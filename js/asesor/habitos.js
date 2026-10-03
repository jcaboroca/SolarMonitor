// Habitos de la casa a partir del historico: medianas por hora y tipo de dia.
// Sin ML: medianas y percentiles sobre una ventana movil.

const DIA_MS = 86400000;

export function percentil(valores, p) {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const posicion = (orden.length - 1) * p;
  const abajo = Math.floor(posicion);
  return orden[abajo] + (orden[Math.ceil(posicion)] - orden[abajo]) * (posicion - abajo);
}

const inicioDeHora = (instante) => {
  const hora = new Date(instante);
  hora.setMinutes(0, 0, 0);
  return hora;
};

/** Registros de datos.js (W por defecto, o kWh por intervalo) → energia por hora en kWh. */
export function aHoras(registros, unidades = {}) {
  const energia = (p, rol) => (unidades[rol] === "kWh" ? p[rol] || 0 : ((p[rol] || 0) * p.horas) / 1000);
  const horas = new Map();
  for (const p of registros) {
    const inicio = inicioDeHora(p.instante);
    const clave = inicio.getTime();
    if (!horas.has(clave)) horas.set(clave, { inicio, casaKwh: 0, solarKwh: 0, socFin: null, cobertura: 0 });
    const h = horas.get(clave);
    h.casaKwh += energia(p, "consumo");
    h.solarKwh += energia(p, "produccion");
    h.cobertura += p.horas;
    // SoC 0 en el export es una celda vacia, no una bateria vacia.
    if (typeof p.soc === "number" && p.soc > 0) h.socFin = p.soc;
  }
  return [...horas.values()]
    .map((h) => ({ ...h, cobertura: Math.min(h.cobertura, 1) }))
    .sort((a, b) => a.inicio - b.inicio);
}

const tipoDia = (fecha) => ([0, 6].includes(fecha.getDay()) ? "finde" : "laborable");

export function crearHabitos(horas, { ahora = new Date(), ventanaDias = 60, consumoPorDefectoKwh = 0.3 } = {}) {
  const desde = ahora.getTime() - ventanaDias * DIA_MS;
  const utiles = horas.filter((h) => h.cobertura >= 0.75 && h.inicio.getTime() <= ahora.getTime());
  const recientes = utiles.filter((h) => h.inicio.getTime() >= desde);
  const diasRecientes = new Set(recientes.map((h) => h.inicio.toDateString())).size;
  // Sin una semana reciente se tira de todo el historico, pero sin fiarse.
  const historicoAntiguo = diasRecientes < 7 && utiles.length > recientes.length;
  const validas = historicoAntiguo ? utiles : recientes;
  const dias = new Set(validas.map((h) => h.inicio.toDateString())).size;

  const grupos = new Map();
  const anotar = (clave, valor) => {
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(valor);
  };
  for (const h of validas) {
    const hora = h.inicio.getHours();
    anotar(`casa|${tipoDia(h.inicio)}|${hora}`, h.casaKwh);
    anotar(`casa|${hora}`, h.casaKwh);
    anotar("casa", h.casaKwh);
    anotar(`solar|${hora}`, h.solarKwh);
    if (h.socFin !== null) anotar(`soc|${hora}`, h.socFin);
  }

  const confianza = historicoAntiguo ? "baja" : dias >= 21 ? "alta" : dias >= 7 ? "media" : "baja";

  function consumo(instante) {
    const hora = instante.getHours();
    // Con pocas muestras del tipo de dia se cae a la hora sin distinguir, y luego al total.
    for (const clave of [`casa|${tipoDia(instante)}|${hora}`, `casa|${hora}`, "casa"]) {
      const valores = grupos.get(clave);
      if (valores?.length >= 3) {
        return { kwh: percentil(valores, 0.5), p25: percentil(valores, 0.25), p75: percentil(valores, 0.75), muestras: valores.length, origen: "habito", confianza };
      }
    }
    return { kwh: consumoPorDefectoKwh, p25: null, p75: null, muestras: 0, origen: "estimado", confianza: "baja" };
  }

  const mediana = (clave) => percentil(grupos.get(clave) || [], 0.5);

  return {
    dias,
    diasRecientes,
    historicoAntiguo,
    confianza,
    aprendiendo: diasRecientes < 7,
    consumo,
    // El sol de otra estacion no vale como prevision.
    solarTipica: (hora) => (historicoAntiguo ? null : mediana(`solar|${hora}`)),
    socTipico: (hora) => mediana(`soc|${hora}`),
  };
}
