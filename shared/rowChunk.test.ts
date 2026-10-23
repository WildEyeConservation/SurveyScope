import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decodeRows, encodeRows } from './rowChunk';
import { ROW_SOURCES, rowSource, unknownFields } from './rowSources';

const images = ROW_SOURCES.imagesByProjectId;
const IMAGE_FIELDS = Object.keys(images.fields);
const roundTrip = (
  rows: Record<string, unknown>[],
  kinds: Record<string, string>,
  fields = Object.keys(kinds),
  sortBy?: string
) =>
  decodeRows(encodeRows(rows, kinds as never, fields, sortBy), kinds as never);

const image = (overrides: Record<string, unknown>) => ({
  ...Object.fromEntries(IMAGE_FIELDS.map((field) => [field, null])),
  ...overrides,
});

const byId = <T extends Record<string, unknown>>(rows: T[]) =>
  [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));

test('round trips every image field, including nulls and mixed separators', () => {
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
  const decoded = roundTrip(rows, images.fields, IMAGE_FIELDS, 'timestamp');
  assert.deepEqual(byId(decoded), byId(rows));
});

test('round trips booleans and float arrays', () => {
  const kinds = { id: 'str', skipped: 'bool', homography: 'floats' };
  const rows = [
    { id: 'a', skipped: true, homography: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    { id: 'b', skipped: false, homography: [0.5, null, 2] },
    { id: 'c', skipped: null, homography: null },
  ];
  assert.deepEqual(roundTrip(rows, kinds), rows);
});

test('only encodes the requested fields', () => {
  const chunk = encodeRows(
    [{ id: 'a', width: 10, height: 20, latitude: 1 }],
    images.fields,
    ['id', 'width']
  );
  assert.deepEqual(Object.keys(chunk.columns), ['id', 'width']);
  assert.deepEqual(decodeRows(chunk, images.fields), [{ id: 'a', width: 10 }]);
  assert.deepEqual(
    decodeRows(encodeRows([{ id: 'a' }], images.fields, []), images.fields),
    [{}]
  );
});

test('keeps row order unless the sort field is requested', () => {
  const rows = [
    { id: 'b', timestamp: 2 },
    { id: 'a', timestamp: 1 },
  ];
  const ids = (fields: string[]) =>
    decodeRows(
      encodeRows(rows, images.fields, fields, 'timestamp'),
      images.fields
    ).map((row) => row.id);
  assert.deepEqual(ids(['id']), ['b', 'a']);
  assert.deepEqual(ids(['id', 'timestamp']), ['a', 'b']);
});

test('shares directory and dictionary entries between rows', () => {
  const chunk = encodeRows(
    [
      { id: 'a', cameraId: 'cam', originalPath: 'x/y/1.jpg' },
      { id: 'b', cameraId: 'cam', originalPath: 'x/y/2.jpg' },
    ],
    images.fields,
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
  const kinds = {
    latitude: 'num',
    timestamp: 'delta',
    cameraId: 'dict',
    oov: 'bool',
  };
  const [row] = roundTrip(
    [{ latitude: Number.NaN, timestamp: '5', cameraId: 7, oov: 'yes' }],
    kinds
  );
  assert.deepEqual(row, {
    latitude: null,
    timestamp: null,
    cameraId: null,
    oov: null,
  });
});

test('only accepts registered sources and fields', () => {
  assert.ok(rowSource('imagesByProjectId'));
  assert.equal(rowSource('toString'), undefined);
  assert.equal(rowSource('listUsers'), undefined);
  assert.deepEqual(unknownFields(images, ['phash', 'exifData', 'toString']), [
    'exifData',
    'toString',
  ]);
});

test('every source declares its key fields', () => {
  for (const [name, source] of Object.entries(ROW_SOURCES)) {
    assert.deepEqual(unknownFields(source, source.key), [], name);
    assert.ok(!source.key.some((field) => field === source.partitionKey), name);
    if ('sortKey' in source)
      assert.ok(
        source.key.some((f) => f === source.sortKey),
        name
      );
  }
});
