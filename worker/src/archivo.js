// Archivo de la curva de 5 minutos de cada dia, sin tener que exportar el Excel.
// Una entrada de KV por mes (la curva compacta) y otra con el resumen (que dias
// hay y la energia por horas para los habitos). Se recupera lo atrasado poco a
// poco: el plan gratuito da 10 ms de CPU por ejecucion.

const BASE = "https://globalhome.solarmanpv.com";
const DIA = 86400000;
const HORA = 3600000;
export const RESUMEN = "solarman-curvas";
export const claveMes = (mes) => `solarman-curva-${mes}`;
// Antes de mayo de 2026 el portal no tiene curva (el datalogger se instalo hacia entonces).
export const INICIO = "2026-05-01";
export const COLUMNAS = ["t", "solar", "casa", "compra", "venta", "carga", "descarga", "soc"];
const MAX_HORAS = 400 * 24;
// Un intervalo largo no se cuenta entero: el portal a veces se salta lecturas.
const PASO_MAXIMO = 7.5 * 60;

const formato = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
export const diaLocal = (t) => formato.format(new Date(t));

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
    if (!horas.has(clave)) horas.set(clave, [clave, 0, 0, null, 0]);
    const h = horas.get(clave);
    h[1] += ((p[2] ?? 0) * segundos) / 3600;
    h[2] += ((p[1] ?? 0) * segundos) / 3600;
    if (p[7] !== null && p[7] > 0) h[3] = p[7];
    h[4] += segundos / 60;
  });
  return [...horas.values()].map(([c, casa, solar, soc, min]) => [c, Math.round(casa), Math.round(solar), soc, Math.round(min)]);
}

/** Dias pendientes del primer mes incompleto, como mucho `maximo`. */
export function pendientes(resumen, ayer, maximo) {
  const faltan = diasEntre(INICIO, ayer).filter((d) => !(d in (resumen?.dias || {})));
  if (!faltan.length) return [];
  const mes = faltan[0].slice(0, 7);
  return faltan.filter((d) => d.startsWith(mes)).slice(0, maximo);
}

export async function archivar(entorno, { ahora = Date.now(), pedir = fetch, maximo = 2 } = {}) {
  const kv = entorno.HISTORICO;
  const sesion = await kv.get("solarman-sesion", "json");
  if (!sesion?.access || sesion.caduca <= ahora || !entorno.SOLARMAN_PLANTA) return { resultado: "sin sesion" };

  const resumen = (await kv.get(RESUMEN, "json")) || { dias: {}, horas: [] };
  const lista = pendientes(resumen, diaLocal(ahora - DIA), maximo);
  if (!lista.length) return { resultado: "al dia" };

  const mes = lista[0].slice(0, 7);
  const archivo = (await kv.get(claveMes(mes), "json")) || { columnas: COLUMNAS, dias: {} };
  const nuevas = [];
  let conDatos = 0;
  for (const dia of lista) {
    const [a, m, d] = dia.split("-").map(Number);
    const respuesta = await pedir(`${BASE}/maintain-s/history/power/${encodeURIComponent(entorno.SOLARMAN_PLANTA)}/record?year=${a}&month=${m}&day=${d}`, {
      headers: { Authorization: `Bearer ${sesion.access}`, Accept: "application/json" },
    });
    // Si falla se deja para la siguiente vuelta, sin marcarlo.
    if (!respuesta.ok) break;
    const puntos = compactar((await respuesta.json())?.records);
    resumen.dias[dia] = puntos.length;
    if (puntos.length) {
      archivo.dias[dia.slice(8)] = puntos;
      nuevas.push(...aHoras(puntos));
      conDatos++;
    }
  }
  if (conDatos) await kv.put(claveMes(mes), JSON.stringify(archivo));
  const horas = new Map((resumen.horas || []).map((h) => [h[0], h]));
  for (const h of nuevas) horas.set(h[0], h);
  resumen.horas = [...horas.values()].sort((x, y) => x[0] - y[0]).slice(-MAX_HORAS);
  await kv.put(RESUMEN, JSON.stringify(resumen));
  return { resultado: "archivado", dias: lista.filter((d) => d in resumen.dias) };
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
