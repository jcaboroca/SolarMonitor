// Normaliza el volcado del datalogger: detecta qué es cada columna, integra la
// potencia a energía y reparte los kWh en los periodos de la tarifa 2.0TD.

export const ROLES = [
  { clave: "tiempo", etiqueta: "Fecha y hora", patron: /fecha|hora|time|date/ },
  { clave: "produccion", etiqueta: "Producción solar", patron: /produc|solar|\bpv\b|generac|generat/ },
  { clave: "consumo", etiqueta: "Consumo de la casa", patron: /consumption|consumo|load|vivienda/ },
  { clave: "importada", etiqueta: "Comprada a la red", patron: /purchas|import|compra|buy|bought|adquisitiv/ },
  { clave: "exportada", etiqueta: "Vertida a la red", patron: /feed.?in|export|vertid|excedent|sell|sold|alimentaci/ },
  { clave: "red", etiqueta: "Red (con signo)", patron: /grid|\bred\b/ },
  // \bcarga\b no pica en "descarga": no hay frontera de palabra dentro de "descarga".
  { clave: "carga", etiqueta: "Carga de batería", patron: /charg(e|ing)_?power|\bcarga\b|carga.*bater|battery.*charg/ },
  { clave: "descarga", etiqueta: "Descarga de batería", patron: /dischar|descarga/ },
  { clave: "bateria", etiqueta: "Batería (con signo)", patron: /batter|bater/ },
  { clave: "soc", etiqueta: "Nivel de batería (%)", patron: /\bsoc\b|state.?of.?charge|nivel/ },
];

const ROLES_ENERGIA = new Set([
  "produccion", "consumo", "importada", "exportada", "red", "carga", "descarga", "bateria",
]);

// Columnas que son magnitudes, no valores con signo: hay dataloggers que las
// escriben en negativo solo para marcar el sentido (vertido, carga).
const MAGNITUDES = new Set(["importada", "exportada", "carga", "descarga"]);

export function unidadDeCabecera(cabecera) {
  const texto = String(cabecera).toLowerCase();
  if (/k\s*w\s*h/.test(texto)) return "kWh";
  if (/\bk\s*w\b/.test(texto)) return "kW";
  if (/%/.test(texto)) return "%";
  return "W";
}

/** Propone un rol para cada columna a partir de su cabecera. */
export function detectarRoles(cabeceras) {
  const asignado = new Map();
  const propuesta = cabeceras.map(() => null);
  for (const rol of ROLES) {
    if (asignado.has(rol.clave)) continue;
    const indice = cabeceras.findIndex(
      (c, i) => propuesta[i] === null && rol.patron.test(String(c ?? "").toLowerCase())
    );
    if (indice >= 0) {
      propuesta[indice] = rol.clave;
      asignado.set(rol.clave, indice);
    }
  }
  return propuesta;
}

function aFecha(valor) {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === "number") return null;
  const texto = String(valor ?? "").trim();
  if (!texto) return null;
  // Formatos habituales: "2026-06-01 00:05:00" y "01/06/2026 00:05".
  const iso = texto.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (iso) {
    const [, a, m, d, h, mi, s] = iso;
    return new Date(+a, +m - 1, +d, +h, +mi, +(s || 0));
  }
  const euro = texto.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (euro) {
    const [, d, m, a, h, mi, s] = euro;
    return new Date(+a, +m - 1, +d, +(h || 0), +(mi || 0), +(s || 0));
  }
  const suelto = new Date(texto);
  return Number.isNaN(suelto.getTime()) ? null : suelto;
}

function aNumero(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  const texto = String(valor ?? "").trim();
  if (!texto || texto === "-" || /^n\/?a$/i.test(texto)) return 0;
  // Se acepta tanto "1.234,5" como "1,234.5".
  const normal = texto.includes(",") && texto.lastIndexOf(",") > texto.lastIndexOf(".")
    ? texto.replace(/\./g, "").replace(",", ".")
    : texto.replace(/,/g, "");
  const numero = parseFloat(normal.replace(/[^\d.eE+-]/g, ""));
  return Number.isFinite(numero) ? numero : 0;
}

function mediana(valores) {
  if (!valores.length) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.floor(orden.length / 2)];
}

/**
 * Convierte la matriz cruda en registros ordenados con potencias en W
 * y la duración real de cada intervalo.
 */
export function construirSerie(filas, roles, unidades, { invertirRed = false, invertirBateria = false } = {}) {
  const columnaDe = {};
  roles.forEach((rol, i) => {
    if (rol && !(rol in columnaDe)) columnaDe[rol] = i;
  });
  if (columnaDe.tiempo === undefined) throw new Error("Falta la columna de fecha y hora.");

  const unidadesRol = {};
  for (const [rol, columna] of Object.entries(columnaDe)) {
    if (rol !== "tiempo") unidadesRol[rol] = unidades[columna] === "kWh" ? "kWh" : "W";
  }

  const registros = [];
  for (const fila of filas) {
    const instante = aFecha(fila[columnaDe.tiempo]);
    if (!instante) continue;
    const punto = { instante };
    for (const [rol, columna] of Object.entries(columnaDe)) {
      if (rol === "tiempo") continue;
      let valor = aNumero(fila[columna]);
      const unidad = unidades[columna];
      if (unidad === "kW") valor *= 1000;
      if (MAGNITUDES.has(rol)) valor = Math.abs(valor);
      punto[rol] = valor;
    }
    if (invertirRed) {
      if ("red" in punto) punto.red = -punto.red;
      if ("importada" in punto && "exportada" in punto) {
        [punto.importada, punto.exportada] = [punto.exportada, punto.importada];
      }
    }
    if (invertirBateria && "bateria" in punto) punto.bateria = -punto.bateria;
    registros.push(punto);
  }
  registros.sort((a, b) => a.instante - b.instante);

  const saltos = [];
  for (let i = 1; i < registros.length; i++) saltos.push(registros[i].instante - registros[i - 1].instante);
  const paso = mediana(saltos) || 5 * 60000;

  registros.forEach((punto, i) => {
    const bruto = i + 1 < registros.length ? registros[i + 1].instante - registros[i].instante : paso;
    // Un hueco de datos no debe contarse como energía: se limita al paso normal.
    punto.horas = Math.min(bruto, paso * 1.5) / 3600000;
  });

  for (const [derivado, origen] of [["importada", "red"], ["exportada", "red"], ["carga", "bateria"], ["descarga", "bateria"]]) {
    if (unidadesRol[derivado] === undefined && unidadesRol[origen] !== undefined) unidadesRol[derivado] = unidadesRol[origen];
  }
  unidadesRol.consumo ??= unidadesRol.produccion || "W";
  unidadesRol.autoconsumo = unidadesRol.consumo;

  // Con la red firmada se deduce qué se compró y qué se vertió.
  for (const punto of registros) {
    if (punto.importada === undefined && punto.red !== undefined) punto.importada = Math.max(punto.red, 0);
    if (punto.exportada === undefined && punto.red !== undefined) punto.exportada = Math.max(-punto.red, 0);
    if (punto.carga === undefined && punto.bateria !== undefined) punto.carga = Math.max(punto.bateria, 0);
    if (punto.descarga === undefined && punto.bateria !== undefined) punto.descarga = Math.max(-punto.bateria, 0);
    if (punto.consumo === undefined) {
      punto.consumo = (punto.produccion || 0) + (punto.importada || 0) - (punto.exportada || 0)
        - (punto.carga || 0) + (punto.descarga || 0);
    }
    punto.autoconsumo = Math.max((punto.consumo || 0) - (punto.importada || 0), 0);
    // Lo que va del sol directamente a la casa, sin pasar por la red ni la batería.
    punto.solarDirecta = Math.max((punto.produccion || 0) - (punto.exportada || 0) - (punto.carga || 0), 0);
  }

  return { registros, unidadesRol, pasoMinutos: Math.round(paso / 60000) };
}

// Para guardar la serie en el navegador se pasa a columnas: un objeto por
// registro multiplica por tres el tamano y no cabria el mes entero.
export function serializarSerie({ registros, unidadesRol, pasoMinutos }) {
  const campos = [...new Set(registros.flatMap(Object.keys))].filter((c) => c !== "instante" && c !== "horas");
  return {
    unidadesRol,
    pasoMinutos,
    campos,
    // Las horas llevan seis decimales porque multiplican a toda la energia.
    valores: registros.map((p) => [
      p.instante.getTime(),
      +p.horas.toFixed(6),
      ...campos.map((c) => (typeof p[c] === "number" ? +p[c].toFixed(3) : null)),
    ]),
  };
}

export function deserializarSerie(guardado) {
  if (!Array.isArray(guardado?.valores) || !guardado.valores.length) return null;
  const { campos, unidadesRol, pasoMinutos } = guardado;
  const registros = guardado.valores.map((fila) => {
    const punto = { instante: new Date(fila[0]), horas: fila[1] };
    campos.forEach((campo, i) => {
      if (fila[i + 2] !== null) punto[campo] = fila[i + 2];
    });
    return punto;
  });
  return { registros, unidadesRol, pasoMinutos };
}

export function energiaKwh(registros, rol, unidad) {
  if (unidad === "kWh") return registros.reduce((suma, p) => suma + (p[rol] || 0), 0);
  return registros.reduce((suma, p) => suma + (p[rol] || 0) * p.horas, 0) / 1000;
}

export function claveDia(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

/** Periodo tarifario 2.0TD: fines de semana y festivos son valle todo el día. */
export function periodoTarifa(fecha, festivos = new Set()) {
  const diaSemana = fecha.getDay();
  if (diaSemana === 0 || diaSemana === 6 || festivos.has(claveDia(fecha))) return "P3";
  const hora = fecha.getHours();
  if (hora < 8) return "P3";
  if ((hora >= 10 && hora < 14) || (hora >= 18 && hora < 22)) return "P1";
  return "P2";
}

export function repartoPorPeriodo(registros, rol, unidad, festivos) {
  const total = { P1: 0, P2: 0, P3: 0 };
  for (const punto of registros) {
    const kwh = unidad === "kWh" ? punto[rol] || 0 : ((punto[rol] || 0) * punto.horas) / 1000;
    total[periodoTarifa(punto.instante, festivos)] += kwh;
  }
  return total;
}

export function resumenPorDia(registros, unidadesRol) {
  const dias = new Map();
  for (const punto of registros) {
    const clave = claveDia(punto.instante);
    if (!dias.has(clave)) {
      dias.set(clave, { clave, fecha: new Date(punto.instante), produccion: 0, consumo: 0, importada: 0, exportada: 0, autoconsumo: 0 });
    }
    const dia = dias.get(clave);
    for (const rol of ["produccion", "consumo", "importada", "exportada", "autoconsumo"]) {
      const unidad = unidadesRol[rol];
      dia[rol] += unidad === "kWh" ? punto[rol] || 0 : ((punto[rol] || 0) * punto.horas) / 1000;
    }
  }
  return [...dias.values()].sort((a, b) => a.fecha - b.fecha);
}
