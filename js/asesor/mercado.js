// Precio horario del mercado electrico (REData de Red Electrica: publica y sin clave).
// Para tarifas indexadas: precio = mercado de esa hora + suplemento + peajes y cargos.

import { periodoTarifa } from "../datos.js";

const SERIE = "Precio mercado spot";

// Facturas de Octopus Flexi: "energia y margen" = mercado + ~5 c€/kWh (septiembre de 2026,
// ponderando cada hora por la compra real); peajes + cargos por periodo (2.0TD). Sin impuestos.
export const INDEXADA_POR_DEFECTO = {
  suplemento: 0.05,
  peajes: { P1: 0.097, P2: 0.029, P3: 0.003 },
};

const dia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function urlMercado(ahora = new Date()) {
  const manana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1);
  return `https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real?start_date=${dia(ahora)}T00:00&end_date=${dia(manana)}T23:59&time_trunc=hour`;
}

/** Map(inicio de hora local en ms → €/kWh). El mercado va por cuartos de hora: se promedian. */
export function leerMercado(json) {
  const valores = json?.included?.find((s) => s.type === SERIE)?.attributes?.values || [];
  const porHora = new Map();
  for (const { datetime, value } of valores) {
    if (!Number.isFinite(value)) continue;
    const hora = new Date(datetime);
    hora.setMinutes(0, 0, 0);
    const clave = hora.getTime();
    if (!porHora.has(clave)) porHora.set(clave, []);
    porHora.get(clave).push(value);
  }
  return new Map([...porHora].map(([clave, lista]) => [clave, lista.reduce((a, b) => a + b, 0) / lista.length / 1000]));
}

export function preciosIndexados(mercado, { suplemento, peajes }, festivos = new Set()) {
  return new Map([...mercado].map(([clave, precio]) => [clave, precio + suplemento + peajes[periodoTarifa(new Date(clave), festivos)]]));
}
