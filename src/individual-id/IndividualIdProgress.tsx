import { useEffect, useState } from 'react';
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
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{
    total: number;
    remaining: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval>;

    async function load() {
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
        if (cancelled) return;
        setStats(
          job
            ? {
                total: job.totalTransects ?? 0,
                remaining: job.remainingTransects ?? 0,
              }
            : null
        );
      } catch (e) {
        if (!cancelled) console.warn('IndividualIdProgress load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

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
