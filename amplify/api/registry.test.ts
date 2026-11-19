import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DATA_CHANNELS, DATA_FIELDS } from '../../shared/dataChannels';
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

test('live events carry exactly the fields of their models', () => {
  const sdl = schema.transform().schema;
  for (const model of Object.keys(DATA_CHANNELS)) {
    const block =
      new RegExp(`type ${model} @model.*\\n\\{\\n([\\s\\S]*?)\\n\\}`).exec(
        sdl,
      )?.[1] ?? '';
    const fields = [...block.matchAll(/^\s*(\w+)\s*:(.*)$/gm)]
      .filter((m) => !/@(belongsTo|hasMany|hasOne)/.test(m[2]))
      .map((m) => m[1]);
    assert.deepEqual(
      [...DATA_FIELDS[model]].sort(),
      [...new Set(['id', ...fields, 'createdAt', 'updatedAt'])].sort(),
      model,
    );
  }
});
