import { test } from "node:test";
import assert from "node:assert/strict";
import * as fases from "../worker/src/informe-hoy.js";

const HORA = 3600000;
const AHORA = Date.UTC(2026, 10, 8, 7, 30);
const FECHA = "2026-11-08";
const UBICACION = { lat: 41.3, lon: 2 };
const TARIFA = { tipo: "periodos", P1: 0.3, P2: 0.2, P3: 0.1, desde: "2026-01-01", fuente: "Contrato sintético" };
const CONFIG = { ubicacion: UBICACION, tarifa: TARIFA };
const INFORME = { energia: { venta: { kwh: 2, minimo: false } } };
const json = (body) => ({ ok: true, status: 200, json: async () => body });
const copia = (x) => JSON.parse(JSON.stringify(x));
const sinRed = async () => assert.fail("esta fase no debe usar la red");

function api(nombre) {
  assert.equal(typeof fases[nombre], "function", `falta exportar ${nombre}`);
  return fases[nombre];
}

function historico({ dias = 8, solar = 800, cobertura = 60 } = {}) {
  const horas = Array.from({ length: dias }, (_, d) => [Date.UTC(2026, 10, 7 - d, 11) / HORA, 400, solar, 50, 60, cobertura]);
  return { horas, meteo: { hourly: { time: horas.map((h) => (h[0] + 1) * 3600), shortwave_radiation: horas.map(() => 400) } } };
}

function pronostico() {
  const inicio = Date.UTC(2026, 10, 7, 23);
  return { hourly: {
    time: Array.from({ length: 24 }, (_, h) => (inicio + (h + 1) * HORA) / 1000),
    shortwave_radiation: Array.from({ length: 24 }, (_, h) => h >= 10 && h < 16 ? 400 : 0),
    cloud_cover: Array(24).fill(20),
  } };
}

async function preparar() {
  const h = historico();
  return {
    prevision: await api("prepararPrevision")({ config: CONFIG, ahora: AHORA, pedir: async () => json(pronostico()) }),
    calibracion: await api("prepararCalibracion")({ config: CONFIG, resumen: h, ahora: AHORA, pedir: async () => json(h.meteo) }),
  };
}

test("prevision: una petición, coordenadas aproximadas y horas serializables del día de Madrid", async () => {
  const urls = [];
  const r = await api("prepararPrevision")({
    config: { ...CONFIG, ubicacion: { lat: 41.298712, lon: 2.000312, direccion: "no enviar" } },
    ahora: AHORA,
    pedir: async (url) => {
      urls.push(new URL(url));
      return json({ hourly: {
        time: [Date.UTC(2026, 10, 7, 23), Date.UTC(2026, 10, 8, 0), Date.UTC(2026, 10, 8, 1), Date.UTC(2026, 10, 8, 2), Date.UTC(2026, 10, 8, 3), Date.UTC(2026, 10, 9, 0)].map((t) => t / 1000),
        shortwave_radiation: [900, 0, null, 400, 600, 900],
        cloud_cover: [90, 99, 99, null, 20, 90],
      } });
    },
  });
  assert.equal(urls.length, 1);
  assert.equal(urls[0].hostname, "api.open-meteo.com");
  assert.equal(urls[0].searchParams.get("latitude"), "41.3");
  assert.equal(urls[0].searchParams.get("longitude"), "2");
  assert.equal(urls[0].searchParams.get("forecast_days"), "2");
  assert.deepEqual([...urls[0].searchParams.keys()].sort(), ["forecast_days", "hourly", "latitude", "longitude", "timeformat"]);
  assert.equal(r.fecha, FECHA);
  assert.deepEqual(r.ubicacion, UBICACION);
  assert.equal(r.estado, "disponible");
  assert.deepEqual(r.horas, [
    { inicio: Date.UTC(2026, 10, 7, 23), irradiancia: 0, nubes: 99 },
    { inicio: Date.UTC(2026, 10, 8, 1), irradiancia: 400, nubes: null },
    { inicio: Date.UTC(2026, 10, 8, 2), irradiancia: 600, nubes: 20 },
  ]);
  assert.equal(r.nubosidadMediaPct, 20);
  assert.deepEqual(copia(r), r);
});

test("sin ubicación: ninguna fase solicita meteorología", async () => {
  const args = { config: { ubicacion: null }, ahora: AHORA, pedir: sinRed };
  for (const nombre of ["prepararPrevision", "prepararCalibracion"]) {
    const r = await api(nombre)(args);
    assert.equal(r.estado, "sin_ubicacion");
    assert.equal(r.ubicacion, null);
    assert.deepEqual(copia(r), r);
  }
});

for (const [nombre, pedir, codigo] of [
  ["HTTP", async () => ({ ok: false, status: 503 }), "http"],
  ["red", async () => { throw new Error("detalle privado que no se persiste"); }, "solicitud_fallida"],
  ["JSON", async () => ({ ok: true, json: async () => { throw new SyntaxError("JSON"); } }), "solicitud_fallida"],
  ["sin horas", async () => json({ hourly: {} }), "sin_horas"],
]) {
  test(`prevision: ${nombre} es un error explícito y no un éxito vacío`, async () => {
    const r = await api("prepararPrevision")({ config: CONFIG, ahora: AHORA, pedir });
    assert.equal(r.estado, "meteo_no_disponible");
    assert.equal(r.error.fase, "prevision");
    assert.equal(r.error.codigo, codigo);
    if (nombre === "HTTP") assert.equal(r.error.httpStatus, 503);
    assert.deepEqual(r.horas, []);
    assert.equal(r.nubosidadMediaPct, null);
    assert.doesNotMatch(JSON.stringify(r), /detalle privado/);
  });
}

test("calibracion: una petición histórica y solo factor global con confianza existente", async () => {
  const h = historico();
  const urls = [];
  const r = await api("prepararCalibracion")({ config: CONFIG, resumen: h, ahora: AHORA, pedir: async (url) => {
    urls.push(new URL(url));
    return json(h.meteo);
  } });
  assert.equal(urls.length, 1);
  assert.equal(urls[0].hostname, "historical-forecast-api.open-meteo.com");
  assert.equal(urls[0].searchParams.get("start_date"), "2026-10-09");
  assert.equal(urls[0].searchParams.get("end_date"), "2026-11-07");
  assert.deepEqual([...urls[0].searchParams.keys()].sort(), ["end_date", "hourly", "latitude", "longitude", "start_date", "timeformat"]);
  assert.equal(r.fecha, FECHA);
  assert.deepEqual(r.ubicacion, UBICACION);
  assert.equal(r.estado, "disponible");
  assert.equal(r.calibracion.kGlobal, 0.002);
  assert.equal(r.calibracion.confianza, "media");
  assert.equal(r.calibracion.dias, 8);
  assert.deepEqual(r.calibracion.kPorHora, Array(24).fill(null));
  assert.deepEqual(copia(r), r);
});

for (const [nombre, transformar] of [
  ["solar ausente", (h) => [...h.slice(0, 5), 0]],
  ["solar legado", (h) => h.slice(0, 5)],
  ["cobertura inferior a 45 minutos", (h) => [...h.slice(0, 5), 44]],
  ["valor solar ausente", (h) => [h[0], h[1], null, ...h.slice(3)]],
  ["horas antiguas", (h) => [h[0] - 60 * 24, ...h.slice(1)]],
  ["horas de hoy o futuras", (h) => [h[0] + 8 * 24, ...h.slice(1)]],
]) {
  test(`calibracion: ${nombre} no causa una petición inútil`, async () => {
    const r = await api("prepararCalibracion")({ config: CONFIG, resumen: { horas: historico().horas.map(transformar) }, ahora: AHORA, pedir: sinRed });
    assert.equal(r.estado, "sin_calibracion");
    assert.equal(r.calibracion, null);
    assert.equal(r.error.codigo, "sin_horas_medidas");
  });
}

test("calibracion: cero medido con 45 minutos sí es una medida válida", async () => {
  const h = historico({ solar: 0, cobertura: 45 });
  let llamadas = 0;
  const r = await api("prepararCalibracion")({ config: CONFIG, resumen: h, ahora: AHORA, pedir: async () => {
    llamadas++;
    return json(h.meteo);
  } });
  assert.equal(llamadas, 1);
  assert.equal(r.estado, "disponible");
  assert.equal(r.calibracion.kGlobal, 0);
  assert.equal(r.calibracion.confianza, "media");
});

test("calibracion: descarta fechas irrelevantes y cobertura insuficiente antes de crear Dates", async () => {
  const h = historico({ dias: 5 });
  const excluidas = [
    [Date.UTC(2026, 9, 8, 21) / HORA, 400, 9000, 50, 60, 60],
    [Date.UTC(2026, 10, 7, 23) / HORA, 400, 9000, 50, 60, 60],
    [Date.UTC(2026, 10, 6, 10) / HORA, 400, 9000, 50, 60, 44],
  ];
  const RealDate = globalThis.Date;
  const prohibidas = new Set(excluidas.map((x) => x[0] * HORA));
  let asignaciones = 0;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...args);
      if (args.length === 1 && prohibidas.has(args[0])) asignaciones++;
    }
  };
  try {
    const r = await api("prepararCalibracion")({ config: CONFIG, resumen: { horas: [...h.horas, ...excluidas] }, ahora: AHORA, pedir: async () => json(h.meteo) });
    assert.equal(r.estado, "disponible");
    assert.equal(r.calibracion.kGlobal, 0.002);
    assert.equal(r.calibracion.dias, 5);
    // Una fecha límite puede coincidir con una hora excluida; no se crean Dates por cada tupla.
    const sinExcluidas = asignaciones;
    asignaciones = 0;
    await api("prepararCalibracion")({ config: CONFIG, resumen: h, ahora: AHORA, pedir: async () => json(h.meteo) });
    assert.equal(sinExcluidas, asignaciones);
  } finally {
    globalThis.Date = RealDate;
  }
});

for (const [dias, estado, confianza] of [[4, "sin_calibracion", null], [5, "disponible", "media"], [14, "disponible", "alta"]]) {
  test(`calibracion: ${dias} días conservan el umbral de confianza`, async () => {
    const h = historico({ dias });
    const r = await api("prepararCalibracion")({ config: CONFIG, resumen: h, ahora: AHORA, pedir: async () => json(h.meteo) });
    assert.equal(r.estado, estado);
    assert.equal(r.calibracion?.confianza ?? null, confianza);
    if (dias === 4) assert.equal(r.error.codigo, "muestras_insuficientes");
  });
}

test("calibracion: fallo histórico se distingue de falta de medidas", async () => {
  const r = await api("prepararCalibracion")({ config: CONFIG, resumen: historico(), ahora: AHORA, pedir: async () => ({ ok: false, status: 429 }) });
  assert.equal(r.estado, "meteo_no_disponible");
  assert.equal(r.calibracion, null);
  assert.deepEqual(r.error, { fase: "calibracion", codigo: "http", httpStatus: 429 });
});

test("calibracion: respuesta histórica vacía no se presenta como insuficiencia de SolarMAN", async () => {
  const r = await api("prepararCalibracion")({ config: CONFIG, resumen: historico(), ahora: AHORA, pedir: async () => json({ hourly: {} }) });
  assert.equal(r.estado, "meteo_no_disponible");
  assert.equal(r.error.codigo, "sin_horas");
});

test("composicion: síncrona, sin red ni mutaciones tras serializar las fases", async () => {
  const preparados = copia(await preparar());
  const antes = copia(preparados);
  const fetchAnterior = globalThis.fetch;
  globalThis.fetch = () => assert.fail("componerHoy no puede solicitar nada");
  let hoy;
  try {
    hoy = api("componerHoy")({ config: CONFIG, informe: INFORME, ...preparados, ahora: AHORA });
  } finally {
    globalThis.fetch = fetchAnterior;
  }
  assert.equal(hoy instanceof Promise, false);
  assert.equal(hoy.estado, "disponible");
  assert.equal(hoy.totalKwh, 4.8);
  assert.equal(hoy.confianza, "media");
  assert.equal(hoy.nubosidadMediaPct, 20);
  assert.deepEqual(hoy.mejorVentana, { desde: "10:00", hasta: "13:00", kwh: 2.4 });
  assert.match(hoy.texto, /unos 4,8 kWh/);
  assert.match(hoy.recomendaciones.join("\n"), /mover los consumos/);
  assert.match(hoy.recomendaciones.join("\n"), /no un ahorro calculado/);
  assert.match(hoy.recomendaciones.join("\n"), /no cambia ningún ajuste/);
  assert.deepEqual(preparados, antes);
});

for (const fase of ["prevision", "calibracion"]) {
  for (const [campo, valor] of [["fecha", "2026-11-07"], ["ubicacion", { lat: 40, lon: 2 }]]) {
    test(`composicion: rechaza ${fase} con ${campo} ajena`, async () => {
      const preparados = await preparar();
      preparados[fase][campo] = valor;
      const hoy = api("componerHoy")({ config: CONFIG, informe: INFORME, ...preparados, ahora: AHORA });
      assert.equal(hoy.estado, fase === "prevision" ? "meteo_no_disponible" : "sin_calibracion");
      assert.equal(hoy.totalKwh, undefined);
      assert.deepEqual(hoy.recomendaciones, []);
      assert.equal(hoy.error.fase, fase);
      assert.equal(hoy.error.codigo, "snapshot_no_vigente");
    });
  }
}

test("composicion: tampoco acepta horas de otro día bajo una fecha válida", async () => {
  const preparados = await preparar();
  preparados.prevision.horas[0].inicio -= 24 * HORA;
  const hoy = api("componerHoy")({ config: CONFIG, ...preparados, ahora: AHORA });
  assert.equal(hoy.estado, "meteo_no_disponible");
  assert.equal(hoy.totalKwh, undefined);
});

test("composicion: fallo meteorológico de calibración no dice que falte producción medida", async () => {
  const preparados = await preparar();
  preparados.calibracion = await api("prepararCalibracion")({ config: CONFIG, resumen: historico(), ahora: AHORA, pedir: async () => ({ ok: false, status: 503 }) });
  const hoy = api("componerHoy")({ config: CONFIG, ...preparados, ahora: AHORA });
  assert.equal(hoy.estado, "sin_calibracion");
  assert.equal(hoy.totalKwh, undefined);
  assert.match(hoy.texto, /meteorol[oó]g/i);
  assert.doesNotMatch(hoy.texto, /suficientes días de producción/);
  assert.equal(hoy.error.codigo, "http");
});

test("composicion: precios actuales y venta completa condicionan la recomendación de mover consumos", async () => {
  const preparados = await preparar();
  for (const [tarifa, venta] of [
    [null, INFORME.energia.venta],
    [{ ...TARIFA, hasta: "2026-11-07" }, INFORME.energia.venta],
    [{ ...TARIFA, desde: "2026-11-09" }, INFORME.energia.venta],
    [{ tipo: "plana", precio: 0.1, desde: "2026-01-01", fuente: "Contrato" }, INFORME.energia.venta],
    [TARIFA, { kwh: 2, minimo: true }],
    [TARIFA, { kwh: 0.49, minimo: false }],
    [TARIFA, undefined],
  ]) {
    const hoy = api("componerHoy")({ config: { ...CONFIG, tarifa }, informe: { energia: { venta } }, ...preparados, ahora: AHORA });
    assert.equal(hoy.estado, "disponible");
    assert.equal(hoy.totalKwh, 4.8);
    assert.doesNotMatch(hoy.recomendaciones.join("\n"), /mover los consumos/);
    assert.doesNotMatch(JSON.stringify(hoy), /"euros"/);
  }
});

test("wrapper: conserva recomendación y evita histórico cuando falla la previsión", async () => {
  const h = historico();
  let llamadas = 0;
  const hoy = await fases.construirHoy({ config: CONFIG, informe: INFORME, resumen: h, ahora: AHORA, pedir: async (url) => {
    llamadas++;
    return json(url.includes("historical-forecast") ? h.meteo : pronostico());
  } });
  assert.equal(llamadas, 2);
  assert.equal(hoy.estado, "disponible");
  assert.equal(hoy.totalKwh, 4.8);
  llamadas = 0;
  const fallido = await fases.construirHoy({ config: CONFIG, informe: INFORME, resumen: h, ahora: AHORA, pedir: async () => {
    llamadas++;
    return { ok: false, status: 503 };
  } });
  assert.equal(llamadas, 1);
  assert.equal(fallido.estado, "meteo_no_disponible");
});
