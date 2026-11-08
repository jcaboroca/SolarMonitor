import { test } from "node:test";
import assert from "node:assert/strict";
import { archivar, RESUMEN, AYER_INTEGRADO, MARCA_VERSION, claveMes } from "../worker/src/archivo.js";
import { avanzarInforme } from "../worker/src/informe-flujo.js";
import { leerTrabajo } from "../worker/src/informe-estado.js";
import { refrescarAnterior } from "../worker/src/informe.js";
import { construirInforme, integrarDia, resumirDia } from "../worker/src/informe-calculo.js";
import { limitesDia, sumarDias } from "../worker/src/horario.js";

const AHORA = Date.UTC(2026, 10, 8, 8);
const AYER = "2026-11-07";
const ANTIGUO = "2026-11-06";
const CONFIG = { activo: true, consentimiento: true, pushActivo: false, ubicacion: null, tarifa: null };
const sinRed = async () => assert.fail("no debe descargar");
function curva(fecha) {
  const { inicio, fin } = limitesDia(fecha);
  return Array.from({ length: (fin - inicio) / 300000 }, (_, i) => [inicio / 1000 + i * 300, 800, 400, 0, 400, 0, 0, 50]);
}
const diario = (fecha) => resumirDia(integrarDia(curva(fecha), fecha));
function kvFalso(inicial = {}) {
  const datos = new Map(Object.entries(inicial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    datos, lecturas: [],
    async get(k, tipo) {
      this.lecturas.push(k);
      const v = datos.get(k);
      return v === undefined ? null : tipo === "json" ? JSON.parse(v) : v;
    },
    async put(k, v) { datos.set(k, v); },
    async delete(k) { datos.delete(k); },
    leer: (k) => JSON.parse(datos.get(k) ?? "null"),
  };
}
const sesion = { "solarman-sesion": { access: "sintetico", caduca: AHORA + 86400000 } };
const entorno = (kv) => ({ HISTORICO: kv, SOLARMAN_PLANTA: "sintetica" });
const copiarKV = (kv) => kvFalso(Object.fromEntries([...kv.datos].map(([k, v]) => [k, JSON.parse(v)])));

// Suspender justo al entrar al trabajo y conservar solo KV simula la terminacion del runtime:
// ni catch ni finally llegan a ejecutarse y la siguiente invocacion no comparte memoria.
async function interrumpir(kv, clave, ejecutar) {
  let entrar;
  const llegado = new Promise((resolve) => { entrar = resolve; });
  const get = kv.get.bind(kv);
  kv.get = async (k, tipo) => {
    if (k === clave) {
      entrar();
      return new Promise(() => {});
    }
    return get(k, tipo);
  };
  void ejecutar();
  await llegado;
  return copiarKV(kv);
}

test("maximo uno da turno a ayer completo, cada reciente incompleto y al atrasado", async () => {
  const dias = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [sumarDias(AYER, -i), 288]));
  const kv = kvFalso({ ...sesion, [RESUMEN]: {
    dias, diarios: { [AYER]: diario(AYER), ...Object.fromEntries(Object.keys(dias).slice(1).map((d) => [d, { cob: {} }])) },
    horas: [], fuente: { dia: AYER, h: "inicial" },
  } });
  const pedidas = [];
  for (let i = 0; i < 36; i++) {
    let descargas = 0;
    await archivar(entorno(kv), { ahora: AHORA, maximo: 1, maxMigracion: 0, pedir: async (url) => {
      descargas++;
      const u = new URL(url);
      const fecha = `${u.searchParams.get("year")}-${u.searchParams.get("month").padStart(2, "0")}-${u.searchParams.get("day").padStart(2, "0")}`;
      pedidas.push(fecha);
      return { ok: true, json: async () => ({ records: curva(fecha).map(([dateTime, generationPower, usePower, buyPower, gridPower, chargePower, dischargePower, batterySoc]) =>
        ({ dateTime, generationPower, usePower, buyPower, gridPower, chargePower, dischargePower, batterySoc })) }) };
    } });
    assert.ok(descargas <= 1);
  }
  for (const fecha of [...Object.keys(dias), "2026-05-01", "2026-05-02"]) assert.ok(pedidas.includes(fecha), `sin turno: ${fecha}`);
  assert.deepEqual(pedidas.slice(0, 3), [AYER, ANTIGUO, "2026-05-01"]);
  assert.ok(pedidas.filter((d) => d === AYER).length > 1, "ayer completo sigue aceptando correcciones");
});

for (const maxMigracion of [0, 1]) {
  test(`inicializar ayer heredado consume el cupo de migracion ${maxMigracion}`, async () => {
    const kv = kvFalso({ ...sesion,
      [RESUMEN]: { dias: { [AYER]: 288, [ANTIGUO]: 288 }, diarios: { [AYER]: diario(AYER) }, horas: [] },
      [claveMes("2026-11")]: { dias: { "07": curva(AYER), "06": curva(ANTIGUO) } },
    });
    await archivar(entorno(kv), { ahora: AHORA, maximo: 0, maxMigracion, pedir: sinRed });
    const inicializados = Number(!!kv.leer(AYER_INTEGRADO)) + Number(!!kv.leer(RESUMEN).diarios[ANTIGUO]);
    assert.equal(inicializados, maxMigracion);
    if (!maxMigracion) assert.equal(kv.lecturas.includes(claveMes("2026-11")), false);
    else {
      await archivar(entorno(kv), { ahora: AHORA, maximo: 0, maxMigracion, pedir: sinRed });
      assert.ok(kv.leer(AYER_INTEGRADO));
      assert.ok(kv.leer(RESUMEN).diarios[ANTIGUO]);
    }
  });
}

for (const fase of ["fuente", "informe"]) {
  test(`tres interrupciones en ${fase} consumen intentos antes del trabajo`, async () => {
    let kv = kvFalso({
      "informe-config": CONFIG,
      [RESUMEN]: { dias: {}, diarios: {}, horas: [] },
      ...(fase === "informe" ? {
        "informe-preparado-prevision": { trabajo: "interrupcion", valor: {} },
        "informe-preparado-calibracion": { trabajo: "interrupcion", valor: {} },
        "informe-trabajo": {
        id: "interrupcion", fecha: AYER, config: JSON.stringify(CONFIG), manual: false,
        fase, intentosFase: 0, actualizado: new Date(AHORA - 60000).toISOString(),
      } } : {}),
    });
    const frontera = fase === "fuente" ? RESUMEN : "informe-preparado-fuente";
    for (let i = 0; i < 3; i++) {
      kv = await interrumpir(kv, frontera, () => avanzarInforme(entorno(kv), { ahora: AHORA + i * 180000, pedir: sinRed }));
      assert.equal((await leerTrabajo(kv))?.intentosFase, i + 1);
    }
    assert.equal((await avanzarInforme(entorno(kv), { ahora: AHORA + 600000, pedir: sinRed })).resultado, "agotado");
    assert.equal(kv.lecturas.includes(frontera), false);
    assert.equal(kv.leer(`informe-${AYER}`), null);
  });
}

function historico() {
  const informe = construirInforme({ integrado: integrarDia(curva(ANTIGUO).slice(0, 200), ANTIGUO), fecha: ANTIGUO,
    ahora: AHORA - 86400000, config: CONFIG, diarios: {}, pendientesMigracion: 1 });
  informe.hoy = { fecha: AYER, estado: "sin_calibracion", texto: "Recomendacion original", recomendaciones: [] };
  const entrada = { fecha: ANTIGUO, estado: informe.estado, generado: informe.generado, intentos: 1,
    huella: informe.huella, push: { estado: "enviado", pendientes: 0, enviados: 1 } };
  return kvFalso({
    "informe-config": CONFIG, "informe-indice": { informes: [entrada] }, [`informe-${ANTIGUO}`]: informe,
    [MARCA_VERSION]: { dia: AYER, m: 0 }, [RESUMEN]: { dias: { [ANTIGUO]: 288 }, diarios: { [ANTIGUO]: diario(ANTIGUO) }, horas: [] },
    [claveMes("2026-11")]: { dias: { "06": curva(ANTIGUO) } },
  });
}
const refrescar = (kv, ahora) => refrescarAnterior(kv, kv.leer("informe-indice"), { fecha: AYER, ahora });

test("refresco historico separa fuente y composicion entre llamadas conservando informe y entrega originales", async () => {
  const kv = historico();
  const original = kv.leer(`informe-${ANTIGUO}`);
  const entrada = kv.leer("informe-indice").informes[0];
  const fuente = await refrescar(kv, AHORA);
  assert.equal(fuente.fase, "refresco_fuente");
  assert.deepEqual(kv.leer(`informe-${ANTIGUO}`), original);
  assert.ok(kv.lecturas.includes(claveMes("2026-11")));
  kv.lecturas.length = 0;
  assert.equal((await refrescar(kv, AHORA + 60000)).resultado, "refrescado");
  assert.equal(kv.lecturas.includes(claveMes("2026-11")), false);
  assert.equal(kv.lecturas.includes(RESUMEN), false);
  const nuevo = kv.leer(`informe-${ANTIGUO}`);
  assert.equal(original.estado, "parcial");
  assert.equal(nuevo.estado, "ok");
  assert.equal(nuevo.cobertura.solar, 1);
  assert.ok(nuevo.energia.solar.kwh > original.energia.solar.kwh);
  assert.equal(kv.leer("informe-indice").informes[0].estado, "ok");
  assert.equal(nuevo.generado, original.generado);
  assert.equal(nuevo.actualizado, new Date(AHORA + 60000).toISOString());
  assert.equal(nuevo.hoy.texto, original.hoy.texto);
  assert.equal(nuevo.huella.p, 0);
  assert.deepEqual(kv.leer("informe-indice").informes[0].push, entrada.push);
  assert.equal(await refrescar(kv, AHORA + 120000), null);
});

for (const fase of ["fuente", "informe"]) {
  test(`el refresco historico interrumpido en ${fase} no reinicia intentos indefinidamente`, async () => {
    let kv = historico();
    if (fase === "informe") await refrescar(kv, AHORA - 60000);
    const frontera = fase === "fuente" ? claveMes("2026-11") : `informe-refresco-fuente-${ANTIGUO}`;
    for (let i = 0; i < 3; i++) {
      kv = await interrumpir(kv, frontera, () => refrescar(kv, AHORA + i * 180000));
      assert.equal(kv.leer(`informe-refresco-intento-${ANTIGUO}-${fase}`).intentos, i + 1);
    }
    assert.equal((await refrescar(kv, AHORA + 600000))?.resultado, "agotado");
    assert.equal(kv.lecturas.includes(frontera), false);
    assert.equal(kv.leer(`informe-${ANTIGUO}`).actualizado, undefined);
  });
}

test("ayer sin curva no impide migrar otros dias dentro del cupo uno", async () => {
  const kv = kvFalso({ ...sesion,
    [RESUMEN]: { dias: { [AYER]: 288, [ANTIGUO]: 288 }, diarios: { [AYER]: diario(AYER) }, horas: [] },
    [claveMes("2026-11")]: { dias: { "06": curva(ANTIGUO) } },
  });
  await archivar(entorno(kv), { ahora: AHORA, maximo: 0, maxMigracion: 1, pedir: sinRed });
  assert.ok(kv.leer(RESUMEN).diarios[ANTIGUO]);
  assert.equal(kv.leer(AYER_INTEGRADO), null);
});

for (const historica of [false, true]) {
  test(`reservar intentos ${historica ? "historicos" : "diarios"} no escribe dos veces la misma clave en la fase`, async () => {
    const kv = historica ? historico() : kvFalso({ "informe-config": CONFIG, [RESUMEN]: { dias: {}, diarios: {}, horas: [] } });
    const claves = [];
    const put = kv.put.bind(kv);
    kv.put = async (k, v, opciones) => {
      claves.push(k);
      return put(k, v, opciones);
    };
    if (historica) await refrescar(kv, AHORA);
    else await avanzarInforme(entorno(kv), { ahora: AHORA, pedir: sinRed });
    assert.equal(new Set(claves).size, claves.length, "KV limita las escrituras por clave; la reserva no comparte clave con el resultado");
  });
}
