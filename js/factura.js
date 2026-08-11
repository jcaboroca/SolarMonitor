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
  // Sin coma decimal, "9.755" son miles; con ella, los puntos siempre lo son.
  const normal = limpio.includes(",")
    ? limpio.replace(/\./g, "").replace(",", ".")
    : limpio.replace(/^(-?\d{1,3})(\.\d{3})+$/, (t) => t.replace(/\./g, ""));
  const numero = parseFloat(normal);
  return Number.isFinite(numero) ? numero : null;
}

function fechaEspanola(texto) {
  const partes = texto.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!partes) return null;
  const anio = partes[3].length === 2 ? 2000 + Number(partes[3]) : Number(partes[3]);
  return new Date(anio, Number(partes[2]) - 1, Number(partes[1]));
}

const NUM = "(-?\\d[\\d.]*(?:,\\d+)?)";
const CENT = "(cent|c)?\\s*€";
const FECHA = "(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})";

function primero(texto, patrones) {
  for (const patron of patrones) {
    const encontrado = texto.match(patron);
    if (encontrado) return encontrado;
  }
  return null;
}

// Los precios unitarios vienen casi siempre en céntimos ("10,8727 c€/kWh").
function aEuros(valor, marca) {
  const numero = aNumeroEspanol(valor);
  if (numero == null) return null;
  return marca ? numero / 100 : numero;
}

function vacio() {
  return { P1: null, P2: null, P3: null };
}

/** Busca en el texto los datos de una factura 2.0TD. Devuelve null en lo que no encuentre. */
export function interpretarFactura(texto) {
  const plano = texto.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  const r = {
    referencia: null,
    cups: null,
    desde: null,
    hasta: null,
    dias: null,
    diasFacturados: null,
    lecturas: vacio(),
    consumo: vacio(),
    precio: vacio(),
    importeEnergia: vacio(),
    consumoTotal: null,
    potenciaContratada: { P1: null, P2: null },
    precioPotencia: { P1: null, P2: null },
    importePotencia: { P1: null, P2: null },
    potenciaMaxima: { P1: null, P2: null },
    excedentes: null,
    precioExcedentes: null,
    importeExcedentes: null,
    alquiler: null,
    tipoImpuesto: null,
    baseImpuesto: null,
    impuestoElectricidad: null,
    baseImponible: null,
    tipoIva: null,
    iva: null,
    potencia: null,
    total: null,
  };

  const referencia = plano.match(/N[ºo°]\s*factura\s+([A-Z0-9-]+)/i);
  if (referencia) r.referencia = referencia[1];
  const cups = plano.match(/CUPS\s*:?\s*([A-Z]{2}[A-Z0-9]{16,20})/i);
  if (cups) r.cups = cups[1];

  const rango = primero(plano, [
    new RegExp(`periodo\\s+de\\s+facturaci[óo]n[^\\d]{0,20}${FECHA}\\s*(?:-|–|a|al|hasta)\\s*${FECHA}`, "i"),
    new RegExp(`(?:per[ií]odo|periodo)[^\\d\\n]{0,30}${FECHA}[^\\d\\n]{1,15}${FECHA}`, "i"),
    new RegExp(`\\bdel?\\s+${FECHA}\\s+(?:a|al|hasta)\\s+${FECHA}`, "i"),
  ]);
  if (rango) {
    r.desde = fechaEspanola(rango[1]);
    r.hasta = fechaEspanola(rango[2]);
    if (r.desde && r.hasta) r.dias = Math.round((r.hasta - r.desde) / 86400000) + 1;
  }
  const diasDeclarados = plano.match(/\(\s*(\d{1,3})\s*d[ií]as\s*\)/i);
  if (diasDeclarados) r.diasFacturados = Number(diasDeclarados[1]);

  // Lecturas del contador: "P1: 01/06/26 30/06/26 9755 kWh (R) 9773 kWh (R) 18 kWh".
  const lecturas = new RegExp(
    `P(\\d)\\s*:\\s*${FECHA}\\s+${FECHA}\\s+${NUM}\\s*kWh\\s*\\((R|E)\\)\\s+${NUM}\\s*kWh\\s*\\((R|E)\\)\\s+${NUM}\\s*kWh`,
    "gi"
  );
  for (const t of plano.matchAll(lecturas)) {
    r.lecturas[`P${t[1]}`] = {
      inicial: aNumeroEspanol(t[4]),
      final: aNumeroEspanol(t[6]),
      consumo: aNumeroEspanol(t[8]),
      estimada: t[5].toUpperCase() === "E" || t[7].toUpperCase() === "E",
    };
  }

  // Energía facturada: "P1: 17 kWh * 10,8727 c€/kWh 1,85 €".
  const energia = new RegExp(`P(\\d)\\s*:\\s*${NUM}\\s*kWh\\s*\\*\\s*${NUM}\\s*${CENT}\\s*/\\s*kWh\\s+${NUM}\\s*€`, "gi");
  for (const t of plano.matchAll(energia)) {
    const clave = `P${t[1]}`;
    r.consumo[clave] = aNumeroEspanol(t[2]);
    r.precio[clave] = aEuros(t[3], t[4]);
    r.importeEnergia[clave] = aNumeroEspanol(t[5]);
  }

  // Potencia facturada: "P1: 3,1 kW * 10,0708 c€/kW/día * 30 días 9,37 €".
  const potencia = new RegExp(
    `P(\\d)\\s*:\\s*${NUM}\\s*kW\\s*\\*\\s*${NUM}\\s*${CENT}\\s*/\\s*kW\\s*/\\s*d[ií]a\\s*\\*\\s*(\\d{1,3})\\s*d[ií]as?\\s+${NUM}\\s*€`,
    "gi"
  );
  for (const t of plano.matchAll(potencia)) {
    const clave = `P${t[1]}`;
    r.potenciaContratada[clave] = aNumeroEspanol(t[2]);
    r.precioPotencia[clave] = aEuros(t[3], t[4]);
    r.diasFacturados ??= Number(t[5]);
    r.importePotencia[clave] = aNumeroEspanol(t[6]);
  }
  if (r.potenciaContratada.P1 == null) {
    const contratada = plano.match(new RegExp(`potencia\\s+contratada\\s*:?\\s*P1\\s*${NUM}\\s*kW(?:\\s*P2\\s*${NUM}\\s*kW)?`, "i"));
    if (contratada) {
      r.potenciaContratada.P1 = aNumeroEspanol(contratada[1]);
      r.potenciaContratada.P2 = aNumeroEspanol(contratada[2]);
    }
  }
  r.potencia = r.potenciaContratada.P1;

  const maximas = plano.match(
    new RegExp(`m[áa]ximas\\s+demandadas[\\s\\S]{0,60}?${NUM}\\s*kW\\s+en\\s+P1[\\s\\S]{0,40}?${NUM}\\s*kW\\s+en\\s+P2`, "i")
  );
  if (maximas) {
    r.potenciaMaxima.P1 = aNumeroEspanol(maximas[1]);
    r.potenciaMaxima.P2 = aNumeroEspanol(maximas[2]);
  }

  const sumaConsumo = ["P1", "P2", "P3"].map((p) => r.consumo[p]).filter((v) => v != null);
  if (sumaConsumo.length) r.consumoTotal = sumaConsumo.reduce((a, b) => a + b, 0);
  else {
    const total = primero(plano, [
      new RegExp(`consumo\\s+total[^\\n]{0,40}?${NUM}\\s*kWh`, "i"),
      new RegExp(`total\\s+(?:de\\s+)?energ[ií]a[^\\n]{0,40}?${NUM}\\s*kWh`, "i"),
    ]);
    if (total) r.consumoTotal = aNumeroEspanol(total[1]);
  }

  const excedentes = primero(plano, [
    new RegExp(`excedent\\w*[^\\n]{0,60}?${NUM}\\s*kWh\\s*\\*\\s*${NUM}\\s*${CENT}\\s*/\\s*kWh\\s+${NUM}\\s*€`, "i"),
    new RegExp(`(?:excedent\\w+|energ[ií]a\\s+vertida|compensaci[óo]n)[^\\n]{0,60}?${NUM}\\s*kWh`, "i"),
  ]);
  if (excedentes) {
    r.excedentes = aNumeroEspanol(excedentes[1]);
    if (excedentes[2]) r.precioExcedentes = Math.abs(aEuros(excedentes[2], excedentes[3]));
    if (excedentes[4]) r.importeExcedentes = aNumeroEspanol(excedentes[4]);
  }

  const alquiler = plano.match(new RegExp(`alquiler\\s+del?\\s+(?:equipo\\s+de\\s+medida|contador)[^\\n\\d]{0,20}${NUM}\\s*€`, "i"));
  if (alquiler) r.alquiler = aNumeroEspanol(alquiler[1]);

  const impuesto = plano.match(new RegExp(`\\(\\s*${NUM}\\s*%\\s*\\)\\s*s\\s*/\\s*${NUM}\\s*€\\s+${NUM}\\s*€`, "i"));
  if (impuesto) {
    r.tipoImpuesto = aNumeroEspanol(impuesto[1]);
    r.baseImpuesto = aNumeroEspanol(impuesto[2]);
    r.impuestoElectricidad = aNumeroEspanol(impuesto[3]);
  }

  const base = plano.match(new RegExp(`importe\\s+total\\s+${NUM}\\s*€`, "i"));
  if (base) r.baseImponible = aNumeroEspanol(base[1]);

  const iva = plano.match(new RegExp(`IVA\\s*\\(\\s*${NUM}\\s*%\\s*\\)\\s*s\\s*/\\s*${NUM}\\s*€\\s+${NUM}\\s*€`, "i"));
  if (iva) {
    r.tipoIva = aNumeroEspanol(iva[1]);
    r.baseImponible ??= aNumeroEspanol(iva[2]);
    r.iva = aNumeroEspanol(iva[3]);
  }

  const total = primero(plano, [
    new RegExp(`TOTAL\\s+(?:FACTURA|IMPORTE)\\s*\\n?\\s*${NUM}\\s*€`, "i"),
    new RegExp(`total\\s+(?:importe\\s+)?(?:de\\s+la\\s+)?factura[^\\n]{0,40}?${NUM}\\s*€`, "i"),
  ]);
  if (total) r.total = aNumeroEspanol(total[1]);

  return r;
}

const PERIODOS = ["P1", "P2", "P3"];

function suma(objeto) {
  const valores = Object.values(objeto).filter((v) => typeof v === "number");
  return valores.length ? valores.reduce((a, b) => a + b, 0) : null;
}

/**
 * Rehace las cuentas de la factura con sus propios números. No compara con el
 * datalogger: solo comprueba que la factura sea coherente consigo misma.
 */
export function revisarFactura(f) {
  const puntos = [];
  const anotar = (concepto, esperado, segunFactura, margen = 0.011) => {
    if (esperado == null || segunFactura == null) return;
    puntos.push({ concepto, esperado, segunFactura, ok: Math.abs(esperado - segunFactura) <= margen });
  };

  for (const p of PERIODOS) {
    if (f.consumo[p] != null && f.precio[p] != null) {
      anotar(`Energía ${p}: ${f.consumo[p]} kWh × ${f.precio[p].toFixed(6)} €/kWh`, f.consumo[p] * f.precio[p], f.importeEnergia[p]);
    }
    const lectura = f.lecturas[p];
    if (lectura?.inicial != null && lectura.final != null) {
      anotar(`Lectura ${p}: ${lectura.final} − ${lectura.inicial}`, lectura.final - lectura.inicial, lectura.consumo, 0.5);
    }
  }

  for (const p of ["P1", "P2"]) {
    if (f.potenciaContratada[p] != null && f.precioPotencia[p] != null && f.diasFacturados) {
      anotar(
        `Potencia ${p}: ${f.potenciaContratada[p]} kW × ${f.precioPotencia[p].toFixed(6)} €/kW/día × ${f.diasFacturados} días`,
        f.potenciaContratada[p] * f.precioPotencia[p] * f.diasFacturados,
        f.importePotencia[p]
      );
    }
  }

  if (f.excedentes != null && f.precioExcedentes != null && f.importeExcedentes != null) {
    anotar(
      `Excedentes: ${f.excedentes} kWh × ${f.precioExcedentes.toFixed(6)} €/kWh`,
      -Math.abs(f.excedentes * f.precioExcedentes),
      f.importeExcedentes
    );
  }

  if (f.dias != null && f.diasFacturados != null) {
    anotar(`Días facturados (${f.desde?.toLocaleDateString("es-ES")} a ${f.hasta?.toLocaleDateString("es-ES")})`, f.dias, f.diasFacturados, 0);
  }

  const totalPotencia = suma(f.importePotencia);
  const totalEnergia = suma(f.importeEnergia);
  if (totalPotencia != null && totalEnergia != null) {
    anotar("Base del impuesto eléctrico (potencia + energía)", totalPotencia + totalEnergia, f.baseImpuesto, 0.02);
    if (f.tipoImpuesto != null && f.baseImpuesto != null) {
      anotar(`Impuesto de electricidad (${f.tipoImpuesto} % s/ ${f.baseImpuesto} €)`, (f.baseImpuesto * f.tipoImpuesto) / 100, f.impuestoElectricidad);
    }
    const base =
      totalPotencia + totalEnergia + (f.importeExcedentes || 0) + (f.alquiler || 0) + (f.impuestoElectricidad || 0);
    anotar("Importe antes de IVA (suma de conceptos)", base, f.baseImponible, 0.02);
  }

  if (f.tipoIva != null && f.baseImponible != null) {
    anotar(`IVA (${f.tipoIva} % s/ ${f.baseImponible} €)`, (f.baseImponible * f.tipoIva) / 100, f.iva);
  }
  if (f.baseImponible != null && f.iva != null) {
    anotar("Total de la factura (base + IVA)", f.baseImponible + f.iva, f.total, 0.02);
  }

  return puntos;
}

/** Diferencias entre lo que marcó el contador y lo que acabaron facturando. */
export function lecturasFrenteAFacturado(f) {
  const filas = [];
  for (const p of PERIODOS) {
    const leido = f.lecturas[p]?.consumo;
    const facturado = f.consumo[p];
    if (leido == null || facturado == null) continue;
    filas.push({ periodo: p, leido, facturado, diferencia: facturado - leido, estimada: !!f.lecturas[p].estimada });
  }
  return filas;
}
