import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  Context,
  DynamoDBBatchResponse,
  DynamoDBRecord,
  DynamoDBStreamEvent,
} from 'aws-lambda';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

process.env.LOCATION_TABLE_NAME = 'Location-test';
process.env.PROJECT_TABLE_NAME = 'Project-test';

type CommandInput = {
  Key: { id: string };
  ConditionExpression?: string;
  ExpressionAttributeValues?: Record<string, unknown>;
};
type Send = (command: {
  constructor: { name: string };
  input: CommandInput;
}) => Promise<unknown>;
let send: Send = async () => ({});
(DynamoDBDocumentClient.prototype as unknown as { send: Send }).send = (
  command
) => send(command);

// Loaded after the stub so the handler's client uses it (amplify/ is CommonJS,
// so there is no top-level await).
const handlerModule = import('./handler');

const insert = (
  sequenceNumber: string,
  id: string,
  projectId: string,
  group?: Record<string, unknown>
): DynamoDBRecord => ({
  eventName: 'INSERT',
  dynamodb: {
    SequenceNumber: sequenceNumber,
    NewImage: {
      id: { S: id },
      projectId: { S: projectId },
      ...(group ? { group } : {}),
    },
  } as DynamoDBRecord['dynamodb'],
});

const run = async (records: DynamoDBRecord[]) =>
  (await (
    await handlerModule
  ).handler(
    { Records: records } as DynamoDBStreamEvent,
    {} as Context,
    () => undefined
  )) as DynamoDBBatchResponse;

const conditionalCheckFailed = () =>
  Object.assign(new Error('The conditional request failed'), {
    name: 'ConditionalCheckFailedException',
  });

test('sets group only on ungrouped inserts, never creating missing items', async () => {
  const updates: CommandInput[] = [];
  send = async ({ constructor, input }) => {
    if (constructor.name === 'GetCommand') {
      return { Item: { organizationId: 'org-a' } };
    }
    updates.push(input);
    return {};
  };

  const result = await run([
    insert('1', 'loc-1', 'project-a'),
    insert('2', 'loc-2', 'project-a', { S: 'org-a' }),
    insert('3', 'loc-3', 'project-a', { NULL: true }),
    insert('4', 'loc-4', 'project-a', { S: '' }),
    { ...insert('5', 'loc-5', 'project-a'), eventName: 'MODIFY' },
  ]);

  assert.deepEqual(result.batchItemFailures, []);
  assert.deepEqual(updates.map((input) => input.Key.id).sort(), [
    'loc-1',
    'loc-3',
    'loc-4',
  ]);
  for (const input of updates) {
    assert.match(
      input.ConditionExpression ?? '',
      /^attribute_exists\(id\) AND /
    );
    assert.equal(input.ExpressionAttributeValues?.[':g'], 'org-a');
  }
});

test('reports only transiently failed records for retry', async () => {
  send = async ({ constructor, input }) => {
    if (constructor.name === 'GetCommand') {
      return { Item: { organizationId: 'org-b' } };
    }
    if (input.Key.id === 'deleted') throw conditionalCheckFailed();
    if (input.Key.id === 'throttled') {
      throw Object.assign(new Error('Rate exceeded'), {
        name: 'ProvisionedThroughputExceededException',
      });
    }
    return {};
  };

  const result = await run([
    insert('10', 'ok', 'project-b'),
    insert('11', 'deleted', 'project-b'),
    insert('12', 'throttled', 'project-b'),
  ]);

  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: '12' }]);
});

test('drops records for projects without an organization and looks them up again later', async () => {
  let lookups = 0;
  let updates = 0;
  send = async ({ constructor }) => {
    if (constructor.name === 'GetCommand') {
      lookups += 1;
      return {};
    }
    updates += 1;
    return {};
  };

  assert.deepEqual(
    (await run([insert('20', 'loc', 'project-c')])).batchItemFailures,
    []
  );
  assert.deepEqual(
    (await run([insert('21', 'loc', 'project-c')])).batchItemFailures,
    []
  );
  assert.equal(lookups, 2);
  assert.equal(updates, 0);
});

test('retries a failed project lookup instead of caching the failure', async () => {
  let lookups = 0;
  send = async ({ constructor }) => {
    if (constructor.name === 'GetCommand') {
      lookups += 1;
      if (lookups === 1) throw new Error('network');
      return { Item: { organizationId: 'org-d' } };
    }
    return {};
  };

  const first = await run([insert('30', 'loc', 'project-d')]);
  assert.deepEqual(first.batchItemFailures, [{ itemIdentifier: '30' }]);
  const second = await run([insert('30', 'loc', 'project-d')]);
  assert.deepEqual(second.batchItemFailures, []);
  assert.equal(lookups, 2);
});

test('shares one project lookup and bounds concurrent updates', async () => {
  let lookups = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  send = async ({ constructor }) => {
    if (constructor.name === 'GetCommand') {
      lookups += 1;
      return { Item: { organizationId: 'org-e' } };
    }
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    return {};
  };

  const records = Array.from({ length: 50 }, (_, index) =>
    insert(String(100 + index), `loc-${index}`, 'project-e')
  );
  const result = await run(records);

  assert.deepEqual(result.batchItemFailures, []);
  assert.equal(lookups, 1);
  assert.equal(maxInFlight, 10);
});
