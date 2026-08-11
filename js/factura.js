// Extrae el texto del PDF de la factura con pdf.js y busca los importes de una
// 2.0TD. Lo que encuentre es solo una propuesta: siempre se puede corregir.

import * as pdfjs from "../vendor/pdf.min.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.js", import.meta.url).href;

export async function textoDelPdf(datos) {
  const tarea = pdfjs.getDocument({ data: datos, isEvalSupported: false });
  const documento = await tarea.promise;
  const paginas = [];
  for (let n = 1; n <= documento.numPages; n++) {
    const pagina = await documento.getPage(n);
    const contenido = await pagina.getTextContent();
    // Se reconstruyen las líneas agrupando por altura: si no, los importes se
    // mezclan con los conceptos de otras filas de la tabla.
    const lineas = new Map();
    for (const trozo of contenido.items) {
      if (!trozo.str) continue;
      const altura = Math.round(trozo.transform[5]);
      if (!lineas.has(altura)) lineas.set(altura, []);
      lineas.get(altura).push({ x: trozo.transform[4], texto: trozo.str });
    }
    const ordenadas = [...lineas.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, trozos]) => trozos.sort((a, b) => a.x - b.x).map((t) => t.texto).join(" ").replace(/\s+/g, " ").trim());
    paginas.push(ordenadas.join("\n"));
  }
  await tarea.destroy();
  return paginas.join("\n");
}

export function aNumeroEspanol(texto) {
  if (texto == null) return null;
  const limpio = String(texto).trim().replace(/\s/g, "");
  const normal = limpio.includes(",") ? limpio.replace(/\./g, "").replace(",", ".") : limpio;
  const numero = parseFloat(normal);
  return Number.isFinite(numero) ? numero : null;
}

function fechaEspanola(texto) {
  const partes = texto.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!partes) return null;
  const anio = partes[3].length === 2 ? 2000 + Number(partes[3]) : Number(partes[3]);
  return new Date(anio, Number(partes[2]) - 1, Number(partes[1]));
}

const NUM = "([\\d.]+,\\d+|[\\d.]+)";

function primero(texto, patrones) {
  for (const patron of patrones) {
    const encontrado = texto.match(patron);
    if (encontrado) return encontrado;
  }
  return null;
}

/** Busca en el texto los datos de una factura 2.0TD. Devuelve null en lo que no encuentre. */
export function interpretarFactura(texto) {
  const plano = texto.replace(/\u00a0/g, " ");
  const resultado = {
    desde: null,
    hasta: null,
    dias: null,
    consumo: { P1: null, P2: null, P3: null },
    precio: { P1: null, P2: null, P3: null },
    consumoTotal: null,
    excedentes: null,
    precioExcedentes: null,
    potencia: null,
    total: null,
  };

  const rango = primero(plano, [
    /(?:per[ií]odo|periodo)\s*(?:de\s*)?factura\w*[^\d]{0,30}(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})[^\d]{1,15}(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /\bdel?\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(?:a|al|hasta)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
  ]);
  if (rango) {
    resultado.desde = fechaEspanola(rango[1]);
    resultado.hasta = fechaEspanola(rango[2]);
    if (resultado.desde && resultado.hasta) {
      resultado.dias = Math.round((resultado.hasta - resultado.desde) / 86400000) + 1;
    }
  }

  for (const periodo of ["P1", "P2", "P3"]) {
    const numero = periodo[1];
    const consumo = primero(plano, [
      new RegExp(`(?:energ[ií]a|consumo)[^\\n]{0,40}\\bP\\s?${numero}\\b[^\\n]{0,40}?${NUM}\\s*kWh`, "i"),
      new RegExp(`\\bP\\s?${numero}\\b[^\\n]{0,60}?${NUM}\\s*kWh`, "i"),
    ]);
    if (consumo) resultado.consumo[periodo] = aNumeroEspanol(consumo[1]);

    const precio = primero(plano, [
      new RegExp(`\\bP\\s?${numero}\\b[^\\n]{0,80}?${NUM}\\s*(?:€|EUR)\\s*/\\s*kWh`, "i"),
    ]);
    if (precio) resultado.precio[periodo] = aNumeroEspanol(precio[1]);
  }

  const totalConsumo = primero(plano, [
    new RegExp(`consumo\\s+total[^\\n]{0,40}?${NUM}\\s*kWh`, "i"),
    new RegExp(`total\\s+(?:de\\s+)?energ[ií]a[^\\n]{0,40}?${NUM}\\s*kWh`, "i"),
    new RegExp(`(?:ha\\s+consumido|consumo\\s+en\\s+el\\s+per[ií]odo)[^\\n]{0,40}?${NUM}\\s*kWh`, "i"),
  ]);
  if (totalConsumo) resultado.consumoTotal = aNumeroEspanol(totalConsumo[1]);

  const excedentes = primero(plano, [
    new RegExp(`(?:excedent\\w+|energ[ií]a\\s+vertida|autoconsumo)[^\\n]{0,60}?${NUM}\\s*kWh`, "i"),
    new RegExp(`compensaci[óo]n[^\\n]{0,60}?${NUM}\\s*kWh`, "i"),
  ]);
  if (excedentes) resultado.excedentes = aNumeroEspanol(excedentes[1]);

  const precioExcedentes = primero(plano, [
    new RegExp(`(?:excedent\\w+|compensaci[óo]n)[^\\n]{0,80}?${NUM}\\s*(?:€|EUR)\\s*/\\s*kWh`, "i"),
  ]);
  if (precioExcedentes) resultado.precioExcedentes = aNumeroEspanol(precioExcedentes[1]);

  const potencia = primero(plano, [
    new RegExp(`potencia\\s+contratada[^\\n]{0,40}?${NUM}\\s*kW\\b`, "i"),
    new RegExp(`potencia[^\\n]{0,30}?${NUM}\\s*kW\\b`, "i"),
  ]);
  if (potencia) resultado.potencia = aNumeroEspanol(potencia[1]);

  const total = primero(plano, [
    new RegExp(`total\\s+(?:importe\\s+)?(?:de\\s+la\\s+)?factura[^\\n]{0,40}?${NUM}\\s*(?:€|EUR)`, "i"),
    new RegExp(`importe\\s+total[^\\n]{0,40}?${NUM}\\s*(?:€|EUR)`, "i"),
  ]);
  if (total) resultado.total = aNumeroEspanol(total[1]);

  return resultado;
}
