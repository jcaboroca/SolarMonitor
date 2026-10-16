// Arco solar (§4.3, §8.4): modelo puro, geometría, cambio horario y trazabilidad.
// node --test ejecuta cada fichero en su propio proceso: fijar la zona aquí no afecta a los demás.
process.env.TZ = "Europe/Madrid";

import assert from "node:assert/strict";
import { test } from "node:test";
import { modeloArco, formatear, angulo, punto, rayosDe, franjaEn, LMAX, LCASA, CX, CY, R } from "../js/arco.js";
import { juntarHoras } from "../js/ahora.js";
import { euros } from "../js/asesor/motor.js";

const H = 3600000;
const fecha = (a, m, d, h = 0, min = 0) => new Date(a, m - 1, d, h, min);

// Producción de 08 a 20 h: campana sobre el centro de la ventana; nada fuera.
const kwhSol = (h) => (h >= 8 && h < 20 ? Math.round((0.2 + 2.2 * Math.sin((Math.PI * (h - 7.5)) / 12)) * 1000) / 1000 : 0);
const medida = (inicio, { solar = 0, casa = 0.3, soc = null, cobertura = 1 } = {}) => ({ inicio, solarKwh: solar, casaKwh: casa, socFin: soc, cobertura });

function prevision(a, m, d, { horas = 48, origen = "prevision", confianza = "alta", factor = 1 } = {}) {
  const lista = [];
  for (let h = 0; h < horas; h++) lista.push({ inicio: new Date(a, m - 1, d, h), kwh: kwhSol(h % 24) * factor, origen, confianza });
  return lista;
}

function horizonte(ahora, horas = 36, socInicial = 72, subida = 5) {
  const slots = [];
  let inicio = ahora.getTime();
  for (let i = 0; i < horas; i++) {
    const d = new Date(inicio);
    d.setMinutes(0, 0, 0);
    const fin = d.getTime() + H;
    slots.push({ inicio: new Date(inicio), fin: new Date(fin) });
    inicio = fin;
  }
  return { slots, pasos: slots.map((_, i) => ({ socPct: Math.min(socInicial + subida * i, 100) })) };
}

const HABITOS = {
  solarTipica: () => null,
  consumo: () => ({ kwh: 0.3, origen: "habito" }),
  socTipico: () => null,
};

function base({ ahora = fecha(2026, 10, 16, 12), ...cambios } = {}) {
  const worker = [];
  for (let h = 0; h < ahora.getHours(); h++) {
    worker.push(medida(fecha(2026, 10, 16, h), { solar: kwhSol(h) * 0.9, casa: 0.3, soc: 20 + h * 5 }));
  }
  worker.push(medida(fecha(2026, 10, 16, ahora.getHours()), { solar: kwhSol(ahora.getHours()) * 0.3, casa: 0.1, soc: 70, cobertura: 0.3 }));
  const { slots, pasos } = horizonte(ahora);
  const yaMismo = { inicio: ahora, fin: new Date(ahora.getTime() + H), coste: 0.04 };
  return {
    ahora,
    error: null,
    horasPorFuente: { local: [], archivo: [], worker },
    solar: prevision(2026, 10, 16),
    prevision: { traida: new Date(ahora.getTime() - 10 * 60000), sinConexion: false },
    calibracion: { kGlobal: 0.004, maxKwh: 2.8, confianza: "alta" },
    habitos: HABITOS,
    vivo: { solarW: 2410, casaW: 620, soc: 72, instante: new Date(ahora.getTime() - 3 * 60000) },
    fresco: true,
    bateria: { capacidadKwh: 5.1, socMinimoPct: 10, rendimiento: 0.9, maxCargaKw: 1.9, maxDescargaKw: 3.8 },
    reserva: { pct: 35, hasta: fecha(2026, 10, 17, 9), aplicaAhora: false },
    slots,
    pasos,
    decision: { estado: "verde", titulo: "Buen momento", ahora: yaMismo, mejor: yaMismo },
    carga: { id: "referencia", nombre: "Consumo grande" },
    ...cambios,
  };
}

const porId = (m) => new Map(m.cifras.map((c) => [c.id, c]));
const franjaDe = (m, d) => m.franjas.find((f) => f.inicio.getTime() === d.getTime());
const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} ≠ ${b}`);

// --- Reglas de coherencia del §4.3.6 -------------------------------------------

const RUTAS = [
  [/^horasPorFuente\.(worker|archivo|local)\[[\d+]+\]\.(solarKwh|casaKwh|cobertura|socFin)$/, (c, m) => c.clase === "medido" && c.procedencia === m[1]],
  [/^solar\[[\d+]+\]\.kwh$/, (c) => c.clase === "previsto" && c.procedencia === "open-meteo"],
  [/^habitos\.(solarTipica|socTipico)\(\d+\)$/, (c) => c.clase === "tipico" && c.procedencia === "habitos"],
  [/^habitos\.consumo\(\d+\)\.kwh$/, (c) => c.clase === "tipico" && c.procedencia === "habitos"],
  [/^franjas\[\d+\]\.inicio$/, (c) => c.clase === "calculo" && c.procedencia === "calculo"],
  [/^ventana\.(desde|hasta)$/, (c) => c.clase === "calculo" && c.procedencia === "calculo"],
  [/^suma\(franjas\.real\)$/, (c) => c.clase === "medido" && c.procedencia === "calculo"],
  [/^suma\(franjas\.previsto\)$/, (c) => c.clase === "previsto" && c.procedencia === "calculo"],
  [/^cuenta\(franjas sin dato\)$/, (c) => c.clase === "calculo" && c.procedencia === "calculo"],
  [/^calibracion\.maxKwh$/, (c) => c.clase === "calculo" && c.procedencia === "calibracion"],
  [/^maximo\(franjas\)$/, (c) => c.clase === "calculo" && c.procedencia === "calculo"],
  [/^prevision\.traida$/, (c) => c.clase === "calculo" && c.procedencia === "open-meteo"],
  [/^pasos\[\d+\]\.socPct$/, (c) => c.clase === "simulado" && c.procedencia === "simulador"],
  [/^vivo\.(solarW|casaW|soc|instante)$/, (c) => c.clase === "vivo" && c.procedencia === "worker"],
  [/^ahora − vivo\.instante$/, (c) => c.clase === "calculo" && c.procedencia === "calculo"],
  [/^bateria\.socMinimoPct$/, (c) => c.clase === "ajuste" && c.procedencia === "ajuste"],
  [/^reserva\.pct$/, (c) => c.clase === "simulado" && c.procedencia === "asesor"],
  [/^decision\.(ahora\.coste|mejor\.(inicio|fin|coste))$/, (c) => c.clase === "simulado" && c.procedencia === "asesor"],
];

function comprobarCoherencia(m) {
  const mapa = new Map();
  // 1. ids únicos
  for (const c of m.cifras) {
    assert.ok(!mapa.has(c.id), `id repetido: ${c.id}`);
    mapa.set(c.id, c);
  }
  const t = m.tabla;
  const enTabla = new Set([...t.franjas.flatMap((f) => f.ids), ...t.pie, ...t.bateria, ...t.vivo, ...t.asesor]);
  // 2. visibles y resumen existen y están en la tabla
  for (const [zona, ids] of Object.entries(m.visibles)) {
    for (const id of ids) {
      assert.ok(mapa.has(id), `${zona}: ${id} no está en cifras`);
      assert.ok(enTabla.has(id), `${zona}: ${id} no está en la tabla`);
    }
  }
  for (const id of m.resumen.ids) {
    assert.ok(mapa.has(id), `resumen: ${id}`);
    assert.ok(enTabla.has(id), `resumen en tabla: ${id}`);
  }
  // 3. la tabla solo cita cifras existentes
  for (const id of enTabla) assert.ok(mapa.has(id), `tabla: ${id}`);
  // 4. texto = formatear(valor) (o euros)
  for (const c of m.cifras) {
    assert.ok(Number.isFinite(c.valor), `${c.id}: valor ${c.valor}`);
    assert.equal(c.texto, c.unidad === "€" ? euros(c.valor) : formatear(c.valor, c.unidad, c.decimales), c.id);
  }
  // 6. el resumen es la plantilla rellena y no tiene cifras sueltas
  assert.equal(m.resumen.texto, m.resumen.plantilla.replace(/\{([^}]+)\}/g, (_, id) => mapa.get(id).texto));
  assert.doesNotMatch(m.resumen.plantilla.replace(/\{[^}]+\}/g, ""), /\d/);
  assert.deepEqual(m.resumen.ids, [...m.resumen.plantilla.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]));
  // 7. clase y procedencia concuerdan con la ruta
  for (const c of m.cifras) {
    const regla = RUTAS.map(([re, ok]) => [re.exec(c.ruta), ok]).find(([x]) => x);
    assert.ok(regla, `${c.id}: ruta desconocida ${c.ruta}`);
    assert.ok(regla[1](c, regla[0]), `${c.id}: ${c.clase}/${c.procedencia} no casa con ${c.ruta}`);
  }
  // 8. longitud de cada rayo a partir del valor de su cifra
  for (const r of rayosDe(m)) {
    if (!r.id) continue;
    const c = mapa.get(r.id);
    assert.ok(c, `rayo sin cifra: ${r.id}`);
    const esperado = r.tipo.startsWith("casa")
      ? Math.min((c.valor / m.escala.kwh) * LMAX, LCASA)
      : Math.min(c.valor / m.escala.kwh, 1) * LMAX;
    cerca(r.longitud, esperado, 1e-9, r.id);
  }
  // 5. ningún valor nulo genera cifra
  for (const f of m.franjas) {
    const ms = f.inicio.getTime();
    for (const campo of ["real", "previsto", "tipico", "casaReal", "casaTipica", "socFin"]) {
      if (f[campo] === null) assert.ok(!mapa.has(`franja:${ms}:${campo}`), `${ms} ${campo} nulo con cifra`);
    }
  }
}

// --- Formato -------------------------------------------------------------------

test("formatear escribe cada unidad en es-ES y delega el euro en el motor", () => {
  assert.equal(formatear(0.42, "kWh", 2), "0,42 kWh");
  assert.equal(formatear(11.43, "kWh", 1), "11,4 kWh");
  assert.equal(formatear(2.41, "kW", 2), "2,41 kW");
  assert.equal(formatear(78, "%", 0), "78 %");
  assert.equal(formatear(0.0249, "€", null), euros(0.0249));
  assert.equal(formatear(fecha(2026, 10, 16, 14, 5).getTime(), "hora", null), "14:05");
  assert.equal(formatear(fecha(2026, 10, 16, 8).getTime(), "franja", null), "08 H");
  assert.equal(formatear(3, "h", 0), "3 h");
  assert.equal(formatear(34, "min", 0), "34 min");
});

// --- Geometría (§4.3.5, criterio 7) -----------------------------------------------

test("con la ventana 08–20 h el ángulo y el punto son los de la tabla del §4.3.5", () => {
  const ventana = { desde: fecha(2026, 10, 16, 8), hasta: fecha(2026, 10, 16, 20) };
  const casos = [
    [fecha(2026, 10, 16, 8), 180, [50, 200]],
    [fecha(2026, 10, 16, 8, 30), 172.5, [51.28, 180.42]],
    [fecha(2026, 10, 16, 12), 120, [125, 70.1]],
    [fecha(2026, 10, 16, 14), 90, [200, 50]],
    [fecha(2026, 10, 16, 20), 0, [350, 200]],
  ];
  for (const [t, theta, [x, y]] of casos) {
    cerca(angulo(t, ventana), theta, 1e-9, `θ(${t.getHours()}:${t.getMinutes()})`);
    const p = punto(angulo(t, ventana));
    const tol = theta === 172.5 ? 0.01 : theta === 120 ? 0.01 : 1e-6;
    cerca(p.x, x, tol, "x");
    cerca(p.y, y, tol, "y");
  }
  cerca(punto(120).y, 200 - 150 * Math.sin((2 * Math.PI) / 3), 1e-9, "y exacta a las 12");
  assert.deepEqual([CX, CY, R], [200, 200, 150]);
});

test("el marcador a las 12:00 va a 120° y a las 14:00 a 90°; fuera de la ventana, bajo el horizonte", () => {
  cerca(modeloArco(base({ ahora: fecha(2026, 10, 16, 12) })).marcador.angulo, 120, 1e-9, "12:00");
  cerca(modeloArco(base({ ahora: fecha(2026, 10, 16, 14) })).marcador.angulo, 90, 1e-9, "14:00");
  const pista = modeloArco(base({ ahora: fecha(2026, 10, 16, 14) })).marcador;
  assert.equal(pista.posicion, "pista");
  assert.equal(pista.lleno, true);
  const antes = modeloArco(base({ ahora: fecha(2026, 10, 16, 7) })).marcador;
  assert.deepEqual([antes.posicion, antes.angulo], ["antes", null]);
  const despues = modeloArco(base({ ahora: fecha(2026, 10, 16, 20, 30) })).marcador;
  assert.deepEqual([despues.posicion, despues.angulo], ["despues", null]);
});

test("cada franja de la ventana tiene su ángulo en el centro y las de fuera no tienen", () => {
  const m = modeloArco(base());
  assert.equal(m.franjas.length, 24);
  assert.equal(m.ventana.desde.getTime(), fecha(2026, 10, 16, 8).getTime());
  assert.equal(m.ventana.hasta.getTime(), fecha(2026, 10, 16, 20).getTime());
  assert.equal(franjaDe(m, fecha(2026, 10, 16, 8)).angulo, 172.5);
  assert.equal(franjaDe(m, fecha(2026, 10, 16, 7)).angulo, null);
  assert.equal(franjaDe(m, fecha(2026, 10, 16, 20)).angulo, null);
  assert.equal(m.franjas.filter((f) => f.angulo !== null).length, 12);
});

test("hay un rayo de sol por franja de la ventana, y el grosor baja con más de 13", () => {
  const m = modeloArco(base());
  const contornos = rayosDe(m).filter((r) => r.tipo === "contorno");
  assert.equal(contornos.length, 12);
  assert.ok(contornos.every((r) => r.grosor === 6));
  const verano = modeloArco(base({ solar: prevision(2026, 10, 16).map((s) => ({ ...s, kwh: s.inicio.getHours() >= 6 && s.inicio.getHours() < 21 ? 1 : 0 })) }));
  assert.ok(rayosDe(verano).filter((r) => r.tipo === "contorno").every((r) => r.grosor === 4));
});

test("franjaEn devuelve la franja más cercana al puntero y nada en el centro o bajo el horizonte", () => {
  const m = modeloArco(base());
  const p = punto(franjaDe(m, fecha(2026, 10, 16, 13)).angulo, R + 10);
  assert.equal(franjaEn(m, p.x, p.y).inicio.getTime(), fecha(2026, 10, 16, 13).getTime());
  assert.equal(franjaEn(m, CX, CY - 10), null);
  assert.equal(franjaEn(m, CX + R, CY + 40), null);
});

// --- Cambio horario (§4.3.1, criterio 36) ----------------------------------------

test("el 29-mar-2026 tiene 23 franjas y ninguna 02 H", () => {
  const ahora = fecha(2026, 3, 29, 12);
  const m = modeloArco(base({ ahora, horasPorFuente: { local: [], archivo: [], worker: [] }, solar: prevision(2026, 3, 29), ...horizonte(ahora) }));
  assert.equal(m.dia.horas, 23);
  assert.equal(m.franjas.length, 23);
  const rotulos = m.franjas.map((f) => porId(m).get(`franja:${f.inicio.getTime()}:rotulo`).texto);
  assert.ok(!rotulos.some((r) => r.startsWith("02")), rotulos.join());
  assert.deepEqual(rotulos.slice(0, 3), ["00 H", "01 H", "03 H"]);
  comprobarCoherencia(m);
});

test("el 25-oct-2026 tiene 25 franjas y dos 02 H distinguidas por su desfase", () => {
  const ahora = fecha(2026, 10, 25, 12);
  const m = modeloArco(base({ ahora, horasPorFuente: { local: [], archivo: [], worker: [] }, solar: prevision(2026, 10, 25), ...horizonte(ahora) }));
  assert.equal(m.dia.horas, 25);
  assert.equal(m.franjas.length, 25);
  const dos = m.franjas.filter((f) => f.inicio.getHours() === 2);
  assert.equal(dos.length, 2);
  const textos = dos.map((f) => porId(m).get(`franja:${f.inicio.getTime()}:rotulo`).texto);
  assert.deepEqual(textos, ["02 H (UTC+2)", "02 H (UTC+1)"]);
  assert.deepEqual(dos.map((f) => f.rotulo), textos);
  assert.deepEqual(dos.map((f) => f.desfaseUtc), ["UTC+2", "UTC+1"]);
  assert.equal(m.franjas.filter((f) => f.desfaseUtc).length, 2);
  comprobarCoherencia(m);
});

test("una entrada del Worker de la segunda 02 H va a la segunda franja", () => {
  const ahora = fecha(2026, 10, 25, 12);
  const segunda = new Date(Date.UTC(2026, 9, 25, 1));
  const m = modeloArco(base({ ahora, horasPorFuente: { local: [], archivo: [], worker: [medida(segunda, { casa: 0.25 })] }, solar: prevision(2026, 10, 25), ...horizonte(ahora) }));
  const dos = m.franjas.filter((f) => f.inicio.getHours() === 2);
  assert.equal(dos[0].casaReal, null);
  assert.equal(dos[1].casaReal.kwh, 0.25);
  assert.equal(dos[1].casaReal.procedencia, "worker");
  assert.equal(dos[1].nota, null);
});

test("una entrada local de la 02 H ambigua lleva la nota de hora repetida y no se reparte", () => {
  const ahora = fecha(2026, 10, 25, 12);
  const primera = new Date(Date.UTC(2026, 9, 25, 0));
  const m = modeloArco(base({ ahora, horasPorFuente: { local: [medida(primera, { casa: 0.5 })], archivo: [], worker: [] }, solar: prevision(2026, 10, 25), ...horizonte(ahora) }));
  const dos = m.franjas.filter((f) => f.inicio.getHours() === 2);
  assert.equal(dos[0].casaReal.kwh, 0.5);
  assert.equal(dos[0].nota, "hora-repetida-local");
  assert.equal(dos[1].casaReal, null);
  assert.equal(dos[1].nota, "hora-repetida-local");
  assert.ok(m.leyendas.includes("hora-repetida-local"));
  assert.match(m.resumen.texto, /hora repetida del cambio no se distingue en el Excel/);
  comprobarCoherencia(m);
});

test("la energía del día no cambia: Σ de las franjas = Σ de las entradas ganadoras del día", () => {
  for (const [a, mes, d] of [[2026, 3, 29], [2026, 10, 25], [2026, 10, 16]]) {
    const ahora = fecha(a, mes, d, 23, 30);
    const inicio = fecha(a, mes, d).getTime();
    const fin = fecha(a, mes, d + 1).getTime();
    const worker = [];
    for (let t = inicio - 2 * H; t < fin + 2 * H; t += H) worker.push(medida(new Date(t), { solar: 0.1, casa: 0.2 }));
    const m = modeloArco(base({ ahora, horasPorFuente: { local: [], archivo: [], worker }, solar: prevision(a, mes, d), ...horizonte(ahora) }));
    const delDia = worker.filter((h) => h.inicio.getTime() >= inicio && h.inicio.getTime() < fin && h.inicio < ahora);
    const sumaFranjas = m.franjas.reduce((s, f) => s + (f.casaReal?.kwh ?? 0), 0);
    cerca(sumaFranjas, delDia.reduce((s, h) => s + h.casaKwh, 0), 1e-9, `${d}/${mes}`);
    assert.equal(m.franjas.reduce((n, f) => n + (f.casaReal?.entradas ?? 0), 0), delDia.length);
  }
});

test("la precedencia por clave coincide con juntarHoras: Worker sobre archivo sobre local", () => {
  const ahora = fecha(2026, 10, 16, 20, 59);
  const local = [], archivo = [], worker = [];
  for (let h = 0; h < 20; h++) {
    local.push(medida(fecha(2026, 10, 16, h), { solar: 1 + h, casa: 0.1 }));
    if (h % 2 === 0) archivo.push(medida(fecha(2026, 10, 16, h), { solar: 100 + h, casa: 0.2 }));
    if (h % 3 === 0) worker.push(medida(fecha(2026, 10, 16, h), { solar: 1000 + h, casa: 0.3 }));
  }
  const juntas = juntarHoras(local, archivo, worker);
  const m = modeloArco(base({ ahora, horasPorFuente: { local, archivo, worker } }));
  for (const h of juntas) {
    const f = franjaDe(m, h.inicio);
    assert.equal(f.real.kwh, h.solarKwh, `${h.inicio.getHours()} h`);
    const esperada = worker.includes(h) ? "worker" : archivo.includes(h) ? "archivo" : "local";
    assert.equal(f.real.procedencia, esperada);
  }
  comprobarCoherencia(m);
});

// --- Clases de datos ------------------------------------------------------------------

test("con previsión, lo típico es nulo en todas las franjas", () => {
  const m = modeloArco(base({ habitos: { ...HABITOS, solarTipica: () => 0.9 } }));
  assert.ok(m.franjas.every((f) => f.tipico === null));
  assert.ok(!m.leyendas.includes("tipico"));
});

test("sin previsión y con hábito se usa lo típico y el estado es sin-prevision", () => {
  const m = modeloArco(base({ solar: [], habitos: { ...HABITOS, solarTipica: (h) => kwhSol(h) } }));
  assert.equal(m.estado, "sin-prevision");
  assert.ok(m.leyendas.includes("tipico"));
  assert.equal(franjaDe(m, fecha(2026, 10, 16, 13)).tipico.kwh, kwhSol(13));
  assert.ok(m.franjas.every((f) => f.previsto === null));
  comprobarCoherencia(m);
});

test("sin previsión, sin hábito y sin medidas de sol, el estado es sin-sol", () => {
  const m = modeloArco(base({ solar: [], horasPorFuente: { local: [], archivo: [], worker: [] } }));
  assert.equal(m.estado, "sin-sol");
  assert.equal(m.ventana, null);
  assert.equal(m.escala, null);
  assert.deepEqual(rayosDe(m), []);
  comprobarCoherencia(m);
});

test("lo real y lo previsto nunca comparten un valor", () => {
  const m = modeloArco(base());
  for (const c of m.cifras) {
    if (/:real$|:casaReal$/.test(c.id)) assert.equal(c.clase, "medido");
    if (/:previsto$/.test(c.id)) assert.equal(c.clase, "previsto");
    if (/:tipico$|:casaTipica$/.test(c.id)) assert.equal(c.clase, "tipico");
  }
});

// --- Medido ------------------------------------------------------------------------------

test("una franja pasada sin entrada es «sin dato»: real nulo, sin cifra y sin contar como 0", () => {
  const entrada = base();
  const worker = entrada.horasPorFuente.worker.filter((h) => h.inicio.getHours() !== 10);
  const m = modeloArco({ ...entrada, horasPorFuente: { local: [], archivo: [], worker } });
  const diez = franjaDe(m, fecha(2026, 10, 16, 10));
  assert.equal(diez.real, null);
  assert.equal(diez.casaReal, null);
  assert.equal(diez.casaTipica, null);
  assert.equal(diez.pasada, true);
  assert.ok(!porId(m).has(`franja:${fecha(2026, 10, 16, 10).getTime()}:real`));
  assert.equal(m.totales.horasSinDato, 1);
  const rayo = rayosDe(m).filter((r) => r.franja === fecha(2026, 10, 16, 10).getTime());
  assert.ok(rayo.some((r) => r.tipo === "sin-dato"));
  assert.ok(!rayo.some((r) => r.tipo === "relleno"));
  cerca(m.totales.realKwh, worker.filter((h) => h.inicio < m.franjas[12].fin).reduce((s, h) => s + h.solarKwh, 0), 1e-9, "total");
  comprobarCoherencia(m);
});

test("estados completa, parcial y en curso según cobertura y hora; sin extrapolar", () => {
  const entrada = base();
  const worker = entrada.horasPorFuente.worker.map((h) =>
    h.inicio.getHours() === 9 ? { ...h, cobertura: 0.5, solarKwh: 0.2 } : h
  );
  const m = modeloArco({ ...entrada, horasPorFuente: { local: [], archivo: [], worker } });
  assert.equal(franjaDe(m, fecha(2026, 10, 16, 8)).real.estado, "completa");
  const parcial = franjaDe(m, fecha(2026, 10, 16, 9)).real;
  assert.deepEqual([parcial.estado, parcial.kwh, parcial.cobertura], ["parcial", 0.2, 0.5]);
  assert.equal(porId(m).get(`franja:${fecha(2026, 10, 16, 9).getTime()}:cobertura`).texto, "30 min");
  const enCurso = franjaDe(m, fecha(2026, 10, 16, 12)).real;
  assert.deepEqual([enCurso.estado, enCurso.kwh], ["en-curso", kwhSol(12) * 0.3]);
  assert.deepEqual([m.totales.horasCompletas, m.totales.horasParciales, m.totales.horasEnCurso], [11, 1, 1]);
  const rayado = rayosDe(m).find((r) => r.id === `franja:${fecha(2026, 10, 16, 9).getTime()}:real`);
  assert.equal(rayado.rayado, true);
  comprobarCoherencia(m);
});

test("una entrada con inicio futuro se ignora", () => {
  const entrada = base();
  const futura = medida(fecha(2026, 10, 16, 15), { solar: 9, casa: 9 });
  const m = modeloArco({ ...entrada, horasPorFuente: { ...entrada.horasPorFuente, worker: [...entrada.horasPorFuente.worker, futura] } });
  const f = franjaDe(m, fecha(2026, 10, 16, 15));
  assert.equal(f.real, null);
  assert.equal(f.casaReal, null);
  assert.equal(f.pasada, false);
  assert.equal(f.casaTipica.kwh, 0.3);
});

test("varias entradas de una procedencia en una franja se suman, con la cobertura topada a 1", () => {
  const entrada = base();
  const extra = [
    medida(fecha(2026, 10, 16, 10, 0), { solar: 0.5, casa: 0.1, soc: 60, cobertura: 0.6 }),
    medida(fecha(2026, 10, 16, 10, 30), { solar: 0.25, casa: 0.2, soc: 65, cobertura: 0.6 }),
  ];
  const worker = [...entrada.horasPorFuente.worker.filter((h) => h.inicio.getHours() !== 10), ...extra];
  const m = modeloArco({ ...entrada, horasPorFuente: { local: [], archivo: [], worker } });
  const f = franjaDe(m, fecha(2026, 10, 16, 10));
  assert.deepEqual([f.real.kwh, f.real.entradas, f.real.cobertura, f.real.estado], [0.75, 2, 1, "completa"]);
  cerca(f.casaReal.kwh, 0.3, 1e-12, "casa");
  assert.deepEqual(f.socFin, { pct: 65, procedencia: "worker" });
  assert.match(porId(m).get(`franja:${fecha(2026, 10, 16, 10).getTime()}:real`).ruta, /^horasPorFuente\.worker\[\d+\+\d+\]\.solarKwh$/);
  comprobarCoherencia(m);
});

test("SoC 0 o fuera de rango no es un dato", () => {
  const entrada = base();
  const worker = entrada.horasPorFuente.worker.map((h) => (h.inicio.getHours() === 5 ? { ...h, socFin: 0 } : h.inicio.getHours() === 6 ? { ...h, socFin: 140 } : h));
  const m = modeloArco({ ...entrada, horasPorFuente: { local: [], archivo: [], worker } });
  assert.equal(franjaDe(m, fecha(2026, 10, 16, 5)).socFin, null);
  assert.equal(franjaDe(m, fecha(2026, 10, 16, 6)).socFin, null);
  assert.equal(franjaDe(m, fecha(2026, 10, 16, 7)).socFin.pct, 55);
});

// --- Casa -------------------------------------------------------------------------------------

test("la casa típica solo va en franjas futuras o en curso", () => {
  const m = modeloArco(base());
  for (const f of m.franjas) {
    if (f.fin <= fecha(2026, 10, 16, 12)) assert.equal(f.casaTipica, null, f.rotulo);
    else assert.deepEqual(f.casaTipica, { kwh: 0.3, origen: "habito" }, f.rotulo);
  }
});

test("un consumo que supera Lcasa se topa y marca el desborde", () => {
  const m = modeloArco(base({ habitos: { ...HABITOS, consumo: () => ({ kwh: 5, origen: "habito" }) } }));
  const casa = rayosDe(m).filter((r) => r.tipo === "casa-tipica");
  assert.ok(casa.length > 0);
  assert.ok(casa.every((r) => r.longitud === LCASA && r.desborde));
});

// --- Escala ----------------------------------------------------------------------------------

test("con calibración la escala es la de la instalación", () => {
  const m = modeloArco(base());
  assert.deepEqual(m.escala, { kwh: 2.8, origen: "instalacion" });
  assert.equal(porId(m).get("escala").procedencia, "calibracion");
  assert.ok(!m.leyendas.includes("escala-dia"));
});

test("sin calibración la escala es el máximo del día y se declara", () => {
  const m = modeloArco(base({ calibracion: { kGlobal: null, maxKwh: null, confianza: "ninguna" } }));
  const maximo = Math.max(...m.franjas.flatMap((f) => [f.previsto?.kwh ?? 0, f.real?.kwh ?? 0]));
  assert.deepEqual(m.escala, { kwh: maximo, origen: "dia" });
  assert.ok(m.leyendas.includes("escala-dia"));
  comprobarCoherencia(m);
});

test("con todo a 0 no hay escala ni rayos", () => {
  const m = modeloArco(base({
    calibracion: { kGlobal: null, maxKwh: 0, confianza: "ninguna" },
    solar: prevision(2026, 10, 16, { factor: 0 }),
    horasPorFuente: { local: [], archivo: [], worker: [] },
  }));
  assert.equal(m.escala, null);
  assert.deepEqual(rayosDe(m), []);
});

// --- Previsión ---------------------------------------------------------------------------

test("la previsión estimada por potencia pico da el estado sin-calibrar y contornos discontinuos", () => {
  const m = modeloArco(base({ solar: prevision(2026, 10, 16, { origen: "estimado", confianza: "baja" }) }));
  assert.equal(m.estado, "sin-calibrar");
  assert.ok(m.leyendas.includes("sin-calibrar"));
  assert.equal(m.prevision.estimada, true);
  assert.ok(rayosDe(m).filter((r) => r.tipo === "contorno").every((r) => r.discontinuo));
  comprobarCoherencia(m);
});

test("la caché con fallo da la leyenda sin-conexion y conserva la hora de la previsión", () => {
  const entrada = base();
  const m = modeloArco({ ...entrada, prevision: { traida: entrada.prevision.traida, sinConexion: true } });
  assert.ok(m.leyendas.includes("sin-conexion"));
  assert.equal(m.prevision.sinConexion, true);
  assert.equal(porId(m).get("prevision:traida").valor, entrada.prevision.traida.getTime());
  assert.ok(m.visibles.leyenda.includes("prevision:traida"));
});

// --- Batería -------------------------------------------------------------------------------

test("el SoC del indicador tiene cuatro orígenes y con «ninguno» no aparece el 50 %", () => {
  const vivo = modeloArco(base());
  assert.deepEqual([vivo.bateria.soc, vivo.bateria.origenSoc], [72, "vivo"]);
  const antigua = modeloArco(base({ fresco: false }));
  assert.deepEqual([antigua.bateria.soc, antigua.bateria.origenSoc], [72, "lectura-antigua"]);
  assert.ok(antigua.visibles.lecturas.includes("vivo:antiguedad"));
  const tipico = modeloArco(base({ vivo: null, fresco: false, habitos: { ...HABITOS, socTipico: () => 61 } }));
  assert.deepEqual([tipico.bateria.soc, tipico.bateria.origenSoc], [61, "tipico"]);
  assert.equal(porId(tipico).get("bateria:soc").clase, "tipico");
  const ninguno = modeloArco(base({ vivo: null, fresco: false }));
  assert.deepEqual([ninguno.bateria.soc, ninguno.bateria.origenSoc], [null, "ninguno"]);
  assert.ok(!porId(ninguno).has("bateria:soc"));
  assert.ok(!ninguno.cifras.some((c) => /^(bateria|vivo):/.test(c.id) && c.valor === 50));
  assert.doesNotMatch(ninguno.resumen.texto, /50 %/);
  assert.match(ninguno.resumen.texto, /sin dato de batería/i);
  for (const m of [vivo, antigua, tipico, ninguno]) comprobarCoherencia(m);
});

test("la muesca medida va al fin de la primera franja con la batería llena", () => {
  const entrada = base();
  const worker = entrada.horasPorFuente.worker.map((h) => (h.inicio.getHours() >= 10 ? { ...h, socFin: 99 } : h));
  const m = modeloArco({ ...entrada, horasPorFuente: { local: [], archivo: [], worker } });
  assert.equal(m.muesca.origen, "medido");
  assert.equal(m.muesca.instante.getTime(), fecha(2026, 10, 16, 11).getTime());
  assert.equal(m.muesca.angulo, angulo(fecha(2026, 10, 16, 11), m.ventana));
  assert.equal(porId(m).get("muesca").procedencia, "worker");
  comprobarCoherencia(m);
});

test("la muesca simulada solo aparece sin la medida y dentro de la ventana", () => {
  const m = modeloArco(base());
  assert.equal(m.muesca.origen, "simulado");
  assert.equal(m.muesca.instante.getTime(), fecha(2026, 10, 16, 19).getTime());
  assert.equal(porId(m).get("muesca").clase, "simulado");
  const tarde = modeloArco(base(horizonte(fecha(2026, 10, 16, 12), 36, 20, 4)));
  assert.equal(tarde.muesca, null);
  comprobarCoherencia(m);
});

test("sin origen de SoC no hay muesca simulada ni SoC al acabar el sol", () => {
  const m = modeloArco(base({ vivo: null, fresco: false }));
  assert.equal(m.muesca, null);
  assert.equal(m.bateria.alAcabarSol, null);
});

test("el SoC al acabar el sol es el del tramo que termina en el fin de la ventana", () => {
  const entrada = base();
  const m = modeloArco(entrada);
  const i = entrada.slots.findIndex((s) => s.fin.getTime() === fecha(2026, 10, 16, 20).getTime());
  assert.equal(m.bateria.alAcabarSol, entrada.pasos[i].socPct);
  assert.equal(porId(m).get("bateria:alAcabarSol").ruta, `pasos[${i}].socPct`);
  assert.deepEqual([m.bateria.minimo, m.bateria.recomendada.pct], [10, 35]);
});

// --- Estados (§4.5, criterio 11) -----------------------------------------------------------

const ESTADOS = {
  error: () => ({ ahora: fecha(2026, 10, 16, 12), error: new Error("sin red") }),
  cargando: () => null,
  "sin-sol": () => base({ solar: [], horasPorFuente: { local: [], archivo: [], worker: [] } }),
  mañana: () => {
    const ahora = fecha(2026, 10, 16, 21, 30);
    return base({ ahora, ...horizonte(ahora) });
  },
  noche: () => base({ ahora: fecha(2026, 10, 16, 6, 45), ...horizonte(fecha(2026, 10, 16, 6, 45)) }),
  "sin-prevision": () => base({ solar: [], habitos: { ...HABITOS, solarTipica: (h) => kwhSol(h) } }),
  "sin-calibrar": () => base({ solar: prevision(2026, 10, 16, { origen: "estimado", confianza: "baja" }) }),
  "sin-vivo": () => base({ fresco: false }),
  completo: () => base(),
};

test("cada estado del §4.5 se puede forzar con su entrada", () => {
  for (const [estado, entrada] of Object.entries(ESTADOS)) {
    assert.equal(modeloArco(entrada()).estado, estado, estado);
  }
});

test("los estados siguen el orden de prioridad del §4.5", () => {
  // error gana a todo; sin-sol gana a mañana; noche gana a sin-calibrar; sin-calibrar gana a sin-vivo.
  assert.equal(modeloArco({ ...base(), error: new Error("x") }).estado, "error");
  const noche = base({ ahora: fecha(2026, 10, 16, 6), solar: prevision(2026, 10, 16, { origen: "estimado" }), fresco: false });
  assert.equal(modeloArco(noche).estado, "noche");
  assert.equal(modeloArco(base({ solar: prevision(2026, 10, 16, { origen: "estimado" }), fresco: false })).estado, "sin-calibrar");
  assert.equal(modeloArco(base({ solar: [], habitos: { ...HABITOS, solarTipica: (h) => kwhSol(h) }, fresco: false })).estado, "sin-prevision");
  const sinMañana = base({ ahora: fecha(2026, 10, 16, 21, 30), solar: prevision(2026, 10, 16, { horas: 24 }) });
  const m = modeloArco(sinMañana);
  assert.deepEqual([m.estado, m.dia.tipo], ["sin-sol", "mañana"]);
  assert.match(m.resumen.texto, /Sin previsión para mañana/);
});

test("D1: desde una hora después del fin de la ventana se muestra mañana como previsión", () => {
  const justo = modeloArco(base({ ahora: fecha(2026, 10, 16, 20, 59) }));
  assert.deepEqual([justo.estado, justo.dia.tipo], ["noche", "hoy"]);
  assert.equal(justo.marcador.posicion, "despues");
  const m = modeloArco(base({ ahora: fecha(2026, 10, 16, 21) }));
  assert.deepEqual([m.estado, m.dia.tipo], ["mañana", "mañana"]);
  assert.equal(m.dia.inicio.getTime(), fecha(2026, 10, 17).getTime());
  assert.deepEqual(m.marcador, { angulo: null, posicion: null, lleno: true });
  assert.ok(m.franjas.every((f) => f.real === null && f.casaReal === null));
  assert.ok(rayosDe(m).every((r) => r.tipo === "contorno" || r.tipo === "casa-tipica"));
  assert.match(m.resumen.texto, /^Mañana/);
  comprobarCoherencia(m);
});

test("de noche el marcador queda bajo el horizonte y el resumen dice desde cuándo hay sol", () => {
  const m = modeloArco(ESTADOS.noche());
  assert.equal(m.marcador.posicion, "antes");
  assert.ok(m.visibles.extremos.includes("ventana:desde"));
  assert.match(m.resumen.texto, /08 H/);
});

test("los estados vacíos no dibujan rayos ni marcador", () => {
  for (const estado of ["error", "cargando", "sin-sol"]) {
    const m = modeloArco(ESTADOS[estado]());
    assert.deepEqual(rayosDe(m), [], estado);
    assert.equal(m.marcador.angulo, null, estado);
    assert.equal(m.marcador.posicion, null, estado);
  }
});

test("ningún texto del modelo habla de amanecer, ocaso, elevación ni mediodía", () => {
  for (const [estado, entrada] of Object.entries(ESTADOS)) {
    const m = modeloArco(entrada());
    const textos = [m.resumen.texto, ...m.cifras.map((c) => c.texto)].join(" ");
    assert.doesNotMatch(textos, /amanecer|ocaso|elevaci[oó]n|mediod[ií]a/i, estado);
    for (const id of ["ventana:desde", "ventana:hasta"]) {
      const c = porId(m).get(id);
      if (c) assert.doesNotMatch(c.texto, /:/, `${estado} ${id}`);
    }
  }
});

// --- Asesor ---------------------------------------------------------------------------------

test("el cuenco cita el coste de ahora y la mejor hora del asesor sin recalcularlos", () => {
  const entrada = base();
  const mejor = { inicio: fecha(2026, 10, 16, 14), fin: fecha(2026, 10, 16, 15), coste: 0.0049 };
  const m = modeloArco({ ...entrada, decision: { ...entrada.decision, mejor } });
  const mapa = porId(m);
  assert.equal(mapa.get("asesor:costeAhora").texto, euros(0.04));
  assert.equal(mapa.get("asesor:mejor:inicio").texto, "14:00");
  assert.equal(mapa.get("asesor:mejor:coste").texto, euros(0.0049));
  assert.deepEqual(m.visibles.cuenco, ["asesor:costeAhora", "asesor:mejor:inicio", "asesor:mejor:coste"]);
  assert.deepEqual(m.asesor.mejor, mejor);
  const ya = modeloArco(entrada);
  assert.deepEqual(ya.visibles.cuenco, ["asesor:costeAhora"]);
  comprobarCoherencia(m);
});

// --- Trazabilidad y pureza -------------------------------------------------------------------

test("las 8 reglas de coherencia se cumplen en un fixture por estado", () => {
  for (const [estado, entrada] of Object.entries(ESTADOS)) {
    const m = modeloArco(entrada());
    try {
      comprobarCoherencia(m);
    } catch (error) {
      error.message = `${estado}: ${error.message}`;
      throw error;
    }
  }
});

function congelar(x, vistos = new Set()) {
  if (x === null || typeof x !== "object" || vistos.has(x)) return x;
  vistos.add(x);
  for (const v of Object.values(x)) congelar(v, vistos);
  return Object.freeze(x);
}

test("modeloArco es puro: no modifica la entrada y da lo mismo con ella congelada", () => {
  const libre = modeloArco(base());
  const congelada = congelar(base());
  const copia = JSON.stringify(congelada);
  const m = modeloArco(congelada);
  assert.equal(JSON.stringify(congelada), copia);
  assert.deepEqual(JSON.parse(JSON.stringify(m)), JSON.parse(JSON.stringify(libre)));
});
