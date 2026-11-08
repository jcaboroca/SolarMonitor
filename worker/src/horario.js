// Fechas y horas siempre en Europe/Madrid, de forma explicita: el worker corre en UTC
// y el navegador en la zona del usuario. Nada de aqui lee la zona del proceso.

const ZONA = "Europe/Madrid";
const HORA = 3600000;
// Festivos nacionales fijos de la 2.0TD (Circular 3/2020, art. 7), igual que js/datos.js.
const FIJOS = ["01-01", "01-06", "05-01", "08-15", "10-12", "11-01", "12-06", "12-08", "12-25"];

const formato = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export function partesMadrid(ms) {
  const p = Object.fromEntries(formato.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const hora = Number(p.hour);
  const minuto = Number(p.minute);
  return { dia: `${p.year}-${p.month}-${p.day}`, hora, minuto, minutosDia: hora * 60 + minuto };
}

export const diaMadrid = (ms) => partesMadrid(ms).dia;

const [A, M, D] = [0, 1, 2];
const trozos = (fecha) => fecha.split("-").map(Number);

export function sumarDias(fecha, n) {
  const t = trozos(fecha);
  return new Date(Date.UTC(t[A], t[M] - 1, t[D] + n)).toISOString().slice(0, 10);
}

/** Medianoche local de `fecha` en epoch ms; las 22:00 UTC previas siempre caen antes del cambio de hora. */
function medianoche(fecha) {
  const t = trozos(fecha);
  const referencia = Date.UTC(t[A], t[M] - 1, t[D]) - 2 * HORA;
  const local = partesMadrid(referencia);
  const desfase = Date.UTC(...local.dia.split("-").map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))), local.hora, local.minuto) - referencia;
  return Date.UTC(t[A], t[M] - 1, t[D]) - desfase;
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
