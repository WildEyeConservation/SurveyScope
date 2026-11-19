import type { DataClient } from '../../amplify/shared/data-schema.generated';
import { fetchAllPaginatedResults } from '../utils';
import { fetchPagedAliased } from './api';
import { matchingCategories, sampleAcrossSurveys } from './fallback';
import { loadImageMeta } from './imageMeta';
import type { GalleryItem, SurveyCategory } from './types';

const STALE = 5 * 60 * 1000;
export const NOTEBOOK_LIMIT = 20;

const CATEGORY_FIELDS = 'id name color shortcutKey annotationSetId projectId';
const ANNOTATION_FIELDS =
  'id x y imageId setId categoryId projectId objectId source reviewedBy reviewCatId createdAt oov';

type AnnotationRow = {
  id: string;
  x: number;
  y: number;
  imageId: string;
  setId: string;
  categoryId: string;
  projectId: string;
  objectId?: string | null;
  source?: string | null;
  reviewedBy?: string | null;
  reviewCatId?: string | null;
  createdAt?: string | null;
  oov?: boolean | null;
};

function toItems(rows: AnnotationRow[]): GalleryItem[] {
  return rows
    .filter((row) => !row.oov && row.imageId)
    .map((row) => ({
      id: row.id,
      x: row.x,
      y: row.y,
      imageId: row.imageId,
      setId: row.setId,
      categoryId: row.categoryId,
      projectId: row.projectId,
      objectId: row.objectId,
      source: row.source,
      createdAt: row.createdAt,
      reviewed: Boolean(row.reviewedBy || row.reviewCatId),
    }));
}

async function categoriesOf(projectIds: string[]) {
  const pages = await fetchPagedAliased<SurveyCategory>(
    'SpeciesCategories',
    projectIds.map((projectId, i) => ({
      alias: `p${i}`,
      field: 'categoriesByProjectId',
      args: { projectId: { type: 'ID!', value: projectId } },
      itemFields: CATEGORY_FIELDS,
      pageSize: 1000,
      max: 10000,
    })),
  );
  return [...pages.values()].flatMap((page) => page.items);
}

export function surveyCategoriesQuery(projectId: string) {
  return {
    queryKey: ['species-notebook', 'categories', projectId],
    staleTime: STALE,
    meta: { persist: false },
    queryFn: () => categoriesOf([projectId]),
  };
}

export type LabelAnnotations = { items: GalleryItem[] };

// max: 0 stops after the first page per category.
async function firstAnnotations(
  name: string,
  categoryIds: string[],
  perCategory: number,
) {
  const pages = await fetchPagedAliased<AnnotationRow>(
    name,
    categoryIds.map((categoryId, i) => ({
      alias: `c${i}`,
      field: 'annotationsByCategoryId',
      args: { categoryId: { type: 'ID!', value: categoryId } },
      itemFields: ANNOTATION_FIELDS,
      pageSize: perCategory,
      max: 0,
    })),
    25,
  );
  return toItems([...pages.values()].flatMap((page) => page.items));
}

export function labelAnnotationsQuery(
  projectId: string,
  name: string,
  categoryIds: string[],
) {
  return {
    queryKey: [
      'species-notebook',
      'annotations',
      projectId,
      name,
      categoryIds.join(','),
    ],
    staleTime: STALE,
    meta: { persist: false },
    enabled: categoryIds.length > 0,
    queryFn: async (): Promise<LabelAnnotations> => {
      const items: GalleryItem[] = [];
      for (const categoryId of categoryIds) {
        const left = NOTEBOOK_LIMIT - items.length;
        if (left <= 0) break;
        items.push(
          ...(await firstAnnotations(
            'SpeciesLabelAnnotations',
            [categoryId],
            left,
          )),
        );
      }
      return { items };
    },
  };
}

type OrgSurvey = { id: string; status?: string | null };

export function orgSurveysQuery(client: DataClient, organizationId: string) {
  return {
    queryKey: ['species-notebook', 'org-surveys', organizationId],
    staleTime: STALE,
    meta: { persist: false },
    queryFn: async () => {
      const surveys = (await fetchAllPaginatedResults(
        client.models.Project.list,
        {
          filter: { organizationId: { eq: organizationId } },
          selectionSet: ['id', 'status'] as const,
        },
      )) as OrgSurvey[];
      return surveys
        .filter((survey) => survey.status !== 'deleted')
        .map((survey) => survey.id);
    },
  };
}

// No index finds categories by name, so read each survey's (small) label list.
export function orgCategoriesQuery(
  organizationId: string,
  surveyIds: string[],
) {
  return {
    queryKey: [
      'species-notebook',
      'org-categories',
      organizationId,
      [...surveyIds].sort().join(','),
    ],
    staleTime: STALE,
    meta: { persist: false },
    enabled: surveyIds.length > 0,
    queryFn: () => categoriesOf(surveyIds),
  };
}

export function fallbackSamplesQuery(
  projectId: string,
  name: string,
  orgCategories: SurveyCategory[] | undefined,
) {
  const matches = orgCategories
    ? matchingCategories(name, orgCategories, projectId)
    : [];
  return {
    queryKey: [
      'species-notebook',
      'fallback',
      projectId,
      name,
      matches.map((c) => c.id).join(','),
    ],
    staleTime: STALE,
    meta: { persist: false },
    enabled: Boolean(orgCategories),
    queryFn: async () => {
      if (matches.length === 0) return { items: [], surveys: 0 };
      const used = matches.slice(0, NOTEBOOK_LIMIT);
      const items = await firstAnnotations(
        'SpeciesFallbackSamples',
        used.map((category) => category.id),
        Math.floor(NOTEBOOK_LIMIT / used.length),
      );
      return {
        items: sampleAcrossSurveys(items, NOTEBOOK_LIMIT),
        surveys: new Set(items.map((item) => item.projectId)).size,
      };
    },
  };
}

export function imageMetaQuery(imageId: string) {
  return {
    queryKey: ['species-notebook', 'image-meta', imageId],
    staleTime: STALE,
    meta: { persist: false },
    queryFn: () => loadImageMeta(imageId),
  };
}

export type ImageAnnotation = {
  id: string;
  x: number;
  y: number;
  categoryId: string;
  objectId?: string | null;
  source?: string | null;
  obscured?: boolean | null;
};

export function imageAnnotationsQuery(
  client: DataClient,
  imageId: string,
  setId: string,
) {
  return {
    queryKey: ['species-notebook', 'image-annotations', imageId, setId],
    staleTime: STALE,
    meta: { persist: false },
    queryFn: () =>
      fetchAllPaginatedResults(
        client.models.Annotation.annotationsByImageIdAndSetId,
        {
          imageId,
          setId: { eq: setId },
          limit: 10000,
          selectionSet: [
            'id',
            'x',
            'y',
            'categoryId',
            'objectId',
            'source',
            'obscured',
          ] as const,
        },
      ) as Promise<ImageAnnotation[]>,
  };
}
