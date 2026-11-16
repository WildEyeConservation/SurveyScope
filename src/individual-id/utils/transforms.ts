import { inv, matrix, multiply, type Matrix } from 'mathjs';
import type { ImageNeighbourType } from '../../schemaTypes';
import type { PixelTransform } from '../types';

function array2Matrix(hc: number[] | null | undefined): number[][] | null {
  if (!hc || hc.length !== 9) return null;
  return [hc.slice(0, 3), hc.slice(3, 6), hc.slice(6, 9)];
}

function makeTransform(H: Matrix): PixelTransform {
  return (c: [number, number]): [number, number] => {
    const result = multiply(H, [c[0], c[1], 1]).valueOf() as number[];
    return [result[0] / result[2], result[1] / result[2]];
  };
}

export interface BuiltTransforms {
  forward: PixelTransform;
  backward: PixelTransform;
  noHomography: boolean;
}

// Returns identity transforms with noHomography:true when the homography is missing/malformed.
export function buildNeighbourTransforms(
  n: ImageNeighbourType,
): BuiltTransforms {
  const arr = array2Matrix(n.homography ?? null);
  if (!arr) {
    const identity: PixelTransform = (c) => [c[0], c[1]];
    return { forward: identity, backward: identity, noHomography: true };
  }
  const M = matrix(arr) as Matrix;
  const Minv = inv(M) as Matrix;
  return {
    forward: makeTransform(M),
    backward: makeTransform(Minv),
    noHomography: false,
  };
}

export function projectsInside(
  x: number,
  y: number,
  tf: PixelTransform,
  w: number,
  h: number,
): boolean {
  const [tx, ty] = tf([x, y]);
  return tx >= 0 && ty >= 0 && tx < w && ty < h;
}

export function pointInPolygon(
  px: number,
  py: number,
  poly: [number, number][],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Point-in-polygon against the other image's projected footprint; the candidate point is never run through the homography, so an out-of-overlap point can't extrapolate to a false "inside".
export function isInOverlap(
  px: number,
  py: number,
  otherToThis: PixelTransform,
  otherW: number,
  otherH: number,
): boolean {
  const quad: [number, number][] = [
    otherToThis([0, 0]),
    otherToThis([otherW, 0]),
    otherToThis([otherW, otherH]),
    otherToThis([0, otherH]),
  ];
  return pointInPolygon(px, py, quad);
}
