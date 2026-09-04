import { useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UserContext } from '../Context';
import { client } from '../stores/appClient';
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { Badge } from 'react-bootstrap';
import {
  HomographyWorkbenchWorker,
  type HomographyMessage,
} from './HomographyWorkbenchWorker';
import type { Point } from './ManualHomographyEditor';

export default function HomographyTask() {
  const { queueId } = useParams<{ queueId: string }>();
  const { getSqsClient } = useContext(UserContext)!;
  const navigate = useNavigate();

  const [queueUrl, setQueueUrl] = useState<string | undefined>(undefined);
  const [buffer, setBuffer] = useState<HomographyMessage[]>([]);
  const [index, setIndex] = useState(0);
  const [sessionCompleted, setSessionCompleted] = useState(0);
  const [isFetching, setIsFetching] = useState(false);
  const isFetchingRef = useRef(false);
  const [queueEmpty, setQueueEmpty] = useState(false);
  const processedRef = useRef<Set<string>>(new Set());
  const savedPointsRef = useRef<Map<string, { p1: Point[]; p2: Point[] }>>(
    new Map()
  );
  // Tracks which pairs have been successfully saved
  const [savedPairs, setSavedPairs] = useState<Set<string>>(new Set());
  // Tracks the highest index the user has advanced to (via complete/skip)
  const frontierIndexRef = useRef(0);

  // Fetch queue URL on mount
  useEffect(() => {
    if (!queueId) return;
    client.models.Queue.get({ id: queueId }).then(({ data }) => {
      if (data?.url) setQueueUrl(data.url as string);
    });
  }, [queueId]);

  // Fetch next message from SQS
  const fetchNext = useCallback(async () => {
    if (!queueUrl || isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsFetching(true);

    try {
      let attempts = 0;
      while (attempts < 3) {
        const sqsClient = await getSqsClient();
        const response = await sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: 1,
            MessageAttributeNames: ['All'],
            VisibilityTimeout: 600,
          })
        );

        if (response.Messages && response.Messages.length > 0) {
          const entity = response.Messages[0];
          const body = JSON.parse(entity.Body!);
          const pairKey = body.pairKey;

          // Deduplication
          if (pairKey && processedRef.current.has(pairKey)) {
            try {
              const sqsClient2 = await getSqsClient();
              await sqsClient2.send(
                new DeleteMessageCommand({
                  QueueUrl: queueUrl,
                  ReceiptHandle: entity.ReceiptHandle,
                })
              );
            } catch { /* ignore */ }
            attempts++;
            continue;
          }

          if (pairKey) processedRef.current.add(pairKey);

          body.ack = async () => {
            try {
              const sqsClient2 = await getSqsClient();
              await sqsClient2.send(
                new DeleteMessageCommand({
                  QueueUrl: queueUrl,
                  ReceiptHandle: entity.ReceiptHandle,
                })
              );
            } catch {
              console.log(`Homography ack failed for pair ${pairKey}`);
            }
          };

          setBuffer((prev) => [...prev, body]);
          isFetchingRef.current = false;
          setIsFetching(false);
          return;
        } else {
          // No messages available
          setQueueEmpty(true);
          isFetchingRef.current = false;
          setIsFetching(false);
          return;
        }
      }
      // Exhausted dedup attempts — treat as effectively empty for this client
      setQueueEmpty(true);
    } catch (error) {
      console.error('Error fetching from SQS', error);
    }

    isFetchingRef.current = false;
    setIsFetching(false);
  }, [queueUrl, getSqsClient]);

  // Keep a ref to latest fetchNext so callbacks always invoke the current version
  const fetchNextRef = useRef(fetchNext);
  useEffect(() => { fetchNextRef.current = fetchNext; }, [fetchNext]);

  // Fetch first message when queue URL is ready
  useEffect(() => {
    if (queueUrl && buffer.length === 0 && !isFetchingRef.current) {
      fetchNextRef.current();
    }
  }, [queueUrl, buffer.length]);

  // Poll SQS for approximate remaining messages
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
          })
        );
        const count = result.Attributes?.ApproximateNumberOfMessages;
        setJobsRemaining(count || 'Unknown');
        if (count === '0') setQueueEmpty(true);
      } catch { /* ignore */ }
    };
    updateJobs();
    const interval = setInterval(updateJobs, 10000);
    return () => clearInterval(interval);
  }, [queueUrl, getSqsClient]);

  // Navigate back after queue is empty and no items in buffer
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    const noCurrentItem = index >= buffer.length;
    if (queueEmpty && noCurrentItem && !isFetching) {
      setCountdown(30);
    }
  }, [queueEmpty, index, buffer.length, isFetching]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      navigate('/jobs');
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, navigate]);

  const handleComplete = useCallback((pairKey: string) => {
    setSavedPairs((prev) => new Set(prev).add(pairKey));
    setSessionCompleted((prev) => prev + 1);
    setQueueEmpty(false);
    setIndex((prev) => {
      const nextIndex = prev + 1;
      frontierIndexRef.current = Math.max(frontierIndexRef.current, nextIndex);
      // Fetch next if we don't have it
      if (nextIndex >= buffer.length) {
        setTimeout(() => fetchNextRef.current(), 0);
      }
      return nextIndex;
    });
  }, [buffer.length]);

  const handleBack = useCallback(() => {
    if (index > 0) {
      setIndex((prev) => prev - 1);
    }
  }, [index]);

  const handleForward = useCallback(() => {
    if (index < frontierIndexRef.current) {
      setIndex((prev) => prev + 1);
    }
  }, [index]);

  const handleSavePoints = useCallback(
    (pairKey: string, points: { p1: Point[]; p2: Point[] }) => {
      savedPointsRef.current.set(pairKey, points);
    },
    []
  );

  const currentPair = buffer[index];
  const currentSavedPoints = currentPair
    ? savedPointsRef.current.get(currentPair.pairKey)
    : undefined;

  return (
    <div
      className='d-flex flex-column align-items-center gap-3 w-100 h-100'
      style={{ paddingTop: '12px', paddingBottom: '12px' }}
    >
      <div className='w-100 h-100'>
        {currentPair ? (
          <HomographyWorkbenchWorker
            key={currentPair.pairKey}
            pair={currentPair}
            savedPoints={currentSavedPoints}
            queueId={queueId!}
            onComplete={handleComplete}
            onBack={index > 0 ? handleBack : undefined}
            onForward={index < frontierIndexRef.current ? handleForward : undefined}
            onExit={() => navigate('/jobs')}
            onSavePoints={handleSavePoints}
            isSaved={savedPairs.has(currentPair.pairKey)}
          />
        ) : queueEmpty || countdown !== null ? (
          <div className='d-flex flex-column justify-content-center align-items-center h-100 gap-3'>
            <h5>No more pairs to process</h5>
            <p className='text-muted'>
              {countdown !== null
                ? `Returning to jobs in ${countdown} seconds...`
                : 'All pairs have been completed or are being processed by other workers.'}
            </p>
            <button
              className='btn btn-primary'
              onClick={() => navigate('/jobs')}
            >
              Return to Jobs
            </button>
          </div>
        ) : (
          <div className='d-flex justify-content-center align-items-center h-100'>
            <div className='text-muted'>Loading homography task...</div>
          </div>
        )}
      </div>
      <Badge className='d-flex flex-row align-items-center justify-content-center gap-3 p-2 w-100 bg-secondary flex-wrap'>
        <p className='mb-0'>{jobsRemaining} pairs remaining (globally)</p>
        <span className='d-none d-sm-block'>|</span>
        <p className='mb-0'>{sessionCompleted} pairs completed in this session</p>
      </Badge>
    </div>
  );
}
