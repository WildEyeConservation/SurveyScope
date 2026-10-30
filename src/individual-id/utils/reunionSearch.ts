import type {
  AnnotationType,
  ImageNeighbourType,
  ImageType,
} from '../../schemaTypes';
import type { PixelTransform } from '../types';
import {
  buildAdjacency,
  buildChainedTransformsFromAdj,
  type ChainedTransform,
  type NeighbourAdjacency,
} from './chainedTransforms';
import { isOov } from './identity';

/**
 * A "reunion" found at transect-completion time: a real annotation's chain
 * ends on `imageAId` (or `imageBId`) and the same animal reappears far away
 * — beyond the direct-neighbour Munkres reach — on the other image. The
 * synthetic pair lets the user confirm and merge the chains via the regular
 * pair workflow.
 *
 * Image ids are normalised (older → A, newer → B) so independent BFS walks
 * that find the same reunion from opposite ends dedupe to one candidate.
 */
export interface ReunionCandidate {
  /** Chronologically older image of the synthetic pair. */
  imageAId: string;
  /** Chronologically newer image of the synthetic pair. */
  imageBId: string;
  /**
   * Neighbour-graph distance between the two images. Always >= 2 — direct
   * neighbours are handled by the regular Munkres pair, not by reunion
   * search.
   */
  hops: number;
  /** imageA pixel coordinate → imageB pixel coordinate. */
  forward: PixelTransform;
  /** imageB pixel coordinate → imageA pixel coordinate. */
  backward: PixelTransform;
}

export interface FindReunionsInput {
  /** All annotations in the transect (current local state). */
  annotations: AnnotationType[];
  /** All neighbour rows in the transect, including ones without homography. */
  rawNeighbours: ImageNeighbourType[];
  imagesById: Record<string, ImageType>;
  /**
   * Active workflow category — only annotations matching this category seed
   * reunion searches, and only same-category annotations on the target image
   * count as a match. Mirrors how Munkres filters today.
   */
  categoryId: string;
  /** Image-pixel radius for the "real annotation nearby on target" check. */
  leniency: number;
  /** Max neighbour-graph hops to walk from each chain endpoint. */
  maxHops: number;
}

/**
 * Chronological ordering between two images, ported from the
 * `reconcileHomographies` lambda. The older image's id becomes `imageAId`
 * on the resulting reunion candidate; the newer becomes `imageBId`. When
 * the comparison is undecided (missing timestamps, equal paths) we fall
 * back to imageId order so the dedup key is stable.
 */
function isOlder(
  a: Pick<ImageType, 'timestamp' | 'originalPath' | 'id'>,
  b: Pick<ImageType, 'timestamp' | 'originalPath' | 'id'>,
): boolean {
  const at = a.timestamp ?? null;
  const bt = b.timestamp ?? null;
  if (at !== null && bt !== null) {
    if (at !== bt) return at < bt;
  } else if (at !== null) {
    return true;
  } else if (bt !== null) {
    return false;
  }
  if (a.originalPath && b.originalPath && a.originalPath !== b.originalPath) {
    return a.originalPath < b.originalPath;
  }
  return a.id < b.id;
}

/**
 * Canonical chain identity for an annotation: its `objectId` if set
 * (annotations sharing one share a chain), otherwise its own `id`
 * (single-member chain).
 */
function chainKey(a: AnnotationType): string {
  return a.objectId ?? a.id;
}

/**
 * Every id (annotation id + objectId) that belongs to the given chain. Used
 * to filter out target annotations that are already linked to the source —
 * those are already part of the same animal's chain and don't represent a
 * reunion.
 */
function collectChainIds(chain: AnnotationType[]): Set<string> {
  const ids = new Set<string>();
  for (const a of chain) {
    ids.add(a.id);
    if (a.objectId) ids.add(a.objectId);
  }
  return ids;
}

/**
 * Find every reunion candidate across the transect.
 *
 * For each chain present in `annotations`, the chronologically oldest and
 * newest REAL members are treated as the chain's endpoints. From each
 * endpoint we BFS up to `maxHops` via composed homographies and, for every
 * reachable image (hops >= 2), check whether a same-category real
 * annotation sits within `leniency` of the projected endpoint position and
 * is NOT already in this chain. If so, the (source, target) image pair is
 * recorded — deduped by sorted (imageA, imageB) so reunions found from both
 * ends collapse to one candidate.
 *
 * The Munkres pass on the resulting synthetic pair will see every same-
 * category annotation on both images and propose all the matches, so this
 * function does not need to pre-resolve which annotations link to which —
 * its only job is to surface the image pair as worth reviewing.
 */
export function findReunions(input: FindReunionsInput): ReunionCandidate[] {
  const {
    annotations,
    rawNeighbours,
    imagesById,
    categoryId,
    leniency,
    maxHops,
  } = input;

  if (annotations.length === 0) return [];

  // Group annotations into chains keyed by their canonical identity.
  const chains = new Map<string, AnnotationType[]>();
  for (const a of annotations) {
    const key = chainKey(a);
    let arr = chains.get(key);
    if (!arr) {
      arr = [];
      chains.set(key, arr);
    }
    arr.push(a);
  }

  // Build the neighbour adjacency once; the BFS cache below memoises per
  // source image so chains with many endpoints on the same image don't
  // redo the walk.
  const adj: NeighbourAdjacency = buildAdjacency(rawNeighbours);
  const transformsCache = new Map<string, Map<string, ChainedTransform>>();
  const getTransforms = (srcId: string) => {
    let cached = transformsCache.get(srcId);
    if (!cached) {
      cached = buildChainedTransformsFromAdj(srcId, adj, maxHops);
      transformsCache.set(srcId, cached);
    }
    return cached;
  };

  // Annotations grouped by image id for the target-side lookup.
  const annsByImage: Record<string, AnnotationType[]> = {};
  for (const a of annotations) {
    (annsByImage[a.imageId] ??= []).push(a);
  }

  const out = new Map<string, ReunionCandidate>();

  for (const chain of chains.values()) {
    // Only REAL members can act as endpoints — an OOV has no position to
    // project, and its chain identity is anchored at its real partner(s).
    const reals = chain.filter((a) => !isOov(a));
    if (reals.length === 0) continue;

    // Endpoints: chronologically oldest + newest by image timestamp. (For
    // a single-member chain, both endpoints are the same annotation; we
    // dedupe via the visited set below.)
    const sorted = reals
      .slice()
      .filter((a) => imagesById[a.imageId])
      .sort((x, y) =>
        isOlder(imagesById[x.imageId], imagesById[y.imageId]) ? -1 : 1,
      );
    if (sorted.length === 0) continue;
    const endpoints =
      sorted.length === 1
        ? [sorted[0]]
        : [sorted[0], sorted[sorted.length - 1]];

    const chainIds = collectChainIds(chain);

    for (const endpoint of endpoints) {
      if (categoryId && endpoint.categoryId !== categoryId) continue;
      const sourceImage = imagesById[endpoint.imageId];
      if (!sourceImage) continue;

      const reachable = getTransforms(endpoint.imageId);
      for (const [targetImageId, ct] of reachable) {
        // Direct neighbours: regular Munkres pair already handles them.
        if (ct.hops < 2) continue;
        const targetImage = imagesById[targetImageId];
        if (!targetImage) continue;

        const [px, py] = ct.forward([endpoint.x, endpoint.y]);
        if (
          px < 0 ||
          py < 0 ||
          px >= targetImage.width ||
          py >= targetImage.height
        ) {
          continue;
        }

        // Look for a same-category real annotation near the projection
        // that isn't already in this chain. One match is enough — the
        // synthetic pair's Munkres run resolves the rest.
        const targetAnns = annsByImage[targetImageId] ?? [];
        let found = false;
        for (const ta of targetAnns) {
          if (isOov(ta)) continue;
          if (categoryId && ta.categoryId !== categoryId) continue;
          if (chainIds.has(ta.id)) continue;
          if (ta.objectId && chainIds.has(ta.objectId)) continue;
          const dx = ta.x - px;
          const dy = ta.y - py;
          if (Math.sqrt(dx * dx + dy * dy) > leniency) continue;
          found = true;
          break;
        }
        if (!found) continue;

        // Normalise pair ordering so the dedup key is stable regardless
        // of which end of the chain discovered the reunion.
        const swap = !isOlder(sourceImage, targetImage);
        const imageAId = swap ? targetImageId : endpoint.imageId;
        const imageBId = swap ? endpoint.imageId : targetImageId;
        const forward = swap ? ct.backward : ct.forward;
        const backward = swap ? ct.forward : ct.backward;
        const key = `${imageAId}|${imageBId}`;
        if (out.has(key)) continue;
        out.set(key, {
          imageAId,
          imageBId,
          hops: ct.hops,
          forward,
          backward,
        });
      }
    }
  }

  return Array.from(out.values());
}
