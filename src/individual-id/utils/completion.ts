import type { MatchCandidate, PairCompletionState } from '../types';

// Informational candidates (project outside partner image) are excluded from totals.
export function evaluatePairCompletion(
  candidates: MatchCandidate[],
): PairCompletionState {
  const linkable = candidates.filter((c) => !c.informational);
  if (linkable.length === 0) {
    return { status: 'empty', remaining: 0, total: 0 };
  }
  const remaining = linkable.filter((c) => c.status !== 'accepted').length;
  return {
    status: remaining === 0 ? 'complete' : 'incomplete',
    remaining,
    total: linkable.length,
  };
}

export function completionColor(state: PairCompletionState): string {
  return state.status === 'incomplete' ? '#f1c40f' : '#2ecc71';
}
