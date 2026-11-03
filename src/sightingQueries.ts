import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { DataClient } from '../amplify/shared/data-schema.generated';
import { loadProjectImages } from './projectImages';
import { loadRows } from './rowChunks';
import { fetchAllPaginatedResults } from './utils';

type Outline = { id: string; coordinates?: number[] | null };

const STALE_TIME = 30 * 60 * 1000;

export function surveyGeoQuery(client: DataClient, surveyId: string) {
  return {
    queryKey: ['densitymap', 'survey-geo-v3', surveyId],
    staleTime: STALE_TIME,
    // Too large for localStorage.
    meta: { persist: false },
    queryFn: async () => {
      const [images, strata, exclusions] = await Promise.all([
        loadProjectImages(client, surveyId, [
          'latitude',
          'longitude',
          'transectId',
          'timestamp',
          'width',
          'height',
          'originalPath',
          'boundaryStatus',
        ]),
        fetchAllPaginatedResults<Outline & { name: string | null }>(
          client.models.Stratum.strataByProjectId,
          {
            projectId: surveyId,
            limit: 10000,
            selectionSet: ['id', 'name', 'coordinates'],
          },
        ),
        fetchAllPaginatedResults<Outline>(
          client.models.ShapefileExclusions.shapefileExclusionsByProjectId,
          {
            projectId: surveyId,
            limit: 10000,
            selectionSet: ['id', 'coordinates'],
          },
        ),
      ]);
      return { surveyId, images, strata, exclusions };
    },
  };
}

export function setAnnotationsQuery(
  client: DataClient,
  surveyId: string,
  annotationSetId: string,
) {
  return {
    queryKey: ['densitymap', 'annotations', annotationSetId],
    staleTime: STALE_TIME,
    meta: { persist: false },
    queryFn: async () => {
      const [rows, surveyCategories] = await Promise.all([
        loadRows(client, 'annotationsByAnnotationSetId', annotationSetId, [
          'imageId',
          'categoryId',
          'objectId',
          'source',
          'owner',
        ]),
        loadRows(client, 'categoriesByProjectId', surveyId, ['name']),
      ]);
      const categories = new Map(
        surveyCategories.map((c) => [c.id, { id: c.id, name: c.name ?? '' }]),
      );
      const annotations = rows.map((a) => ({
        ...a,
        setId: annotationSetId,
        category: (a.categoryId && categories.get(a.categoryId)) || null,
      }));
      return { surveyId, annotationSetId, annotations };
    },
  };
}

export function extractUserIdFromOwner(
  owner: string | null | undefined,
): string | null {
  if (!owner) return null;
  return owner.includes('::') ? owner.split('::')[0] : owner;
}

type ViewerAnnotation = {
  id: string;
  imageId?: string | null;
  setId?: string | null;
  categoryId?: string | null;
  objectId?: string | null;
  source?: string | null;
  owner?: string | null;
};

type SetAnnotations = Awaited<
  ReturnType<ReturnType<typeof setAnnotationsQuery>['queryFn']>
>;

// Viewer query keys scope annotations by set and image.
function viewerScope(queryKey: readonly unknown[]) {
  if (queryKey[0] !== 'Annotation') return null;
  const conditions = (
    queryKey[1] as { filter?: { and?: Record<string, { eq?: string }>[] } }
  )?.filter?.and;
  const setId = conditions?.find((c) => c.setId)?.setId?.eq;
  const imageId = conditions?.find((c) => c.imageId)?.imageId?.eq;
  return setId && imageId ? { setId, imageId } : null;
}

// Sync viewer edits without refetching the whole set.
export function useSyncViewerEdits(categoryNames: Map<string, string>): void {
  const queryClient = useQueryClient();
  const namesRef = useRef(categoryNames);
  namesRef.current = categoryNames;

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated') return;
        const { query } = event;
        if (query.state.status !== 'success') return;
        const scope = viewerScope(query.queryKey);
        if (!scope) return;
        const viewerRows = (query.state.data ?? []) as ViewerAnnotation[];
        queryClient.setQueryData<SetAnnotations>(
          ['densitymap', 'annotations', scope.setId],
          (old) => {
            if (!old) return old;
            const fresh = viewerRows
              .filter((a) => !a.setId || a.setId === scope.setId)
              .map((a) => ({
                id: a.id,
                imageId: scope.imageId,
                categoryId: a.categoryId ?? null,
                objectId: a.objectId ?? null,
                source: a.source ?? null,
                owner: a.owner ?? null,
                setId: scope.setId,
                category: a.categoryId
                  ? {
                      id: a.categoryId,
                      name: namesRef.current.get(a.categoryId) ?? '',
                    }
                  : null,
              }));
            const kept = old.annotations.filter(
              (a) => a.imageId !== scope.imageId,
            );
            return { ...old, annotations: [...kept, ...fresh] };
          },
        );
      }),
    [queryClient],
  );
}
