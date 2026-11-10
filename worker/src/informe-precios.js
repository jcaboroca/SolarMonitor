import { leerMercado, urlMercadoFechas } from "../../js/mercado-datos.js";
import { diaMadrid, sumarDias, limitesDia } from "./horario.js";

export async function prepararPrecios({ config, ahora = Date.now(), pedir = fetch }) {
  if (!config?.tarifa?.mercado) return null;
  const hasta = diaMadrid(ahora);
  const desde = sumarDias(hasta, -1);
  const base = { desde, hasta, fuente: "REE: precio mercado spot", consultado: new Date(ahora).toISOString() };
  try {
    const r = await pedir(urlMercadoFechas(desde, hasta), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`REE HTTP ${r.status}`);
    const inicio = limitesDia(desde).inicio;
    const fin = limitesDia(hasta).fin;
    const horas = [...leerMercado(await r.json(), { completo: true })].filter(([t]) => t >= inicio && t < fin);
    if (!horas.length) throw new Error("REE no ha devuelto horas completas para las fechas solicitadas.");
    return { ...base, estado: horas.length === (fin - inicio) / 3600000 ? "disponible" : "parcial", horas };
  } catch (error) {
    console.error("No se pudieron preparar los precios REE.", { desde, hasta });
    return { ...base, estado: "no_disponible", horas: [], error: error instanceof Error ? error.message : "Error al consultar REE." };
  }
}
