import pLimit from 'p-limit';
import type { DataClient } from '../amplify/shared/data-schema.generated';
import { fetchAllPaginatedResults } from './utils';

export const INFO_TAG_CSV_DELIMITER = '|';

export type InfoTagSetData = {
  tagIdsByAnnotation: Map<string, string[]>;
  nameById: Map<string, string>;
};

export function formatInfoTagsForDisplay(names: string[]): string {
  return names
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .join(', ');
}

export function formatInfoTagsForCsv(names: string[]): string {
  return names
    .map((name) => name.replace(/[|,]/g, '/'))
    .sort((a, b) => a.localeCompare(b))
    .join(INFO_TAG_CSV_DELIMITER);
}

// The tags defined on a set - small, and cheap enough to load on its own when
// only the names are needed (a filter's options, a popup's lookup table).
export async function fetchInfoTagNamesForSet(
  client: DataClient,
  annotationSetId: string
): Promise<Map<string, string>> {
  const tags = await fetchAllPaginatedResults(
    client.models.InfoTag.infoTagsByAnnotationSetId,
    {
      annotationSetId,
      selectionSet: ['id', 'name'] as const,
      limit: 1000,
    }
  );
  return new Map(tags.map((tag) => [tag.id, tag.name]));
}

// Query by annotation set to avoid scanning the link table per annotation.
export async function fetchInfoTagDataForSet(
  client: DataClient,
  annotationSetId: string,
  onProgress?: (count: number) => void
): Promise<InfoTagSetData> {
  // A set with no tags defined cannot have any links, so the scan of the link
  // index - by far the expensive half - is skipped for untagged sets.
  const nameById = await fetchInfoTagNamesForSet(client, annotationSetId);
  if (nameById.size === 0) {
    return { tagIdsByAnnotation: new Map(), nameById };
  }

  const links = await fetchAllPaginatedResults(
    client.models.AnnotationInfoTag.annotationInfoTagsByAnnotationSetId,
    {
      annotationSetId,
      selectionSet: ['annotationId', 'infoTagId'] as const,
      limit: 10000,
    },
    onProgress
  );

  const tagIdsByAnnotation = new Map<string, string[]>();
  for (const link of links) {
    const tagIds = tagIdsByAnnotation.get(link.annotationId);
    if (tagIds) tagIds.push(link.infoTagId);
    else tagIdsByAnnotation.set(link.annotationId, [link.infoTagId]);
  }

  return { tagIdsByAnnotation, nameById };
}

export function infoTagNamesFor(
  data: InfoTagSetData,
  annotationId: string
): string[] {
  return (data.tagIdsByAnnotation.get(annotationId) ?? [])
    .map((id) => data.nameById.get(id))
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b));
}

export async function fetchInfoTagsForAnnotations(
  client: DataClient,
  annotationSetId: string,
  annotationIds: string[]
): Promise<Map<string, string[]>> {
  const data = await fetchInfoTagDataForSet(client, annotationSetId);
  const result = new Map<string, string[]>();
  for (const annotationId of new Set(annotationIds)) {
    result.set(annotationId, infoTagNamesFor(data, annotationId));
  }
  return result;
}

export async function fetchAllInfoTagsForSet(
  client: DataClient,
  annotationSetId: string,
  onProgress?: (count: number) => void
): Promise<Map<string, string[]>> {
  const data = await fetchInfoTagDataForSet(client, annotationSetId, onProgress);
  const result = new Map<string, string[]>();
  for (const annotationId of data.tagIdsByAnnotation.keys()) {
    result.set(annotationId, infoTagNamesFor(data, annotationId));
  }
  return result;
}

export async function attachInfoTagsToAnnotations<T extends { id: string }>(
  client: DataClient,
  annotations: T[],
  annotationSetId: string
): Promise<Array<T & { infoTags?: string[] }>> {
  const data = await fetchInfoTagDataForSet(client, annotationSetId);
  // Always replace the API relationship field, even for sets without tags.
  // Raw annotations can carry an infoTags loader function rather than names.
  return annotations.map((annotation) => ({
    ...annotation,
    infoTags:
      data.nameById.size > 0
        ? infoTagNamesFor(data, annotation.id)
        : undefined,
  }));
}

type MutationOutcome = {
  errors?: ReadonlyArray<{ message?: string }> | null;
};

// Amplify data operations resolve with an `errors` array instead of rejecting,
// so every write has to be inspected or failures pass for successes.
export function assertNoGraphqlErrors(
  result: MutationOutcome | null | undefined,
  description: string
): void {
  const message = result?.errors?.[0]?.message;
  if (message) throw new Error(`${description}: ${message}`);
}

// A conditional check failure on a link write means the row is already in the
// state we wanted, which is exactly what a retry of a partial save produces.
const ALREADY_APPLIED = /conditional (request failed|check)/i;

function assertLinkWriteSucceeded(
  result: MutationOutcome | null | undefined,
  description: string
): void {
  const message = result?.errors?.[0]?.message;
  if (!message || ALREADY_APPLIED.test(message)) return;
  throw new Error(`${description}: ${message}`);
}

// Nested has-many selections come back either as a plain array or as a
// { items: [...] } page, so accept both shapes.
export function infoTagIdsFromLinks(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : (value as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (item as { infoTagId?: unknown } | null)?.infoTagId)
    .filter((id): id is string => typeof id === 'string');
}

export function planInfoTagLinkChanges(
  before: Iterable<string>,
  after: Iterable<string>
): { added: string[]; removed: string[] } {
  const beforeIds = new Set(before);
  const afterIds = new Set(after);
  return {
    added: Array.from(afterIds).filter((id) => !beforeIds.has(id)),
    removed: Array.from(beforeIds).filter((id) => !afterIds.has(id)),
  };
}

export type ImageAnnotationRow = {
  id: string;
  imageId: string;
  setId: string;
  projectId: string;
  group: string | null;
  categoryId: string;
  x: number;
  y: number;
  infoTaggedBy: string | null;
  tagIds: string[];
};

// The tag links ride along with the annotations of the image being worked on.
// Reading the annotation set's entire link index instead made every image cost
// a full scan of every tag in the survey.
export async function fetchImageAnnotationsWithTags(
  client: DataClient,
  imageId: string,
  annotationSetId: string
): Promise<ImageAnnotationRow[]> {
  const rows: ImageAnnotationRow[] = [];
  let nextToken: string | null | undefined = undefined;

  do {
    const result = await client.models.Annotation.annotationsByImageIdAndSetId(
      { imageId, setId: { eq: annotationSetId } },
      {
        selectionSet: [
          'id',
          'imageId',
          'setId',
          'projectId',
          'group',
          'categoryId',
          'x',
          'y',
          'infoTaggedBy',
          'infoTags.annotationId',
          'infoTags.infoTagId',
        ] as const,
        limit: 10000,
        nextToken,
      }
    );
    // A partial read resolves with data alongside `errors`; treating a link
    // that failed to load as "no tag" would write the user's screen back over
    // tags that are actually there, so refuse to work from it.
    assertNoGraphqlErrors(
      result,
      `Failed to load annotations for image ${imageId}`
    );
    for (const annotation of result.data ?? []) {
      rows.push({
        id: annotation.id,
        imageId: annotation.imageId,
        setId: annotation.setId,
        projectId: annotation.projectId,
        group: annotation.group ?? null,
        categoryId: annotation.categoryId,
        x: annotation.x,
        y: annotation.y,
        infoTaggedBy: annotation.infoTaggedBy ?? null,
        tagIds: infoTagIdsFromLinks(annotation.infoTags),
      });
    }
    nextToken = result.nextToken;
  } while (nextToken);

  return rows;
}

// Tag names per annotation for a single image. Reading the image's annotations
// (which carry their links) costs one query, where the set-wide link index
// would be scanned in full for every image opened in a viewer.
export async function fetchInfoTagNamesForImage(
  client: DataClient,
  imageId: string,
  annotationSetId: string,
  nameById: Map<string, string>
): Promise<Map<string, string[]>> {
  const rows = await fetchImageAnnotationsWithTags(
    client,
    imageId,
    annotationSetId
  );
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const names = row.tagIds
      .map((tagId) => nameById.get(tagId))
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b));
    if (names.length) result.set(row.id, names);
  }
  return result;
}

export type InfoTagCommit = {
  annotationId: string;
  annotationSetId: string;
  projectId: string;
  group?: string;
  before: Iterable<string>;
  after: Iterable<string>;
  position: { x: number; y: number };
  taggedBy: string;
  recordStatistics?: () => Promise<void>;
};

// The links are written first and `infoTaggedBy` only once they all succeed:
// stamping the annotation earlier would let the requeue check treat a partial
// save as finished work, and the missing tags would never be written again.
export async function commitInfoTagsForAnnotation(
  client: DataClient,
  commit: InfoTagCommit
): Promise<void> {
  const { added, removed } = planInfoTagLinkChanges(commit.before, commit.after);

  await Promise.all([
    ...added.map(async (infoTagId) =>
      assertLinkWriteSucceeded(
        await client.models.AnnotationInfoTag.create({
          annotationId: commit.annotationId,
          infoTagId,
          annotationSetId: commit.annotationSetId,
          projectId: commit.projectId,
          group: commit.group,
        }),
        `Failed to add info tag ${infoTagId}`
      )
    ),
    ...removed.map(async (infoTagId) =>
      assertLinkWriteSucceeded(
        await client.models.AnnotationInfoTag.delete({
          annotationId: commit.annotationId,
          infoTagId,
        }),
        `Failed to remove info tag ${infoTagId}`
      )
    ),
  ]);

  const saved = await client.models.Annotation.update({
      id: commit.annotationId,
      infoTaggedBy: commit.taggedBy,
      x: commit.position.x,
      y: commit.position.y,
    });
  assertNoGraphqlErrors(saved, 'Failed to record informational tagging');
  if (!saved.data) throw new Error('Failed to record informational tagging: no annotation returned');
  await commit.recordStatistics?.();
}

export type InfoTagImageProgress = { counted: boolean; acknowledged: boolean };

// Queue progress is only recorded and the SQS message only deleted once every
// tag write for the image has landed, so a failed save is redelivered instead
// of being dropped.
export async function finalizeInfoTagImage(options: {
  commits: ReadonlyArray<Promise<unknown>>;
  progress: InfoTagImageProgress;
  countCompletion: boolean;
  incrementCount: () => Promise<void>;
  acknowledge: () => Promise<void>;
}): Promise<void> {
  const results = await Promise.allSettled(options.commits);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failure) throw failure.reason;

  if (options.countCompletion && !options.progress.counted) {
    await options.incrementCount();
    options.progress.counted = true;
  }
  if (!options.progress.acknowledged) {
    await options.acknowledge();
    options.progress.acknowledged = true;
  }
}

// Links reference their tag, so they have to go first.
export async function deleteInfoTagDataForSet(
  client: DataClient,
  annotationSetId: string
): Promise<void> {
  const limit = pLimit(10);
  const links = await fetchAllPaginatedResults(
    client.models.AnnotationInfoTag.annotationInfoTagsByAnnotationSetId,
    {
      annotationSetId,
      selectionSet: ['annotationId', 'infoTagId'] as const,
      limit: 1000,
    }
  );
  await Promise.all(
    links.map((link) =>
      limit(async () =>
        assertLinkWriteSucceeded(
          await client.models.AnnotationInfoTag.delete({
            annotationId: link.annotationId,
            infoTagId: link.infoTagId,
          }),
          'Failed to delete info tag link'
        )
      )
    )
  );

  const tags = await fetchAllPaginatedResults(
    client.models.InfoTag.infoTagsByAnnotationSetId,
    { annotationSetId, selectionSet: ['id'] as const, limit: 1000 }
  );
  await Promise.all(
    tags.map((tag) =>
      limit(async () =>
        assertLinkWriteSucceeded(
          await client.models.InfoTag.delete({ id: tag.id }),
          'Failed to delete info tag'
        )
      )
    )
  );
}

export async function hasInfoTagsForSet(
  client: DataClient,
  annotationSetId: string
): Promise<boolean> {
  const { data } = await client.models.InfoTag.infoTagsByAnnotationSetId(
    { annotationSetId },
    { selectionSet: ['id'] as const, limit: 1 }
  );
  return data.length > 0;
}
