# Instrumento solar — especificación visual y técnica

**Estado: F1–F4 PUBLICADAS** · 17-oct-2026 · revisión 4 (registro en `docs/superpowers/medidas/2026-10-17-publicacion-f1-f4.md`). **La enmienda del §12 prevalece sobre lo que contradiga** (presupuesto y dirección del prototipo de *Ahora*). Revisión 3: Consolida la rev. 2 aprobada y la
auditoría C1–C7 (presupuesto, movimiento reducido, tareas largas, service worker, cambio
horario y trazabilidad estructurada), con las decisiones D1–D7 cerradas. **«Lista para F1»
significa que se puede empezar F1. No significa que F1 esté implementada ni validada.** Es
la única versión de esta especificación; el reparto de lo aprobado, lo pendiente, lo no
ejecutado y lo limitado está en el §11.

**Qué está comprobado y qué no.** No hay nada implementado. **Ninguna prueba ni criterio
de este documento se ha ejecutado** contra la aplicación y **no hay línea base medida**
(ni M1, ni M2, ni CLS, ni las regresiones R1–R7). Solo se ha comprobado:
- los contrastes del §1.3, calculados con la fórmula WCAG 2.x;
- las propiedades de las fuentes del §2.1, leídas de los ficheros oficiales;
- la licencia, el commit y la existencia de los iconos de Phosphor del §3.5 (API de GitHub);
- el soporte de navegadores del §5.5.2 (MDN browser-compat-data);
- el comportamiento de las fechas locales en los cambios de hora del §4.3.1 (Node con
  `TZ=Europe/Madrid`);
- en una muestra de 4 ficheros de la versión publicada, que GitHub Pages sirve con gzip y
  unos 700 B de cabeceras por respuesta (§7.1). No es la línea base.

Todo lo demás son requisitos u objetivos por verificar.

**Alcance:** renovación visual de la web (`index.html`, `styles.css`, `js/` de interfaz,
`sw.js`, `manifest.webmanifest`, `assets/`). **Fuera de alcance:** el Worker
(`worker/`), la lógica del asesor (`js/asesor/*`, salvo el cambio aditivo condicional D3,
§8.2 y §10), la lectura de ficheros (`xlsx.js`, `factura.js`, `datos.js`) y la sincronización
(`nube.js`, `historico.js`).

Todo lo que dibuja esta especificación sale de datos que la aplicación ya calcula. Donde
un dato no existe, se dice qué se muestra en su lugar; nunca se rellena.

---

## 0. Principios

1. **Un instrumento, no un panel.** La jerarquía la marcan escalas, líneas finas,
   tipografía y aire. No hay rejillas de tarjetas idénticas.
2. **Un acento.** El amarillo solar es el único color de marca. Los demás colores
   significan un flujo de energía o un estado, y solo se usan para eso.
3. **Precisión declarada.** Cada cifra lleva su unidad y, si es estimada, lo dice. La
   visualización nunca aparenta más precisión que la del dato (la previsión es horaria;
   el arco también).
4. **Lo operativo, rápido.** El movimiento narrativo vive solo en *Día a día*. Las
   demás pestañas abren al instante.
5. **Nada se esconde detrás del color.** Forma + texto + color, como ya hace el semáforo.

---

## 1. Paleta

Base carbón cálido (tono 30°, saturación baja). Sustituye a la paleta de GitHub Dark
(`#0d1117`, `#161b22`, `#e6edf3`), que desaparece por completo.

### 1.1 Neutros

| Token | Hex | Uso |
|---|---|---|
| `--fondo` | `#14110E` | Fondo de la aplicación, `theme-color`, `background_color` del manifiesto |
| `--pozo` | `#0F0D0B` | Superficies hundidas: campos de formulario, `<pre>`, zonas de soltar |
| `--superficie` | `#1C1814` | Diálogos, globo de la gráfica, fila desplegada del histórico |
| `--superficie-2` | `#26211B` | Hover de filas y botones secundarios |
| `--linea` | `#2E2822` | Filetes separadores (decorativos, sin requisito de contraste) |
| `--escala` | `#74685A` | Marcas de escala, pista del arco, ejes: gráficos con información (≥ 3:1) |
| `--texto` | `#EEE7DB` | Texto principal (papel cálido) |
| `--texto-2` | `#ADA293` | Texto secundario, ayudas |
| `--texto-3` | `#9A8F80` | Etiquetas de eje, unidades, metadatos |

### 1.2 Energía y estados

| Token | Hex | Significa | Dónde |
|---|---|---|---|
| `--sol` | `#EBC25E` | Producción solar y acento único de la marca | Rayos reales del arco, «Sol → casa», foco, pestaña activa, botón primario |
| `--sol-tenue` | `#9A7F3E` | Producción **prevista** | Contorno de los rayos previstos, línea de producción total |
| `--coral` | `#E57A5F` | Energía **comprada** a la red | «Red → casa», mapa de calor de compras, diferencias en contra |
| `--vertido` | `#6DB8B0` | Energía **vertida** a la red | Barras/series de vertido, cotejo con el contador |
| `--estano` | `#A9B8C6` | **Batería** (carga, descarga y nivel) | «Batería → casa», curva de SoC, indicador de batería |
| `--casa` | `#EEE7DB` (= `--texto`) | **Consumo** de la casa | Línea de consumo, rayos interiores del arco |
| `--bien` | `#9CC47E` | Estado «buen momento» / cuadra | Semáforo ●, veredictos favorables |
| `--cuidado` | `#EBC25E` (= `--sol`) | Estado «cuidado» | Semáforo ▲, avisos |
| `--evita` | `#E57A5F` (= `--coral`) | Estado «evita» / no cuadra | Semáforo ■ (evitar = acabar comprando a la red) |

### 1.2 bis Derivados permitidos (sin colores nuevos)

Todo color de la interfaz es un token de §1.1–1.2 o uno de estos derivados. **No hay otra
forma de escribir un color.**

| Derivado | Fórmula | Uso |
|---|---|---|
| Tinte | `color-mix(in srgb, var(--X) 12%, var(--fondo))` | Fondo de avisos y veredictos |
| Borde de tinte | `color-mix(in srgb, var(--X) 35%, var(--fondo))` | Borde de esos bloques |
| Velo | `color-mix(in srgb, var(--fondo) 92%, transparent)` | Barra de pestañas translúcida (hoy `rgba(13,17,23,.92)`) |
| Telón | `color-mix(in srgb, var(--pozo) 72%, transparent)` | `::backdrop` del diálogo (hoy `rgba(0,0,0,.6)`) |
| Translúcido de canvas | Token + `ctx.globalAlpha` (0,80 en capas; 0,35 en el cursor) | Hoy `capa.color + "cc"` y `rgba(255,255,255,.35)` |
| Halo | `color-mix(in srgb, var(--sol) 15%, transparent)` | Halo del marcador del arco |
| Opacidad de SVG | `fill-opacity`/`stroke-opacity` sobre un token | Rayos interiores del arco |

Las únicas copias literales de los hex permitidas fuera de `styles.css` son estas, y una
prueba (§8.4) comprueba que coinciden con `:root`:
- el respaldo de `graficas.js`, por si `getComputedStyle` no devuelve nada;
- `manifest.webmanifest`;
- `assets/icono.svg`.

### 1.3 Contraste medido (WCAG 2.x)

| Primer plano | sobre `--fondo` | sobre `--superficie` | sobre `--superficie-2` |
|---|---|---|---|
| `--texto` | 15,3 | 14,4 | 13,0 |
| `--texto-2` | 7,5 | 7,0 | 6,4 |
| `--texto-3` | 5,9 | 5,6 | 5,0 |
| `--sol` | 11,1 | 10,4 | 9,4 |
| `--coral` | 6,5 | 6,1 | 5,5 |
| `--vertido` | 8,2 | 7,7 | 6,9 |
| `--estano` | 9,3 | 8,7 | 7,9 |
| `--bien` | 9,5 | 8,9 | 8,1 |
| `--sol-tenue` | 4,9 | 4,6 | 4,2 |
| `--escala` | 3,5 | 3,3 | 2,9 |

Reglas derivadas:
- Todo texto usa `--texto`, `--texto-2`, `--texto-3` o un color de energía (todos ≥ 4,5:1
  sobre las tres superficies).
- `--sol-tenue` y `--escala` **no** se usan para texto. `--escala` no se usa sobre
  `--superficie-2`.
- Texto sobre botón `--sol`: `--fondo` (11,1:1).
- Con luminancia relativa sol 0,57 > batería 0,47 > coral 0,31, las tres capas apiladas de
  *Día a día* se distinguen también en escala de grises.

### 1.4 Prohibido

- Cualquier tono entre 250° y 320° (morados): desaparecen `#9b7ff0` (descarga) y
  `#c9a0ff` (etiqueta Factura).
- Cualquier color que no sea un token o un derivado del §1.2 bis. Eso incluye `#000`, `#fff`,
  `black`, `white` y `rgb()`/`rgba()`/`hsl()` literales.
- **Sombras:** no hay ninguna (ver §3.3). La elevación se expresa con superficie + filete.
- Degradados lineales decorativos (el `.titular` y la `.cabecera` actuales los pierden).

---

## 2. Tipografía

### 2.1 Comprobaciones sobre los recursos oficiales

Se descargaron el 16-oct-2026 a un directorio temporal, fuera del repositorio, los ficheros
de `github.com/IBM/plex`, rama `master`, commit `71f558992315a12ca1f06a2215d57962a1992162`. Se leyeron con fontTools.

| Propiedad | Resultado | Cómo se comprobó |
|---|---|---|
| Paquetes | `packages/plex-sans-variable` y `packages/plex-mono-variable`, carpeta `fonts/split/woff2` | Listado del repositorio (API de GitHub) |
| Ficheros y tamaños | `IBM Plex Sans Var-Roman-Latin1.woff2` 68 988 B · `IBM Plex Sans Var-Roman-Pi.woff2` 23 900 B · `IBM Plex Mono Var-Roman-Latin1.woff2` 32 576 B · `IBM Plex Mono Var-Roman-Pi.woff2` 22 488 B (total 147 952 B) | Descarga y `wc -c` |
| Ejes de Sans Var | `wght` 100–700 (por defecto 400) · `wdth` 85–100 (por defecto 100) | Tabla `fvar` de los dos ficheros Sans |
| Ejes de Mono Var | Solo `wght` 100–700 (por defecto 400). **No tiene `wdth`** | Tabla `fvar` |
| Nombre y versión internos | `IBM Plex Sans Var`, «Version 3.000» · `IBM Plex Mono Var`, «Version 1.000» | Tabla `name` |
| Etiqueta de publicación | `@ibm/plex-sans-variable@0.2.0` (25-jun-2025) y `@ibm/plex-mono-variable@1.0.0` (30-jul-2026). La etiqueta del paquete Sans (0.2.0) no coincide con la versión interna (3.000) | Releases de GitHub |
| Español en Latin1 (Sans y Mono) | Completo: `áéíóúüñÁÉÍÓÚÜÑ¿¡`, `€ · — … ‹ › − ° º ª %` | `cmap` |
| Pi (Sans y Mono) | Contiene `≈ → ← ≤ ≥ ✓` | `cmap` |
| Ausentes en los cuatro ficheros | `● ▲ ■ ✕ ⚙` | `cmap` → pasan a SVG (§3.5) |
| `unicode-range` | Los del CSS oficial (`IBM Plex Sans Var-Roman.css`, `IBM Plex Mono Var-Roman.css`). Se copian literalmente, subconjunto a subconjunto | Lectura de ese CSS |
| Licencia | SIL OFL 1.1, «Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"». `license.txt` idéntico en los dos paquetes | `diff` |
| npm | Los paquetes `@ibm/plex-*` declaran telemetría de IBM en su README. **No se instalan**: se copian los `.woff2` | README del paquete |

**Pendiente de verificar** (no se afirma como hecho):
- Que `font-stretch: 85%` de la variable se vea igual que la familia estática
  `IBM Plex Sans Condensed`. Es plausible, pero no se ha comparado: la especificación pide
  el aspecto de 85 %, no la equivalencia.
- El render real en Safari iOS, Chrome y Firefox, incluido el eje `wdth` aplicado con
  `font-stretch`. Se verá en las capturas de F1.
- Los valores de `size-adjust`, `ascent-override` y `descent-override` del respaldo: se
  calibran en F1 y se miden con el criterio CLS.
- Si renombrar el fichero cuenta o no como modificación según la OFL. **No se renombra**: se
  conservan los nombres oficiales, con los espacios codificados como `%20` en la URL.

### 2.2 Decisión

No hace falta un paquete Condensed aparte: el aspecto condensado se obtiene con
`font-stretch: 85%` sobre el eje `wdth` de Sans Var. Mono no tiene eje de anchura y se usa
siempre al 100 %.

| Familia CSS | Fichero en el repo (nombre oficial, sin tocar) | Bytes |
|---|---|---|
| `"Plex Sans"` | `vendor/fuentes/IBM Plex Sans Var-Roman-Latin1.woff2` | 68 988 |
| `"Plex Sans"` | `vendor/fuentes/IBM Plex Sans Var-Roman-Pi.woff2` | 23 900 |
| `"Plex Mono"` | `vendor/fuentes/IBM Plex Mono Var-Roman-Latin1.woff2` | 32 576 |
| `"Plex Mono"` | `vendor/fuentes/IBM Plex Mono Var-Roman-Pi.woff2` | 22 488 |
| — | `vendor/fuentes/license.txt` (el oficial, sin tocar) | 4 360 |

Reglas:
- Los `.woff2` se copian **byte a byte** del commit citado. Una prueba compara su SHA-256
  con el que se anote al copiarlos (§8.4). No se generan subconjuntos, no se convierten y no
  se tocan las tablas internas.
- El nombre de familia en CSS (`"Plex Sans"`) es un alias local de `@font-face`: no modifica
  la fuente.
- Sin cursivas: la interfaz no las usa.
- Van en `vendor/`, que `sw.js` sirve por caché primero.

```css
@font-face {
  font-family: "Plex Sans";
  src: url("vendor/fuentes/IBM%20Plex%20Sans%20Var-Roman-Latin1.woff2") format("woff2");
  font-weight: 100 700; font-stretch: 85% 100%; font-display: swap;
  unicode-range: U+0000, U+000D, U+0020-007E, U+00A0-00FF, U+0131, U+0152-0153, U+02C6,
    U+02DA, U+02DC, U+2013-2014, U+2018-201A, U+201C-201E, U+2020-2022, U+2026, U+2030,
    U+2039-203A, U+2044, U+20AC, U+2122, U+2212, U+FB01-FB02; /* literal del CSS oficial */
}
@font-face {
  font-family: "Plex Mono";
  src: url("vendor/fuentes/IBM%20Plex%20Mono%20Var-Roman-Latin1.woff2") format("woff2");
  font-weight: 100 700; font-display: swap;   /* sin font-stretch: Mono no tiene wdth */
  unicode-range: U+0020-007E, U+00A0-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC,
    U+2013-2014, U+2018-201A, U+201C-201E, U+2020-2022, U+2026, U+2030, U+2039-203A,
    U+2044, U+20AC, U+2122, U+2212, U+FB01-FB02; /* literal del CSS oficial de Mono */
}
/* Pi de Sans y de Mono: ídem, con su unicode-range oficial. Sin local(). */
```

- Se precargan solo los dos Latin1: `<link rel="preload" as="font" type="font/woff2" crossorigin>`.
  Los Pi solo los descarga el navegador si la página usa uno de sus glifos (por ejemplo,
  `≈`). El service worker sí los descarga al instalarse (§7).
- Respaldo: `"Plex Sans", ui-sans-serif, system-ui, sans-serif` y `"Plex Mono",
  ui-monospace, "SF Mono", Menlo, monospace`.
- **Plan B**, si la variable da problemas en las capturas de F1: los estáticos de
  `plex-sans-condensed` (Latin1 Bold, 21 404 B, según el listado del repositorio) y de
  `plex-mono`, con los mismos principios de copia sin modificar.

### 2.3 Escala (base 16 px)

| Token | Uso | Familia | Tamaño | Peso | Ancho | Interlínea | Tracking |
|---|---|---|---|---|---|---|---|
| `--t-display` | Veredicto del arco, título del momento activo | Sans | `clamp(1.75rem, 1.2rem + 2.4vw, 2.5rem)` | 600 | 85 % | 1.05 | −0.02em |
| `--t-titulo` | `h2` de sección | Sans | 1.25rem | 600 | 85 % | 1.2 | −0.01em |
| `--t-subtitulo` | `h3`, `summary` | Sans | 1rem | 600 | 85 % | 1.3 | 0 |
| `--t-cuerpo` | Párrafos | Sans | 1rem | 400 | 100 % | 1.55 | 0 |
| `--t-ayuda` | `.ayuda`, notas | Sans | 0.875rem | 400 | 100 % | 1.5 | 0 |
| `--t-rotulo` | Etiquetas de campo, leyendas, pestañas | Sans | 0.8125rem | 500 | 85 % | 1.3 | +0.01em |
| `--t-cifra-xl` | Lectura principal (kW en vivo, total del relato) | Mono | `clamp(2rem, 1.4rem + 3vw, 3rem)` | 300 | — | 1 | −0.02em |
| `--t-cifra-l` | Coste, lecturas destacadas, `dd` | Mono | 1.5rem | 400 | — | 1.1 | −0.01em |
| `--t-cifra` | Celdas numéricas, horas | Mono | 0.875rem | 400 | — | 1.4 | 0 |
| `--t-escala` | Ejes, marcas del arco, unidades | Mono | 0.6875rem | 500 | — | 1 | +0.04em |

Reglas:
- **Toda cifra va en Plex Mono** (`font-variant-numeric: tabular-nums` implícito). Las
  celdas `.numero` de las tablas también pasan a Mono.
- Mayúsculas **solo** en `--t-escala` para unidades y abreviaturas (`KW`, `KWH`, `P1`).
  Los rótulos de sección (`.titular-etiqueta`, `.sello`, `.pastilla`) dejan el
  `text-transform: uppercase` y pasan a minúscula inicial.
- Prosa con medida máxima de `62ch`. `text-wrap: balance` en títulos y `pretty` en ayudas.
- `canvas`: `ctx.font = "500 11px 'Plex Mono', ui-monospace, monospace"`.

---

## 3. Espaciado, líneas, superficies e iconos

### 3.1 Espaciado (múltiplos de 4 px)

`--e-1` 4 · `--e-2` 8 · `--e-3` 12 · `--e-4` 16 · `--e-5` 24 · `--e-6` 32 · `--e-7` 48 ·
`--e-8` 64 · `--e-9` 96.

- Entre secciones de una pestaña: `--e-7` (móvil) / `--e-8` (≥ 960 px), con un filete
  `--linea` encima. **No hay caja alrededor.**
- Relleno inferior óptico: el bloque inferior de cada sección lleva `+ --e-2` respecto al
  superior.
- Contenedor: `max-width: 72rem` (1152 px) en *Día a día* y *¿Cuadra?*; `45rem` en
  *Ahora*. Márgenes laterales `clamp(16px, 4vw, 40px)`.

### 3.2 Líneas

| Elemento | Especificación |
|---|---|
| Filete | 1 px `--linea` |
| Pista de escala | 1 px `--escala` |
| Marca mayor | 1 px × 8 px `--escala` |
| Marca menor | 1 px × 4 px `--escala` |
| Cabecera de sección | Índice Mono `--t-escala` en `--texto-3` («01»), título `--t-titulo`, y un filete que corre hasta el borde derecho alineado con la línea base |
| Foco | `outline: 2px solid var(--sol); outline-offset: 2px` en **todos** los interactivos (hoy conviven azul y ámbar) |

### 3.3 Superficies, radios y sombras

- Tres niveles: `--pozo` (hundido), `--fondo` (plano), `--superficie` (elevado, solo
  diálogo, globo y fila desplegada).
- Radios: `--r-1` 2 px (marcas, etiquetas de procedencia), `--r-2` 6 px (botones, campos,
  selector de aparatos), `--r-3` 10 px (diálogo, zonas de soltar). **Se eliminan los
  radios de 999 px** (`.chip`, `.pastilla`, `.sello`, `.fuente`).
- **Sin sombras.** El diálogo y el globo se separan del fondo con `--superficie`, un filete
  de 1 px `--linea` y, en el diálogo, el telón del §1.2 bis.
- Sin grano ni ruido: la textura del instrumento son sus escalas.

### 3.4 Componentes base

| Componente | Hoy | Pasa a |
|---|---|---|
| `.tarjeta` | Caja con borde y radio 12 | Sección sin caja: cabecera de sección + contenido |
| `.ficha` / `.fichas` | Rejilla de cajas iguales | **Lectura**: fila de cifras separadas por filetes verticales; la primera a `--t-cifra-l`, el resto a `--t-cifra` |
| `.btn.primario` | Fondo amarillo | Igual, con `--r-2`, pulsado `translateY(1px)`, 120 ms |
| `.btn` | Caja gris | Contorno 1 px `--escala`, texto `--texto`, hover `--superficie-2` |
| `.chip` (aparatos) | Píldoras | **Selector segmentado** con desplazamiento horizontal: icono + nombre, el elegido con filete inferior de 2 px `--sol` |
| `.veredicto` / `.aviso` | Caja con fondo de color | Barra izquierda de 2 px del color de estado + tinte al 12 % + icono de forma (●▲■) |
| `.fuente` (procedencia) | Píldora con emoji | Etiqueta `--r-1`, Mono `--t-escala`, icono SVG de 12 px + nombre (§3.5) |
| Tablas | Sans | Cabecera `--t-rotulo` `--texto-3`, celdas numéricas Mono, filetes `--linea` |
| `.soltar` | Caja discontinua | **Ranura**: fondo `--pozo`, borde discontinuo 1 px `--escala`, icono «entrada», al arrastrar encima el borde pasa a `--sol` |

### 3.5 Iconos

- **Sprite SVG en línea** al principio de `<body>` (`<svg hidden>` con `<symbol>`): no hay
  petición extra ni riesgo de caché. Uso: `<svg class="i"><use href="#i-sol"/></svg>`.
- Todos llevan `aria-hidden="true"`: el texto de al lado siempre nombra la cosa. Tamaños
  16/20/24 px, color `currentColor`.
- **Dos orígenes (D2):**
  - **Propios**, dibujados para este proyecto en rejilla de 24 con trazo de 1,5 px y
    extremos redondeados: los de identidad.
  - **Phosphor**, peso Light, para los genéricos. Solo se copian los de la tabla.

| Símbolo | Sustituye a | Origen | Fichero de origen en Phosphor | Dónde |
|---|---|---|---|---|
| `i-ahora` (dial) | 🚦 | Propio | — | Pestaña Ahora |
| `i-dia` (curva con cursor) | 🔍 | Propio | — | Pestaña Día a día |
| `f-bien`, `f-cuidado`, `f-evita` (●▲■ rellenos) | ● ▲ ■ | Propio | — | Semáforo, línea de 24 h, veredictos |
| `i-datos` | 📥 | Phosphor | `tray-arrow-down-light.svg` | Pestaña Datos, ranuras |
| `i-cuadra` | ⚖️ | Phosphor | `scales-light.svg` | Pestaña ¿Cuadra? |
| `i-meses` | 📅 | Phosphor | `calendar-blank-light.svg` | Pestaña Mes a mes |
| `i-ajustes` | ⚙ | Phosphor | `sliders-horizontal-light.svg` | Cabecera |
| `i-cerrar` | ✕ | Phosphor | `x-light.svg` | Diálogo |
| `i-sol` | ☀️ | Phosphor | `sun-light.svg` | Lecturas, razones, procedencia Solarman |
| `i-casa` | 🏠 | Phosphor | `house-light.svg` | Lecturas, razones |
| `i-bateria` | 🔋 | Phosphor | `battery-high-light.svg` | Lecturas, razones, avisos de reserva |
| `i-red` | 🔌 | Phosphor | `plug-light.svg` | Razones |
| `i-contador` | 🔌 (datadis) | Phosphor | `gauge-light.svg` | Procedencia datadis |
| `i-documento` | 📄 | Phosphor | `file-text-light.svg` | Procedencia Factura |
| `i-euro` | 💶 | Phosphor | `currency-eur-light.svg` | Razones |
| `i-reloj` | ⏰ | Phosphor | `clock-light.svg` | Razones |
| `i-prevision` | 🌤️ | Phosphor | `cloud-sun-light.svg` | Razones |
| `i-senal` | 📡 | Phosphor | `broadcast-light.svg` | Razones |
| `i-potencia` | ⚡ | Phosphor | `lightning-light.svg` | Razones, «Consumo grande», respaldo de aparatos |
| `i-rumbo` | 🧭 | Phosphor | `compass-light.svg` | Razones |
| `i-aviso` | ⚠️ | Phosphor | `warning-light.svg` | Avisos |
| `i-lavadora` | 🧺 | Phosphor | `washing-machine-light.svg` | Aparatos |
| `i-lavavajillas` | 🍽️ | Phosphor | `fork-knife-light.svg` | Aparatos. Phosphor no tiene lavavajillas; el nombre va siempre al lado |
| `i-secadora` | 💨 | Phosphor | `wind-light.svg` | Aparatos |
| `i-horno` | 🔥 | Phosphor | `oven-light.svg` | Aparatos |
| `i-vitro` | 🍳 | Phosphor | `cooking-pot-light.svg` | Aparatos |
| `i-nevera` | 🧊 | Phosphor | `snowflake-light.svg` | «Siempre enchufados» |
| `i-acuario` | 🐠 | Phosphor | `fish-light.svg` | «Siempre enchufados» |
| `i-gambario` | 🦐 | Phosphor | `shrimp-light.svg` | «Siempre enchufados» |
| `i-desconocido` | ❓ | Phosphor | `question-light.svg` | «Siempre enchufados» |

**Origen y licencia de Phosphor** (comprobado el 16-oct-2026 con la API de GitHub):
- Repositorio `github.com/phosphor-icons/core`, licencia MIT, «Copyright (c) 2023 Phosphor
  Icons».
- **Commit de origen:** `2b75f3ad12b420c9504ef05df8d2564a28f8500e` de la rama `main`
  (06-ene-2026), comprobado de nuevo el 16-oct-2026 con su `LICENSE` («MIT License —
  Copyright (c) 2023 Phosphor Icons»). La última etiqueta publicada es `v2.0.8`
  (01-feb-2024); se usa el commit porque es más preciso.
- Ruta de cada fichero: `assets/light/<nombre>-light.svg`. Los 27 nombres de la tabla existen
  en ese commit.

**Reglas de conservación:**
- `vendor/phosphor/LICENSE`: el `LICENSE` del commit de origen, **íntegro y sin tocar**, con
  su aviso de copyright.
- `vendor/phosphor/ORIGEN.txt`: repositorio, SHA completo del commit, fecha de la copia y,
  por cada icono, su ruta de origen, el `id` del símbolo y el SHA-256 del fichero original.
- Comentario al principio del sprite en `index.html`: «Iconos de Phosphor Icons — Copyright
  (c) 2023 Phosphor Icons — Licencia MIT — phosphor-icons/core@<SHA completo> — texto
  íntegro en vendor/phosphor/LICENSE».
- De cada SVG solo se toma el contenido gráfico y se envuelve en `<symbol>` con su `viewBox`
  original. La licencia MIT permite modificar siempre que se conserve el aviso.
- `README.md` cita Phosphor y su licencia junto a IBM Plex.
- Ninguno de estos ficheros entra en `BASE`: la app no los carga, así que no cuentan en M1
  ni en M2.

**Correspondencia en código** (`js/iconos.js`, §8.2):
- Aparatos **por `id`** (`lavadora`, `vitro`…), con `i-potencia` como respaldo.
- Razones del asesor: en F1, por el emoji actual del campo `icono`. En F2 pasan a `tipo`
  **solo si** se aplica D3 con R7 en verde (§10).

---

## 4. El arco solar

### 4.1 Qué representa (y qué no)

El arco es un **gráfico de rayos horarios dispuesto en semicírculo**:

- **Ángulo = hora del día**, de forma lineal, entre la primera y la última hora con
  producción del día. Izquierda = primera hora, derecha = última.
- **Longitud del rayo exterior = kWh solares de esa hora** (real o previsto).
- **Longitud del rayo interior = kWh de consumo de la casa en esa hora**, a la misma escala.
- Un **marcador** sitúa «ahora» sobre la pista.

**No representa** la elevación ni el azimut del sol. La aplicación no calcula la posición
solar y la previsión de Open-Meteo que pide (`shortwave_radiation`, `cloud_cover`) no la
incluye. Por eso los extremos se rotulan «primera/última hora con producción», nunca
«amanecer/ocaso», y la resolución es la franja horaria («08 h»).

### 4.2 Datos de entrada (todos existentes)

| Dato | Origen en el código | Clase | Uso en el arco |
|---|---|---|---|
| Producción y consumo **medidos** por hora `{inicio, solarKwh, casaKwh, socFin, cobertura}`, por fuente | `horasLocales()`, `horasDelArchivo()` y `horasDelWorker()` en `calcular()`. **Se añade `contexto.horasPorFuente = { local, archivo, worker }`**, además de `contexto.horas` (la lista que ya combina `juntarHoras`, sin cambios, y que sigue usando el asesor) | MEDIDO | Relleno de los rayos, rayos interiores pasados y SoC de fin de hora, con su procedencia |
| Producción **prevista** por hora `{inicio, kwh, origen: "prevision"\|"estimado", confianza}` | `preverSolar()` → `contexto.solar` | PREVISTO | Contorno de los rayos |
| Momento y estado de la previsión | `prevision.traido` y `prevision.fallo` (caché de `traerPrevision`). **Se añade `contexto.previsionTraida`**; `contexto.falloPrevision` ya existe | — | Leyenda «previsión de las HH:MM» y «sin conexión» |
| Producción **típica** por hora | `habitos.solarTipica(hora)`. Devuelve `null` si el histórico es de otra estación o no hay muestras | TÍPICO | Contorno de respaldo, solo en días sin previsión |
| Consumo **típico** por hora `{kwh, origen: "habito"\|"fondo"}` | `habitos.consumo(instante)` | TÍPICO | Rayos interiores futuros |
| Calibración `{kGlobal, maxKwh, confianza}` | `traerCalibracion()` → `contexto.calibracion` | — | Escala de los rayos |
| Lectura en vivo `{solarW, casaW, soc, instante}` y `fresco` | `contexto.vivo`, `contexto.fresco` | VIVO | Lecturas bajo el horizonte y marcador lleno o hueco. **Nunca entra en los rayos** |
| SoC típico a esta hora | `habitos.socTipico(hora)` | TÍPICO | Indicador de batería sin lectura en vivo |
| Reserva mínima | `c.bateria.socMinimoPct`, ajuste del usuario | AJUSTE | Marca fija del indicador |
| Reserva recomendada `{pct, hasta, aplicaAhora}` | `reservaRecomendada()` | SIMULADO | Marca en el indicador y texto |
| SoC proyectado por tramo | `simular(contexto.slots, bateria, socPct).pasos[i].socPct`. La función ya está exportada y probada, y llamarla no tiene efectos secundarios | SIMULADO | Muesca «llena» futura y SoC al acabar la producción prevista |
| Veredicto, coste y mejor ventana | `decidir()`, sin cambios | SIMULADO | Cuenco del arco |

Las clases (MEDIDO, PREVISTO, TÍPICO, SIMULADO, VIVO y AJUSTE) **no se mezclan nunca en un
mismo valor**. Cada cifra visible lleva su clase y su procedencia (§4.3.6).

### 4.3 Reglas de datos y modelo (`js/arco.js`, función pura)

#### 4.3.1 Día mostrado, franjas y cambio de hora

- **Día D:** la fecha local de `entrada.ahora`. Por D1, desde `hasta(hoy) + 1 h` hasta
  medianoche, D es el día siguiente (estado `mañana`). La ventana de hoy se calcula con las
  reglas del §4.3.3.
- **Intervalo del día:** `inicioD = new Date(a, m, d)` y `finD = new Date(a, m, d + 1)`, en
  hora local. D dura `finD − inicioD`: 23 h (29-mar-2026), 24 h o 25 h (25-oct-2026),
  comprobado en Node con `Europe/Madrid`.
- **Franjas:** intervalos absolutos `[inicioD + k·3 600 000, inicioD + (k+1)·3 600 000)`, con
  k = 0 … duración − 1.
  - En España el cambio de hora es a hora en punto, así que cada franja empieza a una hh:00
    local.
  - La geometría (§4.3.5) y el orden usan instantes absolutos: el cambio de hora no deforma
    el arco.
- **Hora inexistente** (día de 23 h): las 02:00–02:59 locales no existen. **No hay franja
  ni fila, y no es «sin dato».** Rótulos 00, 01, 03…
- **Hora repetida** (día de 25 h): dos franjas con rótulo 02 h. Solo esas dos llevan el
  desfase, calculado con `getTimezoneOffset()` de su `inicio`: «02 h (UTC+2)» y
  «02 h (UTC+1)».
- **Precedencia entre fuentes:** se combinan `horasPorFuente` por clave exacta
  (`inicio.getTime()`) con la misma precedencia que `juntarHoras`: Worker sobre archivo sobre
  local. Una prueba comprueba que los valores por clave coinciden con los de `juntarHoras`
  (que se exporta desde `ahora.js` sin cambiar su comportamiento). Cada valor guarda su
  `procedencia`.
- **Asignación a franjas:** cada entrada va a la franja que **contiene** su `inicio`
  (`inicio ≤ t < fin`); no se presupone que su clave coincida. Si varias entradas de la
  misma procedencia caen en la misma franja:
  - los kWh se **suman**;
  - la cobertura se suma con tope 1;
  - `socFin` es el de la entrada más tardía;
  - se anota `entradas: N`.
- **La energía nunca se reparte ni se mueve entre franjas.** Σ de las franjas = Σ de las
  entradas con `inicio` dentro de D.
- **Limitación aceptada temporalmente: hora repetida en datos locales.**
  - **Comportamiento comprobado:**
    - `aFecha` (`datos.js`) resuelve una hora local ambigua a su primera ocurrencia (UTC+2);
    - `inicioDeHora` (`habitos.js`) lleva cualquier instante de la segunda 02 h a la clave
      de la primera;
    - en el día de 23 h, `aFecha` convierte 02:xx en 03:xx.
  - Los dos ficheros están protegidos (§8.5.1) y no se corrigen. Por eso, en el día de 25 h,
    una entrada **local** de «02 h (UTC+2)» puede contener la energía de las dos 02 h, y la
    segunda 02 h puede quedar sin entrada local.
  - **Tratamiento:**
    - no se reparte energía;
    - la primera franja lleva `nota: "hora-repetida-local"`, su rayo se dibuja con el
      rayado de incertidumbre de `parcial` y la tabla dice «puede incluir las dos 02 h: el
      Excel no las distingue»;
    - si la segunda 02 h no tiene otra entrada, queda «sin dato» con la misma referencia;
    - el resumen añade «la hora repetida del cambio no se distingue en el Excel»;
    - no se afirma una precisión horaria que el Excel no da.
  - El Worker y Open-Meteo usan instantes UTC y no tienen esta ambigüedad.
  - La limitación se revisa si algún día se decide tocar `datos.js` o `habitos.js`, que hoy
    está fuera de alcance.
- **Recalculado completo:** el modelo se recalcula entero en cada `calcular()` (al abrir, al
  cambiar de pestaña, al volver a la app y cada 5 min). No guarda estado entre llamadas, así
  que el cambio de día lo resuelve el siguiente cálculo.

#### 4.3.2 Valores por franja

Cada franja tiene estos campos por separado. `null` significa «no hay dato»: **nunca se
pinta ni se suma como 0** y no genera cifra (§4.3.6).

| Campo | Regla |
|---|---|
| `real` | Valor combinado y asignado según el §4.3.1, con `procedencia` y `entradas`. Estados:<br>• `completa`: la franja ya terminó (`fin ≤ ahora`) y `cobertura ≥ 0,75`<br>• `parcial`: ya terminó y `0 < cobertura < 0,75`<br>• `en-curso`: la franja contiene `ahora`<br>Sin entrada en una franja pasada → `null` («sin dato»). En una franja futura, siempre `null` aunque haya entrada. Los kWh se muestran tal como se registraron: **no se extrapolan por cobertura** |
| `previsto` | Entrada de `contexto.solar` asignada a la franja, con su `origen` y su `confianza`. Si no hay → `null` |
| `tipico` | `habitos.solarTipica(hora)` **solo si D no tiene ninguna franja con `previsto`**. Si D tiene previsión, `tipico = null` en todas sus franjas: no se mezclan modelos en un mismo día |
| `casaReal` | Mismas reglas, estados y procedencia que `real`, con `casaKwh` |
| `casaTipica` | `habitos.consumo(inicio)` (`kwh`, `origen`), solo en franjas futuras o `en-curso`. En franjas pasadas sin dato, `null`: el pasado no se rellena con lo típico |
| `socFin` | `{pct, procedencia}` de la entrada medida, solo si `pct` es un número en (0, 100]. El 0 se trata como celda vacía, igual que hoy en `aHoras()` |
| `nota` | `"hora-repetida-local"` o `null` (§4.3.1) |

#### 4.3.3 Ventana, escala y referencia

- **Referencia del contorno:** `previsto` si D tiene previsión; si no, `tipico`. El
  relleno es siempre `real`. Si `real` supera la referencia, el relleno sobresale del
  contorno.
- **Ventana:** las franjas de D con `previsto.kwh ≥ 0,02`, `real.kwh ≥ 0,02` o (en días sin
  previsión) `tipico.kwh ≥ 0,02`.
  - `desde` = inicio de la primera; `hasta` = fin de la última.
  - Sin ninguna, no hay ventana y el estado es `sin-sol` (§4.5).
- **`escala.kwh`** (kWh que corresponden a un rayo de longitud `Lmax`; en las fórmulas
  del §4.3.5 se escribe `escalaKwh`):
  1. Si `calibracion.kGlobal !== null` y `calibracion.maxKwh > 0`: `calibracion.maxKwh`.
     Leyenda: «escala de tu instalación».
  2. Si no: el máximo del día entre `previsto`, `real` y `tipico`. Leyenda: «escala de este
     día».
  3. Si es 0 o no hay valores: sin rayos.
- **Calibración inexistente:** `preverSolar()` ya devuelve `[]` cuando no hay calibración
  ni kWp. Entonces D no tiene `previsto` y se aplica `tipico`, o `sin-sol` si tampoco hay.
  Con kWp pero sin calibrar, `origen = "estimado"`: contorno discontinuo y leyenda
  «estimación por potencia pico, sin calibrar».
- **Previsión desfasada:** si `traerPrevision` devolvió la caché con `fallo`, se usa la
  caché y la leyenda dice «previsión de las HH:MM (sin conexión)».

#### 4.3.4 Batería

| Valor | Regla | Origen mostrado |
|---|---|---|
| SoC del indicador | `vivo.soc` si `fresco`; si no, `vivo.soc` si existe; si no, `habitos.socTipico(hora)`; si no, **ninguno** | `en vivo` / `lectura de hace N min` / `típico a esta hora` / «sin dato de batería» |
| Aviso | El asesor usa 50 % por defecto cuando no hay nada (`socPct ?? 50` en `calcular()`). **Ese 50 no se muestra nunca**: con origen «ninguno», el indicador sale vacío y dice «sin dato de batería». El asesor sigue funcionando como hoy | — |
| SoC al acabar el sol | Paso de `simular()` cuyo tramo contiene `hasta`, solo si D = hoy, hay `previsto` y el origen del SoC no es «ninguno» | `simulado` |
| Muesca «llena» pasada | Primera franja de D con `socFin ≥ 98`. Se coloca en el **fin** de la franja: «llena antes de las 14:00» | `medido` |
| Muesca «llena» futura | Solo si no hay muesca pasada: primer paso de `simular()` con `socPct ≥ 98` cuyo tramo termina dentro de la ventana. Se coloca en el fin del tramo: «≈ 14:00 (simulado)» | `simulado` |

#### 4.3.5 Geometría

Convención: el ángulo θ se mide en grados desde el semieje +x (a la derecha del centro), en
sentido antihorario. 180° es el extremo izquierdo, 90° la cima y 0° el extremo derecho.

```
p(t) = (t − desde) / (hasta − desde)        limitado a [0, 1]
θ(t) = 180° · (1 − p(t))
x = cx + R·cos θ        y = cy − R·sin θ     (y del SVG crece hacia abajo)
cx = 200, cy = 200, R = 150
```

**La cima del arco es el punto medio de la ventana, no las 12:00 ni el mediodía solar.**

Ejemplo con la ventana 08:00–20:00 (12 h):

| Instante | p | θ | Punto en la pista (x, y) |
|---|---|---|---|
| 08:00 | 0 | 180° | (50, 200) |
| 08:30 (centro del rayo de 08–09 h) | 0,0417 | 172,5° | (51,28; 180,42) |
| 12:00 | 0,3333 | 120° | (125, 70,10) |
| 14:00 | 0,5 | 90° | (200, 50) |
| 20:00 | 1 | 0° | (350, 200) |

- **Rayo de una franja:** ángulo en el centro de la franja; longitud
  `L = min(kWh / escalaKwh, 1) · Lmax`.
- **Rayo interior:** misma escala en px/kWh, con tope `Lcasa`. Si lo supera, lleva la
  muesca de desborde.
- **Marcador:** se dibuja en `(cx + R, cy)` y se coloca con
  `transform="rotate(−θ, cx, cy)"` (en SVG, un giro positivo va en sentido horario).
- Antes de `desde` o después de `hasta`, el marcador no va en la pista: queda bajo el
  horizonte en el extremo correspondiente (`posicion: "antes" | "despues"`).

#### 4.3.6 Contrato de `modeloArco(entrada)`

`modeloArco` es una función pura: no toca el DOM, `localStorage` ni la red, y no modifica la
entrada. `pintarArco(figure, modelo)` se limita a dibujar el modelo.

**Entrada.** Todo lo calcula ya `calcular()` o se añade a `contexto` sin cambiar el asesor.

```
entrada = null                                   // antes del primer calcular() → estado "cargando"
entrada = {
  ahora: Date,
  error: Error | null,                           // calcular() lanzó → estado "error"
  horasPorFuente: { local: [Hora], archivo: [Hora], worker: [Hora] },
                                                 // Hora = { inicio, casaKwh, solarKwh, socFin, cobertura }
  solar: [{ inicio, kwh, origen: "prevision"|"estimado", confianza }],
  prevision: { traida: Date|null, sinConexion: boolean },
  calibracion: { kGlobal, maxKwh, confianza },
  habitos: { solarTipica(hora), consumo(instante), socTipico(hora) },
  vivo: { solarW, casaW, soc, instante } | null,
  fresco: boolean,
  bateria: { socMinimoPct, ... },                // c.bateria
  reserva: { pct, hasta, aplicaAhora } | null,   // reservaRecomendada()
  slots: [{ inicio, fin }],                      // construirHorizonte()
  pasos: [{ socPct }] | null,                    // simular(slots, …).pasos, en el mismo orden que slots
  decision: { estado, titulo, ahora: {inicio, fin, coste} | null,
              mejor: {inicio, fin, coste} | null } | null,
  carga: { id, nombre }
}
```

**Salida**

```
{
  estado: "error"|"cargando"|"sin-sol"|"mañana"|"noche"|"sin-prevision"|"sin-calibrar"|"sin-vivo"|"completo",
  dia: { tipo: "hoy"|"mañana", inicio: Date, fin: Date, horas: 23|24|25 } | null,
  ventana: { desde: Date, hasta: Date } | null,
  franjas: [{
    inicio, fin, rotulo, desfaseUtc, angulo | null,          // angulo null fuera de la ventana
    real:       { kwh, estado, cobertura, procedencia, entradas } | null,
    previsto:   { kwh, origen, confianza } | null,
    tipico:     { kwh } | null,
    casaReal:   { kwh, estado, cobertura, procedencia, entradas } | null,
    casaTipica: { kwh, origen } | null,
    socFin:     { pct, procedencia } | null,
    nota:       "hora-repetida-local" | null
  }],
  escala:   { kwh, origen: "instalacion"|"dia" } | null,
  prevision:{ traida: Date|null, sinConexion: boolean, estimada: boolean },
  leyendas: ["sin-calibrar" | "sin-conexion" | "tipico" | "escala-dia" | "hora-repetida-local"],
  marcador: { angulo | null, posicion: "pista"|"antes"|"despues"|null, lleno: boolean },
  muesca:   { angulo, instante, origen: "medido"|"simulado" } | null,
  bateria:  { soc | null, origenSoc: "vivo"|"lectura-antigua"|"tipico"|"ninguno", instanteSoc | null,
              minimo, recomendada | null, alAcabarSol | null },
  vivo:     { solarW, casaW, soc, instante, fresco } | null,
  asesor:   { estado, titulo, carga, costeAhora | null, mejor: { inicio, fin, coste } | null } | null,
  totales:  { realKwh, previstoKwh | null, horasCompletas, horasParciales, horasEnCurso, horasSinDato },
  cifras:   [Cifra],
  visibles: { arco: [id], cuenco: [id], lecturas: [id], bateria: [id],
              extremos: [id], muesca: [id], leyenda: [id] },
  tabla:    { franjas: [{ inicio, ids: [id] }], pie: [id], bateria: [id], vivo: [id], asesor: [id] },
  resumen:  { plantilla, ids: [id], texto }
}
```

**Correspondencia con revisiones anteriores.** No se pierde ningún dato del contrato original
(revisión 1): cada campo se conserva, se renombra o se sustituye por uno equivalente, con
su motivo.

*Salida, revisión 1 → revisión 2:*

| Revisión 1 | Revisión 2 y siguientes | Motivo |
|---|---|---|
| `rayos[]` | `franjas[]` (la franja existe aunque no tenga rayo; `angulo: null` fuera de la ventana) | El cambio horario y la tabla necesitan todas las horas del día |
| `rayos[].previsto`, `.confianza`, `.origen` | `franjas[].previsto: {kwh, origen, confianza}` | Se agrupan los datos de la previsión |
| `rayos[].real`, `.parcial` | `franjas[].real: {kwh, estado}` (`parcial` pasa a ser `estado = "parcial"`) | Tres estados: completa, parcial, en curso |
| `rayos[].casa`, `.casaOrigen` | `franjas[].casaReal` / `franjas[].casaTipica: {kwh, origen}` | No se mezclan medido y típico (§4.3.2) |
| `muescas[{tipo: "llena", angulo, prevista}]` | `muesca: {angulo, …, origen}` (`prevista` → `origen = "simulado"`) | Solo existía el tipo «llena» |
| `escalaKwh` | `escala: {kwh, origen}` | D6: la escala declara su origen |
| `bateria.estimado` | `bateria.origenSoc` | Cuatro orígenes en vez de un booleano; nunca se muestra el 50 % por defecto |
| — | `totales` | Totales comprobables en el pie de la tabla |

*Salida, revisión 2 → revisión 3* (no se elimina ningún dato, solo cambia la forma):

| Antes | Ahora | Motivo |
|---|---|---|
| `dia: "hoy"\|"mañana"` | `dia.tipo` + `inicio`, `fin`, `horas` | Días de 23/24/25 h (§4.3.1) |
| `previsionTraida` | `prevision.traida` | Se agrupa con `sinConexion` y `estimada` |
| `muesca.hora` | `muesca.instante` (Date) | Formato único de horas en `cifras` |
| `socFin` (número) | `socFin: {pct, procedencia}` | Procedencia exigida por la trazabilidad |
| `resumen: string` | `resumen: {plantilla, ids, texto}` | `texto` es la antigua cadena; la plantilla la hace comprobable |
| — | `rotulo`, `desfaseUtc`, `nota`, `procedencia`, `entradas`, `leyendas`, `vivo`, `asesor`, `horasEnCurso`, `cifras`, `visibles`, `tabla` | Cambio horario, trazabilidad y cuenco |

*Entrada, revisión 1 → revisión 3:*

| Revisión 1 | Revisión 3 | Motivo |
|---|---|---|
| `ahora`, `solar`, `vivo`, `fresco`, `bateria`, `reserva`, `pasos`, `slots`, `decision` | Igual | — |
| `horas` | `horasPorFuente: {local, archivo, worker}` (`contexto.horas` sigue igual para el asesor) | Procedencia y precedencia (§4.3.1) |
| `consumoTipico`, `solarTipica` | `habitos.consumo`, `habitos.solarTipica`, `habitos.socTipico` | Mismas funciones de `crearHabitos`, sin envolver |
| `escalaKwh` | Se calcula en el modelo a partir de `calibracion` (§4.3.3) | D6: el modelo decide y declara el origen de la escala |
| `socPct`, `socEstimado` | Se quitan de la entrada; el modelo obtiene el SoC de `vivo` y `habitos` (§4.3.4) | `socPct` puede valer 50 por defecto y no debe mostrarse. El asesor lo sigue usando, ya incluido en `pasos` y `decision` |
| — | `error`, `prevision`, `calibracion`, `carga` | Estados `error`, leyendas de previsión, escala y texto del cuenco |

**`Cifra`: registro único de toda cifra mostrada**

```
Cifra = {
  id,           // único y estable (catálogo de abajo)
  valor,        // número en la unidad mostrada; en "hora" y "franja", milisegundos desde 1970
  unidad,       // "kWh" | "kW" | "%" | "€" | "hora" | "franja" | "h" | "min"
  decimales,    // tabla de formato; null en "hora" y "franja"
  texto,        // formatear(valor, unidad, decimales); en "€", euros(valor) del motor, sin cambios
  clase,        // "medido" | "previsto" | "tipico" | "simulado" | "vivo" | "ajuste" | "calculo"
  procedencia,  // "worker" | "archivo" | "local" | "open-meteo" | "habitos" | "simulador" | "asesor" | "ajuste" | "calibracion" | "calculo" | "serie" (solo en el relato, §5.5.1)
  ruta,         // de dónde sale en la entrada, p. ej. "horasPorFuente.worker[<ms>].solarKwh"
  instante      // Date del dato, o null
}
```

| Unidad | Decimales | Ejemplo de `texto` |
|---|---|---|
| `kWh` | 2 en franjas; 1 en totales y en la escala | «0,42 kWh», «11,4 kWh» |
| `kW` | 2 (`valor` = W / 1000) | «2,41 kW» |
| `%` | 0 | «78 %» |
| `€` | Los de `euros()` del motor | «≈ 0,02 €» |
| `hora` | — | «14:05», con `toLocaleTimeString("es-ES", {hour: "2-digit", minute: "2-digit"})`, la misma llamada que `cuando()` del motor |
| `franja` | — | «08 H», «02 H (UTC+1)» |
| `h` | 0 | «1 h» (recuento de horas) |
| `min` | 0 | «34 min» |

Formato en es-ES en **una sola función**, `formatear`, de `arco.js`. En «€» delega en
`euros()` para que el texto sea idéntico al del asesor.

**Catálogo de ids**

| `id` | Unidad | Clase | Procedencia | Visible en | Tabla |
|---|---|---|---|---|---|
| `franja:<ms>:real` | kWh | medido | worker / archivo / local | `arco` (relleno del rayo) | a) |
| `franja:<ms>:cobertura` | min | medido | ídem | — | a) «parcial (NN min)» |
| `franja:<ms>:previsto` | kWh | previsto | open-meteo | `arco` (contorno) | a) |
| `franja:<ms>:tipico` | kWh | tipico | habitos | `arco` (contorno punteado) | a) |
| `franja:<ms>:casaReal` | kWh | medido | worker / archivo / local | `arco` (rayo interior) | a) |
| `franja:<ms>:casaTipica` | kWh | tipico | habitos | `arco` (contorno interior) | a) |
| `franja:<ms>:socFin` | % | medido | worker / archivo / local | — | a) |
| `franja:<ms>:rotulo` | franja | calculo | calculo | — | a) primera columna |
| `ventana:desde`, `ventana:hasta` | franja | calculo | calculo | `extremos` | pie |
| `total:real` | kWh | medido | calculo | resumen | pie |
| `total:previsto` | kWh | previsto | calculo | resumen | pie |
| `total:sinDato` | h | calculo | calculo | resumen | pie |
| `escala` | kWh | calculo | calibracion / calculo | `leyenda` | pie |
| `prevision:traida` | hora | calculo | open-meteo | `leyenda` | pie |
| `muesca` | hora | medido / simulado | worker / archivo / local / simulador | `muesca` | b) |
| `bateria:soc` | % | vivo / tipico | worker / habitos | `lecturas` (sin vivo), `bateria` | b) |
| `bateria:minimo` | % | ajuste | ajuste | `bateria` | b) |
| `bateria:recomendada` | % | simulado | asesor | `bateria` | b) |
| `bateria:alAcabarSol` | % | simulado | simulador | `bateria` | b) |
| `vivo:solarW`, `vivo:casaW` | kW | vivo | worker | `lecturas` | c) |
| `vivo:soc` | % | vivo | worker | `lecturas` | c) |
| `vivo:instante` | hora | vivo | worker | `leyenda` (frescura) | c) |
| `vivo:antiguedad` | min | calculo | calculo | `lecturas` («lectura de hace 34 min») | c) |
| `asesor:costeAhora` | € | simulado | asesor | `cuenco` | d) |
| `asesor:mejor:inicio` | hora | simulado | asesor | `cuenco`, salvo que `cuando()` devuelva «Ahora» | d) |
| `asesor:mejor:fin` | hora | simulado | asesor | — (el cuenco no lo muestra) | d) |
| `asesor:mejor:coste` | € | simulado | asesor | `cuenco` | d) |

**Reglas de coherencia** (las comprueba `test/arco.test.js`, §8.4):
1. Los `id` de `cifras` son únicos.
2. Todo `id` de `visibles` y de `resumen.ids` existe en `cifras` y aparece en `tabla`.
3. Todo `id` de `tabla` existe en `cifras`.
4. Para cada cifra, `texto === formatear(valor, unidad, decimales)` (o `euros(valor)` en «€»).
5. Un valor `null` **no genera cifra**: en la tabla se escribe «—» sin `data-cifra`.
6. `resumen.texto` es `resumen.plantilla` con cada `{id}` sustituido por `cifras[id].texto`.
   Fuera de los marcadores, la plantilla no contiene dígitos.
7. `clase` y `procedencia` concuerdan con `ruta`. Por ejemplo, una ruta `solar[…]` solo
   puede ser `previsto`/`open-meteo`, y una ruta `horasPorFuente.worker[…]` solo
   `medido`/`worker`.
8. La longitud de cada rayo es `min(valor / escala.kwh, 1) · Lmax` (o `Lcasa` en los
   interiores), con el `valor` de la cifra que lleva en `data-cifra`.

**Resumen.** La plantilla se construye según los datos que haya; si falta un dato, su frase
no entra. Ejemplo: «Producción prevista hoy de {ventana:desde} a {ventana:hasta}:
{total:previsto}. Llevas {total:real} (faltan datos de {total:sinDato}). Ahora,
{vivo:solarW}. Batería al {bateria:soc}, en vivo.» Las palabras que nombran el origen («en
vivo», «típico a esta hora») salen de `clase` y no son cifras.

### 4.4 Composición (SVG, `viewBox="0 0 400 236"`)

```
cx = 200, cy = 200 (horizonte), R = 150 (pista)
Rayo exterior: de R + 6 a R + 6 + Lmax,   Lmax = 34
Rayo interior: de R − 6 a R − 6 − Lcasa,  Lcasa máx. = 30
Grosor del rayo: 6 u (≤ 13 rayos) · 4 u (> 13 rayos)   (u = unidades del viewBox; todo escala con el SVG)
Cuenco (HTML superpuesto, no texto SVG): círculo inscrito de radio R − 44
Bajo el horizonte (y 200–236): rótulos de los extremos y marcador fuera de ventana
```

| Capa (de abajo arriba) | Dibujo |
|---|---|
| Horizonte | Línea de 1 px `--escala` de x = 20 a 380 |
| Pista | Arco de 1 px `--escala`; marca menor en cada franja y mayor en los extremos |
| Contorno de referencia | `previsto`: contorno de 1 px `--sol-tenue`, discontinuo `3 2` si `origen = "estimado"` o `confianza = "baja"`. En días sin previsión, `tipico` con punteado `1 2` |
| Relleno medido | `--sol` hasta `real.kwh`. `completa` al 100 %, `en-curso` al 55 %, y `parcial` o con `nota` con rayado diagonal (`<pattern>` de `--sol`). Con `real = null` en una franja pasada: sin relleno y un punto `--escala` de 2 u en la base, que significa «sin dato» |
| Rayo interior (D7) | Siempre hacia dentro y en `--casa`, nunca en un color de energía. `casaReal`: relleno con opacidad 0,70 y los mismos estados. `casaTipica`: solo contorno con opacidad 0,40 |
| Muesca «llena» | Triángulo de 5 u `--estano` sobre la pista |
| Marcador | Círculo de r = 7: relleno `--sol` si `fresco`, contorno de 1,5 u si no. Halo de r = 14 con `color-mix(in srgb, var(--sol) 15%, transparent)` |

- Cada rayo (`<path>`) lleva `data-cifra` con el `id` del valor que dibuja.
- **Rótulos en HTML superpuesto**, no en `<text>` de SVG, para que todas las cifras usen el
  mismo marcado (§4.6) y la misma fuente:
  - extremos: `ventana:desde` / `ventana:hasta`, con `--t-escala`;
  - muesca: «LLENA ANTES DE LAS {muesca}» (medido) o «LLENA ≈ {muesca} · SIMULADO».
- **Leyenda permanente bajo el arco (D7):** sol medido (relleno), sol previsto (contorno),
  casa medida (relleno interior) y casa típica (contorno interior), más las `leyendas`
  activas del modelo.

**Cuenco (HTML):** forma del semáforo (`f-bien`/`f-cuidado`/`f-evita`, 28 px) +
`decision.titulo` en `--t-display` + `#costeAhora` en `--t-cifra` + `#proximaVentana` en
`--sol`.
- Mantiene `role="status"`, `aria-live="polite"` y el `aria-label` que ya construye
  `pintarDecision()`.
- Las cifras de `#costeAhora` y `#proximaVentana` se envuelven en `<data>` (§4.6). **Solo
  se envuelve la subcadena literal** que ya genera el asesor (`euros()`, `cuando()`), así
  que su `textContent` no cambia y R1 lo puede comparar con la línea base. Si `cuando()`
  devuelve «Ahora», no hay cifra de hora visible.

**Bajo el arco:**
- **Lecturas** (`#cifrasVivo`): `SOL {vivo:solarW} · CASA {vivo:casaW} · BATERÍA {vivo:soc}`,
  con iconos `i-sol`/`i-casa`/`i-bateria`.
  - Si la lectura no es fresca, se añade «lectura de hace {vivo:antiguedad}».
  - Si no hay lectura: sin SOL ni CASA, y la batería muestra `bateria:soc` con su origen
    («· típico a esta hora») o «sin dato de batería».
- **Indicador de batería:** regla horizontal de 0 a 100 %, con:
  - relleno `--estano` hasta `bateria:soc` (vacío si el origen es «ninguno»);
  - marca de `bateria:minimo`;
  - marca de `bateria:recomendada`, si existe;
  - punto hueco con `bateria:alAcabarSol` (simulado).

  Debajo, una leyenda Mono con el origen de cada marca.
- **Frescura** (`#frescura`): `--t-ayuda` `--texto-3`. Añade «previsión de las
  {prevision:traida}» y «sin conexión» cuando corresponde.

### 4.5 Estados

| Estado | Condición (se evalúa en este orden; gana el primero) | Se ve |
|---|---|---|
| `error` | `entrada.error` | Solo pista; «No he podido calcular» + mensaje (lo que ya hace `pintarAhora`) |
| `cargando` | `entrada = null` | Pista y marcas sin rayos ni marcador; «Calculando…» |
| `sin-sol` | D sin ventana (§4.3.3) | Solo pista. Si D = hoy: «Sin datos de sol para hoy: pon tu ubicación en Ajustes del asesor», con enlace a `#formAsesor`. Si D = mañana: «Sin previsión para mañana» |
| `mañana` | D = mañana (D1: `ahora ≥ hasta(hoy) + 1 h`) | Solo contornos `previsto` y `casaTipica`. Rótulo «MAÑANA · PREVISIÓN» con la fecha y «previsión de las {prevision:traida}». Sin marcador ni relleno; la tabla solo muestra columnas de previsión y típico |
| `noche` | D = hoy y (`ahora < desde` o `hasta ≤ ahora < hasta + 1 h`) | Rayos de D; marcador bajo el horizonte en el extremo; «Producción prevista desde las {ventana:desde}» o «Hoy: {total:real} medidos» |
| `sin-prevision` | D sin `previsto`, con `tipico` | Contornos punteados; leyenda «lo típico a esta hora, sin previsión» |
| `sin-calibrar` | Algún `previsto` de D con `origen = "estimado"` | Contornos discontinuos; leyenda «estimación por potencia pico, sin calibrar» |
| `sin-vivo` | Hay ventana y `!fresco` | Marcador hueco; lecturas según el §4.4 |
| `completo` | Lo demás | Todo |

Los estados son excluyentes. Las `leyendas` (sin calibrar, sin conexión, escala del día,
hora repetida) se acumulan aunque gane otro estado.

### 4.6 Interacción, accesibilidad y trazabilidad

- `<figure>` con `<svg role="img" aria-labelledby="arcoResumen">`. `#arcoResumen` es texto
  visualmente oculto con `modelo.resumen.texto`.
- **Marcado de cifras:** cada `Cifra` visible, en el arco, el cuenco, las lecturas, la
  batería, los extremos, la muesca, la leyenda o el resumen, se escribe como
  `<data value="{valor}" data-cifra="{id}" data-unidad="{unidad}" data-clase="{clase}" data-procedencia="{procedencia}">{texto}</data>`.
- `<details>` **«Ver por horas»** bajo el arco. Es la alternativa para teclado, lector de
  pantalla y `forced-colors`, y **el sitio donde se comprueba cada cifra**. Usa el mismo
  marcado con los mismos `id` (`modelo.tabla`) y tiene cuatro bloques:

  **a) Franjas de D** (`tabla.franjas`)

  | Hora | Sol medido (kWh) | Estado | Procedencia | Sol previsto (kWh) | Origen de la previsión | Sol típico (kWh)¹ | Casa medida (kWh) | Casa típica (kWh) | SoC fin (%) | Nota |
  |---|---|---|---|---|---|---|---|---|---|---|
  | `rotulo` | `real` o «—» | completa · parcial ({cobertura}) · en curso · sin dato | Worker · archivo · local (N entradas) | `previsto` o «—» | calibrada (alta/media/baja) · potencia pico | `tipico` o «—» | `casaReal` o «—» | `casaTipica` (hábito/fondo) o «—» | `socFin` o «—» | hora repetida local |

  ¹ Solo en días sin previsión. «—» significa sin dato: no es cifra y nunca se escribe 0.

  **Pie** (`tabla.pie`): `total:real` con el recuento «N completas, M parciales, K en curso,
  {total:sinDato} sin dato»; `total:previsto`; `ventana:desde`–`ventana:hasta`; `escala` con
  su origen; `prevision:traida`.

  **b) Batería** (`tabla.bateria`): `bateria:*` y `muesca`, con origen e instante.

  **c) Lectura en vivo** (`tabla.vivo`): `vivo:*`.

  **d) Asesor** (`tabla.asesor`): `asesor:costeAhora` y `asesor:mejor:*`, clase simulado.

- **Regla de trazabilidad:** se cumplen las reglas de coherencia del §4.3.6 y, en el DOM,
  cada `[data-cifra]` visible tiene en «Ver por horas» un elemento con el mismo `data-cifra`,
  `value`, `data-unidad`, `data-clase`, `data-procedencia` y `textContent`. **No se extraen
  números del texto con expresiones regulares.**
- Puntero (opcional en F2): al pasar por un rayo, el globo (`.pista`) muestra la fila de esa
  franja. Sin puntero no se pierde nada: la tabla lo da.

### 4.7 Movimiento

| Momento | Animación | Duración / curva |
|---|---|---|
| Primer pintado de la sesión | Los rayos crecen desde la base (`scale` en el eje del rayo) en orden horario, 12 ms entre uno y otro | 420 ms `cubic-bezier(.2,.8,.2,1)` |
| Refresco cada 5 min | La longitud nueva se interpola, sin crecer desde cero | 300 ms, misma curva |
| Cambio de marcador | Rota sobre el centro (`transform: rotate`) | 600 ms, misma curva |
| Cambio de veredicto | Fundido cruzado del cuenco | 200 ms `ease-out` |
| Cambio de aparato | Solo cuenco, ventanas y línea de 24 h; el arco no se mueve | — |

Estas animaciones solo existen con `prefers-reduced-motion: no-preference` (§6.2). Solo
se animan `transform` y `opacity`.

---

## 5. Las cinco pestañas

Se conservan los ids de pestañas y paneles (`pestana-*`, `panel-*`), la navegación por
`#hash`, las flechas del `tablist` y todos los ids que usa el JS. Los cambios son de
composición y estilo, salvo en *Ahora* y *Día a día*.

### 5.1 Ahora — wireframe

Móvil (375 px):

```
┌─────────────────────────────────────────────┐
│ Solar Monitor               solarman · 3 min [◇]│  cabecera: marca Sans 85 % 600; frescura Mono
├─────────────────────────────────────────────┤
│                 ╻ ╻ ┃ ┃ ┃ ╻                  │
│           ╻ ┃ ┃              ┊ ┊ ╻           │  rayos exteriores: ┃ real (sol) ┊ previsto
│       ╻ ┃   ˙  ˙  ˙  ◉ ˙  ˙  ˙   ┊  ╻         │  pista horaria + ◉ ahora
│     ╻   ˙   │ │ │ │   ¦ ¦ ¦ ¦   ˙   ╻       │  rayos interiores: casa
│        ˙          ●              ˙          │
│       ˙      Buen momento         ˙         │  cuenco: forma + veredicto (display)
│      ˙   Consumo grande ahora ≈ 0,02 €   ˙  │  coste (Mono)
│ ─────┴───────────────────────────────┴───── │  horizonte
│ 08 H    ▲ LLENA ≈ 14:00 · SIMULADO      20 H │  extremos y muesca (escala)
│                                             │
│ SOL 2,41 kW    CASA 0,62 kW    BATERÍA 78 % │  lecturas (Mono, iconos 16 px)
│ 0 ├──┬───────────────▓▓▓▓▓▓▓▓▓▓▓▓──○──┤ 100 │  batería: relleno, │ reserva, ○ al acabar el sol
│      10 % reserva   ↑ 38 % esta noche       │
│ Datos de Solarman hace 3 min                │  frescura
├─────────────────────────────────────────────┤
│ [◇ Consumo grande][◇ Lavadora][◇ Lavav…]  →  │  selector segmentado (◇ = icono SVG del aparato)
├─ 01  Mejor momento · lavadora (2,2 h) ───────┤
│ hoy 13:00 → 15:10                    ≈ 0,00 € │  la mejor: filete izquierdo 2 px --bien
│ hoy 16:00 → 18:10                    ≈ 0,04 € │
├─ 02  Próximas 24 horas ─────────────────────┤
│ ●●●●●▲▲■■■■■■■■■■▲▲●●●●●                    │  24 celdas: forma + color; la actual con filete
│ 14   18   22   02   06   10                  │  escala Mono
├─ 03  Reserva para esta noche ───────────────┤  (solo si aplica)
│ Hasta que el sol vuelva (mañana 09:00) harán  │
│ falta ≈ 3,1 kWh.                              │
├─ ▸ ¿Por qué? ────────────────────────────────┤  details: razones con iconos SVG
├─ ▸ Ajustes del asesor ───────────────────────┤  details: formulario en dos columnas
└─────────────────────────────────────────────┘
│  ◇ Ahora   ◇ Datos   ◇ ¿Cuadra?   ◇ Meses   ◇ Día │  barra inferior fija (◇ = icono SVG de la pestaña)
```

En los wireframes, `◇` marca un icono SVG del sprite (§3.5) y `●▲■` las formas SVG
`f-bien`/`f-cuidado`/`f-evita`. Ninguno es un carácter de texto en la interfaz real.

≥ 960 px: dos columnas. Izquierda (7/12): arco, lecturas, batería, frescura. Derecha
(5/12): selector de aparato, Mejor momento, Próximas 24 h, Reserva. Debajo, a todo el
ancho: ¿Por qué? y Ajustes. El arco queda alineado arriba a la izquierda, no centrado
en la página.

`#aprendiendo` pasa a ser un aviso en línea bajo la frescura (barra `--cuidado`), no una
sección propia.

### 5.2 Datos

- Las dos ranuras (`#soltarDatos`, `#soltarFactura`) en fila (≥ 620 px), numeradas en Mono
  «01 · Datos del datalogger», «02 · Factura de la luz».
- *Desde Solarman*, *Datos del contador* (datadis) y *Columnas detectadas* pasan a
  secciones con cabecera; formularios en una línea de campos con rótulo encima.
- `.estado` se queda con su semántica (verde/rojo) usando `--bien` y `--evita`.

### 5.3 ¿Cuadra?

- `#fichas` pasa a **Lectura**: el titular principal es «Comprado a la red» en
  `--t-cifra-l`; el resto (producido, consumido, vertido, autoconsumo) en una fila Mono.
- `#tablaFactura` → **acta de cotejo**: columnas Factura · Solarman · Diferencia, y una
  cuarta columna con una **barra de desvío** centrada en cero (±10 % a todo el ancho; la
  barra se pinta `--coral` si va en contra y `--bien` si está dentro de tolerancia).
- `#veredicto` y `#veredictoRevision`: barra de estado + forma + texto.
- Etiquetas de procedencia: `Factura` (`i-documento`, `--texto-2`), `Solarman` (`i-sol`,
  `--sol`), `datadis` (`i-contador`, `--estano`). Mismo sitio y mismo número de etiquetas
  que hoy. **Se generan con un helper** (`fuente("factura")`) en vez de cadenas repetidas
  en `app.js`.
- `#mapaSolape` usa `--coral` sobre `--pozo`.

### 5.4 Mes a mes

- `#tablaHistorico` como **libro de registro**: mes en Sans 85 %, cifras Mono, fila activa
  con filete izquierdo `--sol`. Se mantienen el clic y el teclado (`tr` con foco).
- `#detalleMes` se despliega como fila ampliada (`--superficie`) con su Lectura.
- `#graficaHistorico` con la paleta nueva. La barra de importe (hoy `COLORES.carga`,
  azul) pasa a `--texto-2`: el dinero no es un flujo de energía.
- Botones «Guardar este mes» (primario) y «Descargar/Restaurar copia» (enlaces de texto
  con icono, no botones con caja).

### 5.5 Día a día — recorrido narrativo («el relato del día»)

#### 5.5.1 Momentos (función pura, `js/relato.js`)

`detectarMomentos(registros, unidadesRol, { festivos, pasoMinutos }) → { momentos:
[{ tipo, indice, instante, desde?, hasta?, titulo, detalle, cifras }], calidad }`, con los
momentos ordenados por `instante`.

- `registros`: los del día que ya filtra `pintarDia()`.
- `indice`: posición en ese mismo array, la que usa la gráfica.
- La función **no modifica** `registros`: trabaja sobre una copia ordenada por `instante`.
- `cifras`: lista de `Cifra` con la estructura del §4.3.6 (`clase: "medido"`,
  `procedencia: "serie"`, `ruta: "registros[<indice>].<rol>"` o la suma de un tramo). El paso
  las muestra con el mismo marcado `<data>` del §4.6.

**A. Calidad de los datos (se evalúa antes de buscar momentos)**

| Caso | Regla |
|---|---|
| Unidad desconocida | Si `unidadesRol[rol]` no es `"W"` ni `"kWh"`, el rol **no está disponible** ese día |
| Valor inválido | Si un valor no es número finito o es negativo, no vale para ese rol en ese registro. El SoC vale solo en (0, 100]. Un 0 se trata como celda vacía, igual que hoy en `aHoras()` |
| Registro sin duración | `horas` no finito o ≤ 0. Pasa, por ejemplo, con instantes duplicados: `construirSerie` les da `horas = 0`. Ese registro:<br>• no suma tiempo a ninguna racha;<br>• en roles en W, su potencia vale para picos y umbrales, pero su energía cuenta 0;<br>• en roles en kWh, su energía cuenta, pero su potencia es desconocida |
| Potencia | W tal cual. Para kWh: `W = kWh / horas × 1000`, solo si `horas` es válido |
| Hueco | Entre dos registros consecutivos, `Δt > 1,5 × pasoMinutos`. Si falta `pasoMinutos`, se usa la mediana de los Δt del día |
| Rol disponible | Unidad conocida **y** valor válido en al menos el 90 % de los registros con duración del día. Si no, ningún momento que lo necesite aparece |
| `consumo` | `construirSerie` lo deriva cuando no hay columna, y en la serie guardada no se distingue si es medido o derivado. Por prudencia, los momentos que usan consumo exigen además `produccion` e `importada` disponibles |
| Reparto del pico de consumo | Exige `produccion`, `exportada`, `importada`, `carga` y `descarga` disponibles, porque `solarDirecta` se deriva de ellos. Si falta alguno, se muestra el pico sin reparto |
| Cambio de hora | La duración del día es `finD − inicioD` (23, 24 o 25 h, §4.3.1) y es la que usa «Datos de X de N h». Si en el día de 25 h hay instantes duplicados entre las 02:00 y las 02:59 (efecto comprobado de `aFecha`), el resumen dice «La hora repetida del cambio llega duplicada en el Excel: N registros sin duración» en lugar del aviso genérico de huecos. No se reconstruye ni se reparte la hora perdida |

Salida `calidad`: `{ duracionDia: 23|24|25, cobertura: Σ horas válidas, huecos: [{desde, hasta}],
rolesDisponibles, duplicadosHoraRepetida }`.

**B. Definiciones**

- **Racha sostenida:** registros consecutivos que cumplen la condición, sin hueco entre
  ellos, con al menos 15 min de duración (`Σ horas ≥ 0,25`).
- **«Primero» confirmable** (`arranque`, `cubre`, `carga`, `vertido`, `llena`): la racha
  tiene que estar precedida por un registro válido del mismo día en el que la condición era
  falsa, **sin hueco** entre ambos. Si no, no se puede saber si empezó antes y el momento
  no se declara.
- **«Último» confirmable** (`deja`, `fin`): igual, pero con un registro posterior.
- **Picos:** se calculan sobre lo registrado. Si el día tiene huecos, el detalle añade «El
  día tiene 1 h 40 min sin datos».

**C. Catálogo**

| Tipo | Regla | Título | Detalle (ejemplo) | Necesita |
|---|---|---|---|---|
| `arranque` | Primera racha confirmable con producción ≥ 50 W | Empieza la producción | «A las 07:55 los paneles pasan de 50 W.» | `produccion` |
| `cubre` | Primera racha confirmable con producción ≥ consumo y producción ≥ 50 W | El sol ya cubre la casa | «Producción 0,82 kW, consumo 0,61 kW.» | `produccion`, `consumo`, `importada` |
| `carga` | Primera racha confirmable con carga ≥ 100 W | La batería empieza a cargar | «Estaba al 34 %.», solo si `soc` está disponible | `carga` |
| `llena` | Primer registro con SoC ≥ 98 %, confirmable | La batería se llena | «Al 99 % a las 14:05» (el SoC registrado). Se añade «Desde aquí, lo que sobra va a la red» **solo** si empieza una racha de vertido en los 15 min siguientes sin hueco | `soc` (+`exportada`) |
| `maximoBateria` | Si nunca llega al 98 %: el registro del SoC máximo del día | La batería llega a su máximo: 87 % | «Máximo registrado» si hay huecos | `soc` |
| `vertido` | Primera racha confirmable con vertido ≥ 100 W | Empiezas a verter a la red | «Hoy vertiste 6,3 kWh registrados.» | `exportada` |
| `picoProduccion` | Máximo de potencia de producción (registros con potencia conocida) | Pico de producción: 3,42 kW | «A las 13:40.» | `produccion` |
| `picoConsumo` | Máximo de potencia de consumo, si ≥ 1 000 W | Pico de consumo: 2,31 kW | Con reparto disponible: «72 % lo puso el sol, 28 % la batería y 0 % la red» (cada porcentaje sobre el consumo de ese registro, redondeado por separado; si no suman 100, se muestran tal cual) | `consumo`, `produccion`, `importada` |
| `deja` | Última transición confirmable, después del pico de producción, de una racha con producción ≥ consumo a una racha con producción < consumo | El sol deja de cubrir la casa | Nombra lo que cubre el hueco en la racha siguiente: «Desde aquí tira de la batería» (descarga ≥ 100 W sostenida) o «…y entra la red» (compra ≥ 100 W sostenida). Si ninguna se confirma, sin frase | `produccion`, `consumo`, `importada` |
| `fin` | Última racha confirmable con producción ≥ 50 W, en su último registro | Termina la producción | «Los paneles dieron 18,4 kWh registrados.» | `produccion` |
| `compra` | Tramos de compra ≥ 100 W: se unen pausas < 15 min, nunca a través de un hueco; el tramo suma ≥ 15 min por encima del umbral. Se quedan los 3 de más kWh con ≥ 0,1 kWh | Compras a la red | «0,84 kWh de 21:10 a 22:40, sobre todo en punta (P1).» Periodo con más kWh según `periodoTarifa(instante, festivos)`; en empate, el primero | `importada` |
| `minimoBateria` | Después de `fin`: el registro con el SoC mínimo, si en los 30 min siguientes, sin hueco, empieza una racha de compra | La batería toca su mínimo y entra la red | «Al 12 % a las 02:15.» No se habla de «reserva»: el ajuste de reserva no está en los datos del día | `soc`, `importada` |
| `resumen` | Siempre, en el último registro | El día en cifras | Producido, consumido, comprado y vertido (`resumenPorDia`, solo lo registrado) y autoconsumo %. Si la cobertura es menor que la duración del día: «Datos de 22 h 35 min de 24 h» | — |

**D. Composición**

- Dos momentos en el mismo registro se funden en un paso (títulos unidos con « · »).
- Máximo 10 pasos. Si sobran, se descartan por este orden de prioridad (de menor a mayor):
  `carga`, `vertido`, `deja`, `arranque`, `fin`, `cubre`, `compra`, `picoConsumo`,
  `picoProduccion`, `maximoBateria`, `llena`, `minimoBateria`, `resumen`.
- Con **menos de 3 momentos** no hay relato (por ejemplo, un día sin producción o con
  datos insuficientes): se ve la vista compacta con un aviso de por qué.
- Cada cifra de un momento es una `Cifra` con `ruta` a `registros[indice]` (o a la suma
  de un tramo). Se comprueba contra los registros (criterio 15), no contra el texto.

#### 5.5.2 Mecánica

```html
<section id="relato" class="relato">
  <div class="relato-escenario">   <!-- position: sticky -->
    cabecera: ‹ #selectorDia ›  · reloj del relato (Mono) · ‹ ›  (momento anterior/siguiente)
    #leyendaDia
    <canvas id="graficaDia">        (alto)
    <canvas id="graficaBateria">    (64 px, mismo eje x, si hay SoC)
  </div>
  <ol class="relato-pasos">
    <li class="paso" data-indice="…" tabindex="-1"> hora · título · detalle · cifras </li> …
  </ol>
</section>
```

- **Escenario fijo:** `position: sticky`, `top: 0` en móvil (las pestañas están abajo) y
  `top: var(--alto-pestanas)` en escritorio. En móvil ocupa
  `clamp(220px, 40svh, 300px)` y los pasos pasan por debajo. En ≥ 960 px va en dos
  columnas: escenario a la izquierda (7/12, alto `min(70svh, 560px)`) y pasos a la derecha.
- **Paso activo:** `IntersectionObserver` con `rootMargin: "-45% 0px -45% 0px"`; el paso
  que cruza la franja central recibe `aria-current="step"` y llama a
  `grafica.marcar(indice)` (o `marcar({desde, hasta})` en tramos de compra). El reloj del
  relato muestra su hora. **Se repinta el canvas al cambiar de paso, nunca en cada frame
  de scroll** (agrupado con `requestAnimationFrame`).
- **Marcas en el eje:** `areaApilada` dibuja un trazo de 6 px bajo el eje x en cada momento.
  El activo en `--sol`, el resto en `--escala`.
- **Scroll libre:** sin `preventDefault` en `wheel`/`touchmove`, sin `scroll-snap`
  obligatorio y sin desplazamiento suavizado por JS. Los pasos miden
  `min-height: 55svh` en móvil y `70svh` en escritorio; el último, `min-height: 40svh`
  para no dejar un hueco al final.
- **Puntero:** al pasar por el canvas, el cursor sigue al dedo o al ratón (el globo de
  siempre). Al salir, vuelve al paso activo.
- **Teclado:** los botones ‹ › del escenario llevan al paso anterior o siguiente
  (`scrollIntoView({ block: "center" })`, `behavior: "smooth"` salvo con movimiento
  reducido) y le dan foco. Hay un enlace «Saltar el relato» a «Balance por días».
- **Revelado:** dentro de `@media (prefers-reduced-motion: no-preference)` y
  `@supports (animation-timeline: view())`: cada paso aparece con
  `opacity .4 → 1` y `translateY(12px) → 0` en `animation-range: entry 0% entry 40%`. Sin
  soporte: los pasos se ven enteros desde el principio y el activo se distingue por
  `aria-current` (filete izquierdo `--sol` y título a `--texto`; los demás a `--texto-2`).
- **Vista compacta** (conmutador «Relato | Compacta», recordado en `localStorage`): el
  diseño de hoy (gráfica y batería sin fijar), con marcas de momentos en el eje y la lista
  de momentos como tabla de dos columnas debajo. Por D4, la vista por defecto es Relato y la
  elección se recuerda en `solar-monitor-vista-dia`.
- Al cambiar de día se recalculan los momentos y se vuelve al principio del relato.

#### 5.5.3 Wireframes

Móvil (375 px):

```
┌─────────────────────────────────────────────┐ ← sticky top 0
│ ‹ [ sáb 14 jun ▾ ] ›           13:40   ‹  › │  día · reloj del relato · momento ant./sig.
│ ■ Sol→casa ■ Batería→casa ■ Red→casa ┄ Prod.│
│ kW                     ┄┄┄                  │
│ 3 ┤                ┄┄┄▓▓▓┄┄                 │
│ 2 ┤            ┄┄▓▓▓▓▓▓▓▓▓▓▓┄               │  gráfica: cursor │ en el paso activo
│ 1 ┤ ░░      ▓▓▓▓▓▓▓▓▓▓│▓▓▓▓▓▓▓▓▓    ░░▒▒    │
│ 0 ┼──┬────┬────┬────┬─┴──┬────┬────┬────┬──  │
│   00 ╵  04   08 ╵  12 ▲  16 ╵  20   24 ╵     │  ▲ momento activo · ╵ demás momentos
│ SoC ▁▁▁▁▂▃▅▇██████████▇▆▅▄▃▂▁                │  batería 64 px
└─────────────────────────────────────────────┘
   07:55  Empieza la producción                   paso (opacidad .4, aún no activo)
          A las 07:55 los paneles pasan de 50 W.

▌  13:40  Pico de producción: 3,42 kW             paso activo: filete --sol
▌         A las 13:40.

   14:05  La batería se llena
          Desde aquí, lo que sobra va a la red.
   …
   23:55  El día en cifras
          18,4 kWh producidos · 9,7 consumidos · 1,2 comprados · 6,3 vertidos · 88 % autoconsumo
───────────────────────────────────────────────
Balance por días · Cuándo compras a la red · Tu instalación contra el contador  (sin cambios de mecánica)
│  ◇ Ahora   ◇ Datos   ◇ ¿Cuadra?   ◇ Meses   ◇ Día │
```

Escritorio (1440 px):

```
┌ pestañas (sticky) ─────────────────────────────────────────────────────────────────┐
├──────────────────────────────────────────────────────┬─────────────────────────────┤
│ ‹ [ sáb 14 jun ▾ ] ›     13:40     ‹ ›   Relato|Compacta │                             │
│ leyenda                                              │  07:55  Empieza la producción│
│ ┌──────────────────────────────────────────────────┐ │                             │
│ │ gráfica de área apilada (sticky, 70svh)          │ │▌ 13:40  Pico de producción  │
│ │                  │ cursor                        │ │▌        3,42 kW             │
│ └──────────────────────────────────────────────────┘ │                             │
│ SoC ▁▂▃▅▇█████▇▅▃▂▁                                   │  14:05  La batería se llena │
│ (7/12)                                               │  (5/12, pasos de 70svh)      │
└──────────────────────────────────────────────────────┴─────────────────────────────┘
```

#### 5.5.4 Resto de la pestaña

«Balance por días», «Cuándo compras a la red» y «Tu instalación contra el contador»
conservan su mecánica, con la paleta y tipografía nuevas y cabeceras de sección. El mapa
de calor usa `--coral`.

---

## 6. Responsive, movimiento reducido, contraste y teclado

### 6.1 Puntos de corte

| Ancho | Navegación | Ahora | Día a día | Tablas |
|---|---|---|---|---|
| < 620 px | Barra inferior fija (la de hoy) con icono + rótulo y `safe-area` | Una columna, arco a todo el ancho | Escenario arriba (`40svh`), pasos debajo | Desplazamiento horizontal con la primera columna fija |
| 620–959 px | Pestañas arriba, fijas | Una columna, `max-width: 45rem` | Escenario arriba (`45svh`) | Igual |
| ≥ 960 px | Pestañas arriba | Dos columnas (7/5) | Dos columnas (7/5) | Ancho completo |

- Se usan `svh`/`dvh`, nunca `100vh`. El relleno inferior de `main` en móvil sigue
  reservando la barra (`88px + env(safe-area-inset-bottom)`).
- El arco escala con el ancho (`width: 100%` del SVG, alto automático por el `viewBox`). A
  320 px de ancho, un rayo de 6 u mide ≈ 4,8 px: no hace falta una regla aparte.

### 6.2 Movimiento reducido (`prefers-reduced-motion: reduce`)

**Reglas de implementación**
- Toda animación y transición de CSS se declara dentro de
  `@media (prefers-reduced-motion: no-preference)`: el movimiento se activa, no se desactiva.
- El JS consulta `matchMedia("(prefers-reduced-motion: reduce)").matches` **en el momento de
  animar**, no una vez al cargar. Al recibir `change`, termina en su estado final cualquier
  animación en curso.
- Ninguna información depende de que termine una animación: nada empieza oculto esperando
  un `animationend`.
- **Arco:** estado final en el primer pintado y marcador colocado directamente.
- **Relato:** sin revelado; `.paso` con `opacity: 1` y `transform: none`;
  `scrollIntoView({ behavior: "auto" })`; el paso activo se marca solo con color y filete.
- **Hover y pulsado:** solo cambio de color, sin `transform`.
- El escenario sigue fijo: fijar no es movimiento.

**Comprobación.** En Chromium se emula `reduce`. Cada prueba lleva un control con
`no-preference` que tiene que fallar, para demostrar que la prueba no da verde porque sí.
Ninguna se ha ejecutado.

| # | Prueba | Pasa con `reduce` | Control con `no-preference` |
|---|---|---|---|
| V1 | Captura de la zona del arco en el primer frame tras `pintarArco()` y a los 1 000 ms | Diferencia de píxeles = 0 | Diferencia > 0 |
| V2 | `transform` calculado del marcador en el primer frame | Igual al valor final; `transition-duration` = `0s` | Distinto del final |
| V3 | Cada `.paso` en 3 posiciones de scroll | `opacity` 1, `transform` `none`, `animation-name` `none` | Algún paso con opacidad < 1 |
| V4 | Clic en ‹ › del relato | El paso de destino queda centrado (±2 px) en el siguiente `requestAnimationFrame` | Necesita más de un frame |
| V5 | `.btn`, `.chip` y filas del histórico | `transition-duration` = `0s`; pulsado sin `transform` | — |
| V6 | Activar `reduce` a mitad de sesión, sin recargar, y cambiar de aparato | El cuenco cambia sin fundido | — |
| V7 | `document.getAnimations()` tras pintar *Ahora* y al recorrer el relato | Ninguna en estado `running`. Es auxiliar: no basta por sí sola | — |
| V8 | El dueño, en iPhone con «Reducir movimiento» activado | Nada se mueve salvo su propio scroll. Se informa como valoración visual | — |

### 6.3 Contraste

- Ratios del §1.3.
- `prefers-contrast: more`: el texto secundario pasa a `--texto`, los filetes a `--escala`,
  sin rellenos translúcidos y rayos con contorno de 1 px.
- `forced-colors: active`: el SVG usa `currentColor`/`CanvasText`. El canvas no se adapta,
  así que la tabla «Ver por horas» y la tabla de momentos son la alternativa.

### 6.4 Teclado y lector de pantalla

- Se mantienen el `tablist` con flechas, `aria-selected`, `tabindex` gestionado, el
  diálogo nativo y el `radiogroup` de aparatos (con flechas izquierda/derecha nuevas).
- Orden de foco en *Ahora*: ajustes → pestañas → «Ver por horas» → aparatos → Mejor
  momento → ¿Por qué? → Ajustes del asesor.
- El relato es una `<ol>`; cada paso, un `<li>` con su hora en `<time>`.

---

## 7. Rendimiento

### 7.1 Presupuesto de transferencia

> **Enmienda rev. 4 (§12.1):** el límite de 170 000 B y los límites por fase **quedan sin efecto**. M1 y M2 se siguen midiendo en cada fase y se informan; no bloquean la publicación. El criterio 31 pasa a ser informativo.

**Hoy no hay línea base medida.** Todas las cifras de esta sección son límites o
estimaciones, salvo el tamaño de las fuentes, que es el de los ficheros.

**Límite:** el peso añadido acumulado (de F1 a F4, respecto a la línea base) no supera
**170 000 B de cuerpo** en M1 ni en M2. Se mide el cuerpo de la respuesta, no las cabeceras.

| Medida | Qué cuenta | Límite |
|---|---|---|
| **M1 · Primera visita** | Suma de `encodedBodySize` de las entradas `navigation` y `resource` de mismo origen al abrir `#ahora` con caché y service worker borrados, 5 s después de `load`. La suma de `transferSize` (con cabeceras) se anota aparte, solo como información | M1(nueva) − M1(base) ≤ 170 000 B |
| **M2 · Instalación del SW** | Suma de los cuerpos de cada entrada de `BASE` tal como los sirve Pages. **`BASE` incluye `./` y `./index.html`, así que lo que crezca el HTML cuenta dos veces** | M2(nueva) − M2(base) ≤ 170 000 B |

**Reparto del margen.** Los cuatro `.woff2` ocupan 147 952 B (tamaño de los ficheros,
comprobado). Para todo lo demás quedan **22 048 B** en total para las cuatro fases:

| Fase | Límite sin contar las fuentes |
|---|---|
| F1: CSS, sprite, `iconos.js` y cambios de HTML | ≤ 10 000 B |
| F2: `arco.js` y HTML de *Ahora* | ≤ 5 000 B |
| F3: `relato.js` y `relato-vista.js` | ≤ 5 000 B |
| F4 | ≤ 2 048 B |

En M1, que la primera pantalla descargue o no los subconjuntos Pi depende de los glifos que
use. No se sabe hasta implementar F1.

**Línea base:** M1 y M2 de la versión publicada antes de F1, con el método del §7.2. Se
anotan las cifras, la fecha y el commit. Es el primer paso de F1.

**Protocolo de publicación:**
1. **Estimación local antes de publicar:** `.woff2` en bytes de disco y ficheros de texto con
   `gzip -6 -c | wc -c`. Se declara como estimación.
2. Si la estimación supera el límite de la fase, se aplica la contingencia de abajo antes
   de publicar.
3. **Medida en Pages después de publicar.** Es la que cuenta. Si se supera el límite, se
   revierte el commit publicado (`git revert`) y se pasa a la contingencia.

**Contingencia.** Se aplica **solo si una medida demuestra** que no se cumple el límite, y
se vuelve a medir tras cada paso:
1. Quitar del código nuevo lo que no se use: símbolos del sprite sin uso, CSS muerto.
2. **Quitar los subconjuntos Pi**: sus `@font-face`, sus entradas de `BASE` y sus ficheros.
   Son 46 388 B menos en M2, y en M1 si la página los descargaba.
   - **No es una decisión tomada:** solo se aplica si el paso 1 no basta.
   - Antes de aplicarla se **documenta el impacto visual**:
     - inventario de los caracteres del rango Pi que aparecen en el DOM de las cinco
       pestañas con datos de demo;
     - capturas antes/después de cada sitio donde aparecen (se espera `≈` en costes y
       energías y `→` en ventanas, pero lo confirma el inventario).
   - Con la contingencia, esos glifos se ven con la fuente del sistema, sin pérdida funcional.
   - Los textos del asesor **no se cambian** para evitar esos glifos (R1).
3. Si aún no cabe, la fase **no se publica**: se presentan las cifras medidas y el dueño
   decide si cambia el presupuesto o el alcance visual.

### 7.2 Cómo se mide

Nada de esto se ha ejecutado todavía.

- **M1**, en Chrome con DevTools → Application → *Clear site data*, recarga de `#ahora`,
  sin limitación de red (cuenta bytes, no tiempo). En consola, tras 5 s:
  ```js
  [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource")]
    .filter((e) => new URL(e.name).origin === location.origin)
    .reduce((s, e) => s + e.encodedBodySize, 0)
  ```
  Se anota también la suma de `transferSize`, solo como información.
- **M2**, para cada entrada de `BASE` (se lee de `sw.js`), con la URL publicada, incluidas
  `./` y `./index.html`, que cuentan dos veces:
  `curl -s -H 'Accept-Encoding: br, gzip' -o /dev/null -w '%{size_download}\n' <url>`, y se
  suman. Se hace con la versión base y con la nueva, en la misma sesión.
- **CLS** al cargar *Ahora* (caché vacía, Chrome, red «Fast 4G», CPU 4×):
  `PerformanceObserver` de `layout-shift` con `buffered: true`, sumando `value` de las
  entradas sin `hadRecentInput` durante 5 s. Se mide también en la línea base.
- **Tareas largas en el relato: protocolo**
  1. **Instrumentación (solo código nuevo):** `performance.measure` con los nombres
     `relato:momentos` (`detectarMomentos`), `relato:montaje` (primer pintado del relato),
     `relato:paso` (cambio de paso: `marcar()` y repintado) y `arco:pintar`.
  2. **Entorno:**
     - Chrome estable (se anota la versión), perfil nuevo (`--user-data-dir` temporal) y
       sin extensiones (`--disable-extensions`).
     - Servidor local (`python3 -m http.server`) con la base y la nueva versión en puertos
       distintos.
     - Peticiones a Open-Meteo, REE, `workers.dev` y datadis bloqueadas en DevTools.
     - Datos de `localStorage` iguales a los de R1, con `demo.xlsx` cargado.
  3. **Preparación:** abrir `#dia`, elegir el día fijado y esperar a `document.fonts.ready`
     más 2 s sin actividad.
  4. **Ejecución:**
     - CPU 4×, grabación del panel Rendimiento.
     - Un bucle con `requestAnimationFrame` desplaza el documento de forma lineal desde el
       inicio de `#relato` hasta su final en exactamente 10 s.
     - Se hace a 1440 × 900 y a 375 × 812 (DPR 3), 5 pasadas por tamaño y recargando entre
       pasadas.
  5. **Atribución:** cada tarea > 50 ms del hilo principal se clasifica como **«código
     nuevo»** si en su árbol de llamadas hay funciones de `js/arco.js`, `js/relato*.js`,
     `js/iconos.js` o de las funciones modificadas de `js/graficas.js`, o si se solapa con una
     de las medidas del paso 1. Si no, es **«entorno»** (GC sin frames nuestros, trabajo del
     navegador no provocado por nuestro código).
  6. **Ruido del entorno:** el mismo protocolo sobre la versión base (*Día a día* estático)
     da la cifra de tareas de entorno.
  7. **Safari:** no tiene la API. El dueño lo valora a ojo en iPhone y se informa como
     valoración visual.
- **Coste de pintar el arco:** mediana de `arco:pintar` en 20 repintados con CPU 4×. El
  objetivo es ≤ 16 ms.

### 7.3 Medidas de diseño que lo favorecen

- El arco dibuja como máximo 4 trazos por franja de la ventana (contorno y relleno,
  exteriores e interiores), más la pista, las marcas y el marcador. El número real de nodos
  se informa en F2; no se ha medido.
- El relato repinta el canvas solo al cambiar de paso, nunca en cada frame de scroll.
- Los canvas se repintan tras `document.fonts.ready` la primera vez.
- `ResizeObserver` en el escenario del relato en vez de `window.resize`.

---

## 8. Cambios técnicos

### 8.1 Fases (cada una se puede publicar sola)

| Fase | Contenido | Resultado visible |
|---|---|---|
| **F1 Fundamentos** | Tokens, fuentes, sprite e iconos, restilo de todas las pestañas sin cambiar la estructura, colores de `graficas.js` desde tokens, manifiesto y licencias (§2.2, §3.5). **Empieza midiendo la línea base** (M1, M2, CLS y R1, R2, R4, R5 a)–d) y R6; R7 se fija en F2 antes de D3) | Desaparecen GitHub Dark, emojis y morados |
| **F2 Ahora** | `arco.js`, nueva composición de *Ahora*, indicador de batería | El instrumento |
| **F3 Día a día** | `relato.js`, `relato-vista.js`, API de cursor en `graficas.js` | El relato del día |
| **F4 Pulido** | Lectura de *¿Cuadra?*, barra de desvío, libro de *Mes a mes*, icono de la app (D5), repaso de criterios | Coherencia completa |

### 8.2 Ficheros

| Fichero | Cambio |
|---|---|
| `index.html` | `preload` de fuentes, sprite en línea, iconos de pestañas, estructura de *Ahora* (`figure` del arco, lecturas, batería) y *Día a día* (`#relato`). **Se conservan todos los ids actuales** |
| `styles.css` | Reescrito sobre tokens (§1–3). Se corrigen de paso `.crudo` duplicado y `var(--tenue)` inexistente |
| `js/graficas.js` | Colores leídos de CSS (`getComputedStyle`) con respaldo constante. Relleno con `globalAlpha` en vez de concatenar `"cc"` al hex. Fuente Mono. `areaApilada` y `lineaSimple` **devuelven** `{ marcar(indice \| {desde, hasta} \| null) }` (hoy no devuelven nada: compatible). Nueva opción `marcas: [{indice, activa}]` |
| `js/arco.js` (nuevo) | `modeloArco()` (puro, sin DOM) + `pintarArco(figure, modelo)` |
| `js/relato.js` (nuevo) | `detectarMomentos()` (puro) |
| `js/relato-vista.js` (nuevo) | Escenario, pasos, `IntersectionObserver`, conmutador. `app.js` solo cambia `pintarDia()` para delegar |
| `js/iconos.js` (nuevo) | `icono(nombre)`, `ICONO_APARATO` por `id`, `ICONO_RAZON` por emoji en F1 y por `tipo` desde F2 solo si se aplica D3, `fuente(tipo)` para las etiquetas de procedencia |
| `js/ahora.js` | Añade a `contexto` `horasPorFuente` y `previsionTraida` (`contexto.horas`, la lista combinada que usa el asesor, no cambia); exporta `juntarHoras` sin cambiar su comportamiento, para la prueba de equivalencia; llama a `simular()` una vez más para el arco; sustituye los emojis de `#cifrasVivo`, `#avisoReserva`, la tabla de aparatos y las razones por iconos; pinta el arco y la batería. **No cambia ninguna entrada de `decidir`, `lineaDelDia`, `reservaRecomendada` ni `construirHorizonte`** (§8.5) |
| `js/app.js` | Las etiquetas de procedencia se generan con `fuente()`; `ficha()` pasa a Lectura; `⚠️` → `i-aviso`; `pintarDia()` delega en el relato |
| `js/asesor/motor.js` | **Condicional (D3):** añadir `tipo` a cada razón (`"sol"`, `"casa"`, `"bateria"`, `"euro"`, `"reloj"`, `"prevision"`, `"potencia"`, `"senal"`, `"rumbo"`, `"red"`) **solo** si R7 está construida y en verde sobre el código actual. Cambio aditivo: `icono` se queda |
| `js/asesor/aparatos.js` | Sin cambios: el campo `icono` deja de usarse en la interfaz |
| `vendor/fuentes/*` (nuevo) | 4 `.woff2` y `license.txt`, copiados byte a byte con su nombre oficial (§2.2) |
| `vendor/phosphor/*` (nuevo) | `LICENSE` íntegro del commit de origen y `ORIGEN.txt` (§3.5). No entran en `BASE` |
| `sw.js` | Solo dos cosas: añadir a `BASE` los 4 `.woff2` (rutas con `%20`), `arco.js`, `relato.js`, `relato-vista.js` e `iconos.js`, y subir `CACHE` (`v39` y siguientes en cada fase). **No se tocan los manejadores `install`, `activate` ni `fetch`** |
| `manifest.webmanifest` | `background_color` y `theme_color` a `#14110E` |
| `assets/icono.svg` | D5: nuevo icono (arco + rayos sobre `--fondo`, sin el azul `#5b8def`) |
| `README.md` | Fuentes y licencias (IBM Plex y Phosphor); enlace a esta especificación |

### 8.3 Riesgos

| Riesgo | Mitigación |
|---|---|
| Olvidar un fichero en `BASE` o cambiar sin querer el comportamiento del SW rompe el uso sin conexión | `test/sw.test.js` (comportamiento y recursos, §8.4) y R5 |
| Los colores de canvas hoy se concatenan con `"cc"` (exigen hex de 6 dígitos) | Pasar a `globalAlpha`; el lector de tokens normaliza a hex |
| Canvas pintado antes de cargar Plex Mono | Repintar tras `document.fonts.ready` |
| Salto de maquetación al cargar las fuentes | `font-display: swap` + `size-adjust` en el respaldo; criterio CLS |
| Plex Sans Var: la etiqueta de publicación es 0.2.0 aunque la versión interna sea 3.000 | Capturas en F1 en Safari iOS, Chrome y Firefox; plan B estático (§2.2) |
| `sticky` + barra inferior + barras dinámicas de Safari iOS | `svh`, prueba en iPhone real |
| `app.js` (1 400 líneas, 21 `innerHTML`) | No se reorganiza: solo se tocan las funciones citadas y el relato vive en módulo propio |
| El relato parpadea con pasos cortos | Franja central del 10 %, `min-height` de los pasos y repintado agrupado con `rAF` |
| Emojis que vienen de módulos probados (`motor.js`, `aparatos.js`) | La interfaz no los muestra: los traduce a iconos SVG por `id` (aparatos) y por emoji en F1 o `tipo` con D3 (razones). Las pruebas actuales no comprueban `icono` |
| La muesca «llena» futura depende del simulador | Se rotula «≈ … · SIMULADO» y solo aparece dentro de la ventana |
| Se muestre el 50 % por defecto del asesor como si fuera un dato | Regla del §4.3.4 y prueba en `arco.test.js` |
| Cambios de presentación en `app.js` que alteren cifras del cotejo o del histórico | Regresión R2 (§8.5) |
| Margen de 22 048 B para todo lo que no son fuentes, con el HTML contado dos veces en M2 | Límites por fase y contingencia medida del §7.1 |
| Hora repetida en datos locales (limitación de `datos.js` y `habitos.js`, protegidos) | Aceptada temporalmente: sin reparto, con la incertidumbre visible (§4.3.1) |
| Que falte el aviso o la licencia de Phosphor | `test/licencias.test.js` (§8.4) |

### 8.4 Pruebas

**Ninguna de estas pruebas existe todavía ni se ha ejecutado.** Se escriben en la fase que
las necesita y, cuando corrigen o protegen algo, se comprueba que fallan sin el cambio.

- **Existentes:** `node --test 'test/*.test.js'` en verde en cada fase, **sin modificar
  ninguna**.
- **Nuevas, unitarias (Node, sin DOM y sin dependencias):**
  - `test/sw.test.js` (F1): prueba de **comportamiento**, sin comparar texto.
    - **Cómo:** carga `sw.js` en `node:vm` con un `self` simulado y con dobles de `caches`,
      `fetch`, `skipWaiting` y `clients.claim`; usa `Request`, `Response` y `URL` nativos de
      Node. Recoge los manejadores registrados y simula los eventos.
    - **`install`:** abre la caché `CACHE`; `addAll` recibe un `Request` por cada entrada de
      `BASE`, todas con `cache: "reload"`; llama a `skipWaiting` después de `addAll`, todo
      dentro de `waitUntil`.
    - **`activate`:** borra toda caché distinta de `CACHE`, conserva `CACHE` y llama a
      `clients.claim()` dentro de `waitUntil`.
    - **`fetch`:**
      - las peticiones que no son `GET` y las de otro origen no llaman a `respondWith`;
      - mismo origen bajo `/vendor/`: devuelve lo guardado sin llamar a `fetch` y, si no hay
        nada guardado, llama a `fetch`;
      - resto del mismo origen: `fetch` con `cache: "no-store"`, guarda en `CACHE` la
        respuesta `ok` y, si la red falla, devuelve lo guardado o `./index.html`.
    - **Validación de la propia prueba:** antes de tocar `sw.js` tiene que pasar sobre el
      `sw.js` actual. `CACHE` y `BASE` pueden cambiar; el comportamiento, no.
    - **Recursos estáticos:**
      - cada entrada de `BASE` existe en disco (con `decodeURIComponent`);
      - no hay duplicados, salvo `./` y `./index.html`, que son intencionados;
      - todo `import` relativo alcanzable desde `js/app.js` y `js/ahora.js` está en `BASE`,
        comparando con `new URL(x, base).href`;
      - toda URL de mismo origen de `index.html` (`href`, `src`, `preload`) y de
        `styles.css` (`url()`) apunta a una entrada de `BASE` con la misma URL normalizada
        (las rutas con espacios quedan `%20` en los dos lados).
    - **Recursos dinámicos:** se documenta y se prueba que Open-Meteo, REE, los Workers y
      datadis son de otro origen y que el SW no los intercepta.
    - **Riesgo del caché permanente:** las fuentes van por caché primero y nunca se
      refrescan. Si alguna vez se cambia un `.woff2` (por ejemplo, el plan B del §2.2), tiene
      que ir con un **nombre de fichero nuevo**.
  - `test/tokens.test.js` (F1):
    - `styles.css` no tiene colores fuera de `:root`, salvo los derivados del §1.2 bis;
    - el respaldo de `graficas.js`, `manifest.webmanifest` y `assets/icono.svg` usan
      exactamente hex de `:root`;
    - no hay tonos entre 250° y 320°.
  - `test/fuentes.test.js` (F1): el SHA-256 de cada `.woff2` de `vendor/fuentes/` coincide con
    el anotado al copiarlo del commit `71f558992315a12ca1f06a2215d57962a1992162`, y `license.txt` es idéntico al oficial.
  - `test/licencias.test.js` (F1):
    - `vendor/phosphor/LICENSE` coincide con el SHA-256 anotado del `LICENSE` original;
    - `vendor/phosphor/ORIGEN.txt` contiene el SHA completo del commit y una línea por cada
      símbolo de origen Phosphor del sprite, ni más ni menos;
    - el sprite empieza con el comentario de copyright del §3.5;
    - `README.md` cita IBM Plex y Phosphor con sus licencias.
  - `test/arco.test.js` (F2):
    - **Geometría:** con la ventana 08:00–20:00, θ(08:00) = 180°, θ(08:30) = 172,5°,
      θ(12:00) = 120°, θ(14:00) = 90° y θ(20:00) = 0°, con |error| < 1e-9. Puntos (50, 200),
      (125, 70,10), (200, 50) y (350, 200), con |error| < 1e-6. Antes de `desde` y después de
      `hasta`, `posicion` vale `antes`/`despues` y `angulo` es `null`.
    - **Cambio horario.** El fichero fija `process.env.TZ = "Europe/Madrid"` antes de crear
      fechas; `node --test` ejecuta cada fichero en un proceso aparte, así que no afecta a los
      demás.
      - 29-mar-2026: 23 franjas y ninguna con rótulo 02.
      - 25-oct-2026: 25 franjas, con dos 02 h distinguidas por UTC+2 y UTC+1.
      - Una entrada del Worker de la segunda 02 h va a la segunda franja.
      - Una entrada local ambigua produce `nota: "hora-repetida-local"` y no se reparte.
      - Σ de las franjas = Σ de las entradas del día.
      - La precedencia por clave coincide con `juntarHoras`.
    - **Clases de datos:** con previsión, `tipico` es `null` en todas las franjas. Sin
      previsión y con hábito, se usa `tipico`. Sin nada, estado `sin-sol`.
    - **Medido:**
      - una franja pasada sin entrada da `real = null`, no genera cifra y no cuenta como 0;
      - estados `completa`, `parcial` y `en-curso` según cobertura y hora;
      - una entrada con `inicio` futuro se ignora;
      - una parcial no se extrapola;
      - varias entradas de una procedencia en una franja se suman.
    - **Casa:** `casaTipica` solo en franjas futuras o en curso; nunca en pasadas sin dato.
    - **Escala:** con calibración (`maxKwh`), sin calibración (máximo del día, leyenda
      `escala-dia`) y con 0 (sin rayos).
    - **Previsión:** `origen = "estimado"` da estado `sin-calibrar`; la caché con fallo da la
      leyenda `sin-conexion`.
    - **Batería:**
      - los cuatro orígenes del SoC, y con «ninguno» `soc` es `null` (no 50);
      - la muesca pasada va en el fin de la franja;
      - la muesca futura solo aparece sin pasada y dentro de la ventana;
      - sin origen de SoC, no hay muesca futura.
    - **Estados:** el orden de prioridad del §4.5 con una entrada por estado, incluido
      `mañana` (D1) y `sin-sol` para mañana.
    - **Trazabilidad:** las 8 reglas de coherencia del §4.3.6 en un fixture por estado.
    - **Pureza:** la entrada se congela con `Object.freeze` y no se modifica.
  - `test/relato.test.js` (F3), con series sintéticas de 5 min:
    - Un caso por momento del catálogo, con W y con kWh.
    - Unidad desconocida en un rol: desaparecen sus momentos y el resto sigue.
    - Registro con `horas` 0, `null` y `NaN`: no alarga rachas; en W cuenta para picos, en
      kWh no.
    - Instantes duplicados.
    - Hueco de 1 h:
      - corta la racha;
      - no une tramos de compra;
      - un «primero» justo después del hueco no se declara;
      - el detalle de los picos menciona el hueco.
    - Día que empieza con producción ≥ 50 W (sin registro previo por debajo): no hay
      `arranque`.
    - Batería:
      - SoC 0 tratado como vacío;
      - SoC > 100 inválido;
      - SoC en menos del 90 % de los registros: sin `llena`, `maximoBateria`,
        `minimoBateria` ni «Estaba al N %»;
      - nunca llega al 98 %: `maximoBateria`;
      - sin `carga`/`descarga`: sin `carga` y pico de consumo sin reparto.
    - Consumo sin `importada`: sin `cubre`, `deja` ni `picoConsumo`.
    - Cambio horario, con `TZ=Europe/Madrid`:
      - día de 25 h con instantes duplicados en la 02 h: aviso específico y `duracionDia = 25`;
      - día de 23 h: sin hueco falso entre 01:55 y 03:00.
    - Composición:
      - día sin producción (menos de 3 momentos, sin relato);
      - fusión de momentos en el mismo registro;
      - tope de 10 y prioridad;
      - periodo P1/P2/P3 con festivos y empate.
    - **Trazabilidad:** cada `Cifra` de un momento tiene `ruta` a `registros[indice]` (o a la
      suma de un tramo), y su `valor` es el de esos registros con las reglas de potencia y
      energía del §5.5.1.
    - Pureza: la entrada se congela y no se modifica.
  - `test/motor-tipo.test.js` (F2, solo si se aplica D3): R7 del §8.5.3.
- **En navegador** (herramientas del entorno, sin añadir dependencias al repo): las
  regresiones R1, R2, R4, R5 a)–d) y R6 del §8.5.3; las pruebas V1–V7 del §6.2; capturas de
  las cinco pestañas a 375 × 812, 768 × 1024 y 1440 × 900; recorrido con teclado; estados
  del arco forzando la entrada del modelo.
- **En el teléfono, por el dueño:** R3, R5 e) y V8.

### 8.5 Conservación funcional

#### 8.5.1 Ficheros protegidos

En ninguna fase cambian estos ficheros. Se comprueba en cada fase con
`git diff --stat <commit base>..HEAD -- <lista>`, que debe salir vacío.

| Ficheros | Qué protegen |
|---|---|
| `js/asesor/tarifa.js`, `habitos.js`, `prevision.js`, `simulador.js`, `mercado.js`, `aparatos.js` | Cálculos y previsiones del asesor |
| `js/asesor/motor.js` | Ídem. **Excepción única: D3**, que solo añade el campo `tipo` (R7) |
| `js/datos.js`, `js/xlsx.js`, `js/factura.js`, `js/pdf-worker.js`, `js/flujos.js`, `vendor/pdf*.js` | Lectura del Excel y de la factura, y el cotejo |
| `js/historico.js`, `js/nube.js`, `js/datadis.js` | Histórico, sincronización cifrada, fusión campo a campo y contador |
| `worker/**` | Worker, cron y archivo |
| `test/*.test.js` existentes | Las pruebas actuales siguen intactas |

**Datos guardados:** no cambia el formato ni el contenido de ninguna clave existente
(`solar-monitor-historico`, `-curvas`, `-serie`, `-asesor`, `-vivo`, `-prevision`,
`-calibracion`, `-mercado`, `-nube-url`, `-nube-clave`). Se añade una sola clave nueva,
`solar-monitor-vista-dia` («relato» o «compacta»). Se comprueba buscando `localStorage.setItem`
en el diff: solo puede aparecer esa clave.

#### 8.5.2 Lógica existente que se toca (riesgos que exigen regresión)

| Fase | Fichero y cambio | Riesgo | Regresión obligatoria |
|---|---|---|---|
| F1 | `js/graficas.js`: colores, `globalAlpha` y fuente | Cambie un valor dibujado o del globo | R6 |
| F1, F3, F4 | `js/app.js`: etiquetas de procedencia con `fuente()`, emojis por iconos (F1); `pintarDia()` delega (F3); `ficha()` → Lectura, marcado de `pintarComparacion`, `pintarDetalleMes` y `pintarHistorico` (F4) | Que se pierda o cambie una cifra, una fila o un campo editable del cotejo o del histórico | R2 y R4 |
| F1, F2 | `js/ahora.js`: iconos (F1); `contexto.horasPorFuente`, `contexto.previsionTraida`, exportación de `juntarHoras`, llamada extra a `simular()` y pintado del arco (F2) | Que cambie el veredicto, el coste, las ventanas, la línea de 24 h o la reserva | R1 y la prueba de equivalencia de precedencia (§8.4) |
| F1–F4 | `sw.js`: entradas de `BASE` y `CACHE` | Rotura del uso sin conexión | `test/sw.test.js` y R5 |
| F1–F4 | `index.html`: marcado | Que deje de existir un id del que depende el JS | R1–R4 y comprobación de ids (criterio 27) |
| F2 (D3) | `js/asesor/motor.js`: añadir `tipo` | Alterar el resultado de `decidir()` | R7 y las pruebas de `motor` existentes |

#### 8.5.3 Regresiones

Se capturan **antes de empezar F1**, sobre la versión base, y se repiten al final de cada
fase. Pasan solo si coinciden. **Todavía no se ha capturado ninguna.**

- **R1 · Asesor.** Perfil de navegador limpio, sin nube configurada, para que se usen las
  cachés. Se cargan en `localStorage` las claves `-asesor`, `-vivo`, `-prevision`,
  `-calibracion`, `-mercado` y `-serie` de un estado conocido, y se fija el reloj
  (`page.clock` o equivalente) dentro de la hora de validez de esas cachés.
  - Para cada aparato se guardan: `#tituloSemaforo`, el `aria-label` de `#semaforo`,
    `#costeAhora`, `#proximaVentana`, `#listaVentanas`, los `aria-label` de `#linea`,
    `#pctReserva`, `#textoReserva` y los textos de `#razones`.
  - **Normalización antes de comparar** (los iconos cambian a propósito): se quitan los
    caracteres `\p{Extended_Pictographic}` y los selectores de variante, y se colapsan los
    espacios. Nada más.
  - Pasa si los textos normalizados son idénticos antes y después.
- **R2 · Cotejo e histórico.** Con el mismo `.xlsx`, el mismo PDF y el mismo
  `-historico`/`-curvas`, se extrae la secuencia de números
  (`/-?\d+(?:\.\d{3})*(?:,\d+)?/g`) de `#fichas`, `#tablaFactura`, `#veredicto`,
  `#tablaRevision`, `#lecturas`, `#avisosFactura`, `#tablaHistorico` y `#detalleMes` (cada
  mes).
  - Pasa si las secuencias son iguales y el número de etiquetas `.fuente` por bloque es el
    mismo.
  - Además se edita a mano un valor de `#tablaFactura` y la diferencia resultante tiene que
    ser la misma que en la base.
  - **Es una regresión de igualdad entre base y nueva con las mismas entradas, no una prueba
    de trazabilidad.** La trazabilidad del arco y del relato es estructurada (§4.3.6,
    §5.5.1).
- **R3 · Sincronización.** La hace el dueño, porque usa su Worker y su clave: en un perfil
  nuevo, «Traer de la nube» y comparar `#tablaHistorico` con el aparato principal. No se usa
  «Subir» desde un perfil de prueba.
- **R4 · Lectura de archivos.** Se carga `demo.xlsx` y `factura-demo.pdf` con clic y con
  arrastre. `#estadoDatos`, `#estadoFactura`, `#tablaMapeo` y `#textoFactura` son idénticos
  a la base.
- **R5 · Sin conexión.**
  - **a) Instalación:** perfil nuevo, visita con conexión. Esperar a
    `navigator.serviceWorker.ready` y a que `controller` no sea `null` (recargando una vez si
    hace falta). En DevTools → Cache Storage, la caché `CACHE` tiene exactamente
    `BASE.length` entradas distintas.
  - **b) Sin conexión:** DevTools → *Offline* y recarga. Las cinco pestañas abren. Las
    fuentes cargan (`document.fonts.check` da `true`; en Red aparecen «from ServiceWorker»).
    Se ven los iconos y los datos guardados, y el relato funciona con la serie guardada.
  - **c) Recursos dinámicos sin red:** *Ahora* muestra los últimos datos guardados con sus
    avisos de fallo y la leyenda «sin conexión»; datadis y la sincronización enseñan un
    mensaje de error; nada se rompe.
  - **d) Actualización:**
    1. Perfil con la versión base instalada y controlando la página.
    2. Se sirve la versión nueva y se recarga dos veces con conexión.
    3. La caché antigua desaparece y la nueva está completa.
    4. Se repite b).
  - **e)** El dueño lo comprueba en iPhone, en el navegador y en la PWA instalada.
  - Que Playwright ejecute el SW de esta app **no está comprobado**. a)–d) se hacen en Chrome
    DevTools salvo que antes se demuestre lo contrario.
- **R6 · Gráficas.** Con los mismos datos, el texto del globo en 5 posiciones fijas del
  puntero de cada canvas es idéntico al de la base. Las capturas pueden diferir en el color;
  los valores no.
- **R7 · Motor (condición de D3).**
  1. **Antes de tocar `motor.js`**, se fijan como fixture JSON las salidas actuales de
     `decidir()` para los casos de `test/motor.test.js`, y la prueba pasa sobre el código
     actual.
  2. Después del cambio, `decidir()` sin el campo `tipo` es estructuralmente igual a la
     fixture, y cada razón tiene un `tipo` de la lista del §8.2.

  Si R7 no se puede construir o no pasa, D3 no se aplica y el emoji se sigue mapeando en la
  interfaz.

---

## 9. Criterios de aceptación

Cada criterio se comprueba con un comando, una prueba, una medida o una acción concreta.
**Todos están pendientes: no se ha ejecutado ninguno y no hay línea base medida.** El
informe de cada fase indica, por criterio, si pasa, si falla o si no aplica en esa fase, con
la prueba que lo demuestra. Ningún criterio se da por bueno sin haber ejecutado su
comprobación.

**Identidad (F1)**
1. Ningún color de GitHub Dark (`#0d1117`, `#161b22`, `#1c232c`, `#262d38`, `#e6edf3`,
   `#8b98a9`) en `styles.css`, `index.html`, `js/`, `manifest.webmanifest` ni `assets/`.
   Búsqueda sin distinguir mayúsculas = 0.
2. `test/tokens.test.js` en verde: colores solo como tokens o derivados del §1.2 bis, sin
   `#000`/`#fff`/`black`/`white`/`rgb(`/`rgba(`/`hsl(` fuera de `:root`, copias literales
   iguales a `:root` y ningún tono entre 250° y 320°.
3. Ningún `box-shadow` ni `text-shadow` en `styles.css` (búsqueda = 0).
4. Ningún emoji en el DOM de las cinco pestañas, con datos de demo y el asesor desplegado:
   `/\p{Extended_Pictographic}/u` sobre `document.body.innerText` = 0.
5. `test/fuentes.test.js` en verde. `document.fonts.check('16px "Plex Sans"')` y
   `('16px "Plex Mono"')` dan `true` tras la carga. El `@font-face` de Mono no declara
   `font-stretch`.
6. En *Ahora* y *¿Cuadra?* no hay dos o más cajas hermanas con el mismo borde, fondo y
   tamaño (revisión de capturas).

**Arco (F2)**
7. `test/arco.test.js` en verde, incluida la geometría del §4.3.5: para 08:00–20:00,
   180° / 120° / 90° / 0° a las 08:00 / 12:00 / 14:00 / 20:00.
8. En el DOM, con el reloj fijado a las 12:00 y una ventana 08–20, el marcador lleva
   `rotate(-120 200 200)` (±0,5°); a las 14:00, `rotate(-90 200 200)`.
9. El número de rayos dibujados es igual al de franjas de la ventana, y cada franja pasada
   sin dato se ve como «sin dato» (punto en la base) y como «—» en la tabla, nunca como 0.
10. **Trazabilidad estructurada:**
    - **En Node:** las 8 reglas de coherencia del §4.3.6 pasan en un fixture por estado del
      §4.5.
    - **En el navegador:** cada `[data-cifra]` visible del arco, el cuenco, las lecturas, la
      batería, los extremos, la muesca, la leyenda y `#arcoResumen` tiene en «Ver por horas»
      un elemento con el mismo `data-cifra`, `value`, `data-unidad`, `data-clase`,
      `data-procedencia` y `textContent`.
    - No se extraen números con expresiones regulares.
11. Se pueden forzar y ver los 9 estados del §4.5, cada uno con su texto; `mañana` lleva
    «MAÑANA · PREVISIÓN» y la hora de la previsión.
12. Ningún rótulo dice «amanecer», «ocaso», «elevación» ni «mediodía», y los extremos no
    llevan minutos.
13. Sin dato de batería, el indicador dice «sin dato de batería» y no aparece «50 %».

**Relato (F3)**
14. `test/relato.test.js` en verde, incluidos los casos de calidad de datos y de cambio
    horario del §8.4.
15. Con `demo.xlsx`, para cada paso, cada `[data-cifra]` del paso tiene `value` igual al de
    su `Cifra`, y esa `Cifra` coincide con `registros[indice]` según su `ruta` (prueba de
    Node). En el DOM, `textContent` = `texto`.
16. A 375 px y a 1440 px el escenario queda fijo mientras pasan los pasos y no tapa el
    paso activo (capturas en tres posiciones de scroll).
17. Ningún `preventDefault` en manejadores de `wheel`/`touch*` y ningún
    `scroll-snap-type` con `mandatory` (búsqueda = 0).
18. Forzando que falle `@supports (animation-timeline: view())`, los pasos se ven enteros y
    el activo se distingue.
19. Los botones ‹ › y «Saltar el relato» funcionan solo con teclado.
20. El conmutador «Relato | Compacta» se recuerda al recargar; por defecto es Relato (D4).

**Accesibilidad (todas las fases)**
21. Los pares de color usados para texto son los del §1.3 (≥ 4,5:1) y los gráficos
    informativos usan `--escala` o más (≥ 3:1). Se comprueba con axe y revisando los tokens.
22. Las pruebas V1–V7 del §6.2 pasan con `reduce` y sus controles fallan con
    `no-preference`. V8 la confirma el dueño.
23. Foco visible (2 px `--sol`) en todos los interactivos, en el orden del §6.4.
24. El semáforo y los veredictos se entienden en escala de grises (forma + texto).

**Conservación (todas las fases)**
25. `git diff --stat` de los ficheros protegidos del §8.5.1 = vacío. La única excepción es
    D3 en `motor.js`, y solo con R7 en verde.
26. R1, R2, R4, R5 a)–d) y R6 iguales a la línea base o cumplidas. R3 y R5 e) las confirma
    el dueño. R7 solo si se aplica D3.
27. Todos los ids de `index.html` de la línea base existen en la versión nueva (script que
    compara las dos listas).
28. Las cinco pestañas, la navegación por `#hash`, las flechas del `tablist` y la barra
    inferior por debajo de 620 px (con `safe-area`) funcionan como en la base.
29. En el diff, `localStorage.setItem` solo aparece con la clave nueva
    `solar-monitor-vista-dia`.
30. `node --test 'test/*.test.js'` en verde: las existentes sin modificar y las nuevas,
    incluida `test/sw.test.js`, validada antes sobre el `sw.js` actual.

**Rendimiento (todas las fases, medido como en el §7.2)**
31. M1 y M2 (cuerpos) dentro del límite acumulado y del límite de la fase del §7.1, con la
    línea base, la estimación local y la medida en Pages anotadas en el informe de la fase.
    Si se aplicó la contingencia de Pi, se adjunta su documentación de impacto visual.
32. CLS de *Ahora* < 0,05 y no peor que el de la línea base medido igual.
33. En las 10 pasadas del §7.2:
    - **cero** tareas largas atribuibles al código nuevo;
    - `relato:paso` con p95 ≤ 16 ms y máximo ≤ 50 ms;
    - `relato:momentos` ≤ 50 ms en el día de prueba.

    Las tareas de entorno se informan junto a las de la base y no cuentan para el criterio.
34. Mediana de `arco:pintar` ≤ 16 ms con CPU 4× (se informa; si no se cumple, se para la
    fase y se revisa con el dueño).

**Licencias y cambio horario**
35. `test/licencias.test.js` en verde (F1): licencias íntegras de IBM Plex y Phosphor,
    `ORIGEN.txt` con el commit y los iconos copiados, aviso de copyright en el sprite y
    citas en el `README.md`.
36. Cambio horario (F2/F3): en los días de 23 y 25 h no aparece la hora inexistente, la
    repetida se distingue por desfase, la energía del día no cambia y la incertidumbre de la
    hora repetida en datos locales se muestra como se describe en el §4.3.1 (cubierto por
    los criterios 7 y 14, y comprobado en pantalla con un fixture de cada día).

---

## 10. Decisiones tomadas (16-oct-2026)

| # | Decisión |
|---|---|
| D1 | Desde `hasta(hoy) + 1 h` se muestra el arco de **mañana**, identificado como previsión («MAÑANA · PREVISIÓN», fecha y hora de la previsión; §4.5) |
| D2 | SVG propio para los iconos de identidad (pestañas Ahora y Día a día, dial, formas del semáforo, icono de la app) y un **subconjunto mínimo** de Phosphor Light (27 iconos) para los genéricos. Licencia MIT con aviso de copyright, `LICENSE` íntegro y commit exacto conservados (§3.5) |
| D3 | Se añade `tipo` a las razones de `motor.js` **solo si** R7 protege la salida actual (§8.5.3). Si no, el emoji se sigue mapeando en la interfaz |
| D4 | Relato por defecto y Compacta como alternativa recordada (`solar-monitor-vista-dia`) |
| D5 | Icono nuevo de la app en F4 |
| D6 | Escala fija (`calibracion.maxKwh`). Sin calibración se usa la escala del día, con la leyenda «escala de este día» y su origen en el pie de la tabla (§4.3.3) |
| D7 | Rayos de consumo dentro del arco, hacia dentro, en `--casa` y con leyenda permanente (§4.4) |

**Aceptado temporalmente:** la limitación de la hora repetida en datos locales (§4.3.1).
No se reparte energía, se muestra la incertidumbre y no se afirma una precisión que el
Excel no da.

**Contingencia, no decisión:** quitar los subconjuntos Pi solo si una medida demuestra que
no se cumple el presupuesto, y con el impacto visual documentado (§7.1).

---

## 11. Estado del documento

**LISTA PARA F1** quiere decir que las decisiones y los criterios que necesita F1 están
definidos y son comprobables. **No hay nada implementado, ninguna prueba existe todavía y no
se ha ejecutado ningún criterio.**

### 11.1 Decisiones aprobadas

- Dirección «Instrumento solar» y principios (§0); paleta, derivados y prohibiciones (§1);
  IBM Plex Sans Var y Mono Var autoalojadas sin modificar (§2); espaciado, superficies e
  iconos (§3); arco solar (§4); las cinco pestañas y el relato de *Día a día* (§5);
  responsive y accesibilidad (§6); presupuesto y método de medida (§7); fases, ficheros,
  pruebas y conservación funcional (§8); criterios de aceptación (§9).
- Correcciones de la auditoría, incorporadas:

  | # | Corrección | Dónde |
  |---|---|---|
  | C1 | Presupuesto acumulado de 170 000 B con límites por fase; contingencia solo con medidas | §7.1–7.2, criterio 31 |
  | C2 | Movimiento reducido inmediato, con pruebas V1–V8 y sus controles | §6.2, criterio 22 |
  | C3 | Protocolo reproducible de tareas largas con atribución | §7.2, criterio 33 |
  | C4 | Service worker: pruebas de comportamiento y protocolo sin conexión | §8.4, R5, criterios 26 y 30 |
  | C5 | Cambio horario: franjas absolutas, sin redistribuir energía | §4.3.1, §5.5.1, criterio 36 |
  | C6 | Contrato completo de `modeloArco` y trazabilidad estructurada | §4.3.6, §4.4–4.6, criterios 10 y 15 |
  | C7 | Decisiones D1–D7 | §10 |

### 11.2 Pendiente de verificación durante F1 (en este orden)

1. **Primer paso técnico, antes de modificar ningún fichero de la aplicación:**
   - medir la línea base de la versión publicada (M1, M2 y CLS; §7.1–7.2);
   - capturar las regresiones de base R1, R2, R4, R5 a)–d) y R6 (§8.5.3).

   Se anotan las cifras, la fecha y el commit publicado. Hoy no existe ninguna medida.
2. Escribir `test/sw.test.js` y comprobar que pasa sobre el `sw.js` **actual** antes de
   tocarlo (§8.4).
3. Comprobar si Playwright puede ejecutar el service worker de esta app. **Si no es viable,
   R5 a)–d) se hacen a mano en Chrome DevTools** (Application → Service Workers y Cache
   Storage; Network → Offline), tal como se describe en el §8.5.3.
4. Copiar las fuentes del commit `71f558992315a12ca1f06a2215d57962a1992162` de IBM Plex y los 27 iconos de Phosphor del
   commit `2b75f3ad12b420c9504ef05df8d2564a28f8500e`, anotando el SHA-256 de cada fichero
   y conservando las licencias (§2.2, §3.5).
5. Comprobar el render de Plex Sans Var (`font-stretch: 85%`) en Safari iOS, Chrome y Firefox;
   plan B si falla (§2.2).
6. Ajustar `size-adjust` y los demás ajustes de la fuente de respaldo, y medir el CLS
   (§2.1, criterio 32).
7. Estimación local y medida en Pages de M1 y M2 al publicar F1. Solo si no se cumple el
   límite: inventario de glifos Pi y contingencia (§7.1).

Verificaciones de fases posteriores, que no bloquean F1:
- R7 antes de aplicar D3 (F2);
- el protocolo de tareas largas y `relato:paso` (F3);
- `arco:pintar` (F2);
- R3, R5 e) y V8, que hace el dueño.

### 11.3 Criterios de aceptación no ejecutados

Los 36 criterios del §9 y todas las pruebas nuevas del §8.4 están **sin ejecutar** (las
pruebas ni siquiera existen todavía). Por fase:

| Fase | Criterios que se comprueban por primera vez |
|---|---|
| F1 | 1–6, 21–32 y 35 |
| F2 | 7–13, 34 y 36 (arco) |
| F3 | 14–20, 33 y 36 (relato) |
| F4 | Se repiten 21–32 y se completa el 6 en *¿Cuadra?* |

Los criterios 21–32 (accesibilidad, conservación y rendimiento) se repiten al final de
cada fase.

### 11.4 Limitaciones conocidas y temporales

| Limitación | Tipo | Tratamiento |
|---|---|---|
| La hora repetida del cambio de hora no se distingue en los datos del Excel (`aFecha`, `inicioDeHora`, en ficheros protegidos) | Temporal, aceptada | Sin reparto de energía; incertidumbre visible en arco, tabla y resumen (§4.3.1) |
| El arco no representa la posición del sol: la app no la calcula | Del diseño | Rótulos «primera/última hora con producción», precisión horaria (§4.1) |
| Safari no tiene la API de tareas largas | Del entorno | Valoración visual del dueño, declarada como tal (§7.2) |
| Que Playwright ejecute el SW no está comprobado | Por verificar | Alternativa manual en Chrome DevTools (§8.5.3) |
| R3, R5 e) y V8 solo las puede hacer el dueño | Del entorno | Se informan como confirmación del dueño |
| En la serie guardada no se distingue el consumo medido del derivado | De los datos | Los momentos que lo usan exigen `produccion` e `importada` (§5.5.1) |
| Plex Sans Var: etiqueta 0.2.0 frente a versión interna 3.000; la equivalencia de `wdth 85` con Condensed no está comprobada | Por verificar | Capturas en F1 y plan B (§2.1–2.2) |
| Phosphor no tiene icono de lavavajillas | Del recurso | `fork-knife` con el nombre siempre al lado (§3.5) |
| Margen de 22 048 B para todo lo que no son fuentes | Riesgo | Límites por fase y contingencia medida (§7.1) |
| El canvas no se adapta a `forced-colors` | Del recurso | Tablas alternativas (§6.3) |

---

## 12. Enmienda rev. 4 (17-oct-2026)

Decisiones del dueño tras revisar el prototipo de *Ahora* (dirección «esfera»):

### 12.1 Presupuesto
- **Sin límite de peso.** Se miden M1 y M2 en Pages tras publicar cada fase (§7.2) y se
  informan junto a la cifra anterior. El criterio 31 y la contingencia del §7.1 dejan de
  bloquear; la contingencia Pi no se aplica.

### 12.2 Alcance y publicación
- Se ejecutan **F1 a F4** completas. Cada fase se publica (`push` a `main`, GitHub Pages)
  al cerrarla, con sus pruebas en verde.

### 12.3 Cambios aprobados respecto a esta especificación (dirección del prototipo)

| # | Cambio | Sustituye a |
|---|---|---|
| E1 | Veredicto del cuenco en `clamp(28px, 4.4vw, 58px)`, Sans 600 al 85 %, una línea | `--t-display` ≤ 40 px (§2.3) |
| E2 | Rótulos técnicos en mayúscula Mono 10–11 px con tracking .08em («HOY · VIERNES 16 OCT», «SOL», índices de sección) | Mayúsculas solo en unidades (§2.3) |
| E3 | *Ahora* con `max-width` 1320 px y dos columnas 7/12 + 5/12 desde 960 px | `45rem` (§3.1) |
| E4 | Anillo horario exterior (r = 196): marca menor cada 15 min, mayor y numeral cada hora salvo los extremos. `viewBox="0 -22 400 242"`; la geometría del §4.3.5 no cambia | `viewBox="0 0 400 236"` (§4.4) |
| E5 | La mejor ventana del aparato elegido (`asesor.mejor`) se dibuja sobre la pista en `--bien` (3 px) con topes; cambia al cambiar de aparato | «el arco no se mueve» al cambiar de aparato (§4.7) |
| E6 | Cielo y suelo: luz radial tenue sobre el horizonte (`--sol` de día, `--estano` de noche, 11 %) y suelo `--pozo` con bordes difuminados bajo el horizonte | Sin decoración (§3.3); no son sombras |
| E7 | Consumo como agujas de 2,5 u de grosor (sol: 6/4 u) | Grosor único (§4.4) |
| E8 | «Por qué» como lista visible numerada en la columna de decisión | `<details>` (§5.1) |
| E9 | Selector de aparatos en filas que se ajustan (sin scroll oculto), elegido con borde `--sol` y tinte 8 % | Segmentado con scroll (§3.4) |
| E10 | Frescura («● Solarman · hace N min») en la cabecera también en escritorio; pestañas numeradas `01 … 05` en la cabecera ≥ 760 px | Frescura bajo el arco (§4.4) |

Además, del prototipo: lecturas en Mono `clamp(26px, 3.2vw, 44px)` con unidad al 36 % en
`--texto-3`; exploración del arco con puntero (`touch-action: pan-y`) y flechas, cuyo
detalle de franja sustituye al cuenco mientras dura (equivale al globo del §4.6); cinta de
24 h con resumen por tramos. El lenguaje se extiende a las demás pestañas: secciones
numeradas sin cajas, cifras grandes con unidad atenuada, reglas y agujas en lugar de barras
decorativas.

