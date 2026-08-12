# Solar Monitor

Web estática para cotejar los datos que exporta el datalogger de la instalación
fotovoltaica con lo que aparece en la factura de la luz, y ver el detalle en
gráficas.

**Todo se procesa en el navegador.** Ni el `.xlsx` ni el PDF se suben a ningún
servidor: no hay backend, no hay credenciales y funciona sin conexión una vez
cargada.

## Cómo se usa

1. Exporta desde SolarMAN los datos del mes (`.xlsx`, una fila cada 5 minutos).
2. Suéltalo en la primera caja. Las columnas se detectan solas; si alguna se
   identifica mal, se cambia en la tabla «Columnas detectadas».
3. Suelta el PDF de la factura del mismo mes en la segunda caja. Los kWh que se
   consigan leer rellenan la tabla de comparación; lo demás se escribe a mano.
4. Se comparan los kWh comprados a la red por periodo (P1/P2/P3 de la 2.0TD) y
   los excedentes vertidos.

Los festivos nacionales cuentan como valle: se escriben en el campo «Festivos
del mes» (`24/06, 15/08`) porque no hay ninguna lista fija metida en el código.

## Detalles

- El reparto por periodos usa el calendario 2.0TD peninsular: punta de 10 a 14 y
  de 18 a 22 entre semana, valle de 0 a 8 más fines de semana y festivos.
- La energía se calcula integrando la potencia instantánea de cada intervalo. Un
  hueco en los datos no se rellena: se contabiliza como un intervalo normal.
- Es normal una diferencia pequeña con la factura: el datalogger mide en el
  inversor y el contador mide en la acometida.

## Estructura

- `js/xlsx.js` — lector de `.xlsx` sin dependencias (ZIP + XML).
- `js/datos.js` — detección de columnas, integración a kWh y periodos tarifarios.
- `js/factura.js` — texto del PDF (pdf.js) y heurísticas de factura 2.0TD.
- `js/graficas.js` — gráficas en canvas.
- `js/nube.js` — cifrado y sincronización con el Worker.
- `worker/` — Worker de Cloudflare que guarda el histórico cifrado.
- `vendor/` — pdf.js, servido desde el propio repositorio.
- `muestras/` — datos reales de prueba, fuera del control de versiones.

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

Al traer de la nube se fusiona campo a campo: un hueco nunca pisa un dato, así que
sincronizar desde un dispositivo con menos información no borra la que ya había.

> Si se pierde la clave maestra, lo que haya en la nube es irrecuperable. Conviene
> guardarla en el gestor de contraseñas y conservar además la copia en fichero.
