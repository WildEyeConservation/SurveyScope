import { useEffect, useRef, useState } from 'react';
import { useSession } from '../session';
import { client } from '../stores/appClient';
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { Spinner, ProgressBar } from 'react-bootstrap';

type ProjectProgressProps = {
  projectId: string;
  onScanningChange?: (isScanning: boolean) => void;
};

export default function ProjectProgress({ projectId, onScanningChange }: ProjectProgressProps) {
  const { getSqsClient } = useSession();
  const [isLoading, setIsLoading] = useState(true);
  const [queueInfo, setQueueInfo] = useState<{
    url: string;
    batchSize: number;
    totalBatches: number;
    launchedCount: number | null;
    observedCount: number | null;
    requeuesCompleted: number | null;
    emptyQueueTimestamp: string | null;
  } | null>(null);
  const [jobsRemaining, setJobsRemaining] = useState<number>(0);

  const prevScanningRef = useRef<boolean>(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    let cancelled = false;

    async function fetchQueueAndStartPolling() {
      setIsLoading(true);
      const projectData = (
        await client.models.Project.get(
          { id: projectId },
          {
            selectionSet: [
              'queues.url',
              'queues.batchSize',
              'queues.totalBatches',
              'queues.launchedCount',
              'queues.observedCount',
              'queues.requeuesCompleted',
              'queues.emptyQueueTimestamp',
            ],
          }
        )
      ).data;

      if (cancelled || !projectData?.queues?.length) {
        setIsLoading(false);
        return;
      }

      const q = projectData.queues[0];
      const url = q.url || '';
      const batchSize = q.batchSize || 0;
      const totalBatches = q.totalBatches || 0;
      const launchedCount = q.launchedCount ?? null;
      const observedCount = q.observedCount ?? null;
      const requeuesCompleted = q.requeuesCompleted ?? null;
      const emptyQueueTimestamp = q.emptyQueueTimestamp ?? null;
      setQueueInfo({ url, batchSize, totalBatches, launchedCount, observedCount, requeuesCompleted, emptyQueueTimestamp });
      setIsLoading(false);

      async function updateJobsRemaining() {
        const sqsClient = await getSqsClient();
        const params = {
          QueueUrl: url,
          AttributeNames: ['ApproximateNumberOfMessages'] as any[],
        };
        const attrs = await sqsClient.send(
          new GetQueueAttributesCommand(params)
        );
        if (cancelled) return;
        const num = attrs.Attributes?.ApproximateNumberOfMessages;
        setJobsRemaining(num ? Number(num) : 0);
      }

      updateJobsRemaining();
      interval = setInterval(updateJobsRemaining, 10000);
    }

    fetchQueueAndStartPolling();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, getSqsClient]);

  const isScanning = jobsRemaining === 0
    && queueInfo?.launchedCount != null
    && queueInfo?.emptyQueueTimestamp != null
    && (queueInfo.observedCount || 0) < queueInfo.launchedCount
    && (queueInfo.requeuesCompleted || 0) < 1;

  const isPolling = jobsRemaining === 0 && !isScanning;

  const shouldDisable = isScanning || isPolling;

  useEffect(() => {
    if (shouldDisable !== prevScanningRef.current) {
      prevScanningRef.current = shouldDisable;
      onScanningChange?.(shouldDisable);
    }
  }, [shouldDisable, onScanningChange]);

  if (isLoading || !queueInfo) {
    return <Spinner />;
  }

  const { batchSize, totalBatches } = queueInfo;
  if (batchSize > 0) {
    const batchesRemaining = Math.ceil(jobsRemaining / batchSize);
    if (isScanning) {
      return (
        <div className='d-flex flex-column w-100'>
          <div className='d-flex align-items-center gap-2 mb-0'>
            <Spinner animation='border' size='sm' />
            <span>Scanning for missed locations...</span>
          </div>
          <ProgressBar
            now={totalBatches - batchesRemaining}
            max={totalBatches}
            className='w-100'
          />
        </div>
      );
    }
    if (isPolling) {
      return (
        <div className='d-flex flex-column w-100'>
          <div className='d-flex align-items-center gap-2 mb-0'>
            <Spinner animation='border' size='sm' />
            <span>Polling for work...</span>
          </div>
          <ProgressBar
            now={totalBatches}
            max={totalBatches}
            className='w-100'
          />
        </div>
      );
    }
    return (
      <div className='d-flex flex-column w-100'>
        <p className='mb-0'>{batchesRemaining} batches remaining</p>
        <ProgressBar
          now={totalBatches - batchesRemaining}
          max={totalBatches}
          animated
          className='w-100'
        />
      </div>
    );
  } else {
    if (isScanning) {
      return (
        <div className='d-flex align-items-center gap-2 mb-0'>
          <Spinner animation='border' size='sm' />
          <span>Scanning for missed locations...</span>
        </div>
      );
    }
    if (isPolling) {
      return (
        <div className='d-flex align-items-center gap-2 mb-0'>
          <Spinner animation='border' size='sm' />
          <span>Polling for work...</span>
        </div>
      );
    }
    return <p className='mb-0'>Jobs remaining: {jobsRemaining}</p>;
  }
}
