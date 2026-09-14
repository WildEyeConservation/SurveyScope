import {
  S3Client,
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  MAX_TILE_BATCH,
  validTile,
  tileId,
  type TileCoordinate,
} from '../../../shared/imageTiles';
import {
  requireStorageUser,
  authorizeProject,
  isLegacyProject,
  isSysadmin,
  projectPrefix,
  uploadSourceKey,
  type ImageFileRow,
  type ImageRow,
  type ProjectRow,
  type StorageIdentity,
} from './authorization';
import {
  db,
  table,
  getRecord,
  queryFiles,
  resolveImageAccess,
} from './repository';

export const UPLOAD_PART_SIZE = 5 * 1024 * 1024;
export const MAX_UPLOAD_PARTS = 10_000;
export const MAX_SIGNED_PARTS = 128;
export const MAX_PATH_CHECKS = 50;
const PATH_CHECK_CONCURRENCY = 10;
const ROTATIONS = [0, 90, 180, 270];

type Args = Record<string, unknown>;

export interface AppSyncEvent {
  identity: unknown;
  info: { fieldName: string };
  arguments: Args;
}

interface Lifetime {
  expiresIn: number;
  expiresAt: number;
}

function requireString(args: Args, name: string, maxLength = 1024): string {
  const value = args[name];
  if (typeof value !== 'string' || !value || value.length > maxLength) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function optionalString(args: Args, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value ? value : undefined;
}

function isPartNumber(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= MAX_UPLOAD_PARTS
  );
}

function ownershipMetadata(project: ProjectRow, rotation: number) {
  const metadata: Record<string, string> = {
    'organization-id': project.organizationId,
    'project-id': project.id,
  };
  if (rotation) {
    metadata['orientation-correction-ccw'] = String(rotation);
    metadata['orientation-normalized'] = 'false';
  }
  return metadata;
}

function uploadIntent(args: Args) {
  const contentType = requireString(args, 'contentType', 128);
  const rotation = args.rotation ?? 0;
  if (typeof rotation !== 'number' || !ROTATIONS.includes(rotation)) {
    throw new Error('Invalid rotation');
  }
  return { contentType, rotation };
}

export function createImageAccessHandler(s3 = new S3Client({})) {
  const bucket = (name: 'INPUTS' | 'OUTPUTS') => {
    const value = process.env[`${name}_BUCKET_NAME`];
    if (!value) throw new Error(`Missing ${name} bucket`);
    return value;
  };

  const objectKey = (sourceKey: string) => `images/${sourceKey}`;

  async function signingLifetime(): Promise<Lifetime> {
    const credentials = await s3.config.credentials();
    const expiresIn = Math.min(
      3600,
      credentials.expiration
        ? Math.floor((credentials.expiration.getTime() - Date.now()) / 1000) -
            30
        : 3600
    );
    if (expiresIn < 60) {
      throw new Error('Signing session is expiring; retry shortly');
    }
    return { expiresIn, expiresAt: Date.now() + expiresIn * 1000 };
  }

  async function head(
    sourceKey: string
  ): Promise<HeadObjectCommandOutput | null> {
    try {
      return await s3.send(
        new HeadObjectCommand({
          Bucket: bucket('INPUTS'),
          Key: objectKey(sourceKey),
        })
      );
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  // Legacy objects without ownership metadata need an existing file row.
  async function ownsExistingObject(
    project: ProjectRow,
    sourceKey: string,
    object: HeadObjectCommandOutput
  ): Promise<boolean> {
    if (!isLegacyProject(project)) {
      return sourceKey.startsWith(projectPrefix(project));
    }
    if (
      object.Metadata?.['organization-id'] === project.organizationId &&
      object.Metadata?.['project-id'] === project.id
    ) {
      return true;
    }
    const files = await queryFiles('path', sourceKey);
    return files.some(
      (f) =>
        f.key === sourceKey &&
        f.projectId === project.id &&
        f.group === project.organizationId
    );
  }

  async function authorizedProject(
    user: StorageIdentity,
    args: Args
  ): Promise<ProjectRow> {
    const project = await getRecord<ProjectRow>('Project', {
      id: requireString(args, 'projectId'),
    });
    authorizeProject(user, project);
    return project;
  }

  async function uploadTarget(
    user: StorageIdentity,
    project: ProjectRow,
    originalPath: string
  ) {
    const sourceKey = uploadSourceKey(project, originalPath);
    const object = await head(sourceKey);
    const owned =
      !!object &&
      ((await ownsExistingObject(project, sourceKey, object)) ||
        isSysadmin(user));
    if (object && !owned) {
      throw new Error(
        'Unauthorized: existing image has no verified association with this project'
      );
    }
    return { sourceKey, object, owned };
  }

  async function signImageTiles(event: AppSyncEvent) {
    const args = event.arguments;
    const access = await resolveImageAccess(event.identity, {
      imageId: requireString(args, 'imageId'),
      sourceKey: requireString(args, 'sourceKey'),
      sharedImageId: optionalString(args, 'sharedImageId'),
    });
    const tiles: unknown =
      typeof args.tiles === 'string' ? JSON.parse(args.tiles) : args.tiles;
    if (
      !Array.isArray(tiles) ||
      tiles.length < 1 ||
      tiles.length > MAX_TILE_BATCH ||
      tiles.some((t) => !t || !validTile(t as TileCoordinate, access.image))
    ) {
      throw new Error('Invalid tile batch');
    }
    const unique = [
      ...new Map(
        (tiles as TileCoordinate[]).map((t) => [tileId(t), t])
      ).values(),
    ];
    const lifetime = await signingLifetime();
    const urls = await Promise.all(
      unique.map(async (t) => ({
        ...t,
        url: await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: bucket('OUTPUTS'),
            Key: `slippymaps/${access.sourceKey}/${tileId(t)}.png`,
          }),
          lifetime
        ),
      }))
    );
    return { expiresAt: lifetime.expiresAt, tiles: urls };
  }

  async function imageDownloadUrl(event: AppSyncEvent) {
    const args = event.arguments;
    const access = await resolveImageAccess(
      event.identity,
      {
        imageId: requireString(args, 'imageId'),
        sourceKey: requireString(args, 'sourceKey'),
      },
      false
    );
    const lifetime = await signingLifetime();
    return {
      url: await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket('INPUTS'),
          Key: objectKey(access.sourceKey),
        }),
        lifetime
      ),
      expiresAt: lifetime.expiresAt,
    };
  }

  async function uploadedImagePaths(user: StorageIdentity, args: Args) {
    const project = await authorizedProject(user, args);
    const paths = args.paths;
    if (
      !Array.isArray(paths) ||
      paths.length > MAX_PATH_CHECKS ||
      paths.some((p) => typeof p !== 'string')
    ) {
      throw new Error(
        `At most ${MAX_PATH_CHECKS} paths may be checked at once`
      );
    }
    const found: string[] = [];
    for (
      let offset = 0;
      offset < paths.length;
      offset += PATH_CHECK_CONCURRENCY
    ) {
      await Promise.all(
        (paths as string[])
          .slice(offset, offset + PATH_CHECK_CONCURRENCY)
          .map(async (path) => {
            const key = uploadSourceKey(project, path);
            const object = await head(key);
            if (
              object &&
              ((await ownsExistingObject(project, key, object)) ||
                isSysadmin(user))
            ) {
              found.push(path);
            }
          })
      );
    }
    return found;
  }

  async function prepareImageUpload(user: StorageIdentity, args: Args) {
    const project = await authorizedProject(user, args);
    const { sourceKey, object } = await uploadTarget(
      user,
      project,
      requireString(args, 'originalPath')
    );
    // Existing originals are immutable through the browser.
    if (object) return { exists: true, sourceKey };

    const { contentType, rotation } = uploadIntent(args);
    const metadata = ownershipMetadata(project, rotation);
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'If-None-Match': '*',
    };
    for (const [key, value] of Object.entries(metadata)) {
      headers[`x-amz-meta-${key}`] = value;
    }
    const lifetime = await signingLifetime();
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket('INPUTS'),
        Key: objectKey(sourceKey),
        ContentType: contentType,
        IfNoneMatch: '*',
        Metadata: metadata,
      }),
      {
        ...lifetime,
        unhoistableHeaders: new Set(
          Object.keys(headers).map((h) => h.toLowerCase())
        ),
        signableHeaders: new Set(['content-type', 'if-none-match']),
      }
    );
    return {
      url,
      headers,
      sourceKey,
      expiresAt: lifetime.expiresAt,
      exists: false,
    };
  }

  async function createImageMultipartUpload(user: StorageIdentity, args: Args) {
    const project = await authorizedProject(user, args);
    const { sourceKey, object } = await uploadTarget(
      user,
      project,
      requireString(args, 'originalPath')
    );
    if (object) return { exists: true, sourceKey };

    const { contentType, rotation } = uploadIntent(args);
    const created = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket('INPUTS'),
        Key: objectKey(sourceKey),
        ContentType: contentType,
        Metadata: ownershipMetadata(project, rotation),
      })
    );
    if (!created.UploadId) throw new Error('Could not start multipart upload');
    return {
      exists: false,
      sourceKey,
      uploadId: created.UploadId,
      partSize: UPLOAD_PART_SIZE,
    };
  }

  async function signImageUploadParts(user: StorageIdentity, args: Args) {
    const project = await authorizedProject(user, args);
    const sourceKey = uploadSourceKey(
      project,
      requireString(args, 'originalPath')
    );
    const uploadId = requireString(args, 'uploadId');
    const partNumbers = args.partNumbers;
    if (
      !Array.isArray(partNumbers) ||
      partNumbers.length < 1 ||
      partNumbers.length > MAX_SIGNED_PARTS ||
      !partNumbers.every(isPartNumber)
    ) {
      throw new Error(
        `Invalid part numbers; at most ${MAX_SIGNED_PARTS} per request`
      );
    }
    const lifetime = await signingLifetime();
    const parts = await Promise.all(
      [...new Set(partNumbers as number[])].map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          s3,
          new UploadPartCommand({
            Bucket: bucket('INPUTS'),
            Key: objectKey(sourceKey),
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          lifetime
        ),
      }))
    );
    return { expiresAt: lifetime.expiresAt, parts };
  }

  async function completeImageMultipartUpload(
    user: StorageIdentity,
    args: Args
  ) {
    const project = await authorizedProject(user, args);
    const sourceKey = uploadSourceKey(
      project,
      requireString(args, 'originalPath')
    );
    const uploadId = requireString(args, 'uploadId');
    const parts: unknown =
      typeof args.parts === 'string' ? JSON.parse(args.parts) : args.parts;
    if (
      !Array.isArray(parts) ||
      parts.length < 1 ||
      parts.length > MAX_UPLOAD_PARTS ||
      !parts.every(
        (p) =>
          p &&
          isPartNumber((p as { partNumber?: unknown }).partNumber) &&
          typeof (p as { eTag?: unknown }).eTag === 'string' &&
          /^"?[0-9a-f]{32}(-\d+)?"?$/i.test((p as { eTag: string }).eTag)
      )
    ) {
      throw new Error('Invalid multipart completion');
    }
    const ordered = (parts as { partNumber: number; eTag: string }[])
      .slice()
      .sort((a, b) => a.partNumber - b.partNumber);
    // If-None-Match: completion cannot overwrite an existing object.
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket('INPUTS'),
        Key: objectKey(sourceKey),
        UploadId: uploadId,
        IfNoneMatch: '*',
        MultipartUpload: {
          Parts: ordered.map((p) => ({
            PartNumber: p.partNumber,
            ETag: p.eTag,
          })),
        },
      })
    );
    return { sourceKey };
  }

  async function abortImageMultipartUpload(user: StorageIdentity, args: Args) {
    const project = await authorizedProject(user, args);
    const sourceKey = uploadSourceKey(
      project,
      requireString(args, 'originalPath')
    );
    await s3.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket('INPUTS'),
        Key: objectKey(sourceKey),
        UploadId: requireString(args, 'uploadId'),
      })
    );
    return true;
  }

  async function registerImageFile(user: StorageIdentity, args: Args) {
    const project = await authorizedProject(user, args);
    const originalPath = requireString(args, 'originalPath');
    const { sourceKey, object, owned } = await uploadTarget(
      user,
      project,
      originalPath
    );
    if (!object || !owned) {
      throw new Error('Image must be uploaded before registering its file');
    }
    const image = await getRecord<ImageRow>('Image', {
      id: requireString(args, 'imageId'),
    });
    if (
      !image ||
      image.projectId !== project.id ||
      image.group !== project.organizationId ||
      image.originalPath !== originalPath
    ) {
      throw new Error('Unauthorized: image does not belong to this project');
    }
    // Stable id keeps retries idempotent.
    const id = `${image.id}:original`;
    const previous = await getRecord<ImageFileRow>('ImageFile', { id }, true);
    if (previous) {
      if (
        previous.key !== sourceKey ||
        previous.projectId !== project.id ||
        previous.imageId !== image.id
      ) {
        throw new Error('Image file association conflict');
      }
      return { id };
    }
    const timestamp = new Date().toISOString();
    await db.send(
      new PutCommand({
        TableName: table('ImageFile'),
        Item: {
          id,
          projectId: project.id,
          imageId: image.id,
          key: sourceKey,
          path: sourceKey,
          type: object.ContentType || 'application/octet-stream',
          group: project.organizationId,
          createdAt: timestamp,
          updatedAt: timestamp,
          __typename: 'ImageFile',
        },
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );
    return { id };
  }

  const projectOperations: Record<
    string,
    (user: StorageIdentity, args: Args) => Promise<unknown>
  > = {
    uploadedImagePaths,
    prepareImageUpload,
    createImageMultipartUpload,
    signImageUploadParts,
    completeImageMultipartUpload,
    abortImageMultipartUpload,
    registerImageFile,
  };

  return async function handler(event: AppSyncEvent): Promise<unknown> {
    const user = requireStorageUser(event.identity);
    const { fieldName } = event.info;
    if (fieldName === 'signImageTiles') return signImageTiles(event);
    if (fieldName === 'imageDownloadUrl') return imageDownloadUrl(event);
    const operation = projectOperations[fieldName];
    if (!operation) throw new Error('Unsupported storage operation');
    return operation(user, event.arguments);
  };
}

export const handler = createImageAccessHandler();
