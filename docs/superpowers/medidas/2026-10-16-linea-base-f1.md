# Línea base antes de F1 — «Instrumento solar»

Medida el 16-oct-2026 entre las 18:41 y las 19:15 UTC, **antes de modificar ningún fichero
de la aplicación**. Sigue el §7.2 y el §8.5.3 de
[la especificación](../specs/2026-10-16-instrumento-solar-design.md).

## Versión medida

- Publicada en GitHub Pages: commit `0c6cfe5` (estado del build: `built`, 12-oct-2026).
- Las regresiones se capturaron sobre ese mismo commit, exportado con `git archive` a un
  directorio temporal y servido en local con `python3 -m http.server` (`127.0.0.1:8765`).
- Pruebas existentes en ese árbol: `node --test 'test/*.test.js'` → **80/80 en verde**
  (Node v24.6.0).

## Entorno

- Navegador integrado de VS Code: Electron 43.7.7, Chrome 150.0.7871.250, controlado con
  Playwright más una sesión CDP.
- Antes de cada medida: `Storage.clearDataForOrigin` (todo) y `Network.clearBrowserCache`.
  En el origen no había datos de nadie: ninguna base IndexedDB, solo una caché de mercado
  creada en la misma carga.
- **En este entorno, Playwright sí ejecuta el service worker** (registro, control y
  `Cache Storage` operativos). Responde al punto 3 del §11.2.

## Transferencia

| Medida | Método | Resultado |
|---|---|---|
| **M1 · primera visita** | `#ahora` con caché y SW borrados, sin limitación de red; suma de `encodedBodySize` de `navigation` y `resource` de mismo origen 5 s después de `load` | **69 355 B** (dos repeticiones idénticas) |
| M1, información | Suma de `transferSize` en la misma carga | 74 755 B |
| **M2 · instalación del SW** | `curl -H 'Accept-Encoding: br, gzip'` a cada entrada de `BASE` publicada, sumando `size_download` (Pages sirve gzip; `pdf-worker.js`, sin comprimir) | **584 696 B** (25 entradas, todas con 200) |

Recursos de M1 (18, cuerpo comprimido en bytes): `./` 5 590 · `styles.css` 4 330 ·
`js/app.js` 17 128 · `js/xlsx.js` 2 821 · `js/datos.js` 3 589 · `js/graficas.js` 3 503 ·
`js/factura.js` 5 354 · `js/historico.js` 3 991 · `js/datadis.js` 1 959 · `js/nube.js` 1 950 ·
`js/ahora.js` 7 454 · `js/asesor/tarifa.js` 769 · `js/asesor/habitos.js` 1 672 ·
`js/asesor/prevision.js` 1 463 · `js/asesor/motor.js` 4 520 · `js/asesor/aparatos.js` 1 595 ·
`js/asesor/mercado.js` 986 · `js/asesor/simulador.js` 681.

Recursos de M2 (25): las 25 entradas de `BASE` del `sw.js` de `0c6cfe5`; `./` e
`./index.html` cuentan dos veces (5 590 B cada una). Las más pesadas son
`vendor/pdf.worker.min.js` (377 041 B) y `vendor/pdf.min.js` (131 598 B).

## Presupuesto (§7.1)

| Concepto | Bytes |
|---|---|
| Límite acumulado F1–F4 (M1 y M2, cada uno) | 170 000 |
| Fuentes (cuatro `.woff2`, tamaño de fichero) | 147 952 |
| Margen sin fuentes F1–F4 | 22 048 |
| Límite de F1 sin fuentes | 10 000 |
| **Tope de M2 tras F1** | 584 696 + 147 952 + 10 000 = **742 648** |
| **Tope de M1 tras F1** | 69 355 + (fuentes que se descarguen) + 10 000 |

## CLS de *Ahora*

Condiciones: caché y SW borrados; red emulada por CDP con latencia de 165 ms, 1 125 000 B/s
de bajada y 187 500 B/s de subida (equivalente a «Fast 4G»); CPU 4×.
`PerformanceObserver` de `layout-shift` con `buffered: true`, sumando las entradas sin
`hadRecentInput` durante 5 s tras `load`.

| Pasada | CLS |
|---|---|
| 1 | 0,3823 |
| 2 | 0,3823 |
| 3 | 0,3823 |

**La versión publicada ya incumple el objetivo < 0,05 del criterio 32.** Se registra tal
cual; no se ha corregido nada antes de medir.

## Regresiones (§8.5.3)

Captura automatizada y repetida dos veces: **las dos son idénticas en todos los bloques**.
Los valores completos contienen datos reales de `muestras/`, que está fuera del repositorio
a propósito; aquí solo se registra su huella (SHA-256 del JSON, primeros 16 caracteres).

Condiciones:
- reloj fijado con `page.clock.setFixedTime("2026-07-01T12:00:00+02:00")`;
- peticiones a Open-Meteo, REE, `workers.dev` y datadis bloqueadas;
- muestras `muestras/demo.xlsx` (SHA-256 `8926abc8aeee6123…`) y `muestras/factura-demo.pdf`
  (`68c0bfbd93c56dc0…`).

**Estado fijo de R1** (sintético, sin datos personales):
- `-asesor`: `{lat: 40.42, lon: -3.7, kWp: 3.5, indexada: false}`;
- `-prevision`: 48 h de radiación sinusoidal (máximo de 850 W/m², nubes 20 %), obtenida
  10 min antes;
- `-vivo`: lectura de hace 3 min (SoC 72 %, 2 410 W solares, 620 W de casa);
- `-serie`: la que guarda «Guardar este mes» con `demo.xlsx`.

| Regresión | Qué se captura | Huella |
|---|---|---|
| R1 | Seis aparatos: título, `aria-label` del semáforo, coste, próxima ventana, ventanas, `aria-label` de `#linea`, reserva y razones; texto normalizado (sin pictogramas ni selectores de variante, espacios colapsados) | `79abe2774661c544` |
| R2 cotejo | Secuencias numéricas, valores de los `<input>` y número de `.fuente` de `#fichas`, `#tablaFactura`, `#veredicto`, `#tablaRevision`, `#lecturas` y `#avisosFactura` | `e50e3433d07823a1` |
| R2 edición | P1 = 150 en `#tablaFactura` (evento `input`): desvíos y veredicto | `aa11bf92cc7c12a6` |
| R2 histórico | `#tablaHistorico` tras «Guardar este mes» | `f251ee2ef152384d` |
| R2 detalle | `#detalleMes` de cada fila (una) | `34f8cd1a077e28d5` |
| R4 clic | `#estadoDatos`, `#estadoFactura`, filas de `#tablaMapeo` y `#textoFactura` | `4724f8f6a1d0945e` |
| R4 arrastre | Lo mismo, soltando los ficheros (`DragEvent` con `DataTransfer`) | `4724f8f6a1d0945e` (igual que el clic) |
| R6 | Globo de `#graficaDia` (15-jun-2026) en el 10, 30, 50, 70 y 90 % del ancho útil. Es el único canvas con globo en la base | `11c3a11ac4c26018` |
| R5 a) | Página controlada; caché `solar-monitor-v38` con 25 entradas | `eee7555651c7aa42` |
| R5 b) | Sin conexión (CDP *offline*) y recarga: las cinco pestañas abren con contenido | `0aa406dfafa4085e` |
| R5 c) | *Ahora* sin red: título, frescura y confianza con sus mensajes de fallo | `aae81d05d68c10e4` |

No aplica en la base:
- **R5 d)** necesita dos versiones; se prueba en la validación de F1 (de v38 a v39, en local).
- **R3** y **R5 e)** las hace el dueño.
- **R7** se fija en F2, antes de D3.
