// F3 «Día a día»: comprobaciones estáticas del relato (marcado, service worker, scroll libre,
// movimiento reducido y la única clave nueva de localStorage).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const raiz = new URL("../", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, raiz), "utf8");
const html = leer("index.html");
const css = leer("styles.css");
const idsHtml = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

function constantesSw() {
  const contexto = { self: { addEventListener() {} } };
  vm.createContext(contexto);
  vm.runInContext(leer("sw.js"), contexto);
  return vm.runInContext("({ CACHE, BASE })", contexto);
}

test("el service worker guarda relato.js y relato-vista.js y sube la caché a v41", () => {
  const { CACHE, BASE } = constantesSw();
  assert.ok(BASE.includes("./js/relato.js"));
  assert.ok(BASE.includes("./js/relato-vista.js"));
  assert.equal(CACHE, "solar-monitor-v41");
});

test("todo id que piden relato-vista.js y app.js existe en index.html (o lo crea app.js)", () => {
  const creados = new Set([...leer("js/app.js").matchAll(/\sid="([\w-]+)"/g)].map((m) => m[1]));
  for (const fichero of ["js/relato-vista.js", "js/app.js"]) {
    for (const [, id] of leer(fichero).matchAll(/\$\("([\w-]+)"\)/g)) assert.ok(idsHtml.has(id) || creados.has(id), `${fichero}: #${id}`);
  }
});

test("Día a día conserva los ids de las gráficas y añade el relato (§5.5.2)", () => {
  for (const id of ["graficas", "selectorDia", "diaAnterior", "diaSiguiente", "leyendaDia", "graficaDia", "tituloBateria", "graficaBateria", "leyendaMes", "graficaMes", "graficaCalor", "cotejoContador", "mesContadorDia", "leyendaDiaria", "compraDiaria", "vertidoDiario"]) {
    assert.ok(idsHtml.has(id), id);
  }
  assert.match(html, /<section id="relato" class="relato"/);
  assert.match(html, /class="relato-escenario"/);
  assert.match(html, /<ol class="relato-pasos" id="pasosRelato"/);
  assert.match(html, /id="pasoAnterior"[^>]*aria-label="Momento anterior"/);
  assert.match(html, /id="pasoSiguiente"[^>]*aria-label="Momento siguiente"/);
  assert.match(html, /Saltar el relato/);
});

test("scroll libre: sin preventDefault en wheel/touch y sin scroll-snap obligatorio (criterio 17)", () => {
  const vista = leer("js/relato-vista.js");
  assert.doesNotMatch(vista, /addEventListener\(\s*["'](?:wheel|touch\w*)["']/);
  assert.doesNotMatch(vista, /preventDefault/);
  assert.doesNotMatch(css, /scroll-snap-type\s*:[^;]*mandatory/);
  assert.doesNotMatch(css, /scroll-behavior\s*:\s*smooth/);
});

test("el revelado solo existe con view() y sin movimiento reducido (§5.5.2, §6.2)", () => {
  const bloque = css.match(/@supports\s*\(animation-timeline:\s*view\(\)\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(bloque, "falta @supports (animation-timeline: view())");
  assert.match(bloque[1], /@media\s*\(prefers-reduced-motion:\s*no-preference\)/);
  assert.match(bloque[1], /animation-timeline:\s*view\(\)/);
  assert.doesNotMatch(css.replace(bloque[0], ""), /animation-timeline/);
});

test("la única clave nueva de localStorage es solar-monitor-vista-dia (criterio 29)", () => {
  const vista = leer("js/relato-vista.js");
  const claves = [...vista.matchAll(/localStorage\.setItem\(\s*([^,]+),/g)].map((m) => m[1].trim());
  assert.ok(claves.length > 0);
  for (const clave of claves) assert.match(clave, /^(?:"solar-monitor-vista-dia"|CLAVE_VISTA)$/);
  assert.match(vista, /CLAVE_VISTA = "solar-monitor-vista-dia"/);
});

test("relato.js es puro y los dos módulos no escriben emojis ni colores literales", () => {
  const puro = leer("js/relato.js").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(puro, /\bdocument\b|\bwindow\b|localStorage|fetch\(/);
  for (const fichero of ["js/relato.js", "js/relato-vista.js"]) {
    const codigo = leer(fichero);
    assert.doesNotMatch(codigo, /\p{Extended_Pictographic}/u, fichero);
    assert.doesNotMatch(codigo, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, fichero);
  }
});

test("el relato mide sus tiempos con performance (§7.2)", () => {
  const vista = leer("js/relato-vista.js");
  for (const nombre of ["relato:momentos", "relato:montaje", "relato:paso"]) assert.ok(vista.includes(`"${nombre}"`), nombre);
});
