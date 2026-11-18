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
import type { TestBox, TestContextAnnotation } from './api/tasks';
import { ackTask, receiveTasks, type ReceivedTask } from './api/tasks';
import { subscribeToSharedDefaultZoom } from './defaultZoomEvents';
import { createLocationLeases } from './locationLeases';
import { tileLoadStats } from './storage/tileLoadStats';
import { decideTestCadence } from './testCadence';
import { touchQueue } from './touchQueue';
import useTesting, { type TileSample, type TileSource } from './useTesting';
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

function waiter() {
  const waiter = { done: false, resolve: () => {}, ready: Promise.resolve() };
  waiter.ready = new Promise<void>((resolve) => {
    waiter.resolve = () => {
      waiter.done = true;
      resolve();
    };
  });
  return waiter;
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
  testLeaseId?: string;
  testBox?: TestBox;
  testContext?: TestContextAnnotation[];
  queueId?: string;
  observationId?: string;
  taskTag?: string;
  isFalseNegatives?: boolean;
}

export default function useAnnotationTaskQueue() {
  const { currentPM } = useContext(ProjectContext)!;
  const { myOrganizationHook } = useContext(UserContext)!;
  const { client } = useContext(GlobalContext)!;
  const [queueId, setQueueId] = useState<string | undefined>(undefined);
  const [backupQueueId, setBackupQueueId] = useState<string | undefined>(
    undefined,
  );
  const [zoom, setZoom] = useState<number | undefined>(undefined);
  const [backupZoom, setBackupZoom] = useState<number | undefined>(undefined);
  const [isFnQueue, setIsFnQueue] = useState(false);
  const [backupIsFnQueue, setBackupIsFnQueue] = useState(false);
  // Use ref instead of state to prevent fetcher reference churn on every new location
  const processedLocationsRef = useRef<Set<string>>(new Set());

  // user testing state
  const configRef = useRef<Schema['ProjectTestConfig']['type']>();
  const testUserRef = useRef(false);
  const testViewBoundsScaleRef = useRef<number | undefined>(undefined);
  const testingSetupPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const maxCadenceIndexRef = useRef(-1);
  // Taken from the first task of the primary queue.
  const tileRef = useRef<TileSample | undefined>(undefined);
  const workReadyRef = useRef(waiter());
  const tileReadyRef = useRef(waiter());
  // Set in False Negatives jobs, whose tests are grown to the tile size.
  const testGrowRef = useRef<TileSource | undefined>(undefined);
  const { fetcher: testFetcher } = useTesting(testGrowRef);
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
        setQueueId(data.url ? data.id : undefined);
        setZoom(data.zoom ?? undefined);
      });
      if (currentPM.backupQueueId) {
        client.models.Queue.get({ id: currentPM.backupQueueId }).then(
          ({ data }) => {
            if (!data) return;
            setBackupIsFnQueue(data.name === FALSE_NEGATIVES_QUEUE);
            setBackupQueueId(data.url ? data.id : undefined);
            setBackupZoom(data.zoom ?? undefined);
          },
        );
      }
    }

    async function setupTesting() {
      configRef.current = undefined;
      testUserRef.current = false;
      testViewBoundsScaleRef.current = undefined;
      // Keep an unresolved waiter so a pending standby fetch still wakes.
      if (workReadyRef.current.done) workReadyRef.current = waiter();
      if (tileReadyRef.current.done) tileReadyRef.current = waiter();
      tileRef.current = undefined;
      testGrowRef.current = undefined;
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
              { selectionSet: ['name'] },
            )
          : { data: null };
        const shouldTest =
          myOrganizationHook.data?.find(
            (membership) =>
              membership.organizationId === config.project.organizationId,
          )?.isTested ?? false;
        testUserRef.current = shouldTest;

        // False-negative jobs show large tiles, so a small test box stands out.
        if (shouldTest && queue?.name === FALSE_NEGATIVES_QUEUE) {
          testGrowRef.current = () => tileRef.current;
        }
      }
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

      const { data: location } = await client.models.Location.get(
        { id: locationId },
        { selectionSet: LOCATION_SELECTION },
      );
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
        testLeaseId: message.testLeaseId,
        testContext: message.testContext,
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
      received: ReceivedTask,
      queueZoom: number | undefined,
      isFalseNegatives: boolean,
      receiveMs: number,
    ): Promise<AnnotationTaskPayload | null> => {
      const body = JSON.parse(received.body) as AnnotationTaskMessage;
      body.observationId = `queue-message:${received.messageId}`;
      body.zoom = queueZoom;
      body.isFalseNegatives = isFalseNegatives;
      const ack = async () => {
        try {
          await ackTask(received.leaseId);
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
    [client, prepareTask, leases],
  );

  const receiveBatch = useCallback(async (): Promise<number> => {
    const receive = async (id: string) => {
      const startedAt = performance.now();
      const messages = await receiveTasks(
        id,
        RECEIVE_BATCH_SIZE,
        VISIBILITY_TIMEOUT_S,
      );
      return { messages, receiveMs: performance.now() - startedAt };
    };

    let source = { zoom, isFalseNegatives: isFnQueue, primary: true };
    let received = await receive(queueId!);
    if (received.messages.length === 0 && backupQueueId) {
      source = {
        zoom: backupZoom,
        isFalseNegatives: backupIsFnQueue,
        primary: false,
      };
      received = await receive(backupQueueId);
      if (received.messages.length > 0) touchQueue(client, backupQueueId);
    }

    const tasks = await Promise.all(
      received.messages.map((message) =>
        prepareMessage(
          message,
          source.zoom,
          source.isFalseNegatives,
          received.receiveMs,
        ).catch((error: unknown) => {
          console.error('Failed to prepare annotation task', error);
          return null;
        }),
      ),
    );
    const ready = tasks.filter(
      (task): task is AnnotationTaskPayload => task !== null,
    );
    // Tests must open like the job's tiles, or they stand out.
    const sample = source.primary ? ready[0]?.location : undefined;
    if (sample && !tileRef.current) {
      tileRef.current = {
        tile: { width: sample.width, height: sample.height },
        image: { width: sample.image.width, height: sample.image.height },
      };
      if (sample.source === 'manual') {
        testViewBoundsScaleRef.current = TILE_VIEW_BOUNDS_SCALE;
      }
      tileReadyRef.current.resolve();
    }
    // Backup work also releases tests; only False Negatives tests need the sample.
    if (ready.length) workReadyRef.current.resolve();
    readyRef.current.push(...ready);
    return received.messages.length;
  }, [
    queueId,
    backupQueueId,
    zoom,
    backupZoom,
    isFnQueue,
    backupIsFnQueue,
    prepareMessage,
    client,
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
        if (queueId && readyRef.current.length <= RECEIVE_AHEAD) {
          receive().catch((error: unknown) => {
            console.error('Receiving tasks ahead failed', error);
          });
        }
        return ready;
      }
      if (!queueId) {
        await sleep(5000);
        continue;
      }

      const received = await receive();
      if (readyRef.current.length > 0) continue;
      await sleep(received === 0 ? 5000 : 1000);
    }
  }, [queueId, receive]);

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

      const growTests = Boolean(testGrowRef.current);
      await (growTests ? tileReadyRef : workReadyRef).current.ready;

      const testLocation = (await testFetcher()) as
        (AnnotationTaskMessage & { testBox?: TestBox }) | null;
      if (!testLocation) return null;
      const task = await prepareTask(testLocation);
      if (!task) return null;
      const grown = testLocation.testBox;
      if (!grown) {
        return { ...task, viewBoundsScale: testViewBoundsScaleRef.current };
      }

      // The server grew the box; it is served like a real tile so its size gives nothing away.
      const { location } = task;
      const testBoxGrown =
        grown.x !== location.x ||
        grown.y !== location.y ||
        grown.width !== location.width ||
        grown.height !== location.height;
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
    fetcher: queueId ? fetcher : undefined,
    standbyTestFetcher,
    beforeNext,
  };
}
