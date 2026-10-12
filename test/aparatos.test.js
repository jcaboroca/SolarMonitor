import { test } from "node:test";
import assert from "node:assert/strict";
import { combinarAparatos } from "../js/asesor/aparatos.js";

test("los aparatos de la casa: sin termo ni coche, con vitroceramica", () => {
  const ids = combinarAparatos().map((a) => a.id);
  assert.deepEqual(ids, ["lavadora", "lavavajillas", "secadora", "horno", "vitro"]);
});

test("un aparato medido no vuelve a estimado al guardar ajustes sin cambios", () => {
  const horno = combinarAparatos([{ id: "horno" }]).find((a) => a.id === "horno");
  assert.equal(horno.estimado, false);
});

test("al corregir un valor deja de ser estimado y se ignoran aparatos que ya no existen", () => {
  const aparatos = combinarAparatos([{ id: "secadora", energiaKwh: 0.5 }, { id: "termo", energiaKwh: 3 }]);
  const secadora = aparatos.find((a) => a.id === "secadora");
  assert.equal(secadora.energiaKwh, 0.5);
  assert.equal(secadora.estimado, false);
  assert.equal(aparatos.some((a) => a.id === "termo"), false);
});

test("una medida nueva gana a la estimación antigua que quedó guardada en ajustes", () => {
  const guardado = [{ id: "lavavajillas", energiaKwh: 1, duracionH: 2.5, potenciaPicoW: 2000 }];
  const lavavajillas = combinarAparatos(guardado).find((a) => a.id === "lavavajillas");
  assert.deepEqual([lavavajillas.energiaKwh, lavavajillas.duracionH, lavavajillas.potenciaPicoW], [1.3, 2.33, 2300]);
  assert.equal(lavavajillas.estimado, false);
  const corregido = combinarAparatos([{ id: "lavavajillas", energiaKwh: 1.6 }]).find((a) => a.id === "lavavajillas");
  assert.equal(corregido.energiaKwh, 1.6);
});
