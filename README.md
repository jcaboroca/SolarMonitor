# Solar Monitor

Web estática para cotejar los datos que exporta el datalogger de la instalación
fotovoltaica con lo que aparece en la factura de la luz, y ver el detalle en
gráficas.

**Todo se procesa en el navegador.** Ni el `.xlsx` ni el PDF se suben a ningún
servidor: no hay backend, no hay credenciales y funciona sin conexión una vez
cargada.

## Cómo se usa

1. Exporta desde SolarMAN los datos del mes (`.xlsx`, una fila cada 5 minutos).
2. Suéltalo en la ranura «01 · Datos del datalogger» de la pestaña *Datos*. Las columnas se detectan solas; si alguna se
   identifica mal, se cambia en la tabla «Columnas detectadas».
3. Suelta el PDF de la factura del mismo mes en la ranura «02 · Factura de la luz». Los kWh que se
   consigan leer rellenan la tabla de comparación; lo demás se escribe a mano.
4. Se comparan los kWh comprados a la red por periodo (P1/P2/P3 de la 2.0TD) y
   los excedentes vertidos.

Si el PDF y el datalogger son de meses distintos, se avisa y no se compara ni
se sobrescribe la factura del mes abierto. Carga los datos del mes del PDF para
guardarlo. Los valores introducidos a mano quedan ligados a su mes y no se
arrastran al cambiar de fichero.

Los festivos nacionales fijos y el 6 de enero se aplican automáticamente como
valle según la 2.0TD. «Festivos adicionales de tu tarifa» permite excepciones
en formato `dd/mm/aaaa`; los festivos locales no son valle por defecto.

El veredicto compara la factura con **Datadis del mismo intervalo**, solo si
están todas las horas y son reales. Una factura parcial se compara únicamente
con sus fechas (la fecha final de Octopus es exclusiva). «Calculada» en una
lectura impresa no equivale a consumo horario estimado.

## Detalles

- El reparto por periodos usa el calendario 2.0TD peninsular: punta de 10 a 14 y
  de 18 a 22 entre semana, valle de 0 a 8 más fines de semana y festivos.
- La energía se calcula integrando la potencia instantánea de cada intervalo. Un
  hueco en los datos no se rellena: se contabiliza como un intervalo normal.
- Es normal una diferencia pequeña con la factura: el datalogger mide en el
  inversor y el contador mide en la acometida.
- Se muestra cobertura horaria, no solo días con alguna muestra; el cambio de
  hora de octubre conserva las 25 horas. Solarman incompleto no permite culpar
  al contador ni validar una factura.
- Un dato ausente no se representa como cero. Los gráficos de consumo separan
  lo atribuible a la casa de las compras brutas (que pueden incluir pérdidas
  y carga de batería). Los saltos bruscos de SOC se señalan como cambios del
  nivel indicado, sin diagnosticar una avería ni una carga física.

## Estructura

- `js/xlsx.js` — lector de `.xlsx` sin dependencias (ZIP + XML).
- `js/datos.js` — detección de columnas, integración a kWh y periodos tarifarios.
- `js/factura.js` — texto del PDF (pdf.js) y heurísticas de factura 2.0TD.
- `js/graficas.js` — gráficas en canvas.
- `js/nube.js` — cifrado y sincronización con el Worker.
- `worker/` — Worker de Cloudflare que guarda el histórico cifrado.
- `vendor/` — pdf.js, las fuentes IBM Plex y la licencia de los iconos, servidos desde el propio repositorio.
- `js/iconos.js` — traduce aparatos, razones y estados a los iconos del sprite SVG de `index.html`.
- `js/lectura.js` — la Lectura de cifras y la regla de desvío del acta de cotejo (*¿Cuadra?*).
- `js/anual.js` — «El año en rayos» de *Mes a mes*: cada mes guardado, un rayo de producción y una aguja de consumo.
- `assets/` — icono de la app (SVG, versión maskable y PNG de 180, 192 y 512 px).
- `muestras/` — datos reales de prueba, fuera del control de versiones.

## Diseño, fuentes e iconos

La interfaz sigue la especificación «Instrumento solar»
([docs/superpowers/specs/2026-10-16-instrumento-solar-design.md](docs/superpowers/specs/2026-10-16-instrumento-solar-design.md)).

- **Fuentes:** IBM Plex Sans Var e IBM Plex Mono Var, © IBM Corp., con licencia
  SIL Open Font License 1.1 y nombre reservado «Plex». Se sirven los subconjuntos
  oficiales sin modificar, copiados de `github.com/IBM/plex`
  (commit `71f558992315a12ca1f06a2215d57962a1992162`), con su `vendor/fuentes/license.txt`.
- **Iconos:** los genéricos son de Phosphor Icons (peso Light), © 2023 Phosphor Icons,
  con licencia MIT; el texto íntegro está en `vendor/phosphor/LICENSE` y el origen exacto
  de cada icono, en `vendor/phosphor/ORIGEN.txt`. Los de identidad (dial, día, formas del
  semáforo y el icono de la app: el arco sobre el horizonte con el sol en su pista) son propios.

## En local

```sh
python3 -m http.server 8765
```

## Sincronizar entre dispositivos

El histórico vive en el navegador, así que cada dispositivo empieza vacío. Para
compartirlo hay un Worker de Cloudflare que guarda **una copia cifrada**: la clave
de descifrado se deriva en el navegador y nunca se envía, de modo que en la nube
solo queda un churro ilegible.

Despliegue, una sola vez:

```sh
cd worker
npx wrangler login
npx wrangler kv namespace create HISTORICO   # copiar el id en wrangler.toml
node ../scripts/credencial.mjs              # genera clave maestra y SOLAR_ID
npx wrangler secret put SOLAR_ID            # pegar el SOLAR_ID que imprime
npx wrangler deploy
```

Después, en la web: «Mes a mes» → «Sincronizar entre dispositivos», pegar la
dirección del Worker y la **clave maestra** (la otra línea que imprime el script).
La misma clave en cada dispositivo.

Antes de subir se lee y fusiona la copia remota. Las revisiones más recientes
prevalecen por hora; una curva corregida actualiza sus horas aunque conserve la misma
longitud y una descarga parcial no borra las otras horas. Los resúmenes se
recalculan desde la curva. Los borrados se conservan para no resucitar meses
desde dispositivos antiguos. Si no se puede leer o descifrar la nube, no se
sobrescribe con una copia local incompleta.

Las descargas de Datadis también se sincronizan automáticamente al terminar,
incluso si solo se pudo recuperar una parte del rango solicitado. Si falla la
subida, se muestra el error y los datos permanecen guardados en el navegador;
se puede reintentar con «Subir ahora».

> Si se pierde la clave maestra, lo que haya en la nube es irrecuperable. Conviene
> guardarla en el gestor de contraseñas y conservar además la copia en fichero.

## Asesor: ¿consumo ahora?

La pestaña **Ahora** responde con un semáforo (● bien · ▲ cuidado · ■ evita), el
porqué y la mejor ventana para cada electrodoméstico. Simula la casa hora a hora
con y sin la carga y cobra la diferencia, así que la batería nunca sale gratis.
Diseño en `docs/superpowers/specs/2026-10-03-asesor-energetico-design.md`.

- **Dato en vivo**: el Worker lee el portal de Solarman cuando la web pregunta, sin
  escribir en KV. Una vez por hora (cron) guarda la energía de esa hora restando los
  acumulados del día: ~25 escrituras de KV al día, para no comerse la cuota
  gratuita que comparten los Workers de la cuenta. El login del portal lleva
  captcha, así que se vincula una vez pegando el token de renovación en los
  ajustes del asesor; después el cron renueva solo.
- **Previsión solar**: Open-Meteo (sin clave), calibrada con tu producción real.
- **Hábitos**: medianas por hora con el histórico del xlsx y el que va juntando el Worker.

Despliegue (además de lo de la sincronización):

```sh
cd worker
npx wrangler secret put SOLARMAN_PLANTA   # id numérico de la planta en Solarman
npx wrangler deploy                       # incluye el cron horario
```

## Informe diario (pestaña 06 Informe)

Cada día a las 08:30 (Europe/Madrid) el Worker genera un informe de **ayer** y
recomendaciones para **hoy**, lo guarda por fecha y, si lo activas, avisa al iPhone
con una notificación push genérica ("Tu informe solar está disponible") que abre
el informe de esa fecha. **No está activo por defecto**: lo activas tú en la web
tras configurarlo. El envío puede retrasarse por el dispositivo o la red; no se
garantiza al minuto ni exactamente una vez (la etiqueta `informe-AAAA-MM-DD`
suprime duplicados visibles).

### Fuentes y privacidad

- Los datos son el archivo SolarMAN del servidor (5 min), **no** Datadis. Datadis
  sigue siendo una descarga manual y la confirmación con él es opcional y local.
- El paquete cifrado de `/historico` y la clave maestra no se leen ni se tocan.
- En el servidor (KV) solo se guarda: ajustes mínimos (tarifa con vigencia y
  origen, ubicación aproximada, activaciones), suscripciones push (máx. 5) e
  informes generados. Nunca contraseñas de Datadis, facturas ni claves maestras.
- Open-Meteo recibe solo latitud/longitud redondeadas, nunca consumos.
- Todas las rutas `/informe/*` pasan por la misma autenticación que el resto;
  los informes no son ficheros estáticos. El push no lleva consumos ni costes.
- Sin tarifa vigente verificada no hay euros: se ordenan kWh comprados. Un precio
  indexado solo se muestra como estimación de media histórica, nunca como factura.
  El precio por defecto de la factura antigua no se usa como precio actual.

### Despliegue

```sh
node scripts/generar-vapid.mjs            # imprime claves y comandos; no las guardes en git
cd worker
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT     # mailto:tu@correo
npx wrangler deploy
```

Sin esas variables el push falla con un error claro (el informe sí se genera).
Crons (UTC): `2 * * * *` (el de siempre), y `30 6 * * *` y `30 7 * * *`, dos
candidatos para las 08:30 de Madrid (verano/invierno). Una guarda de hora local
(≥ 08:30 Madrid) y el estado guardado evitan generar o enviar dos veces; el cron
horario sirve de reintento acotado (4 generaciones, 3 entregas por dispositivo).
Los endpoints 404/410 del proveedor eliminan la suscripción; solo se aceptan
destinos Apple, FCM y Mozilla.

### iPhone

iOS 16.4 o superior: Safari → Compartir → **Añadir a pantalla de inicio**, abrir
desde el icono y en Ajustes del informe pulsar **Activar avisos** (el permiso solo
se pide con ese gesto). Si lo deniegas: Ajustes de iOS → Notificaciones → Solar
Monitor. Hay botón de notificación de prueba y de desactivar.

### Desactivar / recuperar

Desmarca el informe y los avisos en la web (o `DELETE /informe/suscripcion`);
quitar los crons `30 6/7` de `wrangler.toml` y redesplegar lo para por completo.
Las claves VAPID se rotan con otro `secret put`; los dispositivos deben reactivar.

### Límites medidos (importante)

Estado de un informe: «Completo» exige ≥98 % de cobertura en cada señal necesaria; por debajo es «Parcial» y el coste, si la cobertura de compra es ≥75 %, se presenta como «al menos» (mínimo observado, sin extrapolar). Un informe parcial se regenera si el archivo mejora después (firma de cobertura distinta), con un máximo acotado de reintentos.

`node scripts/medir-informe.mjs` (datos sintéticos, 30 días, CPU de Node en esta
máquina, **no** medida de Cloudflare): generar el informe cuesta ~12–24 ms en
caliente y ~340 ms en frío (carga de módulos); archivar un día nuevo, ~40–50 ms; el
cron horario sin trabajo pendiente, ~0,3 ms. Desde esta revisión `archivar` guarda
el día de ayer ya integrado (`solarman-dia`, una clave pequeña) y los totales
diarios (`diarios`), de modo que generar **no** vuelve a procesar la curva del mes;
antes costaba ~70–170 ms. Aun así queda por encima de los 10 ms de CPU del plan
gratuito, así que sigue siendo un riesgo de despliegue sin validar en Cloudflare
real: alternativas seguras, plan Workers de pago o dividir en invocaciones más
pequeñas; no se ha cambiado el alojamiento.

Presupuesto de KV por día: `archivar` hace cada hora como mucho 2 escrituras (mes
y resumen) más 1 de `solarman-dia` cuando recoge ayer, con un máximo de 8 intentos
por día; el informe, 1 escritura del informe, 1 del índice, 2 del bloqueo y 1 por
dispositivo notificado. Las regeneraciones por mejora del archivo están acotadas
(`MAX_REGENERACIONES`, 4 extra) y no reenvían el aviso ya enviado.

Tras desplegar: la calibración de la previsión solo cuenta horas archivadas con el
formato nuevo (columna de minutos con sol medido), así que necesita ~5 días antes de
calibrar; la comparación con el mes anterior solo usa días con `diarios`, es decir,
archivados con esta versión.

### Prueba manual pendiente

La recepción real en iPhone no está verificada: requiere desplegar tras la
revisión y probarlo con el dispositivo del usuario.

Pruebas: `node --test --test-concurrency=1 'test/*.test.js'`.
