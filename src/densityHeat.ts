import type { ExpressionSpecification } from 'maplibre-gl';

// MapLibre's heatmap kernel: weight * intensity * GAUSS_COEF * exp(-4.5 d²/r²).
const GAUSS_COEF = 0.3989422804014327;
const METERS_PER_DEGREE_LAT = 110574;
const METERS_PER_DEGREE_LNG = 111320;
const EARTH_CIRCUMFERENCE_M = 40075016;
const MIN_RADIUS_PX = 8;
const MAX_RADIUS_PX = 200;
// Colour the densest 2% of the covered area at full strength.
const SCALE_PERCENTILE = 0.98;

export const DEFAULT_HEAT_RADIUS_KM = 5;

// A fixed ground radius, within pixel limits at the far zoom levels.
export function heatRadiusExpression(
  radiusKm: number,
  latitude: number
): ExpressionSpecification {
  const pxPerMetreAtZoom0 =
    512 / (EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180));
  const radiusAtZoom0 = radiusKm * 1000 * pxPerMetreAtZoom0;
  const zoomAt = (px: number) => Math.log2(px / radiusAtZoom0);
  const low = Math.max(0, zoomAt(MIN_RADIUS_PX));
  const high = Math.max(low + 1, zoomAt(MAX_RADIUS_PX));
  return [
    'interpolate',
    ['exponential', 2],
    ['zoom'],
    low,
    MIN_RADIUS_PX,
    high,
    MAX_RADIUS_PX,
  ];
}

// Scales the kernel sums so the colour ramp spans the survey's own densities.
export function heatIntensity(
  points: [number, number][],
  radiusKm: number
): number {
  if (points.length === 0 || radiusKm <= 0) return 1;
  const kx = METERS_PER_DEGREE_LNG * Math.cos((points[0][1] * Math.PI) / 180);
  const radius = radiusKm * 1000;
  const cell = radius / 2;
  const cells = new Map<string, [number, number][]>();
  for (const [lng, lat] of points) {
    const x = lng * kx;
    const y = lat * METERS_PER_DEGREE_LAT;
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push([x, y]);
  }
  const candidates = new Set<string>();
  for (const key of cells.keys()) {
    const [cx, cy] = key.split(',').map(Number);
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) candidates.add(`${cx + dx},${cy + dy}`);
  }
  const sums: number[] = [];
  for (const key of candidates) {
    const [cx, cy] = key.split(',').map(Number);
    const x = (cx + 0.5) * cell;
    const y = (cy + 0.5) * cell;
    let sum = 0;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (const [px, py] of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const d2 = ((px - x) ** 2 + (py - y) ** 2) / radius ** 2;
          if (d2 < 1) sum += Math.exp(-4.5 * d2);
        }
      }
    }
    if (sum > 0) sums.push(sum);
  }
  if (sums.length === 0) return 1;
  sums.sort((a, b) => a - b);
  const scale = sums[Math.floor((sums.length - 1) * SCALE_PERCENTILE)];
  return 1 / (GAUSS_COEF * scale);
}

// Most of the ramp sits at low densities so sparse sightings stay visible.
export const HEAT_COLOR_RAMP: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['heatmap-density'],
  0,
  'rgba(65,105,225,0)',
  0.03,
  'rgba(65,105,225,0.45)',
  0.1,
  'rgba(0,190,255,0.8)',
  0.25,
  'rgba(0,210,120,0.85)',
  0.45,
  'rgba(255,225,0,0.9)',
  0.7,
  'rgba(255,130,0,0.95)',
  1,
  'rgb(215,25,25)',
];
