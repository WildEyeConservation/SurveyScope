/**
 * Resolve the JPEG "source key" for an image from its ImageFile rows — the S3
 * key the chain-viewer tile pyramid (`slippymaps/<sourceKey>/...`) is built
 * from. Shared so the live tile-meta hook and the chain-share snapshot resolve
 * an image's source key identically.
 *
 * NOTE: a self-contained copy of this logic lives in
 * `amplify/functions/createChainShare/handler.ts` (the snapshot Lambda cannot
 * import from `src/`). Keep the two in sync.
 */

export interface ImageFileRow {
  key?: string | null;
  path?: string | null;
  type?: string | null;
}

export function normalizeImagePath(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return value.replace(/\\/g, '/').replace(/^images\//, '');
}

export function isJpegFile(file: ImageFileRow): boolean {
  const type = file.type?.toLowerCase() ?? '';
  const key = normalizeImagePath(file.key);
  const path = normalizeImagePath(file.path);
  return (
    type === 'image/jpeg' ||
    type === 'image/jpg' ||
    !!key?.match(/\.jpe?g$/i) ||
    !!path?.match(/\.jpe?g$/i)
  );
}

export function imageFileMatchesOriginalPath(
  file: ImageFileRow,
  originalPath: string | null | undefined,
): boolean {
  const original = normalizeImagePath(originalPath);
  if (!original) return false;
  const key = normalizeImagePath(file.key);
  const path = normalizeImagePath(file.path);
  return (
    key === original ||
    path === original ||
    !!key?.endsWith(`/${original}`) ||
    !!path?.endsWith(`/${original}`)
  );
}

/**
 * Pick the best JPEG source key for an image: the one whose key/path matches
 * the image's `originalPath`, else the first JPEG, else null.
 */
export function selectSourceKeyForImage(
  files: ImageFileRow[],
  originalPath: string | null | undefined,
): string | null {
  const jpgs = files.filter(isJpegFile);
  const exact = jpgs.find((file) =>
    imageFileMatchesOriginalPath(file, originalPath),
  );
  return exact?.key ?? jpgs[0]?.key ?? null;
}
