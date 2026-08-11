// Los ficheros del programa se piden a la red primero para que una versión nueva
// entre sin trucos; las librerías de vendor van desde memoria porque no cambian.

const CACHE = "solar-monitor-v6";
const BASE = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/datos.js",
  "./js/xlsx.js",
  "./js/factura.js",
  "./js/graficas.js",
  "./js/historico.js",
  "./js/datadis.js",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./assets/icono.svg",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(BASE.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  const peticion = evento.request;
  if (peticion.method !== "GET") return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/vendor/")) {
    evento.respondWith(caches.match(peticion).then((guardada) => guardada || fetch(peticion)));
    return;
  }

  evento.respondWith(
    fetch(new Request(peticion.url, { cache: "no-store", credentials: "same-origin" }))
      .then((respuesta) => {
        if (respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE).then((cache) => cache.put(peticion, copia));
        }
        return respuesta;
      })
      .catch(() => caches.match(peticion).then((guardada) => guardada || caches.match("./index.html")))
  );
});
