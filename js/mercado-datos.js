// Componentes orientativos de Octopus Flexi, inferidos de facturas de septiembre de 2026.
// No son una oferta vigente ni el precio final verificado del contrato.
export const INDEXADA_POR_DEFECTO = {
  suplemento: 0.05,
  peajes: { P1: 0.097, P2: 0.029, P3: 0.003 },
};

export const urlMercadoFechas = (desde, hasta) =>
  `https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real?start_date=${desde}T00:00&end_date=${hasta}T23:59&time_trunc=hour`;

/** REE publica cuartos de hora en EUR/MWh; las claves UTC conservan ambas horas del cambio de horario. */
export function leerMercado(json, { completo = false } = {}) {
  const valores = json?.included?.find((s) => s.type === "Precio mercado spot")?.attributes?.values || [];
  const porHora = new Map();
  for (const { datetime, value } of valores) {
    const instante = Date.parse(datetime);
    if (!Number.isFinite(value) || !Number.isFinite(instante)) continue;
    if (completo && !/(Z|[+-]\d{2}:\d{2})$/.test(datetime)) continue;
    const hora = Math.floor(instante / 3600000) * 3600000;
    if (!porHora.has(hora)) porHora.set(hora, { valores: [], cuartos: new Map(), conflicto: false });
    const fila = porHora.get(hora);
    const cuarto = (instante - hora) / 900000;
    if (!Number.isInteger(cuarto) || (fila.cuartos.has(cuarto) && fila.cuartos.get(cuarto) !== value)) fila.conflicto = true;
    fila.cuartos.set(cuarto, value);
    fila.valores.push(value);
  }
  const horas = new Map();
  for (const [hora, fila] of porHora) {
    if (completo && (fila.conflicto || fila.cuartos.size !== 4)) continue;
    const lista = completo ? [...fila.cuartos.values()] : fila.valores;
    horas.set(hora, lista.reduce((a, b) => a + b, 0) / lista.length / 1000);
  }
  return new Map([...horas].sort((a, b) => a[0] - b[0]));
}
