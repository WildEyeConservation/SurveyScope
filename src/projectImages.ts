import type { FieldOf, RowOf } from '../shared/rowSources';
import { loadRows, type LoadRowsOptions } from './rowChunks';

export type ImageField = FieldOf<'imagesByProjectId'>;
export type ImageRow<F extends ImageField> = RowOf<'imagesByProjectId', F>;
export type LoadImagesOptions = LoadRowsOptions;

export function loadProjectImages<F extends ImageField>(
  client: unknown,
  projectId: string,
  fields: readonly F[],
  options: LoadImagesOptions = {}
): Promise<ImageRow<F>[]> {
  return loadRows(client, 'imagesByProjectId', projectId, fields, options);
}
