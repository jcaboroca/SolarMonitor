// Relato del día (§5.5.1): detectarMomentos() es una función pura. No toca el DOM,
// localStorage ni la red, y no modifica la entrada: trabaja sobre una copia ordenada.
// Cada cifra de un momento es una Cifra (§4.3.6) con `ruta` a registros[indice] o a la
// suma de un tramo, para comprobarla contra los datos y no contra el texto.

import { formatear } from "./arco.js";
import { periodoTarifa, resumenPorDia } from "./datos.js";

const H = 3600000;
const MIN = 60000;
const SOSTENIDA = 0.25; // h: una racha cuenta si dura al menos 15 min
const EPS = 1e-9;
const SOL_W = 50;
const FLUJO_W = 100;
const PICO_CASA_W = 1000;
const LLENA_PCT = 98;
const DISPONIBLE = 0.9;
const MAX_PASOS = 10;
const ROLES = ["produccion", "consumo", "importada", "exportada", "carga", "descarga", "soc"];

// De menor a mayor prioridad: se descartan en este orden si sobran pasos (§5.5.1 D).
export const PRIORIDAD = [
  "carga", "vertido", "deja", "arranque", "fin", "cubre", "compra",
  "picoConsumo", "picoProduccion", "maximoBateria", "llena", "minimoBateria", "resumen",
];
// Orden de lectura cuando dos momentos caen en el mismo registro.
const ORDEN = [
  "arranque", "cubre", "carga", "llena", "maximoBateria", "vertido", "picoProduccion",
  "picoConsumo", "deja", "fin", "minimoBateria", "compra", "resumen",
];
const PERIODO = { P1: "punta", P2: "llano", P3: "valle" };

const valido = (rol, v) =>
  typeof v === "number" && Number.isFinite(v) && (rol === "soc" ? v > 0 && v <= 100 : v >= 0);
const conDuracion = (r) => Number.isFinite(r.horas) && r.horas > 0;

function mediana(valores) {
  if (!valores.length) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.floor(orden.length / 2)];
}

const rellenar = (plantilla, cifras) =>
  plantilla.replace(/\{([^}]+)\}/g, (_, id) => cifras.find((c) => c.id === id)?.texto ?? "");

// «1 h 40 min», «58 min», «2 h»: solo las partes que no son cero, cada una su Cifra.
function duracion(id, minutos, ruta) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  const cifras = [];
  const partes = [];
  if (h > 0) {
    cifras.push(cifra(`${id}:h`, h, "h", 0, `${ruta}:h`));
    partes.push(`{${id}:h}`);
  }
  if (m > 0 || h === 0) {
    cifras.push(cifra(`${id}:min`, m, "min", 0, `${ruta}:min`));
    partes.push(`{${id}:min}`);
  }
  return { plantilla: partes.join(" "), cifras };
}

function cifra(id, valor, unidad, decimales, ruta, { clase = "medido", procedencia = "serie", instante = null } = {}) {
  return { id, valor, unidad, decimales, texto: formatear(valor, unidad, decimales), clase, procedencia, ruta, instante };
}

/**
 * Momentos del día a partir de sus registros (los que ya filtra pintarDia()).
 * Devuelve { momentos, pasos, calidad, relato, motivo, resumen }.
 */
export function detectarMomentos(registros, unidadesRol = {}, { festivos = new Set(), pasoMinutos } = {}) {
  const lista = registros
    .map((registro, indice) => ({ registro, indice, t: registro?.instante?.getTime?.() }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t || a.indice - b.indice);
  const n = lista.length;
  if (!n) {
    return {
      momentos: [], pasos: [], relato: false, motivo: "No hay registros de este día.", resumen: null,
      calidad: { duracionDia: null, cobertura: 0, huecos: [], rolesDisponibles: [], duplicadosHoraRepetida: 0 },
    };
  }

  // --- A. Calidad de los datos ---------------------------------------------------------------
  const reg = (k) => lista[k].registro;
  const dura = (k) => conDuracion(reg(k));
  const horas = (k) => (dura(k) ? reg(k).horas : 0);
  const i0 = new Date(lista[0].t);
  const inicioD = new Date(i0.getFullYear(), i0.getMonth(), i0.getDate());
  const finD = new Date(i0.getFullYear(), i0.getMonth(), i0.getDate() + 1);
  const duracionDia = Math.round((finD - inicioD) / H);

  const conTiempo = lista.filter((x) => conDuracion(x.registro));
  const disponible = {};
  for (const rol of ROLES) {
    const unidad = unidadesRol[rol];
    const conocida = unidad === "W" || unidad === "kWh";
    const buenos = conTiempo.filter((x) => valido(rol, x.registro[rol])).length;
    disponible[rol] = conocida && conTiempo.length > 0 && buenos / conTiempo.length >= DISPONIBLE - EPS;
  }
  // El consumo guardado puede ser derivado: por prudencia exige producción e importada (§5.5.1 A).
  const consumoUsable = disponible.consumo && disponible.produccion && disponible.importada;

  const saltos = [];
  for (let k = 1; k < n; k++) saltos.push(lista[k].t - lista[k - 1].t);
  const paso = Number.isFinite(pasoMinutos) && pasoMinutos > 0
    ? pasoMinutos * MIN
    : mediana(saltos) || mediana(saltos.filter((s) => s > 0)) || 5 * MIN;
  const hueco = lista.map((x, k) => k > 0 && x.t - lista[k - 1].t > 1.5 * paso);
  const huecos = [];
  for (let k = 1; k < n; k++) if (hueco[k]) huecos.push({ desde: new Date(lista[k - 1].t), hasta: new Date(lista[k].t) });

  const sumaHoras = lista.reduce((s, _, k) => s + horas(k), 0);
  const cubiertos = Math.min(Math.floor(Math.round(sumaHoras * 3600) / 60), duracionDia * 60);
  const sinDatos = duracionDia * 60 - cubiertos;

  // Día de 25 h: aFecha() lleva las dos 02 h a la primera y llegan duplicadas sin duración (§4.3.1).
  let duplicadosHoraRepetida = 0;
  if (duracionDia === 25) {
    for (let k = 0; k < 24; k++) {
      const s = inicioD.getTime() + k * H;
      if (new Date(s).getHours() !== new Date(s + H).getHours()) continue;
      const enVentana = lista.filter((x) => x.t >= s && x.t < s + H);
      const repetidos = new Set(enVentana.map((x) => x.t).filter((t, i, todos) => todos.indexOf(t) !== i));
      duplicadosHoraRepetida = enVentana.filter((x) => repetidos.has(x.t) && !conDuracion(x.registro)).length;
      break;
    }
  }

  const potencia = (k, rol) => {
    const v = reg(k)[rol];
    if (!disponible[rol] || !valido(rol, v)) return null;
    if (rol === "soc" || unidadesRol[rol] === "W") return v;
    return dura(k) ? (v / reg(k).horas) * 1000 : null;
  };
  const energia = (k, rol) => {
    const v = reg(k)[rol];
    if (!valido(rol, v)) return 0;
    if (unidadesRol[rol] === "kWh") return v;
    return dura(k) ? (v * reg(k).horas) / 1000 : 0;
  };
  const sinHueco = (k1, k2) => {
    for (let j = k1 + 1; j <= k2; j++) if (hueco[j]) return false;
    return true;
  };

  // --- B. Definiciones -----------------------------------------------------------------------
  // Un registro con la condición desconocida corta la racha, salvo que no dure nada.
  function tramos(cond) {
    const res = [];
    let actual = null;
    const cerrar = () => {
      if (actual) res.push(actual);
      actual = null;
    };
    for (let k = 0; k < n; k++) {
      if (hueco[k]) cerrar();
      const c = cond(k);
      if (c === null) {
        if (dura(k)) cerrar();
        continue;
      }
      if (!c) {
        cerrar();
        continue;
      }
      actual ??= { a: k, b: k, horas: 0 };
      actual.b = k;
      actual.horas += horas(k);
    }
    cerrar();
    return res;
  }
  const rachas = (cond) => tramos(cond).filter((r) => r.horas >= SOSTENIDA - EPS);
  function vecino(k, cond, sentido) {
    for (let j = k + sentido; j >= 0 && j < n; j += sentido) {
      if (hueco[sentido > 0 ? j : j + 1]) return null;
      if (cond(j) === null && !dura(j)) continue;
      return j;
    }
    return null;
  }
  const confirmaAntes = (k, cond) => {
    const j = vecino(k, cond, -1);
    return j !== null && cond(j) === false;
  };
  const confirmaDespues = (k, cond) => {
    const j = vecino(k, cond, 1);
    return j !== null && cond(j) === false;
  };
  const umbral = (rol, minimo) => (k) => {
    const w = potencia(k, rol);
    return w === null ? null : w >= minimo;
  };

  // --- Cifras --------------------------------------------------------------------------------
  const ind = (k) => lista[k].indice;
  const instante = (k) => new Date(lista[k].t);
  const cHora = (id, k) => cifra(id, lista[k].t, "hora", null, `registros[${ind(k)}].instante`, { instante: instante(k) });
  const cKw = (id, k, rol) => cifra(id, potencia(k, rol) / 1000, "kW", 2, `registros[${ind(k)}].${rol}`, { instante: instante(k) });
  const cSoc = (id, k) => cifra(id, reg(k).soc, "%", 0, `registros[${ind(k)}].soc`, { instante: instante(k) });
  const dia = resumenPorDia(lista.map((x) => x.registro), unidadesRol)[0];
  const cTotal = (id, rol) => cifra(id, dia[rol], "kWh", 1, `resumenPorDia.${rol}`);

  const avisoHuecos = (prefijo) => {
    if (!huecos.length || duplicadosHoraRepetida || sinDatos <= 0) return { plantilla: "", cifras: [] };
    const d = duracion(`${prefijo}:sinDatos`, sinDatos, "dia-suma(registros[*].horas)");
    return { plantilla: ` El día tiene ${d.plantilla} sin datos.`, cifras: d.cifras };
  };

  const momentos = [];
  function anotar(tipo, k, titulo, detalle, cifras, extra = {}) {
    momentos.push({
      tipo, indice: ind(k), instante: instante(k), registro: reg(k),
      titulo: rellenar(titulo, cifras), detalle: rellenar(detalle, cifras),
      plantilla: { titulo, detalle }, cifras, ...extra,
    });
  }

  // --- C. Catálogo ---------------------------------------------------------------------------
  const sol = umbral("produccion", SOL_W);
  const rachasSol = disponible.produccion ? rachas(sol) : [];

  if (rachasSol[0] && confirmaAntes(rachasSol[0].a, sol)) {
    const k = rachasSol[0].a;
    anotar("arranque", k, "Empieza la producción", "A las {arranque:hora} los paneles ya dan {arranque:potencia}.",
      [cHora("arranque:hora", k), cKw("arranque:potencia", k, "produccion")]);
  }

  const cubreCond = (k) => {
    const p = potencia(k, "produccion");
    const c = potencia(k, "consumo");
    return p === null || c === null ? null : p >= c && p >= SOL_W;
  };
  if (consumoUsable) {
    const r = rachas(cubreCond)[0];
    if (r && confirmaAntes(r.a, cubreCond)) {
      anotar("cubre", r.a, "El sol ya cubre la casa", "Producción {cubre:produccion}, consumo {cubre:consumo}.",
        [cKw("cubre:produccion", r.a, "produccion"), cKw("cubre:consumo", r.a, "consumo")]);
    }
  }

  if (disponible.carga) {
    const cond = umbral("carga", FLUJO_W);
    const r = rachas(cond)[0];
    if (r && confirmaAntes(r.a, cond)) {
      const cifras = [cKw("carga:potencia", r.a, "carga")];
      let detalle = "Entra a {carga:potencia}.";
      if (disponible.soc && valido("soc", reg(r.a).soc)) {
        cifras.push(cSoc("carga:soc", r.a));
        detalle += " Estaba al {carga:soc}.";
      }
      anotar("carga", r.a, "La batería empieza a cargar", detalle, cifras);
    }
  }

  const vertidoCond = umbral("exportada", FLUJO_W);
  const rachasVertido = disponible.exportada ? rachas(vertidoCond) : [];

  if (disponible.soc) {
    const lleno = (k) => (valido("soc", reg(k).soc) ? reg(k).soc >= LLENA_PCT : null);
    const k = lista.findIndex((_, j) => lleno(j) === true);
    if (k >= 0) {
      if (confirmaAntes(k, lleno)) {
        let detalle = "Al {llena:soc} a las {llena:hora}.";
        const sobra = rachasVertido.some((r) => r.a >= k && lista[r.a].t - lista[k].t <= 15 * MIN && sinHueco(k, r.a));
        if (sobra) detalle += " Desde aquí, lo que sobra va a la red.";
        anotar("llena", k, "La batería se llena", detalle, [cSoc("llena:soc", k), cHora("llena:hora", k)]);
      }
    } else {
      let max = -1;
      let primero = -1;
      for (let j = 0; j < n; j++) {
        if (!valido("soc", reg(j).soc)) continue;
        if (primero < 0) primero = j;
        if (reg(j).soc > (max < 0 ? -Infinity : reg(max).soc)) max = j;
      }
      // «Llega a su máximo» solo si subió: si el máximo es la primera lectura, no llegó a nada.
      if (max > primero && reg(max).soc > reg(primero).soc) {
        anotar("maximoBateria", max, "La batería llega a su máximo: {maximoBateria:soc}",
          huecos.length ? "A las {maximoBateria:hora}. Máximo registrado." : "A las {maximoBateria:hora}.",
          [cSoc("maximoBateria:soc", max), cHora("maximoBateria:hora", max)]);
      }
    }
  }

  if (rachasVertido[0] && confirmaAntes(rachasVertido[0].a, vertidoCond)) {
    anotar("vertido", rachasVertido[0].a, "Empiezas a verter a la red", "Hoy vertiste {vertido:total} registrados.",
      [cTotal("vertido:total", "exportada")]);
  }

  let pico = null;
  if (disponible.produccion) {
    for (let k = 0; k < n; k++) {
      const w = potencia(k, "produccion");
      if (w !== null && (pico === null || w > potencia(pico, "produccion"))) pico = k;
    }
    if (pico !== null && potencia(pico, "produccion") >= SOL_W) {
      const aviso = avisoHuecos("picoProduccion");
      anotar("picoProduccion", pico, "Pico de producción: {picoProduccion:potencia}", `A las {picoProduccion:hora}.${aviso.plantilla}`,
        [cKw("picoProduccion:potencia", pico, "produccion"), cHora("picoProduccion:hora", pico), ...aviso.cifras]);
    } else {
      pico = null;
    }
  }

  if (consumoUsable) {
    let k = null;
    for (let j = 0; j < n; j++) {
      const w = potencia(j, "consumo");
      if (w !== null && (k === null || w > potencia(k, "consumo"))) k = j;
    }
    if (k !== null && potencia(k, "consumo") >= PICO_CASA_W) {
      const r = reg(k);
      const roles = ["produccion", "exportada", "importada", "carga", "descarga"];
      const conReparto = roles.every((rol) => disponible[rol] && unidadesRol[rol] === unidadesRol.consumo && valido(rol, r[rol]))
        && valido("consumo", r.consumo) && r.consumo > 0 && valido("produccion", r.solarDirecta);
      const cifras = [cKw("picoConsumo:potencia", k, "consumo")];
      let detalle;
      if (conReparto) {
        const parte = (id, rol) => cifra(`picoConsumo:${id}`, (r[rol] / r.consumo) * 100, "%", 0,
          `registros[${ind(k)}].${rol}/registros[${ind(k)}].consumo`, { instante: instante(k) });
        cifras.push(parte("sol", "solarDirecta"), parte("bateria", "descarga"), parte("red", "importada"));
        detalle = "{picoConsumo:sol} lo puso el sol, {picoConsumo:bateria} la batería y {picoConsumo:red} la red.";
      } else {
        cifras.push(cHora("picoConsumo:hora", k));
        detalle = "A las {picoConsumo:hora}.";
      }
      const aviso = avisoHuecos("picoConsumo");
      anotar("picoConsumo", k, "Pico de consumo: {picoConsumo:potencia}", detalle + aviso.plantilla, [...cifras, ...aviso.cifras]);
    }
  }

  if (consumoUsable && pico !== null) {
    const cubre = (k) => {
      const p = potencia(k, "produccion");
      const c = potencia(k, "consumo");
      return p === null || c === null ? null : p >= c;
    };
    const noCubre = (k) => {
      const v = cubre(k);
      return v === null ? null : !v;
    };
    const rachasA = rachas(cubre);
    const rachasB = rachas(noCubre);
    let elegida = null;
    for (const b of rachasB) {
      const a = rachasA.filter((x) => x.b < b.a).at(-1);
      const otraB = rachasB.filter((x) => x.b < b.a).at(-1);
      if (!a || (otraB && otraB.b > a.b) || !sinHueco(a.b, b.a)) continue;
      if (lista[b.a].t > lista[pico].t) elegida = b;
    }
    if (elegida) {
      const k = elegida.a;
      let detalle = "Producción {deja:produccion}, consumo {deja:consumo}.";
      const empieza = (rol) => {
        if (!disponible[rol]) return null;
        const r = rachas(umbral(rol, FLUJO_W)).find((x) => x.a >= k && x.a <= elegida.b && lista[x.a].t - lista[k].t <= 15 * MIN && sinHueco(k, x.a));
        return r ? lista[r.a].t : null;
      };
      const bateria = empieza("descarga");
      const red = empieza("importada");
      if (bateria !== null && (red === null || bateria <= red)) detalle += " Desde aquí tira de la batería.";
      else if (red !== null) detalle += " Desde aquí entra la red.";
      anotar("deja", k, "El sol deja de cubrir la casa", detalle,
        [cKw("deja:produccion", k, "produccion"), cKw("deja:consumo", k, "consumo")]);
    }
  }

  let fin = null;
  const ultima = rachasSol.at(-1);
  if (ultima && confirmaDespues(ultima.b, sol)) {
    fin = ultima.b;
    anotar("fin", fin, "Termina la producción", "Los paneles dieron {fin:total} registrados.", [cTotal("fin:total", "produccion")]);
  }

  const compraCond = umbral("importada", FLUJO_W);
  const rachasCompra = disponible.importada ? rachas(compraCond) : [];

  if (disponible.importada) {
    const unidos = [];
    for (const s of tramos(compraCond)) {
      const previo = unidos.at(-1);
      let pausa = 0;
      if (previo) for (let j = previo.b + 1; j < s.a; j++) pausa += horas(j);
      if (previo && pausa < SOSTENIDA - EPS && sinHueco(previo.b, s.a)) {
        previo.b = s.b;
        previo.horas += s.horas;
      } else {
        unidos.push({ ...s });
      }
    }
    const elegidos = unidos
      .filter((x) => x.horas >= SOSTENIDA - EPS)
      .map((x) => {
        let kwh = 0;
        for (let j = x.a; j <= x.b; j++) kwh += energia(j, "importada");
        return { ...x, kwh };
      })
      .filter((x) => x.kwh >= 0.1 - EPS)
      .sort((a, b) => b.kwh - a.kwh || a.a - b.a)
      .slice(0, 3)
      .sort((a, b) => a.a - b.a);
    elegidos.forEach((x, i) => {
      const id = `compra:${i + 1}`;
      const porPeriodo = new Map();
      for (let j = x.a; j <= x.b; j++) {
        const e = energia(j, "importada");
        if (e <= 0) continue;
        const p = periodoTarifa(instante(j), festivos);
        porPeriodo.set(p, (porPeriodo.get(p) ?? 0) + e);
      }
      let mejor = null;
      for (const [p, e] of porPeriodo) if (mejor === null || e > porPeriodo.get(mejor) + EPS) mejor = p;
      const periodo = mejor ? `, ${porPeriodo.size > 1 ? "sobre todo " : ""}en ${PERIODO[mejor]} (${mejor})` : "";
      const finTramo = lista[x.b].t + horas(x.b) * H;
      const cifras = [
        cifra(`${id}:kwh`, x.kwh, "kWh", 2, `suma(registros[${ind(x.a)}..${ind(x.b)}].importada)`),
        cHora(`${id}:desde`, x.a),
        cifra(`${id}:hasta`, finTramo, "hora", null, `fin(registros[${ind(x.b)}])`, { instante: new Date(finTramo) }),
      ];
      anotar("compra", x.a, "Compras a la red", `{${id}:kwh} de {${id}:desde} a {${id}:hasta}${periodo}.`, cifras,
        { desde: instante(x.a), hasta: new Date(finTramo), kwh: x.kwh });
    });
  }

  if (fin !== null && disponible.soc && disponible.importada) {
    let k = null;
    for (let j = fin + 1; j < n; j++) {
      if (!valido("soc", reg(j).soc)) continue;
      if (k === null || reg(j).soc < reg(k).soc) k = j;
    }
    const entra = k !== null && rachasCompra.some((r) => r.a >= k && lista[r.a].t - lista[k].t <= 30 * MIN && sinHueco(k, r.a));
    if (entra) {
      anotar("minimoBateria", k, "La batería toca su mínimo y entra la red", "Al {minimoBateria:soc} a las {minimoBateria:hora}.",
        [cSoc("minimoBateria:soc", k), cHora("minimoBateria:hora", k)]);
    }
  }

  // Resumen: siempre, en el último registro. Solo lo registrado (roles disponibles).
  {
    const k = n - 1;
    const cifras = [];
    const partes = [];
    for (const [rol, palabra] of [["produccion", "producidos"], ["consumo", "consumidos"], ["importada", "comprados"], ["exportada", "vertidos"]]) {
      if (!disponible[rol]) continue;
      cifras.push(cTotal(`resumen:${rol}`, rol));
      partes.push(`{resumen:${rol}} ${palabra}`);
    }
    if (consumoUsable && dia.consumo > 0) {
      cifras.push(cifra("resumen:autoconsumo", (dia.autoconsumo / dia.consumo) * 100, "%", 0, "resumenPorDia.autoconsumo/resumenPorDia.consumo"));
      partes.push("{resumen:autoconsumo} autoconsumo");
    }
    let detalle = partes.length ? `${partes.join(" · ")}.` : "No hay cifras registradas que sumar.";
    if (duplicadosHoraRepetida) {
      detalle += ` La hora repetida del cambio llega duplicada en el Excel: ${duplicadosHoraRepetida} registros sin duración.`;
    } else if (cubiertos < duracionDia * 60) {
      const d = duracion("resumen:cobertura", cubiertos, "suma(registros[*].horas)");
      cifras.push(...d.cifras, cifra("resumen:duracion", duracionDia, "h", 0, "dia", { clase: "calculo", procedencia: "calculo" }));
      detalle += ` Datos de ${d.plantilla} de {resumen:duracion}.`;
    }
    anotar("resumen", k, "El día en cifras", detalle, cifras);
  }

  // --- D. Composición -----------------------------------------------------------------------
  const orden = (m) => ORDEN.indexOf(m.tipo);
  momentos.sort((a, b) => a.instante - b.instante || orden(a) - orden(b));
  let vivos = momentos;
  let pasos = componer(vivos);
  while (pasos.length > MAX_PASOS) {
    const quitar = descartable(vivos, pasos);
    vivos = vivos.filter((m) => m !== quitar);
    pasos = componer(vivos);
  }

  const relato = pasos.length >= 3;
  let motivo = null;
  if (!relato) {
    if (!disponible.produccion) motivo = "Este día no tiene datos de producción que se puedan usar, así que no hay relato que contar.";
    else if (pico === null) motivo = "Este día los paneles no registraron producción, así que no hay relato que contar.";
    else motivo = `Este día solo hay ${pasos.length === 1 ? "un momento reconocible" : `${pasos.length} momentos reconocibles`} en los datos; el relato necesita al menos tres.`;
  }

  return {
    momentos: vivos,
    pasos,
    relato,
    motivo,
    resumen: momentos.find((m) => m.tipo === "resumen"),
    calidad: {
      duracionDia,
      cobertura: sumaHoras,
      huecos,
      rolesDisponibles: ROLES.filter((rol) => disponible[rol]),
      duplicadosHoraRepetida,
    },
  };
}

// Momentos del mismo registro en un solo paso: títulos con « · » y detalles seguidos.
function componer(momentos) {
  const pasos = [];
  for (const m of momentos) {
    const previo = pasos.at(-1);
    if (previo && previo.indice === m.indice) {
      previo.tipos.push(m.tipo);
      previo.momentos.push(m);
      continue;
    }
    pasos.push({ indice: m.indice, instante: m.instante, registro: m.registro, tipos: [m.tipo], momentos: [m] });
  }
  return pasos.map(({ momentos: lista, ...paso }) => {
    const tramo = lista.find((m) => m.desde);
    const plantilla = {
      titulo: lista.map((m) => m.plantilla.titulo).join(" · "),
      detalle: lista.map((m) => m.plantilla.detalle).filter(Boolean).join(" "),
    };
    return {
      ...paso,
      titulo: lista.map((m) => m.titulo).join(" · "),
      detalle: lista.map((m) => m.detalle).filter(Boolean).join(" "),
      plantilla,
      cifras: lista.flatMap((m) => m.cifras),
      ...(tramo ? { desde: tramo.desde, hasta: tramo.hasta } : {}),
    };
  });
}

// El momento de menos prioridad cuyo paso queda libre al quitarlo (las compras, de menos kWh a más).
function descartable(momentos, pasos) {
  const solo = (m) => pasos.find((p) => p.indice === m.indice)?.tipos.length === 1;
  for (const tipo of PRIORIDAD) {
    const candidatos = momentos.filter((m) => m.tipo === tipo).sort((a, b) => (a.kwh ?? 0) - (b.kwh ?? 0));
    const libre = candidatos.find(solo);
    if (libre) return libre;
  }
  return [...momentos].sort((a, b) => PRIORIDAD.indexOf(a.tipo) - PRIORIDAD.indexOf(b.tipo))[0];
}
