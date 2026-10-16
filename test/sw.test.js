import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const raiz = new URL("../", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, raiz), "utf8");
const FUENTE_SW = leer("sw.js");
const AMBITO = "https://ejemplo.test/SolarMonitor/";

// Sandbox mínimo de un service worker: lo justo para que sw.js registre sus
// manejadores y se puedan disparar sus eventos sin navegador.
function cargarSw({ red = async () => new Response("red", { status: 200 }) } = {}) {
  const manejadores = {};
  const registro = [];
  const almacenes = new Map();
  const almacen = (nombre) => {
    if (!almacenes.has(nombre)) almacenes.set(nombre, new Map());
    const mapa = almacenes.get(nombre);
    return {
      mapa,
      async addAll(peticiones) {
        registro.push(["addAll", nombre, peticiones]);
        for (const p of peticiones) mapa.set(p.url, new Response(`guardado ${p.url}`));
      },
      async put(peticion, respuesta) {
        mapa.set(peticion.url, respuesta);
        registro.push(["put", nombre, peticion.url]);
      },
      async match(peticion) {
        return mapa.get(typeof peticion === "string" ? new URL(peticion, AMBITO).href : peticion.url);
      },
    };
  };
  const caches = {
    async open(nombre) {
      return almacen(nombre);
    },
    async keys() {
      return [...almacenes.keys()];
    },
    async delete(nombre) {
      registro.push(["delete", nombre]);
      return almacenes.delete(nombre);
    },
    async match(peticion) {
      for (const nombre of almacenes.keys()) {
        const r = await almacen(nombre).match(peticion);
        if (r) return r;
      }
      return undefined;
    },
  };
  class Peticion extends Request {
    constructor(entrada, opciones) {
      super(typeof entrada === "string" ? new URL(entrada, AMBITO).href : entrada, opciones);
    }
  }
  const llamadasRed = [];
  const self = {
    location: new URL("sw.js", AMBITO),
    addEventListener: (tipo, fn) => (manejadores[tipo] = fn),
    skipWaiting: async () => registro.push(["skipWaiting"]),
    clients: { claim: async () => registro.push(["claim"]) },
  };
  const contexto = vm.createContext({
    self,
    caches,
    Request: Peticion,
    Response,
    URL,
    Promise,
    fetch: async (peticion) => {
      llamadasRed.push(peticion);
      return red(peticion);
    },
  });
  vm.runInContext(FUENTE_SW, contexto);
  const constantes = vm.runInContext("({ CACHE, BASE })", contexto);
  return { manejadores, registro, almacenes, almacen, llamadasRed, ...constantes };
}

async function disparar(manejador, datos) {
  const esperas = [];
  let respuesta = null;
  const evento = {
    ...datos,
    waitUntil: (p) => esperas.push(p),
    respondWith: (p) => (respuesta = p),
  };
  manejador(evento);
  await Promise.all(esperas);
  return { respuesta: respuesta && (await respuesta), respondio: respuesta !== null };
}

const pedir = (ruta, opciones) => new Request(new URL(ruta, AMBITO).href, opciones);
const tick = () => new Promise((r) => setTimeout(r, 0));

test("install guarda todo BASE con cache: reload y luego llama a skipWaiting", async () => {
  const sw = cargarSw();
  await disparar(sw.manejadores.install, {});
  const addAll = sw.registro.find((r) => r[0] === "addAll");
  assert.equal(addAll[1], sw.CACHE);
  assert.deepEqual(addAll[2].map((p) => p.url), sw.BASE.map((u) => new URL(u, AMBITO).href));
  assert.ok(addAll[2].every((p) => p.cache === "reload"));
  assert.ok(sw.registro.findIndex((r) => r[0] === "skipWaiting") > sw.registro.indexOf(addAll));
});

test("activate borra las cachés viejas, conserva la actual y reclama los clientes", async () => {
  const sw = cargarSw();
  await sw.almacen("solar-monitor-v1").put(pedir("./"), new Response("viejo"));
  await sw.almacen(sw.CACHE).put(pedir("./"), new Response("nuevo"));
  await disparar(sw.manejadores.activate, {});
  assert.deepEqual([...sw.almacenes.keys()], [sw.CACHE]);
  assert.ok(sw.registro.some((r) => r[0] === "claim"));
});

test("fetch no intercepta peticiones que no son GET", async () => {
  const sw = cargarSw();
  const { respondio } = await disparar(sw.manejadores.fetch, { request: pedir("./js/app.js", { method: "POST" }) });
  assert.equal(respondio, false);
});

test("fetch no intercepta las fuentes dinámicas de otro origen", async () => {
  const sw = cargarSw();
  for (const url of [
    "https://api.open-meteo.com/v1/forecast?latitude=40",
    "https://historical-forecast-api.open-meteo.com/v1/forecast",
    "https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real",
    "https://solar-monitor-nube.ejemplo.workers.dev/solarman/estado",
    "https://datadis.es/api-private/api/get-supplies",
  ]) {
    const { respondio } = await disparar(sw.manejadores.fetch, { request: new Request(url) });
    assert.equal(respondio, false, url);
  }
});

test("vendor va por caché primero y solo pide a la red si no está guardado", async () => {
  const sw = cargarSw();
  await sw.almacen(sw.CACHE).put(pedir("./vendor/pdf.min.js"), new Response("de la caché"));
  const guardada = await disparar(sw.manejadores.fetch, { request: pedir("./vendor/pdf.min.js") });
  assert.equal(await guardada.respuesta.text(), "de la caché");
  assert.equal(sw.llamadasRed.length, 0);
  await disparar(sw.manejadores.fetch, { request: pedir("./vendor/otro.js") });
  assert.equal(sw.llamadasRed.length, 1);
});

test("el resto va a la red con no-store y guarda la respuesta correcta", async () => {
  const sw = cargarSw({ red: async () => new Response("fresco", { status: 200 }) });
  const { respuesta } = await disparar(sw.manejadores.fetch, { request: pedir("./js/app.js") });
  assert.equal(await respuesta.text(), "fresco");
  assert.equal(sw.llamadasRed[0].cache, "no-store");
  await tick();
  assert.ok(sw.almacen(sw.CACHE).mapa.has(new URL("./js/app.js", AMBITO).href));
});

test("sin red devuelve lo guardado o, en su defecto, index.html", async () => {
  const sw = cargarSw({ red: async () => Promise.reject(new TypeError("sin red")) });
  await sw.almacen(sw.CACHE).put(pedir("./styles.css"), new Response("css guardado"));
  await sw.almacen(sw.CACHE).put(pedir("./index.html"), new Response("portada"));
  const guardado = await disparar(sw.manejadores.fetch, { request: pedir("./styles.css") });
  assert.equal(await guardado.respuesta.text(), "css guardado");
  const ausente = await disparar(sw.manejadores.fetch, { request: pedir("./no-existe.js") });
  assert.equal(await ausente.respuesta.text(), "portada");
});

// --- Recursos estáticos ---------------------------------------------------------

const { BASE } = cargarSw();
const enBase = new Set(BASE.map((u) => new URL(u, AMBITO).href));
const absoluta = (ruta, desde = AMBITO) => new URL(ruta, desde).href;

test("cada entrada de BASE existe en disco", () => {
  for (const entrada of BASE) {
    const ruta = entrada === "./" ? "index.html" : decodeURIComponent(entrada.replace(/^\.\//, ""));
    assert.ok(existsSync(new URL(ruta, raiz)), entrada);
  }
});

test("BASE no repite entradas, salvo ./ e ./index.html", () => {
  assert.equal(new Set(BASE).size, BASE.length);
});

function importsAlcanzables(inicio) {
  const vistos = new Set();
  const pendientes = [inicio];
  while (pendientes.length) {
    const ruta = pendientes.pop();
    if (vistos.has(ruta)) continue;
    vistos.add(ruta);
    const codigo = leer(ruta);
    for (const [, especificador] of codigo.matchAll(/(?:import|export)[^"']*?from\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      pendientes.push(new URL(especificador, new URL(ruta, "file:///r/")).pathname.slice(3));
    }
  }
  return [...vistos];
}

test("todo módulo alcanzable desde app.js y ahora.js está en BASE", () => {
  for (const modulo of new Set([...importsAlcanzables("js/app.js"), ...importsAlcanzables("js/ahora.js")])) {
    assert.ok(enBase.has(absoluta(modulo)), modulo);
  }
});

test("toda URL de mismo origen de index.html y styles.css está en BASE", () => {
  const html = leer("index.html");
  const css = leer("styles.css");
  const urls = [
    ...[...html.matchAll(/\s(?:href|src)="([^"#]+)"/g)].map((m) => m[1]),
    ...[...css.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => m[1]),
  ].filter((u) => !/^[a-z]+:/i.test(u));
  assert.ok(urls.length > 0);
  for (const u of urls) assert.ok(enBase.has(absoluta(u)), u);
});

test("la versión de caché sigue el patrón solar-monitor-vN", () => {
  assert.match(cargarSw().CACHE, /^solar-monitor-v\d+$/);
});
