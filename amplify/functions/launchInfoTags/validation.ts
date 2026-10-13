// Pure request validation for the informational tagging launch, kept free of
// the Amplify env import so it can be exercised directly by tests.

export type LaunchInfoTagsPayload = {
  projectId: string;
  annotationSetId: string;
  categoryIds: string[];
  categoryNames?: string[];
  batchSize: number;
  hidden: boolean;
  zoom?: number;
};

export type AnnotationSetRef = {
  id: string;
  projectId: string;
} | null | undefined;

export type CategoryRef = {
  id: string;
  projectId: string;
  annotationSetId: string;
} | null | undefined;

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 10000;
const MAX_CATEGORIES = 1000;

export function parsePayload(request: unknown): LaunchInfoTagsPayload {
  if (typeof request !== 'string') {
    throw new Error('Launch payload is required');
  }
  const parsed = JSON.parse(request);
  if (
    typeof parsed?.projectId !== 'string' ||
    typeof parsed?.annotationSetId !== 'string' ||
    !Array.isArray(parsed?.categoryIds) ||
    parsed.categoryIds.length === 0 ||
    !parsed.categoryIds.every((id: unknown) => typeof id === 'string' && id)
  ) {
    throw new Error(
      'Launch payload missing required fields (projectId, annotationSetId, categoryIds)'
    );
  }
  const categoryIds = Array.from(new Set<string>(parsed.categoryIds));
  if (categoryIds.length > MAX_CATEGORIES) {
    throw new Error(`Launch payload exceeds ${MAX_CATEGORIES} labels`);
  }
  return {
    projectId: parsed.projectId,
    annotationSetId: parsed.annotationSetId,
    categoryIds,
    categoryNames: Array.isArray(parsed.categoryNames)
      ? parsed.categoryNames.filter(
          (name: unknown): name is string => typeof name === 'string'
        )
      : undefined,
    batchSize: normaliseBatchSize(parsed.batchSize),
    hidden: parsed.hidden === true,
    zoom: Number.isInteger(parsed.zoom) ? parsed.zoom : undefined,
  };
}

function normaliseBatchSize(value: unknown): number {
  const batchSize = Math.floor(Number(value));
  if (!Number.isFinite(batchSize) || batchSize < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(batchSize, MAX_BATCH_SIZE);
}

// The caller is only authorised against the project it names, so every other id
// in the request has to be proven to belong to that same project before the
// Lambda's IAM credentials are used to read or queue anything.
export function assertInputsBelongToProject(
  payload: Pick<
    LaunchInfoTagsPayload,
    'projectId' | 'annotationSetId' | 'categoryIds'
  >,
  annotationSet: AnnotationSetRef,
  categories: ReadonlyArray<CategoryRef>
): void {
  if (!annotationSet) {
    throw new Error(`Annotation set ${payload.annotationSetId} not found`);
  }
  if (annotationSet.projectId !== payload.projectId) {
    throw new Error(
      'Annotation set does not belong to the requested project'
    );
  }

  const byId = new Map(
    categories
      .filter((category): category is NonNullable<CategoryRef> => !!category)
      .map((category) => [category.id, category])
  );
  for (const categoryId of payload.categoryIds) {
    const category = byId.get(categoryId);
    if (!category) {
      throw new Error(`Label ${categoryId} not found`);
    }
    if (
      category.annotationSetId !== payload.annotationSetId ||
      category.projectId !== payload.projectId
    ) {
      throw new Error(
        `Label ${categoryId} does not belong to the requested annotation set`
      );
    }
  }
}
