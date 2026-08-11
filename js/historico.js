// Guarda mes a mes el cotejo entre datalogger y factura, en el propio navegador.
// Solo se guarda el resumen: ni el .xlsx ni el PDF salen de aquí ni se almacenan.

const CLAVE = "solar-monitor-historico";
const CLAVE_CURVAS = "solar-monitor-curvas";
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
  const curvas = curvasCrudas();
  delete curvas[mes];
  localStorage.setItem(CLAVE_CURVAS, JSON.stringify(curvas));
  return meses;
}

const curvasCrudas = () => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_CURVAS) || "{}");
  } catch {
    return {};
  }
};

// Cada hora se guarda como [horas desde 1970, comprado, vertido, real] para que quepa.
export function leerCurvas() {
  const curvas = new Map();
  for (const [mes, puntos] of Object.entries(curvasCrudas())) {
    if (!Array.isArray(puntos)) continue;
    curvas.set(
      mes,
      puntos.map(([hora, consumo, vertido, real]) => ({
        instante: new Date(hora * 3600000),
        consumo,
        vertido,
        real: Boolean(real),
      }))
    );
  }
  return curvas;
}

export function guardarCurva(mes, curva) {
  const curvas = curvasCrudas();
  curvas[mes] = curva.map((p) => [Math.round(p.instante.getTime() / 3600000), +p.consumo.toFixed(3), +p.vertido.toFixed(3), p.real ? 1 : 0]);
  try {
    localStorage.setItem(CLAVE_CURVAS, JSON.stringify(curvas));
  } catch {
    throw new Error("No cabe más histórico en este navegador. Borra algún mes antiguo.");
  }
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

  // Si el contador deja de netear, sobran los mismos kWh en las dos direcciones.
  for (const fila of filas) {
    const { sobraCompra, sobraVertido } = fila;
    if (!Number.isFinite(sobraCompra) || !Number.isFinite(sobraVertido)) continue;
    if (sobraCompra < 20 || sobraVertido < 20) continue;
    const mayor = Math.max(sobraCompra, sobraVertido);
    if (Math.min(sobraCompra, sobraVertido) / mayor < 0.6) continue;
    avisos.push([
      "mal",
      `En ${nombreMes(fila.mes)} sobran ${coma(sobraCompra, 0)} kWh comprados y ${coma(sobraVertido, 0)} vertidos: ` +
        "cantidades parecidas en las dos direcciones. Eso es lo que pasa cuando el contador deja de compensar " +
        "la energía que entra y sale a la vez y empieza a contar los dos flujos por separado.",
    ]);
  }

  // Con las tres medidas ya se puede decir de quién es el problema.
  for (const fila of filas) {
    const instalacion = fila.medido?.total;
    const contador = fila.contador?.total;
    const factura = fila.factura?.total;
    if (![instalacion, contador, factura].every(Number.isFinite)) continue;
    if (casan(contador, factura) && !casan(contador, instalacion)) {
      avisos.push([
        "mal",
        `En ${nombreMes(fila.mes)} el contador registra ${coma(contador, 0)} kWh y te facturan ${coma(factura, 0)}: cuadran entre sí, ` +
          `pero tu instalación solo midió ${coma(instalacion, 0)}. La comercializadora factura lo que le pasa el contador, ` +
          "así que el problema está en cómo mide o está configurado el contador. Hay que reclamar a la distribuidora.",
      ]);
    } else if (casan(contador, instalacion) && !casan(contador, factura)) {
      avisos.push([
        "mal",
        `En ${nombreMes(fila.mes)} el contador registra ${coma(contador, 0)} kWh y tu instalación ${coma(instalacion, 0)}: coinciden. ` +
          `Pero te facturan ${coma(factura, 0)}. Te están cobrando kWh que el contador nunca registró: el problema es de la comercializadora.`,
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
