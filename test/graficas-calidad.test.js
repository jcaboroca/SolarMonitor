import { test } from "node:test";
import assert from "node:assert/strict";
import { barrasAgrupadas } from "../js/graficas.js";
import { modeloAnual } from "../js/anual.js";

test("una barra ausente se distingue del cero real y tiene descripcion accesible", (t) => {
  const previo = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  t.after(() => { globalThis.window = previo; });
  const textos = [], atributos = new Map();
  const ctx = {
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {},
    fillText: (texto) => textos.push(texto), measureText: (texto) => ({ width: texto.length * 5 }),
  };
  const canvas = { getContext: () => ctx, setAttribute: (k, v) => atributos.set(k, v) };
  barrasAgrupadas(canvas, { etiquetas: ["septiembre", "octubre"], series: [{ nombre: "Factura", color: "red", valores: [0, null] }] });
  assert.ok(textos.includes("?"));
  assert.match(atributos.get("aria-label"), /septiembre.*0 kWh/);
  assert.match(atributos.get("aria-label"), /octubre.*sin datos/);
});

test("tener datos todos los dias no oculta los huecos horarios del mes", () => {
  const modelo = modeloAnual([
    { mes: "2026-09", dias: 30, cobertura: { completa: false, porcentaje: 90 }, medido: { produccion: 200 } },
    { mes: "2026-10", dias: 31, cobertura: { completa: true, porcentaje: 100 }, medido: { produccion: 100 } },
  ]);
  assert.equal(modelo.meses[8].parcial, true);
  assert.equal(modelo.meses[9].parcial, false);
});
