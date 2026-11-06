import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { OPERATIONS_SCHEMA } from '../../shared/operations';
import { schema } from '../data/resource';
import { OPERATIONS } from './operations';

// Lambdas and containers call these through AppSync with IAM.
const APPSYNC_OPERATIONS = [
  'updateProjectMemberships',
  'decrementIndividualIdImageUpdates',
  'decrementIndividualIdRemainingTransects',
  'incrementRegistrationProgress',
  'incrementRegistrationBucketStat',
];

const registered = [
  ...Object.keys(OPERATIONS_SCHEMA.queries),
  ...Object.keys(OPERATIONS_SCHEMA.mutations),
];

test('every browser operation has a router policy and the reverse', () => {
  assert.deepEqual(registered.sort(), Object.keys(OPERATIONS).sort());
});

test('AppSync keeps only the operations backends call', () => {
  const sdl = schema.transform().schema;
  const fields = (type: string) => {
    const block =
      new RegExp(`type ${type} \\{\\n([\\s\\S]*?)\\n\\}`).exec(sdl)?.[1] ?? '';
    return [...block.matchAll(/^\s*(\w+)\(/gm)].map((m) => m[1]);
  };
  assert.deepEqual(
    [...fields('Query'), ...fields('Mutation')]
      .filter(
        (name) =>
          !/^(get|list|create|update|delete)[A-Z]/.test(name) ||
          APPSYNC_OPERATIONS.includes(name),
      )
      .sort(),
    [...APPSYNC_OPERATIONS].sort(),
  );
});
