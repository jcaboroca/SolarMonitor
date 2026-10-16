// Arco solar de «Ahora» (§4 de la especificación). Dos partes:
// - modeloArco(entrada): función pura. Sin DOM, sin localStorage ni red; no toca la entrada.
// - pintarArco(figura, modelo): solo dibuja el modelo (SVG + rótulos en HTML superpuesto).
// El arco no es la posición del sol: ángulo = hora, lineal entre la primera y la última
// hora con producción del día (§4.1).

import { euros } from "./asesor/motor.js";

export const HORA = 3600000;
export const CX = 200, CY = 200, R = 150, LMAX = 34, LCASA = 30, ANILLO = 196;
export const CAJA = { x: 0, y: -22, ancho: 400, alto: 242 };
const UMBRAL_KWH = 0.02;
// De menos a más precedencia, igual que juntarHoras(local, archivo, worker).
const FUENTES = ["local", "archivo", "worker"];
const RANGO = { baja: 1, media: 2, alta: 3 };

// --- Formato ---------------------------------------------------------------------

const numero = (x, d) => x.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const dos = (n) => String(n).padStart(2, "0");
const desfase = (d) => {
  const horas = -d.getTimezoneOffset() / 60;
  return `UTC${horas >= 0 ? "+" : "-"}${Math.abs(horas)}`;
};
// Una hora local que se repite (día de 25 h) tiene a su lado otra con el mismo rótulo.
const horaRepetida = (t) => {
  const h = new Date(t).getHours();
  return new Date(t - HORA).getHours() === h || new Date(t + HORA).getHours() === h;
};

/** Única función de formato de las cifras del arco (§4.3.6). */
export function formatear(valor, unidad, decimales) {
  if (unidad === "€") return euros(valor);
  if (unidad === "hora") return new Date(valor).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (unidad === "franja") {
    const d = new Date(valor);
    return horaRepetida(valor) ? `${dos(d.getHours())} H (${desfase(d)})` : `${dos(d.getHours())} H`;
  }
  return `${numero(valor, decimales)} ${unidad}`;
}

// --- Geometría (§4.3.5) ------------------------------------------------------------

/** Ángulo en grados desde +x, antihorario: 180° la primera hora, 0° la última. */
export function angulo(t, { desde, hasta }) {
  const p = Math.min(Math.max((t - desde) / (hasta - desde), 0), 1);
  return 180 * (1 - p);
}

export const punto = (a, r = R) => ({
  x: CX + r * Math.cos((a * Math.PI) / 180),
  y: CY - r * Math.sin((a * Math.PI) / 180),
});

// --- Modelo -------------------------------------------------------------------------

const inicioDelDia = (d, mas = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + mas);

function vacio(estado) {
  return {
    estado,
    dia: null,
    ventana: null,
    franjas: [],
    escala: null,
    prevision: { traida: null, sinConexion: false, estimada: false },
    leyendas: [],
    marcador: { angulo: null, posicion: null, lleno: false },
    muesca: null,
    bateria: null,
    vivo: null,
    asesor: null,
    totales: { realKwh: null, previstoKwh: null, horasCompletas: 0, horasParciales: 0, horasEnCurso: 0, horasSinDato: 0 },
    cifras: [],
    visibles: { arco: [], cuenco: [], lecturas: [], bateria: [], extremos: [], muesca: [], leyenda: [] },
    tabla: { franjas: [], pie: [], bateria: [], vivo: [], asesor: [] },
    resumen: estado === "error"
      ? { plantilla: "No he podido calcular.", ids: [], texto: "No he podido calcular." }
      : { plantilla: "Calculando…", ids: [], texto: "Calculando…" },
  };
}

// Entradas medidas ganadoras por clave exacta, con la precedencia de juntarHoras.
function ganadoras(horasPorFuente = {}) {
  const porClave = new Map();
  for (const procedencia of FUENTES) {
    for (const hora of horasPorFuente[procedencia] ?? []) porClave.set(hora.inicio.getTime(), { hora, procedencia });
  }
  return [...porClave.values()];
}

const valido = (x) => typeof x === "number" && Number.isFinite(x);

function medicion(entradas, campo, estado, procedencia) {
  const utiles = entradas.filter((e) => valido(e[campo]));
  if (!utiles.length) return null;
  return {
    kwh: utiles.reduce((s, e) => s + e[campo], 0),
    estado,
    cobertura: Math.min(utiles.reduce((s, e) => s + e.cobertura, 0), 1),
    procedencia,
    entradas: utiles.length,
  };
}

function construirDia(entrada, inicio, tipo) {
  const { ahora, habitos } = entrada;
  const fin = inicioDelDia(inicio, 1);
  const horas = Math.round((fin - inicio) / HORA);
  const t = ahora.getTime();

  const franjas = Array.from({ length: horas }, (_, k) => {
    const ini = new Date(inicio.getTime() + k * HORA);
    return { inicio: ini, fin: new Date(ini.getTime() + HORA), medidas: [], previstos: [] };
  });
  const indice = (fecha) => {
    const k = Math.floor((fecha.getTime() - inicio.getTime()) / HORA);
    return k >= 0 && k < horas ? k : -1;
  };

  for (const g of ganadoras(entrada.horasPorFuente)) {
    // Sin cobertura no hay medida: es una hora vacía, no un cero.
    if (!(g.hora.cobertura > 0)) continue;
    const k = indice(g.hora.inicio);
    if (k >= 0) franjas[k].medidas.push(g);
  }
  (entrada.solar ?? []).forEach((s, i) => {
    const k = indice(s.inicio);
    if (k >= 0 && valido(s.kwh)) franjas[k].previstos.push({ ...s, i });
  });

  const usaPrevision = franjas.some((f) => f.previstos.length);
  const repetidas = new Map();
  for (const f of franjas) repetidas.set(f.inicio.getHours(), (repetidas.get(f.inicio.getHours()) ?? 0) + 1);

  const lista = franjas.map((f) => {
    const ms = f.inicio.getTime();
    const pasada = f.fin.getTime() <= t;
    const enCurso = f.inicio.getTime() <= t && t < f.fin.getTime();
    let real = null, casaReal = null, socFin = null, rutaMedida = null;
    if ((pasada || enCurso) && f.medidas.length) {
      // Si en una franja coinciden procedencias distintas manda la de más precedencia.
      const procedencia = FUENTES.filter((p) => f.medidas.some((m) => m.procedencia === p)).at(-1);
      const entradas = f.medidas.filter((m) => m.procedencia === procedencia).map((m) => m.hora).sort((a, b) => a.inicio - b.inicio);
      const cobertura = Math.min(entradas.reduce((s, e) => s + e.cobertura, 0), 1);
      const estado = enCurso ? "en-curso" : cobertura >= 0.75 ? "completa" : "parcial";
      real = medicion(entradas, "solarKwh", estado, procedencia);
      casaReal = medicion(entradas, "casaKwh", estado, procedencia);
      const ultima = entradas.at(-1);
      if (valido(ultima.socFin) && ultima.socFin > 0 && ultima.socFin <= 100) socFin = { pct: ultima.socFin, procedencia };
      rutaMedida = `horasPorFuente.${procedencia}[${entradas.map((e) => e.inicio.getTime()).join("+")}]`;
    }
    let previsto = null, rutaPrevista = null;
    if (f.previstos.length) {
      previsto = {
        kwh: f.previstos.reduce((s, p) => s + p.kwh, 0),
        origen: f.previstos.some((p) => p.origen === "estimado") ? "estimado" : "prevision",
        confianza: f.previstos.map((p) => p.confianza).reduce((a, b) => ((RANGO[b] ?? 0) < (RANGO[a] ?? 0) ? b : a)),
      };
      rutaPrevista = `solar[${f.previstos.map((p) => p.inicio.getTime()).join("+")}].kwh`;
    }
    let tipico = null;
    if (!usaPrevision) {
      const v = habitos?.solarTipica(f.inicio.getHours());
      if (valido(v)) tipico = { kwh: v };
    }
    let casaTipica = null;
    if (!pasada) {
      const c = habitos?.consumo(f.inicio);
      if (c && valido(c.kwh)) casaTipica = { kwh: c.kwh, origen: c.origen };
    }
    const repetida = repetidas.get(f.inicio.getHours()) > 1;
    return {
      inicio: f.inicio,
      fin: f.fin,
      rotulo: formatear(ms, "franja"),
      desfaseUtc: repetida ? desfase(f.inicio) : null,
      angulo: null,
      real, previsto, tipico, casaReal, casaTipica, socFin,
      nota: null,
      pasada,
      _rutaMedida: rutaMedida,
      _rutaPrevista: rutaPrevista,
    };
  });

  // Hora repetida en datos locales (§4.3.1): el Excel no distingue las dos 02 h.
  const pares = lista.filter((f) => f.desfaseUtc);
  if (pares.length === 2 && (pares[0].real ?? pares[0].casaReal)?.procedencia === "local") {
    pares[0].nota = "hora-repetida-local";
    if (!pares[1].real && !pares[1].casaReal) pares[1].nota = "hora-repetida-local";
  }

  const conSol = lista.filter((f) =>
    (f.previsto?.kwh ?? 0) >= UMBRAL_KWH || (f.real?.kwh ?? 0) >= UMBRAL_KWH || (!usaPrevision && (f.tipico?.kwh ?? 0) >= UMBRAL_KWH)
  );
  const ventana = conSol.length ? { desde: conSol[0].inicio, hasta: conSol.at(-1).fin } : null;
  if (ventana) {
    for (const f of lista) {
      if (f.inicio >= ventana.desde && f.fin <= ventana.hasta) f.angulo = angulo((f.inicio.getTime() + f.fin.getTime()) / 2, ventana);
    }
  }
  return { dia: { tipo, inicio, fin, horas }, franjas: lista, ventana, usaPrevision };
}

function origenSoc(entrada) {
  const { vivo, fresco, habitos, ahora } = entrada;
  if (vivo && valido(vivo.soc)) {
    return { soc: vivo.soc, origen: fresco ? "vivo" : "lectura-antigua", instante: vivo.instante, ruta: "vivo.soc", clase: "vivo", procedencia: "worker" };
  }
  const hora = ahora.getHours();
  const tipico = habitos?.socTipico(hora);
  if (valido(tipico)) return { soc: tipico, origen: "tipico", instante: null, ruta: `habitos.socTipico(${hora})`, clase: "tipico", procedencia: "habitos" };
  return { soc: null, origen: "ninguno", instante: null };
}

const DECIMALES = { kWh: 2, kW: 2, "%": 0, "€": null, hora: null, franja: null, h: 0, min: 0 };

export function modeloArco(entrada) {
  if (!entrada) return vacio("cargando");
  if (entrada.error) return vacio("error");

  const { ahora } = entrada;
  const t = ahora.getTime();
  const hoy = construirDia(entrada, inicioDelDia(ahora), "hoy");
  // D1: desde una hora después del final de la ventana de hoy se enseña mañana.
  const d = hoy.ventana && t >= hoy.ventana.hasta.getTime() + HORA ? construirDia(entrada, inicioDelDia(ahora, 1), "mañana") : hoy;
  const { dia, franjas, ventana, usaPrevision } = d;
  const esHoy = dia.tipo === "hoy";

  // Escala (§4.3.3, D6). Sin ventana no hay rayos, así que tampoco escala.
  const cal = entrada.calibracion;
  let escala = null;
  if (!ventana) escala = null;
  else if (cal && cal.kGlobal !== null && cal.kGlobal !== undefined && cal.maxKwh > 0) escala = { kwh: cal.maxKwh, origen: "instalacion" };
  else {
    const maximo = Math.max(0, ...franjas.flatMap((f) => [f.previsto?.kwh ?? 0, f.real?.kwh ?? 0, f.tipico?.kwh ?? 0]));
    if (maximo > 0) escala = { kwh: maximo, origen: "dia" };
  }

  const estimada = franjas.some((f) => f.previsto?.origen === "estimado");
  const conTipico = !usaPrevision && franjas.some((f) => f.tipico);
  const prevision = {
    traida: entrada.prevision?.traida ?? null,
    sinConexion: Boolean(entrada.prevision?.sinConexion),
    estimada,
  };
  const leyendas = [];
  if (estimada) leyendas.push("sin-calibrar");
  if (prevision.sinConexion) leyendas.push("sin-conexion");
  if (conTipico) leyendas.push("tipico");
  if (escala?.origen === "dia") leyendas.push("escala-dia");
  if (franjas.some((f) => f.nota)) leyendas.push("hora-repetida-local");

  // Estado (§4.5): gana el primero que se cumple.
  let estado;
  if (!ventana) estado = "sin-sol";
  else if (!esHoy) estado = "mañana";
  else if (t < ventana.desde.getTime() || (ventana.hasta.getTime() <= t && t < ventana.hasta.getTime() + HORA)) estado = "noche";
  else if (conTipico) estado = "sin-prevision";
  else if (estimada) estado = "sin-calibrar";
  else if (!entrada.fresco) estado = "sin-vivo";
  else estado = "completo";

  const marcador = { angulo: null, posicion: null, lleno: Boolean(entrada.fresco) };
  if (esHoy && ventana) {
    if (t < ventana.desde.getTime()) marcador.posicion = "antes";
    else if (t > ventana.hasta.getTime()) marcador.posicion = "despues";
    else {
      marcador.posicion = "pista";
      marcador.angulo = angulo(t, ventana);
    }
  }

  // Batería (§4.3.4). El 50 % por defecto del asesor no entra aquí nunca.
  const soc = origenSoc(entrada);
  const slots = entrada.slots ?? [];
  const pasos = entrada.pasos ?? null;
  let alAcabarSol = null, iAlAcabar = -1;
  if (esHoy && ventana && usaPrevision && soc.origen !== "ninguno" && pasos) {
    iAlAcabar = slots.findIndex((s) => s.inicio < ventana.hasta && ventana.hasta <= s.fin);
    if (iAlAcabar >= 0 && valido(pasos[iAlAcabar]?.socPct)) alAcabarSol = pasos[iAlAcabar].socPct;
    else iAlAcabar = -1;
  }

  let muesca = null;
  if (ventana) {
    const llena = franjas.find((f) => f.angulo !== null && f.socFin && f.socFin.pct >= 98);
    if (llena) {
      muesca = { angulo: angulo(llena.fin, ventana), instante: llena.fin, origen: "medido", _franja: llena };
    } else if (soc.origen !== "ninguno" && pasos) {
      const i = pasos.findIndex((p) => valido(p?.socPct) && p.socPct >= 98);
      const s = slots[i];
      if (i >= 0 && s && s.fin > ventana.desde && s.fin <= ventana.hasta) {
        muesca = { angulo: angulo(s.fin, ventana), instante: s.fin, origen: "simulado", _paso: i };
      }
    }
  }

  const minimo = valido(entrada.bateria?.socMinimoPct) ? entrada.bateria.socMinimoPct : null;
  const reserva = entrada.reserva && valido(entrada.reserva.pct) ? entrada.reserva : null;
  const bateria = {
    soc: soc.soc,
    origenSoc: soc.origen,
    instanteSoc: soc.instante,
    minimo,
    recomendada: reserva ? { pct: reserva.pct, hasta: reserva.hasta ?? null } : null,
    alAcabarSol,
  };

  const v = entrada.vivo;
  const vivo = v ? { solarW: v.solarW, casaW: v.casaW, soc: v.soc, instante: v.instante, fresco: Boolean(entrada.fresco) } : null;

  const decision = entrada.decision;
  const asesor = decision
    ? {
        estado: decision.estado,
        titulo: decision.titulo,
        carga: entrada.carga ?? null,
        costeAhora: decision.ahora && valido(decision.ahora.coste) ? decision.ahora.coste : null,
        mejor: decision.mejor ? { inicio: decision.mejor.inicio, fin: decision.mejor.fin, coste: decision.mejor.coste } : null,
      }
    : null;

  // Totales
  const conReal = franjas.filter((f) => f.real);
  const conPrevisto = franjas.filter((f) => f.previsto);
  const totales = {
    realKwh: conReal.length ? conReal.reduce((s, f) => s + f.real.kwh, 0) : null,
    previstoKwh: conPrevisto.length ? conPrevisto.reduce((s, f) => s + f.previsto.kwh, 0) : null,
    horasCompletas: conReal.filter((f) => f.real.estado === "completa").length,
    horasParciales: conReal.filter((f) => f.real.estado === "parcial").length,
    horasEnCurso: conReal.filter((f) => f.real.estado === "en-curso").length,
    horasSinDato: franjas.filter((f) => f.pasada && !f.real).length,
  };

  // --- Cifras (registro único de todo lo que se muestra) -------------------------------
  const cifras = [];
  const mapa = new Map();
  const cifra = (id, valor, unidad, clase, procedencia, ruta, instante = null, decimales = DECIMALES[unidad]) => {
    const c = { id, valor, unidad, decimales, texto: formatear(valor, unidad, decimales), clase, procedencia, ruta, instante };
    cifras.push(c);
    mapa.set(id, c);
    return id;
  };

  const filas = franjas.map((f) => {
    const ms = f.inicio.getTime();
    const ids = [cifra(`franja:${ms}:rotulo`, ms, "franja", "calculo", "calculo", `franjas[${ms}].inicio`, f.inicio)];
    if (f.real) {
      ids.push(cifra(`franja:${ms}:real`, f.real.kwh, "kWh", "medido", f.real.procedencia, `${f._rutaMedida}.solarKwh`, f.inicio));
      if (f.real.estado !== "completa") {
        ids.push(cifra(`franja:${ms}:cobertura`, f.real.cobertura * 60, "min", "medido", f.real.procedencia, `${f._rutaMedida}.cobertura`, f.inicio));
      }
    }
    if (f.previsto) ids.push(cifra(`franja:${ms}:previsto`, f.previsto.kwh, "kWh", "previsto", "open-meteo", f._rutaPrevista, f.inicio));
    if (f.tipico) ids.push(cifra(`franja:${ms}:tipico`, f.tipico.kwh, "kWh", "tipico", "habitos", `habitos.solarTipica(${f.inicio.getHours()})`, f.inicio));
    if (f.casaReal) ids.push(cifra(`franja:${ms}:casaReal`, f.casaReal.kwh, "kWh", "medido", f.casaReal.procedencia, `${f._rutaMedida}.casaKwh`, f.inicio));
    if (f.casaTipica) ids.push(cifra(`franja:${ms}:casaTipica`, f.casaTipica.kwh, "kWh", "tipico", "habitos", `habitos.consumo(${ms}).kwh`, f.inicio));
    if (f.socFin) ids.push(cifra(`franja:${ms}:socFin`, f.socFin.pct, "%", "medido", f.socFin.procedencia, `${f._rutaMedida}.socFin`, f.fin));
    return { inicio: f.inicio, ids };
  });

  const pie = [];
  if (ventana) {
    pie.push(cifra("ventana:desde", ventana.desde.getTime(), "franja", "calculo", "calculo", "ventana.desde", ventana.desde));
    pie.push(cifra("ventana:hasta", ventana.hasta.getTime(), "franja", "calculo", "calculo", "ventana.hasta", ventana.hasta));
  }
  if (totales.realKwh !== null) pie.push(cifra("total:real", totales.realKwh, "kWh", "medido", "calculo", "suma(franjas.real)", null, 1));
  if (totales.previstoKwh !== null) pie.push(cifra("total:previsto", totales.previstoKwh, "kWh", "previsto", "calculo", "suma(franjas.previsto)", null, 1));
  if (esHoy) pie.push(cifra("total:sinDato", totales.horasSinDato, "h", "calculo", "calculo", "cuenta(franjas sin dato)"));
  if (escala) {
    pie.push(escala.origen === "instalacion"
      ? cifra("escala", escala.kwh, "kWh", "calculo", "calibracion", "calibracion.maxKwh", null, 1)
      : cifra("escala", escala.kwh, "kWh", "calculo", "calculo", "maximo(franjas)", null, 1));
  }
  if (prevision.traida) pie.push(cifra("prevision:traida", prevision.traida.getTime(), "hora", "calculo", "open-meteo", "prevision.traida", prevision.traida));

  const tablaBateria = [];
  if (soc.soc !== null) tablaBateria.push(cifra("bateria:soc", soc.soc, "%", soc.clase, soc.procedencia, soc.ruta, soc.instante));
  if (minimo !== null) tablaBateria.push(cifra("bateria:minimo", minimo, "%", "ajuste", "ajuste", "bateria.socMinimoPct"));
  if (reserva) tablaBateria.push(cifra("bateria:recomendada", reserva.pct, "%", "simulado", "asesor", "reserva.pct", reserva.hasta ?? null));
  if (alAcabarSol !== null) {
    tablaBateria.push(cifra("bateria:alAcabarSol", alAcabarSol, "%", "simulado", "simulador", `pasos[${iAlAcabar}].socPct`, slots[iAlAcabar].fin));
  }
  if (muesca) {
    tablaBateria.push(muesca.origen === "medido"
      ? cifra("muesca", muesca.instante.getTime(), "hora", "medido", muesca._franja.socFin.procedencia, `${muesca._franja._rutaMedida}.socFin`, muesca.instante)
      : cifra("muesca", muesca.instante.getTime(), "hora", "simulado", "simulador", `pasos[${muesca._paso}].socPct`, muesca.instante));
  }

  const tablaVivo = [];
  if (vivo) {
    if (valido(vivo.solarW)) tablaVivo.push(cifra("vivo:solarW", vivo.solarW / 1000, "kW", "vivo", "worker", "vivo.solarW", vivo.instante));
    if (valido(vivo.casaW)) tablaVivo.push(cifra("vivo:casaW", vivo.casaW / 1000, "kW", "vivo", "worker", "vivo.casaW", vivo.instante));
    if (valido(vivo.soc)) tablaVivo.push(cifra("vivo:soc", vivo.soc, "%", "vivo", "worker", "vivo.soc", vivo.instante));
    tablaVivo.push(cifra("vivo:instante", vivo.instante.getTime(), "hora", "vivo", "worker", "vivo.instante", vivo.instante));
    tablaVivo.push(cifra("vivo:antiguedad", Math.max(0, Math.round((t - vivo.instante.getTime()) / 60000)), "min", "calculo", "calculo", "ahora − vivo.instante"));
  }

  const tablaAsesor = [];
  const mejorDistinta = asesor?.mejor && decision.ahora !== decision.mejor && asesor.mejor.inicio.getTime() !== decision.ahora?.inicio?.getTime();
  if (asesor?.costeAhora !== null && asesor?.costeAhora !== undefined) {
    tablaAsesor.push(cifra("asesor:costeAhora", asesor.costeAhora, "€", "simulado", "asesor", "decision.ahora.coste", decision.ahora.inicio));
  }
  if (asesor?.mejor) {
    tablaAsesor.push(cifra("asesor:mejor:inicio", asesor.mejor.inicio.getTime(), "hora", "simulado", "asesor", "decision.mejor.inicio", asesor.mejor.inicio));
    tablaAsesor.push(cifra("asesor:mejor:fin", asesor.mejor.fin.getTime(), "hora", "simulado", "asesor", "decision.mejor.fin", asesor.mejor.fin));
    if (valido(asesor.mejor.coste)) tablaAsesor.push(cifra("asesor:mejor:coste", asesor.mejor.coste, "€", "simulado", "asesor", "decision.mejor.coste", asesor.mejor.inicio));
  }

  // --- Lo que se ve, zona por zona --------------------------------------------------------
  const tiene = (id) => mapa.has(id);
  const solo = (...ids) => ids.filter(tiene);
  const visibles = { arco: [], cuenco: [], lecturas: [], bateria: [], extremos: [], muesca: [], leyenda: [] };
  const rayos = rayosDe({ ventana, escala, franjas });
  visibles.arco = rayos.filter((r) => r.id).map((r) => r.id);
  visibles.cuenco = solo("asesor:costeAhora");
  // cuando() del motor escribe «Ahora» sin hora si la mejor ventana empieza ya.
  if (mejorDistinta) {
    if (Math.abs(asesor.mejor.inicio - ahora) >= 60000) visibles.cuenco.push(...solo("asesor:mejor:inicio"));
    visibles.cuenco.push(...solo("asesor:mejor:coste"));
  }
  if (vivo) visibles.lecturas = solo("vivo:solarW", "vivo:casaW", "vivo:soc", ...(vivo.fresco ? [] : ["vivo:antiguedad"]));
  else visibles.lecturas = solo("bateria:soc");
  visibles.bateria = solo("bateria:minimo", "bateria:recomendada", "bateria:alAcabarSol");
  visibles.extremos = solo("ventana:desde", "ventana:hasta");
  if (estado === "noche" && t >= ventana.hasta.getTime()) visibles.extremos.push(...solo("total:real"));
  visibles.muesca = solo("muesca");
  visibles.leyenda = solo("escala", "prevision:traida");

  // --- Resumen: plantilla sin cifras sueltas -----------------------------------------------
  const frases = [];
  if (estado === "sin-sol") {
    frases.push(esHoy ? "Sin datos de sol para hoy." : "Sin previsión para mañana.");
  } else if (!esHoy) {
    frases.push(`Mañana, producción prevista de {ventana:desde} a {ventana:hasta}${tiene("total:previsto") ? ": {total:previsto}" : ""}.`);
  } else if (tiene("total:previsto")) {
    frases.push("Producción prevista hoy de {ventana:desde} a {ventana:hasta}: {total:previsto}.");
  } else {
    frases.push("Producción hoy de {ventana:desde} a {ventana:hasta}" + (conTipico ? ", según lo típico, sin previsión." : "."));
  }
  if (esHoy && tiene("total:real")) {
    frases.push(`Llevas {total:real}${totales.horasSinDato > 0 ? " (faltan datos de {total:sinDato})" : ""}.`);
  } else if (esHoy && totales.horasSinDato > 0) {
    frases.push("Faltan datos de {total:sinDato}.");
  }
  if (tiene("vivo:solarW") && tiene("vivo:casaW")) {
    frases.push(`Ahora, {vivo:solarW} de sol y {vivo:casaW} de consumo${vivo.fresco ? "" : ", lectura de hace {vivo:antiguedad}"}.`);
  }
  const nombreOrigen = { vivo: "en vivo", "lectura-antigua": "última lectura", tipico: "típico a esta hora" };
  frases.push(tiene("bateria:soc") ? `Batería al {bateria:soc}, ${nombreOrigen[soc.origen]}.` : "Sin dato de batería.");
  if (muesca) frases.push(muesca.origen === "medido" ? "Llena antes de las {muesca}." : "Llena hacia las {muesca}, simulado.");
  if (leyendas.includes("hora-repetida-local")) frases.push("La hora repetida del cambio no se distingue en el Excel.");
  const plantilla = frases.join(" ");
  const resumen = {
    plantilla,
    ids: [...plantilla.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]),
    texto: plantilla.replace(/\{([^}]+)\}/g, (_, id) => mapa.get(id).texto),
  };

  return {
    estado,
    dia,
    ventana,
    franjas: franjas.map(({ _rutaMedida, _rutaPrevista, ...f }) => f),
    escala,
    prevision,
    leyendas,
    marcador,
    muesca: muesca && { angulo: muesca.angulo, instante: muesca.instante, origen: muesca.origen },
    bateria,
    vivo,
    asesor,
    totales,
    cifras,
    visibles,
    tabla: { franjas: filas, pie, bateria: tablaBateria, vivo: tablaVivo, asesor: tablaAsesor },
    resumen,
  };
}

/**
 * Rayos que dibuja el arco, derivados solo del modelo (puro). La longitud sigue el §4.3.5:
 * sol = min(kWh / escala, 1) · Lmax; casa = misma escala en px/kWh con tope Lcasa.
 */
export function rayosDe(m) {
  if (!m.ventana || !m.escala) return [];
  const enVentana = m.franjas.filter((f) => f.angulo !== null);
  const grosor = enVentana.length <= 13 ? 6 : 4;
  const px = LMAX / m.escala.kwh;
  const rayos = [];
  for (const f of enVentana) {
    const ms = f.inicio.getTime();
    const comun = { franja: ms, angulo: f.angulo, grosor };
    const ref = f.previsto ? ["previsto", f.previsto] : f.tipico ? ["tipico", f.tipico] : null;
    if (ref) {
      rayos.push({
        ...comun, tipo: "contorno", referencia: ref[0], id: `franja:${ms}:${ref[0]}`,
        longitud: Math.min(ref[1].kwh / m.escala.kwh, 1) * LMAX,
        discontinuo: ref[0] === "previsto" && (f.previsto.origen === "estimado" || f.previsto.confianza === "baja"),
        punteado: ref[0] === "tipico",
      });
    }
    if (f.real) {
      rayos.push({
        ...comun, tipo: "relleno", id: `franja:${ms}:real`, estado: f.real.estado,
        rayado: f.real.estado === "parcial" || f.nota !== null,
        longitud: Math.min(f.real.kwh / m.escala.kwh, 1) * LMAX,
      });
    } else if (f.pasada) {
      rayos.push({ ...comun, tipo: "sin-dato", id: null, longitud: 0 });
    }
    const casa = f.casaReal ? ["casa", f.casaReal, "casaReal"] : f.casaTipica ? ["casa-tipica", f.casaTipica, "casaTipica"] : null;
    if (casa) {
      const bruto = casa[1].kwh * px;
      rayos.push({
        ...comun, tipo: casa[0], id: `franja:${ms}:${casa[2]}`, estado: casa[1].estado ?? null,
        longitud: Math.min(bruto, LCASA), desborde: bruto > LCASA,
      });
    }
  }
  return rayos;
}

/** Franja de la ventana más cercana a un punto del viewBox, o null fuera de la banda útil. */
export function franjaEn(m, x, y) {
  const dx = x - CX, dy = CY - y;
  if (dy < -24 || Math.hypot(dx, dy) < 60) return null;
  const a = Math.max(0, Math.min(180, (Math.atan2(Math.max(dy, 0), dx) * 180) / Math.PI));
  let mejor = null, distancia = Infinity;
  for (const f of m.franjas) {
    if (f.angulo !== null && Math.abs(f.angulo - a) < distancia) {
      distancia = Math.abs(f.angulo - a);
      mejor = f;
    }
  }
  return mejor;
}

// --- Pintado (solo navegador) ------------------------------------------------------------

const NS = "http://www.w3.org/2000/svg";
const CURVA = "cubic-bezier(.2, .8, .2, 1)";
const memoria = new WeakMap();
let primeraDeLaSesion = true;

// Se pregunta en el momento de animar (§6.2), nunca una vez al cargar.
const quieto = () => !globalThis.matchMedia || globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;

function nodo(etiqueta, atributos, padre) {
  const n = document.createElementNS(NS, etiqueta);
  for (const [k, v] of Object.entries(atributos)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  padre?.append(n);
  return n;
}
const arcoEntre = (a0, a1, r) => {
  const p0 = punto(a0, r), p1 = punto(a1, r);
  return `M${p0.x} ${p0.y} A${r} ${r} 0 0 1 ${p1.x} ${p1.y}`;
};
const raya = (a, r0, r1, clase, padre) => {
  const p0 = punto(a, r0), p1 = punto(a, r1);
  return nodo("line", { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, class: clase }, padre);
};
const enCaja = ({ x, y }) => ({ left: `${((x - CAJA.x) / CAJA.ancho) * 100}%`, top: `${((y - CAJA.y) / CAJA.alto) * 100}%` });

/** <data> con el marcado de trazabilidad del §4.6. `partir` separa la unidad para atenuarla. */
export function elementoCifra(c, { partir = false } = {}) {
  const d = document.createElement("data");
  d.value = String(c.valor);
  d.dataset.cifra = c.id;
  d.dataset.unidad = c.unidad;
  d.dataset.clase = c.clase;
  d.dataset.procedencia = c.procedencia;
  const corte = partir ? c.texto.lastIndexOf(" ") : -1;
  if (corte > 0) {
    const unidad = document.createElement("span");
    unidad.className = "u";
    unidad.textContent = c.texto.slice(corte);
    d.append(c.texto.slice(0, corte), unidad);
  } else {
    d.textContent = c.texto;
  }
  return d;
}

/** Dibuja el modelo en la figura: SVG (anillo, pista, rayos, ventana, muesca, marcador) y rótulos HTML. */
export function pintarArco(figura, m) {
  performance.mark?.("arco:pintar:inicio");
  const svg = figura.querySelector("svg");
  const capa = figura.querySelector(".arco-rotulos");
  const previo = memoria.get(figura);
  const animar = !quieto();
  svg.setAttribute("viewBox", `${CAJA.x} ${CAJA.y} ${CAJA.ancho} ${CAJA.alto}`);
  svg.replaceChildren();
  capa.replaceChildren();
  figura.dataset.estado = m.estado;

  const defs = nodo("defs", {}, svg);
  for (const tono of ["sol", "casa"]) {
    const patron = nodo("pattern", { id: `arco-rayado-${tono}`, width: 3, height: 3, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    nodo("rect", { width: 1.2, height: 3, class: `rayado-${tono}` }, patron);
  }

  const v = m.ventana;
  const n = v ? m.franjas.filter((f) => f.angulo !== null).length : 0;

  // Anillo horario exterior (E4): marca cada 15 min, mayor y numeral cada hora salvo los extremos.
  if (v) {
    const anillo = nodo("g", { class: "arco-anillo" }, svg);
    const pasoRotulo = n > 13 ? 2 : 1;
    for (let t = v.desde.getTime(), i = 0; t <= v.hasta.getTime(); t += HORA / 4, i++) {
      const a = angulo(t, v);
      const mayor = i % 4 === 0;
      raya(a, ANILLO, ANILLO + (mayor ? 7 : 3), mayor ? "marca-mayor" : "marca-menor", anillo);
      if (mayor && t > v.desde.getTime() && t < v.hasta.getTime() && (i / 4) % pasoRotulo === 0) {
        const r = document.createElement("span");
        r.className = "arco-hora";
        r.textContent = dos(new Date(t).getHours());
        Object.assign(r.style, enCaja(punto(a, ANILLO + 15)));
        capa.append(r);
      }
    }
  }

  nodo("line", { x1: 8, y1: CY, x2: 392, y2: CY, class: "arco-horizonte" }, svg);
  nodo("path", { d: arcoEntre(180, 0, R), class: "arco-pista" }, svg);
  const marcas = nodo("g", { class: "arco-marcas" }, svg);
  raya(180, R - 4, R + 8, "marca-mayor", marcas);
  raya(0, R - 4, R + 8, "marca-mayor", marcas);
  if (v) for (let t = v.desde.getTime() + HORA; t < v.hasta.getTime(); t += HORA) raya(angulo(t, v), R - 3, R + 3, "marca-menor", marcas);

  // Mejor ventana del aparato elegido (E5).
  const mejor = m.asesor?.mejor;
  if (v && mejor) {
    const t0 = Math.max(mejor.inicio.getTime(), v.desde.getTime());
    const t1 = Math.min(mejor.fin.getTime(), v.hasta.getTime());
    if (t1 > t0) {
      const g = nodo("g", { class: "arco-mejor" }, svg);
      nodo("path", { d: arcoEntre(angulo(t0, v), angulo(t1, v), R), class: "mejor-tramo" }, g);
      for (const t of [t0, t1]) raya(angulo(t, v), R - 5, R + 5, "mejor-tope", g);
    }
  }

  // Rayos
  const longitudes = new Map();
  const capaRayos = nodo("g", { class: "arco-rayos" }, svg);
  const grupos = new Map();
  let orden = 0;
  for (const r of rayosDe(m)) {
    let g = grupos.get(r.franja);
    if (!g) {
      g = nodo("g", { class: "franja", "data-franja": r.franja, transform: `rotate(${-r.angulo} ${CX} ${CY})` }, capaRayos);
      g.style.setProperty("--retraso", `${orden++ * 12}ms`);
      grupos.set(r.franja, g);
    }
    let el = null;
    if (r.tipo === "contorno") {
      el = nodo("rect", { x: CX + R + 6, y: CY - r.grosor / 2, width: r.longitud, height: r.grosor, class: `rayo contorno${r.discontinuo ? " discontinuo" : ""}${r.punteado ? " punteado" : ""}` }, g);
    } else if (r.tipo === "relleno") {
      el = nodo("rect", { x: CX + R + 6, y: CY - r.grosor / 2, width: r.longitud, height: r.grosor, class: `rayo relleno ${r.estado}${r.rayado ? " rayado" : ""}`, fill: r.rayado ? "url(#arco-rayado-sol)" : null }, g);
    } else if (r.tipo === "sin-dato") {
      nodo("circle", { cx: CX + R + 7, cy: CY, r: 1, class: "sin-dato" }, g);
    } else {
      el = nodo("rect", { x: CX + R - 6 - r.longitud, y: CY - 1.25, width: r.longitud, height: 2.5, class: `rayo ${r.tipo}${r.estado ? ` ${r.estado}` : ""}`, fill: r.estado === "parcial" ? "url(#arco-rayado-casa)" : null }, g);
      if (r.desborde) nodo("line", { x1: CX + R - 6 - LCASA, y1: CY - 3, x2: CX + R - 6 - LCASA, y2: CY + 3, class: "casa-desborde" }, g);
    }
    if (!el || !r.id) continue;
    el.setAttribute("data-cifra", r.id);
    longitudes.set(r.id, r.longitud);
    // Refresco: la longitud nueva se interpola desde la anterior, sin crecer desde cero (§4.7).
    const antes = previo?.longitudes.get(r.id);
    if (animar && !primeraDeLaSesion && antes && r.longitud > 0 && Math.abs(antes - r.longitud) > 0.01) {
      el.animate([{ scale: `${antes / r.longitud} 1` }, { scale: "1 1" }], { duration: 300, easing: CURVA });
    }
  }
  svg.classList.toggle("primera", primeraDeLaSesion && longitudes.size > 0);
  if (longitudes.size) primeraDeLaSesion = false;

  if (m.muesca && m.muesca.angulo !== null) {
    const g = nodo("g", { class: "arco-muesca", transform: `rotate(${-m.muesca.angulo} ${CX} ${CY})` }, svg);
    nodo("path", { d: `M${CX + R - 1} ${CY} l-6 -3.5 v7 z`, "data-cifra": "muesca" }, g);
  }

  const mk = m.marcador;
  if (mk.posicion === "pista") {
    const g = nodo("g", { class: `arco-marcador${mk.lleno ? " lleno" : ""}`, transform: `rotate(${-mk.angulo} ${CX} ${CY})` }, svg);
    const giro = nodo("g", { class: "marcador-giro" }, g);
    nodo("circle", { cx: CX + R, cy: CY, r: 14, class: "halo" }, giro);
    nodo("circle", { cx: CX + R, cy: CY, r: 7, class: "nucleo" }, giro);
    const antes = previo?.marcador;
    if (animar && typeof antes === "number" && Math.abs(antes - mk.angulo) > 0.05) {
      giro.animate([{ rotate: `${mk.angulo - antes}deg` }, { rotate: "0deg" }], { duration: 600, easing: CURVA });
    }
  } else if (mk.posicion) {
    nodo("circle", { cx: mk.posicion === "antes" ? CX - R : CX + R, cy: CY + 13, r: 5, class: `arco-marcador-fuera${mk.lleno ? " lleno" : ""}` }, svg);
  }

  memoria.set(figura, { marcador: mk.posicion === "pista" ? mk.angulo : null, longitudes });
  if (performance.measure) {
    try {
      performance.measure("arco:pintar", "arco:pintar:inicio");
    } catch {
      // Sin marcas de rendimiento el arco se pinta igual.
    }
  }
}

/** Resalta una franja del arco mientras se explora (null la quita). */
export function resaltarFranja(figura, ms) {
  figura.classList.toggle("explorando", ms !== null);
  for (const g of figura.querySelectorAll(".franja")) g.classList.toggle("activa", Number(g.dataset.franja) === ms);
}
