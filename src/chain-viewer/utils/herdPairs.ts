import {
  buildAdjacency,
  buildChainedTransformsFromAdj,
  type ChainedTransform,
} from '../../individual-id/utils/chainedTransforms';
import { buildNeighbourTransforms } from '../../individual-id/utils/transforms';
import type { ImageNeighbourType, ImageType } from '../../schemaTypes';
import type { ChainAnnotation, HerdDisplayPair } from '../types';

const identity = (c: [number, number]): [number, number] => [c[0], c[1]];
const MAX_CHAINED_TRANSFORM_HOPS = 20;

function compareImages(a: ImageType, b: ImageType): number {
  const aTime = a.timestamp ?? null;
  const bTime = b.timestamp ?? null;
  if (aTime !== null && bTime !== null && aTime !== bTime) {
    return aTime - bTime;
  }
  if (aTime !== null && bTime === null) return -1;
  if (aTime === null && bTime !== null) return 1;
  const byPath = (a.originalPath ?? '').localeCompare(b.originalPath ?? '');
  return byPath !== 0 ? byPath : a.id.localeCompare(b.id);
}

function cameraKey(image: ImageType): string {
  // Missing camera metadata must not merge unrelated images into one group.
  return image.cameraId ?? `missing-camera:${image.id}`;
}

function pairKey(image1Id: string, image2Id: string): string {
  return image1Id < image2Id
    ? `${image1Id}::${image2Id}`
    : `${image2Id}::${image1Id}`;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) if (large.has(value)) return true;
  return false;
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  add(value: string): void {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: string): string {
    const parent = this.parent.get(value);
    if (parent === undefined) {
      this.parent.set(value, value);
      return value;
    }
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(a: string, b: string): boolean {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return false;
    this.parent.set(rootB, rootA);
    return true;
  }
}

function syntheticPair(
  herdId: string,
  image1: ImageType,
  image2: ImageType,
): HerdDisplayPair {
  const swap = compareImages(image2, image1) < 0;
  const imageA = swap ? image2 : image1;
  const imageB = swap ? image1 : image2;
  return {
    herdId,
    image1Id: imageA.id,
    image2Id: imageB.id,
    forward: identity,
    backward: identity,
    noHomography: false,
    skipped: false,
    imageA,
    imageB,
    crossover: false,
  };
}

function chainedPair(
  herdId: string,
  image1: ImageType,
  image2: ImageType,
  chained: ChainedTransform | undefined,
): HerdDisplayPair {
  if (!chained) return syntheticPair(herdId, image1, image2);
  const swap = compareImages(image2, image1) < 0;
  const imageA = swap ? image2 : image1;
  const imageB = swap ? image1 : image2;
  return {
    herdId,
    image1Id: imageA.id,
    image2Id: imageB.id,
    forward: swap ? chained.backward : chained.forward,
    backward: swap ? chained.forward : chained.backward,
    noHomography: false,
    skipped: false,
    imageA,
    imageB,
    crossover: false,
  };
}

function registeredPair(
  herdId: string,
  neighbour: ImageNeighbourType,
  image1: ImageType,
  image2: ImageType,
  crossover: boolean,
): HerdDisplayPair | null {
  const transforms = buildNeighbourTransforms(neighbour);
  if (transforms.noHomography) return null;

  // Transform direction is defined by the neighbour row, independently of
  // the order in which the candidate images were supplied.
  const neighbourImage1 = image1.id === neighbour.image1Id ? image1 : image2;
  const neighbourImage2 = image2.id === neighbour.image2Id ? image2 : image1;
  if (
    neighbourImage1.id !== neighbour.image1Id ||
    neighbourImage2.id !== neighbour.image2Id
  ) {
    return null;
  }

  const swap = compareImages(neighbourImage2, neighbourImage1) < 0;
  const imageA = swap ? neighbourImage2 : neighbourImage1;
  const imageB = swap ? neighbourImage1 : neighbourImage2;
  return {
    herdId,
    image1Id: imageA.id,
    image2Id: imageB.id,
    forward: swap ? transforms.backward : transforms.forward,
    backward: swap ? transforms.forward : transforms.backward,
    noHomography: false,
    skipped: false,
    imageA,
    imageB,
    rawNeighbour: neighbour,
    crossover,
  };
}

function comparePairs(a: HerdDisplayPair, b: HerdDisplayPair): number {
  const byA = compareImages(a.imageA, b.imageA);
  return byA !== 0 ? byA : compareImages(a.imageB, b.imageB);
}

/**
 * Build a same-camera pair for two chronologically adjacent images, using a
 * direct neighbour homography when one is registered, then a transform
 * composed through the neighbour graph, and finally identity.
 */
function adjacentPair(
  herdId: string,
  image1: ImageType,
  image2: ImageType,
  neighboursByPair: Map<string, ImageNeighbourType>,
  getChainedTransform: (
    sourceImageId: string,
    targetImageId: string,
  ) => ChainedTransform | undefined,
): HerdDisplayPair {
  const neighbour = neighboursByPair.get(pairKey(image1.id, image2.id));
  if (neighbour) {
    const registered = registeredPair(herdId, neighbour, image1, image2, false);
    if (registered) return registered;
  }
  return chainedPair(
    herdId,
    image1,
    image2,
    getChainedTransform(image1.id, image2.id),
  );
}

/**
 * Build same-camera display pairs for one herd as a set of chronological paths.
 *
 * Images are grouped into chain-connected components (two images link when
 * they are consecutive sightings of a shared chain). Each component is then
 * laid out as a single time-ordered path, pairing each image only with its
 * immediate successor. A path — unlike the spanning tree a minimum forest
 * produces — gives every image at most one earlier-pair and one later-pair, so
 * no image is ever shown as the earlier (or later) half of more than one
 * same-camera pair.
 */
function cameraPairs(
  herdId: string,
  images: ImageType[],
  chainsByImage: Map<string, Set<string>>,
  neighboursByPair: Map<string, ImageNeighbourType>,
  getChainedTransform: (
    sourceImageId: string,
    targetImageId: string,
  ) => ChainedTransform | undefined,
): HerdDisplayPair[] {
  // Connect images that are consecutive sightings of a shared chain. This is
  // the same connectivity the previous minimum forest used; only the layout
  // within each connected component changes from a tree to a path.
  const components = new DisjointSet();
  for (const image of images) components.add(image.id);

  const imagesByChain = new Map<string, ImageType[]>();
  for (const image of images) {
    for (const chain of chainsByImage.get(image.id) ?? []) {
      const sightings = imagesByChain.get(chain);
      if (sightings) sightings.push(image);
      else imagesByChain.set(chain, [image]);
    }
  }
  for (const sightings of imagesByChain.values()) {
    sightings.sort(compareImages);
    for (let i = 1; i < sightings.length; i++) {
      components.union(sightings[i - 1].id, sightings[i].id);
    }
  }

  const componentImages = new Map<string, ImageType[]>();
  for (const image of images) {
    const root = components.find(image.id);
    const list = componentImages.get(root);
    if (list) list.push(image);
    else componentImages.set(root, [image]);
  }

  const pairs: HerdDisplayPair[] = [];
  for (const list of componentImages.values()) {
    list.sort(compareImages);
    for (let i = 1; i < list.length; i++) {
      pairs.push(
        adjacentPair(
          herdId,
          list[i - 1],
          list[i],
          neighboursByPair,
          getChainedTransform,
        ),
      );
    }
  }
  return pairs.sort(comparePairs);
}

/**
 * Build the chain viewer sequence.
 *
 * Chains define herds first: images are in the same herd only when connected
 * transitively by shared chain identities. Camera grouping is secondary. For
 * each herd we lay out a chronological same-camera path, then only the earliest
 * real cross-camera neighbour needed to introduce each additional camera.
 *
 * Same-camera pairs use a direct or composed neighbour-graph homography when
 * possible; cross-camera pairs always use a registered homography neighbour.
 *
 * Every image appears as the earlier half of at most one pair and the later
 * half of at most one pair: the per-camera paths guarantee this within a
 * camera, and a guard drops any crossover that would re-use a role an image
 * has already filled.
 */
export function buildHerdDisplayPairs(
  imagesById: Record<string, ImageType>,
  rawNeighbours: ImageNeighbourType[],
  annotationsByImage: Record<string, ChainAnnotation[]>,
): HerdDisplayPair[] {
  const chainsByImage = new Map<string, Set<string>>();
  const annotatedImages: ImageType[] = [];
  for (const [imageId, annotations] of Object.entries(annotationsByImage)) {
    const image = imagesById[imageId];
    if (!image) continue;
    const chains = new Set(annotations.map((a) => a.objectId ?? a.id));
    if (chains.size === 0) continue;
    chainsByImage.set(imageId, chains);
    annotatedImages.push(image);
  }
  annotatedImages.sort(compareImages);

  const neighboursByPair = new Map<string, ImageNeighbourType>();
  for (const neighbour of rawNeighbours) {
    if (neighbour.skipped) continue;
    neighboursByPair.set(
      pairKey(neighbour.image1Id, neighbour.image2Id),
      neighbour,
    );
  }

  // Reuse Individual ID's neighbour-graph composition. A selected pair that
  // is not a direct neighbour can still be spatially linked when both images
  // are reachable through a chain of registered homographies.
  const adjacency = buildAdjacency(rawNeighbours);
  const chainedTransformsBySource = new Map<
    string,
    Map<string, ChainedTransform>
  >();
  const getChainedTransform = (
    sourceImageId: string,
    targetImageId: string,
  ): ChainedTransform | undefined => {
    let transforms = chainedTransformsBySource.get(sourceImageId);
    if (!transforms) {
      transforms = buildChainedTransformsFromAdj(
        sourceImageId,
        adjacency,
        MAX_CHAINED_TRANSFORM_HOPS,
      );
      chainedTransformsBySource.set(sourceImageId, transforms);
    }
    return transforms.get(targetImageId);
  };

  // Chain connectivity, not camera or neighbour connectivity, defines herds.
  const herdSet = new DisjointSet();
  const firstImageByChain = new Map<string, string>();
  for (const image of annotatedImages) {
    herdSet.add(image.id);
    for (const chain of chainsByImage.get(image.id) ?? []) {
      const firstImageId = firstImageByChain.get(chain);
      if (firstImageId) herdSet.union(firstImageId, image.id);
      else firstImageByChain.set(chain, image.id);
    }
  }

  const herdImages = new Map<string, ImageType[]>();
  for (const image of annotatedImages) {
    const root = herdSet.find(image.id);
    const images = herdImages.get(root);
    if (images) images.push(image);
    else herdImages.set(root, [image]);
  }
  const herds = [...herdImages.entries()]
    .map(([herdId, images]) => ({
      herdId,
      images: images.sort(compareImages),
    }))
    .sort((a, b) => compareImages(a.images[0], b.images[0]));

  const result: HerdDisplayPair[] = [];
  // image1Id is always the earlier image and image2Id the later one. Track the
  // images already shown in each role so no image is ever the earlier half of
  // two pairs (or the later half of two pairs). Same-camera paths never repeat
  // a role; this only ever drops a redundant crossover.
  const usedAsEarlier = new Set<string>();
  const usedAsLater = new Set<string>();
  const pushPair = (pair: HerdDisplayPair): boolean => {
    if (usedAsEarlier.has(pair.image1Id) || usedAsLater.has(pair.image2Id)) {
      return false;
    }
    usedAsEarlier.add(pair.image1Id);
    usedAsLater.add(pair.image2Id);
    result.push(pair);
    return true;
  };
  const pushPairs = (pairs: HerdDisplayPair[]): void => {
    for (const pair of pairs) pushPair(pair);
  };
  for (const { herdId, images } of herds) {
    const imageIds = new Set(images.map((image) => image.id));
    const imagesByCamera = new Map<string, ImageType[]>();
    for (const image of images) {
      const camera = cameraKey(image);
      const cameraImages = imagesByCamera.get(camera);
      if (cameraImages) cameraImages.push(image);
      else imagesByCamera.set(camera, [image]);
    }
    for (const cameraImages of imagesByCamera.values()) {
      cameraImages.sort(compareImages);
    }

    const crossovers: HerdDisplayPair[] = [];
    for (const neighbour of rawNeighbours) {
      if (neighbour.skipped) continue;
      const image1 = imagesById[neighbour.image1Id];
      const image2 = imagesById[neighbour.image2Id];
      if (
        !image1 ||
        !image2 ||
        !imageIds.has(image1.id) ||
        !imageIds.has(image2.id) ||
        cameraKey(image1) === cameraKey(image2)
      ) {
        continue;
      }
      const chains1 = chainsByImage.get(image1.id);
      const chains2 = chainsByImage.get(image2.id);
      if (!chains1 || !chains2 || !intersects(chains1, chains2)) continue;
      const pair = registeredPair(herdId, neighbour, image1, image2, true);
      if (pair) crossovers.push(pair);
    }
    crossovers.sort(comparePairs);

    const cameraOrder = [...imagesByCamera.entries()]
      .sort((a, b) => compareImages(a[1][0], b[1][0]))
      .map(([camera]) => camera);
    const visited = new Set<string>();

    while (visited.size < cameraOrder.length) {
      if (visited.size === 0) {
        const firstCamera = cameraOrder[0];
        visited.add(firstCamera);
        pushPairs(
          cameraPairs(
            herdId,
            imagesByCamera.get(firstCamera) ?? [],
            chainsByImage,
            neighboursByPair,
            getChainedTransform,
          ),
        );
        continue;
      }

      // One crossover per newly introduced camera is the minimum needed.
      const crossover = crossovers.find((pair) => {
        const cameraA = cameraKey(pair.imageA);
        const cameraB = cameraKey(pair.imageB);
        return (
          (visited.has(cameraA) && !visited.has(cameraB)) ||
          (visited.has(cameraB) && !visited.has(cameraA))
        );
      });

      if (crossover) {
        // Drop the bridge pair if either endpoint already fills that role; the
        // new camera is still introduced through its own path below.
        pushPair(crossover);
        const cameraA = cameraKey(crossover.imageA);
        const cameraB = cameraKey(crossover.imageB);
        const nextCamera = visited.has(cameraA) ? cameraB : cameraA;
        visited.add(nextCamera);
        pushPairs(
          cameraPairs(
            herdId,
            imagesByCamera.get(nextCamera) ?? [],
            chainsByImage,
            neighboursByPair,
            getChainedTransform,
          ),
        );
        continue;
      }

      // The chains still define one herd, but no registered crossover reaches
      // the remaining camera. Start its camera group without inventing a pair.
      const nextCamera = cameraOrder.find((camera) => !visited.has(camera));
      if (!nextCamera) break;
      visited.add(nextCamera);
      pushPairs(
        cameraPairs(
          herdId,
          imagesByCamera.get(nextCamera) ?? [],
          chainsByImage,
          neighboursByPair,
          getChainedTransform,
        ),
      );
    }
  }

  return result;
}
