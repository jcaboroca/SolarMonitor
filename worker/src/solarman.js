// Lectura en vivo del portal de Solarman.
// El login de la web lleva captcha; la renovacion con refresh token no. Por eso
// se vincula una vez desde el navegador y el Worker renueva solo. El refresh
// token ROTA en cada uso: aqui hay un unico renovador (el cron) y siempre se
// guarda el ultimo.

const BASE = "https://globalhome.solarmanpv.com";
const HORA = 3600000;
const SESION = "solarman-sesion";
const ESTADO = "solarman-estado";
const MAX_HORAS = 90 * 24;
const MARGEN_RENOVAR = HORA;
// Si el cron se salta lecturas no se inventa energia: el hueco cuenta como mucho 10 min.
const HUECO_MAXIMO = 10 * 60000;

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

// gridPower parece ser lo vertido (buyPower lo comprado): por confirmar con los totales del dia.
export function normalizar(d) {
  const t = Number.isFinite(d?.lastUpdateTime) ? (d.lastUpdateTime < 1e12 ? d.lastUpdateTime * 1000 : d.lastUpdateTime) : null;
  return {
    t,
    soc: numero(d?.batterySoc),
    solarW: numero(d?.generationPower) ?? 0,
    casaW: numero(d?.usePower) ?? 0,
    compraW: numero(d?.buyPower) ?? 0,
    ventaW: numero(d?.gridPower) ?? 0,
    cargaW: Math.abs(numero(d?.chargePower) ?? 0),
    descargaW: Math.abs(numero(d?.dischargePower) ?? 0),
  };
}

const r1 = (x) => Math.round(x * 10) / 10;

/**
 * Integra la lectura anterior hasta la nueva y la anota en su hora.
 * Hora = [hora desde 1970, casa Wh, solar Wh, compra Wh, venta Wh, SoC, minutos con dato].
 * Devuelve null si la lectura no es mas nueva que la ultima.
 */
export function acumular(estado, lectura) {
  const previo = estado?.ultimo;
  if (previo && lectura.t <= previo.t) return null;
  const horas = [...(estado?.horas || [])];
  let hora = estado?.hora ? [...estado.hora] : null;
  if (previo) {
    const intervalo = Math.min(lectura.t - previo.t, HUECO_MAXIMO);
    const clave = Math.floor(previo.t / HORA);
    if (!hora || hora[0] !== clave) {
      if (hora) horas.push(hora);
      hora = [clave, 0, 0, 0, 0, null, 0];
    }
    const f = intervalo / HORA;
    hora[1] = r1(hora[1] + previo.casaW * f);
    hora[2] = r1(hora[2] + previo.solarW * f);
    hora[3] = r1(hora[3] + previo.compraW * f);
    hora[4] = r1(hora[4] + previo.ventaW * f);
    hora[5] = previo.soc;
    hora[6] = r1(hora[6] + intervalo / 60000);
  }
  return { ultimo: lectura, hora, horas: horas.slice(-MAX_HORAS), error: null, caducada: false };
}

export async function sondear(entorno, { ahora = Date.now(), pedir = fetch } = {}) {
  const kv = entorno.HISTORICO;
  const sesion = await kv.get(SESION, "json");
  if (!sesion?.refresh) return { resultado: "sin vincular" };
  const estado = (await kv.get(ESTADO, "json")) || {};

  // Los errores se guardan solo si cambian: KV gratis da 1000 escrituras al dia.
  const fallo = async (mensaje, caducada = false) => {
    if (estado.error !== mensaje) await kv.put(ESTADO, JSON.stringify({ ...estado, error: mensaje, caducada, errorEn: ahora }));
    return { resultado: "error", error: mensaje };
  };

  if (!entorno.SOLARMAN_PLANTA) return fallo("Falta el secret SOLARMAN_PLANTA en el Worker.");

  let vigente = sesion;
  const renovarYGuardar = async () => {
    vigente = await renovar(vigente.refresh, pedir, ahora);
    await kv.put(SESION, JSON.stringify(vigente));
  };
  const leer = () =>
    pedir(`${BASE}/maintain-s/fast/system/${encodeURIComponent(entorno.SOLARMAN_PLANTA)}`, {
      headers: { Authorization: `Bearer ${vigente.access}`, Accept: "application/json" },
    });

  try {
    if (!vigente.access || vigente.caduca - ahora < MARGEN_RENOVAR) await renovarYGuardar();
    let respuesta = await leer();
    if (respuesta.status === 401) {
      await renovarYGuardar();
      respuesta = await leer();
    }
    if (!respuesta.ok) return fallo(`Solarman ha respondido ${respuesta.status} al leer la planta.`);
    const lectura = normalizar(await respuesta.json());
    if (lectura.t === null) return fallo("Solarman no ha mandado la hora del dato.");
    const nuevo = acumular(estado, lectura);
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

const PARECE_JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;

export async function vincular(entorno, token, opciones) {
  const limpio = String(token || "").trim();
  if (!PARECE_JWT.test(limpio) || limpio.length > 4000) return { resultado: "error", error: "Eso no parece un token de Solarman (empieza por eyJ)." };
  await entorno.HISTORICO.put(SESION, JSON.stringify({ refresh: limpio, access: null, caduca: 0 }));
  return sondear(entorno, opciones);
}

export async function leerEstado(entorno) {
  const [sesion, estado] = await Promise.all([entorno.HISTORICO.get(SESION, "json"), entorno.HISTORICO.get(ESTADO, "json")]);
  return { vinculado: Boolean(sesion?.refresh), ...(estado || {}) };
}
