// Piezas de presentación de ¿Cuadra? y Mes a mes (§3.4, §5.3, §5.4): la Lectura y la regla de desvío.
// Solo dan forma: las cifras llegan ya calculadas y formateadas desde app.js.

const TOPE = 10;
const TOLERANCIA = 5;

/** Posición de la aguja en una regla centrada en 0 que va de −10 % a +10 % (en % del ancho, −50…50). */
export function reglaDesvio(relativo) {
  if (relativo == null || !Number.isFinite(relativo)) return null;
  const acotado = Math.max(-TOPE, Math.min(TOPE, relativo));
  return {
    posicion: Math.round((acotado / TOPE) * 5000) / 100,
    fuera: Math.abs(relativo) > TOPE ? Math.sign(relativo) : 0,
    tono: Math.abs(relativo) <= TOLERANCIA ? "bien" : "mal",
  };
}

/** La regla como marcado, sin texto: la cifra ya está escrita en la columna Diferencia. */
export function htmlRegla(relativo) {
  const r = reglaDesvio(relativo);
  if (!r) return "";
  const fuera = r.fuera ? ` data-fuera="${r.fuera}"` : "";
  return (
    `<span class="regla-desvio" data-tono="${r.tono}"${fuera} style="--d:${r.posicion}%" aria-hidden="true">` +
    `<i class="regla-tolerancia"></i><i class="regla-cero"></i><i class="regla-barra"></i><i class="regla-aguja"></i></span>`
  );
}

/** Una cifra de la Lectura: rótulo encima, número en Mono y unidad atenuada. */
export function htmlCifra({ rotulo, valor, unidad, clase = "" }) {
  return `<dl class="cifra${clase ? ` ${clase}` : ""}"><dt>${rotulo}</dt><dd>${valor}<span class="u">${unidad}</span></dd></dl>`;
}
