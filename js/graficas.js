// Gráficas en canvas, sin librerías: área apilada, barras apiladas y mapa de calor.

const MARGEN = { arriba: 16, derecha: 16, abajo: 28, izquierda: 56 };
const FUENTE = "500 11px 'Plex Mono', ui-monospace, monospace";

// Los colores salen de los tokens de styles.css (§1). El respaldo solo se usa si
// el CSS aún no está aplicado, y una prueba comprueba que coincide con :root.
const RESPALDO = {
  "--fondo": "#14110E",
  "--linea": "#2E2822",
  "--escala": "#74685A",
  "--texto": "#EEE7DB",
  "--texto-3": "#9A8F80",
  "--sol": "#EBC25E",
  "--sol-tenue": "#9A7F3E",
  "--coral": "#E57A5F",
  "--vertido": "#6DB8B0",
  "--estano": "#A9B8C6",
};
const token = (nombre) =>
  (typeof document !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue(nombre).trim()) || RESPALDO[nombre];

const ROLES = {
  produccion: "--sol",
  produccionTotal: "--sol-tenue",
  autoconsumo: "--sol",
  importada: "--coral",
  exportada: "--vertido",
  carga: "--estano",
  descarga: "--estano",
  consumo: "--texto",
  soc: "--estano",
};
export const COLORES = Object.defineProperties(
  {},
  Object.fromEntries(Object.entries(ROLES).map(([rol, nombre]) => [rol, { enumerable: true, get: () => token(nombre) }]))
);
const rejilla = () => token("--linea");
const textoEje = () => token("--texto-3");

function preparar(canvas) {
  const escala = window.devicePixelRatio || 1;
  const ancho = canvas.clientWidth || 600;
  const alto = canvas.clientHeight || 220;
  canvas.width = Math.round(ancho * escala);
  canvas.height = Math.round(alto * escala);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(escala, 0, 0, escala, 0, 0);
  ctx.clearRect(0, 0, ancho, alto);
  ctx.font = FUENTE;
  return {
    ctx,
    ancho,
    alto,
    caja: { x0: MARGEN.izquierda, y0: MARGEN.arriba, x1: ancho - MARGEN.derecha, y1: alto - MARGEN.abajo },
  };
}

function pasoBonito(bruto) {
  if (bruto <= 0) return 1;
  const magnitud = 10 ** Math.floor(Math.log10(bruto));
  const resto = bruto / magnitud;
  const factor = resto <= 1 ? 1 : resto <= 2 ? 2 : resto <= 5 ? 5 : 10;
  return factor * magnitud;
}

function ejeVertical(ctx, caja, minimo, maximo, formato) {
  const paso = pasoBonito((maximo - minimo) / 4);
  ctx.strokeStyle = rejilla();
  ctx.fillStyle = textoEje();
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let valor = Math.ceil(minimo / paso) * paso; valor <= maximo + 1e-9; valor += paso) {
    const y = Math.round(caja.y1 - ((valor - minimo) / (maximo - minimo || 1)) * (caja.y1 - caja.y0)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(caja.x0, y);
    ctx.lineTo(caja.x1, y);
    ctx.stroke();
    ctx.fillText(formato(valor), caja.x0 - 8, y);
  }
}

function pista(canvas) {
  const padre = canvas.parentElement;
  let elemento = padre.querySelector(".pista");
  if (!elemento) {
    elemento = document.createElement("div");
    elemento.className = "pista";
    elemento.hidden = true;
    padre.appendChild(elemento);
  }
  return elemento;
}

function horaCorta(fecha) {
  return `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}`;
}

// Marca de un momento (§5.5.2): índice, o tramo {desde, hasta} en ms o Date.
function tramoDe(marca, instantes) {
  if (marca == null) return null;
  if (typeof marca === "number") return instantes[marca] == null ? null : { desde: instantes[marca], hasta: null };
  const desde = +marca.desde;
  const hasta = marca.hasta == null ? null : +marca.hasta;
  return Number.isFinite(desde) ? { desde, hasta: Number.isFinite(hasta) && hasta > desde ? hasta : null } : null;
}

// Cursor del momento: lo que queda después se atenúa con el fondo; un tramo lleva una regla arriba y su fin.
function pintarMarca(ctx, caja, aX, tramo) {
  if (!tramo) return;
  const x0 = Math.min(Math.max(aX(tramo.desde), caja.x0), caja.x1);
  const x1 = tramo.hasta == null ? x0 : Math.min(Math.max(aX(tramo.hasta), caja.x0), caja.x1);
  ctx.fillStyle = token("--fondo");
  ctx.globalAlpha = 0.62;
  ctx.fillRect(x1, caja.y0, caja.x1 - x1, caja.y1 - caja.y0);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = token("--sol");
  if (x1 > x0) {
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(Math.round(x1) + 0.5, caja.y0);
    ctx.lineTo(Math.round(x1) + 0.5, caja.y1);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, caja.y0 + 1);
    ctx.lineTo(x1, caja.y0 + 1);
    ctx.stroke();
  }
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(Math.round(x0) + 0.5, caja.y0);
  ctx.lineTo(Math.round(x0) + 0.5, caja.y1);
  ctx.stroke();
}

// Marcas de 6 px bajo el eje x en cada momento: la activa en --sol, el resto en --escala.
function pintarMarcas(ctx, caja, aX, instantes, marcas, tramo) {
  for (const { indice, activa } of marcas) {
    const t = instantes[indice];
    if (t == null) continue;
    const x = Math.round(aX(t)) + 0.5;
    ctx.strokeStyle = token(activa || (tramo && tramo.desde === t) ? "--sol" : "--escala");
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, caja.y1 + 1);
    ctx.lineTo(x, caja.y1 + 7);
    ctx.stroke();
  }
}

/**
 * Área apilada sobre el tiempo con líneas superpuestas y cursor de datos.
 * capas: [{ clave, nombre, color, valores }] en las mismas posiciones que instantes.
 * Devuelve { marcar(indice | {desde, hasta} | null) } para el relato (§5.5.2).
 */
export function areaApilada(canvas, { instantes, capas, lineas = [], unidad = "W", marcas = [] }) {
  let seleccion = null;
  const pintar = (indiceCursor) => {
    const { ctx, caja } = preparar(canvas);
    if (!instantes.length) return;

    const acumulado = new Float64Array(instantes.length);
    let maximo = 0;
    for (let i = 0; i < instantes.length; i++) {
      let suma = 0;
      for (const capa of capas) suma += Math.max(capa.valores[i] || 0, 0);
      if (suma > maximo) maximo = suma;
    }
    for (const linea of lineas) for (const valor of linea.valores) maximo = Math.max(maximo, valor || 0);
    const objetivo = maximo * 1.1 || 1;
    const pasoEje = pasoBonito(objetivo / 4);
    maximo = Math.ceil(objetivo / pasoEje) * pasoEje;

    const t0 = instantes[0];
    const t1 = instantes[instantes.length - 1] || t0 + 1;
    const aX = (t) => caja.x0 + ((t - t0) / (t1 - t0 || 1)) * (caja.x1 - caja.x0);
    const aY = (v) => caja.y1 - (v / maximo) * (caja.y1 - caja.y0);

    ejeVertical(ctx, caja, 0, maximo, (v) => (unidad === "W" && maximo >= 2000 ? `${(v / 1000).toFixed(1)} kW` : `${Math.round(v)} ${unidad}`));

    ctx.fillStyle = textoEje();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let hora = 0; hora <= 24; hora += 4) {
      const marca = new Date(t0);
      marca.setHours(hora, 0, 0, 0);
      if (marca.getTime() < t0 || marca.getTime() > t1) continue;
      ctx.fillText(`${String(hora).padStart(2, "0")}h`, aX(marca.getTime()), caja.y1 + (marcas.length ? 10 : 6));
    }

    for (const capa of capas) {
      ctx.beginPath();
      ctx.moveTo(aX(instantes[0]), aY(acumulado[0]));
      for (let i = 0; i < instantes.length; i++) ctx.lineTo(aX(instantes[i]), aY(acumulado[i] + Math.max(capa.valores[i] || 0, 0)));
      for (let i = instantes.length - 1; i >= 0; i--) ctx.lineTo(aX(instantes[i]), aY(acumulado[i]));
      ctx.closePath();
      ctx.fillStyle = capa.color;
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
      for (let i = 0; i < instantes.length; i++) acumulado[i] += Math.max(capa.valores[i] || 0, 0);
    }

    for (const linea of lineas) {
      ctx.beginPath();
      instantes.forEach((t, i) => (i ? ctx.lineTo(aX(t), aY(linea.valores[i] || 0)) : ctx.moveTo(aX(t), aY(linea.valores[i] || 0))));
      ctx.setLineDash(linea.discontinua ? [4, 3] : []);
      ctx.strokeStyle = linea.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const tramo = tramoDe(seleccion, instantes);
    pintarMarca(ctx, caja, aX, tramo);
    pintarMarcas(ctx, caja, aX, instantes, marcas, tramo);

    if (indiceCursor != null) {
      const x = aX(instantes[indiceCursor]);
      ctx.beginPath();
      ctx.moveTo(x, caja.y0);
      ctx.lineTo(x, caja.y1);
      ctx.strokeStyle = token("--texto");
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };

  pintar(null);

  const globo = pista(canvas);
  const alSalir = () => {
    globo.hidden = true;
    pintar(null);
  };
  canvas.onpointerleave = alSalir;
  canvas.onpointermove = (evento) => {
    if (!instantes.length) return;
    const marco = canvas.getBoundingClientRect();
    const caja = { x0: MARGEN.izquierda, x1: marco.width - MARGEN.derecha };
    const t0 = instantes[0];
    const t1 = instantes[instantes.length - 1] || t0 + 1;
    const razon = (evento.clientX - marco.left - caja.x0) / (caja.x1 - caja.x0);
    if (razon < 0 || razon > 1) return alSalir();
    const objetivo = t0 + razon * (t1 - t0);
    let indice = 0;
    let mejor = Infinity;
    for (let i = 0; i < instantes.length; i++) {
      const distancia = Math.abs(instantes[i] - objetivo);
      if (distancia < mejor) {
        mejor = distancia;
        indice = i;
      }
    }
    pintar(indice);
    const formatear = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} kW` : `${Math.round(v)} W`);
    const filas = [...capas, ...lineas]
      .map((c) => `<span style="--c:${c.color}"></span>${c.nombre}<b>${formatear(c.valores[indice] || 0)}</b>`)
      .join("");
    globo.innerHTML = `<strong>${horaCorta(new Date(instantes[indice]))}</strong>${filas}`;
    globo.hidden = false;
    const ancho = globo.offsetWidth;
    const x = evento.clientX - marco.left;
    globo.style.left = `${Math.min(Math.max(x + 12, 4), marco.width - ancho - 4)}px`;
    globo.style.top = `${Math.max(evento.clientY - marco.top - globo.offsetHeight - 12, 4)}px`;
  };

  return {
    marcar(nueva) {
      seleccion = nueva;
      pintar(null);
    },
  };
}

/** Barras apiladas por día. capas: [{ nombre, color, valores }] */
export function barrasApiladas(canvas, { etiquetas, capas, unidad = "kWh" }) {
  const { ctx, caja } = preparar(canvas);
  if (!etiquetas.length) return;

  let maximo = 0;
  for (let i = 0; i < etiquetas.length; i++) {
    let suma = 0;
    for (const capa of capas) suma += Math.max(capa.valores[i] || 0, 0);
    maximo = Math.max(maximo, suma);
  }
  const paso = pasoBonito(maximo / 4 || 1);
  maximo = Math.ceil(maximo / paso) * paso || 1;
  ejeVertical(ctx, caja, 0, maximo, (v) => `${v.toFixed(v < 10 ? 1 : 0)}`);

  const anchoHueco = (caja.x1 - caja.x0) / etiquetas.length;
  const anchoBarra = Math.max(anchoHueco * 0.7, 2);
  const acumulado = new Float64Array(etiquetas.length);

  for (const capa of capas) {
    ctx.fillStyle = capa.color;
    for (let i = 0; i < etiquetas.length; i++) {
      const valor = Math.max(capa.valores[i] || 0, 0);
      if (!valor) continue;
      const x = caja.x0 + i * anchoHueco + (anchoHueco - anchoBarra) / 2;
      const yAbajo = caja.y1 - (acumulado[i] / maximo) * (caja.y1 - caja.y0);
      const altura = (valor / maximo) * (caja.y1 - caja.y0);
      ctx.fillRect(x, yAbajo - altura, anchoBarra, altura);
      acumulado[i] += valor;
    }
  }

  ctx.fillStyle = textoEje();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const salto = Math.ceil(etiquetas.length / 15);
  etiquetas.forEach((etiqueta, i) => {
    if (i % salto) return;
    ctx.fillText(etiqueta, caja.x0 + i * anchoHueco + anchoHueco / 2, caja.y1 + 6);
  });
  ctx.textAlign = "right";
  ctx.fillText(unidad, caja.x1, caja.y0 - 12);
}

/** Barras enfrentadas por grupo. series: [{ nombre, color, valores }] */
export function barrasAgrupadas(canvas, { etiquetas, series, unidad = "kWh" }) {
  const { ctx, caja } = preparar(canvas);
  if (!etiquetas.length) return;

  let maximo = 0;
  for (const serie of series) for (const valor of serie.valores) maximo = Math.max(maximo, valor || 0);
  const paso = pasoBonito(maximo / 4 || 1);
  maximo = Math.ceil(maximo / paso) * paso || 1;
  ejeVertical(ctx, caja, 0, maximo, (v) => `${v.toFixed(v < 10 ? 1 : 0)}`);

  const anchoHueco = (caja.x1 - caja.x0) / etiquetas.length;
  const anchoBarra = Math.max((anchoHueco * 0.7) / series.length, 2);

  series.forEach((serie, s) => {
    ctx.fillStyle = serie.color;
    for (let i = 0; i < etiquetas.length; i++) {
      const valor = Math.max(serie.valores[i] || 0, 0);
      if (!valor) continue;
      const centro = caja.x0 + i * anchoHueco + anchoHueco / 2;
      const x = centro + (s - series.length / 2) * anchoBarra;
      const altura = (valor / maximo) * (caja.y1 - caja.y0);
      ctx.fillRect(x, caja.y1 - altura, anchoBarra - 1, altura);
    }
  });

  ctx.fillStyle = textoEje();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  etiquetas.forEach((etiqueta, i) => ctx.fillText(etiqueta, caja.x0 + i * anchoHueco + anchoHueco / 2, caja.y1 + 6));
  ctx.textAlign = "right";
  ctx.fillText(unidad, caja.x1, caja.y0 - 12);
}

/** Mapa de calor día (columnas) × hora (filas). */
export function mapaCalor(canvas, { dias, matriz, color = COLORES.importada }) {
  const { ctx, caja } = preparar(canvas);
  if (!dias.length) return;

  let maximo = 0;
  for (const columna of matriz) for (const valor of columna) maximo = Math.max(maximo, valor);
  if (!maximo) maximo = 1;

  const anchoCelda = (caja.x1 - caja.x0) / dias.length;
  const altoCelda = (caja.y1 - caja.y0) / 24;
  ctx.fillStyle = color;
  for (let d = 0; d < dias.length; d++) {
    for (let h = 0; h < 24; h++) {
      const intensidad = (matriz[d]?.[h] || 0) / maximo;
      ctx.globalAlpha = 0.06 + intensidad * 0.94;
      ctx.fillRect(caja.x0 + d * anchoCelda, caja.y0 + h * altoCelda, Math.ceil(anchoCelda), Math.ceil(altoCelda));
    }
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = textoEje();
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let h = 0; h < 24; h += 6) ctx.fillText(`${String(h).padStart(2, "0")}h`, caja.x0 - 8, caja.y0 + h * altoCelda + altoCelda / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const salto = Math.ceil(dias.length / 15);
  dias.forEach((dia, i) => {
    if (i % salto) return;
    ctx.fillText(dia.slice(-2), caja.x0 + i * anchoCelda + anchoCelda / 2, caja.y1 + 6);
  });
}

/** Línea simple sobre el tiempo, para el nivel de batería. Devuelve { marcar } como areaApilada. */
export function lineaSimple(canvas, { instantes, valores, color = COLORES.soc, unidad = "%", maximoFijo }) {
  let seleccion = null;
  const pintar = () => {
    const { ctx, caja } = preparar(canvas);
    if (!instantes.length) return;
    const maximo = maximoFijo ?? Math.max(1, ...valores);
    ejeVertical(ctx, caja, 0, maximo, (v) => `${Math.round(v)}${unidad}`);

    const t0 = instantes[0];
    const t1 = instantes[instantes.length - 1] || t0 + 1;
    const aX = (t) => caja.x0 + ((t - t0) / (t1 - t0 || 1)) * (caja.x1 - caja.x0);
    const aY = (v) => caja.y1 - (v / maximo) * (caja.y1 - caja.y0);

    ctx.beginPath();
    instantes.forEach((t, i) => (i ? ctx.lineTo(aX(t), aY(valores[i] || 0)) : ctx.moveTo(aX(t), aY(valores[i] || 0))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineTo(aX(t1), caja.y1);
    ctx.lineTo(aX(t0), caja.y1);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.13;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = textoEje();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let hora = 0; hora <= 24; hora += 4) {
      const marcaHora = new Date(t0);
      marcaHora.setHours(hora, 0, 0, 0);
      if (marcaHora.getTime() < t0 || marcaHora.getTime() > t1) continue;
      ctx.fillText(`${String(hora).padStart(2, "0")}h`, aX(marcaHora.getTime()), caja.y1 + 6);
    }
    pintarMarca(ctx, caja, aX, tramoDe(seleccion, instantes));
  };

  pintar();
  return {
    marcar(nueva) {
      seleccion = nueva;
      pintar();
    },
  };
}
