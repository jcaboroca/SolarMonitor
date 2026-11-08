// Archivo de la curva de 5 minutos de cada dia, sin tener que exportar el Excel.
// Una entrada de KV por mes (la curva compacta) y otra con el resumen (que dias
// hay y la energia por horas para los habitos). Se recupera lo atrasado poco a
// poco: el plan gratuito da 10 ms de CPU por ejecucion.

import { integrarDia, resumirDia, diaCompleto, versionIntegrado, versionAgregados } from "./informe-calculo.js";
import { limitesDia } from "./horario.js";
import { diaMadrid, sumarDias } from "./horario.js";

const BASE = "https://globalhome.solarmanpv.com";
const HORA = 3600000;
export const RESUMEN = "solarman-curvas";
// Ayer ya integrado (pequeno): el informe lo lee en vez de reprocesar la curva del mes.
export const AYER_INTEGRADO = "solarman-dia";
// Version pequena (ayer, contenido y agregados) que el cron lee para saber si hay que actualizar el informe.
export const MARCA_VERSION = "solarman-version";
export const claveMes = (mes) => `solarman-curva-${mes}`;
// Antes de mayo de 2026 el portal no tiene curva (el datalogger se instalo hacia entonces).
export const INICIO = "2026-05-01";
export const COLUMNAS = ["t", "solar", "casa", "compra", "venta", "carga", "descarga", "soc"];
const MAX_HORAS = 400 * 24;
// Un intervalo largo no se cuenta entero: el portal a veces se salta lecturas.
const PASO_MAXIMO = 7.5 * 60;
// Dias recientes que se pueden revisitar y veces que se reintenta uno que no se completa.
const DIAS_RECIENTES = 7;
export const MAX_INTENTOS = 8;
const DIAS_RESUMEN = 70;
// Dias heredados que se resumen por vuelta desde sus curvas ya guardadas (acota CPU y lecturas de KV).
export const LOTE_MIGRACION = 2;
const DIAS_MIGRACION = 62;
const SENALES = ["solar", "casa", "compra", "venta", "carga", "descarga"];

export const diaLocal = (t) => diaMadrid(t);

function diasEntre(desde, hasta) {
  const [a, m, d] = desde.split("-").map(Number);
  const dias = [];
  for (let i = 0; ; i++) {
    const dia = new Date(Date.UTC(a, m - 1, d + i)).toISOString().slice(0, 10);
    if (dia > hasta) return dias;
    dias.push(dia);
  }
}

const n = (x) => (Number.isFinite(x) ? x : null);

export function compactar(records) {
  return (records || [])
    .filter((r) => Number.isFinite(r.dateTime))
    .map((r) => [r.dateTime, n(r.generationPower), n(r.usePower), n(r.buyPower), n(r.gridPower), n(r.chargePower), n(r.dischargePower), n(r.batterySoc)])
    .sort((a, b) => a[0] - b[0]);
}

/** Puntos compactos → [hora desde 1970, casa Wh, solar Wh, SoC al final, minutos con dato]. */
export function aHoras(puntos) {
  const horas = new Map();
  puntos.forEach((p, i) => {
    const siguiente = puntos[i + 1]?.[0] ?? p[0] + 300;
    const segundos = Math.min(siguiente - p[0], PASO_MAXIMO);
    const clave = Math.floor((p[0] * 1000) / HORA);
    if (!horas.has(clave)) horas.set(clave, [clave, 0, 0, null, 0, 0]);
    const h = horas.get(clave);
    h[1] += ((p[2] ?? 0) * segundos) / 3600;
    h[2] += ((p[1] ?? 0) * segundos) / 3600;
    if (p[7] !== null && p[7] >= 0) h[3] = p[7];
    h[4] += segundos / 60;
    // Minutos con solar realmente medido: un cero real cuenta, un dato ausente no.
    if (typeof p[1] === "number" && Number.isFinite(p[1])) h[5] += segundos / 60;
  });
  return [...horas.values()].map(([c, casa, solar, soc, min, minSolar]) => [c, Math.round(casa), Math.round(solar), soc, Math.round(min), Math.round(minSolar)]);
}

/** Dias pendientes del primer mes incompleto, como mucho `maximo`. */
export function pendientes(resumen, ayer, maximo) {
  const faltan = diasEntre(INICIO, ayer).filter((d) => !(d in (resumen?.dias || {})));
  if (!faltan.length) return [];
  const mes = faltan[0].slice(0, 7);
  return faltan.filter((d) => d.startsWith(mes)).slice(0, maximo);
}

const restarDias = (dia, n) => sumarDias(dia, -n);

/**
 * Un dia esta completo por la cobertura medida de sus senales, no por el numero de filas. Sin
 * resumen todavia (dato heredado con curva) no se vuelve a descargar: lo mide la migracion.
 */
const incompleto = (resumen, dia) => {
  const d = resumen?.diarios?.[dia];
  return d ? !diaCompleto(d) : (resumen?.dias?.[dia] ?? 0) === 0;
};

const util = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * Une dos curvas del mismo dia por instante y senal: un valor valido nuevo corrige al guardado y uno
 * ausente conserva el guardado. Nunca se pierde una medida valida porque otro canal mejore.
 */
export function reconciliar(guardado, nuevo) {
  const porInstante = new Map();
  for (const lista of [guardado || [], nuevo || []]) {
    for (const p of lista) {
      if (!Array.isArray(p) || !Number.isFinite(p[0])) continue;
      const previo = porInstante.get(p[0]);
      if (!previo) {
        porInstante.set(p[0], p.map((v, i) => (i === 0 ? v : (util(v) ? v : null))));
        continue;
      }
      for (let i = 1; i < p.length; i++) if (util(p[i])) previo[i] = p[i];
    }
  }
  return [...porInstante.values()].sort((a, b) => a[0] - b[0]);
}

/** Dias con curva guardada y sin resumen diario dentro de la ventana que usan comparacion y mes; los mas recientes primero. */
export function pendientesMigracion(resumen, ayer) {
  const minimo = restarDias(ayer, DIAS_MIGRACION);
  const inicio = minimo > INICIO ? minimo : INICIO;
  return Object.keys(resumen?.dias || {})
    .filter((d) => d >= inicio && d <= ayer && resumen.dias[d] > 0 && !resumen.diarios?.[d])
    .sort()
    .reverse();
}

/**
 * Dias a pedir: primero ayer y los recientes incompletos (con intentos acotados) y despues el
 * atrasado desde el principio. Los recientes no se llevan todos los turnos.
 */
export function seleccionar(resumen, ayer, maximo) {
  const dias = resumen?.dias || {};
  const intentos = resumen?.intentos || {};
  const recientes = [];
  for (let i = 0; i < DIAS_RECIENTES; i++) {
    const dia = restarDias(ayer, i);
    if (dia < INICIO) break;
    if (!(dia in dias) || incompleto(resumen, dia)) if ((intentos[dia] || 0) < MAX_INTENTOS) recientes.push(dia);
  }
  // Ayer, aunque este completo, se vuelve a pedir cada vuelta mientras siga siendo ayer: el portal puede corregir
  // valores. Son como mucho unas 24 peticiones y, si nada cambia, no se escribe nada.
  if (!recientes.includes(ayer) && resumen?.fuente?.dia === ayer && ayer >= INICIO && (intentos[ayer] || 0) < MAX_INTENTOS) recientes.unshift(ayer);
  const atrasado = pendientes(resumen, ayer, maximo).filter((d) => !recientes.includes(d));
  const cupo = Math.ceil(maximo / 2);
  const lista = [...recientes.slice(0, cupo), ...atrasado.slice(0, maximo)].slice(0, maximo);
  for (const d of recientes.slice(cupo)) if (lista.length < maximo) lista.push(d);
  return lista;
}

export async function archivar(entorno, { ahora = Date.now(), pedir = fetch, maximo = 2 } = {}) {
  const kv = entorno.HISTORICO;
  const sesion = await kv.get("solarman-sesion", "json");
  if (!sesion?.access || sesion.caduca <= ahora || !entorno.SOLARMAN_PLANTA) return { resultado: "sin sesion" };

  const resumen = (await kv.get(RESUMEN, "json")) || { dias: {}, horas: [] };
  const ayer = sumarDias(diaMadrid(ahora), -1);
  const original = JSON.stringify(resumen);
  resumen.intentos = resumen.intentos || {};
  resumen.diarios = resumen.diarios || {};
  const lista = seleccionar(resumen, ayer, maximo);
  const migrar = pendientesMigracion(resumen, ayer).filter((d) => !lista.includes(d)).slice(0, LOTE_MIGRACION);
  if (!lista.length && !migrar.length) return { resultado: "al dia" };

  const archivos = new Map();
  const sucios = new Set();
  const reconstruidas = [];
  let instantanea = null;
  const curvaDe = async (mes) => {
    if (!archivos.has(mes)) archivos.set(mes, (await kv.get(claveMes(mes), "json")) || { columnas: COLUMNAS, dias: {} });
    return archivos.get(mes);
  };
  for (const dia of lista) {
    const [a, m, d] = dia.split("-").map(Number);
    const respuesta = await pedir(`${BASE}/maintain-s/history/power/${encodeURIComponent(entorno.SOLARMAN_PLANTA)}/record?year=${a}&month=${m}&day=${d}`, {
      headers: { Authorization: `Bearer ${sesion.access}`, Accept: "application/json" },
    });
    const reciente = dia >= restarDias(ayer, DIAS_RECIENTES - 1);
    // Si falla se deja para la siguiente vuelta, sin marcarlo; un reciente gasta un intento.
    if (!respuesta.ok) {
      if (reciente) resumen.intentos[dia] = (resumen.intentos[dia] || 0) + 1;
      break;
    }
    const puntos = compactar((await respuesta.json())?.records);
    if (!puntos.length) {
      if (!(dia in resumen.dias)) resumen.dias[dia] = 0;
    } else {
      const mes = dia.slice(0, 7);
      const curva = await curvaDe(mes);
      const guardada = curva.dias[dia.slice(8)];
      const fusion = reconciliar(guardada, puntos);
      const cambia = JSON.stringify(fusion) !== JSON.stringify(guardada);
      resumen.dias[dia] = fusion.length;
      if (cambia || !resumen.diarios[dia] || (dia === ayer && resumen.fuente?.dia !== ayer)) {
        const integrado = integrarDia(fusion, dia);
        resumen.diarios[dia] = resumirDia(integrado);
        if (cambia) {
          curva.dias[dia.slice(8)] = fusion;
          sucios.add(mes);
          reconstruidas.push([dia, aHoras(fusion)]);
        }
        if (dia === ayer) instantanea = { integrado, h: versionIntegrado(integrado) };
      }
    }
    if (diaCompleto(resumen.diarios[dia])) delete resumen.intentos[dia];
    else if (reciente) resumen.intentos[dia] = (resumen.intentos[dia] || 0) + 1;
  }
  // Migracion incremental: resume desde la curva ya guardada, sin descargar nada.
  for (const dia of migrar) {
    const curva = await curvaDe(dia.slice(0, 7));
    resumen.diarios[dia] = resumirDia(integrarDia(curva.dias[dia.slice(8)] || [], dia));
  }
  for (const mes of sucios) await kv.put(claveMes(mes), JSON.stringify(archivos.get(mes)));
  if (instantanea && resumen.fuente?.dia === ayer && resumen.fuente.h === instantanea.h) instantanea = null;
  if (instantanea) {
    await kv.put(AYER_INTEGRADO, JSON.stringify({ dia: ayer, h: instantanea.h, integrado: instantanea.integrado }));
    resumen.fuente = { dia: ayer, h: instantanea.h };
  }
  // Las horas de un dia reconciliado se rehacen enteras desde la misma curva, sin restos antiguos.
  const horas = new Map((resumen.horas || []).map((h) => [h[0], h]));
  for (const [dia, filas] of reconstruidas) {
    const { inicio, fin } = limitesDia(dia);
    for (const clave of [...horas.keys()]) if (clave >= inicio / HORA && clave < fin / HORA) horas.delete(clave);
    for (const h of filas) horas.set(h[0], h);
  }
  resumen.horas = [...horas.values()].sort((x, y) => x[0] - y[0]).slice(-MAX_HORAS);
  const limite = restarDias(ayer, DIAS_RESUMEN);
  for (const d of Object.keys(resumen.diarios)) if (d < limite) delete resumen.diarios[d];
  for (const d of Object.keys(resumen.intentos)) if (d < restarDias(ayer, 30)) delete resumen.intentos[d];
  {
    const marca = JSON.stringify({ dia: ayer, f: resumen.fuente?.dia === ayer ? resumen.fuente.h : null, a: versionAgregados(resumen.diarios, ayer), m: pendientesMigracion(resumen, ayer).length });
    if (marca !== resumen.marca) {
      await kv.put(MARCA_VERSION, marca);
      resumen.marca = marca;
    }
  }
  if (JSON.stringify(resumen) !== original) await kv.put(RESUMEN, JSON.stringify(resumen));
  return { resultado: lista.length ? "archivado" : "migrado", dias: lista.filter((d) => d in resumen.dias), migrados: migrar };
}

/** Meses disponibles: { "2026-05": numero de dias con curva }. */
export async function mesesArchivados(entorno) {
  const resumen = (await entorno.HISTORICO.get(RESUMEN, "json")) || { dias: {} };
  const meses = {};
  for (const [dia, puntos] of Object.entries(resumen.dias)) {
    if (puntos > 0) meses[dia.slice(0, 7)] = (meses[dia.slice(0, 7)] || 0) + 1;
  }
  return meses;
}

export async function leerMes(entorno, mes) {
  if (!/^\d{4}-\d{2}$/.test(mes)) return null;
  return entorno.HISTORICO.get(claveMes(mes), "json");
}

export async function horasArchivadas(entorno) {
  return ((await entorno.HISTORICO.get(RESUMEN, "json")) || {}).horas || [];
}
