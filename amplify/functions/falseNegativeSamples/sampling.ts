import { createHash } from 'node:crypto';
import {
  isPointInBox,
  isTileSeen,
  type Box,
} from '../../../shared/locationGeometry';

export type Tile = Box & { id: string; imageId: string };
export type Point = { x: number; y: number };

export const FALSE_NEGATIVE_SOURCE = 'false-negative';

export function isFalseNegativeSource(source: unknown): boolean {
  return typeof source === 'string' && source.includes(FALSE_NEGATIVE_SOURCE);
}

/** Uniform in [0, 1), fixed for a seed and tile so a resumed job repeats it. */
export function sampleDraw(seed: string, tileId: string): number {
  const digest = createHash('md5').update(`${seed}:${tileId}`).digest();
  return digest.readUInt32BE(0) / 2 ** 32;
}

export function isCoveredByPrimaryWork(
  tile: Box,
  reviewed: readonly Box[] | undefined,
  annotations: readonly Point[] | undefined,
): boolean {
  if (reviewed?.length && isTileSeen(tile, reviewed)) return true;
  return !!annotations?.some((point) => isPointInBox(point.x, point.y, tile));
}

export function isUsableTile(tile: Box): boolean {
  return tile.x !== 0 && tile.y !== 0 && tile.width > 0 && tile.height > 0;
}

export function sampleTarget(
  percent: number,
  unreviewed: number,
  available: number,
): number {
  const share = Math.min(Math.max(percent, 0), 100) / 100;
  if (share === 0 || unreviewed <= 0 || available <= 0) return 0;
  return Math.min(Math.max(Math.floor(unreviewed * share), 1), available);
}

// Oversample to reduce shortfalls before selecting the lowest draws.
export function stagingThreshold(
  percent: number,
  expectedUnreviewed: number,
  expectedAvailable: number,
  totalTiles: number,
): number {
  const share = Math.min(Math.max(percent, 0), 100) / 100;
  if (share === 0) return 0;
  if (expectedAvailable <= 0 || expectedUnreviewed <= 0) return 1;
  const rate = (share * expectedUnreviewed) / expectedAvailable;
  return Math.min(1, rate * 1.05 + 200 / Math.max(totalTiles, 1));
}

export type RowStatus = 'pending' | 'reviewed' | 'covered';

export type CounterDelta = {
  reviewedCount?: number;
  coveredCount?: number;
  foundCount?: number;
};

export function coverDelta(row: {
  status: RowStatus;
  found?: number;
}): CounterDelta | null {
  if (row.status === 'covered') return null;
  return row.status === 'reviewed'
    ? { coveredCount: 1, reviewedCount: -1, foundCount: -(row.found ?? 0) }
    : { coveredCount: 1 };
}
