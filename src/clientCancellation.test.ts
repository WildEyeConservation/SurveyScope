import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCallOptions, startCancellable } from './clientCancellation';

test('signal and retry are stripped while Amplify options pass through', () => {
  const signal = new AbortController().signal;
  const { args, options } = splitCallOptions([
    { projectId: 'p' },
    { selectionSet: ['id'], nextToken: 't', signal, retry: false },
  ]);
  assert.deepEqual(args, [
    { projectId: 'p' },
    { selectionSet: ['id'], nextToken: 't' },
  ]);
  assert.deepEqual(options, { signal, retry: false });
});

test('a trailing object holding only call options is dropped', () => {
  const signal = new AbortController().signal;
  const { args } = splitCallOptions([{ projectId: 'p' }, { signal }]);
  assert.deepEqual(args, [{ projectId: 'p' }]);
});

test('arguments without call options are untouched', () => {
  const args = [{ projectId: 'p' }, { selectionSet: ['id'] }];
  assert.equal(splitCallOptions(args).args, args);
});

test('an aborted signal stops the request from starting', () => {
  const controller = new AbortController();
  controller.abort();
  let started = false;
  assert.throws(() =>
    startCancellable(
      () => {
        started = true;
        return Promise.resolve();
      },
      controller.signal,
      () => {}
    )
  );
  assert.equal(started, false);
});

test('aborting cancels the original in-flight request', async () => {
  const controller = new AbortController();
  const request = new Promise(() => {});
  const cancelled: Promise<unknown>[] = [];
  startCancellable(
    () => request,
    controller.signal,
    (r) => cancelled.push(r)
  );
  controller.abort();
  assert.deepEqual(cancelled, [request]);
});

test('requests without a signal are never cancelled', async () => {
  const cancelled: Promise<unknown>[] = [];
  const result = await startCancellable(
    () => Promise.resolve('saved'),
    undefined,
    (r) => cancelled.push(r)
  );
  assert.equal(result, 'saved');
  assert.equal(cancelled.length, 0);
});
