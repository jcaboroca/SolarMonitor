process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { partesMadrid, limitesDia } from "../worker/src/horario.js";

const referencia = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const conIntl = (ms) => {
  const p = Object.fromEntries(referencia.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour), minuto: Number(p.minute) };
};

test("partesMadrid coincide con Intl (Europe/Madrid) de 2024 a 2031, incluidos los cambios de hora", () => {
  const dia = 86400000;
  for (let ms = Date.UTC(2024, 0, 1); ms < Date.UTC(2031, 0, 1); ms += 37 * 60000) {
    const { dia: d, hora, minuto } = partesMadrid(ms);
    assert.deepEqual({ dia: d, hora, minuto }, conIntl(ms), new Date(ms).toISOString());
  }
  for (let anio = 2024; anio <= 2031; anio++) {
    for (const mes of [2, 9]) {
      const ultimo = new Date(Date.UTC(anio, mes + 1, 0));
      const base = Date.UTC(anio, mes, ultimo.getUTCDate() - ultimo.getUTCDay(), 1);
      for (const ms of [base - 60000, base, base + 60000, base - dia, base + dia]) {
        const { dia: d, hora, minuto } = partesMadrid(ms);
        assert.deepEqual({ dia: d, hora, minuto }, conIntl(ms), new Date(ms).toISOString());
      }
    }
  }
});

test("los dias de cambio de hora duran 23 y 25 horas aunque el proceso este en UTC", () => {
  assert.equal(limitesDia("2026-03-29").horas, 23);
  assert.equal(limitesDia("2026-10-25").horas, 25);
  assert.equal(limitesDia("2026-11-08").horas, 24);
});
