process.env.TZ = "UTC";
// Regresiones de la segunda revision (R1/R4 completitud, R2 version del contenido, R4 reconciliacion,
// R7 rotacion VAPID con el limite real del API, R8 migracion de resumenes). Solo datos sinteticos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { limitesDia, sumarDias } from "../worker/src/horario.js";
import { integrarDia, resumirDia, construirInforme, diaCompleto, acumuladoMes } from "../worker/src/informe-calculo.js";
import { archivar, seleccionar, RESUMEN, claveMes, LOTE_MIGRACION, MAX_INTENTOS } from "../worker/src/archivo.js";
import { programado, generarInforme, MAX_GENERACIONES, MAX_REGENERACIONES } from "../worker/src/informe.js";
import worker from "../worker/src/index.js";
import { activarPush, desactivarPush, claveABytes } from "../js/informe.js";
import { b64url } from "../worker/src/push.js";

const AHORA = Date.UTC(2026, 10, 8, 7, 30); // 08:30 en Madrid
const AYER = "2026-11-07";
const PLANA = { tipo: "plana", precio: 0.1, desde: "2026-01-01", hasta: null, fuente: "Factura de prueba" };
const CONFIG = { activo: true, pushActivo: false, consentimiento: true, ubicacion: null, tarifa: PLANA };

function dia(fecha, { valores = {}, saltar = () => false, paso = 300, desfase = 0 } = {}) {
  const { inicio, fin } = limitesDia(fecha);
  const base = { solar: 0, casa: 1000, compra: 1000, venta: 0, carga: 0, descarga: 0, soc: 50 };
  const puntos = [];
  let n = 0;
  for (let t = inicio / 1000; t < fin / 1000; t += paso, n++) {
    if (saltar(n, t)) continue;
    const x = typeof valores === "function" ? valores(t, n) : { ...base, ...valores };
    puntos.push([t + desfase, x.solar, x.casa, x.compra, x.venta, x.carga, x.descarga, x.soc]);
  }
  return puntos;
}

const sesion = { "solarman-sesion": { refresh: "r", access: "a", caduca: Date.UTC(2030, 0, 1) } };
const json = (cuerpo) => ({ ok: true, status: 200, json: async () => cuerpo });
const registros = (puntos) => ({ records: puntos.map((p) => ({ dateTime: p[0], generationPower: p[1], usePower: p[2], buyPower: p[3], gridPower: p[4], chargePower: p[5], dischargePower: p[6], batterySoc: p[7] })) });
const noMeteo = async () => new Response("{}", { status: 500 });

function kvFalso(inicial = {}) {
  const datos = new Map(Object.entries(inicial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    escrituras: [],
    async get(k, tipo) {
      const v = datos.get(k);
      return v === undefined ? null : tipo === "json" ? JSON.parse(v) : v;
    },
    async put(k, v) {
      this.escrituras.push(k);
      datos.set(k, v);
    },
    async delete(k) {
      datos.delete(k);
    },
    leer: (k) => JSON.parse(datos.get(k) ?? "null"),
  };
}

const informe = (puntos, extra = {}) => construirInforme({ puntos, fecha: AYER, ahora: AHORA, config: { tarifa: PLANA }, ...extra });

// Estas pruebas de reconciliacion aislan ayer; la rotacion entre colas se prueba por separado.
function kvSoloAyer(extra = {}) {
  const dias = {};
  for (let d = "2026-05-01"; d < AYER; d = sumarDias(d, 1)) dias[d] = 0;
  const intentos = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [sumarDias(AYER, -i - 1), MAX_INTENTOS]));
  return kvFalso({ ...sesion, [RESUMEN]: { dias, intentos, diarios: {}, horas: [] }, ...extra });
}

// ---------------------------------------------------------------- R1/R4: completitud sin redondeos

test("R1: faltan 5 muestras seguidas (25 min): parcial, minimo y coste parcial, aunque la cobertura sea 98,26 %", () => {
  const i = informe(dia(AYER, { saltar: (n) => n >= 100 && n < 105 }));
  assert.ok(i.cobertura.compra > 0.98 && i.cobertura.compra < 0.99);
  assert.equal(i.estado, "parcial");
  assert.equal(i.energia.compra.minimo, true);
  assert.equal(i.coste.parcial, true);
  assert.match(i.coste.aviso, /al menos|mínimo|minimo/i);
});

test("R1: faltan 7 muestras: informe, resumen y acumulado dicen lo mismo (no completo)", () => {
  const puntos = dia(AYER, { saltar: (n) => n >= 100 && n < 107 });
  const integrado = integrarDia(puntos, AYER);
  const resumen = resumirDia(integrado);
  assert.ok(Math.abs(resumen.cob.compra - 0.975694) < 1e-6, String(resumen.cob.compra));
  assert.equal(diaCompleto(resumen), false);
  assert.equal(informe(puntos).estado, "parcial");
  const a = acumuladoMes({ fecha: AYER, diarios: { [AYER]: resumen } });
  assert.equal(a.diasCompletos, 0);
});

test("R1: una sola muestra perdida tambien es un hueco real de 5 minutos", () => {
  const puntos = dia(AYER, { saltar: (n) => n === 100 });
  assert.equal(informe(puntos).estado, "parcial");
  assert.equal(diaCompleto(resumirDia(integrarDia(puntos, AYER))), false);
});

test("R1: solo una holgura numerica de segundos en el borde del dia no impide completo", () => {
  const puntos = dia(AYER, { desfase: 10 }); // marcas con 10 s de desfase
  assert.equal(informe(puntos).estado, "ok");
  assert.equal(diaCompleto(resumirDia(integrarDia(puntos, AYER))), true);
});

test("R1: dias de 23 y 25 horas: completos con todas las filas y parciales con 5 huecos", () => {
  for (const fecha of ["2026-10-25", "2027-03-28"]) {
    const completo = integrarDia(dia(fecha), fecha);
    assert.equal(diaCompleto(resumirDia(completo)), true, fecha);
    const hueco = dia(fecha, { saltar: (n) => n >= 50 && n < 55 });
    assert.equal(diaCompleto(resumirDia(integrarDia(hueco, fecha))), false, fecha);
    const i = construirInforme({ puntos: hueco, fecha, ahora: limitesDia(sumarDias(fecha, 1)).inicio + 9e6, config: { tarifa: PLANA } });
    assert.equal(i.estado, "parcial", fecha);
  }
});

test("R1: un dia con 5 muestras perdidas sigue pendiente de revisita en el archivo", async () => {
  const kv = kvFalso(sesion);
  const puntos = dia(AYER, { saltar: (n) => n >= 100 && n < 105 });
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(puntos)), ahora: AHORA, maximo: 1 });
  assert.ok(seleccionar(kv.leer(RESUMEN), AYER, 2).includes(AYER));
});

// ---------------------------------------------------------------- R2: version del contenido

async function ciclo(kv, puntos, ahora = AHORA, extra = {}) {
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(puntos)), ahora, maximo: 1 });
  return programado({ HISTORICO: kv, ...extra }, { ahora, pedir: noMeteo });
}
const ayerBase = (compra, n = 288) => dia(AYER, { valores: { solar: 0, casa: 2000, compra, venta: 0, carga: 0, descarga: 0, soc: 50 } }).slice(0, n);

test("R2: una correccion de valores con la misma cobertura regenera un informe parcial", async () => {
  const kv = kvSoloAyer({ "informe-config": CONFIG });
  assert.equal((await ciclo(kv, ayerBase(1000, 200))).resultado, "generado");
  assert.equal(kv.leer(`informe-${AYER}`).energia.compra.kwh, 16.67);
  const r = await ciclo(kv, ayerBase(2000, 200), AHORA + 3600000);
  assert.equal(r.resultado, "generado");
  assert.equal(kv.leer(`informe-${AYER}`).energia.compra.kwh, 33.33);
});

test("R2: una muestra adicional (mejora minima de cobertura) tambien regenera", async () => {
  const kv = kvSoloAyer({ "informe-config": CONFIG });
  await ciclo(kv, ayerBase(1000, 201));
  const antes = kv.leer(`informe-${AYER}`).energia.compra.kwh;
  const r = await ciclo(kv, ayerBase(1000, 202), AHORA + 3600000);
  assert.equal(r.resultado, "generado");
  assert.ok(kv.leer(`informe-${AYER}`).energia.compra.kwh > antes);
});

test("R2: un informe completo tambien se regenera si el portal corrige valores despues", async () => {
  const kv = kvSoloAyer({ "informe-config": CONFIG });
  await ciclo(kv, ayerBase(1000));
  assert.equal(kv.leer(`informe-${AYER}`).estado, "ok");
  const r = await ciclo(kv, ayerBase(1500), AHORA + 3600000);
  assert.equal(r.resultado, "generado");
  assert.equal(kv.leer(`informe-${AYER}`).energia.compra.kwh, 36);
});

test("R2: sin cambios en la fuente no se regenera ni se escribe de mas", async () => {
  const kv = kvSoloAyer({ "informe-config": CONFIG });
  await ciclo(kv, ayerBase(1000));
  const antes = kv.escrituras.length;
  const r = await ciclo(kv, ayerBase(1000), AHORA + 3600000);
  assert.equal(r.resultado, "completo");
  assert.equal(kv.leer("informe-indice").informes[0].intentos, 1);
  assert.deepEqual(kv.escrituras.slice(antes), []); // ni curva, ni resumen, ni marca, ni informe
});

test("R2: las regeneraciones por cambios de la fuente estan acotadas", async () => {
  const kv = kvSoloAyer({ "informe-config": CONFIG });
  await ciclo(kv, ayerBase(1000));
  for (let n = 1; n <= MAX_GENERACIONES + MAX_REGENERACIONES + 3; n++) await ciclo(kv, ayerBase(1000 + n * 10), AHORA + n * 3600000);
  assert.equal(kv.leer("informe-indice").informes[0].intentos, MAX_GENERACIONES + MAX_REGENERACIONES);
});

test("R2: un cambio en los agregados de otros dias actualiza el informe dependiente", async () => {
  const kv = kvSoloAyer({ "informe-config": CONFIG });
  await ciclo(kv, ayerBase(1000));
  const resumen = kv.leer(RESUMEN);
  const antes = kv.leer(`informe-${AYER}`).mes.actual.compra;
  resumen.diarios["2026-11-03"] = { ...resumirDia(integrarDia(dia("2026-11-03"), "2026-11-03")) };
  await kv.put(RESUMEN, JSON.stringify(resumen));
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(ayerBase(1000))), ahora: AHORA + 1800000, maximo: 1 });
  assert.ok(kv.leer("solarman-version"));
  const r = await programado({ HISTORICO: kv }, { ahora: AHORA + 3600000, pedir: noMeteo });
  assert.equal(r.resultado, "generado");
  assert.ok(kv.leer(`informe-${AYER}`).mes.actual.compra > antes);
});

test("R2: al regenerar por cambio de valores no se reenvia el aviso ya entregado", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const vapid = { VAPID_PUBLIC_KEY: b64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")])), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: "mailto:op@ejemplo.test" };
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const sub = { id: "d1", endpoint: "https://web.push.apple.com/x", keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(randomBytes(16)) }, creada: "2026-11-01T00:00:00.000Z", entrega: {} };
  const kv = kvSoloAyer({ "informe-config": { ...CONFIG, pushActivo: true }, "informe-subs": { dispositivos: [sub] } });
  let envios = 0;
  const pedir = async (url) => (url.includes("push.apple.com") ? (envios++, new Response(null, { status: 201 })) : noMeteo());
  const ir = async (puntos, ahora) => {
    await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(puntos)), ahora, maximo: 1 });
    return programado({ HISTORICO: kv, ...vapid }, { ahora, pedir });
  };
  await ir(ayerBase(1000), AHORA);
  assert.equal(envios, 1);
  const r = await ir(ayerBase(1800), AHORA + 3600000);
  assert.equal(r.resultado, "generado");
  assert.equal(kv.leer(`informe-${AYER}`).energia.compra.kwh, 43.2);
  assert.equal(envios, 1);
  assert.equal(kv.leer("informe-subs").dispositivos[0].entrega[AYER].estado, "enviado");
  assert.equal(kv.leer("informe-indice").informes[0].push.estado, "enviado");
});

// ---------------------------------------------------------------- R4: reconciliacion por instante y senal

test("R4: una segunda descarga con menos filas pero otro canal valido no destruye medidas ya guardadas", async () => {
  const kv = kvSoloAyer();
  const sinSolar = dia(AYER, { valores: () => ({ solar: null, casa: 1000, compra: 1000, venta: 0, carga: 0, descarga: 0, soc: 50 }) });
  const con250 = dia(AYER, { valores: () => ({ solar: 800, casa: 1000, compra: 1000, venta: 0, carga: 0, descarga: 0, soc: 50 }) }).slice(0, 250);
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(sinSolar)), ahora: AHORA, maximo: 1 });
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(con250)), ahora: AHORA, maximo: 1 });
  const guardado = kv.leer(RESUMEN);
  const curva = kv.leer(claveMes("2026-11")).dias["07"];
  assert.equal(curva.length, 288);
  assert.equal(guardado.dias[AYER], 288);
  assert.equal(guardado.diarios[AYER].compra, 24);
  assert.equal(guardado.diarios[AYER].casa, 24);
  assert.ok(Math.abs(guardado.diarios[AYER].cob.solar - 250 / 288) < 1e-5);
  assert.ok(Math.abs(guardado.diarios[AYER].solar - (800 * 250 * 300) / 3.6e6) < 0.01);
  // Las horas retenidas salen de la misma fuente reconciliada.
  const { inicio, fin } = limitesDia(AYER);
  const horas = guardado.horas.filter((h) => h[0] * 3600000 >= inicio && h[0] * 3600000 < fin);
  assert.equal(horas.length, 24);
  assert.ok(Math.abs(horas.reduce((s, h) => s + h[1], 0) / 1000 - guardado.diarios[AYER].casa) < 0.05);
});

test("R4: una correccion con la misma cobertura actualiza los valores validos y conserva los ausentes", async () => {
  const kv = kvSoloAyer();
  const primera = dia(AYER, { valores: (t, n) => ({ solar: n < 144 ? 500 : null, casa: 1000, compra: 1000, venta: 0, carga: 0, descarga: 0, soc: 50 }) });
  const segunda = dia(AYER, { valores: (t, n) => ({ solar: n < 144 ? 700 : null, casa: 1000, compra: 1500, venta: 0, carga: 0, descarga: 0, soc: null }) });
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(primera)), ahora: AHORA, maximo: 1 });
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(segunda)), ahora: AHORA, maximo: 1 });
  const curva = kv.leer(claveMes("2026-11")).dias["07"];
  assert.equal(curva[10][1], 700);
  assert.equal(curva[10][3], 1500);
  assert.equal(curva[10][7], 50); // el SOC ausente no borra el valido
  assert.equal(curva[200][1], null);
  assert.equal(kv.leer(RESUMEN).diarios[AYER].compra, 36);
});

test("R4: los duplicados se reconcilian por instante y no inflan filas ni energia", async () => {
  const kv = kvFalso(sesion);
  const puntos = dia(AYER);
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros([...puntos, ...puntos.slice(0, 50)])), ahora: AHORA, maximo: 1 });
  assert.equal(kv.leer(claveMes("2026-11")).dias["07"].length, 288);
  assert.equal(kv.leer(RESUMEN).diarios[AYER].compra, 24);
});

test("R4: una revisita sin cambios no reescribe la curva ni deja horas residuales", async () => {
  const kv = kvSoloAyer();
  const lista = dia(AYER, { saltar: (n) => n >= 100 && n < 105 });
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(lista)), ahora: AHORA, maximo: 1 });
  const antes = kv.escrituras.filter((k) => k === claveMes("2026-11")).length;
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(lista)), ahora: AHORA, maximo: 1 });
  assert.equal(kv.escrituras.filter((k) => k === claveMes("2026-11")).length, antes);
  const horas = kv.leer(RESUMEN).horas;
  assert.equal(new Set(horas.map((h) => h[0])).size, horas.length);
});

// ---------------------------------------------------------------- R7: rotacion con el limite real del API

const CLAVE = "clave-de-prueba";
function vapidEntorno() {
  return { VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "x", VAPID_SUBJECT: "mailto:op@ejemplo.test" };
}
function dispositivoDe(nombre) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint: `https://web.push.apple.com/${nombre}`, keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(randomBytes(16)) } };
}
const registroServidor = (s, id) => ({ id, ...s, creada: "2026-11-01T00:00:00.000Z", entrega: {} });

async function idDe(endpoint) {
  const { idSuscripcion } = await import("../worker/src/push.js");
  return idSuscripcion(endpoint);
}

async function escenarioRotacion({ fallaAlta = 0, fallaPut = 0, claveVieja = "AQID", claveNueva = "BAUG" } = {}) {
  const propio = dispositivoDe("propio-viejo");
  const ajenos = [1, 2, 3, 4].map((n) => dispositivoDe(`ajeno${n}`));
  const subs = [];
  for (const s of [propio, ...ajenos]) subs.push(registroServidor(s, await idDe(s.endpoint)));
  const kv = kvFalso({ "informe-subs": { dispositivos: subs } });
  const entorno = { HISTORICO: kv, SOLAR_ID: CLAVE, ...vapidEntorno() };
  const nube = (fallos) => async (ruta, { method = "GET", body } = {}) => {
    if (method === "PUT" && fallos.put-- > 0) return new Response(JSON.stringify({ error: "servidor caido" }), { status: 500 });
    return worker.fetch(new Request(`https://w.test${ruta}`, { method, body, headers: { Authorization: `Bearer ${CLAVE}` } }), entorno);
  };
  const fallos = { put: fallaPut, alta: fallaAlta };
  let local = { endpoint: propio.endpoint, options: { applicationServerKey: claveABytes(claveVieja).buffer }, toJSON: () => propio, unsubscribe: async () => ((local = null), true) };
  let contador = 0;
  const nuevaSub = () => {
    const s = dispositivoDe(`propio-nuevo${++contador}`);
    const sub = { endpoint: s.endpoint, options: { applicationServerKey: claveABytes(claveNueva).buffer }, toJSON: () => s, unsubscribe: async () => (local === sub && (local = null), true) };
    return sub;
  };
  const almacen = new Map();
  const entornoPush = () => ({
    notification: { permission: "granted", requestPermission: async () => "granted" },
    registro: {
      pushManager: {
        getSubscription: async () => local,
        subscribe: async () => {
          if (fallos.alta-- > 0) throw new Error("fallo del proveedor");
          local = nuevaSub();
          return local;
        },
      },
    },
    pedir: nube(fallos),
    clave: claveNueva,
    almacen: { getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => almacen.set(k, v), removeItem: (k) => almacen.delete(k) },
  });
  const endpoints = () => kv.leer("informe-subs").dispositivos.map((d) => d.endpoint);
  return { entornoPush, endpoints, propio, ajenos, almacen, local: () => local };
}

test("R7: con cinco dispositivos la rotacion reemplaza el registro propio sin consumir plaza", async () => {
  const e = await escenarioRotacion();
  const r = await activarPush(e.entornoPush());
  assert.equal(r.estado, "activo", r.mensaje);
  const eps = e.endpoints();
  assert.equal(eps.length, 5);
  assert.ok(!eps.includes(e.propio.endpoint));
  assert.ok(eps.some((x) => x.includes("propio-nuevo")));
  for (const a of e.ajenos) assert.ok(eps.includes(a.endpoint), "no se borran suscripciones ajenas");
  assert.equal(e.almacen.size, 0);
});

test("R7: si falla crear la nueva suscripcion se conserva la referencia y el reintento la limpia", async () => {
  const e = await escenarioRotacion({ fallaAlta: 1 });
  const r = await activarPush(e.entornoPush());
  assert.equal(r.estado, "error");
  assert.match(r.mensaje, /fallo del proveedor/);
  assert.equal(e.endpoints().length, 5);
  assert.ok(e.almacen.size > 0, "queda la referencia del registro antiguo");
  const r2 = await activarPush(e.entornoPush());
  assert.equal(r2.estado, "activo", r2.mensaje);
  const eps = e.endpoints();
  assert.equal(eps.length, 5);
  assert.ok(!eps.includes(e.propio.endpoint));
  assert.equal(e.almacen.size, 0);
});

test("R7: si el servidor rechaza el registro no se anuncia exito, se deshace lo local y el reintento funciona", async () => {
  const e = await escenarioRotacion({ fallaPut: 1 });
  const r = await activarPush(e.entornoPush());
  assert.equal(r.estado, "error");
  assert.match(r.mensaje, /servidor caido/);
  assert.equal(e.local(), null, "la nueva suscripcion local se deshace");
  assert.equal(e.endpoints().length, 5);
  const r2 = await activarPush(e.entornoPush());
  assert.equal(r2.estado, "activo", r2.mensaje);
  assert.equal(e.endpoints().length, 5);
  assert.ok(!e.endpoints().includes(e.propio.endpoint));
});

test("R7: desactivar tras un fallo intermedio quita el registro antiguo en vez de decir que no habia suscripcion", async () => {
  const e = await escenarioRotacion({ fallaAlta: 1 });
  await activarPush(e.entornoPush());
  const r = await desactivarPush(e.entornoPush());
  assert.equal(r.estado, "inactivo");
  assert.doesNotMatch(r.mensaje, /no estaba suscrito/);
  assert.equal(e.endpoints().length, 4);
  assert.ok(!e.endpoints().includes(e.propio.endpoint));
  assert.equal(e.almacen.size, 0);
});

test("R7: el API solo reemplaza el endpoint indicado y mantiene el limite para altas nuevas", async () => {
  const e = await escenarioRotacion();
  const { pedir } = e.entornoPush();
  const nuevo = dispositivoDe("otro-nuevo");
  const sinReemplazo = await pedir("/informe/suscripcion", { method: "PUT", body: JSON.stringify({ suscripcion: nuevo }) });
  assert.equal(sinReemplazo.status, 409);
  const inexistente = await pedir("/informe/suscripcion", { method: "PUT", body: JSON.stringify({ suscripcion: nuevo, reemplaza: "https://web.push.apple.com/no-existe" }) });
  assert.equal(inexistente.status, 409);
  const invalido = await pedir("/informe/suscripcion", { method: "PUT", body: JSON.stringify({ suscripcion: nuevo, reemplaza: "https://evil.example/x" }) });
  assert.equal(invalido.status, 400);
  assert.equal(e.endpoints().length, 5);
  const bien = await pedir("/informe/suscripcion", { method: "PUT", body: JSON.stringify({ suscripcion: nuevo, reemplaza: e.propio.endpoint }) });
  assert.equal(bien.status, 200);
  assert.equal(e.endpoints().length, 5);
});

// ---------------------------------------------------------------- R8: migracion incremental

async function escenarioHeredado() {
  const ahora = Date.UTC(2026, 10, 21, 7, 30); // ayer = 2026-11-20
  const ayer = "2026-11-20";
  const dias = {};
  const curvas = new Map();
  for (let t = Date.UTC(2026, 4, 1); t <= Date.UTC(2026, 10, 20); t += 86400000) dias[new Date(t).toISOString().slice(0, 10)] = 288;
  for (let t = Date.UTC(2026, 9, 1); t <= Date.UTC(2026, 10, 20); t += 86400000) {
    const f = new Date(t).toISOString().slice(0, 10);
    const mes = f.slice(0, 7);
    if (!curvas.has(mes)) curvas.set(mes, { columnas: [], dias: {} });
    curvas.get(mes).dias[f.slice(8)] = dia(f);
  }
  const inicial = { ...sesion, "informe-config": CONFIG, [RESUMEN]: { dias, horas: [], diarios: {} } };
  for (const [mes, c] of curvas) inicial[claveMes(mes)] = c;
  return { kv: kvFalso(inicial), ahora, ayer };
}

// Solo ayer (20) entra en las revisitas horarias; migrar los demas dias heredados no descarga nada.
const soloAyer = async (url) => (url.includes("month=11&day=20") ? json(registros(dia("2026-11-20"))) : assert.fail("la migracion no debe descargar nada"));
const correr = (kv, ahora) => archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: soloAyer, ahora, maximo: 2 });

test("R8: los dias heredados de hace mas de 7 dias se migran por lotes acotados y de forma idempotente", async () => {
  const { kv, ahora, ayer } = await escenarioHeredado();
  const primera = await correr(kv, ahora);
  assert.equal(primera.resultado, "migrado");
  const migrados = Object.keys(kv.leer(RESUMEN).diarios);
  assert.ok(migrados.length > 0 && migrados.length <= LOTE_MIGRACION);
  assert.ok(migrados.includes("2026-11-20"), "primero lo mas reciente");
  let vueltas = 1;
  while ((await correr(kv, ahora)).migrados.length) assert.ok(++vueltas < 80);
  const diarios = kv.leer(RESUMEN).diarios;
  assert.ok(vueltas >= 2 && vueltas <= Math.ceil(62 / LOTE_MIGRACION) + 1, String(vueltas));
  for (let d = 1; d <= 20; d++) assert.equal(diaCompleto(diarios[`2026-11-${String(d).padStart(2, "0")}`]), true);
  assert.equal(diarios["2026-11-05"].compra, 24);
  const escrituras = kv.escrituras.length;
  const final = await correr(kv, ahora);
  assert.equal(final.resultado, "archivado"); // solo la revisita de ayer, sin cambios
  assert.deepEqual(final.migrados, []);
  assert.equal(kv.escrituras.length, escrituras);
});

test("R8: durante la migracion el informe lo dice y al terminar se actualiza con los dias heredados", async () => {
  const { kv, ahora, ayer } = await escenarioHeredado();
  await correr(kv, ahora);
  await programado({ HISTORICO: kv }, { ahora, pedir: noMeteo });
  const parcial = kv.leer(`informe-${ayer}`);
  assert.ok(parcial.mes.pendientesMigracion > 0);
  assert.match(parcial.mes.aviso, /incorporando|migra/i);
  let vueltas = 0;
  while ((await correr(kv, ahora)).migrados.length) assert.ok(++vueltas < 80);
  const r = await programado({ HISTORICO: kv }, { ahora: ahora + 3600000, pedir: noMeteo });
  assert.equal(r.resultado, "generado");
  const fin = kv.leer(`informe-${ayer}`);
  assert.equal(fin.mes.diasCompletos, 20);
  assert.equal(fin.mes.actual.compra, 480);
  assert.equal(fin.mes.pendientesMigracion, 0);
  assert.equal(fin.mes.comparable.mesAnteriorClave, "2026-10");
});

test("R8: un dia archivado cuya curva falta no bloquea la migracion", async () => {
  const { kv, ahora } = await escenarioHeredado();
  const resumen = kv.leer(RESUMEN);
  resumen.dias["2026-11-19"] = 288;
  const curva = kv.leer(claveMes("2026-11"));
  delete curva.dias["19"];
  await kv.put(claveMes("2026-11"), JSON.stringify(curva));
  // Sin curva el dia no se puede medir: la migracion no se atasca y el dia queda incompleto,
  // con la revisita acotada por intentos (el portal aqui no devuelve nada).
  let descargas = 0;
  const vacio = async (url) => (url.includes("day=19") && descargas++, json(url.includes("day=20") ? registros(dia("2026-11-20")) : { records: [] }));
  let vueltas = 0;
  while ((await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: vacio, ahora, maximo: 2 })).migrados.length) assert.ok(++vueltas < 80);
  assert.equal(diaCompleto(kv.leer(RESUMEN).diarios["2026-11-19"]), false);
  assert.ok(descargas <= MAX_INTENTOS, String(descargas));
});
