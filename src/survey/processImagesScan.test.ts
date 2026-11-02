import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { encodeRows } from '../../shared/rowChunk';
import { ROW_SOURCES, type RowSourceName } from '../../shared/rowSources';
import {
  MODELS,
  dispatchBatches,
  findUnprocessedByModel,
} from './processImagesScan';

const pack = (
  source: RowSourceName,
  fields: string[],
  rows: Record<string, unknown>[],
) =>
  gzipSync(
    JSON.stringify(encodeRows(rows, ROW_SOURCES[source].fields, fields)),
  ).toString('base64');

test('processedBy sources match what the workers write', () => {
  assert.equal(MODELS.mad.source, 'mad-v2');
  assert.equal(MODELS.elephant.source, 'heatmap');
});

test('finds images without an exact processedBy source match', async () => {
  const calls: { source: string; beginsWith?: string }[] = [];
  const client = {
    queries: {
      getRowChunk: async (input: { source: string; beginsWith?: string }) => {
        calls.push(input);
        const data =
          input.source === 'imagesByProjectId'
            ? pack(
                'imagesByProjectId',
                ['id', 'originalPath'],
                [
                  { id: 'a', originalPath: 'a.jpg' },
                  { id: 'b', originalPath: 'b.jpg' },
                  { id: 'c', originalPath: 'c.jpg' },
                ],
              )
            : pack(
                'processedByProjectIdAndSource',
                ['imageId', 'source'],
                input.beginsWith === 'mad-v2'
                  ? [
                      { imageId: 'a', source: 'mad-v2' },
                      { imageId: 'b', source: 'mad-v2-test' },
                    ]
                  : [{ imageId: 'c', source: 'owl-d' }],
              );
        return { data: JSON.stringify({ data, count: 3, cursor: null }) };
      },
    },
  };
  const progress: number[] = [];
  const { total, unprocessed } = await findUnprocessedByModel(
    client,
    'p',
    ['mad', 'owl-d'],
    { onProgress: (count) => progress.push(count) },
  );
  assert.equal(total, 3);
  assert.deepEqual(unprocessed.mad, [
    { id: 'b', originalPath: 'b.jpg' },
    { id: 'c', originalPath: 'c.jpg' },
  ]);
  assert.deepEqual(
    unprocessed['owl-d'].map((image) => image.id),
    ['a', 'b'],
  );
  assert.deepEqual(progress, [3]);
  assert.deepEqual(
    calls
      .filter((c) => c.source === 'processedByProjectIdAndSource')
      .map((c) => c.beginsWith)
      .sort(),
    ['mad-v2', 'owl-d'],
  );
});

test('dispatches every batch with bounded concurrency', async () => {
  let active = 0;
  let peak = 0;
  const sent: number[][] = [];
  const result = await dispatchBatches(
    Array.from({ length: 10 }, (_, i) => i),
    3,
    2,
    async (batch) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      sent.push(batch);
      active--;
    },
  );
  assert.deepEqual(result, { queued: 10, error: undefined });
  assert.equal(peak, 2);
  assert.deepEqual(
    sent.flat().sort((a, b) => a - b),
    Array.from({ length: 10 }, (_, i) => i),
  );
});

test('stops dispatching after a failed batch', async () => {
  const sent: number[][] = [];
  const result = await dispatchBatches([1, 2, 3, 4, 5], 2, 1, async (batch) => {
    if (batch[0] === 3) throw new Error('boom');
    sent.push(batch);
  });
  assert.equal(result.queued, 2);
  assert.equal(result.error?.message, 'boom');
  assert.deepEqual(sent, [[1, 2]]);
});
