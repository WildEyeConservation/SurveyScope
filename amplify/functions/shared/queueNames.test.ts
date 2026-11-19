import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DeleteQueueCommand,
  GetQueueUrlCommand,
  ListQueueTagsCommand,
} from '@aws-sdk/client-sqs';
import {
  assertNewQueueUrl,
  buildQueueName,
  deleteBoundQueue,
  queueTags,
} from './queueNames';

const idA = '0b6f1f7e-2c49-4a43-9d0e-3b1f1f2e9a11';
const idB = '5d2c3a4b-7e8f-4a1b-8c9d-0e1f2a3b4c5d';

test('long display names keep the full queue id and stay within 80 chars', () => {
  const longName = 'Survey annotation pass '.repeat(10);
  for (const fifo of [false, true]) {
    const a = buildQueueName(longName, idA, fifo);
    const b = buildQueueName(longName, idB, fifo);
    assert.notEqual(a, b);
    assert.ok(a.includes(idA));
    assert.ok(b.includes(idB));
    assert.ok(a.length <= 80);
    assert.equal(a.endsWith('.fifo'), fifo);
    assert.match(a, /^[a-zA-Z0-9_-]+(\.fifo)?$/);
  }
});

test('short and empty names', () => {
  assert.equal(buildQueueName('My queue', idA), `My_queue-${idA}`);
  assert.equal(buildQueueName('', idA, true), `queue-${idA}.fifo`);
  assert.throws(() => buildQueueName('x', 'bad id'));
});

test('rejects URLs for other names or already recorded', async () => {
  const name = buildQueueName('q', idA);
  const url = `https://sqs.eu-west-1.amazonaws.com/1/${name}`;
  const none = async <T>() => ({ listQueues: { items: [], nextToken: null } }) as T;
  await assertNewQueueUrl(url, name, none);
  await assert.rejects(assertNewQueueUrl(url, buildQueueName('q', idB), none));
  let calls = 0;
  const pagedHit = async <T>() =>
    (++calls === 1
      ? { listQueues: { items: [], nextToken: 't' } }
      : { listQueues: { items: [{ id: 'other' }], nextToken: null } }) as T;
  await assert.rejects(assertNewQueueUrl(url, name, pagedHit), /already uses/);
  assert.equal(calls, 2);
});

function fakeSqs(opts: { tags?: Record<string, string>; account?: string; missing?: boolean }) {
  const deleted: string[] = [];
  return {
    deleted,
    async send(command: unknown) {
      if (command instanceof GetQueueUrlCommand) {
        if (opts.missing) throw Object.assign(new Error('gone'), { name: 'QueueDoesNotExist' });
        return {
          QueueUrl: `https://sqs.eu-west-1.amazonaws.com/${opts.account ?? '1'}/${command.input.QueueName}`,
        };
      }
      if (command instanceof ListQueueTagsCommand) return { Tags: opts.tags };
      if (command instanceof DeleteQueueCommand) {
        deleted.push(command.input.QueueUrl!);
        return {};
      }
      throw new Error('unexpected command');
    },
  };
}

const rows = (ids: string[]) => async <T>() =>
  ({ listQueues: { items: ids.map((id) => ({ id })), nextToken: null } }) as T;

test('deleteBoundQueue deletes tagged queues only for the matching row', async () => {
  const row = { id: idA, projectId: 'p1', url: `https://sqs.eu-west-1.amazonaws.com/1/${buildQueueName('q', idA)}` };
  const ok = fakeSqs({ tags: queueTags('p1', idA) });
  assert.equal(await deleteBoundQueue(ok, row, rows([]), 'eu-west-1'), 'deleted');
  assert.deepEqual(ok.deleted, [row.url]);

  const other = fakeSqs({ tags: queueTags('p2', idA) });
  assert.equal(await deleteBoundQueue(other, row, rows([]), 'eu-west-1'), 'skipped');
  assert.equal(other.deleted.length, 0);
});

test('deleteBoundQueue refuses URLs outside this account or region', async () => {
  const name = buildQueueName('q', idA);
  const tagged = { tags: queueTags('p1', idA) };
  const otherAccount = fakeSqs({ ...tagged, account: '2' });
  const row = { id: idA, projectId: 'p1', url: `https://sqs.eu-west-1.amazonaws.com/1/${name}` };
  assert.equal(await deleteBoundQueue(otherAccount, row, rows([]), 'eu-west-1'), 'skipped');
  const sqs = fakeSqs(tagged);
  assert.equal(await deleteBoundQueue(sqs, row, rows([]), 'us-east-1'), 'skipped');
  assert.equal(
    await deleteBoundQueue(sqs, { ...row, url: `https://evil.example.com/1/${name}` }, rows([]), 'eu-west-1'),
    'skipped',
  );
  assert.equal(sqs.deleted.length + otherAccount.deleted.length, 0);
  assert.equal(await deleteBoundQueue(fakeSqs({ missing: true }), row, rows([]), 'eu-west-1'), 'missing');
});

test('deleteBoundQueue applies the legacy rules to untagged queues', async () => {
  const named = { id: idA, projectId: 'p1', url: `https://sqs.eu-west-1.amazonaws.com/1/Homography-${idA}` };
  const sqs = fakeSqs({});
  assert.equal(await deleteBoundQueue(sqs, named, rows([idA]), 'eu-west-1'), 'deleted');
  assert.equal(await deleteBoundQueue(sqs, named, rows([idA, idB]), 'eu-west-1'), 'skipped');
  // Older names carry a random id; with no other row using it the queue is this row's.
  const unnamed = { ...named, url: 'https://sqs.eu-west-1.amazonaws.com/1/Survey-random' };
  assert.equal(await deleteBoundQueue(sqs, unnamed, rows([idA]), 'eu-west-1'), 'deleted');
  assert.equal(await deleteBoundQueue(sqs, unnamed, rows([idA, idB]), 'eu-west-1'), 'skipped');
  assert.deepEqual(sqs.deleted, [named.url, unnamed.url]);
});
