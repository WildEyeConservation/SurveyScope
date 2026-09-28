import { randomUUID } from 'node:crypto';
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  authorizeProject,
  requireStorageUser,
  requireString,
  type ProjectRow,
  type StorageIdentity,
} from '../shared/identity';
import { signingLifetime } from '../shared/presign';

/*
Browser access to workflow files in the outputs bucket. Every key is derived
by the server from a record the caller is authorized to see, so the browser
never names a key and cannot reach another organization's files.
*/

type Args = Record<string, unknown>;

export interface AppSyncEvent {
  identity: unknown;
  info: { fieldName: string };
  arguments: Args;
}

interface AnnotationSetRow {
  id: string;
  projectId: string;
}

interface JollyJobRow {
  jobKey: string;
  jobId: string;
  surveyId: string;
  statusKey: string;
}

export const FALSE_NEGATIVE_KINDS = {
  pool: 'false-negative-pools',
  history: 'false-negative-history',
} as const;

export const UPLOAD_KINDS = {
  'launch-payload': 'launch-payloads',
  'queue-manifest': 'queue-manifests',
} as const;

export const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function prefixFor<T extends Record<string, string>>(
  kinds: T,
  kind: string
): T[keyof T] {
  if (!Object.hasOwn(kinds, kind)) throw new Error('Invalid kind');
  return kinds[kind as keyof T];
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}

async function getRecord<T>(
  tableEnv: string,
  key: Record<string, string>
): Promise<T | undefined> {
  const result = await db.send(
    new GetCommand({ TableName: env(tableEnv), Key: key })
  );
  return result.Item as T | undefined;
}

export function createWorkflowFilesHandler(s3 = new S3Client({})) {
  const bucket = () => env('OUTPUTS_BUCKET_NAME');

  async function authorizedProject(
    user: StorageIdentity,
    projectId: string
  ): Promise<ProjectRow> {
    const project = await getRecord<ProjectRow>('WORKFLOW_PROJECT_TABLE', {
      id: projectId,
    });
    authorizeProject(user, project);
    return project;
  }

  async function authorizedAnnotationSet(
    user: StorageIdentity,
    args: Args
  ): Promise<AnnotationSetRow> {
    const annotationSet = await getRecord<AnnotationSetRow>(
      'WORKFLOW_ANNOTATIONSET_TABLE',
      { id: requireString(args, 'annotationSetId') }
    );
    if (!annotationSet)
      throw new Error('Unauthorized: annotation set unavailable');
    await authorizedProject(user, annotationSet.projectId);
    return annotationSet;
  }

  async function exists(key: string): Promise<boolean> {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) return false;
      throw error;
    }
  }

  async function downloadUrl(key: string) {
    const lifetime = await signingLifetime(s3);
    return {
      exists: true,
      url: await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket(), Key: key }),
        lifetime
      ),
      expiresAt: lifetime.expiresAt,
    };
  }

  async function falseNegativeFileUrl(user: StorageIdentity, args: Args) {
    const prefix = prefixFor(FALSE_NEGATIVE_KINDS, requireString(args, 'kind'));
    const annotationSet = await authorizedAnnotationSet(user, args);
    const key = `${prefix}/${annotationSet.id}.json`;
    if (!(await exists(key))) return { exists: false };
    return downloadUrl(key);
  }

  async function deleteFalseNegativeFiles(user: StorageIdentity, args: Args) {
    const annotationSet = await authorizedAnnotationSet(user, args);
    await Promise.all(
      Object.values(FALSE_NEGATIVE_KINDS).map((prefix) =>
        s3.send(
          new DeleteObjectCommand({
            Bucket: bucket(),
            Key: `${prefix}/${annotationSet.id}.json`,
          })
        )
      )
    );
    return true;
  }

  async function jollyStatusUrl(user: StorageIdentity, args: Args) {
    const surveyId = requireString(args, 'surveyId');
    const annotationSetId = requireString(args, 'annotationSetId');
    const jobId = requireString(args, 'jobId');
    await authorizedProject(user, surveyId);
    const job = await getRecord<JollyJobRow>('JOLLY_JOB_TABLE_NAME', {
      jobKey: `${surveyId}#${annotationSetId}`,
    });
    if (
      !job ||
      job.jobId !== jobId ||
      job.surveyId !== surveyId ||
      !job.statusKey?.startsWith('jolly-status/')
    ) {
      throw new Error('Unauthorized: results job unavailable');
    }
    return downloadUrl(job.statusKey);
  }

  async function prepareWorkflowUpload(user: StorageIdentity, args: Args) {
    const prefix = prefixFor(UPLOAD_KINDS, requireString(args, 'kind'));
    const project = await authorizedProject(
      user,
      requireString(args, 'projectId')
    );
    const key = `${prefix}/${randomUUID()}.json`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'If-None-Match': '*',
      'x-amz-meta-organization-id': project.organizationId,
      'x-amz-meta-project-id': project.id,
    };
    const lifetime = await signingLifetime(s3);
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        ContentType: 'application/json',
        IfNoneMatch: '*',
        Metadata: {
          'organization-id': project.organizationId,
          'project-id': project.id,
        },
      }),
      {
        ...lifetime,
        unhoistableHeaders: new Set(
          Object.keys(headers).map((h) => h.toLowerCase())
        ),
        signableHeaders: new Set(['content-type', 'if-none-match']),
      }
    );
    return { key, url, headers, expiresAt: lifetime.expiresAt };
  }

  const operations: Record<
    string,
    (user: StorageIdentity, args: Args) => Promise<unknown>
  > = {
    falseNegativeFileUrl,
    deleteFalseNegativeFiles,
    jollyStatusUrl,
    prepareWorkflowUpload,
  };

  return async function handler(event: AppSyncEvent): Promise<unknown> {
    const user = requireStorageUser(event.identity);
    const operation = operations[event.info.fieldName];
    if (!operation) throw new Error('Unsupported workflow file operation');
    return operation(user, event.arguments);
  };
}

export const handler = createWorkflowFilesHandler();
