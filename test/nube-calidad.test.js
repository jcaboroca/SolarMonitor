import assert from "node:assert/strict";
import { test } from "node:test";
import { configurarNube, subirANube } from "../js/nube.js";
import { guardarMes, leerHistorico } from "../js/historico.js";

test("subir fusiona primero la copia remota y no publica si falla su lectura", async (t) => {
  const previo = globalThis.localStorage, fetchPrevio = globalThis.fetch;
  const mapas = [new Map(), new Map()];
  let dispositivo = 0, remoto = null, fallar = false;
  const llamadas = [];
  globalThis.localStorage = {
    getItem: (k) => mapas[dispositivo].get(k) ?? null,
    setItem: (k, v) => mapas[dispositivo].set(k, v),
    removeItem: (k) => mapas[dispositivo].delete(k),
  };
  t.after(() => { globalThis.localStorage = previo; globalThis.fetch = fetchPrevio; });
  globalThis.fetch = async (_, opciones) => {
    llamadas.push(opciones.method);
    if (opciones.method === "GET") return new Response(fallar ? "error" : remoto, { status: fallar ? 503 : remoto ? 200 : 404 });
    remoto = opciones.body;
    return Response.json({ ok: true });
  };
  const clave = Buffer.alloc(32, 7).toString("base64");
  configurarNube("https://example.invalid", clave);
  guardarMes({ mes: "2026-09", guardado: "2026-11-05T00:00:00Z", factura: { total: 27.07 } });
  await subirANube();
  dispositivo = 1;
  configurarNube("https://example.invalid", clave);
  guardarMes({ mes: "2026-10", guardado: "2026-11-06T00:00:00Z", factura: { total: 143.01 } });
  await subirANube();
  assert.deepEqual(leerHistorico().map((m) => m.mes), ["2026-09", "2026-10"]);
  assert.deepEqual(llamadas, ["GET", "PUT", "GET", "PUT"]);
  fallar = true;
  await assert.rejects(subirANube(), /503/);
  assert.equal(llamadas.at(-1), "GET");
});
