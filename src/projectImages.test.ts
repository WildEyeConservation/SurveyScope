import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { encodeManifest } from '../shared/imageManifest';
import { loadProjectImages } from './projectImages';

const pack = (rows: Record<string, unknown>[]) =>
  gzipSync(JSON.stringify(encodeManifest(rows, ['width']))).toString('base64');

const fallbackRows = [{ id: 'fallback', width: 1 }];
const fallback = async () => fallbackRows;

test('follows cursors and reports progress', async () => {
  const calls: unknown[] = [];
  const pages: Record<
    string,
    { data: string; count: number; cursor: string | null }
  > = {
    start: { data: pack([{ id: 'a', width: 10 }]), count: 1, cursor: 'next' },
    next: { data: pack([{ id: 'b', width: 20 }]), count: 1, cursor: null },
  };
  const client = {
    queries: {
      getImageManifestChunk: async (input: { cursor?: string }) => {
        calls.push(input);
        return { data: JSON.stringify(pages[input.cursor ?? 'start']) };
      },
    },
  };
  const progress: number[] = [];
  const images = await loadProjectImages(client, 'p', ['width'], {
    fallback,
    onProgress: (count) => progress.push(count),
  });
  assert.deepEqual(images, [
    { id: 'a', width: 10 },
    { id: 'b', width: 20 },
  ]);
  assert.deepEqual(progress, [1, 2]);
  assert.deepEqual(calls, [
    { projectId: 'p', cursor: undefined, fields: ['width'] },
    { projectId: 'p', cursor: 'next', fields: ['width'] },
  ]);
});

test('falls back when the query is missing or fails', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(
      await loadProjectImages({ queries: {} }, 'p', ['width'], { fallback }),
      fallbackRows
    );
    const failing = {
      queries: {
        getImageManifestChunk: async () => ({ errors: [{ message: 'boom' }] }),
      },
    };
    assert.deepEqual(
      await loadProjectImages(failing, 'p', ['width'], { fallback }),
      fallbackRows
    );
  } finally {
    console.warn = warn;
  }
});

test('paginates imagesByProjectId by default', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const signal = new AbortController().signal;
    const calls: unknown[][] = [];
    const client = {
      queries: {},
      models: {
        Image: {
          imagesByProjectId: async (...args: unknown[]) => {
            calls.push(args);
            const { nextToken } = args[1] as { nextToken?: string };
            return nextToken
              ? { data: [{ id: 'b', width: 2 }], nextToken: null }
              : { data: [{ id: 'a', width: 1 }], nextToken: 't' };
          },
        },
      },
    };
    const progress: number[] = [];
    const images = await loadProjectImages(client, 'p', ['width'], {
      signal,
      onProgress: (count) => progress.push(count),
    });
    assert.deepEqual(images, [
      { id: 'a', width: 1 },
      { id: 'b', width: 2 },
    ]);
    assert.deepEqual(progress, [1, 2]);
    const options = { limit: 10000, selectionSet: ['id', 'width'] };
    assert.deepEqual(calls, [
      [{ projectId: 'p' }, { ...options, nextToken: undefined }, { signal }],
      [{ projectId: 'p' }, { ...options, nextToken: 't' }, { signal }],
    ]);

    calls.length = 0;
    await loadProjectImages(client, 'p', []);
    assert.deepEqual((calls[0][1] as { selectionSet: string[] }).selectionSet, [
      'id',
    ]);
  } finally {
    console.warn = warn;
  }
});

test('does not fall back once cancelled', async () => {
  const controller = new AbortController();
  const client = {
    queries: {
      getImageManifestChunk: async () => {
        controller.abort();
        throw new Error('aborted');
      },
    },
  };
  let fellBack = false;
  await assert.rejects(
    loadProjectImages(client, 'p', ['width'], {
      signal: controller.signal,
      fallback: async () => {
        fellBack = true;
        return [];
      },
    })
  );
  assert.equal(fellBack, false);
});
