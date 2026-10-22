import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  boundaryStatusChange,
  planStrata,
  runSerialized,
  type RecomputeLease,
} from './core';

const options = { sleep: async () => {}, holderCheckMs: 0 };

function fakeLease(overrides: Partial<RecomputeLease>, events: string[]) {
  return {
    acquire: async () => {
      events.push('acquire');
      return true;
    },
    current: async () => null,
    release: async () => {
      events.push('release');
      return true;
    },
    renew: async () => {
      events.push('renew');
    },
    ...overrides,
  } satisfies RecomputeLease;
}

test('a missing status counts as inside', () => {
  assert.equal(boundaryStatusChange(null, 'inside'), 'skip');
  assert.equal(boundaryStatusChange(undefined, null), 'skip');
  assert.equal(boundaryStatusChange('inside', null), 'skip');
  assert.equal(boundaryStatusChange(null, 'outside'), 'set');
  assert.equal(boundaryStatusChange('outside', 'inside'), 'set');
  assert.equal(boundaryStatusChange('excluded', 'outside'), 'set');
  assert.equal(boundaryStatusChange('outside', null), 'remove');
});

test('a live holder keeps the request and this run does nothing', async () => {
  const events: string[] = [];
  const tokens = ['t1', 't2'];
  const lease = fakeLease(
    {
      acquire: async () => {
        events.push('acquire');
        return false;
      },
      current: async () => tokens.shift() ?? null,
    },
    events
  );
  const passes = await runSerialized(
    lease,
    async () => {
      events.push('pass');
    },
    options
  );
  assert.equal(passes, 0);
  assert.deepEqual(events, ['acquire']);
});

test('the lease of a dead holder is taken over once it expires', async () => {
  const events: string[] = [];
  let attempts = 0;
  const lease = fakeLease(
    {
      acquire: async () => {
        events.push('acquire');
        return ++attempts > 2;
      },
      current: async () => 'stale',
    },
    events
  );
  const passes = await runSerialized(
    lease,
    async () => {
      events.push('pass');
    },
    options
  );
  assert.equal(passes, 1);
  assert.deepEqual(events, [
    'acquire',
    'acquire',
    'acquire',
    'pass',
    'release',
  ]);
});

test('a save during a pass triggers another pass', async () => {
  const events: string[] = [];
  let pendingRequests = 1;
  const lease = fakeLease(
    {
      release: async () => {
        events.push('release');
        return pendingRequests-- <= 0;
      },
    },
    events
  );
  const passes = await runSerialized(
    lease,
    async () => {
      events.push('pass');
    },
    options
  );
  assert.equal(passes, 2);
  assert.deepEqual(events, [
    'acquire',
    'pass',
    'release',
    'renew',
    'pass',
    'release',
  ]);
});

const square: [number, number][] = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
];
const south: [number, number][] = [
  [0, 0],
  [0, 1],
  [0.5, 1],
  [0.5, 0],
];
const north: [number, number][] = [
  [0.5, 0],
  [0.5, 1],
  [1, 1],
  [1, 0],
];

function img(
  id: string,
  timestamp: number,
  latitude: number,
  transectId: string | null,
  onEffort = true,
  wasOnEffort = onEffort
) {
  return {
    id,
    timestamp,
    cameraId: null,
    latitude,
    longitude: 0.5,
    onEffort,
    wasOnEffort,
    transectId,
  };
}

test('transects take the stratum of their first image, else the nearest', () => {
  const plan = planStrata({
    images: [
      img('a2', 2, 0.75, 'south-first'),
      img('a1', 1, 0.25, 'south-first'),
      img('b', 1, 0.75, 'north'),
      img('c', 1, 5, 'far-north'),
    ],
    transects: [
      { id: 'south-first', stratumId: 'N' },
      { id: 'north', stratumId: 'N' },
      { id: 'far-north', stratumId: 'S' },
    ],
    strata: [
      { id: 'S', coords: south, offEffort: false },
      { id: 'N', coords: north, offEffort: false },
    ],
    exclusions: [],
  });
  assert.deepEqual(plan.transectStrata, [
    { id: 'south-first', stratumId: 'S' },
    { id: 'far-north', stratumId: 'N' },
  ]);
  assert.deepEqual(
    plan.strata.map((st) => st.id),
    ['S', 'N']
  );
});

test('images leave transects that no longer match their effort', () => {
  const plan = planStrata({
    images: [
      img('kept', 1, 0.5, 't'),
      img('now-outside', 2, 0.5, 't', false),
      img('still-outside', 1, 5, 'out', false),
      img('now-inside', 2, 0.5, 'out'),
    ],
    transects: [
      { id: 't', stratumId: 'A' },
      { id: 'out', stratumId: 'O' },
    ],
    strata: [
      { id: 'A', coords: square, offEffort: false },
      { id: 'O', coords: [], offEffort: true },
    ],
    exclusions: [],
  });
  assert.deepEqual(plan.imageMoves, [
    { id: 'now-outside', from: 't', to: null },
    { id: 'now-inside', from: 'out', to: null },
  ]);
  assert.deepEqual(plan.transectStrata, []);
  assert.equal(plan.strata.length, 1);
});

test('transects of deleted strata move to a current one', () => {
  const plan = planStrata({
    images: [],
    transects: [{ id: 'empty', stratumId: 'gone' }],
    strata: [{ id: 'A', coords: square, offEffort: false }],
    exclusions: [],
  });
  assert.deepEqual(plan.transectStrata, [{ id: 'empty', stratumId: 'A' }]);
});

test('shapeless strata are emptied into shaped ones, then deleted', () => {
  const plan = planStrata({
    images: [img('a', 1, 0.5, 'linked')],
    transects: [{ id: 'linked', stratumId: 'chain' }],
    strata: [
      { id: 'chain', coords: [], offEffort: false },
      { id: 'A', coords: square, offEffort: false },
    ],
    exclusions: [],
  });
  assert.deepEqual(plan.transectStrata, [{ id: 'linked', stratumId: 'A' }]);
  assert.deepEqual(plan.deleteStrata, ['chain']);
});

test('surveys with only shapeless strata are left as they are', () => {
  const plan = planStrata({
    images: [img('a', 1, 0.5, 'linked')],
    transects: [{ id: 'linked', stratumId: 'chain' }],
    strata: [{ id: 'chain', coords: [], offEffort: false }],
    exclusions: [],
  });
  assert.deepEqual(plan.transectStrata, []);
  assert.deepEqual(plan.deleteStrata, []);
  assert.deepEqual(plan.strata, []);
});

test('images back inside the boundary join the transect they were flown on', () => {
  // One image a second along a line, then a separate pass a minute later.
  const at = (second: number) => 0.5 + second * 0.00005;
  const flown = (id: string, second: number, transectId: string | null) =>
    img(id, second * 1000, at(second), transectId);
  const back = (id: string, second: number, transectId: string | null) =>
    img(id, second * 1000, at(second), transectId, true, false);
  const plan = planStrata({
    images: [
      back('before-start', 0, null),
      flown('first', 1, 't'),
      flown('middle', 2, 't'),
      flown('last', 3, 't'),
      back('after-end', 4, 'out'),
      back('own-pass', 64, null),
      back('own-pass-2', 65, null),
      flown('never-assigned', 2.5, null),
    ],
    transects: [
      { id: 't', stratumId: 'A' },
      { id: 'out', stratumId: 'O' },
    ],
    strata: [
      { id: 'A', coords: square, offEffort: false },
      { id: 'O', coords: [], offEffort: true },
    ],
    exclusions: [],
  });
  assert.deepEqual(
    plan.imageMoves.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: 'after-end', from: 'out', to: 't' },
      { id: 'before-start', from: null, to: 't' },
    ]
  );
});

test('an exclusion between kept and returning images keeps their transect', () => {
  // Line t flies north at about 55 m/s, turns, and line u flies back 550 m east.
  const capture = (
    second: number,
    position: [number, number],
    transectId: string | null,
    effort: [boolean, boolean]
  ) => ({
    ...img(`c${second}`, second * 1000, position[0], transectId, ...effort),
    longitude: position[1],
  });
  const north = (s: number): [number, number] => [0.1 + s * 0.0005, 0.5];
  const south = (s: number): [number, number] => [
    0.125 - (s - 100) * 0.0005,
    0.505,
  ];
  const images = [];
  for (let s = 0; s < 50; s++) {
    if (s < 10) images.push(capture(s, north(s), 't', [true, true]));
    else if (s < 40) images.push(capture(s, north(s), null, [false, false]));
    else images.push(capture(s, north(s), null, [true, false]));
  }
  for (let s = 50; s < 100; s++) {
    images.push(
      capture(s, [0.125, 0.5 + (s - 50) * 0.0001], null, [false, false])
    );
  }
  for (let s = 100; s < 110; s++) {
    images.push(capture(s, south(s), null, [true, false]));
  }
  for (let s = 110; s < 120; s++) {
    images.push(capture(s, south(s), 'u', [true, true]));
  }
  const plan = planStrata({
    images,
    transects: [
      { id: 't', stratumId: 'A' },
      { id: 'u', stratumId: 'A' },
    ],
    strata: [{ id: 'A', coords: square, offEffort: false }],
    exclusions: [],
  });
  const to = Object.fromEntries(plan.imageMoves.map((m) => [m.id, m.to]));
  for (let s = 40; s < 50; s++) assert.equal(to[`c${s}`], 't', `c${s}`);
  for (let s = 100; s < 110; s++) assert.equal(to[`c${s}`], 'u', `c${s}`);
  assert.equal(Object.keys(to).length, 20);
});

function flight(
  legs: {
    seconds: [number, number];
    longitude: number;
    transectId: string | null;
    effort: [boolean, boolean];
    gps?: boolean;
  }[]
) {
  return legs.flatMap(
    ({ seconds, longitude, transectId, effort, gps = true }) =>
      Array.from({ length: seconds[1] - seconds[0] }, (_, k) => {
        const second = seconds[0] + k;
        const image = img(
          `c${second}`,
          second * 1000,
          0.1 + (second % 30) * 0.0005,
          transectId,
          ...effort
        );
        return gps
          ? { ...image, longitude }
          : { ...image, latitude: null, longitude: null };
      })
  );
}

const lineStrata = {
  transects: [
    { id: 't', stratumId: 'A' },
    { id: 'u', stratumId: 'A' },
  ],
  strata: [{ id: 'A', coords: square, offEffort: false }],
  exclusions: [],
};

test('a whole line newly inside the boundary is not merged into a neighbour', () => {
  const plan = planStrata({
    ...lineStrata,
    images: flight([
      {
        seconds: [0, 20],
        longitude: 0.5,
        transectId: 't',
        effort: [true, true],
      },
      {
        seconds: [20, 30],
        longitude: 0.501,
        transectId: null,
        effort: [false, false],
      },
      {
        seconds: [30, 50],
        longitude: 0.503,
        transectId: null,
        effort: [true, false],
      },
      {
        seconds: [50, 60],
        longitude: 0.506,
        transectId: null,
        effort: [false, false],
      },
      {
        seconds: [60, 80],
        longitude: 0.51,
        transectId: 'u',
        effort: [true, true],
      },
    ]),
  });
  assert.deepEqual(plan.imageMoves, []);
});

test('a transect without GPS is matched by time, not against distances', () => {
  const plan = planStrata({
    ...lineStrata,
    images: flight([
      {
        seconds: [0, 10],
        longitude: 0.5,
        transectId: 't',
        effort: [true, true],
        gps: false,
      },
      {
        seconds: [10, 20],
        longitude: 0.5,
        transectId: null,
        effort: [true, false],
      },
      {
        seconds: [20, 30],
        longitude: 0.502,
        transectId: null,
        effort: [false, false],
      },
      {
        seconds: [30, 40],
        longitude: 0.505,
        transectId: 'u',
        effort: [true, true],
      },
    ]),
  });
  assert.deepEqual([...new Set(plan.imageMoves.map((m) => m.to))], ['t']);
  assert.equal(plan.imageMoves.length, 10);
});

test('a transect with one positioned image is matched by time', () => {
  const images = flight([
    {
      seconds: [0, 9],
      longitude: 0.5,
      transectId: 't',
      effort: [true, true],
      gps: false,
    },
    { seconds: [9, 10], longitude: 0.5, transectId: 't', effort: [true, true] },
    {
      seconds: [10, 25],
      longitude: 0.5,
      transectId: null,
      effort: [false, false],
    },
    {
      seconds: [25, 30],
      longitude: 0.5,
      transectId: null,
      effort: [true, false],
    },
  ]);
  const plan = planStrata({ ...lineStrata, images });
  assert.equal(plan.imageMoves.length, 5);
  assert.ok(plan.imageMoves.every((m) => m.to === 't'));
});
