import { useContext, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlobalContext, ProjectContext } from '../../Context';
import { loadProjectImages } from '../../projectImages';
import { loadProjectNeighbours } from '../../projectNeighbours';
import type {
  ImageNeighbourType,
  ImageType,
} from '../../schemaTypes';

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
  const { client } = useContext(GlobalContext)!;
  const { project } = useContext(ProjectContext)!;

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
      const images = await loadProjectImages(
        client,
        project!.id,
        ['width', 'height', 'originalPath', 'timestamp', 'cameraId'],
        { onProgress: (n) => setProgress((p) => ({ ...p, images: n })) }
      );

      const imagesById: Record<string, ImageType> = {};
      for (const img of images) imagesById[img.id] = img as unknown as ImageType;

      const neighbours = await loadProjectNeighbours(
        client,
        project!.id,
        new Set(images.map((i) => i.id))
      );
      const rawNeighbours = neighbours.filter(
        (n) => !n.skipped
      ) as unknown as ImageNeighbourType[];

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
