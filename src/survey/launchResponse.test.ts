import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLaunchResponse } from './launchResponse';

test('a failed launch is reported instead of passing for success', () => {
  assert.throws(
    () =>
      parseLaunchResponse(
        {
          data: {
            statusCode: 500,
            body: JSON.stringify({
              message: 'Failed to launch informational tagging job',
              error: 'PRETILE_QUEUE_URL not set',
            }),
          },
        },
        'Launch failed',
      ),
    /Launch failed: PRETILE_QUEUE_URL not set/,
  );
});

test('a stringified envelope is unwrapped before it is checked', () => {
  assert.throws(
    () =>
      parseLaunchResponse(
        {
          data: JSON.stringify({
            statusCode: 500,
            body: { message: 'Unauthorized' },
          }),
        },
        'Launch failed',
      ),
    /Launch failed: Unauthorized/,
  );
});

test('GraphQL errors are surfaced', () => {
  assert.throws(
    () =>
      parseLaunchResponse(
        { data: null, errors: [{ message: 'Not Authorized to access' }] },
        'Launch failed',
      ),
    /Launch failed: Not Authorized to access/,
  );
});

test('a successful launch returns its body', () => {
  const body = parseLaunchResponse(
    {
      data: {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Project is already launching or processing',
        }),
      },
    },
    'Launch failed',
  );
  assert.equal(body.message, 'Project is already launching or processing');
});

test('an unparseable response is treated as success rather than crashing', () => {
  assert.deepEqual(
    parseLaunchResponse({ data: 'not json' }, 'Launch failed'),
    {},
  );
  assert.deepEqual(parseLaunchResponse(undefined, 'Launch failed'), {});
});
