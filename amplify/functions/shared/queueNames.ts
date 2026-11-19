import {
  DeleteQueueCommand,
  GetQueueUrlCommand,
  ListQueueTagsCommand,
} from '@aws-sdk/client-sqs';

const SQS_NAME_LIMIT = 80;
export const PROJECT_TAG = 'surveyscope:projectId';
export const QUEUE_TAG = 'surveyscope:queueId';

type Graphql = <T>(query: string, variables: Record<string, unknown>) => Promise<T>;

// The queue id always survives in full; only the display part is truncated.
export function buildQueueName(
  displayName: string,
  queueId: string,
  fifo = false,
): string {
  if (!/^[a-zA-Z0-9-_]+$/.test(queueId)) {
    throw new Error('Queue id contains characters SQS does not allow');
  }
  const suffix = `-${queueId}${fifo ? '.fifo' : ''}`;
  if (suffix.length >= SQS_NAME_LIMIT) {
    throw new Error('Queue id is too long for an SQS queue name');
  }
  const base =
    displayName
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .slice(0, SQS_NAME_LIMIT - suffix.length) || 'queue';
  return `${base}${suffix}`;
}

// Passed as CreateQueue Tags so deletion can confirm a queue belongs to its row.
export function queueTags(projectId: string, queueId: string): Record<string, string> {
  return { [PROJECT_TAG]: projectId, [QUEUE_TAG]: queueId };
}

const queuesByUrlQuery = /* GraphQL */ `
  query QueuesByUrl($filter: ModelQueueFilterInput, $nextToken: String) {
    listQueues(filter: $filter, limit: 1000, nextToken: $nextToken) {
      items {
        id
      }
      nextToken
    }
  }
`;

// SQS returns an existing queue's URL when the name matches, so confirm the
// URL is ours and that no Queue row already points at it.
export async function assertNewQueueUrl(
  queueUrl: string,
  queueName: string,
  graphql: Graphql,
): Promise<void> {
  if (!queueUrl.endsWith(`/${queueName}`)) {
    throw new Error('SQS returned a queue URL for a different name');
  }
  let nextToken: string | null | undefined;
  do {
    const data = await graphql<{
      listQueues?: { items?: Array<{ id: string } | null>; nextToken?: string | null };
    }>(queuesByUrlQuery, { filter: { url: { eq: queueUrl } }, nextToken });
    if (data.listQueues?.items?.some(Boolean)) {
      throw new Error('Another queue already uses this SQS queue URL');
    }
    nextToken = data.listQueues?.nextToken;
  } while (nextToken);
}

type SqsSender = { send(command: unknown): Promise<unknown> };
export type QueueRow = { id: string; projectId: string; url?: string | null };
export type QueueDeleteOutcome = 'deleted' | 'missing' | 'skipped';

function isMissingQueue(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === 'QueueDoesNotExist' || name === 'AWS.SimpleQueueService.NonExistentQueue';
}

function queueRegion(url: URL): string | undefined {
  return /^(?:sqs\.([a-z0-9-]+)\.amazonaws\.com|([a-z0-9-]+)\.queue\.amazonaws\.com)$/
    .exec(url.hostname)
    ?.slice(1)
    .find(Boolean);
}

// Deletes the SQS queue behind a Queue row only when the queue is bound to that row.
export async function deleteBoundQueue(
  sqs: SqsSender,
  row: QueueRow,
  graphql: Graphql,
  region: string | undefined = process.env.AWS_REGION,
): Promise<QueueDeleteOutcome> {
  if (!row.url) return 'missing';
  const skip = (reason: string) => {
    console.warn('Not deleting SQS queue', { queueId: row.id, url: row.url, reason });
    return 'skipped' as const;
  };
  let parsed: URL;
  try {
    parsed = new URL(row.url);
  } catch {
    return skip('invalid URL');
  }
  const queueName = parsed.pathname.split('/').pop() ?? '';
  if (!region || queueRegion(parsed) !== region || !queueName) {
    return skip('URL is outside this region');
  }
  try {
    const own = (await sqs.send(
      new GetQueueUrlCommand({ QueueName: queueName }),
    )) as { QueueUrl?: string };
    if (!own.QueueUrl || new URL(own.QueueUrl).pathname !== parsed.pathname) {
      return skip('URL is outside this account');
    }
    const { Tags: tags = {} } = (await sqs.send(
      new ListQueueTagsCommand({ QueueUrl: row.url }),
    )) as { Tags?: Record<string, string> };
    if (tags[QUEUE_TAG] !== undefined || tags[PROJECT_TAG] !== undefined) {
      if (tags[QUEUE_TAG] !== row.id || tags[PROJECT_TAG] !== row.projectId) {
        return skip('queue tags belong to another row');
      }
    } else {
      // Older queues carry no tags; one no other row uses belongs to this row.
      let nextToken: string | null | undefined;
      do {
        const data = await graphql<{
          listQueues?: { items?: Array<{ id: string } | null>; nextToken?: string | null };
        }>(queuesByUrlQuery, { filter: { url: { eq: row.url } }, nextToken });
        if (data.listQueues?.items?.some((q) => q && q.id !== row.id)) {
          return skip('another queue row uses this URL');
        }
        nextToken = data.listQueues?.nextToken;
      } while (nextToken);
    }
    await sqs.send(new DeleteQueueCommand({ QueueUrl: row.url }));
    return 'deleted';
  } catch (err) {
    if (isMissingQueue(err)) return 'missing';
    throw err;
  }
}
