import assert from 'node:assert/strict';
import test from 'node:test';
import { persistObservation } from './persistObservation';

class FakeGraphQLError extends Error {
  errors = [{ message: 'The conditional request failed' }];
}

const isGraphQLError = (error: unknown): error is FakeGraphQLError =>
  error instanceof FakeGraphQLError;

const expected = {
  annotationSetId: 'set-1',
  locationId: 'location-1',
  queueId: 'queue-1',
};

const duplicate = async () => {
  throw new FakeGraphQLError();
};

test('a created row needs no lookup', async () => {
  let lookups = 0;
  await persistObservation({
    create: async () => ({ data: { id: 'observation-1' } }),
    getExisting: async () => {
      lookups += 1;
      return { data: null };
    },
    expected,
    isGraphQLError,
  });
  assert.equal(lookups, 0);
});

test('a duplicate ID resolves when the existing row matches', async () => {
  await persistObservation({
    create: duplicate,
    getExisting: async () => ({ data: { ...expected } }),
    expected,
    isGraphQLError,
  });
});

test('a duplicate ID rejects when the existing row differs', async () => {
  await assert.rejects(
    persistObservation({
      create: duplicate,
      getExisting: async () => ({
        data: { ...expected, locationId: 'location-2' },
      }),
      expected,
      isGraphQLError,
    }),
    /Failed to persist observation: The conditional request failed/
  );
});

test('a GraphQL error without a deterministic ID rejects', async () => {
  await assert.rejects(
    persistObservation({ create: duplicate, expected, isGraphQLError }),
    /Failed to persist observation/
  );
});

test('other errors propagate without a lookup', async () => {
  const networkError = new Error('offline');
  let lookups = 0;
  await assert.rejects(
    persistObservation({
      create: async () => {
        throw networkError;
      },
      getExisting: async () => {
        lookups += 1;
        return { data: null };
      },
      expected,
      isGraphQLError,
    }),
    networkError
  );
  assert.equal(lookups, 0);
});
