import { useQuery } from '@tanstack/react-query';
import { useContext, useMemo } from 'react';
import type { UserType } from '../../amplify/shared/types';
import {
  GlobalContext,
  UserContext,
  type ManagementContextType,
  type UserContextType,
} from '../Context';
import {
  fallbackSamplesQuery,
  labelAnnotationsQuery,
  orgCategoriesQuery,
  orgSurveysQuery,
  surveyCategoriesQuery,
} from './data';
import { openInExplore, openInNewTab } from './exploreLink';
import { notebook } from './store';
import type { ViewerContexts } from './SurveyScope';
import type { GalleryItem, LabelRef, SurveyCategory } from './types';

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

export function useOrgCategories(
  organizationId: string | undefined,
  enabled: boolean,
) {
  const { client } = useContext(GlobalContext)!;
  const surveys = useQuery({
    ...orgSurveysQuery(client, organizationId ?? ''),
    enabled: enabled && Boolean(organizationId),
  });
  const categories = useQuery({
    ...orgCategoriesQuery(organizationId ?? '', surveys.data ?? []),
    enabled: enabled && Boolean(surveys.data?.length),
  });
  return {
    data: categories.data,
    loading: surveys.isLoading || categories.isLoading,
    error: surveys.isError || categories.isError,
  };
}

export function categoryIdsFor(
  categories: readonly SurveyCategory[] | undefined,
  name: string,
) {
  return (categories ?? [])
    .filter((category) => category.name === name)
    .map((category) => category.id);
}

export function useLabelGallery(label: LabelRef | null) {
  const projectId = label?.projectId ?? '';
  const name = label?.name ?? '';
  const categories = useQuery({
    ...surveyCategoriesQuery(projectId),
    enabled: Boolean(label),
  });
  const categoryIds = useMemo(
    () => categoryIdsFor(categories.data, name),
    [categories.data, name],
  );
  const annotations = useQuery({
    ...labelAnnotationsQuery(projectId, name, categoryIds),
    enabled: Boolean(label) && categoryIds.length > 0,
  });
  const empty =
    categories.isSuccess &&
    (categoryIds.length === 0 ||
      (annotations.isSuccess && annotations.data.items.length === 0));
  const organizationId = useOrganizationId(empty ? projectId : undefined);
  const org = useOrgCategories(organizationId, empty);
  const fallback = useQuery({
    ...fallbackSamplesQuery(projectId, name, org.data),
    enabled: empty && Boolean(org.data),
  });
  const color =
    label?.color ||
    categories.data?.find((c) => c.name === name && c.color)?.color ||
    DEFAULT_COLOR;
  const items: GalleryItem[] = empty
    ? (fallback.data?.items ?? [])
    : (annotations.data?.items ?? []);
  return {
    color,
    categoryIds,
    items,
    empty,
    loading:
      categories.isLoading ||
      annotations.isLoading ||
      (empty && !fallback.isSuccess && !fallback.isError && !org.error),
    error: categories.isError || annotations.isError,
    borrowedSurveys: empty ? (fallback.data?.surveys ?? 0) : 0,
  };
}

export function useOpenItem() {
  const open = (item: GalleryItem) => {
    const target = {
      projectId: item.projectId,
      imageId: item.imageId,
      annotationSetId: item.setId,
      categoryId: item.categoryId,
    };
    if (item.borrowed) {
      openInNewTab(target);
      return;
    }
    if (openInExplore(target) === 'jumped') notebook.closePalette();
  };
  return open;
}

const noop = () => {};

// The notebook mounts outside the survey providers.
export function useViewerContexts(users: UserType[]): ViewerContexts {
  const user = useContext(UserContext)!;
  return useMemo(() => {
    // Keeps the palette out of the background job's task bookkeeping.
    const userValue: UserContextType = {
      ...user,
      setCurrentAnnoCount: noop,
      setCurrentTaskTag: noop,
    };
    const empty = { data: [], create: () => '', update: noop, delete: noop };
    const management = {
      allUsers: users,
      projectMembershipHook: { ...empty, data: user.myMembershipHook.data },
      annotationSetsHook: empty,
      imageSetsHook: empty,
      locationSetsHook: empty,
      queuesHook: empty,
    } as unknown as ManagementContextType;
    return { userValue, management };
  }, [user, users]);
}
