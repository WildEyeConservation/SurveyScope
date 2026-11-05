import { useCallback, useMemo, useRef, useState } from 'react';
import type { MatchCandidate } from '../types';

type PairKey = string;
type CandidateKey = string;

interface CandidateOverride {
  posA?: { x: number; y: number };
  posB?: { x: number; y: number };
  status?: 'pending' | 'accepted';
  obscuredA?: boolean;
  obscuredB?: boolean;
  rejected?: boolean;
}

function canCarryAcceptedStatus(candidate: MatchCandidate): boolean {
  return (
    !!candidate.realA &&
    !!candidate.realB &&
    !candidate.isShadowA &&
    !candidate.isShadowB
  );
}

export interface PairWorkingState {
  version: number;
  getPairVersion: (pairKey: PairKey) => number;
  mergeCandidates: (
    pairKey: PairKey,
    fresh: MatchCandidate[],
  ) => MatchCandidate[];
  setCandidatePosition: (
    pairKey: PairKey,
    candidateKey: CandidateKey,
    side: 'A' | 'B',
    pos: { x: number; y: number },
  ) => void;
  setCandidateObscured: (
    pairKey: PairKey,
    candidateKey: CandidateKey,
    side: 'A' | 'B',
    value: boolean,
  ) => void;
  acceptCandidate: (pairKey: PairKey, candidateKey: CandidateKey) => void;
  rejectCandidate: (pairKey: PairKey, candidateKey: CandidateKey) => void;
  clearPair: (pairKey: PairKey) => void;
  hasUnsavedWork: (pairKey: PairKey) => boolean;
}

export function makePairKey(imageAId: string, imageBId: string): PairKey {
  return `${imageAId}__${imageBId}`;
}

export function usePairWorkingState(): PairWorkingState {
  // Ref for synchronous reads in callbacks; state for triggering re-renders.
  const storeRef = useRef<Map<PairKey, Map<CandidateKey, CandidateOverride>>>(
    new Map(),
  );
  const pairVersionsRef = useRef<Map<PairKey, number>>(new Map());
  const [version, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);

  const getPair = (pk: PairKey) => {
    let m = storeRef.current.get(pk);
    if (!m) {
      m = new Map();
      storeRef.current.set(pk, m);
    }
    return m;
  };

  const updateCandidate = useCallback(
    (
      pk: PairKey,
      ck: CandidateKey,
      mutator: (prev: CandidateOverride) => CandidateOverride,
    ) => {
      const pair = getPair(pk);
      const prev = pair.get(ck) ?? {};
      pair.set(ck, mutator(prev));
      pairVersionsRef.current.set(
        pk,
        (pairVersionsRef.current.get(pk) ?? 0) + 1,
      );
      rerender();
    },
    [rerender],
  );

  const getPairVersion: PairWorkingState['getPairVersion'] = useCallback(
    (pk) => pairVersionsRef.current.get(pk) ?? 0,
    [],
  );

  const mergeCandidates = useCallback(
    (pk: PairKey, fresh: MatchCandidate[]): MatchCandidate[] => {
      const pair = storeRef.current.get(pk);
      if (!pair || pair.size === 0) return fresh;
      const out: MatchCandidate[] = [];
      for (const c of fresh) {
        const ov = pair.get(c.pairKey);
        if (ov?.rejected) continue;
        if (!ov) {
          out.push(c);
        } else {
          const posA = c.realA && !c.isShadowA ? c.posA : (ov.posA ?? c.posA);
          const posB = c.realB && !c.isShadowB ? c.posB : (ov.posB ?? c.posB);
          const status =
            ov.status === 'accepted' && !canCarryAcceptedStatus(c)
              ? c.status
              : (ov.status ?? c.status);
          out.push({
            ...c,
            posA,
            posB,
            status,
            obscuredA: ov.obscuredA ?? c.obscuredA,
            obscuredB: ov.obscuredB ?? c.obscuredB,
          });
        }
      }
      return out;
    },
    [],
  );

  const setCandidatePosition: PairWorkingState['setCandidatePosition'] =
    useCallback(
      (pk, ck, side, pos) => {
        updateCandidate(pk, ck, (prev) => ({
          ...prev,
          ...(side === 'A' ? { posA: pos } : { posB: pos }),
        }));
      },
      [updateCandidate],
    );

  const setCandidateObscured: PairWorkingState['setCandidateObscured'] =
    useCallback(
      (pk, ck, side, value) => {
        updateCandidate(pk, ck, (prev) => ({
          ...prev,
          ...(side === 'A' ? { obscuredA: value } : { obscuredB: value }),
        }));
      },
      [updateCandidate],
    );

  const acceptCandidate: PairWorkingState['acceptCandidate'] = useCallback(
    (pk, ck) =>
      updateCandidate(pk, ck, (prev) => ({ ...prev, status: 'accepted' })),
    [updateCandidate],
  );

  const rejectCandidate: PairWorkingState['rejectCandidate'] = useCallback(
    (pk, ck) =>
      updateCandidate(pk, ck, (prev) => ({ ...prev, rejected: true })),
    [updateCandidate],
  );

  const clearPair: PairWorkingState['clearPair'] = useCallback(
    (pk) => {
      storeRef.current.delete(pk);
      pairVersionsRef.current.delete(pk);
      rerender();
    },
    [rerender],
  );

  const hasUnsavedWork: PairWorkingState['hasUnsavedWork'] = useCallback(
    (pk) => {
      const pair = storeRef.current.get(pk);
      if (!pair || pair.size === 0) return false;
      for (const ov of pair.values()) {
        if (ov.posA || ov.posB) return true;
        if (ov.obscuredA || ov.obscuredB) return true;
      }
      return false;
    },
    [],
  );

  return useMemo(
    () => ({
      version,
      getPairVersion,
      mergeCandidates,
      setCandidatePosition,
      setCandidateObscured,
      acceptCandidate,
      rejectCandidate,
      clearPair,
      hasUnsavedWork,
    }),
    [
      version,
      getPairVersion,
      mergeCandidates,
      setCandidatePosition,
      setCandidateObscured,
      acceptCandidate,
      rejectCandidate,
      clearPair,
      hasUnsavedWork,
    ],
  );
}
