process.env.TZ = "UTC"; // el worker corre en UTC: todo lo local debe ir explicito en Madrid
import { test } from "node:test";
import assert from "node:assert/strict";
import { limitesDia, diaMadrid, sumarDias, tipoDia, periodoMadrid } from "../worker/src/horario.js";
import { integrarDia, evaluarTarifa, costeDia, construirInforme, compararDias, acumuladoMes, esDependencia } from "../worker/src/informe-calculo.js";

// Puntos cada 5 minutos con potencias constantes entre dos instantes locales de Madrid.
function dia(fecha, { paso = 300, valores = {}, saltar = () => false } = {}) {
  const { inicio, fin } = limitesDia(fecha);
  const base = { solar: 0, casa: 400, compra: 0, venta: 0, carga: 0, descarga: 0, soc: 50 };
  const puntos = [];
  for (let t = inicio / 1000; t < fin / 1000; t += paso) {
    if (saltar(t)) continue;
    const x = typeof valores === "function" ? valores(t) : { ...base, ...valores };
    puntos.push([t, x.solar, x.casa, x.compra, x.venta, x.carga, x.descarga, x.soc]);
  }
  return puntos;
}

test("dias de 23, 24 y 25 horas en Madrid aunque el proceso este en UTC", () => {
  assert.equal(limitesDia("2026-03-29").horas, 23);
  assert.equal(limitesDia("2026-10-25").horas, 25);
  assert.equal(limitesDia("2026-11-07").horas, 24);
  assert.equal(new Date(limitesDia("2026-11-07").inicio).toISOString(), "2026-11-06T23:00:00.000Z");
  assert.equal(new Date(limitesDia("2026-08-10").inicio).toISOString(), "2026-08-09T22:00:00.000Z");
  assert.equal(diaMadrid(Date.UTC(2026, 10, 7, 23, 30)), "2026-11-08");
  assert.equal(sumarDias("2026-02-28", 1), "2026-03-01");
  assert.equal(tipoDia("2026-11-07"), "finde");
  assert.equal(tipoDia("2026-11-06"), "laborable");
  assert.equal(tipoDia("2026-12-08"), "finde");
});

test("periodo 2.0TD segun la hora de Madrid, no la del proceso", () => {
  assert.equal(periodoMadrid(Date.UTC(2026, 10, 6, 9, 0)), "P1"); // 10:00 Madrid, viernes
  assert.equal(periodoMadrid(Date.UTC(2026, 10, 6, 6, 0)), "P3"); // 07:00 Madrid
  assert.equal(periodoMadrid(Date.UTC(2026, 10, 7, 9, 0)), "P3");
  assert.equal(periodoMadrid(Date.UTC(2026, 7, 11, 8, 0)), "P1"); // 10:00 CEST
});

test("las dependencias se recalculan al alternar informes de fechas y meses distintos", () => {
  for (const [dia, fecha, esperado] of [
    ["2026-11-05", "2026-11-07", true],
    ["2026-10-06", "2026-11-07", true],
    ["2026-10-08", "2026-11-07", false],
    ["2026-09-06", "2026-11-07", false],
    ["2026-11-05", "2026-12-07", true],
    ["2026-10-06", "2026-12-07", false],
    ["2026-12-31", "2027-01-01", false],
    ["2026-10-06", "2026-11-07", true],
    ["2026-11-07", "2026-11-07", false],
  ]) assert.equal(esDependencia(dia, fecha), esperado, `${dia} / ${fecha}`);
});

test("integra un dia completo sin inventar energia", () => {
  const r = integrarDia(dia("2026-11-07", { valores: { solar: 1000, casa: 500, compra: 100, venta: 0, carga: 0, descarga: 0, soc: 40 } }), "2026-11-07");
  assert.equal(r.horasEsperadas, 24);
  assert.equal(r.energia.solar, 24);
  assert.equal(r.energia.casa, 12);
  assert.equal(r.energia.compra, 2.4);
  assert.equal(r.cobertura.solar, 1);
  // soc incluye ahora instantes y cobertura para no presentar una lectura aislada como inicio/final.
  assert.deepEqual(r.soc, { min: 40, max: 40, inicio: 40, fin: 40, muestras: 288, primera: "2026-11-06T23:00:00.000Z", ultima: "2026-11-07T22:55:00.000Z", primeraHora: "00:00", ultimaHora: "23:55", inicioCercano: true, finCercano: true, cobertura: 1 });
});

test("dia de 23 horas: cobertura completa y energia de 23 h", () => {
  const r = integrarDia(dia("2026-03-29", { valores: { casa: 1000 } }), "2026-03-29");
  assert.equal(r.horasEsperadas, 23);
  assert.equal(r.cobertura.casa, 1);
  assert.equal(r.energia.casa, 23);
  assert.equal(r.porHora.length, 23);
});

test("dia de 25 horas se reparte en 25 tramos", () => {
  const r = integrarDia(dia("2026-10-25", { valores: { compra: 2000 } }), "2026-10-25");
  assert.equal(r.porHora.length, 25);
  assert.equal(r.energia.compra, 50);
  assert.equal(r.porHora.filter((h) => h.hora === "02").length, 2);
});

test("muestras duplicadas no cuentan dos veces", () => {
  const base = dia("2026-11-07", { valores: { casa: 1000 } });
  const r = integrarDia([...base, ...base.map((p) => [...p])], "2026-11-07");
  assert.equal(r.energia.casa, 24);
});

test("fuera del dia se recorta y un hueco grande solo cuenta un paso normal", () => {
  const { inicio } = limitesDia("2026-11-07");
  const t0 = inicio / 1000;
  const r = integrarDia(
    [
      [t0 - 600, 0, 9999, 0, 0, 0, 0, 50],
      [t0, 0, 1000, 0, 0, 0, 0, 50],
      [t0 + 3 * 3600, 0, 1000, 0, 0, 0, 0, 50],
    ],
    "2026-11-07"
  );
  // 300 s por cada una de las dos lecturas del dia, nada del hueco ni de la lectura de ayer
  assert.equal(r.energia.casa, 0.1667);
  assert.ok(r.cobertura.casa < 0.01);
});

test("un canal ausente no es cero: queda sin cobertura y sin energia", () => {
  const puntos = dia("2026-11-07", { valores: { solar: null, casa: 300, soc: null } });
  const r = integrarDia(puntos, "2026-11-07");
  assert.equal(r.cobertura.solar, 0);
  assert.equal(r.energia.solar, null);
  assert.equal(r.soc, null);
  assert.equal(r.energia.casa, 7.2);
});

test("un SOC real de 0 se conserva", () => {
  const r = integrarDia(dia("2026-11-07", { valores: (t) => ({ solar: 0, casa: 100, compra: 0, venta: 0, carga: 0, descarga: 0, soc: t % 600 === 0 ? 0 : 5 }) }), "2026-11-07");
  assert.equal(r.soc.min, 0);
});

test("potencias negativas o no finitas se tratan como dato ausente", () => {
  const r = integrarDia(dia("2026-11-07", { valores: { compra: -50, venta: NaN } }), "2026-11-07");
  assert.equal(r.cobertura.compra, 0);
  assert.equal(r.cobertura.venta, 0);
});

test("horas parciales: un intervalo cruza la frontera de hora repartido", () => {
  const { inicio } = limitesDia("2026-11-07");
  const t0 = inicio / 1000 + 3600 - 150;
  const r = integrarDia([[t0, 0, 1200, 0, 0, 0, 0, 50]], "2026-11-07");
  assert.equal(r.porHora[0].casa, 0.05);
  assert.equal(r.porHora[1].casa, 0.05);
  assert.equal(r.porHora[0].cobertura.casa, 0.0417);
});

test("saltos bruscos de SOC se marcan como cambios del nivel indicado", () => {
  const { inicio } = limitesDia("2026-11-07");
  const t0 = inicio / 1000;
  const soc = (t) => (t < t0 + 6 * 3600 ? 30 : 80);
  const r = integrarDia(dia("2026-11-07", { valores: (t) => ({ solar: 0, casa: 300, compra: 0, venta: 0, carga: 0, descarga: 0, soc: soc(t) }) }), "2026-11-07");
  assert.equal(r.saltosSoc.length, 1);
  assert.equal(r.saltosSoc[0].de, 30);
  assert.equal(r.saltosSoc[0].a, 80);
  assert.equal(r.saltosSoc[0].hora, "06:00");
});

test("un salto entre muestras separadas por horas no se marca", () => {
  const { inicio } = limitesDia("2026-11-07");
  const t0 = inicio / 1000;
  const r = integrarDia([[t0, 0, 100, 0, 0, 0, 0, 20], [t0 + 4 * 3600, 0, 100, 0, 0, 0, 0, 90]], "2026-11-07");
  assert.equal(r.saltosSoc.length, 0);
});

const tarifaPlana = { tipo: "plana", precio: 0.1, desde: "2026-01-01", hasta: null, fuente: "Factura de octubre" };

test("coste exacto: kWh comprados por precio con impuestos, sin potencia", () => {
  const r = integrarDia(dia("2026-11-06", { valores: { compra: 1000 } }), "2026-11-06");
  const c = costeDia(r, tarifaPlana, "2026-11-06");
  assert.equal(c.estado, "disponible");
  // 24 kWh * 0.10 * 1.0511269632 * 1.21
  assert.equal(c.euros, Math.round(24 * 0.1 * 1.0511269632 * 1.21 * 100) / 100);
  assert.match(c.aviso, /no es la factura/i);
});

test("coste por periodos usa la hora de Madrid", () => {
  const { inicio } = limitesDia("2026-11-06");
  // 1 kWh solo entre 10:00 y 11:00 locales (P1) y 1 kWh entre 03:00 y 04:00 (P3)
  const puntos = dia("2026-11-06", {
    valores: (t) => {
      const h = (t - inicio / 1000) / 3600;
      return { solar: 0, casa: 100, compra: (h >= 10 && h < 11) || (h >= 3 && h < 4) ? 1000 : 0, venta: 0, carga: 0, descarga: 0, soc: 50 };
    },
  });
  const t = { tipo: "periodos", P1: 0.2, P2: 0.15, P3: 0.08, desde: "2026-01-01", fuente: "Contrato" };
  const c = costeDia(integrarDia(puntos, "2026-11-06"), t, "2026-11-06");
  assert.equal(c.euros, Math.round((0.2 + 0.08) * 1.0511269632 * 1.21 * 100) / 100);
});

test("sin tarifa, caducada, futura o sin fuente: no hay euros", () => {
  const r = integrarDia(dia("2026-11-06", { valores: { compra: 1000 } }), "2026-11-06");
  for (const t of [undefined, null, {}, { ...tarifaPlana, hasta: "2026-06-30" }, { ...tarifaPlana, desde: "2026-12-01" }, { ...tarifaPlana, fuente: "" }, { ...tarifaPlana, precio: -1 }, { ...tarifaPlana, desde: undefined }]) {
    const c = costeDia(r, t, "2026-11-06");
    assert.equal(c.estado, "no_disponible");
    assert.equal(c.euros, undefined);
    assert.ok(c.motivo);
  }
});

test("tarifa indexada sin aceptar estimacion no da euros; aceptada, marca estimacion", () => {
  const r = integrarDia(dia("2026-11-06", { valores: { compra: 1000 } }), "2026-11-06");
  const base = { tipo: "indexada", desde: "2026-01-01", fuente: "Octopus Flexi, media de agosto", mediaHistorica: { P1: 0.22, P2: 0.157, P3: 0.184 } };
  assert.equal(costeDia(r, base, "2026-11-06").estado, "no_disponible");
  const c = costeDia(r, { ...base, aceptaEstimacion: true }, "2026-11-06");
  assert.equal(c.estado, "estimado");
  assert.match(c.aviso, /medias hist/i);
  assert.ok(c.euros > 0);
});

test("con poca cobertura de compra no se calcula coste", () => {
  const r = integrarDia(dia("2026-11-06", { valores: { compra: 1000 }, saltar: (t) => (t / 300) % 2 === 0 }), "2026-11-06");
  assert.equal(costeDia(r, tarifaPlana, "2026-11-06").estado, "no_disponible");
});

test("evaluarTarifa valida el esquema", () => {
  assert.equal(evaluarTarifa(tarifaPlana, "2026-11-06").valida, true);
  assert.equal(evaluarTarifa({ ...tarifaPlana, tipo: "otra" }, "2026-11-06").valida, false);
});

test("informe de un dia sin datos no parece un exito", () => {
  const i = construirInforme({ puntos: [], fecha: "2026-11-07", ahora: Date.UTC(2026, 10, 8, 7, 30), config: {} });
  assert.equal(i.estado, "sin_datos");
  assert.equal(i.energia, null);
  assert.deepEqual(i.conclusiones.map((c) => c.tipo), ["aviso"]);
  assert.equal(i.fuente.datadis, false);
});

test("informe completo: ranking por kWh sin tarifa y explicaciones solo con evidencia", () => {
  const { inicio } = limitesDia("2026-11-07");
  const puntos = dia("2026-11-07", {
    valores: (t) => {
      const h = Math.floor((t - inicio / 1000) / 3600);
      const noche = h >= 20 && h < 23;
      return { solar: h >= 10 && h < 16 ? 2000 : 0, casa: noche ? 2500 : 400, compra: noche ? 2500 : h < 7 ? 300 : 0, venta: 0, carga: 0, descarga: 0, soc: noche ? 12 : 60 };
    },
  });
  const i = construirInforme({ puntos, fecha: "2026-11-07", ahora: Date.UTC(2026, 10, 8, 7, 30), config: {} });
  assert.equal(i.estado, "ok");
  assert.equal(i.coste.estado, "no_disponible");
  assert.equal(i.ranking.criterio, "kwh");
  assert.deepEqual(i.ranking.horas.map((h) => h.hora).sort(), ["20", "21", "22"]);
  const motivos = i.ranking.horas[0].motivos.join(" ");
  assert.match(motivos, /sin producci/i);
  assert.match(motivos, /consumo/i);
  assert.match(motivos, /indicado/i);
  assert.doesNotMatch(JSON.stringify(i), /aver[ií]a|fallo del contador|llena fisicamente|reserva configurada/i);
  assert.equal(i.horasEsperadas, 24);
});

test("con tarifa valida el ranking es por euros", () => {
  const puntos = dia("2026-11-06", { valores: (t) => ({ solar: 0, casa: 500, compra: Math.floor((t - limitesDia("2026-11-06").inicio / 1000) / 3600) === 11 ? 3000 : 200, venta: 0, carga: 0, descarga: 0, soc: 50 }) });
  const i = construirInforme({ puntos, fecha: "2026-11-06", ahora: Date.UTC(2026, 10, 7, 7, 30), config: { tarifa: { tipo: "periodos", P1: 0.3, P2: 0.2, P3: 0.1, desde: "2026-01-01", fuente: "Contrato" } } });
  assert.equal(i.ranking.criterio, "euros");
  assert.equal(i.ranking.horas[0].hora, "11");
  assert.ok(i.ranking.horas[0].euros > 0);
});

test("los empates del ranking conservan el orden UTC de las dos horas 02 del cambio de invierno", () => {
  const puntos = dia("2026-10-25", { valores: { compra: 1000 } });
  const integrado = integrarDia(puntos, "2026-10-25");
  integrado.porHora = integrado.porHora.filter((h) => h.hora === "02" || h.hora === "03").reverse();
  const informe = construirInforme({ integrado, fecha: "2026-10-25", ahora: Date.UTC(2026, 9, 26, 7, 30), config: {} });
  assert.deepEqual(informe.ranking.horas.map((h) => h.inicio), [
    "2026-10-25T00:00:00.000Z",
    "2026-10-25T01:00:00.000Z",
    "2026-10-25T02:00:00.000Z",
  ]);
  assert.deepEqual(informe.ranking.horas.map((h) => h.hora), ["02", "02", "03"]);
});

test("cobertura baja: estado parcial y energia no se presenta como total", () => {
  const puntos = dia("2026-11-07", { valores: { casa: 500, solar: 0 }, saltar: (t) => (t - limitesDia("2026-11-07").inicio / 1000) / 3600 >= 15 });
  const i = construirInforme({ puntos, fecha: "2026-11-07", ahora: Date.UTC(2026, 10, 8, 7, 30), config: {} });
  assert.equal(i.estado, "parcial");
  assert.equal(i.energia.casa.minimo, true);
  assert.equal(i.coste.estado, "no_disponible");
});

test("cobertura muy baja: el canal queda en null", () => {
  const puntos = dia("2026-11-07", { valores: { casa: 500 }, saltar: (t) => (t - limitesDia("2026-11-07").inicio / 1000) / 3600 >= 6 });
  const i = construirInforme({ puntos, fecha: "2026-11-07", ahora: Date.UTC(2026, 10, 8, 7, 30), config: {} });
  assert.equal(i.energia.casa, null);
});

const resumenDia = (casa, compra, extra = {}) => ({ solar: 5, casa, compra, venta: 0, carga: 0, descarga: 0, cob: { solar: 1, casa: 1, compra: 1, venta: 1, carga: 1, descarga: 1 }, ...extra });

test("compara con la mediana de dias del mismo tipo y exige al menos dos", () => {
  const diarios = {
    "2026-10-31": resumenDia(10, 2), // sabado
    "2026-10-24": resumenDia(14, 4), // sabado
    "2026-11-01": resumenDia(99, 99), // domingo festivo: tambien finde
    "2026-11-02": resumenDia(1, 1), // laborable, no se usa
  };
  const c = compararDias({ fecha: "2026-11-07", actual: resumenDia(12, 3), diarios });
  assert.equal(c.tipoDia, "finde");
  assert.ok(c.metricas.casa.n >= 2);
  assert.equal(c.metricas.casa.referencia, 14); // mediana de 10, 14 y 99
  assert.equal(compararDias({ fecha: "2026-11-07", actual: resumenDia(12, 3), diarios: { "2026-10-31": resumenDia(10, 2) } }), null);
});

test("no compara dias con cobertura baja", () => {
  const diarios = { "2026-10-31": resumenDia(10, 2, { cob: { casa: 0.5, compra: 0.5, solar: 0.5 } }), "2026-10-24": resumenDia(14, 4) };
  assert.equal(compararDias({ fecha: "2026-11-07", actual: resumenDia(12, 3), diarios }), null);
});

test("acumulado del mes solo suma dias completos y compara dias iguales del mes anterior", () => {
  const diarios = {};
  for (let d = 1; d <= 7; d++) diarios[`2026-11-0${d}`] = resumenDia(10, 2);
  diarios["2026-11-03"] = resumenDia(10, 2, { cob: { casa: 0.4, compra: 0.4, solar: 0.4 } });
  for (let d = 1; d <= 7; d++) diarios[`2026-10-0${d}`] = resumenDia(20, 5);
  diarios["2026-10-05"] = resumenDia(20, 5, { cob: { casa: 0.4, compra: 0.4, solar: 0.4 } });
  const m = acumuladoMes({ fecha: "2026-11-07", diarios });
  assert.equal(m.diasTranscurridos, 7);
  assert.equal(m.diasCompletos, 6);
  assert.equal(m.actual.casa, 60);
  assert.deepEqual(m.comparable.diasIguales, 5);
  assert.equal(m.comparable.mesAnterior.compra, 25);
  assert.equal(m.comparable.mesActual.compra, 10);
  assert.match(m.aviso, /no es el mes completo/i);
  assert.equal(m.proyeccion, undefined);
});
