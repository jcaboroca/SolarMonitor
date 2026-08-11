// Cliente de la API privada de datadis. Se llama desde el navegador del usuario:
// la contraseña sirve para pedir el token y no se guarda en ningún sitio.

const AUTENTICAR = "https://datadis.es/nikola-auth/tokens/login";
const BASE = "https://datadis.es/api-private/api";

let token = null;

export const haySesion = () => Boolean(token);
export const cerrarSesion = () => {
  token = null;
};

export async function entrar(nif, contrasena) {
  const respuesta = await fetch(AUTENTICAR, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: nif.trim(), password: contrasena }),
  });
  const texto = (await respuesta.text()).trim();
  if (!respuesta.ok || !texto) {
    throw new Error(texto.includes("Bad credentials") ? "El NIF o la contraseña no son correctos." : `Datadis no ha dejado entrar (${respuesta.status}).`);
  }
  token = texto;
}

async function pedir(recurso, parametros = {}) {
  if (!token) throw new Error("Primero hay que entrar en datadis.");
  const url = new URL(`${BASE}/${recurso}`);
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor != null && valor !== "") url.searchParams.set(clave, valor);
  }
  const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (respuesta.status === 401) {
    token = null;
    throw new Error("La sesión de datadis ha caducado. Vuelve a entrar.");
  }
  if (respuesta.status === 429) {
    throw new Error("Datadis ha cortado por exceso de peticiones. Espera un rato y sigue desde donde se quedó.");
  }
  if (!respuesta.ok) throw new Error(`Datadis ha respondido ${respuesta.status} en ${recurso}.`);
  const texto = await respuesta.text();
  if (!texto.trim()) return {};
  return JSON.parse(texto);
}

export async function suministros() {
  const datos = await pedir("get-supplies-v2");
  return (datos.supplies || []).map((s) => ({
    cups: s.cups,
    direccion: [s.address, s.municipality, s.province].filter(Boolean).join(", "),
    distribuidora: s.distributor,
    codigoDistribuidora: s.distributorCode,
    tipoPunto: s.pointType,
    desde: s.validDateFrom,
    hasta: s.validDateTo,
  }));
}

export async function contratos(cups, codigoDistribuidora) {
  const datos = await pedir("get-contract-detail-v2", { cups, distributorCode: codigoDistribuidora });
  return (datos.contract || []).map((c) => ({
    desde: c.startDate,
    hasta: c.endDate,
    comercializadora: c.marketer,
    potencia: c.contractedPowerkW,
    tarifa: c.accessFare,
    autoconsumo: c.selfConsumptionTypeDesc ?? c.selfConsumptionTypeCode ?? null,
    codigoAutoconsumo: c.selfConsumptionTypeCode ?? null,
    modoTarifa: c.modePowerControl,
    crudo: c,
  }));
}

// Datadis numera las horas de 1 a 24 marcando el FINAL del intervalo.
function instanteDeMedida(fecha, hora) {
  const [anio, mes, dia] = fecha.split("/").map(Number);
  const final = Number(String(hora).split(":")[0]);
  if (!Number.isFinite(final) || final < 1) return null;
  return new Date(anio, mes - 1, dia, final - 1);
}

const aNumero = (valor) => (Number.isFinite(Number(valor)) ? Number(valor) : 0);

export async function curvaHoraria(cups, codigoDistribuidora, mes, tipoPunto) {
  const datos = await pedir("get-consumption-data-v2", {
    cups,
    distributorCode: codigoDistribuidora,
    startDate: mes,
    endDate: mes,
    measurementType: 0,
    pointType: tipoPunto,
  });
  const registros = [];
  for (const punto of datos.timeCurve || []) {
    const instante = instanteDeMedida(punto.date, punto.time);
    if (!instante) continue;
    registros.push({
      instante,
      consumo: aNumero(punto.consumptionKWh),
      vertido: aNumero(punto.surplusEnergyKWh),
      generado: aNumero(punto.generationEnergyKWh),
      autoconsumido: aNumero(punto.selfConsumptionEnergyKWh),
      real: punto.obtainMethod === "Real",
    });
  }
  return registros.sort((a, b) => a.instante - b.instante);
}

export async function potenciasMaximas(cups, codigoDistribuidora, desde, hasta) {
  const datos = await pedir("get-max-power-v2", {
    cups,
    distributorCode: codigoDistribuidora,
    startDate: desde,
    endDate: hasta,
  });
  return (datos.maxPower || [])
    .filter((p) => p.date && p.time)
    .map((p) => ({ instante: instanteDeMedida(p.date, p.time), kw: aNumero(p.maxPower) }));
}

/** Meses "AAAA/MM" entre dos extremos, ambos incluidos. */
export function mesesEntre(desde, hasta) {
  const [a1, m1] = desde.split(/[-/]/).map(Number);
  const [a2, m2] = hasta.split(/[-/]/).map(Number);
  const meses = [];
  for (let anio = a1, mes = m1; anio < a2 || (anio === a2 && mes <= m2); mes === 12 ? (mes = 1, anio++) : mes++) {
    meses.push(`${anio}/${String(mes).padStart(2, "0")}`);
  }
  return meses;
}
