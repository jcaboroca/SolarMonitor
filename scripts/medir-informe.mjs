// Mide la CPU de generar el informe diario con datos sinteticos de un mes completo.
// Uso: node scripts/medir-informe.mjs   (no usa red ni datos reales)
import { generarInforme, programado } from "../worker/src/informe.js";
import { limitesDia, sumarDias } from "../worker/src/horario.js";

const AHORA = Date.UTC(2026, 10, 30, 7, 30); // 08:30 en Madrid
const AYER = "2026-11-29";

function kvEnMemoria(inicial) {
  const m = new Map(Object.entries(inicial).map(([k, v]) => [k, JSON.stringify(v)]));
  return { get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) };
}

const dias = {};
for (let d = 1; d <= 29; d++) {
  const fecha = `2026-11-${String(d).padStart(2, "0")}`;
  const { inicio, fin } = limitesDia(fecha);
  const puntos = [];
  for (let t = inicio / 1000; t < fin / 1000; t += 300) puntos.push([t, 900, 400, 100, 0, 0, 0, 55]);
  dias[fecha.slice(8)] = puntos;
}
const horas = [];
for (let d = 1; d <= 30; d++) {
  const { inicio } = limitesDia(sumarDias("2026-11-01", -d));
  for (let h = 0; h < 24; h++) horas.push([Math.floor((inicio + h * 3600000) / 3600000), 400, h >= 10 && h < 16 ? 800 : 0, 50, 60]);
}
const config = { activo: true, pushActivo: false, consentimiento: true, ubicacion: { lat: 41.3, lon: 2 }, tarifa: { tipo: "plana", precio: 0.12, desde: "2026-01-01", hasta: null, fuente: "sintetica" } };
const resumen = { dias: { [AYER]: 288 }, horas, diarios: {} };

const meteo = (url) => {
  const t = Array.from({ length: 24 * (url.includes("historical") ? 30 : 2) }, (_, i) => limitesDia(sumarDias(url.includes("historical") ? "2026-10-30" : "2026-11-30", 0)).inicio / 1000 + i * 3600 + 3600);
  return new Response(JSON.stringify({ hourly: { time: t, shortwave_radiation: t.map((_, i) => (i % 24 >= 10 && i % 24 < 16 ? 400 : 0)), cloud_cover: t.map(() => 20) } }));
};
const pedir = async (url) => meteo(url);

const ms = (u) => (u.user + u.system) / 1000;
const mide = async (etiqueta, fn) => {
  const a = process.cpuUsage();
  await fn();
  const c = process.cpuUsage(a);
  console.log(`${etiqueta}: ${ms(c).toFixed(1)} ms de CPU`);
};

const nuevo = () => kvEnMemoria({ "informe-config": config, "solarman-curvas": resumen, "solarman-curva-2026-11": { columnas: [], dias } });
// El KV se prepara fuera de la medicion; el JSON.parse al leer si cuenta, como en el Worker.
const kvs = Array.from({ length: 7 }, nuevo);
await mide("generar (primera vez, en frio)", () => generarInforme({ HISTORICO: kvs[0] }, { ahora: AHORA, pedir }));
const veces = [];
for (let i = 1; i < 6; i++) {
  const a = process.cpuUsage();
  await generarInforme({ HISTORICO: kvs[i] }, { ahora: AHORA, pedir });
  veces.push(ms(process.cpuUsage(a)));
}
console.log(`generar (en caliente): ${Math.min(...veces).toFixed(1)}-${Math.max(...veces).toFixed(1)} ms de CPU`);
const completo = kvs[6];
await programado({ HISTORICO: completo }, { ahora: AHORA, pedir });
await mide("cron horario con todo hecho (2 lecturas)", () => programado({ HISTORICO: completo }, { ahora: AHORA + 3600000, pedir }));
console.log("Plan gratuito de Workers: 10 ms de CPU por ejecucion (esperas de red no cuentan).");
