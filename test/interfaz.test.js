import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const raiz = new URL("../", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, raiz), "utf8");
const css = leer("styles.css");

// Glifos que IBM Plex no tiene (§2.1): pasan a SVG.
const SIN_GLIFO = /[\u25CF\u25B2\u25A0\u2715\u2699]/u;

test("la interfaz no escribe emojis ni glifos sin fuente", () => {
  for (const fichero of ["index.html", "js/app.js", "js/ahora.js", "js/graficas.js"]) {
    const texto = leer(fichero);
    assert.doesNotMatch(texto, /\p{Extended_Pictographic}/u, fichero);
    assert.doesNotMatch(texto, SIN_GLIFO, fichero);
  }
});

// §6.2: el movimiento se activa, no se desactiva.
const sinMovimiento = css.replace(
  /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,
  ""
);

test("toda transición y animación vive dentro de prefers-reduced-motion: no-preference", () => {
  assert.match(css, /prefers-reduced-motion:\s*no-preference/);
  assert.doesNotMatch(sinMovimiento, /(?:^|[\s;{])(?:transition|animation)(?:-[a-z-]+)?\s*:/m);
});

test("fuera de ese bloque no hay transformaciones", () => {
  assert.doesNotMatch(sinMovimiento, /(?:^|[\s;{])transform\s*:/m);
});

test("el foco es de 2 px en --sol para todos los interactivos", () => {
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--sol\)/);
});
