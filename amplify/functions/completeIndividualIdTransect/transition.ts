import {
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

export interface TransectTables {
  IndividualIdJob: string;
  IndividualIdTransect: string;
}

type Sender = { send(command: unknown): Promise<unknown> };

export type TransitionResult =
  | { kind: 'missing' }
  | { kind: 'mismatch' }
  | { kind: 'alreadyComplete'; job: JobRow }
  | { kind: 'noop' }
  | { kind: 'completed'; job: JobRow };

export interface JobRow {
  id: string;
  projectId: string;
  status?: string | null;
  remainingTransects?: number | null;
}

interface TransectRow {
  id: string;
  jobId: string;
  projectId: string;
  status?: string | null;
}

async function get<T>(db: Sender, table: string, id: string): Promise<T | undefined> {
  const result = (await db.send(
    new GetCommand({ TableName: table, Key: { id }, ConsistentRead: true })
  )) as { Item?: T };
  return result.Item;
}

function cancellationCodes(err: unknown): (string | undefined)[] | null {
  if ((err as { name?: string })?.name !== 'TransactionCanceledException') return null;
  const reasons = (err as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
  return (reasons ?? []).map((r) => r?.Code);
}

// Completes the caller's transect and decrements its job in one transaction.
export async function completeTransect(
  db: Sender,
  tables: TransectTables,
  transectId: string,
  userId: string,
  now = new Date().toISOString()
): Promise<TransitionResult> {
  const transect = await get<TransectRow>(db, tables.IndividualIdTransect, transectId);
  if (!transect) return { kind: 'missing' };
  const job = await get<JobRow>(db, tables.IndividualIdJob, transect.jobId);
  if (!job || job.projectId !== transect.projectId) return { kind: 'mismatch' };
  if (transect.status === 'completed') return { kind: 'alreadyComplete', job };

  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tables.IndividualIdTransect,
              Key: { id: transectId },
              UpdateExpression: 'SET #status = :completed, updatedAt = :now',
              ConditionExpression:
                '#status = :assigned AND assignedUserId = :user AND projectId = :project AND jobId = :job',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':completed': 'completed',
                ':assigned': 'assigned',
                ':user': userId,
                ':project': transect.projectId,
                ':job': transect.jobId,
                ':now': now,
              },
            },
          },
          {
            Update: {
              TableName: tables.IndividualIdJob,
              Key: { id: transect.jobId },
              UpdateExpression: 'ADD remainingTransects :neg1 SET updatedAt = :now',
              ConditionExpression: 'attribute_exists(id) AND projectId = :project',
              ExpressionAttributeValues: {
                ':neg1': -1,
                ':project': transect.projectId,
                ':now': now,
              },
            },
          },
        ],
      })
    );
  } catch (err) {
    const codes = cancellationCodes(err);
    if (!codes) throw err;
    if (codes[1] === 'ConditionalCheckFailed') return { kind: 'mismatch' };
    // Not the holder, or another call completed it first.
    if (codes[0] === 'ConditionalCheckFailed') return { kind: 'noop' };
    throw err;
  }

  const updated = await get<JobRow>(db, tables.IndividualIdJob, transect.jobId);
  return { kind: 'completed', job: updated ?? job };
}
