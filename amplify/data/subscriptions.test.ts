import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { schema } from './resource';

// Realtime goes through the Events API; each model subscription costs a dozen resources.
test('no model exposes GraphQL subscriptions', () => {
  const { schema: sdl } = schema.transform();
  assert.doesNotMatch(sdl, /type Subscription\b/);
});
