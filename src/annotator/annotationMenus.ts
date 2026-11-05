import { isMarkedOutside } from '../annotationBoundary';
import type { ExtendedAnnotationType } from '../schemaTypes';
import type { ImageMenuItem } from '../useImageMenuItems';

interface AnnotationMenuOptions {
  annotation: ExtendedAnnotationType;
  readonly: boolean;
  // Only offered on inside images, where marking changes anything.
  canMarkOutside?: boolean;
  onDelete: (annotation: ExtendedAnnotationType) => void;
  onUpdate: (annotation: ExtendedAnnotationType) => void;
  onChangeCategory: (annotation: ExtendedAnnotationType) => void;
}

export function buildAnnotationMenuItems({
  annotation,
  readonly,
  canMarkOutside = false,
  onDelete,
  onUpdate,
  onChangeCategory,
}: AnnotationMenuOptions): ImageMenuItem[] {
  if (readonly) {
    return [{ text: 'Outside location (read-only)', disabled: true }];
  }

  const items: ImageMenuItem[] = [];
  if (!annotation.shadow) {
    items.push({
      text: 'Delete',
      callback: () => onDelete(annotation),
    });
  }
  items.push({
    text: annotation.obscured ? 'Mark as visible' : 'Mark as obscured',
    callback: () =>
      onUpdate({
        ...annotation,
        obscured: !annotation.obscured,
      }),
  });
  if (canMarkOutside) {
    const outside = isMarkedOutside(annotation);
    items.push({
      text: outside ? 'Mark as inside boundary' : 'Mark as outside boundary',
      callback: () =>
        onUpdate({
          ...annotation,
          outsideBoundary: !outside,
        } as ExtendedAnnotationType),
    });
  }
  if (annotation.objectId) {
    items.push({
      text: 'Remove assigned name',
      callback: () =>
        onUpdate({
          ...annotation,
          objectId: undefined,
        }),
    });
  }
  items.push({
    text: 'Change Label',
    callback: () => onChangeCategory(annotation),
  });
  return items;
}

export function buildImageMenuItems(
  baseItems: ImageMenuItem[],
  confidence?: number | null,
): ImageMenuItem[] {
  if (confidence == null) return [...baseItems];
  return [
    {
      text: `Confidence : ${confidence}`,
      disabled: true,
    },
    ...baseItems,
  ];
}
