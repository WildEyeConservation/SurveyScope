// GraphQL documents for the storage operations. Kept free of side effects so
// modules can be imported without configuring the Amplify client.

export type StorageOperation = <T>(
  query: string,
  variables: Record<string, unknown>,
  field: string
) => Promise<T>;

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
