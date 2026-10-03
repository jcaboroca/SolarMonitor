import { test } from "node:test";
import assert from "node:assert/strict";
import { simular } from "../js/asesor/simulador.js";

const bateria = { capacidadKwh: 5, socMinimoPct: 10, rendimiento: 1, maxCargaKw: 2, maxDescargaKw: 3 };
const hora = (solarKwh, casaKwh, extraKwh = 0) => ({ horas: 1, solarKwh, casaKwh, extraKwh, compra: 0.14, venta: 0.016 });

test("el excedente carga la bateria y lo que sobra se vierte", () => {
  const r = simular([hora(3, 0.5)], bateria, 50);
  assert.equal(r.pasos[0].cargaKwh, 2); // limitado por maxCargaKw
  assert.ok(Math.abs(r.pasos[0].exportKwh - 0.5) < 1e-9);
  assert.equal(r.pasos[0].importKwh, 0);
  assert.equal(r.pasos[0].socPct, 90);
});

test("la bateria llena vierte todo el excedente", () => {
  const r = simular([hora(2, 0.5)], bateria, 100);
  assert.equal(r.pasos[0].cargaKwh, 0);
  assert.equal(r.pasos[0].exportKwh, 1.5);
  assert.ok(Math.abs(r.coste - -1.5 * 0.016) < 1e-9);
});

test("la descarga no baja del suelo de SoC y el resto se compra", () => {
  const r = simular([hora(0, 1)], bateria, 20); // 0,5 kWh por encima del 10 %
  assert.equal(r.pasos[0].descargaKwh, 0.5);
  assert.equal(r.pasos[0].importKwh, 0.5);
  assert.equal(r.pasos[0].socPct, 10);
});

test("el rendimiento se reparte entre carga y descarga", () => {
  const r = simular([hora(1, 0), hora(0, 0.5)], { ...bateria, rendimiento: 0.81 }, 50);
  assert.ok(Math.abs(r.pasos[0].socPct - (50 + 0.9 * 1 / 5 * 100)) < 1e-9);
  // entregar 0,5 kWh cuesta 0,5 / 0,9 de la bateria
  assert.ok(Math.abs(r.pasos[1].socPct - (r.pasos[0].socPct - 0.5 / 0.9 / 5 * 100)) < 1e-9);
});

test("la carga extra se suma al consumo", () => {
  const sin = simular([hora(0, 0.2)], bateria, 10);
  const con = simular([hora(0, 0.2, 1)], bateria, 10);
  assert.ok(Math.abs(con.coste - sin.coste - 0.14) < 1e-9);
});

test("energia util final por encima del suelo", () => {
  const r = simular([hora(0, 0)], bateria, 60);
  assert.equal(r.energiaUtilFinalKwh, 2.5);
});
