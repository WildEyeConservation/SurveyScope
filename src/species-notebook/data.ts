import type { DataClient } from '../../amplify/shared/data-schema.generated';
import { fetchAllPaginatedResults } from '../utils';
import type { NotebookCrop, NotebookExamples, SurveyCategory } from './types';

const STALE = 5 * 60 * 1000;
// Example tokens last half an hour on the server.
const TOKEN_STALE = 20 * 60 * 1000;

type JsonResult = { data?: unknown; errors?: { message?: string }[] | null };

async function json<T>(call: Promise<JsonResult>): Promise<T> {
  const { data, errors } = await call;
  if (errors?.length)
    throw new Error(errors.map((e) => e.message).join('; '));
  return (typeof data === 'string' ? JSON.parse(data) : data) as T;
}

export function surveyCategoriesQuery(client: DataClient, projectId: string) {
  return {
    queryKey: ['species-notebook', 'categories', projectId],
    staleTime: STALE,
    meta: { persist: false },
    queryFn: () =>
      fetchAllPaginatedResults(client.models.Category.categoriesByProjectId, {
        projectId,
        selectionSet: [
          'id',
          'name',
          'color',
          'shortcutKey',
          'annotationSetId',
          'projectId',
        ] as const,
      }) as Promise<SurveyCategory[]>,
  };
}

// Label names used in the organisation's other surveys.
export function otherLabelsQuery(client: DataClient, projectId: string) {
  return {
    queryKey: ['species-notebook', 'other-labels', projectId],
    staleTime: STALE,
    meta: { persist: false },
    queryFn: async () =>
      (
        await json<{ names: string[] }>(
          client.queries.speciesNotebookLabels({ projectId }),
        )
      ).names,
  };
}

export function examplesQuery(
  client: DataClient,
  projectId: string,
  name: string,
) {
  return {
    queryKey: ['species-notebook', 'examples', projectId, name],
    staleTime: TOKEN_STALE,
    gcTime: TOKEN_STALE,
    meta: { persist: false },
    queryFn: () =>
      json<NotebookExamples>(
        client.queries.speciesNotebookExamples({ projectId, name }),
      ),
  };
}

export function cropQuery(client: DataClient, token: string) {
  return {
    queryKey: ['species-notebook', 'crop', token],
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    meta: { persist: false },
    queryFn: () =>
      json<NotebookCrop | null>(client.queries.speciesNotebookCrop({ token })),
  };
}
