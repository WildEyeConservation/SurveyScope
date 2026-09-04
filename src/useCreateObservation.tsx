import { useCallback, useContext, useRef } from 'react';
import { ImageContext } from './Context';
import { client } from './stores/appClient';
import useCreateTestResult from './useCreateTestResult';
import type {
  AnnotationLocation,
  TaskAcknowledgement,
} from './annotationTypes';
import { useCurrentProject } from './data/projectScope';

/* This hook will take an ack callback as input and create a new ack callback that:
- Uses the graphQL API to create an Observation entry for the current user.
- Calls the old callback

When the task has no persisted location (e.g. viewing a whole image via a
permalink), no Observation is recorded and the original ack is simply invoked.
*/

interface UseCreateObservationProps {
  ack: TaskAcknowledgement;
  location?: AnnotationLocation;
  isTest?: boolean;
  testPresetId?: string;
  /** The ephemeral set the user's test annotations were written to. */
  testSetId?: string;
  /** Queue ID persisted on the Observation for server-side progress aggregation. */
  queueId?: string;
  /** Stable SQS message identifier used to make Observation creation retry safe. */
  observationId?: string;
  /** Optional source tag for the observation (e.g., 'manual-false-negative') */
  observationSource?: string;
}

// Time limits in milliseconds (matching server-side validation)
const MAX_TIME_WITH_ANNOTATIONS = 900 * 1000; // 15 minutes
const MAX_TIME_WITHOUT_ANNOTATIONS = 120 * 1000; // 2 minutes

function describeErrors(errors: readonly { message?: string }[] | undefined) {
  return errors?.map((error) => error.message || 'Unknown GraphQL error').join('; ');
}

export default function useCreateObservation(props: UseCreateObservationProps) {
  const {
    location,
    isTest,
    ack,
    testPresetId,
    testSetId,
    queueId,
    observationId,
    observationSource,
  } = props;
  const annotationSetId = location?.annotationSetId;
  const id = location?.id;
  const annotationSetToUse = isTest && testSetId ? testSetId : annotationSetId;
  const {
    annoCount,
    startLoadingTimestamp,
    visibleTimestamp,
    fullyLoadedTimestamp,
  } = useContext(ImageContext)!;
  const project = useCurrentProject();
  const completionRef = useRef<Promise<void> | null>(null);

  const createTestResult = useCreateTestResult({
    locationId: id,
    annotationSetId,
    testSetId: isTest ? testSetId : undefined,
    testPresetId,
  });

  const newAck = useCallback(
    (submittedAt?: number): Promise<void> => {
      if (completionRef.current) return completionRef.current;

      const completion = (async () => {
        // The SQS ack is deliberately delayed after the user pages past (see
        // useAckOnTimeout), so callers pass the timestamp captured at submit time.
        const submittedTimestamp = submittedAt ?? Date.now();
        if (!id || !annotationSetId || !project) {
          throw new Error(
            'Cannot complete task without a location, annotation set, and project'
          );
        }

        let timeTaken = visibleTimestamp
          ? submittedTimestamp - visibleTimestamp
          : 0;

        // Clamp to the same caps the server enforces. The server zeroes values
        // that exceed the cap, so clamping here keeps the observation counted
        // instead of discarding a long (likely idle) session entirely.
        const hasSighting = annoCount > 0;
        const maxTime = hasSighting
          ? MAX_TIME_WITH_ANNOTATIONS
          : MAX_TIME_WITHOUT_ANNOTATIONS;

        if (timeTaken > maxTime) {
          console.warn(
            `Time taken (${timeTaken}ms) exceeds maximum (${maxTime}ms) for ${
              hasSighting ? 'sighting' : 'search'
            }. Clamping to the maximum.`
          );
          timeTaken = maxTime;
        }

        const persistedAnnotationSetId = annotationSetToUse ?? annotationSetId;
        const input = {
            ...(observationId ? { id: observationId } : {}),
            annotationSetId: persistedAnnotationSetId,
            annotationCount: annoCount,
            timeTaken,
            // Time the user spent looking at a not-yet-loaded image. With
            // preloading the image usually finishes before it becomes visible,
            // in which case the user waited 0ms (never negative).
            waitingTime:
              visibleTimestamp && fullyLoadedTimestamp
                ? Math.max(0, fullyLoadedTimestamp - visibleTimestamp)
                : 0,
            loadingTime: fullyLoadedTimestamp
              ? fullyLoadedTimestamp - (startLoadingTimestamp ?? 0)
              : 0,
            locationId: id,
            projectId: project.id,
            queueId: queueId || undefined,
            source: observationSource,
            group: project.organizationId,
        };

        const created = await client.models.Observation.create(input);
        if (!created.data) {
            // A lost response after a successful write is indistinguishable from
            // a failed create. Queued observations use a deterministic ID, so a
            // strongly identified existing row proves persistence and makes the
            // client retry safe.
          let existingObservationConfirmed = false;
          if (observationId) {
            const existing = await client.models.Observation.get(
                { id: observationId },
                {
                  selectionSet: [
                    'id',
                    'annotationSetId',
                    'locationId',
                    'queueId',
                  ],
                }
            );
            if (
              existing.data?.annotationSetId === persistedAnnotationSetId &&
              existing.data.locationId === id &&
              (existing.data.queueId ?? undefined) === (queueId ?? undefined)
            ) {
              existingObservationConfirmed = true;
            }
          }

          if (!existingObservationConfirmed) {
            throw new Error(
              `Failed to persist observation: ${
                describeErrors(created.errors) || 'no row returned'
              }`
            );
          }
        }

        // observedCount is bumped by the updateUserStats DynamoDB stream handler
        // when the Observation row lands; don't also increment from the client.

        if (isTest) {
          await createTestResult();
        }

        await ack(submittedAt);
      })();

      completionRef.current = completion.catch((error) => {
        // Permit a later retry after either persistence or SQS acknowledgement
        // fails. Deterministic queued Observation IDs make that retry safe.
        completionRef.current = null;
        throw error;
      });
      return completionRef.current;
    },
    [
      id,
      annotationSetId,
      annotationSetToUse,
      project,
      visibleTimestamp,
      startLoadingTimestamp,
      fullyLoadedTimestamp,
      annoCount,
      isTest,
      createTestResult,
      queueId,
      observationId,
      observationSource,
      ack,
    ]
  );

  return newAck;
}
