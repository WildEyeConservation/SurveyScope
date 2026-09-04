import { useQuery } from '@tanstack/react-query';
import { Spinner, ProgressBar } from 'react-bootstrap';
import { client } from '../stores/appClient';

/**
 * Surveys-page progress for an Individual ID job. Unlike the SQS workflows
 * (ProjectProgress reads ApproximateNumberOfMessages), Individual ID is
 * transect-locked: progress = completed transects / total, derived from the
 * IndividualIdJob counter (remainingTransects is ACID-decremented on each
 * completed transect). Polls every 10s so it advances as workers finish.
 */
export default function IndividualIdProgress({
  projectId,
}: {
  projectId: string;
}) {
  const { data: stats, isLoading: loading } = useQuery({
    queryKey: ['individualIdProgress', projectId],
    queryFn: async () => {
      try {
        const { data } = await (
          client.models as any
        ).IndividualIdJob.individualIdJobsByProjectId(
          { projectId },
          {
            selectionSet: [
              'id',
              'status',
              'totalTransects',
              'remainingTransects',
            ],
          }
        );
        const jobs = data || [];
        const job =
          jobs.find((j: any) => j.status === 'active') ??
          jobs.find((j: any) => j.status === 'launching') ??
          null;
        return job
          ? {
              status: job.status,
              total: job.totalTransects ?? 0,
              remaining: job.remainingTransects ?? 0,
            }
          : null;
      } catch (e) {
        console.warn('IndividualIdProgress load failed', e);
        return null;
      }
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'active' || status === 'launching' ? 10000 : false;
    },
  });

  if (loading && !stats) return <Spinner />;
  if (!stats || stats.total <= 0) {
    return <p className='mb-0'>ChainLinker job</p>;
  }

  const completed = Math.max(0, stats.total - stats.remaining);
  return (
    <div className='d-flex flex-column w-100'>
      <p className='mb-0'>
        {completed} / {stats.total} transects completed
      </p>
      <ProgressBar
        now={completed}
        max={stats.total}
        animated
        className='w-100'
      />
    </div>
  );
}
