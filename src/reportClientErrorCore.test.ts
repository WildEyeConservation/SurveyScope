import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReportBudget,
  describeError,
  graphqlErrorMessage,
} from './reportClientErrorCore';

const routeResponse = (status: number, statusText: string) => ({
  status,
  statusText,
  internal: true,
  data: '',
});

test('describes a thrown Error with its stack', () => {
  const error = new Error('Boom');
  assert.deepEqual(describeError(error), {
    message: 'Boom',
    stack: error.stack,
    status: undefined,
  });
});

test('describes thrown strings and empty values', () => {
  assert.equal(describeError('plain failure')?.message, 'plain failure');
  assert.equal(describeError(undefined)?.message, 'Unknown error');
});

test('a 404 route response is not reported, other statuses are', () => {
  assert.equal(describeError(routeResponse(404, 'Not Found')), null);
  assert.deepEqual(describeError(routeResponse(500, 'Server Error')), {
    message: 'Server Error',
    stack: undefined,
    status: '500',
  });
});

test('the same error is sent once and the total is capped', () => {
  const shouldReport = createReportBudget(5);
  assert.equal(shouldReport({ message: 'a', stack: 's' }), true);
  assert.equal(shouldReport({ message: 'a', stack: 's' }), false);
  assert.equal(shouldReport({ message: 'a', stack: 'other' }), true);
  for (const message of ['b', 'c', 'd']) {
    assert.equal(shouldReport({ message }), true);
  }
  assert.equal(shouldReport({ message: 'sixth' }), false);
});

test('reads the messages out of a rejected GraphQL response', () => {
  assert.equal(
    graphqlErrorMessage({
      data: null,
      errors: [{ message: 'Unauthorized' }, { message: 'Second' }],
    }),
    'Unauthorized; Second'
  );
  assert.equal(graphqlErrorMessage(new Error('Network down')), 'Network down');
  assert.equal(graphqlErrorMessage('odd'), 'odd');
});
