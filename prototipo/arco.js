// Arco solar del prototipo: dibuja un objeto con la forma de salida de modeloArco.
// Geometría del §4.3.5 (cx 200, cy 200, R 150). El viewBox se amplía por arriba para la
// escala exterior de horas; los rótulos van en HTML superpuesto, como pide el §4.4.
import { theta, hhmm, num } from "./datos.js";

const NS = "http://www.w3.org/2000/svg";
const CX = 200, CY = 200, R = 150, LMAX = 34, LCASA = 30, ANILLO = 196;
export const VB = { x: 0, y: -22, w: 400, h: 242 };

const el = (tag, attrs = {}, padre) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (padre) padre.append(n);
  return n;
};
const punto = (ang, r) => [CX + r * Math.cos((ang * Math.PI) / 180), CY - r * Math.sin((ang * Math.PI) / 180)];
const arcoPath = (a0, a1, r) => { const [x0, y0] = punto(a0, r), [x1, y1] = punto(a1, r); return `M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}`; };
const pct = (x, y) => ({ left: `${((x - VB.x) / VB.w) * 100}%`, top: `${((y - VB.y) / VB.h) * 100}%` });

export function pintarArco(fig, m, { primera = false, ventanaMejor = null } = {}) {
  const svg = fig.querySelector("svg");
  const capa = fig.querySelector(".arco-rotulos");
  svg.replaceChildren();
  capa.replaceChildren();
  svg.setAttribute("viewBox", `${VB.x} ${VB.y} ${VB.w} ${VB.h}`);
  const defs = el("defs", {}, svg);
  const pat = el("pattern", { id: "rayado", width: 3, height: 3, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  el("rect", { width: 1.2, height: 3, fill: "var(--sol)" }, pat);

  const desdeH = m.ventana.desde.getHours(), hastaH = m.ventana.hasta.getHours() || 24;
  const th = (t) => theta(t, { desde: desdeH, hasta: hastaH });

  // Escala exterior: marca cada 15 min, mayor cada hora (lenguaje de esfera de instrumento).
  const escala = el("g", { class: "escala-ext" }, svg);
  for (let t = desdeH; t <= hastaH + 1e-9; t += 0.25) {
    const a = th(t), mayor = Math.abs(t - Math.round(t)) < 1e-9;
    const [x0, y0] = punto(a, ANILLO), [x1, y1] = punto(a, ANILLO + (mayor ? 7 : 3));
    el("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: mayor ? "marca-mayor" : "marca-menor" }, escala);
    if (mayor && t > desdeH && t < hastaH) {
      const [lx, ly] = punto(a, ANILLO + 15);
      const r = Object.assign(document.createElement("span"), { className: "rotulo-hora", textContent: String(t % 24).padStart(2, "0") });
      Object.assign(r.style, pct(lx, ly));
      capa.append(r);
    }
  }

  el("line", { x1: 8, y1: CY, x2: 392, y2: CY, class: "horizonte" }, svg);
  el("path", { d: arcoPath(180, 0, R), class: "pista" }, svg);
  for (let t = desdeH; t <= hastaH; t++) {
    const a = th(t), [x0, y0] = punto(a, R - 3), [x1, y1] = punto(a, R + 3);
    el("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: "marca-pista" }, svg);
  }

  // Ventana recomendada por el asesor sobre la pista (propuesta: no está en la especificación).
  if (ventanaMejor) {
    const t0 = Math.max(desdeH, horaDec(ventanaMejor.inicio, m.dia.inicio)), t1 = Math.min(hastaH, horaDec(ventanaMejor.fin, m.dia.inicio));
    if (t1 > t0) {
      el("path", { d: arcoPath(th(t0), th(t1), R), class: "ventana-mejor" }, svg);
      for (const t of [t0, t1]) { const [a0, b0] = punto(th(t), R - 5), [a1, b1] = punto(th(t), R + 5); el("line", { x1: a0, y1: b0, x2: a1, y2: b1, class: "ventana-mejor-tope" }, svg); }
    }
  }

  const n = m.franjas.filter((f) => f.angulo !== null).length;
  const grosor = n <= 13 ? 6 : 4;
  const px = LMAX / m.escala.kwh;
  const rayos = el("g", { class: "rayos" }, svg);
  let i = 0;
  for (const f of m.franjas) {
    if (f.angulo === null) continue;
    const g = el("g", { class: "franja", "data-hora": f.hora, transform: `rotate(${-f.angulo} ${CX} ${CY})` }, rayos);
    el("rect", { x: CX + R - 40, y: CY - 11, width: 80, height: 22, class: "zona" }, g);
    const ref = f.previsto?.kwh ?? f.tipico?.kwh ?? 0;
    const discontinuo = f.previsto?.origen === "estimado" || f.previsto?.confianza === "baja";
    if (ref > 0) el("rect", { x: CX + R + 6, y: CY - grosor / 2, width: Math.min(ref * px, LMAX), height: grosor, class: `contorno${discontinuo ? " discontinuo" : ""}` }, g);
    if (f.real && f.real.kwh > 0) {
      const r = el("rect", { x: CX + R + 6, y: CY - grosor / 2, width: Math.min(f.real.kwh * px, LMAX), height: grosor, class: `relleno ${f.real.estado}` }, g);
      if (primera) r.style.animationDelay = `${i * 12}ms`;
    }
    const casa = f.casaReal ?? f.casaTipica;
    if (casa) {
      const l = Math.min(casa.kwh * px, LCASA);
      const c = el("rect", { x: CX + R - 6 - l, y: CY - 1.25, width: l, height: 2.5, class: f.casaReal ? `casa-real ${f.casaReal.estado}` : "casa-tipica" }, g);
      if (primera) c.style.animationDelay = `${i * 12}ms`;
    }
    i++;
  }
  if (primera) svg.classList.add("primera");
  else svg.classList.remove("primera");

  if (m.muesca) {
    const g = el("g", { class: "muesca", transform: `rotate(${-m.muesca.angulo} ${CX} ${CY})` }, svg);
    el("path", { d: `M${CX + R - 1} ${CY} l-6 -3.5 v7 z` }, g);
  }

  const mk = m.marcador;
  if (mk.posicion === "pista") {
    const g = el("g", { class: `marcador${mk.lleno ? " lleno" : ""}`, style: `transform: rotate(${-mk.angulo}deg)` }, svg);
    el("circle", { cx: CX + R, cy: CY, r: 14, class: "halo" }, g);
    el("circle", { cx: CX + R, cy: CY, r: 6.5, class: "nucleo" }, g);
  } else if (mk.posicion) {
    const x = mk.posicion === "antes" ? CX - R : CX + R;
    el("circle", { cx: x, cy: CY + 13, r: 5, class: `marcador-fuera${mk.lleno ? " lleno" : ""}` }, svg);
  }
}

export const horaDec = (d, inicioDia) => (d - inicioDia) / 3600e3;

// Franja más cercana a un punto del puntero (en coordenadas del viewBox).
export function franjaEn(m, x, y) {
  const dx = x - CX, dy = CY - y;
  if (dy < -24 || Math.hypot(dx, dy) < 60) return null;
  const ang = Math.max(0, Math.min(180, (Math.atan2(Math.max(dy, 0), dx) * 180) / Math.PI));
  let mejor = null, d = Infinity;
  for (const f of m.franjas) if (f.angulo !== null && Math.abs(f.angulo - ang) < d) { d = Math.abs(f.angulo - ang); mejor = f; }
  return mejor;
}

export const kwh = (x) => `${num(x)} kWh`;
export { hhmm };
