import { Badge } from '@/components/ui/badge';
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
  ackTask,
  queueDepths,
  receiveTask,
  setTaskVisibility,
} from './api/tasks';
import ClaimedInfoTagImage from './ClaimedInfoTagImage';
import { GlobalContext, UserContext } from './Context';
import { createInfoTagDelivery } from './infoTagDelivery';
import { plural } from './survey/launchLabel';
import { TaskBuffer } from './TaskBuffer';
import { touchQueue } from './touchQueue';
import useUnsavedWorkGuard from './useUnsavedWorkGuard';
import { fetchAllPaginatedResults } from './utils';

const VISIBILITY_TIMEOUT_SECONDS = 3600;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/** One informational-tagging job, as taken off the queue. */
type InfoTagTaskPayload = {
  imageId: string;
  annotationSetId: string;
  categoryIds: string[];
  ack: () => Promise<void>;
  defer: () => Promise<void>;
};

export default function InfoTagTask() {
  useUnsavedWorkGuard();
  const { queueId } = useParams<{ queueId: string }>();
  const { myMembershipHook } = useContext(UserContext)!;
  const { client } = useContext(GlobalContext)!;
  const [index, setIndex] = useState(0);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [queueUrl, setQueueUrl] = useState<string>();
  const [annotationSetId, setAnnotationSetId] = useState<string>();
  const [projectId, setProjectId] = useState<string>();
  const [group, setGroup] = useState<string>();
  const [queueZoom, setQueueZoom] = useState<number | null>(null);
  const receivedRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const heartbeatTimersRef = useRef(new Set<number>());
  const activeMessageReleasesRef = useRef(new Set<() => Promise<void>>());

  useEffect(() => {
    if (!queueId) return;
    touchQueue(client, queueId);
    client.models.Queue.get({ id: queueId }).then(({ data }) => {
      if (data?.url) setQueueUrl(data.url);
      if (data?.annotationSetId) setAnnotationSetId(data.annotationSetId);
      if (data?.projectId) setProjectId(data.projectId);
      if (data?.group) setGroup(data.group);
      if (data?.zoom != null) setQueueZoom(data.zoom);
    });
  }, [client, queueId]);

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
        },
      ),
      fetchAllPaginatedResults(
        client.models.InfoTag.infoTagsByAnnotationSetId,
        {
          annotationSetId,
          selectionSet: ['id', 'name', 'shortcutKey', 'color'] as const,
          limit: 1000,
        },
      ),
    ]).then(([categoryRows, infoTagRows]) => {
      if (!mounted) return;
      setCategories(
        categoryRows.map((category) => ({
          id: category.id,
          name: category.name,
          shortcutKey: category.shortcutKey ?? null,
        })),
      );
      setInfoTags(
        infoTagRows.map((tag) => ({
          id: tag.id,
          name: tag.name,
          shortcutKey: tag.shortcutKey ?? null,
          color: tag.color ?? null,
        })),
      );
    });
    return () => {
      mounted = false;
    };
  }, [annotationSetId, client]);

  useEffect(() => {
    mountedRef.current = true;
    const releases = activeMessageReleasesRef.current;
    const heartbeats = heartbeatTimersRef.current;
    const received = receivedRef.current;
    return () => {
      mountedRef.current = false;
      for (const release of releases) {
        void release().catch((error) =>
          console.warn('Info Tags message release failed', error),
        );
      }
      for (const timer of heartbeats) {
        window.clearInterval(timer);
      }
      releases.clear();
      heartbeats.clear();
      received.clear();
    };
  }, []);

  const fetcher = useCallback(async (): Promise<InfoTagTaskPayload> => {
    while (mountedRef.current) {
      if (!queueUrl) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        continue;
      }
      try {
        const received = await receiveTask(
          queueId!,
          VISIBILITY_TIMEOUT_SECONDS,
        );
        if (!received) {
          await new Promise((resolve) => window.setTimeout(resolve, 5000));
          continue;
        }
        const { leaseId } = received;
        const changeVisibility = (seconds: number) =>
          setTaskVisibility(leaseId, seconds).then(() => undefined);
        if (!mountedRef.current) {
          await changeVisibility(0);
          break;
        }
        const body = JSON.parse(received.body);
        const imageId = body.imageId as string;
        if (!imageId || typeof imageId !== 'string')
          throw new Error('Invalid Info Tags message');
        if (receivedRef.current.has(imageId)) {
          // Receipt is not completion. Keep duplicates recoverable until the
          // backend confirms the image is finished.
          await changeVisibility(30);
          continue;
        }
        receivedRef.current.add(imageId);
        const heartbeat = window.setInterval(() => {
          void changeVisibility(VISIBILITY_TIMEOUT_SECONDS).catch((error) =>
            console.warn('Info Tags visibility heartbeat failed', {
              imageId,
              error,
            }),
          );
        }, HEARTBEAT_INTERVAL_MS);
        heartbeatTimersRef.current.add(heartbeat);
        const stopHeartbeat = () => {
          window.clearInterval(heartbeat);
          heartbeatTimersRef.current.delete(heartbeat);
        };
        const delivery = createInfoTagDelivery({
          remove: () => ackTask(leaseId).then(() => undefined),
          visibility: changeVisibility,
          stopHeartbeat,
          onSettled: () => {
            receivedRef.current.delete(imageId);
            activeMessageReleasesRef.current.delete(delivery.release);
          },
        });
        activeMessageReleasesRef.current.add(delivery.release);
        return { ...body, ack: delivery.ack, defer: delivery.defer };
      } catch (error) {
        if (!mountedRef.current) break;
        console.warn('Could not receive Info Tags work; retrying', error);
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
      }
    }
    throw new Error('Info Tags session closed');
  }, [queueId, queueUrl]);

  const [imagesRemaining, setImagesRemaining] = useState('Unknown');
  useEffect(() => {
    if (!queueUrl) return;
    const update = async () => {
      try {
        const depths = await queueDepths([queueId!]);
        setImagesRemaining(depths[queueId!] ?? 'Unknown');
      } catch {
        // Status is best effort.
      }
    };
    update();
    const timer = window.setInterval(update, 10000);
    return () => window.clearInterval(timer);
  }, [queueId, queueUrl]);

  const adminMemberships = useMemo(
    () =>
      myMembershipHook.data
        ?.filter((membership) => membership.isAdmin)
        .map((membership) => ({
          projectId: membership.projectId,
          queueId: membership.queueId!,
        })),
    [myMembershipHook.data],
  );

  return (
    <div
      className='flex h-full w-full flex-col items-center gap-4'
      style={{ paddingTop: 12, paddingBottom: 12 }}
    >
      <div className='h-full w-full'>
        {queueUrl && categories.length > 0 && infoTags.length > 0 ? (
          <TaskBuffer
            index={index}
            setIndex={setIndex}
            fetcher={fetcher}
            visible
            preloadN={2}
            historyN={1}
            renderTask={(task) => (
              <ClaimedInfoTagImage
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
          <div className='flex h-full items-center justify-center'>
            <div className='text-muted-foreground'>
              Loading informational tagging queue...
            </div>
          </div>
        )}
      </div>
      <Badge className='flex w-full flex-row flex-wrap items-center justify-center gap-4 bg-secondary p-2'>
        <p className='mb-0'>
          {imagesRemaining === '1' ? '1 image' : `${imagesRemaining} images`}{' '}
          remaining
        </p>
        <span className='hidden sm:block'>|</span>
        <p className='mb-0'>
          {plural(index, 'image')} completed in this session
        </p>
      </Badge>
    </div>
  );
}
