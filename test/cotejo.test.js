process.env.TZ = "Europe/Madrid";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as f from "../js/factura.js";

const factura = {
  desde: new Date(2026, 9, 1), hasta: new Date(2026, 10, 1), comercializadora: "Octopus",
};
const curvaCompleta = () => Array.from({ length: 745 }, (_, i) => ({
  instante: new Date(+factura.desde + i * 3600000), consumo: 1, vertido: 0, real: true,
}));

test("el periodo de Octopus termina antes del dia final impreso", () => {
  assert.equal(typeof f.periodoFactura, "function");
  assert.equal(+f.periodoFactura(factura).hasta, +new Date(2026, 10, 1));
  assert.equal(+f.periodoFactura({ ...factura, comercializadora: "Otra", hasta: new Date(2026, 9, 31) }).hasta, +new Date(2026, 10, 1));
});

test("calcular la lectura impresa no convierte en estimado el consumo horario", () => {
  const parsed = f.interpretarFactura(`Octopus Energy
Periodo: 01-10-2026 a 01-11-2026 (31 días)
Procedencia: Calculada
Lectura Anterior 100 200 300
Lectura Actual 101 202 303
Consumo kWh 1 2 3`);
  assert.equal(parsed.procedencia, "Calculada");
  assert.equal(parsed.lecturas.P1.estimada, false);
});

test("un consumo explicitamente estimado sigue identificado como estimado", () => {
  const parsed = f.interpretarFactura(`Octopus Energy
Procedencia: Estimada
Lectura Anterior 100 200 300
Lectura Actual 101 202 303
Consumo kWh 1 2 3`);
  assert.equal(parsed.lecturas.P1.estimada, true);
});

test("cotejar limita contador y datalogger al intervalo de una factura parcial", () => {
  assert.equal(typeof f.cotejarFactura, "function");
  const parcial = { ...factura, desde: new Date(2026, 9, 31) };
  const serie = { unidadesRol: { importada: "W", exportada: "W" }, registros: [
    { instante: new Date(2026, 9, 30, 23), horas: 1, importada: 9000, exportada: 0 },
    { instante: new Date(2026, 9, 31), horas: 1, importada: 1000, exportada: 0 },
  ] };
  const c = f.cotejarFactura(parcial, serie, curvaCompleta());
  assert.equal(c.contador.total, 24);
  assert.equal(c.contador.cobertura.completa, true);
  assert.equal(c.solarman.total, 1);
  assert.equal(c.coberturaSolarman.esperadas, 24);
  assert.equal(c.coberturaSolarman.horas, 1);
});

test("una curva real completa puede confirmar la factura aunque SolarMAN tenga huecos", () => {
  assert.equal(typeof f.diagnosticoCotejo, "function");
  const c = f.cotejarFactura(factura, null, curvaCompleta());
  const r = f.diagnosticoCotejo({ total: 745 }, c);
  assert.equal(r.tono, "bien");
  assert.match(r.mensaje, /Datadis/);
});

test("una curva parcial o estimada nunca confirma la factura como verificada", () => {
  assert.equal(typeof f.diagnosticoCotejo, "function");
  const parcial = f.cotejarFactura(factura, null, curvaCompleta().slice(0, 100));
  assert.notEqual(f.diagnosticoCotejo({ total: 100 }, parcial).tono, "bien");
  const estimada = f.cotejarFactura(factura, null, curvaCompleta().map((p) => ({ ...p, real: false })));
  assert.notEqual(f.diagnosticoCotejo({ total: 745 }, estimada).tono, "bien");
});

test("sin fechas de factura no se afirma que el contador y la factura sean comparables", () => {
  assert.equal(typeof f.diagnosticoCotejo, "function");
  const c = f.cotejarFactura({}, null, curvaCompleta());
  assert.notEqual(f.diagnosticoCotejo({ total: 745 }, c).tono, "bien");
});

test("cero medido y consumo facturado positivo no equivalen a diferencia cero", () => {
  assert.equal(typeof f.diferenciaEnergia, "function");
  assert.deepEqual(f.diferenciaEnergia(100, 0), { diferencia: 100, relativo: null });
  assert.deepEqual(f.diferenciaEnergia(0, 0), { diferencia: 0, relativo: 0 });
});
