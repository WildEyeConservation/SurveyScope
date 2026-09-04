import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams } from 'react-router-dom';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { Badge } from 'react-bootstrap';
import { UserContext } from './Context';
import { client } from './stores/appClient';
import { TaskBuffer } from './TaskBuffer';
import InfoTagAnnotation from './InfoTagAnnotation';
import { fetchAllPaginatedResults } from './utils';
import useUnsavedWorkGuard from './useUnsavedWorkGuard';

const VISIBILITY_TIMEOUT_SECONDS = 3600;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/** One informational-tagging job, as taken off the queue. */
type InfoTagTaskPayload = {
  imageId: string;
  annotationSetId: string;
  categoryIds: string[];
  ack: () => Promise<void>;
  stopHeartbeat: () => void;
};

export default function InfoTagTask() {
  useUnsavedWorkGuard();
  const { queueId } = useParams<{ queueId: string }>();
  const { getSqsClient, myMembershipHook } = useContext(UserContext)!;
  const [index, setIndex] = useState(0);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [queueUrl, setQueueUrl] = useState<string>();
  const [annotationSetId, setAnnotationSetId] = useState<string>();
  const [projectId, setProjectId] = useState<string>();
  const [group, setGroup] = useState<string>();
  const [queueZoom, setQueueZoom] = useState<number | null>(null);
  const processedRef = useRef(new Set<string>());
  const heartbeatTimersRef = useRef(new Set<number>());
  const activeMessageReleasesRef = useRef(new Set<() => Promise<void>>());

  useEffect(() => {
    if (!queueId) return;
    client.models.Queue.get({ id: queueId }).then(({ data }) => {
      if (data?.url) setQueueUrl(data.url);
      if (data?.annotationSetId) setAnnotationSetId(data.annotationSetId);
      if (data?.projectId) setProjectId(data.projectId);
      if (data?.group) setGroup(data.group);
      if (data?.zoom != null) setQueueZoom(data.zoom);
    });
  }, [queueId]);

  const [categories, setCategories] = useState<
    Array<{ id: string; name: string; shortcutKey: string | null }>
  >([]);
  const [infoTags, setInfoTags] = useState<
    Array<{
      id: string;
      name: string;
      shortcutKey: string | null;
      color: string | null;
    }>
  >([]);

  useEffect(() => {
    if (!annotationSetId) return;
    let mounted = true;
    Promise.all([
      fetchAllPaginatedResults(
        client.models.Category.categoriesByAnnotationSetId,
        {
          annotationSetId,
          selectionSet: ['id', 'name', 'shortcutKey'] as const,
          limit: 1000,
        }
      ),
      fetchAllPaginatedResults(
        client.models.InfoTag.infoTagsByAnnotationSetId,
        {
          annotationSetId,
          selectionSet: ['id', 'name', 'shortcutKey', 'color'] as const,
          limit: 1000,
        }
      ),
    ]).then(([categoryRows, infoTagRows]) => {
      if (!mounted) return;
      setCategories(
        categoryRows.map((category) => ({
          id: category.id,
          name: category.name,
          shortcutKey: category.shortcutKey ?? null,
        }))
      );
      setInfoTags(
        infoTagRows.map((tag) => ({
          id: tag.id,
          name: tag.name,
          shortcutKey: tag.shortcutKey ?? null,
          color: tag.color ?? null,
        }))
      );
    });
    return () => {
      mounted = false;
    };
  }, [annotationSetId]);

  useEffect(
    () => () => {
      for (const release of activeMessageReleasesRef.current) {
        void release();
      }
      for (const timer of heartbeatTimersRef.current) {
        window.clearInterval(timer);
      }
      activeMessageReleasesRef.current.clear();
      heartbeatTimersRef.current.clear();
    },
    []
  );

  const fetcher = useCallback(async (): Promise<InfoTagTaskPayload> => {
    for (;;) {
      if (!queueUrl) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        continue;
      }
      const sqsClient = await getSqsClient();
      const response = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 1,
          MessageAttributeNames: ['All'],
          VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
        })
      );
      const entity = response.Messages?.[0];
      if (!entity) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        continue;
      }

      const body = JSON.parse(entity.Body!);
      body.message_id = crypto.randomUUID();
      const imageId = body.imageId as string | undefined;
      if (imageId && processedRef.current.has(imageId)) {
        await sqsClient
          .send(
            new DeleteMessageCommand({
              QueueUrl: queueUrl,
              ReceiptHandle: entity.ReceiptHandle,
            })
          )
          .catch(() => undefined);
        continue;
      }
      if (imageId) processedRef.current.add(imageId);

      const heartbeat = window.setInterval(async () => {
        try {
          const heartbeatClient = await getSqsClient();
          await heartbeatClient.send(
            new ChangeMessageVisibilityCommand({
              QueueUrl: queueUrl,
              ReceiptHandle: entity.ReceiptHandle,
              VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
            })
          );
        } catch (error) {
          console.warn('Info Tags visibility heartbeat failed', {
            imageId,
            error,
          });
        }
      }, HEARTBEAT_INTERVAL_MS);
      heartbeatTimersRef.current.add(heartbeat);
      const stopHeartbeat = () => {
        window.clearInterval(heartbeat);
        heartbeatTimersRef.current.delete(heartbeat);
      };
      body.stopHeartbeat = stopHeartbeat;
      let settled = false;
      let acknowledgePromise: Promise<void> | null = null;
      let releasePromise: Promise<void> | null = null;
      const release = async () => {
        stopHeartbeat();
        if (acknowledgePromise) await acknowledgePromise;
        if (settled) return;
        if (!releasePromise) {
          releasePromise = (async () => {
            try {
              const releaseClient = await getSqsClient();
              await releaseClient.send(
                new ChangeMessageVisibilityCommand({
                  QueueUrl: queueUrl,
                  ReceiptHandle: entity.ReceiptHandle,
                  VisibilityTimeout: 0,
                })
              );
              settled = true;
              activeMessageReleasesRef.current.delete(release);
            } catch (error) {
              console.warn('Info Tags message release failed', { imageId, error });
            }
          })();
        }
        await releasePromise;
      };
      activeMessageReleasesRef.current.add(release);
      body.ack = async () => {
        stopHeartbeat();
        if (releasePromise) await releasePromise;
        if (settled) return;
        if (!acknowledgePromise) {
          acknowledgePromise = (async () => {
            try {
              const ackClient = await getSqsClient();
              await ackClient.send(
                new DeleteMessageCommand({
                  QueueUrl: queueUrl,
                  ReceiptHandle: entity.ReceiptHandle,
                })
              );
              settled = true;
              activeMessageReleasesRef.current.delete(release);
            } catch (error) {
              console.warn('Info Tags acknowledgement failed', { imageId, error });
            }
          })();
        }
        await acknowledgePromise;
      };
      return body;
    }
  }, [getSqsClient, queueUrl]);

  const [imagesRemaining, setImagesRemaining] = useState('Unknown');
  useEffect(() => {
    if (!queueUrl) return;
    const update = async () => {
      try {
        const sqsClient = await getSqsClient();
        const result = await sqsClient.send(
          new GetQueueAttributesCommand({
            QueueUrl: queueUrl,
            AttributeNames: ['ApproximateNumberOfMessages'],
          })
        );
        setImagesRemaining(
          result.Attributes?.ApproximateNumberOfMessages ?? 'Unknown'
        );
      } catch {
        // Status is best effort.
      }
    };
    update();
    const timer = window.setInterval(update, 10000);
    return () => window.clearInterval(timer);
  }, [getSqsClient, queueUrl]);

  const adminMemberships = useMemo(
    () =>
      myMembershipHook.data
        ?.filter((membership) => membership.isAdmin)
        .map((membership) => ({
          projectId: membership.projectId,
          queueId: membership.queueId!,
        })),
    [myMembershipHook.data]
  );

  return (
    <div
      className='d-flex flex-column align-items-center gap-3 w-100 h-100'
      style={{ paddingTop: 12, paddingBottom: 12 }}
    >
      <div className='w-100 h-100'>
        {queueUrl && categories.length > 0 && infoTags.length > 0 ? (
          <TaskBuffer
            index={index}
            setIndex={setIndex}
            fetcher={fetcher}
            visible
            preloadN={2}
            historyN={1}
            renderTask={(task) => (
              <InfoTagAnnotation
                {...task}
                categories={categories}
                infoTags={infoTags}
                projectId={projectId}
                group={group}
                queueId={queueId!}
                queueZoom={queueZoom}
                setQueueZoom={setQueueZoom}
                adminMemberships={adminMemberships}
                legendCollapsed={legendCollapsed}
                setLegendCollapsed={setLegendCollapsed}
              />
            )}
          />
        ) : (
          <div className='d-flex justify-content-center align-items-center h-100'>
            <div className='text-muted'>Loading informational tagging queue...</div>
          </div>
        )}
      </div>
      <Badge className='d-flex flex-row align-items-center justify-content-center gap-3 p-2 w-100 bg-secondary flex-wrap'>
        <p className='mb-0'>{imagesRemaining} images remaining</p>
        <span className='d-none d-sm-block'>|</span>
        <p className='mb-0'>{index} images completed in this session</p>
      </Badge>
    </div>
  );
}
