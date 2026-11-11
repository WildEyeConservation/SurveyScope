import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTileMarker } from './marking';
import type { SampleRow } from './store';

const row: SampleRow = {
  annotationSetId: 'set',
  sk: 'TILE#tile',
  tileId: 'tile',
  imageId: 'image',
  imageKey: 'set#image',
  x: 1000,
  y: 1000,
  width: 2000,
  height: 2000,
  launchNo: 1,
  draw: 0.01,
  status: 'reviewed',
  found: 1,
};

type FakeInput = {
  TableName: string;
  ExclusiveStartKey?: { page: number };
  RequestItems: Record<string, { DeleteRequest: { Key: { id: string } } }[]>;
};

test('covering a reviewed tile can be retried after its cleanup fails', async () => {
  const sent: string[] = [];
  let failReviews = true;
  const db = {
    send: async (command: {
      constructor: { name: string };
      input: FakeInput;
    }) => {
      const { input } = command;
      const name = command.constructor.name;
      if (name === 'QueryCommand' && input.TableName === 'O') {
        if (failReviews) throw new Error('throttled');
        return {
          Items: [
            {
              id: 'review',
              annotationSetId: 'set',
              source: 'x-false-negative',
            },
            {
              id: 'other-set',
              annotationSetId: 'no',
              source: 'x-false-negative',
            },
          ],
        };
      }
      if (name === 'QueryCommand') {
        return {
          Items: [
            { id: 'inside', x: 500, y: 500, source: 'x-false-negative' },
            { id: 'outside', x: 5000, y: 500, source: 'x-false-negative' },
            { id: 'primary', x: 600, y: 600, source: 'manual' },
          ],
        };
      }
      if (name === 'BatchWriteCommand') {
        for (const [table, requests] of Object.entries(input.RequestItems)) {
          for (const request of requests) {
            sent.push(`delete ${table}:${request.DeleteRequest.Key.id}`);
          }
        }
        return {};
      }
      sent.push(name);
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  const marker = createTileMarker(db, {
    samples: 'S',
    Location: 'L',
    Annotation: 'A',
    Observation: 'O',
  });

  await assert.rejects(marker.coverRow(row), /throttled/);
  assert.deepEqual(sent, []);

  failReviews = false;
  assert.equal(await marker.coverRow(row), true);
  assert.deepEqual(sent, [
    'delete O:review',
    'delete A:inside',
    'TransactWriteCommand',
  ]);
});
