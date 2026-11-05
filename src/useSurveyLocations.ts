import { useContext, useEffect, useState } from 'react';
import { GlobalContext } from './Context';

export type SurveyLocation = { lat: number; lng: number };

const CONCURRENCY = 8;

export function useSurveyLocations(projectIds: string[]) {
  const { client } = useContext(GlobalContext)!;
  const [locations, setLocations] = useState<Map<string, SurveyLocation>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);
  const key = projectIds.join(',');

  useEffect(() => {
    if (!projectIds.length) return;
    let cancelled = false;
    const found = new Map<string, SurveyLocation>();
    const queue = [...projectIds];

    async function worker() {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          const { data } = await client.models.Image.imagesByProjectId(
            { projectId: id },
            { limit: 10, selectionSet: ['latitude', 'longitude'] },
          );
          // 0,0 is what cameras write when they have no GPS fix.
          const image = data.find(
            (i) =>
              i.latitude != null &&
              i.longitude != null &&
              (i.latitude !== 0 || i.longitude !== 0),
          );
          if (image)
            found.set(id, { lat: image.latitude!, lng: image.longitude! });
        } catch (error) {
          console.warn('Failed to load survey location', id, error);
        }
      }
    }

    setLoading(true);
    Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(() => {
      if (cancelled) return;
      setLocations(found);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  return { locations, loading };
}
