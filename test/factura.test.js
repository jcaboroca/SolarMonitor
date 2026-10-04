process.env.TZ = "Europe/Madrid";
import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretarFactura, revisarFactura } from "../js/factura.js";

// Extracto de una factura de Octopus Flexi (sin datos personales).
const OCTOPUS = `Factura de Electricidad
Núm. Factura: 2026ENB00000001
Periodo: 24-08-2026 a 01-09-2026 (8 días)
Total a pagar
4,04 €
Resumen de la factura
Potencia: 1,93 €
Energía Activa: 0,00 €
Bono Social: 0,20 €
Total factura 4,15 €
Uso Solar Wallet: -0,11 €
Octopus Energy España, S.L.U.
Tarifa Acceso: 2.0TD
Tarifa: Octopus Flexi
Detalle de la Factura
Periodo: 24-08-2026 a 01-09-2026
Potencia 1,93 €
Punta 3,10 kW * 8 días 0,076 €/kW/día 1,88 €
Peaje de distribución 3,10 kW * 8 días 0,064 €/ kW/día 1,58 €
Valle 3,10 kW * 8 días 0,002 €/kW/día 0,05 €
Peaje de distribución 3,10 kW * 8 días 0,001 €/ kW/día 0,03 €
Energía Activa 0,00 €
Punta 0,87 kWh 0,220 €/kWh 0,20 €
Peaje de distribución 0,87 kWh 0,033 €/ kWh 0,03 €
Llano 0,78 kWh 0,157 €/kWh 0,12 €
Energía y Margen de comercialización 0,78 kWh 0,128 €/ kWh 0,10 €
Valle 2,26 kWh 0,184 €/kWh 0,42 €
Cargos del sistema 2,26 kWh 0,003 €/ kWh 0,01 €
Excedente de energía
Total generados -24,29 kWh 0,035 €/kWh -0,85 €
No usados destinados a Solar Wallet 0,11 €
Otros conceptos 1,40 €
Costes de gestión tarifa indexada 8 días 0,123 €/días 0,99 €
Bono Social 8 días 0,025 €/días 0,20 €
Alquiler de Equipos 8 días 0,027 €/días 0,21 €
Impuestos 0,82 €
Impuesto Eléctrico 1,93 € 5,11 % 0,10 €
IVA (GENERAL) 3,43 € 21,00 % 0,72 €
Total factura 4,15 €
Uso Solar Wallet -0,11 €
Total a pagar 4,04 €
Lecturas del Contador: 000000000 (24-08-2026 - 01-09-2026)
Procedencia: Calculada
Periodo P1 P2 P3 P4 P5 P6 Total
Lectura Anterior 9.784 3.967 5.996 0 0 0 19.747
Lectura Actual 9.785 3.968 5.998 0 0 0 19.751
Consumo kWh 1 1 2 0 0 0 4,000
Potencia Máx. Demandada (kW) 0,00 0,00 0,00 0,00 0,00 0,00
Potencia Potencia Contratada (kW) 3,10 3,10 0,00 0,00 0,00 0,00`;

test("Octopus: periodo, energia por periodo y potencia", () => {
  const f = interpretarFactura(OCTOPUS);
  assert.equal(f.comercializadora, "Octopus");
  assert.equal(f.referencia, "2026ENB00000001");
  assert.equal(f.dias, 8);
  assert.equal(f.diasFacturados, 8);
  assert.deepEqual(f.consumo, { P1: 0.87, P2: 0.78, P3: 2.26 });
  assert.deepEqual(f.precio, { P1: 0.22, P2: 0.157, P3: 0.184 });
  assert.deepEqual(f.importeEnergia, { P1: 0.2, P2: 0.12, P3: 0.42 });
  assert.deepEqual(f.importePotencia, { P1: 1.88, P2: 0.05 });
  assert.deepEqual(f.precioPotencia, { P1: 0.076, P2: 0.002 });
  assert.equal(f.potencia, 3.1);
  assert.equal(f.energiaNeta, 0);
});

test("Octopus: excedentes, Solar Wallet, impuestos y total", () => {
  const f = interpretarFactura(OCTOPUS);
  assert.equal(f.excedentes, 24.29);
  assert.equal(f.precioExcedentes, 0.035);
  assert.equal(f.importeExcedentes, -0.85);
  assert.equal(f.aWallet, 0.11);
  assert.equal(f.usoWallet, -0.11);
  assert.deepEqual(f.otros, { gestion: 0.99, bonoSocial: 0.2, alquiler: 0.21 });
  assert.equal(f.alquiler, 0.21);
  assert.equal(f.tipoImpuesto, 5.11);
  assert.equal(f.baseImpuesto, 1.93);
  assert.equal(f.impuestoElectricidad, 0.1);
  assert.equal(f.tipoIva, 21);
  assert.equal(f.baseImponible, 3.43);
  assert.equal(f.iva, 0.72);
  assert.equal(f.total, 4.15);
  assert.equal(f.totalAPagar, 4.04);
});

test("Octopus: lecturas de la tabla del contador", () => {
  const f = interpretarFactura(OCTOPUS);
  assert.deepEqual(f.lecturas.P1, { inicial: 9784, final: 9785, consumo: 1, estimada: true });
  assert.deepEqual(f.lecturas.P3, { inicial: 5996, final: 5998, consumo: 2, estimada: true });
});

test("Octopus: la factura cuadra consigo misma", () => {
  const puntos = revisarFactura(interpretarFactura(OCTOPUS));
  const fallos = puntos.filter((p) => !p.ok);
  assert.deepEqual(fallos, []);
  assert.ok(puntos.some((p) => /Solar Wallet/.test(p.concepto)));
  assert.ok(puntos.some((p) => /compensar/.test(p.concepto)));
  assert.ok(puntos.length >= 12, `solo ${puntos.length} comprobaciones`);
});
