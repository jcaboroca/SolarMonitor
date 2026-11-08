process.env.TZ = "UTC";
// Regresiones de la tercera revision: A (huella solo con dependencias efectivas), B (ayer migrado entra en
// las revisitas), C (horas con las mismas reglas que el dia), D (SOC fuera de dominio), E (informes fechados
// pendientes tras migrar y cruzar medianoche) y version de esquema separada de la huella. Solo datos sinteticos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { limitesDia, sumarDias } from "../worker/src/horario.js";
import { integrarDia, resumirDia, construirInforme } from "../worker/src/informe-calculo.js";
import { archivar, aHoras, reconciliar, RESUMEN, claveMes, AYER_INTEGRADO, MARCA_VERSION } from "../worker/src/archivo.js";
import { htmlInforme } from "../js/informe.js";
import { programado } from "../worker/src/informe.js";
import { b64url } from "../worker/src/push.js";

const AHORA = Date.UTC(2026, 10, 8, 7, 30); // 08:30 en Madrid
const AYER = "2026-11-07";
const PLANA = { tipo: "plana", precio: 0.1, desde: "2026-01-01", hasta: null, fuente: "Factura de prueba" };
const CONFIG = { activo: true, pushActivo: false, consentimiento: true, ubicacion: null, tarifa: PLANA };
const HORA = 3600000;

function dia(fecha, { valores = {}, saltar = () => false, paso = 300, desfase = 0 } = {}) {
  const { inicio, fin } = limitesDia(fecha);
  const base = { solar: 0, casa: 1000, compra: 1000, venta: 0, carga: 0, descarga: 0, soc: 50 };
  const puntos = [];
  let n = 0;
  for (let t = inicio / 1000; t < fin / 1000; t += paso, n++) {
    if (saltar(n, t)) continue;
    const x = { ...base, ...valores };
    puntos.push([t + desfase, x.solar, x.casa, x.compra, x.venta, x.carga, x.descarga, x.soc]);
  }
  return puntos;
}

const sesion = { "solarman-sesion": { refresh: "r", access: "a", caduca: Date.UTC(2030, 0, 1) } };
const json = (cuerpo) => ({ ok: true, status: 200, json: async () => cuerpo });
const registros = (puntos) => ({ records: puntos.map((p) => ({ dateTime: p[0], generationPower: p[1], usePower: p[2], buyPower: p[3], gridPower: p[4], chargePower: p[5], dischargePower: p[6], batterySoc: p[7] })) });
const noMeteo = async () => new Response("{}", { status: 500 });
const fechaDe = (url) => {
  const [, a, m, d] = url.match(/year=(\d+)&month=(\d+)&day=(\d+)/);
  return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
};
const dias = (desde, hasta) => {
  const r = [];
  for (let t = Date.UTC(...desde); t <= Date.UTC(...hasta); t += 86400000) r.push(new Date(t).toISOString().slice(0, 10));
  return r;
};

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

const RES = resumirDia(integrarDia(dia(AYER), AYER)); // un dia completo de 1 kW
const entorno = (kv, extra = {}) => ({ HISTORICO: kv, SOLARMAN_PLANTA: "1", ...extra });
const portalDe = (kv, porDia) => async (url) => {
  const f = fechaDe(url);
  return json(f in porDia ? registros(porDia[f]()) : { records: [] });
};

// ---------------------------------------------------------------- A: huella solo con dependencias efectivas

function sembrarA() {
  const marcados = {};
  for (const f of dias([2026, 4, 1], [2026, 10, 6])) marcados[f] = 0;
  const diarios = {};
  const curvaSep = { columnas: [], dias: {} };
  for (const f of dias([2026, 8, 15], [2026, 8, 22])) {
    marcados[f] = 288; // heredados: curva y sin resumen; no son dependencias de un informe de noviembre
    curvaSep.dias[f.slice(8)] = dia(f);
  }
  for (const f of dias([2026, 9, 10], [2026, 10, 6])) {
    marcados[f] = 288;
    diarios[f] = RES;
  }
  return kvFalso({ ...sesion, "informe-config": CONFIG, [RESUMEN]: { dias: marcados, diarios, horas: [] }, [claveMes("2026-09")]: curvaSep });
}

test("A: incorporar historial ajeno al informe no gasta regeneraciones y una correccion real sigue actualizando", async () => {
  const kv = sembrarA();
  let kw = 1000;
  const porDia = { [AYER]: () => dia(AYER, { valores: { casa: kw, compra: kw } }) };
  const ciclo = async (i) => {
    const ahora = AHORA + i * HORA;
    await archivar(entorno(kv), { pedir: portalDe(kv, porDia), ahora, maximo: 2 });
    return programado({ HISTORICO: kv }, { ahora, pedir: noMeteo });
  };
  for (let i = 0; i < 12; i++) await ciclo(i);
  const diarios = kv.leer(RESUMEN).diarios;
  for (const f of dias([2026, 8, 15], [2026, 8, 22])) assert.ok(diarios[f], `${f} migrado`);
  assert.equal(kv.leer("informe-indice").informes[0].intentos, 1, "el backfill irrelevante no regenera");
  assert.equal(kv.leer(`informe-${AYER}`).energia.compra.kwh, 24);

  kw = 2000;
  const r = await ciclo(12);
  assert.equal(r.resultado, "generado");
  assert.equal(kv.leer(`informe-${AYER}`).energia.compra.kwh, 48);
  assert.equal(kv.leer("informe-indice").informes[0].intentos, 2);
});

// ---------------------------------------------------------------- B: ayer migrado entra en las revisitas

test("B: ayer heredado completo se migra sin descargar, queda con instantanea y marca, y el portal puede corregirlo", async () => {
  const marcados = {};
  const diarios = {};
  for (const f of dias([2026, 4, 1], [2026, 9, 9])) marcados[f] = 0;
  for (const f of dias([2026, 9, 10], [2026, 10, 6])) {
    marcados[f] = 288;
    diarios[f] = RES;
  }
  marcados[AYER] = 288;
  const kv = kvFalso({ ...sesion, "informe-config": CONFIG, [RESUMEN]: { dias: marcados, diarios, horas: [] }, [claveMes("2026-11")]: { columnas: [], dias: { "07": dia(AYER) } } });
  const primera = await archivar(entorno(kv), { pedir: async () => assert.fail("migrar no descarga"), ahora: AHORA, maximo: 2 });
  assert.equal(primera.resultado, "migrado");
  assert.equal(kv.leer(RESUMEN).diarios[AYER].compra, 24);
  assert.equal(kv.leer(AYER_INTEGRADO).dia, AYER);
  assert.equal(kv.leer(RESUMEN).fuente.dia, AYER);
  assert.equal(kv.leer(MARCA_VERSION).dia, AYER);
  assert.equal((await programado({ HISTORICO: kv }, { ahora: AHORA, pedir: noMeteo })).resultado, "generado");
  assert.equal(kv.leer(`informe-${AYER}`).energia.compra.kwh, 24);

  let consultas = 0;
  const pedir = async () => (consultas++, json(registros(dia(AYER, { valores: { casa: 2000, compra: 2000 } }))));
  const segunda = await archivar(entorno(kv), { pedir, ahora: AHORA + HORA, maximo: 2 });
  assert.equal(consultas, 1, "ayer se vuelve a pedir");
  assert.equal(segunda.resultado, "archivado");
  assert.equal(kv.leer(RESUMEN).diarios[AYER].compra, 48);
  assert.equal((await programado({ HISTORICO: kv }, { ahora: AHORA + HORA, pedir: noMeteo })).resultado, "generado");
  assert.equal(kv.leer(`informe-${AYER}`).energia.compra.kwh, 48);
});

// ---------------------------------------------------------------- C: horas y dia con las mismas reglas

const sumaHorasKwh = (horas, i) => horas.reduce((s, h) => s + h[i], 0) / 1000;

function horasHeredadas() {
  const { inicio } = limitesDia(AYER);
  return Array.from({ length: 24 }, (_, i) => [
    inicio / HORA + i, i === 23 ? 708 : 750, i === 23 ? 283 : 300, 50,
    i === 23 ? 43 : 45, i === 23 ? 43 : 45,
  ]);
}

for (const migrar of [false, true]) {
  test(`C heredado: ${migrar ? "migrar la curva local" : "redescargar una curva identica"} repara las horas antiguas`, async () => {
    const puntos = dia(AYER, { saltar: (n) => n % 2 === 1, valores: { solar: 400 } });
    const kv = kvFalso({
      ...sesion,
      [RESUMEN]: {
        dias: { [AYER]: 144 }, horas: horasHeredadas(),
        diarios: migrar ? {} : { [AYER]: resumirDia(integrarDia(puntos, AYER)) },
      },
      [claveMes("2026-11")]: { columnas: [], dias: { "07": puntos } },
    });
    const pedir = migrar
      ? async () => assert.fail("la migracion local no necesita descargar")
      : async () => json(registros(puntos));
    await archivar(entorno(kv), { ahora: AHORA, pedir, maximo: migrar ? 0 : 1 });
    const resumen = kv.leer(RESUMEN);
    assert.equal(resumen.diarios[AYER].casa, 12);
    assert.equal(sumaHorasKwh(resumen.horas, 1), 12);
    assert.equal(sumaHorasKwh(resumen.horas, 2), 4.8);
    assert.deepEqual(resumen.horas[0].slice(1), [500, 200, 50, 30, 30]);
    assert.deepEqual(kv.leer(claveMes("2026-11")).dias["07"], puntos);

    kv.escrituras.length = 0;
    await archivar(entorno(kv), {
      ahora: AHORA + HORA, pedir: async () => json(registros(puntos)), maximo: 1,
    });
    assert.equal(sumaHorasKwh(kv.leer(RESUMEN).horas, 1), 12);
    assert.ok(!kv.escrituras.includes(claveMes("2026-11")), "no reescribir la curva si no cambia");
  });
}

test("C: con la mitad de las muestras ausentes las horas no inventan energia ni minutos", async () => {
  const kv = kvFalso({ ...sesion });
  const puntos = dia(AYER, { saltar: (n) => n % 2 === 1, valores: { solar: 400 } });
  await archivar(entorno(kv), { pedir: async () => json(registros(puntos)), ahora: AHORA, maximo: 1 });
  const r = kv.leer(RESUMEN);
  assert.equal(r.diarios[AYER].casa, 12);
  assert.equal(r.diarios[AYER].cob.casa, 0.5);
  const ayer = r.horas.filter((h) => h[0] * HORA >= limitesDia(AYER).inicio);
  assert.ok(Math.abs(sumaHorasKwh(ayer, 1) - 12) < 0.02, String(sumaHorasKwh(ayer, 1)));
  assert.ok(Math.abs(sumaHorasKwh(ayer, 2) - 4.8) < 0.02);
  assert.deepEqual(ayer[0].slice(1, 3), [500, 200]);
  assert.equal(ayer[0][4], 30, "minutos de casa realmente medidos");
  assert.equal(ayer[0][5], 30);
});

test("C: horas y dia coinciden en fronteras de hora, duplicados, huecos y dias de 23 y 25 horas", () => {
  const casos = [
    ["2026-11-07", dia("2026-11-07", { desfase: 150 })],
    ["2026-11-07", [...dia("2026-11-07"), ...dia("2026-11-07")]],
    ["2026-11-07", dia("2026-11-07", { saltar: (n) => n % 3 === 1 })],
    ["2026-11-07", dia("2026-11-07", { saltar: (n) => n >= 100 && n < 110, valores: { solar: 300 } })],
    ["2026-10-25", dia("2026-10-25", { saltar: (n) => n % 2 === 0 })],
    ["2027-03-28", dia("2027-03-28", { saltar: (n) => n % 4 === 3, valores: { solar: 100 } })],
  ];
  for (const [fecha, puntos] of casos) {
    const i = integrarDia(puntos, fecha);
    const h = aHoras(puntos, fecha);
    assert.ok(Math.abs(sumaHorasKwh(h, 1) - i.energia.casa) < 0.013, `${fecha} casa ${sumaHorasKwh(h, 1)} vs ${i.energia.casa}`);
    assert.ok(Math.abs(sumaHorasKwh(h, 2) - (i.energia.solar ?? 0)) < 0.013, `${fecha} solar`);
    const minutos = h.reduce((s, x) => s + x[4], 0);
    assert.ok(Math.abs(minutos - i.cobertura.casa * i.horasEsperadas * 60) < h.length, `${fecha} minutos`);
    assert.equal(h.length <= i.horasEsperadas, true);
  }
});

// ---------------------------------------------------------------- D: SOC fuera de dominio

test("D: reconciliar valida cada senal segun su dominio y conserva la medida valida previa", () => {
  const base = [[1000, 1, 2, 3, 4, 5, 6, 50]];
  const con = (soc) => reconciliar(base, [[1000, null, null, null, null, null, null, soc]])[0][7];
  assert.equal(con(150), 50);
  assert.equal(con(-1), 50);
  assert.equal(con(null), 50);
  assert.equal(con("90"), 50);
  assert.equal(con(Number.NaN), 50);
  assert.equal(con(0), 0, "un cero real corrige");
  assert.equal(con(100), 100);
  assert.equal(reconciliar([], [[1000, 1, 1, 1, 1, 1, 1, 150]])[0][7], null, "sin medida previa un SOC invalido no es medida");
  assert.equal(reconciliar(base, [[1000, -5, "x", null, 7, 8, 9, 50]])[0][1], 1);
  assert.equal(reconciliar(base, [[1000, 0, 0, 0, 0, 0, 0, 50]])[0][2], 0, "cero real en potencia");
});

test("D: una segunda descarga con SOC 150 no destruye el SOC valido ni en el dia ni en las horas", async () => {
  const kv = kvFalso({ ...sesion });
  await archivar(entorno(kv), { pedir: async () => json(registros(dia(AYER, { valores: { soc: 50 } }))), ahora: AHORA, maximo: 1 });
  await archivar(entorno(kv), { pedir: async () => json(registros(dia(AYER, { valores: { soc: 150, casa: 1000 } }))), ahora: AHORA + HORA, maximo: 1 });
  const soc = kv.leer(AYER_INTEGRADO).integrado.soc;
  assert.deepEqual([soc.min, soc.max], [50, 50]);
  assert.equal(kv.leer(claveMes("2026-11")).dias["07"][10][7], 50);
  const horas = kv.leer(RESUMEN).horas.filter((h) => h[0] * HORA >= limitesDia(AYER).inicio);
  assert.ok(horas.every((h) => h[3] === 50));
});

// ---------------------------------------------------------------- E: informes fechados tras migrar y cruzar medianoche

test("E: al terminar la migracion tras medianoche el informe fechado anterior se refresca una vez, sin reenviar avisos", async () => {
  const marcados = {};
  const curvas = new Map();
  for (const f of dias([2026, 4, 1], [2026, 10, 20])) marcados[f] = 0;
  for (const f of dias([2026, 8, 20], [2026, 10, 20])) {
    marcados[f] = 288;
    const mes = f.slice(0, 7);
    if (!curvas.has(mes)) curvas.set(mes, { columnas: [], dias: {} });
    curvas.get(mes).dias[f.slice(8)] = dia(f);
  }
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const vapid = { VAPID_PUBLIC_KEY: b64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")])), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: "mailto:op@ejemplo.test" };
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const sub = { id: "d1", endpoint: "https://web.push.apple.com/x", keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(randomBytes(16)) }, creada: "2026-11-01T00:00:00.000Z", entrega: {} };
  const inicial = { ...sesion, "informe-config": { ...CONFIG, pushActivo: true }, "informe-subs": { dispositivos: [sub] }, [RESUMEN]: { dias: marcados, diarios: {}, horas: [] } };
  for (const [mes, c] of curvas) inicial[claveMes(mes)] = c;
  const kv = kvFalso(inicial);
  let envios = 0;
  const pedirPush = async (url) => (url.includes("push.apple.com") ? (envios++, new Response(null, { status: 201 })) : noMeteo());
  const porDia = { "2026-11-20": () => dia("2026-11-20"), "2026-11-21": () => dia("2026-11-21"), "2026-11-22": () => dia("2026-11-22") };

  const inicio = Date.UTC(2026, 10, 21, 7, 2); // 08:02 en Madrid
  let primero = null;
  let pushAntes = null;
  for (let h = 0; h <= 40; h++) {
    const ahora = inicio + h * HORA;
    await archivar(entorno(kv, vapid), { pedir: portalDe(kv, porDia), ahora, maximo: 2 });
    await programado({ HISTORICO: kv, ...vapid }, { ahora, pedir: pedirPush });
    const i20 = kv.leer("informe-2026-11-20");
    if (i20 && !primero) {
      primero = JSON.parse(JSON.stringify(i20));
      pushAntes = JSON.parse(JSON.stringify(kv.leer("informe-indice").informes.find((e) => e.fecha === "2026-11-20").push));
    }
  }
  assert.ok(primero.mes.pendientesMigracion > 0, "el primer informe se genero con migracion en curso");
  const viejo = kv.leer("informe-2026-11-20");
  assert.equal(viejo.mes.pendientesMigracion, 0);
  assert.equal(viejo.mes.diasCompletos, 20);
  assert.equal(viejo.mes.actual.compra, 480);
  assert.equal(viejo.fecha, "2026-11-20");
  assert.equal(viejo.hoy.fecha, primero.hoy.fecha, "la recomendacion de hoy no se recalcula retrospectivamente");
  assert.match(viejo.hoy.nota, /no se ha recalculado|original/i);
  const vista = htmlInforme(viejo);
  assert.match(vista, /actualizado el/);
  assert.match(vista, /no se ha recalculado/);
  const nuevo = kv.leer("informe-2026-11-21");
  assert.equal(nuevo.mes.diasCompletos, 21);
  assert.equal(nuevo.mes.pendientesMigracion, 0);
  const indice = kv.leer("informe-indice").informes;
  assert.deepEqual(indice.find((e) => e.fecha === "2026-11-20").push, pushAntes, "estado de entrega conservado");
  assert.equal(envios, 2, "un aviso por fecha, ninguno por el refresco");
  assert.ok(indice.find((e) => e.fecha === "2026-11-20").intentos <= 3);
});

// ---------------------------------------------------------------- version de esquema y huella separadas

test("la version de esquema y la huella de la fuente son campos distintos", () => {
  const i = construirInforme({ puntos: dia(AYER), fecha: AYER, ahora: AHORA, config: { tarifa: PLANA } });
  assert.equal(i.version, 1);
  assert.ok(i.huella.f && i.huella.a);
  const fuente = readFileSync(new URL("../worker/src/informe-calculo.js", import.meta.url), "utf8");
  const linea = fuente.split("\n").find((l) => l.includes("const base = {"));
  assert.equal((linea.match(/\bversion:/g) || []).length, 1, "sin claves version duplicadas");
});
