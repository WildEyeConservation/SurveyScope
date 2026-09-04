import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { client } from '../../stores/appClient';
import { fetchAllPaginatedResults } from '../../utils';
import type {
  ImageNeighbourType,
  ImageType,
} from '../../schemaTypes';
import { useCurrentProject } from '../../data/projectScope';

type ImageWithNeighbours = Pick<
  ImageType,
  'id' | 'width' | 'height' | 'originalPath' | 'timestamp' | 'cameraId'
> & {
  leftNeighbours?: ImageNeighbourType[] | null;
  rightNeighbours?: ImageNeighbourType[] | null;
};

export interface HerdLoadProgress {
  phase: 'idle' | 'images' | 'cameras' | 'done';
  images: number;
}

/**
 * Image / neighbour / camera reference data for the herd view, loaded once
 * per survey and cached. Annotations are owned separately by the harness so
 * the obscured toggle can mutate them locally; this hook only supplies the
 * static geometry the pair navigation is built from.
 */
export interface HerdData {
  imagesById: Record<string, ImageType>;
  rawNeighbours: ImageNeighbourType[];
  cameraNamesById: Record<string, string>;
}

export function useHerdData() {
  const project = useCurrentProject();

  const [progress, setProgress] = useState<HerdLoadProgress>({
    phase: 'idle',
    images: 0,
  });

  const query = useQuery<HerdData>({
    queryKey: ['herd-view-images', project?.id],
    enabled: Boolean(project?.id),
    staleTime: Infinity,
    queryFn: async () => {
      setProgress({ phase: 'images', images: 0 });
      const images = (await fetchAllPaginatedResults<ImageType>(
        client.models.Image.imagesByProjectId,
        {
          projectId: project!.id,
          limit: 10000,
          selectionSet: [
            'id',
            'width',
            'height',
            'originalPath',
            'timestamp',
            'cameraId',
            'leftNeighbours.*',
            'rightNeighbours.*',
          ],
        },
        (n) => setProgress((p) => ({ ...p, images: n }))
      )) as unknown as ImageWithNeighbours[];

      const imagesById: Record<string, ImageType> = {};
      for (const img of images) imagesById[img.id] = img as unknown as ImageType;

      const imageIds = new Set(images.map((i) => i.id));
      const seen = new Set<string>();
      const rawNeighbours: ImageNeighbourType[] = [];
      for (const img of images) {
        for (const n of [
          ...(img.leftNeighbours ?? []),
          ...(img.rightNeighbours ?? []),
        ]) {
          if (n.skipped) continue;
          if (!imageIds.has(n.image1Id) || !imageIds.has(n.image2Id)) continue;
          const k = `${n.image1Id}__${n.image2Id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          rawNeighbours.push(n);
        }
      }

      setProgress((p) => ({ ...p, phase: 'cameras' }));
      const cameraResp = await client.models.Camera.camerasByProjectId(
        { projectId: project!.id },
        { selectionSet: ['id', 'name'], limit: 1000 }
      );
      const cameraNamesById: Record<string, string> = {};
      for (const c of (cameraResp.data ?? []) as Array<{
        id?: string | null;
        name?: string | null;
      }>) {
        if (c?.id && c?.name) cameraNamesById[c.id] = c.name;
      }

      setProgress((p) => ({ ...p, phase: 'done' }));
      return { imagesById, rawNeighbours, cameraNamesById };
    },
  });

  return useMemo(() => ({ ...query, progress }), [query, progress]);
}
