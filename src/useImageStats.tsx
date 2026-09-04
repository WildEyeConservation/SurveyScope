import { useEffect, useState } from 'react';
import type { CRUDhook } from './Context';
import { useCategories } from './data/project';
import { useProjectId } from './data/projectScope';

export default function useImageStats(
  annotationsHook: CRUDhook<'Annotation'>
) {
  const [stats, setStats] = useState<Record<string, number>>({});
  const { data: annotations } = annotationsHook;
  const projectId = useProjectId();
  const { data: categories } = useCategories(projectId);

  useEffect(() => {
    if (annotations.length > 0 && categories.length > 0) {
      const tempStats = annotations?.reduce((acc: Record<string, number>, annotation) => {
        const category = categories?.find(
          (c) => c.id === annotation.categoryId
        );
        acc[category?.name || 'Invalid category'] =
          (acc[category?.name || 'Invalid category'] || 0) + 1;
        return acc;
      }, {});
      setStats(tempStats);
    }
  }, [annotations, categories]);
  return stats;
}
