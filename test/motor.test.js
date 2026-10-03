process.env.TZ = "Europe/Madrid";
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidir, reservaRecomendada, lineaDelDia, construirHorizonte, BATERIA_POR_DEFECTO } from "../js/asesor/motor.js";
import { CARGA_REFERENCIA } from "../js/asesor/aparatos.js";

const HORA = 3600000;
const bateria = { ...BATERIA_POR_DEFECTO, capacidadKwh: 5, socMinimoPct: 10, rendimiento: 0.9 };

// Lunes 5 de octubre de 2026 a la hora indicada.
const lunes = (hora) => new Date(2026, 9, 5, hora);

function horizonte(ahora, { solar = () => 0, casa = () => 0.4, compra = () => 0.2, venta = 0.016, horas = 36 } = {}) {
  return Array.from({ length: horas }, (_, i) => {
    const inicio = new Date(ahora.getTime() + i * HORA);
    return {
      inicio, fin: new Date(inicio.getTime() + HORA), horas: 1,
      solarKwh: solar(inicio.getHours(), i), casaKwh: casa(inicio.getHours()),
      compra: compra(inicio.getHours(), inicio), venta, confianza: "alta", origenSolar: "prevision", origenCasa: "habito",
    };
  });
}

const soleado = (h) => (h >= 9 && h < 18 ? 1.8 : 0);

test("caso 1: sol alto + bateria llena + precio alto → verde", () => {
  const ahora = lunes(13);
  const slots = horizonte(ahora, { solar: soleado });
  const r = decidir({ ahora, slots, bateria, socPct: 100, carga: CARGA_REFERENCIA });
  assert.equal(r.estado, "verde");
  assert.ok(r.ahora.coste < 0.03, `coste ${r.ahora.coste}`);
});

test("caso 2: sin sol + bateria al 20 % + precio alto, sol manana → rojo", () => {
  const ahora = lunes(19);
  const slots = horizonte(ahora, { solar: soleado });
  const r = decidir({ ahora, slots, bateria, socPct: 20, carga: CARGA_REFERENCIA });
  assert.equal(r.estado, "rojo");
  assert.ok(r.mejor.inicio.getDate() === 6 && r.mejor.inicio.getHours() >= 9, `mejor ${r.mejor.inicio}`);
  assert.ok(r.razones.some((x) => /Mañana a las 09:00/.test(x.texto)), JSON.stringify(r.razones));
});

test("caso 3: precio medio ahora + precio bajo despues → amarillo", () => {
  const ahora = lunes(8);
  const precio = (h) => (h >= 22 || h < 8 ? 0.08 : (h >= 10 && h < 14) || (h >= 18 && h < 22) ? 0.2 : 0.13);
  const slots = horizonte(ahora, { compra: precio });
  const r = decidir({ ahora, slots, bateria, socPct: 10, carga: CARGA_REFERENCIA });
  assert.equal(r.estado, "amarillo");
  assert.equal(r.mejor.inicio.getHours(), 22);
});

test("caso 4: bateria baja + manana nublado → guardar bateria", () => {
  const ahora = lunes(21);
  const nublado = horizonte(ahora, { solar: (h) => (h >= 9 && h < 18 ? 0.1 : 0), casa: () => 0.3 });
  const despejado = horizonte(ahora, { solar: soleado, casa: () => 0.3 });
  const malo = reservaRecomendada({ slots: nublado, bateria, socPct: 25 });
  const bueno = reservaRecomendada({ slots: despejado, bateria, socPct: 25 });
  assert.equal(malo.sinSol, true);
  assert.equal(malo.suficiente, false);
  assert.equal(malo.aplicaAhora, true);
  assert.ok(malo.pct > bueno.pct);
  assert.equal(bueno.hasta.getHours(), 9);
});

test("caso 5: bateria alta + excedente → verde y la mejor ventana es ahora", () => {
  const ahora = lunes(11);
  const slots = horizonte(ahora, { solar: soleado });
  const r = decidir({ ahora, slots, bateria, socPct: 95, carga: CARGA_REFERENCIA });
  assert.equal(r.estado, "verde");
  assert.equal(r.mejor.inicio.getTime(), ahora.getTime());
});

test("evalua la ventana completa del programa, no solo la primera hora", () => {
  const ahora = lunes(15);
  // A las 17 hay sol, pero el programa de 3 h se come las horas sin sol de despues.
  const slots = horizonte(ahora, { solar: (h, i) => (i < 30 && h >= 9 && h < 18 ? 1.8 : 0) });
  const programa = { id: "x", nombre: "Largo", energiaKwh: 3, duracionH: 3, potenciaPicoW: 1000 };
  const r = decidir({ ahora, slots, bateria, socPct: 100, carga: programa });
  const a17 = r.candidatos.find((c) => c.inicio.getHours() === 17 && c.inicio.getDate() === 5);
  const a15 = r.candidatos[0];
  assert.ok(a15.coste < a17.coste);
});

test("superar la potencia contratada pone rojo", () => {
  const ahora = lunes(20);
  const slots = horizonte(ahora, { casa: () => 0.5 });
  const horno = { id: "horno", nombre: "Horno", energiaKwh: 3, duracionH: 1, potenciaPicoW: 3000 };
  const r = decidir({ ahora, slots, bateria, socPct: 10, carga: horno, potenciaContratadaKw: 3.1 });
  assert.equal(r.excedePotencia, true);
  assert.equal(r.estado, "rojo");
});

test("es determinista", () => {
  const ahora = lunes(19);
  const slots = horizonte(ahora, { solar: soleado });
  const a = decidir({ ahora, slots, bateria, socPct: 40, carga: CARGA_REFERENCIA });
  const b = decidir({ ahora, slots, bateria, socPct: 40, carga: CARGA_REFERENCIA });
  assert.deepEqual(a, b);
});

test("la linea del dia da un estado por hora", () => {
  const ahora = lunes(0);
  const slots = horizonte(ahora, { solar: soleado });
  const linea = lineaDelDia({ ahora, slots, bateria, socPct: 50, carga: CARGA_REFERENCIA });
  assert.equal(linea.length, 24);
  assert.equal(linea[13].estado, "verde");
  assert.notEqual(linea[20].estado, "verde");
});

test("construirHorizonte usa el dato en vivo en el tramo actual", () => {
  const ahora = new Date(2026, 9, 5, 12, 30);
  const habitos = { consumo: () => ({ kwh: 0.3, origen: "habito", confianza: "alta" }), solarTipica: () => null };
  const solar = [{ inicio: lunes(12), kwh: 1, origen: "prevision", confianza: "alta" }, { inicio: lunes(13), kwh: 1.5, origen: "prevision", confianza: "alta" }];
  const tarifa = { precioCompra: () => 0.14, precioVenta: () => 0.016 };
  const vivo = { instante: new Date(2026, 9, 5, 12, 25), solarW: 2000, casaW: 400, soc: 80 };
  const slots = construirHorizonte({ ahora, vivo, solar, habitos, tarifa, horas: 3 });
  assert.equal(slots[0].horas, 0.5);
  assert.equal(slots[0].solarKwh, 1);
  assert.equal(slots[0].casaKwh, 0.2);
  assert.equal(slots[0].origenSolar, "real");
  assert.equal(slots[1].solarKwh, 1.5);
  assert.equal(slots[1].casaKwh, 0.3);
});

test("sin dato en vivo el tramo actual tira de prevision y lo dice", () => {
  const ahora = new Date(2026, 9, 5, 12, 30);
  const habitos = { consumo: () => ({ kwh: 0.3, origen: "habito", confianza: "alta" }), solarTipica: () => null };
  const solar = [{ inicio: lunes(12), kwh: 1, origen: "prevision", confianza: "alta" }];
  const tarifa = { precioCompra: () => 0.14, precioVenta: () => 0.016 };
  const slots = construirHorizonte({ ahora, vivo: null, solar, habitos, tarifa, horas: 2 });
  assert.equal(slots[0].solarKwh, 0.5);
  assert.equal(slots[0].origenSolar, "prevision");
  const r = decidir({ ahora, slots, bateria, socPct: 50, carga: CARGA_REFERENCIA, vivo: null });
  assert.ok(r.razones.some((x) => /Sin dato en vivo/.test(x.texto)));
});
