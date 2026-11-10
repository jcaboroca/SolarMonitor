// Calculo determinista del informe diario a partir de la curva compacta de 5 minutos del
// archivo de SolarMAN: [t en segundos, solar, casa, compra, venta, carga, descarga, soc].
// Todo en hora de Madrid. Un canal ausente NO es cero: sin cobertura no hay energia ni euros.

import { limitesDia, partesMadrid, periodoMadrid, tipoDia, sumarDias, diaMadrid } from "./horario.js";

const SENALES = ["solar", "casa", "compra", "venta", "carga", "descarga"];
const PASO = 300;
const PASO_MAXIMO = 450; // un hueco mayor solo cuenta un paso normal
const SALTO_SOC = 20;
const SALTO_MAX_SEGUNDOS = 900;
const IMPUESTO_ELECTRICO = 0.0511269632;
const IVA = 0.21;
// Un dia solo es completo si no le falta tiempo medido: la unica holgura es de 30 s (desfase de reloj en
// los bordes del dia), nunca minutos reales omitidos. La cobertura se guarda sin redondear a decenas
// de centesimas y solo se redondea al presentar. COBERTURA_MINIMA basta para mostrar lo observado como minimo; el coste necesita COBERTURA_COSTE.
const HOLGURA = 30 / (23 * 3600); // 30 s sobre el dia mas corto (23 h)
export const coberturaCompleta = (c) => typeof c === "number" && c >= 1 - HOLGURA;
const COBERTURA_MINIMA = 0.5;
const COBERTURA_COSTE = 0.75;
const SOC_BORDE = 1800; // una lectura a menos de 30 min del limite del dia vale como inicio o final

const redondear = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const valido = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
/** El nivel de bateria indicado solo vale entre 0 y 100; un cero real es una medida valida. */
export const socValido = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
/** Valor valido de la columna `i` de la curva compacta (1..6 potencias, 7 nivel de bateria). */
export const valorValido = (i, v) => (i === 7 ? socValido(v) : valido(v));
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

/**
 * Reglas unicas de intervalos para el dia y para las horas: sin duplicar instantes, recortando al dia,
 * un hueco grande solo cuenta un paso normal y solo suma tiempo con valor valido en cada senal.
 */
function intervalos(puntos, fecha) {
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
  return { inicio, ini, final, horas, ordenados, total, horario, muestras, ultimo };
}

/** Integra el dia local `fecha` sin duplicar, recortando al dia y limitando huecos. */
export function integrarDia(puntos, fecha) {
  const { inicio, ini, final, horas, ordenados, total, horario, muestras, ultimo } = intervalos(puntos, fecha);
  const cobertura = {};
  const energia = {};
  SENALES.forEach((s, j) => {
    cobertura[s] = total[j].seg / (horas * 3600);
    energia[s] = total[j].seg ? redondear(total[j].ws / 3.6e6) : null;
  });

  const socs = ordenados.filter((p) => p[0] >= ini && socValido(p[7]));
  const socPorHora = new Map();
  for (const p of socs) socPorHora.set(Math.floor((p[0] - ini) / 3600), p[7]);
  const soc = socs.length
    ? {
        min: Math.min(...socs.map((p) => p[7])),
        max: Math.max(...socs.map((p) => p[7])),
        inicio: socs[0][7],
        fin: socs.at(-1)[7],
        muestras: socs.length,
        primera: new Date(socs[0][0] * 1000).toISOString(),
        ultima: new Date(socs.at(-1)[0] * 1000).toISOString(),
        primeraHora: hhmm(socs[0][0] * 1000),
        ultimaHora: hhmm(socs.at(-1)[0] * 1000),
        inicioCercano: socs[0][0] - ini <= SOC_BORDE,
        finCercano: final - socs.at(-1)[0] <= SOC_BORDE,
        cobertura: redondear(socPorHora.size / horas, 2),
      }
    : null;
  const saltosSoc = [];
  for (let i = 1; i < socs.length; i++) {
    const de = socs[i - 1][7];
    const a = socs[i][7];
    if (socs[i][0] - socs[i - 1][0] <= SALTO_MAX_SEGUNDOS && Math.abs(a - de) >= SALTO_SOC) {
      saltosSoc.push({ t: new Date(socs[i][0] * 1000).toISOString(), hora: hhmm(socs[i][0] * 1000), de, a });
    }
  }

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

/**
 * Filas horarias para el archivo con las mismas reglas que el dia: [hora desde 1970, casa Wh, solar Wh,
 * SoC al final, minutos de casa medidos, minutos de solar medidos]. Un dato ausente no suma ni cuenta tiempo.
 */
export function horasDeDia(puntos, fecha) {
  const { inicio, ini, ordenados, horario, horas } = intervalos(puntos, fecha);
  const socPorHora = new Map();
  for (const p of ordenados) if (p[0] >= ini && socValido(p[7])) socPorHora.set(Math.floor((p[0] - ini) / 3600), p[7]);
  const filas = [];
  for (let k = 0; k < horas; k++) {
    const h = horario[k];
    const soc = socPorHora.get(k) ?? null;
    if (!h.seg.some((x) => x > 0) && soc === null) continue;
    filas.push([(inicio + k * 3600000) / 3600000, Math.round(h.ws[1] / 3600), Math.round(h.ws[0] / 3600), soc, Math.round(h.seg[1] / 60), Math.round(h.seg[0] / 60)]);
  }
  return filas;
}

/** Totales diarios compactos para comparar dias y meses sin volver a integrar. */
export function resumirDia(integrado) {
  const r = { cob: {} };
  for (const s of SENALES) {
    r[s] = integrado.energia[s] === null ? null : redondear(integrado.energia[s], 3);
    r.cob[s] = redondear(integrado.cobertura[s], 6);
  }
  return r;
}

const completo = (d) => ["solar", "casa", "compra"].every((s) => coberturaCompleta(d?.cob?.[s]) && valido(d?.[s]));

export const diaCompleto = completo;

// Huella no criptografica (dos FNV-1a de 32 bits) para detectar que el contenido aceptado cambio.
function huella(texto) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
/** Version del contenido integrado de un dia: cambia con cualquier valor, cobertura o muestra distintos. */
export const versionIntegrado = (integrado) => huella(JSON.stringify(integrado));
let limitesDependencias;
/** Dias anteriores que pueden entrar en la comparacion o en el acumulado de `fecha` (superconjunto, sin mirar si estan completos). */
export function esDependencia(dia, fecha) {
  if (!(dia < fecha)) return false;
  // Todos los dias del lote comparten los mismos limites; se conserva solo la ultima fecha.
  if (limitesDependencias?.fecha !== fecha) {
    const mes = fecha.slice(0, 7);
    limitesDependencias = { fecha, mes, anterior: sumarDias(`${mes}-01`, -1).slice(0, 7), minimo: sumarDias(fecha, -28), tipo: tipoDia(fecha) };
  }
  const { mes, anterior, minimo, tipo } = limitesDependencias;
  if (dia.slice(0, 7) === mes) return true;
  if (dia.slice(0, 7) === anterior) return Number(dia.slice(8)) <= Number(fecha.slice(8));
  return dia >= minimo && tipoDia(dia) === tipo;
}

/** Version de lo que de verdad usa el informe de `fecha`: los dias completos del mes, del mes anterior y de la comparacion, con sus totales. */
export function versionDependencias(diarios, fecha) {
  const mes = fecha.slice(0, 7);
  const anterior = sumarDias(`${mes}-01`, -1).slice(0, 7);
  const n = Number(fecha.slice(8));
  const delPeriodo = (d) => d < fecha && (d.startsWith(mes) || (d.startsWith(anterior) && Number(d.slice(8)) <= n));
  const usados = new Set(Object.keys(diarios || {}).filter((d) => delPeriodo(d) && completo(diarios[d])));
  const comp = compararDias({ fecha, actual: { solar: 0, casa: 0, compra: 0, cob: { solar: 1, casa: 1, compra: 1 } }, diarios });
  for (const d of comp?.dias || []) usados.add(d);
  const claves = [...usados].sort();
  return huella(JSON.stringify(claves.map((d) => [d, diarios[d].solar, diarios[d].casa, diarios[d].compra])));
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const precio = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 2;

/** Valida la tarifa configurada para `fecha`. Nunca usa un precio por defecto. */
export function evaluarTarifa(t, fecha, mercado = null) {
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
  if (t.mercado != null) {
    const m = t.mercado;
    if (t.aceptaEstimacion !== true) return no("Debes aceptar la estimacion con precios REE y componentes orientativos.");
    if (!precio(m.suplemento) || !["P1", "P2", "P3"].every((p) => precio(m.peajes?.[p]))) return no("Faltan suplemento, peajes y cargos validos para estimar la tarifa.");
    const horarios = new Map();
    const { inicio, fin } = limitesDia(fecha);
    if (mercado?.desde <= fecha && mercado?.hasta >= fecha) {
      for (const [instante, spot] of mercado.horas || []) {
        if (Number.isFinite(instante) && instante >= inicio && instante < fin && Number.isFinite(spot)) {
          horarios.set(instante, spot + m.suplemento + m.peajes[periodoMadrid(instante)]);
        }
      }
    }
    return { valida: true, tipo: "indexada", precios: null, horarios, estimado: true,
      motivo: "No hay precios REE completos para las horas de compra de ese dia." };
  }
  const m = t.mediaHistorica;
  if (t.aceptaEstimacion !== true) return { valida: true, tipo: "indexada", precios: null, motivo: "Tarifa indexada: no hay precios horarios verificados para ese dia y no has aceptado una estimacion con medias historicas." };
  if (!m || !["P1", "P2", "P3"].every((p) => precio(m[p]))) return no("Faltan las medias historicas validas de P1, P2 y P3.");
  return { valida: true, tipo: "indexada", precios: { P1: m.P1, P2: m.P2, P3: m.P3 }, estimado: true };
}

const conImpuestos = (x) => x * (1 + IMPUESTO_ELECTRICO) * (1 + IVA);

/** Coste de la energia comprada ese dia (con impuestos; sin potencia, alquiler ni otros conceptos). */
export function costeDia(integrado, tarifa, fecha, mercado = null) {
  const sin = (motivo) => ({ estado: "no_disponible", motivo });
  const t = evaluarTarifa(tarifa, fecha, mercado);
  if (!t.valida) return sin(t.motivo);
  if (!t.precios && !t.horarios?.size) return sin(t.motivo);
  const cob = integrado.cobertura.compra;
  if (cob < COBERTURA_COSTE) return sin("No hay datos de compra suficientes ese dia para calcular el coste.");
  const parcial = !coberturaCompleta(cob);
  let euros = 0;
  const periodos = { P1: { kwh: 0, euros: 0 }, P2: { kwh: 0, euros: 0 }, P3: { kwh: 0, euros: 0 } };
  for (const h of integrado.porHora) {
    if (!h.compra) continue;
    const p = periodoMadrid(h.inicio);
    const precioHora = t.horarios ? t.horarios.get(h.inicio) : t.precios[p];
    if (!Number.isFinite(precioHora)) return sin(t.motivo);
    const e = h.compra * conImpuestos(precioHora);
    euros += e;
    periodos[p].kwh += h.compra;
    periodos[p].euros += e;
  }
  for (const p of Object.values(periodos)) {
    p.kwh = redondear(p.kwh, 3);
    p.euros = redondear(p.euros, 2);
  }
  const nota = "Solo energia comprada, con impuesto electrico e IVA; no incluye potencia, alquiler de contador ni otros conceptos, asi que no es la factura.";
  const faltan = parcial ? `${t.horarios ? "Importe observado" : "Minimo observado"}: solo hay datos de compra del ${Math.round(cob * 100)} % del dia y no se ha extrapolado el resto. ` : "";
  const estimacion = t.horarios
    ? "Estimacion con precios horarios REE (media de cuatro cuartos), suplemento y peajes orientativos; no es el precio final verificado de Octopus Flexi."
    : "Estimacion con medias historicas de una tarifa indexada, no con los precios reales de cada hora.";
  const r = t.estimado
    ? { estado: "estimado", euros: redondear(euros, 2), periodos, fuentePrecios: tarifa.fuente, aviso: `${faltan}${estimacion} ${nota}` }
    : { estado: "disponible", euros: redondear(euros, 2), periodos, fuentePrecios: tarifa.fuente, aviso: `${faltan}${nota}` };
  if (parcial) {
    r.parcial = true;
    r.cobertura = cob;
    if (t.horarios) r.minimo = false;
  }
  if (t.horarios) r.metodo = "ree";
  return r;
}

function ranking(integrado, coste, tarifa) {
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
    if (porEuros) r.euros = redondear(h.compra * conImpuestos(tarifa.horarios ? tarifa.horarios.get(h.inicio) : tarifa.precios[periodoMadrid(h.inicio)]), 2);
    return r;
  };
  // ISO UTC ya tiene orden cronologico; localeCompare inicializa ICU y agota la CPU gratuita en frio.
  const horas = candidatas.map(fila).sort((a, b) => (porEuros ? b.euros - a.euros || b.compraKwh - a.compraKwh : b.compraKwh - a.compraKwh) || (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0)).slice(0, 3);
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

export function acumuladoMes({ fecha, diarios, pendientesMigracion = 0 }) {
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
    pendientesMigracion,
    aviso: `Acumulado observado de ${buenos.length} de ${n} días del mes con datos completos; no es el mes completo ni una factura, y no se extrapola.${pendientesMigracion ? ` Se están incorporando días archivados antes (quedan ${pendientesMigracion}): el acumulado y la comparación crecerán cuando termine.` : ""}`,
  };
}

// Nunca redondea a 100 % algo que no esta completo.
const pct = (c) => (coberturaCompleta(c) ? "100" : String(Math.min(99.9, Math.round(c * 1000) / 10)).replace(".", ","));
const kwh = (x) => `${redondear(x, 1).toString().replace(".", ",")} kWh`;
const euros = (x) => x.toFixed(2).replace(".", ",");

export function construirInforme({ puntos, fecha, ahora, config = {}, diarios = {}, integrado: previo = null, pendientesMigracion = 0, mercado = null }) {
  const integrado = previo || integrarDia(puntos, fecha);
  const evaluada = evaluarTarifa(config.tarifa, fecha, mercado);
  const fuente = { nombre: "SolarMAN (archivo del servidor)", datadis: false, nota: "Datos de SolarMAN guardados en el servidor. No usa Datadis ni facturas: son estimaciones, no el contador oficial.", ultimoDato: integrado.ultimoDato };
  const base = { version: 1, fecha, tipoDia: tipoDia(fecha), generado: new Date(ahora).toISOString(), fuente, horasEsperadas: integrado.horasEsperadas, cobertura: Object.fromEntries(Object.entries(integrado.cobertura).map(([k, v]) => [k, redondear(v, 4)])), huella: { f: versionIntegrado(integrado), a: versionDependencias(diarios, fecha), p: pendientesMigracion > 0 ? 1 : 0 } };
  if (config.tarifa?.mercado) {
    const m = config.tarifa.mercado;
    const modeloValido = evaluarTarifa(config.tarifa, config.tarifa.desde).valida;
    base.precios = {
      ...(mercado || { estado: "no_disponible", error: "No se han preparado los precios REE." }),
      tarifa: config.tarifa,
      horas: (mercado?.horas || []).map(([t, spot]) => {
        const dia = diaMadrid(t);
        const vigente = modeloValido && dia >= config.tarifa.desde && (!config.tarifa.hasta || dia <= config.tarifa.hasta);
        return [t, spot, vigente ? conImpuestos(spot + m.suplemento + m.peajes[periodoMadrid(t)]) : null];
      }),
    };
  }
  const necesarias = ["solar", "casa", "compra"].map((s) => integrado.cobertura[s]);

  if (!integrado.muestras || Math.max(...necesarias) < 0.25) {
    return { ...base, estado: "sin_datos", energia: null, soc: null, saltosSoc: [], coste: { estado: "no_disponible", motivo: "No hay datos de ese dia." }, ranking: null, comparacion: null, mes: null, hoy: null, conclusiones: [{ tipo: "aviso", texto: "SolarMAN no tiene datos suficientes de ayer en el servidor, así que no se puede valorar el día. No es que no hayas gastado: simplemente no hay datos." }] };
  }

  const estado = necesarias.every(coberturaCompleta) ? "ok" : "parcial";
  const energia = {};
  for (const s of SENALES) {
    const c = integrado.cobertura[s];
    energia[s] = c >= COBERTURA_MINIMA && integrado.energia[s] !== null ? { kwh: redondear(integrado.energia[s], 2), cobertura: redondear(c, 4), minimo: !coberturaCompleta(c) } : null;
  }
  const coste = costeDia(integrado, config.tarifa, fecha, mercado);
  const rank = integrado.cobertura.compra >= COBERTURA_MINIMA ? ranking(integrado, coste, evaluada) : null;
  const resumen = resumirDia(integrado);
  const comparacion = compararDias({ fecha, actual: resumen, diarios });
  const mes = acumuladoMes({ fecha, diarios: { ...diarios, [fecha]: resumen }, pendientesMigracion });

  const c = [];
  if (estado === "parcial") c.push({ tipo: "aviso", texto: `Cobertura incompleta de ayer (${pct(Math.min(...necesarias))} % del tiempo en el canal peor cubierto): las cifras son lo observado, como mínimo, no el total del día.` });
  const m = (x) => (energia[x] ? `${energia[x].minimo ? "al menos " : ""}${kwh(energia[x].kwh)}` : null);
  if (m("compra")) c.push({ tipo: "dato", texto: `Compraste a la red ${m("compra")}.` });
  if (m("solar")) c.push({ tipo: "dato", texto: `Tus placas produjeron ${m("solar")}${m("casa") ? ` y la casa consumió ${m("casa")}` : ""}.` });
  else if (m("casa")) c.push({ tipo: "dato", texto: `La casa consumió ${m("casa")}.` });
  if (m("venta")) c.push({ tipo: "dato", texto: `Vertiste a la red ${m("venta")}.` });
  if (energia.carga && energia.descarga) c.push({ tipo: "dato", texto: `La batería cargó ${kwh(energia.carga.kwh)} y descargó ${kwh(energia.descarga.kwh)} (medido por el inversor).` });
  const s = integrado.soc;
  if (s?.muestras === 1) c.push({ tipo: "dato", texto: `Hay una sola lectura del nivel de batería indicado: ${s.min} % a las ${s.primeraHora}; no basta para describir el día.` });
  else if (s?.inicioCercano && s.finCercano) c.push({ tipo: "dato", texto: `Nivel de batería indicado: entre ${s.min} % y ${s.max} % (empezó en ${s.inicio} % y acabó en ${s.fin} %).` });
  else if (s) c.push({ tipo: "dato", texto: `Nivel de batería indicado: lecturas entre las ${s.primeraHora} (${s.inicio} %) y las ${s.ultimaHora} (${s.fin} %), con valores de ${s.min} % a ${s.max} %; solo hay lectura en el ${Math.round(s.cobertura * 100)} % de las horas del día, así que no se describe el resto.` });
  if (rank?.horas.length) {
    const h = rank.horas[0];
    c.push({ tipo: "patron", texto: `La hora de compra más ${rank.criterio === "euros" ? "cara" : "alta"} fue la de las ${h.hora}:00 (${kwh(h.compraKwh)}${h.euros !== undefined ? `, ≈ ${euros(h.euros)} €` : ""})${h.motivos.length ? `: ${h.motivos.join("; ")}` : ""}.` });
  }
  for (const s of integrado.saltosSoc.slice(0, 3)) c.push({ tipo: "aviso", texto: `A las ${s.hora} el nivel de batería indicado cambió de golpe de ${s.de} % a ${s.a} %. Es un cambio del valor indicado por el inversor; no se interpreta como un diagnóstico de la batería.` });
  if (coste.estado === "no_disponible") c.push({ tipo: "aviso", texto: `Coste en euros no disponible: ${coste.motivo}` });
  else c.push({ tipo: "dato", texto: `Coste de la energía comprada ${coste.parcial ? (coste.minimo === false ? "observado" : "observado (al menos)") : ""}${coste.estado === "estimado" ? (coste.metodo === "ree" ? " (estimación con mercado REE)" : " (estimación con medias históricas)") : ""}: ${coste.parcial && coste.minimo !== false ? "al menos " : ""}≈ ${euros(coste.euros)} €. ${coste.aviso}`.replace(/\s+:/, ":") });
  if (comparacion) {
    const x = comparacion.metricas.compra;
    c.push({ tipo: "dato", texto: `Frente a la mediana de ${x.n} días ${comparacion.tipoDia === "finde" ? "de fin de semana o festivo" : "laborables"} recientes, compraste ${x.difKwh >= 0 ? "+" : ""}${kwh(x.difKwh)}${x.difPct !== null ? ` (${x.difPct >= 0 ? "+" : ""}${x.difPct} %)` : ""}.` });
  } else if (estado === "parcial") c.push({ tipo: "aviso", texto: "Como los datos de ayer están incompletos, no se compara con otros días ni se extrapola el día entero." });
  if (integrado.ultimoDato && new Date(integrado.ultimoDato).getTime() < limitesDia(fecha).fin - 3600000) c.push({ tipo: "aviso", texto: `El último dato recibido es de las ${hhmm(new Date(integrado.ultimoDato).getTime())}; los datos finales del día pueden estar pendientes.` });

  return { ...base, estado, energia, soc: integrado.soc, saltosSoc: integrado.saltosSoc, coste, ranking: rank, comparacion, mes, hoy: null, conclusiones: c, resumenDia: resumen };
}
