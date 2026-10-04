// Lectura de la planta en el portal de Solarman, gastando lo minimo de la cuota
// gratuita de Cloudflare (compartida con otras apps de la cuenta):
//   · En vivo: bajo demanda cuando la web pregunta. No escribe en KV.
//   · Historico: cron horario que resta los acumulados del dia. 1 escritura/hora.
// El login de la web lleva captcha; la renovacion con refresh token no. El
// refresh token ROTA en cada uso, asi que SOLO el cron (o vincular) renueva.

const BASE = "https://globalhome.solarmanpv.com";
const HORA = 3600000;
const SESION = "solarman-sesion";
const ESTADO = "solarman-estado";
const MAX_HORAS = 90 * 24;
// El cron pasa cada hora: renovando con 3 h de margen nunca se llega a caducar.
const MARGEN_RENOVAR = 3 * HORA;
// Con un hueco mayor el reparto por horas seria inventado: esa hora se descarta.
const HUECO_MAXIMO = 90 * 60000;
const VIVO_EN_MEMORIA = 2 * 60000;

export class SesionCaducada extends Error {}

export async function renovar(refresh, pedir, ahora) {
  const respuesta = await pedir(`${BASE}/mdc-eu/oauth2-s/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: "test", system: "SOLARMAN", area: "ES", origin_id: "" }).toString(),
  });
  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {}
  if (!respuesta.ok || !datos?.access_token) {
    if (respuesta.status >= 400 && respuesta.status < 500) throw new SesionCaducada(`Solarman no acepta la sesión (${respuesta.status}). Hay que volver a vincular.`);
    throw new Error(`Solarman ha respondido ${respuesta.status} al renovar la sesión.`);
  }
  return { refresh: datos.refresh_token || refresh, access: datos.access_token, caduca: ahora + (datos.expires_in || 0) * 1000 };
}

const numero = (x) => (Number.isFinite(x) ? x : null);

// Acumulados del dia en kWh. buyValue = comprado, gridValue = vertido (comprobado).
const acumulados = (d) => ({
  casa: numero(d?.useValue),
  solar: numero(d?.generationValue),
  compra: numero(d?.buyValue),
  venta: numero(d?.gridValue),
});

export function normalizar(d) {
  const t = Number.isFinite(d?.lastUpdateTime) ? (d.lastUpdateTime < 1e12 ? d.lastUpdateTime * 1000 : d.lastUpdateTime) : null;
  return {
    t,
    dia: typeof d?.acceptDay === "string" ? d.acceptDay : null,
    soc: numero(d?.batterySoc),
    solarW: numero(d?.generationPower) ?? 0,
    casaW: numero(d?.usePower) ?? 0,
    compraW: numero(d?.buyPower) ?? 0,
    ventaW: numero(d?.gridPower) ?? 0,
    cargaW: Math.abs(numero(d?.chargePower) ?? 0),
    descargaW: Math.abs(numero(d?.dischargePower) ?? 0),
    acumulados: acumulados(d),
  };
}

const wh = (despues, antes) => (despues === null || antes === null ? null : Math.max(0, Math.round((despues - antes) * 1000)));

/**
 * Anota la energia entre la lectura anterior y esta en la hora de la anterior.
 * Hora = [hora desde 1970, casa Wh, solar Wh, compra Wh, venta Wh, SoC, minutos].
 * `cierre` son los acumulados finales del dia anterior si ha cambiado el dia.
 * Devuelve null si la lectura no es mas nueva que la ultima.
 */
export function registrarHora(estado, lectura, cierre = null) {
  const previo = estado?.ultimo;
  if (previo && lectura.t <= previo.t) return null;
  const horas = [...(estado?.horas || [])];
  const intervalo = previo ? lectura.t - previo.t : 0;
  if (previo && intervalo <= HUECO_MAXIMO && previo.acumulados) {
    let delta = null;
    if (lectura.dia === previo.dia) {
      delta = Object.fromEntries(Object.keys(lectura.acumulados).map((k) => [k, wh(lectura.acumulados[k], previo.acumulados[k])]));
    } else if (cierre) {
      // Lo que falto hasta medianoche mas lo que lleva el dia nuevo.
      delta = Object.fromEntries(
        Object.keys(lectura.acumulados).map((k) => {
          const hastaMedianoche = wh(cierre[k], previo.acumulados[k]);
          return [k, hastaMedianoche === null || lectura.acumulados[k] === null ? null : hastaMedianoche + Math.round(lectura.acumulados[k] * 1000)];
        })
      );
    }
    if (delta && Object.values(delta).every((v) => v !== null)) {
      // Punto medio: el datalogger sube a :58 o a :02 y la hora de la lectura anterior baila.
      const clave = Math.floor((previo.t + lectura.t) / 2 / HORA);
      const ultima = horas.at(-1);
      if (ultima?.[0] === clave) {
        horas[horas.length - 1] = [clave, ultima[1] + delta.casa, ultima[2] + delta.solar, ultima[3] + delta.compra, ultima[4] + delta.venta, lectura.soc, ultima[6] + Math.round(intervalo / 60000)];
      } else {
        horas.push([clave, delta.casa, delta.solar, delta.compra, delta.venta, lectura.soc, Math.round(intervalo / 60000)]);
      }
    }
  }
  return { ultimo: lectura, horas: horas.slice(-MAX_HORAS), error: null, caducada: false };
}

const urlPlanta = (entorno) => `${BASE}/maintain-s/fast/system/${encodeURIComponent(entorno.SOLARMAN_PLANTA)}`;

async function cierreDelDia(entorno, access, dia, pedir) {
  const [, anio, mes, d] = dia.match(/^(\d{4})(\d{2})(\d{2})$/) || [];
  if (!anio) return null;
  const respuesta = await pedir(
    `${BASE}/maintain-s/history/batteryPower/${encodeURIComponent(entorno.SOLARMAN_PLANTA)}/stats/daily?year=${anio}&month=${+mes}&day=${+d}`,
    { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" } }
  );
  if (!respuesta.ok) return null;
  return acumulados((await respuesta.json())?.statistics);
}

/** Cron horario: renueva si hace falta, lee y anota la hora. Una escritura en KV. */
export async function sondear(entorno, { ahora = Date.now(), pedir = fetch } = {}) {
  const kv = entorno.HISTORICO;
  const sesion = await kv.get(SESION, "json");
  if (!sesion?.refresh) return { resultado: "sin vincular" };
  const estado = (await kv.get(ESTADO, "json")) || {};

  // Los errores se guardan solo si cambian, para no gastar escrituras.
  const fallo = async (mensaje, caducada = false) => {
    if (estado.error !== mensaje) await kv.put(ESTADO, JSON.stringify({ ...estado, error: mensaje, caducada, errorEn: ahora }));
    return { resultado: "error", error: mensaje };
  };

  if (!entorno.SOLARMAN_PLANTA) return fallo("Falta el secret SOLARMAN_PLANTA en el Worker.");

  try {
    let vigente = sesion;
    if (!vigente.access || vigente.caduca - ahora < MARGEN_RENOVAR) {
      vigente = await renovar(vigente.refresh, pedir, ahora);
      await kv.put(SESION, JSON.stringify(vigente));
    }
    const respuesta = await pedir(urlPlanta(entorno), { headers: { Authorization: `Bearer ${vigente.access}`, Accept: "application/json" } });
    if (!respuesta.ok) return fallo(`Solarman ha respondido ${respuesta.status} al leer la planta.`);
    const lectura = normalizar(await respuesta.json());
    if (lectura.t === null) return fallo("Solarman no ha mandado la hora del dato.");

    const previo = estado.ultimo;
    const cambioDeDia = previo?.dia && lectura.dia && previo.dia !== lectura.dia;
    const cierre = cambioDeDia ? await cierreDelDia(entorno, vigente.access, previo.dia, pedir).catch(() => null) : null;
    const nuevo = registrarHora(estado, lectura, cierre);
    if (!nuevo) {
      if (estado.error) await kv.put(ESTADO, JSON.stringify({ ...estado, error: null, caducada: false }));
      return { resultado: "sin novedades" };
    }
    await kv.put(ESTADO, JSON.stringify(nuevo));
    return { resultado: "guardado", lectura };
  } catch (error) {
    if (error instanceof SesionCaducada) {
      // Sin refresh valido no se insiste: cada intento seria una escritura y un 4xx mas.
      await kv.put(SESION, JSON.stringify({ refresh: null }));
      return fallo(error.message, true);
    }
    return fallo(error.message);
  }
}

// Vive lo que viva el isolate: ahorra llamadas a Solarman si varias pantallas preguntan a la vez.
let enMemoria = null;
export const olvidarMemoria = () => (enMemoria = null);

/** Peticion de la web: dato en vivo sin escribir en KV ni renovar la sesion. */
export async function leerEstado(entorno, { ahora = Date.now(), pedir = fetch } = {}) {
  const [sesion, estado] = await Promise.all([entorno.HISTORICO.get(SESION, "json"), entorno.HISTORICO.get(ESTADO, "json")]);
  const respuesta = { vinculado: Boolean(sesion?.refresh), ...(estado || {}) };
  if (!sesion?.access || !entorno.SOLARMAN_PLANTA || sesion.caduca <= ahora) return respuesta;

  if (enMemoria && ahora - enMemoria.leido < VIVO_EN_MEMORIA) return { ...respuesta, ultimo: enMemoria.lectura };
  try {
    const r = await pedir(urlPlanta(entorno), { headers: { Authorization: `Bearer ${sesion.access}`, Accept: "application/json" } });
    if (!r.ok) return { ...respuesta, avisoVivo: `Solarman ha respondido ${r.status}; muestro la última lectura guardada.` };
    const lectura = normalizar(await r.json());
    if (lectura.t === null) return respuesta;
    enMemoria = { leido: ahora, lectura };
    return { ...respuesta, ultimo: lectura };
  } catch {
    return { ...respuesta, avisoVivo: "No he podido hablar con Solarman; muestro la última lectura guardada." };
  }
}

const PARECE_JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;

export async function vincular(entorno, token, opciones) {
  const limpio = String(token || "").trim();
  if (!PARECE_JWT.test(limpio) || limpio.length > 4000) return { resultado: "error", error: "Eso no parece un token de Solarman (empieza por eyJ)." };
  await entorno.HISTORICO.put(SESION, JSON.stringify({ refresh: limpio, access: null, caduca: 0 }));
  return sondear(entorno, opciones);
}
