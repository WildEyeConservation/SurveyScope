import test from 'node:test';
import assert from 'node:assert/strict';
import { SurveyAccumulator } from './compute.js';

function createAccumulator(
  transectIds: string[] = ['transect-1']
): SurveyAccumulator {
  return new SurveyAccumulator({
    surveyId: 'survey-1',
    annotationSetId: 'set-1',
    organizationId: 'org-1',
    categoryIds: ['seen', 'empty'],
    cameras: [
      {
        id: 'camera-1',
        focalLengthMm: 50,
        sensorWidthMm: 36,
        tiltDegrees: 0,
      },
      {
        id: 'camera-2',
        focalLengthMm: 50,
        sensorWidthMm: 36,
        tiltDegrees: 25,
      },
    ],
    strata: [
      {
        id: 'stratum-1',
        name: 'Stratum 1',
        area: 10,
        baselineLength: 1_000,
      },
    ],
    transects: transectIds.map((id) => ({
      id,
      stratumId: 'stratum-1',
    })),
    now: () => '2026-07-30T00:00:00.000Z',
  });
}

// Two images one second apart, offset south by `index` transects.
function addTransectPair(
  accumulator: SurveyAccumulator,
  transectId: string,
  index: number,
  seenAnnotations: number
): void {
  for (const step of [0, 1]) {
    accumulator.addImage({
      id: `${transectId}-image-${step}`,
      transectId,
      cameraId: 'camera-1',
      latitude: -33 - index / 100 - step / 1_000,
      longitude: 18,
      altitude_agl: 100,
      timestamp: step + 1,
    });
  }
  for (let count = 0; count < seenAnnotations; count += 1) {
    accumulator.addAnnotation({
      id: `${transectId}-annotation-${count}`,
      objectId: `${transectId}-annotation-${count}`,
      imageId: `${transectId}-image-0`,
      categoryId: 'seen',
    });
  }
}

test('calculation emits explicit zero rows for requested empty categories', () => {
  const accumulator = createAccumulator();
  accumulator.addImage({
    id: 'image-1',
    transectId: 'transect-1',
    cameraId: 'camera-1',
    latitude: -33,
    longitude: 18,
    altitude_agl: 100,
    timestamp: 1,
  });
  accumulator.addImage({
    id: 'image-2',
    transectId: 'transect-1',
    cameraId: 'camera-1',
    latitude: -33.001,
    longitude: 18,
    altitude_agl: 100,
    timestamp: 2,
  });
  accumulator.addAnnotation({
    id: 'annotation-1',
    objectId: 'annotation-1',
    imageId: 'image-1',
    categoryId: 'seen',
  });

  const output = accumulator.calculate();
  assert.equal(output.results.length, 2);
  assert.equal(
    output.results.find((result) => result.categoryId === 'seen')
      ?.animals,
    1
  );
  assert.equal(
    output.results.find((result) => result.categoryId === 'empty')
      ?.animals,
    0
  );
  assert.ok(
    output.results.every((result) =>
      Number.isFinite(result.lowerBound95)
    )
  );
});

test('multi-transect strata produce a real variance and Student-t interval', () => {
  const transectIds = ['transect-1', 'transect-2', 'transect-3'];
  const accumulator = createAccumulator(transectIds);
  const countsPerTransect = [2, 4, 6];
  transectIds.forEach((transectId, index) => {
    addTransectPair(
      accumulator,
      transectId,
      index,
      countsPerTransect[index]!
    );
  });

  const output = accumulator.calculate();
  const seen = output.results.find(
    (result) => result.categoryId === 'seen'
  )!;
  const empty = output.results.find(
    (result) => result.categoryId === 'empty'
  )!;

  assert.equal(seen.numSamples, 3);
  assert.equal(seen.animals, 12);
  assert.ok(
    seen.variance > 0,
    'unequal counts across transects must yield a positive variance'
  );
  assert.ok(seen.standardError > 0);
  assert.ok(seen.lowerBound95 < seen.estimate);
  assert.ok(seen.estimate < seen.upperBound95);

  // Pins the jstat import: the two-sided 97.5% Student-t critical value at
  // df = 2. A broken import throws here rather than silently widening bounds.
  const criticalValue =
    (seen.upperBound95 - seen.estimate) / seen.standardError;
  assert.ok(
    Math.abs(criticalValue - 4.302652729911275) < 1e-9,
    `expected t(0.975, df=2) = 4.302652729911275, got ${criticalValue}`
  );

  // A category with no annotations is still reported, with a degenerate interval.
  assert.equal(empty.animals, 0);
  assert.equal(empty.variance, 0);
  assert.equal(empty.estimate, 0);
});

test('camera strips are treated as non-overlapping without synchronized timestamps', () => {
  // The second camera is deliberately offset by a quarter-second. Each camera
  // supplies its own track, and their areas are added under one parent transect.
  const buildSurvey = (dualCamera: boolean): number => {
    const accumulator = createAccumulator();
    for (const timestamp of [1, 2]) {
      accumulator.addImage({
        id: `camera-1-${timestamp}`,
        transectId: 'transect-1',
        cameraId: 'camera-1',
        latitude: -33 - timestamp / 1_000,
        longitude: 18,
        altitude_agl: 100,
        timestamp,
      });
      if (dualCamera) {
        accumulator.addImage({
          id: `camera-2-${timestamp}`,
          transectId: 'transect-1',
          cameraId: 'camera-2',
          latitude: -33 - timestamp / 1_000,
          longitude: 18,
          altitude_agl: 100,
          timestamp: timestamp + 0.25,
        });
      }
    }
    accumulator.addAnnotation({
      id: 'annotation-1',
      objectId: 'annotation-1',
      imageId: 'camera-1-1',
      categoryId: 'seen',
    });
    return accumulator.calculate().results[0]!.areaSurveyed;
  };

  const singleArea = buildSurvey(false);
  const dualArea = buildSurvey(true);
  const widthOf = (tiltDegrees: number): number => {
    const fieldOfView = 2 * Math.atan(36 / (2 * 50));
    const tilt = (tiltDegrees * Math.PI) / 180;
    return (
      100 *
      (Math.tan(tilt + fieldOfView / 2) -
        Math.tan(tilt - fieldOfView / 2))
    );
  };
  const expectedRatio =
    (widthOf(0) + widthOf(25)) / widthOf(0);
  assert.ok(
    Math.abs(dualArea / singleArea - expectedRatio) < 1e-9,
    `expected area ratio ${expectedRatio}, got ${dualArea / singleArea}`
  );
});

test('multiple camera strips remain one Jolly sample and count only primaries', () => {
  const accumulator = createAccumulator();
  for (const timestamp of [1, 2]) {
    accumulator.addImage({
      id: `camera-1-${timestamp}`,
      transectId: 'transect-1',
      cameraId: 'camera-1',
      latitude: -33 - timestamp / 1_000,
      longitude: 18,
      altitude_agl: 100,
      timestamp,
    });
    accumulator.addImage({
      id: `camera-2-${timestamp}`,
      transectId: 'transect-1',
      cameraId: 'camera-2',
      latitude: -33 - timestamp / 1_000,
      longitude: 18,
      altitude_agl: 100,
      timestamp: timestamp + 0.1,
    });
  }
  accumulator.addAnnotation({
    id: 'primary',
    objectId: 'primary',
    imageId: 'camera-1-1',
    categoryId: 'seen',
  });
  accumulator.addAnnotation({
    id: 'secondary',
    objectId: 'primary',
    imageId: 'camera-2-1',
    categoryId: 'seen',
  });

  const result = accumulator
    .calculate()
    .results.find((row) => row.categoryId === 'seen')!;
  assert.equal(result.numSamples, 1);
  assert.equal(result.animals, 1);
});

test('invalid images are excluded without aborting a computable stratum', () => {
  const accumulator = createAccumulator();
  accumulator.addImage({
    id: 'invalid-image',
    transectId: 'transect-1',
    cameraId: 'camera-1',
    latitude: null,
    longitude: 18,
    altitude_agl: 100,
    timestamp: 0,
  });
  accumulator.addImage({
    id: 'image-1',
    transectId: 'transect-1',
    cameraId: 'camera-1',
    latitude: -33,
    longitude: 18,
    altitude_agl: 100,
    timestamp: 1,
  });
  accumulator.addImage({
    id: 'image-2',
    transectId: 'transect-1',
    cameraId: 'camera-1',
    latitude: -33.001,
    longitude: 18,
    altitude_agl: 100,
    timestamp: 2,
  });

  const output = accumulator.calculate();
  assert.equal(output.validation.excludedImages, 1);
  assert.equal(output.validation.missingPosition, 1);
  assert.equal(output.results.length, 2);
});

test('images outside the survey area and off-effort strata are left out', () => {
  const accumulator = new SurveyAccumulator({
    surveyId: 'survey-1',
    annotationSetId: 'set-1',
    organizationId: 'org-1',
    categoryIds: ['seen'],
    cameras: [
      { id: 'camera-1', focalLengthMm: 50, sensorWidthMm: 36, tiltDegrees: 0 },
    ],
    strata: [
      { id: 'stratum-1', name: 'Stratum 1', area: 10, baselineLength: 1_000 },
      { id: 'outside', name: 'Outside boundary', offEffort: true },
    ],
    transects: [
      { id: 'transect-1', stratumId: 'stratum-1' },
      { id: 'transect-2', stratumId: 'stratum-1' },
      { id: 'outside-transect', stratumId: 'outside' },
    ],
    now: () => '2026-07-30T00:00:00.000Z',
  });
  addTransectPair(accumulator, 'transect-1', 0, 2);
  addTransectPair(accumulator, 'transect-2', 1, 0);
  for (const [id, boundaryStatus] of [
    ['outside-image', 'outside'],
    ['excluded-image', 'excluded'],
  ] as const) {
    accumulator.addImage({
      id,
      transectId: 'outside-transect',
      cameraId: 'camera-1',
      latitude: -34,
      longitude: 18,
      altitude_agl: 100,
      timestamp: 10,
      boundaryStatus,
    });
    accumulator.addAnnotation({
      id: `${id}-annotation`,
      objectId: `${id}-annotation`,
      imageId: id,
      categoryId: 'seen',
    });
  }

  const output = accumulator.calculate();
  assert.equal(output.results.length, 1);
  assert.equal(output.results[0].stratumId, 'stratum-1');
  assert.equal(output.results[0].animals, 2);
  assert.equal(output.validation.outsideBoundary, 2);
  assert.equal(output.validation.annotationsForExcludedImages, 2);
  assert.ok(
    output.warnings.some((warning) => warning.startsWith('2 images outside'))
  );
  assert.ok(
    !output.warnings.some((warning) => warning.includes('missing or invalid'))
  );
});
