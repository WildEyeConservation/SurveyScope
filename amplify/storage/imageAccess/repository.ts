import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  authorizeProject,
  assertFileOwnership,
  isSysadmin,
  requireStorageUser,
  safeSourceKey,
  type ImageFileRow,
  type ImageRow,
  type ProjectRow,
  type ShareRow,
  type SharedImageRow,
  type StorageIdentity,
} from './authorization';

export const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

type TableName =
  | 'Image'
  | 'ImageFile'
  | 'Project'
  | 'SharedChainImage'
  | 'ChainShare';

export function table(name: TableName): string {
  const value = process.env[`STORAGE_${name.toUpperCase()}_TABLE`];
  if (!value) throw new Error(`Missing table configuration: ${name}`);
  return value;
}

export async function getRecord<T>(
  name: TableName,
  key: Record<string, string>,
  consistent = false
): Promise<T | undefined> {
  const result = await db.send(
    new GetCommand({
      TableName: table(name),
      Key: key,
      ConsistentRead: consistent,
    })
  );
  return result.Item as T | undefined;
}

export async function queryFiles(
  field: 'imageId' | 'path',
  value: string
): Promise<ImageFileRow[]> {
  const items: ImageFileRow[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await db.send(
      new QueryCommand({
        TableName: table('ImageFile'),
        IndexName:
          field === 'imageId' ? 'imageFilesByImageId' : 'imageFilesByPath',
        KeyConditionExpression: '#key = :value',
        ExpressionAttributeNames: { '#key': field },
        ExpressionAttributeValues: { ':value': value },
        ExclusiveStartKey: cursor,
        Limit: 100,
      })
    );
    items.push(...((page.Items ?? []) as ImageFileRow[]));
    cursor = page.LastEvaluatedKey;
    if (items.length > 1000) {
      throw new Error('Too many file associations for one image');
    }
  } while (cursor);
  return items;
}

export interface ImageAccessArgs {
  imageId: string;
  sourceKey: string;
  sharedImageId?: string | null;
}

export interface ImageAccess {
  image: { id: string; width: number; height: number };
  sourceKey: string;
  shared: boolean;
}

// Short-lived decision cache; the caller's groups are part of the key.
const ACCESS_CACHE_TTL_MS = 30_000;
const ACCESS_CACHE_LIMIT = 1000;
const accessCache = new Map<string, { value: ImageAccess; expires: number }>();

function accessCacheKey(
  user: StorageIdentity,
  args: ImageAccessArgs,
  allowShare: boolean
): string {
  return JSON.stringify([
    user.sub,
    [...user.groups].sort(),
    args.imageId,
    args.sourceKey,
    allowShare ? args.sharedImageId ?? '' : '',
  ]);
}

export function clearAccessCache(): void {
  accessCache.clear();
}

async function resolveSharedAccess(
  user: StorageIdentity,
  args: ImageAccessArgs,
  sharedImageId: string
): Promise<ImageAccess> {
  const snapshot = await getRecord<SharedImageRow>('SharedChainImage', {
    id: sharedImageId,
  });
  if (
    !snapshot ||
    snapshot.sourceImageId !== args.imageId ||
    snapshot.sourceKey !== args.sourceKey ||
    snapshot.group !== `chainshare-${snapshot.shareId}`
  ) {
    throw new Error('Unauthorized: invalid shared image');
  }
  const share = await getRecord<ShareRow>('ChainShare', {
    shareId: snapshot.shareId,
  });
  if (
    !share ||
    share.status !== 'active' ||
    (!isSysadmin(user) && !user.groups.includes(snapshot.group))
  ) {
    throw new Error('Unauthorized: image share is unavailable');
  }
  return {
    image: { id: args.imageId, width: snapshot.width, height: snapshot.height },
    sourceKey: safeSourceKey(snapshot.sourceKey),
    shared: true,
  };
}

async function resolveOwnedAccess(
  user: StorageIdentity,
  args: ImageAccessArgs
): Promise<ImageAccess> {
  const image = await getRecord<ImageRow>('Image', { id: args.imageId });
  if (!image) throw new Error('Unauthorized: image unavailable');
  const project = await getRecord<ProjectRow>('Project', {
    id: image.projectId,
  });
  authorizeProject(user, project);
  const files = await queryFiles('imageId', image.id);
  const file = files.find((f) => f.key === args.sourceKey);
  if (!file) throw new Error('Unauthorized: image file unavailable');
  assertFileOwnership(file, image, project, args.sourceKey);
  return {
    image: { id: image.id, width: image.width, height: image.height },
    sourceKey: file.key,
    shared: false,
  };
}

export async function resolveImageAccess(
  identity: unknown,
  args: ImageAccessArgs,
  allowShare = true,
  now = Date.now
): Promise<ImageAccess> {
  const user = requireStorageUser(identity);
  safeSourceKey(args.sourceKey);
  const key = accessCacheKey(user, args, allowShare);
  const cached = accessCache.get(key);
  if (cached && cached.expires > now()) return cached.value;

  const value =
    allowShare && args.sharedImageId
      ? await resolveSharedAccess(user, args, args.sharedImageId)
      : await resolveOwnedAccess(user, args);

  accessCache.set(key, { value, expires: now() + ACCESS_CACHE_TTL_MS });
  while (accessCache.size > ACCESS_CACHE_LIMIT) {
    accessCache.delete(accessCache.keys().next().value!);
  }
  return value;
}
