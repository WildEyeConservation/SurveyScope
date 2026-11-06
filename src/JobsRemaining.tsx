import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { queueDepths } from './api/tasks';
import { GlobalContext, ProjectContext, UserContext } from './Context';

export function JobsRemaining() {
  const { client } = useContext(GlobalContext)!;
  const {
    jobsCompleted: sessionJobsCompleted,
    setJobsCompleted: setSessionJobsCompleted,
  } = useContext(UserContext)!;
  const { currentPM } = useContext(ProjectContext)!;
  const [jobsRemaining, setJobsRemaining] = useState<string>('Unknown');
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [backupUrl, setBackupUrl] = useState<string | undefined>(undefined);
  const [batchSize, setBatchSize] = useState<number>(0);
  const [usingBackupQueue, setUsingBackupQueue] = useState<boolean>(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (currentPM.queueId) {
      client.models.Queue.get({ id: currentPM.queueId }).then(({ data }) => {
        if (!data) return;
        setUrl(data.url ? data.id : undefined);
        if (data.batchSize) {
          setBatchSize(data.batchSize);
        }
      });
      if (currentPM.backupQueueId) {
        client.models.Queue.get({ id: currentPM.backupQueueId }).then(
          ({ data }) => {
            setBackupUrl(data?.url ? data.id : undefined);
          },
        );
      }
    }
  }, [currentPM]);

  useEffect(() => {
    if (url) {
      const getNumberofMessages = async (queueId: string) =>
        (await queueDepths([queueId]))[queueId] || 'Unknown';

      const updateJobs = async () => {
        let jobsR = await getNumberofMessages(url);

        if (jobsR === '0' && backupUrl) {
          jobsR = await getNumberofMessages(backupUrl);
          setUsingBackupQueue(true);
        } else {
          setUsingBackupQueue(false);
        }

        setJobsRemaining(jobsR);
      };

      updateJobs();

      const interval = setInterval(updateJobs, 10000);
      return () => {
        clearInterval(interval);
      };
    }
  }, [url, backupUrl]);

  useEffect(() => {
    if (
      batchSize > 0 &&
      sessionJobsCompleted > 0 &&
      sessionJobsCompleted % batchSize === 0
    ) {
      alert('Well done! You have completed a batch of jobs.');
      setSessionJobsCompleted(0);
      navigate('/jobs');
    }
  }, [sessionJobsCompleted, batchSize, navigate, setSessionJobsCompleted]);

  return jobsRemaining === '0' ||
    batchSize === 0 ||
    parseInt(jobsRemaining) < batchSize ? (
    <Badge
      variant='secondary'
      className='flex w-full flex-row flex-wrap items-center justify-center gap-4 p-2'
    >
      <p className='mb-0'>
        {jobsRemaining} jobs remaining
        {usingBackupQueue ? ' on backup queue ' : ' '}(globally)
      </p>
      <span className='hidden sm:block'>|</span>
      <p className='mb-0'>
        {sessionJobsCompleted} jobs completed in this session
      </p>
    </Badge>
  ) : (
    <div className='flex w-full flex-col items-center gap-2'>
      <Progress
        className='w-full'
        variant='primary'
        max={batchSize}
        value={sessionJobsCompleted % batchSize}
        label={`${
          sessionJobsCompleted % batchSize
        } of ${batchSize} jobs completed`}
      />
    </div>
  );
}
