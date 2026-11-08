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
Un único cron (`* * * * *`) selecciona **una fase por invocación**:

- Minutos 02, 03 y 04 de cada hora: sondeo, descarga de un día y migración local de un día, respectivamente.
- Desde las 08:25 de Madrid: fuente de ayer, previsión, calibración e informe, en ejecuciones separadas.
- Desde las 08:30: envío, como máximo a un dispositivo por ejecución; los demás siguen en los minutos posteriores.

La guarda usa Europe/Madrid también en los cambios de hora. El estado de preparación
se guarda en KV: tres intentos por fase, cuatro generaciones ordinarias y cuatro
por cambios de datos, y tres entregas por dispositivo. Las suscripciones 404/410 se
eliminan; solo se aceptan destinos Apple, FCM y Mozilla. El bloqueo KV es de mejor
esfuerzo, no una garantía de ejecución exactamente una vez.

«Generar ahora» solicita `/informe/generar?fases=1` y recibe `202 preparando`. La web continúa mediante peticiones
autenticadas a `/informe/avanzar`, una fase por petición, y limita el seguimiento a
12 pasos separados por dos segundos. Si se cierra la página o se agota ese seguimiento,
el cron continúa. Nunca se anuncia «generado» solo por haber aceptado la solicitud.
Los snapshots meteorológicos deben coincidir en fecha y ubicación; un fallo no se
convierte en una previsión válida. Preparación y progreso están en claves pequeñas,
separadas del paquete cifrado.
El endpoint sin `fases=1` conserva temporalmente la generación síncrona para clientes
que ya estaban abiertos antes de actualizar la web; hay que recargarlos para usar
el flujo nuevo. El cron siempre usa las fases independientes.

### iPhone

iOS 16.4 o superior: Safari → Compartir → **Añadir a pantalla de inicio**, abrir
desde el icono y en Ajustes del informe pulsar **Activar avisos** (el permiso solo
se pide con ese gesto). Si lo deniegas: Ajustes de iOS → Notificaciones → Solar
Monitor. Hay botón de notificación de prueba y de desactivar.

### Desactivar / recuperar

Desmarca el informe y los avisos en la web (o `DELETE /informe/suscripcion` para
quitar un dispositivo). El sondeo y el archivo siguen funcionando.
Quitar el cron de `wrangler.toml` y redesplegar detiene también esas tareas.
Las claves VAPID se rotan con otro `secret put`; los dispositivos deben reactivar.

### Límites medidos (importante)

Estado de un informe: «Completo» exige que no falten más de ~30 s medidos en cada señal necesaria (tolerancia solo numérica, no minutos omitidos): un muestreo perdido ya es «Parcial». La cobertura se decide sin redondear y se redondea solo al mostrarla (nunca se enseña 100 % si hay huecos). Si la cobertura de compra es ≥75 %, el coste se presenta como «al menos» (mínimo observado, sin extrapolar).

Actualización de datos: con una descarga por ejecución, `archivar` rota entre ayer (aunque esté completo), los otros recientes incompletos y el atrasado desde mayo. El turno se conserva en `solarman-curvas.turnoArchivo`; se saltan las colas vacías y los recientes mantienen su límite de intentos. Así ayer no monopoliza las descargas ni se pierde su revisión de correcciones. Reconcilia la curva por instante y señal: un valor válido nuevo corrige al guardado y un dato ausente o fuera de dominio (potencia negativa, SoC fuera de 0–100; el 0 real vale) conserva el guardado. Las horas del día se rehacen desde esa curva con las mismas reglas de intervalos que el total diario (sin duplicados, recortando al día, un hueco grande cuenta un paso normal, solo suma tiempo medido): la suma horaria coincide con la diaria salvo el redondeo a Wh enteros, y los minutos de la tupla horaria son los realmente medidos de casa y de solar. Publica una marca pequeña (`solarman-version`) con un hash del contenido aceptado de ayer y otro de las dependencias efectivas del informe (solo los días completos del mes, del mes anterior hasta el mismo día y de la comparación; el historial ajeno no cuenta); el cron regenera el informe (completo o parcial, máximo `MAX_REGENERACIONES` extra) cuando esa versión difiere de la del informe, sin reenviar el aviso ya entregado.

Migración de días heredados: los días con curva y sin resumen diario (de hace más de 7 días o de meses previos, hasta 62 días atrás) se resumen desde la curva ya guardada, sin descargar, uno por ejecución programada en el minuto 04, los más recientes primero. Ayer heredado se inicializa también desde su curva (instantánea y marca) y consume ese mismo cupo: con `maxMigracion: 0` no se inicializa; con `1` no se integra además otro día. Si su curva falta, no bloquea la migración de otros días. Solo cuentan como pendientes los días que entran en el informe; mientras queden, el informe lo indica en el acumulado del mes y al terminar se regenera una vez. Los informes fechados de los últimos 6 días generados con migración en curso quedan marcados (`huella.p`) y se refrescan de uno en uno (máx. `MAX_REFRESCOS`) para su fecha original, incluso después de medianoche: conservan la recomendación de hoy original con una nota, no reenvían avisos y mantienen el estado de entrega y `generado`; `actualizado` indica cuándo se recompusieron. El refresco prepara y guarda la fuente en una ejecución (`refresco_fuente`); otra ejecución compone el informe sin leer curvas ni reintegrar (`refresco_informe`). Cada fase consume su intento antes del trabajo, como máximo tres, incluso si el runtime termina sin ejecutar `catch`. El agotamiento es explícito y no impide atender otros informes pendientes. Los snapshots e intentos históricos caducan a los siete días. CPU sin medir en Cloudflare. Un backfill de días que no estaban archivados (sin curva) no regenera informes ya publicados. Sin curva no se puede medir: el día queda incompleto y se revisita con intentos acotados.

Rotación de la clave VAPID: el cliente guarda el endpoint antiguo antes de darlo de baja y el `PUT /informe/suscripcion` admite `reemplaza` (solo el endpoint propio, validado), de modo que con 5 dispositivos no hace falta plaza extra; si algo falla, la referencia se conserva y «Desactivar»/reintentar la limpian.

Al migrar una curva local también se reconstruyen sus horas con las mismas reglas
de intervalos que el resumen diario. Las revisitas hacen lo mismo aunque el portal
devuelva una curva idéntica: los datos originales no cambian, pero se reparan las
horas calculadas con reglas antiguas. Si las horas ya coinciden, no hay escritura
adicional; tampoco se reescribe la curva mensual sin cambios.

`node scripts/medir-informe.mjs` mide cada fase con datos sintéticos de 30 días.
Es CPU de Node, **no** de Cloudflare. La generación monolítica llegó a consumir
14–21 ms reales en Cloudflare durante la validación del 8 de noviembre de 2026,
por encima del objetivo de 10 ms del plan gratuito, aunque no devolvió errores.
Por eso se divide ahora el trabajo en invocaciones independientes, no en varias
promesas dentro de la misma invocación. Hay que medir la CPU real de cada fase,
también en frío: que una petición termine bien no demuestra que tenga margen.
No se ha contratado un plan de pago.

Validación real del flujo por fases, 8 de noviembre de 2026:

| Operación | CPU observada (ms) |
| --- | ---: |
| Preparar fuente | 5,604 |
| Preparar previsión | 4,502 |
| Preparar calibración | 7,132 |
| Componer informe | 7,141 |
| Avisos, con la entrega ya completada | 4,776 |
| Cron sin trabajo pendiente, máximo observado | 3,501 |

Son métricas de Cloudflare, no tiempos de respuesta HTTP; las invocaciones
observadas no registraron errores. La calibración seguía sin datos suficientes:
estas muestras no certifican su carga completa ni la del refresco histórico.
Falta observar los turnos programados de archivo y migración por separado.
La prueba del cliente nuevo comprobó también que no se repite un aviso ya enviado
y que no se altera el histórico cifrado.

La fuente preparada contiene el día integrado, los resúmenes y la cobertura
pendiente. La composición no vuelve a leer curvas ni a consultar meteorología.
Las fechas ISO se ordenan sin inicializar comparación regional. La calibración
descarta horas antiguas o sin sol medido antes de crear objetos y, si no queda
ninguna utilizable, no pide histórico meteorológico.

Presupuesto de KV por día: `archivar` hace cada hora como mucho una escritura por mes tocado, 1 del resumen (incluido el turno de selección), 1 de `solarman-dia` y 1 de `solarman-version` solo si su contenido cambia, con un máximo de 8 intentos por día incompleto.
Cada fase reserva primero su intento en una clave distinta del resultado, para no escribir dos veces la misma clave en esa ejecución. `informe-intento` conserva también el trabajo recién creado si se interrumpe antes de guardar `informe-trabajo`; la API y el ejecutor usan el estado más reciente y prefieren el resultado cuando corresponde a la misma reserva.
Además se guarda el resultado preparado cuando
corresponde y se adquiere/libera el bloqueo. Un minuto sin trabajo no
escribe. El informe añade su documento e índice; la entrega actualiza el
dispositivo y el índice. Las regeneraciones por mejora del archivo están acotadas
(`MAX_REGENERACIONES`, 4 extra) y no reenvían el aviso ya enviado.

Tras desplegar: la calibración de la previsión solo cuenta horas archivadas o
reconstruidas con el formato nuevo (columna de minutos con sol medido). Necesita
unos 5 días con datos suficientes, que pueden proceder de la migración local;
la comparación con el mes anterior solo usa días con `diarios`, descargados o
migrados con esta versión.

### Validación en iPhone

El usuario confirmó la recepción de la notificación de prueba el 8 de noviembre
de 2026. El servidor registró además el envío del aviso diario; esa aceptación
por el servicio push no demuestra por sí sola su visualización en el teléfono.
Los avisos están activados y el planificador usa las 08:30 de Madrid.
Queda observar la siguiente entrega automática de esa hora con el flujo por fases.

Pruebas: `node --test --test-concurrency=1 'test/*.test.js'`.
