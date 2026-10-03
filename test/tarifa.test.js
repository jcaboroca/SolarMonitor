process.env.TZ = "Europe/Madrid";
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearTarifa, IMPUESTO_ELECTRICO, IVA } from "../js/asesor/tarifa.js";

const impuestos = (1 + IMPUESTO_ELECTRICO) * (1 + IVA);

test("precio plano por defecto con impuestos", () => {
  const t = crearTarifa();
  const lunes11 = new Date(2026, 9, 5, 11);
  assert.ok(Math.abs(t.precioCompra(lunes11) - 0.108727 * impuestos) < 1e-9);
  assert.ok(Math.abs(t.precioVenta(lunes11) - 0.012645 * impuestos) < 1e-9);
});

test("precios por periodo 2.0TD", () => {
  const t = crearTarifa({ energia: { P1: 0.2, P2: 0.13, P3: 0.08 }, impuestoElectrico: 0, iva: 0 });
  assert.equal(t.precioCompra(new Date(2026, 9, 5, 11)), 0.2); // lunes punta
  assert.equal(t.precioCompra(new Date(2026, 9, 5, 9)), 0.13); // lunes llano
  assert.equal(t.precioCompra(new Date(2026, 9, 5, 3)), 0.08); // valle
  assert.equal(t.precioCompra(new Date(2026, 9, 4, 11)), 0.08); // domingo
});

test("los festivos son valle", () => {
  const t = crearTarifa({ energia: { P1: 0.2, P2: 0.13, P3: 0.08 }, impuestoElectrico: 0, iva: 0, festivos: ["2026-10-12"] });
  assert.equal(t.precioCompra(new Date(2026, 9, 12, 11)), 0.08);
});

test("una serie horaria manda sobre el periodo", () => {
  const hora = new Date(2026, 9, 5, 11);
  const t = crearTarifa({ impuestoElectrico: 0, iva: 0, horaria: new Map([[hora.getTime(), 0.05]]) });
  assert.equal(t.precioCompra(new Date(2026, 9, 5, 11, 30)), 0.05);
  assert.equal(t.precioCompra(new Date(2026, 9, 5, 12)), 0.108727);
});
