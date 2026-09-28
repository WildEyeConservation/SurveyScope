import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { S3Client } from '@aws-sdk/client-s3';
import { createWorkflowFilesHandler, db, type AppSyncEvent } from './handler';

type Row = Record<string, unknown>;

const user = { sub: 'user-a', groups: ['org-a'] };
const outsider = { sub: 'user-b', groups: ['org-b'] };

function fixture(t: TestContext) {
  process.env.OUTPUTS_BUCKET_NAME = 'test-outputs';
  process.env.WORKFLOW_PROJECT_TABLE = 'Project';
  process.env.WORKFLOW_ANNOTATIONSET_TABLE = 'AnnotationSet';
  process.env.JOLLY_JOB_TABLE_NAME = 'JollyJobs';
  const records: Record<string, Row[]> = {
    Project: [{ id: 'p', organizationId: 'org-a', group: 'org-a' }],
    AnnotationSet: [{ id: 'as', projectId: 'p' }],
    JollyJobs: [
      {
        jobKey: 'p#as',
        jobId: 'job-1',
        surveyId: 'p',
        statusKey: 'jolly-status/jobs/job-1.json',
      },
    ],
  };
  t.mock.method(
    db,
    'send',
    async (command: { input: { TableName: string; Key: Row } }) => {
      const { TableName, Key } = command.input;
      return {
        Item: records[TableName].find((row) =>
          Object.entries(Key).every(([k, v]) => row[k] === v)
        ),
      };
    }
  );
  const s3 = new S3Client({
    region: 'eu-west-1',
    credentials: {
      accessKeyId: 'TESTONLYACCESSKEY',
      secretAccessKey: 'test-only-not-a-real-secret',
    },
  });
  const existing = new Set<string>();
  const s3Calls: { command: string; key: string }[] = [];
  t.mock.method(
    s3,
    'send',
    async (command: {
      constructor: { name: string };
      input: { Key: string };
    }) => {
      s3Calls.push({
        command: command.constructor.name,
        key: command.input.Key,
      });
      if (command.constructor.name === 'HeadObjectCommand') {
        if (existing.has(command.input.Key)) return {};
        throw { $metadata: { httpStatusCode: 404 } };
      }
      return {};
    }
  );
  return { handler: createWorkflowFilesHandler(s3), existing, s3Calls };
}

function event(
  fieldName: string,
  args: Record<string, unknown>,
  identity: unknown = user
): AppSyncEvent {
  return { identity, info: { fieldName }, arguments: args };
}

test('false-negative files are keyed by annotation set and scoped to its organization', async (t) => {
  const { handler, existing } = fixture(t);
  const args = { annotationSetId: 'as', kind: 'pool' };
  assert.deepEqual(await handler(event('falseNegativeFileUrl', args)), {
    exists: false,
  });
  existing.add('false-negative-pools/as.json');
  const file = (await handler(event('falseNegativeFileUrl', args))) as {
    exists: boolean;
    url: string;
  };
  assert.equal(file.exists, true);
  assert(new URL(file.url).pathname.endsWith('/false-negative-pools/as.json'));
  await assert.rejects(
    handler(event('falseNegativeFileUrl', args, outsider)),
    /Unauthorized/
  );
  for (const kind of ['../secret', 'constructor', '__proto__', 'toString']) {
    await assert.rejects(
      handler(event('falseNegativeFileUrl', { ...args, kind })),
      /Invalid kind/
    );
  }
  await assert.rejects(
    handler(
      event('falseNegativeFileUrl', { ...args, annotationSetId: 'nope' })
    ),
    /Unauthorized/
  );
  await assert.rejects(
    handler(event('falseNegativeFileUrl', args, null)),
    /Unauthorized/
  );
});

test('deleting false-negative files removes both manifests for an owned annotation set only', async (t) => {
  const { handler, s3Calls } = fixture(t);
  await handler(event('deleteFalseNegativeFiles', { annotationSetId: 'as' }));
  assert.deepEqual(
    s3Calls
      .filter((c) => c.command === 'DeleteObjectCommand')
      .map((c) => c.key)
      .sort(),
    ['false-negative-history/as.json', 'false-negative-pools/as.json']
  );
  await assert.rejects(
    handler(
      event('deleteFalseNegativeFiles', { annotationSetId: 'as' }, outsider)
    ),
    /Unauthorized/
  );
  assert.equal(
    s3Calls.filter((c) => c.command === 'DeleteObjectCommand').length,
    2
  );
});

test('jolly status is resolved from the job record, never from a client-supplied key', async (t) => {
  const { handler } = fixture(t);
  const args = { surveyId: 'p', annotationSetId: 'as', jobId: 'job-1' };
  const file = (await handler(event('jollyStatusUrl', args))) as {
    url: string;
  };
  assert(new URL(file.url).pathname.endsWith('/jolly-status/jobs/job-1.json'));
  await assert.rejects(
    handler(event('jollyStatusUrl', { ...args, jobId: 'other' })),
    /Unauthorized/
  );
  await assert.rejects(
    handler(event('jollyStatusUrl', args, outsider)),
    /Unauthorized/
  );
});

test('workflow uploads get a server-chosen key under the requested prefix with ownership metadata', async (t) => {
  const { handler } = fixture(t);
  const grant = (await handler(
    event('prepareWorkflowUpload', { kind: 'launch-payload', projectId: 'p' })
  )) as { key: string; url: string; headers: Record<string, string> };
  assert.match(grant.key, /^launch-payloads\/[0-9a-f-]{36}\.json$/);
  assert.equal(grant.headers['If-None-Match'], '*');
  assert.equal(grant.headers['x-amz-meta-project-id'], 'p');
  const url = new URL(grant.url);
  assert(url.pathname.endsWith(`/${grant.key}`));
  assert(
    url.searchParams.get('X-Amz-SignedHeaders')!.includes('if-none-match')
  );
  const manifest = (await handler(
    event('prepareWorkflowUpload', { kind: 'queue-manifest', projectId: 'p' })
  )) as { key: string };
  assert(manifest.key.startsWith('queue-manifests/'));
  await assert.rejects(
    handler(
      event('prepareWorkflowUpload', { kind: 'slippymaps', projectId: 'p' })
    ),
    /Invalid kind/
  );
  await assert.rejects(
    handler(
      event(
        'prepareWorkflowUpload',
        { kind: 'launch-payload', projectId: 'p' },
        outsider
      )
    ),
    /Unauthorized/
  );
  await assert.rejects(handler(event('nope', {})), /Unsupported/);
});
