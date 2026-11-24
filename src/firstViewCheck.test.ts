import assert from 'node:assert/strict';
import test from 'node:test';
import { firstViewCheck } from './firstViewCheck';

test('only the first viewing can reject a task', async () => {
  let calls = 0;
  const revalidate = firstViewCheck(async () => {
    calls++;
    return false;
  });
  assert.equal(await revalidate(), false);
  assert.equal(await revalidate(), true);
  assert.equal(calls, 1);
});
