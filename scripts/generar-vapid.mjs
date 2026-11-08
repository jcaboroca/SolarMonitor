// Genera el par de claves VAPID para las notificaciones push. Lo ejecuta el operador, una vez:
//   node scripts/generar-vapid.mjs
// Solo escribe por pantalla (no crea ficheros). Guarda la privada como secret de Cloudflare;
// nunca la subas al repositorio.

const b64url = (datos) => Buffer.from(datos).toString("base64url");

const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publica = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", par.privateKey);

console.log(`VAPID_PUBLIC_KEY=${b64url(publica)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log(`
Pasos (desde la carpeta worker/):
  npx wrangler secret put VAPID_PUBLIC_KEY    # pega el valor de VAPID_PUBLIC_KEY
  npx wrangler secret put VAPID_PRIVATE_KEY   # pega el valor de VAPID_PRIVATE_KEY (secreto)
  npx wrangler secret put VAPID_SUBJECT       # por ejemplo mailto:tu-correo@ejemplo.com
Cambiar las claves invalida las suscripciones ya hechas: hay que volver a activar el aviso en cada dispositivo.`);
