import { Badge } from '@/components/ui/badge';
import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { GlobalContext, UserContext } from './Context';
import QCAnnotationReview from './QCAnnotationReview';
import { TaskBuffer } from './TaskBuffer';
import { touchQueue } from './touchQueue';
import useUnsavedWorkGuard from './useUnsavedWorkGuard';
import { fetchAllPaginatedResults } from './utils';

/**
 * QC Review Task — SQS-driven task buffer for annotation QC review.
 *
 * Tailored for QC review messages whose body shape is
 * `{ annotation: {...}, queueId: string }`.
 */
export default function QCReviewTask() {
  const { queueId } = useParams<{ queueId: string }>();
  const { getSqsClient, myMembershipHook } = useContext(UserContext)!;
  const { client } = useContext(GlobalContext)!;
  const [index, setIndex] = useState(0);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  useUnsavedWorkGuard();
  const [queueUrl, setQueueUrl] = useState<string | undefined>(undefined);
  const [annotationSetId, setAnnotationSetId] = useState<string | undefined>(
    undefined,
  );
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [group, setGroup] = useState<string | undefined>(undefined);
  const processedRef = useRef<Set<string>>(new Set());

  const [queueZoom, setQueueZoom] = useState<number | null>(null);

  // Fetch queue URL and annotationSetId on mount.
  useEffect(() => {
    if (!queueId) return;
    touchQueue(client, queueId);
    client.models.Queue.get({ id: queueId }).then(({ data }) => {
      if (data?.url) setQueueUrl(data.url as string);
      if (data?.annotationSetId) setAnnotationSetId(data.annotationSetId);
      if (data?.projectId) setProjectId(data.projectId);
      if (data?.group) setGroup(data.group);
      if (data?.zoom != null) setQueueZoom(data.zoom);
    });
  }, [queueId, client]);

  // Fetch categories for this annotation set (needed by the review component).
  const [categories, setCategories] = useState<
    Array<{ id: string; name: string; shortcutKey: string | null }>
  >([]);

  useEffect(() => {
    if (!annotationSetId) return;
    let mounted = true;
    fetchAllPaginatedResults(
      client.models.Category.categoriesByAnnotationSetId,
      {
        annotationSetId,
        selectionSet: ['id', 'name', 'shortcutKey'] as const,
      },
    ).then((cats) => {
      if (!mounted) return;
      setCategories(
        cats.map((c: any) => ({
          id: c.id,
          name: c.name,
          shortcutKey: c.shortcutKey ?? null,
        })),
      );
    });
    return () => {
      mounted = false;
    };
  }, [annotationSetId, client]);

  const fetcher = useCallback(async () => {
    while (true) {
      if (!queueUrl) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const sqsClient = await getSqsClient();
      const response = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 1,
          MessageAttributeNames: ['All'],
          VisibilityTimeout: 600,
        }),
      );

      if (response.Messages) {
        const entity = response.Messages[0];
        const body = JSON.parse(entity.Body!);
        body.message_id = crypto.randomUUID();

        // Deduplication by annotation ID.
        const annotationId = body.annotation?.id;
        if (annotationId && processedRef.current.has(annotationId)) {
          try {
            const sqsClient2 = await getSqsClient();
            await sqsClient2.send(
              new DeleteMessageCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: entity.ReceiptHandle,
              }),
            );
          } catch {
            // ignore
          }
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }

        body.ack = async () => {
          try {
            const sqsClient2 = await getSqsClient();
            await sqsClient2.send(
              new DeleteMessageCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: entity.ReceiptHandle,
              }),
            );
          } catch (err) {
            console.error(
              `QC ack failed for annotation ${annotationId} with receipthandle ${entity.ReceiptHandle}`,
              err,
            );
            // The caller must know the message is still on the queue, so the
            // annotation is not recorded as handled below.
            throw err;
          }
          // Marking the annotation handled only after its message is really
          // gone: doing it on receipt meant a redelivery following a failed
          // save was discarded here as a duplicate, losing the review. A
          // genuine duplicate is still safe, because committing a review is
          // idempotent for the same reviewer.
          if (annotationId) {
            processedRef.current.add(annotationId);
          }
        };

        return body;
      } else {
        // No messages — wait and retry.
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }, [queueUrl, getSqsClient]);

  // Poll SQS for approximate remaining messages.
  const [jobsRemaining, setJobsRemaining] = useState<string>('Unknown');

  useEffect(() => {
    if (!queueUrl) return;
    const updateJobs = async () => {
      try {
        const sqsClient = await getSqsClient();
        const result = await sqsClient.send(
          new GetQueueAttributesCommand({
            QueueUrl: queueUrl,
            AttributeNames: ['ApproximateNumberOfMessages'],
          }),
        );
        setJobsRemaining(
          result.Attributes?.ApproximateNumberOfMessages || 'Unknown',
        );
      } catch {
        // ignore polling errors
      }
    };
    updateJobs();
    const interval = setInterval(updateJobs, 10000);
    return () => clearInterval(interval);
  }, [queueUrl, getSqsClient]);

  return (
    <div
      className='flex h-full w-full flex-col items-center gap-4'
      style={{ paddingTop: '12px', paddingBottom: '12px' }}
    >
      <div className='h-full w-full'>
        {queueUrl && categories.length > 0 ? (
          <TaskBuffer
            index={index}
            setIndex={setIndex}
            fetcher={fetcher}
            visible={true}
            preloadN={3}
            historyN={2}
            renderTask={(task) => (
              <QCAnnotationReview
                {...task}
                annotation={task.annotation}
                message_id={task.message_id}
                ack={task.ack}
                categories={categories}
                setCategories={setCategories}
                projectId={projectId}
                annotationSetId={annotationSetId!}
                group={group}
                queueId={queueId!}
                queueZoom={queueZoom}
                setQueueZoom={setQueueZoom}
                adminMemberships={myMembershipHook.data
                  ?.filter((membership: any) => membership.isAdmin)
                  .map((membership: any) => ({
                    projectId: membership.projectId,
                    queueId: membership.queueId!,
                  }))}
                legendCollapsed={legendCollapsed}
                setLegendCollapsed={setLegendCollapsed}
              />
            )}
          />
        ) : (
          <div className='flex h-full items-center justify-center'>
            <div className='text-muted-foreground'>
              Loading QC review queue...
            </div>
          </div>
        )}
      </div>
      <Badge className='flex w-full flex-row flex-wrap items-center justify-center gap-4 bg-secondary p-2'>
        <p className='mb-0'>{jobsRemaining} jobs remaining (globally)</p>
        <span className='hidden sm:block'>|</span>
        <p className='mb-0'>{index} jobs completed in this session</p>
      </Badge>
    </div>
  );
}
