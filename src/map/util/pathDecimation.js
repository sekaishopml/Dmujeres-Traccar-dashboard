/**
 * Decimación de trazados solo para renderizado: se dibujan menos segmentos a zoom
 * bajo y más al hacer zoom. No modifica los datos originales.
 */

/** Radio (m) para considerar que una racha de puntos es una parada (punto quieto).
 * 40 m: tolera el jitter Doppler y el drift del teléfono parado; el tráfico
 * lento se aleja del centro incremental y no se colapsa. */
export const STILL_RADIUS_M = 40;

/** Duración mínima (ms) de una racha para colapsarla en un solo punto.
 * 15 min: solo paradas largas y quietas de verdad; el stop-and-go urbano y las
 * esperas cortas (semáforos, tacos) siguen visibles en el trazo. */
export const STILL_MIN_MS = 15 * 60 * 1000;

/** Velocidad (nudos) por debajo de la cual un punto lejano se tolera como
 * outlier de la racha. 3 kn: el Doppler del teléfono parado a veces marca
 * 0.5-2 kn por jitter; un movimiento real reporta más. */
export const STILL_SPEED_KN = 3;

/** Outliers consecutivos tolerados en una racha antes de cerrarla. */
export const STILL_MAX_OUTLIERS = 4;

/**
 * Indica si un punto debe excluirse del TRAZO por impreciso.
 * Solo visual: nunca modifica ni elimina los datos originales.
 * Se oculta si valid === false o si accuracy (m) supera el umbral.
 * Un accuracy ausente o no numérico no oculta (no se puede juzgar).
 */
export function isInaccurate(position, accuracyThreshold) {
  if (!position) {
    return true;
  }
  if (position.valid === false) {
    return true;
  }
  const accuracy = Number(position.accuracy);
  return Number.isFinite(accuracy) && accuracy > accuracyThreshold;
}

/** Filtra puntos imprecisos solo para renderizado; no modifica el array original. */
export function filterInaccurate(positions, accuracyThreshold) {
  return positions.filter((position) => !isInaccurate(position, accuracyThreshold));
}

/** Instante (ms) de un punto o NaN si no hay tiempo válido. */
function timeOf(position) {
  return Date.parse(position.fixTime || position.deviceTime || position.serverTime);
}

/**
 * Punto representativo de una racha quieta: mediana de latitudes, mediana de
 * longitudes y resto de campos del punto intermedio (incluido su fixTime real).
 * Es la única agregación permitida (sin Kalman, snap ni medias móviles).
 * Si se pasan índices originales, los guarda en `__span` para saber qué
 * tramo real resume (sirve para no dibujar rectas sobre datos ocultos).
 */
function medianOfRun(run, fromIdx = null, toIdx = null) {
  const base = run[Math.floor(run.length / 2)];
  const latitudes = run.map((p) => p.latitude).sort((a, b) => a - b);
  const longitudes = run.map((p) => p.longitude).sort((a, b) => a - b);
  const middle = Math.floor(latitudes.length / 2);
  const median = {
    ...base,
    latitude: latitudes[middle],
    longitude: longitudes[middle],
    cluster: true,
    clusterSize: run.length,
  };
  if (fromIdx != null && toIdx != null) {
    median.__span = [fromIdx, toIdx];
  }
  return median;
}

/** Tramo original [desde, hasta] que resume un punto (mediana: su __span; resto: su índice). */
function spanOf(point, indexOf, fallbackIdx) {
  if (Array.isArray(point.__span)) {
    return point.__span;
  }
  const idx = indexOf ? indexOf.get(point) : undefined;
  const at = idx != null ? idx : fallbackIdx;
  return [at, at];
}

/**
 * Recorre posiciones agrupando rachas robustas al jitter Doppler: un punto
 * entra si dista <= radiusM del centro incremental de la racha (media de los
 * aceptados en radio, que no se mueve con los outliers). Un punto lejano con
 * Doppler < maxSpeedKn (o ausente) se tolera como outlier sin mover el centro
 * mientras no se acumulen maxOutliers consecutivos; si es lejano y rápido,
 * cierra la racha. Al cerrar llama a visit(start, end) con el rango [start,
 * end) y el siguiente punto abre una racha nueva. O(n).
 */
function forEachRobustRun(positions, radiusM, maxSpeedKn, maxOutliers, visit) {
  let start = 0;
  let centerLat = positions[0].latitude;
  let centerLon = positions[0].longitude;
  let inRadius = 1;
  let outliers = 0;
  for (let i = 1; i < positions.length; i += 1) {
    const candidate = positions[i];
    const dist = distanceMeters(candidate, { latitude: centerLat, longitude: centerLon });
    if (dist <= radiusM) {
      inRadius += 1;
      centerLat += (candidate.latitude - centerLat) / inRadius;
      centerLon += (candidate.longitude - centerLon) / inRadius;
      outliers = 0;
      continue;
    }
    const speed = Number(candidate.speed);
    const slow = !Number.isFinite(speed) || speed < maxSpeedKn;
    if (slow && outliers < maxOutliers) {
      outliers += 1;
      continue;
    }
    visit(start, i);
    start = i;
    centerLat = candidate.latitude;
    centerLon = candidate.longitude;
    inRadius = 1;
    outliers = 0;
  }
  visit(start, positions.length);
}

/**
 * Diámetro máximo (m) de una racha para considerarla quieta de verdad: si dos
 * puntos cualesquiera de la racha distan más del doble del radio, la racha se
 * desplazó (arranque lento, crawl de tráfico) y NO se colapsa: el colapso de
 * paradas jamás toca puntos en movimiento. Cota rápida por bounding box
 * (diagonal ≤ 2R ⇒ quieta; lado > 2R ⇒ movida) y, en la zona gris, diámetro
 * exacto sobre el casco convexo (monotone chain): O(n log n) con h pequeños,
 * viable para rachas de miles de puntos que se recalculan en cada zoom.
 */
function runIsStationary(run, radiusM) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  run.forEach((p) => {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
  });
  const limit = radiusM * 2;
  const latSpanM = toRad(maxLat - minLat) * earthRadius;
  const midLatCos = Math.cos(toRad((minLat + maxLat) / 2));
  const lonSpanM = toRad(maxLon - minLon) * earthRadius * midLatCos;
  if (Math.hypot(latSpanM, lonSpanM) <= limit) {
    return true;
  }
  if (Math.max(latSpanM, lonSpanM) > limit) {
    return false;
  }
  // Zona gris: diámetro exacto = máximo par de vértices del casco convexo.
  const pts = run
    .map((p) => ({ x: p.longitude * midLatCos, y: p.latitude }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const hull = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const src = pass === 0 ? pts : pts.slice().reverse();
    const part = [];
    src.forEach((p) => {
      while (part.length >= 2 && cross(part[part.length - 2], part[part.length - 1], p) <= 0) {
        part.pop();
      }
      part.push(p);
    });
    part.pop();
    hull.push(...part);
  }
  const toMeters = (p) => ({ x: toRad(p.x) * earthRadius, y: toRad(p.y) * earthRadius });
  const hullM = hull.map(toMeters);
  for (let i = 0; i < hullM.length - 1; i += 1) {
    for (let j = i + 1; j < hullM.length; j += 1) {
      if (Math.hypot(hullM[j].x - hullM[i].x, hullM[j].y - hullM[i].y) > limit) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Colapsa rachas quietas solo para renderizado: rachas robustas (misma lógica
 * que detectStops: centro incremental de STILL_RADIUS_M, hasta
 * STILL_MAX_OUTLIERS outliers Doppler < STILL_SPEED_KN y cierre al alejarse
 * rápido) de 2+ puntos con duración > STILL_MIN_MS, PERO SOLO si la racha es
 * estacionaria de verdad (diámetro <= 2·STILL_RADIUS_M, ver runIsStationary):
 * una racha que se desplazó (arranque lento, tráfico gateando) se conserva
 * cruda; el colapso nunca oculta puntos en movimiento. Se sustituyen por un
 * solo punto representativo (mediana, marcado con cluster: true).
 * Devuelve { points, collapsed } donde collapsed es cuántos puntos se ahorran.
 */
export function collapseStillClusters(positions, indexOf = null) {
  if (positions.length < 2) {
    return { points: positions, collapsed: 0 };
  }
  const points = [];
  let collapsed = 0;
  forEachRobustRun(
    positions,
    STILL_RADIUS_M,
    STILL_SPEED_KN,
    STILL_MAX_OUTLIERS,
    (runStart, end) => {
      const run = positions.slice(runStart, end);
      const span = timeOf(run[run.length - 1]) - timeOf(run[0]);
      if (
        run.length > 1 &&
        Number.isFinite(span) &&
        span > STILL_MIN_MS &&
        runIsStationary(run, STILL_RADIUS_M)
      ) {
        const [fromIdx] = spanOf(run[0], indexOf, runStart);
        const [, toIdx] = spanOf(run[run.length - 1], indexOf, end - 1);
        points.push(medianOfRun(run, fromIdx, toIdx));
        collapsed += run.length - 1;
      } else {
        points.push(...run);
      }
    },
  );
  return { points, collapsed };
}

/** Radio (m) de la racha de parada respecto a su centro incremental. */
export const STOP_RADIUS_M = 40;

/** Velocidad (nudos) por debajo de la cual un punto lejano es jitter tolerable. */
export const STOP_MAX_SPEED_KN = 3;

/** Outliers consecutivos tolerados dentro de una parada antes de cerrarla. */
export const STOP_MAX_OUTLIERS = 4;

/** Duración mínima (ms) de una racha para reportarla como parada. */
export const STOP_MIN_DURATION_MS = 5 * 60 * 1000;

/** Radio (m) para fusionar paradas contiguas del mismo lugar. */
export const STOP_MERGE_RADIUS_M = 80;

/** Hueco máximo (ms) entre paradas del mismo lugar para fusionarlas. */
export const STOP_MERGE_GAP_MS = 60 * 60 * 1000;

/**
 * Fusiona paradas consecutivas del mismo lugar (<= STOP_MERGE_RADIUS_M) sin
 * hueco real entre ellas (<= STOP_MERGE_GAP_MS): el jitter Doppler parte una
 * parada larga en varias. pointCount pasa a ser el TRAMO del array (el
 * ReplayPage resalta index >= stop.index && index < stop.index + pointCount)
 * y las coordenadas la media ponderada por puntos de las paradas fusionadas.
 */
function mergeNearbyStops(stops) {
  const merged = [];
  stops.forEach((stop) => {
    const prev = merged[merged.length - 1];
    if (prev) {
      const gapMs = Date.parse(stop.arrivalTime) - Date.parse(prev.departureTime);
      if (distanceMeters(prev, stop) <= STOP_MERGE_RADIUS_M && gapMs <= STOP_MERGE_GAP_MS) {
        const total = prev.pointCount + stop.pointCount;
        merged[merged.length - 1] = {
          index: prev.index,
          latitude: (prev.latitude * prev.pointCount + stop.latitude * stop.pointCount) / total,
          longitude: (prev.longitude * prev.pointCount + stop.longitude * stop.pointCount) / total,
          arrivalTime: prev.arrivalTime,
          departureTime: stop.departureTime,
          durationMs: Date.parse(stop.departureTime) - Date.parse(prev.arrivalTime),
          pointCount: stop.index + stop.pointCount - prev.index,
        };
        return;
      }
    }
    merged.push(stop);
  });
  return merged;
}

/**
 * Detecta paradas (solo lectura, función pura): rachas robustas al jitter
 * Doppler (misma lógica que collapseStillClusters: centro incremental de
 * STOP_RADIUS_M, hasta STOP_MAX_OUTLIERS outliers con velocidad <
 * STOP_MAX_SPEED_KN y cierre al alejarse rápido) de 2+ puntos y duración >=
 * minDurationMs. No modifica el array original. Las paradas consecutivas del
 * mismo lugar se fusionan (mergeNearbyStops). Devuelve [{ index, latitude,
 * longitude, arrivalTime, departureTime, durationMs, pointCount }] donde index
 * es la posición de llegada en el array de entrada y las coordenadas son la
 * mediana de la racha (misma lógica que medianOfRun). Las rachas de un solo
 * punto (ruido) se excluyen.
 */
export function detectStops(
  positions,
  {
    radiusM = STOP_RADIUS_M,
    minDurationMs = STOP_MIN_DURATION_MS,
    maxSpeedKn = STOP_MAX_SPEED_KN,
    maxOutliers = STOP_MAX_OUTLIERS,
  } = {},
) {
  const stops = [];
  if (!Array.isArray(positions) || positions.length < 2) {
    return stops;
  }
  const flush = (runStart, end) => {
    const run = positions.slice(runStart, end);
    if (run.length < 2) {
      return;
    }
    const startTime = timeOf(run[0]);
    const endTime = timeOf(run[run.length - 1]);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      return;
    }
    const durationMs = endTime - startTime;
    if (!(durationMs >= minDurationMs)) {
      return;
    }
    const median = medianOfRun(run);
    stops.push({
      index: runStart,
      latitude: median.latitude,
      longitude: median.longitude,
      arrivalTime: run[0].fixTime || run[0].deviceTime || run[0].serverTime,
      departureTime:
        run[run.length - 1].fixTime ||
        run[run.length - 1].deviceTime ||
        run[run.length - 1].serverTime,
      durationMs,
      pointCount: run.length,
    });
  };
  forEachRobustRun(positions, radiusM, maxSpeedKn, maxOutliers, flush);
  return mergeNearbyStops(stops);
}

/** Velocidad implícita (m/s) mínima de un tramo para sospechar ruido en racha.
 * 8 m/s: el random-walk multipath real se mueve a 5-20 m/s con Doppler en 0;
 * el viaje real a esa velocidad reporta Doppler coherente (ver NOISY_MAX).
 * Viajes largos se protegen por diámetro/tiempo máximos, no por velocidad. */
export const NOISY_MIN_SPEED_MPS = 8;

/** Velocidad Doppler reportada (m/s) máxima compatible con "teléfono quieto". */
export const NOISY_MAX_REPORTED_MPS = 4;

/** Duración máxima (ms) de una racha ruidosa para colapsarla sin mentir. */
export const NOISY_MAX_SPAN_MS = 5 * 60 * 1000;

/** Diámetro máximo (m) de una racha ruidosa: si se desplazó más, fue viaje real. */
export const NOISY_MAX_DIAMETER_M = 500;

/** Tramos ruidosos mínimos (puntos = tramos + 1) para colapsar una racha.
 * Solo rachas evidentes: un par de saltos aislados se deja visible en vez de
 * esconder un posible viaje corto real con velocímetro atascado. */
export const NOISY_MIN_POINTS = 4;

/**
 * Colapsa rachas de random-walk multipath solo para renderizado: tramos
 * consecutivos rápidos (velocidad implícita > 12 m/s) mientras el teléfono
 * reporta estar quieto (Doppler < 4 m/s en ambos extremos), con duración
 * total <= 5 min y diámetro <= 500 m. Típico: quieto bajo techo con saltos
 * de 80-150 m cada pocos segundos y accuracy "buena" mentirosa.
 * La racha se sustituye por su mediana (marcada cluster + noisy).
 * Si la racha es más larga o se desplazó más, se conserva cruda: pudo ser
 * viaje real con velocímetro roto. Devuelve { points, noisy }.
 */
export function collapseNoisyRuns(positions, indexOf = null) {
  if (positions.length < 3) {
    return { points: positions, noisy: 0 };
  }
  const reportedMs = (p) => {
    const knots = Number(p.speed);
    return Number.isFinite(knots) ? knots * 0.514444 : NaN;
  };
  const noisyLeg = (a, b) => {
    const info = segmentInfo(a, b);
    if (!info || info.speed < NOISY_MIN_SPEED_MPS) {
      return false;
    }
    const ra = reportedMs(a);
    const rb = reportedMs(b);
    return (
      Number.isFinite(ra) &&
      Number.isFinite(rb) &&
      ra < NOISY_MAX_REPORTED_MPS &&
      rb < NOISY_MAX_REPORTED_MPS
    );
  };
  const diameterOf = (run) => {
    let max = 0;
    for (let i = 0; i < run.length; i += 1) {
      for (let j = i + 1; j < run.length; j += 1) {
        const d = distanceMeters(run[i], run[j]);
        if (d > max) {
          max = d;
        }
      }
    }
    return max;
  };
  const points = [];
  let noisy = 0;
  let runStart = 0;
  const flush = (end) => {
    const run = positions.slice(runStart, end);
    if (run.length >= NOISY_MIN_POINTS) {
      const span = timeOf(run[run.length - 1]) - timeOf(run[0]);
      if (
        Number.isFinite(span) &&
        span > 0 &&
        span <= NOISY_MAX_SPAN_MS &&
        diameterOf(run) <= NOISY_MAX_DIAMETER_M
      ) {
        const [fromIdx] = spanOf(run[0], indexOf, runStart);
        const [, toIdx] = spanOf(run[run.length - 1], indexOf, end - 1);
        const collapsed = medianOfRun(run, fromIdx, toIdx);
        collapsed.noisy = true;
        collapsed.clusterSize = run.length;
        points.push(collapsed);
        noisy += run.length - 1;
        return;
      }
    }
    points.push(...run);
  };
  for (let i = 1; i < positions.length; i += 1) {
    if (!noisyLeg(positions[i - 1], positions[i])) {
      flush(i);
      runStart = i;
    }
  }
  flush(positions.length);
  return { points, noisy };
}

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

/**
 * Piso mínimo (m) de la tolerancia de simplificación: aunque el zoom pida más
 * detalle, Douglas-Peucker nunca baja de 10 m. Suficiente para borrar el
 * temblor del GPS (<10 m) y conservar las esquinas reales: un tramo de 10 s
 * a 60 km/h mide ~166 m y su vértice de giro supera holgadamente 10 m de
 * desviación perpendicular, así que DP lo mantiene.
 */
export const SMOOTH_FLOOR_M = 10;

/** Giro mínimo (grados, cambio de rumbo) para recortar una esquina.
 * 130°: solo giros casi de retorno (zigzag cerrado) se redondean; una esquina
 * de calle típica (~90°) conserva su vértice para que el trazo gire en la
 * intersección y no la corte en diagonal. */
export const CHAIKIN_MIN_ANGLE = 130;

/** Tramo máximo (m) de alguna pata para recortar: solo micro-zigzag corto.
 * 30 m: a 10 s entre fixes esto solo aplica a ruido quieto, nunca a tramos
 * conduciendo (un tramo real a >10 km/h ya mide >27 m). */
export const CHAIKIN_MAX_LEG_M = 30;

/** Ratio de corte de esquina (0.25: Q al 75% hacia B, R al 25% hacia C). */
export const CHAIKIN_RATIO = 0.25;

/**
 * Una pasada de Chaikin SOLO en esquinas duras con tramo corto: por cada
 * tripleta A-B-C con giro (cambio de rumbo) > CHAIKIN_MIN_ANGLE y
 * min(|AB|, |BC|) < CHAIKIN_MAX_LEG_M, el vértice B se sustituye por dos
 * puntos Q = A + 0.75·(B−A) y R = B + 0.25·(C−B) (interpolación lineal en
 * lat/lon, resto de campos heredados de B). Preserva primer/último punto y
 * no cruza cortes: debe aplicarse POR CHUNK ya separado por gaps/teleports.
 * Sin snap-to-road, sin Kalman, sin medias móviles.
 */
export function smoothChaikinOnce(points) {
  if (points.length < 3) {
    return points.slice();
  }
  const ratio = CHAIKIN_RATIO;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const d1 = distanceMeters(a, b);
    const d2 = distanceMeters(b, c);
    const heading1 = bearingDegrees(a, b);
    const heading2 = bearingDegrees(b, c);
    let turn = Math.abs(heading2 - heading1) % 360;
    if (turn > 180) {
      turn = 360 - turn;
    }
    if (turn > CHAIKIN_MIN_ANGLE && Math.min(d1, d2) < CHAIKIN_MAX_LEG_M) {
      const q = {
        ...b,
        latitude: a.latitude + (b.latitude - a.latitude) * (1 - ratio),
        longitude: a.longitude + (b.longitude - a.longitude) * (1 - ratio),
      };
      const r = {
        ...b,
        latitude: b.latitude + (c.latitude - b.latitude) * ratio,
        longitude: b.longitude + (c.longitude - b.longitude) * ratio,
      };
      out.push(q, r);
    } else {
      out.push(b);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Aplana saltos erráticos (GPS loco) y ping-pong multipath, solo para render. */
export function filterSpikes(positions, maxJumpMps = 60, accuracyM = 50) {
  if (positions.length <= 2) {
    return positions;
  }
  let working = positions;
  for (let pass = 0; pass < SPIKE_MAX_PASSES; pass += 1) {
    const result = [working[0]];
    let removed = 0;
    for (let i = 1; i < working.length - 1; i += 1) {
      const prev = working[i - 1];
      const current = working[i];
      const next = working[i + 1];
      const s01 = impliedSpeed(prev, current);
      const s12 = impliedSpeed(current, next);
      const reported = Number(current.speed);
      const corroborated = Number.isFinite(reported) && s12 > 0 && reported * 0.514444 >= s12 * 0.4;
      const extremeJump =
        Number.isFinite(s01) &&
        Number.isFinite(s12) &&
        s01 > maxJumpMps &&
        s12 > maxJumpMps &&
        (Number(current.accuracy) > accuracyM || !corroborated);
      if (!extremeJump && !isPingPong(prev, current, next) && !isSandwich(prev, current, next)) {
        result.push(current);
      } else {
        removed += 1;
      }
    }
    result.push(working[working.length - 1]);
    working = result;
    if (removed === 0) {
      break;
    }
  }
  return working;
}

/**
 * Ping-pong multipath: excursión que sale y vuelve (ida y vuelta de decenas
 * o cientos de metros en segundos) sin velocidad Doppler que la respalde.
 * Es la firma del drift urbano/indoor con accuracy "buena" mentirosa: el
 * teléfono quieto reporta 10-30 m de accuracy mientras salta 100-300 m.
 * El viaje real es monótono (no vuelve al punto de partida en segundos),
 * así que exigir inversión de rumbo protege autopistas y trayectos válidos.
 */
export const SPIKE_MIN_LEG_M = 80;
export const SPIKE_MIN_SPEED_MPS = 8;
export const SPIKE_REVERSAL_RATIO = 0.5;
export const SPIKE_MAX_PASSES = 3;

function segmentInfo(a, b) {
  const ta = Date.parse(a.fixTime || a.deviceTime || a.serverTime);
  const tb = Date.parse(b.fixTime || b.deviceTime || b.serverTime);
  const seconds = (tb - ta) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const dist = distanceMeters(a, b);
  return { dist, speed: dist / seconds };
}

export function isPingPong(prev, current, next) {
  const s01 = segmentInfo(prev, current);
  const s12 = segmentInfo(current, next);
  if (!s01 || !s12) {
    return false;
  }
  if (s01.dist < SPIKE_MIN_LEG_M || s12.dist < SPIKE_MIN_LEG_M) {
    return false;
  }
  if (s01.speed < SPIKE_MIN_SPEED_MPS || s12.speed < SPIKE_MIN_SPEED_MPS) {
    return false;
  }
  const closing = distanceMeters(prev, next);
  if (closing >= SPIKE_REVERSAL_RATIO * (s01.dist + s12.dist)) {
    return false;
  }
  const reported = Number(current.speed) * 0.514444;
  const corroborated =
    Number.isFinite(reported) && reported >= Math.max(s01.speed, s12.speed) * 0.4;
  return !corroborated;
}

/**
 * Sándwich fantasma: punto intermedio con saltos grandes en AMBOS lados
 * mientras sus vecinos casi coinciden (ida y vuelta casi perfecta, d02≈0).
 * Es la firma más clara del multipath: el GPS salta lejos y regresa al
 * instante. A diferencia del ping-pong, no exige velocidad mínima en los
 * tramos (el salto puede durar minutos): basta que ambos extremos superen
 * 80 m, que los vecinos disten menos del 30% de la suma y que no haya
 * respaldo Doppler. Un giro en U real tarda minutos y reporta velocidad;
 * aquí se exige además salto rápido implícito (>15 m/s en algún tramo) o
 * cierre casi perfecto (<10% de la suma) para no tocar maniobras reales.
 */
export const SANDWICH_MIN_LEG_M = 80;
export const SANDWICH_MIN_SPEED_MPS = 15;
export const SANDWICH_MAX_CLOSE_RATIO = 0.3;
export const SANDWICH_TIGHT_CLOSE_RATIO = 0.1;

export function isSandwich(prev, current, next) {
  const s01 = segmentInfo(prev, current);
  const s12 = segmentInfo(current, next);
  if (!s01 || !s12) {
    return false;
  }
  if (s01.dist < SANDWICH_MIN_LEG_M || s12.dist < SANDWICH_MIN_LEG_M) {
    return false;
  }
  const closing = distanceMeters(prev, next);
  const ratio = closing / (s01.dist + s12.dist);
  const fastEnough = s01.speed > SANDWICH_MIN_SPEED_MPS || s12.speed > SANDWICH_MIN_SPEED_MPS;
  if (ratio >= SANDWICH_MAX_CLOSE_RATIO && !(ratio < SANDWICH_TIGHT_CLOSE_RATIO && fastEnough)) {
    return false;
  }
  if (ratio >= SANDWICH_TIGHT_CLOSE_RATIO && !fastEnough) {
    return false;
  }
  const reported = Number(current.speed) * 0.514444;
  const corroborated =
    Number.isFinite(reported) && reported >= Math.max(s01.speed, s12.speed) * 0.4;
  return !corroborated;
}

/** Velocidad implícita en m/s entre dos posiciones (0 si no hay tiempo válido). */
function impliedSpeed(a, b) {
  const ta = Date.parse(a.fixTime || a.deviceTime || a.serverTime);
  const tb = Date.parse(b.fixTime || b.deviceTime || b.serverTime);
  const seconds = (tb - ta) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return NaN;
  }
  return distanceMeters(a, b) / seconds;
}

/** Distancia en metros entre dos posiciones (haversine). */
function distanceMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const la = toRad(a.latitude);
  const lb = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
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

/**
 * TELEPORTS (saltos imposibles entre dos fixes consecutivos): nunca se unen
 * con una recta que cruce cuadras; la línea se CORTA ahí igual que con
 * MAX_GAP_MS por tiempo. Dos reglas independientes, basta que cumpla una:
 *  1) salto largo en muy poco tiempo (> 500 m en < 15 s: > 120 km/h incluso en
 *     autopista; típico de re-adquisición GNSS tras túnel o de fixes cacheados
 *     re-entregados fuera de orden). Medido en el viaje real a casa: 500 m en
 *     59 s son 34 km/h de auto urbano, NO un teleport;
 *  2) velocidad implícita > 35 m/s (~126 km/h, imposible sostenida en ciudad)
 *     sin respaldo de la velocidad Doppler reportada por el propio equipo.
 */
/** Distancia (m) que delata un teleport cuando el dt es corto. */
export const TELEPORT_MAX_DIST_M = 500;

/** Ventana (ms): por debajo de ella, un salto > TELEPORT_MAX_DIST_M se corta.
 * 15 s: 500 m en 59 s (34 km/h) es conducción real, no un salto. */
export const TELEPORT_MAX_DT_MS = 15 * 1000;

/** Velocidad implícita (m/s) imposible en ruta urbana si nadie la corrobora. */
export const TELEPORT_MAX_SPEED_MPS = 35;

/** Fracción de la velocidad implícita que la Doppler reportada (el mejor de
 * ambos extremos, nudos → m/s) debe alcanzar para NO cortar por velocidad. */
export const TELEPORT_CORROBORATE_RATIO = 0.4;

/**
 * Indica si el tramo a→b es un salto imposible y la línea debe cortarse ahí.
 * Solo segmenta (nunca oculta puntos): ambos puntos se siguen dibujando, pero
 * sin la recta que los une. Sin tiempo válido solo se puede juzgar la
 * distancia (mismo instante + distinto sitio = imposible).
 */
export function isTeleport(a, b) {
  const dist = distanceMeters(a, b);
  const dtMs = timeOf(b) - timeOf(a);
  if (!Number.isFinite(dtMs) || dtMs <= 0) {
    return dist > TELEPORT_MAX_DIST_M;
  }
  if (dist > TELEPORT_MAX_DIST_M && dtMs < TELEPORT_MAX_DT_MS) {
    return true;
  }
  const implied = dist / (dtMs / 1000);
  if (implied <= TELEPORT_MAX_SPEED_MPS) {
    return false;
  }
  const reportedA = Number(a.speed) * 0.514444;
  const reportedB = Number(b.speed) * 0.514444;
  const best = Math.max(
    Number.isFinite(reportedA) ? reportedA : -Infinity,
    Number.isFinite(reportedB) ? reportedB : -Infinity,
  );
  return !(best >= implied * TELEPORT_CORROBORATE_RATIO);
}

/**
 * Distancia (m) por debajo de la cual dos fixes están "en el mismo sitio": un
 * hueco temporal entre ellos es una parada, no un corte de datos. 100 m cubre
 * el drift de las medianas de paradas largas (medido: 52-88 m entre clusters
 * del mismo estacionamiento); un hueco real en marcha siempre supera 100 m.
 */
export const SAME_PLACE_M = 100;

/**
 * Indica si entre dos puntos consecutivos del trazo NO debe dibujarse segmento:
 * hueco temporal mayor a maxGapMs o teleport (salto imposible). Dos fixes en el
 * mismo sitio (<= SAME_PLACE_M) nunca se cortan: el hueco es la parada, no una
 * caída de datos. Usar tanto al segmentar como al dibujar (simplify puede crear
 * un salto al quitar puntos intermedios) y al orientar flechas.
 */
export function shouldCut(a, b, maxGapMs = MAX_GAP_MS) {
  if (distanceMeters(a, b) <= SAME_PLACE_M) {
    return false;
  }
  const delta = timeOf(b) - timeOf(a);
  if (Number.isFinite(delta) && delta > maxGapMs) {
    return true;
  }
  return isTeleport(a, b);
}

/** Divide la secuencia cortando por hueco temporal o por teleport. */
export function splitByGapAndTeleport(positions, maxGapMs = MAX_GAP_MS) {
  const chunks = [];
  let current = [];
  positions.forEach((position, index) => {
    if (index > 0 && shouldCut(positions[index - 1], position, maxGapMs)) {
      if (current.length) {
        chunks.push(current);
      }
      current = [];
    }
    current.push(position);
  });
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

/**
 * Rumbo geográfico (grados, 0 = norte, horario) del trazo a→b. Para orientar
 * flechas sobre la línea visible: se calcula con los vecinos de la lista YA
 * LIMPIA que dibuja la línea, nunca con position.course (el course reportado
 * suele venir rancio o en 0 y deja flechas cruzadas al trazo).
 */
export function bearingDegrees(a, b) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const toDeg = (radians) => (radians * 180) / Math.PI;
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Distancia (m) a partir de la cual una cuerda que salta sobre puntos
 * ocultos se corta en vez de dibujarse: una recta de cientos de metros
 * sobre datos eliminados nunca sigue calles.
 */
export const BRIDGED_CUT_DIST_M = 150;

/** Cuerda mínima (m) para sospechar salto aislado entre vecinos lentos. */
export const ISOLATED_JUMP_DIST_M = 250;

/** Velocidad implícita (m/s) mínima del salto y máxima de los vecinos. */
export const ISOLATED_JUMP_SPEED_MPS = 8;

/**
 * Pipeline ÚNICO de limpieza del trazo (lo usan igual la línea y las flechas
 * para que coincidan): duplicados exactos → red sin GNSS → spikes →
 * inexactos → rachas de ruido → paradas largas. No muta el input. Con
 * hideInaccurate en false devuelve los puntos intactos ("Ver todo" = crudo
 * real). Devuelve { points, stats, cuts } donde cuts son las referencias de
 * los puntos ANTES de los cuales hay que cortar (cuerdas sobre ocultos).
 */
/** Umbral mínimo de accuracy (m) admitido: por debajo esconde ruta real. */
export const MIN_ACCURACY_THRESHOLD_M = 30;

export function cleanRoutePositions(positions, { hideInaccurate, accuracyThreshold }) {
  // Por defecto 250 m: en marcha muchos teléfonos (p. ej. ZTE) reportan
  // 120-200 m de accuracy con fixes válidos, y esconderlos borraba la ruta
  // conduciendo. Con 250 solo salen fixes inválidos (valid === false), redes
  // (proveedor network/unknown) o accuracy realmente absurdo (>250 m).
  // Piso de 30 m: un umbral menor sigue escondiendo ruta real porque el GPS
  // de teléfono rara vez baja de 10-30 m. Se respeta la preferencia explícita.
  const th = Math.max(MIN_ACCURACY_THRESHOLD_M, Number(accuracyThreshold) || 250);
  const total = positions.length;
  const origIndex = new Map();
  positions.forEach((p, i) => {
    if (!origIndex.has(p)) {
      origIndex.set(p, i);
    }
  });
  let working = positions;
  let dupes = 0;
  let provider = 0;
  let spikes = 0;
  let inaccurate = 0;
  let noisy = 0;
  let collapsed = 0;
  if (hideInaccurate) {
    // Filas duplicadas exactas (mismo fixTime y coords, distinto id): la
    // ingesta doble las guarda dos veces; para el trazo sobra una.
    const seen = new Set();
    const beforeDupes = working.length;
    working = working.filter((p) => {
      const key = `${p.fixTime || p.deviceTime || ''}|${p.latitude}|${p.longitude}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    dupes = beforeDupes - working.length;
    // Picos/ping-pong/sándwich se evalúan sobre la geometría CRUDA (antes de
    // quitar red/inexactos): si primero se eliminan los vecinos, los tripletos
    // se rompen y los fantasmas sobreviven al filtro.
    const deSpiked = filterSpikes(working);
    spikes = working.length - deSpiked.length;
    working = deSpiked;
    // Puros de red sin GNSS (attributes.provider === 'network' o 'unknown'):
    // re-entregas cacheadas que agrandan el cluster y nunca trazan carretera.
    const beforeProvider = working.length;
    working = working.filter(
      (p) => p.attributes?.provider !== 'network' && p.attributes?.provider !== 'unknown',
    );
    provider = beforeProvider - working.length;
    const filtered = filterInaccurate(working, th);
    inaccurate = working.length - filtered.length;
    working = filtered;
    // Los collapse reciben el mapa de índices para que las medianas guarden
    // el tramo original que resumen (ver __span en medianOfRun).
    // Se pasa origIndex (coordenadas de ENTRADA, estables): los __span de las
    // medianas quedan en el mismo sistema aunque haya varias etapas.
    const noisyRun = collapseNoisyRuns(working, origIndex);
    working = noisyRun.points;
    noisy = noisyRun.noisy;
    const still = collapseStillClusters(working, origIndex);
    working = still.points;
    collapsed = still.collapsed;
  }
  // Cortes: segmentos que saltan sobre puntos ocultos más de BRIDGED_CUT_DIST_M
  // no se dibujan (evita rectas cruzando cuadras). Además, saltos aislados
  // largos entre vecinos lentos sin respaldo Doppler (teleport que aparece y
  // se queda quieto: imposible en viaje real, donde lo rápido es sostenido).
  // Se resuelve por tramo original, así sobrevive a simplify (referencias).
  const cuts = new Set();
  let bridges = 0;
  if (hideInaccurate) {
    const legSpeed = (a, b) => {
      const dt = (timeOf(b) - timeOf(a)) / 1000;
      if (!Number.isFinite(dt) || dt <= 0) {
        return NaN;
      }
      return distanceMeters(a, b) / dt;
    };
    const uncorroborated = (p, implied) => {
      const reported = Number(p.speed) * 0.514444;
      return !(Number.isFinite(reported) && reported >= implied * 0.4);
    };
    for (let i = 1; i < working.length; i += 1) {
      const prev = working[i - 1];
      const curr = working[i];
      const [, prevTo] = spanOf(prev, origIndex, -1);
      const [nextFrom] = spanOf(curr, origIndex, -1);
      const hiddenBetween = nextFrom - prevTo - 1;
      const dist = distanceMeters(prev, curr);
      if (hiddenBetween > 0 && dist > BRIDGED_CUT_DIST_M) {
        cuts.add(curr);
        bridges += 1;
        continue;
      }
      // Salto aislado: cuerda larga y rápida entre vecinos lentos, sin Doppler.
      if (dist > ISOLATED_JUMP_DIST_M) {
        const dt = (timeOf(curr) - timeOf(prev)) / 1000;
        const implied = Number.isFinite(dt) && dt > 0 ? dist / dt : NaN;
        if (
          Number.isFinite(implied) &&
          implied > ISOLATED_JUMP_SPEED_MPS &&
          uncorroborated(curr, implied)
        ) {
          const prevLeg = i < 2 ? NaN : legSpeed(working[i - 2], prev);
          const nextLeg = i + 1 >= working.length ? NaN : legSpeed(curr, working[i + 1]);
          const prevSlow = !Number.isFinite(prevLeg) || prevLeg < ISOLATED_JUMP_SPEED_MPS;
          const nextSlow = !Number.isFinite(nextLeg) || nextLeg < ISOLATED_JUMP_SPEED_MPS;
          if (prevSlow && nextSlow) {
            cuts.add(curr);
            bridges += 1;
          }
        }
      }
    }
  }
  const stats = {
    total,
    shown: working.length,
    hidden: provider + inaccurate + dupes,
    provider,
    inaccurate,
    dupes,
    collapsed,
    noisy,
    spikes,
    bridges,
  };
  return { points: working, stats, cuts };
}
