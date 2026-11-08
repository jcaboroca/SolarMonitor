// Reserva y resultado usan claves distintas: KV limita las escrituras por clave y segundo.
export const TRABAJO = "informe-trabajo";
export const INTENTO = "informe-intento";

export async function leerTrabajo(kv) {
  const [trabajo, intento] = await Promise.all([kv.get(TRABAJO, "json"), kv.get(INTENTO, "json")]);
  // El resultado lleva la misma fecha que su reserva; gana el resultado si ambos existen.
  return intento && (!trabajo || intento.actualizado > trabajo.actualizado) ? intento : trabajo;
}
