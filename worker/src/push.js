// Web Push (RFC 8030) con VAPID (RFC 8292) y cifrado de contenido aes128gcm (RFC 8291 / 8188),
// solo con WebCrypto, que existe tal cual en Cloudflare Workers: sin dependencias.
// Nunca se escribe en logs ni en errores el endpoint completo ni las claves.

const TEXTO = new TextEncoder();
const MAX_PAYLOAD = 3500; // el limite de los servicios push es ~4 kB
const TTL_SEGUNDOS = 6 * 3600;
const REGISTRO = 4096;

export const b64url = (datos) => {
  const bytes = new Uint8Array(datos);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const deB64url = (texto) => {
  if (typeof texto !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(texto)) throw new Error("base64url no valido");
  const limpio = texto.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(limpio.padEnd(Math.ceil(limpio.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
};

const unir = (...trozos) => {
  const salida = new Uint8Array(trozos.reduce((n, t) => n + t.length, 0));
  let o = 0;
  for (const t of trozos) {
    salida.set(t, o);
    o += t.length;
  }
  return salida;
};

const anfitrionPermitido = (h) =>
  h === "web.push.apple.com" || h.endsWith(".push.apple.com") || h === "fcm.googleapis.com" || h === "updates.push.services.mozilla.com" || h.endsWith(".push.services.mozilla.com");

/** Devuelve el endpoint normalizado si es de un servicio push oficial; si no, null. */
export function validarEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 1024) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !anfitrionPermitido(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Valida endpoint (solo servicios push oficiales, sin SSRF) y claves del navegador. */
export function validarSuscripcion(s) {
  const mal = (error) => ({ ok: false, error });
  if (!s || typeof s !== "object" || typeof s.endpoint !== "string" || !s.keys || typeof s.keys !== "object") return mal("Suscripción no válida.");
  if (s.endpoint.length > 1024) return mal("El endpoint es demasiado largo.");
  let url;
  try {
    url = new URL(s.endpoint);
  } catch {
    return mal("El endpoint no es una URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !anfitrionPermitido(url.hostname)) return mal("Ese servicio de notificaciones no está permitido.");
  try {
    const p = deB64url(s.keys.p256dh);
    const a = deB64url(s.keys.auth);
    if (p.length !== 65 || p[0] !== 4) return mal("La clave p256dh no es válida.");
    if (a.length !== 16) return mal("La clave auth no es válida.");
  } catch {
    return mal("Las claves de la suscripción no son válidas.");
  }
  return { ok: true, valor: { endpoint: url.href, keys: { p256dh: s.keys.p256dh.replace(/=+$/, ""), auth: s.keys.auth.replace(/=+$/, "") } } };
}

export async function idSuscripcion(endpoint) {
  const hash = await crypto.subtle.digest("SHA-256", TEXTO.encode(endpoint));
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hkdf(secreto, sal, info, bits) {
  const clave = await crypto.subtle.importKey("raw", secreto, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sal, info }, clave, bits));
}

/** Cifra `datos` para una suscripcion: cabecera (sal, rs, id de clave) + un unico registro. */
export async function cifrarPayload(datos, { p256dh, auth }, { salt = crypto.getRandomValues(new Uint8Array(16)), par = null } = {}) {
  if (datos.length > MAX_PAYLOAD) throw new Error("El contenido es demasiado grande para una notificación.");
  const uaPublica = deB64url(p256dh);
  const authSecreto = deB64url(auth);
  const ua = await crypto.subtle.importKey("raw", uaPublica, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const efimera = par || (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const asPublica = new Uint8Array(await crypto.subtle.exportKey("raw", efimera.publicKey));
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: ua }, efimera.privateKey, 256));
  const ikm = await hkdf(compartido, authSecreto, unir(TEXTO.encode("WebPush: info\0"), uaPublica, asPublica), 256);
  const cek = await hkdf(ikm, salt, TEXTO.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(ikm, salt, TEXTO.encode("Content-Encoding: nonce\0"), 96);
  const clave = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, clave, unir(datos, new Uint8Array([2]))));
  const cabecera = new Uint8Array(21);
  cabecera.set(salt, 0);
  new DataView(cabecera.buffer).setUint32(16, REGISTRO);
  cabecera[20] = asPublica.length;
  return unir(cabecera, asPublica, cifrado);
}

export function configVapid(entorno) {
  const falta = (m) => ({ ok: false, error: `Faltan o no son válidos los secretos VAPID (${m}). Ejecuta scripts/generar-vapid.mjs y sigue las instrucciones del README.` });
  const { VAPID_PUBLIC_KEY: publica, VAPID_PRIVATE_KEY: privada, VAPID_SUBJECT: sujeto } = entorno || {};
  if (!publica || !privada || !sujeto) return falta("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT");
  try {
    const p = deB64url(publica);
    if (p.length !== 65 || p[0] !== 4 || deB64url(privada).length !== 32) return falta("tamaño de clave");
  } catch {
    return falta("formato de clave");
  }
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(sujeto)) return falta("VAPID_SUBJECT debe ser mailto: o https:");
  return { ok: true, publica, privada, sujeto };
}

export async function firmarVapid(endpoint, entorno, ahora = Date.now()) {
  const v = configVapid(entorno);
  if (!v.ok) throw new Error(v.error);
  const p = deB64url(v.publica);
  const jwk = { kty: "EC", crv: "P-256", x: b64url(p.slice(1, 33)), y: b64url(p.slice(33, 65)), d: v.privada, ext: true };
  const clave = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const cabecera = b64url(TEXTO.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(TEXTO.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(ahora / 1000) + 12 * 3600, sub: v.sujeto })));
  const firma = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, clave, TEXTO.encode(`${cabecera}.${claims}`)));
  return { authorization: `vapid t=${cabecera}.${claims}.${b64url(firma)}, k=${v.publica}` };
}

/** resultado: enviado | expirada (404/410: borrar) | transitorio (reintentar) | rechazada | sin_vapid */
export async function enviarPush(suscripcion, payload, entorno, { pedir = fetch, ahora = Date.now() } = {}) {
  if (!configVapid(entorno).ok) return { resultado: "sin_vapid" };
  const valida = validarSuscripcion(suscripcion);
  if (!valida.ok) return { resultado: "rechazada", motivo: "endpoint_no_permitido" };
  const { endpoint, keys } = valida.valor;
  let respuesta;
  try {
    const cuerpo = await cifrarPayload(TEXTO.encode(JSON.stringify(payload)), keys);
    const { authorization } = await firmarVapid(endpoint, entorno, ahora);
    respuesta = await pedir(endpoint, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: authorization, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(TTL_SEGUNDOS), Urgency: "normal" },
      body: cuerpo,
    });
  } catch {
    return { resultado: "transitorio", motivo: "red" };
  }
  const e = respuesta.status;
  if (e >= 200 && e < 300) return { resultado: "enviado", estado: e };
  if (e === 404 || e === 410) return { resultado: "expirada", estado: e };
  if (e === 429 || e >= 500) return { resultado: "transitorio", estado: e };
  return { resultado: "rechazada", estado: e };
}
