import { test } from "node:test";
import assert from "node:assert/strict";
import { avanzarInforme, solicitarInforme } from "../worker/src/informe-flujo.js";
import { integrarDia } from "../worker/src/informe-calculo.js";
import { limitesDia } from "../worker/src/horario.js";
import worker from "../worker/src/index.js";

const AHORA = Date.UTC(2026, 10, 8, 7, 25);
const MINUTO = 60000;
const FECHA = "2026-11-07";
function entorno() {
  const { inicio, fin } = limitesDia(FECHA);
  const puntos = [];
  for (let t = inicio / 1000; t < fin / 1000; t += 300) puntos.push([t, 400, 800, 400, 0, 0, 0, 50]);
  const datos = new Map(Object.entries({
    "informe-config": { activo: true, consentimiento: true, pushActivo: false, ubicacion: { lat: 41.3, lon: 2 }, tarifa: null },
    "solarman-dia": { dia: FECHA, integrado: integrarDia(puntos, FECHA) },
    "solarman-curvas": { dias: { [FECHA]: 288 }, diarios: {}, horas: [] },
  }).map(([k, v]) => [k, JSON.stringify(v)]));
  const lecturas = [];
  return { HISTORICO: {
    datos, lecturas,
    get: async (k, tipo) => { lecturas.push(k); const v = datos.get(k); return v === undefined ? null : tipo === "json" ? JSON.parse(v) : v; },
    put: async (k, v) => { datos.set(k, v); },
    delete: async (k) => { datos.delete(k); },
  } };
}
const sinRed = async () => assert.fail("esta fase no necesita red");
const meteo = async () => new Response(JSON.stringify({ hourly: {
  time: [Date.UTC(2026, 10, 8, 11) / 1000], shortwave_radiation: [400], cloud_cover: [10],
} }));

test("una invocacion solo prepara una fase; informe y aviso nunca comparten la ejecucion", async () => {
  const e = entorno();
  const fases = [];
  for (let i = 0; i < 4; i++) {
    const r = await avanzarInforme(e, { ahora: AHORA + i * MINUTO, pedir: i === 1 ? meteo : sinRed });
    fases.push(r.fase);
    if (i < 3) assert.equal(e.HISTORICO.datos.has(`informe-${FECHA}`), false);
  }
  assert.deepEqual(fases, ["fuente", "prevision", "calibracion", "informe"]);
  const informe = JSON.parse(e.HISTORICO.datos.get(`informe-${FECHA}`));
  assert.equal(informe.estado, "ok");
  assert.equal(informe.hoy.estado, "sin_calibracion");
  assert.equal((await avanzarInforme(e, { ahora: AHORA + 4 * MINUTO, pedir: sinRed })).resultado, "antes_de_hora");
  const envio = await avanzarInforme(e, { ahora: AHORA + 5 * MINUTO, pedir: sinRed });
  assert.equal(envio.fase, "aviso");
  assert.equal((await avanzarInforme(e, { ahora: AHORA + 6 * MINUTO, pedir: sinRed })).resultado, "completo");
});

test("solicitar manualmente no calcula ni toca curvas; una solicitud repetida no reinicia el trabajo", async () => {
  const e = entorno();
  const r = await solicitarInforme(e, { ahora: AHORA - 60 * MINUTO });
  assert.equal(r.estado, "preparando");
  assert.equal(r.fecha, FECHA);
  assert.equal(e.HISTORICO.lecturas.includes("solarman-curvas"), false);
  assert.equal(e.HISTORICO.datos.has(`informe-${FECHA}`), false);
  await avanzarInforme(e, { ahora: AHORA - 59 * MINUTO, pedir: sinRed });
  const antes = e.HISTORICO.datos.get("informe-trabajo");
  await solicitarInforme(e, { ahora: AHORA - 58 * MINUTO });
  assert.equal(e.HISTORICO.datos.get("informe-trabajo"), antes);
});

test("cambiar ubicacion entre fases descarta la preparacion vieja antes de usarla", async () => {
  const e = entorno();
  await avanzarInforme(e, { ahora: AHORA, pedir: sinRed });
  await avanzarInforme(e, { ahora: AHORA + MINUTO, pedir: meteo });
  const config = JSON.parse(e.HISTORICO.datos.get("informe-config"));
  e.HISTORICO.datos.set("informe-config", JSON.stringify({ ...config, ubicacion: { lat: 40.4, lon: -3.7 } }));
  const r = await avanzarInforme(e, { ahora: AHORA + 2 * MINUTO, pedir: sinRed });
  assert.equal(r.fase, "fuente");
  assert.equal(e.HISTORICO.datos.has(`informe-${FECHA}`), false);
});

test("las excepciones dejan estado visible y reintentos acotados, sin anunciar informe generado", async () => {
  const e = entorno();
  const get = e.HISTORICO.get;
  e.HISTORICO.get = async (k, t) => {
    if (k === "solarman-curvas") throw new Error("KV no disponible");
    return get(k, t);
  };
  for (let i = 0; i < 3; i++) {
    const r = await avanzarInforme(e, { ahora: AHORA + i * MINUTO, pedir: sinRed });
    assert.equal(r.resultado, "error");
  }
  const final = await avanzarInforme(e, { ahora: AHORA + 4 * MINUTO, pedir: sinRed });
  assert.equal(final.resultado, "agotado");
  assert.equal(e.HISTORICO.datos.has(`informe-${FECHA}`), false);
  assert.ok(JSON.parse(e.HISTORICO.datos.get("informe-trabajo")).error);
});

test("el cron no une sondeo o archivo con la preparacion del informe", async () => {
  for (const minuto of [2, 3, 4]) {
    const e = entorno();
    const tareas = [];
    await worker.scheduled({ cron: "* * * * *", scheduledTime: Date.UTC(2026, 10, 8, 8, minuto) }, e, { waitUntil: (p) => tareas.push(p) });
    await Promise.all(tareas);
    assert.equal(tareas.length, 1);
    assert.equal(e.HISTORICO.lecturas.includes("informe-config"), false);
    assert.equal(e.HISTORICO.datos.has(`informe-${FECHA}`), false);
  }
});

test("la preparacion empieza a las 08:25 de Madrid tambien con horario de verano", async () => {
  for (const [mes, dia, horaUtc] of [[0, 15, 7], [5, 15, 6], [2, 29, 6], [9, 25, 7]]) {
    const e = entorno();
    assert.equal((await avanzarInforme(e, { ahora: Date.UTC(2026, mes, dia, horaUtc, 24), pedir: sinRed })).resultado, "antes_de_hora");
    assert.equal((await avanzarInforme(e, { ahora: Date.UTC(2026, mes, dia, horaUtc, 25), pedir: sinRed })).fase, "fuente");
  }
});

test("un trabajo heredado de ayer se reinicia sin mezclar snapshots al cruzar medianoche", async () => {
  const e = entorno();
  await solicitarInforme(e, { ahora: AHORA });
  await avanzarInforme(e, { ahora: AHORA + MINUTO, pedir: sinRed });
  const anterior = JSON.parse(e.HISTORICO.datos.get("informe-trabajo"));
  const manana = AHORA + 86400000;
  assert.equal((await avanzarInforme(e, { ahora: manana, pedir: sinRed })).fase, "fuente");
  const nuevo = JSON.parse(e.HISTORICO.datos.get("informe-trabajo"));
  assert.equal(nuevo.fecha, "2026-11-08");
  assert.notEqual(nuevo.id, anterior.id);
});
