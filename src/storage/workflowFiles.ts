import { storageOperation } from './api';

/*
Workflow files in the outputs bucket (jolly result status, launch payloads
and queue manifests). The workflowFiles backend
authorizes each request against the owning project and derives the key, so
the browser never names an S3 key.
*/

interface FileUrl {
  exists: boolean;
  url?: string;
  expiresAt?: number;
}

interface UploadGrant {
  key: string;
  url: string;
  headers: Record<string, string>;
}

export type WorkflowUploadKind = 'launch-payload' | 'queue-manifest';

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) {
    throw new Error(`Workflow file download failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function readJollyStatus<T>(
  surveyId: string,
  annotationSetId: string,
  jobId: string,
): Promise<T> {
  const file = await storageOperation<FileUrl>(
    `query JollyStatusUrl($surveyId: ID!, $annotationSetId: ID!, $jobId: ID!) {
    jollyStatusUrl(surveyId: $surveyId, annotationSetId: $annotationSetId, jobId: $jobId)
  }`,
    { surveyId, annotationSetId, jobId },
    'jollyStatusUrl',
  );
  if (!file.url) throw new Error('Results status is not available yet');
  return fetchJson<T>(file.url);
}

/** Uploads a JSON document and returns the server-assigned key. */
export async function uploadWorkflowFile(
  kind: WorkflowUploadKind,
  projectId: string,
  body: string,
): Promise<string> {
  const grant = await storageOperation<UploadGrant>(
    `mutation PrepareWorkflowUpload($kind: String!, $projectId: ID!) {
    prepareWorkflowUpload(kind: $kind, projectId: $projectId)
  }`,
    { kind, projectId },
    'prepareWorkflowUpload',
  );
  const response = await fetch(grant.url, {
    method: 'PUT',
    headers: grant.headers,
    body,
  });
  if (!response.ok) {
    throw new Error(`Workflow file upload failed: ${response.status}`);
  }
  return grant.key;
}
