// Vista del prototipo de «Ahora». Solo DOM; los datos vienen de escenario() (forma de modeloArco).
import { escenario, APARATOS, num, hhmm, euros, cuando } from "./datos.js";
import { pintarArco, franjaEn } from "./arco.js";

const $ = (s, r = document) => r.querySelector(s);
const params = new URLSearchParams(location.search);
const estado = {
  h: Number(params.get("h") ?? 13.7),
  vivo: params.get("vivo") !== "0",
  calibrada: params.get("calibrada") !== "0",
  aparato: params.get("aparato") ?? "referencia",
};
if (params.has("limpio")) document.documentElement.classList.add("limpio");

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fecha = (d) => `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`;
const icono = (id, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const FORMA = { verde: "f-bien", amarillo: "f-cuidado", rojo: "f-evita", bien: "f-bien", cuidado: "f-cuidado", evita: "f-evita" };
const TONO = { verde: "bien", amarillo: "cuidado", rojo: "evita" };
const dato = (valor, id, unidad, clase, texto) =>
  `<data value="${valor}" data-cifra="${id}" data-unidad="${unidad}" data-clase="${clase}">${texto}</data>`;

let modelo, primera = true;

function pintar() {
  modelo = escenario(estado);
  const m = modelo, a = m.asesor;
  document.documentElement.dataset.fase = m.estado === "noche" || m.estado === "mañana" ? "noche" : "dia";

  // Ojo superior
  $("#ojoDia").textContent = m.dia.tipo === "mañana" ? `Mañana · ${fecha(m.dia.inicio)} · previsión` : `Hoy · ${fecha(m.dia.inicio)}`;
  $("#ojoHora").textContent = hhmm(m.ahora);
  $("#ojoEscala").textContent = m.escala.origen === "instalacion" ? "escala de tu instalación" : "escala de este día · sin calibrar";
  $("#frescura").innerHTML = m.vivo
    ? `<span class="punto vivo"></span>Solarman · hace 3 min`
    : `<span class="punto"></span>Sin lectura en vivo`;

  pintarArco($("#arco"), m, { primera, ventanaMejor: a.mejor });
  primera = false;

  // Cuenco
  const cu = $("#cuenco");
  cu.dataset.tono = TONO[a.estado];
  $("#cuencoForma").innerHTML = `<use href="#${FORMA[a.estado]}"/>`;
  $("#cuencoOjo").textContent = `${a.carga.nombre} · ${m.dia.tipo === "mañana" ? "ahora" : "ahora"}`;
  $("#veredicto").textContent = a.titulo;
  $("#coste").innerHTML = `${a.carga.nombre} ahora ${dato(a.costeAhora.toFixed(2), "asesor:costeAhora", "EUR", "simulado", euros(a.costeAhora))}`;
  const mejorTxt = cuando(a.mejor.inicio, m.ahora);
  $("#proxima").innerHTML = mejorTxt === "Ahora"
    ? `Mejor: <b>ya</b>, hasta las ${dato(a.mejor.fin.toISOString(), "asesor:mejor:fin", "hora", "simulado", hhmm(a.mejor.fin))}`
    : `Mejor: ${dato(a.mejor.inicio.toISOString(), "asesor:mejor:inicio", "hora", "simulado", mejorTxt.replace("Hoy a las", "hoy a las").replace("Mañana", "mañana"))} ${euros(a.mejor.coste)}`;

  // Extremos y muesca
  const v = m.ventana;
  $("#extDesde").innerHTML = `${dato(v.desde.toISOString(), "ventana:desde", "hora", "previsto", hhmm(v.desde))}<small>primera con sol</small>`;
  $("#extHasta").innerHTML = `${dato(v.hasta.toISOString(), "ventana:hasta", "hora", "previsto", hhmm(v.hasta))}<small>última con sol</small>`;
  $("#extMuesca").innerHTML = m.muesca
    ? `${icono("f-cuidado", "ic tri")} ${m.muesca.origen === "medido" ? "Llena antes de las" : "Llena ≈"} ${dato(m.muesca.instante.toISOString(), "muesca", "hora", m.muesca.origen, hhmm(m.muesca.instante))}<small>${m.muesca.origen}</small>`
    : "";

  // Lecturas
  const vv = m.vivo;
  $("#lecSol").innerHTML = vv ? `${dato(vv.solarW, "vivo:solarW", "W", "vivo", num(vv.solarW / 1000))}<span class="u">kW</span>` : `<span class="sin">—</span>`;
  $("#lecCasa").innerHTML = vv ? `${dato(vv.casaW, "vivo:casaW", "W", "vivo", num(vv.casaW / 1000))}<span class="u">kW</span>` : `<span class="sin">—</span>`;
  $("#lecBat").innerHTML = `${dato(m.bateria.soc, "bateria:soc", "%", m.bateria.origenSoc, m.bateria.soc)}<span class="u">%</span>`;
  $("#lecSolNota").textContent = vv ? "en vivo" : "sin lectura";
  $("#lecCasaNota").textContent = vv ? "en vivo" : "sin lectura";
  $("#lecBatNota").textContent = m.bateria.origenSoc === "vivo" ? "en vivo" : "típico a esta hora";

  // Regla de batería
  const b = m.bateria, regla = $("#regla");
  regla.style.setProperty("--soc", `${b.soc}%`);
  regla.style.setProperty("--min", `${b.minimo}%`);
  regla.style.setProperty("--rec", `${b.recomendada.pct}%`);
  regla.style.setProperty("--fin", b.alAcabarSol == null ? "-99%" : `${b.alAcabarSol}%`);
  regla.classList.toggle("tipico", b.origenSoc !== "vivo");
  $("#reglaLeyenda").innerHTML =
    `<span><i class="k-min"></i>reserva ${dato(b.minimo, "bateria:minimo", "%", "ajuste", b.minimo + " %")}</span>` +
    `<span><i class="k-rec"></i>para esta noche ${dato(b.recomendada.pct, "bateria:recomendada", "%", "simulado", b.recomendada.pct + " %")}</span>` +
    (b.alAcabarSol == null ? "" : `<span><i class="k-fin"></i>al acabar el sol ≈ ${dato(b.alAcabarSol, "bateria:alAcabarSol", "%", "simulado", b.alAcabarSol + " %")} · simulado</span>`);

  // Leyenda del arco
  const est = m.leyendas.includes("sin-calibrar");
  $("#leyenda").innerHTML =
    `<span><i class="k-sol"></i>sol medido</span><span><i class="k-prev${est ? " disc" : ""}"></i>sol ${est ? "estimado (sin calibrar)" : "previsto"}</span>` +
    `<span><i class="k-casa"></i>casa medida</span><span><i class="k-casa-t"></i>casa típica</span>` +
    `<span><i class="k-mejor"></i>mejor ventana</span>` +
    `<span class="leyenda-escala">1 rayo lleno = ${num(m.escala.kwh, 1)} kWh · ${m.escala.origen === "instalacion" ? "escala de tu instalación" : "escala de este día"}</span>`;

  pintarTabla(m);
  pintarDecision(m);
  $("#arcoResumen").textContent =
    `${m.dia.tipo === "hoy" ? "Hoy" : "Mañana"}, sol entre las ${hhmm(v.desde)} y las ${hhmm(v.hasta)}. ` +
    `Medidos ${num(m.totales.realKwh)} kWh de ${num(m.totales.previstoKwh)} previstos. Batería al ${b.soc} %.`;
  sincronizarPanel();
}

function pintarDecision(m) {
  const a = m.asesor;
  $("#aparatos").innerHTML = APARATOS.map((x) =>
    `<button type="button" role="radio" aria-checked="${x.id === a.carga.id}" data-id="${x.id}">${icono(x.icono)}<span>${x.nombre}</span></button>`).join("");
  $("#tituloVentanas").innerHTML = `<span class="num">02</span>Mejor momento · ${a.carga.nombre.toLowerCase()} <span class="dur">${num(a.carga.h, 1)} h</span>`;
  $("#ventanas").innerHTML = a.alternativas.map((w, i) => {
    const ini = cuando(w.inicio, m.ahora);
    return `<li class="${i === 0 ? "mejor" : ""}"><span class="cuando">${ini === "Ahora" ? "Ahora" : ini}<span class="flecha">→</span>${hhmm(w.fin)}</span>` +
      `${i === 0 ? '<span class="sello">mejor</span>' : ""}<span class="importe">${euros(w.coste)}</span></li>`;
  }).join("");

  // Cinta de 24 h con resumen en tramos
  const p = m.proximas;
  $("#cinta").innerHTML = p.map((c, i) =>
    `<div class="celda ${c.estado}${i === 0 ? " actual" : ""}" title="${String(c.hora).padStart(2, "0")} h · ${c.estado}">` +
    `<svg class="ic forma" aria-hidden="true"><use href="#${FORMA[c.estado]}"/></svg><i></i>` +
    `<span>${i % 3 === 0 ? String(c.hora).padStart(2, "0") : ""}</span></div>`).join("");
  const tramos = [];
  for (const c of p) { const u = tramos.at(-1); if (u && u.estado === c.estado) u.n++; else tramos.push({ estado: c.estado, desde: c.hora, n: 1 }); }
  const nombre = { bien: "buen momento", cuidado: "con cuidado", evita: "evita" };
  $("#cintaResumen").innerHTML = tramos.slice(0, 4).map((t) =>
    `<span class="t-${t.estado}">${icono(FORMA[t.estado], "ic forma")}${nombre[t.estado]} <b>${String(t.desde).padStart(2, "0")}–${String((t.desde + t.n) % 24).padStart(2, "0")} h</b></span>`).join("");

  $("#razones").innerHTML = m.razones.map((r) => `<li>${icono(r.icono)}<span>${r.texto}</span></li>`).join("");
}

function pintarTabla(m) {
  const filas = m.franjas.filter((f) => f.angulo !== null).map((f) => {
    const r = f.real, c = f.casaReal ?? f.casaTipica;
    const est = !r ? (f.inicio > m.ahora ? "previsto" : "sin dato") : r.estado === "en-curso" ? `en curso (${Math.round(r.cobertura * 100)} %)` : "completa";
    return `<tr><th scope="row">${f.rotulo}</th><td>${r ? num(r.kwh) : "—"}</td><td>${est}</td><td>${num(f.previsto.kwh)}</td>` +
      `<td>${f.previsto.origen === "prevision" ? "calibrada (" + f.previsto.confianza + ")" : "potencia pico"}</td>` +
      `<td>${c ? num(c.kwh) : "—"}</td><td>${f.casaReal ? "medida" : "típica"}</td><td>${f.socFin ? Math.round(f.socFin.pct) : "—"}</td></tr>`;
  }).join("");
  $("#tablaHoras tbody").innerHTML = filas;
}

// Exploración del arco: puntero (ratón, lápiz, dedo en horizontal) y teclado.
const fig = $("#arco");
const svg = fig.querySelector("svg");
let activa = null;
function explorar(f, anunciar = false) {
  activa = f;
  fig.classList.toggle("explorando", !!f);
  svg.querySelectorAll(".franja").forEach((g) => g.classList.toggle("activa", f && Number(g.dataset.hora) === f.hora));
  const d = $("#cuencoFranja");
  if (!f) { d.hidden = true; d.replaceChildren(); d.removeAttribute("aria-live"); return; }
  const r = f.real, c = f.casaReal ?? f.casaTipica;
  d.hidden = false;
  if (anunciar) d.setAttribute("aria-live", "polite"); else d.removeAttribute("aria-live");
  d.innerHTML =
    `<p class="cuenco-ojo">${String(f.hora).padStart(2, "0")}–${String(f.hora + 1).padStart(2, "0")} h · ${r ? (r.estado === "en-curso" ? "en curso" : "medido") : "previsto"}</p>` +
    `<p class="franja-cifra">${num(r ? r.kwh : f.previsto.kwh)}<span class="u">kWh</span></p>` +
    `<p class="franja-det">${r ? `previsto ${num(f.previsto.kwh)}` : "sin medir aún"} · casa ${c ? num(c.kwh) : "—"}${f.casaReal ? "" : " típica"}</p>`;
}
const aViewBox = (e) => {
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
};
svg.addEventListener("pointermove", (e) => { const p = aViewBox(e); explorar(franjaEn(modelo, p.x, p.y)); });
svg.addEventListener("pointerleave", () => explorar(null));
fig.addEventListener("keydown", (e) => {
  const lista = modelo.franjas.filter((f) => f.angulo !== null);
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    const i = activa ? lista.findIndex((f) => f.hora === activa.hora) : lista.findIndex((f) => f.inicio <= modelo.ahora && modelo.ahora < f.fin);
    const j = Math.max(0, Math.min(lista.length - 1, (i < 0 ? 0 : i) + (e.key === "ArrowRight" ? 1 : -1)));
    explorar(lista[activa ? j : Math.max(0, i)], true);
  } else if (e.key === "Escape") explorar(null);
});
fig.addEventListener("blur", () => explorar(null));

$("#aparatos").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-id]");
  if (!b) return;
  estado.aparato = b.dataset.id;
  pintar();
  $(`#aparatos button[data-id="${estado.aparato}"]`).focus();
});

// Panel del prototipo (no forma parte de la propuesta)
function sincronizarPanel() {
  $("#pHora").value = estado.h;
  $("#pHoraTxt").textContent = hhmm(modelo.ahora);
  $("#pVivo").checked = estado.vivo;
  $("#pCal").checked = estado.calibrada;
}
$("#pHora").addEventListener("input", (e) => { estado.h = Number(e.target.value); pintar(); });
$("#pVivo").addEventListener("change", (e) => { estado.vivo = e.target.checked; pintar(); });
$("#pCal").addEventListener("change", (e) => { estado.calibrada = e.target.checked; pintar(); });
document.querySelectorAll("[data-h]").forEach((b) => b.addEventListener("click", () => { estado.h = Number(b.dataset.h); pintar(); }));

document.fonts.ready.then(() => document.documentElement.classList.add("fuentes"));
pintar();
