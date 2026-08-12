import { leerXlsx } from "./xlsx.js";
import {
  ROLES, detectarRoles, unidadDeCabecera, construirSerie, energiaKwh,
  repartoPorPeriodo, resumenPorDia, claveDia, periodoTarifa,
  serializarSerie, deserializarSerie,
} from "./datos.js";
import { textoDelPdf, interpretarFactura, revisarFactura, lecturasFrenteAFacturado } from "./factura.js";
import { areaApilada, barrasApiladas, barrasAgrupadas, mapaCalor, lineaSimple, COLORES } from "./graficas.js";
import { leerHistorico, guardarMes, borrarMes, importarHistorico, exportarTodo, analizarHistorico, mesDominante, nombreMes, leerCurvas, guardarCurva, leerSerie, guardarSerie } from "./historico.js";
import { hayNube, urlNube, claveMaestra, configurarNube, bajarDeNube, subirANube, sincronizarPronto } from "./nube.js";
import * as datadis from "./datadis.js";

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
    pintarComparacion(true);
    pintarRevision();
    guardarSolo();
    pintarHistorico();
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
  refrescarConSerie();
  guardarSolo();
  pintarHistorico();
}

// Todo lo que se pinta a partir de la serie, venga del fichero o del guardado.
function refrescarConSerie() {
  estado.festivos = leerFestivos();
  estado.dias = resumenPorDia(estado.serie.registros, estado.serie.unidadesRol);
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

// Al leer un PDF nuevo mandan sus cifras; si no, se respeta lo escrito a mano.
function pintarComparacion(refrescarFactura = false) {
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
    const anterior = refrescarFactura ? null : valorFactura(concepto.clave);
    const valor = anterior ?? deLaFactura[concepto.clave];
    const fila = document.createElement("tr");
    fila.innerHTML =
      `<td>${concepto.etiqueta}</td>` +
      `<td class="numero"><input type="number" step="0.01" min="0" inputmode="decimal" data-clave="${concepto.clave}" value="${valor ?? ""}" aria-label="${concepto.etiqueta} según la factura"> kWh</td>` +
      `<td class="numero">${numero(medido[concepto.clave])} kWh</td>` +
      `<td class="numero" data-desvio="${concepto.clave}"></td>`;
    cuerpo.appendChild(fila);
  }
  cuerpo.querySelectorAll("input").forEach((entrada) => {
    entrada.addEventListener("input", pintarDesvios);
    entrada.addEventListener("change", guardarSolo);
  });

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
    `<thead><tr><th>Periodo</th><th class="numero">Contador</th><th class="numero">Facturado</th><th class="numero">Diferencia</th></tr></thead><tbody>` +
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

// --- Histórico mes a mes ---------------------------------------------------

function componerMes() {
  if (!estado.serie || !estado.dias.length) return null;
  const mes = mesDominante(estado.dias.map((d) => d.fecha));
  if (!mes) return null;
  const t = totales();
  const f = estado.factura;
  const previo = leerHistorico().find((m) => m.mes === mes);
  const hayFactura = Boolean(f) || CONCEPTOS.some((c) => valorFactura(c.clave) != null);
  return {
    ...previo,
    mes,
    dias: estado.dias.length,
    desde: estado.dias[0].fecha.toISOString(),
    hasta: estado.dias[estado.dias.length - 1].fecha.toISOString(),
    medido: {
      ...estado.medido,
      produccion: t.produccion,
      consumo: t.consumo,
      carga: t.carga,
      descarga: t.descarga,
    },
    // Guardar el dia a dia permite reabrir el mes sin volver a cargar el fichero.
    detalle: estado.dias.map((d) => [
      d.clave,
      +d.produccion.toFixed(2),
      +d.consumo.toFixed(2),
      +d.importada.toFixed(2),
      +d.exportada.toFixed(2),
    ]),
    factura: hayFactura
      ? {
          P1: valorFactura("P1"),
          P2: valorFactura("P2"),
          P3: valorFactura("P3"),
          total: valorFactura("total"),
          excedentes: valorFactura("excedentes"),
          lecturas: f?.lecturas ?? null,
          precioEnergia: f?.precio?.P1 ?? null,
          precioExcedentes: f?.precioExcedentes ?? null,
          importe: f?.total ?? null,
          referencia: f?.referencia ?? null,
        }
      : (previo?.factura ?? {}),
    guardado: new Date().toISOString(),
  };
}

// Si hay un mes reconocible se guarda solo: olvidarse del boton no puede costar los datos.
function guardarSolo() {
  const mes = componerMes();
  if (mes) {
    guardarMes(mes);
    guardarSerie(mes.mes, serializarSerie(estado.serie));
    sincronizarPronto((error) => marcarNube(error ? `No se ha podido subir: ${error.message}` : "Sincronizado"));
  }
}

function pintarHistorico() {
  const meses = leerHistorico();
  const hayDatos = Boolean(estado.serie);
  $("historico").hidden = !meses.length && !hayDatos;
  $("guardarMes").disabled = !hayDatos;

  const { filas, avisos } = analizarHistorico(meses);
  const cuerpo = $("tablaHistorico").querySelector("tbody");
  cuerpo.textContent = "";

  for (const fila of filas) {
    const tr = document.createElement("tr");
    const celda = (instalacion, contador, factura) => {
      const aparte = [];
      if (Number.isFinite(instalacion)) aparte.push(`casa ${numero(instalacion, 0)}`);
      if (Number.isFinite(factura)) aparte.push(`factura ${numero(factura, 0)}`);
      const principal = [contador, factura, instalacion].find((v) => Number.isFinite(v));
      return (
        `<td class="numero dato"><b>${principal == null ? "—" : numero(principal, 0)}</b>` +
        (aparte.length ? `<small class="fuentes">${aparte.join(" · ")}</small>` : "") +
        `</td>`
      );
    };
    const c = fila.contador;
    const sello = c?.horas && c.estimadas === c.horas ? ` <span class="sello">estimado</span>` : "";
    const produccion = Number.isFinite(fila.medido?.produccion) ? `${numero(fila.medido.produccion, 0)} kWh` : "—";
    tr.innerHTML =
      `<td>${nombreMes(fila.mes)}${sello}<br><small class="tenue">${fila.dias} días</small></td>` +
      `<td class="numero">${produccion}</td>` +
      celda(fila.medido?.total, fila.contador?.total, fila.factura?.total) +
      celda(fila.medido?.excedentes, fila.contador?.vertido, fila.factura?.excedentes) +
      `<td class="numero">${euros(fila.factura?.importe)}</td>` +
      `<td class="numero"><button type="button" class="btn cuadrado" data-borrar="${fila.mes}" aria-label="Borrar ${nombreMes(fila.mes)}">×</button></td>`;
    tr.dataset.mes = fila.mes;
    tr.tabIndex = 0;
    cuerpo.appendChild(tr);
  }

  cuerpo.querySelectorAll("[data-mes]").forEach((tr) => {
    const abrir = () => pintarDetalleMes(tr.dataset.mes);
    tr.addEventListener("click", (evento) => {
      if (!evento.target.closest("[data-borrar]")) abrir();
    });
    tr.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter" || evento.key === " ") {
        evento.preventDefault();
        abrir();
      }
    });
  });

  cuerpo.querySelectorAll("[data-borrar]").forEach((boton) =>
    boton.addEventListener("click", () => {
      borrarMes(boton.dataset.borrar);
      pintarHistorico();
    })
  );

  $("avisosHistorico").innerHTML = avisos.map(([tono, texto]) => `<p class="veredicto ${tono}">${texto}</p>`).join("");
  pintarGraficaHistorico(filas);
}

// Reabre un mes ya guardado sin volver a cargar el xlsx ni el PDF.
function pintarDetalleMes(mes) {
  const fila = leerHistorico().find((m) => m.mes === mes);
  const caja = $("detalleMes");
  if (!fila) {
    caja.hidden = true;
    return;
  }
  caja.hidden = false;

  const c = fila.contador;
  const sello = c?.horas && c.estimadas === c.horas ? ` <span class="sello">estimado</span>` : "";
  const ficha = (titulo, valor, unidad, color) =>
    Number.isFinite(valor)
      ? `<dl class="ficha" style="--color:${color}"><dt>${titulo}</dt><dd>${numero(valor, 1)}<small>${unidad}</small></dd></dl>`
      : "";

  const conceptos = [
    ["Comprado en punta (P1)", fila.medido?.P1, c?.P1, fila.factura?.P1],
    ["Comprado en llano (P2)", fila.medido?.P2, c?.P2, fila.factura?.P2],
    ["Comprado en valle (P3)", fila.medido?.P3, c?.P3, fila.factura?.P3],
    ["Comprado en total", fila.medido?.total, c?.total, fila.factura?.total],
    ["Vertido a la red", fila.medido?.excedentes, c?.vertido, fila.factura?.excedentes],
  ];
  const dato = (valor) => `<td class="numero">${Number.isFinite(valor) ? `${numero(valor)} kWh` : "—"}</td>`;

  const faltan = [];
  if (!Number.isFinite(fila.medido?.total)) faltan.push("el fichero del datalogger");
  if (!Number.isFinite(fila.factura?.total)) faltan.push("la factura");

  caja.innerHTML =
    `<h3>${nombreMes(fila.mes)}${sello}</h3>` +
    `<p class="ayuda">${fila.dias} días guardados${fila.guardado ? ` · última actualización ${new Date(fila.guardado).toLocaleDateString("es-ES")}` : ""}.` +
    (faltan.length ? ` Falta cargar ${faltan.join(" y ")} de este mes.` : "") +
    `</p>` +
    `<div class="fichas">` +
    ficha("Producción solar", fila.medido?.produccion, "kWh", COLORES.produccion) +
    ficha("Consumo de la casa", fila.medido?.consumo, "kWh", COLORES.consumo) +
    ficha("Comprado (contador)", c?.total, "kWh", COLORES.importada) +
    ficha("Vertido (contador)", c?.vertido, "kWh", COLORES.exportada) +
    ficha("Importe", fila.factura?.importe, "€", COLORES.carga) +
    `</div>` +
    `<div class="tabla-envoltorio"><table class="tabla">` +
    `<thead><tr><th>Concepto</th><th class="numero">Tu casa</th><th class="numero">Contador</th><th class="numero">Factura</th></tr></thead><tbody>` +
    conceptos
      .map(([etiqueta, propio, contador, factura]) => `<tr><td>${etiqueta}</td>${dato(propio)}${dato(contador)}${dato(factura)}</tr>`)
      .join("") +
    `</tbody></table></div>` +
    (fila.detalle?.length
      ? `<h4>Día a día, según tu instalación</h4><div class="lienzo medio"><canvas id="detalleDiario"></canvas></div>`
      : "");

  if (fila.detalle?.length) {
    barrasAgrupadas($("detalleDiario"), {
      etiquetas: fila.detalle.map(([clave]) => clave.slice(-2)),
      series: [
        { nombre: "Producción", color: COLORES.produccion, valores: fila.detalle.map((d) => d[1]) },
        { nombre: "Comprado", color: COLORES.importada, valores: fila.detalle.map((d) => d[3]) },
        { nombre: "Vertido", color: COLORES.exportada, valores: fila.detalle.map((d) => d[4]) },
      ],
    });
  }
  caja.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function pintarGraficaHistorico(filas) {
  const lienzo = $("graficaHistorico").parentElement;
  lienzo.hidden = filas.length < 2;
  $("leyendaHistorico").hidden = filas.length < 2;
  if (filas.length < 2) return;

  leyenda("leyendaHistorico", [
    ["Comprado según tu instalación", COLORES.descarga],
    ["Comprado según el contador", COLORES.produccion],
    ["Comprado según la factura", COLORES.importada],
  ]);
  barrasAgrupadas($("graficaHistorico"), {
    etiquetas: filas.map((f) => nombreMes(f.mes).split(" ")[0]),
    series: [
      { nombre: "Instalación", color: COLORES.descarga, valores: filas.map((f) => f.medido?.total ?? 0) },
      { nombre: "Contador", color: COLORES.produccion, valores: filas.map((f) => f.contador?.total ?? 0) },
      { nombre: "Factura", color: COLORES.importada, valores: filas.map((f) => f.factura?.total ?? 0) },
    ],
  });
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

// --- Contador (datadis) ----------------------------------------------------

const contador = { suministros: [], curvas: leerCurvas() };

function refrescarMesesContador() {
  // Traer de la nube o restaurar una copia mete curvas nuevas en disco: hay que releerlas.
  contador.curvas = leerCurvas();
  const descargados = [...contador.curvas.keys()].sort();
  const elegido = $("mesContador").value;
  const opciones = descargados.map((m) => `<option value="${m}">${nombreMes(m)}</option>`).join("");
  const mes = descargados.includes(elegido) ? elegido : descargados[descargados.length - 1] ?? "";
  for (const id of ["mesContador", "mesContadorDia"]) {
    $(id).innerHTML = opciones;
    $(id).value = mes;
  }
  pintarCurvaContador();
}

function marcaDatadis(texto, tono = "") {
  const marca = $("estadoDatadis");
  marca.className = `estado ${tono}`;
  marca.textContent = texto;
}

function suministroElegido() {
  return contador.suministros[Number($("suministroDatadis").value)] || null;
}

async function entrarEnDatadis(evento) {
  evento.preventDefault();
  const clave = $("claveDatadis").value;
  marcaDatadis("Entrando en datadis…");
  try {
    await datadis.entrar($("nifDatadis").value, clave);
    $("claveDatadis").value = "";
    contador.suministros = await datadis.suministros();
    if (!contador.suministros.length) throw new Error("Datadis no devuelve ningún suministro a tu nombre.");
    $("suministroDatadis").innerHTML = contador.suministros
      .map((s, i) => `<option value="${i}">${s.cups} · ${s.direccion || s.distribuidora || ""}</option>`)
      .join("");
    const hoy = new Date();
    $("hastaDatadis").value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
    $("desdeDatadis").value = `${hoy.getFullYear() - 1}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
    $("descargaDatadis").hidden = false;
    marcaDatadis(`Dentro · ${contador.suministros.length} suministro${contador.suministros.length === 1 ? "" : "s"}`);
    pintarContrato();
  } catch (error) {
    marcaDatadis(error.message, "error");
  }
}

async function pintarContrato() {
  const suministro = suministroElegido();
  const caja = $("contratoDatadis");
  if (!suministro) return;
  caja.innerHTML = "<p class='ayuda'>Consultando el contrato…</p>";
  try {
    const lista = await datadis.contratos(suministro.cups, suministro.codigoDistribuidora);
    if (!lista.length) {
      caja.innerHTML = "<p class='ayuda'>Datadis no devuelve detalle de contrato para este suministro.</p>";
      return;
    }
    caja.innerHTML =
      `<h3>Cómo está dado de alta tu suministro</h3>` +
      `<div class="tabla-envoltorio"><table class="tabla"><thead><tr>` +
      `<th>Desde</th><th>Hasta</th><th>Comercializadora</th><th class="numero">Potencia</th><th>Autoconsumo</th>` +
      `</tr></thead><tbody>` +
      lista
        .map(
          (c) =>
            `<tr><td>${c.desde || "—"}</td><td>${c.hasta || "—"}</td><td>${c.comercializadora || "—"}</td>` +
            `<td class="numero">${Array.isArray(c.potencia) ? c.potencia.join(" / ") : c.potencia ?? "—"} kW</td>` +
            `<td>${c.autoconsumo ?? "—"}</td></tr>`
        )
        .join("") +
      `</tbody></table></div>` +
      `<details class="crudo"><summary>Ver todo lo que devuelve datadis</summary><pre>${JSON.stringify(lista.map((c) => c.crudo), null, 2)}</pre></details>`;
  } catch (error) {
    caja.innerHTML = `<p class="veredicto mal">${error.message}</p>`;
  }
}

function resumirCurva(registros) {
  const festivos = estado.festivos || new Set();
  const resumen = { P1: 0, P2: 0, P3: 0, total: 0, vertido: 0, horas: registros.length, estimadas: 0 };
  const dias = new Set();
  for (const punto of registros) {
    resumen[periodoTarifa(punto.instante, festivos)] += punto.consumo;
    resumen.total += punto.consumo;
    resumen.vertido += punto.vertido;
    if (!punto.real) resumen.estimadas++;
    dias.add(claveDia(punto.instante));
  }
  resumen.dias = dias.size;
  return resumen;
}

function anotarContador(mes, resumen) {
  const previo = leerHistorico().find((m) => m.mes === mes);
  guardarMes({ dias: resumen.dias, medido: {}, factura: {}, ...previo, mes, contador: resumen });
}

async function bajarDeDatadis() {
  const suministro = suministroElegido();
  if (!suministro) return;
  const meses = datadis.mesesEntre($("desdeDatadis").value, $("hastaDatadis").value);
  if (!meses.length) {
    marcaDatadis("El mes inicial es posterior al final.", "error");
    return;
  }
  $("bajarDatadis").disabled = true;
  let bajados = 0;
  let corte = null;
  for (const tramo of porAnios(meses)) {
    const desde = tramo[0];
    const hasta = tramo[tramo.length - 1];
    const rotulo = desde === hasta ? desde : `${desde} → ${hasta}`;
    marcaDatadis(`Bajando ${rotulo}…`);
    try {
      const curva = await conEspera(rotulo, () =>
        datadis.curvaHoraria(suministro.cups, suministro.codigoDistribuidora, desde, hasta, suministro.tipoPunto));
      for (const [clave, puntos] of agruparPorMes(curva)) {
        contador.curvas.set(clave, puntos);
        guardarCurva(clave, puntos);
        anotarContador(clave, resumirCurva(puntos));
        bajados++;
      }
    } catch (error) {
      corte = { mes: desde, motivo: error.message };
      break;
    }
    await pausa(1000);
  }
  $("bajarDatadis").disabled = false;
  if (corte) {
    marcaDatadis(
      `${corte.motivo} Se cortó en ${corte.mes} y van ${bajados} meses guardados. ` +
        `Pon ${corte.mes.replace("/", "-")} en «desde» y dale otra vez para seguir.`,
      "error",
    );
  } else if (bajados) {
    const sinDatos = meses.length - bajados;
    const nota = sinDatos > 0 ? ` · ${sinDatos} sin datos en datadis` : "";
    marcaDatadis(`Listo · ${bajados} mes${bajados === 1 ? "" : "es"} del contador${nota}`);
  } else {
    marcaDatadis("Datadis no ha devuelto datos de ningún mes de ese rango.", "error");
  }
  pintarHistorico();
  refrescarMesesContador();
}

// Datadis no sirve mas de un anio por peticion, asi que se pide a trozos de doce meses.
function porAnios(meses) {
  const tramos = [];
  for (let desde = 0; desde < meses.length; desde += 12) tramos.push(meses.slice(desde, desde + 12));
  return tramos;
}

function agruparPorMes(curva) {
  const meses = new Map();
  for (const punto of curva) {
    const clave = `${punto.instante.getFullYear()}-${String(punto.instante.getMonth() + 1).padStart(2, "0")}`;
    if (!meses.has(clave)) meses.set(clave, []);
    meses.get(clave).push(punto);
  }
  return meses;
}

const pausa = (ms) => new Promise((seguir) => setTimeout(seguir, ms));

// Datadis corta a las pocas peticiones seguidas y su ventana dura minutos, no segundos.
async function conEspera(rotulo, intento) {
  const esperas = [60, 120, 240];
  for (let vuelta = 0; ; vuelta++) {
    try {
      return await intento();
    } catch (error) {
      if (!error.limitado || vuelta >= esperas.length) throw error;
      for (let resto = esperas[vuelta]; resto > 0; resto--) {
        marcaDatadis(`Datadis va saturado. Reintento ${rotulo} en ${resto} s…`);
        await pausa(1000);
      }
    }
  }
}

// Un contador que compensa bien nunca registra entrada y salida a la vez en la misma hora.
function analizarSolape(curva) {
  const dias = new Map();
  let horas = 0;
  let kwh = 0;
  for (const punto of curva) {
    const clave = claveDia(punto.instante);
    if (!dias.has(clave)) dias.set(clave, { clave, matriz: new Array(24).fill(0), kwh: 0 });
    const dia = dias.get(clave);
    const solape = Math.min(punto.consumo, punto.vertido);
    dia.matriz[punto.instante.getHours()] += solape;
    dia.kwh += solape;
    kwh += solape;
    if (solape >= 0.05) horas++;
  }
  return { dias: [...dias.values()].sort((a, b) => a.clave.localeCompare(b.clave)), horas, kwh };
}

// El primer día que se descuelga y ya no vuelve: ahí cambió algo.
function diaDelCambio(dias) {
  for (let i = 0; i < dias.length; i++) {
    if (dias[i].kwh < 1) continue;
    const siguientes = dias.slice(i + 1, i + 6);
    if (siguientes.filter((d) => d.kwh >= 1).length >= Math.min(3, siguientes.length)) return dias[i];
  }
  return null;
}

function pintarCurvaContador() {
  const mes = $("mesContador").value;
  const curva = contador.curvas.get(mes);
  $("solapeContador").hidden = !curva;
  if (!curva) {
    $("cotejoContador").hidden = true;
    return;
  }

  const { dias, horas, kwh } = analizarSolape(curva);
  const cambio = diaDelCambio(dias);
  const total = curva.reduce((suma, p) => suma + p.consumo, 0);
  const resumen = leerHistorico().find((m) => m.mes === mes)?.contador;
  const inventado = Boolean(resumen?.horas) && resumen.estimadas === resumen.horas;
  const solape =
    kwh < 2
      ? `<p class="veredicto bien">En ${nombreMes(mes)} el contador compensa bien: solo ${numero(kwh, 1)} kWh se registraron ` +
        `entrando y saliendo a la vez, lo normal en las horas de amanecer y anochecer.</p>`
      : inventado
        ? `<p class="veredicto regular">Hay ${numero(kwh, 1)} kWh en ${horas} horas con energía entrando y saliendo a la vez. ` +
          `Como el mes está estimado entero, eso lo ha producido el cálculo de la distribuidora, no tu contador.</p>`
        : `<p class="veredicto mal">En ${nombreMes(mes)} hay <b>${numero(kwh, 1)} kWh</b> repartidos en ${horas} horas en las que el contador ` +
          `apuntó energía entrando y saliendo al mismo tiempo. Esa energía te la cobran como comprada y te la pagan como vertida, ` +
          `cuando en realidad nunca salió de tu casa. Son ${numero((kwh / total) * 100, 0)}% de los ${numero(total, 0)} kWh que te constan comprados ese mes.` +
          (cambio ? ` Empieza el <b>${cambio.clave}</b>.` : "") +
          `</p>`;
  $("veredictoSolape").innerHTML = panelEstimado(mes) + solape;

  mapaCalor($("mapaSolape"), { dias: dias.map((d) => d.clave), matriz: dias.map((d) => d.matriz) });

  const porDia = new Map();
  for (const punto of curva) {
    const clave = claveDia(punto.instante);
    if (!porDia.has(clave)) porDia.set(clave, { compra: 0, vertido: 0 });
    porDia.get(clave).compra += punto.consumo;
    porDia.get(clave).vertido += punto.vertido;
  }

  const propios = estado.dias?.length ? estado.dias : [];
  const mismoMes = propios.length && mesDominante(propios.map((d) => d.fecha)) === mes;
  pintarDiasImposibles(porDia, mismoMes ? propios : []);

  $("cotejoContador").hidden = !mismoMes;
  if (!mismoMes) return;

  const etiquetas = propios.map((d) => String(d.fecha.getDate()));
  const serie = (rol, campo) => [
    { nombre: "Instalación", color: COLORES.descarga, valores: propios.map((d) => d[rol]) },
    { nombre: "Contador", color: COLORES.importada, valores: propios.map((d) => porDia.get(d.clave)?.[campo] ?? 0) },
  ];
  leyenda("leyendaDiaria", [["Tu instalación", COLORES.descarga], ["El contador", COLORES.importada]]);
  barrasAgrupadas($("compraDiaria"), { etiquetas, series: serie("importada", "compra") });
  barrasAgrupadas($("vertidoDiario"), { etiquetas, series: serie("exportada", "vertido") });
}

// Datadis marca cada hora como medida o estimada: un mes estimado entero no es una lectura.
function panelEstimado(mes) {
  const meses = leerHistorico();
  const fila = meses.find((m) => m.mes === mes);
  const c = fila?.contador;
  if (!c?.horas) return "";

  const nadaEstimado = !c.estimadas;
  const todoEstimado = c.estimadas === c.horas;
  const porcentaje = (c.estimadas / c.horas) * 100;
  // Se redondea solo la parte estimada y la real se saca de ella: asi las dos suman 100.
  const casiNada = porcentaje > 0 && porcentaje < 1;
  const cifraEstimado = casiNada ? "<1%" : `${Math.round(porcentaje)}%`;
  const cifraReal = casiNada ? ">99%" : `${100 - Math.round(porcentaje)}%`;
  const enMeses = (clave) => Number(clave.slice(0, 4)) * 12 + Number(clave.slice(5, 7));
  // A igual distancia gana el mes posterior: refleja la instalación tal y como está hoy.
  const referencia = meses
    .filter((m) => m.mes !== mes && m.contador?.horas && !m.contador.estimadas && m.contador.dias >= 28)
    .sort((a, b) => {
      const cerca = Math.abs(enMeses(a.mes) - enMeses(mes)) - Math.abs(enMeses(b.mes) - enMeses(mes));
      return cerca || enMeses(b.mes) - enMeses(a.mes);
    })[0];

  const cifras = [[numero(c.total, 0), "kWh que te facturan"]];
  if (Number.isFinite(fila.medido?.total)) cifras.push([numero(fila.medido.total, 0), "kWh midió tu casa"]);
  // El mes de contraste solo hace falta para juzgar uno estimado.
  if (referencia && !nadaEstimado) cifras.push([numero(referencia.contador.total, 0), `kWh en ${nombreMes(referencia.mes)}, con lectura real`]);

  const pie = nadaEstimado
    ? `del mes lo midió el contador: la distribuidora leyó las ${c.horas} horas, no calculó ninguna.`
    : todoEstimado
      ? `del mes está estimado: la distribuidora no midió ninguna de las ${c.horas} horas. Aun así, es lo que se factura.`
      : `del mes está estimado: ${c.estimadas} de las ${c.horas} horas las calculó la distribuidora en vez de medirlas. Aun así, es lo que se factura.`;

  return (
    `<div class="titular ${nadaEstimado ? "bien" : todoEstimado ? "mal" : "regular"}">` +
    `<p class="titular-etiqueta">${nombreMes(mes)} en tu contador</p>` +
    `<div class="titular-par">` +
    `<div class="estimado"><b>${cifraEstimado}</b><small>estimado</small></div>` +
    `<div class="real"><b>${cifraReal}</b><small>lectura real</small></div>` +
    `</div>` +
    `<p class="titular-pie">${pie}</p>` +
    `<div class="titular-cifras">` +
    cifras.map(([valor, pie]) => `<div><b>${valor}</b><small>${pie}</small></div>`).join("") +
    `</div></div>`
  );
}

// Nadie puede verter más de lo que genera: si un día se dispara, ese dato está mal.
function pintarDiasImposibles(porDia, propios) {
  const caja = $("diasImposibles");
  const vertidos = [...porDia.values()].map((d) => d.vertido).sort((a, b) => a - b);
  const centro = vertidos[Math.floor(vertidos.length / 2)] || 0;
  const produccion = new Map(propios.map((d) => [d.clave, d.produccion]));

  const sospechosos = [];
  for (const [clave, dia] of porDia) {
    const techo = produccion.get(clave);
    const razones = [];
    if (techo != null && dia.vertido > techo * 1.2 + 2) {
      razones.push(`ese día tus placas solo generaron ${numero(techo, 1)} kWh`);
    }
    if (centro > 0 && dia.vertido > centro * 4) {
      razones.push(`el resto de días del mes rondan ${numero(centro, 1)} kWh`);
    }
    if (razones.length) sospechosos.push({ clave, dia, razones });
  }
  caja.hidden = !sospechosos.length;
  if (!sospechosos.length) return;

  caja.innerHTML =
    `<p class="veredicto mal">Hay ${sospechosos.length === 1 ? "un día imposible" : `${sospechosos.length} días imposibles`} en la curva del contador. ` +
    `Nadie puede verter a la red más energía de la que genera, así que ${sospechosos.length === 1 ? "ese dato es" : "esos datos son"} incorrecto${sospechosos.length === 1 ? "" : "s"}.</p>` +
    `<ul class="lista-avisos">` +
    sospechosos
      .map(
        ({ clave, dia, razones }) =>
          `<li><b>${clave}</b>: el contador apuntó <b>${numero(dia.vertido, 1)} kWh vertidos</b> y ${numero(dia.compra, 1)} comprados, ` +
          `cuando ${razones.join(" y ")}.</li>`
      )
      .join("") +
    `</ul>`;
}

// --- Arranque --------------------------------------------------------------

conectarZona("soltarDatos", "ficheroDatos", cargarDatos);
conectarZona("soltarFactura", "ficheroFactura", cargarFactura);
$("recalcular").addEventListener("click", recalcular);

$("guardarMes").addEventListener("click", () => {
  const registro = componerMes();
  if (!registro) return;
  guardarMes(registro);
  pintarHistorico();
  avisar(`Guardado ${nombreMes(registro.mes)}. Cuando tengas varios meses, la tabla enseña cuál se sale del patrón.`);
});

$("exportarHistorico").addEventListener("click", () => {
  const blob = new Blob([exportarTodo()], { type: "application/json" });
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob);
  enlace.download = `solar-monitor-${new Date().toISOString().slice(0, 10)}.json`;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
});

$("ficheroHistorico").addEventListener("change", async (evento) => {
  const fichero = evento.target.files[0];
  if (!fichero) return;
  try {
    const r = importarHistorico(await fichero.text());
    pintarHistorico();
    refrescarMesesContador();
    avisar(`Copia restaurada: ${r.nuevos} meses nuevos y ${r.fusionados} completados. Lo que ya tenías no se ha perdido.`);
  } catch (error) {
    avisar(`No se ha podido leer la copia: ${error.message}`);
  }
  evento.target.value = "";
});

function marcarNube(mensaje) {
  const sello = $("estadoNube");
  sello.textContent = mensaje ?? (hayNube() ? "activa" : "sin configurar");
  sello.classList.toggle("apagada", !hayNube());
}

$("guardarNube").addEventListener("click", () => {
  configurarNube($("urlNube").value, $("claveNube").value);
  marcarNube();
  avisar(hayNube() ? "Sincronización configurada. Pega esta misma clave en tus otros dispositivos." : "Sincronización desactivada.");
});

$("subirNube").addEventListener("click", async () => {
  if (!hayNube()) return avisar("Antes hay que rellenar la dirección del Worker y la clave maestra.");
  marcarNube("subiendo…");
  try {
    const r = await subirANube();
    marcarNube("activa");
    avisar(`Histórico subido y cifrado (${Math.round(r.bytes / 1024)} kB).`);
  } catch (error) {
    marcarNube(`error: ${error.message}`);
    avisar(`No se ha podido subir: ${error.message}`);
  }
});

$("bajarNube").addEventListener("click", async () => {
  if (!hayNube()) return avisar("Antes hay que rellenar la dirección del Worker y la clave maestra.");
  marcarNube("bajando…");
  try {
    const r = await bajarDeNube();
    marcarNube("activa");
    restaurarSerie();
    pintarHistorico();
    refrescarMesesContador();
    avisar(r.vacio ? "En la nube todavía no hay nada guardado." : `Traído de la nube: ${r.nuevos} meses nuevos y ${r.fusionados} completados.`);
  } catch (error) {
    marcarNube(`error: ${error.message}`);
    avisar(`No se ha podido traer: ${error.message}`);
  }
});

$("urlNube").value = urlNube();
$("claveNube").value = claveMaestra();
marcarNube();

// Al abrir, lo de la nube se funde con lo de este navegador antes de pintar nada.
if (hayNube()) {
  bajarDeNube()
    .then((r) => {
      if (!r.vacio && (r.nuevos || r.fusionados)) {
        restaurarSerie();
        pintarHistorico();
        refrescarMesesContador();
      }
      marcarNube("activa");
    })
    .catch((error) => marcarNube(`error: ${error.message}`));
}

// El ultimo mes se recupera del navegador para no tener que rearrastrar el .xlsx.
let serieEnPantalla = null;

function restaurarSerie() {
  const guardado = leerSerie();
  // Un fichero recien cargado manda sobre lo guardado.
  if (!guardado || guardado.mes === serieEnPantalla || estado.filas.length) return;
  const serie = deserializarSerie(guardado.serie);
  if (!serie) return;
  estado.serie = serie;
  serieEnPantalla = guardado.mes;
  refrescarConSerie();
  $("estadoDatos").textContent = `${nombreMes(guardado.mes)} · guardado en este navegador`;
}

restaurarSerie();
pintarHistorico();
refrescarMesesContador();
$("accesoDatadis").addEventListener("submit", entrarEnDatadis);
$("suministroDatadis").addEventListener("change", pintarContrato);
$("bajarDatadis").addEventListener("click", bajarDeDatadis);
// Los dos selectores de mes del contador viven en pestanas distintas pero mandan lo mismo.
for (const id of ["mesContador", "mesContadorDia"]) {
  $(id).addEventListener("change", (evento) => {
    $(id === "mesContador" ? "mesContadorDia" : "mesContador").value = evento.target.value;
    pintarCurvaContador();
  });
}
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

// --- Pestañas --------------------------------------------------------------

const PESTANAS = ["datos", "cuadra", "meses", "dia"];

// Las gráficas se miden con clientWidth, que dentro de un panel oculto vale 0
// y las deja del ancho de reserva. Por eso cada panel se repinta al mostrarse.
function repintarPanel(nombre) {
  if (nombre === "cuadra") pintarCurvaContador();
  if (nombre === "meses") pintarHistorico();
  if (nombre === "dia" && estado.serie) {
    pintarDia();
    pintarMes();
  }
}

function refrescarVacios() {
  for (const nombre of PESTANAS) {
    const panel = $(`panel-${nombre}`);
    const cartel = panel.querySelector(".vacio");
    if (!cartel) continue;
    const hayAlgo = Boolean(panel.querySelector("section:not([hidden])"));
    if (cartel.hidden !== hayAlgo) cartel.hidden = hayAlgo;
  }
}

function abrirPestana(nombre, guardarEnUrl = true) {
  if (!PESTANAS.includes(nombre)) nombre = "datos";
  for (const otra of PESTANAS) {
    const pestana = $(`pestana-${otra}`);
    const activa = otra === nombre;
    pestana.setAttribute("aria-selected", String(activa));
    pestana.tabIndex = activa ? 0 : -1;
    $(`panel-${otra}`).hidden = !activa;
  }
  if (guardarEnUrl) history.replaceState(null, "", `#${nombre}`);
  repintarPanel(nombre);
  refrescarVacios();
}

for (const nombre of PESTANAS) {
  $(`pestana-${nombre}`).addEventListener("click", () => abrirPestana(nombre));
}

document.querySelector(".lista-pestanas").addEventListener("keydown", (evento) => {
  const paso = { ArrowLeft: -1, ArrowRight: 1 }[evento.key];
  if (!paso) return;
  evento.preventDefault();
  const actual = PESTANAS.findIndex((n) => $(`pestana-${n}`).getAttribute("aria-selected") === "true");
  const destino = PESTANAS[(actual + paso + PESTANAS.length) % PESTANAS.length];
  abrirPestana(destino);
  $(`pestana-${destino}`).focus();
});

window.addEventListener("hashchange", () => abrirPestana(location.hash.slice(1), false));

// Los paneles se van llenando segun llegan los datos: el cartel de vacio se
// entera solo, mirando cuando alguna seccion deja de estar oculta.
const vigilante = new MutationObserver(refrescarVacios);
for (const nombre of PESTANAS) {
  vigilante.observe($(`panel-${nombre}`), { attributes: true, attributeFilter: ["hidden"], subtree: true });
}

$("abrirAjustes").addEventListener("click", () => $("ajustes").showModal());

abrirPestana(location.hash.slice(1), false);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
