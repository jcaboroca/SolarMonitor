// Buzon cifrado para el historico de Solar Monitor.
// Solo guarda y devuelve un churro: la clave de descifrado nunca sale del navegador.

const ORIGEN_WEB = "https://jcaboroca.github.io";
// Las curvas de Solarman van a 5 minutos y abultan; KV admite hasta 25 MB.
const LIMITE = 20 * 1024 * 1024;

// El origen no es la seguridad (esa es la credencial); solo abre el navegador a la web propia.
const permitido = (origen) => origen === ORIGEN_WEB || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origen);

const cabeceras = (origen) => ({
  "Access-Control-Allow-Origin": permitido(origen) ? origen : ORIGEN_WEB,
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

// Comparacion en tiempo constante: no delata la clave a base de medir respuestas.
function coincide(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

export default {
  async fetch(peticion, entorno) {
    const origen = peticion.headers.get("Origin") || "";
    const cors = cabeceras(origen);
    const responder = (cuerpo, estado = 200, tipo = "text/plain") =>
      new Response(cuerpo, { status: estado, headers: { ...cors, "Content-Type": tipo, "Cache-Control": "no-store" } });

    if (peticion.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(peticion.url);
    if (url.pathname !== "/historico") return responder("No hay nada aqui.", 404);

    const credencial = (peticion.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!coincide(credencial, entorno.SOLAR_ID)) return responder("Clave incorrecta.", 401);

    if (peticion.method === "GET") {
      const guardado = await entorno.HISTORICO.get("paquete");
      return guardado ? responder(guardado, 200, "application/json") : responder("Aun no hay nada guardado.", 404);
    }

    if (peticion.method === "PUT") {
      const cuerpo = await peticion.text();
      if (cuerpo.length > LIMITE) return responder(`Demasiado grande: ${Math.round(cuerpo.length / 1024)} kB.`, 413);
      await entorno.HISTORICO.put("paquete", cuerpo);
      return responder(JSON.stringify({ guardado: new Date().toISOString(), bytes: cuerpo.length }), 200, "application/json");
    }

    return responder("Metodo no permitido.", 405);
  },
};
