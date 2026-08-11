// Lector mínimo de .xlsx sin dependencias: un xlsx es un ZIP con XML dentro,
// así que descomprimimos con DecompressionStream y escaneamos la hoja a mano.

const FIRMA_FINAL = 0x06054b50;
const FIRMA_CENTRAL = 0x02014b50;

function buscarFinalCentral(vista) {
  // El bloque final va al final del fichero, pero puede llevar comentario detrás.
  const minimo = Math.max(0, vista.byteLength - 66000);
  for (let i = vista.byteLength - 22; i >= minimo; i--) {
    if (vista.getUint32(i, true) === FIRMA_FINAL) return i;
  }
  return -1;
}

async function inflar(bytes, metodo) {
  if (metodo === 0) return bytes;
  if (metodo !== 8) throw new Error(`Compresión ZIP no soportada (método ${metodo}).`);
  const flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

// Devuelve un mapa { ruta: Uint8Array } con las entradas del ZIP.
async function abrirZip(buffer) {
  const vista = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const fin = buscarFinalCentral(vista);
  if (fin < 0) throw new Error("El fichero no parece un .xlsx válido.");

  const total = vista.getUint16(fin + 10, true);
  let puntero = vista.getUint32(fin + 16, true);
  const entradas = {};

  for (let n = 0; n < total; n++) {
    if (vista.getUint32(puntero, true) !== FIRMA_CENTRAL) break;
    const metodo = vista.getUint16(puntero + 10, true);
    const comprimido = vista.getUint32(puntero + 20, true);
    const largoNombre = vista.getUint16(puntero + 28, true);
    const largoExtra = vista.getUint16(puntero + 30, true);
    const largoComentario = vista.getUint16(puntero + 32, true);
    const inicioLocal = vista.getUint32(puntero + 42, true);
    const nombre = new TextDecoder().decode(bytes.subarray(puntero + 46, puntero + 46 + largoNombre));

    const nombreLocal = vista.getUint16(inicioLocal + 26, true);
    const extraLocal = vista.getUint16(inicioLocal + 28, true);
    const datos = inicioLocal + 30 + nombreLocal + extraLocal;
    entradas[nombre] = { metodo, bytes: bytes.subarray(datos, datos + comprimido) };

    puntero += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

async function texto(entradas, ruta) {
  const entrada = entradas[ruta];
  if (!entrada) return null;
  return new TextDecoder().decode(await inflar(entrada.bytes, entrada.metodo));
}

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function desescapar(cadena) {
  return cadena.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (todo, cuerpo) => {
    if (cuerpo[0] === "#") {
      const codigo = cuerpo[1] === "x" ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : todo;
    }
    return ENTIDADES[cuerpo.toLowerCase()] ?? todo;
  });
}

function textosCompartidos(xml) {
  if (!xml) return [];
  const lista = [];
  for (const grupo of xml.match(/<si\b[\s\S]*?<\/si>|<si\b[^>]*\/>/g) || []) {
    let acumulado = "";
    for (const trozo of grupo.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []) {
      acumulado += desescapar(trozo.replace(/<t\b[^>]*>|<\/t>/g, ""));
    }
    lista.push(acumulado);
  }
  return lista;
}

// Qué estilos representan fechas: hace falta para saber si un número es un instante.
function estilosDeFecha(xml) {
  if (!xml) return new Set();
  const personalizados = new Map();
  for (const formato of xml.match(/<numFmt\b[^>]*\/>/g) || []) {
    const id = Number(formato.match(/numFmtId="(\d+)"/)?.[1]);
    const codigo = formato.match(/formatCode="([^"]*)"/)?.[1] || "";
    personalizados.set(id, desescapar(codigo));
  }
  const bloque = xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] || "";
  const conFecha = new Set();
  let indice = 0;
  for (const xf of bloque.match(/<xf\b[^>]*\/>|<xf\b[\s\S]*?<\/xf>/g) || []) {
    const id = Number(xf.match(/numFmtId="(\d+)"/)?.[1] ?? 0);
    const incorporado = (id >= 14 && id <= 22) || (id >= 45 && id <= 47);
    const codigo = personalizados.get(id) || "";
    // Se descartan los literales entre comillas antes de buscar marcas de fecha.
    const limpio = codigo.replace(/"[^"]*"|\[[^\]]*\]/g, "");
    if (incorporado || /[ymdhs]/i.test(limpio)) conFecha.add(indice);
    indice++;
  }
  return conFecha;
}

const BASE_EXCEL = Date.UTC(1899, 11, 30);
export function fechaDesdeSerie(serie) {
  const instante = new Date(BASE_EXCEL + Math.round(serie * 86400000));
  // Los registros del datalogger vienen en hora local, así que se lee sin zona.
  return new Date(
    instante.getUTCFullYear(),
    instante.getUTCMonth(),
    instante.getUTCDate(),
    instante.getUTCHours(),
    instante.getUTCMinutes(),
    instante.getUTCSeconds()
  );
}

function indiceColumna(referencia) {
  const letras = referencia.match(/^[A-Z]+/)?.[0];
  if (!letras) return -1;
  let n = 0;
  for (const letra of letras) n = n * 26 + (letra.charCodeAt(0) - 64);
  return n - 1;
}

function rutaPrimeraHoja(entradas) {
  const hojas = Object.keys(entradas)
    .filter((r) => /^xl\/worksheets\/sheet\d+\.xml$/.test(r))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!hojas.length) throw new Error("El xlsx no contiene ninguna hoja.");
  return hojas[0];
}

/**
 * Lee la primera hoja y devuelve una matriz de valores (string, number o Date).
 */
export async function leerXlsx(buffer) {
  const entradas = await abrirZip(buffer);
  const compartidos = textosCompartidos(await texto(entradas, "xl/sharedStrings.xml"));
  const fechas = estilosDeFecha(await texto(entradas, "xl/styles.xml"));
  const hoja = await texto(entradas, rutaPrimeraHoja(entradas));

  const filas = [];
  const patronFila = /<row\b([^>]*)\/>|<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  const patronCelda = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;

  let coincidencia;
  while ((coincidencia = patronFila.exec(hoja)) !== null) {
    const contenido = coincidencia[3];
    if (!contenido) {
      filas.push([]);
      continue;
    }
    const fila = [];
    let celda;
    patronCelda.lastIndex = 0;
    while ((celda = patronCelda.exec(contenido)) !== null) {
      const atributos = celda[1] ?? celda[2] ?? "";
      const cuerpo = celda[3] ?? "";
      const referencia = atributos.match(/r="([A-Z]+\d+)"/)?.[1];
      const columna = referencia ? indiceColumna(referencia) : fila.length;
      const tipo = atributos.match(/t="([^"]+)"/)?.[1] || "n";
      const estilo = Number(atributos.match(/s="(\d+)"/)?.[1] ?? -1);

      let valor = null;
      if (tipo === "inlineStr") {
        valor = (cuerpo.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [])
          .map((t) => desescapar(t.replace(/<t\b[^>]*>|<\/t>/g, "")))
          .join("");
      } else {
        const bruto = cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (bruto == null) valor = null;
        else if (tipo === "s") valor = compartidos[Number(bruto)] ?? "";
        else if (tipo === "str" || tipo === "e") valor = desescapar(bruto);
        else if (tipo === "b") valor = bruto === "1";
        else if (tipo === "d") valor = new Date(bruto);
        else {
          const numero = Number(bruto);
          valor = fechas.has(estilo) && Number.isFinite(numero) ? fechaDesdeSerie(numero) : numero;
        }
      }
      if (columna >= 0) fila[columna] = valor;
    }
    filas.push(fila);
  }
  return filas;
}
