// Pestaña «Ahora»: junta dato en vivo, habitos y prevision y pinta el semaforo.
// Toda la logica energetica vive en js/asesor/; aqui solo se trae y se pinta.

import { crearTarifa, TARIFA_POR_DEFECTO } from "./asesor/tarifa.js";
import { aHoras, crearHabitos } from "./asesor/habitos.js";
import { leerOpenMeteo, calibrar, preverSolar, urlPrevision, urlPrevisionPasada } from "./asesor/prevision.js";
import { construirHorizonte, decidir, lineaDelDia, reservaRecomendada, BATERIA_POR_DEFECTO, euros, cuando } from "./asesor/motor.js";
import { combinarAparatos, APARATOS_POR_DEFECTO, CARGA_REFERENCIA } from "./asesor/aparatos.js";
import { leerSerie } from "./historico.js";
import { deserializarSerie } from "./datos.js";
import { hayNube, pedirNube } from "./nube.js";

const $ = (id) => document.getElementById(id);
const HORA = 3600000;
const DIA = 24 * HORA;
const MINUTOS_VIVO = 20;
const CLAVE_CONFIG = "solar-monitor-asesor";
const CLAVE_VIVO = "solar-monitor-vivo";
const CLAVE_PREVISION = "solar-monitor-prevision";
const CLAVE_CALIBRACION = "solar-monitor-calibracion";

const leerJson = (clave, defecto) => {
  try {
    return JSON.parse(localStorage.getItem(clave)) ?? defecto;
  } catch {
    return defecto;
  }
};
const guardarJson = (clave, valor) => {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    // Sin cache se sigue funcionando: solo se pierde el modo sin conexion.
  }
};

const POR_DEFECTO = {
  lat: null,
  lon: null,
  kWp: null,
  potenciaContratadaKw: 3.1,
  bateria: { ...BATERIA_POR_DEFECTO },
  tarifa: { energia: { ...TARIFA_POR_DEFECTO.energia }, excedentes: TARIFA_POR_DEFECTO.excedentes },
  aparatos: [],
  aparato: CARGA_REFERENCIA.id,
};

function leerConfig() {
  const c = leerJson(CLAVE_CONFIG, {});
  return {
    ...POR_DEFECTO,
    ...c,
    bateria: { ...POR_DEFECTO.bateria, ...c.bateria },
    tarifa: {
      energia: { ...POR_DEFECTO.tarifa.energia, ...c.tarifa?.energia },
      excedentes: c.tarifa?.excedentes ?? POR_DEFECTO.tarifa.excedentes,
    },
  };
}
const guardarConfig = (cambios) => guardarJson(CLAVE_CONFIG, { ...leerConfig(), ...cambios });

// --- Datos -------------------------------------------------------------------

async function traerVivo() {
  if (!hayNube()) return leerJson(CLAVE_VIVO, null);
  try {
    const respuesta = await pedirNube("/solarman/estado");
    if (!respuesta.ok) throw new Error(`La nube ha respondido ${respuesta.status}.`);
    const guardado = { estado: await respuesta.json(), traido: Date.now() };
    guardarJson(CLAVE_VIVO, guardado);
    return guardado;
  } catch (error) {
    const previo = leerJson(CLAVE_VIVO, null);
    return { ...(previo || {}), fallo: error.message };
  }
}

const horasDelWorker = (estado) =>
  (estado?.horas || []).map(([hora, casaWh, solarWh, , , soc, minutos]) => ({
    inicio: new Date(hora * HORA),
    casaKwh: casaWh / 1000,
    solarKwh: solarWh / 1000,
    socFin: soc,
    cobertura: Math.min(minutos / 60, 1),
  }));

function horasLocales() {
  const guardado = leerSerie();
  const serie = guardado && deserializarSerie(guardado.serie);
  return serie ? aHoras(serie.registros, serie.unidadesRol) : [];
}

function juntarHoras(...listas) {
  const porHora = new Map();
  for (const lista of listas) for (const h of lista) porHora.set(h.inicio.getTime(), h);
  return [...porHora.values()].sort((a, b) => a.inicio - b.inicio);
}

async function traerPrevision(c) {
  if (c.lat === null || c.lon === null) return null;
  const cache = leerJson(CLAVE_PREVISION, null);
  if (cache && cache.lat === c.lat && cache.lon === c.lon && Date.now() - cache.traido < HORA) return cache;
  try {
    const json = await (await fetch(urlPrevision({ lat: c.lat, lon: c.lon }))).json();
    if (!json.hourly) throw new Error(json.reason || "Open-Meteo no ha devuelto previsión.");
    const nueva = { lat: c.lat, lon: c.lon, traido: Date.now(), json };
    guardarJson(CLAVE_PREVISION, nueva);
    return nueva;
  } catch (error) {
    return cache ? { ...cache, fallo: error.message } : { fallo: error.message };
  }
}

const diaIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function traerCalibracion(c, horas) {
  const conSol = horas.filter((h) => h.solarKwh > 0.01);
  if (c.lat === null || c.lon === null || !conSol.length) return calibrar([], []);
  const hasta = conSol.at(-1).inicio;
  const desde = new Date(Math.max(conSol[0].inicio.getTime(), hasta.getTime() - 60 * DIA));
  // Una vez al dia basta: el factor apenas cambia de una hora a otra.
  const clave = `${c.lat},${c.lon},${diaIso(desde)},${diaIso(hasta)}`;
  const cache = leerJson(CLAVE_CALIBRACION, null);
  if (cache?.clave === clave) return cache.calibracion;
  try {
    const json = await (await fetch(urlPrevisionPasada({ lat: c.lat, lon: c.lon, desde: diaIso(desde), hasta: diaIso(hasta) }))).json();
    const calibracion = calibrar(horas.filter((h) => h.inicio >= desde), leerOpenMeteo(json));
    guardarJson(CLAVE_CALIBRACION, { clave, calibracion });
    return calibracion;
  } catch {
    return cache?.calibracion ?? calibrar([], []);
  }
}

// --- Calculo -----------------------------------------------------------------

let contexto = null;

async function calcular() {
  const c = leerConfig();
  const [vivoGuardado, prevision] = await Promise.all([traerVivo(), traerPrevision(c)]);
  const estadoWorker = vivoGuardado?.estado;
  const horas = juntarHoras(horasLocales(), horasDelWorker(estadoWorker));
  const ahora = new Date();
  const habitos = crearHabitos(horas, { ahora });
  const calibracion = await traerCalibracion(c, horas);
  const irradiancia = prevision?.json ? leerOpenMeteo(prevision.json) : [];
  const solar = preverSolar(irradiancia, calibracion, { kWp: c.kWp, ahora });

  const ultimo = estadoWorker?.ultimo;
  const vivo = ultimo && Number.isFinite(ultimo.soc)
    ? { instante: new Date(ultimo.t), solarW: ultimo.solarW, casaW: ultimo.casaW, soc: ultimo.soc }
    : null;
  const fresco = vivo && ahora - vivo.instante <= MINUTOS_VIVO * 60000 ? vivo : null;
  const socTipico = habitos.socTipico(ahora.getHours());
  const socPct = vivo?.soc ?? socTipico ?? 50;

  contexto = {
    c, ahora, habitos, calibracion, solar, vivo, fresco, socPct,
    socEstimado: !fresco,
    slots: construirHorizonte({ ahora, vivo: fresco, solar, habitos, tarifa: crearTarifa(c.tarifa) }),
    estadoWorker,
    falloVivo: vivoGuardado?.fallo,
    falloPrevision: prevision?.fallo,
    sinUbicacion: c.lat === null || c.lon === null,
  };
}

function cargaElegida(c) {
  return [CARGA_REFERENCIA, ...combinarAparatos(c.aparatos)].find((a) => a.id === c.aparato) || CARGA_REFERENCIA;
}

// --- Pintado -----------------------------------------------------------------

const ROTULO = { verde: "Buen momento", amarillo: "Cuidado", rojo: "Evita ahora" };
const FORMA = { verde: "●", amarillo: "▲", rojo: "■" };
const fmt = (x, d = 1) => x.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const hhmm = (d) => d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

function haceCuanto(ms) {
  const minutos = Math.round(ms / 60000);
  if (minutos < 1) return "ahora mismo";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  return horas < 48 ? `hace ${horas} h` : `hace ${Math.round(horas / 24)} días`;
}

function elemento(etiqueta, clase, texto) {
  const e = document.createElement(etiqueta);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function pintarDecision() {
  const k = contexto;
  const carga = cargaElegida(k.c);
  const bateria = k.c.bateria;
  const decision = decidir({
    ahora: k.ahora, slots: k.slots, bateria, socPct: k.socPct, carga,
    potenciaContratadaKw: k.c.potenciaContratadaKw, vivo: k.fresco,
  });

  // Semaforo: forma + texto + color, nunca solo color.
  const luz = $("luzSemaforo");
  luz.dataset.estado = decision.estado || "";
  $("formaSemaforo").textContent = FORMA[decision.estado] || "?";
  $("tituloSemaforo").textContent = decision.titulo;
  $("semaforo").setAttribute("aria-label", `${ROTULO[decision.estado] || "Sin datos"}: ${decision.titulo}`);

  const cifras = $("cifrasVivo");
  cifras.replaceChildren();
  if (k.vivo) {
    cifras.append(
      elemento("span", "", `☀️ ${fmt(k.vivo.solarW / 1000, 2)} kW`),
      elemento("span", "", `🏠 ${fmt(k.vivo.casaW / 1000, 2)} kW`),
      elemento("span", "", `🔋 ${Math.round(k.vivo.soc)} %`)
    );
  } else {
    cifras.append(elemento("span", "estimado", `🔋 ~${Math.round(k.socPct)} % (estimado)`));
  }

  $("costeAhora").textContent = decision.ahora
    ? `${carga.icono} ${carga.nombre} ahora: ${euros(decision.ahora.coste)}${carga.estimado ? " · consumo estimado" : ""}`
    : "";

  const proxima = $("proximaVentana");
  if (decision.mejor && decision.mejor !== decision.ahora) {
    proxima.hidden = false;
    proxima.textContent = `Mejor: ${cuando(decision.mejor.inicio, k.ahora).toLowerCase()} → ${euros(decision.mejor.coste)}`;
  } else {
    proxima.hidden = true;
  }

  const frescura = $("frescura");
  if (k.vivo) {
    frescura.textContent = `Datos de Solarman ${haceCuanto(k.ahora - k.vivo.instante)}${k.fresco ? "" : " · demasiado viejos para el semáforo"}`;
  } else if (!hayNube()) {
    frescura.textContent = "Sin dato en vivo: configura la sincronización y vincula Solarman en los ajustes de abajo.";
  } else if (k.estadoWorker && !k.estadoWorker.vinculado) {
    frescura.textContent = "Sin dato en vivo: falta vincular Solarman (ajustes de abajo).";
  } else {
    frescura.textContent = "Sin dato en vivo.";
  }
  if (k.estadoWorker?.error) frescura.textContent += ` · ${k.estadoWorker.error}`;
  if (k.estadoWorker?.avisoVivo) frescura.textContent += ` · ${k.estadoWorker.avisoVivo}`;
  if (k.falloVivo) frescura.textContent += ` · Sin conexión con la nube (${k.falloVivo})`;

  // ¿Por que?
  const lista = $("razones");
  lista.replaceChildren(
    ...decision.razones.map((r) => {
      const li = elemento("li");
      li.append(elemento("span", "icono", r.icono), elemento("span", "", r.texto));
      return li;
    })
  );
  const avisos = [];
  if (k.sinUbicacion) avisos.push("Sin ubicación no hay previsión solar: ponla en los ajustes.");
  else if (k.falloPrevision) avisos.push(`Previsión del tiempo no disponible (${k.falloPrevision}).`);
  if (!k.sinUbicacion && k.calibracion.confianza === "ninguna") avisos.push("Previsión solar sin calibrar: faltan datos de producción.");
  $("confianza").textContent = [`Confianza: ${decision.confianza || "baja"}.`, ...avisos].join(" ");

  pintarVentanas(decision, carga);
  pintarLinea(carga);
  pintarAparatos(carga);
}

function pintarVentanas(decision, carga) {
  const lista = $("listaVentanas");
  lista.replaceChildren();
  if (!decision.mejor) return;
  // Una alternativa que no mejora a "ahora" solo mete ruido.
  const filas = [decision.mejor, ...decision.alternativas.filter((a) => a.coste < decision.ahora.coste - 0.005)];
  for (const [i, v] of filas.entries()) {
    const li = elemento("li", i === 0 ? "destacada" : "");
    li.append(
      elemento("span", "cuando", `${cuando(v.inicio, contexto.ahora)} → ${hhmm(v.fin)}`),
      elemento("span", "numero", euros(v.coste))
    );
    lista.append(li);
  }
  $("tituloVentanas").textContent = `Mejor momento · ${carga.nombre.toLowerCase()} (${fmt(carga.duracionH)} h)`;
}

function pintarLinea(carga) {
  const k = contexto;
  const linea = lineaDelDia({ ahora: k.ahora, slots: k.slots, bateria: k.c.bateria, socPct: k.socPct, carga });
  const caja = $("linea");
  caja.replaceChildren(
    ...linea.map((h) => {
      const celda = elemento("div", `hora ${h.estado}`);
      const etiqueta = `${hhmm(h.inicio)}: ${ROTULO[h.estado].toLowerCase()}, ${euros(h.coste)}`;
      celda.title = etiqueta;
      celda.setAttribute("role", "listitem");
      celda.setAttribute("aria-label", etiqueta);
      celda.append(elemento("span", "marca", FORMA[h.estado]), elemento("span", "rotulo", String(h.inicio.getHours()).padStart(2, "0")));
      return celda;
    })
  );

  // Sin prevision solar la reserva saldria siempre al 100 %: mejor no decir nada.
  const reserva = k.solar.length ? reservaRecomendada({ slots: k.slots, bateria: k.c.bateria, socPct: k.socPct }) : null;
  const tarjeta = $("reserva");
  tarjeta.hidden = !reserva?.aplicaAhora;
  if (reserva?.aplicaAhora) {
    $("pctReserva").textContent = `${Math.round(reserva.pct)} %`;
    $("textoReserva").textContent = reserva.sinSol
      ? `No se prevé sol suficiente para cubrir la casa en lo que alcanza la previsión: la batería tendría que aguantar ≈ ${fmt(reserva.necesidadKwh)} kWh.`
      : `Hasta que el sol vuelva a cubrir la casa (${cuando(reserva.hasta, k.ahora).toLowerCase()}) harán falta ≈ ${fmt(reserva.necesidadKwh)} kWh.`;
    const enElSuelo = k.socPct <= k.c.bateria.socMinimoPct + 2;
    const aviso = $("avisoReserva");
    aviso.hidden = reserva.suficiente;
    aviso.textContent = enElSuelo
      ? "🔋 La batería ya está en la reserva mínima: lo que consumas hasta que vuelva el sol saldrá de la red."
      : "🔋 Guarda batería: evita consumos grandes hasta que vuelva el sol.";
  }

  const aprendiendo = $("aprendiendo");
  aprendiendo.hidden = !k.habitos.aprendiendo;
  if (k.habitos.aprendiendo) {
    $("textoAprendiendo").textContent = k.habitos.historicoAntiguo
      ? `Uso tu histórico antiguo (${k.habitos.dias} días) mientras junto datos recientes: llevo ${k.habitos.diasRecientes} de 7.`
      : `Llevo ${k.habitos.diasRecientes} días de datos recientes; con 7 empiezo a fiarme de tus hábitos.`;
  }
}

function pintarAparatos(elegida) {
  const caja = $("aparatos");
  const todos = [CARGA_REFERENCIA, ...combinarAparatos(contexto.c.aparatos)];
  caja.replaceChildren(
    ...todos.map((a) => {
      const boton = elemento("button", "chip");
      boton.type = "button";
      boton.setAttribute("role", "radio");
      boton.setAttribute("aria-checked", String(a.id === elegida.id));
      boton.append(elemento("span", "", a.icono), elemento("span", "", a.nombre));
      boton.addEventListener("click", () => {
        guardarConfig({ aparato: a.id });
        contexto.c = leerConfig();
        pintarDecision();
      });
      return boton;
    })
  );
}

// --- Ajustes -----------------------------------------------------------------

const CAMPOS = [
  ["ajLat", (c) => c.lat, (c, v) => (c.lat = v)],
  ["ajLon", (c) => c.lon, (c, v) => (c.lon = v)],
  ["ajKwp", (c) => c.kWp, (c, v) => (c.kWp = v)],
  ["ajCapacidad", (c) => c.bateria.capacidadKwh, (c, v) => (c.bateria.capacidadKwh = v ?? BATERIA_POR_DEFECTO.capacidadKwh)],
  ["ajSocMinimo", (c) => c.bateria.socMinimoPct, (c, v) => (c.bateria.socMinimoPct = v ?? BATERIA_POR_DEFECTO.socMinimoPct)],
  ["ajRendimiento", (c) => Math.round(c.bateria.rendimiento * 100), (c, v) => (c.bateria.rendimiento = v ? v / 100 : BATERIA_POR_DEFECTO.rendimiento)],
  ["ajPotencia", (c) => c.potenciaContratadaKw, (c, v) => (c.potenciaContratadaKw = v)],
  ["ajP1", (c) => c.tarifa.energia.P1, (c, v) => (c.tarifa.energia.P1 = v ?? TARIFA_POR_DEFECTO.energia.P1)],
  ["ajP2", (c) => c.tarifa.energia.P2, (c, v) => (c.tarifa.energia.P2 = v ?? TARIFA_POR_DEFECTO.energia.P2)],
  ["ajP3", (c) => c.tarifa.energia.P3, (c, v) => (c.tarifa.energia.P3 = v ?? TARIFA_POR_DEFECTO.energia.P3)],
  ["ajExcedentes", (c) => c.tarifa.excedentes, (c, v) => (c.tarifa.excedentes = v ?? TARIFA_POR_DEFECTO.excedentes)],
];

const leerNumero = (input) => {
  const v = parseFloat(String(input.value).replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

function pintarAjustes() {
  const c = leerConfig();
  for (const [id, leer] of CAMPOS) $(id).value = leer(c) ?? "";
  const cuerpo = $("tablaAparatos").querySelector("tbody");
  const propios = combinarAparatos(c.aparatos);
  cuerpo.replaceChildren(
    ...propios.map((a) => {
      const fila = elemento("tr");
      fila.dataset.id = a.id;
      fila.append(elemento("td", "", `${a.icono} ${a.nombre}${a.estimado ? " (estimado)" : ""}`));
      for (const [campo, paso] of [["energiaKwh", "0.1"], ["duracionH", "0.25"], ["potenciaPicoW", "100"]]) {
        const td = elemento("td", "numero");
        const input = elemento("input");
        input.type = "number";
        input.step = paso;
        input.min = "0";
        input.value = a[campo];
        input.dataset.campo = campo;
        input.setAttribute("aria-label", `${a.nombre}: ${campo}`);
        td.append(input);
        fila.append(td);
      }
      return fila;
    })
  );
}

function guardarAjustes() {
  const c = leerConfig();
  for (const [id, , escribir] of CAMPOS) escribir(c, leerNumero($(id)));
  c.aparatos = [...$("tablaAparatos").querySelectorAll("tbody tr")].map((fila) => {
    const propio = { id: fila.dataset.id };
    for (const input of fila.querySelectorAll("input")) {
      const defecto = APARATOS_POR_DEFECTO.find((a) => a.id === fila.dataset.id)?.[input.dataset.campo];
      const v = leerNumero(input);
      // Solo se guarda lo que el usuario cambio: lo demas sigue marcado como estimado.
      if (v !== null && v !== defecto) propio[input.dataset.campo] = v;
    }
    return propio;
  });
  guardarJson(CLAVE_CONFIG, c);
}

async function vincularSolarman() {
  const marca = $("estadoVincular");
  const token = $("tokenSolarman").value.trim();
  marca.className = "estado";
  if (!hayNube()) {
    marca.className = "estado error";
    marca.textContent = "Antes hay que configurar la sincronización (⚙ arriba).";
    return;
  }
  marca.textContent = "Probando…";
  try {
    const respuesta = await pedirNube("/solarman/vincular", { method: "PUT", body: token });
    const r = await respuesta.json();
    if (r.resultado === "error") throw new Error(r.error);
    $("tokenSolarman").value = "";
    marca.textContent = r.lectura ? `Vinculado: batería al ${r.lectura.soc} %.` : "Vinculado.";
    await pintarAhora();
  } catch (error) {
    marca.className = "estado error";
    marca.textContent = error.message;
  }
}

function usarUbicacion() {
  const marca = $("estadoUbicacion");
  if (!navigator.geolocation) {
    marca.textContent = "Este navegador no da la ubicación: escríbela a mano.";
    return;
  }
  marca.textContent = "Buscando…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $("ajLat").value = Math.round(pos.coords.latitude * 100) / 100;
      $("ajLon").value = Math.round(pos.coords.longitude * 100) / 100;
      marca.textContent = "";
      guardarAjustes();
      pintarAhora();
    },
    (error) => (marca.textContent = error.message),
    { maximumAge: DIA, timeout: 15000 }
  );
}

// --- Entrada -----------------------------------------------------------------

let pintando = null;

export function pintarAhora() {
  // Si ya hay un repintado en marcha no se lanza otro: los datos serian los mismos.
  pintando ??= calcular()
    .then(pintarDecision)
    .catch((error) => {
      $("tituloSemaforo").textContent = "No he podido calcular";
      $("frescura").textContent = error.message;
    })
    .finally(() => (pintando = null));
  return pintando;
}

export function iniciarAhora({ visible }) {
  pintarAjustes();
  $("formAsesor").addEventListener("change", () => {
    guardarAjustes();
    pintarAhora();
  });
  $("formAsesor").addEventListener("submit", (evento) => evento.preventDefault());
  $("usarUbicacion").addEventListener("click", usarUbicacion);
  $("vincularSolarman").addEventListener("click", vincularSolarman);
  // El datalogger sube cada ~5 min: no tiene sentido mirar mas a menudo.
  setInterval(() => visible() && document.visibilityState === "visible" && pintarAhora(), 5 * 60000);
  document.addEventListener("visibilitychange", () => visible() && document.visibilityState === "visible" && pintarAhora());
}
