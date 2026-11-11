import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Schema } from '../amplify/client-schema';
import { GlobalContext, UserContext } from '../Context';
import { logAdminAction } from '../utils/adminActionLogger';
import {
  fetchFalseNegativesStatus,
  sendFalseNegativesRequest,
  validSampleCount,
  type FalseNegativesRequest,
  type FalseNegativesStatus,
} from './falseNegativesApi';
import { plural, useLaunchLabel } from './launchLabel';
import {
  AdvancedOptions,
  Banner,
  LaunchSummary,
  SettingRow,
} from './launchParts';
import { LoadingProgressCard } from './LoadingProgressCard';
import { loadLocationCandidates } from './zoomPreview';
import ZoomSetting from './ZoomSetting';

type LaunchHandler = {
  execute: (
    onProgress: (msg: string) => void,
    onLaunchConfirmed: () => void,
  ) => Promise<void>;
};

const POLL_MS = 3000;
// The job reports at least every few minutes; give up watching after this.
const WATCH_LIMIT_MS = 90 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function FalseNegatives({
  project,
  annotationSet,
  launching,
  setLaunchDisabled,
  setFalseNegativesLaunchHandler,
}: {
  project: Schema['Project']['type'];
  annotationSet: Schema['AnnotationSet']['type'];
  launching: boolean;
  setLaunchDisabled: React.Dispatch<React.SetStateAction<boolean>>;
  setFalseNegativesLaunchHandler: React.Dispatch<
    React.SetStateAction<LaunchHandler | null>
  >;
}) {
  const { client } = useContext(GlobalContext)!;
  const { user } = useContext(UserContext)!;

  const tiledLocationSetId =
    (project as { tiledLocationSetId?: string | null }).tiledLocationSetId ??
    undefined;

  const [queueTag, setQueueTag] = useState<string>(
    `${annotationSet.name} - False Negatives`,
  );
  const [batchSize, setBatchSize] = useState<number>(200);
  const [zoom, setZoom] = useState<number | undefined>(undefined);
  const [samplePercent, setSamplePercent] = useState<number>(5);

  const [globalTileCount, setGlobalTileCount] = useState<number | null>(null);
  const [status, setStatus] = useState<FalseNegativesStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [resetting, setResetting] = useState(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const loadStatus = useCallback(async () => {
    const next = await fetchFalseNegativesStatus(
      client,
      project.id,
      annotationSet.id,
    );
    if (mountedRef.current) {
      setStatus(next);
      setStatusError(false);
    }
    return next;
  }, [annotationSet.id, client, project.id]);

  useEffect(() => {
    loadStatus().catch((error) => {
      console.error('Failed to load the false negatives sample', error);
      if (mountedRef.current) setStatusError(true);
    });
  }, [loadStatus]);

  useEffect(() => {
    let mounted = true;
    if (!tiledLocationSetId) {
      setGlobalTileCount(0);
      return;
    }
    client.models.LocationSet.get(
      { id: tiledLocationSetId },
      { selectionSet: ['locationCount'] },
    )
      .then(({ data }) => {
        if (mounted) setGlobalTileCount(data?.locationCount ?? 0);
      })
      .catch((error) => {
        console.error('Failed to load tile count', error);
        if (mounted) setGlobalTileCount(0);
      });
    return () => {
      mounted = false;
    };
  }, [client.models.LocationSet, tiledLocationSetId]);

  const sample = status?.sample ?? null;
  const working = sample?.state === 'working';

  useEffect(() => {
    if (!working || launching || resetting) return;
    const timer = setInterval(() => {
      loadStatus().catch(console.error);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [working, launching, resetting, loadStatus]);

  const watchJob = useCallback(
    async (onProgress: (message: string) => void) => {
      const startedAt = Date.now();
      for (;;) {
        await sleep(POLL_MS);
        const next = await loadStatus();
        if (next.sample?.state !== 'working') return next;
        if (next.sample.step) onProgress(`${next.sample.step}...`);
        if (Date.now() - startedAt > WATCH_LIMIT_MS) {
          throw new Error(
            'The job is still being prepared. It carries on in the background; reopen this tab to check on it.',
          );
        }
      }
    },
    [loadStatus],
  );

  const pending = sample?.pendingCount ?? 0;
  const hasSample = !!sample && sample.sampledCount > 0;
  const valid = sample ? validSampleCount(sample) : 0;
  const unsampled = sample ? Math.max(0, sample.unreviewedTiles - valid) : 0;
  const noTiles =
    globalTileCount !== null && (!tiledLocationSetId || globalTileCount === 0);

  let mode: 'loading' | 'first-launch' | 'running' | 'continue' | 'additional';
  if (status === null || globalTileCount === null) mode = 'loading';
  else if (!hasSample) mode = 'first-launch';
  else if (status.queueActive) mode = 'running';
  else if (pending > 0) mode = 'continue';
  else mode = 'additional';

  const exhausted = mode === 'additional' && unsampled === 0;
  const blocked =
    mode === 'loading' ||
    noTiles ||
    working ||
    mode === 'running' ||
    !!status?.surveyBusy ||
    exhausted ||
    (mode !== 'continue' && !(samplePercent > 0 && samplePercent <= 100));

  useEffect(() => {
    setLaunchDisabled(blocked || launching || resetting);
  }, [blocked, launching, resetting, setLaunchDisabled]);

  // Refs keep the launch handler stable while the settings change.
  const settingsRef = useRef({
    mode,
    queueTag,
    samplePercent,
    batchSize,
    zoom,
  });
  settingsRef.current = { mode, queueTag, samplePercent, batchSize, zoom };
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    setFalseNegativesLaunchHandler({
      execute: async (onProgress, onLaunchConfirmed) => {
        const settings = settingsRef.current;
        const continuing = settings.mode === 'continue';
        const request: FalseNegativesRequest = {
          action: continuing ? 'continue' : 'launch',
          projectId: project.id,
          annotationSetId: annotationSet.id,
          samplePercent: settings.samplePercent,
          queueTag: settings.queueTag,
          batchSize: settings.batchSize,
          zoom: settings.zoom ?? null,
        };
        const remaining = pendingRef.current;

        onProgress('Starting the job...');
        await sendFalseNegativesRequest(client, request);
        onLaunchConfirmed();
        const finished = await watchJob(onProgress);
        if (finished.sample?.state !== 'ready') {
          throw new Error(
            finished.sample?.error ?? 'The False Negatives job did not start',
          );
        }

        const launched =
          finished.sample.launches[finished.sample.launches.length - 1]?.count;
        const names = `annotation set "${annotationSet.name}" in project "${project.name}"`;
        const message = continuing
          ? `Continued False Negatives queue for ${names} (${remaining} remaining tiles)`
          : settings.mode === 'additional'
            ? `Launched additional ${settings.samplePercent}% False Negatives sample for ${names} (${launched ?? 0} tiles)`
            : `Launched False Negatives queue for ${names} (${settings.samplePercent}% sample, ${launched ?? 0} tiles)`;
        await logAdminAction(
          client,
          user.userId,
          message,
          project.id,
          project.organizationId,
        );
      },
    });
    return () => {
      setFalseNegativesLaunchHandler(null);
    };
  }, [
    annotationSet.id,
    annotationSet.name,
    client,
    project.id,
    project.name,
    project.organizationId,
    setFalseNegativesLaunchHandler,
    user.userId,
    watchJob,
  ]);

  const [resetError, setResetError] = useState<string | null>(null);
  const handleReset = useCallback(async () => {
    if (
      !confirm(
        'Reset all false negatives data? This deletes every false negative review and annotation for this annotation set, and the sample itself, so you can start fresh. This cannot be undone.',
      )
    ) {
      return;
    }
    setResetting(true);
    setResetError(null);
    try {
      await sendFalseNegativesRequest(client, {
        action: 'reset',
        projectId: project.id,
        annotationSetId: annotationSet.id,
      });
      const finished = await watchJob(() => {});
      if (finished.sample) {
        throw new Error(finished.sample.error ?? 'The reset did not finish');
      }
      await logAdminAction(
        client,
        user.userId,
        `Reset False Negatives data for annotation set "${annotationSet.name}" in project "${project.name}"`,
        project.id,
        project.organizationId,
      );
    } catch (error) {
      console.error('Reset failed', error);
      if (mountedRef.current) {
        setResetError(
          error instanceof Error ? error.message : 'The reset failed',
        );
      }
    } finally {
      if (mountedRef.current) setResetting(false);
    }
  }, [
    annotationSet.id,
    annotationSet.name,
    client,
    project.id,
    project.name,
    project.organizationId,
    user.userId,
    watchJob,
  ]);

  useLaunchLabel(
    mode === 'continue'
      ? `Launch ${plural(pending, 'remaining tile')}`
      : mode === 'additional'
        ? `Launch another ${samplePercent}% sample`
        : mode === 'first-launch'
          ? `Launch ${samplePercent}% sample`
          : null,
    noTiles
      ? 'Create tiles in Edit Survey › Manage Tiles first'
      : working
        ? 'A False Negatives job is being prepared'
        : mode === 'running'
          ? 'A False Negatives job is already running'
          : status?.surveyBusy
            ? 'Another job is running on this survey'
            : exhausted
              ? 'Every unreviewed tile has been sampled'
              : undefined,
  );

  const busy = launching || resetting || working;

  const batchField = (
    <div>
      <Label className='mb-1'>Batch size</Label>
      <Input
        type='number'
        title='The number of annotation jobs a user can pick up at a time'
        value={batchSize}
        onChange={(e) => setBatchSize(Number(e.target.value))}
        disabled={busy}
      />
    </div>
  );

  const zoomSetting = (
    <ZoomSetting
      mode='level'
      zoom={zoom}
      onChange={setZoom}
      loadCandidates={() =>
        loadLocationCandidates(
          client,
          tiledLocationSetId ? [tiledLocationSetId] : [],
        )
      }
      disabled={busy || !tiledLocationSetId}
    />
  );

  const sampleField = (label: string) => (
    <div>
      <Label className='mb-1'>{label}</Label>
      <div className='relative'>
        <Input
          type='number'
          min={0}
          max={100}
          step={1}
          className='pr-8'
          value={samplePercent}
          onChange={(e) => setSamplePercent(Number(e.target.value))}
          disabled={busy}
        />
        <span className='pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-[#6c757d]'>
          %
        </span>
      </div>
    </div>
  );

  const advanced = (
    <AdvancedOptions disabled={busy}>
      <SettingRow label='Job name' hint='Shown on the Jobs page'>
        <Input
          type='text'
          aria-label='Job name'
          value={queueTag}
          onChange={(e) => setQueueTag(e.target.value)}
          disabled={busy}
        />
      </SettingRow>
      {sample && (
        <SettingRow
          label='Reset false negative data'
          hint='Deletes the reviews, annotations and sample so you can start over.'
        >
          <Button
            variant='outline-danger'
            className='w-full'
            onClick={handleReset}
            disabled={busy || mode === 'running'}
          >
            {resetting ? (
              <>
                <Spinner animation='border' size='sm' />
                Resetting...
              </>
            ) : (
              'Reset'
            )}
          </Button>
        </SettingRow>
      )}
    </AdvancedOptions>
  );

  const results = sample && (
    <>
      {sample.reviewedCount.toLocaleString()} of {valid.toLocaleString()}{' '}
      sampled tiles reviewed, {plural(sample.foundCount, 'animal')} found
      {sample.coveredCount > 0 && (
        <>
          <br />
          {plural(sample.coveredCount, 'sampled tile')} left out because primary
          review reached {sample.coveredCount === 1 ? 'it' : 'them'} later
        </>
      )}
    </>
  );

  return (
    <div className='flex flex-col gap-4 p-4'>
      {statusError && (
        <Banner tone='danger'>
          The false negatives sample could not be loaded.{' '}
          <Button
            variant='link'
            className='p-0'
            onClick={() =>
              loadStatus().catch(() => {
                if (mountedRef.current) setStatusError(true);
              })
            }
          >
            Try again
          </Button>
        </Banner>
      )}
      {working && !launching && (
        <Banner tone='info'>
          <span className='flex items-center gap-2'>
            <Spinner animation='border' size='sm' />
            {sample?.action === 'reset'
              ? 'Resetting false negative data'
              : (sample?.step ?? 'Preparing the False Negatives job')}
            ...
          </span>
        </Banner>
      )}
      {sample?.state === 'failed' && (
        <Banner tone='danger'>
          The last False Negatives job did not finish:{' '}
          {sample.error ?? 'unknown error'}
        </Banner>
      )}
      {resetError && <Banner tone='danger'>{resetError}</Banner>}

      {statusError && status === null ? null : mode === 'loading' ? (
        <LoadingProgressCard
          title='Loading the false negatives sample...'
          rows={[
            {
              label: 'Tiles',
              count: globalTileCount ?? 0,
              done: globalTileCount !== null,
            },
            {
              label: 'Sampled tiles',
              count: sample?.sampledCount ?? 0,
              done: status !== null,
            },
          ]}
        />
      ) : noTiles ? (
        <Banner tone='warning'>
          This survey has no tiles yet. Create them in Edit Survey › Manage
          Tiles.
        </Banner>
      ) : mode === 'running' ? (
        <>
          <LaunchSummary value={pending.toLocaleString()}>
            sampled tiles still to review in the running job
            <br />
            {results}
          </LaunchSummary>
          {advanced}
        </>
      ) : mode === 'continue' ? (
        <>
          <LaunchSummary value={pending.toLocaleString()}>
            sampled tiles still need a look
            <br />
            {results}
          </LaunchSummary>
          <div className='grid gap-3 sm:grid-cols-2'>
            {batchField}
            {zoomSetting}
          </div>
          {advanced}
        </>
      ) : mode === 'additional' ? (
        <>
          <LaunchSummary
            value={`${
              sample && sample.unreviewedTiles > 0
                ? ((valid / sample.unreviewedTiles) * 100).toFixed(1)
                : '0.0'
            }%`}
          >
            of the unreviewed tiles sampled ({valid.toLocaleString()} of{' '}
            {sample?.unreviewedTiles.toLocaleString()})
            <br />
            {results}
          </LaunchSummary>
          {!exhausted && (
            <div className='grid gap-3 sm:grid-cols-3'>
              {sampleField('Additional sample')}
              {batchField}
              {zoomSetting}
            </div>
          )}
          {advanced}
        </>
      ) : (
        <>
          <LaunchSummary value={`${samplePercent}%`}>
            of the tiles nobody has reviewed will be sampled
            <br />
            This survey has {globalTileCount?.toLocaleString() ?? '—'} tiles;
            those already reviewed or annotated are left out
          </LaunchSummary>
          <div className='grid gap-3 sm:grid-cols-3'>
            {sampleField('Sample size')}
            {batchField}
            {zoomSetting}
          </div>
          {advanced}
        </>
      )}
    </div>
  );
}
