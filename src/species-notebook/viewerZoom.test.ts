import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearViewerZoom,
  reportViewerZoom,
  scaleFromZoom,
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
