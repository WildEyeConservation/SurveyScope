import { detectTransectsById } from '../../../amplify/functions/shared/detectTransects';
import {
  isOnEffort,
  type BoundaryStatus,
} from '../../../shared/boundaryStatus';

export const OUTSIDE_GROUP = 'outside-boundary';
const DETECTED_PREFIX = 'detected:';

export type LaunchImage = {
  id: string;
  transectId?: string | null;
  boundaryStatus?: BoundaryStatus | null;
  timestamp?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  cameraId?: string | null;
};

export function groupLaunchImages(images: LaunchImage[]): {
  groups: Map<string, Set<string>>;
  transectsExist: boolean;
} {
  const groups = new Map<string, Set<string>>();
  const add = (group: string, id: string) => {
    let set = groups.get(group);
    if (!set) groups.set(group, (set = new Set()));
    set.add(id);
  };
  const onEffort = images.filter((img) => isOnEffort(img.boundaryStatus));
  for (const img of images) {
    if (!isOnEffort(img.boundaryStatus)) add(OUTSIDE_GROUP, img.id);
  }
  const transectsExist = onEffort.some((img) => img.transectId);
  if (transectsExist) {
    for (const img of onEffort) {
      if (img.transectId) add(img.transectId, img.id);
    }
  } else {
    for (const a of detectTransectsById(onEffort)) {
      add(`${DETECTED_PREFIX}${a.transectIndex}`, a.id);
    }
  }
  return { groups, transectsExist };
}

export type LaunchSelection = {
  incompleteTransectIds?: string[];
  incompleteImageIds?: string[];
  includeOutside: boolean;
};

// Detected groups have no transect ids yet, so send their annotated images.
export function launchSelection(
  incompleteGroups: string[],
  groups: Map<string, Set<string>>,
  annotatedImageIds: string[],
  transectsExist: boolean,
): LaunchSelection {
  const includeOutside = incompleteGroups.includes(OUTSIDE_GROUP);
  const inside = incompleteGroups.filter((g) => g !== OUTSIDE_GROUP);
  if (transectsExist) return { incompleteTransectIds: inside, includeOutside };
  const imageIds = new Set<string>();
  for (const g of inside) {
    for (const id of groups.get(g) ?? []) imageIds.add(id);
  }
  return {
    incompleteImageIds: annotatedImageIds.filter((id) => imageIds.has(id)),
    includeOutside,
  };
}
