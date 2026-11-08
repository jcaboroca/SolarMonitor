import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, createHash, createDecipheriv, generateKeyPairSync, hkdfSync, randomBytes, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { b64url, deB64url, validarSuscripcion, idSuscripcion, cifrarPayload, firmarVapid, enviarPush, configVapid } from "../worker/src/push.js";

const ENDPOINT = "https://web.push.apple.com/QGxQ-abc_DEF123";

function dispositivo() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) } };
}

// Descifrado independiente, escrito desde RFC 8188/8291 con node:crypto (no comparte codigo con el Worker).
function descifrar({ ecdh, auth }, cuerpo) {
  const salt = cuerpo.subarray(0, 16);
  const rs = cuerpo.readUInt32BE(16);
  const idlen = cuerpo[20];
  const asPublica = cuerpo.subarray(21, 21 + idlen);
  const cifrado = cuerpo.subarray(21 + idlen);
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);
  const secreto = ecdh.computeSecret(asPublica);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublica]);
  const ikm = Buffer.from(hkdfSync("sha256", secreto, auth, info, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(cifrado.subarray(-16));
  const plano = Buffer.concat([d.update(cifrado.subarray(0, -16)), d.final()]);
  assert.equal(plano.at(-1), 2); // delimitador del ultimo registro
  return plano.subarray(0, -1);
}

function vapidDePrueba() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const publica = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return { publicKey, entorno: { VAPID_PUBLIC_KEY: b64url(publica), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: "mailto:operador@ejemplo.test" } };
}

test("el cifrado aes128gcm de Web Push lo descifra una implementacion independiente", async () => {
  const d = dispositivo();
  const texto = JSON.stringify({ tipo: "informe", fecha: "2026-11-07", texto: "Tu informe solar está disponible" });
  const cuerpo = Buffer.from(await cifrarPayload(new TextEncoder().encode(texto), d.keys));
  assert.equal(descifrar(d, cuerpo).toString("utf8"), texto);
  const otro = Buffer.from(await cifrarPayload(new TextEncoder().encode(texto), d.keys));
  assert.notDeepEqual(cuerpo, otro); // sal y clave efimera nuevas cada vez
  assert.throws(() => descifrar(dispositivo(), cuerpo));
});

test("un payload demasiado grande se rechaza antes de cifrar", async () => {
  await assert.rejects(cifrarPayload(new Uint8Array(4000), dispositivo().keys), /grande/);
});

test("la firma VAPID es un ES256 valido con las reclamaciones correctas", async () => {
  const { publicKey, entorno } = vapidDePrueba();
  const ahora = Date.UTC(2026, 10, 8, 7, 30);
  const { authorization } = await firmarVapid(ENDPOINT, entorno, ahora);
  const m = authorization.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m, authorization);
  assert.equal(m[4], entorno.VAPID_PUBLIC_KEY);
  assert.deepEqual(JSON.parse(Buffer.from(m[1], "base64url")), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(Buffer.from(m[2], "base64url"));
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.equal(claims.sub, "mailto:operador@ejemplo.test");
  assert.ok(claims.exp > ahora / 1000 && claims.exp - ahora / 1000 <= 86400);
  const firma = Buffer.from(m[3], "base64url");
  assert.equal(firma.length, 64);
  assert.ok(verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, firma));
});

test("sin claves VAPID el envio falla con un mensaje claro", async () => {
  assert.equal(configVapid({}).ok, false);
  assert.match(configVapid({ VAPID_PUBLIC_KEY: "x" }).error, /VAPID/);
  assert.equal(configVapid({ ...vapidDePrueba().entorno, VAPID_SUBJECT: "ftp://x" }).ok, false);
  assert.equal(configVapid(vapidDePrueba().entorno).ok, true);
});

test("solo se aceptan suscripciones de los servicios push oficiales y claves del tamaño correcto", () => {
  const d = dispositivo();
  const ok = (endpoint) => validarSuscripcion({ endpoint, keys: d.keys }).ok;
  assert.equal(ok(ENDPOINT), true);
  assert.equal(ok("https://fcm.googleapis.com/fcm/send/abc:def"), true);
  assert.equal(ok("https://updates.push.services.mozilla.com/wpush/v2/abc"), true);
  assert.equal(ok("https://sub.push.apple.com/x"), true);
  for (const malo of [
    "http://web.push.apple.com/x",
    "https://evil.example/x",
    "https://web.push.apple.com.evil.example/x",
    "https://evilpush.apple.com/x",
    "https://user:pw@web.push.apple.com/x",
    "https://web.push.apple.com:8443/x",
    "https://127.0.0.1/x",
    "https://localhost/x",
    "https://fcm.googleapis.com.attacker.test/",
    `https://web.push.apple.com/${"a".repeat(2000)}`,
    "no es una url",
    123,
  ]) assert.equal(ok(malo), false, String(malo).slice(0, 60));
  assert.equal(validarSuscripcion({ endpoint: ENDPOINT, keys: { p256dh: b64url(randomBytes(64)), auth: d.keys.auth } }).ok, false);
  assert.equal(validarSuscripcion({ endpoint: ENDPOINT, keys: { p256dh: b64url(Buffer.concat([Buffer.from([2]), randomBytes(64)])), auth: d.keys.auth } }).ok, false);
  assert.equal(validarSuscripcion({ endpoint: ENDPOINT, keys: { p256dh: d.keys.p256dh, auth: b64url(randomBytes(8)) } }).ok, false);
  assert.equal(validarSuscripcion(null).ok, false);
  assert.equal(validarSuscripcion({ endpoint: ENDPOINT }).ok, false);
});

test("el id de suscripcion es un hash corto y no contiene el endpoint", async () => {
  const id = await idSuscripcion(ENDPOINT);
  assert.equal(id, createHash("sha256").update(ENDPOINT).digest("hex").slice(0, 24));
  assert.doesNotMatch(id, /apple/);
});

test("enviarPush: cabeceras, redirecciones no seguidas y clasificacion de respuestas", async () => {
  const d = dispositivo();
  const { entorno } = vapidDePrueba();
  const sub = { endpoint: ENDPOINT, keys: d.keys };
  const llamadas = [];
  const con = (estado) => async (url, init) => (llamadas.push([url, init]), new Response(null, { status: estado }));
  const payload = { tipo: "informe", fecha: "2026-11-07" };

  assert.equal((await enviarPush(sub, payload, entorno, { pedir: con(201) })).resultado, "enviado");
  const [url, init] = llamadas[0];
  assert.equal(url, ENDPOINT);
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual");
  assert.equal(init.headers["Content-Encoding"], "aes128gcm");
  assert.ok(Number(init.headers.TTL) > 0);
  assert.match(init.headers.Authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse(descifrar(d, Buffer.from(init.body))), payload);

  for (const [estado, esperado] of [[404, "expirada"], [410, "expirada"], [429, "transitorio"], [500, "transitorio"], [503, "transitorio"], [400, "rechazada"], [403, "rechazada"], [301, "rechazada"], [302, "rechazada"]]) {
    assert.equal((await enviarPush(sub, payload, entorno, { pedir: con(estado) })).resultado, esperado, String(estado));
  }
  const red = await enviarPush(sub, payload, entorno, { pedir: async () => { throw new Error(`fallo con ${ENDPOINT}`); } });
  assert.equal(red.resultado, "transitorio");
  assert.doesNotMatch(JSON.stringify(red), /apple\.com|QGxQ/);
});

test("enviarPush no hace ninguna peticion si el endpoint no es de la lista", async () => {
  const d = dispositivo();
  const r = await enviarPush({ endpoint: "https://evil.example/x", keys: d.keys }, {}, vapidDePrueba().entorno, { pedir: async () => assert.fail("no debe pedir") });
  assert.equal(r.resultado, "rechazada");
});

test("enviarPush sin claves VAPID no pide nada", async () => {
  const r = await enviarPush({ endpoint: ENDPOINT, keys: dispositivo().keys }, {}, {}, { pedir: async () => assert.fail("no debe pedir") });
  assert.equal(r.resultado, "sin_vapid");
});

test("el script del operador genera un par VAPID usable y no escribe ficheros", () => {
  const salida = execFileSync(process.execPath, ["scripts/generar-vapid.mjs"], { encoding: "utf8" });
  const publica = salida.match(/VAPID_PUBLIC_KEY=(\S+)/)[1];
  const privada = salida.match(/VAPID_PRIVATE_KEY=(\S+)/)[1];
  assert.equal(deB64url(publica).length, 65);
  assert.equal(deB64url(privada).length, 32);
  assert.match(salida, /wrangler secret put VAPID_PRIVATE_KEY/);
});
