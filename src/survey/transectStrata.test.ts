import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllPaginatedResults } from '../utils';
import { carryStrata, type LatLng } from './transectStrata';

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
