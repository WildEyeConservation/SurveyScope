import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataClient } from '../amplify/shared/data-schema.generated';
import {
  attachInfoTagsToAnnotations,
  commitInfoTagsForAnnotation,
  finalizeInfoTagImage,
  infoTagIdsFromLinks,
  planInfoTagLinkChanges,
} from './infoTags';

type Call = { name: string; input: Record<string, unknown> };

test('untagged sets strip API relationship loaders before annotations reach map popups', async () => {
  const relationship = async (_options: unknown) => ({ data: [] });
  const annotations = [
    { id: 'a', infoTags: relationship },
    { id: 'b', infoTags: { items: [] } },
    { id: 'c', infoTags: ['stale tag'] },
  ];
  const client = {
    models: {
      InfoTag: {
        infoTagsByAnnotationSetId: async () => ({ data: [] }),
      },
      AnnotationInfoTag: {
        annotationInfoTagsByAnnotationSetId: async () => {
          assert.fail('untagged sets should not fetch annotation links');
        },
      },
    },
  } as unknown as DataClient;

  const result = await attachInfoTagsToAnnotations(client, annotations, 'set-1');
  assert.deepEqual(result, [
    { id: 'a', infoTags: undefined },
    { id: 'b', infoTags: undefined },
    { id: 'c', infoTags: undefined },
  ]);
  assert.equal(annotations[0].infoTags, relationship);
});

test('tagged sets resolve sorted names and retain empty arrays for untagged annotations', async () => {
  const client = {
    models: {
      InfoTag: {
        infoTagsByAnnotationSetId: async () => ({ data: [
          { id: 'z', name: 'Zebra' },
          { id: 'a', name: 'Adult' },
        ] }),
      },
      AnnotationInfoTag: {
        annotationInfoTagsByAnnotationSetId: async () => ({ data: [
          { annotationId: 'tagged', infoTagId: 'z' },
          { annotationId: 'tagged', infoTagId: 'a' },
        ] }),
      },
    },
  } as unknown as DataClient;

  const result = await attachInfoTagsToAnnotations(client, [
    { id: 'tagged', infoTags: async () => ({ data: [] }) },
    { id: 'untagged' },
  ], 'set-1');
  assert.deepEqual(result, [
    { id: 'tagged', infoTags: ['Adult', 'Zebra'] },
    { id: 'untagged', infoTags: [] },
  ]);
});

test('image queue progress is not repeated after an ack retry', async () => {
  const steps: string[] = [];
  const progress = { counted: false, acknowledged: false };
  let failAck = true;
  const options = {
    commits: [Promise.resolve().then(() => { steps.push('saved'); })],
    progress,
    countCompletion: true,
    incrementCount: async () => { steps.push('count'); },
    acknowledge: async () => {
      steps.push('ack');
      if (failAck) throw new Error('ack failed');
    },
  };
  await assert.rejects(finalizeInfoTagImage(options), /ack failed/);
  failAck = false;
  await finalizeInfoTagImage(options);
  assert.deepEqual(steps, ['saved', 'count', 'ack', 'ack']);
});

test('failed annotation saves do not report statistics', async () => {
  let statistics = 0;
  const { client } = fakeClient({ updateAnnotation: { errors: [{ message: 'save failed' }] } });
  await assert.rejects(commitInfoTagsForAnnotation(client, {
    ...commit, recordStatistics: async () => { statistics++; },
  }), /save failed/);
  assert.equal(statistics, 0);
});

test('partial-image work reports each saved annotation without finishing the image', async () => {
  const { client, calls } = fakeClient();
  const reported: string[] = [];
  for (const annotationId of ['first', 'second']) {
    await commitInfoTagsForAnnotation(client, {
      ...commit, annotationId,
      recordStatistics: async () => {
        assert.equal(calls.at(-1)?.name, 'updateAnnotation');
        reported.push(annotationId);
      },
    });
  }
  assert.deepEqual(reported, ['first', 'second']);
});

test('last annotation reports before image progress and acknowledgement', async () => {
  const { client } = fakeClient();
  const order: string[] = [];
  await finalizeInfoTagImage({
    commits: [commitInfoTagsForAnnotation(client, {
      ...commit, recordStatistics: async () => { order.push('annotation'); },
    })],
    progress: { counted: false, acknowledged: false }, countCompletion: true,
    incrementCount: async () => { order.push('image'); },
    acknowledge: async () => { order.push('ack'); },
  });
  assert.deepEqual(order, ['annotation', 'image', 'ack']);
});

function fakeClient(
  responses: Record<string, { errors?: Array<{ message: string }> }> = {}
) {
  const calls: Call[] = [];
  const respond = (name: string) => async (input: Record<string, unknown>) => {
    calls.push({ name, input });
    return { data: {}, ...(responses[name] ?? {}) };
  };
  const client = {
    models: {
      AnnotationInfoTag: {
        create: respond('createLink'),
        delete: respond('deleteLink'),
      },
      Annotation: { update: respond('updateAnnotation') },
    },
  } as unknown as DataClient;
  return { client, calls };
}

const commit = {
  annotationId: 'annotation-1',
  annotationSetId: 'set-1',
  projectId: 'project-1',
  group: 'org-1',
  before: ['tag-old'],
  after: ['tag-new'],
  position: { x: 10, y: 20 },
  taggedBy: 'user-1',
};

test('planInfoTagLinkChanges reports only the differences', () => {
  const { added, removed } = planInfoTagLinkChanges(
    ['a', 'b'],
    ['b', 'c']
  );
  assert.deepEqual(added, ['c']);
  assert.deepEqual(removed, ['a']);
});

test('infoTagIdsFromLinks accepts array and paged link shapes', () => {
  assert.deepEqual(infoTagIdsFromLinks([{ infoTagId: 'a' }]), ['a']);
  assert.deepEqual(infoTagIdsFromLinks({ items: [{ infoTagId: 'b' }] }), ['b']);
  assert.deepEqual(infoTagIdsFromLinks(undefined), []);
  assert.deepEqual(infoTagIdsFromLinks([{ infoTagId: null }]), []);
});

test('a failed link write leaves the annotation untagged', async () => {
  const { client, calls } = fakeClient({
    createLink: { errors: [{ message: 'Network error' }] },
  });

  await assert.rejects(
    () => commitInfoTagsForAnnotation(client, commit),
    /Failed to add info tag tag-new: Network error/
  );
  assert.equal(
    calls.some((call) => call.name === 'updateAnnotation'),
    false,
    'infoTaggedBy must not be set while a tag link is missing'
  );
});

test('links are written before the annotation is marked tagged', async () => {
  const { client, calls } = fakeClient();

  await commitInfoTagsForAnnotation(client, commit);

  assert.deepEqual(
    calls.map((call) => call.name).sort(),
    ['createLink', 'deleteLink', 'updateAnnotation']
  );
  assert.equal(calls.at(-1)?.name, 'updateAnnotation');
  assert.deepEqual(calls.at(-1)?.input, {
    id: 'annotation-1',
    infoTaggedBy: 'user-1',
    x: 10,
    y: 20,
  });
});

test('a link that is already in the wanted state does not fail a retry', async () => {
  const { client, calls } = fakeClient({
    createLink: { errors: [{ message: 'The conditional request failed' }] },
    deleteLink: { errors: [{ message: 'The conditional request failed' }] },
  });

  await commitInfoTagsForAnnotation(client, commit);

  assert.equal(calls.at(-1)?.name, 'updateAnnotation');
});

test('a failed save is neither counted nor acknowledged', async () => {
  const progress = { counted: false, acknowledged: false };
  let counted = 0;
  let acknowledged = 0;

  await assert.rejects(
    () =>
      finalizeInfoTagImage({
        commits: [Promise.resolve(), Promise.reject(new Error('save failed'))],
        progress,
        countCompletion: true,
        incrementCount: async () => {
          counted++;
        },
        acknowledge: async () => {
          acknowledged++;
        },
      }),
    /save failed/
  );

  assert.equal(counted, 0);
  assert.equal(acknowledged, 0, 'the queue message must stay for redelivery');
  assert.deepEqual(progress, { counted: false, acknowledged: false });
});

test('a retried finish does not count the image twice', async () => {
  const progress = { counted: false, acknowledged: false };
  let counted = 0;
  let acknowledged = 0;
  const options = {
    commits: [],
    progress,
    countCompletion: true,
    incrementCount: async () => {
      counted++;
    },
    acknowledge: async () => {
      acknowledged++;
    },
  };

  await finalizeInfoTagImage(options);
  await finalizeInfoTagImage(options);

  assert.equal(counted, 1);
  assert.equal(acknowledged, 1);
  assert.deepEqual(progress, { counted: true, acknowledged: true });
});

test('an image with no work is acknowledged without being counted', async () => {
  const progress = { counted: false, acknowledged: false };
  let counted = 0;
  let acknowledged = 0;

  await finalizeInfoTagImage({
    commits: [],
    progress,
    countCompletion: false,
    incrementCount: async () => {
      counted++;
    },
    acknowledge: async () => {
      acknowledged++;
    },
  });

  assert.equal(counted, 0);
  assert.equal(acknowledged, 1);
});
