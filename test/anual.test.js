// F4 «Mes a mes»: el año en rayos (modelo puro de js/anual.js).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { modeloAnual, ANGULO_MES } from "../js/anual.js";
import { CX, CY, R, LMAX, LCASA } from "../js/arco.js";

const mes = (clave, produccion, consumo, dias) => ({ mes: clave, dias, medido: { produccion, consumo, total: 10 } });
const congelar = (x) => {
  if (x && typeof x === "object") {
    Object.values(x).forEach(congelar);
    Object.freeze(x);
  }
  return x;
};

test("con menos de dos meses con producción no hay año que pintar", () => {
  assert.equal(modeloAnual([]), null);
  assert.equal(modeloAnual([mes("2026-06", 673.1, 494.9, 30)]), null);
  // Un mes sin medida propia (solo contador o factura) no cuenta como rayo.
  assert.equal(modeloAnual([mes("2026-06", 673.1, 494.9, 30), { mes: "2026-05", dias: 31, contador: { total: 40 } }]), null);
  assert.equal(modeloAnual(null), null);
});

test("doce posiciones de enero a diciembre: enero a la izquierda, el verano en lo alto", () => {
  const m = modeloAnual([mes("2026-05", 347, 300, 31), mes("2026-06", 673.1, 494.9, 30)]);
  assert.equal(m.anio, 2026);
  assert.equal(m.meses.length, 12);
  assert.deepEqual(m.meses.map((x) => x.mes), Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`));
  assert.equal(ANGULO_MES(0), 172.5);
  assert.equal(ANGULO_MES(5), 97.5);
  assert.equal(ANGULO_MES(6), 82.5);
  assert.equal(ANGULO_MES(11), 7.5);
  m.meses.forEach((x, i) => assert.equal(x.angulo, ANGULO_MES(i)));
});

test("solo hay rayo en los meses guardados; los demás no inventan cifras", () => {
  const m = modeloAnual([mes("2026-05", 347, 300, 31), mes("2026-06", 673.1, 494.9, 30)]);
  const conRayo = m.meses.filter((x) => x.sol !== null).map((x) => x.mes);
  assert.deepEqual(conRayo, ["2026-05", "2026-06"]);
  for (const x of m.meses.filter((x) => !["2026-05", "2026-06"].includes(x.mes))) {
    assert.equal(x.produccion, null);
    assert.equal(x.consumo, null);
    assert.equal(x.sol, null);
    assert.equal(x.casa, null);
  }
  assert.equal(m.conDatos, 2);
});

test("escala: el mes de más producción es el rayo lleno y la casa va en la misma escala", () => {
  const m = modeloAnual([mes("2026-05", 347, 300, 31), mes("2026-06", 673.1, 494.9, 30)]);
  assert.deepEqual(m.escala, { kwh: 673.1, mes: "2026-06" });
  const junio = m.meses[5], mayo = m.meses[4];
  assert.equal(junio.sol, LMAX);
  assert.ok(Math.abs(mayo.sol - (347 / 673.1) * LMAX) < 1e-9);
  const px = LMAX / 673.1;
  assert.ok(Math.abs(mayo.casa - 300 * px) < 1e-9);
  assert.equal(mayo.desborde, false);
  // 494,9 kWh × px = 25 u, por debajo del tope.
  assert.ok(Math.abs(junio.casa - Math.min(494.9 * px, LCASA)) < 1e-9);
});

test("un consumo que se sale del tope interior se recorta y se marca", () => {
  const m = modeloAnual([mes("2026-01", 100, 900, 31), mes("2026-02", 120, 50, 28)]);
  const enero = m.meses[0];
  assert.equal(enero.casa, LCASA);
  assert.equal(enero.desborde, true);
});

test("un mes con menos días guardados que los del calendario es parcial", () => {
  const m = modeloAnual([mes("2026-02", 200, 150, 20), mes("2026-03", 300, 200, 31), mes("2024-02", 1, 1, 29)]);
  assert.equal(m.meses[1].parcial, true);
  assert.equal(m.meses[1].diasMes, 28);
  assert.equal(m.meses[2].parcial, false);
  // Sin días anotados no se afirma nada.
  const sinDias = modeloAnual([mes("2026-02", 200, 150), mes("2026-03", 300, 200)]);
  assert.equal(sinDias.meses[1].parcial, false);
});

test("totales y pico solo con meses guardados", () => {
  const m = modeloAnual([mes("2026-05", 347, 300, 31), mes("2026-06", 673.1, 494.9, 30), { mes: "2026-07", dias: 31, contador: { total: 9 } }]);
  assert.ok(Math.abs(m.total.produccion - 1020.1) < 1e-9);
  assert.ok(Math.abs(m.total.consumo - 794.9) < 1e-9);
  assert.equal(m.total.meses, 2);
  assert.deepEqual(m.pico, { mes: "2026-06", kwh: 673.1 });
});

test("elige el año más reciente con al menos dos meses medidos", () => {
  const meses = [mes("2025-05", 300, 280, 31), mes("2025-06", 600, 400, 30), mes("2026-01", 90, 300, 31)];
  assert.equal(modeloAnual(meses).anio, 2025);
  assert.equal(modeloAnual([...meses, mes("2026-02", 120, 280, 28)]).anio, 2026);
});

test("sin producción no hay escala ni arco", () => {
  assert.equal(modeloAnual([mes("2026-05", 0, 300, 31), mes("2026-06", 0, 200, 30)]), null);
});

test("la geometría es la del arco de Ahora", () => {
  const m = modeloAnual([mes("2026-05", 347, 300, 31), mes("2026-06", 673.1, 494.9, 30)]);
  assert.deepEqual(m.geometria, { cx: CX, cy: CY, r: R, lmax: LMAX, lcasa: LCASA });
});

test("modeloAnual es pura: no modifica la entrada", () => {
  const entrada = congelar([mes("2026-06", 673.1, 494.9, 30), mes("2026-05", 347, 300, 31)]);
  assert.doesNotThrow(() => modeloAnual(entrada));
  assert.equal(entrada[0].mes, "2026-06");
});

test("la parte pura no toca el DOM, localStorage ni la red", () => {
  const codigo = readFileSync(new URL("../js/anual.js", import.meta.url), "utf8");
  const pura = codigo.slice(0, codigo.indexOf("// --- Pintado"));
  assert.ok(pura.length > 0);
  assert.doesNotMatch(pura, /document\.|localStorage|fetch\(|window\./);
});
