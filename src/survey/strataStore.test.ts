import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sameShape,
  saveStrataRows,
  strataReshaped,
  type StrataClient,
} from './strataStore';
import type { LatLng } from './strataNetwork';

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

function fakeClient(failCreate: number | null) {
  const rows = new Map<string, { name: string; coordinates: number[] }>();
  let creates = 0;
  const client = {
    models: {
      Stratum: {
        async create(input: { name: string; coordinates: number[] }) {
          creates += 1;
          if (creates === failCreate) return { errors: ['create failed'] };
          const id = `s${creates}`;
          rows.set(id, input);
          return { data: { id } };
        },
        async update() {
          return { data: {} };
        },
        async delete({ id }: { id: string }) {
          rows.delete(id);
          return { data: {} };
        },
      },
    },
  } as unknown as StrataClient;
  return { client, rows };
}

test('retrying after a partial save leaves one row per stratum', async () => {
  const { client, rows } = fakeClient(2);
  const named = [
    { name: 'West', coords: west },
    { name: 'East', coords: east },
  ];
  await assert.rejects(saveStrataRows(client, 'p', 'g', named, []));
  assert.equal(rows.size, 1);
  const reloaded = [...rows].map(([id, row]) => ({
    id,
    name: row.name,
    coords: west,
  }));
  assert.equal(strataReshaped(named, reloaded), true);
  const strata = await saveStrataRows(client, 'p', 'g', named, reloaded);
  assert.equal(rows.size, 2);
  assert.deepEqual(
    strata.map((st) => st.name),
    ['West', 'East']
  );
});

test('a renamed stratum with the same shape is not reshaped', () => {
  assert.equal(
    strataReshaped(
      [{ id: 'w', name: 'Renamed', coords: [...west].reverse() }],
      [{ id: 'w', name: 'West', coords: west }]
    ),
    false
  );
});

test('shapes match regardless of start point, direction and float noise', () => {
  const noisy = west.map(([lat, lng]) => [lat + 1e-12, lng] as LatLng);
  assert.ok(sameShape(west, [...noisy.slice(2), ...noisy.slice(0, 2)]));
  assert.ok(sameShape(west, [...west].reverse()));
  assert.ok(!sameShape(west, east));
});
