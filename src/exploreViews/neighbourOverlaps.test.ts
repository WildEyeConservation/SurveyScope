import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clipPolygon,
  clipSegment,
  colourOverlaps,
  neighbourOverlaps,
  neighbourToImage,
  OVERLAP_COLOURS,
  polygonArea,
  polygonCentroid,
  projectCorners,
} from './neighbourOverlaps';
import { applyHomography, nearbyViews, type Pt } from './otherViews';

const shift = (dx: number, dy: number) => [1, 0, dx, 0, 1, dy, 0, 0, 1];
const size = { width: 100, height: 100 };
const sizeOf = () => size;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function inside(p: Pt, poly: Pt[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      hit = !hit;
  }
  return hit;
}

test('maps the neighbour into the image whichever side of the row it is', () => {
  const asImage2 = neighbourToImage('c', {
    image1Id: 'n',
    image2Id: 'c',
    homography: shift(10, 0),
  })!;
  assert.equal(asImage2.imageId, 'n');
  assert.deepEqual(applyHomography(asImage2.matrix, 0, 0), { x: 10, y: 0 });

  const asImage1 = neighbourToImage('c', {
    image1Id: 'c',
    image2Id: 'n',
    homography: shift(10, 0),
  })!;
  assert.equal(asImage1.imageId, 'n');
  const p = applyHomography(asImage1.matrix, 0, 0)!;
  assert.ok(near(p.x, -10) && near(p.y, 0));

  assert.equal(
    neighbourToImage('c', {
      image1Id: 'a',
      image2Id: 'b',
      homography: shift(1, 1),
    }),
    null,
  );
  assert.equal(
    neighbourToImage('c', { image1Id: 'c', image2Id: 'n', homography: null }),
    null,
  );
});

test('footprints agree with where nearby views project points', () => {
  const h = [1.02, 0.04, 35, -0.03, 0.98, -20, 0.0004, -0.0002, 1];
  for (const row of [
    { image1Id: 'c', image2Id: 'n', homography: h },
    { image1Id: 'n', image2Id: 'c', homography: h },
  ]) {
    const corners = projectCorners(neighbourToImage('c', row)!.matrix, size)!;
    for (let x = 2; x < 100; x += 7)
      for (let y = 3; y < 100; y += 7) {
        const views = nearbyViews('c', { x, y }, [row], sizeOf);
        const projected = views.length === 1 && views[0].point !== null;
        const p = views[0]?.point;
        const onEdge = p && Math.min(p.x, p.y, 100 - p.x, 100 - p.y) < 1e-6;
        if (!onEdge) assert.equal(inside({ x, y }, corners), projected);
      }
  }
});

test('rejects a projection that crosses the horizon', () => {
  assert.equal(projectCorners([1, 0, 0, 0, 1, 0, -0.02, 0, 1], size), null);
  assert.equal(projectCorners(shift(5, 5), size)?.length, 4);
});

test('clips a polygon to the image', () => {
  const square = [
    { x: 50, y: 50 },
    { x: 150, y: 50 },
    { x: 150, y: 150 },
    { x: 50, y: 150 },
  ];
  const clipped = clipPolygon(square, size);
  assert.ok(near(Math.abs(polygonArea(clipped)), 2500));
  const c = polygonCentroid(clipped);
  assert.ok(near(c.x, 75) && near(c.y, 75));
  assert.deepEqual(
    clipPolygon(
      square.map((p) => ({ x: p.x + 200, y: p.y })),
      size,
    ),
    [],
  );
});

test('clips segments to the image', () => {
  assert.deepEqual(clipSegment({ x: -50, y: 50 }, { x: 150, y: 50 }, size), [
    { x: 0, y: 50 },
    { x: 100, y: 50 },
  ]);
  assert.deepEqual(clipSegment({ x: 10, y: 10 }, { x: 20, y: 20 }, size), [
    { x: 10, y: 10 },
    { x: 20, y: 20 },
  ]);
  assert.equal(clipSegment({ x: -10, y: 5 }, { x: 5, y: -10 }, size), null);
  assert.equal(clipSegment({ x: 120, y: 0 }, { x: 120, y: 100 }, size), null);
});

test('builds an overlap for each registered neighbour', () => {
  const rows = [
    { image1Id: 'a', image2Id: 'c', homography: shift(0, -60) },
    { image1Id: 'c', image2Id: 'b', homography: shift(-30, 0) },
    { image1Id: 'c', image2Id: 'u', homography: null },
    { image1Id: 'c', image2Id: 'far', homography: shift(500, 0) },
    { image1Id: 'c', image2Id: 'nosize', homography: shift(5, 0) },
  ];
  const out = neighbourOverlaps('c', size, rows, (id) =>
    id === 'nosize' ? undefined : size,
  );
  assert.deepEqual(
    out.map((o) => o.imageId),
    ['a', 'b'],
  );
  const [a, b] = out;
  assert.ok(near(Math.abs(polygonArea(a.area)), 4000));
  assert.ok(near(a.labelAt.x, 50) && near(a.labelAt.y, 20));
  assert.ok(near(Math.abs(polygonArea(b.area)), 7000));
  assert.ok(near(b.labelAt.x, 65) && near(b.labelAt.y, 50));
  // a sits above c: only its bottom edge and part of its sides show.
  assert.equal(a.edges.length, 3);
  for (const o of out)
    for (const [p, q] of [...o.edges, ...o.grid])
      for (const pt of [p, q])
        assert.ok(pt.x >= 0 && pt.x <= 100 && pt.y >= 0 && pt.y <= 100);
  assert.ok(b.grid.length > 0);
});

test('colours neighbours in time order', () => {
  const times: Record<string, number> = { a: 30, b: 10, c: 20 };
  const out = colourOverlaps(
    [{ imageId: 'a' }, { imageId: 'b' }, { imageId: 'c' }, { imageId: 'd' }],
    (id) => times[id],
  );
  assert.deepEqual(
    out.map((o) => [o.imageId, o.colour]),
    [
      ['b', OVERLAP_COLOURS[0]],
      ['c', OVERLAP_COLOURS[1]],
      ['a', OVERLAP_COLOURS[2]],
      ['d', OVERLAP_COLOURS[3]],
    ],
  );
});
