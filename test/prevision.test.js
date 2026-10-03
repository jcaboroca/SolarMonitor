process.env.TZ = "Europe/Madrid";
import { test } from "node:test";
import assert from "node:assert/strict";
import { leerOpenMeteo, calibrar, preverSolar, urlPrevision } from "../js/asesor/prevision.js";

test("la radiacion de Open-Meteo es la media de la hora anterior", () => {
  const t = new Date(2026, 9, 5, 13).getTime() / 1000;
  const horas = leerOpenMeteo({ hourly: { time: [t], shortwave_radiation: [500], cloud_cover: [20] } });
  assert.equal(horas[0].inicio.getHours(), 12);
  assert.equal(horas[0].irradiancia, 500);
  assert.equal(horas[0].nubes, 20);
});

test("la URL redondea la ubicacion a dos decimales", () => {
  const url = urlPrevision({ lat: 40.416775, lon: -3.70379 });
  assert.match(url, /latitude=40\.42&/);
  assert.match(url, /longitude=-3\.7&/);
  assert.match(url, /shortwave_radiation/);
});

function historico(dias, k) {
  const reales = [], irradiancia = [];
  for (let d = 0; d < dias; d++) {
    for (let h = 7; h < 20; h++) {
      const inicio = new Date(2026, 8, 1 + d, h);
      const irr = 800 * Math.sin(((h - 6) / 14) * Math.PI);
      irradiancia.push({ inicio, irradiancia: irr });
      reales.push({ inicio, solarKwh: k(h) * irr, cobertura: 1 });
    }
  }
  return { reales, irradiancia };
}

test("calibra un factor por hora del dia", () => {
  const { reales, irradiancia } = historico(20, (h) => (h < 14 ? 0.002 : 0.001));
  const c = calibrar(reales, irradiancia);
  assert.ok(Math.abs(c.kPorHora[10] - 0.002) < 1e-9);
  assert.ok(Math.abs(c.kPorHora[16] - 0.001) < 1e-9);
  assert.equal(c.confianza, "alta");
});

test("la prevision usa el factor de su hora y no pasa del maximo visto", () => {
  const { reales, irradiancia } = historico(20, () => 0.002);
  const c = calibrar(reales, irradiancia);
  const inicio = new Date(2026, 9, 5, 12);
  const [p] = preverSolar([{ inicio, irradiancia: 5000 }], c, { ahora: new Date(2026, 9, 5, 8) });
  assert.ok(p.kwh <= c.maxKwh + 1e-9);
  assert.equal(p.origen, "prevision");
});

test("sin historico tira de la potencia pico si se conoce", () => {
  const c = calibrar([], []);
  assert.equal(c.confianza, "ninguna");
  const [p] = preverSolar([{ inicio: new Date(2026, 9, 5, 12), irradiancia: 1000 }], c, { kWp: 2, ahora: new Date(2026, 9, 5, 8) });
  assert.ok(Math.abs(p.kwh - 1.6) < 1e-9);
  assert.equal(p.origen, "estimado");
  assert.equal(p.confianza, "baja");
});

test("sin historico ni potencia pico no inventa produccion", () => {
  const p = preverSolar([{ inicio: new Date(2026, 9, 5, 12), irradiancia: 1000 }], calibrar([], []), {});
  assert.equal(p.length, 0);
});

test("baja la confianza a mas de 24 h vista", () => {
  const { reales, irradiancia } = historico(20, () => 0.002);
  const c = calibrar(reales, irradiancia);
  const ahora = new Date(2026, 9, 5, 8);
  const [cerca, lejos] = preverSolar(
    [{ inicio: new Date(2026, 9, 5, 12), irradiancia: 500 }, { inicio: new Date(2026, 9, 6, 15), irradiancia: 500 }],
    c,
    { ahora }
  );
  assert.equal(cerca.confianza, "alta");
  assert.equal(lejos.confianza, "media");
});
