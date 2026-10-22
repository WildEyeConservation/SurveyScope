import { gzipSync } from 'node:zlib';
import {
  encodeManifest,
  type ManifestField,
} from '../../../shared/imageManifest';

export type QueryPage = (
  startKey: Record<string, unknown> | undefined,
  limit: number
) => Promise<{
  Items?: Record<string, unknown>[];
  LastEvaluatedKey?: Record<string, unknown>;
}>;

export interface ChunkOptions {
  maxPayloadBytes: number;
  rowTarget: number;
  readDeadlineMs: number;
  now?: () => number;
}

type Row = Record<string, unknown> & { id: string };

// The cursor only carries an image id, so it cannot reach another project.
export async function readChunk(
  queryPage: QueryPage,
  projectId: string,
  cursor: string | null | undefined,
  fields: readonly ManifestField[],
  { maxPayloadBytes, rowTarget, readDeadlineMs, now = Date.now }: ChunkOptions
) {
  let startKey: Record<string, unknown> | undefined = cursor
    ? {
        projectId,
        id: JSON.parse(Buffer.from(cursor, 'base64url').toString()).id,
      }
    : undefined;
  const pack = (rows: Row[]) =>
    gzipSync(JSON.stringify(encodeManifest(rows, fields))).toString('base64');
  const rows: Row[] = [];
  const started = now();
  do {
    const page = await queryPage(startKey, rowTarget - rows.length);
    rows.push(...((page.Items ?? []) as Row[]));
    startKey = page.LastEvaluatedKey;
  } while (
    startKey &&
    rows.length < rowTarget &&
    now() - started < readDeadlineMs
  );

  let count = rows.length;
  let data = pack(rows);
  while (data.length > maxPayloadBytes) {
    count = Math.floor((count * maxPayloadBytes * 0.9) / data.length);
    if (count === 0) throw new Error('A single image exceeds the chunk budget');
    data = pack(rows.slice(0, count));
  }

  const nextId = count < rows.length ? rows[count - 1].id : startKey?.id;
  return {
    data,
    count,
    cursor: nextId
      ? Buffer.from(JSON.stringify({ id: nextId })).toString('base64url')
      : null,
  };
}
