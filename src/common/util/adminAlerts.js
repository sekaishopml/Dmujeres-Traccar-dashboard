/**
 * Lógica pura de la sección Alertas del panel admin (sin React ni red):
 * agrupa por severidad y formatea el estado del sistema para las tarjetas.
 * Pura para poder testear con `node --test`.
 */
export const SEVERITY_CRITICAL = 'critical';
export const SEVERITY_WARNING = 'warning';
export const SEVERITY_INFO = 'info';

const RANK = { critical: 3, warning: 2, info: 1 };

export const severityRank = (severity) => RANK[severity] || 0;

export const sortAlerts = (alerts) =>
  [...(alerts || [])].sort(
    (first, second) =>
      severityRank(second.severity) - severityRank(first.severity) ||
      (second.ts || 0) - (first.ts || 0),
  );

/** Devuelve siempre las tres claves, de crítica a información. */
export const groupAlerts = (alerts) => {
  const groups = { critical: [], warning: [], info: [] };
  sortAlerts(alerts).forEach((alert) => {
    const key = severityRank(alert.severity) > 0 ? alert.severity : SEVERITY_INFO;
    groups[key].push(alert);
  });
  return groups;
};

export const formatBytes = (bytes) => {
  if (bytes == null || Number.isNaN(Number(bytes))) {
    return null;
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unit]}`;
};

/** Edad legible del respaldo: '<1 h', '5 h' o '3 d'. */
export const formatAgeHours = (hours) => {
  if (hours == null) {
    return null;
  }
  if (hours < 1) {
    return '<1 h';
  }
  if (hours < 48) {
    return `${Math.floor(hours)} h`;
  }
  return `${Math.floor(hours / 24)} d`;
};

/** Uptime legible del server: '5 min', '3 h 20 min' o '2 d 4 h'. */
export const formatUptime = (seconds) => {
  if (seconds == null || seconds < 0) {
    return null;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days} d ${hours} h`;
  }
  if (hours > 0) {
    return `${hours} h ${minutes} min`;
  }
  return `${minutes} min`;
};
