import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as turf from '@turf/turf';
import { fetchAllPaginatedResults } from '../utils';
import { carryStrata, type LatLng } from './transectStrata';
import { ringToPolygon } from './new-survey/surveyArea';

test('saved strata keep their name when a line moves', () => {
  const west: LatLng[] = [
    [0, 0],
    [1, 0],
    [1, 0.5],
    [0, 0.5],
  ];
  const east: LatLng[] = [
    [0, 0.5],
    [1, 0.5],
    [1, 1],
    [0, 1],
  ];
  const carried = carryStrata(
    [
      [
        [0, 0.6],
        [1, 0.6],
        [1, 1],
        [0, 1],
      ],
      [
        [0, 0],
        [1, 0],
        [1, 0.6],
        [0, 0.6],
      ],
      [
        [5, 5],
        [6, 5],
        [6, 6],
        [5, 6],
      ],
    ],
    [
      { id: 'w', name: 'West', coords: west },
      { id: 'e', name: 'East', coords: east },
    ]
  );
  assert.deepEqual(
    carried.map(({ id, name }) => [id, name]),
    [
      ['e', 'East'],
      ['w', 'West'],
      [undefined, 'Stratum 1'],
    ]
  );
});

function assertClipThrows(a: LatLng[], b: LatLng[]) {
  assert.throws(() =>
    turf.intersect(
      turf.featureCollection([ringToPolygon(a)!, ringToPolygon(b)!])
    )
  );
}

test('strata survive clipping that only works on rounded coordinates', () => {
  const section: LatLng[] = [
    [-24.899999999395238, 22.47000000048338],
    [-24.889999999730872, 22.450000000626485],
    [-24.869999999032117, 22.450000000606106],
    [-24.879999999464147, 22.450000000020502],
    [-24.869999999239212, 22.450000000057045],
  ];
  const previous: LatLng[] = [
    [-24.889999999470618, 22.47000000077756],
    [-24.879999999974135, 22.46000000090847],
    [-24.89999999913447, 22.47000000071174],
    [-24.879999999719878, 22.480000000807433],
    [-24.869999999064436, 22.45000000036853],
  ];
  assertClipThrows(section, previous);
  const carried = carryStrata(
    [section],
    [{ id: 'p', name: 'Kept', coords: previous }]
  );
  assert.deepEqual(
    carried.map(({ id, name }) => [id, name]),
    [[undefined, 'Stratum 1']]
  );
});

test('strata fall back to an interior point when clipping keeps failing', () => {
  const section: LatLng[] = [
    [1.0000002, 1.0000002],
    [3.0000001, 1],
    [3.0000002, 2.0000001],
    [3.0000001, 1],
    [1.0000002, 2.0000002],
    [2, 2.0000002],
  ];
  const previous: LatLng[] = [
    [1, 1.0000001],
    [2.0000002, 2.0000002],
    [2.0000001, 1.0000001],
    [1, 1],
    [3.0000001, 3],
    [1e-7, 1],
  ];
  assertClipThrows(section, previous);
  const carried = carryStrata(
    [section],
    [{ id: 'p', name: 'Kept', coords: previous }]
  );
  assert.deepEqual(
    carried.map(({ id, name }) => [id, name]),
    [['p', 'Kept']]
  );
});

test('aborting stops paging', async () => {
  const controller = new AbortController();
  let calls = 0;
  const query = async () => {
    calls++;
    controller.abort();
    return { data: [calls], nextToken: 'more' };
  };
  await assert.rejects(
    fetchAllPaginatedResults(query, { limit: 1, signal: controller.signal })
  );
  assert.equal(calls, 1);
});

test('the signal is passed to the query as a trailing option', async () => {
  const controller = new AbortController();
  const seen: unknown[][] = [];
  const query = async (...args: unknown[]) => {
    seen.push(args);
    return { data: [1], nextToken: null };
  };
  await fetchAllPaginatedResults(query, {
    projectId: 'p',
    signal: controller.signal,
  });
  assert.deepEqual(seen[0][0], { projectId: 'p' });
  assert.deepEqual(seen[0][2], { signal: controller.signal });
});

test('default names are renumbered in list order', () => {
  const half = (lng: number): LatLng[] => [
    [0, lng],
    [1, lng],
    [1, lng + 0.5],
    [0, lng + 0.5],
  ];
  const carried = carryStrata(
    [half(0.5), half(0)],
    [
      {
        id: 'whole',
        name: 'Stratum 1',
        coords: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      },
    ]
  );
  assert.deepEqual(
    carried.map(({ name }) => name),
    ['Stratum 1', 'Stratum 2']
  );
  assert.equal(carried.filter((st) => st.id === 'whole').length, 1);
});
