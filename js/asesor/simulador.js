// Balance hora a hora: sol → casa → bateria → red. Sin DOM y determinista.
//
// slots: [{ horas, solarKwh, casaKwh, extraKwh?, compra, venta }] (precios en €/kWh)
// bateria: { capacidadKwh, socMinimoPct, socMaximoPct?, rendimiento, maxCargaKw, maxDescargaKw }

export function simular(slots, bateria, socInicialPct) {
  const { capacidadKwh, socMinimoPct, socMaximoPct = 100, rendimiento, maxCargaKw, maxDescargaKw } = bateria;
  // El rendimiento de ida y vuelta se reparte a partes iguales entre cargar y descargar.
  const eficiencia = Math.sqrt(rendimiento);
  const minimo = (capacidadKwh * socMinimoPct) / 100;
  const maximo = (capacidadKwh * socMaximoPct) / 100;
  let energia = Math.min(Math.max((capacidadKwh * socInicialPct) / 100, 0), capacidadKwh);
  let coste = 0;
  const pasos = [];

  for (const slot of slots) {
    const neto = slot.solarKwh - slot.casaKwh - (slot.extraKwh || 0);
    let cargaKwh = 0, descargaKwh = 0, importKwh = 0, exportKwh = 0;
    if (neto >= 0) {
      cargaKwh = Math.max(0, Math.min(neto, maxCargaKw * slot.horas, (maximo - energia) / eficiencia));
      energia += cargaKwh * eficiencia;
      exportKwh = neto - cargaKwh;
    } else {
      descargaKwh = Math.max(0, Math.min(-neto, maxDescargaKw * slot.horas, (energia - minimo) * eficiencia));
      energia -= descargaKwh / eficiencia;
      importKwh = -neto - descargaKwh;
    }
    coste += importKwh * slot.compra - exportKwh * slot.venta;
    pasos.push({ cargaKwh, descargaKwh, importKwh, exportKwh, socPct: (energia / capacidadKwh) * 100 });
  }

  return { pasos, coste, energiaUtilFinalKwh: Math.max(energia - minimo, 0) };
}
