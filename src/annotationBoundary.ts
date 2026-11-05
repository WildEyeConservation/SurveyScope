import { hasModelField } from './modelFields';

// Frontend changes can precede the master-only backend deployment.
export function canMarkOutsideBoundary(): boolean {
  return hasModelField('Annotation', 'outsideBoundary');
}

export function outsideBoundaryFields<F extends string>(): F[] {
  return canMarkOutsideBoundary() ? ['outsideBoundary' as F] : [];
}

export function isMarkedOutside(annotation: object | null | undefined) {
  return !!(annotation as { outsideBoundary?: boolean | null } | null)
    ?.outsideBoundary;
}
