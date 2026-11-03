import { useEffect, useState, useContext, useCallback, useRef } from 'react';
import { UserContext, ProjectContext, GlobalContext } from './Context';
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import type { Schema } from './amplify/client-schema';
import useTesting from './useTesting';
import type {
  AnnotationTaskPayload,
  TaskAcknowledgement,
} from './annotationTypes';
import { fetchAllPaginatedResults, isWithinLocationBounds } from './utils';
import { subscribeToSharedDefaultZoom } from './defaultZoomEvents';
import { decideTestCadence } from './testCadence';
import type { BeforeNextDecision } from './TaskBuffer';
import { tileLoadStats } from './storage/tileLoadStats';
import { createLocationLeases } from './locationLeases';
import { primeTask } from './annotator/prefetchTask';
import { touchQueue } from './touchQueue';

const LOCATION_SELECTION = [
  'id',
  'x',
  'y',
  'width',
  'height',
  'confidence',
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
  // Use ref instead of state to prevent fetcher reference churn on every new location
  const processedLocationsRef = useRef<Set<string>>(new Set());

  // user testing state
  const configRef = useRef<Schema['ProjectTestConfig']['type']>();
  const testUserRef = useRef(false);
  const testingSetupPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const maxCadenceIndexRef = useRef(-1);
  const { fetcher: testFetcher } = useTesting();
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
    [currentPM.projectId]
  );

  useEffect(() => {
    if (currentPM.queueId) {
      touchQueue(client, currentPM.queueId);
      client.models.Queue.get({ id: currentPM.queueId }).then(({ data }) => {
        if (!data) return;
        setUrl(data.url ?? undefined);
        setZoom(data.zoom ?? undefined);
      });
      if (currentPM.backupQueueId) {
        client.models.Queue.get({ id: currentPM.backupQueueId }).then(
          ({ data }) => {
            if (!data) return;
            setBackupUrl(data.url ?? undefined);
            setBackupZoom(data.zoom ?? undefined);
          }
        );
      }
    }

    async function setupTesting() {
      configRef.current = undefined;
      testUserRef.current = false;
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
        }
      );

      if (config?.projectId) {
        configRef.current = config;

        const shouldTest =
          myOrganizationHook.data?.find(
            (membership) =>
              membership.organizationId === config.project.organizationId
          )?.isTested ?? false;
        testUserRef.current = shouldTest;
      }
    }

    testingSetupPromiseRef.current = setupTesting();
    // Queue/test configuration is refreshed when the active membership changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPM]);

  const prepareTask = useCallback(
    async (
      message: AnnotationTaskMessage
    ): Promise<AnnotationTaskPayload | null> => {
      const locationId = message.location?.id;
      if (!locationId) return null;

      const { data: location } = await client.models.Location.get(
        { id: locationId },
        { selectionSet: LOCATION_SELECTION }
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
        }
      );
      const hasAnnotationWithinLocation = allAnnotations
        .filter(
          (annotation) =>
            !annotation.source ||
            !String(annotation.source).includes('false-negative')
        )
        .some((annotation) => isWithinLocationBounds(annotation, location));

      return hasAnnotationWithinLocation ? null : hydratedTask;
    },
    [client]
  );

  const readyRef = useRef<AnnotationTaskPayload[]>([]);
  const [leases] = useState(() =>
    createLocationLeases(VISIBILITY_TIMEOUT_S * 1000)
  );
  const receivingRef = useRef<Promise<number> | null>(null);

  const prepareMessage = useCallback(
    async (
      entity: Message,
      sourceUrl: string,
      queueZoom: number | undefined,
      receiveMs: number
    ): Promise<AnnotationTaskPayload | null> => {
      const body = JSON.parse(entity.Body!) as AnnotationTaskMessage;
      if (entity.MessageId) {
        body.observationId = `queue-message:${entity.MessageId}`;
      }
      body.zoom = queueZoom;
      const ack = async () => {
        try {
          // Re-resolve the client: the ack can fire long after the receive.
          const ackClient = await getSqsClient();
          await ackClient.send(
            new DeleteMessageCommand({
              QueueUrl: sourceUrl,
              ReceiptHandle: entity.ReceiptHandle,
            })
          );
          if (body.location?.id) {
            processedLocationsRef.current.add(body.location.id);
          }
        } catch (error) {
          console.error(
            `Failed to acknowledge location ${body.location.id}`,
            error
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
        preparedTask.location
      );

      return {
        ...preparedTask,
        // Last-resort filtering when the buffered task becomes visible.
        revalidate: async () => Boolean(await prepareTask(body)),
      };
    },
    [client, getSqsClient, prepareTask, leases]
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
        })
      );
      return {
        messages: response.Messages ?? [],
        receiveMs: performance.now() - startedAt,
      };
    };

    let source = { url: url!, zoom };
    let received = await receive(url!);
    if (received.messages.length === 0 && backupUrl) {
      source = { url: backupUrl, zoom: backupZoom };
      received = await receive(backupUrl);
      if (received.messages.length > 0 && currentPM.backupQueueId) {
        touchQueue(client, currentPM.backupQueueId);
      }
    }

    const tasks = await Promise.all(
      received.messages.map((entity) =>
        prepareMessage(entity, source.url, source.zoom, received.receiveMs).catch(
          (error: unknown) => {
            console.error('Failed to prepare annotation task', error);
            return null;
          }
        )
      )
    );
    readyRef.current.push(
      ...tasks.filter((task): task is AnnotationTaskPayload => task !== null)
    );
    return received.messages.length;
  }, [url, backupUrl, zoom, backupZoom, getSqsClient, prepareMessage, client, currentPM.backupQueueId]);

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

  const standbyTestFetcher = useCallback(
    async (): Promise<AnnotationTaskPayload | null> => {
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
      return prepareTask(testLocation as unknown as AnnotationTaskMessage);
    },
    [prepareTask, testFetcher]
  );

  const beforeNext = useCallback(
    async (
      completedTask: AnnotationTaskPayload & { id: string },
      completedIndex: number,
      { standbyReady }: { standbyReady: boolean }
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
        (annotations) => annotations.length > 0
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
    ]
  );

  return {
    fetcher: url ? fetcher : undefined,
    standbyTestFetcher,
    beforeNext,
  };
}
