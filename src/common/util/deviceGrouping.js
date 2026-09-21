/**
 * Agrupación de la lista de dispositivos por DEPARTAMENTO (grupos Traccar)
 * con desplegar/contraer.
 *
 * Reglas:
 * - Grupos ordenados alfabéticamente por nombre.
 * - Dentro de cada grupo se conserva el orden de entrada (que ya viene por
 *   estado: En línea → Detenidos → Sin señal → Deshabilitado y alfabético).
 * - Los equipos sin grupo van al final en "Sin grupo".
 * - Un grupo contraído aporta SOLO su cabecera (con el conteo).
 *
 * Función pura (Node/JVM): testeable sin la UI.
 */

export const HEADER_TYPE = 'header';
export const DEVICE_TYPE = 'device';

export const buildGroupedRows = (devices, groups, collapsedGroups = {}) => {
  const byGroup = new Map();
  const withoutGroup = [];
  (devices || []).forEach((device) => {
    const groupId = device.groupId;
    if (groupId && groups && groups[groupId]) {
      if (!byGroup.has(groupId)) {
        byGroup.set(groupId, []);
      }
      byGroup.get(groupId).push(device);
    } else {
      withoutGroup.push(device);
    }
  });

  const result = [];
  const sortedGroupIds = [...byGroup.keys()].sort((a, b) =>
    groups[a].name.localeCompare(groups[b].name),
  );
  sortedGroupIds.forEach((groupId) => {
    const groupDevices = byGroup.get(groupId);
    result.push({
      type: HEADER_TYPE,
      groupId,
      group: groups[groupId].name,
      count: groupDevices.length,
    });
    if (!collapsedGroups[groupId]) {
      groupDevices.forEach((device) => result.push({ type: DEVICE_TYPE, device }));
    }
  });

  if (withoutGroup.length > 0) {
    result.push({
      type: HEADER_TYPE,
      groupId: '__none__',
      group: 'Sin grupo',
      count: withoutGroup.length,
    });
    if (!collapsedGroups.__none__) {
      withoutGroup.forEach((device) => result.push({ type: DEVICE_TYPE, device }));
    }
  }
  return result;
};
