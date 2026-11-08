// Recomendacion para hoy: prevision de Open-Meteo calibrada con la produccion real de SolarMAN.
// A Open-Meteo solo viajan coordenadas aproximadas; nunca consumos, costes ni nombres.

import { urlPrevision, urlPrevisionPasada, leerOpenMeteo, calibrar, preverSolar } from "../../js/asesor/prevision.js";
import { diaMadrid, partesMadrid, sumarDias, limitesDia } from "./horario.js";
import { evaluarTarifa } from "./informe-calculo.js";

const HORA_MS = 3600000;
const DIAS_CALIBRACION = 30;
const MIN_KWH_DIA = 2;
const MIN_VENTA_KWH = 0.5;
const SIN_AJUSTES = "Esta recomendación no cambia ningún ajuste de la batería ni del inversor, y no calcula ahorros de aparatos concretos: solo orienta cuándo habrá más sol.";

const dosDigitos = (n) => String(n).padStart(2, "0");
const horaTexto = (ms) => `${dosDigitos(partesMadrid(ms).hora)}:00`;
const kwhTexto = (x) => (Math.round(x * 10) / 10).toString().replace(".", ",");

async function leerJson(pedir, url) {
  const r = await pedir(url, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
  if (!r.ok) throw Object.assign(new Error("Open-Meteo no disponible"), { httpStatus: r.status });
  return r.json();
}

function ubicacionAproximada(config) {
  const u = config?.ubicacion;
  return u && Number.isFinite(u.lat) && Number.isFinite(u.lon)
    ? { lat: Math.round(u.lat * 100) / 100, lon: Math.round(u.lon * 100) / 100 }
    : null;
}

function errorMeteo(fase, error) {
  return Number.isInteger(error?.httpStatus)
    ? { fase, codigo: "http", httpStatus: error.httpStatus }
    : { fase, codigo: "solicitud_fallida" };
}

const horasMeteo = (json) => leerOpenMeteo(json).filter((h) => Number.isFinite(h.inicio.getTime()) && Number.isFinite(h.irradiancia));

/** Snapshot JSON de hoy: horas con inicio en epoch ms, nunca Date; como máximo una petición. */
export async function prepararPrevision({ config, ahora, pedir }) {
  const fecha = diaMadrid(ahora);
  const ubicacion = ubicacionAproximada(config);
  const base = { fecha, ubicacion, horas: [], nubosidadMediaPct: null };
  if (!ubicacion) return { ...base, estado: "sin_ubicacion" };
  let horas;
  try {
    horas = horasMeteo(await leerJson(pedir, urlPrevision({ ...ubicacion, dias: 2 })))
      .filter((h) => diaMadrid(h.inicio.getTime()) === fecha)
      .map((h) => ({ inicio: h.inicio.getTime(), irradiancia: h.irradiancia, nubes: Number.isFinite(h.nubes) ? h.nubes : null }));
  } catch (error) {
    return { ...base, estado: "meteo_no_disponible", error: errorMeteo("prevision", error) };
  }
  if (!horas.length) return { ...base, estado: "meteo_no_disponible", error: { fase: "prevision", codigo: "sin_horas" } };
  const conSol = horas.filter((h) => h.irradiancia > 0 && h.nubes !== null);
  const nubosidadMediaPct = conSol.length ? Math.round(conSol.reduce((s, h) => s + h.nubes, 0) / conSol.length) : null;
  return { ...base, estado: "disponible", horas, nubosidadMediaPct };
}

/** Snapshot JSON global; sin medidas recientes suficientes por hora no se consulta el histórico. */
export async function prepararCalibracion({ config, resumen, ahora, pedir }) {
  const fecha = diaMadrid(ahora);
  const ubicacion = ubicacionAproximada(config);
  const base = { fecha, ubicacion, calibracion: null };
  if (!ubicacion) return { ...base, estado: "sin_ubicacion" };
  const desde = sumarDias(fecha, -DIAS_CALIBRACION);
  const inicio = limitesDia(desde).inicio / HORA_MS;
  const fin = limitesDia(fecha).inicio / HORA_MS;
  // Filtrar tuplas numéricas antes de crear Dates: el archivo puede abarcar años.
  const medidas = (resumen?.horas || []).filter((h) =>
    Number.isFinite(h?.[0]) && h[0] >= inicio && h[0] < fin &&
    Number.isFinite(h[5]) && h[5] >= 45 &&
    Number.isFinite(h[2]) && h[2] >= 0);
  if (!medidas.length) return { ...base, estado: "sin_calibracion", error: { fase: "calibracion", codigo: "sin_horas_medidas" } };
  let pasado;
  try {
    pasado = horasMeteo(await leerJson(pedir, urlPrevisionPasada({ ...ubicacion, desde, hasta: sumarDias(fecha, -1) })));
  } catch (error) {
    return { ...base, estado: "meteo_no_disponible", error: errorMeteo("calibracion", error) };
  }
  if (!pasado.length) return { ...base, estado: "meteo_no_disponible", error: { fase: "calibracion", codigo: "sin_horas" } };
  const reales = medidas.map((h) => ({ inicio: new Date(h[0] * HORA_MS), solarKwh: h[2] / 1000, cobertura: h[5] / 60 }));
  // Solo el factor global, sin ajustar por la hora local del proceso.
  const calibracion = calibrar(reales, pasado, { minimoMuestras: Infinity });
  if (!Number.isFinite(calibracion.kGlobal) || !["media", "alta"].includes(calibracion.confianza)) {
    return { ...base, estado: "sin_calibracion", error: { fase: "calibracion", codigo: "muestras_insuficientes" } };
  }
  return { ...base, estado: "disponible", calibracion };
}

function errorSnapshot(snapshot, fase, fecha, ubicacion) {
  if (!snapshot) return { fase, codigo: "snapshot_ausente" };
  if (snapshot.fecha !== fecha || snapshot.ubicacion?.lat !== ubicacion.lat || snapshot.ubicacion?.lon !== ubicacion.lon) {
    return { fase, codigo: "snapshot_no_vigente" };
  }
  return null;
}

function mejorVentana(horas, ancho = 3) {
  let mejor = null;
  for (let i = 0; i + ancho <= horas.length; i++) {
    const kwh = horas.slice(i, i + ancho).reduce((s, h) => s + h.kwh, 0);
    if (!mejor || kwh > mejor.kwh + 1e-9) mejor = { i, kwh };
  }
  if (!mejor || mejor.kwh <= 0) return null;
  const inicio = horas[mejor.i].inicio.getTime();
  return { desde: horaTexto(inicio), hasta: horaTexto(inicio + ancho * HORA_MS), kwh: Math.round(mejor.kwh * 10) / 10 };
}

/** Composición pura: solo usa snapshots del día y ubicación actuales, sin red ni almacenamiento. */
export function componerHoy({ config, informe, prevision, calibracion: preparada, ahora }) {
  const hoy = diaMadrid(ahora);
  const base = { fecha: hoy, fuente: "Open-Meteo (previsión) y SolarMAN (calibración)" };
  const u = ubicacionAproximada(config);
  if (!u) return { ...base, estado: "sin_ubicacion", texto: "No hay ubicación aproximada configurada, así que no se puede preparar la previsión de hoy.", recomendaciones: [] };

  let errorPrevision = errorSnapshot(prevision, "prevision", hoy, u);
  if (!errorPrevision && prevision.estado !== "disponible") errorPrevision = prevision.error || { fase: "prevision", codigo: "snapshot_no_disponible" };
  if (!errorPrevision && (!Array.isArray(prevision.horas) || !prevision.horas.length || prevision.horas.some((h) =>
    !Number.isFinite(h?.inicio) || !Number.isFinite(h.irradiancia) || diaMadrid(h.inicio) !== hoy))) {
    errorPrevision = { fase: "prevision", codigo: "snapshot_invalido" };
  }
  if (errorPrevision) {
    return { ...base, estado: "meteo_no_disponible", error: errorPrevision, texto: "No se ha podido obtener la previsión meteorológica de hoy. El informe de ayer sigue siendo válido; la recomendación de hoy no está disponible.", recomendaciones: [] };
  }
  const nubosidad = prevision.nubosidadMediaPct;
  let errorCalibracion = errorSnapshot(preparada, "calibracion", hoy, u);
  if (!errorCalibracion && preparada.estado !== "disponible") errorCalibracion = preparada.error || { fase: "calibracion", codigo: "snapshot_no_disponible" };
  const calibracion = preparada?.calibracion;
  if (!errorCalibracion && (!Number.isFinite(calibracion?.kGlobal) || calibracion.kGlobal < 0 ||
    !["media", "alta"].includes(calibracion.confianza) || !Array.isArray(calibracion.kPorHora) ||
    calibracion.kPorHora.length !== 24 || calibracion.kPorHora.some((k) => k !== null))) {
    errorCalibracion = { fase: "calibracion", codigo: "snapshot_invalido" };
  }
  if (errorCalibracion) {
    const insuficiente = ["sin_horas_medidas", "muestras_insuficientes"].includes(errorCalibracion.codigo);
    const motivo = insuficiente
      ? "Aún no hay suficientes días de producción de SolarMAN para calibrar una previsión en kWh"
      : "No se dispone de una calibración meteorológica válida para la ubicación y el día de hoy; no se puede preparar una previsión en kWh";
    return { ...base, estado: "sin_calibracion", error: errorCalibracion, nubosidadMediaPct: nubosidad, texto: `${motivo}${nubosidad !== null ? `; la nubosidad media prevista en las horas de sol es del ${nubosidad} %` : ""}.`, recomendaciones: [] };
  }

  const horas = preverSolar(prevision.horas.map((h) => ({ ...h, inicio: new Date(h.inicio) })), calibracion, { ahora: new Date(ahora) });
  const total = Math.round(horas.reduce((s, h) => s + h.kwh, 0) * 10) / 10;
  const ventana = mejorVentana(horas);
  const recomendaciones = [`Producción solar prevista para hoy: unos ${kwhTexto(total)} kWh (confianza ${calibracion.confianza}), a partir de la previsión de Open-Meteo y de tu producción real en SolarMAN.`];
  if (ventana && total >= MIN_KWH_DIA) recomendaciones.push(`Las horas con más sol previstas son de ${ventana.desde} a ${ventana.hasta}.`);
  else recomendaciones.push("Se prevé poco sol hoy: no cuentes con la producción solar para cubrir consumos flexibles.");

  const tarifa = evaluarTarifa(config.tarifa, hoy);
  const precios = tarifa.valida && tarifa.precios && !tarifa.estimado ? tarifa.precios : null;
  const diferentes = precios && new Set([precios.P1, precios.P2, precios.P3]).size > 1;
  const venta = informe?.energia?.venta;
  const hayExcedente = venta && !venta.minimo && venta.kwh >= MIN_VENTA_KWH;
  if (diferentes && hayExcedente && ventana && total >= MIN_KWH_DIA) {
    recomendaciones.push(`Ayer vertiste ${kwhTexto(venta.kwh)} kWh a la red. Si puedes elegir cuándo, puedes mover los consumos flexibles que ya tenías previstos a la franja de ${ventana.desde} a ${ventana.hasta}: así el sol cubre parte de la casa en lugar de comprar en periodos más caros. Es una orientación, no un ahorro calculado.`);
  }
  recomendaciones.push(SIN_AJUSTES);
  return { ...base, estado: "disponible", totalKwh: total, confianza: calibracion.confianza, nubosidadMediaPct: nubosidad, mejorVentana: ventana, texto: recomendaciones[0], recomendaciones };
}

// Compatibilidad para los llamadores anteriores; el programador ejecuta las fases por separado.
export async function construirHoy({ config, informe, resumen, ahora, pedir }) {
  const prevision = await prepararPrevision({ config, ahora, pedir });
  const calibracion = prevision.estado === "disponible" ? await prepararCalibracion({ config, resumen, ahora, pedir }) : null;
  return componerHoy({ config, informe, prevision, calibracion, ahora });
}
