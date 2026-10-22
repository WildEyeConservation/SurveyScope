import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  decodeManifest,
  encodeManifest,
  type ManifestImage,
} from './imageManifest';

const image = (overrides: Partial<ManifestImage>): ManifestImage => ({
  id: 'a',
  cameraId: null,
  originalPath: null,
  latitude: null,
  longitude: null,
  altitude_agl: null,
  altitude_wgs84: null,
  timestamp: null,
  ...overrides,
});

const byId = (rows: ManifestImage[]) =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

test('round trips every field, including nulls and mixed separators', () => {
  const rows = [
    image({
      id: 'c',
      cameraId: 'cam-1',
      originalPath: 'flight/left/IMG_0003.JPG',
      latitude: -24.123456789,
      longitude: 31.5,
      altitude_agl: 120.25,
      altitude_wgs84: 850,
      timestamp: 1700000300,
    }),
    image({
      id: 'a',
      cameraId: 'cam-1',
      originalPath: 'flight/left/IMG_0001.JPG',
      timestamp: 1700000100,
    }),
    image({ id: 'b', originalPath: 'C:\\survey\\IMG_0002.JPG' }),
    image({
      id: 'd',
      cameraId: 'cam-2',
      originalPath: 'IMG_0004.JPG',
      timestamp: 0,
    }),
    image({ id: 'e', originalPath: '' }),
  ];
  assert.deepEqual(byId(decodeManifest(encodeManifest(rows))), byId(rows));
});

test('shares directory and camera entries between rows', () => {
  const chunk = encodeManifest([
    image({ id: 'a', cameraId: 'cam', originalPath: 'x/y/1.jpg' }),
    image({ id: 'b', cameraId: 'cam', originalPath: 'x/y/2.jpg' }),
  ]);
  assert.deepEqual(chunk.dirs, ['x/y/']);
  assert.deepEqual(chunk.cameras, ['cam']);
});

test('drops non-numeric values', () => {
  const [row] = decodeManifest(
    encodeManifest([
      image({ latitude: Number.NaN, timestamp: '5' as unknown as number }),
    ])
  );
  assert.equal(row.latitude, null);
  assert.equal(row.timestamp, null);
});
