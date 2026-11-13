import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { matchHerd, solveAssignment, type HerdPoint } from './herdMatch';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function herd(n: number, seed: number, spacing = 40): HerdPoint[] {
  const rand = rng(seed);
  const pts: HerdPoint[] = [];
  while (pts.length < n) {
    const x = 1000 + rand() * 2400;
    const y = 2000 + rand() * 1000;
    if (pts.every((p) => Math.hypot(p.x - x, p.y - y) >= spacing)) {
      pts.push({ id: `a${pts.length}`, x, y });
    }
  }
  return pts;
}

function moved(
  A: HerdPoint[],
  seed: number,
  { dx = 0, dy = 0, sx = 1, sy = 1, angle = 0, jitter = 0 } = {},
): HerdPoint[] {
  const rand = rng(seed);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return A.map((p) => {
    const x = p.x * sx;
    const y = p.y * sy;
    return {
      id: p.id.replace('a', 'b'),
      x: c * x - s * y + dx + (rand() - 0.5) * 2 * jitter,
      y: s * x + c * y + dy + (rand() - 0.5) * 2 * jitter,
    };
  });
}

const correct = (pairs: Array<[string, string, boolean]>) =>
  pairs.filter(([a, b]) => a.slice(1) === b.slice(1)).length;

test('solveAssignment finds the minimum-cost assignment', () => {
  const cost = Float64Array.from([4, 1, 3, 2, 0, 5, 3, 2, 2]);
  assert.deepEqual([...solveAssignment(cost, 3, 3)], [1, 0, 2]);
});

test('equal counts are all linked', () => {
  const A = herd(60, 1);
  const B = moved(A, 2, { dx: 900, dy: -400, jitter: 25 });
  const pairs = matchHerd(A, B);
  assert.equal(pairs.length, 60);
  assert.equal(new Set(pairs.map(([, b]) => b)).size, 60);
});

test('unequal counts link min(nA, nB) and keep the true pairs', () => {
  const A = herd(200, 3);
  const B = moved(A, 4, { dx: 500, dy: 300, jitter: 4 }).filter(
    (_, i) => i % 40 !== 7,
  );
  const pairs = matchHerd(A, B);
  assert.equal(pairs.length, 195);
  assert.equal(correct(pairs), 195);
  assert.equal(matchHerd(B, A).length, 195);
});

test('a translated, stretched and turned herd recovers the true pairing', () => {
  const A = herd(250, 5);
  const B = moved(A, 6, {
    dx: 700,
    dy: -350,
    sx: 1.06,
    sy: 0.96,
    angle: 0.05,
    jitter: 5,
  });
  const pairs = matchHerd(A, B);
  assert.equal(pairs.length, 250);
  assert.equal(correct(pairs), 250);
});

test('a herd whose movement bends across it is still paired animal by animal', () => {
  const A = herd(200, 13);
  const B = A.map((p, i) => ({
    id: `b${i}`,
    x: p.x + 600 + 250 * Math.sin((p.y - 2000) / 400),
    y: p.y - 300 + 200 * Math.cos((p.x - 1000) / 700),
  }));
  const pairs = matchHerd(A, B);
  assert.ok(correct(pairs) >= 183, `${correct(pairs)} of 200`);
});

test("the two spare animals pair with each other, not with anyone else's partner", () => {
  const A = herd(120, 14);
  const B = moved(A, 15, { dx: 800, dy: 300, jitter: 6 });
  const left = A.reduce((m, p) => (p.x < m.x ? p : m));
  const right = B.reduce((m, p) => (p.x > m.x ? p : m));
  const pairs = matchHerd(
    A.filter((a) => a.id.slice(1) !== right.id.slice(1)),
    B.filter((b) => b.id.slice(1) !== left.id.slice(1)),
  );
  assert.equal(pairs.length, 119);
  assert.equal(correct(pairs), 118);
  const spare = pairs.find(([a]) => a === left.id);
  assert.equal(spare?.[1], right.id);
  assert.deepEqual(
    pairs.filter(([, , uncertain]) => uncertain).map(([a]) => a),
    [left.id],
  );
});

test('a herd running one way at different speeds is paired', () => {
  const A = herd(150, 21);
  const rand = rng(121);
  const B = A.map((p, i) => ({
    id: `b${i}`,
    x: p.x + (rand() - 0.5) * 10,
    y: p.y - 300 * (1 + (rand() - 0.5) * 0.5),
  }));
  assert.ok(correct(matchHerd(A, B)) >= 144);
});

test('250 x 250 matches quickly', () => {
  const A = herd(250, 8);
  const B = moved(A, 9, { dx: 1200, dy: 600, jitter: 10 });
  const start = performance.now();
  matchHerd(A, B);
  const ms = performance.now() - start;
  assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
});
