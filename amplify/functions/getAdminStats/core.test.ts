import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { rollUp } from './core';

test('rollUp sums project days into months', () => {
  const payload = rollUp([
    { pk: 'PROJECT#p1', sk: 'DAY#2026-09-30', images: 10 },
    { pk: 'PROJECT#p1', sk: 'DAY#2026-10-01', images: 5, annotations: 3 },
    { pk: 'PROJECT#p1', sk: 'DAY#2026-10-27', annotations: 2 },
    { pk: 'USERS', sk: '2026-10', newUsers: 2 },
    { pk: 'META', sk: 'LAST_RUN', updatedAt: '2026-10-27T10:00:00.000Z' },
  ]);
  assert.deepEqual(payload, {
    projects: {
      p1: {
        '2026-09': { images: 10, annotations: 0 },
        '2026-10': { images: 5, annotations: 5 },
      },
    },
    users: { '2026-10': { newUsers: 2, activeUsers: 0 } },
    updatedAt: '2026-10-27T10:00:00.000Z',
  });
});
