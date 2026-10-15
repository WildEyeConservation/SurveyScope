import jstat from 'jstat';
import {
  cameraFootprintWidth,
  covariance,
  trimmedMean,
  vincentyDistance,
} from './math.js';
import type {
  AnnotationRecord,
  CameraRecord,
  ComputationOutput,
  ImageRecord,
  JollyResultRecord,
  StratumRecord,
  TransectRecord,
  ValidationCounts,
} from './types.js';

interface ValidImage {
  id: string;
  transectId: string;
  cameraId: string;
  latitude: number;
  longitude: number;
  altitude_agl: number;
  timestamp: number;
}

interface TransectMetrics {
  stratumId: string;
  transectId: string;
  distance: number;
  widthAverage: number;
  areaSquareKilometres: number;
  animalCounts: Record<string, number>;
}

interface CameraStripMetrics {
  cameraId: string;
  distance: number;
  widthAverage: number;
  areaSquareKilometres: number;
  animalCounts: Record<string, number>;
}

interface ImageStrip {
  transectId: string;
  cameraId: string;
}

interface SurveyAccumulatorOptions {
  surveyId: string;
  annotationSetId: string;
  organizationId: string;
  categoryIds: string[];
  cameras: CameraRecord[];
  strata: StratumRecord[];
  transects: TransectRecord[];
  now?: () => string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function cameraStripKey(transectId: string, cameraId: string): string {
  return `${transectId}\u0000${cameraId}`;
}

export class SurveyAccumulator {
  private readonly surveyId: string;
  private readonly annotationSetId: string;
  private readonly organizationId: string;
  private readonly categoryIds: string[];
  private readonly selectedCategories: Set<string>;
  private readonly cameraMap: Map<string, CameraRecord>;
  private readonly stratumMap: Map<string, StratumRecord>;
  private readonly transectMap: Map<string, TransectRecord>;
  private readonly now: () => string;
  private readonly imagesByTransect = new Map<string, ValidImage[]>();
  private readonly imageToStrip = new Map<string, ImageStrip>();
  private readonly countsByCameraStrip = new Map<
    string,
    Record<string, number>
  >();
  private readonly validation: ValidationCounts = {
    excludedImages: 0,
    outsideBoundary: 0,
    missingTransect: 0,
    missingCamera: 0,
    missingPosition: 0,
    missingAltitude: 0,
    missingTimestamp: 0,
    invalidCameraOptics: 0,
    annotationsForExcludedImages: 0,
  };

  constructor(options: SurveyAccumulatorOptions) {
    this.surveyId = options.surveyId;
    this.annotationSetId = options.annotationSetId;
    this.organizationId = options.organizationId;
    this.categoryIds = [...new Set(options.categoryIds)];
    this.selectedCategories = new Set(this.categoryIds);
    this.cameraMap = new Map(
      options.cameras.map((camera) => [camera.id, camera])
    );
    // Off-effort strata hold images outside the survey area for chain linking.
    this.stratumMap = new Map(
      options.strata
        .filter((stratum) => !stratum.offEffort)
        .map((stratum) => [stratum.id, stratum])
    );
    this.transectMap = new Map(
      options.transects
        .filter((transect) => this.stratumMap.has(transect.stratumId))
        .map((transect) => [transect.id, transect])
    );
    this.now = options.now ?? (() => new Date().toISOString());

    if (this.categoryIds.length === 0) {
      throw new Error('At least one category is required');
    }
    if (this.cameraMap.size === 0) {
      throw new Error('No cameras found for survey');
    }
    if (this.stratumMap.size === 0) {
      throw new Error('No strata found for survey');
    }
    if (this.transectMap.size === 0) {
      throw new Error('No transects found for survey');
    }
  }

  get validImageCount(): number {
    return this.imageToStrip.size;
  }

  addImage(image: ImageRecord): void {
    const exclude = (reason: keyof ValidationCounts): void => {
      this.validation.excludedImages += 1;
      this.validation[reason] += 1;
    };

    // A missing status predates the field and counts as inside.
    if (
      image.boundaryStatus === 'outside' ||
      image.boundaryStatus === 'excluded'
    ) {
      exclude('outsideBoundary');
      return;
    }
    if (!image.transectId || !this.transectMap.has(image.transectId)) {
      exclude('missingTransect');
      return;
    }
    if (!image.cameraId || !this.cameraMap.has(image.cameraId)) {
      exclude('missingCamera');
      return;
    }
    if (
      !isFiniteNumber(image.latitude) ||
      !isFiniteNumber(image.longitude)
    ) {
      exclude('missingPosition');
      return;
    }
    if (!isFiniteNumber(image.altitude_agl) || image.altitude_agl < 0) {
      exclude('missingAltitude');
      return;
    }
    if (!isFiniteNumber(image.timestamp)) {
      exclude('missingTimestamp');
      return;
    }

    const camera = this.cameraMap.get(image.cameraId)!;
    if (
      !isFiniteNumber(camera.sensorWidthMm) ||
      camera.sensorWidthMm <= 0 ||
      !isFiniteNumber(camera.focalLengthMm) ||
      camera.focalLengthMm <= 0 ||
      !isFiniteNumber(camera.tiltDegrees)
    ) {
      exclude('invalidCameraOptics');
      return;
    }

    const validImage: ValidImage = {
      id: image.id,
      transectId: image.transectId,
      cameraId: image.cameraId,
      latitude: image.latitude,
      longitude: image.longitude,
      altitude_agl: image.altitude_agl,
      timestamp: image.timestamp,
    };
    const images = this.imagesByTransect.get(image.transectId) ?? [];
    images.push(validImage);
    this.imagesByTransect.set(image.transectId, images);
    this.imageToStrip.set(image.id, {
      transectId: image.transectId,
      cameraId: image.cameraId,
    });
  }

  addAnnotation(annotation: AnnotationRecord): void {
    if (
      annotation.id !== annotation.objectId ||
      !this.selectedCategories.has(annotation.categoryId)
    ) {
      return;
    }
    const strip = this.imageToStrip.get(annotation.imageId);
    if (!strip) {
      this.validation.annotationsForExcludedImages += 1;
      return;
    }
    const key = cameraStripKey(strip.transectId, strip.cameraId);
    const counts = this.countsByCameraStrip.get(key) ?? {};
    counts[annotation.categoryId] =
      (counts[annotation.categoryId] ?? 0) + 1;
    this.countsByCameraStrip.set(key, counts);
  }

  calculate(): ComputationOutput {
    if (this.imageToStrip.size === 0) {
      throw new Error('No usable images found for survey');
    }

    const warnings: string[] = [];
    if (this.validation.outsideBoundary > 0) {
      warnings.push(
        `${this.validation.outsideBoundary} images outside the survey area or in an exclusion zone were left out`
      );
    }
    const invalidImages =
      this.validation.excludedImages - this.validation.outsideBoundary;
    if (invalidImages > 0) {
      warnings.push(
        `${invalidImages} images were excluded because required survey data was missing or invalid`
      );
    }
    if (this.validation.annotationsForExcludedImages > 0) {
      warnings.push(
        `${this.validation.annotationsForExcludedImages} selected annotations belonged to excluded images`
      );
    }

    const metricsByStratum = new Map<string, TransectMetrics[]>();
    for (const [transectId, images] of this.imagesByTransect.entries()) {
      const metrics = this.calculateTransect(transectId, images, warnings);
      if (!metrics) {
        warnings.push(
          `Transect ${transectId} was excluded because it had insufficient usable track data`
        );
        continue;
      }
      const current = metricsByStratum.get(metrics.stratumId) ?? [];
      current.push(metrics);
      metricsByStratum.set(metrics.stratumId, current);
    }

    const uncomputable = [...this.stratumMap.values()].filter(
      (stratum) => !metricsByStratum.get(stratum.id)?.length
    );
    if (uncomputable.length > 0) {
      throw new Error(
        `The following strata have no computable transects: ${uncomputable
          .map((stratum) => stratum.name ?? stratum.id)
          .join(', ')}`
      );
    }

    const timestamp = this.now();
    const results: JollyResultRecord[] = [];
    for (const [stratumId, metrics] of metricsByStratum.entries()) {
      const stratum = this.stratumMap.get(stratumId)!;
      if (
        !isFiniteNumber(stratum.area) ||
        stratum.area <= 0 ||
        !isFiniteNumber(stratum.baselineLength) ||
        stratum.baselineLength <= 0
      ) {
        throw new Error(
          `Stratum ${stratum.name ?? stratum.id} is missing a positive area or baseline length`
        );
      }

      const sampleCount = metrics.length;
      const areaSurveyed = metrics.reduce(
        (sum, metric) => sum + metric.areaSquareKilometres,
        0
      );
      const sampledAreas = metrics.map(
        (metric) => metric.areaSquareKilometres
      );
      const averageWidth =
        metrics.reduce(
          (sum, metric) => sum + metric.widthAverage,
          0
        ) / sampleCount;
      const populationTransects = stratum.baselineLength / averageWidth;

      for (const categoryId of this.categoryIds) {
        const animalCounts = metrics.map(
          (metric) => metric.animalCounts[categoryId] ?? 0
        );
        const animals = animalCounts.reduce(
          (sum, count) => sum + count,
          0
        );
        const density = animals / areaSurveyed;
        const covarianceAnimals = covariance(
          animalCounts,
          animalCounts
        );
        const covarianceAnimalArea = covariance(
          animalCounts,
          sampledAreas
        );
        const covarianceAreas = covariance(
          sampledAreas,
          sampledAreas
        );
        const rawVariance =
          sampleCount < 2
            ? 0
            : ((populationTransects *
                (populationTransects - sampleCount)) /
                sampleCount) *
              (covarianceAnimals -
                2 * density * covarianceAnimalArea +
                density * density * covarianceAreas);
        const variance = Math.max(0, rawVariance);
        const standardError = Math.sqrt(variance);
        const estimate = density * stratum.area;
        const criticalValue =
          sampleCount > 1
            ? jstat.studentt.inv(0.975, sampleCount - 1)
            : 0;
        const lowerBound95 =
          estimate - criticalValue * standardError;
        const upperBound95 =
          estimate + criticalValue * standardError;

        const result: JollyResultRecord = {
          surveyId: this.surveyId,
          stratumId,
          annotationSetId: this.annotationSetId,
          categoryId,
          animals,
          areaSurveyed,
          estimate,
          density,
          variance,
          standardError,
          numSamples: sampleCount,
          lowerBound95,
          upperBound95,
          group: this.organizationId,
          createdAt: timestamp,
          updatedAt: timestamp,
          __typename: 'JollyResult',
          'stratumId#annotationSetId#categoryId':
            `${stratumId}#${this.annotationSetId}#${categoryId}`,
        };
        this.assertFiniteResult(result);
        results.push(result);
      }
    }

    return {
      results,
      validation: { ...this.validation },
      warnings,
    };
  }

  private calculateTransect(
    transectId: string,
    images: ValidImage[],
    warnings: string[]
  ): TransectMetrics | null {
    const transect = this.transectMap.get(transectId);
    if (!transect || !this.stratumMap.has(transect.stratumId)) {
      return null;
    }

    // A camera is a physical sub-strip of the parent flight transect. Its
    // geometry is calculated from its own timestamp series, so cameras do not
    // need synchronized shutters. The sub-strip areas and primary-annotation
    // counts are combined below while the flight transect remains one Jolly
    // sampling unit. Survey data can identify overlapping camera pairs, but it
    // does not store the overlap extent or geometry needed by this calculation.
    // Camera strips are therefore treated as non-overlapping and their complete
    // areas are summed.
    const imagesByCamera = new Map<string, ValidImage[]>();
    for (const image of images) {
      const cameraImages = imagesByCamera.get(image.cameraId) ?? [];
      cameraImages.push(image);
      imagesByCamera.set(image.cameraId, cameraImages);
    }

    const cameraStrips: CameraStripMetrics[] = [];
    for (const [cameraId, cameraImages] of imagesByCamera.entries()) {
      const strip = this.calculateCameraStrip(
        transectId,
        cameraId,
        cameraImages
      );
      if (!strip) {
        warnings.push(
          `Camera ${cameraId} on transect ${transectId} was excluded because it had insufficient usable track data`
        );
        continue;
      }
      cameraStrips.push(strip);
    }

    if (cameraStrips.length === 0) return null;

    const distance = Math.max(
      ...cameraStrips.map((strip) => strip.distance)
    );
    // The stored camera data does not contain the overlap extent or geometry
    // needed to calculate a union area, so strips are treated as non-overlapping.
    const areaSquareKilometres = cameraStrips.reduce(
      (sum, strip) => sum + strip.areaSquareKilometres,
      0
    );
    // Express the summed, potentially partial camera coverage as an effective
    // swath over the parent flight distance. When every camera covers the full
    // flight line this is exactly the sum of the per-camera average widths.
    const widthAverage =
      (areaSquareKilometres * 1_000_000) / distance;
    const animalCounts = Object.fromEntries(
      this.categoryIds.map((categoryId) => [
        categoryId,
        cameraStrips.reduce(
          (sum, strip) => sum + (strip.animalCounts[categoryId] ?? 0),
          0
        ),
      ])
    );

    return {
      stratumId: transect.stratumId,
      transectId,
      distance,
      widthAverage,
      areaSquareKilometres,
      animalCounts,
    };
  }

  private calculateCameraStrip(
    transectId: string,
    cameraId: string,
    images: ValidImage[]
  ): CameraStripMetrics | null {
    const camera = this.cameraMap.get(cameraId);
    if (!camera || images.length < 2) return null;

    const orderedImages = [...images].sort(
      (first, second) => first.timestamp - second.timestamp
    );
    const deltas = orderedImages
      .slice(1)
      .map(
        (image, index) =>
          image.timestamp - orderedImages[index]!.timestamp
      )
      .filter((delta) => delta > 0);
    const meanDelta = trimmedMean(deltas);
    const sections: ValidImage[][] = [[]];
    for (let index = 0; index < orderedImages.length; index += 1) {
      if (
        index > 0 &&
        meanDelta > 0 &&
        orderedImages[index]!.timestamp -
          orderedImages[index - 1]!.timestamp >
          3 * meanDelta
      ) {
        sections.push([]);
      }
      sections[sections.length - 1]!.push(orderedImages[index]!);
    }

    const distance = sections.reduce((total, section) => {
      if (section.length < 2) return total;
      const start = section[0]!;
      const end = section[section.length - 1]!;
      return (
        total +
        vincentyDistance(
          start.latitude,
          start.longitude,
          end.latitude,
          end.longitude
        )
      );
    }, 0);
    const widthAverage =
      orderedImages.reduce(
        (sum, image) =>
          sum +
          cameraFootprintWidth(
            image.altitude_agl,
            camera.sensorWidthMm!,
            camera.focalLengthMm!,
            camera.tiltDegrees!
          ),
        0
      ) / orderedImages.length;
    const areaSquareKilometres =
      (distance * widthAverage) / 1_000_000;
    if (
      !Number.isFinite(areaSquareKilometres) ||
      areaSquareKilometres <= 0
    ) {
      return null;
    }

    const existingCounts =
      this.countsByCameraStrip.get(cameraStripKey(transectId, cameraId)) ??
      {};
    const animalCounts = Object.fromEntries(
      this.categoryIds.map((categoryId) => [
        categoryId,
        existingCounts[categoryId] ?? 0,
      ])
    );
    return {
      cameraId,
      distance,
      widthAverage,
      areaSquareKilometres,
      animalCounts,
    };
  }

  private assertFiniteResult(result: JollyResultRecord): void {
    const numericFields: Array<keyof JollyResultRecord> = [
      'animals',
      'areaSurveyed',
      'estimate',
      'density',
      'variance',
      'standardError',
      'numSamples',
      'lowerBound95',
      'upperBound95',
    ];
    for (const field of numericFields) {
      if (!Number.isFinite(result[field] as number)) {
        throw new Error(
          `Calculation produced an invalid ${field} for stratum ${result.stratumId} and category ${result.categoryId}`
        );
      }
    }
  }
}
