// Motor de decision. Determinista y explicable: simula la casa hora a hora con
// y sin la carga y cobra la diferencia. Asi la bateria nunca sale "gratis":
// gastarla ahora se paga en compras de mas despues.

import { simular } from "./simulador.js";
import { CARGA_REFERENCIA } from "./aparatos.js";

const HORA = 3600000;
const MINUTOS_VIVO = 20;

// Medido en el export de mayo y junio de 2026 salvo el rendimiento, que es estimado.
export const BATERIA_POR_DEFECTO = { capacidadKwh: 5.1, socMinimoPct: 10, rendimiento: 0.9, maxCargaKw: 1.9, maxDescargaKw: 3.8 };
export const UMBRALES = { ahorro: 0.15, rojo: 0.75, verde: 0.5 };

const RANGO = { ninguna: 0, baja: 1, media: 2, alta: 3 };
const peor = (lista) => lista.reduce((a, b) => (RANGO[b] < RANGO[a] ? b : a), "alta");

const inicioDeHora = (t) => {
  const d = new Date(t);
  d.setMinutes(0, 0, 0);
  return d.getTime();
};

/** Tramos desde ahora: el primero hasta la siguiente hora en punto, el resto de una hora. */
export function construirHorizonte({ ahora, vivo, solar = [], habitos, tarifa, horas = 36 }) {
  const previsto = new Map(solar.map((s) => [s.inicio.getTime(), s]));
  const vivoFresco = vivo && ahora - vivo.instante <= MINUTOS_VIVO * 60000;
  const slots = [];
  let inicio = ahora.getTime();
  for (let i = 0; i < horas; i++) {
    const fin = inicioDeHora(inicio) + HORA;
    const fraccion = (fin - inicio) / HORA;
    const instante = new Date(inicio);
    let solarKwh, origenSolar, confianzaSolar, casaKwh, origenCasa, confianzaCasa;

    if (i === 0 && vivoFresco) {
      solarKwh = (vivo.solarW / 1000) * fraccion;
      casaKwh = (vivo.casaW / 1000) * fraccion;
      origenSolar = origenCasa = "real";
      confianzaSolar = confianzaCasa = "alta";
    } else {
      const s = previsto.get(inicioDeHora(inicio));
      if (s) {
        solarKwh = s.kwh * fraccion;
        origenSolar = s.origen;
        confianzaSolar = s.confianza;
      } else {
        const tipica = habitos.solarTipica(instante.getHours());
        solarKwh = (tipica ?? 0) * fraccion;
        origenSolar = tipica === null ? "ninguno" : "habito";
        confianzaSolar = "baja";
      }
      const c = habitos.consumo(instante);
      casaKwh = c.kwh * fraccion;
      origenCasa = c.origen;
      confianzaCasa = c.confianza;
    }

    slots.push({
      inicio: instante,
      fin: new Date(fin),
      horas: fraccion,
      solarKwh,
      casaKwh,
      compra: tarifa.precioCompra(instante),
      venta: tarifa.precioVenta(instante),
      origenSolar,
      origenCasa,
      // De noche la prevision solar no cuenta: no hay nada que prever.
      confianza: solarKwh < 0.05 ? confianzaCasa : peor([confianzaSolar, confianzaCasa]),
    });
    inicio = fin;
  }
  return slots;
}

/** Reparte la energia de la carga entre los tramos que pisa. */
function repartir(slots, inicio, duracionH, energiaKwh) {
  const fin = inicio + duracionH * HORA;
  return slots.map((s) => {
    const solape = Math.max(0, Math.min(s.fin.getTime(), fin) - Math.max(s.inicio.getTime(), inicio)) / HORA;
    return (energiaKwh * solape) / duracionH;
  });
}

const suma = (pasos, campo) => pasos.reduce((total, p) => total + p[campo], 0);

function evaluador(slots, bateria, socPct) {
  // Lo que queda en la bateria al final del horizonte evita compras futuras.
  const valorFinal = slots.at(-1).compra * bateria.rendimiento;
  const valorar = (r) => r.coste - r.energiaUtilFinalKwh * valorFinal;
  const base = simular(slots, bateria, socPct);
  const valorBase = valorar(base);
  const evaluar = (inicio, carga) => {
    const extra = repartir(slots, inicio, carga.duracionH, carga.energiaKwh);
    const con = simular(slots.map((s, i) => ({ ...s, extraKwh: extra[i] })), bateria, socPct);
    const enVentana = extra.map((e) => e > 0);
    return {
      inicio: new Date(inicio),
      fin: new Date(inicio + carga.duracionH * HORA),
      coste: valorar(con) - valorBase,
      deRedKwh: suma(con.pasos, "importKwh") - suma(base.pasos, "importKwh"),
      deRedEnVentanaKwh: con.pasos.reduce((t, p, i) => t + (enVentana[i] ? p.importKwh - base.pasos[i].importKwh : 0), 0),
      solarPerdidoKwh: suma(base.pasos, "exportKwh") - suma(con.pasos, "exportKwh"),
      solarEnVentanaKwh: slots.reduce((t, s, i) => t + (enVentana[i] ? s.solarKwh : 0), 0),
    };
  };
  evaluar.seLlena = base.pasos.some((p) => p.socPct >= 98);
  return evaluar;
}

function clasificar(rel, ahorroRel, excede, u) {
  if (excede) return "rojo";
  if (ahorroRel >= u.ahorro) return rel >= u.rojo ? "rojo" : "amarillo";
  return rel < u.verde ? "verde" : "amarillo";
}

const TITULOS = {
  verde: "Buen momento",
  amarillo: "Mejor espera",
  amarilloSinVentana: "Sin ventana mejor",
  rojo: "Evita ahora",
  potencia: "Pasarías de potencia",
};

const fmt = (x, decimales = 2) => x.toLocaleString("es-ES", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
export const euros = (x) => `≈ ${fmt(Math.max(x, 0))} €`;
const kw = (w) => `${fmt(w / 1000, 2)} kW`;
const kwh = (x) => `${fmt(x, 1)} kWh`;
const centimos = (x) => `${fmt(x * 100, 1)} c€/kWh`;
export function cuando(fecha, ahora) {
  const hora = fecha.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (Math.abs(fecha - ahora) < 60000) return "Ahora";
  const dias = Math.round((inicioDia(fecha) - inicioDia(ahora)) / 86400000);
  return dias === 0 ? `A las ${hora}` : dias === 1 ? `Mañana a las ${hora}` : `${fecha.toLocaleDateString("es-ES", { weekday: "long" })} a las ${hora}`;
}
const inicioDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function candidatosDe(ahora, slots, carga, buscarHoras) {
  const finHorizonte = slots.at(-1).fin.getTime();
  const limite = ahora.getTime() + buscarHoras * HORA;
  return [ahora.getTime(), ...slots.slice(1).map((s) => s.inicio.getTime())].filter(
    (t) => t <= limite && t + carga.duracionH * HORA <= finHorizonte
  );
}

const referenciaDe = (ahora, slots, carga, buscarHoras) => {
  const limite = ahora.getTime() + buscarHoras * HORA;
  return carga.energiaKwh * Math.max(...slots.filter((s) => s.inicio.getTime() < limite).map((s) => s.compra));
};

export function decidir({
  ahora, slots, bateria = BATERIA_POR_DEFECTO, socPct, carga = CARGA_REFERENCIA,
  umbrales = UMBRALES, potenciaContratadaKw = null, buscarHoras = 24, vivo = null,
}) {
  const inicios = candidatosDe(ahora, slots, carga, buscarHoras);
  if (!inicios.length) {
    return { estado: null, titulo: "Sin previsión suficiente", carga, razones: [{ icono: "📡", texto: "El programa dura más que la previsión disponible." }] };
  }
  const evaluar = evaluador(slots, bateria, socPct);
  const candidatos = inicios.map((t) => evaluar(t, carga));
  const yaMismo = candidatos[0];
  let mejor = candidatos.reduce((a, b) => (b.coste < a.coste - 1e-9 ? b : a));
  // Por unos centimos no merece la pena hacer esperar a nadie.
  if (yaMismo.coste - mejor.coste < 0.005) mejor = yaMismo;

  const referencia = referenciaDe(ahora, slots, carga, buscarHoras);
  const rel = yaMismo.coste / referencia;
  const ahorro = yaMismo.coste - mejor.coste;
  const ahorroRel = ahorro / referencia;

  const primero = slots[0];
  const conBateria = socPct > bateria.socMinimoPct + 1 ? bateria.maxDescargaKw : 0;
  const picoKw = primero.casaKwh / primero.horas + carga.potenciaPicoW / 1000 - primero.solarKwh / primero.horas - conBateria;
  const excedePotencia = potenciaContratadaKw !== null && picoKw > potenciaContratadaKw;

  const estado = clasificar(rel, ahorroRel, excedePotencia, umbrales);
  const titulo = excedePotencia ? TITULOS.potencia
    : estado === "amarillo" && mejor === yaMismo ? TITULOS.amarilloSinVentana
    : TITULOS[estado];

  const alternativas = [];
  for (const c of [...candidatos].sort((a, b) => a.coste - b.coste)) {
    if (alternativas.length === 3) break;
    const pisa = [mejor, ...alternativas].some((o) => Math.abs(o.inicio - c.inicio) < carga.duracionH * HORA);
    if (!pisa) alternativas.push(c);
  }

  const enJuego = slots.filter((s) => s.inicio < mejor.fin);
  let confianza = peor(enJuego.map((s) => s.confianza));
  if (!vivo) confianza = peor([confianza, "media"]);

  const razones = explicar({ ahora, slots, bateria, socPct, carga, vivo, yaMismo, mejor, ahorro, excedePotencia, potenciaContratadaKw, picoKw });
  if (mejor === yaMismo && rel >= umbrales.verde) {
    razones.push({
      icono: "🧭",
      texto: evaluar.seLlena
        ? "No hay una hora claramente mejor en las próximas 24 h."
        : "Con el sol previsto la batería no llegará a llenarse: gastes ahora o más tarde, ese consumo acabará saliéndote de la red. Da igual cuándo.",
    });
  }

  return { estado, titulo, carga, ahora: yaMismo, mejor, alternativas, ahorro, referencia, rel, excedePotencia, confianza, razones, candidatos };
}

function explicar({ ahora, slots, bateria, socPct, carga, vivo, yaMismo, mejor, ahorro, excedePotencia, potenciaContratadaKw, picoKw }) {
  const razones = [];
  const primero = slots[0];
  if (vivo) {
    razones.push({ icono: "☀️", texto: `Solar ${kw(vivo.solarW)}` });
    razones.push({ icono: "🏠", texto: `Casa ${kw(vivo.casaW)}` });
  } else {
    razones.push({ icono: "📡", texto: "Sin dato en vivo: uso lo habitual a esta hora y la previsión." });
  }
  razones.push({ icono: "🔋", texto: `Batería ${Math.round(socPct)} %${socPct <= bateria.socMinimoPct + 2 ? " (en la reserva mínima)" : ""}` });

  const sobranteKw = (primero.solarKwh - primero.casaKwh) / primero.horas;
  if (sobranteKw >= 0.3) {
    razones.push({
      icono: "☀️",
      texto: socPct >= 98
        ? `Sobran ${kw(sobranteKw * 1000)} de sol y la batería está llena: se venderían a ${centimos(primero.venta)}.`
        : `Sobran ${kw(sobranteKw * 1000)} de sol, que ahora van a la batería.`,
    });
  }

  if (yaMismo.solarPerdidoKwh >= carga.energiaKwh * 0.6) {
    razones.push({ icono: "💶", texto: `Ahora saldría casi todo del sol sobrante: ${euros(yaMismo.coste)}.` });
  } else if (yaMismo.deRedKwh > 0.05) {
    const bateriaTapa = yaMismo.deRedEnVentanaKwh < yaMismo.deRedKwh * 0.5;
    razones.push({
      icono: "🔌",
      texto: bateriaTapa
        ? `La batería lo cubriría ahora, pero se vaciaría antes y tocaría comprar ≈ ${kwh(yaMismo.deRedKwh)} más tarde: ${euros(yaMismo.coste)}.`
        : `≈ ${kwh(yaMismo.deRedKwh)} saldrían de la red: ${euros(yaMismo.coste)}.`,
    });
  }

  if (mejor !== yaMismo) {
    razones.push({ icono: "⏰", texto: `${cuando(mejor.inicio, ahora)}: ${euros(mejor.coste)} (ahorras ${euros(ahorro)}).` });
    if (mejor.solarEnVentanaKwh >= carga.energiaKwh * 0.5) {
      razones.push({ icono: "🌤️", texto: `Se esperan ≈ ${kwh(mejor.solarEnVentanaKwh)} de sol en esa franja.` });
    }
  }

  const proximas = slots.filter((s) => s.inicio - ahora < 24 * HORA);
  const barata = proximas.reduce((a, b) => (b.compra < a.compra ? b : a));
  if (primero.compra - barata.compra > 0.02) {
    razones.push({ icono: "💶", texto: `Luz de la red ahora: ${centimos(primero.compra)}. La más barata: ${centimos(barata.compra)} ${cuando(barata.inicio, ahora).toLowerCase()}.` });
  }

  if (excedePotencia) {
    razones.push({ icono: "⚡", texto: `Con lo que ya está encendido llegarías a ≈ ${fmt(picoKw, 1)} kW y tienes ${fmt(potenciaContratadaKw, 1)} kW contratados.` });
  }
  return razones;
}

/** Estado por hora de las proximas 24 h para una carga. */
export function lineaDelDia({ ahora, slots, bateria = BATERIA_POR_DEFECTO, socPct, carga = CARGA_REFERENCIA, umbrales = UMBRALES, horas = 24 }) {
  const inicios = candidatosDe(ahora, slots, carga, horas - 1);
  if (!inicios.length) return [];
  const evaluar = evaluador(slots, bateria, socPct);
  const evaluados = inicios.map((t) => evaluar(t, carga));
  const minimo = Math.min(...evaluados.map((c) => c.coste));
  const referencia = referenciaDe(ahora, slots, carga, horas);
  return evaluados.map((c) => ({
    inicio: c.inicio,
    coste: c.coste,
    estado: clasificar(c.coste / referencia, (c.coste - minimo) / referencia, false, umbrales),
  }));
}

/**
 * Bateria que conviene guardar: lo que la casa gastara desde que deje de haber
 * sol hasta que vuelva a cubrir el consumo, mas la reserva minima.
 */
export function reservaRecomendada({ slots, bateria = BATERIA_POR_DEFECTO, socPct }) {
  const falta = (s) => s.casaKwh - s.solarKwh > 1e-6;
  const desdeIndice = slots.findIndex(falta);
  if (desdeIndice < 0) return null;
  let necesidadKwh = 0;
  let hasta = null;
  for (let i = desdeIndice; i < slots.length; i++) {
    const s = slots[i];
    if (!falta(s)) {
      hasta = s.inicio;
      break;
    }
    necesidadKwh += s.casaKwh - s.solarKwh;
  }
  const entregable = necesidadKwh / Math.sqrt(bateria.rendimiento);
  const pct = Math.min(100, bateria.socMinimoPct + (entregable / bateria.capacidadKwh) * 100);
  return {
    pct,
    necesidadKwh: entregable,
    desde: slots[desdeIndice].inicio,
    hasta,
    sinSol: hasta === null,
    aplicaAhora: desdeIndice === 0,
    suficiente: socPct >= pct,
  };
}
