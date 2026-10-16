// F2 «Ahora»: comprobaciones estáticas del marcado, del service worker y de los textos.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const raiz = new URL("../", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, raiz), "utf8");
const html = leer("index.html");
const idsHtml = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

function constantesSw() {
  const contexto = { self: { addEventListener() {} } };
  vm.createContext(contexto);
  vm.runInContext(leer("sw.js"), contexto);
  return vm.runInContext("({ CACHE, BASE })", contexto);
}

test("el service worker guarda js/arco.js y sube la caché a v40", () => {
  const { CACHE, BASE } = constantesSw();
  assert.ok(BASE.includes("./js/arco.js"));
  assert.equal(CACHE, "solar-monitor-v40");
});

test("todo id que piden ahora.js y arco.js existe en index.html", () => {
  for (const fichero of ["js/ahora.js", "js/arco.js"]) {
    for (const [, id] of leer(fichero).matchAll(/\$\("([\w-]+)"\)/g)) assert.ok(idsHtml.has(id), `${fichero}: #${id}`);
  }
});

test("el arco usa el viewBox ampliado del anillo horario (E4) y se describe con su resumen", () => {
  assert.match(html, /<svg role="img" aria-labelledby="arcoResumen" viewBox="0 -22 400 242">/);
  assert.match(html, /id="arcoResumen"/);
  assert.match(leer("js/arco.js"), /CAJA = \{ x: 0, y: -22, ancho: 400, alto: 242 \}/);
});

test("las pestañas conservan ids y paneles, y van numeradas 01–05 (E10)", () => {
  const pestanas = ["ahora", "datos", "cuadra", "meses", "dia"];
  pestanas.forEach((n, i) => {
    assert.ok(idsHtml.has(`pestana-${n}`) && idsHtml.has(`panel-${n}`), n);
    assert.match(html, new RegExp(`id="pestana-${n}"[^>]*>\\s*<span class="num" aria-hidden="true">0${i + 1}</span>`));
  });
  assert.match(html, /role="tablist"/);
});

test("el cuenco mantiene el estado vivo del semáforo y las cifras del asesor", () => {
  assert.match(html, /<section class="semaforo" id="semaforo" role="status" aria-live="polite">/);
  for (const id of ["tituloSemaforo", "costeAhora", "proximaVentana", "cifrasVivo", "frescura", "listaVentanas", "linea", "razones", "pctReserva", "textoReserva"]) {
    assert.ok(idsHtml.has(id), id);
  }
});

test("ningún texto del arco habla de amanecer, ocaso, elevación ni mediodía", () => {
  const panelAhora = html.slice(html.indexOf('id="panel-ahora"'), html.indexOf("<!-- 1 · Datos -->"));
  for (const [nombre, texto] of [["panel Ahora", panelAhora], ["js/arco.js", leer("js/arco.js")]]) {
    assert.doesNotMatch(texto, /amanecer|ocaso|elevaci[oó]n|mediod[ií]a/i, nombre);
  }
});

test("arco.js no escribe emojis ni colores literales", () => {
  const codigo = leer("js/arco.js");
  assert.doesNotMatch(codigo, /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(codigo, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
});

test("la parte pura de arco.js no toca el DOM, localStorage ni la red", () => {
  const codigo = leer("js/arco.js");
  const puro = codigo.slice(0, codigo.indexOf("// --- Pintado")).replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(puro, /\bdocument\b|\bwindow\b|localStorage|fetch\(/);
});
