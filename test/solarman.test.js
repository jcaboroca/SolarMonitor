import { test } from "node:test";
import assert from "node:assert/strict";
import { acumular, normalizar, sondear, vincular, leerEstado } from "../worker/src/solarman.js";

const HORA = 3600000;
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJhdGkiOiJ4In0.firma";

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

function solarmanFalso({ planta = {}, renovacion = 200 } = {}) {
  const llamadas = [];
  const pedir = async (url, opciones = {}) => {
    llamadas.push({ url, opciones });
    if (url.includes("oauth/token")) {
      if (renovacion !== 200) return json({ error: "invalid_grant" }, renovacion);
      const n = llamadas.filter((l) => l.url.includes("oauth/token")).length;
      return json({ access_token: `acceso-${n}`, refresh_token: `${JWT}${n}`, expires_in: 86399 });
    }
    return json({ lastUpdateTime: 1790000000, batterySoc: 55, generationPower: 1500, usePower: 400, buyPower: 0, gridPower: 0, chargePower: -1100, dischargePower: 0, ...planta });
  };
  return { pedir, llamadas };
}

test("normaliza la respuesta de fast/system", () => {
  const l = normalizar({ lastUpdateTime: 1790000000, batterySoc: 10, generationPower: 113, usePower: 375, buyPower: 374, gridPower: 0, chargePower: -21, dischargePower: 0 });
  assert.deepEqual(l, { t: 1790000000000, soc: 10, solarW: 113, casaW: 375, compraW: 374, ventaW: 0, cargaW: 21, descargaW: 0 });
});

test("acumular integra la lectura anterior en su hora y cierra la hora al cambiar", () => {
  const t0 = 1000 * HORA + 50 * 60000;
  let e = acumular(null, { t: t0, soc: 50, solarW: 1200, casaW: 600, compraW: 0, ventaW: 0 });
  e = acumular(e, { t: t0 + 5 * 60000, soc: 51, solarW: 1200, casaW: 600, compraW: 0, ventaW: 0 });
  assert.deepEqual(e.hora, [1000, 50, 100, 0, 0, 50, 5]);
  e = acumular(e, { t: t0 + 10 * 60000, soc: 52, solarW: 0, casaW: 300, compraW: 0, ventaW: 0 });
  e = acumular(e, { t: t0 + 15 * 60000, soc: 52, solarW: 0, casaW: 300, compraW: 0, ventaW: 0 });
  assert.equal(e.horas.length, 1);
  assert.equal(e.horas[0][0], 1000);
  assert.equal(e.hora[0], 1001);
});

test("acumular no inventa energia en un hueco largo", () => {
  let e = acumular(null, { t: 0, soc: 50, solarW: 0, casaW: 600, compraW: 0, ventaW: 0 });
  e = acumular(e, { t: 3 * HORA, soc: 50, solarW: 0, casaW: 600, compraW: 0, ventaW: 0 });
  assert.equal(e.hora[1], 100); // 10 min a 600 W
  assert.equal(e.hora[6], 10);
});

test("acumular ignora una lectura repetida", () => {
  const e = acumular(null, { t: 5, soc: 1, solarW: 0, casaW: 0, compraW: 0, ventaW: 0 });
  assert.equal(acumular(e, { ...e.ultimo }), null);
});

test("sondear sin vincular no hace nada", async () => {
  const kv = kvFalso();
  const r = await sondear({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => assert.fail("no debe pedir") });
  assert.equal(r.resultado, "sin vincular");
});

test("sondear renueva, guarda el refresh nuevo y la lectura", async () => {
  const kv = kvFalso({ "solarman-sesion": { refresh: JWT, access: null, caduca: 0 } });
  const { pedir, llamadas } = solarmanFalso();
  const r = await sondear({ HISTORICO: kv, SOLARMAN_PLANTA: "123" }, { pedir, ahora: 1790000000000 });
  assert.equal(r.resultado, "guardado");
  assert.equal(kv.leer("solarman-sesion").refresh, `${JWT}1`);
  assert.equal(kv.leer("solarman-estado").ultimo.soc, 55);
  assert.match(llamadas[1].url, /fast\/system\/123$/);
  assert.equal(llamadas[1].opciones.headers.Authorization, "Bearer acceso-1");
});

test("con sesion vigente no renueva y sin dato nuevo no escribe", async () => {
  const ahora = 1790000000000;
  const kv = kvFalso({
    "solarman-sesion": { refresh: JWT, access: "a", caduca: ahora + 10 * HORA },
    "solarman-estado": { ultimo: { t: 1790000000000 } },
  });
  const { pedir, llamadas } = solarmanFalso();
  const r = await sondear({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir, ahora });
  assert.equal(r.resultado, "sin novedades");
  assert.equal(llamadas.length, 1);
  assert.equal(kv.escrituras, 0);
});

test("si Solarman rechaza la renovacion pide volver a vincular y deja de insistir", async () => {
  const kv = kvFalso({ "solarman-sesion": { refresh: JWT, access: null, caduca: 0 } });
  const { pedir } = solarmanFalso({ renovacion: 401 });
  const r = await sondear({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir, ahora: 0 });
  assert.equal(r.resultado, "error");
  assert.equal(kv.leer("solarman-sesion").refresh, null);
  assert.equal(kv.leer("solarman-estado").caducada, true);
  const estado = await leerEstado({ HISTORICO: kv });
  assert.equal(estado.vinculado, false);
});

test("un error repetido no gasta escrituras", async () => {
  const kv = kvFalso({ "solarman-sesion": { refresh: JWT, access: "a", caduca: Infinity } });
  const pedir = async () => json({}, 503);
  await sondear({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir, ahora: 0 });
  const antes = kv.escrituras;
  await sondear({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir, ahora: 0 });
  assert.equal(kv.escrituras, antes);
});

test("vincular rechaza lo que no parece un token", async () => {
  const kv = kvFalso();
  const r = await vincular({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, "hola");
  assert.equal(r.resultado, "error");
  assert.equal(kv.escrituras, 0);
});

test("vincular guarda el token y prueba en el acto", async () => {
  const kv = kvFalso();
  const { pedir } = solarmanFalso();
  const r = await vincular({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, ` ${JWT} `, { pedir, ahora: 1790000000000 });
  assert.equal(r.resultado, "guardado");
});
