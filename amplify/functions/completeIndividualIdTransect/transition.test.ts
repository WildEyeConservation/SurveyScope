import assert from 'node:assert/strict';
import test from 'node:test';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { completeTransect } from './transition';

const tables = { IndividualIdJob: 'jobs', IndividualIdTransect: 'transects' };

type Rows = Record<string, Record<string, string | number>>;

function fakeDb(rows: Rows, cancel?: (string | undefined)[]) {
  const writes: unknown[] = [];
  return {
    writes,
    async send(command: unknown) {
      if (command instanceof GetCommand) {
        return { Item: rows[`${command.input.TableName}:${command.input.Key!.id}`] };
      }
      if (command instanceof TransactWriteCommand) {
        if (cancel) {
          throw Object.assign(new Error('cancelled'), {
            name: 'TransactionCanceledException',
            CancellationReasons: cancel.map((Code) => ({ Code })),
          });
        }
        writes.push(command.input);
        rows['jobs:j1'].remainingTransects = Number(rows['jobs:j1'].remainingTransects) - 1;
        rows['transects:t1'].status = 'completed';
        return {};
      }
      throw new Error('unexpected command');
    },
  };
}

const base = (): Rows => ({
  'transects:t1': { id: 't1', jobId: 'j1', projectId: 'p1', status: 'assigned', assignedUserId: 'u1' },
  'jobs:j1': { id: 'j1', projectId: 'p1', status: 'active', remainingTransects: 1 },
});

test('completes the transect and decrements the job in one transaction', async () => {
  const db = fakeDb(base());
  const result = await completeTransect(db, tables, 't1', 'u1', 'now');
  assert.equal(result.kind, 'completed');
  assert.equal(result.kind === 'completed' && result.job.remainingTransects, 0);
  const items = (db.writes[0] as { TransactItems: { Update: { TableName: string } }[] }).TransactItems;
  assert.deepEqual(items.map((i) => i.Update.TableName), ['transects', 'jobs']);
});

test('refuses a job from another project before writing', async () => {
  const rows = base();
  rows['jobs:j1'].projectId = 'p2';
  const db = fakeDb(rows);
  assert.equal((await completeTransect(db, tables, 't1', 'u1')).kind, 'mismatch');
  assert.equal(db.writes.length, 0);
});

test('retries and lost races do not decrement again', async () => {
  const rows = base();
  rows['transects:t1'].status = 'completed';
  rows['jobs:j1'].remainingTransects = 0;
  const done = fakeDb(rows);
  const result = await completeTransect(done, tables, 't1', 'u1');
  assert.equal(result.kind, 'alreadyComplete');
  assert.equal(done.writes.length, 0);

  const raced = fakeDb(base(), ['ConditionalCheckFailed', 'None']);
  assert.equal((await completeTransect(raced, tables, 't1', 'u1')).kind, 'noop');
  const moved = fakeDb(base(), ['None', 'ConditionalCheckFailed']);
  assert.equal((await completeTransect(moved, tables, 't1', 'u1')).kind, 'mismatch');
});
