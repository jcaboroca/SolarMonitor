# Asesor energético — diseño (fase 1)

Fecha: 2026-10-03 · Rama: `asesor` · Estado: implementado en local, sin desplegar.

## Objetivo

Responder en dos segundos a **«¿consumo ahora?»** con 🟢 / 🟡 / 🔴, el **porqué** y
**cuándo será mejor**, y a **«¿cuándo pongo la lavadora?»** evaluando la ventana
completa del programa.

## Decisiones tomadas

| Tema | Decisión | Motivo |
|---|---|---|
| Plataforma | Web actual (PWA) primero; app nativa después | Validar el motor con datos reales antes de reescribir nada |
| Dato en vivo | Portal Solarman vía Worker, con *refresh token* | El login lleva captcha (Turnstile); la renovación no. Verificado |
| Frecuencia | Cron cada 5 min, solo escribe si el datalogger trae dato nuevo | El datalogger sube cada ~5 min; KV gratis = 1000 escrituras/día |
| Tiempo | Open-Meteo (sin clave) | WeatherKit REST exige cuenta de desarrollador y JWT; Open-Meteo da radiación horaria y archivo para calibrar |
| Precios | Tarifa configurable por periodo + impuestos; PVPC solo como abstracción | La tarifa actual es de precio plano: la señal útil es sol + batería |
| Motor | Simulación horaria determinista + coste marginal | Explicable, testeable, sin ML |
| TimesFM | No en fase 1 | Con 61 días y patrones tan regulares, medianas por hora bastan; reevaluar con un año de histórico |

## Lo que dicen los datos (mayo + junio 2026, 61 días, paso 5 min)

- **Batería útil ≈ 5,1 kWh** (ΔSoC frente a energía descargada, 47 noches, p10 4,9 · p90 5,2).
- **Suelo de SoC ≈ 10–13 %** (mínimo diario mediana 20 %, p10 13 %).
- **Solar**: pico 2,4 kW (p99 1,84 kW); 13,4 kWh/día mediana (p10 6,4).
- **Casa**: 6,9 kWh/día; noche plana ≈ 0,22 kWh/h (≈ 1,7 kWh de 0 a 8 h).
- **Batería llena** 51 de 61 días, hacia las 13:20.
- **Calibración solar** contra la radiación de Open-Meteo: ≈ 1,75 Wh por W/m², con
  perfil horario (más alto por la mañana, cae por la tarde: orientación o sombras).
  Error diario mediano 3–4 %, p90 35–47 % (días nubosos).
- Ambigüedades del export: celdas vacías = 0 en importada/vertida/carga/descarga;
  dos filas de junio con SoC vacío (se leen como 0 → descartar SoC = 0); la
  cabecera dice UTC+01:00 pero las marcas son hora local real.

## Arquitectura

```
Solarman ──(Worker, cron 5 min)──► KV: último dato + agregados horarios
                                         │
Open-Meteo ──(navegador)──► previsión de radiación ──► previsión solar calibrada
Histórico (xlsx + Worker) ──► hábitos (medianas por hora y tipo de día)
                                         │
                        motor (simulación horaria + coste marginal)
                                         │
                        semáforo · porqué · ventanas · reserva
                                         │
                                pestaña «Ahora»
```

Módulos puros (sin DOM, probados con `node --test`), en `js/asesor/`:

- `tarifa.js` — `ElectricityTariff`: precio de energía por periodo 2.0TD (o por
  hora si se inyecta una serie), compensación de excedentes, impuesto eléctrico
  e IVA. `precioCompra(instante)`, `precioVenta(instante)` en €/kWh con impuestos.
- `habitos.js` — `EnergyBehaviorModel`: agrega a horas y calcula medianas y
  percentiles de consumo por hora y tipo de día (laborable/finde), producción
  por hora, SoC por hora; confianza según días de histórico.
- `prevision.js` — lee Open-Meteo (la radiación es la media de la hora
  **anterior**), calibra un factor por hora del día contra la producción real y
  produce la previsión solar con su confianza. Datos REAL / PREVISIÓN / ESTIMADO
  siempre etiquetados.
- `simulador.js` — balance hora a hora: sol → casa → batería (con rendimiento y
  suelo de SoC) → red. Devuelve importación, vertido, SoC y coste.
- `motor.js` — `EnergyDecisionEngine`: coste marginal de una carga en cada
  inicio posible = coste(con carga) − coste(sin carga), incluido el valor de la
  energía que queda en la batería al final del horizonte. De ahí salen el
  semáforo, la mejor ventana, las alternativas, la reserva recomendada y las
  razones.
- `aparatos.js` — `ApplianceProfile` con valores **estimados y editables**.

Worker (`worker/src/`): `/solarman/vincular` (PUT, guarda el refresh token),
`/solarman/estado` (GET), `scheduled()` cada 5 min. Misma credencial que la
sincronización (`SOLAR_ID`). El id de la planta va en un secret
(`SOLARMAN_PLANTA`), no en el repositorio (es público).

## El semáforo

Para una carga de referencia (1 kW durante 1 h) o el aparato elegido:

- `rel` = coste marginal ahora ÷ coste si todo saliera de la red al precio más alto del horizonte.
- `ahorro` = (coste ahora − coste en la mejor ventana) ÷ esa misma referencia.

| Condición | Estado |
|---|---|
| Supera la potencia contratada | 🔴 |
| `ahorro ≥ 15 %` y `rel ≥ 75 %` | 🔴 Mejor esperar |
| `ahorro ≥ 15 %` y `rel < 75 %` | 🟡 Puedes, pero hay una ventana mejor |
| `ahorro < 15 %` y `rel < 50 %` | 🟢 Buen momento |
| `ahorro < 15 %` y `rel ≥ 50 %` | 🟡 No hay ventana mejor: sale de la red |

Umbrales configurables. Los costes se muestran redondeados (`≈ 0,07 €`).

**La batería no es gratis**: usarla ahora adelanta compras después, y la
simulación lo cobra. La energía que sobra al final del horizonte se valora a
precio de compra × rendimiento.

**Reserva recomendada**: energía que la casa necesitará desde ahora hasta que el
sol vuelva a cubrir el consumo (según previsión y hábitos) + suelo de SoC.

## Privacidad

- El histórico sigue cifrado de extremo a extremo como hasta ahora.
- El dato en vivo **no puede** ir cifrado de extremo a extremo: el Worker lo lee
  de Solarman. Queda en KV de la cuenta propia, solo legible con `SOLAR_ID`.
- El refresh token solo lo conoce el Worker. Rota en cada uso: hay un único
  renovador (el cron) y si falla, la web pide volver a vincular.
- Open-Meteo recibe la latitud/longitud que se configure (redondeada a 2 decimales).

## Fuera de la fase 1

Widgets, notificaciones, app nativa, PVPC real (fuente: REData de REE, por
validar), detección de electrodomésticos, TimesFM, HomeKit, Shortcuts.

## Pruebas (casos del enunciado)

1. Sol alto + batería 100 % + precio alto → 🟢
2. Sol bajo + batería 20 % + precio alto, sol mañana → 🔴
3. Precio medio ahora + precio bajo después → 🟡
4. Batería baja + mañana nublado → reserva recomendada > SoC actual
5. Batería alta + excedente → 🟢 y mejor ventana = ahora
