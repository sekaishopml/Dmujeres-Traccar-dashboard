/**
 * Decimación de trazados solo para renderizado: se dibujan menos segmentos a zoom
 * bajo y más al hacer zoom. No modifica los datos originales.
 */

/** Divide la secuencia en tramos separados por huecos mayores a maxGapMs (fixTime). */
export function splitByGap(positions, maxGapMs) {
  const chunks = [];
  let current = [];
  positions.forEach((position, index) => {
    if (index > 0) {
      const previous = positions[index - 1];
      const delta = Date.parse(position.fixTime) - Date.parse(previous.fixTime);
      if (Number.isFinite(delta) && delta > maxGapMs) {
        if (current.length) {
          chunks.push(current);
        }
        current = [];
      }
    }
    current.push(position);
  });
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

/** Douglas-Peucker sobre objetos {longitude, latitude}; devuelve los puntos a mantener (misma referencia). */
export function simplify(points, tolerance) {
  if (points.length <= 2 || tolerance <= 0) {
    return points;
  }
  const sqTolerance = tolerance * tolerance;
  const first = 0;
  const last = points.length - 1;
  const keep = new Array(points.length).fill(false);
  keep[first] = true;
  keep[last] = true;

  const stack = [[first, last]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDistance = 0;
    let maxIndex = -1;
    const sx = points[start].longitude;
    const sy = points[start].latitude;
    const ex = points[end].longitude;
    const ey = points[end].latitude;
    for (let i = start + 1; i < end; i += 1) {
      const px = points[i].longitude;
      const py = points[i].latitude;
      const distance = pointSegmentDistanceSq(px, py, sx, sy, ex, ey);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }
    if (maxDistance > sqTolerance && maxIndex !== -1) {
      keep[maxIndex] = true;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function pointSegmentDistanceSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    const ox = px - ax;
    const oy = py - ay;
    return ox * ox + oy * oy;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const ox = px - (ax + t * dx);
  const oy = py - (ay + t * dy);
  return ox * ox + oy * oy;
}

/** Tolerancia de simplificación (grados) según el zoom del mapa. */
export function toleranceForZoom(zoom) {
  if (zoom <= 8) return 0.0008;
  if (zoom === 9) return 0.0004;
  if (zoom === 10) return 0.0002;
  if (zoom === 11) return 0.0001;
  if (zoom === 12) return 0.00005;
  if (zoom === 13) return 0.00002;
  if (zoom === 14) return 0.00001;
  return 0;
}

/** Cada cuántos puntos se dibuja una flecha según el zoom (menos al alejarse). */
export function strideForZoom(zoom) {
  if (zoom < 9) return 40;
  if (zoom <= 10) return 24;
  if (zoom <= 12) return 12;
  if (zoom === 13) return 6;
  if (zoom === 14) return 3;
  return 1;
}

/** Umbral a partir del cual merece la pena decimar (evita cambiar rutas cortas). */
export const DECIMATION_THRESHOLD = 200;

export const MAX_GAP_MS = 5 * 60 * 1000;
