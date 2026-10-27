import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { encodeRows } from '../shared/rowChunk';
import { ROW_SOURCES } from '../shared/rowSources';
import { loadProjectImages } from './projectImages';
import { loadRows, streamRows } from './rowChunks';

const pack = (rows: Record<string, unknown>[]) =>
  gzipSync(
    JSON.stringify(
      encodeRows(rows, ROW_SOURCES.imagesByProjectId.fields, ['id', 'width'])
    )
  ).toString('base64');

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
      getRowChunk: async (input: { cursor?: string }) => {
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
    {
      source: 'imagesByProjectId',
      scopeId: 'p',
      fields: ['width'],
      cursor: undefined,
    },
    {
      source: 'imagesByProjectId',
      scopeId: 'p',
      fields: ['width'],
      cursor: 'next',
    },
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
        getRowChunk: async () => ({ errors: [{ message: 'boom' }] }),
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
      getRowChunk: async () => {
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

test('paginates sort-key prefixes through the matching model query', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const calls: unknown[][] = [];
    const client = {
      queries: {},
      models: {
        Location: {
          locationsByProjectIdAndSource: async (...args: unknown[]) => {
            calls.push(args);
            return { data: [{ id: 'l', source: 'mad-v1' }], nextToken: null };
          },
        },
      },
    };
    const rows = await loadRows(
      client,
      'locationsByProjectIdAndSource',
      'p',
      ['x'],
      { beginsWith: 'mad' }
    );
    assert.deepEqual(rows, [{ id: 'l', source: 'mad-v1' }]);
    assert.deepEqual(calls[0][0], {
      projectId: 'p',
      source: { beginsWith: 'mad' },
    });
    assert.deepEqual((calls[0][1] as { selectionSet: string[] }).selectionSet, [
      'id',
      'source',
      'x',
    ]);
  } finally {
    console.warn = warn;
  }
});

test('streams fall back only before the first chunk', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const failing = {
      queries: { getRowChunk: async () => ({ errors: [{ message: 'boom' }] }) },
    };
    const seen: unknown[] = [];
    await streamRows(
      failing,
      'imagesByProjectId',
      'p',
      ['width'],
      (rows) => seen.push(...rows),
      {
        fallback: async (onRows) => onRows([{ id: 'f', width: 1 }]),
      }
    );
    assert.deepEqual(seen, [{ id: 'f', width: 1 }]);

    let calls = 0;
    const halfway = {
      queries: {
        getRowChunk: async () =>
          calls++ === 0
            ? {
                data: {
                  data: pack([{ id: 'a', width: 1 }]),
                  count: 1,
                  cursor: 'next',
                },
              }
            : { errors: [{ message: 'boom' }] },
      },
    };
    let fellBack = false;
    await assert.rejects(
      streamRows(halfway, 'imagesByProjectId', 'p', ['width'], () => {}, {
        fallback: async () => {
          fellBack = true;
        },
      }),
      /boom/
    );
    assert.equal(fellBack, false);
  } finally {
    console.warn = warn;
  }
});

test('paginates sort-key ranges', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const calls: unknown[][] = [];
    const client = {
      queries: {},
      models: {
        Location: {
          locationsBySetIdAndConfidence: async (...args: unknown[]) => {
            calls.push(args);
            return { data: [], nextToken: null };
          },
        },
      },
    };
    await loadRows(client, 'locationsBySetIdAndConfidence', 's', ['x'], {
      between: [0.6, 1],
    });
    assert.deepEqual(calls[0][0], {
      setId: 's',
      confidence: { between: [0.6, 1] },
    });
  } finally {
    console.warn = warn;
  }
});

test('flattens joined fields when paginating', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const client = {
      queries: {},
      models: {
        Observation: {
          observationsByAnnotationSetId: async () => ({
            data: [
              { id: 'o1', locationId: 'l1', location: { x: 5, imageId: 'i' } },
              { id: 'o2', locationId: 'gone', location: null },
            ],
            nextToken: null,
          }),
        },
      },
    };
    const rows = await loadRows(
      client,
      'observationsByAnnotationSetId',
      'a',
      ['locationId', 'location.x', 'location.imageId']
    );
    assert.deepEqual(
      rows.map((row) => [row['location.x'], row['location.imageId']]),
      [
        [5, 'i'],
        [undefined, undefined],
      ]
    );
  } finally {
    console.warn = warn;
  }
});
