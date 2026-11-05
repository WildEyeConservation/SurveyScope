import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { useContext, useEffect, useRef, useState } from 'react';
import { GlobalContext, UserContext } from '../Context';
import { plural } from '../survey/launchLabel';

type ProjectProgressProps = {
  projectId: string;
  onScanningChange?: (isScanning: boolean) => void;
};

export default function ProjectProgress({
  projectId,
  onScanningChange,
}: ProjectProgressProps) {
  const { client } = useContext(GlobalContext)!;
  const { getSqsClient } = useContext(UserContext)!;
  const [isLoading, setIsLoading] = useState(true);
  const [queueInfo, setQueueInfo] = useState<{
    url: string;
    infoTags: boolean;
    batchSize: number;
    totalBatches: number;
    launchedCount: number | null;
    observedCount: number | null;
    requeuesCompleted: number | null;
    emptyQueueTimestamp: string | null;
  } | null>(null);
  const [jobsRemaining, setJobsRemaining] = useState<number>(0);

  const prevScanningRef = useRef<boolean>(false);
  // Read through a ref so a new client function doesn't restart polling.
  const getSqsClientRef = useRef(getSqsClient);
  getSqsClientRef.current = getSqsClient;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    let cancelled = false;

    async function fetchQueueAndStartPolling() {
      const projectData = (
        await client.models.Project.get(
          { id: projectId },
          {
            selectionSet: [
              'queues.url',
              'queues.tag',
              'queues.batchSize',
              'queues.totalBatches',
              'queues.launchedCount',
              'queues.observedCount',
              'queues.requeuesCompleted',
              'queues.emptyQueueTimestamp',
            ],
          },
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
      setQueueInfo({
        url,
        infoTags: q.tag === 'info-tags',
        batchSize,
        totalBatches,
        launchedCount,
        observedCount,
        requeuesCompleted,
        emptyQueueTimestamp,
      });
      setIsLoading(false);

      async function updateJobsRemaining() {
        const sqsClient = await getSqsClientRef.current();
        const params = {
          QueueUrl: url,
          AttributeNames: ['ApproximateNumberOfMessages'] as any[],
        };
        const attrs = await sqsClient.send(
          new GetQueueAttributesCommand(params),
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
  }, [projectId, client]);

  const isScanning =
    jobsRemaining === 0 &&
    queueInfo?.launchedCount != null &&
    queueInfo?.emptyQueueTimestamp != null &&
    (queueInfo.observedCount || 0) < queueInfo.launchedCount &&
    (queueInfo.requeuesCompleted || 0) < 1;

  const isPolling = jobsRemaining === 0 && !isScanning;

  const shouldDisable = isScanning || isPolling;

  useEffect(() => {
    if (shouldDisable !== prevScanningRef.current) {
      prevScanningRef.current = shouldDisable;
      onScanningChange?.(shouldDisable);
    }
  }, [shouldDisable, onScanningChange]);

  if (!queueInfo) {
    return isLoading ? <Spinner /> : null;
  }

  const { batchSize, totalBatches } = queueInfo;
  // Info-tag jobs hand out one image at a time, so count images.
  if (
    queueInfo.infoTags &&
    queueInfo.launchedCount &&
    !isScanning &&
    !isPolling
  ) {
    return (
      <div className='flex w-full flex-col'>
        <p className='mb-0'>{plural(jobsRemaining, 'image')} remaining</p>
        <Progress
          value={queueInfo.launchedCount - jobsRemaining}
          max={queueInfo.launchedCount}
          animated
          className='w-full'
        />
      </div>
    );
  }
  if (batchSize > 0) {
    const batchesRemaining = Math.ceil(jobsRemaining / batchSize);
    if (isScanning) {
      return (
        <div className='flex w-full flex-col'>
          <div className='mb-0 flex items-center gap-2'>
            <Spinner animation='border' size='sm' />
            <span>Scanning for missed locations...</span>
          </div>
          <Progress
            value={totalBatches - batchesRemaining}
            max={totalBatches}
            className='w-full'
          />
        </div>
      );
    }
    if (isPolling) {
      return (
        <div className='flex w-full flex-col'>
          <div className='mb-0 flex items-center gap-2'>
            <Spinner animation='border' size='sm' />
            <span>Polling for work...</span>
          </div>
          <Progress
            value={totalBatches}
            max={totalBatches}
            className='w-full'
          />
        </div>
      );
    }
    return (
      <div className='flex w-full flex-col'>
        <p className='mb-0'>
          {plural(batchesRemaining, 'batch', 'batches')} remaining
        </p>
        <Progress
          value={totalBatches - batchesRemaining}
          max={totalBatches}
          animated
          className='w-full'
        />
      </div>
    );
  } else {
    if (isScanning) {
      return (
        <div className='mb-0 flex items-center gap-2'>
          <Spinner animation='border' size='sm' />
          <span>Scanning for missed locations...</span>
        </div>
      );
    }
    if (isPolling) {
      return (
        <div className='mb-0 flex items-center gap-2'>
          <Spinner animation='border' size='sm' />
          <span>Polling for work...</span>
        </div>
      );
    }
    return <p className='mb-0'>Jobs remaining: {jobsRemaining}</p>;
  }
}
