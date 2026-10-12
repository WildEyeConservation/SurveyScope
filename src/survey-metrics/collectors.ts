import { isInOverlap } from '../individual-id/utils/transforms';
import { isOlder } from '../individual-id/utils/imageAge';
import { isWithinLocationBounds } from '../utils';
import type { PixelTransform } from '../individual-id/types';
import type {
  AnnotationRow,
  CategoryRow,
  ImageRow,
  LocationRow,
  NeighbourRow,
  ObservationRow,
  ProcessedByRow,
  RegistrationRows,
} from './types';

export type Counts = Record<string, number>;

function bump(counts: Counts, key: string, by = 1) {
  counts[key] = (counts[key] ?? 0) + by;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function range(values: Iterable<string | null>) {
  let first: string | null = null;
  let last: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (first === null || value < first) first = value;
    if (last === null || value > last) last = value;
  }
  return { first, last };
}

export const HOMOGRAPHY_BUCKETS = [
  'homography',
  'malformed',
  'skipped',
  'failed',
  'suggestedPointsOnly',
  'processedNoHomography',
  'unprocessed',
] as const;

export type HomographyBucket = (typeof HOMOGRAPHY_BUCKETS)[number];
export type HomographyCounts = Record<HomographyBucket, number>;

export function emptyHomographyCounts(): HomographyCounts {
  return {
    homography: 0,
    malformed: 0,
    skipped: 0,
    failed: 0,
    suggestedPointsOnly: 0,
    processedNoHomography: 0,
    unprocessed: 0,
  };
}

type Transforms = { forward: PixelTransform; backward: PixelTransform };

const DET_EPSILON = 1e-12;

// Row-major 3x3. mathjs is too slow to invert one matrix per pair here.
function makeTransform(m: number[]): PixelTransform {
  return ([x, y]) => {
    const w = m[6] * x + m[7] * y + m[8];
    return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
  };
}

function invert(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const ca = e * i - f * h;
  const cb = f * g - d * i;
  const cc = d * h - e * g;
  const det = a * ca + b * cb + c * cc;
  if (!Number.isFinite(det) || Math.abs(det) < DET_EPSILON) return null;
  return [
    ca / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    cb / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    cc / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
}

export function neighbourTransforms(
  neighbour: NeighbourRow
): Transforms | null {
  const h = neighbour.homography;
  if (!h || h.length !== 9 || !h.every((v) => Number.isFinite(v))) return null;
  const matrix = h as number[];
  const inverse = invert(matrix);
  if (!inverse) return null;
  return { forward: makeTransform(matrix), backward: makeTransform(inverse) };
}

export function classifyNeighbour(neighbour: NeighbourRow): HomographyBucket {
  if (neighbour.skipped) return 'skipped';
  if (neighbour.homography && neighbour.homography.length > 0) {
    return neighbourTransforms(neighbour) ? 'homography' : 'malformed';
  }
  if (neighbour.registrationFailed) return 'failed';
  if ((neighbour.suggestedPointsKept ?? 0) > 0) return 'suggestedPointsOnly';
  if (neighbour.registrationProcessed) return 'processedNoHomography';
  return 'unprocessed';
}

function componentSizes(
  neighbours: NeighbourRow[],
  buckets: HomographyBucket[],
  imageIds: Set<string>,
  usableOnly: boolean
): number[] {
  const parent = new Map<string, string>();
  for (const id of imageIds) parent.set(id, id);

  const find = (start: string): string => {
    let root = start;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let node = start;
    while (parent.get(node) !== root) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };

  neighbours.forEach((neighbour, index) => {
    if (usableOnly && buckets[index] !== 'homography') return;
    if (!parent.has(neighbour.image1Id) || !parent.has(neighbour.image2Id)) {
      return;
    }
    const a = find(neighbour.image1Id);
    const b = find(neighbour.image2Id);
    if (a !== b) parent.set(a, b);
  });

  const sizes = new Map<string, number>();
  for (const id of imageIds) {
    const root = find(id);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  return [...sizes.values()];
}

export type HomographySummary = {
  pairs: number;
  assessablePairs: number;
  counts: HomographyCounts;
  coverage: number | null;
  bySource: Counts;
  byCameraPair: Record<string, HomographyCounts>;
  registrationTimestampShare: number | null;
  pairsOutsideSurvey: number;
  graph: {
    images: number;
    imagesWithoutPairs: number;
    chains: number;
    components: number;
    largestComponent: number;
  };
  registration: {
    pairsCreated: number | null;
    pairsProcessed: number | null;
    pendingCount: number | null;
    cleanupState: string | null;
    lastKickoffAt: string | null;
    lastChangeAt: string | null;
    countersMatchPairs: boolean;
    bucketStats: number;
    bucketSuccessTotal: number;
  } | null;
};

export function summariseHomographies(
  neighbours: NeighbourRow[],
  images: ImageRow[],
  registration: RegistrationRows | null
): HomographySummary {
  const imageIds = new Set(images.map((image) => image.id));
  const counts = emptyHomographyCounts();
  const bySource: Counts = {};
  const byCameraPair: Record<string, HomographyCounts> = {};
  const paired = new Set<string>();
  let withTimestamp = 0;
  let outside = 0;

  const buckets = neighbours.map((neighbour) => {
    const bucket = classifyNeighbour(neighbour);
    counts[bucket] += 1;
    const cameraPair = neighbour.cameraPairKey || 'same-camera';
    (byCameraPair[cameraPair] ??= emptyHomographyCounts())[bucket] += 1;
    if (bucket === 'homography') {
      bump(bySource, neighbour.homographySource || 'unknown');
    }
    if (neighbour.registrationProcessed || neighbour.registrationFailed) {
      withTimestamp += 1;
    }
    if (!imageIds.has(neighbour.image2Id)) outside += 1;
    paired.add(neighbour.image1Id);
    paired.add(neighbour.image2Id);
    return bucket;
  });

  const pairs = neighbours.length;
  const assessable = pairs - counts.skipped;
  const usable = componentSizes(neighbours, buckets, imageIds, true);
  const progress = registration?.progress ?? null;

  let imagesWithoutPairs = 0;
  for (const id of imageIds) if (!paired.has(id)) imagesWithoutPairs += 1;

  return {
    pairs,
    assessablePairs: assessable,
    counts,
    coverage: ratio(counts.homography, assessable),
    bySource,
    byCameraPair,
    registrationTimestampShare: ratio(withTimestamp, pairs),
    pairsOutsideSurvey: outside,
    graph: {
      images: imageIds.size,
      imagesWithoutPairs,
      chains: componentSizes(neighbours, buckets, imageIds, false).length,
      components: usable.length,
      largestComponent: usable.reduce((max, size) => Math.max(max, size), 0),
    },
    registration: registration && {
      pairsCreated: progress?.pairsCreated ?? null,
      pairsProcessed: progress?.pairsProcessed ?? null,
      pendingCount: progress?.pendingCount ?? null,
      cleanupState: progress?.cleanupState ?? null,
      lastKickoffAt: progress?.lastKickoffAt ?? null,
      lastChangeAt: progress?.lastChangeAt ?? null,
      countersMatchPairs: progress?.pairsCreated === pairs,
      bucketStats: registration.buckets.length,
      bucketSuccessTotal: registration.buckets.reduce(
        (sum, bucket) => sum + (bucket.successCount ?? 0),
        0
      ),
    },
  };
}

export type SetHomographySummary = {
  annotatedImages: number;
  pairsWithAnnotations: number;
  counts: HomographyCounts;
  coverage: number | null;
};

export function summariseSetHomographies(
  neighbours: NeighbourRow[],
  annotations: AnnotationRow[]
): SetHomographySummary {
  const annotated = new Set(
    annotations.map((annotation) => annotation.imageId)
  );
  const counts = emptyHomographyCounts();
  let relevant = 0;
  for (const neighbour of neighbours) {
    if (
      !annotated.has(neighbour.image1Id) &&
      !annotated.has(neighbour.image2Id)
    ) {
      continue;
    }
    relevant += 1;
    counts[classifyNeighbour(neighbour)] += 1;
  }
  return {
    annotatedImages: annotated.size,
    pairsWithAnnotations: relevant,
    counts,
    coverage: ratio(counts.homography, relevant - counts.skipped),
  };
}

export type ProcessedBySummary = {
  totalImages: number | null;
  sources: { source: string; images: number; share: number | null }[];
};

export function summariseProcessedBy(
  rows: ProcessedByRow[],
  totalImages: number | null
): ProcessedBySummary {
  const bySource = new Map<string, Set<string>>();
  for (const row of rows) {
    let images = bySource.get(row.source);
    if (!images) bySource.set(row.source, (images = new Set()));
    images.add(row.imageId);
  }
  return {
    totalImages,
    sources: [...bySource.entries()]
      .map(([source, images]) => ({
        source,
        images: images.size,
        share: totalImages ? images.size / totalImages : null,
      }))
      .sort((a, b) => b.images - a.images),
  };
}

export const CONFIDENCE_BUCKET_WIDTH = 0.05;
export const CONFIDENCE_BUCKET_COUNT = 20;
export const UNSCORED = 'unscored';

export function confidenceBucketLabels(): string[] {
  const labels: string[] = [];
  for (let i = 0; i < CONFIDENCE_BUCKET_COUNT; i++) {
    labels.push((i * CONFIDENCE_BUCKET_WIDTH).toFixed(2));
  }
  labels.push(UNSCORED);
  return labels;
}

export function confidenceBucket(
  confidence: number | null | undefined
): string {
  if (confidence === null || confidence === undefined) return UNSCORED;
  if (!Number.isFinite(confidence)) return UNSCORED;
  // Epsilon keeps band edges such as 0.15 out of the band below.
  const index = Math.floor(confidence / CONFIDENCE_BUCKET_WIDTH + 1e-9);
  const clamped = Math.max(0, Math.min(CONFIDENCE_BUCKET_COUNT - 1, index));
  return (clamped * CONFIDENCE_BUCKET_WIDTH).toFixed(2);
}

// The detector writes a zero-area row for an image it found nothing in.
export function isEmptyMarker(location: LocationRow): boolean {
  return !location.width && !location.height;
}

export type DetectionSourceSummary = {
  source: string;
  detectionRows: number;
  markerRows: number;
  imagesWithDetections: number;
  imagesWithoutDetections: number;
  imagesNotProcessed: number;
  imagesWithBothMarkerAndDetection: number;
  rowsWithoutImage: number;
  confidence: Counts;
};

export type DetectionSummary = {
  totalImages: number;
  sources: DetectionSourceSummary[];
};

type DetectionTally = {
  detectionRows: number;
  markerRows: number;
  rowsWithoutImage: number;
  detected: Set<string>;
  marked: Set<string>;
  confidence: Counts;
};

export type DetectionScan = Map<string, DetectionTally>;

export function addDetection(scan: DetectionScan, location: LocationRow) {
  let tally = scan.get(location.source);
  if (!tally) {
    tally = {
      detectionRows: 0,
      markerRows: 0,
      rowsWithoutImage: 0,
      detected: new Set(),
      marked: new Set(),
      confidence: {},
    };
    scan.set(location.source, tally);
  }
  if (!location.imageId) tally.rowsWithoutImage += 1;
  if (isEmptyMarker(location)) {
    tally.markerRows += 1;
    if (location.imageId) tally.marked.add(location.imageId);
  } else {
    tally.detectionRows += 1;
    if (location.imageId) tally.detected.add(location.imageId);
    bump(tally.confidence, confidenceBucket(location.confidence));
  }
}

export function finishDetections(
  scan: DetectionScan,
  images: ImageRow[]
): DetectionSummary {
  const imageIds = new Set(images.map((image) => image.id));
  const sources = [...scan.entries()].map(([source, tally]) => {
    let both = 0;
    let accounted = 0;
    for (const id of tally.marked) if (tally.detected.has(id)) both += 1;
    for (const id of imageIds) {
      if (tally.detected.has(id) || tally.marked.has(id)) accounted += 1;
    }
    return {
      source,
      detectionRows: tally.detectionRows,
      markerRows: tally.markerRows,
      imagesWithDetections: tally.detected.size,
      imagesWithoutDetections: tally.marked.size - both,
      imagesNotProcessed: imageIds.size - accounted,
      imagesWithBothMarkerAndDetection: both,
      rowsWithoutImage: tally.rowsWithoutImage,
      confidence: tally.confidence,
    };
  });
  sources.sort((a, b) => b.detectionRows - a.detectionRows);
  return { totalImages: imageIds.size, sources };
}

export function summariseDetections(
  locations: LocationRow[],
  images: ImageRow[]
): DetectionSummary {
  const scan: DetectionScan = new Map();
  for (const location of locations) addDetection(scan, location);
  return finishDetections(scan, images);
}

export type ChainState = 'primary' | 'secondary' | 'unlinked';
export type ChainStateCounts = Record<ChainState, number>;

export function chainState(annotation: AnnotationRow): ChainState {
  if (!annotation.objectId) return 'unlinked';
  return annotation.objectId === annotation.id ? 'primary' : 'secondary';
}

function emptyChainStates(): ChainStateCounts {
  return { primary: 0, secondary: 0, unlinked: 0 };
}

export type AnnotationSummary = {
  total: number;
  imagesAnnotated: number;
  bySource: Counts;
  byOwner: Counts;
  byCategory: {
    categoryId: string;
    name: string;
    count: number;
    primary: number;
  }[];
  byState: ChainStateCounts;
  obscured: number;
  outOfView: number;
  reviewed: number;
  infoTagged: number;
  firstCreatedAt: string | null;
  lastCreatedAt: string | null;
};

export function summariseAnnotations(
  annotations: AnnotationRow[],
  categories: CategoryRow[]
): AnnotationSummary {
  const names = new Map(
    categories.map((category) => [category.id, category.name])
  );
  const images = new Set<string>();
  const bySource: Counts = {};
  const byOwner: Counts = {};
  const byCategory = new Map<string, { count: number; primary: number }>();
  const byState = emptyChainStates();
  let obscured = 0;
  let outOfView = 0;
  let reviewed = 0;
  let infoTagged = 0;

  for (const annotation of annotations) {
    images.add(annotation.imageId);
    bump(bySource, annotation.source || 'unknown');
    bump(byOwner, annotation.owner || 'unknown');
    const state = chainState(annotation);
    byState[state] += 1;
    let category = byCategory.get(annotation.categoryId);
    if (!category) {
      byCategory.set(
        annotation.categoryId,
        (category = { count: 0, primary: 0 })
      );
    }
    category.count += 1;
    if (state === 'primary') category.primary += 1;
    if (annotation.obscured) obscured += 1;
    if (annotation.oov) outOfView += 1;
    if (annotation.reviewedBy) reviewed += 1;
    if (annotation.infoTaggedBy) infoTagged += 1;
  }

  const created = range(annotations.map((annotation) => annotation.createdAt));
  return {
    total: annotations.length,
    imagesAnnotated: images.size,
    bySource,
    byOwner,
    byCategory: [...byCategory.entries()]
      .map(([categoryId, value]) => ({
        categoryId,
        name: names.get(categoryId) ?? categoryId,
        ...value,
      }))
      .sort((a, b) => b.count - a.count),
    byState,
    obscured,
    outOfView,
    reviewed,
    infoTagged,
    firstCreatedAt: created.first,
    lastCreatedAt: created.last,
  };
}

export type ObservationSummary = {
  total: number;
  locationsObserved: number;
  bySource: Counts;
  byOwner: Counts;
  firstCreatedAt: string | null;
  lastCreatedAt: string | null;
};

export function summariseObservations(
  observations: ObservationRow[]
): ObservationSummary {
  const locations = new Set<string>();
  const bySource: Counts = {};
  const byOwner: Counts = {};
  for (const observation of observations) {
    locations.add(observation.locationId);
    bump(bySource, observation.source || 'unspecified');
    bump(byOwner, observation.owner || 'unknown');
  }
  const created = range(
    observations.map((observation) => observation.createdAt)
  );
  return {
    total: observations.length,
    locationsObserved: locations.size,
    bySource,
    byOwner,
    firstCreatedAt: created.first,
    lastCreatedAt: created.last,
  };
}

export type ConfidenceBand = {
  locations: number;
  observed: number;
  annotated: number;
  observedAndAnnotated: number;
};

export type ConfidenceCoverageSource = {
  source: string;
  bands: Record<string, ConfidenceBand>;
  totals: ConfidenceBand;
  lowestObservedBand: string | null;
};

export type ConfidenceCoverage = {
  labels: string[];
  sources: ConfidenceCoverageSource[];
  observedOutsideDetections: number;
};

function emptyBand(): ConfidenceBand {
  return { locations: 0, observed: 0, annotated: 0, observedAndAnnotated: 0 };
}

function groupAnnotationsByImage(annotations: AnnotationRow[]) {
  const byImage = new Map<string, AnnotationRow[]>();
  for (const annotation of annotations) {
    const list = byImage.get(annotation.imageId);
    if (list) list.push(annotation);
    else byImage.set(annotation.imageId, [annotation]);
  }
  return byImage;
}

export type ConfidenceCoverageScan = {
  add: (location: LocationRow) => void;
  finish: () => ConfidenceCoverage;
};

export function scanConfidenceCoverage(
  observations: ObservationRow[],
  annotations: AnnotationRow[]
): ConfidenceCoverageScan {
  const labels = confidenceBucketLabels();
  const observed = new Set(
    observations.map((observation) => observation.locationId)
  );
  const byImage = groupAnnotationsByImage(annotations);
  const bySource = new Map<string, Record<string, ConfidenceBand>>();
  let matchedObserved = 0;

  const add = (location: LocationRow) => {
    if (isEmptyMarker(location)) return;
    let bands = bySource.get(location.source);
    if (!bands) {
      bands = Object.fromEntries(labels.map((label) => [label, emptyBand()]));
      bySource.set(location.source, bands);
    }
    const band = bands[confidenceBucket(location.confidence)];
    const isObserved = observed.has(location.id);
    const imageAnnotations = location.imageId
      ? byImage.get(location.imageId)
      : undefined;
    const isAnnotated =
      imageAnnotations?.some((annotation) =>
        isWithinLocationBounds(annotation, location)
      ) ?? false;
    band.locations += 1;
    if (isObserved) {
      band.observed += 1;
      matchedObserved += 1;
    }
    if (isAnnotated) band.annotated += 1;
    if (isObserved && isAnnotated) band.observedAndAnnotated += 1;
  };

  const finish = (): ConfidenceCoverage => {
    const sources = [...bySource.entries()].map(([source, bands]) => {
      const totals = emptyBand();
      let lowestObservedBand: string | null = null;
      for (const label of labels) {
        const band = bands[label];
        totals.locations += band.locations;
        totals.observed += band.observed;
        totals.annotated += band.annotated;
        totals.observedAndAnnotated += band.observedAndAnnotated;
        if (
          lowestObservedBand === null &&
          label !== UNSCORED &&
          band.observed > 0
        ) {
          lowestObservedBand = label;
        }
      }
      return { source, bands, totals, lowestObservedBand };
    });
    sources.sort((a, b) => b.totals.locations - a.totals.locations);
    return {
      labels,
      sources,
      observedOutsideDetections: observed.size - matchedObserved,
    };
  };

  return { add, finish };
}

export function summariseConfidenceCoverage(
  locations: LocationRow[],
  observations: ObservationRow[],
  annotations: AnnotationRow[]
): ConfidenceCoverage {
  const scan = scanConfidenceCoverage(observations, annotations);
  for (const location of locations) scan.add(location);
  return scan.finish();
}

export const DEFAULT_MATCH_RADIUS = 40;

type MatchPoint = { id: string; x: number; y: number; categoryId: string };

export function greedyMatch(
  sources: MatchPoint[],
  targets: MatchPoint[],
  radius: number
): Map<string, string> {
  const radiusSquared = radius * radius;
  const candidates: { distance: number; source: string; target: string }[] = [];
  for (const source of sources) {
    if (!Number.isFinite(source.x) || !Number.isFinite(source.y)) continue;
    for (const target of targets) {
      if (source.categoryId !== target.categoryId) continue;
      const dx = source.x - target.x;
      const dy = source.y - target.y;
      const distance = dx * dx + dy * dy;
      if (distance <= radiusSquared) {
        candidates.push({ distance, source: source.id, target: target.id });
      }
    }
  }
  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) ||
      (a.target < b.target ? -1 : a.target > b.target ? 1 : 0)
  );
  const matched = new Map<string, string>();
  const usedTargets = new Set<string>();
  for (const candidate of candidates) {
    if (matched.has(candidate.source) || usedTargets.has(candidate.target)) {
      continue;
    }
    matched.set(candidate.source, candidate.target);
    usedTargets.add(candidate.target);
  }
  return matched;
}

function sameChain(later: AnnotationRow, earlier: AnnotationRow): boolean {
  if (later.objectId && later.objectId === earlier.id) return true;
  if (earlier.objectId && earlier.objectId === later.id) return true;
  return Boolean(later.objectId) && later.objectId === earlier.objectId;
}

export type ChainLinkRecommendation =
  | 'unknown'
  | 'investigate-coverage'
  | 'run-chain-linker'
  | 'skip';

export type ChainLinkSummary = {
  matchRadius: number;
  pairsAssessed: number;
  pairsNoHomography: number;
  pairsSkipped: number;
  pairsMissingImageMetadata: number;
  pairsUnordered: number;
  pairsNoOverlapAnnotations: number;
  overlapAnnotations: number;
  overlapByState: ChainStateCounts;
  linked: number;
  duplicated: number;
  absentFromEarlier: number;
  absentByState: ChainStateCounts;
  setByState: ChainStateCounts;
  nonOverlapByState: ChainStateCounts;
  allOverlapUnlinked: boolean;
  duplicationRate: number | null;
  absentRate: number | null;
  verdict: { recommendation: ChainLinkRecommendation; reason: string };
};

function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function chainLinkVerdict(
  summary: Omit<ChainLinkSummary, 'verdict'>
): ChainLinkSummary['verdict'] {
  const matches = summary.linked + summary.duplicated;
  if (summary.pairsAssessed === 0) {
    return {
      recommendation: 'unknown',
      reason:
        'No image pair had a usable homography and annotations in the overlap.',
    };
  }
  if (matches < 20) {
    return {
      recommendation: 'unknown',
      reason: `Only ${matches} annotation(s) could be compared across overlaps; too few to conclude anything.`,
    };
  }
  const absent = summary.absentRate ?? 0;
  if (absent > 0.5) {
    return {
      recommendation: 'investigate-coverage',
      reason: `${percent(
        absent
      )} of overlap annotations have nothing annotated near them in the earlier image, so the duplicate counts describe only a small slice of the survey.`,
    };
  }
  if (summary.allOverlapUnlinked) {
    return {
      recommendation: 'run-chain-linker',
      reason: `${summary.duplicated.toLocaleString()} of ${summary.overlapAnnotations.toLocaleString()} unlinked overlap annotations have an annotated counterpart in the earlier image; each is currently counted as a separate individual.`,
    };
  }
  const rate = summary.duplicationRate ?? 0;
  if (rate < 0.05) {
    return {
      recommendation: 'skip',
      reason: `${percent(
        rate,
        1
      )} of matched overlap annotations are unlinked duplicates; linking already worked during annotation.`,
    };
  }
  return {
    recommendation: 'run-chain-linker',
    reason: `${percent(
      rate
    )} of matched overlap annotations are counted twice (~${summary.duplicated.toLocaleString()} duplicate sightings).`,
  };
}

type Outcome = 'linked' | 'duplicated' | 'absent';
const OUTCOME_RANK: Record<Outcome, number> = {
  absent: 0,
  duplicated: 1,
  linked: 2,
};

export function summariseChainLinking(
  neighbours: NeighbourRow[],
  images: ImageRow[],
  annotations: AnnotationRow[],
  matchRadius = DEFAULT_MATCH_RADIUS
): ChainLinkSummary {
  const imageById = new Map(images.map((image) => [image.id, image]));
  const byImage = groupAnnotationsByImage(
    annotations.filter((annotation) => !annotation.oov)
  );
  const outcomes = new Map<string, Outcome>();
  const summary = {
    matchRadius,
    pairsAssessed: 0,
    pairsNoHomography: 0,
    pairsSkipped: 0,
    pairsMissingImageMetadata: 0,
    pairsUnordered: 0,
    pairsNoOverlapAnnotations: 0,
    overlapAnnotations: 0,
    overlapByState: emptyChainStates(),
    linked: 0,
    duplicated: 0,
    absentFromEarlier: 0,
    absentByState: emptyChainStates(),
    setByState: emptyChainStates(),
    nonOverlapByState: emptyChainStates(),
    allOverlapUnlinked: false,
    duplicationRate: null as number | null,
    absentRate: null as number | null,
  };

  for (const neighbour of neighbours) {
    if (neighbour.skipped) {
      summary.pairsSkipped += 1;
      continue;
    }
    const transforms = neighbourTransforms(neighbour);
    if (!transforms) {
      summary.pairsNoHomography += 1;
      continue;
    }
    const image1 = imageById.get(neighbour.image1Id);
    const image2 = imageById.get(neighbour.image2Id);
    if (!image1?.width || !image1.height || !image2?.width || !image2.height) {
      summary.pairsMissingImageMetadata += 1;
      continue;
    }

    let earlier: ImageRow;
    let later: ImageRow;
    let earlierToLater: PixelTransform;
    let laterToEarlier: PixelTransform;
    if (isOlder(image1, image2)) {
      [earlier, later] = [image1, image2];
      [earlierToLater, laterToEarlier] = [
        transforms.forward,
        transforms.backward,
      ];
    } else if (isOlder(image2, image1)) {
      [earlier, later] = [image2, image1];
      [earlierToLater, laterToEarlier] = [
        transforms.backward,
        transforms.forward,
      ];
    } else {
      summary.pairsUnordered += 1;
      continue;
    }

    const overlap = (byImage.get(later.id) ?? []).filter((annotation) =>
      isInOverlap(
        annotation.x,
        annotation.y,
        earlierToLater,
        earlier.width!,
        earlier.height!
      )
    );
    if (overlap.length === 0) {
      summary.pairsNoOverlapAnnotations += 1;
      continue;
    }

    const earlierAnnotations = byImage.get(earlier.id) ?? [];
    const linkedTargets = new Set<string>();
    const unlinked: AnnotationRow[] = [];
    for (const annotation of overlap) {
      const counterpart = earlierAnnotations.find(
        (candidate) =>
          !linkedTargets.has(candidate.id) && sameChain(annotation, candidate)
      );
      if (counterpart) {
        linkedTargets.add(counterpart.id);
        outcomes.set(annotation.id, 'linked');
      } else {
        unlinked.push(annotation);
      }
    }
    const matches = greedyMatch(
      unlinked.map((annotation) => {
        const [x, y] = laterToEarlier([annotation.x, annotation.y]);
        return { id: annotation.id, x, y, categoryId: annotation.categoryId };
      }),
      earlierAnnotations.filter(
        (candidate) => !linkedTargets.has(candidate.id)
      ),
      matchRadius
    );

    summary.pairsAssessed += 1;
    for (const annotation of unlinked) {
      const outcome: Outcome = matches.has(annotation.id)
        ? 'duplicated'
        : 'absent';
      const previous = outcomes.get(annotation.id);
      if (!previous || OUTCOME_RANK[outcome] > OUTCOME_RANK[previous]) {
        outcomes.set(annotation.id, outcome);
      }
    }
  }

  for (const annotation of annotations) {
    const state = chainState(annotation);
    summary.setByState[state] += 1;
    const outcome = outcomes.get(annotation.id);
    if (!outcome) {
      summary.nonOverlapByState[state] += 1;
      continue;
    }
    summary.overlapAnnotations += 1;
    summary.overlapByState[state] += 1;
    if (outcome === 'linked') summary.linked += 1;
    else if (outcome === 'duplicated') summary.duplicated += 1;
    else {
      summary.absentFromEarlier += 1;
      summary.absentByState[state] += 1;
    }
  }

  const matches = summary.linked + summary.duplicated;
  // Unlinked individual-id overlaps make the duplication rate uninformative.
  summary.allOverlapUnlinked =
    summary.overlapAnnotations > 0 &&
    summary.overlapByState.primary === 0 &&
    summary.overlapByState.secondary === 0;
  summary.duplicationRate =
    matches > 0 && !summary.allOverlapUnlinked
      ? summary.duplicated / matches
      : null;
  summary.absentRate = ratio(
    summary.absentFromEarlier,
    summary.overlapAnnotations
  );

  return { ...summary, verdict: chainLinkVerdict(summary) };
}
