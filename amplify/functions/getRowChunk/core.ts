import { gzipSync } from 'node:zlib';
import { encodeRows } from '../../../shared/rowChunk';
import { chunkFields, type RowSource } from '../../../shared/rowSources';

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

type Row = Record<string, unknown>;

const pick = (row: Row, attributes: readonly string[]) =>
  Object.fromEntries(attributes.map((name) => [name, row[name]]));

// The cursor never carries the partition key, so it cannot leave the scope.
export function decodeCursor(
  source: RowSource,
  scopeId: string,
  cursor: string | null | undefined
): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  const valid =
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Object.keys(parsed).length === source.key.length &&
    source.key.every((name) =>
      ['string', 'number'].includes(typeof parsed[name])
    );
  if (!valid) throw new Error('Invalid cursor');
  return { ...pick(parsed, source.key), [source.partitionKey]: scopeId };
}

const encodeCursor = (source: RowSource, row: Row) =>
  Buffer.from(JSON.stringify(pick(row, source.key))).toString('base64url');

export async function readChunk(
  queryPage: QueryPage,
  source: RowSource,
  startKey: Record<string, unknown> | undefined,
  requested: readonly string[],
  { maxPayloadBytes, rowTarget, readDeadlineMs, now = Date.now }: ChunkOptions
) {
  const fields = chunkFields(source, requested);
  const pack = (rows: Row[]) =>
    gzipSync(
      JSON.stringify(encodeRows(rows, source.fields, fields, source.sortBy))
    ).toString('base64');
  const rows: Row[] = [];
  const started = now();
  do {
    const page = await queryPage(startKey, rowTarget - rows.length);
    rows.push(...(page.Items ?? []));
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
    if (count === 0) throw new Error('A single row exceeds the chunk budget');
    data = pack(rows.slice(0, count));
  }

  const next = count < rows.length ? rows[count - 1] : startKey;
  return { data, count, cursor: next ? encodeCursor(source, next) : null };
}
