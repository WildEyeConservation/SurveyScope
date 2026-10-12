import test from 'node:test';
import assert from 'node:assert/strict';
import { createExclusive } from './exclusive';

function setup() {
  const busy: (string | null)[] = [];
  return { busy, run: createExclusive((key) => busy.push(key)) };
}

test('createExclusive skips a second call while one is pending', async () => {
  const { busy, run } = setup();
  let release!: () => void;
  const first = run('a', async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return true;
  });
  let ran = false;
  const second = await run('b', async () => {
    ran = true;
    return true;
  });
  assert.equal(second, undefined);
  assert.equal(ran, false);
  assert.deepEqual(busy, ['a']);
  release();
  assert.equal(await first, true);
  assert.deepEqual(busy, ['a', null]);
});

test('createExclusive clears after a task that returns false', async () => {
  const { busy, run } = setup();
  assert.equal(await run('a', async () => false), false);
  assert.equal(await run('b', async () => true), true);
  assert.deepEqual(busy, ['a', null, 'b', null]);
});

test('createExclusive clears after a task that throws', async () => {
  const { busy, run } = setup();
  await assert.rejects(
    run('a', async () => {
      throw new Error('read failed');
    }),
    /read failed/
  );
  assert.deepEqual(busy, ['a', null]);
  assert.equal(await run('a', async () => true), true);
});
