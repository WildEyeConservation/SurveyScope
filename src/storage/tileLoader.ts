import type { TileUrl } from './tileUrlBatcher';
/** Keep authorization failures separate from missing-tile generation. */
export async function loadAuthorizedTile(ops: {
  sign: () => Promise<TileUrl>;
  evict: () => void;
  readCache: () => Promise<Blob | null>;
  writeCache: (blob: Blob) => Promise<unknown>;
  fetch: (url: string) => Promise<Response>;
  generate: () => Promise<Blob>;
  assertCurrentSession: () => void;
}): Promise<Blob> {
  let signed = await ops.sign();
  const cached = await ops.readCache();
  ops.assertCurrentSession();
  if (cached) return cached;
  let response = await ops.fetch(signed.url);
  if (response.status === 403) {
    ops.evict();
    signed = await ops.sign();
    response = await ops.fetch(signed.url);
  }
  let blob: Blob;
  if (response.status === 404) blob = await ops.generate();
  else if (response.ok) blob = await response.blob();
  else throw new Error(`Tile download failed: ${response.status}`);
  ops.assertCurrentSession();
  await ops.writeCache(blob);
  ops.assertCurrentSession();
  return blob;
}
