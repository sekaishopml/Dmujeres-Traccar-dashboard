/**
 * Etiquetas y color de la fila "Calidad" del replay (puro, sin React):
 * mapea attributes.qualityClass a un token de paleta MUI y attributes.speedSource
 * a su etiqueta localizada.
 */

/** Token de paleta MUI por clase de calidad (null si la clase no existe). */
export function qualityColor(qualityClass) {
  switch (qualityClass) {
    case 'EXCELLENT':
    case 'GOOD':
      return 'success.main';
    case 'DEGRADED':
      return 'warning.main';
    case 'POOR':
    case 'INVALID':
      return 'error.main';
    default:
      return null;
  }
}

/** Etiqueta por fuente de velocidad (null si la fuente no existe). */
export function speedSourceLabel(speedSource, t) {
  switch (speedSource) {
    case 'doppler':
      return t('replaySpeedSourceDoppler');
    case 'implied':
      return t('replaySpeedSourceImplied');
    case 'unknown':
      return t('replaySpeedSourceUnknown');
    default:
      return null;
  }
}
