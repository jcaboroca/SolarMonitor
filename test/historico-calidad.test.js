process.env.TZ = "Europe/Madrid";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as h from "../js/historico.js";

function almacenar(t) {
  const valores = new Map(), previo = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => valores.get(k) ?? null,
    setItem: (k, v) => valores.set(k, v),
    removeItem: (k) => valores.delete(k),
  };
  t.after(() => {
    if (previo === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previo;
  });
}
const hora = new Date(2026, 9, 1).getTime() / 3600000;

test("si el detalle no cabe se avisa y se conserva la serie anterior", (t) => {
  almacenar(t);
  h.guardarSerie("2026-09", { original: true });
  const setItem = localStorage.setItem;
  localStorage.setItem = (k, v) => {
    if (k === "solar-monitor-serie") throw new Error("QuotaExceededError");
    setItem(k, v);
  };
  assert.throws(() => h.guardarSerie("2026-10", { nueva: true }), /no.*guardar|no cabe/i);
  assert.equal(h.leerSerie().mes, "2026-09");
});

test("una curva corregida actualiza horas existentes aunque tenga igual longitud", (t) => {
  almacenar(t);
  h.fusionarPaquete({ meses: [{ mes: "2026-10" }], curvas: { "2026-10": [[hora, 1, 0, 1]] } });
  h.fusionarPaquete({ meses: [{ mes: "2026-10", contador: { total: 99 } }], curvas: { "2026-10": [[hora, 2, 0, 1]] } });
  assert.equal(h.leerCurvas().get("2026-10")[0].consumo, 2);
  assert.equal(h.leerHistorico()[0].contador.total, 2);
});

test("una curva parcial actualiza sus horas sin borrar las demas", (t) => {
  almacenar(t);
  h.fusionarPaquete({ meses: [{ mes: "2026-10" }], curvas: { "2026-10": [[hora, 1, 0, 1], [hora + 1, 3, 0, 1]] } });
  h.fusionarPaquete({ meses: [], curvas: { "2026-10": [[hora, 2, 0, 1]] } });
  assert.deepEqual(h.leerCurvas().get("2026-10").map((p) => p.consumo), [2, 3]);
  assert.equal(h.leerHistorico()[0].contador.total, 5);
});

test("guardar una descarga parcial tampoco borra horas ya guardadas", (t) => {
  almacenar(t);
  const punto = (h, consumo) => ({ instante: new Date(h * 3600000), consumo, vertido: 0, real: true });
  h.guardarCurva("2026-10", [punto(hora, 1), punto(hora + 1, 3)]);
  h.guardarCurva("2026-10", [punto(hora, 2)]);
  assert.deepEqual(h.leerCurvas().get("2026-10").map((p) => p.consumo), [2, 3]);
});

test("una revision antigua no pisa horas corregidas mas recientemente", (t) => {
  almacenar(t);
  h.fusionarPaquete({
    meses: [{ mes: "2026-10" }], curvas: { "2026-10": [[hora, 2, 0, 1]] },
    revisionesCurvas: { "2026-10": "2026-11-06T09:00:00Z" },
  });

  h.fusionarPaquete({
    meses: [{ mes: "2026-10" }], curvas: { "2026-10": [[hora, 1, 0, 1], [hora + 1, 3, 0, 1]] },
    revisionesCurvas: { "2026-10": "2026-11-05T09:00:00Z" },
  });
  assert.deepEqual(h.leerCurvas().get("2026-10").map((p) => p.consumo), [2, 3]);
});

test("una actualizacion parcial no envejece artificialmente las otras horas", (t) => {
  almacenar(t);
  const cargar = (dia, puntos) => h.fusionarPaquete({
    meses: [{ mes: "2026-10" }], curvas: { "2026-10": puntos },
    revisionesCurvas: { "2026-10": `2026-11-0${dia}T09:00:00Z` },
  });
  cargar(1, [[hora, 1, 0, 1], [hora + 1, 1, 0, 1]]);
  cargar(3, [[hora, 2, 0, 1]]);
  cargar(2, [[hora, 1, 0, 1], [hora + 1, 3, 0, 1], [hora + 2, 4, 0, 1]]);
  assert.deepEqual(h.leerCurvas().get("2026-10").map((p) => p.consumo), [2, 3, 4]);
});

test("datalogger incompleto no permite culpar al contador cuando este cuadra con la factura", () => {
  const r = h.analizarHistorico([{
    mes: "2026-10", medido: { total: 125.5 }, factura: { total: 143.01 },
    contador: { total: 143.011, horas: 745, estimadas: 0 },
  }]);
  assert.ok(!r.avisos.some(([, texto]) => /reclamar|problema est[aá]|configurado el contador/i.test(texto)));
  assert.ok(r.avisos.some(([, texto]) => /cobertura|no permite|no demuestra/i.test(texto)));
});

test("solape de compra y vertido no diagnostica por si solo un fallo de neteo", () => {
  const r = h.analizarHistorico([{
    mes: "2026-06", medido: { total: 10, excedentes: 20 },
    factura: { total: 100, excedentes: 110 },
  }]);
  assert.ok(!r.avisos.some(([, texto]) => /deja de compensar|nunca sali[oó]|empieza a contar/i.test(texto)));
});

test("una copia antigua no pisa una factura ni una serie corregidas", (t) => {
  almacenar(t);
  h.fusionarPaquete({
    meses: [{ mes: "2026-10", guardado: "2026-11-06T09:00:00Z", factura: { total: 143 } }],
    serie: { mes: "2026-10", guardado: "2026-11-06T09:00:00Z", serie: { version: "corregida" } },
  });
  h.fusionarPaquete({
    meses: [{ mes: "2026-10", guardado: "2026-11-05T09:00:00Z", factura: { total: 27 } }],
    serie: { mes: "2026-10", guardado: "2026-11-05T09:00:00Z", serie: { version: "antigua" } },
  });
  assert.equal(h.leerHistorico()[0].factura.total, 143);
  assert.equal(h.leerSerie().serie.version, "corregida");
  assert.equal(h.leerSerie().guardado, "2026-11-06T09:00:00Z");
});

test("un mes borrado no resucita al fusionar una copia anterior", (t) => {
  almacenar(t);
  const paquete = {
    meses: [{ mes: "2026-10", guardado: "2026-01-01T00:00:00Z" }],
    curvas: { "2026-10": [[hora, 1, 0, 1]] },
  };
  h.fusionarPaquete(paquete);
  h.borrarMes("2026-10");
  h.fusionarPaquete(paquete);
  assert.equal(h.leerHistorico().length, 0);
  assert.equal(h.leerCurvas().size, 0);
  assert.ok(h.paqueteActual().borrados["2026-10"]);
});
