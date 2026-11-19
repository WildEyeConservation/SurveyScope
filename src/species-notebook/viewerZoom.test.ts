import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearViewerZoom,
  reportViewerZoom,
  scaleFromZoom,
  targetZoom,
  viewerScale,
  zoomFromScale,
} from './viewerZoom';

const small = { width: 4000, height: 3000 };
const large = { width: 9000, height: 6000 };

test('matches magnification across image sizes', () => {
  const scale = scaleFromZoom(4, small.width, small.height);
  const zoom = zoomFromScale(scale, large.width, large.height);
  assert.equal(zoom, 6);
  assert.equal(scaleFromZoom(zoom, large.width, large.height), scale);
});

test('prefers the viewer zoom, then the stored default, then framing', () => {
  const scale = scaleFromZoom(3, small.width, small.height);
  assert.equal(targetZoom(small, scale, 6), 3);
  assert.equal(targetZoom(small, null, 6), 5);
  assert.equal(targetZoom(small, null, null), null);
});

test('only the reporting viewer can clear its zoom', () => {
  const first = {};
  const second = {};
  reportViewerZoom(first, 3, small);
  reportViewerZoom(second, 4, small);
  clearViewerZoom(first);
  assert.equal(viewerScale(), scaleFromZoom(4, small.width, small.height));
  clearViewerZoom(second);
  assert.equal(viewerScale(), null);
});
