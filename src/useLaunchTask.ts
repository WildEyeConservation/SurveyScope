import { useContext, useCallback } from 'react';
import { uploadWorkflowFile } from './storage/workflowFiles';
import { GlobalContext } from './Context';
import type {
  LaunchQueueOptions,
  TiledLaunchRequest,
} from './types/LaunchTask';
import type { DataClient } from '../amplify/shared/data-schema.generated';
import { fetchAllPaginatedResults } from './utils';
import { loadRows } from './rowChunks';
import {
  countMaskRegions,
  isPointMasked,
  parseCameraMasks,
  type CameraMasks,
} from './types/CameraMask';
import { loadProjectImages } from './projectImages';
import { isCentreObserved, type Box } from '../shared/locationGeometry';

export const LEGACY_STORMFLY_BOX_SIZE = 64;

// Types for options and function arguments
export type LaunchTaskOptions = {
  taskTag: string;
  annotationSetId: string;
  projectId: string;
  skipLocationWithAnnotations: boolean;
  allowOutside: boolean;
  filterObserved: boolean;
  lowerLimit: number;
  upperLimit: number;
  batchSize: number;
  zoom?: number;
};

export type LaunchTaskArgs = {
  selectedTasks: string[];
  onProgress?: (message: string) => void;
  queueOptions: LaunchQueueOptions;
  tiledRequest?: TiledLaunchRequest | null;
  /** If true, delete false negative annotations/observations before launching */
  hasFN?: boolean;
  onLaunchConfirmed?: () => void;
  launchImageIds?: string[];
};

type LaunchLambdaPayload = {
  projectId: string;
  annotationSetId: string;
  queueOptions: LaunchQueueOptions;
  allowOutside: boolean;
  skipLocationWithAnnotations: boolean;
  taskTag: string;
  batchSize: number;
  zoom?: number | null;
  locationIds?: string[];
  locationSetIds?: string[];
  tiledRequest?: TiledLaunchRequest | null;
  locationManifestS3Key?: string | null;
  launchedCount?: number | null;
  /** If true, delete false negative annotations/observations before launching */
  hasFN?: boolean;
  launchImageIds?: string[];
};

export function useLaunchTask(
  options: LaunchTaskOptions
): (args: LaunchTaskArgs) => Promise<void> {
  const { client } = useContext(GlobalContext)!;

  type LocationWithConfidence = {
    id: string;
    confidence: number;
    x: number;
    y: number;
    width: number;
    height: number;
    imageId: string;
    source: string;
  };

  type AnnotationPoint = { x: number; y: number; imageId: string };

  type ObservedLocations = {
    ids: Set<string>;
    boxesByImage: Map<string, Box[]>;
  };

  type LocationQueryResult = {
    locations: LocationWithConfidence[];
    queriedCount: number;
    invalidCounts: {
      confidence: number;
      dimensions: number;
      imageId: number;
      coordinates: number;
    };
    recoveredLegacyStormflyCount: number;
  };

  async function filterMaskedLocations(
    locations: LocationWithConfidence[],
    onProgress?: (message: string) => void
  ): Promise<LocationWithConfidence[]> {
    if (locations.length === 0) return locations;
    const cameras = await fetchAllPaginatedResults(
      client.models.Camera.camerasByProjectId,
      {
        projectId: options.projectId,
        selectionSet: ['id', 'masks'] as const,
      }
    );
    const masksByCamera = new Map<string, CameraMasks>();
    for (const camera of cameras) {
      const masks = parseCameraMasks(camera.masks);
      if (countMaskRegions(masks) > 0) masksByCamera.set(camera.id, masks);
    }
    if (masksByCamera.size === 0) return locations;

    onProgress?.('Applying camera masks...');
    const images = await loadProjectImages(client, options.projectId, [
      'cameraId',
      'width',
      'height',
    ]);
    const imageById = new Map(images.map((image) => [image.id, image]));
    const kept = locations.filter((location) => {
      const image = imageById.get(location.imageId);
      const masks = image?.cameraId
        ? masksByCamera.get(image.cameraId)
        : undefined;
      return !(
        image?.width &&
        image.height &&
        isPointMasked(masks, location.x, location.y, image.width, image.height)
      );
    });
    if (kept.length < locations.length) {
      onProgress?.(
        `Discarded ${locations.length - kept.length} detections inside camera masks`
      );
    }
    return kept;
  }

  async function queryLocations(
    locationSetId: string,
    onProgress?: (message: string) => void
  ): Promise<LocationQueryResult> {
    onProgress?.('Querying locations...');
    const allLocations = await loadRows(
      client,
      'locationsBySetIdAndConfidence',
      locationSetId,
      ['x', 'y', 'width', 'height', 'imageId', 'source'],
      { between: [options.lowerLimit, options.upperLimit] }
    );
    const invalidCounts = {
      confidence: 0,
      dimensions: 0,
      imageId: 0,
      coordinates: 0,
    };
    let recoveredLegacyStormflyCount = 0;
    const locations: LocationWithConfidence[] = [];

    for (const loc of allLocations) {
      const confidence = loc.confidence ?? 0;
      const hasCoordinates =
        Number.isFinite(loc.x) && Number.isFinite(loc.y);
      const hasImageId = !!loc.imageId;
      const isLegacyStormflyLocation =
        loc.source === 'stormfly-testing' &&
        ((loc.width ?? 0) <= 0 || (loc.height ?? 0) <= 0);
      const width = isLegacyStormflyLocation
        ? LEGACY_STORMFLY_BOX_SIZE
        : (loc.width ?? 0);
      const height = isLegacyStormflyLocation
        ? LEGACY_STORMFLY_BOX_SIZE
        : (loc.height ?? 0);

      if (confidence <= 0) invalidCounts.confidence += 1;
      if (!hasCoordinates) invalidCounts.coordinates += 1;
      if (!hasImageId) invalidCounts.imageId += 1;
      if (width <= 0 || height <= 0) invalidCounts.dimensions += 1;

      if (
        confidence <= 0 ||
        !hasCoordinates ||
        !hasImageId ||
        width <= 0 ||
        height <= 0
      ) {
        continue;
      }

      if (isLegacyStormflyLocation) {
        recoveredLegacyStormflyCount += 1;
      }
      locations.push({
        id: loc.id,
        confidence,
        x: loc.x!,
        y: loc.y!,
        width,
        height,
        imageId: loc.imageId!,
        source: loc.source ?? '',
      });
    }
    const invalidCount = allLocations.length - locations.length;
    onProgress?.(
      `Location set returned ${locations.length} valid locations in confidence range` +
        (recoveredLegacyStormflyCount > 0
          ? ` (${recoveredLegacyStormflyCount} legacy Stormfly points assigned ${LEGACY_STORMFLY_BOX_SIZE}px boxes)`
          : '') +
        (invalidCount > 0 ? ` (${invalidCount} invalid locations ignored)` : '')
    );
    return {
      locations,
      queriedCount: allLocations.length,
      invalidCounts,
      recoveredLegacyStormflyCount,
    };
  }

  async function queryObservations(
    annotationSetId: string,
    onProgress?: (message: string) => void
  ): Promise<ObservedLocations> {
    onProgress?.('Querying observations...');
    const allObs = await loadRows(
      client,
      'observationsByAnnotationSetId',
      annotationSetId,
      [
        'locationId',
        'location.imageId',
        'location.x',
        'location.y',
        'location.width',
        'location.height',
      ]
    );
    const observed: ObservedLocations = {
      ids: new Set(),
      boxesByImage: new Map(),
    };
    for (const obs of allObs) {
      if (obs.locationId) observed.ids.add(obs.locationId);
      const imageId = obs['location.imageId'];
      const x = obs['location.x'];
      const y = obs['location.y'];
      if (!imageId || x == null || y == null) continue;
      const boxes = observed.boxesByImage.get(imageId) ?? [];
      boxes.push({
        x,
        y,
        width: obs['location.width'] ?? 0,
        height: obs['location.height'] ?? 0,
      });
      observed.boxesByImage.set(imageId, boxes);
    }
    return observed;
  }

  function isLocationObserved(
    location: LocationWithConfidence,
    observed: ObservedLocations
  ): boolean {
    if (observed.ids.has(location.id)) return true;
    const boxes = observed.boxesByImage.get(location.imageId);
    return !!boxes && isCentreObserved(location, boxes);
  }

  // Query normal (non-FN) annotations for an annotation set (for filtering locations with existing annotations)
  async function queryAnnotations(
    annotationSetId: string,
    onProgress?: (message: string) => void
  ): Promise<AnnotationPoint[]> {
    onProgress?.('Querying annotations...');
    const allAnnos = await loadRows(
      client,
      'annotationsByAnnotationSetId',
      annotationSetId,
      ['x', 'y', 'imageId', 'source']
    );
    const points: AnnotationPoint[] = [];
    for (const a of allAnnos) {
      if (a.source?.includes('false-negative')) continue;
      if (a.x == null || a.y == null || !a.imageId) continue;
      points.push({ x: a.x, y: a.y, imageId: a.imageId });
    }
    return points;
  }

  // Check if an annotation falls within a location's bounds
  // Location (x, y) is the CENTER, so bounds are calculated as:
  // minX = x - width/2, maxX = x + width/2
  // minY = y - height/2, maxY = y + height/2
  function isAnnotationWithinLocation(
    annotation: AnnotationPoint,
    location: LocationWithConfidence
  ): boolean {
    const minX = location.x - location.width / 2;
    const maxX = location.x + location.width / 2;
    const minY = location.y - location.height / 2;
    const maxY = location.y + location.height / 2;

    return (
      annotation.x >= minX &&
      annotation.x <= maxX &&
      annotation.y >= minY &&
      annotation.y <= maxY
    );
  }

  // Filter out locations that have annotations within their bounds (same image only)
  function filterLocationsWithAnnotations(
    locations: LocationWithConfidence[],
    annotations: AnnotationPoint[],
    onProgress?: (message: string) => void
  ): LocationWithConfidence[] {
    onProgress?.(`Filtering ${locations.length} locations against ${annotations.length} annotations...`);

    // Group annotations by imageId so we only check annotations on the same image
    const annotationsByImage = new Map<string, AnnotationPoint[]>();
    for (const a of annotations) {
      let list = annotationsByImage.get(a.imageId);
      if (!list) {
        list = [];
        annotationsByImage.set(a.imageId, list);
      }
      list.push(a);
    }

    const filtered = locations.filter((location) => {
      const imageAnnotations = annotationsByImage.get(location.imageId);
      if (!imageAnnotations) return true; // No annotations on this image, keep location
      // Check if any annotation on the same image falls within this location's bounds
      const hasAnnotationWithin = imageAnnotations.some((annotation) =>
        isAnnotationWithinLocation(annotation, location)
      );
      // Keep the location only if it has NO annotations within
      return !hasAnnotationWithin;
    });

    const skipped = locations.length - filtered.length;
    onProgress?.(`Filtered out ${skipped} locations with existing annotations, ${filtered.length} remaining`);

    return filtered;
  }

  const launchTask = useCallback(
    async ({
      selectedTasks,
      onProgress,
      queueOptions,
      tiledRequest,
      hasFN,
      onLaunchConfirmed,
      launchImageIds,
    }: LaunchTaskArgs) => {
      onProgress?.('Preparing launch request');
      let collectedLocations: string[] | undefined;

      if (!tiledRequest) {
        const observed = options.filterObserved
          ? await queryObservations(options.annotationSetId, onProgress)
          : null;

        // If skipLocationWithAnnotations is enabled, query all annotations for the set
        const allAnnotations = options.skipLocationWithAnnotations
          ? await queryAnnotations(options.annotationSetId, onProgress)
          : [];

        const locationQueryResults = await Promise.all(
          selectedTasks.map((task) => queryLocations(task, onProgress))
        );
        const queriedLocationCount = locationQueryResults.reduce(
          (total, result) => total + result.queriedCount,
          0
        );
        const invalidLocationCounts = locationQueryResults.reduce(
          (totals, result) => ({
            confidence:
              totals.confidence + result.invalidCounts.confidence,
            dimensions:
              totals.dimensions + result.invalidCounts.dimensions,
            imageId: totals.imageId + result.invalidCounts.imageId,
            coordinates:
              totals.coordinates + result.invalidCounts.coordinates,
          }),
          { confidence: 0, dimensions: 0, imageId: 0, coordinates: 0 }
        );
        const validLocations = locationQueryResults.flatMap(
          (result) => result.locations
        );

        // Collect locations from all sets, filter observed, and sort by confidence (descending)
        let allLocationsWithConfidence = observed
          ? validLocations.filter(
              (location) => !isLocationObserved(location, observed)
            )
          : validLocations;
        const observedLocationCount =
          validLocations.length - allLocationsWithConfidence.length;
        if (options.filterObserved) {
          onProgress?.(
            `Filtered out ${observedLocationCount} observed locations, ${allLocationsWithConfidence.length} remaining`
          );
        }

        // Filter by launchImageIds if provided (dev feature for re-launching specific images)
        let imageFilteredLocationCount = 0;
        if (launchImageIds && launchImageIds.length > 0) {
          const allowedImageIds = new Set(launchImageIds);
          const beforeImageFilter = allLocationsWithConfidence.length;
          allLocationsWithConfidence = allLocationsWithConfidence.filter(
            (l) => allowedImageIds.has(l.imageId)
          );
          imageFilteredLocationCount =
            beforeImageFilter - allLocationsWithConfidence.length;
          onProgress?.(`Filtered to ${allLocationsWithConfidence.length} locations matching ${launchImageIds.length} image IDs`);
        }

        const beforeMaskFilter = allLocationsWithConfidence.length;
        allLocationsWithConfidence = await filterMaskedLocations(
          allLocationsWithConfidence,
          onProgress
        );
        const maskedLocationCount =
          beforeMaskFilter - allLocationsWithConfidence.length;

        // Filter out locations that already have annotations within their bounds
        let annotatedLocationCount = 0;
        if (options.skipLocationWithAnnotations && allAnnotations.length > 0) {
          const beforeAnnotationFilter = allLocationsWithConfidence.length;
          allLocationsWithConfidence = filterLocationsWithAnnotations(
            allLocationsWithConfidence,
            allAnnotations,
            onProgress
          );
          annotatedLocationCount =
            beforeAnnotationFilter - allLocationsWithConfidence.length;
        }

        // Sort by confidence (descending) - High confidence first
        allLocationsWithConfidence.sort((a, b) => b.confidence - a.confidence);

        // Extract IDs for interleaving (now sorted by confidence)
        let allLocationIds = allLocationsWithConfidence.map((l) => l.id);

        // Interleave locations to distribute across confidence levels
        const chunkSize = 100;
        const passes = Math.ceil(allLocationIds.length / chunkSize);
        const interleavedLocations: string[] = [];
        for (let i = 0; i < chunkSize; i++) {
          for (let j = 0; j < passes; j++) {
            const index = j * chunkSize + i;
            if (index < allLocationIds.length) {
              interleavedLocations.push(allLocationIds[index]);
            }
          }
        }
        allLocationIds = interleavedLocations.reverse();
        onProgress?.(`Found ${allLocationIds.length} locations to launch`);

        if (allLocationIds.length === 0) {
          if (queriedLocationCount === 0) {
            alert(
              `No locations matched the confidence range ${options.lowerLimit} to ${options.upperLimit}.`
            );
          } else {
            const exclusions = [
              invalidLocationCounts.confidence > 0
                ? `${invalidLocationCounts.confidence} without valid confidence`
                : null,
              invalidLocationCounts.dimensions > 0
                ? `${invalidLocationCounts.dimensions} without dimensions`
                : null,
              invalidLocationCounts.imageId > 0
                ? `${invalidLocationCounts.imageId} without an image`
                : null,
              invalidLocationCounts.coordinates > 0
                ? `${invalidLocationCounts.coordinates} without coordinates`
                : null,
              observedLocationCount > 0
                ? `${observedLocationCount} observed`
                : null,
              imageFilteredLocationCount > 0
                ? `${imageFilteredLocationCount} outside the selected images`
                : null,
              maskedLocationCount > 0
                ? `${maskedLocationCount} inside camera masks`
                : null,
              annotatedLocationCount > 0
                ? `${annotatedLocationCount} with existing annotations`
                : null,
            ].filter((reason): reason is string => reason !== null);
            alert(
              `No locations remain to launch after filtering${
                exclusions.length > 0 ? `: ${exclusions.join(', ')}` : '.'
              }`
            );
          }
          return;
        }

        collectedLocations = allLocationIds;

        onProgress?.('Uploading location manifest...');

        // Map back to the full location objects for the manifest
        const locationsMap = new Map(allLocationsWithConfidence.map((l) => [l.id, l]));
        const manifestItems = collectedLocations.map((id) => {
          const loc = locationsMap.get(id);
          return {
            locationId: id,
            imageId: loc?.imageId || '',
            x: loc?.x || 0,
            y: loc?.y || 0,
            width: loc?.width || 0,
            height: loc?.height || 0,
          };
        });

        const locationManifestS3Key = await uploadWorkflowFile(
          'queue-manifest',
          options.projectId,
          JSON.stringify({ items: manifestItems })
        );
        const launchedCount = manifestItems.length;

        const payload: LaunchLambdaPayload = {
          projectId: options.projectId,
          annotationSetId: options.annotationSetId,
          queueOptions,
          allowOutside: options.allowOutside,
          skipLocationWithAnnotations: options.skipLocationWithAnnotations,
          taskTag: options.taskTag,
          batchSize: options.batchSize,
          zoom: options.zoom ?? null,
          locationIds: collectedLocations,
          locationSetIds: selectedTasks,
          tiledRequest: tiledRequest ?? null,
          locationManifestS3Key,
          launchedCount,
          hasFN: hasFN ?? false,
        };

        onProgress?.('Enqueuing jobs...');
        sendLaunchLambdaRequest(client, payload);
        onProgress?.('Launch request submitted');
        return; // Exit early for model-guided
      }

      onLaunchConfirmed?.();

      const payload: LaunchLambdaPayload = {
        projectId: options.projectId,
        annotationSetId: options.annotationSetId,
        queueOptions,
        allowOutside: options.allowOutside,
        skipLocationWithAnnotations: options.skipLocationWithAnnotations,
        taskTag: options.taskTag,
        batchSize: options.batchSize,
        zoom: options.zoom ?? null,
        locationIds: collectedLocations,
        locationSetIds: selectedTasks,
        tiledRequest: tiledRequest ?? null,
        hasFN: hasFN ?? false,
        launchImageIds: launchImageIds ?? tiledRequest?.launchImageIds,
      };

      onProgress?.('Enqueuing jobs...');
      sendLaunchLambdaRequest(client, payload);
      onProgress?.('Launch request submitted');
    },
    [options, client]
  );

  return launchTask;
}

// Threshold in bytes above which we upload the payload to S3.
// Lambda sync limit is 6MB, but we use a conservative threshold.
const PAYLOAD_SIZE_THRESHOLD = 200 * 1024; // 200KB

async function sendLaunchLambdaRequest(
  client: DataClient,
  payload: LaunchLambdaPayload
) {
  const payloadStr = JSON.stringify(payload);
  const payloadSize = new Blob([payloadStr]).size;

  let requestPayload: string;

  if (payloadSize > PAYLOAD_SIZE_THRESHOLD) {
    // Upload large payload to S3 and send only the reference.
    const s3Key = await uploadWorkflowFile(
      'launch-payload',
      payload.projectId,
      payloadStr
    );
    requestPayload = JSON.stringify({ payloadS3Key: s3Key });
  } else {
    requestPayload = payloadStr;
  }

  try {
    await (client as any).mutations.launchAnnotationSet({
      request: requestPayload,
    }, { retry: false });
  } catch (error: any) {
    if (shouldIgnoreLaunchError(error)) {
      console.warn('Ignoring launch lambda timeout response', error);
      return;
    }
    throw error;
  }
}

function shouldIgnoreLaunchError(error: any): boolean {
  const messages: string[] = [];
  if (error?.message) {
    messages.push(String(error.message));
  }
  if (Array.isArray(error?.errors)) {
    for (const err of error.errors) {
      if (err?.message) {
        messages.push(String(err.message));
      }
    }
  }
  return messages.some((msg) =>
    /timed out|timeout|Task timed out|socket hang up/i.test(msg)
  );
}
