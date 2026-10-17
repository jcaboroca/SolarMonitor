# Publicación de Instrumento solar F1–F4 (17-oct-2026)

Registro de lo publicado en GitHub Pages (`main`, https://jcaboroca.github.io/SolarMonitor/)
tras la enmienda rev. 4 de la especificación (§12: sin límite de peso, solo vigilancia).

## Commits publicados

| Fase | Commit | Caché del SW | Pruebas (`node --test 'test/*.test.js'`) |
|---|---|---|---|
| Enmienda rev. 4 | `d412506` | — | — |
| F1 · cimientos (tokens, IBM Plex, iconos) | `78b6745` | v39 | 122/122 |
| F2 · *Ahora* como instrumento solar (`js/arco.js`) | `2be71b4` | v40 | 172/172 |
| F3 · *Día a día* como relato con scroll (`js/relato.js`, `js/relato-vista.js`) | `1bf9004` | v41 | 217/217 |
| F4 · *Datos*, *¿Cuadra?*, *Mes a mes*, icono (`js/lectura.js`, `js/anual.js`) | `71bd577` | v42 | 245/245 |
| SW: PNG del manifest fuera de la instalación | `62a35af` | v43 | 245/245 |

(`5248dda` publicó una demo con datos de muestra en `/prototipo/` y `a09d472` la retiró a
petición del dueño: en la web solo hay datos reales.)

## M2 medido en Pages

Método del §7.1–7.2: `curl -H 'Accept-Encoding: gzip'` a cada entrada de `BASE` del `sw.js`
publicado, sumando `size_download`. Todas las entradas respondieron 200.

| Versión | Entradas | M2 (B) | Δ sobre la anterior (B) |
|---|---|---|---|
| Línea base `0c6cfe5` | 25 | 584 696 | — |
| F1 `78b6745` | 30 | 745 871 | +161 175 (147 952 son las cuatro fuentes) |
| F2 `2be71b4` | 31 | 768 797 | +22 926 |
| F3 `1bf9004` | 33 | 786 235 | +17 438 |
| F4 `71bd577` | 40 | 930 344 | +144 109 (132 KB de PNG del icono en `BASE`) |
| `62a35af` | 37 | **808 080** | −122 264 (los PNG del manifest salen de `BASE`; se queda el `apple-touch-icon`, que enlaza `index.html`) |

Total sobre la línea base: **+223 384 B**. Informativo (§12.1). M1 no se ha vuelto a medir.

## Verificaciones ejecutadas

- Pruebas automáticas en cada fase (tabla de arriba), con los ficheros protegidos del §8.5.1
  sin cambios (`git diff --stat` vacío en cada fase).
- R1 (asesor): 270/270 campos idénticos en 30 combinaciones hora × aparato (F2).
- R2 / R4 (cotejo e histórico): sin cambios de valores con junio y junio + mayo (F4).
- Chrome 155 headless: sin errores de consola ni desbordamiento horizontal a 390, 768 y 1280 px;
  movimiento reducido sin animaciones; teclado en el arco y en el relato; tareas largas del
  relato con CPU 4×: ninguna > 50 ms, `relato:paso` p95 ≈ 6 ms (F3).
- Web publicada (`71bd577`) cargando `demo.xlsx` y `factura-demo.pdf`: las cinco pestañas se
  pintan con datos a 1280×900 y 390×844.

## Pendiente (no ejecutado)

- Safari / iOS en dispositivo real (sticky, `svh`, revelado del relato, iconos de inicio).
- VoiceOver con las tablas que cambian de disposición en móvil (acta, libro de registro).
- Auditoría axe (criterios 21, 23, 24) y CLS en Pages tras F4.
- M1 en Pages tras F4.
