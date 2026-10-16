// Datos de muestra del PROTOTIPO. No es el asesor ni modeloArco: imita la FORMA de su salida
// (§4.3.6 de la especificación) para que la vista se pueda conectar en F2 sin tocar la lógica.
// Instalación supuesta: 3,5 kWp en Madrid, batería de 10 kWh, viernes 16-oct-2026 despejado
// con nubes a media mañana. Precios con forma de 2.0TD (valle / llano / punta).

export const APARATOS = [
  { id: "referencia", nombre: "Consumo grande", icono: "i-potencia", kwh: 1, h: 1 },
  { id: "lavadora", nombre: "Lavadora", icono: "i-lavadora", kwh: 0.7, h: 2.17 },
  { id: "lavavajillas", nombre: "Lavavajillas", icono: "i-lavavajillas", kwh: 1.3, h: 2.33 },
  { id: "secadora", nombre: "Secadora", icono: "i-secadora", kwh: 2.15, h: 1.08 },
  { id: "horno", nombre: "Horno", icono: "i-horno", kwh: 1.1, h: 0.5 },
];

const DIA = new Date(2026, 9, 16);
const BAT_KWH = 10, SOC_MIN = 10, SOC_INICIO = 72, RESERVA = 35;
const PREVISTO = { 9: 0.14, 10: 0.72, 11: 1.52, 12: 2.12, 13: 2.48, 14: 2.58, 15: 2.42, 16: 1.98, 17: 1.3, 18: 0.56, 19: 0.07 };
const FACTOR = { 9: 1.07, 10: 0.97, 11: 0.74, 12: 0.9, 13: 0.99, 14: 1.0, 15: 0.97, 16: 0.93, 17: 0.88, 18: 0.91, 19: 1 };
const CASA = [0.32, 0.28, 0.26, 0.25, 0.25, 0.27, 0.34, 0.62, 0.71, 0.48, 0.42, 0.4, 0.46, 0.66, 0.92, 0.51, 0.44, 0.47, 0.58, 0.74, 1.06, 1.12, 0.83, 0.52];
const CASA_VAR = [1.04, 0.96, 1.0, 1.02, 0.98, 1.01, 0.93, 1.12, 1.08, 0.94, 1.1, 0.9, 1.06, 0.97, 0.97, 1.03, 1.0, 0.95, 1.05, 1.0, 1.0, 1.0, 1.0, 1.0];
const EXCEDENTE = 0.04, BAT_VALOR = 0.15;
const precio = (k) => { const h = k % 24; return h < 8 ? 0.092 : (h >= 10 && h < 14) || (h >= 18 && h < 22) ? 0.207 : 0.138; };
const enHora = (h) => new Date(DIA.getTime() + h * 3600e3);

export const VENTANA = { desde: 9, hasta: 20 };
export const theta = (t, v = VENTANA) => 180 * (1 - Math.min(1, Math.max(0, (t - v.desde) / (v.hasta - v.desde))));

export function escenario({ h = 13.7, vivo = true, calibrada = true, aparato = "lavadora" } = {}) {
  const kEstimado = calibrada ? 1 : 1.14;
  const solarReal = (k) => (k < 24 ? (PREVISTO[k] ?? 0) * (FACTOR[k] ?? 1) : 0);
  const solarPrev = (k) => (PREVISTO[k % 24] ?? 0) * (k >= 24 ? 0.93 : 1);
  const casaReal = (k) => CASA[k % 24] * (k < 24 ? CASA_VAR[k] : 1);
  const mezcla = (k, real, prev) => (k + 1 <= h ? real(k) : k <= h ? real(k) * (h - k) + prev(k) * (k + 1 - h) : prev(k));

  const pasos = [];
  let soc = SOC_INICIO;
  for (let k = 0; k < 48; k++) {
    const solar = mezcla(k, solarReal, solarPrev), casa = mezcla(k, casaReal, (x) => CASA[x % 24]);
    const inicio = soc, delta = solar - casa;
    let importa = 0, vierte = 0;
    if (delta > 0) { const carga = Math.min(delta, ((100 - soc) / 100) * BAT_KWH); soc += (carga / BAT_KWH) * 100; vierte = delta - carga; }
    else { const da = Math.min(-delta, Math.max(0, ((soc - SOC_MIN) / 100) * BAT_KWH)); soc -= (da / BAT_KWH) * 100; importa = -delta - da; }
    pasos.push({ k, solar, casa, socInicio: inicio, socFin: soc, importa, vierte });
  }
  const socEn = (t) => { const k = Math.min(47, Math.floor(t)); const p = pasos[k]; return p.socInicio + (p.socFin - p.socInicio) * (t - k); };

  const manana = h >= VENTANA.hasta + 1;
  const base = manana ? 24 : 0;
  const franjas = [];
  for (let i = 0; i < 24; i++) {
    const k = base + i;
    const dentro = i >= VENTANA.desde && i < VENTANA.hasta;
    const pasada = !manana && k + 1 <= h, enCurso = !manana && k <= h && h < k + 1;
    const real = pasada ? { kwh: solarReal(k), estado: "completa", cobertura: 1, procedencia: "worker", entradas: 12 }
      : enCurso ? { kwh: solarReal(k) * (h - k), estado: "en-curso", cobertura: h - k, procedencia: "worker", entradas: Math.floor((h - k) * 12) } : null;
    const casaR = pasada ? { kwh: casaReal(k), estado: "completa", cobertura: 1, procedencia: "worker", entradas: 12 }
      : enCurso ? { kwh: casaReal(k) * (h - k), estado: "en-curso", cobertura: h - k, procedencia: "worker", entradas: Math.floor((h - k) * 12) } : null;
    franjas.push({
      inicio: enHora(k), fin: enHora(k + 1), rotulo: `${String(i).padStart(2, "0")} h`, hora: i,
      angulo: dentro ? theta(i + 0.5) : null,
      real,
      previsto: { kwh: solarPrev(k) * kEstimado, origen: calibrada ? "prevision" : "estimado", confianza: calibrada ? "alta" : "baja" },
      tipico: null,
      casaReal: casaR,
      casaTipica: pasada ? null : { kwh: CASA[i], origen: "habito" },
      socFin: pasada ? { pct: pasos[k].socFin, procedencia: "worker" } : null,
      nota: null,
    });
  }

  const enDia = franjas.filter((f) => f.angulo !== null);
  const escala = calibrada ? { kwh: 2.8, origen: "instalacion" }
    : { kwh: Math.max(...enDia.map((f) => Math.max(f.previsto.kwh, f.real?.kwh ?? 0))), origen: "dia" };

  let muesca = null;
  for (let k = base + VENTANA.desde; k < base + VENTANA.hasta; k++) {
    if (pasos[k].socFin >= 98) { muesca = { angulo: theta(k + 1 - base), instante: enHora(k + 1), origen: !manana && k + 1 <= h ? "medido" : "simulado" }; break; }
  }

  const fresco = vivo;
  const hk = Math.floor(h);
  const vivoDato = vivo ? {
    solarW: Math.round(solarReal(hk) * 1000 * 0.98), casaW: Math.round(casaReal(hk) * 1000 * 0.97),
    soc: Math.round(socEn(h)), instante: enHora(h - 3 / 60), fresco,
  } : null;

  const estado = manana ? "mañana" : h < VENTANA.desde || h >= VENTANA.hasta ? "noche"
    : !calibrada ? "sin-calibrar" : !fresco ? "sin-vivo" : "completo";
  const leyendas = [];
  if (!calibrada) leyendas.push("sin-calibrar");
  if (escala.origen === "dia") leyendas.push("escala-dia");

  const asesor = decidir(h, aparato, pasos, socEn);
  const proximas = proximas24(h, pasos, socEn);

  return {
    estado,
    dia: { tipo: manana ? "mañana" : "hoy", inicio: enHora(base), fin: enHora(base + 24), horas: 24 },
    ventana: { desde: enHora(base + VENTANA.desde), hasta: enHora(base + VENTANA.hasta) },
    franjas, escala,
    prevision: { traida: enHora(Math.max(0, Math.floor(h) - 0.75)), sinConexion: false, estimada: !calibrada },
    leyendas,
    marcador: manana ? { angulo: null, posicion: null, lleno: false }
      : h < VENTANA.desde ? { angulo: null, posicion: "antes", lleno: fresco }
      : h >= VENTANA.hasta ? { angulo: null, posicion: "despues", lleno: fresco }
      : { angulo: theta(h), posicion: "pista", lleno: fresco },
    muesca,
    bateria: {
      soc: Math.round(socEn(h)), origenSoc: vivo ? "vivo" : "tipico", instanteSoc: vivo ? enHora(h - 3 / 60) : null,
      minimo: SOC_MIN, recomendada: { pct: RESERVA, hasta: enHora(24 + 9) },
      alAcabarSol: !manana && h < VENTANA.hasta ? Math.round(pasos[VENTANA.hasta - 1].socFin) : null,
    },
    vivo: vivoDato,
    asesor,
    proximas,
    totales: {
      realKwh: franjas.reduce((s, f) => s + (f.real?.kwh ?? 0), 0),
      previstoKwh: franjas.reduce((s, f) => s + f.previsto.kwh, 0),
      horasCompletas: franjas.filter((f) => f.real?.estado === "completa").length,
      horasEnCurso: franjas.filter((f) => f.real?.estado === "en-curso").length,
    },
    ahora: enHora(h),
    razones: razones(h, pasos, socEn, vivoDato, muesca),
  };
}

function costeDesde(t0, a, pasos, socEn) {
  const n = Math.ceil(a.h / 0.25), e = a.kwh / n;
  let coste = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * 0.25, k = Math.min(47, Math.floor(t));
    const sobra = Math.max(0, pasos[k].solar - pasos[k].casa) / 4;
    const delSol = Math.min(e, sobra), falta = e - delSol;
    coste += delSol * EXCEDENTE + (falta > 0 ? (socEn(t) > RESERVA + 5 ? falta * BAT_VALOR : falta * precio(k)) : 0);
  }
  return coste;
}

function decidir(h, id, pasos, socEn) {
  const a = APARATOS.find((x) => x.id === id);
  const inicios = [h];
  for (let t = Math.ceil(h * 4) / 4; t <= h + 24 - a.h; t += 0.25) if (t > h) inicios.push(t);
  const cand = inicios.map((t) => ({ inicio: enHora(t), fin: enHora(t + a.h), t, coste: costeDesde(t, a, pasos, socEn) }));
  const ahora = cand[0];
  const orden = [...cand].sort((x, y) => x.coste - y.coste || x.t - y.t);
  const mejores = [];
  for (const c of orden) { if (mejores.every((m) => Math.abs(m.t - c.t) >= 1)) mejores.push(c); if (mejores.length === 3) break; }
  const mejor = mejores[0];
  const estado = ahora.coste <= mejor.coste + 0.02 ? "verde" : ahora.coste <= mejor.coste + 0.1 ? "amarillo" : "rojo";
  const titulo = { verde: "Buen momento", amarillo: "Mejor espera", rojo: "Evita ahora" }[estado];
  return { estado, titulo, carga: a, costeAhora: ahora.coste, ahora, mejor, alternativas: mejores };
}

function proximas24(h, pasos, socEn) {
  const ref = APARATOS[0], fl = Math.floor(h);
  const costes = Array.from({ length: 24 }, (_, i) => ({ hora: (fl + i) % 24, t: fl + i, coste: costeDesde(Math.max(h, fl + i), ref, pasos, socEn) }));
  const min = Math.min(...costes.map((c) => c.coste));
  return costes.map((c) => ({ ...c, estado: c.coste <= min + 0.03 ? "bien" : c.coste <= min + 0.12 ? "cuidado" : "evita" }));
}

function razones(h, pasos, socEn, vivo, muesca) {
  const k = Math.floor(h), p = pasos[k], r = [];
  const sol = vivo ? vivo.solarW / 1000 : p.solar, casa = vivo ? vivo.casaW / 1000 : p.casa;
  if (sol > casa + 0.05) r.push({ icono: "i-sol", texto: `El sol da ${kw(sol)} y la casa usa ${kw(casa)}: sobran ${kw(sol - casa)}.` });
  else if (sol > 0.05) r.push({ icono: "i-sol", texto: `El sol da ${kw(sol)}, menos de lo que usa la casa (${kw(casa)}).` });
  else r.push({ icono: "i-sol", texto: "No hay producción solar a esta hora." });
  const s = Math.round(socEn(h));
  r.push({ icono: "i-bateria", texto: muesca && muesca.origen === "simulado" ? `La batería está al ${s} % y se llenará hacia las ${hhmm(muesca.instante)}.` : `La batería está al ${s} %.` });
  r.push({ icono: "i-reloj", texto: `La luz de la red cuesta ahora ${num(precio(k), 3)} €/kWh (${precio(k) > 0.2 ? "punta" : precio(k) < 0.1 ? "valle" : "llano"}).` });
  return r;
}

export const num = (x, d = 2) => x.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
export const kw = (x) => `${num(x)} kW`;
export const hhmm = (d) => d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
export const euros = (x) => `≈ ${num(x)} €`;
export function cuando(fecha, ahora) {
  if (Math.abs(fecha - ahora) < 60000) return "Ahora";
  const dias = Math.round((new Date(fecha).setHours(0, 0, 0, 0) - new Date(ahora).setHours(0, 0, 0, 0)) / 864e5);
  return dias === 0 ? `Hoy a las ${hhmm(fecha)}` : dias === 1 ? `Mañana a las ${hhmm(fecha)}` : hhmm(fecha);
}
