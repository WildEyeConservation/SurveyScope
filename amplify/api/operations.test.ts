import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ApiError } from './errors';
import type { DispatchTargets, ImageRef, LaunchStore } from './launch';
import { Authorized, OPERATIONS } from './operations';
import { POLICIES } from './policies';
import { actor, MemoryData, operationContext } from './testing';

function fixture() {
  return new MemoryData({
    OrganizationMembership: [
      { organizationId: 'org1', userId: 'admin', isAdmin: true },
      { organizationId: 'org1', userId: 'annotator', isAdmin: false },
      { organizationId: 'org1', userId: 'lead', isAdmin: false },
    ],
    Project: [
      { id: 'p1', organizationId: 'org1' },
      { id: 'p2', organizationId: 'org1' },
      { id: 'p3', organizationId: 'org1', tags: ['legacy'] },
    ],
    UserProjectMembership: [
      { id: 'm1', userId: 'annotator', projectId: 'p1' },
      { id: 'm2', userId: 'lead', projectId: 'p1', isAdmin: true },
    ],
    AnnotationSet: [
      { id: 'a1', projectId: 'p1' },
      { id: 'a2', projectId: 'p2' },
    ],
    LocationSet: [
      { id: 'l1', projectId: 'p1' },
      { id: 'l2', projectId: 'p2' },
      { id: 'l3', projectId: 'p3' },
    ],
    Queue: [{ id: 'q1', projectId: 'p1' }],
  });
}

class Files implements LaunchStore {
  files = new Map<string, unknown>();
  removed: string[] = [];
  rows: Record<string, Record<string, string>> = {
    AnnotationSet: { a1: 'p1', a2: 'p2' },
    LocationSet: { l1: 'p1', l2: 'p2' },
    Image: { i1: 'p1', i2: 'p2' },
  };
  images: Record<string, ImageRef> = {
    i1: { projectId: 'p1', originalPath: 'a/1.jpg' },
    i2: { projectId: 'p2', originalPath: 'b/2.jpg' },
    i3: { projectId: 'p3', originalPath: 'c/3.jpg' },
    i4: { projectId: 'p1', originalPath: null },
  };
  targets: DispatchTargets | null = {
    bucket: 'inputs',
    queues: { runScoutbot: 'scoutbot-queue', runImageRegistration: 'lg-queue' },
  };
  async readJson(key: string) {
    if (!this.files.has(key)) throw new Error(`missing ${key}`);
    return this.files.get(key);
  }
  async writeJson(prefix: string, value: unknown) {
    const key = `${prefix}copy-${this.files.size}.json`;
    this.files.set(key, value);
    return key;
  }
  async remove(key: string) {
    this.removed.push(key);
  }
  async imagesOf(ids: string[]) {
    return new Map(
      ids.flatMap((id) => (this.images[id] ? [[id, this.images[id]]] : [])) as [
        string,
        ImageRef,
      ][],
    );
  }
  async dispatchTargets() {
    return this.targets;
  }
  async projectsOf(model: string, ids: string[]) {
    return new Map(
      ids.flatMap((id) =>
        this.rows[model]?.[id] ? [[id, this.rows[model][id]]] : [],
      ) as [string, string][],
    );
  }
}

const authorize = (
  user: string,
  name: string,
  args: Record<string, unknown>,
  launches: LaunchStore = new Files(),
) => {
  const data = fixture();
  return OPERATIONS[name].authorize(
    operationContext(data, actor(user), POLICIES, { launches }),
    args,
  );
};

const rejected = (status: number) => (promise: Promise<unknown>) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof ApiError && e.status === status,
  );
const denied = rejected(403);
const invalid = rejected(400);

describe('operation authorisation', () => {
  it('lets survey admins launch only with their own survey rows', async () => {
    const request = (body: Record<string, unknown>) => ({
      request: JSON.stringify(body),
    });
    await authorize(
      'lead',
      'launchAnnotationSet',
      request({
        projectId: 'p1',
        annotationSetId: 'a1',
        locationSetIds: ['l1'],
      }),
    );
    await denied(
      authorize(
        'lead',
        'launchAnnotationSet',
        request({ projectId: 'p1', annotationSetId: 'a2' }),
      ),
    );
    await denied(
      authorize(
        'lead',
        'launchAnnotationSet',
        request({
          projectId: 'p1',
          annotationSetId: 'a1',
          locationSetIds: ['l1', 'l2'],
        }),
      ),
    );
    await denied(
      authorize(
        'annotator',
        'launchQCReview',
        request({ projectId: 'p1', annotationSetId: 'a1' }),
      ),
    );
  });

  it('checks nested references and the files a launch reads', async () => {
    const request = (body: Record<string, unknown>) => ({
      request: JSON.stringify(body),
    });
    await denied(
      authorize(
        'lead',
        'launchAnnotationSet',
        request({
          projectId: 'p1',
          annotationSetId: 'a1',
          tiledRequest: { existingLocationSetId: 'l2', images: [{ id: 'i1' }] },
        }),
      ),
    );

    const files = new Files();
    files.files.set('launch-payloads/user.json', {
      projectId: 'p2',
      annotationSetId: 'a2',
    });
    await denied(
      authorize(
        'lead',
        'launchAnnotationSet',
        request({ projectId: 'p1', payloadS3Key: 'launch-payloads/user.json' }),
        files,
      ),
    );

    files.files.set('queue-manifests/m.json', { items: [{ imageId: 'i2' }] });
    await denied(
      authorize(
        'lead',
        'launchHomography',
        request({
          projectId: 'p1',
          annotationSetId: 'a1',
          manifestS3Key: 'queue-manifests/m.json',
        }),
        files,
      ),
    );

    files.files.set('queue-manifests/ok.json', { items: [{ imageId: 'i1' }] });
    files.files.set('launch-payloads/ok.json', {
      projectId: 'p1',
      annotationSetId: 'a1',
      locationManifestS3Key: 'queue-manifests/ok.json',
    });
    const verdict = await authorize(
      'lead',
      'launchAnnotationSet',
      request({ payloadS3Key: 'launch-payloads/ok.json' }),
      files,
    );
    assert.ok(verdict instanceof Authorized);
    const passed = JSON.parse(String(verdict.grant.args!.request));
    assert.match(passed.payloadS3Key, /^launch-payloads\/copy-/);
    const stored = files.files.get(passed.payloadS3Key) as Record<
      string,
      string
    >;
    assert.match(stored.locationManifestS3Key, /^queue-manifests\/copy-/);
    assert.deepEqual(files.removed.sort(), [
      'launch-payloads/ok.json',
      'queue-manifests/ok.json',
    ]);
  });

  it('ties detectors and queue deletion to survey admins', async () => {
    await authorize('admin', 'runScoutbot', { projectId: 'p1', setId: 'l1' });
    await denied(
      authorize('annotator', 'runScoutbot', { projectId: 'p1', setId: 'l1' }),
    );
    await denied(
      authorize('admin', 'runScoutbot', { projectId: 'p1', setId: 'l2' }),
    );
    await denied(
      authorize('annotator', 'deleteProjectInFull', { projectId: 'p1' }),
    );
    await denied(
      authorize('annotator', 'deleteQueueMutation', { queueId: 'q1' }),
    );
    await authorize('admin', 'deleteQueueMutation', { queueId: 'q1' });
  });

  it('passes detectors only the survey images under their stored keys', async () => {
    const run = (
      args: Record<string, unknown>,
      name = 'runScoutbot',
      files = new Files(),
    ) =>
      authorize(
        'admin',
        name,
        { projectId: 'p1', setId: 'l1', ...args },
        files,
      );

    const verdict = await run({
      images: ['i1---org1/p1/a/1.jpg'],
      bucket: 'elsewhere',
      queueUrl: 'elsewhere',
    });
    assert.ok(verdict instanceof Authorized);
    assert.deepEqual(verdict.grant.args, {
      projectId: 'p1',
      setId: 'l1',
      images: ['i1---org1/p1/a/1.jpg'],
      bucket: 'inputs',
      queueUrl: 'scoutbot-queue',
    });

    await denied(run({ images: ['i2---org1/p2/b/2.jpg'] }));
    await denied(run({ images: ['missing---org1/p1/a/1.jpg'] }));
    await denied(run({ images: ['i1---org1/p2/a/1.jpg'] }));
    await denied(run({ images: ['i1---a/1.jpg'] }));
    await denied(run({ images: ['i4---org1/p1/'] }));
    await invalid(run({ images: ['i1'] }));
    await invalid(run({ images: [42] }));
    await invalid(run({ images: 'i1---org1/p1/a/1.jpg' }));

    await authorize('admin', 'runScoutbot', {
      projectId: 'p3',
      setId: 'l3',
      images: ['i3---c/3.jpg'],
    });
    await denied(
      authorize('admin', 'runScoutbot', {
        projectId: 'p3',
        setId: 'l3',
        images: ['i3---org1/p3/c/3.jpg'],
      }),
    );
  });

  it('refuses detectors without a configured queue', async () => {
    const args = { projectId: 'p1', setId: 'l1', images: [] };
    await rejected(503)(authorize('admin', 'runMadDetector', args));
    const files = new Files();
    files.targets = null;
    await rejected(503)(authorize('admin', 'runScoutbot', args, files));
  });

  it('passes registration only survey images with their stored paths', async () => {
    const run = (metadata: unknown, user = 'admin') =>
      authorize(user, 'runImageRegistration', {
        projectId: 'p1',
        metadata: JSON.stringify(metadata),
        queueUrl: 'elsewhere',
      });
    const verdict = await run({
      images: [
        { id: 'i1', originalPath: 'a/1.jpg', timestamp: 1 },
        { id: 'i4', timestamp: 2 },
      ],
      sessionIds: ['i1'],
    });
    assert.ok(verdict instanceof Authorized);
    assert.equal(verdict.grant.args!.queueUrl, 'lg-queue');
    await run({ masks: [] });

    await denied(run({ images: [{ id: 'i1' }] }, 'annotator'));
    await denied(run({ images: [{ id: 'i2', originalPath: 'b/2.jpg' }] }));
    await denied(run({ images: [{ id: 'i1', originalPath: 'b/2.jpg' }] }));
    await denied(run({ images: [{ id: 'i1' }] }));
    await denied(run({ images: [], sessionIds: ['i2'] }));
    await invalid(run({ images: [{ originalPath: 'a/1.jpg' }] }));
    await invalid(run({ images: {} }));
    await invalid(run({ sessionIds: [1] }));
    await invalid(run(['i1']));
    await invalid(
      authorize('admin', 'runImageRegistration', {
        projectId: 'p1',
        metadata: '{not json',
      }),
    );
  });
});
