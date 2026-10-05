import type { ImageNeighbourType, ImageType } from '../schemaTypes';
import type { PixelTransform } from '../individual-id/types';

/**
 * Minimal annotation shape pulled up-front for the chain viewer. Image and
 * camera details are fetched lazily per chain via the harness, so we keep
 * the bulk fetch narrow.
 */
export interface ChainAnnotation {
  id: string;
  x: number;
  y: number;
  imageId: string;
  objectId: string | null;
  categoryId: string;
  obscured: boolean;
  /** True for "out of view" rows — animal is on this image but not visible (placeholder x/y). */
  oov: boolean;
  /** Image capture time (epoch seconds). Used to order annotations within a chain. */
  imageTimestamp: number | null;
  infoTags?: string[];
}

/**
 * A group of annotations sharing the same objectId. `primaryId` is the
 * canonical objectId for the chain. `categoryId` reflects the primary
 * annotation; secondary annotations in a chain should agree but we don't
 * enforce.
 */
export interface Chain {
  primaryId: string;
  categoryId: string;
  annotations: ChainAnnotation[];
}

/**
 * Per-annotation image / camera metadata fetched on demand the first time a
 * chain becomes the current view. Keyed by annotation id.
 */
export interface AnnotationImageMeta {
  sharedImageId?: string;
  imageId: string;
  width: number;
  height: number;
  originalPath: string | null;
  cameraId: string | null;
  cameraName: string | null;
  cameraSerial: string | null;
  sourceKey: string | null;
}

/**
 * A pair shown by the herd viewer. Camera crossovers always carry a registered
 * neighbour. Same-camera pairs are chronological chain adjacencies. They use
 * a direct neighbour homography when available, otherwise an in-memory
 * transform composed through the neighbour graph, with identity as a final
 * fallback.
 */
export interface HerdDisplayPair {
  /** Stable id of the chain-connected image component this pair belongs to. */
  herdId: string;
  image1Id: string;
  image2Id: string;
  forward: PixelTransform;
  backward: PixelTransform;
  noHomography: boolean;
  skipped: boolean;
  imageA: ImageType;
  imageB: ImageType;
  rawNeighbour?: ImageNeighbourType;
  crossover: boolean;
}
