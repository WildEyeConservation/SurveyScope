import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { operationArgsError } from './operations';

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
