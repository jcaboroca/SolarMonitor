import { leerXlsx } from "./xlsx.js";
import {
  ROLES, detectarRoles, unidadDeCabecera, construirSerie, energiaKwh,
  repartoPorPeriodo, resumenPorDia, claveDia,
} from "./datos.js";
import { textoDelPdf, interpretarFactura, revisarFactura, lecturasFrenteAFacturado } from "./factura.js";
import { areaApilada, barrasApiladas, mapaCalor, lineaSimple, COLORES } from "./graficas.js";

const $ = (id) => document.getElementById(id);
const estado = { cabeceras: [], filas: [], roles: [], unidades: [], serie: null, dias: [], factura: null };

const numero = (valor, decimales = 1) =>
  Number.isFinite(valor) ? valor.toLocaleString("es-ES", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }) : "—";

function avisar(mensaje) {
  const aviso = $("aviso");
  aviso.textContent = mensaje || "";
  aviso.hidden = !mensaje;
}

// --- Entrada de ficheros ---------------------------------------------------

function conectarZona(zonaId, entradaId, alRecibir) {
  const zona = $(zonaId);
  const entrada = $(entradaId);
  entrada.addEventListener("change", () => entrada.files[0] && alRecibir(entrada.files[0]));
  ["dragenter", "dragover"].forEach((evento) =>
    zona.addEventListener(evento, (e) => {
      e.preventDefault();
      zona.classList.add("encima");
    })
  );
  ["dragleave", "drop"].forEach((evento) =>
    zona.addEventListener(evento, (e) => {
      e.preventDefault();
      zona.classList.remove("encima");
    })
  );
  zona.addEventListener("drop", (e) => {
    const fichero = e.dataTransfer?.files?.[0];
    if (fichero) alRecibir(fichero);
  });
}

// La exportación suele traer filas de encabezado antes de la tabla real.
function localizarCabecera(filas) {
  for (let i = 0; i < Math.min(filas.length, 20); i++) {
    const fila = filas[i] || [];
    const textos = fila.filter((c) => typeof c === "string" && c.trim().length > 1).length;
    const siguiente = filas[i + 1] || [];
    const datos = siguiente.filter((c) => typeof c === "number" || c instanceof Date).length;
    if (textos >= 2 && datos >= 1) return i;
  }
  return 0;
}

async function cargarDatos(fichero) {
  const marca = $("estadoDatos");
  marca.className = "estado";
  marca.textContent = "Leyendo…";
  try {
    const filas = await leerXlsx(await fichero.arrayBuffer());
    const indice = localizarCabecera(filas);
    estado.cabeceras = (filas[indice] || []).map((c) => String(c ?? "").trim());
    estado.filas = filas.slice(indice + 1).filter((f) => f && f.length);
    estado.unidades = estado.cabeceras.map(unidadDeCabecera);
    estado.roles = detectarRoles(estado.cabeceras);
    marca.textContent = `${fichero.name} · ${estado.filas.length.toLocaleString("es-ES")} registros`;
    pintarMapeo();
    recalcular();
  } catch (error) {
    marca.className = "estado error";
    marca.textContent = error.message;
  }
}

async function cargarFactura(fichero) {
  const marca = $("estadoFactura");
  marca.className = "estado";
  marca.textContent = "Leyendo el PDF…";
  try {
    const texto = await textoDelPdf(await fichero.arrayBuffer());
    if (texto.replace(/\s/g, "").length < 40) {
      throw new Error("El PDF no tiene texto (parece escaneado). Rellena los datos a mano.");
    }
    estado.factura = interpretarFactura(texto);
    estado.factura.texto = texto;
    marca.textContent = `${fichero.name} · datos extraídos`;
    pintarComparacion();
    pintarRevision();
  } catch (error) {
    marca.className = "estado error";
    marca.textContent = error.message;
    estado.factura = estado.factura || { consumo: {}, precio: {}, texto: "" };
    pintarComparacion();
  }
}

// --- Mapeo de columnas -----------------------------------------------------

function pintarMapeo() {
  const cuerpo = $("tablaMapeo").querySelector("tbody");
  cuerpo.textContent = "";
  const primeraFila = estado.filas[0] || [];

  estado.cabeceras.forEach((cabecera, i) => {
    if (!cabecera && primeraFila[i] == null) return;
    const fila = document.createElement("tr");

    const celdaNombre = document.createElement("td");
    celdaNombre.textContent = cabecera || `Columna ${i + 1}`;
    const celdaMuestra = document.createElement("td");
    celdaMuestra.className = "muestra";
    const muestra = primeraFila[i];
    celdaMuestra.textContent = muestra instanceof Date ? muestra.toLocaleString("es-ES") : String(muestra ?? "");

    const celdaRol = document.createElement("td");
    const selector = document.createElement("select");
    selector.innerHTML = `<option value="">Ignorar</option>` +
      ROLES.map((rol) => `<option value="${rol.clave}">${rol.etiqueta}</option>`).join("");
    selector.value = estado.roles[i] || "";
    selector.addEventListener("change", () => {
      estado.roles[i] = selector.value || null;
    });
    celdaRol.appendChild(selector);

    fila.append(celdaNombre, celdaMuestra, celdaRol);
    cuerpo.appendChild(fila);
  });
  $("mapeo").hidden = false;
}

function leerFestivos() {
  const anio = estado.serie?.registros[0]?.instante.getFullYear() ?? new Date().getFullYear();
  const conjunto = new Set();
  for (const trozo of $("festivos").value.split(/[,;\s]+/)) {
    const partes = trozo.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/);
    if (!partes) continue;
    const fecha = new Date(Number(partes[3] || anio), Number(partes[2]) - 1, Number(partes[1]));
    conjunto.add(claveDia(fecha));
  }
  return conjunto;
}

// --- Cálculo y pintado -----------------------------------------------------

function recalcular() {
  if (!estado.filas.length) return;
  try {
    estado.serie = construirSerie(estado.filas, estado.roles, estado.unidades, {
      invertirRed: $("invertirRed").checked,
      invertirBateria: $("invertirBateria").checked,
    });
  } catch (error) {
    avisar(error.message);
    return;
  }
  const { registros } = estado.serie;
  if (!registros.length) {
    avisar("No se ha podido interpretar ninguna fila con fecha válida.");
    return;
  }
  avisar("");
  estado.festivos = leerFestivos();
  estado.dias = resumenPorDia(registros, estado.serie.unidadesRol);
  pintarFichas();
  pintarComparacion();
  prepararGraficas();
}

function totales() {
  const { registros, unidadesRol } = estado.serie;
  const kwh = (rol) => energiaKwh(registros, rol, unidadesRol[rol]);
  const consumo = kwh("consumo");
  return {
    produccion: kwh("produccion"),
    consumo,
    importada: kwh("importada"),
    exportada: kwh("exportada"),
    autoconsumo: kwh("autoconsumo"),
    carga: kwh("carga"),
    descarga: kwh("descarga"),
    cobertura: consumo > 0 ? (1 - kwh("importada") / consumo) * 100 : 0,
  };
}

function pintarFichas() {
  const t = totales();
  const fichas = [
    ["Producción solar", t.produccion, "kWh", COLORES.produccion],
    ["Consumo de la casa", t.consumo, "kWh", COLORES.consumo],
    ["Comprado a la red", t.importada, "kWh", COLORES.importada],
    ["Vertido a la red", t.exportada, "kWh", COLORES.exportada],
    ["Cubierto sin la red", t.cobertura, "%", COLORES.carga],
  ];
  $("fichas").innerHTML = fichas
    .map(([titulo, valor, unidad, color]) =>
      `<dl class="ficha" style="--color:${color}"><dt>${titulo}</dt><dd>${numero(valor, unidad === "%" ? 0 : 1)}<small>${unidad}</small></dd></dl>`
    )
    .join("");
  $("resumen").hidden = false;
}

// --- Comparación con la factura -------------------------------------------

const CONCEPTOS = [
  { clave: "P1", etiqueta: "Comprado en punta (P1)" },
  { clave: "P2", etiqueta: "Comprado en llano (P2)" },
  { clave: "P3", etiqueta: "Comprado en valle (P3)" },
  { clave: "total", etiqueta: "Comprado en total" },
  { clave: "excedentes", etiqueta: "Vertido a la red" },
];

function valorFactura(clave) {
  const entrada = document.querySelector(`#tablaFactura input[data-clave="${clave}"]`);
  const valor = entrada ? parseFloat(entrada.value.replace(",", ".")) : NaN;
  return Number.isFinite(valor) ? valor : null;
}

function pintarComparacion() {
  if (!estado.serie) return;
  const { registros, unidadesRol } = estado.serie;
  const reparto = repartoPorPeriodo(registros, "importada", unidadesRol.importada, estado.festivos);
  const medido = {
    P1: reparto.P1,
    P2: reparto.P2,
    P3: reparto.P3,
    total: reparto.P1 + reparto.P2 + reparto.P3,
    excedentes: energiaKwh(registros, "exportada", unidadesRol.exportada),
  };
  estado.medido = medido;

  const leido = estado.factura;
  const deLaFactura = {
    P1: leido?.consumo?.P1 ?? null,
    P2: leido?.consumo?.P2 ?? null,
    P3: leido?.consumo?.P3 ?? null,
    total: leido?.consumoTotal ?? null,
    excedentes: leido?.excedentes ?? null,
  };

  const cuerpo = $("tablaFactura").querySelector("tbody");
  cuerpo.textContent = "";
  for (const concepto of CONCEPTOS) {
    const anterior = valorFactura(concepto.clave);
    const valor = anterior ?? deLaFactura[concepto.clave];
    const fila = document.createElement("tr");
    fila.innerHTML =
      `<td>${concepto.etiqueta}</td>` +
      `<td class="numero"><input type="number" step="0.01" min="0" inputmode="decimal" data-clave="${concepto.clave}" value="${valor ?? ""}" aria-label="${concepto.etiqueta} según la factura"> kWh</td>` +
      `<td class="numero">${numero(medido[concepto.clave])} kWh</td>` +
      `<td class="numero" data-desvio="${concepto.clave}"></td>`;
    cuerpo.appendChild(fila);
  }
  cuerpo.querySelectorAll("input").forEach((entrada) => entrada.addEventListener("input", pintarDesvios));

  $("textoFactura").textContent = leido?.texto || "";
  $("comparacion").hidden = false;
  pintarDesvios();
}

function pintarDesvios() {
  const medido = estado.medido;
  let veredicto = null;

  for (const concepto of CONCEPTOS) {
    const celda = document.querySelector(`#tablaFactura [data-desvio="${concepto.clave}"]`);
    const facturado = valorFactura(concepto.clave);
    if (facturado == null) {
      celda.textContent = "—";
      celda.className = "numero";
      continue;
    }
    const diferencia = facturado - medido[concepto.clave];
    const relativo = medido[concepto.clave] > 0 ? (diferencia / medido[concepto.clave]) * 100 : 0;
    const signo = diferencia > 0 ? "+" : "";
    celda.textContent = `${signo}${numero(diferencia)} kWh (${signo}${numero(relativo, 1)} %)`;
    celda.className = `numero ${Math.abs(relativo) <= 5 ? "desvio-bien" : "desvio-mal"}`;
    if (concepto.clave === "total") veredicto = relativo;
  }

  const caja = $("veredicto");
  if (veredicto == null) {
    caja.className = "veredicto";
    caja.textContent = "Introduce los kWh que aparecen en la factura para comparar.";
    return;
  }
  const desvio = Math.abs(veredicto);
  const nota = notaPeriodo() + notaMedicion();
  if (desvio <= 3) {
    caja.className = "veredicto bien";
    caja.textContent = `La factura cuadra: solo ${numero(desvio, 1)} % de diferencia con lo que midió tu instalación. ${nota}`;
  } else if (desvio <= 10) {
    caja.className = "veredicto regular";
    caja.textContent = `Diferencia del ${numero(desvio, 1)} %. Entra dentro de lo esperable por pérdidas y por dónde mide cada aparato, pero conviene mirarlo. ${nota}`;
  } else {
    caja.className = "veredicto mal";
    caja.textContent = `Diferencia del ${numero(desvio, 1)} %: demasiada. Antes de reclamar, mira la revisión de las cuentas de la factura y el aviso de medición. ${nota}`;
  }
}

// El datalogger hace una foto cada pocos minutos: los picos cortos de compra y
// venta se le escapan aunque el contador sí los registre. Si su propio balance
// no cierra, sus kWh de red no sirven para acusar a nadie.
function notaMedicion() {
  const t = totales();
  const descuadre = t.produccion + t.importada + t.descarga - t.consumo - t.exportada - t.carga;
  const relativo = t.consumo > 0 ? (descuadre / t.consumo) * 100 : 0;
  if (Math.abs(relativo) < 5) return "";
  return (
    ` Ojo: los datos del datalogger no cuadran ni consigo mismos (bailan ${numero(Math.abs(descuadre))} kWh,` +
    ` un ${numero(Math.abs(relativo), 0)} % del consumo). Con una muestra cada ${estado.serie.pasoMinutos} minutos se pierden` +
    ` los picos cortos de compra y venta, así que aquí sus kWh de red son orientativos y el contador manda.`
  );
}

// --- Revisión interna de la factura ---------------------------------------

const euros = (valor) => (Number.isFinite(valor) ? `${numero(valor, 2)} €` : "—");

function pintarRevision() {
  const f = estado.factura;
  const seccion = $("revision");
  const puntos = f ? revisarFactura(f) : [];
  if (!puntos.length) {
    seccion.hidden = true;
    return;
  }
  seccion.hidden = false;

  const cuerpo = $("tablaRevision").querySelector("tbody");
  cuerpo.textContent = "";
  for (const punto of puntos) {
    const fila = document.createElement("tr");
    fila.innerHTML =
      `<td>${punto.concepto}</td>` +
      `<td class="numero">${numero(punto.esperado, 2)}</td>` +
      `<td class="numero">${numero(punto.segunFactura, 2)}</td>` +
      `<td class="numero ${punto.ok ? "desvio-bien" : "desvio-mal"}">${punto.ok ? "cuadra" : "no cuadra"}</td>`;
    cuerpo.appendChild(fila);
  }

  const fallos = puntos.filter((p) => !p.ok);
  const caja = $("veredictoRevision");
  caja.className = `veredicto ${fallos.length ? "mal" : "bien"}`;
  caja.textContent = fallos.length
    ? `${fallos.length} de ${puntos.length} operaciones no cuadran. Eso sí es un error de facturación: reclama con esta lista.`
    : `Las ${puntos.length} operaciones de la factura cuadran entre sí. Si el importe te chirría, mira los kWh y los precios de abajo, no la aritmética.`;

  pintarLecturas(f);
  pintarAvisosFactura(f);
}

function pintarLecturas(f) {
  const filas = lecturasFrenteAFacturado(f);
  const caja = $("lecturas");
  if (!filas.length) {
    caja.textContent = "";
    return;
  }
  const total = filas.reduce((suma, fila) => suma + fila.diferencia, 0);
  const precio = f.precio.P1 ?? 0;
  caja.innerHTML =
    `<h3>Lo que marcó el contador y lo que te facturaron</h3>` +
    `<div class="tabla-envoltorio"><table class="tabla">` +
    `<thead><tr><th>Periodo</th><th>Contador</th><th>Facturado</th><th>Diferencia</th></tr></thead><tbody>` +
    filas
      .map(
        (fila) =>
          `<tr><td>${fila.periodo}${fila.estimada ? " ⚠️ estimada" : ""}</td>` +
          `<td class="numero">${numero(fila.leido)} kWh</td>` +
          `<td class="numero">${numero(fila.facturado)} kWh</td>` +
          `<td class="numero ${fila.diferencia > 0 ? "desvio-mal" : ""}">${fila.diferencia > 0 ? "+" : ""}${numero(fila.diferencia)} kWh</td></tr>`
      )
      .join("") +
    `</tbody></table></div>` +
    `<p class="ayuda">${
      total > 0
        ? `Te han facturado ${numero(total)} kWh más de los que marcó el contador (${euros(total * precio)}). Pídeles explicación.`
        : total < 0
          ? `Te han facturado ${numero(-total)} kWh menos de los que marcó el contador: a tu favor.`
          : "Coincide con la lectura del contador."
    }</p>`;
}

function pintarAvisosFactura(f) {
  const avisos = [];

  if (f.excedentes != null && f.precioExcedentes != null) {
    const cobrado = f.excedentes * f.precioExcedentes;
    const alPrecioDeCompra = f.precio.P1 != null ? f.excedentes * f.precio.P1 : null;
    const linea =
      `Te compensan los excedentes a ${numero(f.precioExcedentes * 100, 4)} c€/kWh. ` +
      `Vertiste ${numero(f.excedentes)} kWh y te devolvieron ${euros(cobrado)}.`;
    if (f.precioExcedentes < 0.03) {
      avisos.push([
        "mal",
        `${linea} Es una tarifa de compensación muy baja: lo habitual está entre 5 y 10 c€/kWh.` +
          (alPrecioDeCompra ? ` A lo que tú pagas la luz, esos kWh valdrían ${euros(alPrecioDeCompra)}.` : ""),
      ]);
    } else {
      avisos.push(["bien", linea]);
    }
  }

  const excesos = ["P1", "P2"].filter(
    (p) => f.potenciaMaxima[p] != null && f.potenciaContratada[p] != null && f.potenciaMaxima[p] > f.potenciaContratada[p]
  );
  if (excesos.length) {
    avisos.push([
      "regular",
      `Has llegado a demandar ${excesos.map((p) => `${numero(f.potenciaMaxima[p], 2)} kW en ${p}`).join(" y ")} ` +
        `con ${numero(f.potenciaContratada.P1, 2)} kW contratados. No te lo penalizan en la factura, pero es lo que hace saltar el diferencial.`,
    ]);
  }

  if (Object.values(f.lecturas).some((l) => l?.estimada)) {
    avisos.push(["mal", "Hay lecturas estimadas: el consumo facturado no viene de una lectura real del contador."]);
  }

  $("avisosFactura").innerHTML = avisos
    .map(([tono, texto]) => `<p class="veredicto ${tono}">${texto}</p>`)
    .join("");
}

// Comparar dos periodos distintos no significa nada, así que se avisa.
function notaPeriodo() {
  const dias = estado.dias.length;
  const propio = `Estás comparando ${dias} día${dias === 1 ? "" : "s"} de datos.`;
  const desde = estado.factura?.desde;
  const hasta = estado.factura?.hasta;
  if (!desde || !hasta) return `${propio} Asegúrate de que cubren exactamente el periodo de la factura.`;

  const primero = estado.dias[0].fecha;
  const ultimo = estado.dias[dias - 1].fecha;
  const formato = (fecha) => fecha.toLocaleDateString("es-ES");
  if (claveDia(primero) === claveDia(desde) && claveDia(ultimo) === claveDia(hasta)) {
    return `${propio} Coinciden con el periodo facturado (${formato(desde)} a ${formato(hasta)}).`;
  }
  return `⚠️ Ojo: la factura va del ${formato(desde)} al ${formato(hasta)} y tus datos van del ${formato(primero)} al ${formato(ultimo)}. Exporta el mismo tramo para que la comparación valga.`;
}

// --- Gráficas --------------------------------------------------------------

function prepararGraficas() {
  const selector = $("selectorDia");
  selector.innerHTML = estado.dias
    .map((dia) => `<option value="${dia.clave}">${dia.fecha.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</option>`)
    .join("");
  const mejor = estado.dias.reduce((a, b) => (b.produccion > a.produccion ? b : a), estado.dias[0]);
  selector.value = mejor.clave;
  $("graficas").hidden = false;
  pintarDia();
  pintarMes();
}

function leyenda(elemento, entradas) {
  $(elemento).innerHTML = entradas.map(([nombre, color]) => `<span><i style="background:${color}"></i>${nombre}</span>`).join("");
}

function pintarDia() {
  const clave = $("selectorDia").value;
  const registros = estado.serie.registros.filter((p) => claveDia(p.instante) === clave);
  if (!registros.length) return;
  const instantes = registros.map((p) => p.instante.getTime());

  leyenda("leyendaDia", [
    ["Sol → casa", COLORES.produccion],
    ["Batería → casa", COLORES.descarga],
    ["Red → casa", COLORES.importada],
    ["Producción solar total", COLORES.produccionTotal],
    ["Consumo total", COLORES.consumo],
  ]);

  areaApilada($("graficaDia"), {
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
  });

  const tieneSoc = registros.some((p) => p.soc != null);
  $("tituloBateria").hidden = !tieneSoc;
  $("graficaBateria").parentElement.hidden = !tieneSoc;
  if (tieneSoc) {
    lineaSimple($("graficaBateria"), { instantes, valores: registros.map((p) => p.soc || 0), maximoFijo: 100 });
  }
}

function pintarMes() {
  leyenda("leyendaMes", [
    ["Cubierto por el sol y la batería", COLORES.produccion],
    ["Comprado a la red", COLORES.importada],
  ]);
  barrasApiladas($("graficaMes"), {
    etiquetas: estado.dias.map((dia) => String(dia.fecha.getDate())),
    capas: [
      { nombre: "Autoconsumo", color: COLORES.produccion, valores: estado.dias.map((d) => d.autoconsumo) },
      { nombre: "Red", color: COLORES.importada, valores: estado.dias.map((d) => d.importada) },
    ],
  });

  const { unidadesRol } = estado.serie;
  const indicePorDia = new Map(estado.dias.map((dia, i) => [dia.clave, i]));
  const matriz = estado.dias.map(() => new Array(24).fill(0));
  for (const punto of estado.serie.registros) {
    const fila = indicePorDia.get(claveDia(punto.instante));
    if (fila === undefined) continue;
    const kwh = unidadesRol.importada === "kWh" ? punto.importada || 0 : ((punto.importada || 0) * punto.horas) / 1000;
    matriz[fila][punto.instante.getHours()] += kwh;
  }
  mapaCalor($("graficaCalor"), { dias: estado.dias.map((d) => d.clave), matriz });
}

// --- Arranque --------------------------------------------------------------

conectarZona("soltarDatos", "ficheroDatos", cargarDatos);
conectarZona("soltarFactura", "ficheroFactura", cargarFactura);
$("recalcular").addEventListener("click", recalcular);
$("selectorDia").addEventListener("change", pintarDia);
$("diaAnterior").addEventListener("click", () => moverDia(-1));
$("diaSiguiente").addEventListener("click", () => moverDia(1));

function moverDia(paso) {
  const selector = $("selectorDia");
  const indice = selector.selectedIndex + paso;
  if (indice < 0 || indice >= selector.options.length) return;
  selector.selectedIndex = indice;
  pintarDia();
}

let temporizador;
window.addEventListener("resize", () => {
  if (!estado.serie) return;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    pintarDia();
    pintarMes();
  }, 150);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
