// Informe diario: generacion a las 08:30 de Madrid, persistencia, envio de push y API.
// Todo en KV (el mismo HISTORICO). Nada de aqui toca el paquete cifrado del historico.

import { claveMes, RESUMEN, AYER_INTEGRADO, MARCA_VERSION, pendientesRelevantes } from "./archivo.js";
import { integrarDia, construirInforme, evaluarTarifa } from "./informe-calculo.js";
import { construirHoy, componerHoy } from "./informe-hoy.js";
import { diaMadrid, partesMadrid, sumarDias } from "./horario.js";
import { configVapid, enviarPush, idSuscripcion, validarEndpoint, validarSuscripcion } from "./push.js";

export const MAX_GENERACIONES = 4;
// Regeneraciones extra, solo si cambia el contenido aceptado de SolarMAN (o los agregados) despues de generar.
export const MAX_REGENERACIONES = 4;
export const MAX_ENTREGAS = 3;
// Informes fechados anteriores a ayer que se refrescan al terminar la migracion: solo los de la ultima semana
// (los resumenes diarios de mas atras ya se han recortado) y con un maximo de refrescos por informe.
export const MAX_REFRESCOS = 3;
const DIAS_REFRESCO = 6;
const HORA_INFORME = 8 * 60 + 30;
const MAX_INFORMES = 60;
const MAX_DISPOSITIVOS = 5;
const MAX_CUERPO = 4096;
const INTERVALO_PRUEBA = 30000;
const LOCK_MS = 120000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const CONFIG_BASE = { activo: false, pushActivo: false, consentimiento: false, ubicacion: null, tarifa: null };
const claveInforme = (fecha) => `informe-${fecha}`;
const redondear = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------- Validacion de la configuracion

const numero = (x, min, max) => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;

/** Devuelve { ok, valor } o { ok:false, error }. Solo se guardan los campos conocidos. */
export function validarConfig(cuerpo) {
  const mal = (error) => ({ ok: false, error });
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return mal("El cuerpo debe ser un objeto JSON.");
  for (const k of ["activo", "pushActivo", "consentimiento"]) if (k in cuerpo && typeof cuerpo[k] !== "boolean") return mal(`${k} debe ser verdadero o falso.`);
  const valor = { ...CONFIG_BASE };
  for (const k of ["activo", "pushActivo", "consentimiento"]) valor[k] = cuerpo[k] === true;
  if ((valor.activo || valor.pushActivo) && !valor.consentimiento) return mal("Para activar el informe hay que aceptar guardar la configuración mínima en el servidor.");

  const u = cuerpo.ubicacion;
  if (u != null) {
    if (typeof u !== "object" || !numero(u.lat, -90, 90) || !numero(u.lon, -180, 180)) return mal("La ubicación necesita una latitud y una longitud válidas.");
    valor.ubicacion = { lat: redondear(u.lat, 2), lon: redondear(u.lon, 2) };
  }

  const t = cuerpo.tarifa;
  if (t != null) {
    if (typeof t !== "object" || Array.isArray(t)) return mal("La tarifa no es válida.");
    const limpia = { tipo: t.tipo, desde: t.desde, hasta: t.hasta ? t.hasta : null, fuente: typeof t.fuente === "string" ? t.fuente.trim().slice(0, 120) : t.fuente };
    if (limpia.tipo === "plana") limpia.precio = t.precio;
    else if (limpia.tipo === "periodos") Object.assign(limpia, { P1: t.P1, P2: t.P2, P3: t.P3 });
    else if (limpia.tipo === "indexada") {
      limpia.aceptaEstimacion = t.aceptaEstimacion === true;
      if (limpia.aceptaEstimacion) limpia.mediaHistorica = t.mediaHistorica && { P1: t.mediaHistorica.P1, P2: t.mediaHistorica.P2, P3: t.mediaHistorica.P3 };
    }
    const r = evaluarTarifa(limpia, FECHA.test(limpia.desde || "") ? limpia.desde : "0000-00-00");
    if (!r.valida) return mal(r.motivo);
    if (limpia.hasta && limpia.hasta < limpia.desde) return mal("La fecha de fin de la tarifa es anterior a la de inicio.");
    valor.tarifa = limpia;
  }
  return { ok: true, valor };
}

// ---------------------------------------------------------------- Generacion

/**
 * Datos de ayer: el archivo guarda ya integrado el ultimo dia (una lectura pequena); solo si falta
 * (datos antiguos) se integra la curva del mes. Los totales de otros dias salen de `diarios`.
 */
async function leerFuente(kv, resumen, fecha) {
  const diarios = { ...(resumen?.diarios || {}) };
  const instantanea = await kv.get(AYER_INTEGRADO, "json");
  if (instantanea?.dia === fecha && instantanea.integrado) return { diarios, integrado: instantanea.integrado };
  const curva = await kv.get(claveMes(fecha.slice(0, 7)), "json");
  return { diarios, integrado: integrarDia(curva?.dias?.[fecha.slice(8)] || [], fecha) };
}

export async function prepararFuente(entorno, { ahora = Date.now() } = {}) {
  const fecha = sumarDias(diaMadrid(ahora), -1);
  const resumen = await entorno.HISTORICO.get(RESUMEN, "json");
  const fuente = await leerFuente(entorno.HISTORICO, resumen, fecha);
  return { ...fuente, fecha, pendientesMigracion: pendientesRelevantes(resumen, fecha).length };
}

function informeDeError(fecha, ahora) {
  return {
    version: 1,
    fecha,
    estado: "error",
    generado: new Date(ahora).toISOString(),
    fuente: { nombre: "SolarMAN (archivo del servidor)", datadis: false },
    energia: null,
    coste: { estado: "no_disponible", motivo: "No se ha podido generar el informe." },
    hoy: null,
    conclusiones: [{ tipo: "aviso", texto: "No se ha podido generar el informe de ayer. Se reintentará automáticamente unas cuantas veces; mientras tanto no hay datos que valorar." }],
  };
}

async function guardarIndice(kv, indice, entrada) {
  const informes = [entrada, ...(indice?.informes || []).filter((e) => e.fecha !== entrada.fecha)].sort((a, b) => a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0);
  for (const viejo of informes.slice(MAX_INFORMES)) await kv.delete(claveInforme(viejo.fecha));
  await kv.put("informe-indice", JSON.stringify({ informes: informes.slice(0, MAX_INFORMES) }));
}

/** Genera y guarda el informe de ayer (hora de Madrid) y su entrada del indice. No envia nada. */
export async function generarInforme(entorno, { ahora = Date.now(), pedir = (u, i) => fetch(u, i), preparacion } = {}) {
  const kv = entorno.HISTORICO;
  const fecha = sumarDias(diaMadrid(ahora), -1);
  const [config, indice] = await Promise.all([kv.get("informe-config", "json"), kv.get("informe-indice", "json")]);
  const previa = indice?.informes?.find((e) => e.fecha === fecha);
  const intentos = (previa?.intentos || 0) + 1;
  let informe;
  try {
    const cfg = { ...CONFIG_BASE, ...(config || {}) };
    const resumen = preparacion ? null : await kv.get(RESUMEN, "json");
    const fuente = preparacion?.fuente ?? await leerFuente(kv, resumen, fecha);
    if (preparacion && fuente.fecha !== fecha) throw new Error("La fuente preparada no corresponde a ayer.");
    const { diarios, integrado } = fuente;
    informe = construirInforme({ integrado, fecha, ahora, config: cfg, diarios, pendientesMigracion: preparacion ? fuente.pendientesMigracion : pendientesRelevantes(resumen, fecha).length });
    if (informe.estado !== "sin_datos") informe.hoy = preparacion
      ? componerHoy({ config: cfg, informe, prevision: preparacion.prevision, calibracion: preparacion.calibracion, ahora })
      : await construirHoy({ config: cfg, informe, resumen, ahora, pedir });
    else informe.hoy = { fecha: diaMadrid(ahora), estado: "no_disponible", texto: "Sin datos de ayer no se prepara la recomendación de hoy.", recomendaciones: [] };
  } catch {
    console.error("No se pudo componer el informe diario.", { fecha });
    informe = informeDeError(fecha, ahora);
  }
  const final = informe.estado === "ok" || informe.estado === "parcial";
  // Regenerar no borra la entrega: el estado de envio de esa fecha se conserva para no duplicar avisos.
  const push = final ? (previa?.push && previa.push.estado !== "no_aplica" ? previa.push : { estado: "pendiente", pendientes: 1 }) : { estado: "no_aplica", pendientes: 0 };
  const entrada = { fecha, estado: informe.estado, generado: informe.generado, intentos, huella: informe.huella ?? null, push };
  await kv.put(claveInforme(fecha), JSON.stringify(informe));
  await guardarIndice(kv, indice, entrada);
  return { informe, entrada };
}

// ---------------------------------------------------------------- Envio

async function enviarPendientes(entorno, kv, config, entrada, { ahora, pedir, maxDispositivos = MAX_DISPOSITIVOS }) {
  const fecha = entrada.fecha;
  if (!config.pushActivo) return { estado: "desactivado", pendientes: 0 };
  if (!configVapid(entorno).ok) return { estado: "sin_vapid", pendientes: 0 };
  const subs = await kv.get("informe-subs", "json");
  const dispositivos = subs?.dispositivos || [];
  if (!dispositivos.length) return { estado: "sin_suscripciones", pendientes: 0 };

  const payload = { tipo: "informe", fecha, titulo: "Solar Monitor", texto: "Tu informe solar está disponible", ruta: `./#informe=${fecha}` };
  const restantes = [];
  let enviados = 0;
  let cambios = false;
  let procesados = 0;
  for (const d of dispositivos) {
    const previo = d.entrega?.[fecha];
    if (previo?.estado === "enviado" || previo?.estado === "fallido") {
      restantes.push(d);
      continue;
    }
    if (procesados >= maxDispositivos) {
      restantes.push(d);
      continue;
    }
    procesados++;
    const r = await enviarPush(d, payload, entorno, { pedir, ahora });
    cambios = true;
    if (r.resultado === "expirada") continue;
    const intentos = (previo?.intentos || 0) + 1;
    const estado = r.resultado === "enviado" ? "enviado" : r.resultado === "transitorio" && intentos < MAX_ENTREGAS ? "pendiente" : "fallido";
    const entrega = { ...(d.entrega || {}), [fecha]: { estado, intentos, ts: new Date(ahora).toISOString() } };
    for (const viejo of Object.keys(entrega).sort().slice(0, -10)) delete entrega[viejo];
    restantes.push({ ...d, entrega });
  }
  if (cambios) await kv.put("informe-subs", JSON.stringify({ dispositivos: restantes }));
  const estados = restantes.map((d) => d.entrega?.[fecha]?.estado);
  const pendientes = estados.filter((e) => e === "pendiente" || e === undefined).length;
  enviados = estados.filter((e) => e === "enviado").length;
  return { estado: pendientes ? "pendiente" : enviados ? "enviado" : "fallido", pendientes, enviados };
}

const huellaDe = (e) => e?.huella ?? (e?.version && typeof e.version === "object" ? e.version : null);

export async function cambioInforme(kv, previa, fecha) {
  const marca = await kv.get(MARCA_VERSION, "json");
  if (marca?.dia !== fecha) return false;
  const huella = huellaDe(previa);
  return !huella || (marca.f && huella.f !== marca.f) || (!(marca.m > 0) && (huella.a !== marca.a || !!huella.p));
}

/**
 * Un informe fechado anterior a ayer generado mientras se migraban dias que entran en sus acumulados queda
 * marcado (`huella.p`). Al terminar la migracion se rehace, de uno en uno, para su fecha original; conserva la
 * recomendacion de hoy original (con una nota) y el estado de entrega, y no envia nada.
 */
export async function refrescarAnterior(kv, indice, { fecha: ayer, ahora }) {
  const minimo = sumarDias(ayer, -DIAS_REFRESCO);
  const candidata = (indice?.informes || [])
    .filter((e) => e.fecha < ayer && e.fecha >= minimo && (e.estado === "ok" || e.estado === "parcial") && huellaDe(e)?.p && (e.refrescos || 0) < MAX_REFRESCOS)
    .sort((a, b) => a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)[0];
  if (!candidata) return null;
  const marca = await kv.get(MARCA_VERSION, "json");
  if (marca?.dia !== ayer || marca.m > 0) return null;
  const bloqueo = await kv.get("informe-lock", "json");
  if (bloqueo?.hasta > ahora) return null;
  await kv.put("informe-lock", JSON.stringify({ hasta: ahora + LOCK_MS }));
  try {
    const fecha = candidata.fecha;
    const [previo, config, resumen] = await Promise.all([kv.get(claveInforme(fecha), "json"), kv.get("informe-config", "json"), kv.get(RESUMEN, "json")]);
    if (!previo || (previo.estado !== "ok" && previo.estado !== "parcial")) return null;
    const { diarios, integrado } = await leerFuente(kv, resumen, fecha);
    const informe = construirInforme({ integrado, fecha, ahora, config: { ...CONFIG_BASE, ...(config || {}) }, diarios, pendientesMigracion: pendientesRelevantes(resumen, fecha, ayer).length });
    informe.generado = previo.generado;
    informe.actualizado = new Date(ahora).toISOString();
    informe.hoy = previo.hoy ? { ...previo.hoy, nota: `Recomendación elaborada el ${previo.generado.slice(0, 10)}; no se ha recalculado al actualizar este informe.` } : null;
    informe.conclusiones.push({ tipo: "aviso", texto: "Informe actualizado después de incorporar días archivados antes: el acumulado del mes y la comparación pueden diferir de la primera versión. La recomendación de hoy es la original de ese día." });
    await kv.put(claveInforme(fecha), JSON.stringify(informe));
    const actual = (await kv.get("informe-indice", "json")) || indice;
    await guardarIndice(kv, actual, { ...candidata, huella: informe.huella, refrescos: (candidata.refrescos || 0) + 1 });
    return { resultado: "refrescado", fecha, estado: informe.estado };
  } finally {
    await kv.delete("informe-lock");
  }
}

/** Punto de entrada de los crons: respeta las 08:30 de Madrid y repite lo pendiente. */
export async function programado(entorno, { ahora = Date.now(), pedir = (u, i) => fetch(u, i), soloAvisos = false } = {}) {
  const kv = entorno.HISTORICO;
  const config = await kv.get("informe-config", "json");
  if (!config?.activo) return { resultado: "desactivado" };
  if (partesMadrid(ahora).minutosDia < HORA_INFORME) return { resultado: "antes_de_hora" };

  const fecha = sumarDias(diaMadrid(ahora), -1);
  const indice = await kv.get("informe-indice", "json");
  const previa = indice?.informes?.find((e) => e.fecha === fecha);
  const final = previa && (previa.estado === "ok" || previa.estado === "parcial");
  // El archivo publica una version pequena del contenido aceptado de ayer y de los agregados de los
  // dias anteriores. Si no coincide con la del informe (parcial o completo), la fuente cambio.
  if (soloAvisos && !final) return { resultado: "sin_informe" };
  const cambio = final && !soloAvisos && await cambioInforme(kv, previa, fecha);
  const regenerar = cambio && previa.intentos < MAX_GENERACIONES + MAX_REGENERACIONES;
  if (final && !previa.push?.pendientes && !regenerar) return (soloAvisos ? null : await refrescarAnterior(kv, indice, { fecha, ahora })) ?? { resultado: "completo" };
  if (previa && !final && previa.intentos >= MAX_GENERACIONES && !regenerar) return { resultado: "agotado" };

  const bloqueo = await kv.get("informe-lock", "json");
  if (bloqueo?.hasta > ahora) return { resultado: "ocupado" };
  await kv.put("informe-lock", JSON.stringify({ hasta: ahora + LOCK_MS }));
  try {
    let entrada = previa;
    let resultado = "reintento";
    let estado = previa?.estado;
    if (!final || regenerar) {
      ({ entrada } = await generarInforme(entorno, { ahora, pedir }));
      resultado = entrada.estado === "error" ? "error" : "generado";
      estado = entrada.estado;
    }
    if (estado === "ok" || estado === "parcial") {
      // El informe y su indice ya estan guardados: un fallo de envio no los pierde.
      const push = await enviarPendientes(entorno, kv, config, entrada, { ahora, pedir, maxDispositivos: soloAvisos ? 1 : MAX_DISPOSITIVOS });
      const actual = (await kv.get("informe-indice", "json")) || { informes: [entrada] };
      await guardarIndice(kv, actual, { ...entrada, push });
    }
    return { resultado, fecha, estado };
  } finally {
    await kv.delete("informe-lock");
  }
}

// ---------------------------------------------------------------- API

async function leerCuerpo(peticion, responder) {
  const declarado = Number(peticion.headers.get("Content-Length") || 0);
  if (declarado > MAX_CUERPO) return { respuesta: responder(JSON.stringify({ error: "Cuerpo demasiado grande." }), 413, "application/json") };
  const texto = await peticion.text();
  if (texto.length > MAX_CUERPO) return { respuesta: responder(JSON.stringify({ error: "Cuerpo demasiado grande." }), 413, "application/json") };
  try {
    return { valor: JSON.parse(texto || "{}") };
  } catch {
    return { respuesta: responder(JSON.stringify({ error: "El cuerpo no es JSON válido." }), 400, "application/json") };
  }
}

export const RUTAS_INFORME = ["/informe/config", "/informe/suscripcion", "/informe/prueba", "/informe/indice", "/informe/ver", "/informe/generar", "/informe/avanzar"];

/** Atiende /informe/*; la autenticacion ya la ha hecho index.js. */
export async function manejarInforme(peticion, entorno, url, responder, { ahora = Date.now() } = {}) {
  const kv = entorno.HISTORICO;
  const json = (obj, estado = 200) => responder(JSON.stringify(obj), estado, "application/json");
  const error = (mensaje, estado) => json({ error: mensaje }, estado);
  const ruta = url.pathname;
  const m = peticion.method;

  if (ruta === "/informe/config" && m === "GET") {
    const [config, subs] = await Promise.all([kv.get("informe-config", "json"), kv.get("informe-subs", "json")]);
    const v = configVapid(entorno);
    return json({ config: { ...CONFIG_BASE, ...(config || {}) }, vapid: v.ok ? { disponible: true, publica: v.publica } : { disponible: false, error: v.error }, suscripciones: subs?.dispositivos?.length || 0 });
  }

  if (ruta === "/informe/config" && m === "PUT") {
    const c = await leerCuerpo(peticion, responder);
    if (c.respuesta) return c.respuesta;
    const r = validarConfig(c.valor);
    if (!r.ok) return error(r.error, 400);
    await kv.put("informe-config", JSON.stringify(r.valor));
    return json({ guardado: true, config: r.valor });
  }

  if (ruta === "/informe/suscripcion" && m === "PUT") {
    const c = await leerCuerpo(peticion, responder);
    if (c.respuesta) return c.respuesta;
    const v = validarSuscripcion(c.valor?.suscripcion);
    if (!v.ok) return error(v.error, 400);
    const subs = (await kv.get("informe-subs", "json")) || { dispositivos: [] };
    const id = await idSuscripcion(v.valor.endpoint);
    // `reemplaza`: el cliente cambia su propio registro (p. ej. tras rotar la clave VAPID) sin gastar una plaza.
    let reemplazado = null;
    if (c.valor?.reemplaza != null) {
      const viejo = validarEndpoint(c.valor.reemplaza);
      if (!viejo) return error("El endpoint a reemplazar no es válido.", 400);
      reemplazado = subs.dispositivos.find((d) => d.endpoint === viejo && d.id !== id) || null;
    }
    const otros = subs.dispositivos.filter((d) => d.id !== id && d !== reemplazado);
    if (otros.length >= MAX_DISPOSITIVOS) return error(`Solo se admiten ${MAX_DISPOSITIVOS} dispositivos. Quita alguno antes de añadir otro.`, 409);
    const previo = subs.dispositivos.find((d) => d.id === id) || reemplazado;
    const registro = { id, ...v.valor, creada: previo?.creada || new Date(ahora).toISOString(), entrega: previo?.entrega || {} };
    await kv.put("informe-subs", JSON.stringify({ dispositivos: [...otros, registro] }));
    return json({ guardado: true, suscripciones: otros.length + 1 });
  }

  if (ruta === "/informe/suscripcion" && m === "DELETE") {
    const c = await leerCuerpo(peticion, responder);
    if (c.respuesta) return c.respuesta;
    const endpoint = validarEndpoint(c.valor?.endpoint);
    if (!endpoint) return error("Endpoint no válido.", 400);
    const subs = await kv.get("informe-subs", "json");
    const resto = (subs?.dispositivos || []).filter((d) => d.endpoint !== endpoint);
    if (resto.length !== (subs?.dispositivos || []).length) await kv.put("informe-subs", JSON.stringify({ dispositivos: resto }));
    return json({ eliminado: true, suscripciones: resto.length });
  }

  if (ruta === "/informe/prueba" && m === "POST") {
    const c = await leerCuerpo(peticion, responder);
    if (c.respuesta) return c.respuesta;
    const endpoint = validarEndpoint(c.valor?.endpoint);
    if (!endpoint) return error("Endpoint no válido.", 400);
    const subs = await kv.get("informe-subs", "json");
    const d = (subs?.dispositivos || []).find((x) => x.endpoint === endpoint);
    if (!d) return error("Ese dispositivo no está suscrito.", 404);
    const v = configVapid(entorno);
    if (!v.ok) return error(v.error, 503);
    if (d.pruebaTs && ahora - Date.parse(d.pruebaTs) < INTERVALO_PRUEBA) return error("Espera unos segundos antes de otra prueba.", 429);
    const r = await enviarPush(d, { tipo: "prueba", titulo: "Solar Monitor", texto: "Notificación de prueba", ruta: "./" }, entorno, { ahora });
    if (r.resultado === "expirada") {
      await kv.put("informe-subs", JSON.stringify({ dispositivos: subs.dispositivos.filter((x) => x !== d) }));
      return error("El servicio de notificaciones dice que esta suscripción ha caducado: actívala de nuevo.", 410);
    }
    if (r.resultado !== "enviado") return error("El servicio de notificaciones no ha aceptado la prueba.", 502);
    await kv.put("informe-subs", JSON.stringify({ dispositivos: subs.dispositivos.map((x) => (x === d ? { ...x, pruebaTs: new Date(ahora).toISOString() } : x)) }));
    return json({ enviado: true });
  }

  if (ruta === "/informe/indice" && m === "GET") {
    const [indice, trabajo] = await Promise.all([kv.get("informe-indice", "json"), kv.get("informe-trabajo", "json")]);
    return json({
      informes: indice?.informes || [],
      trabajo: trabajo ? {
        fecha: trabajo.fecha, fase: trabajo.fase, error: trabajo.error, actualizado: trabajo.actualizado,
        estado: trabajo.intentosFase >= 3 ? "error" : trabajo.fase === "completo" ? "completo" : "preparando",
      } : null,
    });
  }

  if (ruta === "/informe/ver" && m === "GET") {
    const fecha = url.searchParams.get("fecha") || "";
    if (!FECHA.test(fecha)) return error("Fecha no válida (AAAA-MM-DD).", 400);
    const informe = await kv.get(claveInforme(fecha), "json");
    return informe ? json(informe) : error("No hay informe de ese día.", 404);
  }

  if (ruta === "/informe/generar" && m === "POST") {
    // Los clientes ya abiertos conservan su contrato durante el despliegue de la web.
    if (!url.searchParams.has("fases")) {
      const { informe, entrada } = await generarInforme(entorno, { ahora });
      return json({ fecha: informe.fecha, estado: entrada.estado });
    }
    if (url.searchParams.get("fases") !== "1") return error("Modo de preparación no válido.", 400);
    const { solicitarInforme } = await import("./informe-flujo.js");
    return json(await solicitarInforme(entorno, { ahora }), 202);
  }

  if (ruta === "/informe/avanzar" && m === "POST") {
    const { avanzarInforme } = await import("./informe-flujo.js");
    const resultado = await avanzarInforme(entorno, { ahora });
    return json(resultado, resultado.resultado === "agotado" ? 503 : 200);
  }

  return responder("Metodo no permitido.", 405);
}
