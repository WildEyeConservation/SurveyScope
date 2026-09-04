import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ProjectContext } from '../Context';
import { client } from '../stores/appClient';
import type { AnnotationType, CategoryType } from '../schemaTypes';
import { usePairData, type PairData } from './hooks/usePairData';
import {
  makePairKey,
  usePairWorkingState,
} from './hooks/usePairWorkingState';
import { buildMatchCandidates } from './utils/munkres';
import { buildNeighbourTransforms } from './utils/transforms';
import { isOov } from './utils/identity';
import {
  buildChainSplitPlan,
  findDuplicateSameImageChainAnnotationIds,
  findSameImageAnnotationConflicts,
  type ChainSplitPlan,
} from './utils/chains';
import type { MatchCandidate, NeighbourPairWithMeta } from './types';
import { IndividualIdMapPair } from './IndividualIdMapPair';
import { LoadingCard } from './components/LoadingCard';
import { LinkAnnotationDialog } from './components/LinkAnnotationDialog';
import { SplitChainDialog } from './components/SplitChainDialog';
import ChangeCategoryModal from '../ChangeCategoryModal';

const DEFAULT_LENIENCY = 40;

function indexByImage(
  annotations: AnnotationType[]
): Record<string, AnnotationType[]> {
  const out: Record<string, AnnotationType[]> = {};
  for (const a of annotations) (out[a.imageId] ??= []).push(a);
  return out;
}

function isOlder(
  a: { timestamp?: number | null; originalPath?: string | null },
  b: { timestamp?: number | null; originalPath?: string | null }
): boolean {
  const at = a.timestamp ?? null;
  const bt = b.timestamp ?? null;
  if (at !== null && bt !== null) {
    if (at !== bt) return at < bt;
  } else {
    return false;
  }
  if (a.originalPath && b.originalPath) {
    return a.originalPath < b.originalPath;
  }
  return false;
}

type LinkActor = {
  id: string;
  imageId: string;
  existing: AnnotationType | null;
  candidatePos: { x: number; y: number } | null;
  obscured?: boolean;
  oov?: boolean;
};

interface Props {
  image1Id: string;
  image2Id: string;
  categoryId: string;
  annotationSetId: string;
  /** When set, the toolbar's previous-pair button navigates to this URL. Button hides otherwise. */
  prevHref?: string;
  /** When set, the toolbar's next-pair button navigates to this URL. Button hides otherwise. */
  nextHref?: string;
  /** Copyable single-pair link displayed in the toolbar's Share button. */
  shareHref?: string;
  /** When set, the toolbar's "Edit homography" button navigates here. */
  editHomographyHref?: string;
}

/**
 * Single-pair counterpart to IndividualIdHarness. Loads exactly the data for
 * one image pair, runs the Munkres matcher just for that pair, and skips all
 * the transect-level navigation (lanes, progress bar, pair-complete prompts,
 * transect-completion lambda call). Prev/next leave the page entirely via
 * caller-supplied URLs rather than walking an internal pair list.
 */
export function IndividualIdPairHarness({
  image1Id,
  image2Id,
  categoryId,
  annotationSetId,
  prevHref,
  nextHref,
  shareHref,
  editHomographyHref,
}: Props) {
  const [leniency, setLeniency] = useState<number>(DEFAULT_LENIENCY);
  const navigate = useNavigate();
  const projectCtx = useContext(ProjectContext);
  const queryClient = useQueryClient();
  const pairData = usePairData({
    image1Id,
    image2Id,
    categoryId,
    annotationSetId,
  });
  const working = usePairWorkingState();

  const [localAnnotations, setLocalAnnotations] = useState<AnnotationType[]>(
    []
  );
  useEffect(() => {
    if (pairData.data?.annotations)
      setLocalAnnotations(pairData.data.annotations);
  }, [pairData.data?.annotations]);

  const annotationsByImage = useMemo(
    () => indexByImage(localAnnotations),
    [localAnnotations]
  );

  // Mirror the optimistic mutation pattern from the transect harness so the
  // localStorage-persisted cache stays consistent with the in-memory state.
  const patchPairCache = useCallback(
    (mutate: (data: PairData) => PairData) => {
      queryClient.setQueriesData<PairData>(
        {
          predicate: (q) =>
            Array.isArray(q.queryKey) && q.queryKey[0] === 'individual-id-pair',
        },
        (old) => (old ? mutate(old) : old)
      );
    },
    [queryClient]
  );

  // Build a single NeighbourPair, re-orienting so A is the older image.
  const pair: NeighbourPairWithMeta | null = useMemo(() => {
    const d = pairData.data;
    if (!d || !d.neighbour) return null;
    const tfs = buildNeighbourTransforms(d.neighbour);
    if (tfs.noHomography) return null;

    // The neighbour fixes which image is "1" and which is "2" for the
    // homography. Find which loaded image is on which side so the
    // swap-to-chronological-order logic below picks the right transforms.
    const neighbourImg1 = d.imageA.id === d.neighbour.image1Id ? d.imageA : d.imageB;
    const neighbourImg2 = d.imageA.id === d.neighbour.image1Id ? d.imageB : d.imageA;

    const swap = isOlder(neighbourImg2, neighbourImg1);
    const imageA = swap ? neighbourImg2 : neighbourImg1;
    const imageB = swap ? neighbourImg1 : neighbourImg2;
    const forward = swap ? tfs.backward : tfs.forward;
    const backward = swap ? tfs.forward : tfs.backward;

    return {
      image1Id: imageA.id,
      image2Id: imageB.id,
      forward,
      backward,
      noHomography: false,
      skipped: false,
      imageA,
      imageB,
      rawNeighbour: d.neighbour,
    };
  }, [pairData.data]);

  const currentPairKey = pair ? makePairKey(pair.image1Id, pair.image2Id) : '';

  const candidates: MatchCandidate[] = useMemo(() => {
    if (!pair) return [];
    const munkres = buildMatchCandidates({
      annotationsA: annotationsByImage[pair.image1Id] ?? [],
      annotationsB: annotationsByImage[pair.image2Id] ?? [],
      imageA: pair.imageA,
      imageB: pair.imageB,
      forward: pair.forward,
      backward: pair.backward,
      leniency,
      categoryFilter: categoryId,
    });
    return working.mergeCandidates(currentPairKey, munkres);
  }, [
    pair,
    annotationsByImage,
    leniency,
    categoryId,
    working,
    currentPairKey,
  ]);

  // ---- The map-pair callbacks (mirror IndividualIdHarness) ----
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
      patchPairCache((old) => ({
        ...old,
        annotations: old.annotations.map(apply),
      }));

      try {
        await client.models.Annotation.update({
          id: annotationId,
          x,
          y,
        } as any);
      } catch (err) {
        console.error('Failed to update annotation position', err);
        setLocalAnnotations((prev) => prev.map(revert));
        patchPairCache((old) => ({
          ...old,
          annotations: old.annotations.map(revert),
        }));
      }
    },
    [localAnnotations, patchPairCache]
  );

  const handleDrag = useCallback(
    (
      candidateKey: string,
      side: 'A' | 'B',
      pos: { x: number; y: number }
    ) => {
      if (!currentPairKey) return;
      const candidate = candidates.find((c) => c.pairKey === candidateKey);
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
    [working, currentPairKey, candidates, persistAnnotationPosition]
  );

  const handlePlaceNew = useCallback(
    async (
      side: 'A' | 'B',
      pos: { x: number; y: number },
      newId: string
    ) => {
      if (!pair) return;
      const group = (projectCtx?.project as any)?.organizationId ?? undefined;
      const nowIso = new Date().toISOString();
      const imageId = side === 'A' ? pair.image1Id : pair.image2Id;
      const dbInput = {
        id: newId,
        imageId,
        setId: annotationSetId,
        categoryId,
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        source: 'individual-id',
        projectId: projectCtx?.project?.id,
        group,
      };
      const localRow = {
        ...dbInput,
        createdAt: nowIso,
        updatedAt: nowIso,
      } as unknown as AnnotationType;

      setLocalAnnotations((prev) => [...prev, localRow]);
      patchPairCache((old) => ({
        ...old,
        annotations: [...old.annotations, localRow],
      }));

      try {
        await client.models.Annotation.create(dbInput as any);
      } catch (err) {
        console.error('Failed to create annotation', err);
        setLocalAnnotations((prev) => prev.filter((a) => a.id !== newId));
        patchPairCache((old) => ({
          ...old,
          annotations: old.annotations.filter((a) => a.id !== newId),
        }));
      }
    },
    [
      pair,
      annotationSetId,
      categoryId,
      projectCtx?.project?.id,
      projectCtx?.project,
      patchPairCache,
    ]
  );

  const handleDelete = useCallback(
    async (annotationId: string) => {
      const before = localAnnotations;
      const target = localAnnotations.find((a) => a.id === annotationId);

      // Mirror the transect harness's OOV re-rooting: deleting an OOV that
      // bridges newer annotations to an older chain re-anchors the newer
      // segment to its own oldest survivor so the chains end up split, not
      // dangling.
      const imagesById: Record<string, any> =
        pairData.data?.imagesById ?? {};
      const ageOf = (imageId: string) => {
        const img: any = imagesById[imageId];
        return {
          timestamp: (img?.timestamp ?? null) as number | null,
          originalPath: (img?.originalPath ?? null) as string | null,
        };
      };
      const reRootUpdates: Array<{
        id: string;
        patch: Partial<AnnotationType>;
      }> = [];
      if (target && isOov(target)) {
        const chainKey = target.objectId ?? target.id;
        const chainMembers = localAnnotations.filter(
          (a) =>
            a.id !== annotationId &&
            (a.objectId === chainKey || a.id === chainKey)
        );
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

      const applyDeleteAndReRoot = (
        prev: AnnotationType[]
      ): AnnotationType[] => {
        let next = prev.filter((a) => a.id !== annotationId);
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
      patchPairCache((old) => ({
        ...old,
        annotations: applyDeleteAndReRoot(old.annotations),
      }));

      try {
        const result: any = await client.models.Annotation.delete({
          id: annotationId,
        } as any);
        await Promise.all(
          reRootUpdates.map((u) =>
            client.models.Annotation.update({
              id: u.id,
              ...u.patch,
            } as any)
          )
        );
        if (result && result.data == null && !result.errors?.length) {
          console.warn(
            'Annotation.delete returned null — likely an authorization issue (you may not own this row).',
            { id: annotationId }
          );
        }
      } catch (err) {
        console.error('Failed to delete annotation', err);
        setLocalAnnotations(before);
        patchPairCache((old) => ({ ...old, annotations: before }));
      }
    },
    [localAnnotations, pairData.data?.imagesById, patchPairCache]
  );

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
      patchPairCache((old) => ({
        ...old,
        annotations: old.annotations.map(apply),
      }));
      try {
        await client.models.Annotation.update({
          id: annotationId,
          obscured: next,
        } as any);
      } catch (err) {
        console.error('Failed to toggle annotation obscured', err);
        setLocalAnnotations((prev) => prev.map(revert));
        patchPairCache((old) => ({
          ...old,
          annotations: old.annotations.map(revert),
        }));
      }
    },
    [localAnnotations, patchPairCache]
  );

  const handleSetProposedObscured = useCallback(
    (candidateKey: string, side: 'A' | 'B', value: boolean) => {
      if (!currentPairKey) return;
      working.setCandidateObscured(currentPairKey, candidateKey, side, value);
    },
    [working, currentPairKey]
  );

  // ---- Change-label flow ----
  const allCategories: CategoryType[] =
    (projectCtx as any)?.categoriesHook?.data ?? [];
  const setCategories = useMemo(
    () =>
      allCategories.filter(
        (c) => (c as any).annotationSetId === annotationSetId
      ),
    [allCategories, annotationSetId]
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

  // Annotations on the pair's two images that belong to OTHER categories —
  // rendered as read-only informational markers. OOV rows are excluded
  // since they have no on-image position.
  const foreignAnnotations = useMemo(() => {
    if (!pair) return [];
    return localAnnotations.filter(
      (a) =>
        a.categoryId !== categoryId &&
        !isOov(a) &&
        (a.imageId === pair.image1Id || a.imageId === pair.image2Id)
    );
  }, [localAnnotations, pair, categoryId]);

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
    chainIds: string[];
  } | null>(null);
  const [splitRequest, setSplitRequest] = useState<{
    annotationId: string;
    plan: ChainSplitPlan;
  } | null>(null);

  const buildChainIds = useCallback(
    (annotationId: string): string[] => {
      const ids = new Set<string>([annotationId]);
      const target = localAnnotations.find((a) => a.id === annotationId);
      const chainKey = target?.objectId;
      if (chainKey) {
        for (const a of localAnnotations) {
          if (a.objectId === chainKey || a.id === chainKey) {
            ids.add(a.id);
          }
        }
      }
      return Array.from(ids);
    },
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

  const buildSplitPlan = useCallback(
    (annotationId: string) => {
      const imagesById = pairData.data?.imagesById ?? {};
      return buildChainSplitPlan(localAnnotations, annotationId, (imageId) => {
        const img: any = imagesById[imageId];
        return {
          timestamp: (img?.timestamp ?? null) as number | null,
          originalPath: (img?.originalPath ?? null) as string | null,
        };
      });
    },
    [localAnnotations, pairData.data?.imagesById]
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
      patchPairCache((old) => ({
        ...old,
        annotations: applySplit(old.annotations),
      }));

      try {
        await Promise.all(
          plan.updates.map((u) =>
            client.models.Annotation.update({ id: u.id, ...u.patch } as any)
          )
        );
      } catch (err) {
        console.error('Failed to split individual-id chain', err);
        setLocalAnnotations(before);
        patchPairCache((old) => ({ ...old, annotations: before }));
      }
    },
    [buildSplitPlan, localAnnotations, patchPairCache]
  );

  const confirmSplitChain = () => {
    if (!splitRequest) return;
    void executeSplitChain(splitRequest.annotationId);
    setSplitRequest(null);
  };

  const handleApplyLabelChange = useCallback(
    async (newCategoryId: string) => {
      const target = labelChange;
      if (!target) return;
      const ids = new Set(target.chainIds);
      const beforeMap = new Map<string, AnnotationType>();
      for (const aid of ids) {
        const a = localAnnotations.find((x) => x.id === aid);
        if (a) beforeMap.set(aid, a);
      }
      const apply = (a: AnnotationType): AnnotationType =>
        ids.has(a.id) ? { ...a, categoryId: newCategoryId } : a;
      setLocalAnnotations((prev) => prev.map(apply));
      patchPairCache((old) => ({
        ...old,
        annotations: old.annotations.map(apply),
      }));
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
        console.error('Failed to update annotation labels', err);
        const rollback = (a: AnnotationType): AnnotationType =>
          beforeMap.get(a.id) ?? a;
        setLocalAnnotations((prev) => prev.map(rollback));
        patchPairCache((old) => ({
          ...old,
          annotations: old.annotations.map(rollback),
        }));
      }
    },
    [labelChange, localAnnotations, patchPairCache]
  );

  const commitActorLink = useCallback(
    async (actors: LinkActor[], cat: string) => {
      if (actors.length === 0) return false;
      const nowIso = new Date().toISOString();
      const group = (projectCtx?.project as any)?.organizationId ?? undefined;
      const imagesById: Record<string, any> =
        pairData.data?.imagesById ?? {};
      const ageOf = (imageId: string) => {
        const img: any = imagesById[imageId];
        return {
          timestamp: (img?.timestamp ?? null) as number | null,
          originalPath: (img?.originalPath ?? null) as string | null,
        };
      };

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

      const all = [
        ...actors.map((a) => ({ id: a.id, age: ageOf(a.imageId) })),
        ...chainOnly.map((a) => ({ id: a.id, age: ageOf(a.imageId) })),
      ];
      let oldest = all[0];
      for (let i = 1; i < all.length; i++) {
        if (isOlder(all[i].age, oldest.age)) oldest = all[i];
      }
      const rootId = oldest.id;

      const updates: Array<{ id: string; patch: Partial<AnnotationType> }> = [];
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
            setId: annotationSetId,
            categoryId: cat,
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

      for (const ann of chainOnly) {
        if (ann.objectId !== rootId) {
          updates.push({ id: ann.id, patch: { objectId: rootId } });
        }
      }

      const applyToList = (prev: AnnotationType[]): AnnotationType[] => {
        const patchById = new Map(updates.map((u) => [u.id, u.patch]));
        const next = prev.map((a) => {
          const patch = patchById.get(a.id);
          return patch ? { ...a, ...patch } : a;
        });
        return next.concat(newRows);
      };
      setLocalAnnotations(applyToList);
      patchPairCache((old) => ({
        ...old,
        annotations: applyToList(old.annotations),
      }));

      try {
        await Promise.all([
          ...updates.map((u) =>
            client.models.Annotation.update({ id: u.id, ...u.patch } as any)
          ),
          ...newRows.map((row) => {
            const { createdAt: _c, updatedAt: _u, ...dbInput } = row as any;
            return client.models.Annotation.create(dbInput as any);
          }),
        ]);
      } catch (err) {
        console.error('Failed to commit individual-id link', err);
      }
      return true;
    },
    [
      annotationSetId,
      pairData.data?.imagesById,
      projectCtx?.project?.id,
      projectCtx?.project,
      localAnnotations,
      patchPairCache,
    ]
  );

  const handleAccept = useCallback(
    async (candidateKey: string) => {
      if (!pair) return false;
      const candidate = candidates.find((c) => c.pairKey === candidateKey);
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
          imageId: pair.image1Id,
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
          imageId: pair.image2Id,
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
    [pair, candidates, working, currentPairKey, commitActorLink]
  );

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

  const handleMoveToOov = useCallback(
    async (candidateKey: string, oovSide: 'A' | 'B') => {
      if (!pair || !currentPairKey) return;
      const candidate = candidates.find((c) => c.pairKey === candidateKey);
      if (!candidate) return;
      const partner = oovSide === 'A' ? candidate.realB : candidate.realA;
      if (!partner) return;
      const oovImageId = oovSide === 'A' ? pair.image1Id : pair.image2Id;
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
    [pair, candidates, working, currentPairKey, commitActorLink]
  );

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

  const goPrev = useMemo(
    () => (prevHref ? () => navigate(prevHref) : undefined),
    [prevHref, navigate]
  );
  const goNext = useMemo(
    () => (nextHref ? () => navigate(nextHref) : undefined),
    [nextHref, navigate]
  );

  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);

  // ---- Render states ----
  if (!image1Id || !image2Id || !categoryId || !annotationSetId) {
    return (
      <div className='p-4 text-light'>
        Missing one of <code>image1Id</code>, <code>image2Id</code>,{' '}
        <code>categoryId</code>, or <code>annotationSetId</code> in the URL.
      </div>
    );
  }
  if (pairData.isLoading) {
    return (
      <LoadingCard
        progress={{
          phase:
            pairData.progress.phase === 'chain'
              ? 'annotations'
              : pairData.progress.phase === 'idle'
              ? 'idle'
              : pairData.progress.phase,
          images: 0,
          annotations: pairData.progress.annotations,
        }}
      />
    );
  }
  if (pairData.error) {
    return (
      <div className='p-4 text-light'>
        Failed to load pair data: {String(pairData.error)}
      </div>
    );
  }
  if (!pairData.data?.neighbour) {
    return (
      <div className='p-4 text-light'>
        These two images aren't registered as neighbours (no homography
        between them).
      </div>
    );
  }
  if (!pair) {
    return (
      <div className='p-4 text-light'>
        The image pair exists but has no homography — nothing to register.
      </div>
    );
  }

  return (
    <div
      className='w-100 h-100 d-flex flex-column py-3'
      style={{ minHeight: 0 }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        <IndividualIdMapPair
          key={currentPairKey}
          pair={pair}
          imageA={pair.imageA}
          imageB={pair.imageB}
          candidates={candidates}
          category={pairData.data?.category ?? null}
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
          onRequestPrevPair={goPrev}
          onRequestNextPair={goNext}
          collapsed={toolbarCollapsed}
          onCollapsedChange={setToolbarCollapsed}
          shareHref={shareHref}
          editHomographyHref={editHomographyHref}
          chainViewerBaseHref={
            projectCtx?.project?.id
              ? `/surveys/${projectCtx.project.id}/set/${annotationSetId}/chain-viewer`
              : undefined
          }
        />
      </div>
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
              individual. Changing the label will update{' '}
              <strong>all {count}</strong> of them so the chain stays
              consistent.
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
