// Calculo determinista del informe diario a partir de la curva compacta de 5 minutos del
// archivo de SolarMAN: [t en segundos, solar, casa, compra, venta, carga, descarga, soc].
// Todo en hora de Madrid. Un canal ausente NO es cero: sin cobertura no hay energia ni euros.

import { limitesDia, partesMadrid, periodoMadrid, tipoDia, sumarDias } from "./horario.js";

const SENALES = ["solar", "casa", "compra", "venta", "carga", "descarga"];
const PASO = 300;
const PASO_MAXIMO = 450; // un hueco mayor solo cuenta un paso normal
const SALTO_SOC = 20;
const SALTO_MAX_SEGUNDOS = 900;
const IMPUESTO_ELECTRICO = 0.0511269632;
const IVA = 0.21;
const COBERTURA_BUENA = 0.9;
const COBERTURA_MINIMA = 0.5;

const redondear = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const valido = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const dosDigitos = (n) => String(n).padStart(2, "0");
const hhmm = (ms) => {
  const p = partesMadrid(ms);
  return `${dosDigitos(p.hora)}:${dosDigitos(p.minuto)}`;
};
const mediana = (xs) => {
  const o = [...xs].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

/** Integra el dia local `fecha` sin duplicar, recortando al dia y limitando huecos. */
export function integrarDia(puntos, fecha) {
  const { inicio, fin, horas } = limitesDia(fecha);
  const ini = inicio / 1000;
  const final = fin / 1000;

  const porInstante = new Map();
  for (const p of puntos || []) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || p[0] >= final) continue;
    const previo = porInstante.get(p[0]);
    porInstante.set(p[0], previo ? p.map((v, i) => (v ?? previo[i])) : p);
  }
  const ordenados = [...porInstante.values()].sort((a, b) => a[0] - b[0]);

  const total = SENALES.map(() => ({ ws: 0, seg: 0 }));
  const horario = Array.from({ length: horas }, () => ({ ws: SENALES.map(() => 0), seg: SENALES.map(() => 0) }));
  let muestras = 0;
  let ultimo = null;
  ordenados.forEach((p, i) => {
    const hueco = (ordenados[i + 1]?.[0] ?? p[0] + PASO) - p[0];
    const dt = hueco <= PASO_MAXIMO ? hueco : PASO;
    let a = Math.max(p[0], ini);
    const b = Math.min(p[0] + dt, final);
    if (p[0] >= ini) {
      muestras++;
      ultimo = p[0];
    }
    while (a < b) {
      const k = Math.min(Math.floor((a - ini) / 3600), horas - 1);
      const corte = Math.min(b, ini + (k + 1) * 3600);
      const largo = corte - a;
      SENALES.forEach((_, j) => {
        const v = p[j + 1];
        if (!valido(v)) return;
        total[j].ws += v * largo;
        total[j].seg += largo;
        horario[k].ws[j] += v * largo;
        horario[k].seg[j] += largo;
      });
      a = corte;
    }
  });

  const cobertura = {};
  const energia = {};
  SENALES.forEach((s, j) => {
    cobertura[s] = redondear(total[j].seg / (horas * 3600));
    energia[s] = total[j].seg ? redondear(total[j].ws / 3.6e6) : null;
  });

  const socs = ordenados.filter((p) => p[0] >= ini && typeof p[7] === "number" && Number.isFinite(p[7]) && p[7] >= 0 && p[7] <= 100);
  const soc = socs.length ? { min: Math.min(...socs.map((p) => p[7])), max: Math.max(...socs.map((p) => p[7])), inicio: socs[0][7], fin: socs.at(-1)[7], muestras: socs.length } : null;
  const saltosSoc = [];
  for (let i = 1; i < socs.length; i++) {
    const de = socs[i - 1][7];
    const a = socs[i][7];
    if (socs[i][0] - socs[i - 1][0] <= SALTO_MAX_SEGUNDOS && Math.abs(a - de) >= SALTO_SOC) {
      saltosSoc.push({ t: new Date(socs[i][0] * 1000).toISOString(), hora: hhmm(socs[i][0] * 1000), de, a });
    }
  }

  const socPorHora = new Map();
  for (const p of socs) socPorHora.set(Math.floor((p[0] - ini) / 3600), p[7]);
  const socFin = (k) => socPorHora.get(k) ?? null;
  const porHora = horario.map((h, k) => {
    const instante = inicio + k * 3600000;
    const fila = { indice: k, inicio: instante, hora: dosDigitos(partesMadrid(instante).hora), cobertura: {}, socFin: socFin(k) };
    SENALES.forEach((s, j) => {
      fila[s] = h.seg[j] ? redondear(h.ws[j] / 3.6e6) : null;
      fila.cobertura[s] = redondear(h.seg[j] / 3600);
    });
    return fila;
  });

  return { fecha, horasEsperadas: horas, muestras, ultimoDato: ultimo === null ? null : new Date(ultimo * 1000).toISOString(), cobertura, energia, soc, saltosSoc, porHora };
}

/** Totales diarios compactos para comparar dias y meses sin volver a integrar. */
export function resumirDia(integrado) {
  const r = { cob: {} };
  for (const s of SENALES) {
    r[s] = integrado.energia[s] === null ? null : redondear(integrado.energia[s], 3);
    r.cob[s] = redondear(integrado.cobertura[s], 2);
  }
  return r;
}

const completo = (d) => ["solar", "casa", "compra"].every((s) => (d?.cob?.[s] ?? 0) >= COBERTURA_BUENA && valido(d?.[s]));

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const precio = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 2;

/** Valida la tarifa configurada para `fecha`. Nunca usa un precio por defecto. */
export function evaluarTarifa(t, fecha) {
  const no = (motivo) => ({ valida: false, motivo });
  if (!t || typeof t !== "object") return no("No hay tarifa configurada.");
  if (!["plana", "periodos", "indexada"].includes(t.tipo)) return no("El tipo de tarifa no es valido.");
  if (typeof t.fuente !== "string" || !t.fuente.trim()) return no("Falta anotar de donde salen los precios.");
  if (typeof t.desde !== "string" || !FECHA.test(t.desde)) return no("Falta la fecha desde la que vale la tarifa.");
  if (t.hasta != null && t.hasta !== "" && !FECHA.test(t.hasta)) return no("La fecha de fin de la tarifa no es valida.");
  if (fecha < t.desde) return no("La tarifa configurada aun no estaba vigente ese dia.");
  if (t.hasta && fecha > t.hasta) return no("La tarifa configurada habia caducado ese dia.");
  if (t.tipo === "plana") {
    if (!precio(t.precio)) return no("El precio de la tarifa plana no es valido.");
    return { valida: true, tipo: "plana", precios: { P1: t.precio, P2: t.precio, P3: t.precio }, estimado: false };
  }
  if (t.tipo === "periodos") {
    if (!["P1", "P2", "P3"].every((p) => precio(t[p]))) return no("Faltan precios validos de P1, P2 y P3.");
    return { valida: true, tipo: "periodos", precios: { P1: t.P1, P2: t.P2, P3: t.P3 }, estimado: false };
  }
  const m = t.mediaHistorica;
  if (t.aceptaEstimacion !== true) return { valida: true, tipo: "indexada", precios: null, motivo: "Tarifa indexada: no hay precios horarios verificados para ese dia y no has aceptado una estimacion con medias historicas." };
  if (!m || !["P1", "P2", "P3"].every((p) => precio(m[p]))) return no("Faltan las medias historicas validas de P1, P2 y P3.");
  return { valida: true, tipo: "indexada", precios: { P1: m.P1, P2: m.P2, P3: m.P3 }, estimado: true };
}

const conImpuestos = (x) => x * (1 + IMPUESTO_ELECTRICO) * (1 + IVA);

/** Coste de la energia comprada ese dia (con impuestos; sin potencia, alquiler ni otros conceptos). */
export function costeDia(integrado, tarifa, fecha) {
  const sin = (motivo) => ({ estado: "no_disponible", motivo });
  const t = evaluarTarifa(tarifa, fecha);
  if (!t.valida) return sin(t.motivo);
  if (!t.precios) return sin(t.motivo);
  if (integrado.cobertura.compra < COBERTURA_BUENA) return sin("No hay datos de compra suficientes ese dia para calcular el coste.");
  let euros = 0;
  const periodos = { P1: { kwh: 0, euros: 0 }, P2: { kwh: 0, euros: 0 }, P3: { kwh: 0, euros: 0 } };
  for (const h of integrado.porHora) {
    if (!h.compra) continue;
    const p = periodoMadrid(h.inicio);
    const e = h.compra * conImpuestos(t.precios[p]);
    euros += e;
    periodos[p].kwh += h.compra;
    periodos[p].euros += e;
  }
  for (const p of Object.values(periodos)) {
    p.kwh = redondear(p.kwh, 3);
    p.euros = redondear(p.euros, 2);
  }
  const base = "Solo energia comprada, con impuesto electrico e IVA; no incluye potencia, alquiler de contador ni otros conceptos, asi que no es la factura.";
  return t.estimado
    ? { estado: "estimado", euros: redondear(euros, 2), periodos, fuentePrecios: tarifa.fuente, aviso: `Estimacion con medias historicas de una tarifa indexada, no con los precios reales de cada hora. ${base}` }
    : { estado: "disponible", euros: redondear(euros, 2), periodos, fuentePrecios: tarifa.fuente, aviso: base };
}

function ranking(integrado, coste, tarifaPrecios) {
  const porEuros = coste.estado === "disponible" || coste.estado === "estimado";
  const medianaCasa = mediana(integrado.porHora.filter((h) => h.cobertura.casa >= 0.75 && h.casa !== null).map((h) => h.casa));
  const candidatas = integrado.porHora.filter((h) => h.cobertura.compra >= 0.75 && (h.compra ?? 0) > 0.05);
  const fila = (h) => {
    const motivos = [];
    if (h.cobertura.solar >= 0.75 && h.solar !== null && h.solar < 0.05) motivos.push("casi sin producción solar en esa hora");
    if (h.cobertura.casa >= 0.75 && h.casa !== null && medianaCasa > 0 && h.casa >= 1.5 * medianaCasa) motivos.push("consumo de la casa por encima de lo habitual del día");
    if (h.socFin !== null && h.socFin <= 20) motivos.push(`nivel de batería indicado bajo (${h.socFin} %)`);
    if (h.cobertura.descarga >= 0.75 && (h.descarga ?? 0) > 0.05) motivos.push("descarga de batería observada en esa hora");
    const r = { hora: h.hora, inicio: new Date(h.inicio).toISOString(), compraKwh: redondear(h.compra, 2), motivos };
    if (porEuros) r.euros = redondear(h.compra * conImpuestos(tarifaPrecios[periodoMadrid(h.inicio)]), 2);
    return r;
  };
  const horas = candidatas.map(fila).sort((a, b) => (porEuros ? b.euros - a.euros || b.compraKwh - a.compraKwh : b.compraKwh - a.compraKwh) || a.inicio.localeCompare(b.inicio)).slice(0, 3);
  return { criterio: porEuros ? "euros" : "kwh", horas, nota: porEuros ? undefined : "Sin precios validos: se ordenan por energia comprada, no por coste." };
}

export function compararDias({ fecha, actual, diarios, festivos }) {
  if (!completo(actual)) return null;
  const tipo = tipoDia(fecha, festivos);
  const minimo = sumarDias(fecha, -28);
  const dias = Object.keys(diarios || {})
    .filter((d) => d < fecha && d >= minimo && tipoDia(d, festivos) === tipo && completo(diarios[d]))
    .sort()
    .reverse()
    .slice(0, 4);
  if (dias.length < 2) return null;
  const metricas = {};
  for (const s of ["solar", "casa", "compra"]) {
    const ref = mediana(dias.map((d) => diarios[d][s]));
    metricas[s] = { actual: actual[s], referencia: redondear(ref, 2), n: dias.length, difKwh: redondear(actual[s] - ref, 2), difPct: ref >= 0.5 ? Math.round(((actual[s] - ref) / ref) * 100) : null };
  }
  return { tipoDia: tipo, dias, metricas };
}

export function acumuladoMes({ fecha, diarios }) {
  const mes = fecha.slice(0, 7);
  const n = Number(fecha.slice(8));
  const anterior = sumarDias(`${mes}-01`, -1).slice(0, 7);
  const suma = (meses, dias) => {
    const r = { solar: 0, casa: 0, compra: 0 };
    for (const d of dias) for (const s of Object.keys(r)) r[s] += diarios[`${meses}-${dosDigitos(d)}`][s];
    for (const s of Object.keys(r)) r[s] = redondear(r[s], 2);
    return r;
  };
  const dias = Array.from({ length: n }, (_, i) => i + 1);
  const buenos = dias.filter((d) => completo(diarios?.[`${mes}-${dosDigitos(d)}`]));
  const iguales = buenos.filter((d) => completo(diarios?.[`${anterior}-${dosDigitos(d)}`]));
  return {
    mes,
    diasTranscurridos: n,
    diasCompletos: buenos.length,
    actual: suma(mes, buenos),
    comparable: iguales.length ? { diasIguales: iguales.length, mesActual: suma(mes, iguales), mesAnterior: suma(anterior, iguales), mesAnteriorClave: anterior } : null,
    aviso: `Acumulado observado de ${buenos.length} de ${n} días del mes con datos completos; no es el mes completo ni una factura, y no se extrapola.`,
  };
}

const kwh = (x) => `${redondear(x, 1).toString().replace(".", ",")} kWh`;
const euros = (x) => x.toFixed(2).replace(".", ",");

export function construirInforme({ puntos, fecha, ahora, config = {}, diarios = {} }) {
  const integrado = integrarDia(puntos, fecha);
  const fuente = { nombre: "SolarMAN (archivo del servidor)", datadis: false, nota: "Datos de SolarMAN guardados en el servidor. No usa Datadis ni facturas: son estimaciones, no el contador oficial.", ultimoDato: integrado.ultimoDato };
  const base = { version: 1, fecha, tipoDia: tipoDia(fecha), generado: new Date(ahora).toISOString(), fuente, horasEsperadas: integrado.horasEsperadas, cobertura: integrado.cobertura };
  const necesarias = ["solar", "casa", "compra"].map((s) => integrado.cobertura[s]);

  if (!integrado.muestras || Math.max(...necesarias) < 0.25) {
    return { ...base, estado: "sin_datos", energia: null, soc: null, saltosSoc: [], coste: { estado: "no_disponible", motivo: "No hay datos de ese dia." }, ranking: null, comparacion: null, mes: null, hoy: null, conclusiones: [{ tipo: "aviso", texto: "SolarMAN no tiene datos suficientes de ayer en el servidor, así que no se puede valorar el día. No es que no hayas gastado: simplemente no hay datos." }] };
  }

  const estado = necesarias.every((c) => c >= COBERTURA_BUENA) ? "ok" : "parcial";
  const energia = {};
  for (const s of SENALES) {
    const c = integrado.cobertura[s];
    energia[s] = c >= COBERTURA_MINIMA && integrado.energia[s] !== null ? { kwh: redondear(integrado.energia[s], 2), cobertura: c, minimo: c < COBERTURA_BUENA } : null;
  }
  const coste = costeDia(integrado, config.tarifa, fecha);
  const evaluada = evaluarTarifa(config.tarifa, fecha);
  const rank = integrado.cobertura.compra >= COBERTURA_MINIMA ? ranking(integrado, coste, evaluada.precios) : null;
  const resumen = resumirDia(integrado);
  const comparacion = compararDias({ fecha, actual: resumen, diarios });
  const mes = acumuladoMes({ fecha, diarios: { ...diarios, [fecha]: resumen } });

  const c = [];
  if (estado === "parcial") c.push({ tipo: "aviso", texto: `Cobertura incompleta de ayer (${Math.round(Math.min(...necesarias) * 100)} % del tiempo en el canal peor cubierto): las cifras son lo observado, como mínimo, no el total del día.` });
  const m = (x) => (energia[x] ? `${energia[x].minimo ? "al menos " : ""}${kwh(energia[x].kwh)}` : null);
  if (m("compra")) c.push({ tipo: "dato", texto: `Compraste a la red ${m("compra")}.` });
  if (m("solar")) c.push({ tipo: "dato", texto: `Tus placas produjeron ${m("solar")}${m("casa") ? ` y la casa consumió ${m("casa")}` : ""}.` });
  else if (m("casa")) c.push({ tipo: "dato", texto: `La casa consumió ${m("casa")}.` });
  if (m("venta")) c.push({ tipo: "dato", texto: `Vertiste a la red ${m("venta")}.` });
  if (energia.carga && energia.descarga) c.push({ tipo: "dato", texto: `La batería cargó ${kwh(energia.carga.kwh)} y descargó ${kwh(energia.descarga.kwh)} (medido por el inversor).` });
  if (integrado.soc) c.push({ tipo: "dato", texto: `Nivel de batería indicado: entre ${integrado.soc.min} % y ${integrado.soc.max} % (empezó en ${integrado.soc.inicio} % y acabó en ${integrado.soc.fin} %).` });
  if (rank?.horas.length) {
    const h = rank.horas[0];
    c.push({ tipo: "patron", texto: `La hora de compra más ${rank.criterio === "euros" ? "cara" : "alta"} fue la de las ${h.hora}:00 (${kwh(h.compraKwh)}${h.euros !== undefined ? `, ≈ ${euros(h.euros)} €` : ""})${h.motivos.length ? `: ${h.motivos.join("; ")}` : ""}.` });
  }
  for (const s of integrado.saltosSoc.slice(0, 3)) c.push({ tipo: "aviso", texto: `A las ${s.hora} el nivel de batería indicado cambió de golpe de ${s.de} % a ${s.a} %. Es un cambio del valor indicado por el inversor; no se interpreta como un diagnóstico de la batería.` });
  if (coste.estado === "no_disponible") c.push({ tipo: "aviso", texto: `Coste en euros no disponible: ${coste.motivo}` });
  else c.push({ tipo: "dato", texto: `Coste de la energía comprada ${coste.estado === "estimado" ? "(estimación con medias históricas)" : ""}: ≈ ${euros(coste.euros)} €. ${coste.aviso}` });
  if (comparacion) {
    const x = comparacion.metricas.compra;
    c.push({ tipo: "dato", texto: `Frente a la mediana de ${x.n} días ${comparacion.tipoDia === "finde" ? "de fin de semana o festivo" : "laborables"} recientes, compraste ${x.difKwh >= 0 ? "+" : ""}${kwh(x.difKwh)}${x.difPct !== null ? ` (${x.difPct >= 0 ? "+" : ""}${x.difPct} %)` : ""}.` });
  }
  if (integrado.ultimoDato && new Date(integrado.ultimoDato).getTime() < limitesDia(fecha).fin - 3600000) c.push({ tipo: "aviso", texto: `El último dato recibido es de las ${hhmm(new Date(integrado.ultimoDato).getTime())}; los datos finales del día pueden estar pendientes.` });

  return { ...base, estado, energia, soc: integrado.soc, saltosSoc: integrado.saltosSoc, coste, ranking: rank, comparacion, mes, hoy: null, conclusiones: c, resumenDia: resumen };
}
