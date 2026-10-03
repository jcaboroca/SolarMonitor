process.env.TZ = "Europe/Madrid";
import { test } from "node:test";
import assert from "node:assert/strict";
import { aHoras, crearHabitos } from "../js/asesor/habitos.js";

test("aHoras integra la potencia de cada intervalo en su hora", () => {
  const base = new Date(2026, 9, 5, 10, 0).getTime();
  const registros = Array.from({ length: 24 }, (_, i) => ({
    instante: new Date(base + i * 5 * 60000),
    horas: 5 / 60,
    consumo: 600,
    produccion: i < 12 ? 1200 : 0,
    soc: 50 + i,
  }));
  const horas = aHoras(registros);
  assert.equal(horas.length, 2);
  assert.ok(Math.abs(horas[0].casaKwh - 0.6) < 1e-9);
  assert.ok(Math.abs(horas[0].solarKwh - 1.2) < 1e-9);
  assert.equal(horas[1].solarKwh, 0);
  assert.equal(horas[0].socFin, 61);
  assert.equal(horas[0].cobertura, 1);
});

test("aHoras ignora SoC 0, que en el export es una celda vacia", () => {
  const instante = new Date(2026, 9, 5, 10, 0);
  const [h] = aHoras([{ instante, horas: 1, consumo: 0, produccion: 0, soc: 0 }]);
  assert.equal(h.socFin, null);
});

function horasSinteticas(dias, { laborable = 0.3, finde = 0.5 } = {}) {
  const horas = [];
  const inicio = new Date(2026, 8, 1);
  for (let d = 0; d < dias; d++) {
    for (let h = 0; h < 24; h++) {
      const inicioHora = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + d, h);
      const esFinde = [0, 6].includes(inicioHora.getDay());
      horas.push({ inicio: inicioHora, casaKwh: esFinde ? finde : laborable, solarKwh: h >= 9 && h < 18 ? 1 : 0, socFin: 50, cobertura: 1 });
    }
  }
  return horas;
}

test("separa laborables y fines de semana", () => {
  const habitos = crearHabitos(horasSinteticas(28), { ahora: new Date(2026, 8, 29) });
  assert.equal(habitos.consumo(new Date(2026, 9, 5, 12)).kwh, 0.3); // lunes
  assert.equal(habitos.consumo(new Date(2026, 9, 4, 12)).kwh, 0.5); // domingo
  assert.equal(habitos.confianza, "alta");
  assert.equal(habitos.aprendiendo, false);
});

test("con pocos dias avisa de que esta aprendiendo", () => {
  const habitos = crearHabitos(horasSinteticas(3), { ahora: new Date(2026, 8, 4) });
  assert.equal(habitos.confianza, "baja");
  assert.equal(habitos.aprendiendo, true);
});

test("sin historico devuelve el valor por defecto marcado como estimado", () => {
  const habitos = crearHabitos([], { consumoPorDefectoKwh: 0.25 });
  const c = habitos.consumo(new Date(2026, 9, 5, 12));
  assert.equal(c.kwh, 0.25);
  assert.equal(c.origen, "estimado");
});

test("descarta horas con poca cobertura", () => {
  const horas = horasSinteticas(10).map((h) => ({ ...h, cobertura: 0.2 }));
  const habitos = crearHabitos(horas, { ahora: new Date(2026, 8, 11) });
  assert.equal(habitos.dias, 0);
});

test("sin datos recientes usa el historico antiguo con confianza baja y sin sol tipico", () => {
  const habitos = crearHabitos(horasSinteticas(28), { ahora: new Date(2026, 11, 20) });
  assert.equal(habitos.historicoAntiguo, true);
  assert.equal(habitos.aprendiendo, true);
  assert.equal(habitos.confianza, "baja");
  assert.equal(habitos.consumo(new Date(2026, 11, 21, 12)).kwh, 0.3);
  assert.equal(habitos.solarTipica(12), null);
});
