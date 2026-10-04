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
  const aparatos = combinarAparatos([{ id: "lavadora", energiaKwh: 0.5 }, { id: "termo", energiaKwh: 3 }]);
  const lavadora = aparatos.find((a) => a.id === "lavadora");
  assert.equal(lavadora.energiaKwh, 0.5);
  assert.equal(lavadora.estimado, false);
  assert.equal(aparatos.some((a) => a.id === "termo"), false);
});
