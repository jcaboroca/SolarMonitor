// Pestaña «Ahora»: junta dato en vivo, habitos y prevision y pinta el semaforo.
// Toda la logica energetica vive en js/asesor/; aqui solo se trae y se pinta.

import { crearTarifa, TARIFA_POR_DEFECTO } from "./asesor/tarifa.js";
import { aHoras, crearHabitos } from "./asesor/habitos.js";
import { leerOpenMeteo, calibrar, preverSolar, urlPrevision, urlPrevisionPasada } from "./asesor/prevision.js";
import { construirHorizonte, decidir, lineaDelDia, reservaRecomendada, BATERIA_POR_DEFECTO, euros, cuando } from "./asesor/motor.js";
import { combinarAparatos, APARATOS_POR_DEFECTO, CARGA_REFERENCIA, CONSUMOS_FIJOS } from "./asesor/aparatos.js";
import { urlMercado, leerMercado, preciosIndexados, INDEXADA_POR_DEFECTO } from "./asesor/mercado.js";
import { leerSerie } from "./historico.js";
import { deserializarSerie } from "./datos.js";
import { hayNube, pedirNube } from "./nube.js";
import { simular } from "./asesor/simulador.js";
import { iconoAparato, iconoRazon, forma, htmlIcono } from "./iconos.js";
import { modeloArco, pintarArco, elementoCifra, franjaEn, resaltarFranja } from "./arco.js";

const $ = (id) => document.getElementById(id);
const HORA = 3600000;
const DIA = 24 * HORA;
const MINUTOS_VIVO = 20;
const CLAVE_CONFIG = "solar-monitor-asesor";
const CLAVE_VIVO = "solar-monitor-vivo";
const CLAVE_PREVISION = "solar-monitor-prevision";
const CLAVE_CALIBRACION = "solar-monitor-calibracion";
const CLAVE_MERCADO = "solar-monitor-mercado";

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
  indexada: true,
  suplemento: INDEXADA_POR_DEFECTO.suplemento,
  bateria: { ...BATERIA_POR_DEFECTO },
  tarifa: { energia: { ...TARIFA_POR_DEFECTO.energia }, excedentes: TARIFA_POR_DEFECTO.excedentes },
  aparatos: [],
  aparato: CARGA_REFERENCIA.id,
};

function leerConfig() {
  const c = leerJson(CLAVE_CONFIG, {});
  // Los precios de Nexus que se guardaron al tocar los ajustes ya no valen tras pasar a Octopus.
  if (c.tarifa?.energia?.P1 === 0.108727 && c.tarifa?.excedentes === 0.012645) delete c.tarifa;
  // El suplemento de 4,6 c€ salio de solo 8 dias de agosto; septiembre lo afino a 5 c€.
  if (c.suplemento === 0.046) delete c.suplemento;
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

const horasDelArchivo = (estado) =>
  (estado?.horasArchivo || []).map(([hora, casaWh, solarWh, soc, minutos]) => ({
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

export function juntarHoras(...listas) {
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

// REE publica el dia siguiente hacia mediodia: con mirar cada hora basta.
async function traerMercado(c, ahora) {
  if (!c.indexada) return null;
  const cache = leerJson(CLAVE_MERCADO, null);
  if (cache && cache.dia === diaIso(ahora) && ahora - cache.traido < HORA) return cache;
  try {
    const json = await (await fetch(urlMercado(ahora))).json();
    if (!leerMercado(json).size) throw new Error("REE no ha devuelto precios.");
    const nuevo = { dia: diaIso(ahora), traido: ahora.getTime(), json };
    guardarJson(CLAVE_MERCADO, nuevo);
    return nuevo;
  } catch (error) {
    return cache ? { ...cache, fallo: error.message } : { fallo: error.message };
  }
}

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
  const ahora = new Date();
  const [vivoGuardado, prevision, mercadoGuardado] = await Promise.all([traerVivo(), traerPrevision(c), traerMercado(c, ahora)]);
  const estadoWorker = vivoGuardado?.estado;
  // El arco necesita saber de dónde sale cada hora; el asesor sigue usando la lista combinada.
  const horasPorFuente = { local: horasLocales(), archivo: horasDelArchivo(estadoWorker), worker: horasDelWorker(estadoWorker) };
  const horas = juntarHoras(horasPorFuente.local, horasPorFuente.archivo, horasPorFuente.worker);
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

  const mercado = mercadoGuardado?.json ? leerMercado(mercadoGuardado.json) : new Map();
  const horaria = mercado.size ? preciosIndexados(mercado, { ...INDEXADA_POR_DEFECTO, suplemento: c.suplemento ?? INDEXADA_POR_DEFECTO.suplemento }) : null;
  const ultimaHoraConPrecio = mercado.size ? Math.max(...mercado.keys()) : null;

  contexto = {
    c, ahora, habitos, calibracion, solar, vivo, fresco, socPct,
    socEstimado: !fresco,
    slots: construirHorizonte({ ahora, vivo: fresco, solar, habitos, tarifa: crearTarifa({ ...c.tarifa, horaria }) }),
    estadoWorker,
    horasPorFuente,
    previsionTraida: Number.isFinite(prevision?.traido) ? new Date(prevision.traido) : null,
    falloVivo: vivoGuardado?.fallo,
    falloPrevision: prevision?.fallo,
    falloMercado: mercadoGuardado?.fallo,
    // Sin precio del mercado para todo el dia siguiente se tira de las medias por periodo.
    sinPrecioManana: Boolean(c.indexada && (!ultimaHoraConPrecio || ultimaHoraConPrecio < ahora.getTime() + 23 * HORA)),
    sinUbicacion: c.lat === null || c.lon === null,
  };
}

function cargaElegida(c) {
  return [CARGA_REFERENCIA, ...combinarAparatos(c.aparatos)].find((a) => a.id === c.aparato) || CARGA_REFERENCIA;
}

// --- Pintado -----------------------------------------------------------------

const ROTULO = { verde: "Buen momento", amarillo: "Cuidado", rojo: "Evita ahora" };
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

// Icono del sprite delante de un texto: el texto no cambia, el emoji desaparece.
function conIcono(e, icono, texto = "") {
  e.replaceChildren();
  if (icono) e.insertAdjacentHTML("afterbegin", htmlIcono(icono));
  e.append(texto);
  return e;
}

// --- Instrumento (arco, suelo y «Ver por horas») ---------------------------------

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaCorta = (d) => `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`;
const conMovimiento = () => window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
const icono = (nombre) => {
  const plantilla = document.createElement("template");
  plantilla.innerHTML = htmlIcono(nombre);
  return plantilla.content.firstChild;
};

let modelo = null;

/** Devuelve una función id → <data> (o null si el modelo no tiene esa cifra). */
function cifrasDe(m, opciones) {
  const mapa = new Map(m.cifras.map((c) => [c.id, c]));
  return (id, extra = opciones) => (mapa.has(id) ? elementoCifra(mapa.get(id), extra) : null);
}

function pintarFrescura(k) {
  const frescura = $("frescura");
  frescura.classList.toggle("vivo", Boolean(k.fresco));
  frescura.replaceChildren(elemento("span", "punto"), elemento("span", "", k.vivo ? `Solarman · ${haceCuanto(k.ahora - k.vivo.instante)}` : "Sin lectura en vivo"));

  // Con una lectura vieja no hace falta aviso: la nota bajo las lecturas ya lo dice.
  const partes = [];
  if (!k.vivo && !hayNube()) partes.push("Sin dato en vivo: configura la sincronización y vincula Solarman en los ajustes del asesor.");
  else if (!k.vivo && k.estadoWorker && !k.estadoWorker.vinculado) partes.push("Sin dato en vivo: falta vincular Solarman (ajustes del asesor).");
  else if (!k.vivo) partes.push("Sin dato en vivo.");
  if (k.estadoWorker?.error) partes.push(k.estadoWorker.error);
  if (k.estadoWorker?.avisoVivo) partes.push(k.estadoWorker.avisoVivo);
  if (k.falloVivo) partes.push(`Sin conexión con la nube (${k.falloVivo})`);
  const aviso = $("avisoVivo");
  aviso.hidden = !partes.length;
  aviso.textContent = partes.join(" · ");
  frescura.title = partes.join(" · ");
}

const NOMBRE_ORIGEN = { vivo: "en vivo", "lectura-antigua": "última lectura", tipico: "típico a esta hora" };

function pintarInstrumento(m, ahora) {
  modelo = m;
  explorar(null);
  const dato = cifrasDe(m);
  const instrumento = document.querySelector(".instrumento");
  instrumento.dataset.fase = ["noche", "mañana"].includes(m.estado) ? "noche" : "dia";

  // Rótulo superior
  const dia = m.dia?.inicio ?? ahora;
  $("ojoDia").textContent = m.dia?.tipo === "mañana" ? `Mañana · previsión · ${fechaCorta(dia)}` : `Hoy · ${fechaCorta(dia)}`;
  $("ojoHora").textContent = hhmm(ahora);
  const escala = $("ojoEscala");
  if (m.dia?.tipo === "mañana" && m.prevision.traida) escala.replaceChildren("previsión de las ", dato("prevision:traida"));
  else escala.textContent = m.escala ? (m.escala.origen === "instalacion" ? "escala de tu instalación" : "escala de este día") : "";

  pintarArco($("arco"), m);
  $("arcoResumen").replaceChildren(...conCifras(m.resumen.plantilla, dato));

  // Extremos y muesca
  const pie = (texto) => elemento("small", "", texto);
  const desde = dato("ventana:desde"), hasta = dato("ventana:hasta");
  $("extDesde").replaceChildren(...(desde ? [desde, pie("inicio de la producción")] : []));
  $("extHasta").replaceChildren(...(hasta ? [hasta, pie("fin de la producción")] : []));
  const muesca = $("extMuesca");
  if (m.muesca) {
    muesca.replaceChildren(icono("f-cuidado"), m.muesca.origen === "medido" ? "Llena antes de las " : "Llena ≈ ", dato("muesca"), pie(m.muesca.origen));
  } else {
    muesca.replaceChildren();
  }

  // Nota del estado (§4.5)
  const nota = $("arcoNota");
  const partes = [];
  if (m.estado === "sin-sol" && m.dia?.tipo === "mañana") partes.push("Sin previsión para mañana.");
  else if (m.estado === "sin-sol") {
    const enlace = elemento("a", "", "Ajustes del asesor");
    enlace.href = "#formAsesor";
    enlace.addEventListener("click", abrirAjustesAsesor);
    partes.push("Sin datos de sol para hoy: pon tu ubicación en ", enlace, ".");
  } else if (m.estado === "noche" && m.marcador.posicion === "antes") {
    partes.push("Producción prevista desde las ", dato("ventana:desde"), ".");
  } else if (m.estado === "noche") {
    partes.push(...(m.visibles.extremos.includes("total:real") ? ["Hoy: ", dato("total:real"), " medidos."] : ["Hoy: sin datos medidos."]));
  }
  nota.hidden = !partes.length;
  nota.replaceChildren(...partes);

  pintarLecturas(m, dato);
  pintarRegla(m, dato);
  pintarLeyenda(m, dato);
  pintarTablaHoras(m, dato);
}

// Sustituye cada {id} de una plantilla por su <data>.
function conCifras(plantilla, dato) {
  return plantilla.split(/(\{[^}]+\})/).filter(Boolean).map((trozo) => {
    const id = /^\{([^}]+)\}$/.exec(trozo)?.[1];
    return id ? dato(id) : trozo;
  });
}

function pintarLecturas(m, dato) {
  const grande = cifrasDe(m, { partir: true });
  const caja = $("cifrasVivo");
  const lectura = (clase, simbolo, nombre, notaTexto, valor) => {
    const fila = elemento("div", `lectura ${clase}`);
    const dt = elemento("dt");
    dt.append(icono(simbolo), nombre, elemento("span", "", notaTexto));
    const dd = elemento("dd");
    dd.append(valor ?? elemento("span", "sin", "—"));
    fila.append(dt, dd);
    return fila;
  };
  const nota = $("lecturasNota");
  nota.hidden = true;
  if (!m.vivo && m.estado === "cargando") {
    caja.replaceChildren();
    return;
  }
  if (m.vivo) {
    const estado = m.vivo.fresco ? "en vivo" : "antigua";
    caja.replaceChildren(
      lectura("l-sol", "i-sol", "Sol", estado, grande("vivo:solarW")),
      lectura("l-casa", "i-casa", "Casa", estado, grande("vivo:casaW")),
      lectura("l-bat", "i-bateria", "Batería", estado, grande("vivo:soc"))
    );
    if (!m.vivo.fresco) {
      nota.hidden = false;
      nota.replaceChildren("Lectura de hace ", dato("vivo:antiguedad"), ": demasiado vieja para el semáforo.");
    }
  } else {
    const b = m.bateria;
    caja.replaceChildren(
      lectura("l-sol", "i-sol", "Sol", "sin lectura", null),
      lectura("l-casa", "i-casa", "Casa", "sin lectura", null),
      lectura("l-bat", "i-bateria", "Batería", b?.soc === null || !b ? "sin dato" : NOMBRE_ORIGEN[b.origenSoc], grande("bateria:soc"))
    );
  }
}

function pintarRegla(m, dato) {
  const regla = $("regla");
  const b = m.bateria;
  const pista = regla.querySelector(".regla-pista");
  const [relleno, min, rec, fin] = pista.children;
  regla.dataset.origen = b?.origenSoc ?? "ninguno";
  regla.style.setProperty("--soc", `${b?.soc ?? 0}%`);
  min.hidden = !(b?.minimo !== null && b?.minimo !== undefined);
  rec.hidden = !b?.recomendada;
  fin.hidden = b?.alAcabarSol === null || b?.alAcabarSol === undefined;
  relleno.hidden = b?.soc === null || b?.soc === undefined;
  if (!min.hidden) regla.style.setProperty("--min", `${b.minimo}%`);
  if (!rec.hidden) regla.style.setProperty("--rec", `${Math.min(b.recomendada.pct, 100)}%`);
  if (!fin.hidden) regla.style.setProperty("--fin", `${b.alAcabarSol}%`);

  const leyenda = $("reglaLeyenda");
  // Antes del primer cálculo (o si falla) no se sabe nada de la batería: no se rotula.
  if (!b) {
    leyenda.replaceChildren();
    regla.setAttribute("aria-label", "Batería");
    return;
  }
  const clave = (clase, ...contenido) => {
    const s = elemento("span");
    s.append(elemento("i", clase), ...contenido);
    return s;
  };
  const partes = [];
  const texto = [];
  if (b.soc === null) {
    partes.push(clave("k-nivel hueco", "sin dato de batería"));
    texto.push("sin dato de batería");
  } else {
    partes.push(clave(`k-nivel${b.origenSoc === "vivo" ? "" : " estimado"}`, `nivel ${NOMBRE_ORIGEN[b.origenSoc]}`));
    texto.push(`${dato("bateria:soc")?.textContent ?? ""} ${NOMBRE_ORIGEN[b.origenSoc]}`);
  }
  if (!min.hidden) {
    partes.push(clave("k-min", "reserva ", dato("bateria:minimo")));
    texto.push(`reserva mínima ${dato("bateria:minimo").textContent}`);
  }
  if (!rec.hidden) {
    partes.push(clave("k-rec", "para esta noche ", dato("bateria:recomendada")));
    texto.push(`recomendada para esta noche ${dato("bateria:recomendada").textContent}`);
  }
  if (!fin.hidden) {
    partes.push(clave("k-fin", "al acabar el sol ≈ ", dato("bateria:alAcabarSol"), " · simulado"));
    texto.push(`al acabar el sol ≈ ${dato("bateria:alAcabarSol").textContent}, simulado`);
  }
  leyenda.replaceChildren(...partes);
  regla.setAttribute("aria-label", `Batería: ${texto.join("; ")}`);
}

const TEXTO_LEYENDA = {
  "sin-calibrar": "estimación por potencia pico, sin calibrar",
  tipico: "lo típico a esta hora, sin previsión",
  "hora-repetida-local": "la hora repetida del cambio no se distingue en el Excel",
};

function pintarLeyenda(m, dato) {
  const caja = $("arcoLeyenda");
  if (!m.ventana) {
    caja.replaceChildren();
    return;
  }
  const clave = (clase, texto) => {
    const s = elemento("span");
    s.append(elemento("i", clase), texto);
    return s;
  };
  const partes = [];
  const manana = m.dia.tipo === "mañana";
  if (!manana) partes.push(clave("k-sol", "sol medido"));
  if (m.leyendas.includes("tipico")) partes.push(clave("k-prev punteado", "sol típico"));
  else if (m.prevision.estimada) partes.push(clave("k-prev discontinuo", "sol estimado (sin calibrar)"));
  else partes.push(clave("k-prev", "sol previsto"));
  if (!manana) partes.push(clave("k-casa", "casa medida"));
  partes.push(clave("k-casa-t", "casa típica"));
  if (m.asesor?.mejor && $("arco").querySelector(".arco-mejor")) partes.push(clave("k-mejor", "mejor ventana"));
  const notas = elemento("span", "leyenda-notas");
  const frases = [];
  if (m.escala) frases.push(["1 rayo lleno = ", dato("escala"), m.escala.origen === "instalacion" ? " · escala de tu instalación" : " · escala de este día"]);
  if (m.prevision.traida) frases.push(["previsión de las ", dato("prevision:traida"), m.prevision.sinConexion ? " (sin conexión)" : ""]);
  else if (m.prevision.sinConexion) frases.push(["previsión sin conexión"]);
  for (const l of m.leyendas) if (TEXTO_LEYENDA[l]) frases.push([TEXTO_LEYENDA[l]]);
  frases.forEach((f, i) => notas.append(...(i ? [" · "] : []), ...f));
  caja.replaceChildren(...partes, notas);
}

// «Ver por horas» (§4.6): el sitio donde se comprueba cada cifra, con el mismo marcado.
const NOMBRE_ESTADO = { completa: "completa", parcial: "parcial", "en-curso": "en curso" };
const NOMBRE_FUENTE = { worker: "Worker", archivo: "archivo", local: "local" };
const NOMBRE_CLASE = { medido: "medido", previsto: "previsto", tipico: "típico", simulado: "simulado", vivo: "en vivo", ajuste: "ajuste", calculo: "cálculo" };

function tablaSimple(titulo, cabeceras, filas) {
  const envoltura = elemento("div", "tabla-envoltorio");
  const tabla = elemento("table", "tabla tabla-horas");
  tabla.append(elemento("caption", "", titulo));
  const cabeza = elemento("tr");
  for (const c of cabeceras) {
    const th = elemento("th", "", c);
    th.scope = "col";
    cabeza.append(th);
  }
  const thead = elemento("thead");
  thead.append(cabeza);
  const tbody = elemento("tbody");
  for (const celdas of filas) {
    const tr = elemento("tr");
    celdas.forEach((contenido, i) => {
      const celda = elemento(i === 0 ? "th" : "td");
      if (i === 0) celda.scope = "row";
      if (Array.isArray(contenido)) celda.append(...contenido.filter((x) => x !== null && x !== undefined));
      else celda.append(contenido ?? "—");
      tr.append(celda);
    });
    tbody.append(tr);
  }
  tabla.append(thead, tbody);
  envoltura.append(tabla);
  return envoltura;
}

function pintarTablaHoras(m, dato) {
  const caja = $("tablaHoras");
  if (!m.dia) {
    caja.replaceChildren(elemento("p", "ayuda", m.estado === "error" ? "No he podido calcular." : "Calculando…"));
    return;
  }
  const manana = m.dia.tipo === "mañana";
  const conTipico = m.franjas.some((f) => f.tipico);
  const cabeceras = ["Hora"];
  if (!manana) cabeceras.push("Sol medido (kWh)", "Estado", "Procedencia");
  cabeceras.push("Sol previsto (kWh)", "Origen de la previsión");
  if (conTipico) cabeceras.push("Sol típico (kWh)");
  if (!manana) cabeceras.push("Casa medida (kWh)");
  cabeceras.push("Casa típica (kWh)");
  if (!manana) cabeceras.push("SoC fin", "Nota");

  const filas = m.franjas.map((f) => {
    const ms = f.inicio.getTime();
    const id = (campo) => dato(`franja:${ms}:${campo}`);
    const celdas = [id("rotulo")];
    if (!manana) {
      celdas.push(id("real"));
      const cobertura = id("cobertura");
      celdas.push(f.real ? [NOMBRE_ESTADO[f.real.estado], ...(cobertura ? [" (", cobertura, ")"] : [])] : f.pasada ? "sin dato" : "—");
      const r = f.real ?? f.casaReal;
      celdas.push(r ? `${NOMBRE_FUENTE[r.procedencia]}${r.entradas > 1 ? ` (${r.entradas} entradas)` : ""}` : "—");
    }
    celdas.push(id("previsto"));
    celdas.push(f.previsto ? (f.previsto.origen === "prevision" ? `calibrada (${f.previsto.confianza})` : "potencia pico") : "—");
    if (conTipico) celdas.push(id("tipico"));
    if (!manana) celdas.push(id("casaReal"));
    celdas.push(f.casaTipica ? [id("casaTipica"), f.casaTipica.origen === "habito" ? " (hábito)" : " (fondo)"] : "—");
    if (!manana) {
      celdas.push(id("socFin"));
      celdas.push(f.nota ? "puede incluir las dos 02 h: el Excel no las distingue" : "");
    }
    return celdas;
  });

  const bloques = [tablaSimple(manana ? "a) Franjas de mañana" : "a) Franjas de hoy", cabeceras, filas)];

  const pie = elemento("dl", "pie-horas");
  const fila = (nombre, ...contenido) => {
    const d = elemento("div");
    const dd = elemento("dd");
    dd.append(...contenido.filter((x) => x !== null && x !== undefined));
    d.append(elemento("dt", "", nombre), dd);
    pie.append(d);
  };
  const t = m.totales;
  if (m.tabla.pie.includes("total:real")) {
    fila("Sol medido", dato("total:real"), ` · ${t.horasCompletas} completas, ${t.horasParciales} parciales, ${t.horasEnCurso} en curso, `, dato("total:sinDato"), " sin dato");
  } else if (m.tabla.pie.includes("total:sinDato")) {
    fila("Sol medido", "sin datos · ", dato("total:sinDato"), " sin dato");
  }
  if (m.tabla.pie.includes("total:previsto")) fila("Sol previsto", dato("total:previsto"));
  if (m.ventana) fila("Horas con sol", dato("ventana:desde"), " – ", dato("ventana:hasta"));
  if (m.escala) fila("Escala", dato("escala"), m.escala.origen === "instalacion" ? " · de tu instalación (calibración)" : " · de este día (sin calibración)");
  if (m.prevision.traida) fila("Previsión", "de las ", dato("prevision:traida"), m.prevision.sinConexion ? " (sin conexión)" : "");
  bloques.push(pie);

  const filasDe = (pares) =>
    pares.filter(([id]) => m.cifras.some((c) => c.id === id)).map(([id, nombre]) => {
      const c = m.cifras.find((x) => x.id === id);
      return [nombre, dato(id), NOMBRE_CLASE[c.clase], c.procedencia];
    });
  const columnas = ["Dato", "Valor", "Clase", "Procedencia"];
  const bateria = filasDe([
    ["bateria:soc", "Nivel del indicador"],
    ["bateria:minimo", "Reserva mínima"],
    ["bateria:recomendada", "Reserva para esta noche"],
    ["bateria:alAcabarSol", "Al acabar el sol"],
    ["muesca", m.muesca?.origen === "medido" ? "Llena antes de las" : "Llena hacia las"],
  ]);
  bloques.push(tablaSimple("b) Batería", columnas, bateria.length ? bateria : [["Sin dato de batería", "—", "—", "—"]]));
  const vivo = filasDe([
    ["vivo:solarW", "Sol"],
    ["vivo:casaW", "Casa"],
    ["vivo:soc", "Batería"],
    ["vivo:instante", "Lectura de las"],
    ["vivo:antiguedad", "Antigüedad"],
  ]);
  bloques.push(tablaSimple("c) Lectura en vivo", columnas, vivo.length ? vivo : [["Sin lectura en vivo", "—", "—", "—"]]));
  const asesor = filasDe([
    ["asesor:costeAhora", "Coste de ponerlo ahora"],
    ["asesor:mejor:inicio", "Mejor momento, inicio"],
    ["asesor:mejor:fin", "Mejor momento, fin"],
    ["asesor:mejor:coste", "Mejor momento, coste"],
  ]);
  bloques.push(tablaSimple("d) Asesor", columnas, asesor.length ? asesor : [["Sin decisión", "—", "—", "—"]]));
  caja.replaceChildren(...bloques);
}

// --- Exploración del arco con puntero y teclado ---------------------------------------

let franjaActiva = null;

function explorar(f, anunciar = false) {
  const figura = $("arco");
  franjaActiva = f;
  resaltarFranja(figura, f ? f.inicio.getTime() : null);
  const caja = $("cuencoFranja");
  if (!f || !modelo) {
    caja.hidden = true;
    caja.replaceChildren();
    return;
  }
  const dato = cifrasDe(modelo);
  const ms = f.inicio.getTime();
  const id = (campo) => `franja:${ms}:${campo}`;
  const estado = f.real ? (f.real.estado === "completa" ? "medido" : NOMBRE_ESTADO[f.real.estado]) : f.pasada ? "sin dato" : f.previsto ? "previsto" : "típico";
  const principal = f.real ? "real" : f.previsto ? "previsto" : f.tipico ? "tipico" : null;
  const ojo = elemento("p", "cuenco-ojo");
  ojo.append(dato(id("rotulo")), ` · ${estado}`);
  const cifra = elemento("p", "franja-cifra");
  cifra.append(principal ? cifrasDe(modelo, { partir: true })(id(principal)) : elemento("span", "sin", "—"));
  const detalle = elemento("p", "franja-det");
  const trozos = [];
  if (f.real && f.previsto) trozos.push(["previsto ", dato(id("previsto"))]);
  if (f.casaReal) trozos.push(["casa ", dato(id("casaReal"))]);
  else if (f.casaTipica) trozos.push(["casa típica ", dato(id("casaTipica"))]);
  if (!f.real && f.pasada) trozos.push(["sin medida en esta hora"]);
  trozos.forEach((t, i) => detalle.append(...(i ? [" · "] : []), ...t));
  caja.replaceChildren(ojo, cifra, detalle);
  caja.hidden = false;
  if (anunciar) $("arcoAnuncio").textContent = [ojo.textContent, cifra.textContent, detalle.textContent].join(". ");
}

function prepararExploracion() {
  const figura = $("arco");
  const svg = figura.querySelector("svg");
  const aCaja = (evento) => {
    const p = svg.createSVGPoint();
    p.x = evento.clientX;
    p.y = evento.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  };
  const mover = (evento) => {
    if (!modelo?.ventana) return;
    const p = aCaja(evento);
    explorar(franjaEn(modelo, p.x, p.y));
  };
  svg.addEventListener("pointermove", mover);
  svg.addEventListener("pointerdown", mover);
  svg.addEventListener("pointerleave", () => explorar(null));
  svg.addEventListener("pointercancel", () => explorar(null));
  figura.addEventListener("keydown", (evento) => {
    if (!modelo?.ventana) return;
    const lista = modelo.franjas.filter((f) => f.angulo !== null);
    if (evento.key === "ArrowRight" || evento.key === "ArrowLeft") {
      evento.preventDefault();
      const paso = evento.key === "ArrowRight" ? 1 : -1;
      let i = franjaActiva ? lista.indexOf(lista.find((f) => f.inicio.getTime() === franjaActiva.inicio.getTime())) + paso : -1;
      if (!franjaActiva) {
        const ahora = contexto?.ahora.getTime() ?? Date.now();
        i = lista.findIndex((f) => f.inicio.getTime() <= ahora && ahora < f.fin.getTime());
        if (i < 0) i = paso > 0 ? 0 : lista.length - 1;
      }
      explorar(lista[Math.max(0, Math.min(lista.length - 1, i))], true);
    } else if (evento.key === "Escape" && franjaActiva) {
      explorar(null);
      $("arcoAnuncio").textContent = "";
    }
  });
  figura.addEventListener("blur", () => explorar(null));
}

function abrirAjustesAsesor(evento) {
  evento.preventDefault();
  const plegable = $("formAsesor").closest("details");
  plegable.open = true;
  plegable.scrollIntoView({ block: "start", behavior: conMovimiento() ? "smooth" : "auto" });
  $("ajLat").focus({ preventScroll: true });
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
  const figura = forma(decision.estado);
  if (figura) $("formaSemaforo").innerHTML = htmlIcono(figura);
  else $("formaSemaforo").textContent = "?";
  const titulo = $("tituloSemaforo");
  const cambia = titulo.textContent !== decision.titulo;
  titulo.textContent = decision.titulo;
  // El veredicto va en una línea: el tamaño se ajusta a su longitud (E1).
  titulo.style.setProperty("--letras", String(Math.max(decision.titulo.length, 8)));
  // Cambio de veredicto: fundido del cuenco (§4.7), solo si nadie ha pedido reducir el movimiento.
  if (cambia && conMovimiento()) $("semaforo").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
  $("semaforo").setAttribute("aria-label", `${ROTULO[decision.estado] || "Sin datos"}: ${decision.titulo}`);

  // El arco solo dibuja lo que ya ha calculado el asesor: una simulación más, sin efectos.
  const pasos = simular(k.slots, bateria, k.socPct).pasos;
  const reserva = k.solar.length ? reservaRecomendada({ slots: k.slots, bateria, socPct: k.socPct }) : null;
  const m = modeloArco({
    ahora: k.ahora, error: null,
    horasPorFuente: k.horasPorFuente, solar: k.solar,
    prevision: { traida: k.previsionTraida, sinConexion: Boolean(k.falloPrevision) },
    calibracion: k.calibracion, habitos: k.habitos,
    vivo: k.vivo, fresco: Boolean(k.fresco),
    bateria, reserva, slots: k.slots, pasos, decision,
    carga: { id: carga.id, nombre: carga.nombre },
  });
  pintarInstrumento(m, k.ahora);
  const dato = cifrasDe(m);
  $("cuencoOjo").textContent = `${carga.nombre} · ahora`;

  // Solo se envuelve en <data> la subcadena literal que ya escribe el asesor: el texto no cambia.
  const coste = $("costeAhora");
  if (decision.ahora) {
    coste.replaceChildren(`${carga.nombre} ahora: `, dato("asesor:costeAhora") ?? euros(decision.ahora.coste), carga.estimado ? " · consumo estimado" : "");
  } else {
    coste.textContent = "";
  }

  const proxima = $("proximaVentana");
  if (decision.mejor && decision.mejor !== decision.ahora) {
    proxima.hidden = false;
    const texto = cuando(decision.mejor.inicio, k.ahora).toLowerCase();
    const hora = m.visibles.cuenco.includes("asesor:mejor:inicio") ? dato("asesor:mejor:inicio") : null;
    const corte = hora ? texto.lastIndexOf(hora.textContent) : -1;
    proxima.replaceChildren(
      "Mejor: ",
      ...(corte >= 0 ? [texto.slice(0, corte), hora, texto.slice(corte + hora.textContent.length)] : [texto]),
      " → ",
      dato("asesor:mejor:coste") ?? euros(decision.mejor.coste)
    );
  } else {
    proxima.hidden = true;
  }

  pintarFrescura(k);

  // ¿Por que?
  const lista = $("razones");
  lista.replaceChildren(
    ...decision.razones.map((r) => {
      const li = elemento("li");
      li.append(conIcono(elemento("span", "icono"), iconoRazon(r.icono)), elemento("span", "", r.texto));
      return li;
    })
  );
  const avisos = [];
  if (k.sinUbicacion) avisos.push("Sin ubicación no hay previsión solar: ponla en los ajustes.");
  else if (k.falloPrevision) avisos.push(`Previsión del tiempo no disponible (${k.falloPrevision}).`);
  if (!k.sinUbicacion && k.calibracion.confianza === "ninguna") avisos.push("Previsión solar sin calibrar: faltan datos de producción.");
  if (k.falloMercado) avisos.push(`Precios del mercado no disponibles (${k.falloMercado}): uso medias por periodo.`);
  else if (k.sinPrecioManana) avisos.push("Los precios de mañana aún no están publicados (REE los da hacia mediodía): para esas horas uso medias por periodo.");
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
      celda.append(conIcono(elemento("span", "marca"), forma(h.estado)), elemento("span", "rotulo", String(h.inicio.getHours()).padStart(2, "0")));
      return celda;
    })
  );
  pintarTramos(linea);

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
    conIcono(aviso, "i-bateria", enElSuelo
      ? "La batería ya está en la reserva mínima: lo que consumas hasta que vuelva el sol saldrá de la red."
      : "Guarda batería: evita consumos grandes hasta que vuelva el sol.");
  }

  const aprendiendo = $("aprendiendo");
  aprendiendo.hidden = !k.habitos.aprendiendo;
  if (k.habitos.aprendiendo) {
    $("textoAprendiendo").textContent = k.habitos.historicoAntiguo
      ? `Uso tu histórico antiguo (${k.habitos.dias} días) mientras junto datos recientes: llevo ${k.habitos.diasRecientes} de 7.`
      : `Llevo ${k.habitos.diasRecientes} días de datos recientes; con 7 empiezo a fiarme de tus hábitos.`;
  }
}

// Resumen de la línea de 24 h por tramos seguidos del mismo estado (solo agrupa, no calcula).
const NOMBRE_TRAMO = { verde: "buen momento", amarillo: "cuidado", rojo: "evita" };
function pintarTramos(linea) {
  const tramos = [];
  for (const h of linea) {
    const ultimo = tramos.at(-1);
    if (ultimo && ultimo.estado === h.estado) ultimo.hasta = new Date(h.inicio.getTime() + HORA);
    else tramos.push({ estado: h.estado, desde: h.inicio, hasta: new Date(h.inicio.getTime() + HORA) });
  }
  const dos = (d) => String(d.getHours()).padStart(2, "0");
  $("resumenLinea").replaceChildren(
    ...tramos.slice(0, 4).map((t) => {
      const s = elemento("span", t.estado);
      conIcono(s, forma(t.estado), `${NOMBRE_TRAMO[t.estado]} `);
      s.append(elemento("b", "", tramos.length === 1 ? "las próximas horas" : `${dos(t.desde)}–${dos(t.hasta)} h`));
      return s;
    })
  );
}

function pintarAparatos(elegida) {
  const caja = $("aparatos");
  const conFoco = caja.contains(document.activeElement);
  const todos = [CARGA_REFERENCIA, ...combinarAparatos(contexto.c.aparatos)];
  caja.replaceChildren(
    ...todos.map((a) => {
      const boton = elemento("button", "chip");
      boton.type = "button";
      boton.dataset.id = a.id;
      boton.setAttribute("role", "radio");
      boton.setAttribute("aria-checked", String(a.id === elegida.id));
      boton.tabIndex = a.id === elegida.id ? 0 : -1;
      boton.append(conIcono(elemento("span"), iconoAparato(a.id)), elemento("span", "", a.nombre));
      boton.addEventListener("click", () => {
        guardarConfig({ aparato: a.id });
        contexto.c = leerConfig();
        pintarDecision();
      });
      return boton;
    })
  );
  if (conFoco) caja.querySelector('[aria-checked="true"]')?.focus();
}

// Radiogroup: flechas para cambiar de aparato (§6.4).
function moverAparato(evento) {
  const paso = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[evento.key];
  if (!paso) return;
  evento.preventDefault();
  const botones = [...$("aparatos").querySelectorAll('[role="radio"]')];
  const actual = botones.findIndex((b) => b.getAttribute("aria-checked") === "true");
  botones[(actual + paso + botones.length) % botones.length]?.click();
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
  ["ajSuplemento", (c) => c.suplemento, (c, v) => (c.suplemento = v ?? INDEXADA_POR_DEFECTO.suplemento)],
];

const leerNumero = (input) => {
  const v = parseFloat(String(input.value).replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

function pintarAjustes() {
  const c = leerConfig();
  for (const [id, leer] of CAMPOS) $(id).value = leer(c) ?? "";
  $("ajIndexada").checked = c.indexada;
  const cuerpo = $("tablaAparatos").querySelector("tbody");
  const propios = combinarAparatos(c.aparatos);
  cuerpo.replaceChildren(
    ...propios.map((a) => {
      const fila = elemento("tr");
      fila.dataset.id = a.id;
      fila.append(conIcono(elemento("td"), iconoAparato(a.id), `${a.nombre}${a.estimado ? " (estimado)" : ""}`));
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
  $("tablaFijos").querySelector("tbody").replaceChildren(
    ...CONSUMOS_FIJOS.map((f) => {
      const fila = elemento("tr");
      fila.append(
        conIcono(elemento("td"), iconoAparato(f.id), f.nombre),
        elemento("td", "ayuda", f.detalle),
        elemento("td", "numero", f.kwhDia === null ? "—" : `≈ ${fmt(f.kwhDia)} kWh`)
      );
      return fila;
    })
  );
}

function guardarAjustes() {
  const c = leerConfig();
  for (const [id, , escribir] of CAMPOS) escribir(c, leerNumero($(id)));
  c.indexada = $("ajIndexada").checked;
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
    marca.textContent = "Antes hay que configurar la sincronización (botón Ajustes, arriba).";
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
      pintarInstrumento(modeloArco({ ahora: new Date(), error }), new Date());
      $("tituloSemaforo").textContent = "No he podido calcular";
      $("frescura").replaceChildren(elemento("span", "punto"), elemento("span", "", "Sin datos"));
      $("avisoVivo").hidden = false;
      $("avisoVivo").textContent = error.message;
    })
    .finally(() => (pintando = null));
  return pintando;
}

export function iniciarAhora({ visible }) {
  pintarInstrumento(modeloArco(null), new Date());
  prepararExploracion();
  $("aparatos").addEventListener("keydown", moverAparato);
  // Si se pide reducir el movimiento a mitad de sesión, lo que esté en marcha acaba ya (§6.2).
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", (cambio) => {
    if (cambio.matches) for (const animacion of document.getAnimations?.() ?? []) animacion.finish();
  });
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
