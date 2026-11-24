import { useQuery } from '@tanstack/react-query';
import { useContext } from 'react';
import { GlobalContext } from '../Context';
import { examplesQuery, surveyCategoriesQuery } from './data';
import { openInExplore, openInNewTab } from './exploreLink';
import { notebook } from './store';
import type { LabelRef, NotebookExample } from './types';

export const DEFAULT_COLOR = '#facc15';

export function useOrganizationId(projectId: string | undefined) {
  const { client } = useContext(GlobalContext)!;
  // Same key and fetch as the survey provider, so this is usually cached.
  const project = useQuery({
    queryKey: ['project', projectId],
    enabled: Boolean(projectId),
    queryFn: () => client.models.Project.get({ id: projectId! }),
  });
  return project.data?.data?.organizationId ?? undefined;
}

export function useLabelGallery(label: LabelRef | null) {
  const { client } = useContext(GlobalContext)!;
  const projectId = label?.projectId ?? '';
  const name = label?.name ?? '';
  const categories = useQuery({
    ...surveyCategoriesQuery(client, projectId),
    enabled: Boolean(label),
  });
  const examples = useQuery({
    ...examplesQuery(client, projectId, name),
    enabled: Boolean(label),
  });
  const items = examples.data?.examples ?? [];
  const empty = examples.isSuccess && !items.some((item) => !item.borrowed);
  const color =
    label?.color ||
    categories.data?.find((c) => c.name === name && c.color)?.color ||
    DEFAULT_COLOR;
  return {
    color,
    items,
    empty,
    loading: examples.isLoading,
    error: examples.isError,
    borrowedSurveys: examples.data?.borrowedSurveys ?? 0,
  };
}

export function openExample(item: NotebookExample) {
  if (!item.explore) return;
  if (item.borrowed) {
    openInNewTab(item.explore);
    return;
  }
  if (openInExplore(item.explore) === 'jumped') notebook.closePalette();
}
