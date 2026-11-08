process.env.TZ = "Europe/Madrid";
import { test } from "node:test";
import assert from "node:assert/strict";
import { archivar, compactar, aHoras, pendientes, diaLocal, mesesArchivados, leerMes, RESUMEN, claveMes } from "../worker/src/archivo.js";

const HORA = 3600000;

function kvFalso(inicial = {}) {
  const datos = new Map(Object.entries(inicial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    escrituras: 0,
    async get(clave, tipo) {
      const v = datos.get(clave);
      return v === undefined ? null : tipo === "json" ? JSON.parse(v) : v;
    },
    async put(clave, valor) {
      this.escrituras++;
      datos.set(clave, valor);
    },
    leer: (clave) => JSON.parse(datos.get(clave) ?? "null"),
  };
}

const json = (cuerpo, status = 200) => ({ ok: status < 400, status, json: async () => cuerpo });

// Un dia de 288 puntos: 400 W de casa siempre y 1200 W de sol de 10 a 16.
function diaDePortal(fecha) {
  const inicio = new Date(fecha + "T00:00:00").getTime() / 1000;
  return {
    records: Array.from({ length: 288 }, (_, i) => {
      const t = inicio + i * 300;
      const hora = new Date(t * 1000).getHours();
      return { dateTime: t, generationPower: hora >= 10 && hora < 16 ? 1200 : 0, usePower: 400, buyPower: 0, gridPower: 0, chargePower: 0, dischargePower: 0, batterySoc: 50, otraCosa: "x" };
    }),
  };
}

const sesionValida = { "solarman-sesion": { refresh: "r", access: "a", caduca: Date.UTC(2030, 0, 1) } };
const diariosCompletos = (dias) => Object.fromEntries(Object.keys(dias).map((d) => [d, { solar: 1, casa: 1, compra: 1, venta: 0, carga: 0, descarga: 0, cob: { solar: 1, casa: 1, compra: 1, venta: 1, carga: 1, descarga: 1 } }]));
// Ayer y la semana reciente ya archivados con su cobertura medida: el atrasado sigue su orden desde mayo.
const diasPrevios = Object.fromEntries(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"].map((d) => [d, 288]));
const conAyerCompleto = { ...sesionValida, [RESUMEN]: { dias: diasPrevios, diarios: diariosCompletos(diasPrevios), horas: [] } };

test("diaLocal usa la hora de Madrid", () => {
  assert.equal(diaLocal(Date.UTC(2026, 9, 3, 22, 30)), "2026-10-04");
  assert.equal(diaLocal(Date.UTC(2026, 9, 3, 21, 30)), "2026-10-03");
});

test("compactar se queda con las columnas utiles y ordena", () => {
  const puntos = compactar([{ dateTime: 20, generationPower: 1, usePower: 2, buyPower: 3, gridPower: 4, chargePower: 5, dischargePower: 6, batterySoc: 7 }, { dateTime: 10, usePower: 9 }]);
  assert.deepEqual(puntos, [[10, null, 9, null, null, null, null, null], [20, 1, 2, 3, 4, 5, 6, 7]]);
});

test("aHoras integra cada hora del dia", () => {
  const horas = aHoras(compactar(diaDePortal("2026-08-10").records));
  assert.equal(horas.length, 24);
  assert.deepEqual(horas[12].slice(1), [400, 1200, 50, 60, 60]); // el ultimo es el tiempo con solar medido
  assert.equal(horas[3][2], 0);
});

test("pendientes coge el primer mes incompleto", () => {
  const resumen = { dias: { "2026-05-01": 288, "2026-05-02": 0 } };
  assert.deepEqual(pendientes(resumen, "2026-10-03", 3), ["2026-05-03", "2026-05-04", "2026-05-05"]);
  const casi = { dias: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`2026-05-${String(i + 1).padStart(2, "0")}`, 288])) };
  assert.deepEqual(pendientes(casi, "2026-10-03", 3), ["2026-05-31"]);
});

test("archivar guarda la curva del mes y el resumen con dos escrituras", async () => {
  const kv = kvFalso(conAyerCompleto);
  const pedidas = [];
  const pedir = async (url) => {
    pedidas.push(url);
    const [, a, m, d] = url.match(/year=(\d+)&month=(\d+)&day=(\d+)/);
    return json(diaDePortal(`${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`));
  };
  const r = await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "123" }, { pedir, ahora: Date.UTC(2026, 9, 4, 10), maximo: 2 });
  assert.equal(r.resultado, "archivado");
  assert.deepEqual(r.dias, ["2026-05-01", "2026-05-02"]);
  assert.equal(kv.escrituras, 2);
  assert.match(pedidas[0], /history\/power\/123\/record\?year=2026&month=5&day=1$/);
  const mes = kv.leer(claveMes("2026-05"));
  assert.equal(mes.dias["01"].length, 288);
  assert.equal(mes.dias["01"][0].length, 8);
  assert.equal(kv.leer(RESUMEN).horas.length, 48);
});

test("un dia sin curva se marca para no repetirlo y no escribe el mes", async () => {
  const kv = kvFalso(conAyerCompleto);
  const r = await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json({ records: [] }), ahora: Date.UTC(2026, 9, 4, 10), maximo: 1 });
  assert.equal(r.resultado, "archivado");
  assert.equal(kv.escrituras, 1);
  assert.equal(kv.leer(RESUMEN).dias["2026-05-01"], 0);
});

test("si Solarman falla no marca el dia", async () => {
  const kv = kvFalso(sesionValida);
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json({}, 502), ahora: Date.UTC(2026, 9, 4, 10) });
  assert.deepEqual(kv.leer(RESUMEN).dias, {});
});

test("al dia no pide nada ni escribe", async () => {
  const dias = {};
  for (let t = Date.UTC(2026, 4, 1); t <= Date.UTC(2026, 9, 3); t += 86400000) dias[new Date(t).toISOString().slice(0, 10)] = 288;
  const kv = kvFalso({ ...sesionValida, [RESUMEN]: { dias, diarios: diariosCompletos(dias), horas: [] } });
  const r = await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => assert.fail("no debe pedir"), ahora: Date.UTC(2026, 9, 4, 10) });
  assert.equal(r.resultado, "al dia");
  assert.equal(kv.escrituras, 0);
});

test("sin sesion vigente no hace nada", async () => {
  const kv = kvFalso({ "solarman-sesion": { refresh: "r", access: "a", caduca: 0 } });
  const r = await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => assert.fail("no debe pedir"), ahora: Date.UTC(2026, 9, 4, 10) });
  assert.equal(r.resultado, "sin sesion");
});

test("meses archivados y lectura de un mes", async () => {
  const kv = kvFalso({ [RESUMEN]: { dias: { "2026-05-01": 288, "2026-05-02": 0, "2026-06-01": 280 } }, [claveMes("2026-06")]: { dias: { "01": [] } } });
  assert.deepEqual(await mesesArchivados({ HISTORICO: kv }), { "2026-05": 1, "2026-06": 1 });
  assert.deepEqual(await leerMes({ HISTORICO: kv }, "2026-06"), { dias: { "01": [] } });
  assert.equal(await leerMes({ HISTORICO: kv }, "../otra"), null);
});

// --- Prioridad de ayer, revisitas acotadas y resumenes diarios ---
import { seleccionar, MAX_INTENTOS } from "../worker/src/archivo.js";

const portal = (cuerpos) => async (url) => {
  const [, a, m, d] = url.match(/year=(\d+)&month=(\d+)&day=(\d+)/);
  const clave = `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return json(cuerpos[clave] ?? diaDePortal(clave));
};

test("ayer va el primero aunque haya atrasado desde mayo, y no se deja sin turno al atrasado", () => {
  const lista = seleccionar({ dias: {} }, "2026-10-03", 2);
  assert.deepEqual(lista, ["2026-10-03", "2026-05-01"]);
});

test("un ayer vacio o parcial se revisita con intentos acotados", async () => {
  const kv = kvFalso(sesionValida);
  const entorno = { HISTORICO: kv, SOLARMAN_PLANTA: "1" };
  const ahora = Date.UTC(2026, 9, 4, 10);
  const completos = {};
  for (let t = Date.UTC(2026, 4, 1); t <= Date.UTC(2026, 9, 2); t += 86400000) completos[new Date(t).toISOString().slice(0, 10)] = 288;
  await kv.put(RESUMEN, JSON.stringify({ dias: completos, diarios: diariosCompletos(completos), horas: [] }));
  let llamadas = 0;
  const pedir = async () => (llamadas++, json({ records: diaDePortal("2026-10-03").records.slice(0, 100) }));
  for (let i = 0; i < MAX_INTENTOS + 3; i++) await archivar(entorno, { pedir, ahora, maximo: 1 });
  assert.equal(llamadas, MAX_INTENTOS);
  assert.equal(kv.leer(RESUMEN).dias["2026-10-03"], 100);
});

test("el dia parcial mejora cuando llegan mas datos y deja de revisitarse al completarse", async () => {
  const kv = kvFalso(sesionValida);
  const entorno = { HISTORICO: kv, SOLARMAN_PLANTA: "1" };
  const completos = {};
  for (let t = Date.UTC(2026, 4, 1); t <= Date.UTC(2026, 9, 2); t += 86400000) completos[new Date(t).toISOString().slice(0, 10)] = 288;
  await kv.put(RESUMEN, JSON.stringify({ dias: { ...completos, "2026-10-03": 100 }, diarios: diariosCompletos(completos), horas: [] }));
  const ahora = Date.UTC(2026, 9, 4, 10);
  await archivar(entorno, { pedir: portal({}), ahora, maximo: 1 });
  assert.equal(kv.leer(RESUMEN).dias["2026-10-03"], 288);
  await archivar(entorno, { pedir: async () => assert.fail("completo: no se pide"), ahora, maximo: 1 });
});

test("una revisita con menos puntos no borra lo ya archivado", async () => {
  const kv = kvFalso(sesionValida);
  const entorno = { HISTORICO: kv, SOLARMAN_PLANTA: "1" };
  const completos = {};
  for (let t = Date.UTC(2026, 4, 1); t <= Date.UTC(2026, 9, 2); t += 86400000) completos[new Date(t).toISOString().slice(0, 10)] = 288;
  const ahora = Date.UTC(2026, 9, 4, 10);
  await kv.put(RESUMEN, JSON.stringify({ dias: { ...completos, "2026-10-03": 200 }, diarios: diariosCompletos(completos), horas: [] }));
  await kv.put(claveMes("2026-10"), JSON.stringify({ columnas: COLUMNAS_PRUEBA, dias: { "03": compactar(diaDePortal("2026-10-03").records).slice(0, 200) } }));
  await archivar(entorno, { pedir: async () => json({ records: diaDePortal("2026-10-03").records.slice(0, 50) }), ahora, maximo: 1 });
  assert.equal(kv.leer(claveMes("2026-10")).dias["03"].length, 200);
  assert.equal(kv.leer(RESUMEN).dias["2026-10-03"], 200);
});

import { COLUMNAS as COLUMNAS_PRUEBA } from "../worker/src/archivo.js";

test("un SOC de 0 por ciento no se descarta en las horas", () => {
  const horas = aHoras([[1000, 0, 100, 0, 0, 0, 0, 0], [1300, 0, 100, 0, 0, 0, 0, 0]]);
  assert.equal(horas[0][3], 0);
});

test("al archivar se guarda el resumen diario para comparar sin reintegrar", async () => {
  const kv = kvFalso(sesionValida);
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: portal({}), ahora: Date.UTC(2026, 9, 4, 10), maximo: 1 });
  const d = kv.leer(RESUMEN).diarios["2026-10-03"];
  assert.equal(d.casa, 9.6);
  assert.equal(d.cob.casa, 1);
});
