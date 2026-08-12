// Sincroniza el historico entre dispositivos a traves de un Worker de Cloudflare.
// El navegador cifra antes de subir: en la nube solo hay un churro ilegible.

import { paqueteActual, fusionarPaquete } from "./historico.js";

const CLAVE_URL = "solar-monitor-nube-url";
const CLAVE_MAESTRA = "solar-monitor-nube-clave";

// Se rellena cuando el Worker este desplegado; hasta entonces se pide en los ajustes.
const URL_POR_DEFECTO = "";

const texto = (cadena) => new TextEncoder().encode(cadena);
const aBase64 = (datos) => btoa(String.fromCharCode(...new Uint8Array(datos)));
const deBase64 = (cadena) => Uint8Array.from(atob(cadena), (c) => c.charCodeAt(0));
const aHex = (datos) => [...new Uint8Array(datos)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const urlNube = () => localStorage.getItem(CLAVE_URL) || URL_POR_DEFECTO;
export const claveMaestra = () => localStorage.getItem(CLAVE_MAESTRA) || "";
export const hayNube = () => Boolean(urlNube() && claveMaestra());

export const generarClave = () => aBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function configurarNube(url, maestra) {
  const limpia = url.trim().replace(/\/+$/, "");
  if (limpia) localStorage.setItem(CLAVE_URL, limpia);
  else localStorage.removeItem(CLAVE_URL);
  if (maestra.trim()) localStorage.setItem(CLAVE_MAESTRA, maestra.trim());
  else localStorage.removeItem(CLAVE_MAESTRA);
}

// De una sola clave salen dos cosas distintas: la credencial que ve el Worker
// y la clave de cifrado, que no sale nunca del navegador.
async function derivar() {
  const cruda = claveMaestra().replace(/-/g, "+").replace(/_/g, "/");
  const material = await crypto.subtle.importKey("raw", deBase64(cruda.padEnd(Math.ceil(cruda.length / 4) * 4, "=")), "HKDF", false, ["deriveBits", "deriveKey"]);
  const comun = { name: "HKDF", hash: "SHA-256", salt: new Uint8Array() };
  const id = await crypto.subtle.deriveBits({ ...comun, info: texto("solar-monitor-credencial") }, material, 256);
  const clave = await crypto.subtle.deriveKey({ ...comun, info: texto("solar-monitor-cifrado") }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { id: aHex(id), clave };
}

async function cifrar(clave, objeto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cripto = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, clave, texto(JSON.stringify(objeto)));
  const junto = new Uint8Array(iv.length + cripto.byteLength);
  junto.set(iv);
  junto.set(new Uint8Array(cripto), iv.length);
  return aBase64(junto);
}

async function descifrar(clave, cadena) {
  const junto = deBase64(cadena);
  const plano = await crypto.subtle.decrypt({ name: "AES-GCM", iv: junto.slice(0, 12) }, clave, junto.slice(12));
  return JSON.parse(new TextDecoder().decode(plano));
}

async function llamar(metodo, id, cuerpo) {
  const respuesta = await fetch(`${urlNube()}/historico`, {
    method: metodo,
    headers: { Authorization: `Bearer ${id}`, "Content-Type": "text/plain" },
    body: cuerpo,
  });
  if (respuesta.status === 401) throw new Error("La clave maestra no coincide con la del Worker.");
  return respuesta;
}

export async function bajarDeNube() {
  const { id, clave } = await derivar();
  const respuesta = await llamar("GET", id);
  if (respuesta.status === 404) return { vacio: true };
  if (!respuesta.ok) throw new Error(`La nube ha respondido ${respuesta.status}.`);
  let paquete;
  try {
    paquete = await descifrar(clave, await respuesta.text());
  } catch {
    throw new Error("No se ha podido descifrar: la clave maestra no es la que cifro estos datos.");
  }
  return fusionarPaquete(paquete);
}

export async function subirANube() {
  const { id, clave } = await derivar();
  const respuesta = await llamar("PUT", id, await cifrar(clave, paqueteActual()));
  if (!respuesta.ok) throw new Error(`La nube ha respondido ${respuesta.status}.`);
  return respuesta.json();
}

// Al guardar se sube, pero sin atosigar: se espera a que pare de haber cambios.
let pendiente = null;
export function sincronizarPronto(alTerminar) {
  if (!hayNube()) return;
  clearTimeout(pendiente);
  pendiente = setTimeout(async () => {
    try {
      alTerminar(null, await subirANube());
    } catch (error) {
      alTerminar(error);
    }
  }, 2500);
}
