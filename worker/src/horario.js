// Fechas y horas siempre en Europe/Madrid, de forma explicita: el worker corre en UTC
// y el navegador en la zona del usuario. Nada de aqui lee la zona del proceso.

const HORA = 3600000;
// Festivos nacionales fijos de la 2.0TD (Circular 3/2020, art. 7), igual que js/datos.js.
const FIJOS = ["01-01", "01-06", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08", "12-25"];

// Reglas de la UE: hora de verano (UTC+2) desde el ultimo domingo de marzo a la 01:00 UTC hasta el
// ultimo domingo de octubre a la 01:00 UTC; el resto del año UTC+1. Se calcula sin Intl porque
// formatear cada instante cuesta demasiada CPU en el plan gratuito de Workers.
const transiciones = new Map();
function ultimoDomingo(anio, mes) {
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0));
  return Date.UTC(anio, mes, ultimo.getUTCDate() - ultimo.getUTCDay(), 1);
}
function desfaseMadrid(ms) {
  const anio = new Date(ms).getUTCFullYear();
  if (!transiciones.has(anio)) transiciones.set(anio, [ultimoDomingo(anio, 2), ultimoDomingo(anio, 9)]);
  const [verano, invierno] = transiciones.get(anio);
  return ms >= verano && ms < invierno ? 2 * HORA : HORA;
}

export function partesMadrid(ms) {
  const f = new Date(ms + desfaseMadrid(ms));
  const dosDigitos = (n) => String(n).padStart(2, "0");
  const hora = f.getUTCHours();
  const minuto = f.getUTCMinutes();
  return { dia: `${f.getUTCFullYear()}-${dosDigitos(f.getUTCMonth() + 1)}-${dosDigitos(f.getUTCDate())}`, hora, minuto, minutosDia: hora * 60 + minuto };
}

export const diaMadrid = (ms) => partesMadrid(ms).dia;

const [A, M, D] = [0, 1, 2];
const trozos = (fecha) => fecha.split("-").map(Number);

export function sumarDias(fecha, n) {
  const t = trozos(fecha);
  return new Date(Date.UTC(t[A], t[M] - 1, t[D] + n)).toISOString().slice(0, 10);
}

/** Medianoche local de `fecha` en epoch ms; a las 22:00 UTC previas el desfase ya es el de esa medianoche. */
function medianoche(fecha) {
  const t = trozos(fecha);
  const utc = Date.UTC(t[A], t[M] - 1, t[D]);
  return utc - desfaseMadrid(utc - 2 * HORA);
}

export function limitesDia(fecha) {
  const inicio = medianoche(fecha);
  const fin = medianoche(sumarDias(fecha, 1));
  return { inicio, fin, horas: Math.round((fin - inicio) / HORA) };
}

const diaSemana = (fecha) => {
  const t = trozos(fecha);
  return new Date(Date.UTC(t[A], t[M] - 1, t[D])).getUTCDay();
};

export const esFestivo = (fecha, festivos = new Set()) => diaSemana(fecha) === 0 || diaSemana(fecha) === 6 || FIJOS.includes(fecha.slice(5)) || festivos.has(fecha);
export const tipoDia = (fecha, festivos) => (esFestivo(fecha, festivos) ? "finde" : "laborable");

/** Periodo 2.0TD segun la hora de Madrid. */
export function periodoMadrid(ms, festivos = new Set()) {
  const { dia, hora } = partesMadrid(ms);
  if (esFestivo(dia, festivos) || hora < 8) return "P3";
  if ((hora >= 10 && hora < 14) || (hora >= 18 && hora < 22)) return "P1";
  return "P2";
}
