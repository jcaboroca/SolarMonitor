import { test } from "node:test";
import assert from "node:assert/strict";
import { leerMercado } from "../js/asesor/mercado.js";
import { configDeFormulario, htmlInforme } from "../js/informe.js";
import { validarConfig, generarInforme, refrescarAnterior } from "../worker/src/informe.js";
import { avanzarInforme } from "../worker/src/informe-flujo.js";
import { integrarDia, costeDia, construirInforme, resumirDia } from "../worker/src/informe-calculo.js";
import { limitesDia } from "../worker/src/horario.js";

const FECHA = "2026-11-07";
const AHORA = Date.parse("2026-11-08T07:25:00Z");
const tarifa = {
  tipo: "indexada", desde: "2026-11-01", hasta: null, fuente: "REE y componentes orientativos",
  aceptaEstimacion: true, mercado: { suplemento: 0.05, peajes: { P1: 0.097, P2: 0.029, P3: 0.003 } },
};
const config = { activo: true, pushActivo: false, consentimiento: true, ubicacion: null, tarifa };
function respuesta(fecha = FECHA, precio = 100) {
  const { inicio, fin } = limitesDia(fecha);
  return { included: [{ type: "Precio mercado spot", attributes: {
    values: Array.from({ length: (fin - inicio) / 900000 }, (_, i) => ({
      datetime: new Date(inicio + i * 900000).toISOString(), value: precio,
    })),
  } }] };
}
function integrado(fecha = FECHA) {
  const { inicio, fin } = limitesDia(fecha);
  return integrarDia(Array.from({ length: (fin - inicio) / 300000 }, (_, i) => [
    (inicio + i * 300000) / 1000, 0, 1000, 1000, 0, 0, 0, 50,
  ]), fecha);
}
function mercado(fecha = FECHA, precio = 100) {
  return { desde: fecha, hasta: fecha, estado: "disponible", consultado: new Date(AHORA).toISOString(),
    horas: [...leerMercado(respuesta(fecha, precio), { completo: true })] };
}
function entorno() {
  const datos = new Map(Object.entries({
    "informe-config": config,
    "solarman-dia": { dia: FECHA, integrado: integrado() },
    "solarman-curvas": { dias: { [FECHA]: 288 }, diarios: {}, horas: [] },
  }).map(([k, v]) => [k, JSON.stringify(v)]));
  return { HISTORICO: {
    datos,
    get: async (k, tipo) => datos.has(k) ? tipo === "json" ? JSON.parse(datos.get(k)) : datos.get(k) : null,
    put: async (k, v) => { datos.set(k, v); },
    delete: async (k) => { datos.delete(k); },
  } };
}
const ree = async (url) => {
  assert.equal(new URL(url).hostname, "apidatos.ree.es");
  return Response.json(respuesta());
};
const sinRed = async () => assert.fail("la composicion no debe consultar la red");

test("una hora REE incompleta no se convierte en un precio horario completo", () => {
  const json = respuesta();
  json.included[0].attributes.values.splice(1, 1);
  assert.equal(leerMercado(json, { completo: true }).size, 23);
  assert.equal(leerMercado(json).size, 24);
});
test("un cuarto de hora contradictorio no se promedia como si fuera valido", () => {
  const json = respuesta();
  json.included[0].attributes.values.push({ ...json.included[0].attributes.values[0], value: 300 });
  assert.equal(leerMercado(json, { completo: true }).size, 23);
});
test("los dias de cambio horario conservan sus 23 y 25 precios distintos", () => {
  assert.equal(leerMercado(respuesta("2026-03-29"), { completo: true }).size, 23);
  assert.equal(leerMercado(respuesta("2026-10-25"), { completo: true }).size, 25);
});
test("la API conserva los componentes del modelo y exige aceptar su estimacion", () => {
  assert.deepEqual(validarConfig(config).valor?.tarifa, tarifa);
  assert.equal(validarConfig({ ...config, tarifa: { ...tarifa, aceptaEstimacion: false } }).ok, false);
  assert.equal(validarConfig({ ...config, tarifa: { ...tarifa, mercado: { suplemento: 0.05, peajes: { P1: 0.1 } } } }).ok, false);
});
test("el coste usa mercado mas componentes y lo identifica como estimacion", () => {
  const coste = costeDia(integrado(), tarifa, FECHA, mercado());
  assert.equal(coste.estado, "estimado");
  assert.equal(coste.euros, 4.67);
  assert.match(coste.aviso, /REE/);
  assert.doesNotMatch(coste.aviso, /medias historicas/);
});
test("un precio cero o negativo es real, no un precio ausente", () => {
  assert.equal(costeDia(integrado(), tarifa, FECHA, mercado(FECHA, 0)).euros, 1.62);
  assert.ok(costeDia(integrado(), tarifa, FECHA, mercado(FECHA, -1000)).euros < 0);
});
test("no se calculan euros si falta el precio de una hora comprada o son de otro dia", () => {
  const parcial = mercado();
  parcial.horas.shift();
  assert.equal(costeDia(integrado(), tarifa, FECHA, parcial).estado, "no_disponible");
  assert.equal(costeDia(integrado(), tarifa, FECHA, mercado("2026-11-06")).estado, "no_disponible");
});
test("el ranking usa el coste horario, no las medias de P1 P2 P3", () => {
  const precios = mercado();
  precios.horas[12][1] = 0.9;
  const informe = construirInforme({ integrado: integrado(), fecha: FECHA, ahora: AHORA, config, mercado: precios });
  assert.equal(informe.ranking.criterio, "euros");
  assert.equal(informe.ranking.horas[0].hora, "12");
});
test("REE tiene una fase propia y la composicion consume su snapshot sin red", async () => {
  const e = entorno();
  const fases = [];
  for (let i = 0; i < 5; i++) {
    const r = await avanzarInforme(e, { ahora: AHORA + i * 60000, pedir: i === 3 ? ree : sinRed });
    fases.push(r.fase);
    if (i < 4) assert.equal(e.HISTORICO.datos.has(`informe-${FECHA}`), false);
  }
  assert.deepEqual(fases, ["fuente", "prevision", "calibracion", "precios", "informe"]);
  const informe = JSON.parse(e.HISTORICO.datos.get(`informe-${FECHA}`));
  assert.equal(informe.coste.euros, 4.67);
  assert.equal(informe.precios.horas.length, 24);
  assert.deepEqual(informe.precios.tarifa, tarifa);
});
test("un fallo REE se reintenta de forma acotada y publica energia sin inventar costes", async () => {
  const e = entorno();
  for (let i = 0; i < 3; i++) await avanzarInforme(e, { ahora: AHORA + i * 60000, pedir: sinRed });
  for (let i = 3; i < 6; i++) await avanzarInforme(e, { ahora: AHORA + i * 60000, pedir: async () => new Response("", { status: 503 }) });
  const paso = await avanzarInforme(e, { ahora: AHORA + 6 * 60000, pedir: sinRed });
  assert.equal(paso.fase, "informe");
  const informe = JSON.parse(e.HISTORICO.datos.get(`informe-${FECHA}`));
  assert.equal(informe.estado, "ok");
  assert.equal(informe.coste.estado, "no_disponible");
  assert.equal(informe.precios.estado, "no_disponible");
});
test("la generacion compatible tambien carga REE y conserva una entrega completada", async () => {
  const e = entorno();
  e.HISTORICO.datos.set("informe-indice", JSON.stringify({ informes: [{ fecha: FECHA, push: { estado: "enviado", enviados: 1, pendientes: 0 } }] }));
  const r = await generarInforme(e, { ahora: AHORA, pedir: ree });
  assert.equal(r.informe.coste.euros, 4.67);
  assert.equal(r.entrada.push.estado, "enviado");
});
test("el formulario conserva la seleccion REE y sus componentes", () => {
  const c = configDeFormulario({ consentimiento: true, activo: true, tipo: "indexada_ree", desde: tarifa.desde,
    fuente: tarifa.fuente, aceptaEstimacion: true, suplemento: "0,05", peajeP1: "0,097", peajeP2: "0,029", peajeP3: "0,003" });
  assert.deepEqual(c.tarifa, tarifa);
});
test("el informe muestra precios aunque no haya cobertura suficiente para calcular euros", () => {
  const datos = integrado();
  datos.cobertura.compra = 0.6;
  const informe = construirInforme({ integrado: datos, fecha: FECHA, ahora: AHORA, config, mercado: mercado() });
  assert.equal(informe.coste.estado, "no_disponible");
  assert.match(htmlInforme(informe), /<th[^>]*>Mercado/);
  assert.match(htmlInforme(informe), /0,1000/);
});
test("un coste parcial con mercado negativo no se anuncia como un minimo ni como medias historicas", () => {
  const datos = integrado();
  datos.cobertura.compra = 0.8;
  const informe = construirInforme({ integrado: datos, fecha: FECHA, ahora: AHORA, config, mercado: mercado(FECHA, -1000) });
  assert.equal(informe.coste.parcial, true);
  assert.equal(informe.coste.minimo, false);
  const conclusion = informe.conclusiones.find((c) => c.texto.startsWith("Coste de"));
  assert.doesNotMatch(conclusion.texto, /al menos|medias hist[oó]ricas|[Mm]inimo/);
  assert.doesNotMatch(htmlInforme(informe).match(/<p>Estimación del coste[^<]+/)[0], /al menos/);
});
test("el refresco historico conserva los precios y componentes originales sin consultar REE", async () => {
  const e = entorno();
  const original = construirInforme({ integrado: integrado(), fecha: FECHA, ahora: AHORA, config, mercado: mercado() });
  const entrada = { fecha: FECHA, estado: original.estado, generado: original.generado,
    huella: { ...original.huella, p: 1 }, push: { estado: "enviado", enviados: 1, pendientes: 0 } };
  const indice = { informes: [entrada] };
  e.HISTORICO.datos.set(`informe-${FECHA}`, JSON.stringify(original));
  e.HISTORICO.datos.set("informe-indice", JSON.stringify(indice));
  e.HISTORICO.datos.set("solarman-curvas", JSON.stringify({ dias: { [FECHA]: 288 }, diarios: { [FECHA]: resumirDia(integrado()) }, horas: [] }));
  e.HISTORICO.datos.set("solarman-version", JSON.stringify({ dia: "2026-11-08", m: 0 }));
  e.HISTORICO.datos.set("informe-config", JSON.stringify({ ...config, tarifa: { ...tarifa, mercado: { ...tarifa.mercado, suplemento: 0.5 } } }));
  const ahora = AHORA + 86400000;
  assert.equal((await refrescarAnterior(e.HISTORICO, indice, { fecha: "2026-11-08", ahora })).fase, "refresco_fuente");
  const siguiente = JSON.parse(e.HISTORICO.datos.get("informe-indice"));
  assert.equal((await refrescarAnterior(e.HISTORICO, siguiente, { fecha: "2026-11-08", ahora: ahora + 60000 })).fase, "refresco_informe");
  const actualizado = JSON.parse(e.HISTORICO.datos.get(`informe-${FECHA}`));
  assert.equal(actualizado.coste.euros, 4.67);
  assert.deepEqual(actualizado.precios, original.precios);
  assert.equal(actualizado.generado, original.generado);
  assert.deepEqual(JSON.parse(e.HISTORICO.datos.get("informe-indice")).informes[0].push, entrada.push);
});
test("cada precio mostrado respeta la vigencia del modelo en su propio dia", () => {
  const precios = { ...mercado(), hasta: "2026-11-08", horas: [...mercado().horas, ...mercado("2026-11-08").horas] };
  for (const [cambio, nula, calculada] of [[{ desde: "2026-11-08" }, 0, 24], [{ hasta: FECHA }, 24, 0]]) {
    const informe = construirInforme({ integrado: integrado(), fecha: FECHA, ahora: AHORA,
      config: { ...config, tarifa: { ...tarifa, ...cambio } }, mercado: precios });
    assert.equal(informe.precios.horas[nula][2], null);
    assert.ok(informe.precios.horas[calculada][2] > 0);
  }
});
test("los precios incompletos se reintentan mas tarde sin sobrepasar el limite diario", async () => {
  const e = entorno();
  for (let i = 0; i < 6; i++) await avanzarInforme(e, { ahora: AHORA + i * 60000, pedir: i === 3 ? ree : sinRed });
  assert.equal((await avanzarInforme(e, { ahora: AHORA + 6 * 60000, pedir: sinRed })).resultado, "completo");
  assert.equal((await avanzarInforme(e, { ahora: AHORA + 66 * 60000, pedir: sinRed })).fase, "fuente");
  const indice = JSON.parse(e.HISTORICO.datos.get("informe-indice"));
  indice.informes[0].intentos = 8;
  e.HISTORICO.datos.set("informe-indice", JSON.stringify(indice));
  const trabajo = JSON.parse(e.HISTORICO.datos.get("informe-trabajo"));
  trabajo.fase = "completo";
  e.HISTORICO.datos.set("informe-trabajo", JSON.stringify(trabajo));
  assert.equal((await avanzarInforme(e, { ahora: AHORA + 130 * 60000, pedir: sinRed })).resultado, "completo");
});
