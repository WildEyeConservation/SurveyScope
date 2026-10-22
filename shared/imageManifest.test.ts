import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  decodeManifest,
  encodeManifest,
  isManifestField,
  MANIFEST_FIELDS,
  type ManifestImage,
} from './imageManifest';

const image = (overrides: Partial<ManifestImage>): ManifestImage => ({
  id: 'a',
  cameraId: null,
  transectId: null,
  boundaryStatus: null,
  originalPath: null,
  latitude: null,
  longitude: null,
  altitude_agl: null,
  altitude_wgs84: null,
  width: null,
  height: null,
  timestamp: null,
  phash: null,
  ...overrides,
});

const byId = <T extends { id: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

test('round trips every field, including nulls and mixed separators', () => {
  const rows = [
    image({
      id: 'c',
      cameraId: 'cam-1',
      transectId: 't-1',
      boundaryStatus: 'outside',
      originalPath: 'flight/left/IMG_0003.JPG',
      latitude: -24.123456789,
      longitude: 31.5,
      altitude_agl: 120.25,
      altitude_wgs84: 850,
      width: 6000,
      height: 4000,
      timestamp: 1700000300,
      phash: 'ffd8a1b2c3d4e5f6',
    }),
    image({
      id: 'a',
      cameraId: 'cam-1',
      transectId: 't-1',
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
  const decoded = decodeManifest(encodeManifest(rows, MANIFEST_FIELDS));
  assert.deepEqual(byId(decoded), byId(rows));
});

test('only encodes the requested fields', () => {
  const chunk = encodeManifest(
    [{ id: 'a', width: 10, height: 20, latitude: 1 }],
    ['width']
  );
  assert.deepEqual(Object.keys(chunk.columns), ['width']);
  assert.deepEqual(decodeManifest(chunk), [{ id: 'a', width: 10 }]);
  assert.deepEqual(decodeManifest(encodeManifest([{ id: 'a' }], [])), [
    { id: 'a' },
  ]);
});

test('keeps row order unless timestamps are requested', () => {
  const rows = [
    { id: 'b', timestamp: 2 },
    { id: 'a', timestamp: 1 },
  ];
  assert.deepEqual(encodeManifest(rows, []).ids, ['b', 'a']);
  assert.deepEqual(encodeManifest(rows, ['timestamp']).ids, ['a', 'b']);
});

test('shares directory and dictionary entries between rows', () => {
  const chunk = encodeManifest(
    [
      { id: 'a', cameraId: 'cam', originalPath: 'x/y/1.jpg' },
      { id: 'b', cameraId: 'cam', originalPath: 'x/y/2.jpg' },
    ],
    ['cameraId', 'originalPath']
  );
  assert.deepEqual(chunk.columns.originalPath, {
    dirs: ['x/y/'],
    dir: [0, 0],
    names: ['1.jpg', '2.jpg'],
  });
  assert.deepEqual(chunk.columns.cameraId, { values: ['cam'], index: [0, 0] });
});

test('drops values of the wrong type', () => {
  const [row] = decodeManifest(
    encodeManifest(
      [{ id: 'a', latitude: Number.NaN, timestamp: '5', cameraId: 7 }],
      ['latitude', 'timestamp', 'cameraId']
    )
  );
  assert.equal(row.latitude, null);
  assert.equal(row.timestamp, null);
  assert.equal(row.cameraId, null);
});

test('only accepts known fields', () => {
  assert.ok(isManifestField('phash'));
  assert.ok(!isManifestField('exifData'));
  assert.ok(!isManifestField('toString'));
});
