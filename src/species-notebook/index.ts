import type { LabelRef } from './types';

export {
  openInExplore,
  openInNewTab,
  readExploreParams,
  registerExplore,
} from './exploreLink';
export type { ExploreTarget } from './exploreLink';
export { LabelPeek } from './LabelPeek';
export { default as SpeciesNotebook } from './SpeciesNotebook';

type LegendCategory = {
  projectId: string;
  name: string;
  color?: string | null;
};

export function toLabelRef(category: LegendCategory): LabelRef {
  return {
    projectId: category.projectId,
    name: category.name,
    color: category.color,
  };
}
