import { useEffect, useState, useContext, useCallback, useRef } from 'react';
import { UserContext } from './Context';
import { client } from './stores/appClient';
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
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
import { useCurrentMembershipRow } from './data/projectScope';

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
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const currentPM = useCurrentMembershipRow();
  const { getSqsClient, myOrganizationHook } = useContext(UserContext)!;
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
    []
  );

  const fetcher = useCallback(async (): Promise<AnnotationTaskPayload> => {
    for (;;) {
      if (!url) {
        await sleep(5000);
        continue;
      }

      const sqsClient = await getSqsClient();

      const getResponse = (queueUrl: string) =>
        sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: 1,
            MessageAttributeNames: ['All'],
            VisibilityTimeout: 600,
          })
        );

      let response = await getResponse(url);
      let usingBackup = false;

      if (!response.Messages && backupUrl) {
        response = await getResponse(backupUrl);
        usingBackup = Boolean(response.Messages);
      }

      if (!response.Messages) {
        await sleep(5000);
        continue;
      }

      const sourceUrl = usingBackup ? backupUrl! : url;
      const entity = response.Messages[0];
      const body = JSON.parse(entity.Body!) as AnnotationTaskMessage;
      if (entity.MessageId) {
        body.observationId = `queue-message:${entity.MessageId}`;
      }
      body.zoom = usingBackup ? backupZoom : zoom;
      body.ack = async () => {
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

      if (
        body.location?.id &&
        processedLocationsRef.current.has(body.location.id)
      ) {
        try {
          await body.ack();
        } catch {
          await sleep(1000);
        }
        // Back off so a run of duplicates cannot spin the loop.
        await sleep(500);
        continue;
      }

      const preparedTask = await prepareTask(body);
      if (!preparedTask) {
        try {
          await body.ack();
        } catch {
          await sleep(1000);
        }
        await sleep(1000);
        continue;
      }

      return {
        ...preparedTask,
        // Last-resort filtering when the buffered task becomes visible.
        revalidate: async () => Boolean(await prepareTask(body)),
      };
    }
  }, [url, backupUrl, getSqsClient, prepareTask, zoom, backupZoom]);

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
