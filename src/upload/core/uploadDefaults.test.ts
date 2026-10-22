import test from 'node:test';
import assert from 'node:assert/strict';
import {
  columnMappingForHeaders,
  fetchUploadDefaults,
  mappingForFolders,
  mergeUploadDefaults,
  parseUploadDefaults,
} from './uploadDefaults';
import type { UploadClient } from './types';

const fakeClient = (result: unknown) =>
  ({
    models: { Project: { get: async () => result } },
  } as unknown as UploadClient);

test('parseUploadDefaults reads a saved JSON string', () => {
  const saved = {
    altitudeInMeters: false,
    altitudeType: 'agl',
    altitudeFilter: {
      enabled: true,
      target: '120',
      deviation: '10',
      unit: 'm',
    },
    trimToBoundary: false,
    folderCameraMapping: { left: 'Left Camera' },
    rotations: { 'Left Camera': { landscape: 90 } },
  };
  assert.deepEqual(parseUploadDefaults(JSON.stringify(saved)), saved);
});

test('parseUploadDefaults drops invalid fields', () => {
  assert.deepEqual(
    parseUploadDefaults({
      altitudeInMeters: 'yes',
      altitudeType: 'msl',
      altitudeFilter: {
        enabled: true,
        target: 120,
        deviation: '10',
        unit: 'm',
      },
      folderCameraMapping: { left: '', right: 3, centre: 'Centre' },
      rotations: { A: { landscape: 45, portrait: 270 }, B: 90 },
    }),
    {
      folderCameraMapping: { centre: 'Centre' },
      rotations: { A: { portrait: 270 } },
    }
  );
});

test('parseUploadDefaults returns null for missing or malformed values', () => {
  assert.equal(parseUploadDefaults(null), null);
  assert.equal(parseUploadDefaults('not json'), null);
  assert.equal(parseUploadDefaults('[]'), null);
});

test('mergeUploadDefaults replaces only the cameras and folders uploaded', () => {
  const merged = mergeUploadDefaults(
    {
      trimToBoundary: true,
      folderCameraMapping: { left: 'L', right: 'R' },
      rotations: { L: { landscape: 90 }, R: { portrait: 180 } },
    },
    {
      trimToBoundary: false,
      folderCameraMapping: {},
      rotations: {},
    },
    ['L'],
    ['left']
  );
  assert.deepEqual(merged, {
    trimToBoundary: false,
    folderCameraMapping: { right: 'R' },
    rotations: { R: { portrait: 180 } },
  });
});

test('mappingForFolders keeps only folders in this upload', () => {
  assert.deepEqual(
    mappingForFolders({ left: 'L', right: 'R' }, ['left', 'centre']),
    { left: 'L' }
  );
  assert.deepEqual(mappingForFolders(undefined, ['left']), {});
});

test('parseUploadDefaults keeps __proto__ keys off Object.prototype', () => {
  const parsed = parseUploadDefaults(
    '{"rotations":{"__proto__":{"landscape":90}},"folderCameraMapping":{"__proto__":"A"}}'
  );
  assert.equal(({} as Record<string, unknown>).landscape, undefined);
  assert.deepEqual(Object.keys(parsed?.rotations ?? {}), ['__proto__']);
  assert.deepEqual(mappingForFolders({}, ['constructor']), {});
});

test('fetchUploadDefaults throws on a GraphQL error response', async () => {
  await assert.rejects(
    fetchUploadDefaults(
      fakeClient({ data: null, errors: [{ message: 'Unauthorized' }] }),
      'p1'
    )
  );
  await assert.rejects(fetchUploadDefaults(fakeClient({ data: null }), 'p1'));
});

test('fetchUploadDefaults returns null when nothing was saved yet', async () => {
  assert.equal(
    await fetchUploadDefaults(
      fakeClient({ data: { uploadDefaults: null } }),
      'p1'
    ),
    null
  );
  assert.deepEqual(
    await fetchUploadDefaults(
      fakeClient({ data: { uploadDefaults: '{"trimToBoundary":false}' } }),
      'p1'
    ),
    { trimToBoundary: false }
  );
});

test('parseUploadDefaults keeps known non-empty column mappings', () => {
  assert.deepEqual(
    parseUploadDefaults({
      columnMapping: { filepath: 'File', lat: 'Lat', alt: '', other: 'X' },
    }),
    { columnMapping: { filepath: 'File', lat: 'Lat' } }
  );
});

test('columnMappingForHeaders requires every saved column', () => {
  const mapping = { filepath: 'File', lat: 'Lat', lng: 'Lng' };
  assert.deepEqual(
    columnMappingForHeaders(mapping, ['File', 'Lat', 'Lng', 'Alt']),
    mapping
  );
  assert.equal(columnMappingForHeaders(mapping, ['File', 'Lat']), null);
  assert.equal(columnMappingForHeaders({}, ['File']), null);
  assert.equal(columnMappingForHeaders(undefined, ['File']), null);
});

test('mergeUploadDefaults keeps the saved column mapping for GPX uploads', () => {
  const merged = mergeUploadDefaults(
    { columnMapping: { filepath: 'File' } },
    { trimToBoundary: true },
    [],
    []
  );
  assert.deepEqual(merged.columnMapping, { filepath: 'File' });
});
