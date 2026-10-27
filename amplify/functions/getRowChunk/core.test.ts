import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { decodeRows } from '../../../shared/rowChunk';
import { ROW_SOURCES, type RowSource } from '../../../shared/rowSources';
import { decodeCursor, joinRows, readChunk, type QueryPage } from './core';

const images: RowSource = ROW_SOURCES.imagesByProjectId;
const processedBy: RowSource = ROW_SOURCES.processedByProjectIdAndSource;
const FIELDS = ['cameraId', 'originalPath', 'latitude', 'timestamp'];

const items = Array.from({ length: 500 }, (_, i) => ({
  id: `img-${String(i).padStart(4, '0')}`,
  cameraId: 'cam',
  originalPath: `flight/IMG_${i}.JPG`,
  latitude: -24 + i / 1000,
  timestamp: 1_700_000_000 + ((i * 7919) % 500),
}));

function fakeIndex(
  rows: Record<string, unknown>[],
  pageSize: number,
  key: (row: Record<string, unknown>) => string = (row) => String(row.id)
): QueryPage {
  return async (startKey, limit) => {
    assert.ok(!startKey || startKey.projectId === 'p');
    const from = startKey
      ? rows.findIndex((r) => key(r) === key(startKey)) + 1
      : 0;
    const page = rows.slice(from, from + Math.min(pageSize, limit));
    const end = from + page.length;
    return {
      Items: page,
      LastEvaluatedKey:
        end < rows.length ? { ...rows[end - 1], projectId: 'p' } : undefined,
    };
  };
}

const unpack = (source: RowSource, data: string) =>
  decodeRows(
    JSON.parse(gunzipSync(Buffer.from(data, 'base64')).toString()),
    source.fields
  );

async function readAll(
  source: RowSource,
  queryPage: QueryPage,
  fields: string[],
  options: Parameters<typeof readChunk>[4]
) {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let chunks = 0;
  do {
    const chunk = await readChunk(
      queryPage,
      source,
      decodeCursor(source, 'p', cursor),
      fields,
      options
    );
    assert.ok(chunk.data.length <= options.maxPayloadBytes);
    const decoded = unpack(source, chunk.data);
    assert.equal(decoded.length, chunk.count);
    rows.push(...decoded);
    chunks++;
    cursor = chunk.cursor;
  } while (cursor);
  return { rows, chunks };
}

test('trimmed chunks resume after the last packed row', async () => {
  const { rows, chunks } = await readAll(images, fakeIndex(items, 37), FIELDS, {
    maxPayloadBytes: 1200,
    rowTarget: 200,
    readDeadlineMs: 60_000,
  });
  assert.ok(chunks > 2);
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    items.map((r) => r.id)
  );
});

test('composite keys round trip through the cursor', async () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({
    imageId: `img-${Math.floor(i / 3)}`,
    source: `model-${i % 3}`,
  }));
  const key = (row: Record<string, unknown>) => `${row.imageId}/${row.source}`;
  const { rows: seen, chunks } = await readAll(
    processedBy,
    fakeIndex(rows, 40, key),
    [],
    { maxPayloadBytes: 600, rowTarget: 64, readDeadlineMs: 60_000 }
  );
  assert.ok(chunks > 3);
  assert.deepEqual(seen.map(key).sort(), rows.map(key).sort());
});

test('an empty scope returns one empty, final chunk', async () => {
  const chunk = await readChunk(fakeIndex([], 10), images, undefined, FIELDS, {
    maxPayloadBytes: 3000,
    rowTarget: 100,
    readDeadlineMs: 60_000,
  });
  assert.equal(chunk.count, 0);
  assert.equal(chunk.cursor, null);
  assert.deepEqual(unpack(images, chunk.data), []);
});

test('stops reading at the deadline and continues from the cursor', async () => {
  let clock = 0;
  const options = {
    maxPayloadBytes: 1_000_000,
    rowTarget: 1000,
    readDeadlineMs: 10,
    now: () => (clock += 6),
  };
  const first = await readChunk(
    fakeIndex(items, 50),
    images,
    undefined,
    FIELDS,
    options
  );
  assert.equal(first.count, 100);
  assert.ok(first.cursor);
  const second = await readChunk(
    fakeIndex(items, 50),
    images,
    decodeCursor(images, 'p', first.cursor),
    FIELDS,
    options
  );
  const ids = unpack(images, second.data).map((r) => String(r.id));
  assert.ok(ids.every((id) => id >= 'img-0100'));
});

test('cursors cannot leave the scope or carry other attributes', () => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  assert.deepEqual(decodeCursor(images, 'p', encode({ id: 'a' })), {
    id: 'a',
    projectId: 'p',
  });
  for (const bad of [
    { id: 'a', projectId: 'other' },
    { id: { S: 'a' } },
    {},
    ['a'],
  ]) {
    assert.throws(() => decodeCursor(images, 'p', encode(bad)));
  }
});

test('joins referenced items in batches and retries unprocessed keys', async () => {
  const join = ROW_SOURCES.observationsByAnnotationSetId.join;
  const rows = Array.from({ length: 250 }, (_, i) => ({
    id: `obs-${i}`,
    locationId: `loc-${i % 150}`,
  }));
  rows.push({ id: 'orphan', locationId: 'deleted' });
  const calls: string[][] = [];
  const retried = new Set<string>();
  const joined = await joinRows(
    rows,
    join,
    ['x'],
    async (ids) => {
      calls.push(ids);
      const unprocessed = ids.filter((id) => id === 'loc-7' && !retried.has(id));
      unprocessed.forEach((id) => retried.add(id));
      const items = ids
        .filter((id) => id !== 'deleted' && !unprocessed.includes(id))
        .map((id) => ({ id, x: Number(id.slice(4)) }));
      return { items, unprocessed };
    },
    () => true,
    { backoffMs: 0 }
  );
  assert.ok(calls.every((ids) => ids.length <= 100));
  assert.equal(new Set(calls.flat()).size, 151);
  assert.deepEqual(calls.at(-1), ['loc-7']);
  assert.equal(joined[7]['location.x'], 7);
  assert.equal(joined[157]['location.x'], 7);
  assert.equal(joined.at(-1)?.['location.x'], undefined);
});

test('fails when lookups stay unprocessed', async () => {
  await assert.rejects(
    joinRows(
      [{ id: 'o', locationId: 'l' }],
      ROW_SOURCES.observationsByAnnotationSetId.join,
      ['x'],
      async (ids) => ({ items: [], unprocessed: ids }),
      () => true,
      { backoffMs: 0, attempts: 3 }
    )
  );
});

test('drops joined items the caller may not see', async () => {
  const [mine, theirs] = await joinRows(
    [
      { id: 'o1', locationId: 'l1' },
      { id: 'o2', locationId: 'l2' },
    ],
    ROW_SOURCES.observationsByAnnotationSetId.join,
    ['x'],
    async () => ({
      items: [
        { id: 'l1', projectId: 'p', x: 1 },
        { id: 'l2', projectId: 'other', x: 2 },
      ],
      unprocessed: [],
    }),
    (item) => item.projectId === 'p'
  );
  assert.equal(mine['location.x'], 1);
  assert.equal(theirs['location.x'], undefined);
});
