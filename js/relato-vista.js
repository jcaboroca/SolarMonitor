// Relato del día (§5.5.2): apertura con las cifras del día, escenario fijo con la gráfica,
// pasos que pasan por debajo y vista compacta. Toda cifra visible sale de detectarMomentos()
// con el marcado <data> del §4.6; aquí solo se dibuja.

import { areaApilada, lineaSimple, COLORES } from "./graficas.js";
import { detectarMomentos } from "./relato.js";
import { elementoCifra, formatear } from "./arco.js";
import { htmlIcono } from "./iconos.js";

export const CLAVE_VISTA = "solar-monitor-vista-dia";
const H = 3600000;
const SVG = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);
const quieto = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const dos = (n) => String(n).padStart(2, "0");
const hora = (fecha) => formatear(fecha.getTime(), "hora", null);

const TEMA = {
  arranque: ["i-sol", "Sol"], picoProduccion: ["i-sol", "Sol"], fin: ["i-sol", "Sol"],
  cubre: ["i-casa", "Sol y casa"], deja: ["i-casa", "Sol y casa"], picoConsumo: ["i-casa", "Casa"],
  carga: ["i-bateria", "Batería"], llena: ["i-bateria", "Batería"], maximoBateria: ["i-bateria", "Batería"], minimoBateria: ["i-bateria", "Batería"],
  vertido: ["i-red", "Red"], compra: ["i-red", "Red"], resumen: ["i-dia", "Balance"],
};

const vista = {
  clave: null, serie: null, festivos: null, registros: [], resultado: null,
  grafica: null, bateria: null, activo: -1, pendiente: -1, cuadro: 0, observador: null,
  luz: [], conectada: false, anchoEscenario: 0,
};

function leerVista() {
  try {
    return localStorage.getItem(CLAVE_VISTA) === "compacta" ? "compacta" : "relato";
  } catch {
    return "relato";
  }
}
function guardarVista(valor) {
  try {
    localStorage.setItem(CLAVE_VISTA, valor);
  } catch {
    // Sin almacenamiento la elección dura lo que dure la página.
  }
}
const modo = () => $("relato").dataset.vista;

/** Pinta el día. Con el mismo día y los mismos datos solo repinta las gráficas y conserva el paso. */
export function pintarRelato({ clave, registros, serie, festivos }) {
  conectar();
  medirCabecera();
  const nuevo = clave !== vista.clave || serie !== vista.serie || festivos !== vista.festivos;
  if (!nuevo) {
    pintarGraficas();
    return;
  }
  const cambiaDia = vista.clave !== null && serie === vista.serie && clave !== vista.clave;
  performance.mark("relato:momentos:inicio");
  const resultado = detectarMomentos(registros, serie.unidadesRol, { festivos, pasoMinutos: serie.pasoMinutos });
  performance.measure("relato:momentos", "relato:momentos:inicio");

  performance.mark("relato:montaje:inicio");
  Object.assign(vista, { clave, serie, festivos, registros, resultado, activo: -1, pendiente: -1, grafica: null, bateria: null });
  vista.luz = luces(resultado.pasos);
  pintarApertura();
  pintarPasos();
  aplicarVista();
  pintarGraficas();
  performance.measure("relato:montaje", "relato:montaje:inicio");
  if (cambiaDia) volverAlPrincipio();
}

// --- Apertura ---------------------------------------------------------------------------

function pintarApertura() {
  const { resultado, registros } = vista;
  const cifras = resultado.resumen?.cifras ?? [];
  const c = (id) => cifras.find((x) => x.id === id);
  const fecha = registros[0].instante.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("fechaDia").textContent = resultado.relato ? `${fecha} · el día en ${resultado.pasos.length} momentos` : fecha;

  const produccion = c("resumen:produccion");
  const titular = $("titularDia");
  if (produccion && produccion.valor >= 0.05) {
    const cifra = elementoCifra(produccion, { partir: true });
    cifra.className = "titular-cifra";
    titular.replaceChildren(document.createTextNode("Tus paneles dieron "), cifra);
  } else if (produccion) {
    titular.textContent = "Este día los paneles no registraron producción";
  } else {
    titular.textContent = "Este día no hay datos de producción que se puedan usar";
  }

  const sub = $("subtitularDia");
  const autoconsumo = c("resumen:autoconsumo");
  const consumo = c("resumen:consumo");
  if (autoconsumo && autoconsumo.texto !== formatear(0, "%", 0)) {
    sub.replaceChildren("El sol y la batería cubrieron el ", elementoCifra(autoconsumo), " de lo que gastó la casa.");
  } else if (autoconsumo && consumo) {
    sub.replaceChildren("Todo lo que gastó la casa, ", elementoCifra(consumo), ", vino de la red.");
  } else if (consumo) {
    sub.replaceChildren("La casa gastó ", elementoCifra(consumo), ".");
  } else {
    sub.replaceChildren();
  }
  sub.hidden = !sub.childNodes.length;

  const filas = [
    ["resumen:produccion", "Producido", "c-sol"],
    ["resumen:consumo", "Consumido", "c-casa"],
    ["resumen:importada", "Comprado", "c-red"],
    ["resumen:exportada", "Vertido", "c-vertido"],
  ].filter(([id]) => c(id));
  $("cifrasDia").replaceChildren(
    ...filas.map(([id, nombre, clase]) => {
      const div = document.createElement("div");
      div.className = `apertura-cifra ${clase}`;
      const dt = document.createElement("dt");
      dt.textContent = nombre;
      const dd = document.createElement("dd");
      dd.append(elementoCifra(c(id), { partir: true }));
      div.append(dt, dd);
      return div;
    })
  );
  pintarFirma();
}

// Firma del día: el arco de Ahora en pequeño, de 00 h a 24 h, con un rayo por hora de energía
// producida (fuera) y consumida (dentro), sumada de los registros de ese día.
function pintarFirma() {
  const svg = $("firmaDia");
  const { registros, serie } = vista;
  const u = serie.unidadesRol;
  const i0 = registros[0].instante;
  const inicio = new Date(i0.getFullYear(), i0.getMonth(), i0.getDate()).getTime();
  const horas = Math.round((new Date(i0.getFullYear(), i0.getMonth(), i0.getDate() + 1) - inicio) / H);
  const sol = new Array(horas).fill(0);
  const casa = new Array(horas).fill(0);
  const energia = (r, rol) => {
    const v = r[rol];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0;
    if (u[rol] === "kWh") return v;
    return Number.isFinite(r.horas) && r.horas > 0 ? (v * r.horas) / 1000 : 0;
  };
  for (const r of registros) {
    const k = Math.floor((r.instante.getTime() - inicio) / H);
    if (k < 0 || k >= horas) continue;
    sol[k] += energia(r, "produccion");
    casa[k] += energia(r, "consumo");
  }
  const tope = Math.max(...sol, ...casa, 0.001);
  const cx = 100, cy = 100, r = 66;
  const punto = (a, radio) => [cx + radio * Math.cos((a * Math.PI) / 180), cy - radio * Math.sin((a * Math.PI) / 180)];
  const angulo = (k) => 180 * (1 - (k + 0.5) / horas);
  const nodo = (nombre, atributos, padre = svg) => {
    const n = document.createElementNS(SVG, nombre);
    for (const [k, v] of Object.entries(atributos)) n.setAttribute(k, v);
    padre.append(n);
    return n;
  };
  svg.replaceChildren();
  nodo("line", { x1: 4, y1: cy, x2: 196, y2: cy, class: "firma-horizonte" });
  nodo("path", { d: `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`, class: "firma-pista" });
  for (let h = 0; h <= horas; h += 6) {
    const a = 180 * (1 - h / horas);
    const [x1, y1] = punto(a, r - 3);
    const [x2, y2] = punto(a, r + 3);
    nodo("line", { x1, y1, x2, y2, class: "firma-marca" });
  }
  let pico = -1;
  sol.forEach((kwh, k) => {
    if (kwh > 0 && (pico < 0 || kwh > sol[pico])) pico = k;
    const a = angulo(k);
    if (kwh > 0) {
      const [x1, y1] = punto(a, r + 4);
      const [x2, y2] = punto(a, r + 4 + (kwh / tope) * 28);
      nodo("line", { x1, y1, x2, y2, class: "firma-sol" });
    }
    if (casa[k] > 0) {
      const [x1, y1] = punto(a, r - 5);
      const [x2, y2] = punto(a, r - 5 - (casa[k] / tope) * 24);
      nodo("line", { x1, y1, x2, y2, class: "firma-casa" });
    }
  });
  if (pico >= 0) {
    const [x, y] = punto(angulo(pico), r);
    nodo("circle", { cx: x, cy: y, r: 3.2, class: "firma-pico" });
  }
}

// --- Pasos ------------------------------------------------------------------------------

// Escribe una plantilla con {id} sustituyendo cada marcador por su <data>.
function conCifras(elemento, plantilla, cifras, partir = false) {
  const trozos = plantilla.split(/\{([^}]+)\}/);
  elemento.replaceChildren(
    ...trozos.map((trozo, i) => {
      if (i % 2 === 0) return document.createTextNode(trozo);
      const c = cifras.find((x) => x.id === trozo);
      return c ? elementoCifra(c, { partir }) : document.createTextNode("");
    })
  );
  return elemento;
}

function pintarPasos() {
  const { pasos } = vista.resultado;
  const total = dos(pasos.length);
  $("pasosRelato").replaceChildren(
    ...pasos.map((p, i) => {
      const li = document.createElement("li");
      li.className = "paso";
      li.dataset.paso = String(i);
      li.dataset.indice = String(p.indice);
      li.tabIndex = -1;
      const cuerpo = document.createElement("div");
      cuerpo.className = "paso-cuerpo";

      const cabeza = document.createElement("p");
      cabeza.className = "paso-cabeza";
      const tiempo = document.createElement("time");
      tiempo.className = "paso-hora";
      tiempo.dateTime = p.instante.toISOString();
      tiempo.textContent = hora(p.instante);
      const [icono, tema] = TEMA[p.tipos[0]] ?? ["i-dia", ""];
      const etiqueta = document.createElement("span");
      etiqueta.className = "paso-tema";
      etiqueta.innerHTML = `${htmlIcono(icono)}${tema}`;
      const numero = document.createElement("span");
      numero.className = "paso-num";
      numero.textContent = `${dos(i + 1)} / ${total}`;
      cabeza.append(tiempo, etiqueta, numero);

      const titulo = conCifras(document.createElement("h3"), p.plantilla.titulo, p.cifras, true);
      titulo.className = "paso-titulo";
      const detalle = conCifras(document.createElement("p"), p.plantilla.detalle, p.cifras);
      detalle.className = "paso-detalle";
      cuerpo.append(cabeza, titulo, detalle);
      li.append(cuerpo);
      return li;
    })
  );
}

// La luz del escenario es la producción registrada en el registro del paso, frente al pico del día.
function luces(pasos) {
  const valor = (r) => (typeof r.produccion === "number" && Number.isFinite(r.produccion) && r.produccion > 0 ? r.produccion : 0);
  const maximo = Math.max(0, ...vista.registros.map(valor));
  return pasos.map((p) => (maximo > 0 ? Math.sqrt(valor(vista.registros[p.indice]) / maximo) : 0));
}

// --- Vista: relato o compacta ------------------------------------------------------------

function aplicarVista() {
  const { relato, motivo } = vista.resultado;
  const elegida = relato ? leerVista() : "compacta";
  $("relato").dataset.vista = elegida;
  for (const [id, valor] of [["vistaRelato", "relato"], ["vistaCompacta", "compacta"]]) {
    $(id).setAttribute("aria-pressed", String(elegida === valor));
    $(id).disabled = !relato;
  }
  const aviso = $("avisoRelato");
  aviso.hidden = relato;
  aviso.textContent = relato ? "" : `${motivo} Se muestra la vista compacta.`;
  for (const id of ["pistaDesliza", "saltarRelato"]) $(id).hidden = elegida !== "relato";
  observar();
  activar(elegida === "relato" ? vista.activo : -1, { forzar: true, animar: false });
}

function cambiarVista(valor) {
  if (!vista.resultado?.relato || modo() === valor) return;
  guardarVista(valor);
  aplicarVista();
  pintarGraficas();
}

function observar() {
  vista.observador?.disconnect();
  vista.observador = null;
  if (modo() !== "relato" || !("IntersectionObserver" in window)) return;
  vista.observador = new IntersectionObserver(alCruzar, { rootMargin: "-45% 0px -45% 0px" });
  for (const li of $("pasosRelato").children) vista.observador.observe(li);
}

function alCruzar(entradas) {
  for (const entrada of entradas) {
    const i = Number(entrada.target.dataset.paso);
    if (entrada.isIntersecting) programar(i);
    else if (i === 0 && entrada.boundingClientRect.top > (entrada.rootBounds?.bottom ?? innerHeight / 2)) programar(-1);
  }
}

// El canvas se repinta al cambiar de paso, nunca en cada frame de scroll (agrupado con rAF).
function programar(i) {
  vista.pendiente = i;
  if (vista.cuadro) return;
  vista.cuadro = requestAnimationFrame(() => {
    vista.cuadro = 0;
    activar(vista.pendiente);
  });
}

function seleccion(i) {
  if (modo() !== "relato") return null;
  const p = vista.resultado.pasos[i];
  if (!p) return 0;
  return p.desde ? { desde: p.desde, hasta: p.hasta } : p.indice;
}

function activar(i, { forzar = false, animar = true } = {}) {
  const { pasos } = vista.resultado;
  if (i === vista.activo && !forzar) return;
  performance.mark("relato:paso:inicio");
  vista.activo = i;
  const lista = $("pasosRelato").children;
  for (const li of lista) {
    if (Number(li.dataset.paso) === i && modo() === "relato") li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  }
  const p = pasos[i];
  const reloj = $("relojRelato");
  const instante = p ? p.instante : vista.registros[0].instante;
  reloj.textContent = hora(instante);
  reloj.dateTime = instante.toISOString();
  $("etiquetaReloj").textContent = p ? `Momento ${dos(i + 1)} / ${dos(pasos.length)}` : "Empieza el día";
  if (animar && !quieto()) {
    reloj.animate([{ opacity: 0.2, translate: "0 6px" }, { opacity: 1, translate: "0 0" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  $("escenarioRelato").style.setProperty("--dia", (p ? vista.luz[i] : 0).toFixed(3));
  $("pasoAnterior").disabled = i <= 0;
  $("pasoSiguiente").disabled = i >= pasos.length - 1;
  const marca = seleccion(i);
  vista.grafica?.marcar(marca);
  vista.bateria?.marcar(marca);
  performance.measure("relato:paso", "relato:paso:inicio");
}

// --- Gráficas -----------------------------------------------------------------------------

function leyenda(entradas) {
  $("leyendaDia").innerHTML = entradas.map(([nombre, color]) => `<span><i style="background:${color}"></i>${nombre}</span>`).join("");
}

function pintarGraficas() {
  const { registros, resultado } = vista;
  if (!resultado) return;
  const instantes = registros.map((p) => p.instante.getTime());
  leyenda([
    ["Sol → casa", COLORES.produccion],
    ["Batería → casa", COLORES.descarga],
    ["Red → casa", COLORES.importada],
    ["Producción solar total", COLORES.produccionTotal],
    ["Consumo total", COLORES.consumo],
  ]);
  vista.grafica = areaApilada($("graficaDia"), {
    instantes,
    capas: [
      { clave: "solarDirecta", nombre: "Sol → casa", color: COLORES.produccion, valores: registros.map((p) => p.solarDirecta || 0) },
      { clave: "descarga", nombre: "Batería → casa", color: COLORES.descarga, valores: registros.map((p) => p.descarga || 0) },
      { clave: "importada", nombre: "Red → casa", color: COLORES.importada, valores: registros.map((p) => p.importada || 0) },
    ],
    lineas: [
      { nombre: "Producción solar", color: COLORES.produccionTotal, discontinua: true, valores: registros.map((p) => p.produccion || 0) },
      { nombre: "Consumo", color: COLORES.consumo, valores: registros.map((p) => p.consumo || 0) },
    ],
    marcas: resultado.pasos.map((p) => ({ indice: p.indice, activa: false })),
  });

  const tieneSoc = registros.some((p) => p.soc != null);
  $("tituloBateria").hidden = !tieneSoc;
  $("graficaBateria").parentElement.hidden = !tieneSoc;
  vista.bateria = tieneSoc
    ? lineaSimple($("graficaBateria"), { instantes, valores: registros.map((p) => p.soc || 0), maximoFijo: 100 })
    : null;
  const marca = seleccion(vista.activo);
  vista.grafica.marcar(marca);
  vista.bateria?.marcar(marca);
}

// --- Navegación ---------------------------------------------------------------------------

function irA(i) {
  const lista = $("pasosRelato").children;
  if (!lista.length || modo() !== "relato") return;
  const destino = Math.min(Math.max(i, 0), lista.length - 1);
  lista[destino].scrollIntoView({ block: "start", behavior: quieto() ? "auto" : "smooth" });
  lista[destino].focus({ preventScroll: true });
  programar(destino);
}

function saltar() {
  const destino = $("balanceDias");
  destino.scrollIntoView({ block: "start", behavior: quieto() ? "auto" : "smooth" });
  destino.focus({ preventScroll: true });
}

// Al cambiar de día se vuelve al principio del relato, si se estaba dentro de él.
function volverAlPrincipio() {
  if ($("panel-dia").hidden) return;
  const apertura = $("aperturaDia");
  if (apertura.getBoundingClientRect().top < 0) apertura.scrollIntoView({ block: "start", behavior: "auto" });
}

// La cabecera es fija desde 621 px: el escenario se pega justo debajo.
function medirCabecera() {
  const cabecera = document.querySelector(".cabecera");
  const fija = cabecera && getComputedStyle(cabecera).position === "sticky";
  document.documentElement.style.setProperty("--alto-cabecera", `${fija ? cabecera.offsetHeight : 0}px`);
}

function conectar() {
  if (vista.conectada) return;
  vista.conectada = true;
  $("vistaRelato").addEventListener("click", () => cambiarVista("relato"));
  $("vistaCompacta").addEventListener("click", () => cambiarVista("compacta"));
  $("pasoAnterior").addEventListener("click", () => irA(vista.activo - 1));
  $("pasoSiguiente").addEventListener("click", () => irA(vista.activo + 1));
  $("saltarRelato").addEventListener("click", saltar);
  if ("ResizeObserver" in window) {
    new ResizeObserver(medirCabecera).observe(document.querySelector(".cabecera"));
    new ResizeObserver(([entrada]) => {
      const ancho = Math.round(entrada.contentRect.width);
      if (!ancho || ancho === vista.anchoEscenario) return;
      vista.anchoEscenario = ancho;
      requestAnimationFrame(pintarGraficas);
    }).observe($("escenarioRelato"));
  }
}
