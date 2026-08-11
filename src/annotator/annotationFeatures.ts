import {
  adjectives,
  names,
  uniqueNamesGenerator,
} from 'unique-names-generator';
import type { ExtendedAnnotationType } from '../schemaTypes';
import { isWithinLocationBounds } from '../utils';
import { formatInfoTagsForDisplay } from '../infoTags';

export interface AnnotationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationFeatureProperties {
  id: string;
  color: string;
  markerKind: 'primary' | 'secondary' | 'shadow';
  borderColor: string;
  borderWidth: number;
  opacity: number;
  active: boolean;
  obscured: boolean;
  readonly: boolean;
  icon: string;
  statusIcon: string;
}

interface BuildAnnotationFeaturesOptions {
  annotations: ExtendedAnnotationType[];
  draggedAnnotationId?: string | null;
  dragPosition?: { x: number; y: number } | null;
  locationBounds?: AnnotationBounds;
  px2lngLat: (x: number, y: number) => [number, number];
  categoryColor: (categoryId: string) => string;
}

export function isFalseNegative(annotation: {
  source?: string | null;
}): boolean {
  return String(annotation.source ?? '')
    .toLowerCase()
    .includes('false-negative');
}

export function annotationObjectName(seed: string): string {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, names],
    seed,
    style: 'capital',
    separator: ' ',
  });
}

export function buildAnnotationFeatureProperties(
  annotation: ExtendedAnnotationType,
  categoryColor: (categoryId: string) => string,
  locationBounds?: AnnotationBounds
): AnnotationFeatureProperties {
  const markerKind = annotation.shadow
    ? 'shadow'
    : annotation.objectId && annotation.objectId !== annotation.id
    ? 'secondary'
    : 'primary';
  const identityKey =
    annotation.objectId ?? annotation.proposedObjectId ?? annotation.id;

  return {
    id: annotation.id,
    color: categoryColor(annotation.categoryId),
    markerKind,
    borderColor: markerKind === 'shadow' ? '#ffffff' : 'rgba(0, 0, 0, 0.7)',
    borderWidth: markerKind === 'shadow' ? 2 : 1,
    opacity: markerKind === 'shadow' ? 0.75 : 1,
    active: Boolean(annotation.selected),
    obscured: Boolean(annotation.obscured),
    readonly: locationBounds
      ? !isWithinLocationBounds(annotation, locationBounds)
      : false,
    icon: isFalseNegative(annotation)
      ? 'fn-marker'
      : markerKind === 'primary'
      ? `identicon-${identityKey}`
      : '',
    statusIcon: annotation.obscured ? 'obscured-marker' : '',
  };
}

export function buildAnnotationFeatureCollection({
  annotations,
  draggedAnnotationId,
  dragPosition,
  locationBounds,
  px2lngLat,
  categoryColor,
}: BuildAnnotationFeaturesOptions): GeoJSON.FeatureCollection<
  GeoJSON.Point,
  AnnotationFeatureProperties
> {
  return {
    type: 'FeatureCollection',
    features: annotations.map((annotation) => {
      const override =
        draggedAnnotationId === annotation.id ? dragPosition : null;
      const x = override?.x ?? annotation.x;
      const y = override?.y ?? annotation.y;
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: px2lngLat(x, y),
        },
        properties: buildAnnotationFeatureProperties(
          annotation,
          categoryColor,
          locationBounds
        ),
      };
    }),
  };
}

export function buildAnnotationPopupLines(
  annotation: ExtendedAnnotationType,
  categoryName: (categoryId: string) => string,
  users: ReadonlyArray<{ id: string; name?: string | null }>,
  infoTags?: string[]
): string[] {
  const lines = [`Label: ${categoryName(annotation.categoryId)}`];
  if (infoTags?.length) {
    lines.push(`Info tags: ${formatInfoTagsForDisplay(infoTags)}`);
  }
  if (isFalseNegative(annotation)) lines.push('False Negative');
  lines.push(
    `Created by: ${
      users.find((user) => user.id === annotation.owner)?.name ?? 'Unknown'
    }`
  );
  if (annotation.createdAt) lines.push(`Created at: ${annotation.createdAt}`);
  if (annotation.objectId) {
    lines.push(`Name: ${annotationObjectName(annotation.objectId)}`);
  } else if (annotation.proposedObjectId) {
    lines.push(
      `Proposed Name: ${annotationObjectName(annotation.proposedObjectId)}`
    );
  }
  return lines;
}
