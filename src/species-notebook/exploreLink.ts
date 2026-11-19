export type ExploreTarget = {
  projectId: string;
  imageId?: string;
  annotationSetId?: string;
  categoryId?: string;
};

// Returns false when the open Explore page can't show the target.
type ExploreHandler = (target: ExploreTarget) => boolean;

const handlers = new Map<string, ExploreHandler>();

export function registerExplore(projectId: string, handler: ExploreHandler) {
  handlers.set(projectId, handler);
  return () => {
    if (handlers.get(projectId) === handler) handlers.delete(projectId);
  };
}

export function exploreUrl(target: ExploreTarget): string {
  const params = new URLSearchParams();
  if (target.imageId) params.set('image', target.imageId);
  if (target.annotationSetId) params.set('set', target.annotationSetId);
  if (target.categoryId) params.set('label', target.categoryId);
  const query = params.toString();
  return `/surveys/${target.projectId}/review${query ? `?${query}` : ''}`;
}

export function readExploreParams(
  projectId: string,
  search: string,
): ExploreTarget | null {
  const params = new URLSearchParams(search);
  const target: ExploreTarget = {
    projectId,
    imageId: params.get('image') ?? undefined,
    annotationSetId: params.get('set') ?? undefined,
    categoryId: params.get('label') ?? undefined,
  };
  return target.imageId || target.categoryId ? target : null;
}

export function openInNewTab(target: ExploreTarget) {
  window.open(exploreUrl(target), '_blank', 'noopener');
}

// Open a new tab to preserve any active workflow.
export function openInExplore(target: ExploreTarget): 'jumped' | 'tab' {
  if (handlers.get(target.projectId)?.(target)) return 'jumped';
  openInNewTab(target);
  return 'tab';
}
