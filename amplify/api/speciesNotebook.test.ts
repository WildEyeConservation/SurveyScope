import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type {
  NotebookCrop,
  NotebookExamples,
} from '../../shared/speciesNotebook';
import { ApiError } from './errors';
import { OPERATIONS } from './operations';
import { POLICIES } from './policies';
import { actor, MemoryData, operationContext } from './testing';

let fixtureCount = 0;

// Surveys get fresh ids per fixture so the module's short cache never mixes tests.
function fixture() {
  const n = ++fixtureCount;
  const p1 = `p1-${n}`;
  const p2 = `p2-${n}`;
  const p3 = `p3-${n}`;
  const org1 = `org1-${n}`;
  const annotations = Array.from({ length: 30 }, (_, i) => ({
    id: `z${n}-${i}`,
    projectId: p1,
    setId: 's1',
    categoryId: `zebra-${n}`,
    imageId: `img-${i}`,
    x: 1000 + i,
    y: 1000 + i,
    source: i % 2 ? 'manual' : 'scoutbot',
    reviewedBy: i === 7 ? 'qc' : null,
    objectId: null,
    createdAt: '2026-01-01T00:00:00Z',
  }));
  const images = [...annotations.map((a) => a.imageId), 'img-oov', 'img-e'].map(
    (id) => ({ id, width: 4000, height: 3000 }),
  );
  const data = new MemoryData({
    Image: [...images, { id: 'img-edge', width: 4000, height: 3000 }],
    OrganizationMembership: [
      { organizationId: org1, userId: 'admin', isAdmin: true },
      { organizationId: org1, userId: 'annotator', isAdmin: false },
      { organizationId: 'org2', userId: 'outsider', isAdmin: false },
    ],
    Project: [
      { id: p1, organizationId: org1 },
      { id: p2, organizationId: org1 },
      { id: p3, organizationId: 'org2' },
    ],
    UserProjectMembership: [{ id: 'm1', userId: 'annotator', projectId: p1 }],
    Category: [
      {
        id: `zebra-${n}`,
        name: 'Zebra',
        projectId: p1,
        annotationSetId: 's1',
      },
      {
        id: `eland-${n}`,
        name: 'Eland',
        projectId: p1,
        annotationSetId: 's1',
      },
      {
        id: `eland2-${n}`,
        name: 'Eland',
        projectId: p2,
        annotationSetId: 's2',
      },
      {
        id: `kudu3-${n}`,
        name: 'Kudu',
        projectId: p3,
        annotationSetId: 's3',
      },
    ],
    Annotation: [
      ...annotations,
      {
        id: `edge-${n}`,
        projectId: p1,
        setId: 's1',
        categoryId: `zebra-${n}`,
        imageId: 'img-edge',
        x: 3990,
        y: 1500,
        source: 'manual',
        reviewedBy: 'qc',
      },
      {
        id: `oov-${n}`,
        projectId: p1,
        setId: 's1',
        categoryId: `zebra-${n}`,
        imageId: 'img-oov',
        x: 1,
        y: 1,
        source: 'manual',
        oov: true,
      },
      {
        id: `e${n}`,
        projectId: p2,
        setId: 's2',
        categoryId: `eland2-${n}`,
        imageId: 'img-e',
        x: 500,
        y: 600,
        source: 'manual',
      },
    ],
  });
  return { data, p1, p2, p3 };
}

async function call(
  data: MemoryData,
  user: string,
  name: string,
  args: Record<string, unknown>,
  crops: { imageId: string; point: unknown }[] = [],
) {
  const ctx = operationContext(data, actor(user), POLICIES, {
    images: {
      crop: async (imageId, point) => {
        crops.push({ imageId, point });
        return { size: 1, type: 'image/webp', data: '' } as NotebookCrop;
      },
    },
  });
  const op = OPERATIONS[name];
  await op.authorize(ctx, args);
  const result = await op.run!(ctx, args);
  return result.data;
}

const denied = (promise: Promise<unknown>) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof ApiError && e.status === 403,
  );

describe('species notebook', () => {
  it('serves survey members a capped set of examples with no whereabouts', async () => {
    const { data, p1 } = fixture();
    const result = (await call(data, 'annotator', 'speciesNotebookExamples', {
      projectId: p1,
      name: 'Zebra',
    })) as NotebookExamples;
    assert.equal(result.examples.length, 20);
    assert.equal(result.borrowedSurveys, 0);
    assert.ok(result.examples[0].reviewed, 'reviewed examples come first');
    const text = JSON.stringify(result);
    for (const leak of ['img-', 'imageId', '"x"', '"y"', 'zebra-', p1])
      assert.ok(!text.includes(leak), `examples leak ${leak}`);
    assert.ok(result.examples.every((e) => !e.explore));
    assert.ok(result.examples.some((e) => e.model));
  });

  it('serves the same examples however often it is asked', async () => {
    const { data, p1 } = fixture();
    const ask = async () =>
      (
        (await call(data, 'annotator', 'speciesNotebookExamples', {
          projectId: p1,
          name: 'Zebra',
        })) as NotebookExamples
      ).examples.length;
    assert.deepEqual([await ask(), await ask()], [20, 20]);
    const crops: { imageId: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const { examples } = (await call(
        data,
        'annotator',
        'speciesNotebookExamples',
        { projectId: p1, name: 'Zebra' },
      )) as NotebookExamples;
      for (const e of examples)
        await call(
          data,
          'annotator',
          'speciesNotebookCrop',
          {
            token: e.token,
          },
          crops as never,
        );
    }
    assert.equal(new Set(crops.map((c) => c.imageId)).size, 20);
    assert.ok(!crops.some((c) => c.imageId === 'img-edge'));
  });

  it('gives survey admins the Explore target', async () => {
    const { data, p1 } = fixture();
    const result = (await call(data, 'admin', 'speciesNotebookExamples', {
      projectId: p1,
      name: 'Zebra',
    })) as NotebookExamples;
    assert.ok(result.examples.every((e) => e.explore?.projectId === p1));
  });

  it('borrows from other surveys in the organisation only', async () => {
    const { data, p1 } = fixture();
    const result = (await call(data, 'annotator', 'speciesNotebookExamples', {
      projectId: p1,
      name: 'Eland',
    })) as NotebookExamples;
    assert.equal(result.examples.length, 1);
    assert.equal(result.borrowedSurveys, 1);
    assert.ok(result.examples[0].borrowed);
    assert.equal(result.examples[0].explore, undefined);
    const kudu = (await call(data, 'annotator', 'speciesNotebookExamples', {
      projectId: p1,
      name: 'Kudu',
    })) as NotebookExamples;
    assert.deepEqual(kudu.examples, []);
    const names = (await call(data, 'annotator', 'speciesNotebookLabels', {
      projectId: p1,
    })) as { names: string[] };
    assert.deepEqual(names.names, ['Eland']);
  });

  it('turns a token into a crop of the right point', async () => {
    const { data, p1 } = fixture();
    const { examples } = (await call(
      data,
      'annotator',
      'speciesNotebookExamples',
      { projectId: p1, name: 'Eland' },
    )) as NotebookExamples;
    const crops: { imageId: string; point: unknown }[] = [];
    await call(
      data,
      'annotator',
      'speciesNotebookCrop',
      { token: examples[0].token },
      crops,
    );
    assert.deepEqual(crops, [{ imageId: 'img-e', point: { x: 500, y: 600 } }]);
  });

  it("keeps images holding the caller's tests out of the notebook", async () => {
    const { data, p1 } = fixture();
    const ask = async () =>
      (
        (await call(data, 'annotator', 'speciesNotebookExamples', {
          projectId: p1,
          name: 'Eland',
        })) as NotebookExamples
      ).examples;
    const [before] = await ask();
    const membership = data.tables.OrganizationMembership.find(
      (m) => m.userId === 'annotator',
    )!;
    membership.isTested = true;
    data.tables.TestPresetProject = [{ testPresetId: 'tp', projectId: p1 }];
    data.tables.TestPresetLocation = [
      { testPresetId: 'tp', locationId: 'loc', annotationSetId: 's2' },
    ];
    data.tables.Location = [
      { id: 'loc', imageId: 'img-e', x: 500, y: 600, width: 100, height: 100 },
    ];
    assert.deepEqual(await ask(), []);
    await denied(
      call(data, 'annotator', 'speciesNotebookCrop', { token: before.token }),
    );
  });

  it('refuses outsiders, other users and tampered tokens', async () => {
    const { data, p1 } = fixture();
    await denied(
      call(data, 'outsider', 'speciesNotebookExamples', {
        projectId: p1,
        name: 'Zebra',
      }),
    );
    await denied(
      call(data, 'outsider', 'speciesNotebookLabels', { projectId: p1 }),
    );
    const { examples } = (await call(
      data,
      'annotator',
      'speciesNotebookExamples',
      { projectId: p1, name: 'Zebra' },
    )) as NotebookExamples;
    const token = examples[0].token;
    await denied(call(data, 'admin', 'speciesNotebookCrop', { token }));
    await denied(
      call(data, 'annotator', 'speciesNotebookCrop', {
        token: `${token.slice(0, -2)}xx`,
      }),
    );
    data.tables.UserProjectMembership = [];
    await denied(call(data, 'annotator', 'speciesNotebookCrop', { token }));
  });
});
