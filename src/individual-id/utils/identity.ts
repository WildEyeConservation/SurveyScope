import {
  adjectives,
  names,
  uniqueNamesGenerator,
} from 'unique-names-generator';
import type { AnnotationType } from '../../schemaTypes';

// Deterministic name seeded by identity key — stable across re-renders, consistent between map and OOV panel.
export function nameFor(identityKey: string): string {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, names],
    seed: identityKey,
    style: 'capital',
    separator: ' ',
  });
}

// Cast works around `oov` not yet appearing in the generated AnnotationType.
export function isOov(
  a: AnnotationType | { oov?: boolean | null } | null | undefined,
): boolean {
  return !!(a as { oov?: boolean | null } | null | undefined)?.oov;
}
