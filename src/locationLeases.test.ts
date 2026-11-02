import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocationLeases } from './locationLeases';

test('skips a duplicate while leased and serves a redelivery after the lease', () => {
  let clock = 0;
  const leases = createLocationLeases(600_000, () => clock);
  assert.equal(leases.claim('a'), true);
  assert.equal(leases.claim('a'), false);
  assert.equal(leases.claim('b'), true);
  // Completion failed and SQS redelivered after the visibility timeout.
  clock = 600_000;
  assert.equal(leases.claim('a'), true);
  leases.release('b');
  assert.equal(leases.claim('b'), true);
});
