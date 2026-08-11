// Guarda mes a mes el cotejo entre datalogger y factura, en el propio navegador.
// Solo se guarda el resumen: ni el .xlsx ni el PDF salen de aquí ni se almacenan.

const CLAVE = "solar-monitor-historico";
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export const nombreMes = (mes) => {
  const [anio, numero] = mes.split("-");
  return `${MESES[Number(numero) - 1]} ${anio}`;
};

export function leerHistorico() {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE) || "[]");
    return Array.isArray(crudo) ? crudo.sort((a, b) => a.mes.localeCompare(b.mes)) : [];
  } catch {
    return [];
  }
}

function escribir(meses) {
  localStorage.setItem(CLAVE, JSON.stringify(meses.sort((a, b) => a.mes.localeCompare(b.mes))));
}

export function guardarMes(registro) {
  const meses = leerHistorico().filter((m) => m.mes !== registro.mes);
  meses.push(registro);
  escribir(meses);
  return meses;
}

export function borrarMes(mes) {
  const meses = leerHistorico().filter((m) => m.mes !== mes);
  escribir(meses);
  return meses;
}

export function importarHistorico(texto) {
  const entrantes = JSON.parse(texto);
  if (!Array.isArray(entrantes)) throw new Error("El fichero no tiene el formato esperado.");
  const porMes = new Map(leerHistorico().map((m) => [m.mes, m]));
  for (const registro of entrantes) {
    if (registro?.mes) porMes.set(registro.mes, registro);
  }
  const meses = [...porMes.values()];
  escribir(meses);
  return meses;
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

const mediana = (valores) => {
  const orden = [...valores].sort((a, b) => a - b);
  if (!orden.length) return null;
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
};

const proporcion = (facturado, medido) =>
  Number.isFinite(facturado) && medido > 0.5 ? facturado / medido : null;

const coma = (valor, decimales) => valor.toFixed(decimales).replace(".", ",");

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
  }));

  const avisos = [];

  for (let i = 1; i < filas.length; i++) {
    const previo = filas[i - 1];
    const actual = filas[i];
    for (const periodo of ["P1", "P2", "P3"]) {
      const final = previo.factura?.lecturas?.[periodo]?.final;
      const inicial = actual.factura?.lecturas?.[periodo]?.inicial;
      if (!Number.isFinite(final) || !Number.isFinite(inicial)) continue;
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
      const centro = mediana(conDato.filter((o) => o !== fila).map((o) => o[campo]));
      if (!centro) continue;
      const valor = fila[campo];
      if (valor > centro * 1.5 && valor > 1.3) {
        avisos.push([
          "mal",
          `En ${nombreMes(fila.mes)} te facturaron ${coma(valor, 1)} veces ${etiqueta} que midió tu instalación, ` +
            `cuando el resto de meses la proporción ronda ${coma(centro, 2)}. Ese mes se sale del patrón.`,
        ]);
      }
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
