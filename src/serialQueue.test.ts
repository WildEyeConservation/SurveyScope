import assert from 'node:assert/strict';
import test from 'node:test';
import { createSerialQueue } from './serialQueue';

test('runs operations queued after an empty drain', async () => {
  const queue = createSerialQueue();
  await queue.drain();
  const ran: number[] = [];
  queue.push(async () => {
    ran.push(1);
  });
  await queue.drain();
  assert.deepEqual(ran, [1]);
  assert.equal(queue.busy, false);
});

test('runs operations in order, including ones added mid-drain', async () => {
  const queue = createSerialQueue();
  const ran: number[] = [];
  queue.push(async () => {
    ran.push(1);
    queue.push(async () => {
      ran.push(3);
    });
  });
  queue.push(async () => {
    ran.push(2);
  });
  await queue.drain();
  assert.deepEqual(ran, [1, 2, 3]);
});

test('keeps a failed operation for the next drain', async () => {
  const queue = createSerialQueue();
  let attempts = 0;
  queue.push(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('offline');
  });
  await assert.rejects(queue.drain(), /offline/);
  await queue.drain();
  assert.equal(attempts, 2);
  assert.equal(queue.busy, false);
});
