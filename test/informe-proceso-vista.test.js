import { test } from "node:test";
import assert from "node:assert/strict";
import * as vista from "../js/informe.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const esperar = async () => {};

test("generar no anuncia exito hasta que termina la fase de composicion", async () => {
  assert.equal(typeof vista.generarPorFases, "function");
  const fases = ["fuente", "prevision", "calibracion", "informe"];
  const progreso = [];
  const rutas = [];
  const r = await vista.generarPorFases({
    esperar, alProgreso: (texto) => progreso.push(texto),
    pedir: async (ruta) => {
      rutas.push(ruta);
      return ruta.includes("/generar") ? json({ estado: "preparando" }, 202)
        : json({ resultado: "preparado", fase: fases.shift() });
    },
  });
  assert.equal(r.estado, "generado");
  assert.equal(rutas.filter((r) => r.endsWith("/avanzar")).length, 4);
  assert.ok(progreso.every((p) => !/generado/i.test(p)));
});

test("una preparacion ocupada tiene seguimiento acotado y no se presenta como terminada", async () => {
  assert.equal(typeof vista.generarPorFases, "function");
  let pasos = 0;
  const r = await vista.generarPorFases({
    esperar,
    pedir: async (ruta) => ruta.includes("/generar") ? json({ estado: "preparando" }, 202)
      : (pasos++, json({ resultado: "ocupado" })),
  });
  assert.equal(pasos, 12);
  assert.equal(r.estado, "preparando");
  assert.match(r.mensaje, /servidor/i);
});

test("un agotamiento o error HTTP se explica sin anunciar informe generado", async () => {
  assert.equal(typeof vista.generarPorFases, "function");
  for (const fallo of [json({ resultado: "agotado" }, 503), json({ error: "No autorizado" }, 401)]) {
    const r = await vista.generarPorFases({
      esperar,
      pedir: async (ruta) => ruta.includes("/generar") ? json({ estado: "preparando" }, 202) : fallo,
    });

    assert.equal(r.estado, "error");
    assert.ok(r.mensaje.length);
    assert.doesNotMatch(r.mensaje, /informe generado/i);
  }
});

test("durante el despliegue conserva compatibilidad con el servidor anterior", async () => {
  const r = await vista.generarPorFases({
    esperar,
    pedir: async (ruta) => {
      assert.equal(ruta, "/informe/generar?fases=1");
      return json({ estado: "parcial" });
    },
  });
  assert.equal(r.estado, "generado");
});
