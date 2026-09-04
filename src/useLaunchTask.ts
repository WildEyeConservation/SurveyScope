import { useCallback } from 'react';
import { uploadData } from 'aws-amplify/storage';
import { client } from './stores/appClient';
import type {
  LaunchQueueOptions,
  TiledLaunchRequest,
} from './types/LaunchTask';
import type { DataClient } from '../amplify/shared/data-schema.generated';
import { fetchAllPaginatedResults } from './utils';

const LEGACY_STORMFLY_BOX_SIZE = 64;

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

  async function queryLocations(
    locationSetId: string,
    onProgress?: (message: string) => void
  ): Promise<LocationQueryResult> {
    onProgress?.('Querying locations...');
    const allLocations = await fetchAllPaginatedResults(
      client.models.Location.locationsBySetIdAndConfidence,
      {
        setId: locationSetId,
        confidence: { between: [options.lowerLimit, options.upperLimit] },
        sortDirection: 'DESC',
        limit: 10000,
        selectionSet: [
          'id',
          'x',
          'y',
          'width',
          'height',
          'confidence',
          'imageId',
          'source',
        ] as const,
      }
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
        x: loc.x,
        y: loc.y,
        width,
        height,
        imageId: loc.imageId!,
        source: loc.source,
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
  ): Promise<string[]> {
    onProgress?.('Querying observations...');
    const allObs = await fetchAllPaginatedResults(
      client.models.Observation.observationsByAnnotationSetId,
      {
        annotationSetId,
        limit: 10000,
        selectionSet: ['locationId'] as const,
      }
    );
    return allObs.map(o => o.locationId);
  }

  // Query normal (non-FN) annotations for an annotation set (for filtering locations with existing annotations)
  async function queryAnnotations(
    annotationSetId: string,
    onProgress?: (message: string) => void
  ): Promise<AnnotationPoint[]> {
    onProgress?.('Querying annotations...');
    const allAnnos = await fetchAllPaginatedResults(
      client.models.Annotation.annotationsByAnnotationSetId,
      {
        setId: annotationSetId,
        filter: {
          or: [
            { source: { attributeExists: false } },
            { source: { notContains: 'false-negative' } },
          ],
        },
        limit: 10000,
        selectionSet: ['x', 'y', 'imageId'] as const,
      }
    );
    return allAnnos.map(a => ({ x: a.x, y: a.y, imageId: a.imageId }));
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
        const allSeenLocations = options.filterObserved
          ? new Set(await queryObservations(options.annotationSetId, onProgress))
          : new Set<string>();

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
        let allLocationsWithConfidence = validLocations.filter(
          (location) => !allSeenLocations.has(location.id)
        );
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
        const manifestKey = `queue-manifests/${crypto.randomUUID()}.json`;

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

        await uploadData({
          path: manifestKey,
          data: JSON.stringify({ items: manifestItems }),
          options: {
            bucket: 'outputs',
            contentType: 'application/json',
          },
        }).result;

        // Note: we can't update payload directly here if it's defined later, 
        // but we can store these in variables.
        const locationManifestS3Key = manifestKey;
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
    [options]
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
    const s3Key = `launch-payloads/${crypto.randomUUID()}.json`;
    console.log(
      `Payload size ${payloadSize} exceeds threshold, uploading to S3`,
      { key: s3Key }
    );
    await uploadData({
      path: s3Key,
      data: payloadStr,
      options: {
        bucket: 'outputs',
        contentType: 'application/json',
      },
    }).result;
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
