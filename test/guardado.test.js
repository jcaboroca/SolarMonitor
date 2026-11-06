process.env.TZ = "Europe/Madrid";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as datos from "../js/datos.js";
import * as facturas from "../js/factura.js";
import * as historico from "../js/historico.js";

const fuente = readFileSync(new URL("../js/app.js", import.meta.url), "utf8")
  .replace(/^import\b[\s\S]*?;\n/gm, "")
  .split("// --- Arranque")[0];

function cargarApp(t) {
  const almacen = new Map();
  const anterior = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => almacen.get(k) ?? null,
    setItem: (k, v) => almacen.set(k, v),
    removeItem: (k) => almacen.delete(k),
  };
  t.after(() => {
    if (anterior === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = anterior;
  });
  const elementos = new Map();
  const elemento = (id) => {
    if (!elementos.has(id)) elementos.set(id, {
      value: "", textContent: "", hidden: false, disabled: false,
      classList: { toggle() {} },
    });
    return elementos.get(id);
  };
  const entradas = { P1: "21.35", P2: "32.84", P3: "88.82", total: "143.01", excedentes: "17.26" };
  const subidas = [];
  let alSincronizar;
  const contexto = vm.createContext({
    ...datos, ...facturas, ...historico, Date, console,
    setTimeout: (callback) => callback(),
    marcarNube: (mensaje) => { elemento("estadoNube").textContent = mensaje; },
    document: {
      getElementById: elemento,
      querySelector: (selector) => {
        const clave = selector.match(/data-clave="([^"]+)"/)?.[1];
        return clave ? { value: entradas[clave] ?? "" } : null;
      },
    },
    sincronizarPronto: (callback) => {
      subidas.push(historico.paqueteActual());
      alSincronizar = callback;
    },
  });
  vm.runInContext(fuente, contexto);
  vm.runInContext(`
    pintarHistorico = () => {};
    refrescarMesesContador = () => {};
  `, contexto);
  const estado = vm.runInContext("estado", contexto);
  const fecha = new Date(2026, 8, 1);
  estado.serie = {
    registros: [{ instante: fecha, horas: 1, produccion: 1000, consumo: 500, importada: 10, exportada: 20 }],
    unidadesRol: { produccion: "W", consumo: "W", importada: "W", exportada: "W" },
  };
  estado.dias = [{ clave: "2026-09-01", fecha, produccion: 1, consumo: 0.5, importada: 0.01, exportada: 0.02 }];
  estado.medido = { P1: 0, P2: 0, P3: 0.01, total: 0.01, excedentes: 0.02 };
  estado.mesComparacion = "2026-09";
  estado.factura = {
    desde: new Date(2026, 9, 1), hasta: new Date(2026, 10, 1),
    comercializadora: "Octopus", precio: { P1: 0.375 }, total: 65.54,
    referencia: "OCTUBRE", lecturas: {}, precioExcedentes: 0.035,
  };
  return {
    contexto, estado, elemento, entradas, subidas,
    ejecutar: (codigo) => vm.runInContext(codigo, contexto),
    terminarSincronizacion: (error) => alSincronizar(error),
  };
}

test("un PDF de octubre no sobrescribe la factura de septiembre al guardar su serie", (t) => {
  const app = cargarApp(t);
  historico.guardarMes({ mes: "2026-09", factura: { total: 27.07, importe: 20.86 } });
  app.ejecutar("guardarSolo()");
  const septiembre = historico.leerHistorico().find((m) => m.mes === "2026-09");
  assert.equal(septiembre.factura.total, 27.07);
  assert.equal(septiembre.factura.importe, 20.86);
  assert.equal(septiembre.medido.produccion, 1);
});

test("un PDF de otro mes tampoco crea una factura incorrecta si no habia una anterior", (t) => {
  const app = cargarApp(t);
  app.ejecutar("guardarSolo()");
  assert.deepEqual(historico.leerHistorico()[0].factura, {});
});

test("la factura coincidente conserva su periodo para identificarla despues de restaurar", (t) => {
  const app = cargarApp(t);
  app.estado.dias[0].fecha = new Date(2026, 9, 1);
  app.estado.dias[0].clave = "2026-10-01";
  app.estado.mesComparacion = "2026-10";
  app.ejecutar("guardarSolo()");
  const factura = historico.leerHistorico()[0].factura;
  assert.equal(factura.total, 143.01);
  assert.equal(factura.mes, "2026-10");
  assert.equal(factura.desde, new Date(2026, 9, 1).toISOString());
  assert.equal(factura.hasta, new Date(2026, 10, 1).toISOString());
});

test("los valores manuales de otro mes no se arrastran al guardado", (t) => {
  const app = cargarApp(t);
  app.estado.factura = null;
  app.estado.mesComparacion = "2026-08";
  app.ejecutar("guardarSolo()");
  assert.deepEqual(historico.leerHistorico()[0].factura, {});
});

test("los valores manuales siguen guardandose en su mes", (t) => {
  const app = cargarApp(t);
  app.estado.factura = null;
  app.ejecutar("guardarSolo()");
  assert.equal(historico.leerHistorico()[0].factura.total, 143.01);
});

test("un PDF sin fechas queda ligado al mes en que se introdujo, no al siguiente", (t) => {
  const app = cargarApp(t);
  app.estado.factura = { consumo: {}, precio: {}, texto: "" };
  app.estado.mesFactura = "2026-08";
  app.ejecutar("guardarSolo()");
  assert.deepEqual(historico.leerHistorico()[0].factura, {});
});

function prepararDatadis(app, curva) {
  app.elemento("desdeDatadis").value = "2026-10";
  app.elemento("hastaDatadis").value = "2026-10";
  app.contexto.datadis = {
    mesesEntre: () => ["2026/10"],
    curvaHoraria: async () => curva,
  };
  app.ejecutar('suministroElegido = () => ({ cups: "PRUEBA", codigoDistribuidora: "1", tipoPunto: 5 })');
}

const punto = {
  instante: new Date(2026, 9, 1), consumo: 0.4, vertido: 0.1,
  generado: 0, autoconsumido: 0, real: true,
};

test("descargar Datadis sincroniza la curva recien guardada", async (t) => {
  const app = cargarApp(t);
  prepararDatadis(app, [punto]);
  await app.ejecutar("bajarDeDatadis()");
  assert.equal(app.subidas.length, 1);
  assert.equal(app.subidas[0].curvas["2026-10"].length, 1);
  assert.equal(app.subidas[0].curvas["2026-10"][0][1], 0.4);
  assert.equal(app.elemento("bajarDatadis").disabled, false);
});

test("una descarga vacia no sube ni borra las curvas existentes", async (t) => {
  const app = cargarApp(t);
  historico.guardarCurva("2026-10", [punto]);
  prepararDatadis(app, []);
  await app.ejecutar("bajarDeDatadis()");
  assert.equal(app.subidas.length, 0);
  assert.equal(historico.leerCurvas().get("2026-10").length, 1);
  assert.match(app.elemento("estadoDatadis").textContent, /no ha devuelto datos/i);
});

test("una descarga parcial sincroniza lo recuperado aunque falle el tramo siguiente", async (t) => {
  const app = cargarApp(t);
  prepararDatadis(app, [punto]);
  app.contexto.datadis.mesesEntre = () => Array.from({ length: 13 }, (_, i) =>
    i < 12 ? `2025/${String(i + 1).padStart(2, "0")}` : "2026/01");
  let llamadas = 0;
  app.contexto.datadis.curvaHoraria = async () => {
    if (llamadas++) throw new Error("Error de la distribuidora");
    return [{ ...punto, instante: new Date(2025, 0, 1) }];
  };
  await app.ejecutar("bajarDeDatadis()");
  assert.equal(app.subidas.length, 1);
  assert.equal(app.subidas[0].curvas["2025-01"].length, 1);
  assert.match(app.elemento("estadoDatadis").textContent, /Error de la distribuidora/);
});

test("un fallo de sincronizacion se muestra sin perder la descarga local", async (t) => {
  const app = cargarApp(t);
  prepararDatadis(app, [punto]);
  await app.ejecutar("bajarDeDatadis()");
  assert.equal(app.subidas.length, 1);
  app.terminarSincronizacion(new Error("Sin conexion"));
  assert.match(app.elemento("aviso").textContent, /Sin conexion/);
  assert.equal(app.elemento("aviso").hidden, false);
  assert.equal(historico.leerCurvas().get("2026-10").length, 1);
});

test("el mes de una factura usa los dias facturados, incluido el cambio de hora", () => {
  assert.equal(typeof historico.mesDeFactura, "function");
  for (const [desde, hasta, comercializadora, mes] of [
    ["2026-10-01T00:00:00", "2026-11-01T00:00:00", "Octopus", "2026-10"],
    ["2026-09-16T00:00:00", "2026-10-16T00:00:00", "Octopus", "2026-09"],
    ["2026-09-16T00:00:00", "2026-10-16T00:00:00", undefined, "2026-10"],
    ["2026-10-31T00:00:00", "2026-11-01T00:00:00", "Octopus", "2026-10"],
  ]) {
    assert.equal(historico.mesDeFactura({ desde, hasta, comercializadora }), mes);
  }
  assert.equal(historico.mesDeFactura({}), null);
});
