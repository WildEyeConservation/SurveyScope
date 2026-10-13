import assert from 'node:assert/strict';
import test from 'node:test';
import { makeProjection, pxBoundsCamera } from './imageProjection';

const projection = makeProjection(8192, 8192);
const viewport = { width: 1024, height: 768 };

const centrePx = (left: number, top: number, right: number, bottom: number) => {
  const camera = pxBoundsCamera(projection, viewport, left, top, right, bottom);
  assert.ok(camera);
  const { x, y } = projection.lngLat2px(...camera.center);
  return { x: Math.round(x), y: Math.round(y), zoom: camera.zoom };
};

test('a rectangle past the image edge stays centred on its tile', () => {
  // 512px tile at scale 1.5, in each corner of the image.
  assert.deepEqual(centrePx(-512, -512, 1024, 1024), {
    x: 256,
    y: 256,
    zoom: 3,
  });
  assert.deepEqual(centrePx(7168, 7168, 8704, 8704), {
    x: 7936,
    y: 7936,
    zoom: 3,
  });
});

test('edge and interior tiles fit at the same zoom', () => {
  assert.equal(
    centrePx(-512, -512, 1024, 1024).zoom,
    centrePx(3000, 3000, 4536, 4536).zoom
  );
});

test('an empty viewport or rectangle yields no camera', () => {
  assert.equal(
    pxBoundsCamera(projection, { width: 0, height: 0 }, 0, 0, 512, 512),
    null
  );
  assert.equal(pxBoundsCamera(projection, viewport, 100, 100, 100, 100), null);
});
