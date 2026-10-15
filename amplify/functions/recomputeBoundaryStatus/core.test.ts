import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  boundaryStatusChange,
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
