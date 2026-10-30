import type { AnnotationType } from '../../schemaTypes';

type ImageAge = {
  timestamp?: number | null;
  originalPath?: string | null;
};

export interface ChainSplitPlan {
  chainSize: number;
  splitCount: number;
  retainedCount: number;
  newRootId: string;
  updates: Array<{ id: string; patch: Partial<AnnotationType> }>;
}

export interface SameImageAnnotationConflict {
  imageId: string;
  annotationIds: string[];
}

export function findSameImageAnnotationConflicts(
  annotations: Array<{ id: string; imageId: string }>,
): SameImageAnnotationConflict[] {
  const byImage = new Map<string, string[]>();
  for (const annotation of annotations) {
    const ids = byImage.get(annotation.imageId);
    if (ids) ids.push(annotation.id);
    else byImage.set(annotation.imageId, [annotation.id]);
  }
  return Array.from(byImage.entries())
    .filter(([, annotationIds]) => annotationIds.length > 1)
    .map(([imageId, annotationIds]) => ({ imageId, annotationIds }));
}

export function findDuplicateSameImageChainAnnotationIds(
  annotations: AnnotationType[],
): Set<string> {
  const byChainAndImage = new Map<string, AnnotationType[]>();
  for (const annotation of annotations) {
    const chainKey = annotation.objectId ?? annotation.id;
    const key = `${chainKey}\x1f${annotation.imageId}`;
    const group = byChainAndImage.get(key);
    if (group) group.push(annotation);
    else byChainAndImage.set(key, [annotation]);
  }

  const duplicateIds = new Set<string>();
  for (const group of byChainAndImage.values()) {
    if (group.length <= 1) continue;
    for (const annotation of group) duplicateIds.add(annotation.id);
  }
  return duplicateIds;
}

function isOlder(a: ImageAge, b: ImageAge): boolean {
  const at = a.timestamp ?? null;
  const bt = b.timestamp ?? null;
  if (at !== null && bt !== null) {
    if (at !== bt) return at < bt;
  } else {
    return false;
  }
  if (a.originalPath && b.originalPath) {
    return a.originalPath < b.originalPath;
  }
  return false;
}

export function buildChainSplitPlan(
  annotations: AnnotationType[],
  annotationId: string,
  ageOf: (imageId: string) => ImageAge,
): ChainSplitPlan | null {
  const target = annotations.find((a) => a.id === annotationId);
  if (!target) return null;

  const chainKey = target.objectId ?? target.id;
  const chainMembers = annotations.filter(
    (a) => a.objectId === chainKey || a.id === chainKey,
  );
  if (chainMembers.length <= 1) return null;

  const targetAge = ageOf(target.imageId);
  const retained = chainMembers.filter((a) =>
    isOlder(ageOf(a.imageId), targetAge),
  );
  if (retained.length === 0) return null;

  const split = chainMembers.filter(
    (a) => !isOlder(ageOf(a.imageId), targetAge),
  );
  if (split.length === 0 || split.length === chainMembers.length) return null;

  const newRootId = target.id;
  const updates = split
    .filter((a) => a.objectId !== newRootId)
    .map((a) => ({ id: a.id, patch: { objectId: newRootId } }));
  if (updates.length === 0) return null;

  return {
    chainSize: chainMembers.length,
    splitCount: split.length,
    retainedCount: retained.length,
    newRootId,
    updates,
  };
}
