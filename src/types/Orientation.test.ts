import assert from 'node:assert/strict';
import test from 'node:test';
import {
  orientationCorrectionFor,
  orientationGroupForDimensions,
  type CameraOrientationRotations,
} from './Orientation';

test('groups source images using displayed width and height only', () => {
  assert.equal(orientationGroupForDimensions(4000, 3000), 'landscape');
  assert.equal(orientationGroupForDimensions(3000, 4000), 'portrait');
  assert.equal(orientationGroupForDimensions(3000, 3000), 'landscape');
});

test('resolves independent landscape and portrait corrections per camera', () => {
  const rotations: CameraOrientationRotations = {
    CameraA: { landscape: 90, portrait: 270 },
    CameraB: { landscape: 180 },
  };

  assert.equal(orientationCorrectionFor(rotations, 'CameraA', 'landscape'), 90);
  assert.equal(orientationCorrectionFor(rotations, 'CameraA', 'portrait'), 270);
  assert.equal(orientationCorrectionFor(rotations, 'CameraB', 'portrait'), 0);
  assert.equal(
    orientationCorrectionFor({ CameraC: 90 }, 'CameraC', 'portrait'),
    90,
  );
});
