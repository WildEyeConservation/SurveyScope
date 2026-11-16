import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteFalseNegativeWork, type ResetProgress } from './reads';

const tables = { Location: 'L', Observation: 'O', Annotation: 'A' };

type FakeInput = {
  TableName: string;
  ExclusiveStartKey?: { page: number };
  RequestItems: Record<string, { DeleteRequest: { Key: { id: string } } }[]>;
};

test('an interrupted reset resumes where it stopped', async () => {
  const pages: Record<string, { id: string; source: string }[][]> = {
    O: [
      [{ id: 'o1', source: 'manual-Primary' }],
      [{ id: 'o2', source: 'manual-x-false-negative' }],
      [{ id: 'o3', source: 'manual-x-false-negative' }],
    ],
    A: [[{ id: 'a1', source: 'manual-x-false-negative' }]],
  };
  const queried: string[] = [];
  const deleted: string[] = [];
  const db = {
    send: async (command: {
      constructor: { name: string };
      input: FakeInput;
    }) => {
      const { input } = command;
      if (command.constructor.name === 'QueryCommand') {
        const page = input.ExclusiveStartKey?.page ?? 0;
        queried.push(`${input.TableName}${page}`);
        return {
          Items: pages[input.TableName][page],
          LastEvaluatedKey:
            page + 1 < pages[input.TableName].length
              ? { page: page + 1 }
              : undefined,
        };
      }
      for (const [table, requests] of Object.entries(input.RequestItems)) {
        for (const request of requests) {
          deleted.push(`${table}:${request.DeleteRequest.Key.id}`);
        }
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  let progress: ResetProgress | null = { stage: 0 };
  let invocations = 0;
  while (progress) {
    invocations += 1;
    progress = await deleteFalseNegativeWork(
      db,
      tables,
      'set',
      progress,
      () => true,
    );
  }

  assert.deepEqual(queried, ['O0', 'O1', 'O2', 'A0']);
  assert.deepEqual(deleted.sort(), ['A:a1', 'O:o2', 'O:o3']);
  assert.equal(invocations, 3);
});
