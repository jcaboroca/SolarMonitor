// «El año en rayos» de Mes a mes (F4, §5.4): el arco de Ahora aplicado a los meses guardados.
// - modeloAnual(meses): función pura. Sin DOM, sin almacenamiento ni red; no toca la entrada.
// - pintarAnual(figura, modelo): solo dibuja el modelo.
// Enero a la izquierda, diciembre a la derecha y el verano en lo alto. Cada mes guardado con
// producción medida es un rayo hacia fuera; su consumo, una aguja hacia dentro en la misma escala.
// Los meses que no están guardados no llevan rayo: no se inventa nada.

import { CX, CY, R, LMAX, LCASA, ANILLO, CAJA, punto } from "./arco.js";
import { htmlCifra } from "./lectura.js";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const NOMBRES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const PASO = 180 / 12;

/** Ángulo del centro del mes `indice` (0 = enero): 172,5° … 7,5°. */
export const ANGULO_MES = (indice) => 180 - (indice + 0.5) * PASO;

const cifra = (x) => (Number.isFinite(x) && x >= 0 ? x : null);
const clave = (m) => (typeof m?.mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m.mes) ? m.mes : null);
const diasDelMes = (anio, indice) => new Date(Date.UTC(anio, indice + 1, 0)).getUTCDate();

export function modeloAnual(meses) {
  if (!Array.isArray(meses)) return null;
  const medidos = meses.filter((m) => clave(m) && cifra(m.medido?.produccion) !== null);
  const porAnio = new Map();
  for (const m of medidos) {
    const anio = Number(m.mes.slice(0, 4));
    porAnio.set(anio, [...(porAnio.get(anio) ?? []), m]);
  }
  const anio = [...porAnio.keys()].sort((a, b) => b - a).find((a) => porAnio.get(a).length >= 2);
  if (anio === undefined) return null;

  const delAnio = new Map(porAnio.get(anio).map((m) => [Number(m.mes.slice(5, 7)) - 1, m]));
  let escala = null;
  for (const [, m] of [...delAnio].sort(([a], [b]) => a - b)) {
    if (!escala || m.medido.produccion > escala.kwh) escala = { kwh: m.medido.produccion, mes: m.mes };
  }
  if (!(escala.kwh > 0)) return null;
  const px = LMAX / escala.kwh;

  const total = { produccion: 0, consumo: 0, meses: 0 };
  const lista = MESES.map((_, indice) => {
    const m = delAnio.get(indice);
    const diasMes = diasDelMes(anio, indice);
    const base = { mes: `${anio}-${String(indice + 1).padStart(2, "0")}`, indice, angulo: ANGULO_MES(indice), diasMes };
    if (!m) return { ...base, produccion: null, consumo: null, dias: null, parcial: false, sol: null, casa: null, desborde: false };
    const produccion = m.medido.produccion;
    const consumo = cifra(m.medido.consumo);
    const dias = Number.isFinite(m.dias) ? m.dias : null;
    total.produccion += produccion;
    total.meses += 1;
    if (consumo !== null) total.consumo += consumo;
    const bruto = consumo === null ? null : consumo * px;
    return {
      ...base, produccion, consumo, dias,
      parcial: dias !== null && dias < diasMes,
      sol: Math.min(produccion / escala.kwh, 1) * LMAX,
      casa: bruto === null ? null : Math.min(bruto, LCASA),
      desborde: bruto !== null && bruto > LCASA,
    };
  });

  return {
    anio,
    meses: lista,
    conDatos: total.meses,
    escala,
    total,
    pico: { ...escala },
    geometria: { cx: CX, cy: CY, r: R, lmax: LMAX, lcasa: LCASA },
  };
}

// --- Pintado (solo navegador) ------------------------------------------------------------

const NS = "http://www.w3.org/2000/svg";
const kwh = (x) => `${Math.round(x).toLocaleString("es-ES")} kWh`;
const nombre = (clave) => `${NOMBRES[Number(clave.slice(5, 7)) - 1]} ${clave.slice(0, 4)}`;

function nodo(etiqueta, atributos, padre) {
  const n = document.createElementNS(NS, etiqueta);
  for (const [k, v] of Object.entries(atributos)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  padre?.append(n);
  return n;
}
const raya = (a, r0, r1, clase, padre) => {
  const p0 = punto(a, r0), p1 = punto(a, r1);
  return nodo("line", { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, class: clase }, padre);
};
const enCaja = ({ x, y }) => ({ left: `${((x - CAJA.x) / CAJA.ancho) * 100}%`, top: `${((y - CAJA.y) / CAJA.alto) * 100}%` });

/** Dibuja el año en la figura (SVG + rótulos de los meses) y su resumen para el lector de pantalla. */
export function pintarAnual(figura, m, hoy = new Date()) {
  const svg = figura.querySelector("svg");
  const capa = figura.querySelector(".arco-rotulos");
  const resumen = figura.querySelector(".oculto");
  svg.setAttribute("viewBox", `${CAJA.x} ${CAJA.y} ${CAJA.ancho} ${CAJA.alto}`);
  svg.replaceChildren();
  capa.replaceChildren();

  const defs = nodo("defs", {}, svg);
  const patron = nodo("pattern", { id: "anual-rayado", width: 3, height: 3, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  nodo("rect", { width: 1.2, height: 3, class: "rayado-sol" }, patron);

  // Anillo exterior: una marca mayor entre meses y el nombre de cada mes en su centro.
  const anillo = nodo("g", { class: "arco-anillo" }, svg);
  for (let i = 0; i <= 12; i++) raya(180 - i * PASO, ANILLO, ANILLO + (i % 3 === 0 ? 7 : 4), i % 3 === 0 ? "marca-mayor" : "marca-menor", anillo);
  m.meses.forEach((x) => {
    const r = document.createElement("span");
    r.className = `arco-hora${x.sol === null ? "" : " con-dato"}`;
    r.textContent = MESES[x.indice];
    Object.assign(r.style, enCaja(punto(x.angulo, ANILLO + 15)));
    capa.append(r);
  });

  nodo("line", { x1: 8, y1: CY, x2: 392, y2: CY, class: "arco-horizonte" }, svg);
  const p0 = punto(180), p1 = punto(0);
  nodo("path", { d: `M${p0.x} ${p0.y} A${R} ${R} 0 0 1 ${p1.x} ${p1.y}`, class: "arco-pista" }, svg);
  const marcas = nodo("g", { class: "arco-marcas" }, svg);
  for (let i = 0; i <= 12; i++) raya(180 - i * PASO, R - (i % 6 === 0 ? 4 : 3), R + (i % 6 === 0 ? 8 : 3), i % 6 === 0 ? "marca-mayor" : "marca-menor", marcas);

  const rayos = nodo("g", { class: "arco-rayos" }, svg);
  for (const x of m.meses) {
    if (x.sol === null) continue;
    const g = nodo("g", { class: "franja", "data-mes": x.mes, transform: `rotate(${-x.angulo} ${CX} ${CY})` }, rayos);
    nodo("rect", {
      x: CX + R + 6, y: CY - 3, width: Math.max(x.sol, 0.5), height: 6,
      class: `rayo relleno${x.parcial ? " rayado" : ""}`, fill: x.parcial ? "url(#anual-rayado)" : null,
    }, g);
    if (x.parcial) nodo("rect", { x: CX + R + 6, y: CY - 3, width: Math.max(x.sol, 0.5), height: 6, class: "rayo contorno" }, g);
    if (x.casa !== null) {
      nodo("rect", { x: CX + R - 6 - x.casa, y: CY - 1.25, width: Math.max(x.casa, 0.5), height: 2.5, class: "rayo casa" }, g);
      if (x.desborde) nodo("line", { x1: CX + R - 6 - LCASA, y1: CY - 3, x2: CX + R - 6 - LCASA, y2: CY + 3, class: "casa-desborde" }, g);
    }
  }

  // Hoy, si el año que se ve es el actual: el mismo marcador que «ahora» en el arco del día.
  if (hoy.getFullYear() === m.anio) {
    const indice = hoy.getMonth();
    const a = 180 - (indice + (hoy.getDate() - 0.5) / diasDelMes(m.anio, indice)) * PASO;
    const p = punto(a);
    const marcador = nodo("g", { class: "arco-marcador" }, svg);
    nodo("circle", { cx: p.x, cy: p.y, r: 9, class: "halo" }, marcador);
    nodo("circle", { cx: p.x, cy: p.y, r: 4.5, class: "nucleo" }, marcador);
  }

  const conDato = m.meses.filter((x) => x.sol !== null);
  resumen.textContent =
    `${m.anio}, mes a mes: ` +
    conDato
      .map((x) => `${nombre(x.mes)}, ${kwh(x.produccion)} producidos${x.consumo === null ? "" : ` y ${kwh(x.consumo)} consumidos`}${x.parcial ? ` (${x.dias} de ${x.diasMes} días)` : ""}`)
      .join("; ") +
    `. Los demás meses no están guardados.`;
  figura.dataset.anio = m.anio;
}

/** Destaca el rayo del mes abierto en el libro de registro. */
export function resaltarMes(figura, mes) {
  let hay = false;
  figura.querySelectorAll(".franja").forEach((g) => {
    const activa = g.dataset.mes === mes;
    g.classList.toggle("activa", activa);
    hay ||= activa;
  });
  figura.classList.toggle("con-mes", hay);
}

/** Lectura del año: lo producido y consumido en los meses guardados, el mes de más sol y cuántos hay. */
export function htmlLecturaAnual(m) {
  const entero = (x) => Math.round(x).toLocaleString("es-ES");
  const conConsumo = m.meses.some((x) => x.consumo !== null);
  return [
    htmlCifra({ rotulo: `Producido en ${m.anio}`, valor: entero(m.total.produccion), unidad: "kWh", clase: "c-sol" }),
    conConsumo ? htmlCifra({ rotulo: "Consumido", valor: entero(m.total.consumo), unidad: "kWh", clase: "c-casa" }) : "",
    htmlCifra({ rotulo: `Más sol · ${NOMBRES[Number(m.pico.mes.slice(5, 7)) - 1]}`, valor: entero(m.pico.kwh), unidad: "kWh" }),
    htmlCifra({ rotulo: "Meses guardados", valor: String(m.conDatos), unidad: "de 12" }),
  ].join("");
}

/** Leyenda permanente, como la del arco de Ahora. */
export function htmlLeyendaAnual(m, hoy = new Date()) {
  const partes = ['<span><i class="k-sol"></i>producido</span>'];
  if (m.meses.some((x) => x.parcial)) partes.push('<span><i class="k-sol k-rayado"></i>mes incompleto</span>');
  if (m.meses.some((x) => x.casa !== null)) partes.push('<span><i class="k-casa"></i>consumido</span>');
  if (hoy.getFullYear() === m.anio) partes.push('<span><i class="k-hoy"></i>hoy</span>');
  partes.push(`<span class="leyenda-notas">1 rayo lleno = <data value="${m.escala.kwh}">${kwh(m.escala.kwh)}</data> · ${NOMBRES[Number(m.escala.mes.slice(5, 7)) - 1]}</span>`);
  return partes.join("");
}
