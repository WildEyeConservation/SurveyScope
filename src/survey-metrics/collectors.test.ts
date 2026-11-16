import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyNeighbour,
  confidenceBucket,
  confidenceBucketLabels,
  greedyMatch,
  summariseAnnotations,
  summariseChainLinking,
  summariseConfidenceCoverage,
  summariseDetections,
  summariseHomographies,
  summariseProcessedBy,
  summariseSetHomographies,
} from './collectors';
import type {
  AnnotationRow,
  ImageRow,
  LocationRow,
  NeighbourRow,
  ObservationRow,
} from './types';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
// Maps image1 pixels to image2 pixels: image2 sits 500px to the right.
const SHIFT = [1, 0, -500, 0, 1, 0, 0, 0, 1];

function image(id: string, timestamp: number | null = 0): ImageRow {
  return {
    id,
    width: 1000,
    height: 1000,
    timestamp,
    originalPath: `${id}.jpg`,
    cameraId: null,
  };
}

function neighbour(
  image1Id: string,
  image2Id: string,
  patch: Partial<NeighbourRow> = {},
): NeighbourRow {
  return {
    image1Id,
    image2Id,
    homography: null,
    homographySource: null,
    skipped: false,
    suggestedPointsKept: null,
    cameraPairKey: null,
    registrationProcessed: false,
    registrationFailed: false,
    ...patch,
  };
}

function annotation(
  id: string,
  imageId: string,
  x: number,
  y: number,
  patch: Partial<AnnotationRow> = {},
): AnnotationRow {
  return {
    id,
    imageId,
    categoryId: 'cat',
    objectId: null,
    x,
    y,
    source: 'manual',
    oov: false,
    obscured: false,
    owner: 'user',
    reviewedBy: null,
    infoTaggedBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...patch,
  };
}

function location(id: string, patch: Partial<LocationRow> = {}): LocationRow {
  return {
    id,
    imageId: 'a',
    x: 100,
    y: 100,
    width: 50,
    height: 50,
    source: 'scoutbotv3',
    confidence: 0.5,
    ...patch,
  };
}

test('classifies each pair into one bucket in priority order', () => {
  assert.equal(
    classifyNeighbour(
      neighbour('a', 'b', { skipped: true, homography: IDENTITY }),
    ),
    'skipped',
  );
  assert.equal(
    classifyNeighbour(neighbour('a', 'b', { homography: IDENTITY })),
    'homography',
  );
  assert.equal(
    classifyNeighbour(neighbour('a', 'b', { homography: [1, 2, 3] })),
    'malformed',
  );
  assert.equal(
    classifyNeighbour(
      neighbour('a', 'b', { homography: [0, 0, 0, 0, 0, 0, 0, 0, 0] }),
    ),
    'malformed',
  );
  assert.equal(
    classifyNeighbour(
      neighbour('a', 'b', { registrationFailed: true, suggestedPointsKept: 4 }),
    ),
    'failed',
  );
  assert.equal(
    classifyNeighbour(
      neighbour('a', 'b', {
        suggestedPointsKept: 4,
        registrationProcessed: true,
      }),
    ),
    'suggestedPointsOnly',
  );
  assert.equal(
    classifyNeighbour(neighbour('a', 'b', { registrationProcessed: true })),
    'processedNoHomography',
  );
  assert.equal(classifyNeighbour(neighbour('a', 'b')), 'unprocessed');
});

test('summarises homography coverage, sources and graph fragmentation', () => {
  const images = ['a', 'b', 'c', 'd', 'e'].map((id) => image(id));
  const neighbours = [
    neighbour('a', 'b', { homography: IDENTITY, homographySource: 'manual' }),
    neighbour('b', 'c', { registrationFailed: true, cameraPairKey: 'x#y' }),
    neighbour('c', 'd', { skipped: true }),
  ];
  const summary = summariseHomographies(neighbours, images, {
    progress: {
      pairsCreated: 3,
      pairsProcessed: 2,
      pendingCount: 0,
      lastKickoffAt: null,
      lastChangeAt: null,
      cleanupState: 'done',
    },
    buckets: [{ cameraPairKey: 'x#y', bucketIndex: 0, successCount: 2 }],
  });

  assert.equal(summary.pairs, 3);
  assert.equal(summary.assessablePairs, 2);
  assert.equal(summary.coverage, 0.5);
  assert.deepEqual(summary.bySource, { manual: 1 });
  assert.equal(summary.byCameraPair['x#y'].failed, 1);
  assert.equal(summary.byCameraPair['same-camera'].homography, 1);
  assert.deepEqual(summary.graph, {
    images: 5,
    imagesWithoutPairs: 1,
    chains: 2,
    components: 4,
    largestComponent: 2,
  });
  assert.equal(summary.registration?.countersMatchPairs, true);
  assert.equal(summary.registration?.bucketSuccessTotal, 2);
});

test('limits set homographies to pairs touching an annotated image', () => {
  const summary = summariseSetHomographies(
    [
      neighbour('a', 'b', { homography: IDENTITY }),
      neighbour('b', 'c'),
      neighbour('c', 'd', { homography: IDENTITY }),
    ],
    [annotation('1', 'b', 1, 1)],
  );
  assert.equal(summary.pairsWithAnnotations, 2);
  assert.equal(summary.counts.homography, 1);
  assert.equal(summary.coverage, 0.5);
});

test('counts distinct images per processed-by source', () => {
  const summary = summariseProcessedBy(
    [
      { imageId: 'a', source: 'scoutbotv3' },
      { imageId: 'a', source: 'scoutbotv3' },
      { imageId: 'b', source: 'scoutbotv3' },
      { imageId: 'a', source: 'mad-v2' },
    ],
    4,
  );
  assert.deepEqual(summary.sources, [
    { source: 'scoutbotv3', images: 2, share: 0.5 },
    { source: 'mad-v2', images: 1, share: 0.25 },
  ]);
});

function observation(
  locationId: string,
  patch: Partial<ObservationRow> = {},
): ObservationRow {
  return {
    locationId,
    owner: 'u',
    source: null,
    createdAt: null,
    imageId: null,
    x: null,
    y: null,
    width: null,
    height: null,
    ...patch,
  };
}

test('puts band edges in the band they open', () => {
  assert.equal(confidenceBucket(0.15), '0.15');
  assert.equal(confidenceBucket(0.3), '0.30');
  assert.equal(confidenceBucket(1), '0.95');
  assert.equal(confidenceBucket(0), '0.00');
  assert.equal(confidenceBucket(null), 'unscored');
});

test('buckets confidence into 0.02 bands', () => {
  assert.equal(confidenceBucket(0.06, 0.02), '0.06');
  assert.equal(confidenceBucket(0.935, 0.02), '0.92');
  assert.equal(confidenceBucket(1, 0.02), '0.98');
  assert.equal(confidenceBucketLabels(0.02).length, 51);
});

test('uses each source its own band width', () => {
  const coverage = summariseConfidenceCoverage(
    [
      location('owl', { source: 'owl-d-v1', confidence: 0.93 }),
      location('mad', { source: 'mad-v2', confidence: 0.93 }),
    ],
    [],
    [],
    (source) => (source.startsWith('owl-d') ? 0.02 : 0.05),
  );
  const bySource = Object.fromEntries(
    coverage.sources.map((source) => [source.source, source]),
  );
  assert.equal(bySource['owl-d-v1'].bands['0.92'].locations, 1);
  assert.equal(bySource['mad-v2'].bands['0.90'].locations, 1);
  assert.equal(bySource['owl-d-v1'].bandWidth, 0.02);
});

test('separates empty-image markers from detections', () => {
  const marker = { width: 0, height: 0, confidence: 0, x: 0, y: 0 };
  const summary = summariseDetections(
    [
      location('1', { imageId: 'a' }),
      location('2', { imageId: 'a', confidence: 0.92 }),
      location('3', { imageId: 'b', ...marker }),
      location('4', { imageId: 'b', ...marker }),
      location('5', { imageId: 'a', ...marker }),
    ],
    [image('a'), image('b'), image('c')],
  );
  assert.equal(summary.sources.length, 1);
  const source = summary.sources[0];
  assert.equal(source.detectionRows, 2);
  assert.equal(source.markerRows, 3);
  assert.equal(source.imagesWithDetections, 1);
  assert.equal(source.imagesWithoutDetections, 1);
  assert.equal(source.imagesNotProcessed, 1);
  assert.equal(source.imagesWithBothMarkerAndDetection, 1);
  assert.deepEqual(source.confidence, { '0.50': 1, '0.90': 1 });
});

test('summarises annotations by source, category and chain state', () => {
  const summary = summariseAnnotations(
    [
      annotation('1', 'a', 1, 1, { objectId: '1' }),
      annotation('2', 'b', 1, 1, { objectId: '1', source: 'individual-id' }),
      annotation('3', 'b', 1, 1, { categoryId: 'other', oov: true }),
    ],
    [{ id: 'cat', name: 'Elephant' }],
  );
  assert.equal(summary.total, 3);
  assert.equal(summary.imagesAnnotated, 2);
  assert.deepEqual(summary.byState, { primary: 1, secondary: 1, unlinked: 1 });
  assert.deepEqual(summary.bySource, { manual: 2, 'individual-id': 1 });
  assert.deepEqual(summary.byCategory, [
    { categoryId: 'cat', name: 'Elephant', count: 2, primary: 1 },
    { categoryId: 'other', name: 'other', count: 1, primary: 0 },
  ]);
  assert.equal(summary.outOfView, 1);
});

test('reports observed and annotated detections per confidence band', () => {
  const coverage = summariseConfidenceCoverage(
    [
      location('high', { confidence: 0.9 }),
      location('low', { confidence: 0.2, x: 500, y: 500 }),
      location('unseen', { confidence: 0.2, x: 800, y: 800 }),
      location('marker', { width: 0, height: 0, confidence: 0 }),
    ],
    [observation('high'), observation('low'), observation('tile')],
    [annotation('1', 'a', 110, 90)],
  );
  assert.equal(coverage.sources.length, 1);
  const source = coverage.sources[0];
  assert.deepEqual(source.totals, {
    locations: 3,
    observed: 2,
    annotated: 1,
    observedAndAnnotated: 1,
    insideObserved: 0,
  });
  assert.deepEqual(source.bands['0.20'], {
    locations: 2,
    observed: 1,
    annotated: 0,
    observedAndAnnotated: 0,
    insideObserved: 0,
    cumulativeLocations: 3,
    completedDownTo: 2 / 3,
    precision: 0,
    countingSkipped: { completedDownTo: 2 / 3, precision: 0 },
  });
  assert.equal(source.bands['0.90'].cumulativeLocations, 1);
  assert.equal(source.bands['0.90'].completedDownTo, 1);
  assert.equal(source.bands['0.90'].precision, 1);
  assert.equal(source.bands['0.50'].cumulativeLocations, 1);
  assert.equal(source.bands['0.50'].precision, null);
  assert.equal(source.bands['0.95'].completedDownTo, null);
  assert.equal(source.lowestObservedBand, '0.20');
  assert.equal(coverage.observedOutsideDetections, 1);
});

test('measures precision on observed detections only', () => {
  const coverage = summariseConfidenceCoverage(
    [
      location('hit', { confidence: 0.9 }),
      location('miss', { confidence: 0.9, x: 500, y: 500 }),
      location('unseen', { confidence: 0.9, x: 110, y: 110 }),
      location('unscored', { confidence: null, x: 500, y: 500 }),
    ],
    [observation('hit'), observation('miss')],
    [annotation('1', 'a', 110, 90)],
  );
  const { bands } = coverage.sources[0];
  assert.equal(bands['0.90'].annotated, 2);
  assert.equal(bands['0.90'].precision, 0.5);
  assert.equal(bands['0.90'].cumulativeLocations, 3);
  assert.equal(bands['0.90'].completedDownTo, 2 / 3);
  assert.deepEqual(bands['0.90'].countingSkipped, {
    completedDownTo: 1,
    precision: 2 / 3,
  });
  assert.equal(bands.unscored.cumulativeLocations, null);
  assert.equal(bands.unscored.completedDownTo, null);
});

test('skipping annotated detections needs an observed rate for the rest', () => {
  const coverage = summariseConfidenceCoverage(
    [
      location('known', { confidence: 0.9 }),
      location('unseen', { confidence: 0.9, x: 500, y: 500 }),
      location('all-known', { confidence: 0.4 }),
    ],
    [],
    [annotation('1', 'a', 110, 90)],
  );
  const { bands } = coverage.sources[0];
  assert.equal(bands['0.90'].precision, null);
  assert.deepEqual(bands['0.90'].countingSkipped, {
    completedDownTo: 0.5,
    precision: null,
  });
  assert.deepEqual(bands['0.40'].countingSkipped, {
    completedDownTo: 2 / 3,
    precision: 1,
  });
});

test('counts a detection centred inside an observed box as reviewed', () => {
  const seen = { imageId: 'a', x: 100, y: 100, width: 200, height: 200 };
  const coverage = summariseConfidenceCoverage(
    [
      location('seen', { confidence: 0.9, ...seen }),
      location('inner', { confidence: 0.9, x: 150, y: 150 }),
      location('outer', { confidence: 0.9, x: 600, y: 600 }),
    ],
    [observation('seen', seen), observation('seen', seen)],
    [annotation('1', 'a', 100, 100)],
  );
  const band = coverage.sources[0].bands['0.90'];
  assert.equal(band.observed, 1);
  assert.equal(band.insideObserved, 1);
  assert.equal(band.completedDownTo, 1 / 3);
  assert.equal(band.precision, 1);
  assert.deepEqual(band.countingSkipped, {
    completedDownTo: 2 / 3,
    precision: 2 / 3,
  });
});

test('counts an annotation on the detection box edge as inside it', () => {
  const coverage = summariseConfidenceCoverage(
    [location('edge')],
    [],
    [annotation('1', 'a', 125, 100)],
  );
  assert.equal(coverage.sources[0].totals.annotated, 1);
});

test('matches nearest pairs first within a category', () => {
  const matches = greedyMatch(
    [
      { id: 's1', x: 0, y: 0, categoryId: 'cat' },
      { id: 's2', x: 10, y: 0, categoryId: 'cat' },
      { id: 's3', x: 0, y: 0, categoryId: 'other' },
    ],
    [
      { id: 't1', x: 9, y: 0, categoryId: 'cat' },
      { id: 't2', x: 300, y: 0, categoryId: 'cat' },
    ],
    40,
  );
  assert.deepEqual([...matches], [['s2', 't1']]);
});

test('finds unlinked duplicates in overlaps and recommends chain linking', () => {
  const images = [image('early', 1), image('late', 2)];
  const neighbours = [neighbour('early', 'late', { homography: SHIFT })];
  const annotations: AnnotationRow[] = [];
  for (let i = 0; i < 25; i++) {
    const y = 20 + i * 35;
    annotations.push(
      annotation(`e${i}`, 'early', 700, y, { objectId: `e${i}` }),
    );
    annotations.push(annotation(`l${i}`, 'late', 205, y));
  }
  // Outside the earlier image's footprint.
  annotations.push(annotation('far', 'late', 900, 500));

  const summary = summariseChainLinking(neighbours, images, annotations);
  assert.equal(summary.pairsAssessed, 1);
  assert.equal(summary.overlapAnnotations, 25);
  assert.equal(summary.duplicated, 25);
  assert.equal(summary.linked, 0);
  assert.equal(summary.allOverlapUnlinked, true);
  assert.equal(summary.duplicationRate, null);
  assert.equal(summary.nonOverlapByState.unlinked, 1);
  assert.equal(summary.verdict.recommendation, 'run-chain-linker');
});

test('treats linked overlap annotations as already deduplicated', () => {
  const images = [image('early', 1), image('late', 2)];
  // Stored the other way round: image1 is the later image.
  const neighbours = [
    neighbour('late', 'early', { homography: [1, 0, 500, 0, 1, 0, 0, 0, 1] }),
  ];
  const annotations: AnnotationRow[] = [];
  for (let i = 0; i < 25; i++) {
    const y = 20 + i * 35;
    annotations.push(
      annotation(`e${i}`, 'early', 700, y, { objectId: `e${i}` }),
    );
    annotations.push(
      annotation(`l${i}`, 'late', 200, y, { objectId: `e${i}` }),
    );
  }

  const summary = summariseChainLinking(neighbours, images, annotations);
  assert.equal(summary.linked, 25);
  assert.equal(summary.duplicated, 0);
  assert.equal(summary.duplicationRate, 0);
  assert.equal(summary.verdict.recommendation, 'skip');
});

test('does not assess pairs that cannot be ordered or lack a homography', () => {
  const summary = summariseChainLinking(
    [
      neighbour('a', 'b', { homography: IDENTITY }),
      neighbour('b', 'c'),
      neighbour('c', 'd', { homography: IDENTITY, skipped: true }),
    ],
    [image('a', null), image('b', 1), image('c', 2), image('d', 3)],
    [annotation('1', 'b', 10, 10)],
  );
  assert.equal(summary.pairsUnordered, 1);
  assert.equal(summary.pairsNoHomography, 1);
  assert.equal(summary.pairsSkipped, 1);
  assert.equal(summary.verdict.recommendation, 'unknown');
});

function overlapSet(counts: {
  linked?: number;
  duplicated?: number;
  absent?: number;
}) {
  const annotations: AnnotationRow[] = [];
  let row = 0;
  const add = (kind: string, count = 0) => {
    for (let i = 0; i < count; i++, row++) {
      const y = 10 + row * 19;
      const id = `${kind}${i}`;
      if (kind !== 'absent') {
        annotations.push(
          annotation(`e-${id}`, 'early', 700, y, { objectId: `e-${id}` }),
        );
      }
      annotations.push(
        annotation(`l-${id}`, 'late', 200, y, {
          objectId: kind === 'linked' ? `e-${id}` : null,
        }),
      );
    }
  };
  add('linked', counts.linked);
  add('duplicated', counts.duplicated);
  add('absent', counts.absent);
  return summariseChainLinking(
    [neighbour('early', 'late', { homography: SHIFT })],
    [image('early', 1), image('late', 2)],
    annotations,
    8,
  );
}

test('recommends chain linking when a share of matches is unlinked', () => {
  const summary = overlapSet({ linked: 20, duplicated: 5 });
  assert.equal(summary.linked, 20);
  assert.equal(summary.duplicated, 5);
  assert.equal(summary.duplicationRate, 0.2);
  assert.equal(summary.verdict.recommendation, 'run-chain-linker');
});

test('flags coverage when most overlap annotations have no counterpart', () => {
  const summary = overlapSet({ duplicated: 20, absent: 25 });
  assert.equal(summary.absentFromEarlier, 25);
  assert.equal(summary.verdict.recommendation, 'investigate-coverage');
});

test('draws no conclusion from a handful of matches', () => {
  const summary = overlapSet({ linked: 3, duplicated: 2 });
  assert.equal(summary.verdict.recommendation, 'unknown');
});

test('keeps existing links when a nearer animal could steal the match', () => {
  const annotations: AnnotationRow[] = [];
  for (let i = 0; i < 25; i++) {
    const y = 20 + i * 35;
    annotations.push(
      annotation(`e${i}`, 'early', 700, y, { objectId: `e${i}` }),
    );
    // 22px registration residual towards the next animal.
    annotations.push(
      annotation(`l${i}`, 'late', 200, y + 22, { objectId: `e${i}` }),
    );
  }
  const summary = summariseChainLinking(
    [neighbour('early', 'late', { homography: SHIFT })],
    [image('early', 1), image('late', 2)],
    annotations,
  );
  assert.equal(summary.linked, 25);
  assert.equal(summary.duplicated, 0);
  assert.equal(summary.verdict.recommendation, 'skip');
});

test('counts an annotation once when it overlaps several earlier images', () => {
  const summary = summariseChainLinking(
    [
      neighbour('a', 'b', { homography: IDENTITY }),
      neighbour('a', 'c', { homography: IDENTITY }),
      neighbour('b', 'c', { homography: IDENTITY }),
    ],
    [image('a', 1), image('b', 2), image('c', 3)],
    [
      annotation('1', 'a', 100, 100),
      annotation('2', 'b', 100, 100),
      annotation('3', 'c', 100, 100),
    ],
  );
  assert.equal(summary.pairsAssessed, 3);
  assert.equal(summary.overlapAnnotations, 2);
  assert.equal(summary.duplicated, 2);
  assert.deepEqual(summary.overlapByState, {
    primary: 0,
    secondary: 0,
    unlinked: 2,
  });
  assert.deepEqual(summary.nonOverlapByState, {
    primary: 0,
    secondary: 0,
    unlinked: 1,
  });
  assert.deepEqual(summary.setByState, {
    primary: 0,
    secondary: 0,
    unlinked: 3,
  });
});
