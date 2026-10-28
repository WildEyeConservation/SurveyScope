import type { RowOf } from '../shared/rowSources';
import { loadRows, type LoadRowsOptions } from './rowChunks';

export type NeighbourRow = RowOf<
  'imageNeighboursByProjectId',
  'homography' | 'homographySource' | 'skipped'
>;

export async function loadProjectNeighbours(
  client: unknown,
  projectId: string,
  imageIds: ReadonlySet<string>,
  options: LoadRowsOptions = {},
): Promise<NeighbourRow[]> {
  const rows = await loadRows(
    client,
    'imageNeighboursByProjectId',
    projectId,
    ['homography', 'homographySource', 'skipped'],
    options,
  );
  const key = (row: NeighbourRow) => `${row.image1Id}\u0000${row.image2Id}`;
  // A fixed order keeps equal-length path choices stable across loads.
  return rows
    .filter((row) => imageIds.has(row.image1Id) && imageIds.has(row.image2Id))
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
