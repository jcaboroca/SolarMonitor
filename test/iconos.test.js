import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { APARATOS_POR_DEFECTO, CARGA_REFERENCIA, CONSUMOS_FIJOS } from "../js/asesor/aparatos.js";
import { iconoAparato, iconoRazon, forma, htmlIcono, htmlFuente } from "../js/iconos.js";

const raiz = new URL("../", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, raiz), "utf8");
const simbolos = new Set([...leer("index.html").matchAll(/<symbol id="([\w-]+)"/g)].map((m) => m[1]));
const PICTOGRAMA = /\p{Extended_Pictographic}/u;

test("cada aparato del asesor tiene un icono que existe en el sprite", () => {
  for (const a of [CARGA_REFERENCIA, ...APARATOS_POR_DEFECTO, ...CONSUMOS_FIJOS]) {
    assert.ok(simbolos.has(iconoAparato(a.id)), `${a.id} → ${iconoAparato(a.id)}`);
  }
  assert.equal(iconoAparato("lavadora"), "i-lavadora");
  assert.equal(iconoAparato("referencia"), "i-potencia");
});

test("un aparato desconocido cae en i-potencia", () => {
  assert.equal(iconoAparato("tostadora"), "i-potencia");
});

test("cada icono de razón que emite el motor tiene su símbolo", () => {
  const usados = new Set([...leer("js/asesor/motor.js").matchAll(/icono: "([^"]+)"/g)].map((m) => m[1]));
  assert.ok(usados.size >= 8);
  for (const emoji of usados) assert.ok(simbolos.has(iconoRazon(emoji)), `${emoji} → ${iconoRazon(emoji)}`);
  assert.equal(iconoRazon("☀️"), "i-sol");
  assert.equal(iconoRazon("💶"), "i-euro");
});

test("una razón con icono desconocido no lleva icono", () => {
  assert.equal(iconoRazon("🦄"), null);
});

test("el semáforo usa las formas propias", () => {
  assert.deepEqual(["verde", "amarillo", "rojo"].map(forma), ["f-bien", "f-cuidado", "f-evita"]);
  assert.equal(forma(""), null);
});

test("htmlIcono devuelve un uso del sprite oculto para el lector de pantalla", () => {
  assert.equal(htmlIcono("i-sol"), '<svg class="i" aria-hidden="true" focusable="false"><use href="#i-sol"></use></svg>');
});

test("las etiquetas de procedencia llevan icono SVG y nombre, sin emoji", () => {
  const esperado = { factura: ["i-documento", "Factura"], solarman: ["i-sol", "Solarman"], datadis: ["i-contador", "datadis"] };
  for (const [tipo, [icono, nombre]] of Object.entries(esperado)) {
    const html = htmlFuente(tipo);
    assert.ok(html.startsWith(`<span class="fuente ${tipo}">`), html);
    assert.ok(html.includes(`#${icono}`), html);
    assert.ok(html.endsWith(`${nombre}</span>`), html);
    assert.doesNotMatch(html, PICTOGRAMA);
  }
});
