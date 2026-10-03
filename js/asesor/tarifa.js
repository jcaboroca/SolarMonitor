// Tarifa electrica: precio de la energia por periodo 2.0TD (o por hora si se
// inyecta una serie), compensacion de excedentes e impuestos. Todo en €/kWh.

import { periodoTarifa } from "../datos.js";

export const IMPUESTO_ELECTRICO = 0.0511269632;
export const IVA = 0.21;

// Precios de la factura de Nexus (2026): energia plana y excedentes, sin impuestos.
export const TARIFA_POR_DEFECTO = {
  nombre: "2.0TD precio fijo",
  energia: { P1: 0.108727, P2: 0.108727, P3: 0.108727 },
  excedentes: 0.012645,
  impuestoElectrico: IMPUESTO_ELECTRICO,
  iva: IVA,
  festivos: [],
  horaria: null,
};

const inicioDeHora = (instante) => {
  const hora = new Date(instante);
  hora.setMinutes(0, 0, 0);
  return hora.getTime();
};

export function crearTarifa(config = {}) {
  const t = { ...TARIFA_POR_DEFECTO, ...config, energia: { ...TARIFA_POR_DEFECTO.energia, ...config.energia } };
  const festivos = new Set(t.festivos);
  // La compensacion de excedentes se descuenta del termino de energia, antes de impuestos.
  const conImpuestos = (euros) => euros * (1 + t.impuestoElectrico) * (1 + t.iva);
  const base = (instante) => {
    const horaria = t.horaria?.get(inicioDeHora(instante));
    return horaria ?? t.energia[periodoTarifa(instante, festivos)];
  };
  return {
    config: t,
    periodo: (instante) => periodoTarifa(instante, festivos),
    precioCompra: (instante) => conImpuestos(base(instante)),
    precioVenta: () => conImpuestos(t.excedentes),
    precioPlano: new Set(Object.values(t.energia)).size === 1 && !t.horaria,
  };
}
