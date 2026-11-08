// Recomendacion para hoy: prevision de Open-Meteo calibrada con la produccion real de SolarMAN.
// A Open-Meteo solo viajan coordenadas aproximadas; nunca consumos, costes ni nombres.

import { urlPrevision, urlPrevisionPasada, leerOpenMeteo, calibrar, preverSolar } from "../../js/asesor/prevision.js";
import { diaMadrid, partesMadrid, sumarDias } from "./horario.js";
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
  if (!r.ok) throw new Error(`Open-Meteo respondio ${r.status}`);
  return r.json();
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

export async function construirHoy({ config, informe, resumen, ahora, pedir }) {
  const hoy = diaMadrid(ahora);
  const base = { fecha: hoy, fuente: "Open-Meteo (previsión) y SolarMAN (calibración)" };
  const u = config.ubicacion;
  if (!u) return { ...base, estado: "sin_ubicacion", texto: "No hay ubicación aproximada configurada, así que no se puede preparar la previsión de hoy.", recomendaciones: [] };

  let prevision;
  try {
    prevision = leerOpenMeteo(await leerJson(pedir, urlPrevision({ lat: u.lat, lon: u.lon, dias: 2 }))).filter((h) => diaMadrid(h.inicio.getTime()) === hoy);
    if (!prevision.length) throw new Error("sin horas");
  } catch {
    return { ...base, estado: "meteo_no_disponible", texto: "No se ha podido obtener la previsión meteorológica de hoy. El informe de ayer sigue siendo válido; la recomendación de hoy no está disponible.", recomendaciones: [] };
  }
  const conSol = prevision.filter((h) => h.irradiancia > 0 && typeof h.nubes === "number");
  const nubosidad = conSol.length ? Math.round(conSol.reduce((s, h) => s + h.nubes, 0) / conSol.length) : null;

  let calibracion = null;
  try {
    const pasado = leerOpenMeteo(await leerJson(pedir, urlPrevisionPasada({ lat: u.lat, lon: u.lon, desde: sumarDias(hoy, -DIAS_CALIBRACION), hasta: sumarDias(hoy, -1) })));
    const reales = (resumen?.horas || []).map((h) => ({ inicio: new Date(h[0] * HORA_MS), solarKwh: h[2] / 1000, cobertura: h[4] / 60 }));
    // minimoMuestras enorme: solo el factor global, que no depende de la zona horaria del proceso.
    const c = calibrar(reales, pasado, { minimoMuestras: Infinity });
    if (c.kGlobal !== null && (c.confianza === "media" || c.confianza === "alta")) calibracion = c;
  } catch {
    calibracion = null;
  }
  if (!calibracion) {
    return { ...base, estado: "sin_calibracion", nubosidadMediaPct: nubosidad, texto: `Aún no hay suficientes días de producción de SolarMAN para calibrar una previsión en kWh${nubosidad !== null ? `; la nubosidad media prevista en las horas de sol es del ${nubosidad} %` : ""}.`, recomendaciones: [] };
  }

  const horas = preverSolar(prevision, calibracion, { ahora: new Date(ahora) });
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
