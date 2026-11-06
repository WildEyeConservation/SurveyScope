import { generateModelsSync } from '@aws-amplify/graphql-generator';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { schema } from '../data/resource';
import { ApiError } from './errors';
import { FOREIGN_KEYS } from './foreignKeys';
import { POLICIES } from './policies';
import type { Introspection } from './schema';
import { actor, gateway, MemoryData } from './testing';

// The schema the router sees in production, not the test fixture.
const deployed = JSON.parse(
  Object.values(
    generateModelsSync({
      schema: schema.transform().schema,
      target: 'introspection',
      directives: '',
    }),
  )[0],
) as Introspection;

function fixture() {
  return new MemoryData(
    {
      Organization: [{ id: 'org1' }, { id: 'org2' }],
      OrganizationMembership: [
        { organizationId: 'org1', userId: 'admin', isAdmin: true },
      ],
      Project: [
        { id: 'p1', organizationId: 'org1' },
        { id: 'p2', organizationId: 'org2' },
      ],
      TestPreset: [
        { id: 'own', organizationId: 'org1' },
        { id: 'foreign', organizationId: 'org2' },
      ],
      AnnotationSet: [
        { id: 'a1', projectId: 'p1' },
        { id: 'a2', projectId: 'p2' },
      ],
      Location: [
        { id: 'loc1', projectId: 'p1' },
        { id: 'loc2', projectId: 'p2' },
      ],
      LocationSet: [{ id: 'l1', projectId: 'p1' }],
      TasksOnAnnotationSet: [
        { id: 't1', annotationSetId: 'a1', locationSetId: 'l1' },
      ],
    },
    deployed,
  );
}

const forbidden = (promise: Promise<unknown>) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof ApiError && e.status === 403,
  );

describe('policies on the deployed schema', () => {
  it('links surveys only to test presets of their own organisation', async () => {
    const { models } = gateway(fixture(), actor('admin'), POLICIES);
    await models.run('TestPresetProject', 'create', [
      { projectId: 'p1', testPresetId: 'own' },
    ]);
    await forbidden(
      models.run('TestPresetProject', 'create', [
        { projectId: 'p1', testPresetId: 'foreign' },
      ]),
    );
  });

  it("adds locations from the organisation's own surveys to its test presets", async () => {
    const { models } = gateway(fixture(), actor('admin'), POLICIES);
    const link = {
      testPresetId: 'own',
      locationId: 'loc1',
      annotationSetId: 'a1',
    };
    await models.run('TestPresetLocation', 'create', [link]);
    await forbidden(
      models.run('TestPresetLocation', 'create', [
        { ...link, locationId: 'loc2', annotationSetId: 'a2' },
      ]),
    );
  });

  it('resolves task mappings to their survey through the annotation set', async () => {
    const { models } = gateway(fixture(), actor('admin'), POLICIES);
    const result = await models.run('TasksOnAnnotationSet', 'get', [
      { id: 't1' },
    ]);
    assert.equal(
      (result.data as { locationSetId: string }).locationSetId,
      'l1',
    );
  });

  it('knows every foreign key, including those without a GraphQL relationship', () => {
    for (const [model, keys] of Object.entries(FOREIGN_KEYS)) {
      for (const [fk, target] of Object.entries(keys)) {
        assert.ok(
          deployed.models[model]?.fields[fk],
          `${model}.${fk} is not in the schema`,
        );
        assert.ok(
          deployed.models[target],
          `${model}.${fk} points at missing ${target}`,
        );
      }
    }
    for (const [model, info] of Object.entries(deployed.models)) {
      for (const field of Object.values(info.fields)) {
        if (field.association?.connectionType !== 'BELONGS_TO') continue;
        for (const fk of field.association.targetNames ?? []) {
          assert.ok(
            FOREIGN_KEYS[model]?.[fk],
            `${model}.${fk} is missing from FOREIGN_KEYS`,
          );
        }
      }
    }
  });
});
