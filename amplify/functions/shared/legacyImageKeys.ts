import pLimit from 'p-limit';

type ExecuteGraphql = <T>(
  query: string,
  variables: Record<string, unknown>,
) => Promise<T>;

export interface ImageFileRef {
  key?: string | null;
  projectId?: string | null;
  imageId?: string | null;
}

const normalize = (value: string) =>
  value.replace(/\\/g, '/').replace(/^images\//, '');

// Legacy keys carry no project prefix, so an image's originalPath is only used
// as a key when a file registered to that image and project has that key.
export function legacyKeyIsRegistered(
  projectId: string,
  image: { id: string; originalPath?: string | null },
  files: ImageFileRef[],
): boolean {
  if (!image.originalPath) return false;
  const wanted = normalize(image.originalPath);
  return files.some(
    (file) =>
      file.projectId === projectId &&
      file.imageId === image.id &&
      typeof file.key === 'string' &&
      normalize(file.key) === wanted,
  );
}

const filesByImageQuery = /* GraphQL */ `
  query ImageFilesByImageId($imageId: ID!, $nextToken: String) {
    imagesByimageId(imageId: $imageId, limit: 100, nextToken: $nextToken) {
      items {
        key
        projectId
        imageId
      }
      nextToken
    }
  }
`;

export async function registeredLegacyImages<
  T extends { id: string; originalPath?: string | null },
>(
  projectId: string,
  images: T[],
  executeGraphql: ExecuteGraphql,
): Promise<{ kept: T[]; refused: string[] }> {
  const limit = pLimit(20);
  const verdicts = await Promise.all(
    images.map((image) =>
      limit(async () => {
        const files: ImageFileRef[] = [];
        let nextToken: string | null | undefined;
        do {
          const data = await executeGraphql<{
            imagesByimageId?: {
              items?: (ImageFileRef | null)[];
              nextToken?: string | null;
            } | null;
          }>(filesByImageQuery, { imageId: image.id, nextToken });
          for (const item of data.imagesByimageId?.items ?? [])
            if (item) files.push(item);
          nextToken = data.imagesByimageId?.nextToken;
        } while (nextToken);
        return legacyKeyIsRegistered(projectId, image, files);
      }),
    ),
  );
  const kept = images.filter((_, i) => verdicts[i]);
  const refused = images.filter((_, i) => !verdicts[i]).map((i) => i.id);
  if (refused.length) {
    console.warn(
      JSON.stringify({
        msg: 'legacy_image_key_unverified',
        projectId,
        count: refused.length,
        imageIds: refused.slice(0, 20),
      }),
    );
  }
  return { kept, refused };
}
