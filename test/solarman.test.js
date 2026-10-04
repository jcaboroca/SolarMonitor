import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { normalizar, registrarHora, sondear, vincular, leerEstado, olvidarMemoria } from "../worker/src/solarman.js";

const HORA = 3600000;
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJhdGkiOiJ4In0.firma";
const T0 = 1790000000000;

beforeEach(olvidarMemoria);

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

const planta = (extra = {}) => ({
  lastUpdateTime: T0 / 1000, acceptDay: "20261003", batterySoc: 55,
  generationPower: 1500, usePower: 400, buyPower: 0, gridPower: 0, chargePower: -1100, dischargePower: 0,
  generationValue: 5, useValue: 3, buyValue: 0.5, gridValue: 1, ...extra,
});

function solarmanFalso({ lecturas = [planta()], renovacion = 200, cierre = null } = {}) {
  const llamadas = [];
  let i = 0;
  const pedir = async (url, opciones = {}) => {
    llamadas.push({ url, opciones });
    if (url.includes("oauth/token")) {
      if (renovacion !== 200) return json({ error: "invalid_grant" }, renovacion);
      const n = llamadas.filter((l) => l.url.includes("oauth/token")).length;
      return json({ access_token: `acceso-${n}`, refresh_token: `${JWT}${n}`, expires_in: 86399 });
    }
    if (url.includes("stats/daily")) return json({ statistics: cierre });
    return json(lecturas[Math.min(i++, lecturas.length - 1)]);
  };
  return { pedir, llamadas };
}

test("normaliza la respuesta de fast/system", () => {
  const l = normalizar(planta({ batterySoc: 10, generationPower: 113, usePower: 375, buyPower: 374, chargePower: -21 }));
  assert.equal(l.t, T0);
  assert.equal(l.dia, "20261003");
  assert.equal(l.cargaW, 21);
  assert.deepEqual(l.acumulados, { casa: 3, solar: 5, compra: 0.5, venta: 1 });
});

test("registrarHora resta los acumulados y anota en la hora de la lectura anterior", () => {
  const a = normalizar(planta());
  const b = normalizar(planta({ lastUpdateTime: (T0 + HORA) / 1000, useValue: 3.4, generationValue: 6.2, buyValue: 0.5, gridValue: 1.3, batterySoc: 60 }));
  const e = registrarHora(registrarHora(null, a), b);
  assert.deepEqual(e.horas, [[Math.floor(T0 / HORA), 400, 1200, 0, 300, 60, 60]]);
});

test("una lectura a las :58 no repite hora ni deja huecos", () => {
  const base = Math.floor(T0 / HORA) * HORA;
  const tiempos = [base + 58 * 60000, base + 2 * HORA + 1 * 60000, base + 2 * HORA + 58 * 60000, base + 4 * HORA + 2 * 60000];
  let e = null;
  tiempos.forEach((t, i) => (e = registrarHora(e, normalizar(planta({ lastUpdateTime: t / 1000, useValue: 3 + i * 0.3 })))));
  assert.deepEqual(e.horas.map((h) => h[0] - base / HORA), [1, 2, 3]);
});

test("dos tramos en la misma hora se suman", () => {
  const base = Math.floor(T0 / HORA) * HORA;
  let e = registrarHora(null, normalizar(planta({ lastUpdateTime: (base + 5 * 60000) / 1000, useValue: 3 })));
  e = registrarHora(e, normalizar(planta({ lastUpdateTime: (base + 25 * 60000) / 1000, useValue: 3.1 })));
  e = registrarHora(e, normalizar(planta({ lastUpdateTime: (base + 45 * 60000) / 1000, useValue: 3.3 })));
  assert.equal(e.horas.length, 1);
  assert.equal(e.horas[0][1], 300);
  assert.equal(e.horas[0][6], 40);
});

test("al cambiar de dia usa el cierre del dia anterior", () => {
  const a = normalizar(planta({ useValue: 9 }));
  const b = normalizar(planta({ lastUpdateTime: (T0 + HORA) / 1000, acceptDay: "20261004", useValue: 0.1, generationValue: 0, buyValue: 0.1, gridValue: 0 }));
  const cierre = { casa: 9.3, solar: 5, compra: 0.7, venta: 1 };
  const e = registrarHora(registrarHora(null, a), b, cierre);
  assert.deepEqual(e.horas[0].slice(1, 5), [400, 0, 300, 0]);
});

test("sin cierre del dia anterior no inventa la hora", () => {
  const a = normalizar(planta());
  const b = normalizar(planta({ lastUpdateTime: (T0 + HORA) / 1000, acceptDay: "20261004" }));
  assert.equal(registrarHora(registrarHora(null, a), b).horas.length, 0);
});

test("un hueco largo no se reparte como si fuera una hora", () => {
  const a = normalizar(planta());
  const b = normalizar(planta({ lastUpdateTime: (T0 + 5 * HORA) / 1000, useValue: 8 }));
  assert.equal(registrarHora(registrarHora(null, a), b).horas.length, 0);
});

test("registrarHora ignora una lectura repetida", () => {
  const e = registrarHora(null, normalizar(planta()));
  assert.equal(registrarHora(e, normalizar(planta())), null);
});

test("sondear sin vincular no hace nada", async () => {
  const kv = kvFalso();
  const r = await sondear({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => assert.fail("no debe pedir") });
  assert.equal(r.resultado, "sin vincular");
});

test("sondear renueva, guarda el refresh nuevo y la lectura", async () => {
  const kv = kvFalso({ "solarman-sesion": { refresh: JWT, access: null, caduca: 0 } });
  const { pedir, llamadas } = solarmanFalso();
  const r = await sondear({ HISTORICO: kv, SOLARMAN_PLANTA: "123" }, { pedir, ahora: T0 });
  assert.equal(r.resultado, "guardado");
  assert.equal(kv.leer("solarman-sesion").refresh, `${JWT}1`);
  assert.equal(kv.leer("solarman-estado").ultimo.soc, 55);
  assert.match(llamadas[1].url, /fast\/system\/123$/);
  assert.equal(llamadas[1].opciones.headers.Authorization, "Bearer acceso-1");
});

test("un dia entero de cron gasta unas 25 escrituras de KV", async () => {
  const lecturas = Array.from({ length: 24 }, (_, h) => planta({ lastUpdateTime: (T0 + h * HORA) / 1000, useValue: 3 + h * 0.3 }));
  const kv = kvFalso({ "solarman-sesion": { refresh: JWT, access: null, caduca: 0 } });
  const { pedir } = solarmanFalso({ lecturas });
  for (let h = 0; h < 24; h++) await sondear({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir, ahora: T0 + h * HORA });
  assert.ok(kv.escrituras <= 26, `escrituras ${kv.escrituras}`);
  assert.equal(kv.leer("solarman-estado").horas.length, 23);
});

test("con sesion vigente no renueva y sin dato nuevo no escribe", async () => {
  const kv = kvFalso({
    "solarman-sesion": { refresh: JWT, access: "a", caduca: T0 + 10 * HORA },
    "solarman-estado": { ultimo: { t: T0 } },
  });
  const { pedir, llamadas } = solarmanFalso();
  const r = await sondear({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir, ahora: T0 });
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
  const estado = await leerEstado({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => assert.fail("no debe pedir") });
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

test("leerEstado trae el dato en vivo sin escribir ni renovar", async () => {
  const kv = kvFalso({
    "solarman-sesion": { refresh: JWT, access: "a", caduca: T0 + HORA },
    "solarman-estado": { ultimo: { t: T0 - HORA, soc: 40 }, horas: [] },
  });
  const { pedir, llamadas } = solarmanFalso({ lecturas: [planta({ batterySoc: 77 })] });
  const e = await leerEstado({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir, ahora: T0 });
  assert.equal(e.ultimo.soc, 77);
  assert.equal(kv.escrituras, 0);
  assert.ok(llamadas.every((l) => !l.url.includes("oauth")));
  // Una segunda pantalla al momento no vuelve a molestar a Solarman.
  await leerEstado({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir, ahora: T0 + 30000 });
  assert.equal(llamadas.length, 1);
});

test("leerEstado con la sesion caducada devuelve lo guardado y no renueva", async () => {
  const kv = kvFalso({
    "solarman-sesion": { refresh: JWT, access: "a", caduca: T0 - 1 },
    "solarman-estado": { ultimo: { t: T0 - HORA, soc: 40 } },
  });
  const e = await leerEstado({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => assert.fail("no debe pedir"), ahora: T0 });
  assert.equal(e.ultimo.soc, 40);
});

test("leerEstado avisa si Solarman falla y devuelve lo guardado", async () => {
  const kv = kvFalso({
    "solarman-sesion": { refresh: JWT, access: "a", caduca: T0 + HORA },
    "solarman-estado": { ultimo: { t: T0 - HORA, soc: 40 } },
  });
  const e = await leerEstado({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json({}, 502), ahora: T0 });
  assert.equal(e.ultimo.soc, 40);
  assert.match(e.avisoVivo, /502/);
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
  const r = await vincular({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, ` ${JWT} `, { pedir, ahora: T0 });
  assert.equal(r.resultado, "guardado");
});
