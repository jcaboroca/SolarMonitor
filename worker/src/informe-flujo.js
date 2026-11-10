// Una sola fase por invocacion: la espera entre fases no comparte presupuesto de CPU.
import { diaMadrid, sumarDias, partesMadrid } from "./horario.js";
import { RESUMEN } from "./archivo.js";
import { prepararPrevision, prepararCalibracion } from "./informe-hoy.js";
import { prepararFuente, generarInforme, programado, cambioInforme, refrescarAnterior, MAX_GENERACIONES, MAX_REGENERACIONES } from "./informe.js";
import { leerTrabajo, TRABAJO, INTENTO } from "./informe-estado.js";
import { prepararPrecios } from "./informe-precios.js";

const LOCK = "informe-fases-lock";
const PREPARAR_DESDE = 8 * 60 + 25;
const AVISAR_DESDE = 8 * 60 + 30;
const MAX_INTENTOS_FASE = 3;
const HORA = 3600000;
const firma = (config) => JSON.stringify(config || {});
const fechaInforme = (ahora) => sumarDias(diaMadrid(ahora), -1);
const clave = (fase) => `informe-preparado-${fase}`;
const terminado = (entrada) => entrada && ["ok", "parcial"].includes(entrada.estado);

function nuevoTrabajo(config, ahora, manual) {
  return {
    id: crypto.randomUUID(), fecha: fechaInforme(ahora), config: firma(config), manual,
    fase: "fuente", intentosFase: 0, actualizado: new Date(ahora).toISOString(),
  };
}

export async function solicitarInforme(entorno, { ahora = Date.now() } = {}) {
  const kv = entorno.HISTORICO;
  const [config, previo] = await Promise.all([kv.get("informe-config", "json"), leerTrabajo(kv)]);
  const enCurso = previo?.fecha === fechaInforme(ahora) && previo.config === firma(config)
    && previo.fase !== "completo" && previo.intentosFase < MAX_INTENTOS_FASE;
  if (!enCurso) await kv.put(TRABAJO, JSON.stringify(nuevoTrabajo(config, ahora, true)));
  return { fecha: fechaInforme(ahora), estado: "preparando" };
}

async function preparado(kv, trabajo, fase) {
  const dato = await kv.get(clave(fase), "json");
  if (dato?.trabajo !== trabajo.id) throw new Error(`Falta la preparacion de ${fase}.`);
  return dato.valor;
}

export async function avanzarInforme(entorno, { ahora = Date.now(), pedir = (u, i) => fetch(u, i) } = {}) {
  const kv = entorno.HISTORICO;
  const config = await kv.get("informe-config", "json");
  let trabajo = await leerTrabajo(kv);
  const fecha = fechaInforme(ahora);
  const minutos = partesMadrid(ahora).minutosDia;
  const manual = trabajo?.fecha === fecha && trabajo.manual && trabajo.fase !== "completo";
  if (!config?.activo && !manual) return { resultado: "desactivado" };
  if (!manual && minutos < PREPARAR_DESDE) return { resultado: "antes_de_hora" };
  if (!trabajo || trabajo.fecha !== fecha || trabajo.config !== firma(config)) {
    trabajo = nuevoTrabajo(config, ahora, !!manual);
  }
  if (trabajo.intentosFase >= MAX_INTENTOS_FASE) return { resultado: "agotado", fase: trabajo.fase, fecha };
  if (trabajo.reintentarDesde > ahora) return { resultado: "esperando", fase: trabajo.fase, fecha };

  if (trabajo.fase === "completo") {
    const indice = await kv.get("informe-indice", "json");
    const previa = indice?.informes?.find((e) => e.fecha === fecha);
    const corregido = terminado(previa) && previa.intentos < MAX_GENERACIONES + MAX_REGENERACIONES && await cambioInforme(kv, previa, fecha);
    const reintentar = !terminado(previa) && (previa?.intentos || 0) < MAX_GENERACIONES
      && ahora - Date.parse(trabajo.actualizado) >= HORA;
    const reintentarPrecios = config?.tarifa?.mercado && previa?.preciosEstado !== "disponible"
      && (previa?.intentos || 0) < MAX_GENERACIONES + MAX_REGENERACIONES && ahora - Date.parse(trabajo.actualizado) >= HORA;
    if (corregido || reintentar || reintentarPrecios) trabajo = nuevoTrabajo(config, ahora, false);
    else {
      if (previa?.push?.pendientes && minutos >= AVISAR_DESDE) trabajo = { ...trabajo, fase: "aviso" };
      else {
        const anterior = await refrescarAnterior(kv, indice, { fecha, ahora });
        return anterior ?? { resultado: "completo" };
      }
    }
  }

  if (trabajo.fase === "aviso" && minutos < AVISAR_DESDE) return { resultado: "antes_de_hora", fase: "aviso", fecha };
  if (trabajo.fase !== "fuente" && ahora - Date.parse(trabajo.actualizado) < 1100) return { resultado: "ocupado" };
  const bloqueo = await kv.get(LOCK, "json");
  if (bloqueo?.hasta > ahora) return { resultado: "ocupado" };
  await kv.put(LOCK, JSON.stringify({ hasta: ahora + 120000 }));
  const fase = trabajo.fase;
  try {
    // Una terminacion por CPU no ejecuta catch/finally. Consumir el intento antes del trabajo.
    trabajo = { ...trabajo, intentosFase: trabajo.intentosFase + 1, reintentarDesde: ahora + 60000,
      error: `Fase ${fase} iniciada; pendiente de completar.`, actualizado: new Date(ahora).toISOString() };
    await kv.put(INTENTO, JSON.stringify(trabajo));
    let valor;
    let siguiente;
    if (fase === "fuente") {
      valor = await prepararFuente(entorno, { ahora });
      siguiente = "prevision";
    } else if (fase === "prevision") {
      valor = await prepararPrevision({ config: config || {}, ahora, pedir });
      siguiente = "calibracion";
    } else if (fase === "calibracion") {
      const resumen = await kv.get(RESUMEN, "json");
      valor = await prepararCalibracion({ config: config || {}, resumen, ahora, pedir });
      siguiente = config?.tarifa?.mercado ? "precios" : "informe";
    } else if (fase === "precios") {
      valor = await prepararPrecios({ config, ahora, pedir });
      siguiente = "informe";
    } else if (fase === "informe") {
      const [fuente, prevision, calibracion] = await Promise.all(["fuente", "prevision", "calibracion"].map((f) => preparado(kv, trabajo, f)));
      const precios = config?.tarifa?.mercado ? await preparado(kv, trabajo, "precios") : null;
      const r = await generarInforme(entorno, { ahora, preparacion: { fuente, prevision, calibracion, precios } });
      if (r.informe.estado === "error") throw new Error("No se pudo componer el informe.");
      siguiente = "aviso";
    } else if (fase === "aviso") {
      await programado(entorno, { ahora, pedir, soloAvisos: true });
      const indice = await kv.get("informe-indice", "json");
      const entrada = indice?.informes?.find((e) => e.fecha === fecha);
      siguiente = entrada?.push?.pendientes && config?.activo ? "aviso" : "completo";
    } else {
      throw new Error("Fase de informe desconocida.");
    }
    if (valor !== undefined) {
      await kv.put(clave(fase), JSON.stringify({ trabajo: trabajo.id, valor }));
      // Tras tres fallos meteorologicos se conserva su estado explicito y se publica
      // el informe energetico sin inventar una prevision.
      if ((valor.estado === "meteo_no_disponible" || (fase === "precios" && valor.estado === "no_disponible")) && trabajo.intentosFase < MAX_INTENTOS_FASE) {
        trabajo = { ...trabajo, error: fase === "precios" ? "No se pudieron preparar los precios REE; se reintentara." : "No se pudo preparar la meteorologia; se reintentara." };
        await kv.put(TRABAJO, JSON.stringify(trabajo));
        return { resultado: "reintento", fase, fecha };
      }
    }
    trabajo = { ...trabajo, fase: siguiente, intentosFase: 0, reintentarDesde: 0, error: null, actualizado: new Date(ahora).toISOString() };
    await kv.put(TRABAJO, JSON.stringify(trabajo));
    return { resultado: "preparado", fase, fecha };
  } catch {
    console.error("Fallo en fase del informe.", { fase, fecha });
    trabajo = { ...trabajo, error: `No se pudo completar la fase ${fase}.` };
    await kv.put(TRABAJO, JSON.stringify(trabajo));
    return { resultado: "error", fase, fecha };
  } finally {
    await kv.delete(LOCK);
  }
}
