import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ApiError } from './errors';
import { OPERATIONS } from './operations';
import { POLICIES } from './policies';
import * as tasks from './tasks';
import { actor, MemoryData, MemoryQueue, operationContext } from './testing';

function fixture() {
  return new MemoryData({
    OrganizationMembership: [
      { organizationId: 'org1', userId: 'annotator', isAdmin: false },
      { organizationId: 'org1', userId: 'other', isAdmin: false },
    ],
    Project: [
      { id: 'p1', organizationId: 'org1' },
      { id: 'p2', organizationId: 'org1' },
    ],
    UserProjectMembership: [
      { id: 'm1', userId: 'annotator', projectId: 'p1' },
      { id: 'm2', userId: 'other', projectId: 'p1' },
    ],
    AnnotationSet: [
      { id: 'a1', projectId: 'p1' },
      { id: 'a2', projectId: 'p1' },
      { id: 'pool', projectId: 'p2' },
    ],
    Queue: [
      {
        id: 'q1',
        projectId: 'p1',
        url: 'https://queue/q1',
        annotationSetId: 'a1',
      },
      { id: 'hidden', projectId: 'p1', url: 'https://queue/h', hidden: true },
    ],
    Image: [
      { id: 'img1', projectId: 'p1' },
      { id: 'img2', projectId: 'p1' },
      { id: 'img3', projectId: 'p1' },
      { id: 'poolImage', projectId: 'p2' },
    ],
    ImageNeighbour: [{ image1Id: 'img1', image2Id: 'img2', projectId: 'p1' }],
    Location: [
      { id: 'loc1', projectId: 'p1', imageId: 'img1' },
      { id: 'foreign', projectId: 'p2', imageId: 'poolImage' },
    ],
    Annotation: [],
    IndividualIdJob: [
      { id: 'job1', projectId: 'p1', annotationSetId: 'a2', status: 'active' },
    ],
    IndividualIdTransect: [
      {
        id: 't1',
        projectId: 'p1',
        jobId: 'job1',
        assignedUserId: 'annotator',
        status: 'assigned',
      },
      {
        id: 't2',
        projectId: 'p1',
        jobId: 'job1',
        assignedUserId: 'annotator',
        status: 'completed',
      },
    ],
    TestPresetProject: [{ testPresetId: 'preset', projectId: 'p1' }],
    TestPresetLocation: [
      {
        testPresetId: 'preset',
        locationId: 'foreign',
        annotationSetId: 'pool',
      },
    ],
    LocationAnnotationCount: [
      {
        locationId: 'foreign',
        categoryId: 'c',
        annotationSetId: 'pool',
        count: 2,
      },
    ],
    SharedChainImage: [{ id: 'shared1', shareId: 's1', sourceImageId: 'img3' }],
    ChainShare: [{ shareId: 's1', status: 'active' }],
  });
}

const as = (data: MemoryData, user: string, queue = new MemoryQueue()) =>
  operationContext(data, actor(user), POLICIES, { queue });

const denied = (promise: Promise<unknown>) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof ApiError && e.status === 403,
  );

describe('task leases', () => {
  it('opens only the received task to its holder', async () => {
    const data = fixture();
    const queue = new MemoryQueue([
      { body: { location: { id: 'loc1', annotationSetId: 'a1' } } },
    ]);
    const ctx = as(data, 'annotator', queue);
    await denied(ctx.models.run('Image', 'get', [{ id: 'img1' }]));

    const received = await tasks.receive(ctx.tasks, { queueId: 'q1' });
    assert.ok(received.data);

    const fresh = as(data, 'annotator');
    await fresh.models.run('Image', 'get', [{ id: 'img1' }]);
    await fresh.models.run('Image', 'get', [{ id: 'img2' }]);
    await denied(fresh.models.run('Image', 'get', [{ id: 'img3' }]));
    await fresh.models.run('Annotation', 'create', [
      { projectId: 'p1', imageId: 'img1', setId: 'a1' },
    ]);
    await denied(
      fresh.models.run('Annotation', 'create', [
        { projectId: 'p1', imageId: 'img3', setId: 'a1' },
      ]),
    );
    await denied(
      fresh.models.run('Annotation', 'create', [
        { projectId: 'p1', imageId: 'img1', setId: 'a2' },
      ]),
    );
    await denied(
      as(data, 'other').models.run('Image', 'get', [{ id: 'img1' }]),
    );

    const { leaseId } = received.data as { leaseId: string };
    await assert.rejects(
      tasks.ack(as(data, 'other', queue).tasks, { leaseId }),
      (e: unknown) => e instanceof ApiError && e.status === 404,
    );
    await tasks.ack(as(data, 'annotator', queue).tasks, { leaseId });
    assert.equal(queue.removed.length, 1);
  });

  it('records observations only for held locations and lets their owner read them back', async () => {
    const data = fixture();
    data.tables.Location.push({ id: 'loc3', projectId: 'p1', imageId: 'img3' });
    const ctx = as(
      data,
      'annotator',
      new MemoryQueue([
        { body: { location: { id: 'loc1', annotationSetId: 'a1' } } },
      ]),
    );
    await tasks.receive(ctx.tasks, { queueId: 'q1' });
    const fresh = as(data, 'annotator');
    const created = await fresh.models.run('Observation', 'create', [
      { id: 'o1', projectId: 'p1', locationId: 'loc1', annotationSetId: 'a1' },
    ]);
    assert.equal(
      (created.data as { owner: string }).owner,
      'annotator::annotator',
    );
    await as(data, 'annotator').models.run('Observation', 'get', [
      { id: 'o1' },
    ]);
    await denied(
      as(data, 'other').models.run('Observation', 'get', [{ id: 'o1' }]),
    );
    await denied(
      fresh.models.run('Observation', 'create', [
        { projectId: 'p1', locationId: 'loc3', annotationSetId: 'a1' },
      ]),
    );
  });

  it('lets reviewers of an active share sign its images', async () => {
    const data = fixture();
    const args = { imageId: 'img3', sourceKey: 'k', sharedImageId: 'shared1' };
    await denied(
      OPERATIONS.signImageTiles.authorize(as(data, 'annotator'), args),
    );
    const reviewer = operationContext(
      data,
      actor('annotator', ['chainshare-s1']),
      POLICIES,
    );
    await OPERATIONS.signImageTiles.authorize(reviewer, args);
    await denied(
      OPERATIONS.signImageTiles.authorize(reviewer, {
        ...args,
        imageId: 'img1',
      }),
    );
    data.tables.ChainShare[0].status = 'revoked';
    await denied(
      OPERATIONS.signImageTiles.authorize(
        operationContext(data, actor('annotator', ['chainshare-s1']), POLICIES),
        args,
      ),
    );
  });

  it('drops messages about another survey and keeps hidden queues for admins', async () => {
    const data = fixture();
    const queue = new MemoryQueue([
      { body: { location: { id: 'foreign', annotationSetId: 'a1' } } },
    ]);
    const ctx = as(data, 'annotator', queue);
    assert.deepEqual(await tasks.receive(ctx.tasks, { queueId: 'q1' }), {
      data: null,
    });
    assert.equal(queue.removed.length, 1);
    assert.equal(data.leases.length, 0);
    await denied(tasks.receive(ctx.tasks, { queueId: 'hidden' }));
  });

  it('leases each task of a batch and drops the ones about another survey', async () => {
    const data = fixture();
    data.tables.Location.push({ id: 'loc3', projectId: 'p1', imageId: 'img3' });
    const queue = new MemoryQueue([
      { body: { location: { id: 'loc1', annotationSetId: 'a1' } } },
      { body: { location: { id: 'foreign', annotationSetId: 'a1' } } },
      { body: { location: { id: 'loc3', annotationSetId: 'a1' } } },
    ]);
    const ctx = as(data, 'annotator', queue);
    await assert.rejects(
      tasks.receiveBatch(ctx.tasks, { queueId: 'q1', max: 11 }),
      (e: unknown) => e instanceof ApiError && e.status === 400,
    );
    const received = await tasks.receiveBatch(ctx.tasks, {
      queueId: 'q1',
      max: 5,
    });
    assert.equal((received.data as unknown[]).length, 2);
    assert.equal(data.leases.length, 2);
    assert.equal(queue.removed.length, 1);
    const fresh = as(data, 'annotator');
    await fresh.models.run('Image', 'get', [{ id: 'img1' }]);
    await fresh.models.run('Image', 'get', [{ id: 'img3' }]);
    await denied(tasks.receiveBatch(ctx.tasks, { queueId: 'hidden', max: 5 }));
  });

  it('lets survey members touch queues they may work', async () => {
    const data = fixture();
    data.tables.UserProjectMembership.push({
      id: 'm3',
      userId: 'outsider',
      projectId: 'p2',
    });
    await OPERATIONS.touchQueue.authorize(as(data, 'annotator'), { id: 'q1' });
    await denied(
      OPERATIONS.touchQueue.authorize(as(data, 'annotator'), { id: 'hidden' }),
    );
    await denied(
      OPERATIONS.touchQueue.authorize(as(data, 'outsider'), { id: 'q1' }),
    );
  });

  it('ends a lease when its time is up', async () => {
    const data = fixture();
    const ctx = as(
      data,
      'annotator',
      new MemoryQueue([{ body: { imageId: 'img3' } }]),
    );
    await tasks.receive(ctx.tasks, { queueId: 'q1' });
    data.leases[0].expiresAt = Math.floor(Date.now() / 1000) - 1;
    await denied(
      as(data, 'annotator').models.run('Image', 'get', [{ id: 'img3' }]),
    );
    await assert.rejects(
      tasks.ack(as(data, 'annotator').tasks, {
        leaseId: data.leases[0].leaseId,
      }),
      (e: unknown) => e instanceof ApiError && e.status === 404,
    );
  });

  it('stops a removed member from acknowledging or extending their tasks', async () => {
    const data = fixture();
    const queue = new MemoryQueue([
      { body: { location: { id: 'loc1', annotationSetId: 'a1' } } },
    ]);
    const received = await tasks.receive(as(data, 'annotator', queue).tasks, {
      queueId: 'q1',
    });
    const { leaseId } = received.data as { leaseId: string };
    data.tables.UserProjectMembership =
      data.tables.UserProjectMembership.filter((m) => m.userId !== 'annotator');
    const ctx = as(data, 'annotator', queue);
    await denied(tasks.ack(ctx.tasks, { leaseId }));
    await denied(tasks.visibility(ctx.tasks, { leaseId, seconds: 600 }));
    assert.equal(queue.removed.length, 0);
    assert.equal(queue.visibilities.length, 0);
  });

  it('shows a test location from a linked preset read-only', async () => {
    const data = fixture();
    const ctx = as(data, 'annotator');
    const result = {
      userId: 'annotator',
      projectId: 'p1',
      locationId: 'foreign',
      annotationSetId: 'pool',
    };
    await denied(ctx.models.run('Location', 'get', [{ id: 'foreign' }]));
    await denied(ctx.models.run('TestResult', 'create', [result]));
    await tasks.test(ctx.tasks, {
      projectId: 'p1',
      testPresetId: 'preset',
      locationId: 'foreign',
      annotationSetId: 'pool',
    });
    const fresh = as(data, 'annotator');
    await fresh.models.run('Location', 'get', [{ id: 'foreign' }]);
    const counts = await fresh.models.run(
      'LocationAnnotationCount',
      'categoryCountsByLocationIdAndAnnotationSetId',
      [{ locationId: 'foreign', annotationSetId: { eq: 'pool' } }],
    );
    assert.equal((counts.data as unknown[]).length, 1);
    await fresh.models.run('Image', 'get', [{ id: 'poolImage' }]);
    await denied(
      fresh.models.run('Annotation', 'create', [
        { projectId: 'p2', imageId: 'poolImage', setId: 'pool' },
      ]),
    );
    await fresh.models.run('TestResult', 'create', [result]);
    await denied(
      fresh.models.run('TestResult', 'create', [
        { ...result, userId: 'other' },
      ]),
    );
    await denied(
      fresh.models.run('TestResult', 'create', [
        { ...result, locationId: 'loc1' },
      ]),
    );
    await denied(
      tasks.test(as(data, 'annotator').tasks, {
        projectId: 'p1',
        testPresetId: 'preset',
        locationId: 'loc1',
        annotationSetId: 'pool',
      }),
    );
  });

  it('opens an Individual ID job to the holder of one of its transects', async () => {
    const data = fixture();
    const ctx = as(data, 'annotator');
    await OPERATIONS.pingIndividualIdTransect.authorize(ctx, { id: 't1' });
    await OPERATIONS.pingIndividualIdTransect.run!(ctx, { id: 't1' });
    const fresh = as(data, 'annotator');
    await fresh.models.run('Image', 'get', [{ id: 'img3' }]);
    await fresh.models.run('Annotation', 'create', [
      { projectId: 'p1', imageId: 'img3', setId: 'a2' },
    ]);
    await denied(
      fresh.models.run('Annotation', 'create', [
        { projectId: 'p1', imageId: 'img3', setId: 'a1' },
      ]),
    );
    await denied(
      OPERATIONS.pingIndividualIdTransect.authorize(as(data, 'other'), {
        id: 't1',
      }),
    );
    await denied(
      OPERATIONS.pingIndividualIdTransect.authorize(as(data, 'annotator'), {
        id: 't2',
      }),
    );
  });

  it('stops honouring leases once the holder leaves the survey', async () => {
    const data = fixture();
    const ctx = as(
      data,
      'annotator',
      new MemoryQueue([{ body: { imageId: 'img3' } }]),
    );
    await tasks.receive(ctx.tasks, { queueId: 'q1' });
    await OPERATIONS.pingIndividualIdTransect.run!(ctx, { id: 't1' });
    data.tables.UserProjectMembership =
      data.tables.UserProjectMembership.filter((m) => m.userId !== 'annotator');
    const former = as(data, 'annotator');
    await denied(former.models.run('Image', 'get', [{ id: 'img3' }]));
    await denied(
      former.models.run('Annotation', 'create', [
        { projectId: 'p1', imageId: 'img1', setId: 'a2' },
      ]),
    );
    await denied(
      OPERATIONS.pingIndividualIdTransect.authorize(former, { id: 't1' }),
    );
  });
});
