/**
 * Filtro defensivo SOLO para la geometría de la línea de ruta (nunca muta el input):
 * 1) descarta puntos marcados por el server como de red (attributes.network === true);
 * 2) colapsa duplicados CONSECUTIVOS con coordenadas exactamente iguales
 *    (lat y lon string-equal), conservando el primero — cubre datos históricos
 *    (p. ej. 2026-09-07) que aún no traen attributes.network;
 * 3) si quedan menos de 2 puntos, devuelve el array original (fallback: mejor
 *    un trazo con ruido que romper la línea).
 * Si attributes no viene, es null o no trae network, nada cambia.
 */
export function filterRoutePositions(positions) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return positions;
  }
  const nonNetwork = positions.filter((p) => p?.attributes?.network !== true);
  const collapsed = [];
  let prevKey = null;
  nonNetwork.forEach((p) => {
    const key = `${String(p?.latitude)},${String(p?.longitude)}`;
    if (key !== prevKey) {
      collapsed.push(p);
      prevKey = key;
    }
  });
  return collapsed.length >= 2 ? collapsed : positions;
}
