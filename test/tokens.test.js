import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";

const raiz = new URL("../", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, raiz), "utf8");

// Paleta aprobada (§1.1 y §1.2 de la especificación).
const PALETA = {
  "--fondo": "#14110E",
  "--pozo": "#0F0D0B",
  "--superficie": "#1C1814",
  "--superficie-2": "#26211B",
  "--linea": "#2E2822",
  "--escala": "#74685A",
  "--texto": "#EEE7DB",
  "--texto-2": "#ADA293",
  "--texto-3": "#9A8F80",
  "--sol": "#EBC25E",
  "--sol-tenue": "#9A7F3E",
  "--coral": "#E57A5F",
  "--vertido": "#6DB8B0",
  "--estano": "#A9B8C6",
  "--bien": "#9CC47E",
};
const ALIAS = { "--casa": "--texto", "--cuidado": "--sol", "--evita": "--coral" };
const HEX_APROBADOS = new Set(Object.values(PALETA).map((h) => h.toUpperCase()));
const GITHUB_DARK = ["#0d1117", "#161b22", "#1c232c", "#262d38", "#e6edf3", "#8b98a9"];

const css = leer("styles.css");
const raices = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
const fueraDeRaiz = css.replace(/:root\s*\{[^}]*\}/g, "");
const hexDe = (texto) => [...texto.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toUpperCase());

function ficheros(dir) {
  return readdirSync(new URL(dir, raiz)).flatMap((n) => {
    const ruta = `${dir}${n}`;
    return statSync(new URL(ruta, raiz)).isDirectory() ? ficheros(`${ruta}/`) : [ruta];
  });
}

function tono(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const declaraciones = (bloque) => [...bloque.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);

test("el primer :root define exactamente la paleta aprobada y sus alias", () => {
  const declarado = Object.fromEntries(declaraciones(raices[0]));
  for (const [token, hex] of Object.entries(PALETA)) assert.equal(declarado[token]?.toUpperCase(), hex, token);
  for (const [alias, destino] of Object.entries(ALIAS)) assert.equal(declarado[alias], `var(${destino})`, alias);
  const coloresDeclarados = Object.entries(declarado).filter(([, v]) => /^#/.test(v));
  assert.deepEqual(coloresDeclarados.map(([k]) => k).sort(), Object.keys(PALETA).sort());
});

test("los demás :root (prefers-contrast…) solo reasignan tokens a otros tokens", () => {
  for (const bloque of raices.slice(1)) {
    for (const [token, valor] of declaraciones(bloque)) {
      assert.ok(token in PALETA, token);
      assert.match(valor, /^var\(--[\w-]+\)$/, `${token}: ${valor}`);
    }
  }
});

test("fuera de :root no hay colores literales", () => {
  assert.deepEqual(hexDe(fueraDeRaiz), []);
  assert.doesNotMatch(fueraDeRaiz, /\b(?:rgba?|hsla?)\(/);
  assert.doesNotMatch(fueraDeRaiz, /(?<![\w-])(?:black|white)(?![\w-])/);
});

test("color-mix solo mezcla tokens con tokens o con transparent", () => {
  for (const [, dentro] of fueraDeRaiz.matchAll(/color-mix\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    const partes = dentro.split(",").slice(1).map((p) => p.trim().replace(/\s+\d+%$/, ""));
    for (const p of partes) assert.match(p, /^(?:var\(--[\w-]+\)|transparent)$/, dentro);
  }
});

test("no hay sombras", () => {
  assert.doesNotMatch(css, /(?:box|text)-shadow/);
});

test("ningún tono de la paleta cae entre 250° y 320°", () => {
  for (const hex of HEX_APROBADOS) {
    const h = tono(hex);
    assert.ok(h === null || h < 250 || h > 320, `${hex} → ${h}`);
  }
});

test("las copias literales fuera de styles.css son colores de la paleta", () => {
  const copias = [
    "index.html",
    "manifest.webmanifest",
    ...ficheros("assets/").filter((f) => f.endsWith(".svg")),
    ...ficheros("js/"),
  ];
  for (const fichero of copias) {
    for (const hex of hexDe(leer(fichero))) assert.ok(HEX_APROBADOS.has(hex), `${fichero}: ${hex}`);
  }
});

test("el manifiesto usa --fondo como color de tema y de fondo", () => {
  const manifiesto = JSON.parse(leer("manifest.webmanifest"));
  assert.equal(manifiesto.theme_color.toUpperCase(), PALETA["--fondo"]);
  assert.equal(manifiesto.background_color.toUpperCase(), PALETA["--fondo"]);
});

test("ningún color de GitHub Dark queda en la interfaz", () => {
  const todos = ["styles.css", "index.html", "manifest.webmanifest", ...ficheros("assets/"), ...ficheros("js/")];
  for (const fichero of todos) {
    const texto = leer(fichero).toLowerCase();
    for (const color of GITHUB_DARK) assert.ok(!texto.includes(color), `${fichero}: ${color}`);
  }
});
