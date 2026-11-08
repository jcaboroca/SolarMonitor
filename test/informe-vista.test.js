import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fechaDeHash,
  capacidadPush,
  claveABytes,
  configDeFormulario,
  htmlInforme,
  htmlIndice,
  activarPush,
  desactivarPush,
  probarPush,
} from "../js/informe.js";

const IPHONE_17 = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
const IPHONE_15 = IPHONE_17.replace("17_2", "15_6");
const ESCRITORIO = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
const ok = { seguro: true, serviceWorker: true, notification: true, pushManager: true };

test("la ruta de la notificacion solo acepta una fecha, nunca una URL", () => {
  assert.equal(fechaDeHash("#informe=2026-11-07"), "2026-11-07");
  assert.equal(fechaDeHash("#informe"), null);
  assert.equal(fechaDeHash("#informe=https://evil.example"), null);
  assert.equal(fechaDeHash("#informe=2026-11-07&x=1"), null);
  assert.equal(fechaDeHash("#ahora"), null);
  assert.equal(fechaDeHash(""), null);
});

test("capacidades del iPhone: instalar, version minima, estandar y soporte", () => {
  assert.equal(capacidadPush({ ...ok, ua: IPHONE_17, standalone: false }).estado, "instalar");
  assert.match(capacidadPush({ ...ok, ua: IPHONE_17, standalone: false }).mensaje, /Compartir.*Añadir a pantalla de inicio/s);
  assert.equal(capacidadPush({ ...ok, ua: IPHONE_15, standalone: true }).estado, "version");
  assert.equal(capacidadPush({ ...ok, ua: IPHONE_17, standalone: true }).estado, "ok");
  assert.equal(capacidadPush({ ...ok, ua: IPHONE_17, standalone: true, pushManager: false }).estado, "sin_soporte");
  assert.equal(capacidadPush({ ...ok, ua: IPHONE_17, standalone: true, notification: false }).estado, "sin_soporte");
  assert.equal(capacidadPush({ ...ok, ua: IPHONE_17, standalone: true, seguro: false }).estado, "sin_soporte");
  assert.equal(capacidadPush({ ...ok, ua: ESCRITORIO, standalone: false }).estado, "ok");
  assert.equal(capacidadPush({ ...ok, ua: IPHONE_17, standalone: true, permiso: "denied" }).estado, "denegado");
  assert.match(capacidadPush({ ...ok, ua: IPHONE_17, standalone: true, permiso: "denied" }).mensaje, /Ajustes/);
});

test("la clave publica VAPID se convierte a bytes", () => {
  assert.deepEqual([...claveABytes("AQID")], [1, 2, 3]);
  assert.deepEqual([...claveABytes("-_8")], [251, 255]);
});

test("el formulario genera una configuracion validable y no activa nada sin consentimiento", () => {
  const c = configDeFormulario({ consentimiento: true, activo: true, pushActivo: false, lat: "41.2987", lon: "2.0003", tipo: "plana", desde: "2026-01-01", hasta: "", fuente: "Factura", precio: "0,12" });
  assert.deepEqual(c.ubicacion, { lat: 41.2987, lon: 2.0003 });
  assert.deepEqual(c.tarifa, { tipo: "plana", desde: "2026-01-01", hasta: null, fuente: "Factura", precio: 0.12 });
  const periodos = configDeFormulario({ consentimiento: true, tipo: "periodos", desde: "2026-01-01", fuente: "x", p1: "0,3", p2: "0,2", p3: "0,1" });
  assert.deepEqual([periodos.tarifa.P1, periodos.tarifa.P2, periodos.tarifa.P3], [0.3, 0.2, 0.1]);
  const indexada = configDeFormulario({ consentimiento: true, tipo: "indexada", desde: "2026-01-01", fuente: "x", aceptaEstimacion: true, p1: "0,3", p2: "0,2", p3: "0,1" });
  assert.equal(indexada.tarifa.aceptaEstimacion, true);
  assert.equal(indexada.tarifa.mediaHistorica.P3, 0.1);
  const sin = configDeFormulario({ consentimiento: false, activo: true, pushActivo: true, tipo: "", lat: "", lon: "" });
  assert.equal(sin.tarifa, null);
  assert.equal(sin.ubicacion, null);
  assert.equal(sin.activo, false);
  assert.equal(sin.pushActivo, false);
});

const INFORME = {
  fecha: "2026-11-07",
  estado: "parcial",
  generado: "2026-11-08T07:30:00.000Z",
  horasEsperadas: 24,
  cobertura: { solar: 0.8, casa: 0.95, compra: 0.95 },
  fuente: { nombre: "SolarMAN (archivo del servidor)", datadis: false, nota: "No usa Datadis." },
  coste: { estado: "no_disponible", motivo: "No hay tarifa configurada." },
  conclusiones: [{ tipo: "dato", texto: "Compraste <b>7</b> kWh" }],
  hoy: { estado: "meteo_no_disponible", texto: "No se ha podido obtener la previsión.", recomendaciones: [] },
};

test("el informe se pinta con fuente, cobertura y estado en texto, y escapa el contenido", () => {
  const h = htmlInforme(INFORME);
  assert.match(h, /7 de noviembre|2026-11-07/);
  assert.match(h, /SolarMAN/);
  assert.match(h, /Datadis/);
  assert.match(h, /Parcial/);
  assert.match(h, /95 %/);
  assert.match(h, /Coste no disponible/);
  assert.match(h, /No se ha podido obtener la previsión/);
  assert.doesNotMatch(h, /<b>7<\/b>/);
  assert.match(h, /&lt;b&gt;7&lt;\/b&gt;/);
});

test("un informe sin datos o con error no parece un exito", () => {
  assert.match(htmlInforme({ ...INFORME, estado: "sin_datos", conclusiones: [{ tipo: "aviso", texto: "Sin datos." }] }), /Sin datos/);
  const e = htmlInforme({ ...INFORME, estado: "error", conclusiones: [{ tipo: "aviso", texto: "No se ha podido generar el informe de ayer." }] });
  assert.match(e, /Error/);
  assert.doesNotMatch(e, /estado-ok/);
});

test("el indice marca el estado con texto y enlaza cada fecha", () => {
  const h = htmlIndice([{ fecha: "2026-11-07", estado: "ok", push: { estado: "enviado" } }, { fecha: "2026-11-06", estado: "sin_datos" }], "2026-11-07");
  assert.match(h, /data-fecha="2026-11-07"[^>]*aria-current="true"/);
  assert.match(h, /data-fecha="2026-11-06"/);
  assert.match(h, /Sin datos/);
  assert.equal(htmlIndice([], null).includes("button"), false);
});

// ---------------------------------------------------------------- Push con dependencias falsas

function entorno({ permiso = "default", respuesta = "granted", suscrito = null } = {}) {
  const llamadas = [];
  const sub = { endpoint: "https://web.push.apple.com/x", toJSON: () => ({ endpoint: "https://web.push.apple.com/x", keys: { p256dh: "p", auth: "a" } }), unsubscribe: async () => (llamadas.push("unsubscribe"), true) };
  return {
    llamadas,
    notification: { permission: permiso, requestPermission: async () => (llamadas.push("permiso"), respuesta) },
    registro: { pushManager: { getSubscription: async () => suscrito && sub, subscribe: async (o) => (llamadas.push(["subscribe", o.userVisibleOnly, o.applicationServerKey.length]), sub) } },
    pedir: async (ruta, { method, body } = {}) => (llamadas.push([method || "GET", ruta, body && JSON.parse(body)]), new Response("{}", { status: 200 })),
    clave: "AQID",
  };
}

test("activar push pide permiso solo aqui (gesto del usuario), suscribe y registra en el servidor", async () => {
  const e = entorno();
  const r = await activarPush(e);
  assert.equal(r.estado, "activo");
  assert.deepEqual(e.llamadas[0], "permiso");
  assert.deepEqual(e.llamadas[1], ["subscribe", true, 3]);
  assert.equal(e.llamadas[2][1], "/informe/suscripcion");
  assert.equal(e.llamadas[2][0], "PUT");
  assert.equal(e.llamadas[2][2].suscripcion.endpoint, "https://web.push.apple.com/x");
});

test("permiso denegado: no se suscribe ni se llama al servidor", async () => {
  const e = entorno({ respuesta: "denied" });
  const r = await activarPush(e);
  assert.equal(r.estado, "denegado");
  assert.deepEqual(e.llamadas, ["permiso"]);
  const ya = entorno({ permiso: "denied" });
  assert.equal((await activarPush(ya)).estado, "denegado");
  assert.deepEqual(ya.llamadas, []);
});

test("si el servidor rechaza la suscripcion se deshace y se informa", async () => {
  const e = entorno();
  e.pedir = async () => new Response(JSON.stringify({ error: "Ese servicio no está permitido." }), { status: 400 });
  e.registro.pushManager.getSubscription = async () => null;
  const r = await activarPush(e);
  assert.equal(r.estado, "error");
  assert.match(r.mensaje, /no está permitido/);
  assert.ok(e.llamadas.includes("unsubscribe"));
});

test("desactivar baja la suscripcion en el servidor y en el navegador", async () => {
  const e = entorno({ permiso: "granted", suscrito: true });
  const r = await desactivarPush(e);
  assert.equal(r.estado, "inactivo");
  assert.deepEqual(e.llamadas[0], ["DELETE", "/informe/suscripcion", { endpoint: "https://web.push.apple.com/x" }]);
  assert.ok(e.llamadas.includes("unsubscribe"));
});

test("probar exige una suscripcion y envia solo su endpoint", async () => {
  const sin = entorno({ permiso: "granted" });
  assert.equal((await probarPush(sin)).estado, "sin_suscripcion");
  assert.deepEqual(sin.llamadas, []);
  const e = entorno({ permiso: "granted", suscrito: true });
  assert.equal((await probarPush(e)).estado, "enviada");
  assert.deepEqual(e.llamadas[0], ["POST", "/informe/prueba", { endpoint: "https://web.push.apple.com/x" }]);
});

test("el modulo no pide permisos ni suscribe al cargarse", () => {
  const fuente = readFileSync(new URL("../js/informe.js", import.meta.url), "utf8");
  const fuera = fuente.split("\n").filter((l) => /requestPermission|\.subscribe\(/.test(l));
  assert.equal(fuera.length, 2); // solo dentro de activarPush
});
