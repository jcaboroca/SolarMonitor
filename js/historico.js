// Guarda mes a mes el cotejo entre datalogger y factura, en el propio navegador.
// Solo se guarda el resumen: ni el .xlsx ni el PDF salen de aquí ni se almacenan.
import { normalizarInstantes, resumirContador } from "./datos.js";
import { periodoFactura } from "./factura.js";

const CLAVE = "solar-monitor-historico";
const CLAVE_CURVAS = "solar-monitor-curvas";
const CLAVE_SERIE = "solar-monitor-serie";
const CLAVE_REVISIONES = "solar-monitor-revisiones-curvas";
const CLAVE_BORRADOS = "solar-monitor-meses-borrados";
const borradosActuales = () => JSON.parse(localStorage.getItem(CLAVE_BORRADOS) || "{}");
const tiempo = (fecha) => fecha ? new Date(fecha).getTime() : 0;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export const nombreMes = (mes) => {
  const [anio, numero] = mes.split("-");
  return `${MESES[Number(numero) - 1]} ${anio}`;
};

export function leerHistorico() {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE) || "[]");
    if (!Array.isArray(crudo)) return [];
    const curvas = leerCurvas();
    return crudo.map((m) => curvas.has(m.mes)
      ? { ...m, contador: resumirContador(curvas.get(m.mes), new Set(m.festivos || [])) }
      : m).sort((a, b) => a.mes.localeCompare(b.mes));
  } catch {
    return [];
  }
}

function escribir(meses) {
  localStorage.setItem(CLAVE, JSON.stringify(meses.sort((a, b) => a.mes.localeCompare(b.mes))));
}

export function guardarMes(registro) {
  registro = {
    ...registro,
    guardado: registro.guardado || new Date(Math.max(Date.now(), tiempo(borradosActuales()[registro.mes]) + 1)).toISOString(),
  };
  const meses = leerHistorico().filter((m) => m.mes !== registro.mes);
  meses.push(registro);
  escribir(meses);
  return meses;
}

export function borrarMes(mes) {
  const meses = leerHistorico().filter((m) => m.mes !== mes);
  escribir(meses);
  localStorage.setItem(CLAVE_BORRADOS, JSON.stringify({ ...borradosActuales(), [mes]: new Date().toISOString() }));
  borrarDetalleMes(mes);
  return meses;
}

function borrarDetalleMes(mes) {
  const curvas = curvasCrudas();
  delete curvas[mes];
  localStorage.setItem(CLAVE_CURVAS, JSON.stringify(curvas));
  const revisiones = revisionesCurvas();
  delete revisiones[mes];
  localStorage.setItem(CLAVE_REVISIONES, JSON.stringify(revisiones));
  if (leerSerie()?.mes === mes) localStorage.removeItem(CLAVE_SERIE);
}

const curvasCrudas = () => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_CURVAS) || "{}");
  } catch {
    return {};
  }
};
const revisionesCurvas = () => JSON.parse(localStorage.getItem(CLAVE_REVISIONES) || "{}");
const registrosCurva = (puntos, revision = null) => normalizarInstantes(puntos.map(([hora, consumo, vertido, real, actualizada]) => ({
  instante: new Date(hora * 3600000), consumo, vertido, real: Boolean(real), revision: actualizada ?? revision,
})));

// La quinta columna opcional conserva la revisión de cada hora, no la de todo el mes.
export function leerCurvas() {
  const curvas = new Map();
  for (const [mes, puntos] of Object.entries(curvasCrudas())) {
    if (!Array.isArray(puntos)) continue;
    curvas.set(
      mes,
      registrosCurva(puntos)
    );
  }
  return curvas;
}

export function guardarCurva(mes, curva) {
  const puntos = normalizarInstantes(curva).map((p) => [Math.round(p.instante.getTime() / 3600000), +p.consumo.toFixed(3), +p.vertido.toFixed(3), p.real ? 1 : 0]);
  fusionarCurvas({ [mes]: puntos }, { [mes]: new Date().toISOString() });
}

// Del detalle cada pocos minutos solo se guarda UN mes: son ~400 kB y el
// navegador corta sobre los 5 MB. Cada fichero nuevo releva al anterior.
export function leerSerie() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_SERIE) || "null");
    return guardado?.mes && guardado.serie ? guardado : null;
  } catch {
    return null;
  }
}

export function guardarSerie(mes, serie, guardado = new Date().toISOString()) {
  try {
    localStorage.setItem(CLAVE_SERIE, JSON.stringify({ mes, serie, guardado }));
  } catch (error) {
    throw new Error("No se ha podido guardar el detalle del mes en este navegador. Se conserva la serie anterior; exporta una copia para liberar espacio.", { cause: error });
  }
}

export const paqueteActual = () => ({
  version: 4,
  exportado: new Date().toISOString(),
  meses: leerHistorico(),
  curvas: curvasCrudas(),
  revisionesCurvas: revisionesCurvas(),
  borrados: borradosActuales(),
  serie: leerSerie(),
});

export const exportarTodo = () => JSON.stringify(paqueteActual(), null, 2);

const tieneDatos = (valor) => {
  if (valor == null) return false;
  if (Array.isArray(valor)) return valor.length > 0;
  if (typeof valor === "object") return Object.values(valor).some((v) => v != null);
  return true;
};

// Al fusionar, un hueco nunca pisa un dato: si la copia trae el mes sin factura, la que ya habia se queda.
function fusionarMes(previo, entrante) {
  if (!previo) return entrante;
  if (tiempo(entrante.guardado) < tiempo(previo.guardado)) [previo, entrante] = [entrante, previo];
  const fusion = { ...previo };
  for (const [campo, valor] of Object.entries(entrante)) {
    if (tieneDatos(valor) || !tieneDatos(previo[campo])) fusion[campo] = valor;
  }
  if (entrante.facturaPendiente) fusion.factura = entrante.factura ?? {};
  else if (Number.isFinite(entrante.factura?.total)) delete fusion.facturaPendiente;
  return fusion;
}

function fusionarCurvas(entrantes, revisionesEntrantes = {}, exportado = null) {
  const curvas = curvasCrudas();
  const revisiones = revisionesCurvas();
  let sumadas = 0;
  for (const [mes, puntos] of Object.entries(entrantes)) {
    if (!Array.isArray(puntos) || !puntos.length) continue;
    const revision = revisionesEntrantes[mes] || exportado || new Date().toISOString();
    const reciente = !revisiones[mes] || new Date(revision) >= new Date(revisiones[mes]);
    const porHora = new Map(registrosCurva(curvas[mes] || [], revisiones[mes]).map((p) => [+p.instante, p]));
    for (const p of registrosCurva(puntos, revision)) {
      const previa = porHora.get(+p.instante);
      if (!previa || tiempo(p.revision) >= tiempo(previa.revision)) porHora.set(+p.instante, p);
    }
    curvas[mes] = [...porHora.values()].sort((a, b) => a.instante - b.instante)
      .map((p) => [+p.instante / 3600000, p.consumo, p.vertido, p.real ? 1 : 0, tiempo(p.revision)]);
    if (reciente) revisiones[mes] = revision;
    sumadas++;
  }
  try {
    localStorage.setItem(CLAVE_CURVAS, JSON.stringify(curvas));
    localStorage.setItem(CLAVE_REVISIONES, JSON.stringify(revisiones));
  } catch {
    throw new Error("Los meses se han restaurado, pero las curvas horarias no caben en este navegador.");
  }
  return sumadas;
}

export const importarHistorico = (texto) => fusionarPaquete(JSON.parse(texto));

export function fusionarPaquete(crudo) {
  const entrantes = Array.isArray(crudo) ? crudo : crudo?.meses;
  if (!Array.isArray(entrantes)) throw new Error("El fichero no tiene el formato esperado.");
  const porMes = new Map(leerHistorico().map((m) => [m.mes, m]));
  const borrados = borradosActuales();
  for (const [mes, fecha] of Object.entries(crudo?.borrados || {})) {
    if (tiempo(fecha) > tiempo(borrados[mes])) borrados[mes] = fecha;
  }
  const resumen = { nuevos: 0, fusionados: 0, curvas: 0 };
  for (const registro of entrantes) {
    if (!registro?.mes) continue;
    const previo = porMes.get(registro.mes);
    previo ? resumen.fusionados++ : resumen.nuevos++;
    porMes.set(registro.mes, fusionarMes(previo, registro));
  }
  const eliminados = new Set();
  for (const [mes, fecha] of Object.entries(borrados)) {
    if (tiempo(porMes.get(mes)?.guardado) <= tiempo(fecha)) {
      porMes.delete(mes);
      eliminados.add(mes);
      borrarDetalleMes(mes);
    }
  }
  localStorage.setItem(CLAVE_BORRADOS, JSON.stringify(borrados));
  escribir([...porMes.values()]);
  if (crudo?.curvas) resumen.curvas = fusionarCurvas(
    Object.fromEntries(Object.entries(crudo.curvas).filter(([mes]) => !eliminados.has(mes))),
    crudo.revisionesCurvas, crudo.exportado
  );
  // Solo hay sitio para una serie: se queda la del mes mas reciente.
  const previa = leerSerie();
  if (crudo?.serie?.mes && !eliminados.has(crudo.serie.mes) && (
    crudo.serie.mes > (previa?.mes ?? "") ||
    (crudo.serie.mes === previa?.mes && tiempo(crudo.serie.guardado) >= tiempo(previa.guardado))
  )) {
    guardarSerie(crudo.serie.mes, crudo.serie.serie, crudo.serie.guardado || crudo.exportado);
    resumen.serie = crudo.serie.mes;
  }
  return resumen;
}

// El mes al que pertenece un tramo: aquel en el que caen más días.
export function mesDominante(fechas) {
  const cuenta = new Map();
  for (const fecha of fechas) {
    const clave = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
    cuenta.set(clave, (cuenta.get(clave) || 0) + 1);
  }
  let mejor = null;
  for (const [clave, veces] of cuenta) {
    if (!mejor || veces > mejor[1]) mejor = [clave, veces];
  }
  return mejor?.[0] ?? null;
}

export function mesDeFactura(factura) {
  if (!factura?.desde || !factura?.hasta) return null;
  const desde = new Date(factura.desde), hasta = new Date(factura.hasta);
  if (!Number.isFinite(desde.getTime()) || !Number.isFinite(hasta.getTime()) || hasta < desde) return null;
  const dias = [];
  // Octopus excluye la fecha final; los otros formatos incluyen ambos extremos.
  for (const dia = new Date(desde); factura.comercializadora === "Octopus" ? dia < hasta : dia <= hasta; dia.setDate(dia.getDate() + 1)) {
    dias.push(new Date(dia));
  }
  return mesDominante(dias);
}

const mediana = (valores) => {
  const orden = [...valores].sort((a, b) => a - b);
  if (!orden.length) return null;
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
};

const proporcion = (facturado, medido) =>
  Number.isFinite(facturado) && medido > 0.5 ? facturado / medido : null;

const diferencia = (facturado, medido) =>
  Number.isFinite(facturado) && Number.isFinite(medido) ? facturado - medido : null;

const coma = (valor, decimales) => valor.toFixed(decimales).replace(".", ",");

// Dos medidas de lo mismo: se aceptan como iguales si difieren poco.
const casan = (a, b) =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(2, 0.1 * Math.max(Math.abs(a), Math.abs(b)));

/**
 * Devuelve una fila por mes con las proporciones factura/datalogger y una lista
 * de avisos: saltos en las lecturas del contador, meses que se desvían del
 * patrón de los demás y cambios en la tarifa de compensación.
 */
export function analizarHistorico(meses) {
  const filas = meses.map((m) => ({
    ...m,
    razonCompra: proporcion(m.factura?.total, m.medido?.total),
    razonVertido: proporcion(m.factura?.excedentes, m.medido?.excedentes),
    sobraCompra: diferencia(m.factura?.total, m.medido?.total),
    sobraVertido: diferencia(m.factura?.excedentes, m.medido?.excedentes),
  }));

  const avisos = [];

  for (let i = 1; i < filas.length; i++) {
    const previo = filas[i - 1];
    const actual = filas[i];
    if (+periodoFactura(previo.factura)?.hasta !== +periodoFactura(actual.factura)?.desde) continue;
    for (const periodo of ["P1", "P2", "P3"]) {
      const final = previo.factura?.lecturas?.[periodo]?.final;
      const inicial = actual.factura?.lecturas?.[periodo]?.inicial;
      if (!Number.isFinite(final) || !Number.isFinite(inicial) || !previo.factura?.desde || !actual.factura?.desde) continue;
      const salto = inicial - final;
      if (Math.abs(salto) > 1) {
        avisos.push([
          "mal",
          `Las lecturas del contador no encadenan en ${periodo}: ${nombreMes(previo.mes)} acabó en ${final} kWh y ` +
            `${nombreMes(actual.mes)} empieza en ${inicial} kWh (${salto > 0 ? "+" : ""}${salto} kWh sin justificar).`,
        ]);
      }
    }
  }

  // Cada mes se juzga contra los demás: el raro es el que se sale del grupo.
  for (const [campo, etiqueta] of [["razonCompra", "lo comprado"], ["razonVertido", "lo vertido"]]) {
    const conDato = filas.filter((f) => Number.isFinite(f[campo]));
    if (conDato.length < 2) continue;
    for (const fila of conDato) {
      if (!fila.cobertura?.completa) continue;
      const centro = mediana(conDato.filter((o) => o !== fila).map((o) => o[campo]));
      if (!centro) continue;
      const valor = fila[campo];
      if (valor > centro * 1.5 && valor > 1.3) {
        avisos.push([
          "regular",
          `En ${nombreMes(fila.mes)} te facturaron ${coma(valor, 1)} veces ${etiqueta} que midió tu instalación, ` +
            `cuando el resto de meses la proporción ronda ${coma(centro, 2)}. Ese mes se sale del patrón.`,
        ]);
      }
    }
  }

  // El solape es descriptivo: no demuestra un defecto de medida.
  for (const fila of filas) {
    const { sobraCompra, sobraVertido } = fila;
    if (!Number.isFinite(sobraCompra) || !Number.isFinite(sobraVertido)) continue;
    if (sobraCompra < 20 || sobraVertido < 20) continue;
    const mayor = Math.max(sobraCompra, sobraVertido);
    if (Math.min(sobraCompra, sobraVertido) / mayor < 0.6) continue;
    avisos.push([
      "regular",
      `En ${nombreMes(fila.mes)} hay diferencias de ${coma(sobraCompra, 0)} kWh comprados y ${coma(sobraVertido, 0)} vertidos: ` +
        "cantidades parecidas en las dos direcciones. Comprueba cobertura, intervalos y revisiones de la curva. " +
        "Este patrón no demuestra por sí solo un fallo del contador.",
    ]);
  }

  // Solo son comparables los totales del mismo mes completo.
  for (const fila of filas) {
    const instalacion = fila.medido?.total;
    const contador = fila.contador?.total;
    const factura = fila.factura?.total;
    if (![instalacion, contador, factura].every(Number.isFinite)) continue;
    const periodo = periodoFactura(fila.factura);
    const [anio, mes] = fila.mes.split("-").map(Number);
    if (!periodo || +periodo.desde !== +new Date(anio, mes - 1, 1) || +periodo.hasta !== +new Date(anio, mes, 1)
      || !fila.contador.cobertura?.completa || fila.contador.estimadas) {
      avisos.push(["regular", `En ${nombreMes(fila.mes)} la comparación mensual está sin verificar: comprueba el periodo de la factura y la cobertura real de Datadis. Solarman no basta para validarla.`]);
      continue;
    }
    const coincideFactura = Math.abs(contador - factura) <= (Number.isInteger(factura) ? 1 : 0.011);
    if (coincideFactura && !casan(contador, instalacion)) {
      avisos.push([
        "regular",
        `En ${nombreMes(fila.mes)} el contador registra ${coma(contador, 0)} kWh y te facturan ${coma(factura, 0)}: cuadran entre sí, ` +
          `pero tu instalación solo midió ${coma(instalacion, 0)}. La comercializadora factura lo que le pasa el contador, ` +
          "pero la diferencia con Solarman no demuestra un fallo del contador: hay que comprobar la cobertura " +
          "y las pérdidas de medida antes de sacar conclusiones.",
      ]);
    } else if (casan(contador, instalacion) && !coincideFactura) {
      avisos.push([
        "regular",
        `En ${nombreMes(fila.mes)} el contador registra ${coma(contador, 0)} kWh y tu instalación ${coma(instalacion, 0)}: coinciden. ` +
          `Pero la factura indica ${coma(factura, 0)}. Comprueba que las tres fuentes cubren el mismo periodo completo y que no hay revisiones pendientes.`,
      ]);
    }
  }

  const tarifas = filas.map((f) => f.factura?.precioExcedentes).filter(Number.isFinite);
  if (new Set(tarifas.map((t) => t.toFixed(6))).size > 1) {
    const conTarifa = filas.filter((f) => Number.isFinite(f.factura?.precioExcedentes));
    avisos.push([
      "regular",
      "La tarifa de compensación de excedentes cambia de un mes a otro: " +
        conTarifa.map((f) => `${nombreMes(f.mes)} ${coma(f.factura.precioExcedentes * 100, 4)} c€/kWh`).join(", ") +
        ". Pide que te expliquen cómo se calcula.",
    ]);
  }

  return { filas, avisos };
}
