import type { GpsRow } from '../survey/new-survey/gpsIndex';

export type AltitudeUnit = 'm' | 'ft';
export type AltitudeBand = { min: number; max: number };

export const METERS_PER_FOOT = 0.3048;

// SRTM voids are -32768; anything this low is not real terrain.
const MIN_GROUND_ELEVATION = -500;

export function altitudeBandFrom(
  target: string,
  deviation: string,
  unit: AltitudeUnit
): AltitudeBand | null {
  if (target.trim() === '' || deviation.trim() === '') return null;
  const t = Number(target);
  const d = Number(deviation);
  if (!Number.isFinite(t) || !Number.isFinite(d) || t <= 0 || d < 0) {
    return null;
  }
  const factor = unit === 'ft' ? METERS_PER_FOOT : 1;
  return { min: (t - d) * factor, max: (t + d) * factor };
}

export function isOutsideAltitudeBand(
  agl: number | undefined,
  band: AltitudeBand
): boolean {
  return agl !== undefined && (agl < band.min || agl > band.max);
}

export async function computeAglByRow(
  rows: GpsRow[],
  altitudeIsAgl: boolean,
  getElevation: (lat: number, lng: number) => Promise<number | null>
): Promise<Map<GpsRow, number>> {
  const result = new Map<GpsRow, number>();
  // One failed lookup skips the rest of its tile instead of refetching per row.
  const failedTiles = new Set<string>();
  for (const row of rows) {
    if (!Number.isFinite(row.alt)) continue;
    if (altitudeIsAgl) {
      result.set(row, row.alt);
      continue;
    }
    // Sea-level altitude 0 is the placeholder for a missing value.
    if (row.alt === 0) continue;
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue;
    const tile = `${Math.floor(row.lat)}|${Math.floor(row.lng)}`;
    if (failedTiles.has(tile)) continue;
    const ground = await getElevation(row.lat, row.lng);
    if (ground === null) {
      failedTiles.add(tile);
      continue;
    }
    if (ground < MIN_GROUND_ELEVATION) continue;
    result.set(row, row.alt - ground);
  }
  return result;
}
