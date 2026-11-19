import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  ARG_LIMITS,
  operationArgsError,
  operationReturnsJson,
  operationType,
} from './operations';

test('operation arguments are checked against their declared types', () => {
  assert.equal(
    operationArgsError('runScoutbot', {
      projectId: 'p1',
      images: ['a', 'b'],
      setId: 's1',
      rotation: 90,
      landscape: true,
    }),
    null,
  );
  assert.match(
    operationArgsError('runScoutbot', { projectId: 'p1', setId: 's1', x: 1 })!,
    /no argument x/,
  );
  assert.match(
    operationArgsError('runScoutbot', { setId: 's1' })!,
    /needs projectId/,
  );
  assert.match(
    operationArgsError('runScoutbot', {
      projectId: 'p1',
      setId: 's1',
      rotation: '90',
    })!,
    /rotation must be Int/,
  );
  assert.match(
    operationArgsError('runScoutbot', {
      projectId: 'p1',
      setId: 's1',
      rotation: 1.5,
    })!,
    /rotation must be Int/,
  );
  assert.match(
    operationArgsError('runScoutbot', {
      projectId: 'p1',
      setId: 's1',
      images: [1],
    })!,
    /images must be \[String\]/,
  );
  assert.equal(
    operationArgsError('recordWorkflowTask', {
      workflowRunId: 'q',
      workItemType: 'annotation',
      workItemId: 'a',
      outcome: 'approved',
      metrics: '{}',
    }),
    null,
  );
});

const scoutbot = (extra: Record<string, unknown>) =>
  operationArgsError('runScoutbot', { projectId: 'p1', setId: 's1', ...extra });

test('integers stay within the GraphQL Int range', () => {
  assert.equal(scoutbot({ rotation: 2 ** 31 - 1 }), null);
  assert.equal(scoutbot({ rotation: -(2 ** 31) }), null);
  assert.match(scoutbot({ rotation: 2 ** 31 })!, /rotation must be Int/);
  assert.match(scoutbot({ rotation: -(2 ** 31) - 1 })!, /rotation must be Int/);
});

test('lists and strings are bounded', () => {
  const ids = Array.from({ length: 30_000 }, (_, i) => `image-${i}`);
  assert.equal(scoutbot({ images: ids }), null);
  assert.match(
    scoutbot({ images: new Array(ARG_LIMITS.listLength + 1).fill('a') })!,
    /more than/,
  );
  assert.match(
    scoutbot({ setId: 'x'.repeat(ARG_LIMITS.stringLength + 1) })!,
    /setId must be String/,
  );
  assert.match(
    operationArgsError('touchQueue', { id: 'x'.repeat(ARG_LIMITS.idLength + 1) })!,
    /id must be ID/,
  );
});

test('AWSJSON must be valid, bounded JSON', () => {
  const record = (metrics: unknown) =>
    operationArgsError('recordWorkflowTask', {
      workflowRunId: 'q',
      workItemType: 'annotation',
      workItemId: 'a',
      outcome: 'approved',
      metrics,
    });
  assert.equal(record({ approved: 1 }), null);
  assert.match(record('{not json')!, /metrics must be AWSJSON/);
  assert.match(record('x'.repeat(ARG_LIMITS.jsonChars + 1))!, /metrics must be AWSJSON/);
  let deep: unknown = 1;
  for (let i = 0; i < ARG_LIMITS.jsonDepth + 1; i++) deep = [deep];
  assert.match(record(deep)!, /metrics must be AWSJSON/);
  assert.match(record(JSON.stringify(deep))!, /metrics must be AWSJSON/);
  let shallow: unknown = 1;
  for (let i = 0; i < ARG_LIMITS.jsonDepth; i++) shallow = { a: shallow };
  assert.equal(record(shallow), null);
});

test('inherited names are not operations', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.match(operationArgsError(name, {})!, /Unknown operation/);
    assert.equal(operationReturnsJson(name), false);
    assert.equal(operationType(name), undefined);
  }
});
