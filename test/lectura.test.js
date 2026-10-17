// F4 «¿Cuadra?» y «Mes a mes»: piezas de presentación de js/lectura.js.
import assert from "node:assert/strict";
import { test } from "node:test";
import { reglaDesvio, htmlRegla, htmlCifra } from "../js/lectura.js";

test("la regla está centrada en 0 y llega a ±10 % de borde a borde", () => {
  assert.deepEqual(reglaDesvio(0), { posicion: 0, fuera: 0, tono: "bien" });
  assert.deepEqual(reglaDesvio(10), { posicion: 50, fuera: 0, tono: "mal" });
  assert.deepEqual(reglaDesvio(-10), { posicion: -50, fuera: 0, tono: "mal" });
  assert.equal(reglaDesvio(4.9).posicion, 24.5);
  assert.equal(reglaDesvio(-2.2).posicion, -11);
});

test("fuera de escala la aguja se queda en el borde y lo dice", () => {
  assert.deepEqual(reglaDesvio(1661.7), { posicion: 50, fuera: 1, tono: "mal" });
  assert.deepEqual(reglaDesvio(-35), { posicion: -50, fuera: -1, tono: "mal" });
});

test("la tolerancia es la misma que colorea la diferencia (|desvío| ≤ 5 %)", () => {
  assert.equal(reglaDesvio(5).tono, "bien");
  assert.equal(reglaDesvio(-5).tono, "bien");
  assert.equal(reglaDesvio(5.01).tono, "mal");
});

test("sin factura no hay aguja", () => {
  assert.equal(reglaDesvio(null), null);
  assert.equal(reglaDesvio(Number.NaN), null);
  assert.equal(htmlRegla(null), "");
});

test("htmlRegla dibuja la aguja sin texto: la cifra ya está en la columna Diferencia", () => {
  const html = htmlRegla(4.9);
  assert.match(html, /^<span class="regla-desvio" data-tono="bien" style="--d:24\.5%" aria-hidden="true">/);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ""), /\S/);
  assert.match(htmlRegla(40), /data-fuera="1"/);
  assert.match(htmlRegla(-40), /data-fuera="-1"/);
});

test("htmlCifra conserva rótulo y valor tal cual, con la unidad aparte", () => {
  assert.equal(
    htmlCifra({ rotulo: "Comprado a la red", valor: "138,4", unidad: "kWh", clase: "c-red" }),
    '<dl class="cifra c-red"><dt>Comprado a la red</dt><dd>138,4<span class="u">kWh</span></dd></dl>'
  );
  assert.equal(htmlCifra({ rotulo: "Cubierto sin la red", valor: "72", unidad: "%" }), '<dl class="cifra"><dt>Cubierto sin la red</dt><dd>72<span class="u">%</span></dd></dl>');
});
