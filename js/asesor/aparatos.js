// Perfiles de electrodomesticos. Valores ESTIMADOS de partida: cada casa es
// distinta y el usuario los corrige en Ajustes. `potenciaPicoW` sirve para
// avisar de la potencia contratada; `energiaKwh` para el coste.

export const APARATOS_POR_DEFECTO = [
  { id: "lavadora", nombre: "Lavadora", icono: "🧺", energiaKwh: 0.7, duracionH: 2, potenciaPicoW: 2000, estimado: true },
  { id: "lavavajillas", nombre: "Lavavajillas", icono: "🍽️", energiaKwh: 1, duracionH: 2.5, potenciaPicoW: 2000, estimado: true },
  { id: "secadora", nombre: "Secadora", icono: "💨", energiaKwh: 1.5, duracionH: 2, potenciaPicoW: 1000, estimado: true },
  // Medido el 3-oct-2026 en la curva de 5 min: ~2,15 kW durante ~30 min.
  { id: "horno", nombre: "Horno", icono: "🔥", energiaKwh: 1.1, duracionH: 0.5, potenciaPicoW: 2200, estimado: false },
  { id: "vitro", nombre: "Vitrocerámica", icono: "🍳", energiaKwh: 0.9, duracionH: 0.75, potenciaPicoW: 2000, estimado: true },
];

export const CARGA_REFERENCIA = { id: "referencia", nombre: "Consumo grande", icono: "⚡", energiaKwh: 1, duracionH: 1, potenciaPicoW: 1000, estimado: false };

// Siempre enchufados: no se programan, pero explican el consumo de fondo.
// Medidos en la curva de 5 min con la casa vacía (5-20 de agosto de 2026).
export const CONSUMOS_FIJOS = [
  { id: "nevera", nombre: "Nevera", icono: "🧊", detalle: "Motor de ~70 W en marcha ~2/3 del tiempo (≈ 47 W de media). Por confirmar: si no para nunca, gasta más.", kwhDia: 1.1 },
  { id: "acuario", nombre: "Acuario grande", icono: "🐠", detalle: "Luz ≈ 105 W de 12 a 17 h; bomba y calentador ≈ 25-30 W las 24 h (medido al pararlo, oct-2026).", kwhDia: 1.2 },
  { id: "gambario", nombre: "Gambario", icono: "🦐", detalle: "Luz ≈ 25 W, se apaga a las 19:00 (hora de encendido por confirmar).", kwhDia: null },
  { id: "veinticuatro", nombre: "Resto que nunca se apaga (24 h)", icono: "❓", detalle: "≈ 145 W sin identificar: gambario (bomba y calentador), wifi… y quizá la nevera.", kwhDia: 3.5 },
];

/** Mezcla los perfiles guardados por el usuario sobre los de fabrica. */
export function combinarAparatos(guardados = []) {
  const porId = new Map(guardados.map((a) => [a.id, a]));
  return APARATOS_POR_DEFECTO.map((a) => {
    const propio = porId.get(a.id);
    if (!propio) return a;
    const limpio = Object.fromEntries(
      ["energiaKwh", "duracionH", "potenciaPicoW"]
        .filter((campo) => Number.isFinite(propio[campo]) && propio[campo] > 0)
        .map((campo) => [campo, propio[campo]])
    );
    return { ...a, ...limpio, estimado: a.estimado && Object.keys(limpio).length === 0 };
  });
}
