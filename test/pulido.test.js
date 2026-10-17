// F4 «Pulido»: icono de la app (D5), manifiesto, service worker y marcado de Datos, ¿Cuadra? y Mes a mes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const raiz = new URL("../", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, raiz), "utf8");
const html = leer("index.html");
const css = leer("styles.css");
const manifiesto = JSON.parse(leer("manifest.webmanifest"));

function constantesSw() {
  const contexto = { self: { addEventListener() {} } };
  vm.createContext(contexto);
  vm.runInContext(leer("sw.js"), contexto);
  return vm.runInContext("({ CACHE, BASE })", contexto);
}

// Ancho y alto de la cabecera IHDR de un PNG.
function medidasPng(ruta) {
  const b = readFileSync(new URL(ruta, raiz));
  assert.equal(b.toString("latin1", 1, 4), "PNG", ruta);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test("el manifiesto ofrece el icono en SVG, en PNG 192 y 512 y en versión maskable", () => {
  const iconos = manifiesto.icons;
  const buscar = (src) => iconos.find((i) => i.src === src);
  assert.deepEqual(buscar("assets/icono.svg"), { src: "assets/icono.svg", sizes: "any", type: "image/svg+xml", purpose: "any" });
  assert.deepEqual(buscar("assets/icono-192.png"), { src: "assets/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" });
  assert.deepEqual(buscar("assets/icono-512.png"), { src: "assets/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" });
  assert.deepEqual(buscar("assets/icono-maskable-512.png"), { src: "assets/icono-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" });
  for (const icono of iconos) {
    assert.ok(existsSync(new URL(icono.src, raiz)), icono.src);
    if (icono.type === "image/png") assert.deepEqual(medidasPng(icono.src), icono.sizes.split("x").map(Number), icono.src);
  }
});

test("iOS tiene su icono de 180 px", () => {
  assert.match(html, /<link rel="apple-touch-icon" href="assets\/icono-180\.png">/);
  assert.deepEqual(medidasPng("assets/icono-180.png"), [180, 180]);
});

test("el icono maskable llena el lienzo y deja el dibujo dentro de la zona segura", () => {
  const svg = leer("assets/icono-maskable.svg");
  assert.match(svg, /viewBox="0 0 512 512"/);
  assert.match(svg, /<rect width="512" height="512" fill="#14110E"\/>/);
  assert.doesNotMatch(svg, /\brx=/);
  // El dibujo es el del icono normal reducido al 80 % alrededor del centro.
  assert.match(svg, /transform="translate\(51\.2 51\.2\) scale\(0\.8\)"/);
});

test("los dos SVG del icono son el instrumento: horizonte, pista del arco, rayos y sol", () => {
  for (const ruta of ["assets/icono.svg", "assets/icono-maskable.svg"]) {
    const svg = leer(ruta);
    for (const clase of ["horizonte", "pista", "rayo", "sol"]) assert.match(svg, new RegExp(`data-parte="${clase}"`), `${ruta}: ${clase}`);
    assert.doesNotMatch(svg, /#5b8def/i);
  }
});

test("el service worker guarda los SVG y el apple-touch-icon, anual.js y lectura.js, no los PNG del manifest, y sube la caché a v43 o posterior", () => {
  const { CACHE, BASE } = constantesSw();
  assert.ok(Number(CACHE.match(/v(\d+)$/)[1]) >= 43, CACHE);
  for (const entrada of ["./assets/icono.svg", "./assets/icono-maskable.svg", "./assets/icono-180.png", "./js/anual.js", "./js/lectura.js"]) {
    assert.ok(BASE.includes(entrada), entrada);
  }
  // Los PNG del manifest los pide el sistema al instalar la app; no hacen falta sin conexión (122 KB fuera de la instalación del SW)
  for (const png of ["./assets/icono-192.png", "./assets/icono-512.png", "./assets/icono-maskable-512.png"]) {
    assert.ok(!BASE.includes(png), png);
  }
});

test("Datos: dos ranuras numeradas 01 y 02 con el icono de entrada (§5.2)", () => {
  for (const [id, n, titulo] of [["soltarDatos", "01", "Datos del datalogger"], ["soltarFactura", "02", "Factura de la luz"]]) {
    const ranura = html.match(new RegExp(`<label class="soltar ranura" id="${id}">([\\s\\S]*?)</label>`))?.[1];
    assert.ok(ranura, id);
    assert.match(ranura, new RegExp(`<span class="num">${n}</span>`));
    assert.ok(ranura.includes(titulo), titulo);
    assert.match(ranura, /#i-datos/);
  }
});

test("¿Cuadra?: el acta de cotejo tiene la columna del desvío", () => {
  const cabecera = html.match(/<table class="tabla acta" id="tablaFactura"[^>]*>\s*<thead[^>]*>([\s\S]*?)<\/thead>/)?.[1];
  assert.ok(cabecera);
  assert.equal([...cabecera.matchAll(/<th\b/g)].length, 5);
  assert.match(cabecera, />Desvío</);
  assert.equal([...cabecera.matchAll(/class="fuente /g)].length, 2);
});

test("los veredictos llevan forma además de color (criterio 24)", () => {
  for (const tono of ["bien", "regular", "mal"]) assert.match(css, new RegExp(`\\.veredicto\\.${tono}::before`));
});

test("Mes a mes: el año en rayos tiene su figura y el libro conserva sus ids", () => {
  assert.match(html, /<div class="meses-seccion anual-bloque" id="bloqueAnual" hidden>/);
  assert.match(html, /<figure class="arco anual" id="anual"/);
  for (const id of ["historico", "guardarMes", "exportarHistorico", "ficheroHistorico", "avisosHistorico", "tablaHistorico", "detalleMes", "leyendaHistorico", "graficaHistorico"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
});

test("los nuevos módulos no escriben colores literales ni emojis", () => {
  for (const ruta of ["js/anual.js", "js/lectura.js"]) {
    const codigo = leer(ruta);
    assert.doesNotMatch(codigo, /#[0-9a-fA-F]{3,8}\b/, ruta);
    assert.doesNotMatch(codigo, /\p{Extended_Pictographic}/u, ruta);
  }
});
