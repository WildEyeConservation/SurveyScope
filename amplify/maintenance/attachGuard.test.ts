import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App, Stack, NestedStack } from 'aws-cdk-lib';
import { CfnResolver } from 'aws-cdk-lib/aws-appsync';
import { attachMaintenanceGuard } from './attachGuard';

test('guard includes model, custom sibling and subscription resolvers, keeping recovery APIs available', () => {
  const stack = new Stack(new App(), 'Data');
  const nested = new NestedStack(stack, 'Model');
  const make = (scope: Stack, name: string, typeName: string) =>
    new CfnResolver(scope, name, {
      apiId: 'api',
      typeName,
      fieldName: name,
      kind: 'PIPELINE',
      pipelineConfig: { functions: ['existing'] },
    });
  const guarded = [
    make(nested, 'updateAnnotation', 'Mutation'),
    make(stack, 'publish', 'Mutation'),
    make(nested, 'getProject', 'Query'),
    make(nested, 'onUpdateAnnotation', 'Subscription'),
  ];
  const exempt = [
    make(stack, 'getUserAnnouncement', 'Query'),
    make(stack, 'setUserAnnouncement', 'Mutation'),
    make(stack, 'onUserAnnouncementChange', 'Subscription'),
    make(stack, 'getSystemMaintenance', 'Query'),
    make(stack, 'setSystemMaintenance', 'Mutation'),
    make(stack, 'onSystemMaintenanceChange', 'Subscription'),
    make(nested, 'annotations', 'Project'),
  ];
  attachMaintenanceGuard(stack, ['guard']);
  for (const r of guarded)
    assert.deepEqual(r.pipelineConfig, {
      functions: ['guard', 'existing'],
    });
  for (const r of exempt)
    assert.deepEqual(r.pipelineConfig, { functions: ['existing'] });
});
test('unsupported resolver layouts fail synthesis rather than silently bypass maintenance', () => {
  const stack = new Stack(new App(), 'Data');
  new CfnResolver(stack, 'Unit', {
    apiId: 'api',
    typeName: 'Mutation',
    fieldName: 'custom',
  });
  assert.throws(
    () => attachMaintenanceGuard(stack, ['guard']),
    /requires a pipeline/
  );
});
