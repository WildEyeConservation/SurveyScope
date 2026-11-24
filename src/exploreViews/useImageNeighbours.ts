import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useContext, useMemo } from 'react';
import { GlobalContext } from '../Context';
import type { NeighbourRow } from './otherViews';

type NeighbourResponse = { data?: NeighbourRow[] | null };

// Same keys and shape as ImageContext, so the annotator's fetch is reused.
const prevKey = (imageId: string | null) => ['prevNeighbours', imageId];
const nextKey = (imageId: string | null) => ['nextNeighbours', imageId];

export function useImageNeighbours(imageId: string | null) {
  const { client } = useContext(GlobalContext)!;
  const options = { enabled: !!imageId, staleTime: Infinity, gcTime: 36e5 };
  const prev = useQuery({
    queryKey: prevKey(imageId),
    queryFn: () =>
      client.models.ImageNeighbour.imageNeighboursByImage2key({
        image2Id: imageId!,
      }),
    ...options,
  });
  const next = useQuery({
    queryKey: nextKey(imageId),
    queryFn: () =>
      client.models.ImageNeighbour.imageNeighboursByImage1key({
        image1Id: imageId!,
      }),
    ...options,
  });
  const rows = useMemo(
    () => [
      ...((prev.data as NeighbourResponse | undefined)?.data ?? []),
      ...((next.data as NeighbourResponse | undefined)?.data ?? []),
    ],
    [prev.data, next.data],
  );
  return { rows, loading: prev.isLoading || next.isLoading };
}

export function cachedNeighbours(
  queryClient: QueryClient,
  imageId: string,
): NeighbourRow[] | null {
  const prev = queryClient.getQueryData<NeighbourResponse>(prevKey(imageId));
  const next = queryClient.getQueryData<NeighbourResponse>(nextKey(imageId));
  if (!prev || !next) return null;
  return [...(prev.data ?? []), ...(next.data ?? [])];
}
