// Precio horario del mercado electrico (REData de Red Electrica: publica y sin clave).
// Para tarifas indexadas: precio = mercado de esa hora + suplemento + peajes y cargos.

import { periodoTarifa } from "../datos.js";
import { urlMercadoFechas } from "../mercado-datos.js";
export { leerMercado, INDEXADA_POR_DEFECTO } from "../mercado-datos.js";

const dia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function urlMercado(ahora = new Date()) {
  const manana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1);
  return urlMercadoFechas(dia(ahora), dia(manana));
}

export function preciosIndexados(mercado, { suplemento, peajes }, festivos = new Set()) {
  return new Map([...mercado].map(([clave, precio]) => [clave, precio + suplemento + peajes[periodoTarifa(new Date(clave), festivos)]]));
}
