import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const raiz = new URL("../", import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, raiz), "utf8");

const COMMIT = "2b75f3ad12b420c9504ef05df8d2564a28f8500e";
const LICENCIA_PHOSPHOR = "b5b1f1da112d18ea2147decfd48ddc1bf2b5aeb6c265381579340e95b15a2bb2";

// §3.5: símbolo → fichero de assets/light/ en phosphor-icons/core.
const PHOSPHOR = {
  "i-datos": "tray-arrow-down",
  "i-cuadra": "scales",
  "i-meses": "calendar-blank",
  "i-ajustes": "sliders-horizontal",
  "i-cerrar": "x",
  "i-sol": "sun",
  "i-casa": "house",
  "i-bateria": "battery-high",
  "i-red": "plug",
  "i-contador": "gauge",
  "i-documento": "file-text",
  "i-euro": "currency-eur",
  "i-reloj": "clock",
  "i-prevision": "cloud-sun",
  "i-senal": "broadcast",
  "i-potencia": "lightning",
  "i-rumbo": "compass",
  "i-aviso": "warning",
  "i-lavadora": "washing-machine",
  "i-lavavajillas": "fork-knife",
  "i-secadora": "wind",
  "i-horno": "oven",
  "i-vitro": "cooking-pot",
  "i-nevera": "snowflake",
  "i-acuario": "fish",
  "i-gambario": "shrimp",
  "i-desconocido": "question",
};
const PROPIOS = ["i-ahora", "i-dia", "f-bien", "f-cuidado", "f-evita"];

const html = leer("index.html");
const simbolos = [...html.matchAll(/<symbol id="([\w-]+)" data-origen="(\w+)"/g)].map((m) => ({ id: m[1], origen: m[2] }));

test("la licencia de Phosphor es la del commit de origen, íntegra", () => {
  const huella = createHash("sha256").update(readFileSync(new URL("vendor/phosphor/LICENSE", raiz))).digest("hex");
  assert.equal(huella, LICENCIA_PHOSPHOR);
  assert.match(leer("vendor/phosphor/LICENSE"), /Copyright \(c\) 2023 Phosphor Icons/);
});

test("el sprite empieza con el aviso de copyright y el commit exacto", () => {
  const sprite = html.match(/<svg[^>]*class="sprite"[^>]*>\s*<!--([\s\S]*?)-->/);
  assert.ok(sprite, "falta el sprite o su comentario inicial");
  for (const parte of ["Phosphor Icons", "Copyright (c) 2023 Phosphor Icons", "MIT", `phosphor-icons/core@${COMMIT}`, "vendor/phosphor/LICENSE"]) {
    assert.ok(sprite[1].includes(parte), parte);
  }
});

test("el sprite tiene exactamente los símbolos de Phosphor y los propios de la especificación", () => {
  assert.deepEqual(simbolos.filter((s) => s.origen === "phosphor").map((s) => s.id).sort(), Object.keys(PHOSPHOR).sort());
  assert.deepEqual(simbolos.filter((s) => s.origen === "propio").map((s) => s.id).sort(), [...PROPIOS].sort());
  assert.equal(simbolos.length, Object.keys(PHOSPHOR).length + PROPIOS.length);
});

test("ORIGEN.txt registra el commit y una línea por icono copiado", () => {
  const origen = leer("vendor/phosphor/ORIGEN.txt");
  assert.ok(origen.includes(`github.com/phosphor-icons/core`));
  assert.ok(origen.includes(COMMIT));
  const lineas = [...origen.matchAll(/^(i-[\w-]+)\s+(assets\/light\/[\w-]+-light\.svg)\s+([0-9a-f]{64})$/gm)];
  assert.equal(lineas.length, Object.keys(PHOSPHOR).length);
  for (const [, id, ruta] of lineas) assert.equal(ruta, `assets/light/${PHOSPHOR[id]}-light.svg`, id);
});

test("el README cita las licencias de IBM Plex y de Phosphor", () => {
  const readme = leer("README.md");
  assert.match(readme, /IBM Plex/);
  assert.match(readme, /SIL Open Font License/);
  assert.match(readme, /Phosphor/);
  assert.match(readme, /MIT/);
});
