import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurveyImagesStore } from './surveyImages';
import { runSurveySave } from './surveySaves';

type Page = { data: { id: string }[]; nextToken: null };

function fakeClient() {
  const calls: {
    resolve: (page: Page) => void;
    reject: (err: Error) => void;
  }[] = [];
  const client = {
    models: {
      Image: {
        imagesByProjectId: () =>
          new Promise<Page>((resolve, reject) =>
            calls.push({ resolve, reject }),
          ),
      },
    },
  };
  const answer = (index: number, ids: string[]) =>
    calls[index].resolve({ data: ids.map((id) => ({ id })), nextToken: null });
  return { client, calls, answer };
}

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('tabs share one fetch, and a late tab sees the progress so far', async () => {
  const { client, calls, answer } = fakeClient();
  const store = createSurveyImagesStore(client, 'shared');
  const close = store.open();
  const first = store.load();
  await tick();
  answer(0, ['a', 'b']);
  assert.deepEqual(ids(await first), ['a', 'b']);
  const progress: number[] = [];
  const second = await store.load({ onProgress: (n) => progress.push(n) });
  assert.deepEqual(ids(second), ['a', 'b']);
  assert.deepEqual(progress, [2]);
  assert.equal(calls.length, 1);
  close();
});

test('leaving a tab detaches it without stopping the fetch', async () => {
  const { client, calls, answer } = fakeClient();
  const store = createSurveyImagesStore(client, 'detach');
  const close = store.open();
  const tab = new AbortController();
  const leaving = store.load({ signal: tab.signal });
  await tick();
  tab.abort();
  await assert.rejects(leaving);
  const next = store.load();
  answer(0, ['a']);
  assert.deepEqual(ids(await next), ['a']);
  assert.equal(calls.length, 1);
  close();
});

test('a refresh hands waiting tabs the new rows', async () => {
  const { client, calls, answer } = fakeClient();
  const store = createSurveyImagesStore(client, 'refresh');
  const close = store.open();
  const waiting = store.load();
  await tick();
  store.refresh();
  await tick();
  answer(1, ['fresh']);
  assert.deepEqual(ids(await waiting), ['fresh']);
  assert.equal(calls.length, 2);
  close();
});

test('rows loaded before a survey save are refetched', async () => {
  const { client, calls, answer } = fakeClient();
  const store = createSurveyImagesStore(client, 'saved');
  const close = store.open();
  const before = store.load();
  await tick();
  answer(0, ['old']);
  await before;
  await runSurveySave('saved', async () => {});
  const after = store.load();
  await tick();
  answer(1, ['new']);
  assert.deepEqual(ids(await after), ['new']);
  assert.equal(calls.length, 2);
  close();
});

test('a failed fetch is retried by the next load', async () => {
  const { client, calls, answer } = fakeClient();
  const store = createSurveyImagesStore(client, 'failed');
  const close = store.open();
  const failing = store.load();
  await tick();
  calls[0].reject(new Error('bad request'));
  await assert.rejects(failing);
  const retry = store.load();
  await tick();
  answer(1, ['a']);
  assert.deepEqual(ids(await retry), ['a']);
  close();
});
