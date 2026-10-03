// Prevision solar: radiacion de Open-Meteo calibrada contra la produccion real.
// Open-Meteo no pide clave. Su radiacion horaria es la MEDIA DE LA HORA ANTERIOR.

import { percentil } from "./habitos.js";

const HORA_MS = 3600000;
const redondear = (x) => Math.round(x * 100) / 100;

export const urlPrevision = ({ lat, lon, dias = 2 }) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${redondear(lat)}&longitude=${redondear(lon)}` +
  `&hourly=shortwave_radiation,cloud_cover&forecast_days=${dias}&timeformat=unixtime`;

// La prevision historica sale del mismo modelo que la de hoy: calibra mejor que el reanalisis.
export const urlPrevisionPasada = ({ lat, lon, desde, hasta }) =>
  `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${redondear(lat)}&longitude=${redondear(lon)}` +
  `&hourly=shortwave_radiation&start_date=${desde}&end_date=${hasta}&timeformat=unixtime`;

export function leerOpenMeteo(json) {
  const { time = [], shortwave_radiation: radiacion = [], cloud_cover: nubes = [] } = json?.hourly || {};
  return time
    .map((t, i) => ({ inicio: new Date(t * 1000 - HORA_MS), irradiancia: radiacion[i], nubes: nubes[i] ?? null }))
    .filter((h) => typeof h.irradiancia === "number");
}

// kWh por (W/m2 · h) de una regresion por el origen.
const pendiente = (pares) => {
  const arriba = pares.reduce((suma, [x, y]) => suma + x * y, 0);
  const abajo = pares.reduce((suma, [x]) => suma + x * x, 0);
  return abajo > 0 ? arriba / abajo : null;
};

export function calibrar(reales, irradiancia, { minimoIrradiancia = 50, minimoMuestras = 5 } = {}) {
  const porHora = new Map(irradiancia.map((h) => [h.inicio.getTime(), h.irradiancia]));
  const pares = reales
    .filter((h) => (h.cobertura ?? 1) >= 0.75)
    .map((h) => ({ hora: h.inicio.getHours(), dia: h.inicio.toDateString(), x: porHora.get(h.inicio.getTime()), y: h.solarKwh }))
    .filter((p) => typeof p.x === "number" && p.x > minimoIrradiancia);

  const dias = new Set(pares.map((p) => p.dia)).size;
  const kGlobal = pendiente(pares.map((p) => [p.x, p.y]));
  const kPorHora = Array.from({ length: 24 }, (_, hora) => {
    const deLaHora = pares.filter((p) => p.hora === hora);
    return deLaHora.length >= minimoMuestras ? pendiente(deLaHora.map((p) => [p.x, p.y])) : null;
  });
  const maxKwh = pares.length ? percentil(pares.map((p) => p.y), 0.99) * 1.05 : null;
  const confianza = kGlobal === null ? "ninguna" : dias >= 14 ? "alta" : dias >= 5 ? "media" : "baja";
  return { kGlobal, kPorHora, maxKwh, dias, confianza };
}

const BAJAR = { alta: "media", media: "baja", baja: "baja" };

/** Devuelve [{inicio, kwh, origen, confianza}] o [] si no hay forma honesta de estimar. */
export function preverSolar(irradiancia, calibracion, { kWp = null, rendimientoSistema = 0.8, ahora = new Date() } = {}) {
  const calibrada = calibracion.kGlobal !== null;
  if (!calibrada && !kWp) return [];
  return irradiancia.map(({ inicio, irradiancia: irr }) => {
    const k = calibrada ? calibracion.kPorHora[inicio.getHours()] ?? calibracion.kGlobal : (kWp * rendimientoSistema) / 1000;
    let kwh = Math.max(irr, 0) * k;
    if (calibrada && calibracion.maxKwh) kwh = Math.min(kwh, calibracion.maxKwh);
    let confianza = calibrada ? calibracion.confianza : "baja";
    if (inicio.getTime() - ahora.getTime() > 24 * HORA_MS) confianza = BAJAR[confianza];
    return { inicio, kwh, origen: calibrada ? "prevision" : "estimado", confianza };
  });
}
