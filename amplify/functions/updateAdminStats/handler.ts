import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type QueryCommandInput,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import pLimit from 'p-limit';
import {
  LAST_RUN_KEY,
  META_KEY,
  USERS_KEY,
  DAY_PREFIX,
  dayOf,
  monthOf,
  projectKey,
} from '../../../shared/adminStats';
import {
  addDays,
  changedFields,
  desiredRows,
  imagesToday,
  monthsBetween,
  daysBetween,
  tallyByDay,
  type Counts,
} from './core';

type Tables = {
  Project: string;
  ImageSet: string;
  Image: string;
  Annotation: string;
  ClientLog: string;
};

const tables = JSON.parse(process.env.ADMIN_STATS_SOURCE_TABLES!) as Tables;
const statsTable = process.env.ADMIN_STATS_TABLE!;
const userPoolId = process.env.USER_POOL_ID!;

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const limit = pLimit(8);

type Item = Record<string, unknown>;

async function queryAll(input: QueryCommandInput): Promise<Item[]> {
  const items: Item[] = [];
  let ExclusiveStartKey: Item | undefined;
  do {
    const page = await db.send(
      new QueryCommand({ ...input, ExclusiveStartKey }),
    );
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function scanAll(
  input: ScanCommandInput,
  onPage: (items: Item[]) => void,
  segments = 1,
): Promise<void> {
  await Promise.all(
    Array.from({ length: segments }, async (_, segment) => {
      let ExclusiveStartKey: Item | undefined;
      do {
        const page = await db.send(
          new ScanCommand({
            ...input,
            ...(segments > 1
              ? { Segment: segment, TotalSegments: segments }
              : {}),
            ExclusiveStartKey,
          }),
        );
        onPage(page.Items ?? []);
        ExclusiveStartKey = page.LastEvaluatedKey;
      } while (ExclusiveStartKey);
    }),
  );
}

async function storedRows(
  pk: string,
  prefix: string,
): Promise<Map<string, Counts>> {
  const items = await queryAll({
    TableName: statsTable,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': pk },
  });
  const rows = new Map<string, Counts>();
  for (const { sk, ...counts } of items) {
    delete counts.pk;
    rows.set((sk as string).slice(prefix.length), counts as Counts);
  }
  return rows;
}

async function writeChanges(
  pk: string,
  prefix: string,
  stored: Map<string, Counts>,
  desired: Map<string, Counts>,
): Promise<void> {
  for (const [key, counts] of desired) {
    const changed = Object.entries(changedFields(stored.get(key), counts));
    if (changed.length === 0) continue;
    await db.send(
      new UpdateCommand({
        TableName: statsTable,
        Key: { pk, sk: `${prefix}${key}` },
        UpdateExpression: `SET ${changed.map((_, i) => `#f${i} = :v${i}`).join(', ')}`,
        ExpressionAttributeNames: Object.fromEntries(
          changed.map(([field], i) => [`#f${i}`, field]),
        ),
        ExpressionAttributeValues: Object.fromEntries(
          changed.map(([, value], i) => [`:v${i}`, value]),
        ),
      }),
    );
  }
}

function merge(...maps: Map<string, Counts>[]): Map<string, Counts> {
  const merged = new Map<string, Counts>();
  for (const map of maps) {
    for (const [key, counts] of map) {
      merged.set(key, { ...merged.get(key), ...counts });
    }
  }
  return merged;
}

async function countAnnotations(
  projectId: string,
  days: string[] | null,
): Promise<Map<string, Counts>> {
  const counts = new Map<string, Counts>();
  for (const day of days ?? [null]) {
    const items = await queryAll({
      TableName: tables.Annotation,
      IndexName: 'annotationsByProjectIdAndCreatedAt',
      KeyConditionExpression: day
        ? 'projectId = :p AND begins_with(createdAt, :day)'
        : 'projectId = :p',
      ExpressionAttributeValues: day
        ? { ':p': projectId, ':day': day }
        : { ':p': projectId },
      ProjectionExpression: 'createdAt',
    });
    tallyByDay(
      items.map((item) => item.createdAt as string | undefined),
      'annotations',
      counts,
    );
  }
  return counts;
}

async function imageCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await scanAll(
    {
      TableName: tables.ImageSet,
      ProjectionExpression: 'projectId, imageCount',
    },
    (items) => {
      for (const item of items as {
        projectId: string;
        imageCount?: number;
      }[]) {
        counts.set(
          item.projectId,
          (counts.get(item.projectId) ?? 0) + (item.imageCount ?? 0),
        );
      }
    },
  );
  return counts;
}

async function imageHistory(): Promise<Map<string, Map<string, Counts>>> {
  const history = new Map<string, Map<string, Counts>>();
  await scanAll(
    {
      TableName: tables.Image,
      ProjectionExpression: 'projectId, createdAt',
    },
    (items) => {
      for (const { projectId, createdAt } of items as {
        projectId: string;
        createdAt?: string;
      }[]) {
        const days = history.get(projectId) ?? new Map<string, Counts>();
        tallyByDay([createdAt], 'images', days);
        history.set(projectId, days);
      }
    },
    16,
  );
  return history;
}

async function updateProject(
  projectId: string,
  today: string,
  window: string[],
  imageCount: number,
  history: Map<string, Counts> | undefined,
  backfill: boolean,
): Promise<void> {
  const pk = projectKey(projectId);
  const stored = await storedRows(pk, DAY_PREFIX);
  const images = backfill
    ? desiredRows(stored, history ?? new Map(), ['images'], () => true)
    : new Map([[today, { images: imagesToday(imageCount, stored, today) }]]);
  const annotations = desiredRows(
    stored,
    await countAnnotations(projectId, backfill ? null : window),
    ['annotations'],
    (day) => backfill || window.includes(day),
  );
  await writeChanges(pk, DAY_PREFIX, stored, merge(images, annotations));
}

async function listUsers(): Promise<{ sub: string; createdAt: string }[]> {
  const users: { sub: string; createdAt: string }[] = [];
  let PaginationToken: string | undefined;
  do {
    const page = await cognito.send(
      new ListUsersCommand({ UserPoolId: userPoolId, PaginationToken }),
    );
    for (const user of page.Users ?? []) {
      const sub = user.Attributes?.find((a) => a.Name === 'sub')?.Value;
      if (sub && user.UserCreateDate) {
        users.push({ sub, createdAt: user.UserCreateDate.toISOString() });
      }
    }
    PaginationToken = page.PaginationToken;
  } while (PaginationToken);
  return users;
}

async function loggedInDuring(userId: string, month: string): Promise<boolean> {
  const page = await db.send(
    new QueryCommand({
      TableName: tables.ClientLog,
      IndexName: 'clientLogsByUserIdAndCreatedAt',
      KeyConditionExpression: 'userId = :u AND begins_with(createdAt, :m)',
      ExpressionAttributeValues: { ':u': userId, ':m': month },
      ProjectionExpression: 'id',
      Limit: 1,
    }),
  );
  return (page.Items?.length ?? 0) > 0;
}

async function updateUsers(window: string[], backfill: boolean): Promise<void> {
  const users = await listUsers();
  const thisMonth = monthOf(window[window.length - 1]);
  const recount = new Map<string, Counts>();
  const bump = (month: string, field: string) => {
    const counts = recount.get(month) ?? {};
    counts[field] = (counts[field] ?? 0) + 1;
    recount.set(month, counts);
  };
  for (const user of users) bump(monthOf(user.createdAt), 'newUsers');

  const windowMonths = [...new Set(window.map(monthOf))];
  const checks = users.flatMap((user) =>
    (backfill
      ? monthsBetween(monthOf(user.createdAt), thisMonth)
      : windowMonths
    ).map((month) =>
      limit(async () => {
        if (await loggedInDuring(user.sub, month)) bump(month, 'activeUsers');
      }),
    ),
  );
  await Promise.all(checks);

  const stored = await storedRows(USERS_KEY, '');
  const desired = merge(
    desiredRows(stored, recount, ['newUsers'], () => true),
    desiredRows(
      stored,
      recount,
      ['activeUsers'],
      (month) => backfill || windowMonths.includes(month),
    ),
  );
  await writeChanges(USERS_KEY, '', stored, desired);
}

async function lastRunDay(): Promise<string | undefined> {
  const { Item } = await db.send(
    new GetCommand({
      TableName: statsTable,
      Key: { pk: META_KEY, sk: LAST_RUN_KEY },
    }),
  );
  return Item?.updatedAt ? dayOf(Item.updatedAt as string) : undefined;
}

// Invoke with { "backfill": true } to rebuild history.
export const handler = async (event: { backfill?: boolean } = {}) => {
  const backfill = event?.backfill === true;
  const now = new Date().toISOString();
  const today = dayOf(now);
  const yesterday = addDays(today, -1);
  // Starting from the last run's day catches up after missed runs.
  const lastRun = await lastRunDay();
  const window = daysBetween(
    lastRun && lastRun < yesterday ? lastRun : yesterday,
    today,
  );

  const projects: string[] = [];
  await scanAll(
    { TableName: tables.Project, ProjectionExpression: 'id' },
    (items) => projects.push(...items.map((item) => item.id as string)),
  );
  const [counts, history] = await Promise.all([
    imageCounts(),
    backfill ? imageHistory() : Promise.resolve(undefined),
  ]);

  await Promise.all([
    ...projects.map((projectId) =>
      limit(() =>
        updateProject(
          projectId,
          today,
          window,
          counts.get(projectId) ?? 0,
          history?.get(projectId),
          backfill,
        ),
      ),
    ),
    updateUsers(window, backfill),
  ]);

  await db.send(
    new PutCommand({
      TableName: statsTable,
      Item: { pk: META_KEY, sk: LAST_RUN_KEY, updatedAt: now },
    }),
  );
  return { projects: projects.length, backfill };
};
