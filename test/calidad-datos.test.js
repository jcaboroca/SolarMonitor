process.env.TZ = "Europe/Madrid";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as datos from "../js/datos.js";

test("guardar y restaurar conserva energia y duraciones sin redondeos acumulados", () => {
  const serie = {
    registros: [{ instante: new Date(2026, 9, 1), horas: 1 / 12, importada: 0.0004567 }],
    unidadesRol: { importada: "kWh" }, pasoMinutos: 5,
  };
  const restaurada = datos.deserializarSerie(JSON.parse(JSON.stringify(datos.serializarSerie(serie))));
  assert.deepEqual(restaurada, serie);
});

test("la atribucion a casa no incluye perdidas ni supera su consumo", () => {
  const reparto = datos.repartoCasa({ consumo: 100, importada: 120, solarDirecta: 30, descarga: 50 });
  assert.deepEqual(reparto, { importada: 100, solarDirecta: 0, descarga: 0 });
});

test("el Excel conserva las 25 horas del cambio de octubre", () => {
  const filas = [];
  for (let h = 0; h < 24; h++) {
    for (let vuelta = 0; vuelta < (h === 2 ? 2 : 1); vuelta++) {
      for (let m = 0; m < 60; m += 5) filas.push([
        `2026-10-25 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, 1000,
      ]);
    }
  }
  const s = datos.construirSerie(filas, ["tiempo", "importada"], ["", "W"]);
  assert.equal(new Set(s.registros.map((p) => +p.instante)).size, 300);
  assert.ok(Math.abs(datos.energiaKwh(s.registros, "importada", "W") - 25) < 1e-8);
});

test("un hueco largo solo integra el paso normal, no un paso y medio", () => {
  const s = datos.construirSerie([
    ["2026-10-01 00:00", 1000], ["2026-10-01 00:05", 1000],
    ["2026-10-01 01:05", 1000], ["2026-10-01 01:10", 1000],
  ], ["tiempo", "importada"], ["", "W"]);
  assert.ok(Math.abs(datos.energiaKwh(s.registros, "importada", "W") - 1 / 3) < 1e-8);
});

test("2.0TD aplica festivos nacionales fijos y Reyes sin depender de un campo manual", () => {
  assert.equal(datos.periodoTarifa(new Date(2026, 9, 12, 12)), "P3");
  assert.equal(datos.periodoTarifa(new Date(2026, 0, 6, 12)), "P3");
  assert.equal(datos.periodoTarifa(new Date(2026, 11, 8, 12)), "P3");
  assert.equal(datos.periodoTarifa(new Date(2026, 3, 3, 12)), "P1");
  assert.equal(datos.periodoTarifa(new Date(2026, 5, 24, 12)), "P1");
  assert.equal(datos.periodoTarifa(new Date(2026, 5, 24, 12), new Set(["2026-06-24"])), "P3");
});

test("la cobertura cuenta tiempo unico, no dias presentes ni intervalos duplicados", () => {
  assert.equal(typeof datos.coberturaPeriodo, "function");
  const desde = new Date(2026, 9, 1), hasta = new Date(2026, 10, 1);
  const registros = [
    { instante: desde, horas: 1 }, { instante: desde, horas: 1 },
    { instante: new Date(2026, 9, 31, 23), horas: 1 },
  ];
  const c = datos.coberturaPeriodo(registros, desde, hasta);
  assert.equal(c.horas, 2);
  assert.equal(c.esperadas, 745);
  assert.equal(c.completa, false);
});

test("el resumen del contador conserva las dos horas locales repetidas y sus kWh", () => {
  assert.equal(typeof datos.resumirContador, "function");
  const r = [
    { instante: new Date(2026, 9, 25, 2), consumo: 1, vertido: 0, real: true },
    { instante: new Date(2026, 9, 25, 2), consumo: 2, vertido: 0, real: true },
  ];
  const c = datos.resumirContador(r);
  assert.equal(c.total, 3);
  assert.equal(c.cobertura.horas, 2);
  assert.equal(c.cobertura.esperadas, 745);
  assert.equal(c.cobertura.completa, false);
});

test("la parte de red atribuida a la casa no incluye perdidas o carga de bateria", () => {
  const s = datos.construirSerie([["2026-10-01 00:00", 300, 400]],
    ["tiempo", "consumo", "importada"], ["", "W", "W"]);
  const p = s.registros[0];
  assert.equal(p.redCasa, 300);
  assert.equal(p.autoconsumo + p.redCasa, p.consumo);
  assert.equal(p.importada, 400);
});
