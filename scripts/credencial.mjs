// Deriva la credencial del Worker a partir de una clave maestra, igual que hace el navegador.
// Uso: node scripts/credencial.mjs <clave-maestra>   (sin argumento, genera una nueva)

const texto = (cadena) => new TextEncoder().encode(cadena);
const aBase64url = (datos) => Buffer.from(datos).toString("base64url");

const maestra = process.argv[2] || aBase64url(crypto.getRandomValues(new Uint8Array(32)));
const material = await crypto.subtle.importKey("raw", Buffer.from(maestra, "base64url"), "HKDF", false, ["deriveBits"]);
const id = await crypto.subtle.deriveBits(
  { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: texto("solar-monitor-credencial") },
  material,
  256
);

console.log("clave maestra (pegar en la web):", maestra);
console.log("SOLAR_ID (secret del Worker)  :", Buffer.from(id).toString("hex"));
