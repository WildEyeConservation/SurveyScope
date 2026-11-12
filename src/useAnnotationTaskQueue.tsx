import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { GlobalContext, ProjectContext, UserContext } from './Context';
import type { BeforeNextDecision } from './TaskBuffer';
import type { Schema } from './amplify/client-schema';
import type {
  AnnotationTaskPayload,
  TaskAcknowledgement,
} from './annotationTypes';
import { primeTask } from './annotator/prefetchTask';
import { TILE_VIEW_BOUNDS_SCALE } from './annotator/viewTiles';
import { subscribeToSharedDefaultZoom } from './defaultZoomEvents';
import { createLocationLeases } from './locationLeases';
import { tileLoadStats } from './storage/tileLoadStats';
import { decideTestCadence } from './testCadence';
import {
  growTestBox,
  tileSizeForImage,
  type Box,
  type Size,
} from './testTileBounds';
import { touchQueue } from './touchQueue';
import useTesting, { type CandidateFilter } from './useTesting';
import { fetchAllPaginatedResults, isWithinLocationBounds } from './utils';

const LOCATION_SELECTION = [
  'id',
  'x',
  'y',
  'width',
  'height',
  'confidence',
  'source',
  'image.id',
  'image.width',
  'image.height',
  'image.latitude',
  'image.longitude',
  'image.altitude_wgs84',
  'image.altitude_egm96',
  'image.altitude_agl',
  'image.boundaryStatus',
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Enough to stay ahead of a fast annotator without hoarding a shared queue.
const RECEIVE_BATCH_SIZE = 5;
// Start the next batch while there is still time to prime it.
const RECEIVE_AHEAD = 3;
const VISIBILITY_TIMEOUT_S = 600;
const FALSE_NEGATIVES_QUEUE = 'False Negatives';

type TileSample = { tile: Size; image: Size };

function growToTile(
  sample: TileSample,
  location: Box & { id?: string },
  image: Size,
) {
  return growTestBox(
    location,
    tileSizeForImage(sample, image),
    image,
    location.id ?? '',
  );
}

interface AnnotationTaskMessage {
  location: {
    id: string;
    annotationSetId: string;
  };
  skipLocationWithAnnotations?: boolean;
  ack?: TaskAcknowledgement;
  allowOutside?: boolean;
  zoom?: number;
  testPresetId?: string;
  isTest?: boolean;
  queueId?: string;
  observationId?: string;
  taskTag?: string;
  isFalseNegatives?: boolean;
}

/*
Owns the annotation-task source: queue selection, optional test insertion,
deduplication, location hydration, skip filtering, visible-time revalidation,
and SQS acknowledgement.
*/
export default function useAnnotationTaskQueue() {
  const { currentPM } = useContext(ProjectContext)!;
  const { getSqsClient, myOrganizationHook } = useContext(UserContext)!;
  const { client } = useContext(GlobalContext)!;
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [backupUrl, setBackupUrl] = useState<string | undefined>(undefined);
  const [zoom, setZoom] = useState<number | undefined>(undefined);
  const [backupZoom, setBackupZoom] = useState<number | undefined>(undefined);
  const [isFnQueue, setIsFnQueue] = useState(false);
  const [backupIsFnQueue, setBackupIsFnQueue] = useState(false);
  // Use ref instead of state to prevent fetcher reference churn on every new location
  const processedLocationsRef = useRef<Set<string>>(new Set());
  // Tasks this session finished, so paging back to one is not a redelivery.
  const ownObservationsRef = useRef<Set<string>>(new Set());

  // user testing state
  const configRef = useRef<Schema['ProjectTestConfig']['type']>();
  const testUserRef = useRef(false);
  const testViewBoundsScaleRef = useRef<number | undefined>(undefined);
  const testingSetupPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const maxCadenceIndexRef = useRef(-1);
  // Set in False Negatives jobs, whose tests are grown to the tile size.
  const fnTileRef = useRef<TileSample | undefined>(undefined);
  const testFilterRef = useRef<CandidateFilter | undefined>(undefined);
  const { fetcher: testFetcher } = useTesting(testFilterRef);
  const {
    jobsCompleted,
    currentAnnoCount,
    currentTaskTag,
    setCurrentAnnoCount,
    unannotatedJobs,
    setUnannotatedJobs,
  } = useContext(UserContext)!;

  // Keep future task fetches on the value saved during this active session.
  useEffect(
    () =>
      subscribeToSharedDefaultZoom((update) => {
        if (update.surveyId === currentPM.projectId) {
          setZoom(update.zoom);
        }
      }),
    [currentPM.projectId],
  );

  useEffect(() => {
    if (currentPM.queueId) {
      touchQueue(client, currentPM.queueId);
      client.models.Queue.get({ id: currentPM.queueId }).then(({ data }) => {
        if (!data) return;
        setIsFnQueue(data.name === FALSE_NEGATIVES_QUEUE);
        setUrl(data.url ?? undefined);
        setZoom(data.zoom ?? undefined);
      });
      if (currentPM.backupQueueId) {
        client.models.Queue.get({ id: currentPM.backupQueueId }).then(
          ({ data }) => {
            if (!data) return;
            setBackupIsFnQueue(data.name === FALSE_NEGATIVES_QUEUE);
            setBackupUrl(data.url ?? undefined);
            setBackupZoom(data.zoom ?? undefined);
          },
        );
      }
    }

    async function setupTesting() {
      configRef.current = undefined;
      testUserRef.current = false;
      testViewBoundsScaleRef.current = undefined;
      fnTileRef.current = undefined;
      testFilterRef.current = undefined;
      const { data: config } = await client.models.ProjectTestConfig.get(
        {
          projectId: currentPM.projectId,
        },
        {
          selectionSet: [
            'projectId',
            'project.organizationId',
            'postTestConfirmation',
            'testType',
            'random',
            'deadzone',
            'interval',
            'accuracy',
          ],
        },
      );

      if (config?.projectId) {
        configRef.current = config;

        const { data: queue } = currentPM.queueId
          ? await client.models.Queue.get(
              { id: currentPM.queueId },
              { selectionSet: ['name', 'locationSetId'] },
            )
          : { data: null };
        const shouldTest =
          myOrganizationHook.data?.find(
            (membership) =>
              membership.organizationId === config.project.organizationId,
          )?.isTested ?? false;
        testUserRef.current = shouldTest;

        // Tests in a tiled job must open like its tiles, or they stand out.
        if (shouldTest && queue?.locationSetId) {
          const { data: sample } =
            await client.models.Location.locationsBySetIdAndConfidence(
              { setId: queue.locationSetId },
              { limit: 1, selectionSet: ['source'] as const },
            );
          if (sample?.[0]?.source === 'manual') {
            testViewBoundsScaleRef.current = TILE_VIEW_BOUNDS_SCALE;
          }
        }

        // False-negative jobs show large tiles, so a small test box stands out.
        if (shouldTest && queue?.name === FALSE_NEGATIVES_QUEUE) {
          await setupFnTests(queue.locationSetId);
        }
      }
    }

    async function setupFnTests(locationSetId: string | null | undefined) {
      const { data: tiles } = locationSetId
        ? await client.models.Location.locationsBySetIdAndConfidence(
            { setId: locationSetId },
            {
              limit: 1,
              selectionSet: [
                'width',
                'height',
                'image.width',
                'image.height',
              ] as const,
            },
          )
        : { data: null };
      const tile = tiles?.[0];
      if (!tile?.width || !tile.height || !tile.image) {
        testUserRef.current = false;
        return;
      }
      const sample: TileSample = {
        tile: { width: tile.width, height: tile.height },
        image: { width: tile.image.width, height: tile.image.height },
      };
      fnTileRef.current = sample;
      const fits = new Map<string, Promise<boolean>>();
      testFilterRef.current = (entry) => {
        let fit = fits.get(entry.locationId);
        if (!fit) {
          fit = client.models.Location.get(
            { id: entry.locationId },
            {
              selectionSet: [
                'id',
                'x',
                'y',
                'width',
                'height',
                'image.width',
                'image.height',
              ] as const,
            },
          ).then(({ data }) =>
            Boolean(
              data?.image &&
              data.width != null &&
              data.height != null &&
              growToTile(
                sample,
                { ...data, width: data.width, height: data.height },
                data.image,
              ),
            ),
          );
          // A failed lookup is retried on the next test.
          fit.catch(() => fits.delete(entry.locationId));
          fits.set(entry.locationId, fit);
        }
        return fit;
      };
    }

    testingSetupPromiseRef.current = setupTesting();
    // Queue/test configuration is refreshed when the active membership changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPM]);

  const prepareTask = useCallback(
    async (
      message: AnnotationTaskMessage,
    ): Promise<AnnotationTaskPayload | null> => {
      const locationId = message.location?.id;
      if (!locationId) return null;

      const observationId = message.observationId;
      const [{ data: location }, done] = await Promise.all([
        client.models.Location.get(
          { id: locationId },
          { selectionSet: LOCATION_SELECTION },
        ),
        // A redelivered message someone else already completed.
        observationId && !ownObservationsRef.current.has(observationId)
          ? client.models.Observation.get(
              { id: observationId },
              { selectionSet: ['id'] },
            )
          : null,
      ]);
      if (done?.data) return null;
      if (
        !location?.image ||
        location.width == null ||
        location.height == null
      ) {
        return null;
      }

      const hydratedTask: AnnotationTaskPayload = {
        location: {
          id: location.id,
          x: location.x,
          y: location.y,
          width: location.width,
          height: location.height,
          confidence: location.confidence,
          source: location.source,
          image: location.image,
          annotationSetId: message.location.annotationSetId,
        },
        ack: message.ack ?? (() => {}),
        allowOutside: message.allowOutside,
        zoom: message.zoom,
        testPresetId: message.testPresetId,
        isTest: message.isTest,
        queueId: message.queueId,
        observationId: message.observationId,
        taskTag: message.taskTag,
        isFalseNegatives: message.isFalseNegatives,
      };

      if (!message.skipLocationWithAnnotations) {
        return hydratedTask;
      }

      const allAnnotations = await fetchAllPaginatedResults(
        client.models.Annotation.annotationsByImageIdAndSetId,
        {
          imageId: location.image.id,
          setId: { eq: message.location.annotationSetId },
          selectionSet: ['x', 'y', 'source'] as const,
          limit: 10000,
        },
      );
      const hasAnnotationWithinLocation = allAnnotations
        .filter(
          (annotation) =>
            !annotation.source ||
            !String(annotation.source).includes('false-negative'),
        )
        .some((annotation) => isWithinLocationBounds(annotation, location));

      return hasAnnotationWithinLocation ? null : hydratedTask;
    },
    [client],
  );

  const readyRef = useRef<AnnotationTaskPayload[]>([]);
  const [leases] = useState(() =>
    createLocationLeases(VISIBILITY_TIMEOUT_S * 1000),
  );
  const receivingRef = useRef<Promise<number> | null>(null);

  const prepareMessage = useCallback(
    async (
      entity: Message,
      sourceUrl: string,
      queueZoom: number | undefined,
      isFalseNegatives: boolean,
      receiveMs: number,
    ): Promise<AnnotationTaskPayload | null> => {
      const body = JSON.parse(entity.Body!) as AnnotationTaskMessage;
      if (entity.MessageId) {
        body.observationId = `queue-message:${entity.MessageId}`;
      }
      body.zoom = queueZoom;
      body.isFalseNegatives = isFalseNegatives;
      const ack = async () => {
        if (body.observationId) {
          ownObservationsRef.current.add(body.observationId);
        }
        try {
          // Re-resolve the client: the ack can fire long after the receive.
          const ackClient = await getSqsClient();
          await ackClient.send(
            new DeleteMessageCommand({
              QueueUrl: sourceUrl,
              ReceiptHandle: entity.ReceiptHandle,
            }),
          );
          if (body.location?.id) {
            processedLocationsRef.current.add(body.location.id);
          }
        } catch (error) {
          console.error(
            `Failed to acknowledge location ${body.location.id}`,
            error,
          );
          throw error;
        }
      };
      body.ack = ack;
      const discard = async () => {
        try {
          await ack();
        } catch {
          // The message reappears after its visibility timeout.
        }
        return null;
      };

      const locationId = body.location?.id;
      if (locationId && processedLocationsRef.current.has(locationId)) {
        return discard();
      }
      // Already waiting here: leave the copy in SQS in case this one is never done.
      if (locationId && !leases.claim(locationId)) return null;

      const hydrateStart = performance.now();
      const preparedTask = await prepareTask(body).catch((error: unknown) => {
        if (locationId) leases.release(locationId);
        throw error;
      });
      if (!preparedTask) {
        if (locationId) leases.release(locationId);
        return discard();
      }
      const taskId = preparedTask.location.id;
      if (taskId) {
        tileLoadStats.step(taskId, 'receive', receiveMs);
        tileLoadStats.step(taskId, 'hydrate', performance.now() - hydrateStart);
      }
      void primeTask(
        client as unknown as Parameters<typeof primeTask>[0],
        preparedTask.location,
      );

      return {
        ...preparedTask,
        // Last-resort filtering when the buffered task becomes visible.
        revalidate: async () => Boolean(await prepareTask(body)),
      };
    },
    [client, getSqsClient, prepareTask, leases],
  );

  const receiveBatch = useCallback(async (): Promise<number> => {
    const sqsClient = await getSqsClient();
    const receive = async (queueUrl: string) => {
      const startedAt = performance.now();
      const response = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: RECEIVE_BATCH_SIZE,
          MessageAttributeNames: ['All'],
          VisibilityTimeout: VISIBILITY_TIMEOUT_S,
        }),
      );
      return {
        messages: response.Messages ?? [],
        receiveMs: performance.now() - startedAt,
      };
    };

    let source = { url: url!, zoom, isFalseNegatives: isFnQueue };
    let received = await receive(url!);
    if (received.messages.length === 0 && backupUrl) {
      source = {
        url: backupUrl,
        zoom: backupZoom,
        isFalseNegatives: backupIsFnQueue,
      };
      received = await receive(backupUrl);
      if (received.messages.length > 0 && currentPM.backupQueueId) {
        touchQueue(client, currentPM.backupQueueId);
      }
    }

    const tasks = await Promise.all(
      received.messages.map((entity) =>
        prepareMessage(
          entity,
          source.url,
          source.zoom,
          source.isFalseNegatives,
          received.receiveMs,
        ).catch((error: unknown) => {
          console.error('Failed to prepare annotation task', error);
          return null;
        }),
      ),
    );
    readyRef.current.push(
      ...tasks.filter((task): task is AnnotationTaskPayload => task !== null),
    );
    return received.messages.length;
  }, [
    url,
    backupUrl,
    zoom,
    backupZoom,
    isFnQueue,
    backupIsFnQueue,
    getSqsClient,
    prepareMessage,
    client,
    currentPM.backupQueueId,
  ]);

  const receive = useCallback(() => {
    receivingRef.current ??= receiveBatch().finally(() => {
      receivingRef.current = null;
    });
    return receivingRef.current;
  }, [receiveBatch]);

  const fetcher = useCallback(async (): Promise<AnnotationTaskPayload> => {
    for (;;) {
      const ready = readyRef.current.shift();
      if (ready) {
        if (url && readyRef.current.length <= RECEIVE_AHEAD) {
          receive().catch((error: unknown) => {
            console.error('Receiving tasks ahead failed', error);
          });
        }
        return ready;
      }
      if (!url) {
        await sleep(5000);
        continue;
      }

      const received = await receive();
      if (readyRef.current.length > 0) continue;
      await sleep(received === 0 ? 5000 : 1000);
    }
  }, [url, receive]);

  const standbyTestFetcher =
    useCallback(async (): Promise<AnnotationTaskPayload | null> => {
      try {
        await testingSetupPromiseRef.current;
      } catch (error) {
        console.error('Failed to load test configuration', error);
        return null;
      }

      if (
        !testUserRef.current ||
        !configRef.current ||
        configRef.current.testType === 'none'
      ) {
        return null;
      }

      const testLocation = await testFetcher();
      if (!testLocation) return null;
      const task = await prepareTask(
        testLocation as unknown as AnnotationTaskMessage,
      );
      if (!task) return null;
      const sample = fnTileRef.current;
      if (!sample) {
        return { ...task, viewBoundsScale: testViewBoundsScaleRef.current };
      }

      const { location } = task;
      const grown = growToTile(sample, location, location.image);
      if (!grown) return null;
      const testBoxGrown =
        grown.x !== location.x ||
        grown.y !== location.y ||
        grown.width !== location.width ||
        grown.height !== location.height;
      // Served like a real tile so its size gives nothing away.
      return {
        ...task,
        location: { ...location, ...grown, testBoxGrown },
        allowOutside: false,
        isFalseNegatives: true,
        viewBoundsScale: testViewBoundsScaleRef.current,
      };
    }, [prepareTask, testFetcher]);

  const beforeNext = useCallback(
    async (
      completedTask: AnnotationTaskPayload & { id: string },
      completedIndex: number,
      { standbyReady }: { standbyReady: boolean },
    ): Promise<BeforeNextDecision<AnnotationTaskPayload>> => {
      try {
        await testingSetupPromiseRef.current;
      } catch (error) {
        // Testing setup must never prevent ordinary queue navigation.
        console.error('Failed to load test configuration', error);
      }

      // Going back and forward through retained buffer entries must not count
      // the same visible task more than once.
      if (completedIndex <= maxCadenceIndexRef.current) {
        setCurrentAnnoCount({});
        return null;
      }

      const userAnnotated = Object.values(currentAnnoCount).some(
        (annotations) => annotations.length > 0,
      );
      const decision = decideTestCadence({
        unannotatedJobs,
        userAnnotated,
        isTestTask: Boolean(completedTask.isTest),
        testingEnabled: testUserRef.current,
        config: configRef.current,
        jobsCompleted,
      });

      // The acknowledgement callback captures this task's annotation state
      // before navigation. Clear the shared working set for the next task.
      setCurrentAnnoCount({});

      if (!decision.shouldInsertTest) {
        maxCadenceIndexRef.current = completedIndex;
        setUnannotatedJobs(decision.nextUnannotatedJobs);
        return null;
      }

      if (standbyReady) {
        maxCadenceIndexRef.current = completedIndex;
        setUnannotatedJobs(0);
        return {
          kind: 'promote-standby',
          overrides: {
            taskTag: completedTask.taskTag || currentTaskTag,
          },
        };
      }

      // The threshold remains reached if warming has not finished. Navigation
      // continues normally and the next newly completed task retries.
      maxCadenceIndexRef.current = completedIndex;
      setUnannotatedJobs(decision.nextUnannotatedJobs);
      return null;
    },
    [
      currentAnnoCount,
      currentTaskTag,
      jobsCompleted,
      setCurrentAnnoCount,
      setUnannotatedJobs,
      unannotatedJobs,
    ],
  );

  return {
    fetcher: url ? fetcher : undefined,
    standbyTestFetcher,
    beforeNext,
  };
}
