process.env.TZ = "Europe/Madrid";
import { test } from "node:test";
import assert from "node:assert/strict";
import { urlMercado, leerMercado, preciosIndexados, INDEXADA_POR_DEFECTO } from "../js/asesor/mercado.js";

test("la URL pide de hoy a manana en hora local", () => {
  const url = urlMercado(new Date(2026, 9, 4, 15, 30));
  assert.match(url, /^https:\/\/apidatos\.ree\.es\/es\/datos\/mercados\/precios-mercados-tiempo-real\?/);
  assert.match(url, /start_date=2026-10-04T00:00/);
  assert.match(url, /end_date=2026-10-05T23:59/);
});

test("promedia los cuartos de hora y pasa de €/MWh a €/kWh", () => {
  const json = {
    included: [
      { type: "PVPC", attributes: { values: [{ datetime: "2026-10-04T00:00:00.000+02:00", value: 999 }] } },
      {
        type: "Precio mercado spot",
        attributes: {
          values: [
            { datetime: "2026-10-04T00:00:00.000+02:00", value: 100 },
            { datetime: "2026-10-04T00:15:00.000+02:00", value: 110 },
            { datetime: "2026-10-04T00:30:00.000+02:00", value: 120 },
            { datetime: "2026-10-04T00:45:00.000+02:00", value: 130 },
            { datetime: "2026-10-04T01:00:00.000+02:00", value: 50 },
          ],
        },
      },
    ],
  };
  const precios = leerMercado(json);
  assert.equal(precios.size, 2);
  assert.ok(Math.abs(precios.get(new Date(2026, 9, 4, 0).getTime()) - 0.115) < 1e-12);
  assert.ok(Math.abs(precios.get(new Date(2026, 9, 4, 1).getTime()) - 0.05) < 1e-12);
});

test("sin la serie del mercado devuelve un mapa vacio", () => {
  assert.equal(leerMercado({ included: [] }).size, 0);
  assert.equal(leerMercado(null).size, 0);
});

test("precio indexado = mercado + suplemento + peajes y cargos del periodo", () => {
  const lunes11 = new Date(2026, 9, 5, 11).getTime();
  const lunes3 = new Date(2026, 9, 5, 3).getTime();
  const mercado = new Map([[lunes11, 0.08], [lunes3, 0.13]]);
  const precios = preciosIndexados(mercado, INDEXADA_POR_DEFECTO);
  assert.ok(Math.abs(precios.get(lunes11) - (0.08 + 0.05 + 0.097)) < 1e-12);
  assert.ok(Math.abs(precios.get(lunes3) - (0.13 + 0.05 + 0.003)) < 1e-12);
});

test("con el mercado ponderado de septiembre reproduce la factura de Octopus", () => {
  // Mercado de septiembre de 2026 (REE) ponderado por la compra real de cada hora.
  const ponderado = { P1: 0.126, P2: 0.167, P3: 0.178 };
  const factura = { P1: 0.274, P2: 0.248, P3: 0.232 };
  const horas = { P1: new Date(2026, 8, 7, 11), P2: new Date(2026, 8, 7, 9), P3: new Date(2026, 8, 7, 3) };
  for (const p of ["P1", "P2", "P3"]) {
    const precio = preciosIndexados(new Map([[horas[p].getTime(), ponderado[p]]]), INDEXADA_POR_DEFECTO).get(horas[p].getTime());
    assert.ok(Math.abs(precio - factura[p]) < 0.003, `${p}: ${precio} frente a ${factura[p]}`);
  }
});

test("con la media simple de agosto se acerca a la factura de Octopus", () => {
  // Medias simples (sin ponderar) del mercado por periodo del 24 al 31 de agosto de 2026 (REE).
  const medias = { P1: 0.07784, P2: 0.08302, P3: 0.1325 };
  const factura = { P1: 0.22, P2: 0.157, P3: 0.184 };
  const horas = { P1: new Date(2026, 7, 24, 11), P2: new Date(2026, 7, 24, 9), P3: new Date(2026, 7, 24, 3) };
  for (const p of ["P1", "P2", "P3"]) {
    const precio = preciosIndexados(new Map([[horas[p].getTime(), medias[p]]]), INDEXADA_POR_DEFECTO).get(horas[p].getTime());
    assert.ok(Math.abs(precio - factura[p]) < 0.006, `${p}: ${precio} frente a ${factura[p]}`);
  }
});
