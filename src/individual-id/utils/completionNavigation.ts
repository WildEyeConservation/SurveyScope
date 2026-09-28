import type { PairCompletionState } from '../types';

export function completionNavigationTarget(
  views: readonly { completion: PairCompletionState }[],
  lanes: readonly { entries: readonly number[] }[],
  activeLane: number,
  currentIndex: number
): { target: number; lane: number; earlier?: number } | undefined {
  const incomplete = (index: number) =>
    index !== currentIndex && views[index]?.completion.status === 'incomplete';
  const laneFor = (index: number) => {
    const lane = lanes.findIndex((item) => item.entries.includes(index));
    return lane >= 0 ? lane : activeLane;
  };
  const target = (index: number, lane: number) => ({
    target: index,
    lane,
    earlier: index < currentIndex ? index : undefined,
  });
  const lane = lanes[activeLane];
  if (lane) {
    const pos = lane.entries.indexOf(currentIndex);
    if (pos !== -1) {
      const earlier = lane.entries.slice(0, pos).find(incomplete);
      if (earlier !== undefined)
        return { target: earlier, lane: activeLane, earlier };
      const later = lane.entries.slice(pos + 1).find(incomplete);
      if (later !== undefined) return { target: later, lane: activeLane };
    }
    const any = lane.entries.find(incomplete);
    if (any !== undefined) return target(any, activeLane);
  }
  for (let index = 0; index < currentIndex; index++) {
    if (incomplete(index)) return target(index, laneFor(index));
  }
  const later = views.findIndex(
    (_, index) => index > currentIndex && incomplete(index)
  );
  if (later !== -1) return { target: later, lane: laneFor(later) };
  const any = views.findIndex((_, index) => incomplete(index));
  if (any !== -1) return target(any, laneFor(any));
  return undefined;
}
