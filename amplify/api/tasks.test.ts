import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ApiError } from './errors';
import { OPERATIONS } from './operations';
import { POLICIES } from './policies';
import * as tasks from './tasks';
import {
  actor,
  MemoryData,
  MemoryQueue,
  operationContext,
  refused,
} from './testing';

function fixture() {
  return new MemoryData({
    OrganizationMembership: [
      {
        organizationId: 'org1',
        userId: 'annotator',
        isAdmin: false,
        isTested: true,
      },
      { organizationId: 'org1', userId: 'other', isAdmin: false },
    ],
    ProjectTestConfig: [{ projectId: 'p1', testType: 'interval', interval: 2 }],
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
      { id: 'poolImage', projectId: 'p2', width: 600, height: 400 },
    ],
    ImageNeighbour: [{ image1Id: 'img1', image2Id: 'img2', projectId: 'p1' }],
    Location: [
      { id: 'loc1', projectId: 'p1', imageId: 'img1' },
      {
        id: 'foreign',
        projectId: 'p2',
        imageId: 'poolImage',
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      },
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
    Category: [
      { id: 'c', projectId: 'p2', annotationSetId: 'pool', name: 'Elephant' },
      { id: 'j1', projectId: 'p1', annotationSetId: 'a1', name: 'elephant' },
    ],
    SharedChainImage: [{ id: 'shared1', shareId: 's1', sourceImageId: 'img3' }],
    ChainShare: [{ shareId: 's1', status: 'active' }],
  });
}

const as = (data: MemoryData, user: string, queue = new MemoryQueue()) =>
  operationContext(data, actor(user), POLICIES, { queue });

const denied = (promise: Promise<unknown>) => refused(promise);

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
    const received = await tasks.receive(ctx.tasks, { queueId: 'q1' });
    const id = `queue-message:${(received.data as { messageId: string }).messageId}`;
    const fresh = as(data, 'annotator');
    await denied(
      fresh.models.run('Observation', 'create', [
        {
          id: 'o1',
          projectId: 'p1',
          locationId: 'loc1',
          annotationSetId: 'a1',
        },
      ]),
    );
    const created = await fresh.models.run('Observation', 'create', [
      { id, projectId: 'p1', locationId: 'loc1', annotationSetId: 'a1' },
    ]);
    assert.equal(
      (created.data as { owner: string }).owner,
      'annotator::annotator',
    );
    await as(data, 'annotator').models.run('Observation', 'get', [{ id }]);
    await denied(as(data, 'other').models.run('Observation', 'get', [{ id }]));
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

  it('drops a redelivered task that someone already saved', async () => {
    const data = fixture();
    data.tables.Observation = [
      { id: 'queue-message:msg-0', projectId: 'p1', owner: 'other::other' },
    ];
    const queue = new MemoryQueue([
      { body: { location: { id: 'loc1', annotationSetId: 'a1' } } },
      { body: { location: { id: 'loc1', annotationSetId: 'a1' } } },
    ]);
    const received = await tasks.receiveBatch(
      as(data, 'annotator', queue).tasks,
      { queueId: 'q1', max: 5 },
    );
    assert.deepEqual(
      (received.data as { messageId: string }[]).map((t) => t.messageId),
      ['msg-1'],
    );
    assert.deepEqual(queue.removed, ['receipt-msg-0']);
    assert.equal(data.leases.length, 1);
  });

  it('caps unfinished tasks per queue and frees a slot on ack', async () => {
    const data = fixture();
    const queue = new MemoryQueue(
      Array.from({ length: 35 }, () => ({
        body: { location: { id: 'loc1', annotationSetId: 'a1' } },
      })),
    );
    const ctx = as(data, 'annotator', queue).tasks;
    for (const visibility of [0, 43_200]) {
      await assert.rejects(
        tasks.receiveBatch(ctx, { queueId: 'q1', max: 5, visibility }),
        (e: unknown) => e instanceof ApiError && e.status === 400,
      );
    }
    let held: { leaseId: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const batch = await tasks.receiveBatch(ctx, { queueId: 'q1', max: 10 });
      held = [...held, ...(batch.data as { leaseId: string }[])];
    }
    assert.equal(held.length, 30);
    await assert.rejects(
      tasks.receiveBatch(ctx, { queueId: 'q1', max: 10 }),
      (e: unknown) => e instanceof ApiError && e.status === 429,
    );
    await tasks.ack(ctx, { leaseId: held[0].leaseId });
    const done = data.leases.find((l) => l.leaseId === held[0].leaseId)!;
    assert.equal(done.acked, true);
    assert.ok(done.expiresAt <= Math.floor(Date.now() / 1000) + 3600);
    const next = await tasks.receiveBatch(ctx, { queueId: 'q1', max: 10 });
    assert.equal((next.data as unknown[]).length, 1);
  });

  it('holds the cap when receives run at the same time', async () => {
    const data = fixture();
    const queue = new MemoryQueue(
      Array.from({ length: 60 }, () => ({
        body: { location: { id: 'loc1', annotationSetId: 'a1' } },
      })),
    );
    const ctx = as(data, 'annotator', queue).tasks;
    const batches = await Promise.all(
      Array.from({ length: 6 }, () =>
        tasks
          .receiveBatch(ctx, { queueId: 'q1', max: 10 })
          .catch(() => ({ data: [] })),
      ),
    );
    const held = batches.flatMap((b) => b.data as unknown[]).length;
    assert.ok(held <= 30, `held ${held}`);
    assert.equal(data.locks.size, 0);
  });

  it('retries a task whose rows are not readable yet before dropping it', async () => {
    const data = fixture();
    const body = { location: { id: 'pending', annotationSetId: 'a1' } };
    const queue = new MemoryQueue([{ body }, { body, receiveCount: 5 }]);
    const ctx = as(data, 'annotator', queue).tasks;
    const received = await tasks.receiveBatch(ctx, { queueId: 'q1', max: 5 });
    assert.equal((received.data as unknown[]).length, 0);
    assert.deepEqual(queue.visibilities, [['receipt-msg-0', 60]]);
    assert.deepEqual(queue.removed, ['receipt-msg-1']);
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

  it('serves a test without its answers and grades it on the server', async () => {
    const data = fixture();
    data.tables.Annotation = [
      {
        id: 'in',
        projectId: 'p2',
        imageId: 'poolImage',
        setId: 'pool',
        categoryId: 'c',
        x: 12,
        y: 22,
      },
      {
        id: 'out',
        projectId: 'p2',
        imageId: 'poolImage',
        setId: 'pool',
        categoryId: 'c',
        x: 300,
        y: 300,
      },
    ];
    const ctx = as(data, 'annotator');
    const args = {
      projectId: 'p1',
      testPresetId: 'preset',
      locationId: 'foreign',
      annotationSetId: 'pool',
      jobAnnotationSetId: 'a1',
    };
    await denied(ctx.models.run('Location', 'get', [{ id: 'foreign' }]));
    const started = (await tasks.test(ctx.tasks, args)).data!;
    assert.deepEqual(started.box, { x: 10, y: 20, width: 30, height: 40 });
    assert.deepEqual(
      started.context.map((a) => [a.id, a.categoryName]),
      [['out', 'Elephant']],
    );
    const again = (await tasks.test(ctx.tasks, args)).data!;
    assert.equal(again.leaseId, started.leaseId);
    // Another job grades with its own labels, so it gets its own lease.
    data.tables.Category.push({
      id: 'j2',
      projectId: 'p1',
      annotationSetId: 'a2',
      name: 'Elephant',
    });
    const otherJob = (
      await tasks.test(ctx.tasks, { ...args, jobAnnotationSetId: 'a2' })
    ).data!;
    assert.notEqual(otherJob.leaseId, started.leaseId);

    const fresh = as(data, 'annotator');
    await fresh.models.run('Location', 'get', [{ id: 'foreign' }]);
    await fresh.models.run('Image', 'get', [{ id: 'poolImage' }]);
    await denied(fresh.models.run('Annotation', 'get', [{ id: 'in' }]));
    await denied(
      fresh.models.run(
        'LocationAnnotationCount',
        'categoryCountsByLocationIdAndAnnotationSetId',
        [{ locationId: 'foreign', annotationSetId: { eq: 'pool' } }],
      ),
    );
    await denied(
      fresh.models.run('TestResult', 'create', [
        { userId: 'annotator', projectId: 'p1', locationId: 'foreign' },
      ]),
    );

    const marks = [
      { x: 12, y: 22, categoryId: 'j1' },
      { x: 500, y: 300, categoryId: 'j1' },
    ];
    await tasks.submitTest(ctx.tasks, {
      leaseId: started.leaseId,
      annotations: marks,
    });
    await tasks.submitTest(ctx.tasks, {
      leaseId: started.leaseId,
      annotations: [...marks, ...marks],
    });
    assert.equal(data.tables.TestResult.length, 1);
    const [result] = data.tables.TestResult;
    assert.equal(result.userId, 'annotator');
    assert.equal(result.testAnimals, 2);
    assert.equal(result.totalMissedAnimals, 1);
    assert.deepEqual(
      data.tables.TestResultCategoryCount.map((c) => [
        c.categoryName,
        c.userCount,
        c.testCount,
      ]),
      [['Elephant', 1, 2]],
    );
    await assert.rejects(
      tasks.submitTest(as(data, 'other').tasks, {
        leaseId: started.leaseId,
        annotations: [],
      }),
      (e: unknown) => e instanceof ApiError && e.status === 404,
    );
  });

  it('finishes a partly saved test on retry with its first grade', async () => {
    const data = fixture();
    const ctx = as(data, 'annotator').tasks;
    const { leaseId } = (
      await tasks.test(ctx, {
        projectId: 'p1',
        testPresetId: 'preset',
        locationId: 'foreign',
        annotationSetId: 'pool',
        jobAnnotationSetId: 'a1',
      })
    ).data!;
    const create = data.create.bind(data);
    let failed = false;
    data.create = (async (model: string, input: Record<string, unknown>) => {
      if (model === 'TestResultCategoryCount' && !failed) {
        failed = true;
        return { data: null, errors: [{ message: 'throttled' }] };
      }
      return create(model, input);
    }) as typeof data.create;
    const mark = { x: 12, y: 22, categoryId: 'j1' };
    await assert.rejects(
      tasks.submitTest(ctx, { leaseId, annotations: [mark] }),
    );
    await tasks.submitTest(ctx, { leaseId, annotations: [mark, mark] });
    assert.equal(data.tables.TestResult.length, 1);
    assert.deepEqual(
      data.tables.TestResultCategoryCount.map((c) => c.userCount),
      [1],
    );
  });

  it('keeps one grade when submissions race', async () => {
    const data = fixture();
    const ctx = as(data, 'annotator').tasks;
    const { leaseId } = (
      await tasks.test(ctx, {
        projectId: 'p1',
        testPresetId: 'preset',
        locationId: 'foreign',
        annotationSetId: 'pool',
        jobAnnotationSetId: 'a1',
      })
    ).data!;
    const mark = { x: 12, y: 22, categoryId: 'j1' };
    await Promise.all([
      tasks.submitTest(ctx, { leaseId, annotations: [mark] }),
      tasks.submitTest(ctx, { leaseId, annotations: [mark, mark] }),
    ]);
    const [result] = data.tables.TestResult;
    const [count] = data.tables.TestResultCategoryCount;
    assert.equal(
      result.totalMissedAnimals,
      Number(result.testAnimals) - Number(count.userCount),
    );
    assert.deepEqual(data.leases[0].test?.grade?.counts, [
      { categoryName: 'Elephant', userCount: count.userCount, testCount: 2 },
    ]);
  });

  it("keeps another test's answers on the same image out of the context", async () => {
    const data = fixture();
    data.tables.Location.push({
      id: 'second',
      projectId: 'p2',
      imageId: 'poolImage',
      x: 200,
      y: 200,
      width: 30,
      height: 30,
    });
    data.tables.TestPresetLocation.push({
      testPresetId: 'preset',
      locationId: 'second',
      annotationSetId: 'pool',
    });
    data.tables.Annotation = [
      {
        id: 'other-answer',
        projectId: 'p2',
        imageId: 'poolImage',
        setId: 'pool',
        categoryId: 'c',
        x: 205,
        y: 195,
      },
      {
        id: 'context',
        projectId: 'p2',
        imageId: 'poolImage',
        setId: 'pool',
        categoryId: 'c',
        x: 400,
        y: 50,
      },
    ];
    const started = (
      await tasks.test(as(data, 'annotator').tasks, {
        projectId: 'p1',
        testPresetId: 'preset',
        locationId: 'foreign',
        annotationSetId: 'pool',
        jobAnnotationSetId: 'a1',
      })
    ).data!;
    assert.deepEqual(
      started.context.map((a) => a.id),
      ['context'],
    );
  });

  it('serves a tile-sized test but grades only its location box', async () => {
    const data = fixture();
    data.tables.Annotation = [
      {
        id: 'in',
        projectId: 'p2',
        imageId: 'poolImage',
        setId: 'pool',
        categoryId: 'c',
        x: 12,
        y: 22,
      },
      {
        id: 'margin',
        projectId: 'p2',
        imageId: 'poolImage',
        setId: 'pool',
        categoryId: 'c',
        x: 70,
        y: 70,
      },
    ];
    const ctx = as(data, 'annotator').tasks;
    const args = {
      projectId: 'p1',
      testPresetId: 'preset',
      locationId: 'foreign',
      annotationSetId: 'pool',
      jobAnnotationSetId: 'a1',
    };
    const tiled = (
      await tasks.test(ctx, {
        ...args,
        tile: {
          tile: { width: 100, height: 100 },
          image: { width: 600, height: 400 },
        },
      })
    ).data!;
    assert.deepEqual(tiled.box, { x: 50, y: 50, width: 100, height: 100 });
    // The margin is context, never an answer, whichever way the test is served.
    assert.deepEqual(
      tiled.context.map((a) => a.id),
      ['margin'],
    );
    await tasks.submitTest(ctx, {
      leaseId: tiled.leaseId,
      annotations: [
        { x: 12, y: 22, categoryId: 'j1' },
        { x: 70, y: 70, categoryId: 'j1' },
      ],
    });
    const [result] = data.tables.TestResult;
    assert.equal(result.testAnimals, 2);
    assert.equal(result.totalMissedAnimals, 1);
  });

  it('refuses tests the job cannot answer or that name another survey', async () => {
    const data = fixture();
    const ctx = as(data, 'annotator').tasks;
    const args = {
      projectId: 'p1',
      testPresetId: 'preset',
      locationId: 'foreign',
      annotationSetId: 'pool',
    };
    assert.equal(
      (await tasks.test(ctx, { ...args, jobAnnotationSetId: 'a2' })).data,
      null,
    );
    assert.equal(data.leases.length, 0);
    await denied(tasks.test(ctx, { ...args, jobAnnotationSetId: 'pool' }));
    // Only organisations that test someone hand them tests.
    assert.equal(
      (
        await tasks.test(as(data, 'other').tasks, {
          ...args,
          jobAnnotationSetId: 'a1',
        })
      ).data,
      null,
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

describe('review fixes', () => {
  // A test box on img1 in the job's own set, and work beside it.
  function testedFixture() {
    const data = fixture();
    data.tables.Location.push(
      {
        id: 'tbox',
        projectId: 'p1',
        imageId: 'img1',
        x: 50,
        y: 50,
        width: 20,
        height: 20,
      },
      {
        id: 'work',
        projectId: 'p1',
        imageId: 'img2',
        x: 50,
        y: 50,
        width: 20,
        height: 20,
      },
      {
        id: 'overlap',
        projectId: 'p1',
        imageId: 'img1',
        x: 55,
        y: 55,
        width: 20,
        height: 20,
      },
    );
    data.tables.TestPresetLocation.push({
      testPresetId: 'preset',
      locationId: 'tbox',
      annotationSetId: 'a1',
    });
    data.tables.Annotation = [
      {
        id: 'ans',
        projectId: 'p1',
        imageId: 'img1',
        setId: 'a1',
        categoryId: 'j1',
        x: 52,
        y: 52,
      },
      {
        id: 'free',
        projectId: 'p1',
        imageId: 'img1',
        setId: 'a1',
        categoryId: 'j1',
        x: 300,
        y: 300,
      },
    ];
    return data;
  }
  const work = (id = 'work') => ({
    body: { location: { id, annotationSetId: 'a1' } },
  });

  it('refuses relation objects and references to rows that do not exist', async () => {
    const data = fixture();
    const admin = as(data, 'root');
    admin.access.actor.groups.push('sysadmin');
    await refused(
      admin.models.run('Queue', 'create', [
        { projectId: 'p1', name: 'x', project: { id: 'p2' } },
      ]),
      400,
    );
    await refused(
      admin.models.run('Location', 'create', [
        { projectId: 'p1', imageId: 'missing' },
      ]),
      400,
    );
  });

  it("keeps a tester's own test answers out of their leases", async () => {
    const data = testedFixture();
    const { tasks: ctx, models } = as(
      data,
      'annotator',
      new MemoryQueue([work()]),
    );
    const [task] = (await tasks.receiveBatch(ctx, { queueId: 'q1', max: 1 }))
      .data;
    assert.ok(task);
    const fresh = as(data, 'annotator');
    assert.equal(
      (await fresh.models.run('Annotation', 'get', [{ id: 'ans' }])).data,
      null,
    );
    assert.ok(
      (await fresh.models.run('Annotation', 'get', [{ id: 'free' }])).data,
    );
    assert.equal(
      await fresh.models.canSubscribe('Annotation', 'imageId', 'img1'),
      false,
    );
    assert.equal(
      await fresh.models.canSubscribe('Annotation', 'imageId', 'img2'),
      true,
    );
    // Someone not tested sees the image as before.
    data.tables.OrganizationMembership.find(
      (m) => m.userId === 'annotator',
    )!.isTested = false;
    assert.ok(
      (
        await as(data, 'annotator').models.run('Annotation', 'get', [
          { id: 'ans' },
        ])
      ).data,
    );
    void models;
  });

  it("serves tasks on a tester's own test box but hides its answers", async () => {
    const data = testedFixture();
    const queue = new MemoryQueue([work('overlap')]);
    const ctx = as(data, 'annotator', queue).tasks;
    assert.equal(
      (await tasks.receiveBatch(ctx, { queueId: 'q1', max: 1 })).data.length,
      1,
    );
    const fresh = as(data, 'annotator');
    assert.equal(
      (await fresh.models.run('Annotation', 'get', [{ id: 'ans' }])).data,
      null,
    );
  });

  it('finishes a task only once its work is saved, and keeps releases final', async () => {
    const data = testedFixture();
    const queue = new MemoryQueue([work(), work()]);
    const { tasks: ctx, models } = as(data, 'annotator', queue);
    const [first, second] = (
      await tasks.receiveBatch(ctx, { queueId: 'q1', max: 2 })
    ).data as {
      leaseId: string;
      messageId: string;
    }[];
    await assert.rejects(
      tasks.ack(ctx, { leaseId: first.leaseId }),
      (e: unknown) => e instanceof ApiError && e.status === 409,
    );
    await models.run('Observation', 'create', [
      {
        id: `queue-message:${first.messageId}`,
        projectId: 'p1',
        locationId: 'work',
        annotationSetId: 'a1',
        annotationCount: 1,
      },
    ]);
    await tasks.ack(as(data, 'annotator', queue).tasks, {
      leaseId: first.leaseId,
    });
    assert.ok(queue.removed.includes('receipt-msg-0'));
    // The same location, now saved, may be let go as a duplicate.
    await tasks.visibility(ctx, { leaseId: second.leaseId, seconds: 0 });
    await assert.rejects(
      tasks.visibility(ctx, { leaseId: second.leaseId, seconds: 600 }),
      (e: unknown) => e instanceof ApiError && e.status === 404,
    );
  });

  it('shows neighbour images but lets a task change only its own', async () => {
    const data = testedFixture();
    const { tasks: ctx } = as(data, 'annotator', new MemoryQueue([work()]));
    await tasks.receiveBatch(ctx, { queueId: 'q1', max: 1 });
    const fresh = as(data, 'annotator');
    const mark = {
      projectId: 'p1',
      setId: 'a1',
      categoryId: 'j1',
      x: 300,
      y: 300,
    };
    await fresh.models.run('Annotation', 'create', [
      { ...mark, imageId: 'img2' },
    ]);
    await refused(
      fresh.models.run('Annotation', 'create', [{ ...mark, imageId: 'img1' }]),
    );
  });

  it('grades each spot once, counts wrong labels and repeats tests only once all are taken', async () => {
    const data = fixture();
    data.tables.Category.push({
      id: 'jz',
      projectId: 'p1',
      annotationSetId: 'a1',
      name: 'Zebra',
    });
    const ctx = as(data, 'annotator').tasks;
    const started = (
      await tasks.test(ctx, { projectId: 'p1', jobAnnotationSetId: 'a1' })
    ).data!;
    await tasks.submitTest(ctx, {
      leaseId: started.leaseId,
      annotations: [
        { x: 12, y: 22, categoryId: 'j1' },
        { x: 12, y: 22, categoryId: 'j1' },
        { x: 15, y: 25, categoryId: 'jz' },
      ],
    });
    const [result] = data.tables.TestResult;
    assert.equal(result.testAnimals, 2);
    assert.equal(result.totalMissedAnimals, 1);
    assert.equal(result.falsePositives, 1);
    assert.deepEqual(
      data.tables.TestResultCategoryCount.map((c) => [
        c.categoryName,
        c.userCount,
        c.testCount,
      ]),
      [
        ['Elephant', 1, 2],
        ['Zebra', 1, 0],
      ],
    );
    // Every location is tested, so the server starts round again.
    const again = (
      await tasks.test(ctx, { projectId: 'p1', jobAnnotationSetId: 'a1' })
    ).data!;
    assert.equal(again.location.id, started.location.id);
    await tasks.submitTest(ctx, { leaseId: again.leaseId, annotations: [] });
    assert.equal(data.tables.TestResult.length, 2);
  });

  it('holds back work when a test falls due until one is taken', async () => {
    const data = testedFixture();
    data.tables.Location.find((l) => l.id === 'loc1')!.width = 10;
    data.tables.Location.find((l) => l.id === 'loc1')!.height = 10;
    const queue = new MemoryQueue([work('loc1'), work('loc1'), work('loc1')]);
    const { tasks: ctx, models } = as(data, 'annotator', queue);
    const received = (await tasks.receiveBatch(ctx, { queueId: 'q1', max: 2 }))
      .data as {
      leaseId: string;
      messageId: string;
    }[];
    let due = false;
    for (const task of received) {
      await models.run('Observation', 'create', [
        {
          id: `queue-message:${task.messageId}`,
          projectId: 'p1',
          locationId: 'loc1',
          annotationSetId: 'a1',
          annotationCount: 0,
        },
      ]);
      due = (
        await tasks.ack(as(data, 'annotator', queue).tasks, {
          leaseId: task.leaseId,
        })
      ).testDue;
    }
    assert.equal(due, true);
    await assert.rejects(
      tasks.receiveBatch(ctx, { queueId: 'q1', max: 1 }),
      (e: unknown) => e instanceof ApiError && e.status === 409,
    );
    const started = (
      await tasks.test(ctx, { projectId: 'p1', jobAnnotationSetId: 'a1' })
    ).data!;
    await tasks.submitTest(ctx, { leaseId: started.leaseId, annotations: [] });
    assert.equal(
      (await tasks.receiveBatch(ctx, { queueId: 'q1', max: 1 })).data.length,
      1,
    );
  });

  it('credits observations to their own queue and counts each task once', async () => {
    const data = testedFixture();
    data.tables.Queue.push({
      id: 'q2',
      projectId: 'p1',
      url: 'https://queue/q2',
      annotationSetId: 'a1',
    });
    const queue = new MemoryQueue([work()]);
    const { tasks: ctx, models } = as(data, 'annotator', queue);
    const [task] = (await tasks.receiveBatch(ctx, { queueId: 'q1', max: 1 }))
      .data as {
      messageId: string;
    }[];
    const observation = {
      id: `queue-message:${task.messageId}`,
      projectId: 'p1',
      locationId: 'work',
      annotationSetId: 'a1',
    };
    data.intro.models.Observation.fields.queueId = {
      name: 'queueId',
      type: 'String',
    };
    await refused(
      models.run('Observation', 'create', [{ ...observation, queueId: 'q2' }]),
    );
    await models.run('Observation', 'create', [
      { ...observation, queueId: 'q1' },
    ]);
    const counted: string[] = [];
    const op = as(data, 'annotator', queue);
    op.queues.recordObservation = async (id: string) => {
      counted.push(id);
      return counted.length;
    };
    await OPERATIONS.incrementQueueCount.run!(op, { id: 'q1' });
    await OPERATIONS.incrementQueueCount.run!(as(data, 'annotator', queue), {
      id: 'q1',
    });
    assert.deepEqual(counted, ['q1']);
  });

  it('keeps labels to the annotation set and annotators to hand-made marks', async () => {
    const data = testedFixture();
    data.tables.Category.push({
      id: 'other',
      projectId: 'p1',
      annotationSetId: 'a2',
      name: 'Lion',
    });
    const { tasks: ctx } = as(data, 'annotator', new MemoryQueue([work()]));
    await tasks.receiveBatch(ctx, { queueId: 'q1', max: 1 });
    const fresh = as(data, 'annotator');
    const mark = {
      projectId: 'p1',
      setId: 'a1',
      imageId: 'img2',
      x: 300,
      y: 300,
    };
    await refused(
      fresh.models.run('Annotation', 'create', [
        { ...mark, categoryId: 'other' },
      ]),
    );
    await refused(
      fresh.models.run('Annotation', 'create', [
        { ...mark, categoryId: 'j1', source: 'scoutbotv3' },
      ]),
    );
    await fresh.models.run('Annotation', 'create', [
      { ...mark, categoryId: 'j1', source: 'manual-elephants' },
    ]);
  });

  it('adds only neighbours from the same survey to a lease', async () => {
    const data = testedFixture();
    data.tables.ImageNeighbour.push({
      image1Id: 'img2',
      image2Id: 'poolImage',
      projectId: 'p1',
    });
    const { tasks: ctx } = as(data, 'annotator', new MemoryQueue([work()]));
    await tasks.receiveBatch(ctx, { queueId: 'q1', max: 1 });
    assert.deepEqual(data.leases[0].imageIds.sort(), ['img1', 'img2']);
  });
});
