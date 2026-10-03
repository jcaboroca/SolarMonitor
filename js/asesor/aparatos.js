// Perfiles de electrodomesticos. Valores ESTIMADOS de partida: cada casa es
// distinta y el usuario los corrige en Ajustes. `potenciaPicoW` sirve para
// avisar de la potencia contratada; `energiaKwh` para el coste.

export const APARATOS_POR_DEFECTO = [
  { id: "lavadora", nombre: "Lavadora", icono: "🧺", energiaKwh: 0.7, duracionH: 2, potenciaPicoW: 2000, estimado: true },
  { id: "lavavajillas", nombre: "Lavavajillas", icono: "🍽️", energiaKwh: 1, duracionH: 2.5, potenciaPicoW: 2000, estimado: true },
  { id: "secadora", nombre: "Secadora", icono: "💨", energiaKwh: 1.5, duracionH: 2, potenciaPicoW: 1000, estimado: true },
  { id: "horno", nombre: "Horno", icono: "🔥", energiaKwh: 1.2, duracionH: 1, potenciaPicoW: 2200, estimado: true },
  { id: "termo", nombre: "Termo", icono: "🚿", energiaKwh: 2, duracionH: 2, potenciaPicoW: 1500, estimado: true },
  { id: "coche", nombre: "Cargar coche", icono: "🚗", energiaKwh: 7, duracionH: 4, potenciaPicoW: 2300, estimado: true },
];

export const CARGA_REFERENCIA = { id: "referencia", nombre: "Consumo grande", icono: "⚡", energiaKwh: 1, duracionH: 1, potenciaPicoW: 1000, estimado: false };

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
    return { ...a, ...limpio, estimado: Object.keys(limpio).length === 0 };
  });
}
