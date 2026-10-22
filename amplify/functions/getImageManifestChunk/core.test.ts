import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { decodeManifest } from '../../../shared/imageManifest';
import { readChunk, type QueryPage } from './core';

const FIELDS = ['cameraId', 'originalPath', 'latitude', 'timestamp'] as const;

const items = Array.from({ length: 500 }, (_, i) => ({
  id: `img-${String(i).padStart(4, '0')}`,
  cameraId: 'cam',
  originalPath: `flight/IMG_${i}.JPG`,
  latitude: -24 + i / 1000,
  timestamp: 1_700_000_000 + ((i * 7919) % 500),
}));

function fakeIndex(rows: typeof items, pageSize: number): QueryPage {
  return async (startKey, limit) => {
    assert.ok(!startKey || startKey.projectId === 'p');
    const from = startKey ? rows.findIndex((r) => r.id === startKey.id) + 1 : 0;
    const page = rows.slice(from, from + Math.min(pageSize, limit));
    const end = from + page.length;
    return {
      Items: page,
      LastEvaluatedKey:
        end < rows.length
          ? { projectId: 'p', id: rows[end - 1].id }
          : undefined,
    };
  };
}

const unpack = (data: string) =>
  decodeManifest(
    JSON.parse(gunzipSync(Buffer.from(data, 'base64')).toString())
  );

test('trimmed chunks resume after the last packed row', async () => {
  const options = {
    maxPayloadBytes: 1200,
    rowTarget: 200,
    readDeadlineMs: 60_000,
  };
  const seen: string[] = [];
  let cursor: string | null = null;
  let chunks = 0;
  do {
    const chunk = await readChunk(
      fakeIndex(items, 37),
      'p',
      cursor,
      FIELDS,
      options
    );
    assert.ok(chunk.data.length <= options.maxPayloadBytes);
    if (chunk.cursor) assert.ok(chunk.count < options.rowTarget);
    const rows = unpack(chunk.data);
    assert.equal(rows.length, chunk.count);
    seen.push(...rows.map((r) => r.id));
    chunks++;
    cursor = chunk.cursor;
  } while (cursor);
  assert.ok(chunks > 2);
  assert.deepEqual(
    [...seen].sort(),
    items.map((r) => r.id)
  );
});

test('an empty project returns one empty, final chunk', async () => {
  const chunk = await readChunk(fakeIndex([], 10), 'p', null, FIELDS, {
    maxPayloadBytes: 3000,
    rowTarget: 100,
    readDeadlineMs: 60_000,
  });
  assert.equal(chunk.count, 0);
  assert.equal(chunk.cursor, null);
  assert.deepEqual(unpack(chunk.data), []);
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
    'p',
    null,
    FIELDS,
    options
  );
  assert.equal(first.count, 100);
  assert.ok(first.cursor);
  const second = await readChunk(
    fakeIndex(items, 50),
    'p',
    first.cursor,
    FIELDS,
    options
  );
  assert.equal(unpack(second.data)[0].id >= 'img-0100', true);
  assert.equal(
    unpack(second.data).some((r) => r.id === 'img-0099'),
    false
  );
});
