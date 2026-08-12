// Comprueba que el Worker responde y que la credencial derivada vale.
// Solo lee: escribir aqui pisaria la copia buena del historico.
// Uso: node scripts/probar-nube.mjs   (lee CLAVE-MAESTRA.txt)

import { readFileSync } from "node:fs";

const URL_NUBE = "https://solar-monitor-nube.mundialisimo.workers.dev";
const texto = (cadena) => new TextEncoder().encode(cadena);

const fichero = readFileSync(new URL("../CLAVE-MAESTRA.txt", import.meta.url), "utf8");
const maestra = fichero.trim().split(/\s+/).find((t) => t.length === 43);
if (!maestra) throw new Error("no encuentro la clave maestra en CLAVE-MAESTRA.txt");

const material = await crypto.subtle.importKey("raw", Buffer.from(maestra, "base64url"), "HKDF", false, ["deriveBits"]);
const id = await crypto.subtle.deriveBits(
  { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: texto("solar-monitor-credencial") },
  material,
  256
);
const cabeceras = { Authorization: "Bearer " + Buffer.from(id).toString("hex") };

const bajada = await fetch(URL_NUBE + "/historico", { headers: cabeceras });
if (bajada.status === 401) console.log("401: la clave maestra no coincide con el secret del Worker");
else if (bajada.status === 404) console.log("404: credencial correcta, pero en la nube no hay nada guardado todavia");
else console.log(bajada.status, `credencial correcta, ${(await bajada.text()).length} bytes cifrados en la nube`);
