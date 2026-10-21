// SSTILE01: little-endian JSON metadata and uint32 offset/length entries in zoom/row/column order.

const MAGIC = 'SSTILE01';
const PREFIX_LENGTH = 12;
const ENTRY_LENGTH = 8;

// The header is ASCII only, so it is encoded by hand to stay platform neutral.
const toAscii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const fromAscii = (bytes: Uint8Array) =>
  Array.from(bytes, (c) => String.fromCharCode(c)).join('');

export interface TilePackMeta {
  width: number;
  height: number;
  tileSize: number;
  maxZoom: number;
  format: string;
}
export interface TilePackLevel {
  zoom: number;
  columns: number;
  rows: number;
  start: number;
}
export interface TilePackEntry {
  offset: number;
  length: number;
}

export const HEADER_GUESS_BYTES = 64 * 1024;

export const tilePackKey = (sourceKey: string) =>
  `slippymaps/${sourceKey}/tiles.sstile`;

export const maxZoomFor = (width: number, height: number, tileSize: number) =>
  Math.max(0, Math.ceil(Math.log2(Math.max(width, height) / tileSize)));

export function pyramid(
  meta: Pick<TilePackMeta, 'width' | 'height' | 'tileSize' | 'maxZoom'>
): { levels: TilePackLevel[]; tileCount: number } {
  const levels: TilePackLevel[] = [];
  let start = 0;
  for (let zoom = 0; zoom <= meta.maxZoom; zoom++) {
    const coverage = meta.tileSize * 2 ** (meta.maxZoom - zoom);
    const columns = Math.ceil(meta.width / coverage);
    const rows = Math.ceil(meta.height / coverage);
    levels.push({ zoom, columns, rows, start });
    start += columns * rows;
  }
  return { levels, tileCount: start };
}

export function tileIndex(
  levels: TilePackLevel[],
  zoom: number,
  row: number,
  column: number
): number | undefined {
  const level = levels[zoom];
  if (!level || !Number.isInteger(row) || !Number.isInteger(column))
    return undefined;
  if (row < 0 || column < 0 || row >= level.rows || column >= level.columns)
    return undefined;
  return level.start + row * level.columns + column;
}

export function encodeHeader(
  meta: TilePackMeta,
  tileLengths: number[]
): Uint8Array {
  const { tileCount } = pyramid(meta);
  if (tileLengths.length !== tileCount) {
    throw new Error(`Expected ${tileCount} tiles, got ${tileLengths.length}`);
  }
  const metaBytes = toAscii(JSON.stringify(meta));
  const headerLength =
    PREFIX_LENGTH + metaBytes.length + tileCount * ENTRY_LENGTH;
  const header = new Uint8Array(headerLength);
  header.set(toAscii(MAGIC), 0);
  const view = new DataView(header.buffer);
  view.setUint32(8, metaBytes.length, true);
  header.set(metaBytes, PREFIX_LENGTH);
  let offset = headerLength;
  let position = PREFIX_LENGTH + metaBytes.length;
  for (const length of tileLengths) {
    view.setUint32(position, offset, true);
    view.setUint32(position + 4, length, true);
    offset += length;
    position += ENTRY_LENGTH;
  }
  if (offset > 0xffffffff) throw new Error('Tile pack exceeds 4 GiB');
  return header;
}

export type DecodedHeader =
  | {
      complete: true;
      meta: TilePackMeta;
      levels: TilePackLevel[];
      entries: TilePackEntry[];
    }
  | { complete: false; needed: number };

export function decodeHeader(bytes: Uint8Array): DecodedHeader {
  if (bytes.length < PREFIX_LENGTH)
    return { complete: false, needed: HEADER_GUESS_BYTES };
  if (fromAscii(bytes.subarray(0, 8)) !== MAGIC)
    throw new Error('Not a tile pack');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tableStart = PREFIX_LENGTH + view.getUint32(8, true);
  if (bytes.length < tableStart)
    return { complete: false, needed: tableStart + HEADER_GUESS_BYTES };
  const meta = JSON.parse(
    fromAscii(bytes.subarray(PREFIX_LENGTH, tableStart))
  ) as TilePackMeta;
  const { levels, tileCount } = pyramid(meta);
  const headerLength = tableStart + tileCount * ENTRY_LENGTH;
  if (bytes.length < headerLength)
    return { complete: false, needed: headerLength };
  const entries: TilePackEntry[] = [];
  for (let index = 0; index < tileCount; index++) {
    const position = tableStart + index * ENTRY_LENGTH;
    entries.push({
      offset: view.getUint32(position, true),
      length: view.getUint32(position + 4, true),
    });
  }
  return { complete: true, meta, levels, entries };
}
