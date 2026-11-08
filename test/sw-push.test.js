import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const FUENTE_SW = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const AMBITO = "https://ejemplo.test/SolarMonitor/";

function cargar({ clientes = [] } = {}) {
  const manejadores = {};
  const mostradas = [];
  const abiertas = [];
  const self = {
    location: new URL("sw.js", AMBITO),
    registration: { scope: AMBITO, showNotification: async (titulo, opciones) => mostradas.push({ titulo, ...opciones }) },
    addEventListener: (t, fn) => (manejadores[t] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => clientes, openWindow: async (u) => (abiertas.push(u), { url: u }) },
  };
  vm.runInContext("0", vm.createContext({}));
  vm.runInContext(FUENTE_SW, vm.createContext({ self, caches: {}, Request, Response, URL, Promise, fetch: async () => new Response("") }));
  return { manejadores, mostradas, abiertas };
}

async function disparar(manejador, evento) {
  const esperas = [];
  manejador({ ...evento, waitUntil: (p) => esperas.push(p) });
  await Promise.all(esperas);
}

const pushCon = (carga) => ({ data: { json: () => (typeof carga === "string" ? JSON.parse(carga) : carga) } });
const clic = (data) => {
  const cerrada = { v: false };
  return { notification: { data, close: () => (cerrada.v = true) }, cerrada };
};

test("push muestra una notificacion generica con etiqueta por fecha", async () => {
  const sw = cargar();
  await disparar(sw.manejadores.push, pushCon({ tipo: "informe", fecha: "2026-11-07", titulo: "Solar Monitor", texto: "Tu informe solar está disponible", ruta: "./#informe=2026-11-07" }));
  assert.equal(sw.mostradas.length, 1);
  assert.equal(sw.mostradas[0].tag, "informe-2026-11-07");
  assert.equal(JSON.stringify(sw.mostradas[0].data), JSON.stringify({ fecha: "2026-11-07" }));
  assert.match(sw.mostradas[0].body, /informe solar/i);
});

test("push no obedece textos ni rutas del payload", async () => {
  const sw = cargar();
  await disparar(sw.manejadores.push, pushCon({ tipo: "informe", fecha: "2026-11-07", titulo: "CLICK AQUI", texto: "Has gastado 99 €", ruta: "https://evil.example/" }));
  const n = sw.mostradas[0];
  assert.doesNotMatch(JSON.stringify(n), /evil|99|CLICK/);
});

test("un payload ilegible o sin fecha valida sigue mostrando una notificacion generica (iOS lo exige)", async () => {
  for (const carga of ["{no json", { tipo: "informe", fecha: "../x" }, { tipo: "otro" }]) {
    const sw = cargar();
    await disparar(sw.manejadores.push, { data: { json: () => (typeof carga === "string" ? JSON.parse(carga) : carga) } });
    assert.equal(sw.mostradas.length, 1);
    assert.equal(sw.mostradas[0].data.fecha, undefined);
  }
  const sin = cargar();
  await disparar(sin.manejadores.push, {});
  assert.equal(sin.mostradas.length, 1);
});

test("la prueba usa su propia etiqueta", async () => {
  const sw = cargar();
  await disparar(sw.manejadores.push, pushCon({ tipo: "prueba" }));
  assert.equal(sw.mostradas[0].tag, "prueba");
});

test("clic: abre la ruta del informe dentro del ambito y nunca una URL del payload", async () => {
  const sw = cargar();
  const e = clic({ fecha: "2026-11-07", url: "https://evil.example/" });
  await disparar(sw.manejadores.notificationclick, e);
  assert.equal(e.cerrada.v, true);
  assert.deepEqual(sw.abiertas, [`${AMBITO}#informe=2026-11-07`]);
});

test("clic con datos manipulados abre solo la app", async () => {
  const sw = cargar();
  await disparar(sw.manejadores.notificationclick, clic({ fecha: "javascript:alert(1)" }));
  await disparar(sw.manejadores.notificationclick, clic(undefined));
  assert.deepEqual(sw.abiertas, [AMBITO, AMBITO]);
});

test("clic con la app ya abierta la enfoca y le dice que muestre la fecha", async () => {
  const mensajes = [];
  let enfocada = false;
  const cliente = { url: `${AMBITO}#ahora`, focus: async () => (enfocada = true), postMessage: (m) => mensajes.push(m) };
  const ajeno = { url: "https://otro.test/", focus: async () => assert.fail("no se enfoca otro origen"), postMessage: () => assert.fail("no") };
  const sw = cargar({ clientes: [ajeno, cliente] });
  await disparar(sw.manejadores.notificationclick, clic({ fecha: "2026-11-07" }));
  assert.equal(enfocada, true);
  assert.equal(JSON.stringify(mensajes), JSON.stringify([{ tipo: "abrir-informe", fecha: "2026-11-07" }]));
  assert.deepEqual(sw.abiertas, []);
});
