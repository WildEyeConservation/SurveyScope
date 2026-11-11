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

function surveyFixture() {
  const data = new MemoryData(
    {
      Organization: [{ id: 'org1' }],
      OrganizationMembership: [
        { organizationId: 'org1', userId: 'orgAdmin', isAdmin: true },
        { organizationId: 'org1', userId: 'surveyAdmin', isAdmin: false },
        { organizationId: 'org1', userId: 'annotator', isAdmin: false },
      ],
      Project: [{ id: 'p1', organizationId: 'org1', name: 'One', tags: [] }],
      UserProjectMembership: [
        { id: 'm1', userId: 'surveyAdmin', projectId: 'p1', isAdmin: true },
        { id: 'm2', userId: 'annotator', projectId: 'p1', isAdmin: false },
      ],
      Queue: [{ id: 'q1', projectId: 'p1', name: 'Queue', url: 'queue-url' }],
      Image: [
        { id: 'i1', projectId: 'p1' },
        { id: 'i2', projectId: 'p1' },
      ],
      ImageFile: [
        { id: 'f1', projectId: 'p1', imageId: 'i1', key: 'k1' },
        { id: 'f2', projectId: 'p1', imageId: 'i2', key: 'k2' },
      ],
    },
    deployed,
  );
  data.leases = [
    {
      userId: 'annotator',
      leaseId: 'l1',
      kind: 'queue',
      projectId: 'p1',
      grantedFor: 'p1',
      imageIds: ['i1'],
      locationIds: [],
      pairs: [],
      readSetIds: [],
      writeSetIds: [],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
  ];
  return data;
}

const user = (data: MemoryData, name: string) =>
  gateway(data, actor(name, name === 'root' ? ['sysadmin'] : []), POLICIES)
    .models;

describe('queue settings', () => {
  it('lets survey admins change queue settings but never the queue URL', async () => {
    const data = surveyFixture();
    for (const name of ['surveyAdmin', 'orgAdmin', 'root']) {
      await user(data, name).run('Queue', 'update', [
        { id: 'q1', zoom: 3, url: 'other-url' },
      ]);
      await user(data, name).run('Queue', 'create', [
        { projectId: 'p1', name: 'New', url: 'other-url' },
      ]);
    }
    assert.equal(data.tables.Queue[0].url, 'queue-url');
    assert.equal(data.tables.Queue[0].zoom, 3);
    assert.ok(data.tables.Queue.slice(1).every((q) => q.url === undefined));
    await forbidden(
      user(data, 'annotator').run('Queue', 'update', [{ id: 'q1', zoom: 4 }]),
    );
  });
});

describe('image files', () => {
  it('lets survey admins read and delete image files, and leaseholders read their images', async () => {
    const data = surveyFixture();
    const annotator = user(data, 'annotator');
    await annotator.run('ImageFile', 'get', [{ id: 'f1' }]);
    await forbidden(annotator.run('ImageFile', 'get', [{ id: 'f2' }]));
    await forbidden(annotator.run('ImageFile', 'delete', [{ id: 'f1' }]));
    for (const name of ['surveyAdmin', 'orgAdmin']) {
      const models = user(data, name);
      await models.run('ImageFile', 'get', [{ id: 'f2' }]);
      await forbidden(
        models.run('ImageFile', 'create', [
          { projectId: 'p1', imageId: 'i1', key: 'k3', path: 'x', type: 'y' },
        ]),
      );
      await forbidden(
        models.run('ImageFile', 'update', [{ id: 'f1', key: 'k3' }]),
      );
    }
    await user(data, 'surveyAdmin').run('ImageFile', 'delete', [{ id: 'f2' }]);
    assert.deepEqual(
      data.tables.ImageFile.map((f) => [f.id, f.key]),
      [['f1', 'k1']],
    );
  });
});

describe('survey tags', () => {
  it('leaves survey tags to sysadmins on create and update', async () => {
    const data = surveyFixture();
    const survey = { organizationId: 'org1', name: 'Two' };
    const orgAdmin = user(data, 'orgAdmin');
    await forbidden(
      orgAdmin.run('Project', 'create', [{ ...survey, tags: ['legacy'] }]),
    );
    await orgAdmin.run('Project', 'create', [survey]);
    await forbidden(user(data, 'annotator').run('Project', 'create', [survey]));
    for (const name of ['surveyAdmin', 'orgAdmin']) {
      await forbidden(
        user(data, name).run('Project', 'update', [
          { id: 'p1', tags: ['legacy'] },
        ]),
      );
      await user(data, name).run('Project', 'update', [
        { id: 'p1', name, tags: [] },
      ]);
    }
    const root = user(data, 'root');
    await root.run('Project', 'update', [{ id: 'p1', tags: ['test'] }]);
    await root.run('Project', 'create', [{ ...survey, tags: ['legacy'] }]);
    assert.deepEqual(data.tables.Project[0].tags, ['test']);
    assert.deepEqual(
      data.tables.Project.slice(1).map((p) => p.tags),
      [undefined, ['legacy']],
    );
  });
});
