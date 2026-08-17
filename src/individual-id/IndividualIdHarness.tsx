import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { GlobalContext, ProjectContext } from '../Context';
import { recordWorkflowTask } from '../recordWorkflowTask';
import type {
  AnnotationType,
  ImageNeighbourType,
  ImageType,
} from '../schemaTypes';
import { useTransectData, type TransectData } from './hooks/useTransectData';
import {
  makePairKey,
  usePairWorkingState,
} from './hooks/usePairWorkingState';
import { buildMatchCandidates } from './utils/munkres';
import { buildNeighbourTransforms } from './utils/transforms';
import { evaluatePairCompletion } from './utils/completion';
import { isOov } from './utils/identity';
import { buildLanes, filterLanesToAttention } from './utils/lanes';
import {
  buildChainSplitPlan,
  findDuplicateSameImageChainAnnotationIds,
  findSameImageAnnotationConflicts,
  type ChainSplitPlan,
} from './utils/chains';
import {
  findReunions,
  type ReunionCandidate,
} from './utils/reunionSearch';
import type {
  MatchCandidate,
  NeighbourPairWithMeta,
  PairCompletionState,
} from './types';
import { IndividualIdMapPair } from './IndividualIdMapPair';
import { ProgressBar } from './components/ProgressBar';
import { LoadingCard } from './components/LoadingCard';
import { NavigateAwayDialog } from './components/NavigateAwayDialog';
import { PairCompleteDialog } from './components/PairCompleteDialog';
import { ReunionDialog } from './components/ReunionDialog';
import { TransectCompleteDialog } from './components/TransectCompleteDialog';
import { LinkAnnotationDialog } from './components/LinkAnnotationDialog';
import { DeleteAnnotationDialog } from './components/DeleteAnnotationDialog';
import { SplitChainDialog } from './components/SplitChainDialog';
import ChangeCategoryModal from '../ChangeCategoryModal';
import type { CategoryType } from '../schemaTypes';

/**
 * BFS hop budget for reunion search. We walk the neighbour graph this far
 * from every chain endpoint at transect-completion time to find images
 * where an out-of-view animal may have reappeared.
 */
const REUNION_MAX_HOPS = 20;

/**
 * Default Munkres "leave unmatched" cost in image pixels. Anything at a
 * projected distance below this gets paired; anything beyond is left as a
 * shadow. 40 px is intentionally tight — wide enough to absorb typical
 * homography drift, narrow enough that two animals lying a body-length
 * apart on the same image won't accidentally claim each other.
 */
const DEFAULT_LENIENCY = 40;

/**
 * Chronological order between two images, ported from the
 * `reconcileHomographies` Lambda so the UI's primary/secondary determination
 * matches the server's. The older image owns the canonical identity (its
 * annotation is the primary); newer images carry secondaries that link to
 * it.
 *
 * Rules:
 *   1. If both images have timestamps and they differ, the smaller one wins.
 *   2. If either timestamp is missing, the comparison is undecided (returns
 *      false in both directions, treating them as same-age).
 *   3. On a timestamp tie, fall back to alphabetic comparison of
 *      `originalPath` so the order is at least deterministic.
 */
/** Group annotations by imageId — used to keep `annotationsByImage` in
 * sync with `annotations` whenever we mutate the transect cache. */
function indexByImage(
  annotations: AnnotationType[]
): Record<string, AnnotationType[]> {
  const out: Record<string, AnnotationType[]> = {};
  for (const a of annotations) (out[a.imageId] ??= []).push(a);
  return out;
}

/**
 * Ids of every annotation in the chain containing `annotationId` (including
 * itself). A "chain" is the set of annotations sharing an objectId — i.e. all
 * sightings of one individual. Used by both delete (scope choice) and
 * change-label (propagation).
 */
function buildChainIdsFor(
  annotations: AnnotationType[],
  annotationId: string
): string[] {
  const ids = new Set<string>([annotationId]);
  const target = annotations.find((a) => a.id === annotationId);
  const chainKey = target?.objectId;
  if (chainKey) {
    for (const a of annotations) {
      if (a.objectId === chainKey || a.id === chainKey) {
        ids.add(a.id);
      }
    }
  }
  return Array.from(ids);
}

function annotationSignature(annotations: AnnotationType[] | undefined): string {
  if (!annotations?.length) return '';
  return annotations
    .map(
      (a) =>
        `${a.id}:${a.categoryId}:${a.x}:${a.y}:${a.objectId ?? ''}:${
          a.obscured ? 1 : 0
        }:${isOov(a) ? 1 : 0}`
    )
    .join('|');
}

function isOlder(
  a: { timestamp?: number | null; originalPath?: string | null },
  b: { timestamp?: number | null; originalPath?: string | null }
): boolean {
  const at = a.timestamp ?? null;
  const bt = b.timestamp ?? null;
  if (at !== null && bt !== null) {
    if (at !== bt) return at < bt;
    // tie: fall through to originalPath
  } else {
    // at least one missing — treat as same-age
    return false;
  }
  if (a.originalPath && b.originalPath) {
    return a.originalPath < b.originalPath;
  }
  return false;
}

/**
 * One participant in an identity link: an existing real annotation, or a
 * shadow position that commitActorLink will materialise as a new row.
 */
type LinkActor = {
  id: string;
  imageId: string;
  existing: AnnotationType | null;
  candidatePos: { x: number; y: number } | null;
  /**
   * Only meaningful for a shadow actor (existing === null): the row created
   * for it is stamped `obscured: true`. Ignored when `existing` is set —
   * real annotations keep their own DB-backed obscured flag.
   */
  obscured?: boolean;
  /**
   * Materialise the new row as an OOV annotation (oov: true, placeholder
   * coords). Used by "Move to OOV" on a shadow whose partner sits on the
   * other side. Ignored when `existing` is set.
   */
  oov?: boolean;
};

/**
 * Top-level "Individual ID" workflow.
 *
 * Receives transectId / categoryId / annotationSetId as props from its parent
 * (IndividualIdTaskPage), which obtains them from the transect-claim lambda.
 *
 * Responsibilities:
 *   - Load all images / neighbours / annotations for the transect (one
 *     category at a time) via useTransectData.
 *   - Pre-compute Munkres candidates for every pair, every render. Merging
 *     with usePairWorkingState preserves the user's drags/locks across
 *     navigation.
 *   - Manage `currentPairIndex`, navigation guards, the progress bar.
 *   - On accept, write the link to the database and invalidate cache.
 *   - When a pair becomes complete, decide whether an earlier pair now needs
 *     attention (because its annotations gained new partners) and prompt the
 *     user accordingly. Never auto-jumps without confirmation.
 *
 * Two components total are exported from this directory: this Harness and
 * IndividualIdMapPair. Everything else is internal to the feature.
 */
export function IndividualIdHarness({
  transectId,
  chainObjectId,
  categoryId,
  annotationSetId,
  jobId,
  leniency: leniencyProp,
  onComplete,
}: {
  /** Provide either `transectId` (normal workflow) or `chainObjectId` (chain-review mode). */
  transectId?: string;
  /** When set, the harness loads only the chain's neighbourhood instead of a transect. */
  chainObjectId?: string;
  categoryId: string;
  annotationSetId?: string;
  /**
   * The IndividualIdJob id, which doubles as the Workflow Run id for
   * statistics. Absent in chain-review mode and for jobs launched before runs
   * were recorded, in which case pair completions are simply not reported.
   */
  jobId?: string;
  leniency?: number;
  // Called when every pair in the transect is complete. The parent
  // (IndividualIdTaskPage) wires this to the transect-complete lambda.
  // Chain-review mode leaves this unset — there's no transect to close.
  onComplete?: () => void;
}) {
  // Leniency is state so the user can adjust it via the toolbar slider; the
  // prop only seeds the initial value.
  const [leniency, setLeniency] = useState<number>(() =>
    typeof leniencyProp === 'number' && leniencyProp >= 0
      ? leniencyProp
      : DEFAULT_LENIENCY
  );

  // Kept in a ref so the Phase-6 completion detector can fire it from an
  // effect without a stale closure.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const { client } = useContext(GlobalContext)!;
  const projectCtx = useContext(ProjectContext);
  const queryClient = useQueryClient();
  const transect = useTransectData({
    transectId,
    chainObjectId,
    categoryId,
    annotationSetId,
  });
  const working = usePairWorkingState();

  /**
   * Mutate the cached `TransectData` for the current transect query so the
   * change survives a reload. We deliberately do NOT invalidate (which
   * would refetch the whole transect — thousands of queries); we just edit
   * the cache in place. The persister picks the new value up on its next
   * debounced save.
   *
   * The predicate matches by query-key prefix so we don't need to know
   * the project/transect/category specifics here.
   */
  const patchTransectCache = useCallback(
    (mutate: (data: TransectData) => TransectData) => {
      queryClient.setQueriesData<TransectData>(
        {
          predicate: (q) =>
            Array.isArray(q.queryKey) &&
            (q.queryKey[0] === 'individual-id-transect' ||
              q.queryKey[0] === 'individual-id-chain'),
        },
        (old) => (old ? mutate(old) : old)
      );
    },
    [queryClient]
  );

  // Local annotations cache: starts as the harness load, then mutates
  // optimistically when the user accepts a match. We refetch from React Query
  // on a debounce afterwards.
  const [localAnnotations, setLocalAnnotations] = useState<AnnotationType[]>(
    []
  );
  useEffect(() => {
    if (transect.data?.annotations)
      setLocalAnnotations(transect.data.annotations);
  }, [transect.data?.annotations]);

  // Index annotations by image for fast Munkres input.
  const annotationsByImage = useMemo(() => {
    const out: Record<string, AnnotationType[]> = {};
    for (const a of localAnnotations) (out[a.imageId] ??= []).push(a);
    return out;
  }, [localAnnotations]);

  const annotationSignaturesByImage = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [imageId, annotations] of Object.entries(annotationsByImage)) {
      out[imageId] = annotationSignature(annotations);
    }
    return out;
  }, [annotationsByImage]);

  // ---- Re-derive transforms from raw neighbours ----
  // Functions cannot survive React Query's localStorage persister, so we
  // rebuild them fresh from `rawNeighbours` on every reload. `directPairs`
  // is ephemeral (not cached) by virtue of being a useMemo result.
  //
  // We also normalise orientation here: imageA is always the chronologically
  // older image (and image1Id its id), imageB always the newer. The progress
  // bar then sorts cleanly by imageA.timestamp ascending, the left map
  // always shows the older photo, and downstream chronological reasoning
  // (handleAccept, etc.) only ever sees A < B. If we'd swap, the homography
  // transforms swap with us — the pre-swap "forward" mapped image1→image2,
  // which becomes "backward" in the new A/B framing.
  //
  // The harness later swaps `directPairs` out for a synthetic reunion-pair
  // set (`pairs = reunionMode?.pairs ?? directPairs`) so the same render
  // tree drives the reunion-review phase.
  const directPairs: NeighbourPairWithMeta[] = useMemo(() => {
    const raw = transect.data?.rawNeighbours ?? [];
    const imagesById = transect.data?.imagesById ?? {};
    const out: NeighbourPairWithMeta[] = [];
    for (const n of raw) {
      const tfs = buildNeighbourTransforms(n);
      if (tfs.noHomography) continue;
      const img1 = imagesById[n.image1Id];
      const img2 = imagesById[n.image2Id];
      if (!img1 || !img2) continue;

      const swap = isOlder(img2, img1);
      const imageA = swap ? img2 : img1;
      const imageB = swap ? img1 : img2;
      const forward = swap ? tfs.backward : tfs.forward;
      const backward = swap ? tfs.forward : tfs.backward;

      out.push({
        image1Id: imageA.id,
        image2Id: imageB.id,
        forward,
        backward,
        noHomography: false,
        skipped: false,
        imageA,
        imageB,
        rawNeighbour: n,
      });
    }
    out.sort((p, q) => {
      const at = p.imageA.timestamp ?? 0;
      const bt = q.imageA.timestamp ?? 0;
      if (at !== bt) return at - bt;
      return (p.imageB.timestamp ?? 0) - (q.imageB.timestamp ?? 0);
    });
    return out;
  }, [transect.data?.rawNeighbours, transect.data?.imagesById]);

  // ---- Reunion-review phase ----
  // When every direct pair is complete, `findReunions` walks each chain
  // endpoint's neighbourhood and surfaces any image pairs (hops >= 2)
  // where the animal may have come back into view. The user is then
  // forced through those synthetic pairs before the transect completes;
  // when they finish a round, we search again (chains may have merged
  // and exposed new endpoints). `reviewedReunionsRef` records, per image
  // pair, the pending candidate keys that were on screen when the user
  // confirmed the dialog — a pair only re-surfaces in a later round when
  // merges have produced pendings the user has NOT seen, so unchanged
  // pairs can't loop but new possible links still come back for review.
  const [reunionMode, setReunionMode] = useState<{
    pairs: NeighbourPairWithMeta[];
  } | null>(null);
  const [pendingReunionDialog, setPendingReunionDialog] = useState<{
    pairs: NeighbourPairWithMeta[];
    /** reviewKey (imageA|imageB) → pending candidate keys shown this round. */
    pendingKeysByPair: Map<string, Set<string>>;
  } | null>(null);
  // Final "you're done" gate — set when the completion detector decides
  // the transect is closed. Confirmation fires `onComplete`; the parent
  // navigates the user back to Jobs.
  const [showTransectComplete, setShowTransectComplete] = useState(false);
  const reviewedReunionsRef = useRef<Map<string, Set<string>>>(new Map());

  // Fabricate a `NeighbourPairWithMeta` from a `ReunionCandidate`. There's
  // no DB `ImageNeighbour` row backing a synthetic pair, but nothing
  // downstream of `pairs` actually reads `rawNeighbour`, so a typed stub
  // is enough to satisfy the interface. The composed forward/backward
  // already maps imageA (older) → imageB (newer) in pixel space because
  // `findReunions` normalised orientation when it produced the candidate.
  const synthesiseReunionPair = useCallback(
    (
      c: ReunionCandidate,
      imagesById: Record<string, ImageType>
    ): NeighbourPairWithMeta | null => {
      const imageA = imagesById[c.imageAId];
      const imageB = imagesById[c.imageBId];
      if (!imageA || !imageB) return null;
      return {
        image1Id: c.imageAId,
        image2Id: c.imageBId,
        forward: c.forward,
        backward: c.backward,
        noHomography: false,
        skipped: false,
        imageA,
        imageB,
        rawNeighbour: {
          id: `reunion:${c.imageAId}|${c.imageBId}`,
          image1Id: c.imageAId,
          image2Id: c.imageBId,
        } as unknown as ImageNeighbourType,
      };
    },
    []
  );

  // Chain-review mode: continuously recompute reunion candidates from the
  // live annotation state and append them to the direct pairs. Unlike the
  // transect path, we don't gate on "all direct pairs complete" or use a
  // pending dialog — the user sees direct + synthetic in one unified pair
  // list from the first render. As they place new annotations the
  // `findReunions` BFS re-runs (via this memo's deps), so newly-exposed
  // chain endpoints surface their own synthetic pairs without needing a
  // round-completion event.
  const chainSyntheticPairs: NeighbourPairWithMeta[] = useMemo(() => {
    if (!chainObjectId) return [];
    const imagesById = transect.data?.imagesById ?? {};
    if (!Object.keys(imagesById).length) return [];
    const candidates = findReunions({
      annotations: localAnnotations,
      rawNeighbours: transect.data?.rawNeighbours ?? [],
      imagesById,
      categoryId: categoryId ?? '',
      leniency,
      maxHops: REUNION_MAX_HOPS,
    });
    return candidates
      .map((c) => synthesiseReunionPair(c, imagesById))
      .filter((p): p is NeighbourPairWithMeta => p !== null);
  }, [
    chainObjectId,
    transect.data?.imagesById,
    transect.data?.rawNeighbours,
    localAnnotations,
    categoryId,
    leniency,
    synthesiseReunionPair,
  ]);

  // Active pair set:
  //   - Chain mode → direct pairs + synthetic pairs from the start, no
  //     phase transition. The synthetic list recomputes continuously.
  //   - Transect mode → reunion pairs when reviewing reunions, otherwise
  //     the direct neighbours. Same phased behaviour as before.
  // Memoised so the reference is stable across renders — `pairViews` /
  // `lanes` / `currentPair` consumers downstream all key off this one
  // value.
  const pairs: NeighbourPairWithMeta[] = useMemo(
    () =>
      chainObjectId
        ? [...directPairs, ...chainSyntheticPairs]
        : reunionMode?.pairs ?? directPairs,
    [chainObjectId, directPairs, chainSyntheticPairs, reunionMode]
  );

  // ---- Build all pair-candidate lists in display order ----
  type PairView = {
    candidates: MatchCandidate[];
    completion: PairCompletionState;
    pairKeyStr: string;
  };
  type PairViewCacheEntry = {
    cacheKey: string;
    pair: NeighbourPairWithMeta;
    view: PairView;
  };
  const pairViewCacheRef = useRef<Map<string, PairViewCacheEntry>>(new Map());

  const pairViews: PairView[] = useMemo(() => {
    const cache = pairViewCacheRef.current;
    const livePairKeys = new Set<string>();
    const views = pairs.map((p) => {
      const pairKey = makePairKey(p.image1Id, p.image2Id);
      livePairKeys.add(pairKey);
      const cacheKey = [
        pairKey,
        leniency,
        categoryId ?? '',
        annotationSignaturesByImage[p.image1Id] ?? '',
        annotationSignaturesByImage[p.image2Id] ?? '',
        working.getPairVersion(pairKey),
      ].join('\x1f');
      const cached = cache.get(pairKey);
      if (cached?.cacheKey === cacheKey && cached.pair === p) {
        return cached.view;
      }
      const fresh = buildMatchCandidates({
        annotationsA: annotationsByImage[p.image1Id] ?? [],
        annotationsB: annotationsByImage[p.image2Id] ?? [],
        imageA: p.imageA,
        imageB: p.imageB,
        forward: p.forward,
        backward: p.backward,
        leniency,
        categoryFilter: categoryId,
      });
      const merged = working.mergeCandidates(pairKey, fresh);
      const view = {
        candidates: merged,
        completion: evaluatePairCompletion(merged),
        pairKeyStr: pairKey,
      };
      cache.set(pairKey, { cacheKey, pair: p, view });
      return view;
    });
    for (const pairKey of cache.keys()) {
      if (!livePairKeys.has(pairKey)) cache.delete(pairKey);
    }
    return views;
    // `working` changes on every override mutation so this memo recomputes,
    // while the cache only rebuilds the pair whose per-pair version changed.
  }, [
    pairs,
    annotationsByImage,
    annotationSignaturesByImage,
    leniency,
    categoryId,
    working,
  ]);

  // ---- Progress-bar rows ----
  // Pure presentation grouping over the flat `pairs` array: one row per
  // camera, plus a dedicated overlap row for cross-camera pairs between two
  // cameras. Single camera with no overlaps → one row.
  const lanes = useMemo(
    () => buildLanes(pairs, transect.data?.cameraNamesById ?? {}),
    [pairs, transect.data?.cameraNamesById]
  );

  // ---- Current pair index + navigation guards ----
  const [currentIndex, setCurrentIndex] = useState(0);
  // Which lane the prev/next arrows are walking. A cross-camera pair lives
  // in two lanes; this records which one the user is navigating so "next"
  // stays on the expected camera instead of jumping rigs.
  const [activeLane, setActiveLane] = useState(0);

  // "Simple view" (default on): collapse each lane to just the pairs that
  // still need attention plus their 3 nearest neighbours, hiding the long
  // runs of done pairs. The active pair is always kept so its marker stays
  // visible. Everything downstream (render + lane-relative nav) runs off
  // `visibleLanes`, so simple view transparently restricts navigation too.
  const [simpleView, setSimpleView] = useState(true);
  // Collapses the bottom chrome: the toolbar's secondary info and the whole
  // progress bar, leaving just the clean top div.
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const visibleLanes = useMemo(() => {
    if (!simpleView) return lanes;
    const states = pairViews.map((v) => v.completion);
    return filterLanesToAttention(lanes, states, currentIndex, 3);
  }, [simpleView, lanes, pairViews, currentIndex]);
  // After the first load, skip to the first incomplete (yellow) pair.
  //
  // We deliberately wait for the annotations sync to finish before
  // locking in the initial index. There's a brief window where
  // `transect.data` has resolved (so `pairViews` has length) but
  // `localAnnotations` is still empty (the sync effect hasn't fired yet).
  // In that window every pair's completion shows as `empty`, `findIndex`
  // returns -1, and we'd fall back to pair 0 forever — even though there
  // are clearly yellow pairs once annotations propagate.
  const initialisedRef = useRef(false);
  useEffect(() => {
    if (initialisedRef.current) return;
    if (!pairViews.length) return;
    const tAnns = transect.data?.annotations;
    // Wait one render if the transect has annotations but they haven't
    // been mirrored into `localAnnotations` yet — pairViews would be
    // computed against zero annotations and lock us onto pair 0.
    if (tAnns && tAnns.length > 0 && localAnnotations.length === 0) return;
    initialisedRef.current = true;
    const firstIncomplete = pairViews.findIndex(
      (v) => v.completion.status === 'incomplete'
    );
    setCurrentIndex(Math.max(0, firstIncomplete));
  }, [pairViews, transect.data?.annotations, localAnnotations.length]);

  // When no pair is 'incomplete' anymore we either enter reunion review
  // or fire `onComplete` (the parent marks the transect complete server-
  // side and returns to Jobs). Fixpoint loop: after every reunion round
  // the user finishes we re-run `findReunions`; chain merges may have
  // exposed new endpoints, surfacing more pairs to review. Only when a
  // round produces zero *unseen* candidates does the transect finish.
  //
  // Gated on `initialisedRef` so the brief pre-annotation-sync window
  // (every pair momentarily 'empty') cannot false-fire.
  const completionFiredRef = useRef(false);
  useEffect(() => {
    // Chain-review mode has no completion phase: synthetic pairs are
    // already inlined into `pairs`, there's no transect to close, and
    // the user just leaves when satisfied. Skip the entire detector.
    if (chainObjectId) return;
    if (completionFiredRef.current) return;
    if (!initialisedRef.current) return;
    if (transect.isLoading) return;
    if (pendingReunionDialog) return;
    if (pairViews.length === 0) {
      // In reunion mode this means every synthetic pair failed to
      // synthesise (no matching images) — degenerate; finish.
      if (reunionMode) {
        completionFiredRef.current = true;
        setShowTransectComplete(true);
      }
      return;
    }
    const anyIncomplete = pairViews.some(
      (v) => v.completion.status === 'incomplete'
    );
    if (anyIncomplete) return;

    const imagesById = transect.data?.imagesById ?? {};
    const candidates = findReunions({
      annotations: localAnnotations,
      rawNeighbours: transect.data?.rawNeighbours ?? [],
      imagesById,
      categoryId: categoryId ?? '',
      leniency,
      maxHops: REUNION_MAX_HOPS,
    });
    // `findReunions` only checks "is there a cross-chain annotation near
    // the endpoint projection?" — but the full Munkres assignment on the
    // synthetic pair can still come out all-accepted (a same-objectId
    // annotation outbidding the cross-chain one) or all-informational.
    // Pre-run Munkres so the dialog count is what the user will actually
    // have to action.
    //
    // Already-reviewed pairs are skipped by PENDING-CANDIDATE comparison,
    // not by image pair: a round's chain merges can mint brand-new pending
    // candidates on a pair the user already walked through, and those must
    // come back for review. (Merges also rewrite objectIds, which are part
    // of candidate keys, so a merge touching a reviewed pair makes its
    // pendings look new and re-surfaces it — conservative in the right
    // direction, since the merge changed the context of the decision.)
    const actionable: NeighbourPairWithMeta[] = [];
    const pendingKeysByPair = new Map<string, Set<string>>();
    for (const c of candidates) {
      const p = synthesiseReunionPair(c, imagesById);
      if (!p) continue;
      const pairKey = makePairKey(p.image1Id, p.image2Id);
      const built = buildMatchCandidates({
        annotationsA: annotationsByImage[p.image1Id] ?? [],
        annotationsB: annotationsByImage[p.image2Id] ?? [],
        imageA: p.imageA,
        imageB: p.imageB,
        forward: p.forward,
        backward: p.backward,
        leniency,
        categoryFilter: categoryId,
      });
      const merged = working.mergeCandidates(pairKey, built);
      if (evaluatePairCompletion(merged).status !== 'incomplete') continue;
      const pending = new Set(
        merged
          .filter((m) => !m.informational && m.status !== 'accepted')
          .map((m) => m.pairKey)
      );
      const reviewKey = `${p.image1Id}|${p.image2Id}`;
      const seen = reviewedReunionsRef.current.get(reviewKey);
      if (seen) {
        let hasNew = false;
        for (const k of pending) {
          if (!seen.has(k)) {
            hasNew = true;
            break;
          }
        }
        if (!hasNew) continue;
      }
      actionable.push(p);
      pendingKeysByPair.set(reviewKey, pending);
    }

    if (actionable.length === 0) {
      completionFiredRef.current = true;
      setShowTransectComplete(true);
      return;
    }
    setPendingReunionDialog({ pairs: actionable, pendingKeysByPair });
  }, [
    chainObjectId,
    pairViews,
    transect.isLoading,
    transect.data?.imagesById,
    transect.data?.rawNeighbours,
    localAnnotations,
    annotationsByImage,
    categoryId,
    leniency,
    reunionMode,
    pendingReunionDialog,
    synthesiseReunionPair,
    working,
  ]);

  // The reunion dialog has no skip button — confirmation always enters
  // review mode. The pending candidate keys shown for each pair are
  // stamped into `reviewedReunionsRef` here (unioned with any earlier
  // round's), so a pair the user saw and left untouched is never re-shown,
  // while later merges that mint unseen pendings on it re-surface it.
  const confirmReunionDialog = useCallback(() => {
    if (!pendingReunionDialog) return;
    for (const p of pendingReunionDialog.pairs) {
      const reviewKey = `${p.image1Id}|${p.image2Id}`;
      const pending = pendingReunionDialog.pendingKeysByPair.get(reviewKey);
      if (!pending) continue;
      const seen = reviewedReunionsRef.current.get(reviewKey);
      if (seen) {
        for (const k of pending) seen.add(k);
      } else {
        reviewedReunionsRef.current.set(reviewKey, new Set(pending));
      }
    }
    setReunionMode({ pairs: pendingReunionDialog.pairs });
    setPendingReunionDialog(null);
    setCurrentIndex(0);
    setActiveLane(0);
  }, [pendingReunionDialog]);

  // Keep `activeLane` pointing at a lane that actually contains the current
  // pair. The pair-complete popups move `currentIndex` directly with no lane
  // context; snap to a lane containing it so the arrows keep working.
  useEffect(() => {
    if (!visibleLanes.length) return;
    if (visibleLanes[activeLane]?.entries.includes(currentIndex)) return;
    const li = visibleLanes.findIndex((l) =>
      l.entries.includes(currentIndex)
    );
    setActiveLane(li >= 0 ? li : 0);
  }, [currentIndex, visibleLanes, activeLane]);

  const [navAway, setNavAway] = useState<{
    show: boolean;
    target: number;
    direction: 'prev' | 'next' | 'jump';
    lane: number;
  }>({ show: false, target: 0, direction: 'jump', lane: 0 });

  const requestPair = useCallback(
    (target: number, direction: 'prev' | 'next' | 'jump', lane: number) => {
      if (target < 0 || target >= pairViews.length) return;
      if (target === currentIndex) {
        // Same pair, clicked in a different lane — just refocus that lane.
        setActiveLane(lane);
        return;
      }
      const here = pairViews[currentIndex];
      const stillHasWork =
        here && here.completion.status === 'incomplete';
      if (stillHasWork) {
        setNavAway({ show: true, target, direction, lane });
      } else {
        setCurrentIndex(target);
        setActiveLane(lane);
      }
    },
    [pairViews, currentIndex]
  );

  // Prev/next arrows walk the active lane's entries, not the global flat
  // order — so navigation stays on one camera.
  const laneNav = useCallback(
    (delta: 1 | -1) => {
      const lane = visibleLanes[activeLane];
      if (!lane) return;
      const pos = lane.entries.indexOf(currentIndex);
      if (pos === -1) return;
      const next = pos + delta;
      if (next < 0 || next >= lane.entries.length) return;
      requestPair(
        lane.entries[next],
        delta === 1 ? 'next' : 'prev',
        activeLane
      );
    },
    [visibleLanes, activeLane, currentIndex, requestPair]
  );

  const confirmNavAway = () => {
    setCurrentIndex(navAway.target);
    setActiveLane(navAway.lane);
    setNavAway({ ...navAway, show: false });
  };
  const cancelNavAway = () => setNavAway({ ...navAway, show: false });

  // ---- Pair-complete popup logic ----
  const [completePopup, setCompletePopup] = useState<{
    show: boolean;
    earlier?: number;
    target?: number;
    lane?: number;
  }>({ show: false });

  const laneContainingPair = useCallback(
    (pairIndex: number) => {
      const laneIndex = lanes.findIndex((l) => l.entries.includes(pairIndex));
      return laneIndex >= 0 ? laneIndex : activeLane;
    },
    [lanes, activeLane]
  );

  const completeNavigationTarget = useMemo(() => {
    const incomplete = (idx: number) =>
      idx !== currentIndex &&
      pairViews[idx]?.completion.status === 'incomplete';

    const lane = lanes[activeLane];
    if (lane) {
      const pos = lane.entries.indexOf(currentIndex);
      if (pos !== -1) {
        const earlierInLane = lane.entries
          .slice(0, pos)
          .find((idx) => incomplete(idx));
        if (earlierInLane !== undefined) {
          return {
            target: earlierInLane,
            lane: activeLane,
            earlier: earlierInLane,
          };
        }

        const laterInLane = lane.entries
          .slice(pos + 1)
          .find((idx) => incomplete(idx));
        if (laterInLane !== undefined) {
          return { target: laterInLane, lane: activeLane };
        }
      }

      const anyInLane = lane.entries.find((idx) => incomplete(idx));
      if (anyInLane !== undefined) {
        return {
          target: anyInLane,
          lane: activeLane,
          earlier: anyInLane < currentIndex ? anyInLane : undefined,
        };
      }
    }

    for (let i = 0; i < currentIndex; i++) {
      if (incomplete(i)) {
        return { target: i, lane: laneContainingPair(i), earlier: i };
      }
    }

    const nextGlobal = pairViews.findIndex(
      (_, i) => i > currentIndex && incomplete(i)
    );
    if (nextGlobal !== -1) {
      return { target: nextGlobal, lane: laneContainingPair(nextGlobal) };
    }

    const anyGlobal = pairViews.findIndex((_, i) => incomplete(i));
    if (anyGlobal !== -1) {
      return {
        target: anyGlobal,
        lane: laneContainingPair(anyGlobal),
        earlier: anyGlobal < currentIndex ? anyGlobal : undefined,
      };
    }

    return undefined;
  }, [activeLane, currentIndex, lanes, laneContainingPair, pairViews]);

  // ---- Statistics bookkeeping ----
  // Refs rather than state: these are read from callbacks declared before the
  // current-pair values exist, and must never cause a re-render of the pair.
  const currentPairKeyRef = useRef<string | undefined>(undefined);
  const linksByPairRef = useRef<Map<string, number>>(new Map());
  const reportedPairsRef = useRef<Set<string>>(new Set());

  const reportPairCompleted = useCallback(() => {
    const pairKey = currentPairKeyRef.current;
    // Chain-review mode and jobs launched before runs existed have no run to
    // attribute the work to.
    if (!jobId || !pairKey) return;
    // The completion callback can fire again if the user re-opens a finished
    // pair; the pair is one unit however many times it is visited.
    if (reportedPairsRef.current.has(pairKey)) return;
    reportedPairsRef.current.add(pairKey);

    void recordWorkflowTask(client, {
      workflowRunId: jobId,
      workItemType: 'image-pair',
      workItemId: pairKey,
      outcome: 'linked',
      idempotencyKey: `pair:${pairKey}`,
      metrics: {
        annotationsLinked: linksByPairRef.current.get(pairKey) ?? 0,
      },
    });
  }, [client, jobId]);

  const handleAllAccepted = useCallback(() => {
    // Recorded before the navigation guard below, so the last pair of a
    // transect counts like any other.
    reportPairCompleted();

    // Suppress the "Stay / Next pair" popup when no other pair in the
    // active set is still incomplete. There's nothing to navigate to —
    // and the completion effect will take over (open ReunionDialog or
    // fire onComplete) on the next render. Without this guard the stale
    // popup stacks on top of ReunionDialog, since onComplete no longer
    // navigates away immediately.
    if (!completeNavigationTarget) return;
    setCompletePopup({
      show: true,
      target: completeNavigationTarget.target,
      lane: completeNavigationTarget.lane,
      earlier: completeNavigationTarget.earlier,
    });
  }, [completeNavigationTarget, reportPairCompleted]);

  const acceptCompletePopup = () => {
    if (completePopup.target !== undefined) {
      setCurrentIndex(completePopup.target);
      setActiveLane(
        completePopup.lane ?? laneContainingPair(completePopup.target)
      );
    }
    setCompletePopup({ show: false });
  };

  // ---- The map-pair callbacks ----
  const currentPair = pairs[currentIndex];
  const currentView = pairViews[currentIndex];
  const currentPairKey = currentView?.pairKeyStr;
  // Assigned during render, not in an effect: child effects run before the
  // parent's, so an effect here could still hold the previous pair when the
  // completion callback fires.
  currentPairKeyRef.current = currentPairKey;

  // Persist a dragged real annotation's new position straight to the DB
  // (optimistic local + cache update, rolled back on failure).
  const persistAnnotationPosition = useCallback(
    async (annotationId: string, pos: { x: number; y: number }) => {
      const current = localAnnotations.find((a) => a.id === annotationId);
      if (!current) return;
      const x = Math.round(pos.x);
      const y = Math.round(pos.y);
      if (current.x === x && current.y === y) return;

      const apply = (a: AnnotationType): AnnotationType =>
        a.id === annotationId ? { ...a, x, y } : a;
      const revert = (a: AnnotationType): AnnotationType =>
        a.id === annotationId ? { ...a, x: current.x, y: current.y } : a;

      setLocalAnnotations((prev) => prev.map(apply));
      patchTransectCache((old) => {
        const annotations = old.annotations.map(apply);
        return {
          ...old,
          annotations,
          annotationsByImage: indexByImage(annotations),
        };
      });

      try {
        await client.models.Annotation.update({
          id: annotationId,
          x,
          y,
        } as any);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to update annotation position', err);
        setLocalAnnotations((prev) => prev.map(revert));
        patchTransectCache((old) => {
          const annotations = old.annotations.map(revert);
          return {
            ...old,
            annotations,
            annotationsByImage: indexByImage(annotations),
          };
        });
      }
    },
    [localAnnotations, client, patchTransectCache]
  );

  const handleDrag = useCallback(
    (
      candidateKey: string,
      side: 'A' | 'B',
      pos: { x: number; y: number }
    ) => {
      if (!currentPairKey) return;
      const candidate = currentView?.candidates.find(
        (c) => c.pairKey === candidateKey
      );
      if (!candidate) {
        // Informational (other-category) marker — keyed by annotation id.
        persistAnnotationPosition(candidateKey, pos);
        return;
      }
      // A real annotation persists its new x/y immediately; a shadow /
      // proposed marker keeps its drag in working state until accept.
      const real = side === 'A' ? candidate.realA : candidate.realB;
      if (real) {
        persistAnnotationPosition(real.id, pos);
      } else {
        working.setCandidatePosition(currentPairKey, candidateKey, side, pos);
      }
    },
    [working, currentPairKey, currentView, persistAnnotationPosition]
  );

  /**
   * User clicked empty map area to place a brand-new annotation. We create
   * the row in the DB immediately (optimistic local update first) so Munkres
   * sees it on the next render and proposes a partner shadow on the other
   * side. The pair component pre-generates `newId` so it can also set the
   * resulting candidate as active without waiting for the round-trip.
   */
  const handlePlaceNew = useCallback(
    async (
      side: 'A' | 'B',
      pos: { x: number; y: number },
      newId: string
    ) => {
      if (!currentPair || !categoryId) return;
      const setId =
        transect.data?.category?.annotationSetId ?? annotationSetId ?? '';
      if (!setId) return;
      const group = (projectCtx?.project as any)?.organizationId ?? undefined;
      const nowIso = new Date().toISOString();
      const imageId =
        side === 'A' ? currentPair.image1Id : currentPair.image2Id;
      // Fields that go to the DB. Amplify auto-manages createdAt/updatedAt
      // and owner — they are NOT part of CreateAnnotationInput.
      const dbInput = {
        id: newId,
        imageId,
        setId,
        categoryId,
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        source: 'individual-id',
        projectId: projectCtx?.project?.id,
        group,
      };
      // Local cache still wants the fuller AnnotationType shape so Munkres
      // and downstream components have everything they expect.
      const localRow = {
        ...dbInput,
        createdAt: nowIso,
        updatedAt: nowIso,
      } as unknown as AnnotationType;

      // Optimistic local merge — Munkres will pick it up next render.
      setLocalAnnotations((prev) => [...prev, localRow]);
      // Persist the new row in the cached transect data too — otherwise it
      // would be missing on reload.
      patchTransectCache((old) => {
        const annotations = [...old.annotations, localRow];
        return {
          ...old,
          annotations,
          annotationsByImage: indexByImage(annotations),
        };
      });

      try {
        await client.models.Annotation.create(dbInput as any);
      } catch (err) {
        // Roll back the optimistic insert on failure.
        // eslint-disable-next-line no-console
        console.error('Failed to create annotation', err);
        setLocalAnnotations((prev) => prev.filter((a) => a.id !== newId));
        patchTransectCache((old) => {
          const annotations = old.annotations.filter((a) => a.id !== newId);
          return {
            ...old,
            annotations,
            annotationsByImage: indexByImage(annotations),
          };
        });
      }
    },
    [
      currentPair,
      categoryId,
      transect.data?.category?.annotationSetId,
      annotationSetId,
      projectCtx?.project?.id,
      projectCtx?.project,
      client,
      patchTransectCache,
    ]
  );

  // Deferred until the user confirms scope. null means no dialog open.
  const [deleteRequest, setDeleteRequest] = useState<{
    annotationId: string;
    chainIds: string[];
  } | null>(null);
  const [splitRequest, setSplitRequest] = useState<{
    annotationId: string;
    plan: ChainSplitPlan;
  } | null>(null);

  /**
   * Performs the actual annotation deletion. Optimistic local + cache
   * update, rolled back on DB failure. Accepts either a single id (the
   * regular path or "Delete this one" from the chain dialog) or a list of
   * ids (the chain-wide path from the same dialog).
   *
   * OOV re-rooting (chronologically splitting the chain at the deleted OOV)
   * only applies to single-row deletes — a chain-wide delete by definition
   * leaves nothing to re-root onto.
   */
  const executeDelete = useCallback(
    async (ids: string[], scope: 'single' | 'chain') => {
      if (ids.length === 0) return;
      const before = localAnnotations;
      const idSet = new Set(ids);

      const reRootUpdates: Array<{
        id: string;
        patch: Partial<AnnotationType>;
      }> = [];
      if (scope === 'single' && ids.length === 1) {
        const annotationId = ids[0];
        const target = localAnnotations.find((a) => a.id === annotationId);
        if (target && isOov(target)) {
          // OOV deletion: the OOV is almost always a secondary bridging the
          // chain across an image where the animal isn't visible. Deleting
          // it should un-bridge — annotations OLDER than the OOV keep their
          // existing identity, while annotations NEWER than the OOV form
          // their own chain rooted at the chronologically nearest survivor.
          // The older and newer segments end up independent, exactly as if
          // the OOV had never been inserted.
          const chainKey = target.objectId ?? target.id;
          const chainMembers = localAnnotations.filter(
            (a) =>
              a.id !== annotationId &&
              (a.objectId === chainKey || a.id === chainKey)
          );
          const imagesById = transect.data?.imagesById ?? {};
          const ageOf = (imageId: string) => {
            const img: any = imagesById[imageId];
            return {
              timestamp: (img?.timestamp ?? null) as number | null,
              originalPath: (img?.originalPath ?? null) as string | null,
            };
          };
          const oovAge = ageOf(target.imageId);
          const newer = chainMembers.filter((a) =>
            isOlder(oovAge, ageOf(a.imageId))
          );
          if (newer.length > 0) {
            let nearest = newer[0];
            for (let i = 1; i < newer.length; i++) {
              if (isOlder(ageOf(newer[i].imageId), ageOf(nearest.imageId))) {
                nearest = newer[i];
              }
            }
            for (const a of newer) {
              if (a.objectId !== nearest.id) {
                reRootUpdates.push({
                  id: a.id,
                  patch: { objectId: nearest.id },
                });
              }
            }
          }
        }
      }

      const applyDeleteAndReRoot = (
        prev: AnnotationType[]
      ): AnnotationType[] => {
        let next = prev.filter((a) => !idSet.has(a.id));
        if (reRootUpdates.length > 0) {
          const patchById = new Map(
            reRootUpdates.map((u) => [u.id, u.patch])
          );
          next = next.map((a) =>
            patchById.has(a.id) ? { ...a, ...patchById.get(a.id)! } : a
          );
        }
        return next;
      };

      setLocalAnnotations(applyDeleteAndReRoot);
      patchTransectCache((old) => {
        const annotations = applyDeleteAndReRoot(old.annotations);
        return {
          ...old,
          annotations,
          annotationsByImage: indexByImage(annotations),
        };
      });

      try {
        const results: any[] = await Promise.all(
          ids.map((id) =>
            client.models.Annotation.delete({ id } as any)
          )
        );
        await Promise.all(
          reRootUpdates.map((u) =>
            client.models.Annotation.update({
              id: u.id,
              ...u.patch,
            } as any)
          )
        );
        // AppSync returns `data: null` (with no errors) when an owner/group
        // auth filter blocks the mutation. Surface so we notice.
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result && result.data == null && !result.errors?.length) {
            // eslint-disable-next-line no-console
            console.warn(
              'Annotation.delete returned null — likely an authorization issue (you may not own this row).',
              { id: ids[i] }
            );
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to delete annotation(s)', err);
        setLocalAnnotations(before);
        patchTransectCache((old) => ({
          ...old,
          annotations: before,
          annotationsByImage: indexByImage(before),
        }));
      }
    },
    [client, localAnnotations, patchTransectCache, transect.data?.imagesById]
  );

  /**
   * Entry point from the marker popup's Delete button. If the annotation is
   * linked to other sightings of the same individual we open a dialog to
   * let the user choose scope (this one vs entire chain); a solo annotation
   * deletes immediately with no confirmation.
   */
  const handleDelete = useCallback(
    (annotationId: string) => {
      const chainIds = buildChainIdsFor(localAnnotations, annotationId);
      if (chainIds.length <= 1) {
        void executeDelete([annotationId], 'single');
      } else {
        setDeleteRequest({ annotationId, chainIds });
      }
    },
    [localAnnotations, executeDelete]
  );

  const confirmDeleteScope = (scope: 'single' | 'chain') => {
    if (!deleteRequest) return;
    const ids =
      scope === 'single' ? [deleteRequest.annotationId] : deleteRequest.chainIds;
    void executeDelete(ids, scope);
    setDeleteRequest(null);
  };

  const buildSplitPlan = useCallback(
    (annotationId: string) => {
      const imagesById = transect.data?.imagesById ?? {};
      return buildChainSplitPlan(localAnnotations, annotationId, (imageId) => {
        const img: any = imagesById[imageId];
        return {
          timestamp: (img?.timestamp ?? null) as number | null,
          originalPath: (img?.originalPath ?? null) as string | null,
        };
      });
    },
    [localAnnotations, transect.data?.imagesById]
  );

  const canSplitChain = useCallback(
    (annotationId: string) => buildSplitPlan(annotationId) !== null,
    [buildSplitPlan]
  );

  const handleSplitChain = useCallback(
    (annotationId: string) => {
      const plan = buildSplitPlan(annotationId);
      if (!plan) return;
      setSplitRequest({ annotationId, plan });
    },
    [buildSplitPlan]
  );

  const executeSplitChain = useCallback(
    async (annotationId: string) => {
      const plan = buildSplitPlan(annotationId);
      if (!plan) return;

      const before = localAnnotations;
      const patchById = new Map(plan.updates.map((u) => [u.id, u.patch]));
      const applySplit = (prev: AnnotationType[]): AnnotationType[] =>
        prev.map((a) =>
          patchById.has(a.id) ? { ...a, ...patchById.get(a.id)! } : a
        );

      setLocalAnnotations(applySplit);
      patchTransectCache((old) => {
        const annotations = applySplit(old.annotations);
        return {
          ...old,
          annotations,
          annotationsByImage: indexByImage(annotations),
        };
      });

      try {
        await Promise.all(
          plan.updates.map((u) =>
            client.models.Annotation.update({ id: u.id, ...u.patch } as any)
          )
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to split individual-id chain', err);
        setLocalAnnotations(before);
        patchTransectCache((old) => ({
          ...old,
          annotations: before,
          annotationsByImage: indexByImage(before),
        }));
      }
    },
    [buildSplitPlan, client, localAnnotations, patchTransectCache]
  );

  const confirmSplitChain = () => {
    if (!splitRequest) return;
    void executeSplitChain(splitRequest.annotationId);
    setSplitRequest(null);
  };

  /**
   * User clicked "Mark as obscured" / "Mark as visible" in a marker's popup.
   * Toggles the annotation's `obscured` flag. Deliberately NOT propagated to
   * the rest of the chain — visibility is per-image (an animal can be clearly
   * visible in one photo and hidden behind a bush in the next), unlike a
   * label change which must stay consistent across the whole individual.
   */
  const handleToggleObscured = useCallback(
    async (annotationId: string) => {
      const current = localAnnotations.find((a) => a.id === annotationId);
      if (!current) return;
      const next = !current.obscured;

      const apply = (a: AnnotationType): AnnotationType =>
        a.id === annotationId ? { ...a, obscured: next } : a;
      const revert = (a: AnnotationType): AnnotationType =>
        a.id === annotationId ? { ...a, obscured: current.obscured } : a;

      setLocalAnnotations((prev) => prev.map(apply));
      patchTransectCache((old) => {
        const annotations = old.annotations.map(apply);
        return {
          ...old,
          annotations,
          annotationsByImage: indexByImage(annotations),
        };
      });

      try {
        await client.models.Annotation.update({
          id: annotationId,
          obscured: next,
        } as any);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to toggle annotation obscured', err);
        setLocalAnnotations((prev) => prev.map(revert));
        patchTransectCache((old) => {
          const annotations = old.annotations.map(revert);
          return {
            ...old,
            annotations,
            annotationsByImage: indexByImage(annotations),
          };
        });
      }
    },
    [localAnnotations, client, patchTransectCache]
  );

  /**
   * User clicked "Mark as obscured" on a *proposed* (shadow) marker — there's
   * no DB row yet, so we only record the intent in working state. It rides
   * along when the candidate is accepted and the row is created with
   * `obscured: true`. Lets the user flag the obscured animal up front instead
   * of accepting, panning back to the new marker, and toggling it after.
   */
  const handleSetProposedObscured = useCallback(
    (candidateKey: string, side: 'A' | 'B', value: boolean) => {
      if (!currentPairKey) return;
      working.setCandidateObscured(currentPairKey, candidateKey, side, value);
    },
    [working, currentPairKey]
  );

  // ---- Change-label flow ----
  // The marker popup's "Change Label" button asks the harness to open the
  // ChangeCategoryModal for a specific real annotation. The modal posts
  // back the new categoryId, we fire `Annotation.update`, and apply the
  // change optimistically + to the persisted cache. Since the harness is
  // filtered to a single category, relabelling makes the row vanish from
  // this view — that's flagged in the modal via the `warning` prop.
  const allCategories: CategoryType[] =
    (projectCtx as any)?.categoriesHook?.data ?? [];
  const setIdForModal =
    transect.data?.category?.annotationSetId ?? annotationSetId ?? '';
  const setCategories = useMemo(
    () =>
      allCategories.filter(
        (c) => (c as any).annotationSetId === setIdForModal
      ),
    [allCategories, setIdForModal]
  );

  // categoryId → marker colour for the informational (other-category)
  // markers drawn on the maps.
  const categoryColors = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of setCategories) {
      const col = (c as any).color;
      if (c.id && col) m[c.id] = col;
    }
    return m;
  }, [setCategories]);

  // Annotations on the current pair's two images that belong to OTHER
  // categories — rendered as read-only informational markers. OOV rows are
  // excluded since they have no on-image position.
  const foreignAnnotations = useMemo(() => {
    if (!currentPair) return [];
    return localAnnotations.filter(
      (a) =>
        a.categoryId !== categoryId &&
        !isOov(a) &&
        (a.imageId === currentPair.image1Id ||
          a.imageId === currentPair.image2Id)
    );
  }, [localAnnotations, currentPair, categoryId]);

  const duplicateAnnotationIds = useMemo(
    () => findDuplicateSameImageChainAnnotationIds(localAnnotations),
    [localAnnotations]
  );
  const [conflictHighlightAnnotationIds, setConflictHighlightAnnotationIds] =
    useState<Set<string>>(() => new Set<string>());
  const clearConflictHighlights = useCallback(
    () => setConflictHighlightAnnotationIds(new Set<string>()),
    []
  );

  const [labelChange, setLabelChange] = useState<{
    annotationId: string;
    currentCategoryId: string;
    /** ids of every annotation in the merged chain, including the target. */
    chainIds: string[];
  } | null>(null);

  /**
   * Build the chain of annotation ids that share an `objectId` with the
   * target. Includes the target itself, every secondary pointing at the
   * chain root, and the chain root annotation (whose id equals that
   * objectId). Annotations from other transects are NOT included — chains
   * are assumed to stay within a transect.
   */
  const buildChainIds = useCallback(
    (annotationId: string): string[] =>
      buildChainIdsFor(localAnnotations, annotationId),
    [localAnnotations]
  );

  const handleChangeLabel = useCallback(
    (annotationId: string, currentCategoryId: string) => {
      setLabelChange({
        annotationId,
        currentCategoryId,
        chainIds: buildChainIds(annotationId),
      });
    },
    [buildChainIds]
  );

  const handleApplyLabelChange = useCallback(
    async (newCategoryId: string) => {
      const target = labelChange;
      if (!target) return;
      // Apply the new category to the entire chain. Rationale: the chain
      // represents a single individual animal — if the user mis-IDed it
      // here, every linked sighting was mis-IDed too. Without propagation
      // the chain would carry inconsistent labels.
      const ids = new Set(target.chainIds);

      // Capture before-state for every chain member so we can roll back.
      const beforeMap = new Map<string, AnnotationType>();
      for (const aid of ids) {
        const a = localAnnotations.find((x) => x.id === aid);
        if (a) beforeMap.set(aid, a);
      }

      const apply = (a: AnnotationType): AnnotationType =>
        ids.has(a.id) ? { ...a, categoryId: newCategoryId } : a;

      setLocalAnnotations((prev) => prev.map(apply));
      patchTransectCache((old) => {
        const annotations = old.annotations.map(apply);
        return {
          ...old,
          annotations,
          annotationsByImage: indexByImage(annotations),
        };
      });
      setLabelChange(null);

      try {
        await Promise.all(
          Array.from(ids).map((aid) =>
            client.models.Annotation.update({
              id: aid,
              categoryId: newCategoryId,
            } as any)
          )
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to update annotation labels', err);
        // Roll back every chain member we touched.
        const rollback = (a: AnnotationType): AnnotationType =>
          beforeMap.get(a.id) ?? a;
        setLocalAnnotations((prev) => prev.map(rollback));
        patchTransectCache((old) => {
          const annotations = old.annotations.map(rollback);
          return {
            ...old,
            annotations,
            annotationsByImage: indexByImage(annotations),
          };
        });
      }
    },
    [labelChange, localAnnotations, client, patchTransectCache]
  );

  /**
   * Shared core for committing an identity link between a set of "actors"
   * (real annotations and/or Munkres-proposed shadow positions that should
   * all share one `objectId`).
   *
   * Chain-aware primary determination:
   *
   *   1. Each actor is either a real annotation (possibly already linked to a
   *      chain via its `objectId`) or a shadow we'll create as a new row.
   *   2. We gather all annotations in the merged chain — the actors plus
   *      every existing annotation already sharing an `objectId` with any
   *      actor (chain members and the chain root each actor points to).
   *   3. The chronologically oldest annotation across that whole set becomes
   *      the chain root. Its id is the shared `objectId` everyone else gets.
   *   4. Every annotation whose current `objectId` differs from the new root
   *      gets a patch — including chain-only annotations on images outside
   *      this pair (merging two chains).
   *
   * The cascade is bounded — only annotations already linked to an actor are
   * touched. Two unlinked actors is the no-cascade fast path.
   *
   * We deliberately do NOT invalidate the transect query: that would refetch
   * thousands of paginated rows and the resulting reference change would
   * clobber the optimistic `localAnnotations`. The optimistic update is the
   * session source of truth; the disk cache rehydrates it on next load.
   */
  const commitActorLink = useCallback(
    async (
      actors: LinkActor[],
      categoryId: string
    ) => {
      if (actors.length === 0) return false;
      const nowIso = new Date().toISOString();
      const setId =
        transect.data?.category?.annotationSetId ?? annotationSetId ?? '';
      const group =
        (projectCtx?.project as any)?.organizationId ?? undefined;
      const imagesById = transect.data?.imagesById ?? {};
      const ageOf = (imageId: string) => {
        const img: any = imagesById[imageId];
        return {
          timestamp: (img?.timestamp ?? null) as number | null,
          originalPath: (img?.originalPath ?? null) as string | null,
        };
      };

      // Gather chain-only annotations for any actor that is already linked —
      // both annotations sharing the same `objectId` and the root pointed to.
      const actorIds = new Set(actors.map((a) => a.id));
      const chainOnly: AnnotationType[] = [];
      const seenIds = new Set<string>(actorIds);
      for (const actor of actors) {
        const objId = actor.existing?.objectId;
        if (!objId) continue;
        for (const a of localAnnotations) {
          if (seenIds.has(a.id)) continue;
          if (a.objectId === objId || a.id === objId) {
            chainOnly.push(a);
            seenIds.add(a.id);
          }
        }
      }

      const sameImageConflicts = findSameImageAnnotationConflicts([
        ...actors.map((a) => ({ id: a.id, imageId: a.imageId })),
        ...chainOnly.map((a) => ({ id: a.id, imageId: a.imageId })),
      ]);
      if (sameImageConflicts.length > 0) {
        setConflictHighlightAnnotationIds(
          new Set(sameImageConflicts.flatMap((c) => c.annotationIds))
        );
        const details = sameImageConflicts
          .map(
            (c) =>
              `${c.imageId}: ${c.annotationIds
                .map((id) => id.slice(0, 8))
                .join(', ')}`
          )
          .join('; ');
        window.alert(
          `Cannot link these annotations: that would put multiple annotations from the same image in one chain (${details}).`
        );
        return false;
      }
      setConflictHighlightAnnotationIds(new Set<string>());

      // Chronologically oldest member of the merged set is the chain root.
      const all = [
        ...actors.map((a) => ({ id: a.id, age: ageOf(a.imageId) })),
        ...chainOnly.map((a) => ({ id: a.id, age: ageOf(a.imageId) })),
      ];
      let oldest = all[0];
      for (let i = 1; i < all.length; i++) {
        if (isOlder(all[i].age, oldest.age)) oldest = all[i];
      }
      const rootId = oldest.id;

      const updates: Array<{ id: string; patch: Partial<AnnotationType> }> =
        [];
      const newRows: AnnotationType[] = [];

      for (const actor of actors) {
        if (actor.existing) {
          const patch: Partial<AnnotationType> = {};
          if (actor.existing.objectId !== rootId) {
            patch.objectId = rootId;
          }
          if (
            actor.candidatePos &&
            (actor.candidatePos.x !== actor.existing.x ||
              actor.candidatePos.y !== actor.existing.y)
          ) {
            // x/y are `a.integer().required()` — round defensively.
            patch.x = Math.round(actor.candidatePos.x);
            patch.y = Math.round(actor.candidatePos.y);
          }
          if (Object.keys(patch).length > 0) {
            updates.push({ id: actor.id, patch });
          }
        } else if (actor.candidatePos) {
          newRows.push({
            id: actor.id,
            imageId: actor.imageId,
            setId,
            categoryId,
            x: Math.round(actor.candidatePos.x),
            y: Math.round(actor.candidatePos.y),
            objectId: rootId,
            source: 'individual-id',
            projectId: projectCtx?.project?.id,
            group,
            ...(actor.obscured ? { obscured: true } : {}),
            ...(actor.oov ? { oov: true } : {}),
            createdAt: nowIso,
            updatedAt: nowIso,
          } as unknown as AnnotationType);
        }
      }

      // Chain-only annotations: rewrite their objectId to the new root if
      // it differs. They never get position changes here.
      for (const ann of chainOnly) {
        if (ann.objectId !== rootId) {
          updates.push({ id: ann.id, patch: { objectId: rootId } });
        }
      }

      // One confirmed link per call, regardless of how many rows the chain
      // cascade rewrites: the user made one linking decision. Accumulated per
      // pair so the pair's completion event can report the effort involved,
      // since a pair of 200 buffalo is far more work than one of 6 elephants.
      const statsPairKey = currentPairKeyRef.current;
      if (statsPairKey) {
        linksByPairRef.current.set(
          statsPairKey,
          (linksByPairRef.current.get(statsPairKey) ?? 0) + 1
        );
      }

      // Optimistic local merge so the next Munkres run treats this as
      // already linked, mirrored into the persisted cache.
      const applyToList = (prev: AnnotationType[]): AnnotationType[] => {
        const patchById = new Map(updates.map((u) => [u.id, u.patch]));
        const next = prev.map((a) => {
          const patch = patchById.get(a.id);
          return patch ? { ...a, ...patch } : a;
        });
        return next.concat(newRows);
      };
      setLocalAnnotations(applyToList);
      patchTransectCache((old) => {
        const annotations = applyToList(old.annotations);
        return {
          ...old,
          annotations,
          annotationsByImage: indexByImage(annotations),
        };
      });

      // Fire writes (non-blocking). Strip createdAt/updatedAt — Amplify
      // auto-manages those and CreateAnnotationInput rejects them.
      //
      // We deliberately do NOT await the round-trip: the optimistic local
      // update above is the session source of truth, and callers use the
      // return value only to advance focus to the next marker. Awaiting
      // AppSync here stalled that advance by a visible ~1s and — because the
      // accepted candidate's pairKey changes once it gains an objectId — gave
      // the stale-activeKey cleanup time to fire, which reset the pan baseline
      // and suppressed the pan to the next marker. Failures only log; there's
      // no rollback to sequence.
      void Promise.all([
        ...updates.map((u) =>
          client.models.Annotation.update({ id: u.id, ...u.patch } as any)
        ),
        ...newRows.map((row) => {
          const { createdAt: _c, updatedAt: _u, ...dbInput } = row as any;
          return client.models.Annotation.create(dbInput as any);
        }),
      ]).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Failed to commit individual-id link', err);
      });
      return true;
    },
    [
      transect.data?.category?.annotationSetId,
      transect.data?.imagesById,
      annotationSetId,
      projectCtx?.project?.id,
      projectCtx?.project,
      localAnnotations,
      client,
      patchTransectCache,
    ]
  );

  /**
   * Space-accept. Builds actors from the candidate's two sides (real
   * annotation, or a Munkres shadow → new row) and delegates the chain-aware
   * identity assignment to commitActorLink.
   */
  const handleAccept = useCallback(
    async (candidateKey: string) => {
      if (!currentPair || !currentPairKey || !currentView) return false;
      const candidate = currentView.candidates.find(
        (c) => c.pairKey === candidateKey
      );
      if (!candidate) return false;

      const actors: LinkActor[] = [];
      if (candidate.realA) {
        actors.push({
          id: candidate.realA.id,
          imageId: candidate.realA.imageId,
          existing: candidate.realA,
          candidatePos: candidate.posA ?? null,
        });
      } else if (candidate.posA) {
        actors.push({
          id: crypto.randomUUID(),
          imageId: currentPair.image1Id,
          existing: null,
          candidatePos: candidate.posA,
          obscured: !!candidate.obscuredA,
        });
      }
      if (candidate.realB) {
        actors.push({
          id: candidate.realB.id,
          imageId: candidate.realB.imageId,
          existing: candidate.realB,
          candidatePos: candidate.posB ?? null,
        });
      } else if (candidate.posB) {
        actors.push({
          id: crypto.randomUUID(),
          imageId: currentPair.image2Id,
          existing: null,
          candidatePos: candidate.posB,
          obscured: !!candidate.obscuredB,
        });
      }
      if (actors.length === 0) return false;

      const committed = await commitActorLink(actors, candidate.categoryId);
      if (committed) {
        working.acceptCandidate(currentPairKey, candidateKey);
        return true;
      }
      return false;
    },
    [currentPair, currentPairKey, currentView, working, commitActorLink]
  );

  /**
   * Manual cross-image link (ctrl+click → confirm). The two ids are real
   * annotations on opposite images that the user asserts are the same
   * individual — Munkres couldn't pair them (e.g. the animal moved between
   * frames so the projected distance exceeded the leniency radius). Writing a
   * shared objectId makes the next Munkres rebuild hard-force the match,
   * collapsing both shadow proposals automatically.
   */
  const handleManualLink = useCallback(
    async (annotationIdA: string, annotationIdB: string) => {
      const a = localAnnotations.find((x) => x.id === annotationIdA);
      const b = localAnnotations.find((x) => x.id === annotationIdB);
      if (!a || !b) return;
      await commitActorLink(
        [
          { id: a.id, imageId: a.imageId, existing: a, candidatePos: null },
          { id: b.id, imageId: b.imageId, existing: b, candidatePos: null },
        ],
        a.categoryId
      );
    },
    [localAnnotations, commitActorLink]
  );

  /**
   * User clicked "Move to OOV" on a shadow whose candidate has a real
   * partner on the other side. Materialises a new OOV row on this side
   * chain-linked to the partner via shared objectId. Munkres ignores OOVs,
   * so the new row never proposes shadows on neighbour pairs — it sits as
   * a record in the OovPanel until deleted.
   */
  const handleMoveToOov = useCallback(
    async (candidateKey: string, oovSide: 'A' | 'B') => {
      if (!currentPair || !currentView || !currentPairKey) return;
      const candidate = currentView.candidates.find(
        (c) => c.pairKey === candidateKey
      );
      if (!candidate) return;
      const partner = oovSide === 'A' ? candidate.realB : candidate.realA;
      if (!partner) return;
      const oovImageId =
        oovSide === 'A' ? currentPair.image1Id : currentPair.image2Id;
      const actors: LinkActor[] = [
        {
          id: partner.id,
          imageId: partner.imageId,
          existing: partner,
          candidatePos: null,
        },
        {
          id: crypto.randomUUID(),
          imageId: oovImageId,
          existing: null,
          candidatePos: { x: 0, y: 0 },
          oov: true,
        },
      ];
      const committed = await commitActorLink(actors, candidate.categoryId);
      if (committed) working.acceptCandidate(currentPairKey, candidateKey);
    },
    [currentPair, currentView, currentPairKey, working, commitActorLink]
  );

  // ---- Manual-link confirmation ----
  // `active` is the real annotation in the currently-active candidate (on the
  // image opposite the click); `clicked` is the real annotation the user
  // ctrl+clicked on the other image. The dialog is the deliberate gate —
  // confirming commits the link immediately.
  const [pendingLink, setPendingLink] = useState<{
    active: string;
    clicked: string;
  } | null>(null);
  const requestManualLink = useCallback(
    (activeAnnotationId: string, clickedAnnotationId: string) => {
      setPendingLink({
        active: activeAnnotationId,
        clicked: clickedAnnotationId,
      });
    },
    []
  );
  const confirmManualLink = () => {
    if (pendingLink) handleManualLink(pendingLink.active, pendingLink.clicked);
    setPendingLink(null);
  };
  const cancelManualLink = () => setPendingLink(null);

  // ---- Render states ----
  if ((!transectId && !chainObjectId) || !categoryId) {
    return (
      <div className='p-4 text-light'>
        Missing <code>transectId</code> or <code>categoryId</code> in the URL.
      </div>
    );
  }
  if (transect.isLoading) {
    return <LoadingCard progress={transect.progress} />;
  }
  if (transect.error) {
    return (
      <div className='p-4 text-light'>
        Failed to load transect data: {String(transect.error)}
      </div>
    );
  }
  if (!pairs.length) {
    return (
      <div className='p-4 text-light'>
        No registerable pairs in this transect for the selected label.
      </div>
    );
  }

  const completionStates = pairViews.map((v) => v.completion);

  // Build a single-pair link for the Share button. We can only construct it
  // when we have a current pair AND a project to scope the URL to — the
  // single-pair route is nested under /surveys/:surveyId.
  //
  // Suppressed in reunion mode: synthetic pairs have no DB neighbour row,
  // so the single-pair harness can't load one. Same for the homography
  // editor below.
  const shareHref = (() => {
    if (reunionMode) return undefined;
    if (!currentPair || !projectCtx?.project?.id) return undefined;
    const setId =
      transect.data?.category?.annotationSetId ?? annotationSetId ?? '';
    const params = new URLSearchParams({
      image1Id: currentPair.image1Id,
      image2Id: currentPair.image2Id,
      categoryId,
    });
    if (setId) params.set('annotationSetId', setId);
    return `/surveys/${projectCtx.project.id}/individual-id-pair?${params.toString()}`;
  })();

  // Single-pair homography editor link. No backHref — the editor falls back
  // to navigate(-1), which restores location.state on the transect route
  // (IndividualIdTaskPage relies on it; a URL push would bounce to /jobs).
  const editHomographyHref = (() => {
    if (reunionMode) return undefined;
    if (!currentPair || !projectCtx?.project?.id) return undefined;
    const setId =
      transect.data?.category?.annotationSetId ?? annotationSetId ?? '';
    const params = new URLSearchParams({
      image1Id: currentPair.image1Id,
      image2Id: currentPair.image2Id,
    });
    if (setId) params.set('annotationSetId', setId);
    return `/surveys/${projectCtx.project.id}/homography-edit?${params.toString()}`;
  })();

  const chainViewerBaseHref = (() => {
    if (!projectCtx?.project?.id) return undefined;
    const setId =
      transect.data?.category?.annotationSetId ?? annotationSetId ?? '';
    if (!setId) return undefined;
    return `/surveys/${projectCtx.project.id}/set/${setId}/chain-viewer`;
  })();

  return (
    <div
      className='w-100 h-100 d-flex flex-column py-3'
      style={{ minHeight: 0 }}
    >
      {reunionMode && (
        <div
          style={{
            padding: '6px 12px',
            margin: '0 12px 8px',
            background: '#ff8c1a',
            color: '#fff',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          Reviewing reunions — {pairs.length}{' '}
          {pairs.length === 1 ? 'image pair' : 'image pairs'} where chains
          may rejoin
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        {currentPair && currentView && (
          <IndividualIdMapPair
            key={currentView.pairKeyStr}
            pair={currentPair}
            imageA={currentPair.imageA}
            imageB={currentPair.imageB}
            candidates={currentView.candidates}
            category={transect.data?.category ?? null}
            foreignAnnotations={foreignAnnotations}
            categoryColors={categoryColors}
            duplicateAnnotationIds={duplicateAnnotationIds}
            conflictHighlightAnnotationIds={conflictHighlightAnnotationIds}
            onClearConflictHighlights={clearConflictHighlights}
            visible
            leniency={leniency}
            onLeniencyChange={setLeniency}
            onDrag={handleDrag}
            onAccept={handleAccept}
            onPlaceNew={handlePlaceNew}
            onDelete={handleDelete}
            onSplitChain={handleSplitChain}
            canSplitChain={canSplitChain}
            onChangeLabel={handleChangeLabel}
            onToggleObscured={handleToggleObscured}
            onSetProposedObscured={handleSetProposedObscured}
            onMoveToOov={handleMoveToOov}
            onManualLinkRequest={requestManualLink}
            onAllAccepted={handleAllAccepted}
            onRequestPrevPair={() => laneNav(-1)}
            onRequestNextPair={() => laneNav(1)}
            collapsed={toolbarCollapsed}
            onCollapsedChange={setToolbarCollapsed}
            shareHref={shareHref}
            editHomographyHref={editHomographyHref}
            chainViewerBaseHref={chainViewerBaseHref}
          />
        )}
      </div>
      {!toolbarCollapsed && (
        <ProgressBar
          states={completionStates}
          lanes={visibleLanes}
          activeIndex={currentIndex}
          activeLane={activeLane}
          onJump={(i, lane) => requestPair(i, 'jump', lane)}
          simpleView={simpleView}
          onSimpleViewChange={setSimpleView}
        />
      )}
      <NavigateAwayDialog
        show={navAway.show}
        destination={navAway.direction}
        onConfirm={confirmNavAway}
        onCancel={cancelNavAway}
      />
      <PairCompleteDialog
        show={completePopup.show}
        earlierIncompleteIndex={completePopup.earlier}
        onConfirm={acceptCompletePopup}
        onStay={() => setCompletePopup({ show: false })}
      />
      <ReunionDialog
        show={!!pendingReunionDialog}
        count={pendingReunionDialog?.pairs.length ?? 0}
        onConfirm={confirmReunionDialog}
      />
      <TransectCompleteDialog
        show={showTransectComplete}
        onConfirm={() => {
          setShowTransectComplete(false);
          onCompleteRef.current?.();
        }}
      />
      <ChangeCategoryModal
        show={labelChange !== null}
        onClose={() => setLabelChange(null)}
        categories={setCategories}
        currentCategoryId={labelChange?.currentCategoryId}
        onSelectCategory={handleApplyLabelChange}
        warning={(() => {
          const count = labelChange?.chainIds.length ?? 1;
          if (count > 1) {
            return (
              <>
              <strong>Heads up:</strong> this annotation is linked to{' '}
              {count - 1} other{count - 1 === 1 ? '' : 's'} of the same
              individual. Changing the label will update <strong>all {count}</strong>{' '}
              of them so the chain stays consistent. 
            </>
            );
          }
        })()}
      />
      <LinkAnnotationDialog
        show={pendingLink !== null}
        onConfirm={confirmManualLink}
        onCancel={cancelManualLink}
      />
      <DeleteAnnotationDialog
        show={deleteRequest !== null}
        chainSize={deleteRequest?.chainIds.length ?? 0}
        onDeleteOne={() => confirmDeleteScope('single')}
        onDeleteChain={() => confirmDeleteScope('chain')}
        onCancel={() => setDeleteRequest(null)}
      />
      <SplitChainDialog
        show={splitRequest !== null}
        splitCount={splitRequest?.plan.splitCount ?? 0}
        retainedCount={splitRequest?.plan.retainedCount ?? 0}
        onConfirm={confirmSplitChain}
        onCancel={() => setSplitRequest(null)}
      />
    </div>
  );
}
