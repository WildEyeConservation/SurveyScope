import type { DynamoDBBatchItemFailure, DynamoDBRecord, DynamoDBStreamHandler } from "aws-lambda";
import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

// Safety net for Locations inserted without a group. Every known writer now sets
// group at creation, and the event source mapping filter only invokes this for
// INSERTs whose NewImage lacks one, so in steady state it should not run at all.

const logger = new Logger({
  logLevel: "INFO",
  serviceName: "backfill-location-group",
});

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const LOCATION_TABLE = process.env.LOCATION_TABLE_NAME!;
const PROJECT_TABLE = process.env.PROJECT_TABLE_NAME!;

// Bounds in-flight UpdateItems so a full batch cannot burst the table.
const UPDATE_CONCURRENCY = 10;

// Warm-container cache: projectId → organizationId lookup. Caching the promise
// lets concurrent workers share one GetItem; misses and failures are evicted so
// they are looked up again rather than remembered.
const organizationIdCache = new Map<string, Promise<string | undefined>>();

function getOrganizationId(projectId: string): Promise<string | undefined> {
  const cached = organizationIdCache.get(projectId);
  if (cached) return cached;

  const lookup = ddbClient
    .send(
      new GetCommand({
        TableName: PROJECT_TABLE,
        Key: { id: projectId },
        ProjectionExpression: "organizationId",
      })
    )
    .then((result) => result.Item?.organizationId as string | undefined);
  organizationIdCache.set(projectId, lookup);
  lookup.then(
    (organizationId) => {
      if (!organizationId) organizationIdCache.delete(projectId);
    },
    () => organizationIdCache.delete(projectId)
  );
  return lookup;
}

async function setGroup(locationId: string, organizationId: string): Promise<void> {
  try {
    await ddbClient.send(
      new UpdateCommand({
        TableName: LOCATION_TABLE,
        Key: { id: locationId },
        UpdateExpression: "SET #g = :g",
        // attribute_exists(id) stops UpdateItem from creating a stub item when the
        // location was deleted before this event was processed.
        ConditionExpression:
          "attribute_exists(id) AND (attribute_not_exists(#g) OR #g = :empty OR attribute_type(#g, :null))",
        ExpressionAttributeNames: { "#g": "group" },
        ExpressionAttributeValues: { ":g": organizationId, ":empty": "", ":null": "NULL" },
      })
    );
  } catch (error: any) {
    // Location deleted, or group already set by someone else: nothing to do.
    if (error?.name === "ConditionalCheckFailedException") {
      logger.info(`Location ${locationId} no longer exists or already has a group, skipping`);
      return;
    }
    throw error;
  }
}

function needsBackfill(record: DynamoDBRecord): boolean {
  if (record.eventName !== "INSERT") return false;
  const group = record.dynamodb?.NewImage?.group;
  return !group?.S;
}

export const handler: DynamoDBStreamHandler = async (event) => {
  const records = event.Records.filter(needsBackfill);
  logger.info(`Processing ${records.length} of ${event.Records.length} records`);

  const batchItemFailures: DynamoDBBatchItemFailure[] = [];

  let next = 0;
  const worker = async () => {
    while (next < records.length) {
      const record = records[next++];
      const newImage = record.dynamodb?.NewImage;
      const locationId = newImage?.id?.S;
      const projectId = newImage?.projectId?.S;
      if (!locationId || !projectId) {
        logger.warn("INSERT missing id or projectId", { locationId, projectId });
        continue;
      }

      try {
        const organizationId = await getOrganizationId(projectId);
        if (!organizationId) {
          // Retrying cannot help: the project is gone or has no organization.
          logger.warn("No organizationId found for project, skipping location", {
            projectId,
            locationId,
          });
          continue;
        }
        await setGroup(locationId, organizationId);
      } catch (error) {
        logger.error(`Failed to backfill group for location ${locationId}`, {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        });
        const sequenceNumber = record.dynamodb?.SequenceNumber;
        if (!sequenceNumber) throw error;
        batchItemFailures.push({ itemIdentifier: sequenceNumber });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(UPDATE_CONCURRENCY, records.length) }, worker)
  );

  if (batchItemFailures.length > 0) {
    logger.warn(`Reporting ${batchItemFailures.length} failed records for retry`);
  }
  return { batchItemFailures };
};
