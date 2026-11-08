process.env.TZ = "UTC";
// Regresiones de la revision R1-R5 del informe diario (datos sinteticos, proceso en UTC).
import { test } from "node:test";
import assert from "node:assert/strict";
import { limitesDia, sumarDias } from "../worker/src/horario.js";
import { integrarDia, resumirDia, construirInforme, costeDia, acumuladoMes, diaCompleto } from "../worker/src/informe-calculo.js";
import { archivar, aHoras, seleccionar, pendientesMigracion, RESUMEN, claveMes, MAX_INTENTOS } from "../worker/src/archivo.js";
import { programado, generarInforme, MAX_GENERACIONES, MAX_REGENERACIONES } from "../worker/src/informe.js";
import { htmlInforme } from "../js/informe.js";

const AHORA = Date.UTC(2026, 10, 8, 7, 30); // 08:30 en Madrid
const AYER = "2026-11-07";
const PLANA = { tipo: "plana", precio: 0.1, desde: "2026-01-01", hasta: null, fuente: "Factura de prueba" };

function dia(fecha, { valores = {}, saltar = () => false, paso = 300 } = {}) {
  const { inicio, fin } = limitesDia(fecha);
  const base = { solar: 0, casa: 1000, compra: 1000, venta: 0, carga: 0, descarga: 0, soc: 50 };
  const puntos = [];
  for (let t = inicio / 1000; t < fin / 1000; t += paso) {
    if (saltar(t, (t - inicio / 1000) / 3600)) continue;
    const x = typeof valores === "function" ? valores(t, (t - inicio / 1000) / 3600) : { ...base, ...valores };
    puntos.push([t, x.solar, x.casa, x.compra, x.venta, x.carga, x.descarga, x.soc]);
  }
  return puntos;
}

const informe = (puntos, extra = {}) => construirInforme({ puntos, fecha: AYER, ahora: AHORA, config: { tarifa: PLANA }, ...extra });
const textos = (i) => i.conclusiones.map((c) => c.texto).join("\n");

// ---------------------------------------------------------------- R1

test("R1: dos horas sin datos de 24 (91,67 %) es parcial, no completo, y todo lo observado lo advierte", () => {
  const puntos = dia(AYER, { saltar: (t, h) => h >= 5 && h < 7 });
  const i = informe(puntos);
  assert.equal(i.estado, "parcial");
  assert.equal(i.cobertura.compra, 0.9167);
  assert.equal(i.energia.compra.kwh, 22);
  assert.equal(i.energia.compra.minimo, true);
  assert.match(textos(i), /al menos 22 kWh/);
  assert.match(textos(i), /Cobertura incompleta/);
  assert.equal(i.coste.estado, "disponible");
  assert.equal(i.coste.parcial, true);
  assert.match(i.coste.aviso, /al menos|mínimo|minimo/i);
  assert.match(i.coste.aviso, /no se ha extrapolado|sin extrapolar/i);
  const h = htmlInforme(i);
  assert.match(h, /Parcial/);
  assert.doesNotMatch(h, />Completo</);
});

test("R1: solo un dia sin huecos es completo; un muestreo perdido (5 min medidos de menos) ya es parcial", () => {
  assert.equal(informe(dia(AYER)).estado, "ok");
  assert.equal(informe(dia(AYER, { saltar: (t, h) => h === 5.5 })).estado, "parcial");
  const i = informe(dia(AYER));
  assert.equal(i.energia.compra.minimo, false);
  assert.equal(i.coste.parcial, undefined);
});

test("R1: coste de un dia parcial es un minimo observado y por debajo de 75 % de compra no hay euros", () => {
  const casi = integrarDia(dia(AYER, { saltar: (t, h) => h >= 5 && h < 7 }), AYER);
  const c = costeDia(casi, PLANA, AYER);
  assert.equal(c.euros, Math.round(22 * 0.1 * 1.0511269632 * 1.21 * 100) / 100);
  const poco = integrarDia(dia(AYER, { saltar: (t, h) => h < 12 }), AYER);
  assert.equal(costeDia(poco, PLANA, AYER).estado, "no_disponible");
});

test("R1: un dia parcial no se compara con dias completos como si fuera el dia entero", () => {
  const diarios = {};
  for (const d of ["2026-10-31", "2026-10-24", "2026-10-17"]) diarios[d] = resumirDia(integrarDia(dia(d), d));
  const parcial = informe(dia(AYER, { saltar: (t, h) => h >= 5 && h < 7 }), { diarios });
  assert.equal(parcial.comparacion, null);
  assert.match(textos(parcial), /no se compara/i);
  const entero = informe(dia(AYER), { diarios });
  assert.ok(entero.comparacion);
});

test("R1: el acumulado mensual solo suma dias completos y lo dice", () => {
  const parcial = resumirDia(integrarDia(dia("2026-11-02", { saltar: (t, h) => h >= 5 && h < 7 }), "2026-11-02"));
  const entero = resumirDia(integrarDia(dia("2026-11-03"), "2026-11-03"));
  const m = acumuladoMes({ fecha: "2026-11-04", diarios: { "2026-11-02": parcial, "2026-11-03": entero } });
  assert.equal(m.diasCompletos, 1);
  assert.equal(m.actual.compra, 24);
  assert.match(m.aviso, /1 de 4/);
});

// ---------------------------------------------------------------- R5

test("R5: un SOC aislado a mediodia no es inicio ni final del dia", () => {
  const { inicio } = limitesDia(AYER);
  const puntos = dia(AYER, { valores: (t) => ({ solar: 0, casa: 500, compra: 500, venta: 0, carga: 0, descarga: 0, soc: t === inicio / 1000 + 12 * 3600 ? 5 : null }) });
  const i = informe(puntos);
  assert.equal(i.soc.muestras, 1);
  assert.equal(i.soc.inicioCercano, false);
  assert.equal(i.soc.finCercano, false);
  assert.equal(i.soc.primeraHora, "12:00");
  const t = textos(i);
  assert.doesNotMatch(t, /empezó|acabó/);
  assert.match(t, /una sola lectura.*5 %.*12:00/);
});

test("R5: con lecturas cerca de los extremos si se habla de inicio y final; el cero real vale", () => {
  const i = informe(dia(AYER, { valores: (t, h) => ({ solar: 0, casa: 500, compra: 500, venta: 0, carga: 0, descarga: 0, soc: h < 12 ? 0 : 40 }) }));
  assert.equal(i.soc.inicioCercano, true);
  assert.equal(i.soc.finCercano, true);
  assert.equal(i.soc.min, 0);
  assert.match(textos(i), /empezó en 0 % y acabó en 40 %/);
});

test("R5: lecturas solo de la manana describen el intervalo observado, no el final del dia", () => {
  const i = informe(dia(AYER, { valores: (t, h) => ({ solar: 0, casa: 500, compra: 500, venta: 0, carga: 0, descarga: 0, soc: h < 6 ? 30 : null }) }));
  assert.equal(i.soc.inicioCercano, true);
  assert.equal(i.soc.finCercano, false);
  assert.doesNotMatch(textos(i), /acabó/);
  assert.match(textos(i), /lecturas entre las 00:00 y las 06:55|lecturas entre/);
  assert.ok(i.soc.cobertura < 0.3);
});

// ---------------------------------------------------------------- R3 (origen: aHoras)

test("R3: aHoras distingue solar ausente de solar cero real", () => {
  const sin = aHoras([[1000, null, 100, 0, 0, 0, 0, 50], [1300, null, 100, 0, 0, 0, 0, 50]]);
  assert.equal(sin[0][2], 0);
  assert.equal(sin[0][5], 0); // minutos con solar medido
  const cero = aHoras([[1000, 0, 100, 0, 0, 0, 0, 50], [1300, 0, 100, 0, 0, 0, 0, 50]]);
  assert.equal(cero[0][2], 0);
  assert.equal(cero[0][5], 10);
  const mixto = aHoras([[1000, 500, 100, 0, 0, 0, 0, 50], [1300, null, 100, 0, 0, 0, 0, 50]]);
  assert.equal(mixto[0][5], 5);
});

// ---------------------------------------------------------------- R4

const sesion = { "solarman-sesion": { refresh: "r", access: "a", caduca: Date.UTC(2030, 0, 1) } };
const json = (cuerpo) => ({ ok: true, status: 200, json: async () => cuerpo });
const registros = (puntos) => ({ records: puntos.map((p) => ({ dateTime: p[0], generationPower: p[1], usePower: p[2], buyPower: p[3], gridPower: p[4], chargePower: p[5], dischargePower: p[6], batterySoc: p[7] })) });

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

const conSolar = (extra = {}) => dia(AYER, { valores: (t, h) => ({ solar: h >= 10 && h < 16 ? 1500 : 0, casa: 400, compra: 100, venta: 0, carga: 0, descarga: 0, soc: 50, ...extra }) });
const sinSolar = () => conSolar({ solar: null }).map((p) => [p[0], null, ...p.slice(2)]);
const ahoraArchivo = AHORA; // ayer = 2026-11-07

async function archivarCon(kv, puntos, opciones = {}) {
  let llamadas = 0;
  const pedir = async () => (llamadas++, json(registros(puntos)));
  const r = await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir, ahora: ahoraArchivo, maximo: 1, ...opciones });
  return { r, llamadas };
}

test("R4: 288 filas con cobertura solar cero no cierran ayer y una correccion posterior se recupera", async () => {
  const kv = kvSoloAyer();
  let { llamadas } = await archivarCon(kv, sinSolar());
  assert.equal(llamadas, 1);
  assert.equal(kv.leer(RESUMEN).dias[AYER], 288);
  assert.equal(kv.leer(RESUMEN).diarios[AYER].cob.solar, 0);
  assert.ok(seleccionar(kv.leer(RESUMEN), AYER, 2).includes(AYER), "ayer debe seguir pendiente");
  ({ llamadas } = await archivarCon(kv, conSolar()));
  assert.equal(llamadas, 1);
  assert.equal(kv.leer(RESUMEN).diarios[AYER].cob.solar, 1);
  assert.equal(kv.leer(RESUMEN).diarios[AYER].solar, 9);
  assert.equal(diaCompleto(kv.leer(RESUMEN).diarios[AYER]), true);
  assert.equal(kv.leer(RESUMEN).intentos[AYER], undefined);
});

test("R4: la revisita con la misma cantidad de filas pero menos cobertura no sustituye lo bueno", async () => {
  const kv = kvSoloAyer();
  const mediaManana = conSolar().map((p, i) => (i >= 144 ? [p[0], null, ...p.slice(2)] : p));
  await archivarCon(kv, mediaManana);
  assert.equal(kv.leer(RESUMEN).diarios[AYER].cob.solar, 0.5);
  await archivarCon(kv, sinSolar());
  assert.equal(kv.leer(RESUMEN).diarios[AYER].cob.solar, 0.5);
  assert.equal(kv.leer(claveMes("2026-11")).dias["07"][120][1], 1500);
});

test("R4: filas duplicadas no cuentan como dia completo", async () => {
  const kv = kvFalso(sesion);
  const mitad = dia(AYER, { saltar: (t) => (t / 300) % 2 === 0 });
  const duplicadas = [...mitad, ...mitad, ...mitad.slice(0, 144)].slice(0, 288);
  assert.equal(duplicadas.length, 288);
  await archivarCon(kv, duplicadas);
  assert.equal(kv.leer(RESUMEN).dias[AYER], 144); // filas unicas por instante
  assert.ok(kv.leer(RESUMEN).diarios[AYER].cob.casa < 0.6);
  assert.ok(seleccionar(kv.leer(RESUMEN), AYER, 2).includes(AYER));
});

test("R4: dias de 23 y 25 horas se completan con sus filas reales, sin revisitas", async () => {
  for (const [fecha, filas] of [["2026-10-25", 300], ["2027-03-28", 276]]) {
    const kv = kvFalso(sesion);
    const puntos = dia(fecha);
    assert.equal(puntos.length, filas);
    const ahora = limitesDia(sumarDias(fecha, 1)).inicio + 10 * 3600000;
    await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(puntos)), ahora, maximo: 1 });
    assert.equal(kv.leer(RESUMEN).diarios[fecha].cob.casa, 1, fecha);
    assert.equal(diaCompleto(kv.leer(RESUMEN).diarios[fecha]), true, fecha);
    assert.equal(kv.leer(RESUMEN).intentos[fecha], undefined, fecha);
  }
});

test("R4: los reintentos siguen acotados y ayer no deja sin turno al atrasado", async () => {
  const kv = kvFalso(sesion);
  let llamadas = 0;
  for (let i = 0; i < MAX_INTENTOS + 4; i++) await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => (llamadas++, json(registros(sinSolar()))), ahora: ahoraArchivo, maximo: 1 });
  assert.ok(llamadas <= MAX_INTENTOS + 4);
  assert.ok(kv.leer(RESUMEN).intentos[AYER] === undefined || kv.leer(RESUMEN).intentos[AYER] <= MAX_INTENTOS);
  const lista = seleccionar({ dias: {}, intentos: { [AYER]: MAX_INTENTOS }, diarios: {} }, AYER, 2);
  assert.equal(lista.includes(AYER), false);
  assert.ok(lista.includes("2026-05-01"));
});

test("R4: un dia con curva y sin resumen de cobertura no se descarga: lo mide la migracion desde la curva", () => {
  const resumen = { dias: { [AYER]: 288 }, diarios: {}, intentos: {} };
  assert.equal(seleccionar(resumen, AYER, 2).includes(AYER), false);
  assert.deepEqual(pendientesMigracion(resumen, AYER), [AYER]);
});

// ---------------------------------------------------------------- R2

const CONFIG = { activo: true, pushActivo: false, consentimiento: true, ubicacion: null, tarifa: PLANA };
const noMeteo = async () => new Response("{}", { status: 500 });

// Aislar las correcciones de ayer de la rotacion de colas, cubierta en sus propias regresiones.
function kvSoloAyer(extra = {}) {
  const dias = {};
  for (let d = "2026-05-01"; d < AYER; d = sumarDias(d, 1)) dias[d] = 0;
  const intentos = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [sumarDias(AYER, -i - 1), MAX_INTENTOS]));
  return kvFalso({ ...sesion, [RESUMEN]: { dias, intentos, diarios: {}, horas: [] }, ...extra });
}

async function paso(kv, puntos, ahora = AHORA) {
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(puntos)), ahora, maximo: 1 });
  return programado({ HISTORICO: kv }, { ahora, pedir: noMeteo });
}

test("R2: el informe parcial se regenera cuando el archivo mejora y conserva el historial", async () => {
  const kv = kvSoloAyer({ "informe-config": CONFIG });
  const completos = conSolar();
  assert.equal((await paso(kv, completos.slice(0, 200))).resultado, "generado");
  assert.equal(kv.leer(`informe-${AYER}`).estado, "parcial");
  assert.ok(kv.leer(`informe-${AYER}`).cobertura.casa < 0.7);
  const r = await paso(kv, completos, AHORA + 3600000);
  assert.equal(r.resultado, "generado");
  const guardado = kv.leer(`informe-${AYER}`);
  assert.equal(guardado.estado, "ok");
  assert.equal(guardado.cobertura.casa, 1);
  const entrada = kv.leer("informe-indice").informes[0];
  assert.equal(entrada.estado, "ok");
  assert.equal(entrada.intentos, 2);
  assert.equal((await programado({ HISTORICO: kv }, { ahora: AHORA + 7200000, pedir: noMeteo })).resultado, "completo");
});

test("R2: sin mejora en el archivo no se regenera y las regeneraciones estan acotadas", async () => {
  const kv = kvSoloAyer({ "informe-config": CONFIG });
  const completos = conSolar();
  await paso(kv, completos.slice(0, 100));
  const escrituras = kv.escrituras.length;
  const r = await programado({ HISTORICO: kv }, { ahora: AHORA + 3600000, pedir: noMeteo });
  assert.equal(r.resultado, "completo");
  assert.equal(kv.escrituras.length, escrituras);
  for (let n = 1; n <= MAX_GENERACIONES + MAX_REGENERACIONES + 2; n++) await paso(kv, completos.slice(0, 100 + n * 10), AHORA + n * 3600000);
  assert.equal(kv.leer("informe-indice").informes[0].intentos, MAX_GENERACIONES + MAX_REGENERACIONES);
});

test("R2: una generacion manual anterior a las 08:30 no impide la actualizacion programada", async () => {
  const kv = kvSoloAyer({ "informe-config": CONFIG });
  const completos = conSolar();
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(completos.slice(0, 150))), ahora: AHORA - 5400000, maximo: 1 });
  await generarInforme({ HISTORICO: kv }, { ahora: AHORA - 5400000, pedir: noMeteo });
  assert.equal(kv.leer(`informe-${AYER}`).estado, "parcial");
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(completos)), ahora: AHORA - 1800000, maximo: 1 });
  assert.equal((await programado({ HISTORICO: kv }, { ahora: AHORA - 1800000, pedir: noMeteo })).resultado, "antes_de_hora");
  assert.equal((await programado({ HISTORICO: kv }, { ahora: AHORA, pedir: noMeteo })).resultado, "generado");
  assert.equal(kv.leer(`informe-${AYER}`).estado, "ok");
});

test("R2: al regenerar no se duplica el aviso ya enviado y se conserva el estado de entrega", async () => {
  const { createECDH, randomBytes, generateKeyPairSync } = await import("node:crypto");
  const { b64url } = await import("../worker/src/push.js");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const vapid = { VAPID_PUBLIC_KEY: b64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")])), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: "mailto:op@ejemplo.test" };
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const sub = { id: "d1", endpoint: "https://web.push.apple.com/x", keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(randomBytes(16)) }, creada: "2026-11-01T00:00:00.000Z", entrega: {} };
  const kv = kvSoloAyer({ "informe-config": { ...CONFIG, pushActivo: true }, "informe-subs": { dispositivos: [sub] } });
  let envios = 0;
  const pedir = async (url) => (url.includes("push.apple.com") ? (envios++, new Response(null, { status: 201 })) : noMeteo());
  const completos = conSolar();
  const ir = async (puntos, ahora) => {
    await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(puntos)), ahora, maximo: 1 });
    return programado({ HISTORICO: kv, ...vapid }, { ahora, pedir });
  };
  await ir(completos.slice(0, 200), AHORA);
  assert.equal(envios, 1);
  assert.equal(kv.leer("informe-subs").dispositivos[0].entrega[AYER].estado, "enviado");
  await ir(completos, AHORA + 3600000);
  assert.equal(kv.leer(`informe-${AYER}`).estado, "ok");
  assert.equal(envios, 1);
  assert.equal(kv.leer("informe-subs").dispositivos[0].entrega[AYER].estado, "enviado");
  assert.equal(kv.leer("informe-indice").informes[0].push.estado, "enviado");
});

test("R2: al cambiar el dia se informa del nuevo ayer", async () => {
  const kv = kvFalso({ ...sesion, "informe-config": CONFIG });
  await paso(kv, conSolar());
  const manana = AHORA + 86400000;
  const siguiente = dia("2026-11-08");
  await archivar({ HISTORICO: kv, SOLARMAN_PLANTA: "1" }, { pedir: async () => json(registros(siguiente)), ahora: manana, maximo: 1 });
  const r = await programado({ HISTORICO: kv }, { ahora: manana, pedir: noMeteo });
  assert.equal(r.fecha, "2026-11-08");
  assert.equal(kv.leer("informe-indice").informes.length, 2);
  assert.equal(kv.leer("informe-2026-11-07").estado, "ok");
});

// ---------------------------------------------------------------- R3 (calibracion)

const hora = (d, h) => Math.floor((limitesDia(`2026-10-${String(d + 10).padStart(2, "0")}`).inicio + h * 3600000) / 3600000);
function pasadoMeteo(dias = 8) {
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
const meteoHoy = () => {
  const { inicio } = limitesDia("2026-11-08");
  const t = Array.from({ length: 24 }, (_, h) => (inicio + h * 3600000) / 1000 + 3600);
  return { hourly: { time: t, shortwave_radiation: t.map((_, h) => (h >= 10 && h < 16 ? 400 : 0)), cloud_cover: t.map(() => 20) } };
};
const redSol = async (url) => new Response(JSON.stringify(url.includes("historical-forecast") ? pasadoMeteo() : meteoHoy()), { status: 200 });

async function hoyCon(horas) {
  const kv = kvFalso({
    "informe-config": { ...CONFIG, ubicacion: { lat: 41.3, lon: 2 } },
    [RESUMEN]: { dias: { [AYER]: 288 }, horas, diarios: {} },
    [claveMes("2026-11")]: { columnas: [], dias: { "07": dia(AYER, { valores: { solar: 0, casa: 400, compra: 400, venta: 0, carga: 0, descarga: 0, soc: 50 } }) } },
  });
  await generarInforme({ HISTORICO: kv }, { ahora: AHORA, pedir: redSol });
  return kv.leer(`informe-${AYER}`).hoy;
}

const horasPasadas = (formato) => {
  const r = [];
  for (let d = 1; d <= 8; d++) for (let h = 0; h < 24; h++) r.push(formato(d, h));
  return r;
};

test("R3: solar ausente (marcas completas, sin medidas) no calibra ni predice cero kWh", async () => {
  const hoy = await hoyCon(horasPasadas((d, h) => [hora(d, h), 400, 0, 50, 60, 0]));
  assert.equal(hoy.estado, "sin_calibracion");
  assert.equal(hoy.totalKwh, undefined);
  assert.doesNotMatch(JSON.stringify(hoy), /poco sol/);
});

test("R3: registros antiguos sin cobertura solar no acreditan calibracion", async () => {
  const hoy = await hoyCon(horasPasadas((d, h) => [hora(d, h), 400, h >= 10 && h < 16 ? 800 : 0, 50, 60]));
  assert.equal(hoy.estado, "sin_calibracion");
});

test("R3: solar medido (incluido cero real de noche) si calibra", async () => {
  const hoy = await hoyCon(horasPasadas((d, h) => [hora(d, h), 400, h >= 10 && h < 16 ? 800 : 0, 50, 60, 60]));
  assert.equal(hoy.estado, "disponible");
  assert.ok(hoy.totalKwh > 4 && hoy.totalKwh < 6);
});

test("R3: solo cuentan las horas con cobertura solar suficiente", async () => {
  const hoy = await hoyCon(horasPasadas((d, h) => [hora(d, h), 400, h >= 10 && h < 16 ? 800 : 0, 50, 60, h >= 10 && h < 16 ? 30 : 60]));
  assert.equal(hoy.estado, "sin_calibracion");
});
