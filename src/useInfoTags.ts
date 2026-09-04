import { useCallback, useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { client } from './stores/appClient';
import {
  fetchInfoTagDataForSet,
  fetchInfoTagNamesForImage,
  fetchInfoTagNamesForSet,
  infoTagNamesFor,
  type InfoTagSetData,
} from './infoTags';
import { mapFromEntries } from './utils/persistedMap';

/** InfoTagSetData as it is cached: Maps flattened to entries so it survives JSON. */
type SerializedInfoTagSetData = {
  tagIdsByAnnotation: [string, string[]][];
  nameById: [string, string][];
};

// Info tags only change when someone runs an informational tagging job, so a
// generous stale time keeps the review page from re-scanning the link index
// every time a filter is tweaked.
const STALE_TIME = 30 * 60 * 1000;

/** The tags defined on a set, id -> name. Cheap; safe to call per component. */
export function useInfoTagNames(annotationSetId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['info-tag-names', annotationSetId],
    enabled: Boolean(annotationSetId),
    staleTime: STALE_TIME,
    // Entries, not the Map: query data is persisted to localStorage as JSON,
    // which turns a Map into `{}`. See utils/persistedMap.
    queryFn: async () =>
      Array.from(await fetchInfoTagNamesForSet(client, annotationSetId!)),
  });
  const entries = query.data;
  return useMemo(() => mapFromEntries(entries, EMPTY_NAMES), [entries]);
}

const EMPTY_NAMES = new Map<string, string>();
const EMPTY_TAG_IDS = new Map<string, string[]>();
const EMPTY_LIST: string[] = [];

/**
 * Tag data for one or more annotation sets, for filtering and display. Each set
 * is a separate cached query, so adding a set to the review page's selection
 * only fetches the new one.
 */
export function useInfoTagData(annotationSetIds: string[]) {
  const idsKey = Array.from(new Set(annotationSetIds.filter(Boolean)))
    .sort()
    .join(',');
  const ids = useMemo(
    () => (idsKey ? idsKey.split(',') : []),
    [idsKey]
  );

  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['info-tag-data', id],
      staleTime: STALE_TIME,
      // Both fields are Maps, so both are cached as entries. See the comment on
      // useInfoTagNames.
      queryFn: async (): Promise<SerializedInfoTagSetData> => {
        const data = await fetchInfoTagDataForSet(client, id);
        return {
          tagIdsByAnnotation: Array.from(data.tagIdsByAnnotation),
          nameById: Array.from(data.nameById),
        };
      },
    })),
  });

  // Signature of the loaded data, so the memos below only recompute when the
  // queries actually resolve (useQueries returns new objects every render).
  const dataSig = queries
    .map((q) =>
      q.data
        ? `${q.data.nameById?.length ?? -1}:${
            q.data.tagIdsByAnnotation?.length ?? -1
          }`
        : ''
    )
    .join('|');

  const bySet = useMemo(() => {
    const map = new Map<string, InfoTagSetData>();
    ids.forEach((id, index) => {
      const data = queries[index]?.data;
      if (!data) return;
      map.set(id, {
        tagIdsByAnnotation: mapFromEntries(
          data.tagIdsByAnnotation,
          EMPTY_TAG_IDS
        ),
        nameById: mapFromEntries(data.nameById, EMPTY_NAMES),
      });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, dataSig]);

  const tagNames = useMemo(() => {
    const names = new Set<string>();
    for (const data of bySet.values()) {
      for (const name of data.nameById.values()) names.add(name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [bySet]);

  const namesFor = useCallback(
    (annotationSetId: string, annotationId: string): string[] => {
      const data = bySet.get(annotationSetId);
      return data ? infoTagNamesFor(data, annotationId) : EMPTY_LIST;
    },
    [bySet]
  );

  return {
    bySet,
    dataSig,
    tagNames,
    namesFor,
    isLoading: queries.some((q) => q.isLoading),
  };
}

/** Tag names per annotation for a single image, keyed by annotation id. */
export function useImageInfoTags(
  imageId: string | null | undefined,
  annotationSetId: string | null | undefined
) {
  const nameById = useInfoTagNames(annotationSetId);
  const query = useQuery({
    queryKey: ['image-info-tags', annotationSetId, imageId],
    // Sets without any tags never reach the (per-image) link query.
    enabled: Boolean(imageId && annotationSetId && nameById.size > 0),
    staleTime: STALE_TIME,
    // Entries, not the Map. See the comment on useInfoTagNames.
    queryFn: async () =>
      Array.from(
        await fetchInfoTagNamesForImage(
          client,
          imageId!,
          annotationSetId!,
          nameById
        )
      ),
  });
  const entries = query.data;
  return useMemo(() => mapFromEntries(entries, EMPTY_IMAGE_TAGS), [entries]);
}

const EMPTY_IMAGE_TAGS = new Map<string, string[]>();
