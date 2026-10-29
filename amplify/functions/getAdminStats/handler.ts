import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { rollUp } from './core';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const statsTable = process.env.ADMIN_STATS_TABLE!;

// The table holds one small row per project-day, so a scan stays cheap.
export const handler = async () => {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(
      new ScanCommand({ TableName: statsTable, ExclusiveStartKey }),
    );
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rollUp(items);
};
