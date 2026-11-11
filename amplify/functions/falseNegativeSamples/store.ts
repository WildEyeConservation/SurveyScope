import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { CounterDelta, RowStatus } from './sampling';

export const SUMMARY_SK = 'SUMMARY';
export const TILE_PREFIX = 'TILE#';
export const BY_IMAGE_INDEX = 'byImage';

export const tileSk = (tileId: string) => `${TILE_PREFIX}${tileId}`;
export const imageKeyOf = (annotationSetId: string, imageId: string) =>
  `${annotationSetId}#${imageId}`;

export type SampleRow = {
  annotationSetId: string;
  sk: string;
  tileId: string;
  imageId: string;
  imageKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
  launchNo: number;
  draw: number;
  status: RowStatus;
  found?: number;
  reviewedAt?: string;
  coveredAt?: string;
};

export type SampleLaunch = {
  launchNo: number;
  launchedAt: string;
  launchedBy: string;
  percent: number;
  count: number;
};

export type SampleJob = {
  id: string;
  action: 'launch' | 'continue' | 'reset';
  phase: 'sample' | 'enqueue' | 'reset';
  startedAt: string;
  launchedBy: string;
  percent: number;
  queueTag: string;
  batchSize: number;
  zoom: number | null;
  // Sampling progress, carried across invocations.
  seed: string;
  launchNo: number;
  threshold: number;
  cursor?: Record<string, unknown>;
  resetStage?: number;
  tilesRead: number;
  unreviewed: number;
  // Unreviewed tiles that earlier launches already sampled.
  alreadySampled: number;
  // Enqueue progress.
  queueId?: string;
  queueUrl?: string;
  lastSk?: string;
  enqueued: number;
};

export type SampleSummary = {
  annotationSetId: string;
  sk: typeof SUMMARY_SK;
  projectId: string;
  organizationId: string;
  locationSetId: string;
  state: 'working' | 'ready' | 'failed';
  step?: string;
  error?: string;
  job?: SampleJob;
  // Tiles nobody had reviewed when the sample was last worked out.
  unreviewedTiles: number;
  evaluatedAt?: string;
  sampledCount: number;
  reviewedCount: number;
  coveredCount: number;
  foundCount: number;
  launches: SampleLaunch[];
  updatedAt: string;
};

export type SampleStore = ReturnType<typeof createSampleStore>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function pooled<T>(
  items: readonly T[],
  concurrency: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await run(items[next++]);
    }),
  );
}

export function createSampleStore(db: DynamoDBDocumentClient, table: string) {
  async function getSummary(
    annotationSetId: string,
  ): Promise<SampleSummary | null> {
    const { Item } = await db.send(
      new GetCommand({
        TableName: table,
        Key: { annotationSetId, sk: SUMMARY_SK },
        ConsistentRead: true,
      }),
    );
    return (Item as SampleSummary | undefined) ?? null;
  }

  async function putSummary(
    summary: SampleSummary,
    onlyIfState?: SampleSummary['state'][] | 'absent',
  ): Promise<void> {
    const condition =
      onlyIfState === 'absent'
        ? { ConditionExpression: 'attribute_not_exists(sk)' }
        : onlyIfState
          ? {
              ConditionExpression: `#state IN (${onlyIfState
                .map((_, i) => `:s${i}`)
                .join(', ')})`,
              ExpressionAttributeNames: { '#state': 'state' },
              ExpressionAttributeValues: Object.fromEntries(
                onlyIfState.map((state, i) => [`:s${i}`, state]),
              ),
            }
          : {};
    await db.send(
      new PutCommand({ TableName: table, Item: summary, ...condition }),
    );
  }

  /** Sets top-level summary attributes; undefined removes one. */
  async function updateSummary(
    annotationSetId: string,
    changes: Partial<Omit<SampleSummary, 'annotationSetId' | 'sk'>>,
    add?: CounterDelta & { sampledCount?: number },
  ): Promise<void> {
    const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = {
      ':updatedAt': new Date().toISOString(),
    };
    const sets = ['#updatedAt = :updatedAt'];
    const removes: string[] = [];
    const adds: string[] = [];
    Object.entries(changes).forEach(([key, value], i) => {
      names[`#c${i}`] = key;
      if (value === undefined) {
        removes.push(`#c${i}`);
      } else {
        values[`:c${i}`] = value;
        sets.push(`#c${i} = :c${i}`);
      }
    });
    Object.entries(add ?? {}).forEach(([key, value], i) => {
      if (!value) return;
      names[`#a${i}`] = key;
      values[`:a${i}`] = value;
      adds.push(`#a${i} :a${i}`);
    });
    await db.send(
      new UpdateCommand({
        TableName: table,
        Key: { annotationSetId, sk: SUMMARY_SK },
        UpdateExpression:
          `SET ${sets.join(', ')}` +
          (removes.length ? ` REMOVE ${removes.join(', ')}` : '') +
          (adds.length ? ` ADD ${adds.join(', ')}` : ''),
        ConditionExpression: 'attribute_exists(sk)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  async function* rowPages(
    annotationSetId: string,
    options: { afterSk?: string } = {},
  ): AsyncGenerator<SampleRow[]> {
    let startKey: Record<string, unknown> | undefined = options.afterSk
      ? { annotationSetId, sk: options.afterSk }
      : undefined;
    do {
      const page = await db.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression:
            'annotationSetId = :set AND begins_with(sk, :tile)',
          ExpressionAttributeValues: {
            ':set': annotationSetId,
            ':tile': TILE_PREFIX,
          },
          ExclusiveStartKey: startKey,
        }),
      );
      yield (page.Items ?? []) as SampleRow[];
      startKey = page.LastEvaluatedKey;
    } while (startKey);
  }

  async function allRows(annotationSetId: string): Promise<SampleRow[]> {
    const rows: SampleRow[] = [];
    for await (const page of rowPages(annotationSetId)) rows.push(...page);
    return rows;
  }

  async function rowsForImage(
    annotationSetId: string,
    imageId: string,
  ): Promise<SampleRow[]> {
    const rows: SampleRow[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await db.send(
        new QueryCommand({
          TableName: table,
          IndexName: BY_IMAGE_INDEX,
          KeyConditionExpression: 'imageKey = :key',
          ExpressionAttributeValues: {
            ':key': imageKeyOf(annotationSetId, imageId),
          },
          ExclusiveStartKey: startKey,
        }),
      );
      rows.push(...((page.Items ?? []) as SampleRow[]));
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return rows;
  }

  async function batchWrite(
    requests: Record<string, unknown>[],
    concurrency: number,
  ): Promise<void> {
    await pooled(chunk(requests, 25), concurrency, async (batch) => {
      let pending = batch;
      for (let attempt = 0; pending.length; attempt++) {
        if (attempt > 10) {
          throw new Error('Sample table writes kept being throttled');
        }
        if (attempt) await sleep(Math.min(100 * 2 ** attempt, 5000));
        const { UnprocessedItems } = await db.send(
          new BatchWriteCommand({ RequestItems: { [table]: pending } }),
        );
        pending = (UnprocessedItems?.[table] ?? []) as Record<
          string,
          unknown
        >[];
      }
    });
  }

  const putRows = (rows: readonly SampleRow[], concurrency = 8) =>
    batchWrite(
      rows.map((row) => ({ PutRequest: { Item: row } })),
      concurrency,
    );

  const deleteRows = (
    annotationSetId: string,
    sks: readonly string[],
    concurrency = 8,
  ) =>
    batchWrite(
      sks.map((sk) => ({ DeleteRequest: { Key: { annotationSetId, sk } } })),
      concurrency,
    );

  // Returns false if the tile is no longer in an allowed source status.
  async function transitionRow(
    annotationSetId: string,
    tileId: string,
    change: {
      from: RowStatus[];
      to: RowStatus;
      set?: Record<string, unknown>;
      delta: CounterDelta;
    },
  ): Promise<boolean> {
    const rowNames: Record<string, string> = { '#status': 'status' };
    const rowValues: Record<string, unknown> = { ':to': change.to };
    const rowSets = ['#status = :to'];
    change.from.forEach((status, i) => {
      rowValues[`:f${i}`] = status;
    });
    Object.entries(change.set ?? {}).forEach(([key, value], i) => {
      rowNames[`#r${i}`] = key;
      rowValues[`:r${i}`] = value;
      rowSets.push(`#r${i} = :r${i}`);
    });
    const counterNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const counterValues: Record<string, unknown> = {
      ':updatedAt': new Date().toISOString(),
    };
    const adds: string[] = [];
    Object.entries(change.delta).forEach(([key, value], i) => {
      if (!value) return;
      counterNames[`#d${i}`] = key;
      counterValues[`:d${i}`] = value;
      adds.push(`#d${i} :d${i}`);
    });
    const command = new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: table,
            Key: { annotationSetId, sk: tileSk(tileId) },
            UpdateExpression: `SET ${rowSets.join(', ')}`,
            ConditionExpression: `#status IN (${change.from
              .map((_, i) => `:f${i}`)
              .join(', ')})`,
            ExpressionAttributeNames: rowNames,
            ExpressionAttributeValues: rowValues,
          },
        },
        {
          Update: {
            TableName: table,
            Key: { annotationSetId, sk: SUMMARY_SK },
            UpdateExpression:
              'SET #updatedAt = :updatedAt' +
              (adds.length ? ` ADD ${adds.join(', ')}` : ''),
            ConditionExpression: 'attribute_exists(sk)',
            ExpressionAttributeNames: counterNames,
            ExpressionAttributeValues: counterValues,
          },
        },
      ],
    });
    for (let attempt = 0; ; attempt++) {
      try {
        await db.send(command);
        return true;
      } catch (error) {
        const reasons =
          (error as { CancellationReasons?: { Code?: string }[] })
            .CancellationReasons ?? [];
        if (
          (error as { name?: string }).name !== 'TransactionCanceledException'
        ) {
          throw error;
        }
        if (
          reasons.some((reason) => reason.Code === 'ConditionalCheckFailed')
        ) {
          return false;
        }
        // Another writer touched the summary at the same moment.
        if (attempt >= 8) throw error;
        await sleep(25 * 2 ** attempt + Math.random() * 25);
      }
    }
  }

  async function deleteSample(annotationSetId: string): Promise<number> {
    let deleted = 0;
    for await (const page of rowPages(annotationSetId)) {
      await deleteRows(
        annotationSetId,
        page.map((row) => row.sk),
      );
      deleted += page.length;
    }
    await db.send(
      new DeleteCommand({
        TableName: table,
        Key: { annotationSetId, sk: SUMMARY_SK },
      }),
    );
    return deleted;
  }

  return {
    getSummary,
    putSummary,
    updateSummary,
    rowPages,
    allRows,
    rowsForImage,
    putRows,
    deleteRows,
    transitionRow,
    deleteSample,
  };
}

export function pendingCount(summary: SampleSummary): number {
  return Math.max(
    0,
    summary.sampledCount - summary.reviewedCount - summary.coveredCount,
  );
}
