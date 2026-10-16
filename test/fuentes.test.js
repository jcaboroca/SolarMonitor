import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const raiz = new URL("../", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, raiz), "utf8");
const sha256 = (ruta) => createHash("sha256").update(readFileSync(new URL(ruta, raiz))).digest("hex");

// Copiados byte a byte de github.com/IBM/plex, commit 71f558992315a12ca1f06a2215d57962a1992162
// (§2.1–2.2). Cualquier diferencia significa que el fichero no es el oficial.
const OFICIALES = {
  "IBM Plex Sans Var-Roman-Latin1.woff2": "a18d94ea83c93f0a465d0976d8bc8ecbb031225dbaf76fd201d4e724a972034f",
  "IBM Plex Sans Var-Roman-Pi.woff2": "0273a6b0411acbccb52b7d55af2bae2c58b35d68d6795a28c2f4db7ab21accbc",
  "IBM Plex Mono Var-Roman-Latin1.woff2": "632cb6cee5e90d89bd4354ff362bcffcef1384c19b603ddd2830561716e1f440",
  "IBM Plex Mono Var-Roman-Pi.woff2": "0f4106b9f16d23589dde8426b326355e271002dc666ffcdca2b837258bc8662e",
  "license.txt": "91c25c350d3cac39da2736d74f7ba37ef648f5237a4e330a240615bc8d8c4360",
};

// unicode-range literales del CSS oficial de cada familia.
const RANGOS = {
  "Plex Sans|Latin1":
    "U+0000, U+000D, U+0020-007E, U+00A0-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC, U+2013-2014, U+2018-201A, U+201C-201E, U+2020-2022, U+2026, U+2030, U+2039-203A, U+2044, U+20AC, U+2122, U+2212, U+FB01-FB02",
  "Plex Sans|Pi":
    "U+0E3F, U+2000-200D, U+2015, U+2028-2029, U+202F, U+2032-2033, U+2070, U+2074-2079, U+2080-2089, U+2113, U+2116, U+2126, U+212E, U+2150-2151, U+2153-215E, U+2190-2199, U+21A9-21AA, U+21B0-21B3, U+21B6-21B7, U+21BA-21BB, U+21C4, U+21C6, U+2202, U+2206, U+220F, U+2211, U+2215, U+221A, U+221E, U+222B, U+2248, U+2260, U+2264-2265, U+25CA, U+2713, U+274C, U+2B0E-2B11, U+ECE0, U+EFCC, U+FEFF, U+FFFD",
  "Plex Mono|Latin1":
    "U+0020-007E, U+00A0-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC, U+2013-2014, U+2018-201A, U+201C-201E, U+2020-2022, U+2026, U+2030, U+2039-203A, U+2044, U+20AC, U+2122, U+2212, U+FB01-FB02",
  "Plex Mono|Pi":
    "U+03C0, U+0E3F, U+2000-200D, U+2010-2012, U+2015, U+2028-2029, U+202F, U+2032-2033, U+203E, U+205F, U+2070, U+2074-2079, U+2080-2089, U+2113, U+2116, U+2126, U+212E, U+2150-2151, U+2153-215E, U+2190-2199, U+21A9-21AA, U+21B0-21B3, U+21B6-21B7, U+21BA-21BB, U+21C4, U+21C6, U+2202, U+2206, U+220F, U+2211, U+2215, U+2219-221A, U+221E, U+222B, U+2236, U+2248, U+2260, U+2264-2265, U+2400-2421, U+2500-259F, U+25CA, U+2713, U+274C, U+2B0E-2B11, U+3000, U+FEFF, U+FFFD",
};

const css = leer("styles.css");
const caras = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const propiedad = (nombre) => m[1].match(new RegExp(`${nombre}\\s*:\\s*([^;]+);`))?.[1].trim() ?? null;
  return {
    familia: propiedad("font-family")?.replace(/"/g, ""),
    src: propiedad("src"),
    peso: propiedad("font-weight"),
    anchura: propiedad("font-stretch"),
    display: propiedad("font-display"),
    rango: propiedad("unicode-range")?.replace(/\s+/g, " "),
  };
});

test("vendor/fuentes contiene exactamente los ficheros oficiales, sin modificar", () => {
  assert.deepEqual(readdirSync(new URL("vendor/fuentes/", raiz)).sort(), Object.keys(OFICIALES).sort());
  for (const [nombre, huella] of Object.entries(OFICIALES)) assert.equal(sha256(`vendor/fuentes/${nombre}`), huella, nombre);
});

test("hay una cara por familia y subconjunto, con el rango oficial y sin local()", () => {
  assert.equal(caras.length, 4);
  for (const cara of caras) {
    const subconjunto = /Latin1/.test(cara.src) ? "Latin1" : "Pi";
    assert.equal(cara.rango, RANGOS[`${cara.familia}|${subconjunto}`], `${cara.familia} ${subconjunto}`);
    assert.doesNotMatch(cara.src, /local\(/);
    assert.equal(cara.display, "swap");
    assert.equal(cara.peso, "100 700");
    const fichero = decodeURIComponent(cara.src.match(/url\("vendor\/fuentes\/([^"]+)"\)/)[1]);
    assert.ok(fichero in OFICIALES, fichero);
    assert.match(fichero, cara.familia === "Plex Sans" ? /Sans Var/ : /Mono Var/);
  }
});

test("Sans declara el eje de anchura 85–100 % y Mono no declara anchura", () => {
  assert.equal(caras.length, 4);
  for (const cara of caras) assert.equal(cara.anchura, cara.familia === "Plex Sans" ? "85% 100%" : null, cara.src);
});

test("solo se precargan los dos Latin1, con crossorigin", () => {
  const precargas = [...leer("index.html").matchAll(/<link rel="preload"[^>]*>/g)].map((m) => m[0]);
  assert.equal(precargas.length, 2);
  for (const p of precargas) {
    assert.match(p, /as="font"/);
    assert.match(p, /type="font\/woff2"/);
    assert.match(p, /crossorigin/);
    assert.match(p, /Latin1\.woff2"/);
  }
});

test("las cifras usan Plex Mono y el texto Plex Sans", () => {
  assert.match(css, /--sans:\s*"Plex Sans",/);
  assert.match(css, /--mono:\s*"Plex Mono",/);
  assert.match(leer("js/graficas.js"), /Plex Mono/);
});
