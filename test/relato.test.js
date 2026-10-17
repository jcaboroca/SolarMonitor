// Relato del día (§5.5.1, §8.4): momentos como función pura, con calidad de datos,
// definiciones, catálogo, composición, trazabilidad y cambio horario.
// node --test ejecuta cada fichero en su propio proceso: fijar la zona aquí no afecta a los demás.
process.env.TZ = "Europe/Madrid";

import assert from "node:assert/strict";
import { test } from "node:test";
import { detectarMomentos } from "../js/relato.js";
import { construirSerie, detectarRoles, unidadDeCabecera, resumenPorDia } from "../js/datos.js";
import { formatear } from "../js/arco.js";

const H = 3600000;
const CAB_W = [
  "Hora actualizada", "Potencia de producción(W)", "Potencia de consumo(W)", "Poder adquisitivo(W)",
  "Potencia de alimentación(W)", "Potencia de carga(W)", "Poder de descarga(W)", "SoC(%)",
];
const CAB_KWH = CAB_W.map((c, i) => (i === 0 || i === 7 ? c : c.replace("(W)", "(kWh)")));
const CAMPOS = ["p", "c", "i", "e", "ca", "d", "s"];
const hhmm = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
const hora = (fecha) => fecha.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

// Una fila cada 5 min de [desde, hasta) en minutos del día. Con kwh, la energía de 5 min.
function filasDe(perfil, { fecha = [2026, 6, 16], desde = 0, hasta = 1440, quitar = () => false, kwh = false, texto = false } = {}) {
  const filas = [];
  for (let t = desde; t < hasta; t += 5) {
    if (quitar(t)) continue;
    const v = perfil(t);
    const [a, m, d] = fecha;
    const instante = texto ? `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${hhmm(t)}:00` : new Date(a, m - 1, d, 0, t);
    filas.push([instante, ...CAMPOS.map((k, j) => (kwh && j < 6 ? ((v[k] ?? 0) * 5) / 60 / 1000 : v[k] ?? 0))]);
  }
  return filas;
}
function serie(filas, kwh = false) {
  const cab = kwh ? CAB_KWH : CAB_W;
  return construirSerie(filas, detectarRoles(cab), cab.map(unidadDeCabecera));
}

// Día soleado de martes 16-jun-2026 (§5.5.1 C): un momento de cada tipo en un registro conocido.
function soleado(t, { socMax = 100, compraManana = false } = {}) {
  let p = 0;
  if (t >= 475 && t < 540) p = 300;
  else if (t >= 540 && t < 780) p = 1500;
  else if (t >= 780 && t < 1020) p = t === 820 ? 3420 : 2500;
  else if (t >= 1020 && t < 1200) p = 600;
  else if (t >= 1200 && t < 1230) p = 120;
  let c = t === 1140 ? 2310 : t >= 1270 && t < 1360 ? 1200 : 400;
  let s;
  if (t < 540) s = 40 - (20 * t) / 540;
  else if (t < 720) s = 20 + (78 * (t - 540)) / 180;
  else if (t < 1140) s = t === 720 ? 98 : 100;
  else if (t < 1200) s = 97;
  else if (t <= 1330) s = 95 - (82 * (t - 1200)) / 130;
  else s = 12;
  s = Math.min(s, socMax);
  let ca = 0, e = 0, d = 0, i = 0;
  if (compraManana && t >= 240 && t < 300) { c = 1000; return { p, c, i: 1000, e, ca, d, s }; }
  if (compraManana && t >= 360 && t <= 390) { c = 800; return { p, c, i: 800, e, ca, d, s }; }
  if (p >= c) {
    if (t <= 720) ca = p - c;
    else e = p - c;
  } else if (s > 12) d = c - p;
  else i = c - p;
  return { p, c, i, e, ca, d, s };
}

const sinProduccion = () => ({ p: 0, c: 300, i: 300, e: 0, ca: 0, d: 0, s: 0 });

function detectar(s, opciones = {}) {
  return detectarMomentos(s.registros, s.unidadesRol, { festivos: new Set(), pasoMinutos: s.pasoMinutos, ...opciones });
}
const tipos = (r) => r.momentos.map((m) => m.tipo);
const momento = (r, tipo) => r.momentos.find((m) => m.tipo === tipo);
const enHora = (r) => Object.fromEntries(r.momentos.map((m) => [m.tipo === "compra" ? `compra ${hora(m.instante)}` : m.tipo, hora(m.instante)]));

// --- Comprobación estructurada de cada Cifra contra los registros (criterio 15) ----------

const potenciaW = (r, rol, u) => (u[rol] === "kWh" ? (r[rol] / r.horas) * 1000 : r[rol]);
function energia(registros, u, rol, a, b) {
  const t0 = registros[a].instante.getTime();
  const t1 = registros[b].instante.getTime();
  let suma = 0;
  for (const r of registros) {
    const t = r.instante.getTime();
    const v = r[rol];
    if (t < t0 || t > t1 || typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    if (u[rol] === "kWh") suma += v;
    else if (Number.isFinite(r.horas) && r.horas > 0) suma += (v * r.horas) / 1000;
  }
  return suma;
}
function minutosValidos(registros) {
  const segundos = Math.round(registros.reduce((s, r) => s + (Number.isFinite(r.horas) && r.horas > 0 ? r.horas : 0), 0) * 3600);
  return Math.floor(segundos / 60);
}
function valorEsperado(c, registros, u) {
  let m;
  if ((m = c.ruta.match(/^registros\[(\d+)\]\.instante$/))) return registros[+m[1]].instante.getTime();
  if ((m = c.ruta.match(/^fin\(registros\[(\d+)\]\)$/))) {
    const r = registros[+m[1]];
    return r.instante.getTime() + (Number.isFinite(r.horas) && r.horas > 0 ? r.horas * H : 0);
  }
  if ((m = c.ruta.match(/^registros\[(\d+)\]\.(\w+)\/registros\[(\d+)\]\.(\w+)$/))) {
    assert.equal(m[1], m[3], c.ruta);
    const r = registros[+m[1]];
    return (r[m[2]] / r[m[4]]) * 100;
  }
  if ((m = c.ruta.match(/^registros\[(\d+)\]\.(\w+)$/))) {
    const r = registros[+m[1]];
    if (c.unidad === "%") return r[m[2]];
    assert.equal(c.unidad, "kW", c.ruta);
    return potenciaW(r, m[2], u) / 1000;
  }
  if ((m = c.ruta.match(/^suma\(registros\[(\d+)\.\.(\d+)\]\.(\w+)\)$/))) return energia(registros, u, m[3], +m[1], +m[2]);
  const dia = resumenPorDia(registros, u)[0];
  if ((m = c.ruta.match(/^resumenPorDia\.(\w+)\/resumenPorDia\.(\w+)$/))) return (dia[m[1]] / dia[m[2]]) * 100;
  if ((m = c.ruta.match(/^resumenPorDia\.(\w+)$/))) return dia[m[1]];
  const i0 = registros[0].instante;
  const horasDia = Math.round((new Date(i0.getFullYear(), i0.getMonth(), i0.getDate() + 1) - new Date(i0.getFullYear(), i0.getMonth(), i0.getDate())) / H);
  const cubiertos = Math.min(minutosValidos(registros), horasDia * 60);
  if (c.ruta === "dia") return horasDia;
  if (c.ruta === "suma(registros[*].horas):h") return Math.floor(cubiertos / 60);
  if (c.ruta === "suma(registros[*].horas):min") return cubiertos % 60;
  if (c.ruta === "dia-suma(registros[*].horas):h") return Math.floor((horasDia * 60 - cubiertos) / 60);
  if (c.ruta === "dia-suma(registros[*].horas):min") return (horasDia * 60 - cubiertos) % 60;
  throw new Error(`ruta desconocida: ${c.ruta}`);
}
function comprobarTrazabilidad(resultado, s) {
  const ids = new Set();
  for (const lista of [resultado.momentos, resultado.pasos]) {
    for (const m of lista) {
      assert.equal(m.registro, s.registros[m.indice], `${m.tipo ?? m.tipos}: indice`);
      assert.equal(m.instante.getTime(), s.registros[m.indice].instante.getTime());
      for (const parte of ["titulo", "detalle"]) {
        const texto = m.plantilla[parte].replace(/\{([^}]+)\}/g, (_, id) => {
          const c = m.cifras.find((x) => x.id === id);
          assert.ok(c, `${id} en cifras`);
          return c.texto;
        });
        assert.equal(texto, m[parte]);
      }
    }
  }
  for (const m of resultado.momentos) {
    for (const c of m.cifras) {
      assert.ok(!ids.has(c.id), `id repetido ${c.id}`);
      ids.add(c.id);
      assert.equal(c.clase, c.ruta === "dia" ? "calculo" : "medido", c.id);
      assert.equal(c.procedencia, c.ruta === "dia" ? "calculo" : "serie", c.id);
      assert.equal(c.texto, formatear(c.valor, c.unidad, c.decimales), c.id);
      const esperado = valorEsperado(c, s.registros, s.unidadesRol);
      assert.ok(Math.abs(c.valor - esperado) < 1e-9, `${c.id}: ${c.valor} ≠ ${esperado}`);
    }
  }
  return ids.size;
}

// --- Catálogo -------------------------------------------------------------------------------

const ESPERADO = {
  arranque: "07:55", cubre: "09:00", carga: "09:00", llena: "12:00", vertido: "12:05",
  picoProduccion: "13:40", picoConsumo: "19:00", deja: "20:00", fin: "20:25",
  minimoBateria: "22:15", "compra 22:15": "22:15", resumen: "23:55",
};

for (const kwh of [false, true]) {
  const unidad = kwh ? "kWh" : "W";
  test(`día soleado (${unidad}): cada momento del catálogo en su registro`, () => {
    const s = serie(filasDe(soleado, { kwh }), kwh);
    const r = detectar(s);
    assert.deepEqual(enHora(r), ESPERADO);
    assert.equal(r.relato, true);
    assert.equal(r.calidad.duracionDia, 24);
    assert.deepEqual(r.calidad.huecos, []);
    assert.deepEqual([...r.calidad.rolesDisponibles].sort(), ["carga", "consumo", "descarga", "exportada", "importada", "produccion", "soc"]);
  });

  test(`día soleado (${unidad}): títulos y detalles con las cifras registradas`, () => {
    const s = serie(filasDe(soleado, { kwh }), kwh);
    const r = detectar(s);
    const dia = resumenPorDia(s.registros, s.unidadesRol)[0];
    const kwh1 = (x) => `${x.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`;
    assert.equal(momento(r, "arranque").titulo, "Empieza la producción");
    assert.equal(momento(r, "arranque").detalle, "A las 07:55 los paneles ya dan 0,30 kW.");
    assert.equal(momento(r, "cubre").titulo, "El sol ya cubre la casa");
    assert.equal(momento(r, "cubre").detalle, "Producción 1,50 kW, consumo 0,40 kW.");
    assert.equal(momento(r, "carga").titulo, "La batería empieza a cargar");
    assert.equal(momento(r, "carga").detalle, "Entra a 1,10 kW. Estaba al 20 %.");
    assert.equal(momento(r, "llena").titulo, "La batería se llena");
    assert.equal(momento(r, "llena").detalle, "Al 98 % a las 12:00. Desde aquí, lo que sobra va a la red.");
    assert.equal(momento(r, "vertido").titulo, "Empiezas a verter a la red");
    assert.equal(momento(r, "vertido").detalle, `Hoy vertiste ${kwh1(dia.exportada)} registrados.`);
    assert.equal(momento(r, "picoProduccion").titulo, "Pico de producción: 3,42 kW");
    assert.equal(momento(r, "picoProduccion").detalle, "A las 13:40.");
    assert.equal(momento(r, "picoConsumo").titulo, "Pico de consumo: 2,31 kW");
    assert.equal(momento(r, "picoConsumo").detalle, "26 % lo puso el sol, 74 % la batería y 0 % la red.");
    assert.equal(momento(r, "deja").titulo, "El sol deja de cubrir la casa");
    assert.equal(momento(r, "deja").detalle, "Producción 0,12 kW, consumo 0,40 kW. Desde aquí tira de la batería.");
    assert.equal(momento(r, "fin").titulo, "Termina la producción");
    assert.equal(momento(r, "fin").detalle, `Los paneles dieron ${kwh1(dia.produccion)} registrados.`);
    assert.equal(momento(r, "minimoBateria").titulo, "La batería toca su mínimo y entra la red");
    assert.equal(momento(r, "minimoBateria").detalle, "Al 12 % a las 22:15.");
    assert.equal(momento(r, "compra").titulo, "Compras a la red");
    assert.equal(momento(r, "compra").detalle, "1,03 kWh de 22:15 a 00:00, en llano (P2).");
    assert.equal(momento(r, "resumen").titulo, "El día en cifras");
    assert.match(momento(r, "resumen").detalle, /producidos · .* consumidos · .* comprados · .* vertidos · \d+ % autoconsumo\.$/);
    assert.doesNotMatch(momento(r, "resumen").detalle, /Datos de/);
  });

  test(`día soleado (${unidad}): cada Cifra coincide con registros[indice] según su ruta`, () => {
    const s = serie(filasDe(soleado, { kwh }), kwh);
    const r = detectar(s);
    assert.ok(comprobarTrazabilidad(r, s) > 20);
  });
}

test("los momentos van ordenados por instante y llevan desde/hasta en los tramos", () => {
  const s = serie(filasDe(soleado));
  const r = detectar(s);
  const t = r.momentos.map((m) => m.instante.getTime());
  assert.deepEqual(t, [...t].sort((a, b) => a - b));
  const compra = momento(r, "compra");
  assert.equal(hora(compra.desde), "22:15");
  assert.equal(hora(compra.hasta), "00:00");
  assert.equal(compra.desde.getTime(), compra.instante.getTime());
});

test("maximoBateria cuando la batería nunca llega al 98 %", () => {
  const s = serie(filasDe((t) => soleado(t, { socMax: 87 })));
  const r = detectar(s);
  assert.ok(!tipos(r).includes("llena"));
  const m = momento(r, "maximoBateria");
  assert.equal(m.titulo, "La batería llega a su máximo: 87 %");
  assert.equal(hora(m.instante), "11:35");
  assert.equal(m.detalle, "A las 11:35.");
});

// --- Calidad de los datos (A) ---------------------------------------------------------------

test("unidad desconocida: desaparecen los momentos de ese rol y el resto sigue", () => {
  const s = serie(filasDe(soleado));
  const r = detectar({ ...s, unidadesRol: { ...s.unidadesRol, soc: "%" } });
  for (const t of ["llena", "maximoBateria", "minimoBateria"]) assert.ok(!tipos(r).includes(t), t);
  assert.equal(momento(r, "carga").detalle, "Entra a 1,10 kW.");
  assert.ok(!r.calidad.rolesDisponibles.includes("soc"));
  for (const t of ["arranque", "cubre", "vertido", "picoProduccion", "picoConsumo", "deja", "fin", "compra", "resumen"]) assert.ok(tipos(r).includes(t), t);

  const sinVertido = detectar({ ...s, unidadesRol: { ...s.unidadesRol, exportada: "Wh" } });
  assert.ok(!tipos(sinVertido).includes("vertido"));
  assert.equal(momento(sinVertido, "llena").detalle, "Al 98 % a las 12:00.");
  assert.equal(momento(sinVertido, "picoConsumo").detalle, "A las 19:00.");
  assert.doesNotMatch(momento(sinVertido, "resumen").detalle, /vertidos/);
});

test("rol disponible solo con valor válido en al menos el 90 % de los registros", () => {
  const conInvalidos = (proporcion) => {
    const s = serie(filasDe(soleado));
    const n = Math.round(s.registros.length * proporcion);
    const registros = s.registros.map((r, i) => (i < n ? { ...r, produccion: i % 2 ? Number.NaN : -3 } : r));
    return detectar({ ...s, registros });
  };
  const mal = conInvalidos(0.15);
  assert.ok(!mal.calidad.rolesDisponibles.includes("produccion"));
  for (const t of ["arranque", "cubre", "picoProduccion", "picoConsumo", "deja", "fin"]) assert.ok(!tipos(mal).includes(t), t);
  const bien = conInvalidos(0.05);
  assert.ok(bien.calidad.rolesDisponibles.includes("produccion"));
  assert.ok(tipos(bien).includes("picoProduccion"));
});

const vertidoCorto = (t) => ({ p: 0, c: 300, i: 300, e: t >= 720 && t < 735 ? 200 : 0, ca: 0, d: 0, s: 0 });

for (const horas of [0, null, Number.NaN]) {
  test(`registro con horas ${horas}: no alarga rachas`, () => {
    const s = serie(filasDe(vertidoCorto));
    assert.equal(hora(momento(detectar(s), "vertido").instante), "12:00", "control: 15 min sí son racha");
    const registros = s.registros.map((r) => (hora(r.instante) === "12:10" ? { ...r, horas } : r));
    assert.ok(!tipos(detectar({ ...s, registros })).includes("vertido"));
  });
}

test("registro sin duración: en W vale para picos; en kWh su potencia es desconocida", () => {
  const conPico = (kwh) => {
    const s = serie(filasDe(soleado, { kwh }), kwh);
    const registros = s.registros.map((r) =>
      hora(r.instante) === "15:00" ? { ...r, horas: 0, produccion: kwh ? 0.5 : 5000 } : r
    );
    return detectar({ ...s, registros });
  };
  assert.equal(hora(momento(conPico(false), "picoProduccion").instante), "15:00");
  assert.equal(momento(conPico(false), "picoProduccion").titulo, "Pico de producción: 5,00 kW");
  assert.equal(hora(momento(conPico(true), "picoProduccion").instante), "13:40");
});

test("instantes duplicados: registros sin duración que no rompen el día", () => {
  const filas = filasDe(soleado);
  const k = filas.findIndex((f) => f[0].getHours() === 15 && f[0].getMinutes() === 0);
  filas.splice(k, 0, [new Date(filas[k][0]), ...filas[k].slice(1)]);
  const s = serie(filas);
  assert.equal(s.registros.filter((r) => r.horas === 0).length, 1);
  const r = detectar(s);
  assert.deepEqual(enHora(r), ESPERADO);
  assert.equal(r.calidad.duplicadosHoraRepetida, 0);
  comprobarTrazabilidad(r, s);
});

test("hueco: corta la racha", () => {
  const largo = (t) => ({ ...vertidoCorto(t), e: t >= 720 && t < 750 ? 200 : 0 });
  assert.equal(hora(momento(detectar(serie(filasDe(largo))), "vertido").instante), "12:00", "control sin hueco");
  const r = detectar(serie(filasDe(largo, { quitar: (t) => t === 730 || t === 735 })));
  assert.equal(r.calidad.huecos.length, 1);
  assert.ok(!tipos(r).includes("vertido"));
});

test("hueco: no une tramos de compra", () => {
  const perfil = (t) => ({ p: 0, c: 300, i: (t >= 600 && t < 610) || (t >= 620 && t < 630) ? 900 : 0, e: 0, ca: 0, d: 300, s: 50 });
  const control = detectar(serie(filasDe(perfil)));
  assert.equal(control.momentos.filter((m) => m.tipo === "compra").length, 1, "control: la pausa de 10 min se une");
  const r = detectar(serie(filasDe(perfil, { quitar: (t) => t === 610 || t === 615 })));
  assert.equal(r.calidad.huecos.length, 1);
  assert.ok(!tipos(r).includes("compra"));
});

test("hueco: un «primero» justo después del hueco no se declara", () => {
  const r = detectar(serie(filasDe(soleado, { quitar: (t) => t >= 440 && t < 475 })));
  assert.ok(!tipos(r).includes("arranque"));
  assert.ok(tipos(r).includes("cubre"));
});

test("hueco: el detalle de los picos menciona el tiempo sin datos", () => {
  const s = serie(filasDe(soleado, { quitar: (t) => t >= 600 && t < 660 }));
  const r = detectar(s);
  assert.equal(r.calidad.huecos.length, 1);
  assert.equal(momento(r, "picoProduccion").detalle, "A las 13:40. El día tiene 58 min sin datos.");
  assert.match(momento(r, "resumen").detalle, / Datos de 23 h 2 min de 24 h\.$/);
  assert.equal(momento(r, "picoConsumo").detalle, "26 % lo puso el sol, 74 % la batería y 0 % la red. El día tiene 58 min sin datos.");
  comprobarTrazabilidad(r, s);
});

test("día que empieza con producción ≥ 50 W: no hay arranque", () => {
  const r = detectar(serie(filasDe(soleado, { desde: 600 })));
  assert.ok(!tipos(r).includes("arranque"));
  assert.ok(tipos(r).includes("picoProduccion"));
  assert.ok(tipos(r).includes("fin"));
});

test("el último registro de producción sin otro después: no hay fin", () => {
  const r = detectar(serie(filasDe(soleado, { hasta: 1100 })));
  assert.ok(!tipos(r).includes("fin"));
  assert.ok(!tipos(r).includes("minimoBateria"));
});

// --- Batería ----------------------------------------------------------------------------------

test("SoC 0 se trata como vacío y no es el mínimo", () => {
  const s = serie(filasDe(soleado));
  const registros = s.registros.map((r) => (hora(r.instante) === "23:00" ? { ...r, soc: 0 } : r));
  const r = detectar({ ...s, registros });
  assert.equal(momento(r, "minimoBateria").detalle, "Al 12 % a las 22:15.");
});

test("SoC > 100 es inválido", () => {
  const s = serie(filasDe((t) => soleado(t, { socMax: 87 })));
  const registros = s.registros.map((r) => (hora(r.instante) === "13:00" ? { ...r, soc: 150 } : r));
  const r = detectar({ ...s, registros });
  assert.ok(!tipos(r).includes("llena"));
  assert.equal(momento(r, "maximoBateria").titulo, "La batería llega a su máximo: 87 %");
});

test("SoC en menos del 90 % de los registros: sin momentos de batería ni «Estaba al»", () => {
  const s = serie(filasDe(soleado));
  const registros = s.registros.map((r, i) => (i % 7 === 0 ? { ...r, soc: 0 } : r));
  const r = detectar({ ...s, registros });
  for (const t of ["llena", "maximoBateria", "minimoBateria"]) assert.ok(!tipos(r).includes(t), t);
  assert.equal(momento(r, "carga").detalle, "Entra a 1,10 kW.");
});

test("sin carga ni descarga: sin momento de carga y pico de consumo sin reparto", () => {
  const s = serie(filasDe(soleado));
  const unidadesRol = { ...s.unidadesRol };
  delete unidadesRol.carga;
  delete unidadesRol.descarga;
  const registros = s.registros.map(({ carga, descarga, ...resto }) => resto);
  const r = detectar({ ...s, registros, unidadesRol });
  assert.ok(!tipos(r).includes("carga"));
  assert.equal(momento(r, "picoConsumo").detalle, "A las 19:00.");
  assert.equal(momento(r, "deja").detalle, "Producción 0,12 kW, consumo 0,40 kW.");
});

test("consumo sin importada: sin cubre, deja ni pico de consumo", () => {
  const s = serie(filasDe(soleado));
  const unidadesRol = { ...s.unidadesRol };
  delete unidadesRol.importada;
  const registros = s.registros.map(({ importada, ...resto }) => resto);
  const r = detectar({ ...s, registros, unidadesRol });
  for (const t of ["cubre", "deja", "picoConsumo", "compra", "minimoBateria"]) assert.ok(!tipos(r).includes(t), t);
  assert.doesNotMatch(momento(r, "resumen").detalle, /comprados|autoconsumo/);
});

test("consumo sin producción disponible: tampoco cubre, deja ni pico de consumo", () => {
  const s = serie(filasDe(soleado));
  const r = detectar({ ...s, unidadesRol: { ...s.unidadesRol, produccion: "VA" } });
  for (const t of ["cubre", "deja", "picoConsumo", "arranque", "fin"]) assert.ok(!tipos(r).includes(t), t);
});

// --- Cambio horario (§4.3.1) -----------------------------------------------------------------

test("día de 25 h con la 02 h duplicada por el Excel: aviso específico y duracionDia 25", () => {
  const fecha = [2026, 10, 25];
  const filas = filasDe(soleado, { fecha, texto: true });
  const k = filas.findIndex((f) => f[0].endsWith(" 03:00:00"));
  filas.splice(k, 0, ...filas.filter((f) => / 02:\d\d:00$/.test(f[0])).map((f) => [...f]));
  const s = serie(filas);
  const r = detectar(s);
  assert.equal(r.calidad.duracionDia, 25);
  assert.equal(r.calidad.duplicadosHoraRepetida, 12);
  const resumen = momento(r, "resumen").detalle;
  assert.match(resumen, /La hora repetida del cambio llega duplicada en el Excel: 12 registros sin duración\.$/);
  assert.doesNotMatch(resumen, /Datos de/);
  assert.doesNotMatch(momento(r, "picoProduccion").detalle, /sin datos/);
  comprobarTrazabilidad(r, s);
});

test("día de 23 h: sin hueco falso entre 01:55 y 03:00 y sin aviso de cobertura", () => {
  const fecha = [2026, 3, 29];
  const filas = filasDe(soleado, { fecha, texto: true, quitar: (t) => t >= 120 && t < 180 });
  const s = serie(filas);
  const r = detectar(s);
  assert.equal(r.calidad.duracionDia, 23);
  assert.deepEqual(r.calidad.huecos, []);
  assert.equal(r.calidad.duplicadosHoraRepetida, 0);
  assert.doesNotMatch(momento(r, "resumen").detalle, /Datos de/);
  comprobarTrazabilidad(r, s);
});

// --- Composición (D) -------------------------------------------------------------------------

test("día sin producción: menos de 3 momentos y sin relato, con el motivo", () => {
  const s = serie(filasDe(sinProduccion));
  const r = detectar(s);
  assert.ok(r.pasos.length < 3);
  assert.equal(r.relato, false);
  assert.match(r.motivo, /producción/);
  assert.ok(tipos(r).includes("resumen"));
});

test("dos momentos en el mismo registro se funden en un paso", () => {
  const r = detectar(serie(filasDe(soleado)));
  assert.equal(r.pasos.length, 10);
  const paso = r.pasos.find((p) => p.tipos.includes("cubre"));
  assert.deepEqual(paso.tipos, ["cubre", "carga"]);
  assert.equal(paso.titulo, "El sol ya cubre la casa · La batería empieza a cargar");
  assert.equal(paso.detalle, "Producción 1,50 kW, consumo 0,40 kW. Entra a 1,10 kW. Estaba al 20 %.");
  assert.deepEqual(r.pasos.find((p) => p.tipos.includes("compra")).tipos, ["minimoBateria", "compra"]);
});

test("tope de 10 pasos: se descartan por prioridad los que dejan un paso libre", () => {
  const s = serie(filasDe((t) => soleado(t, { compraManana: true })));
  const r = detectar(s);
  assert.equal(r.pasos.length, 10);
  assert.ok(!tipos(r).includes("vertido"));
  assert.ok(!tipos(r).includes("deja"));
  for (const t of ["carga", "arranque", "fin", "resumen", "llena"]) assert.ok(tipos(r).includes(t), t);
  assert.deepEqual(r.momentos.filter((m) => m.tipo === "compra").map((m) => hora(m.instante)), ["04:00", "06:00", "22:15"]);
  comprobarTrazabilidad(r, s);
});

test("compras: se quedan las 3 de más kWh con al menos 0,1 kWh", () => {
  const perfil = (t) => {
    const tramos = [[60, 80, 2000], [180, 200, 1200], [300, 320, 900], [420, 440, 600], [540, 560, 200]];
    const i = tramos.find(([a, b]) => t >= a && t < b)?.[2] ?? 0;
    return { p: 0, c: 300, i, e: 0, ca: 0, d: i ? 0 : 300, s: 50 };
  };
  const r = detectar(serie(filasDe(perfil)));
  assert.deepEqual(r.momentos.filter((m) => m.tipo === "compra").map((m) => hora(m.instante)), ["01:00", "03:00", "05:00"]);
});

test("periodo de la compra: P1/P2/P3, festivos y empate", () => {
  const tramo = (a, b) => (t) => ({ p: 0, c: 300, i: t >= a && t < b ? 600 : 0, e: 0, ca: 0, d: t >= a && t < b ? 0 : 300, s: 50 });
  const empate = serie(filasDe(tramo(810, 870)));
  assert.equal(momento(detectar(empate), "compra").detalle, "0,60 kWh de 13:30 a 14:30, sobre todo en punta (P1).");
  assert.equal(momento(detectar(empate, { festivos: new Set(["2026-06-16"]) }), "compra").detalle, "0,60 kWh de 13:30 a 14:30, en valle (P3).");
  const llano = serie(filasDe(tramo(830, 900)));
  assert.equal(momento(detectar(llano), "compra").detalle, "0,70 kWh de 13:50 a 15:00, sobre todo en llano (P2).");
});

test("sin festivos ni pasoMinutos, usa la mediana de los saltos del día", () => {
  const s = serie(filasDe(soleado, { quitar: (t) => t >= 600 && t < 660 }));
  const r = detectarMomentos(s.registros, s.unidadesRol);
  assert.equal(r.calidad.huecos.length, 1);
  assert.equal(hora(r.calidad.huecos[0].desde), "09:55");
  assert.equal(hora(r.calidad.huecos[0].hasta), "11:00");
});

test("sin registros: sin momentos ni relato", () => {
  const r = detectarMomentos([], { produccion: "W" });
  assert.deepEqual(r.momentos, []);
  assert.deepEqual(r.pasos, []);
  assert.equal(r.relato, false);
});

// --- Pureza -------------------------------------------------------------------------------------

test("no modifica la entrada (congelada) y trabaja sobre una copia ordenada", () => {
  const s = serie(filasDe(soleado));
  const desordenados = [...s.registros].reverse();
  const antes = JSON.stringify(desordenados);
  for (const r of desordenados) Object.freeze(r);
  Object.freeze(desordenados);
  const unidadesRol = Object.freeze({ ...s.unidadesRol });
  const r = detectarMomentos(desordenados, unidadesRol, Object.freeze({ festivos: new Set(), pasoMinutos: 5 }));
  assert.equal(JSON.stringify(desordenados), antes);
  assert.deepEqual(enHora(r), ESPERADO);
  for (const m of r.momentos) assert.equal(desordenados[m.indice].instante.getTime(), m.instante.getTime());
});
