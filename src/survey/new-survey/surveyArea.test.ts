import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyImport,
  outsideAreaKeys,
  polygonsFromGeoJson,
  pruneOutsideArea,
  ringAreaKm2,
  setImportRole,
  suggestRoles,
  traceAroundPoints,
  type AreaRole,
  type ImportedPolygon,
  type LatLng,
} from './surveyArea.ts';
import { loadSurveyArea, saveSurveyArea } from '../../utils/shapefileUtils.ts';

// [lng, lat] closed square, as GeoJSON stores it.
// Offset longitude to expose lat/lng swaps.
const EAST = 30;
const square = (west: number, minLat: number, size: number) => [
  [EAST + west, minLat],
  [EAST + west + size, minLat],
  [EAST + west + size, minLat + size],
  [EAST + west, minLat + size],
  [EAST + west, minLat],
];

const block: LatLng[] = [
  [0, EAST],
  [0, EAST + 1],
  [1, EAST + 1],
  [1, EAST],
];

test('polygonsFromGeoJson splits multipolygons and reports holes', () => {
  const polygons = polygonsFromGeoJson(
    {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Block' },
          geometry: {
            type: 'Polygon',
            coordinates: [square(0, 0, 1), square(0.4, 0.4, 0.1)],
          },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'MultiPolygon',
            coordinates: [[square(5, 5, 1)], [square(8, 8, 1)]],
          },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
      ],
    },
    'area.geojson'
  );
  assert.deepEqual(
    polygons.map((polygon) => polygon.name),
    ['Block', 'Block (hole 1)', 'Polygon 3', 'Polygon 4']
  );
  assert.equal(new Set(polygons.map((polygon) => polygon.id)).size, 4);
  assert.deepEqual(polygons[2].ring[0], [5, EAST + 5]);
  assert.equal(polygons[2].ring.length, 4);
});

test('polygonsFromGeoJson reads shpjs layer arrays and bare geometries', () => {
  const polygons = polygonsFromGeoJson(
    [
      { type: 'FeatureCollection', features: [] },
      { type: 'Polygon', coordinates: [square(0, 0, 1)] },
    ],
    'layers.zip'
  );
  assert.equal(polygons.length, 1);
});

test('polygonsFromGeoJson rejects projected coordinates', () => {
  assert.throws(
    () =>
      polygonsFromGeoJson(
        {
          type: 'Polygon',
          coordinates: [
            [
              [350000, 7200000],
              [351000, 7200000],
              [351000, 7201000],
              [350000, 7200000],
            ],
          ],
        },
        'utm.geojson'
      ),
    /WGS84/
  );
});

test('suggestRoles picks the polygon holding the images as the boundary', () => {
  const polygons = polygonsFromGeoJson(
    {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Buffer' },
          geometry: { type: 'Polygon', coordinates: [square(20, 20, 5)] },
        },
        {
          type: 'Feature',
          properties: { name: 'Block' },
          geometry: { type: 'Polygon', coordinates: [square(0, 0, 1)] },
        },
        {
          type: 'Feature',
          properties: { name: 'Dam' },
          geometry: { type: 'Polygon', coordinates: [square(0.4, 0.4, 0.1)] },
        },
      ],
    },
    'area.geojson'
  );
  const points = [
    { lat: 0.2, lng: EAST + 0.2 },
    { lat: 0.8, lng: EAST + 0.8 },
  ];
  assert.deepEqual(
    suggestRoles(polygons, points, null).map((polygon) => polygon.role),
    ['ignore', 'boundary', 'exclusion']
  );
  assert.equal(suggestRoles(polygons, [], null)[0].role, 'boundary');
  assert.deepEqual(
    suggestRoles(polygons, points, block).map((polygon) => polygon.role),
    ['ignore', 'ignore', 'exclusion']
  );
});

test('setImportRole keeps a single boundary', () => {
  const polygons = suggestRoles(
    polygonsFromGeoJson(
      {
        type: 'MultiPolygon',
        coordinates: [[square(0, 0, 2)], [square(10, 10, 1)]],
      },
      'a.geojson'
    ),
    [],
    null
  );
  const promoted = setImportRole(polygons, polygons[1].id, 'boundary');
  assert.deepEqual(
    promoted.map((polygon) => polygon.role),
    ['ignore', 'boundary']
  );
});

test('applyImport replaces the boundary and appends exclusions', () => {
  const dam: LatLng[] = [
    [0.4, EAST + 0.4],
    [0.4, EAST + 0.5],
    [0.5, EAST + 0.5],
  ];
  const pan: LatLng[] = dam.map(([lat, lng]) => [lat + 0.2, lng]);
  const wider: LatLng[] = block.map(([lat, lng]) => [lat * 2, lng]);
  const other: LatLng[] = block.map(([lat, lng]) => [lat + 9, lng]);
  const imported = (ring: LatLng[], role: AreaRole): ImportedPolygon => ({
    id: role,
    name: role,
    source: 's',
    ring,
    areaKm2: 1,
    role,
  });
  const existing = { boundary: block, exclusions: [dam] };

  const kept = applyImport(existing, [imported(pan, 'exclusion')]);
  assert.equal(kept.boundary, block);
  assert.deepEqual(kept.exclusions, [dam, pan]);

  const replaced = applyImport(existing, [
    imported(wider, 'boundary'),
    imported(pan, 'exclusion'),
    imported(other, 'ignore'),
  ]);
  assert.equal(replaced.boundary, wider);
  assert.deepEqual(replaced.exclusions, [dam, pan]);
});

test('outsideAreaKeys honours the margin and skips unplaced rows', () => {
  const rows = [
    { id: 'in', lat: 0.5, lng: EAST + 0.5 },
    { id: 'near', lat: 0.5, lng: EAST + 1.001 },
    { id: 'far', lat: 0.5, lng: EAST + 3 },
    { id: 'nogps', lat: NaN, lng: NaN },
  ];
  const keyOf = (row: { id: string }) => row.id;
  assert.deepEqual(
    [...outsideAreaKeys(rows, block, 0, keyOf)],
    ['near', 'far']
  );
  assert.deepEqual([...outsideAreaKeys(rows, block, 500, keyOf)], ['far']);
  assert.equal(outsideAreaKeys(rows, null, 0, keyOf).size, 0);
});

test('pruneOutsideArea drops queued images outside the area', () => {
  const image = (originalPath: string, longitude: number) => ({
    originalPath,
    latitude: 0.5,
    longitude,
  });
  const queued = [
    image('in.jpg', EAST + 0.5),
    image('outside.jpg', EAST + 3),
    image('created.jpg', EAST + 3),
  ];
  const kept = pruneOutsideArea(queued, block, 0, new Set(['created.jpg']));
  assert.deepEqual(
    kept.map((entry) => entry.originalPath),
    ['in.jpg', 'created.jpg']
  );
  assert.equal(pruneOutsideArea(queued, null, 0, new Set()).length, 3);
});

test('traceAroundPoints encloses every position', () => {
  const points = [
    { lat: 0, lng: EAST },
    { lat: 0, lng: EAST + 0.1 },
    { lat: 0.1, lng: EAST + 0.1 },
    { lat: 0.1, lng: EAST },
    { lat: 0.05, lng: EAST + 0.05 },
  ];
  const ring = traceAroundPoints(points);
  assert.ok(ring && ring.length >= 4);
  const key = (row: { lat: number; lng: number }) => `${row.lat},${row.lng}`;
  assert.equal(outsideAreaKeys(points, ring, 0, key).size, 0);
  assert.ok(
    ringAreaKm2(ring) >
      ringAreaKm2(points.slice(0, 4).map(({ lat, lng }) => [lat, lng]))
  );

  const line = traceAroundPoints(points.slice(0, 2));
  assert.ok(line && line.length >= 4);
  assert.equal(traceAroundPoints([]), null);
});

type Call = [model: string, method: string, args: Record<string, unknown>];

function fakeClient(respond: (call: Call) => unknown) {
  const calls: Call[] = [];
  const models = new Proxy(
    {},
    {
      get: (_target, model: string) =>
        new Proxy(
          {},
          {
            get:
              (_inner, method: string) =>
              async (args: Record<string, unknown>) => {
                const call: Call = [model, method, args];
                calls.push(call);
                return respond(call) ?? { data: [] };
              },
          }
        ),
    }
  );
  return { client: { models }, calls };
}

test('saveSurveyArea stores the boundary and replaces exclusions', async () => {
  const { client, calls } = fakeClient(([model, method]) =>
    model === 'ShapefileExclusions' && method.endsWith('ByProjectId')
      ? { data: [{ id: 'old' }] }
      : undefined
  );
  await saveSurveyArea(
    client,
    'p1',
    { boundary: block, exclusions: [block.slice(0, 3)] },
    'org'
  );
  const boundary = calls.find(
    ([model, method]) => model === 'Shapefile' && method === 'create'
  );
  assert.deepEqual((boundary?.[2].coordinates as number[]).slice(0, 4), [
    0,
    EAST,
    0,
    EAST + 1,
  ]);
  assert.deepEqual(
    calls
      .filter(([model]) => model === 'ShapefileExclusions')
      .map(([, method]) => method),
    ['shapefileExclusionsByProjectId', 'delete', 'create']
  );
});

test('saveSurveyArea removes a cleared boundary', async () => {
  const { client, calls } = fakeClient(([model, method]) =>
    model === 'Shapefile' && method.endsWith('ByProjectId')
      ? { data: [{ id: 's1' }] }
      : undefined
  );
  await saveSurveyArea(client, 'p1', { boundary: null, exclusions: [] }, 'org');
  assert.ok(
    calls.some(
      ([model, method, args]) =>
        model === 'Shapefile' && method === 'delete' && args.id === 's1'
    )
  );
});

test('area persistence rejects when a request reports errors', async () => {
  const failing = fakeClient(([, method]) =>
    method === 'create'
      ? { data: null, errors: [{ message: 'denied' }] }
      : undefined
  );
  await assert.rejects(
    saveSurveyArea(
      failing.client,
      'p1',
      { boundary: block, exclusions: [] },
      'org'
    ),
    /denied/
  );
  const unreadable = fakeClient(() => ({
    data: null,
    errors: [{ message: 'offline' }],
  }));
  await assert.rejects(loadSurveyArea(unreadable.client, 'p1'), /offline/);
});
