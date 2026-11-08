process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, createDecipheriv, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import worker from "../worker/src/index.js";
import { programado, generarInforme, MAX_GENERACIONES, MAX_ENTREGAS } from "../worker/src/informe.js";
import { limitesDia, sumarDias } from "../worker/src/horario.js";
import { b64url } from "../worker/src/push.js";

const AHORA = Date.UTC(2026, 10, 8, 7, 30); // 08:30 en Madrid (CET)
const AYER = "2026-11-07";
const CLAVE = "clave-de-prueba";

function kvFalso(inicial = {}) {
  const m = new Map(Object.entries(inicial).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    m,
    puts: [],
    async get(k, tipo) {
      const v = m.get(k);
      return v === undefined ? null : tipo === "json" ? JSON.parse(v) : v;
    },
    async put(k, v) {
      this.puts.push(k);
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
    leer: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
  };
}

function vapid() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return { VAPID_PUBLIC_KEY: b64url(pub), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: "mailto:op@ejemplo.test" };
}

function dispositivo(ruta = "abc") {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, suscripcion: { endpoint: `https://web.push.apple.com/${ruta}`, keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) } } };
}

function descifrar({ ecdh, auth }, cuerpo) {
  const b = Buffer.from(cuerpo);
  const salt = b.subarray(0, 16);
  const asPublica = b.subarray(21, 21 + b[20]);
  const cifrado = b.subarray(21 + b[20]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdh.computeSecret(asPublica), auth, Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublica]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(cifrado.subarray(-16));
  const plano = Buffer.concat([d.update(cifrado.subarray(0, -16)), d.final()]);
  return JSON.parse(plano.subarray(0, -1).toString("utf8"));
}

const CONFIG = { activo: true, pushActivo: true, consentimiento: true, ubicacion: { lat: 41.2987, lon: 2.0003 }, tarifa: { tipo: "plana", precio: 0.12, desde: "2026-01-01", hasta: null, fuente: "Factura de octubre" } };

// Curva de ayer: sol de 10 a 16 sin compra, casa 400 W y compra de 400 W el resto del dia.
function curvaDeAyer(fecha = AYER) {
  const { inicio, fin } = limitesDia(fecha);
  const puntos = [];
  for (let t = inicio / 1000; t < fin / 1000; t += 300) {
    const h = (t - inicio / 1000) / 3600;
    const sol = h >= 10 && h < 16;
    puntos.push([t, sol ? 1500 : 0, 400, sol ? 0 : 400, 0, 0, 0, 50]);
  }
  return puntos;
}

function sembrar({ config = CONFIG, subs = [], conDatos = true, horas = [], extra = {} } = {}) {
  const inicial = { "informe-config": config, ...extra };
  if (subs.length) inicial["informe-subs"] = { dispositivos: subs };
  if (conDatos) {
    inicial["solarman-curvas"] = { dias: { [AYER]: 288 }, horas, diarios: {} };
    inicial["solarman-curva-2026-11"] = { columnas: [], dias: { [AYER.slice(8)]: curvaDeAyer() } };
  }
  return kvFalso(inicial);
}

const sinRed = async () => assert.fail("no debe haber red");
const fetchOriginal = globalThis.fetch;
const conFetch = (f) => (globalThis.fetch = f);
test.afterEach(() => (globalThis.fetch = fetchOriginal));
const noMeteo = async () => new Response("{}", { status: 500 });

const subRegistro = (d, id = "d1") => ({ id, ...d.suscripcion, creada: "2026-11-01T00:00:00.000Z", entrega: {} });

// ---------------------------------------------------------------- API

const llamar = (entorno, ruta, { method = "GET", body, clave = CLAVE } = {}) =>
  worker.fetch(new Request(`https://w.test${ruta}`, { method, body, headers: clave ? { Authorization: `Bearer ${clave}` } : {} }), entorno);

const entornoApi = (kv = kvFalso(), extra = {}) => ({ HISTORICO: kv, SOLAR_ID: CLAVE, ...extra });

test("todas las rutas del informe exigen la clave", async () => {
  const e = entornoApi();
  const rutas = [["GET", "/informe/config"], ["PUT", "/informe/config"], ["PUT", "/informe/suscripcion"], ["DELETE", "/informe/suscripcion"], ["POST", "/informe/prueba"], ["GET", "/informe/indice"], ["GET", `/informe/ver?fecha=${AYER}`], ["POST", "/informe/generar"]];
  for (const [method, ruta] of rutas) {
    for (const clave of [null, "otra"]) {
      const r = await llamar(e, ruta, { method, clave, body: method === "GET" ? undefined : "{}" });
      assert.equal(r.status, 401, `${method} ${ruta}`);
    }
  }
  assert.equal(e.HISTORICO.puts.length, 0);
});

test("los informes no se sirven por rutas publicas", async () => {
  const kv = sembrar();
  await generarInforme({ HISTORICO: kv }, { ahora: AHORA, forzar: true, pedir: noMeteo });
  assert.equal((await llamar(entornoApi(kv), `/informe-${AYER}`, { clave: null })).status, 404);
  assert.equal((await llamar(entornoApi(kv), `/informe/ver?fecha=${AYER}`, { clave: null })).status, 401);
});

test("config: JSON mal formado, demasiado grande o invalido recibe errores utiles", async () => {
  const e = entornoApi();
  let r = await llamar(e, "/informe/config", { method: "PUT", body: "{no es json" });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /JSON/);
  r = await llamar(e, "/informe/config", { method: "PUT", body: JSON.stringify({ activo: false, relleno: "x".repeat(6000) }) });
  assert.equal(r.status, 413);
  r = await llamar(e, "/informe/config", { method: "PUT", body: "[1]" });
  assert.equal(r.status, 400);
  for (const mala of [
    { ...CONFIG, ubicacion: { lat: 123, lon: 2 } },
    { ...CONFIG, ubicacion: { lat: "a", lon: 2 } },
    { ...CONFIG, tarifa: { ...CONFIG.tarifa, precio: -3 } },
    { ...CONFIG, tarifa: { ...CONFIG.tarifa, fuente: "" } },
    { ...CONFIG, tarifa: { ...CONFIG.tarifa, desde: "ayer" } },
    { ...CONFIG, consentimiento: false },
    { ...CONFIG, pushActivo: "si" },
  ]) {
    r = await llamar(e, "/informe/config", { method: "PUT", body: JSON.stringify(mala) });
    assert.equal(r.status, 400, JSON.stringify(mala).slice(0, 80));
    assert.ok((await r.json()).error);
  }
  assert.equal(e.HISTORICO.puts.length, 0);
});

test("config valida: coordenadas aproximadas, sin campos extra, y por defecto todo desactivado", async () => {
  const kv = kvFalso();
  const secretos = vapid();
  const e = entornoApi(kv, secretos);
  let g = await (await llamar(e, "/informe/config")).json();
  assert.equal(g.config.activo, false);
  assert.equal(g.config.pushActivo, false);
  assert.equal(g.vapid.disponible, true);
  assert.equal(g.vapid.publica, secretos.VAPID_PUBLIC_KEY);
  assert.equal(JSON.stringify(g).includes(secretos.VAPID_PRIVATE_KEY), false);
  const r = await llamar(e, "/informe/config", { method: "PUT", body: JSON.stringify({ ...CONFIG, intruso: "x", ubicacion: { lat: 41.298712, lon: 2.000312, direccion: "calle" } }) });
  assert.equal(r.status, 200);
  const guardado = kv.leer("informe-config");
  assert.deepEqual(guardado.ubicacion, { lat: 41.3, lon: 2 });
  assert.equal("intruso" in guardado, false);
  assert.equal(guardado.tarifa.precio, 0.12);
  g = await (await llamar(e, "/informe/config")).json();
  assert.equal(g.config.activo, true);
});

test("sin secretos VAPID la config lo dice y no ofrece clave publica", async () => {
  const g = await (await llamar(entornoApi(), "/informe/config")).json();
  assert.equal(g.vapid.disponible, false);
  assert.equal(g.vapid.publica, undefined);
  assert.match(g.vapid.error, /VAPID/);
});

test("suscripcion: validacion, guardado, limite y baja", async () => {
  const kv = kvFalso();
  const e = entornoApi(kv, vapid());
  const d = dispositivo();
  const poner = (s) => llamar(e, "/informe/suscripcion", { method: "PUT", body: JSON.stringify({ suscripcion: s }) });
  assert.equal((await poner({ endpoint: "https://evil.example/x", keys: d.suscripcion.keys })).status, 400);
  assert.equal((await llamar(e, "/informe/suscripcion", { method: "PUT", body: "{" })).status, 400);
  assert.equal((await poner(d.suscripcion)).status, 200);
  assert.equal(kv.leer("informe-subs").dispositivos.length, 1);
  await poner(d.suscripcion);
  assert.equal(kv.leer("informe-subs").dispositivos.length, 1);
  for (let i = 0; i < 4; i++) await poner(dispositivo(`n${i}`).suscripcion);
  assert.equal((await poner(dispositivo("extra").suscripcion)).status, 409);
  const g = await (await llamar(e, "/informe/config")).json();
  assert.equal(g.suscripciones, 5);
  assert.equal(JSON.stringify(g).includes("apple.com"), false);
  const baja = () => llamar(e, "/informe/suscripcion", { method: "DELETE", body: JSON.stringify({ endpoint: d.suscripcion.endpoint }) });
  assert.equal((await baja()).status, 200);
  assert.equal(kv.leer("informe-subs").dispositivos.length, 4);
  assert.equal((await baja()).status, 200); // idempotente
});

test("la notificacion de prueba solo va a una suscripcion validada y con limite de frecuencia", async () => {
  const d = dispositivo();
  const kv = kvFalso({ "informe-subs": { dispositivos: [subRegistro(d)] } });
  const e = entornoApi(kv, vapid());
  const enviados = [];
  conFetch(async (url, init) => (enviados.push([url, init]), new Response(null, { status: 201 })));
  const probar = (endpoint) => llamar(e, "/informe/prueba", { method: "POST", body: JSON.stringify({ endpoint }) });
  assert.equal((await probar("https://web.push.apple.com/otra")).status, 404);
  assert.equal((await probar("https://evil.example/x")).status, 400);
  assert.equal(enviados.length, 0);
  assert.equal((await probar(d.suscripcion.endpoint)).status, 200);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0][0], d.suscripcion.endpoint);
  assert.equal(descifrar(d, enviados[0][1].body).tipo, "prueba");
  assert.equal((await probar(d.suscripcion.endpoint)).status, 429);
  assert.equal(enviados.length, 1);
});

test("prueba sin VAPID falla con un error claro y sin red", async () => {
  const d = dispositivo();
  const e = entornoApi(kvFalso({ "informe-subs": { dispositivos: [subRegistro(d)] } }));
  conFetch(sinRed);
  const r = await llamar(e, "/informe/prueba", { method: "POST", body: JSON.stringify({ endpoint: d.suscripcion.endpoint }) });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /VAPID/);
});

test("una prueba que el servicio push da por caducada borra la suscripcion", async () => {
  const d = dispositivo();
  const kv = kvFalso({ "informe-subs": { dispositivos: [subRegistro(d)] } });
  conFetch(async () => new Response(null, { status: 410 }));
  const r = await llamar(entornoApi(kv, vapid()), "/informe/prueba", { method: "POST", body: JSON.stringify({ endpoint: d.suscripcion.endpoint }) });
  assert.equal(r.status, 410);
  assert.equal(kv.leer("informe-subs").dispositivos.length, 0);
});

test("ver y listar informes validan la fecha y devuelven 404 si no existe", async () => {
  const kv = sembrar();
  const e = entornoApi(kv);
  conFetch(noMeteo);
  assert.equal((await llamar(e, "/informe/ver?fecha=../x")).status, 400);
  assert.equal((await llamar(e, "/informe/ver")).status, 400);
  assert.equal((await llamar(e, `/informe/ver?fecha=${AYER}`)).status, 404);
  assert.deepEqual((await (await llamar(e, "/informe/indice")).json()).informes, []);
  assert.equal((await llamar(e, "/informe/generar", { method: "POST", body: "{}" })).status, 200);
  const informe = await (await llamar(e, `/informe/ver?fecha=${AYER}`)).json();
  assert.equal(informe.fecha, AYER);
  assert.equal((await (await llamar(e, "/informe/indice")).json()).informes[0].fecha, AYER);
});

test("los endpoints antiguos no cambian", async () => {
  const kv = kvFalso();
  const e = entornoApi(kv);
  assert.equal((await llamar(e, "/historico", { clave: null })).status, 401);
  assert.equal((await llamar(e, "/historico")).status, 404);
  assert.equal((await llamar(e, "/historico", { method: "PUT", body: "cifrado==" })).status, 200);
  assert.equal(await (await llamar(e, "/historico")).text(), "cifrado==");
  assert.equal((await llamar(e, "/otra-cosa")).status, 404);
  assert.equal((await llamar(e, "/historico", { method: "DELETE" })).status, 405);
  const o = await worker.fetch(new Request("https://w.test/historico", { method: "OPTIONS", headers: { Origin: "https://jcaboroca.github.io" } }), e);
  assert.equal(o.status, 204);
  assert.match(o.headers.get("Access-Control-Allow-Methods"), /DELETE/);
  assert.equal(kv.m.get("paquete"), "cifrado==");
});

// ---------------------------------------------------------------- Generacion y envio

test("el informe se guarda antes de enviar ningun push", async () => {
  const d = dispositivo();
  const kv = sembrar({ subs: [subRegistro(d)] });
  let vistoAntes = null;
  const pedir = async (url) => {
    if (url.startsWith("https://web.push.apple.com")) {
      vistoAntes = kv.m.has(`informe-${AYER}`) && kv.leer("informe-indice").informes[0].estado === "ok";
      return new Response(null, { status: 201 });
    }
    return noMeteo();
  };
  const r = await programado({ HISTORICO: kv, ...vapid() }, { ahora: AHORA, pedir });
  assert.equal(r.resultado, "generado");
  assert.equal(vistoAntes, true);
});

test("el payload es generico: sin consumos, costes ni nombres", async () => {
  const d = dispositivo();
  const kv = sembrar({ subs: [subRegistro(d)] });
  const cuerpos = [];
  const pedir = async (url, init) => {
    if (url.includes("push.apple.com")) {
      cuerpos.push(descifrar(d, init.body));
      return new Response(null, { status: 201 });
    }
    return noMeteo();
  };
  await programado({ HISTORICO: kv, ...vapid() }, { ahora: AHORA, pedir });
  assert.equal(cuerpos.length, 1);
  assert.deepEqual(Object.keys(cuerpos[0]).sort(), ["fecha", "ruta", "texto", "tipo", "titulo"]);
  assert.equal(cuerpos[0].fecha, AYER);
  assert.equal(cuerpos[0].ruta, `./#informe=${AYER}`);
  assert.doesNotMatch(JSON.stringify(cuerpos[0]), /kwh|€|euro|\d+[,.]\d+/i);
});

test("repetir el cron no regenera ni reenvia", async () => {
  const d = dispositivo();
  const kv = sembrar({ subs: [subRegistro(d)] });
  let envios = 0;
  const pedir = async (url) => (url.includes("push.apple.com") ? (envios++, new Response(null, { status: 201 })) : noMeteo());
  const env = { HISTORICO: kv, ...vapid() };
  await programado(env, { ahora: AHORA, pedir });
  const escrituras = kv.puts.length;
  const r = await programado(env, { ahora: AHORA + 3600000, pedir });
  assert.equal(r.resultado, "completo");
  assert.equal(envios, 1);
  assert.equal(kv.puts.length, escrituras);
  assert.equal(kv.leer("informe-subs").dispositivos[0].entrega[AYER].estado, "enviado");
});

test("errores transitorios se reintentan de forma acotada y por dispositivo", async () => {
  const a = dispositivo("a");
  const b = dispositivo("b");
  const kv = sembrar({ subs: [subRegistro(a), subRegistro(b, "d2")] });
  const llamadas = { a: 0, b: 0 };
  const pedir = async (url) => {
    if (url.endsWith("/a")) return llamadas.a++, new Response(null, { status: 503 });
    if (url.endsWith("/b")) return llamadas.b++, new Response(null, { status: 201 });
    return noMeteo();
  };
  const env = { HISTORICO: kv, ...vapid() };
  for (let i = 0; i < MAX_ENTREGAS + 3; i++) await programado(env, { ahora: AHORA + i * 3600000, pedir });
  assert.equal(llamadas.b, 1);
  assert.equal(llamadas.a, MAX_ENTREGAS);
  const subs = kv.leer("informe-subs").dispositivos;
  assert.equal(subs[1].entrega[AYER].estado, "enviado");
  assert.equal(subs[0].entrega[AYER].estado, "fallido");
  assert.equal(subs[0].entrega[AYER].intentos, MAX_ENTREGAS);
});

test("un transitorio que luego funciona queda enviado", async () => {
  const d = dispositivo();
  const kv = sembrar({ subs: [subRegistro(d)] });
  const codigos = [429, 201];
  const pedir = async (url) => (url.includes("push.apple.com") ? new Response(null, { status: codigos.shift() ?? 201 }) : noMeteo());
  const env = { HISTORICO: kv, ...vapid() };
  await programado(env, { ahora: AHORA, pedir });
  assert.equal(kv.leer("informe-subs").dispositivos[0].entrega[AYER].estado, "pendiente");
  await programado(env, { ahora: AHORA + 3600000, pedir });
  assert.equal(kv.leer("informe-subs").dispositivos[0].entrega[AYER].estado, "enviado");
});

test("suscripciones caducadas (404/410) se eliminan y las demas reciben", async () => {
  const a = dispositivo("a");
  const b = dispositivo("b");
  const c = dispositivo("c");
  const kv = sembrar({ subs: [subRegistro(a), subRegistro(b, "d2"), subRegistro(c, "d3")] });
  const pedir = async (url) => (url.endsWith("/a") ? new Response(null, { status: 410 }) : url.endsWith("/b") ? new Response(null, { status: 404 }) : url.endsWith("/c") ? new Response(null, { status: 201 }) : noMeteo());
  await programado({ HISTORICO: kv, ...vapid() }, { ahora: AHORA, pedir });
  const subs = kv.leer("informe-subs").dispositivos;
  assert.equal(subs.length, 1);
  assert.equal(subs[0].id, "d3");
});

test("un rechazo definitivo (403) no se reintenta", async () => {
  const d = dispositivo();
  const kv = sembrar({ subs: [subRegistro(d)] });
  let n = 0;
  const pedir = async (url) => (url.includes("push.apple.com") ? (n++, new Response(null, { status: 403 })) : noMeteo());
  const env = { HISTORICO: kv, ...vapid() };
  await programado(env, { ahora: AHORA, pedir });
  await programado(env, { ahora: AHORA + 3600000, pedir });
  assert.equal(n, 1);
  assert.equal(kv.leer("informe-subs").dispositivos[0].entrega[AYER].estado, "fallido");
});

test("sin VAPID el informe se genera, no hay envio y el estado lo dice", async () => {
  const d = dispositivo();
  const kv = sembrar({ subs: [subRegistro(d)] });
  const pedir = async (url) => (url.includes("push.apple.com") ? assert.fail("sin VAPID no se envia") : noMeteo());
  await programado({ HISTORICO: kv }, { ahora: AHORA, pedir });
  assert.ok(kv.leer(`informe-${AYER}`));
  assert.equal(kv.leer("informe-indice").informes[0].push.estado, "sin_vapid");
});

test("con el push desactivado se genera el informe pero no se envia nada", async () => {
  const d = dispositivo();
  const kv = sembrar({ config: { ...CONFIG, pushActivo: false }, subs: [subRegistro(d)] });
  const pedir = async (url) => (url.includes("push.apple.com") ? assert.fail("push desactivado") : noMeteo());
  const r = await programado({ HISTORICO: kv, ...vapid() }, { ahora: AHORA, pedir });
  assert.equal(r.resultado, "generado");
  assert.equal(kv.leer("informe-indice").informes[0].push.estado, "desactivado");
});

test("con el informe desactivado o sin configurar no se hace nada", async () => {
  for (const config of [{ ...CONFIG, activo: false }, undefined]) {
    const kv = config ? sembrar({ config }) : kvFalso();
    const r = await programado({ HISTORICO: kv, ...vapid() }, { ahora: AHORA, pedir: sinRed });
    assert.equal(r.resultado, "desactivado");
    assert.equal(kv.puts.length, 0);
  }
});

test("la guarda de hora local respeta el 08:30 de Madrid en verano, invierno y cambios de hora", async () => {
  const caso = async (ms, esperado) => {
    const r = await programado({ HISTORICO: kvFalso({ "informe-config": CONFIG }) }, { ahora: ms, pedir: noMeteo });
    assert.equal(r.resultado, esperado, new Date(ms).toISOString());
  };
  await caso(Date.UTC(2026, 7, 10, 6, 29), "antes_de_hora"); // 08:29 CEST
  await caso(Date.UTC(2026, 7, 10, 6, 30), "generado"); // 08:30 CEST
  await caso(Date.UTC(2026, 10, 8, 6, 30), "antes_de_hora"); // 07:30 CET: el hueco de verano no vale en invierno
  await caso(Date.UTC(2026, 10, 8, 7, 29), "antes_de_hora");
  await caso(Date.UTC(2026, 10, 8, 7, 30), "generado"); // 08:30 CET
  await caso(Date.UTC(2026, 2, 29, 6, 30), "generado"); // dia del cambio a verano: 08:30 CEST
  await caso(Date.UTC(2026, 9, 25, 6, 30), "antes_de_hora"); // dia del cambio a invierno: 07:30 CET
  await caso(Date.UTC(2026, 9, 25, 7, 30), "generado"); // 08:30 CET
});

test("el dia que se informa es el de ayer en Madrid", async () => {
  const kv = sembrar();
  await programado({ HISTORICO: kv }, { ahora: Date.UTC(2026, 10, 9, 7, 30), pedir: noMeteo });
  assert.equal(kv.leer("informe-indice").informes[0].fecha, "2026-11-08");
});

test("sin datos: estado observable, sin push y con intentos acotados", async () => {
  const d = dispositivo();
  const kv = sembrar({ conDatos: false, subs: [subRegistro(d)] });
  const pedir = async (url) => (url.includes("push.apple.com") ? assert.fail("no se avisa de un informe sin datos") : noMeteo());
  const env = { HISTORICO: kv, ...vapid() };
  for (let i = 0; i < MAX_GENERACIONES + 3; i++) await programado(env, { ahora: AHORA + i * 3600000, pedir });
  const e = kv.leer("informe-indice").informes[0];
  assert.equal(e.estado, "sin_datos");
  assert.equal(e.intentos, MAX_GENERACIONES);
  assert.equal(kv.leer(`informe-${AYER}`).estado, "sin_datos");
  assert.equal(kv.leer(`informe-${AYER}`).energia, null);
});

test("sin datos al principio y con datos despues: se completa y entonces avisa", async () => {
  const d = dispositivo();
  const kv = sembrar({ conDatos: false, subs: [subRegistro(d)] });
  let envios = 0;
  const pedir = async (url) => (url.includes("push.apple.com") ? (envios++, new Response(null, { status: 201 })) : noMeteo());
  const env = { HISTORICO: kv, ...vapid() };
  await programado(env, { ahora: AHORA, pedir });
  assert.equal(envios, 0);
  kv.m.set("solarman-curvas", JSON.stringify({ dias: { [AYER]: 288 }, horas: [], diarios: {} }));
  kv.m.set("solarman-curva-2026-11", JSON.stringify({ columnas: [], dias: { "07": curvaDeAyer() } }));
  await programado(env, { ahora: AHORA + 3600000, pedir });
  assert.equal(envios, 1);
  assert.equal(kv.leer("informe-indice").informes[0].estado, "ok");
});

test("un fallo al generar queda registrado como error, sin exito aparente", async () => {
  const kv = sembrar();
  const roto = {
    get: async (k, t) => {
      if (k.startsWith("solarman-curva-2026")) throw new Error("KV caido");
      return kv.get(k, t);
    },
    put: (k, v) => kv.put(k, v),
    delete: (k) => kv.delete(k),
  };
  const r = await programado({ HISTORICO: roto }, { ahora: AHORA, pedir: sinRed });
  assert.equal(r.resultado, "error");
  const e = kv.leer("informe-indice").informes[0];
  assert.equal(e.estado, "error");
  assert.equal(e.intentos, 1);
  assert.equal(kv.leer(`informe-${AYER}`).estado, "error");
  assert.match(JSON.stringify(kv.leer(`informe-${AYER}`)), /No se ha podido generar/);
});

test("un bloqueo vigente evita ejecuciones solapadas y uno caducado se ignora", async () => {
  const kv = sembrar({ extra: { "informe-lock": { hasta: AHORA + 60000 } } });
  assert.equal((await programado({ HISTORICO: kv }, { ahora: AHORA, pedir: sinRed })).resultado, "ocupado");
  const caducado = sembrar({ extra: { "informe-lock": { hasta: AHORA - 1 } } });
  assert.equal((await programado({ HISTORICO: caducado }, { ahora: AHORA, pedir: noMeteo })).resultado, "generado");
  assert.equal(caducado.m.has("informe-lock"), false);
});

test("se conservan solo los ultimos 60 informes y se borran los caducados", async () => {
  const informes = Array.from({ length: 60 }, (_, i) => ({ fecha: sumarDias(AYER, -(i + 1)), estado: "ok", intentos: 1, push: { estado: "enviado", pendientes: 0 } }));
  const ultimo = informes.at(-1).fecha;
  const kv = sembrar({ extra: { "informe-indice": { informes }, [`informe-${ultimo}`]: { x: 1 } } });
  await programado({ HISTORICO: kv }, { ahora: AHORA, pedir: noMeteo });
  const idx = kv.leer("informe-indice").informes;
  assert.equal(idx.length, 60);
  assert.equal(idx[0].fecha, AYER);
  assert.equal(idx.some((x) => x.fecha === ultimo), false);
  assert.equal(kv.m.has(`informe-${ultimo}`), false);
});

// ---------------------------------------------------------------- Hoy / meteo

const meteo = (dia = "2026-11-08") => {
  const { inicio } = limitesDia(dia);
  const t = Array.from({ length: 24 }, (_, h) => (inicio + h * 3600000) / 1000 + 3600);
  return { hourly: { time: t, shortwave_radiation: t.map((_, h) => (h >= 10 && h < 16 ? 400 : 0)), cloud_cover: t.map(() => 20) } };
};

function pasado(dias = 8) {
  const t = [];
  const rad = [];
  for (let d = 1; d <= dias; d++) {
    const { inicio } = limitesDia(`2026-10-${String(d + 10).padStart(2, "0")}`);
    for (let h = 0; h < 24; h++) {
      t.push((inicio + h * 3600000) / 1000 + 3600);
      rad.push(h >= 10 && h < 16 ? 400 : 0);
    }
  }
  return { hourly: { time: t, shortwave_radiation: rad } };
}

function horasCalibradas(dias = 8) {
  const horas = [];
  for (let d = 1; d <= dias; d++) {
    const { inicio } = limitesDia(`2026-10-${String(d + 10).padStart(2, "0")}`);
    for (let h = 0; h < 24; h++) horas.push([Math.floor((inicio + h * 3600000) / 3600000), 400, h >= 10 && h < 16 ? 800 : 0, 50, 60, h >= 10 && h < 16 ? 60 : 0]);
  }
  return horas;
}

const redMeteo = (urls = []) => async (url) => {
  urls.push(url);
  if (url.includes("historical-forecast")) return new Response(JSON.stringify(pasado()), { status: 200 });
  if (url.includes("open-meteo")) return new Response(JSON.stringify(meteo()), { status: 200 });
  return new Response("{}", { status: 500 });
};

test("prevision de hoy: calibrada con SolarMAN y sin enviar consumos a Open-Meteo", async () => {
  const kv = sembrar({ horas: horasCalibradas() });
  const urls = [];
  await generarInforme({ HISTORICO: kv }, { ahora: AHORA, pedir: redMeteo(urls) });
  const { hoy } = kv.leer(`informe-${AYER}`);
  assert.equal(hoy.estado, "disponible");
  assert.ok(hoy.totalKwh > 4 && hoy.totalKwh < 6, String(hoy.totalKwh)); // 6 h x 400 W/m2 x 0,002 kWh por W/m2
  assert.equal(hoy.confianza, "media");
  assert.match(hoy.mejorVentana.desde, /^1[0-3]:00$/);
  assert.equal(urls.length, 2);
  for (const u of urls) {
    const q = new URL(u).searchParams;
    assert.equal(q.get("latitude"), "41.3");
    assert.equal(q.get("longitude"), "2");
    assert.deepEqual([...q.keys()].filter((k) => /kwh|consumo|casa|compra|euro/i.test(k)), []);
  }
  assert.match(JSON.stringify(hoy.recomendaciones), /ning[uú]n ajuste/i);
});

test("sin meteorologia: el informe retrospectivo se conserva y hoy queda degradado de forma explicita", async () => {
  const kv = sembrar({ horas: horasCalibradas() });
  await generarInforme({ HISTORICO: kv }, { ahora: AHORA, pedir: async () => { throw new Error("sin red"); } });
  const informe = kv.leer(`informe-${AYER}`);
  assert.equal(informe.estado, "ok");
  assert.equal(informe.energia.compra.kwh, 7.2);
  assert.equal(informe.coste.euros, 1.1);
  assert.equal(informe.hoy.estado, "meteo_no_disponible");
  assert.equal(informe.hoy.totalKwh, undefined);
  assert.match(informe.hoy.texto, /no se ha podido/i);
});

test("respuesta meteorologica invalida no inventa una prevision", async () => {
  const kv = sembrar({ horas: horasCalibradas() });
  await generarInforme({ HISTORICO: kv }, { ahora: AHORA, pedir: async () => new Response('{"hourly":{}}', { status: 200 }) });
  assert.equal(kv.leer(`informe-${AYER}`).hoy.estado, "meteo_no_disponible");
});

test("sin historico suficiente solo se da el tiempo, no kWh", async () => {
  const kv = sembrar({ horas: [] });
  await generarInforme({ HISTORICO: kv }, { ahora: AHORA, pedir: redMeteo() });
  const { hoy } = kv.leer(`informe-${AYER}`);
  assert.equal(hoy.estado, "sin_calibracion");
  assert.equal(hoy.totalKwh, undefined);
  assert.equal(hoy.nubosidadMediaPct, 20);
});

test("sin ubicacion no hay llamadas a Open-Meteo", async () => {
  const kv = sembrar({ config: { ...CONFIG, ubicacion: null } });
  await generarInforme({ HISTORICO: kv }, { ahora: AHORA, pedir: sinRed });
  assert.equal(kv.leer(`informe-${AYER}`).hoy.estado, "sin_ubicacion");
});

test("solo se sugiere mover consumos con tarifa valida de periodos distintos, excedente real y sol previsto", async () => {
  const conVenta = (kv) => {
    const mes = kv.leer("solarman-curva-2026-11");
    mes.dias["07"] = mes.dias["07"].map((p) => [p[0], p[1], p[2], p[3], p[1] > 0 ? 800 : 0, p[5], p[6], p[7]]);
    kv.m.set("solarman-curva-2026-11", JSON.stringify(mes));
  };
  const texto = async (config, venta = true) => {
    const kv = sembrar({ horas: horasCalibradas(), config });
    if (venta) conVenta(kv);
    await generarInforme({ HISTORICO: kv }, { ahora: AHORA, pedir: redMeteo() });
    return JSON.stringify(kv.leer(`informe-${AYER}`).hoy.recomendaciones);
  };
  const periodos = { tipo: "periodos", P1: 0.3, P2: 0.2, P3: 0.1, desde: "2026-01-01", fuente: "Contrato" };
  assert.doesNotMatch(await texto(CONFIG), /mover|aplazar/i); // tarifa plana
  assert.match(await texto({ ...CONFIG, tarifa: periodos }), /mover/i);
  assert.doesNotMatch(await texto({ ...CONFIG, tarifa: { ...periodos, hasta: "2026-06-30" } }), /mover/i); // caducada
  assert.doesNotMatch(await texto({ ...CONFIG, tarifa: null }), /mover/i);
  assert.doesNotMatch(await texto({ ...CONFIG, tarifa: periodos }, false), /mover/i); // sin excedente observado
});

test("sin tarifa el informe guardado no contiene euros inventados", async () => {
  const kv = sembrar({ config: { ...CONFIG, tarifa: null, ubicacion: null } });
  await generarInforme({ HISTORICO: kv }, { ahora: AHORA, pedir: sinRed });
  const informe = kv.leer(`informe-${AYER}`);
  assert.equal(informe.coste.estado, "no_disponible");
  assert.equal(informe.coste.euros, undefined);
  assert.equal(informe.ranking.criterio, "kwh");
  assert.doesNotMatch(JSON.stringify(informe), /"euros"|≈ \d/);
});
