import { generateClient } from 'aws-amplify/api';
import { runWithClientLimit } from '../limitedClient';

const client = generateClient({ authMode: 'userPool' });

export async function storageOperation<T>(
  query: string,
  variables: Record<string, unknown>,
  field: string
): Promise<T> {
  const result = (await runWithClientLimit(
    async () => await client.graphql({ query, variables })
  )) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join('; '));
  }
  const value = result.data?.[field];
  if (value == null) throw new Error(`No result from ${field}`);
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

export const SIGN_TILES = `query SignImageTiles($imageId: ID!, $sourceKey: String!, $sharedImageId: ID, $tiles: AWSJSON!) {
  signImageTiles(imageId: $imageId, sourceKey: $sourceKey, sharedImageId: $sharedImageId, tiles: $tiles)
}`;

export const GENERATE_TILE = `query GenerateTile($imageKey: String!, $imageId: ID!, $sharedImageId: ID, $zs: [Int!]!, $rows: [Int!]!, $cols: [Int!]!) {
  generateTile(imageKey: $imageKey, imageId: $imageId, sharedImageId: $sharedImageId, zs: $zs, rows: $rows, cols: $cols)
}`;

export const UPLOADED_IMAGE_PATHS = `query UploadedImagePaths($projectId: ID!, $paths: [String!]!) {
  uploadedImagePaths(projectId: $projectId, paths: $paths)
}`;

export const PREPARE_IMAGE_UPLOAD = `mutation PrepareImageUpload($projectId: ID!, $originalPath: String!, $contentType: String!, $rotation: Int) {
  prepareImageUpload(projectId: $projectId, originalPath: $originalPath, contentType: $contentType, rotation: $rotation)
}`;

export const CREATE_IMAGE_MULTIPART_UPLOAD = `mutation CreateImageMultipartUpload($projectId: ID!, $originalPath: String!, $contentType: String!, $rotation: Int) {
  createImageMultipartUpload(projectId: $projectId, originalPath: $originalPath, contentType: $contentType, rotation: $rotation)
}`;

export const SIGN_IMAGE_UPLOAD_PARTS = `query SignImageUploadParts($projectId: ID!, $originalPath: String!, $uploadId: String!, $partNumbers: [Int!]!) {
  signImageUploadParts(projectId: $projectId, originalPath: $originalPath, uploadId: $uploadId, partNumbers: $partNumbers)
}`;

export const COMPLETE_IMAGE_MULTIPART_UPLOAD = `mutation CompleteImageMultipartUpload($projectId: ID!, $originalPath: String!, $uploadId: String!, $parts: AWSJSON!) {
  completeImageMultipartUpload(projectId: $projectId, originalPath: $originalPath, uploadId: $uploadId, parts: $parts)
}`;

export const ABORT_IMAGE_MULTIPART_UPLOAD = `mutation AbortImageMultipartUpload($projectId: ID!, $originalPath: String!, $uploadId: String!) {
  abortImageMultipartUpload(projectId: $projectId, originalPath: $originalPath, uploadId: $uploadId)
}`;

export async function imageDownloadUrl(imageId: string, sourceKey: string) {
  return storageOperation<{ url: string; expiresAt: number }>(
    `query ImageDownloadUrl($imageId: ID!, $sourceKey: String!) {
    imageDownloadUrl(imageId: $imageId, sourceKey: $sourceKey)
  }`,
    { imageId, sourceKey },
    'imageDownloadUrl'
  );
}

export async function registerImageFile(
  projectId: string,
  imageId: string,
  originalPath: string
) {
  return storageOperation<{ id: string }>(
    `mutation RegisterImageFile($projectId: ID!, $imageId: ID!, $originalPath: String!) {
    registerImageFile(projectId: $projectId, imageId: $imageId, originalPath: $originalPath)
  }`,
    { projectId, imageId, originalPath },
    'registerImageFile'
  );
}
