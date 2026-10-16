// Iconos de la interfaz: todo pasa por el sprite SVG de index.html (§3.5).
// Los módulos del asesor siguen emitiendo su campo `icono`; aquí se traduce.

const APARATO = {
  referencia: "i-potencia",
  lavadora: "i-lavadora",
  lavavajillas: "i-lavavajillas",
  secadora: "i-secadora",
  horno: "i-horno",
  vitro: "i-vitro",
  nevera: "i-nevera",
  acuario: "i-acuario",
  gambario: "i-gambario",
  desconocido: "i-desconocido",
};

// Claves sin el selector de variante U+FE0F, que el motor a veces añade.
const RAZON = {
  "\u{1F4E1}": "i-senal",
  "\u{1F9ED}": "i-rumbo",
  "\u2600": "i-sol",
  "\u{1F3E0}": "i-casa",
  "\u{1F50B}": "i-bateria",
  "\u{1F4B6}": "i-euro",
  "\u{1F50C}": "i-red",
  "\u23F0": "i-reloj",
  "\u{1F324}": "i-prevision",
  "\u26A1": "i-potencia",
};

const FORMA = { verde: "f-bien", amarillo: "f-cuidado", rojo: "f-evita" };

const FUENTE = {
  factura: ["i-documento", "Factura"],
  solarman: ["i-sol", "Solarman"],
  datadis: ["i-contador", "datadis"],
};

export const iconoAparato = (id) => APARATO[id] ?? "i-potencia";
export const iconoRazon = (emoji) => RAZON[String(emoji).replace(/\uFE0F/g, "")] ?? null;
export const forma = (estado) => FORMA[estado] ?? null;

export const htmlIcono = (nombre) =>
  `<svg class="i" aria-hidden="true" focusable="false"><use href="#${nombre}"></use></svg>`;

export function htmlFuente(tipo) {
  const [icono, nombre] = FUENTE[tipo];
  return `<span class="fuente ${tipo}">${htmlIcono(icono)}${nombre}</span>`;
}
