import { App, CfnResource, NestedStack, Stack } from 'aws-cdk-lib';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  guardStackLimits,
  measureStack,
  stackLimitErrors,
} from './stackLimits';

function addResources(stack: Stack, count: number) {
  for (let i = 0; i < count; i++) {
    new CfnResource(stack, `Topic${i}`, { type: 'AWS::SNS::Topic' });
  }
}

test('passes stacks under the threshold', () => {
  const app = new App();
  const stack = new Stack(app, 'Root');
  addResources(new NestedStack(stack, 'Nested'), 400);
  guardStackLimits(stack);
  assert.doesNotThrow(() => app.synth());
});

test('fails synth for a nested stack over 90% of the resource limit', () => {
  const app = new App();
  const stack = new Stack(app, 'Root');
  addResources(new NestedStack(stack, 'Nested'), 460);
  guardStackLimits(stack);
  assert.throws(() => app.synth(), /Root\/Nested.*resources 46\d of 500/s);
});

test('measures what CDK writes', () => {
  const app = new App();
  const stack = new Stack(app, 'Root');
  addResources(stack, 3);
  const template = app.synth().getStackByName('Root').template;
  const usage = measureStack(stack);
  assert.equal(usage.resources, Object.keys(template.Resources).length);
  assert.equal(
    usage.bytes,
    Buffer.byteLength(JSON.stringify(template, undefined, 1)),
  );
});

test('reports template size near the 1 MB limit', () => {
  const errors = stackLimitErrors({
    resources: 10,
    outputs: 0,
    parameters: 0,
    bytes: 1_000_000,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^bytes 1000000 of 1048576/);
});
