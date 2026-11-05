import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { XIcon } from 'lucide-react';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Schema } from '../amplify/client-schema';
import { GlobalContext } from '../Context';
import { Footer } from '../Modal';
import {
  readFalseNegativeFile,
  uploadWorkflowFile,
} from '../storage/workflowFiles';
import TileConfiguration, { type TileSettings } from '../TileConfiguration';
import type { TiledLaunchRequest } from '../types/LaunchTask';
import { SectionTitle } from './SurveyStructure';

// Threshold in bytes above which we upload the payload to S3.
const PAYLOAD_SIZE_THRESHOLD = 200 * 1024; // 200KB

type TilingTaskStatus = 'idle' | 'processing' | 'completed' | 'failed';

function parseSettings(description?: string | null) {
  try {
    const parsed = JSON.parse(description ?? '');
    return typeof parsed?.horizontalTiles === 'number'
      ? (parsed as TileSettings)
      : null;
  } catch {
    return null;
  }
}

export default function ManageTiles({
  project,
}: {
  project: Schema['Project']['type'];
}) {
  const { client, showModal } = useContext(GlobalContext)!;

  const [launchDisabled, setLaunchDisabled] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [tilingStatus, setTilingStatus] = useState<TilingTaskStatus>('idle');
  const [tilingProgress, setTilingProgress] = useState<{
    totalBatches: number;
    completedBatches: number;
    totalLocations: number;
  } | null>(null);
  const [currentTileCount, setCurrentTileCount] = useState<number | null>(null);
  const [currentSettings, setCurrentSettings] = useState<TileSettings | null>(
    null,
  );
  const [loadingTileCount, setLoadingTileCount] = useState(true);
  const [expectedTiles, setExpectedTiles] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [handleCreateTask, setHandleCreateTask] = useState<
    (() => Promise<TiledLaunchRequest>) | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [hasFnData, setHasFnData] = useState(false);
  const [checkingFnData, setCheckingFnData] = useState(true);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const isActiveRef = useRef(true);
  const pollAbortRef = useRef<AbortController | null>(null);

  // Get the tiled location set ID from project
  const tiledLocationSetId = project.tiledLocationSetId;

  useEffect(() => {
    isActiveRef.current = true;
    const controller = new AbortController();
    pollAbortRef.current = controller;
    return () => {
      isActiveRef.current = false;
      controller.abort();
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Load current tile count
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function loadTileCount() {
      if (!tiledLocationSetId) {
        setCurrentTileCount(0);
        setLoadingTileCount(false);
        return;
      }
      try {
        const { data } = await client.models.LocationSet.get(
          { id: tiledLocationSetId },
          { selectionSet: ['locationCount', 'description'], signal },
        );
        setCurrentTileCount(data?.locationCount ?? 0);
        setCurrentSettings(parseSettings(data?.description));
      } catch (err) {
        if (signal.aborted) return;
        console.error('Failed to load tile count', err);
        setCurrentTileCount(0);
      }
      setLoadingTileCount(false);
    }
    loadTileCount();
    return () => controller.abort();
  }, [client.models.LocationSet, tiledLocationSetId]);

  // Check for active tiling tasks on mount
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function checkActiveTilingTask() {
      if (!tiledLocationSetId) return;
      try {
        const { data: tasks } =
          await client.models.TilingTask.tilingTasksByProjectId(
            { projectId: project.id },
            {
              selectionSet: [
                'id',
                'status',
                'totalBatches',
                'completedBatches',
                'totalLocations',
                'locationSetId',
              ],
              limit: 10,
              signal,
            },
          );

        // Find active task for our location set
        const activeTask = tasks?.find(
          (t) =>
            t.locationSetId === tiledLocationSetId &&
            (t.status === 'pending' || t.status === 'processing'),
        );

        if (activeTask) {
          setTilingStatus('processing');
          setTilingProgress({
            totalBatches: activeTask.totalBatches ?? 0,
            completedBatches: activeTask.completedBatches ?? 0,
            totalLocations: activeTask.totalLocations ?? 0,
          });
          setProcessing(true);
          startPollingProgress(activeTask.id);
        }
      } catch (err) {
        if (signal.aborted) return;
        console.error('Failed to check active tiling tasks', err);
      }
    }
    checkActiveTilingTask();
    return () => controller.abort();
  }, [client.models.TilingTask, project.id, tiledLocationSetId]);

  // Check if any annotation sets in this project have FN data
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function checkForFnData() {
      setCheckingFnData(true);
      try {
        const { data: annotationSets } =
          await client.models.AnnotationSet.annotationSetsByProjectId(
            { projectId: project.id },
            { selectionSet: ['id'], limit: 100, signal },
          );
        if (!annotationSets?.length) return;

        for (const as of annotationSets) {
          if (signal.aborted) return;
          const pool = await readFalseNegativeFile(as.id, 'pool', signal).catch(
            () => null,
          );
          if (pool) {
            if (!signal.aborted) setHasFnData(true);
            return;
          }
        }
      } catch (err) {
        if (!signal.aborted) console.error('Failed to check for FN data', err);
      } finally {
        if (!signal.aborted) setCheckingFnData(false);
      }
    }
    checkForFnData();
    return () => controller.abort();
  }, [client.models.AnnotationSet, project.id]);

  const startPollingProgress = useCallback(
    (tilingTaskId: string) => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }

      const pollInterval = setInterval(async () => {
        if (!isActiveRef.current) {
          clearInterval(pollInterval);
          return;
        }

        const signal = pollAbortRef.current?.signal;
        try {
          const { data: task } = await client.models.TilingTask.get(
            { id: tilingTaskId },
            {
              signal,
              selectionSet: [
                'id',
                'status',
                'totalBatches',
                'completedBatches',
                'totalLocations',
                'errorMessage',
              ],
            },
          );

          if (!task) return;

          setTilingProgress({
            totalBatches: task.totalBatches ?? 0,
            completedBatches: task.completedBatches ?? 0,
            totalLocations: task.totalLocations ?? 0,
          });

          if (task.status === 'completed') {
            clearInterval(pollInterval);
            setTilingStatus('completed');
            setProcessing(false);
            setStatusMessage('Tiles created successfully!');
            // Refresh tile count
            if (tiledLocationSetId) {
              const { data: ls } = await client.models.LocationSet.get(
                { id: tiledLocationSetId },
                { selectionSet: ['locationCount', 'description'], signal },
              );
              setCurrentTileCount(ls?.locationCount ?? 0);
              setCurrentSettings(parseSettings(ls?.description));
            }
          } else if (task.status === 'failed') {
            clearInterval(pollInterval);
            setTilingStatus('failed');
            setProcessing(false);
            setError(task.errorMessage ?? 'Tiling failed');
          }
        } catch (err) {
          if (signal?.aborted) return;
          console.error('Error polling tiling task', err);
        }
      }, 3000); // Poll every 3 seconds

      pollingRef.current = pollInterval;
    },
    [client.models.TilingTask, client.models.LocationSet, tiledLocationSetId],
  );

  // Poll for the tiling task to appear and get its ID
  const startPollingForTask = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    let attempts = 0;
    const maxAttempts = 20; // Give up after ~60 seconds

    const pollInterval = setInterval(async () => {
      if (!isActiveRef.current) {
        clearInterval(pollInterval);
        return;
      }

      attempts++;
      const signal = pollAbortRef.current?.signal;
      try {
        const { data: tasks } =
          await client.models.TilingTask.tilingTasksByProjectId(
            { projectId: project.id },
            {
              signal,
              selectionSet: [
                'id',
                'status',
                'totalBatches',
                'completedBatches',
                'totalLocations',
                'locationSetId',
                'createdAt',
              ],
              limit: 10,
            },
          );

        // Find the most recent active task for our location set
        const activeTask = tasks
          ?.filter(
            (t) =>
              t.locationSetId === tiledLocationSetId &&
              (t.status === 'pending' || t.status === 'processing'),
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt!).getTime() -
              new Date(a.createdAt!).getTime(),
          )[0];

        if (activeTask) {
          clearInterval(pollInterval);
          setTilingProgress({
            totalBatches: activeTask.totalBatches ?? 0,
            completedBatches: activeTask.completedBatches ?? 0,
            totalLocations: activeTask.totalLocations ?? 0,
          });
          startPollingProgress(activeTask.id);
        } else if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          // Check if tiles were created (task completed quickly)
          if (tiledLocationSetId) {
            const { data: ls } = await client.models.LocationSet.get(
              { id: tiledLocationSetId },
              { selectionSet: ['locationCount', 'description'], signal },
            );
            const newCount = ls?.locationCount ?? 0;
            if (newCount > 0 && newCount !== currentTileCount) {
              setCurrentTileCount(newCount);
              setCurrentSettings(parseSettings(ls?.description));
              setTilingStatus('completed');
              setProcessing(false);
              setStatusMessage('Tiles created successfully!');
            } else {
              setError('Could not find tiling task. Please refresh the page.');
              setProcessing(false);
              setTilingStatus('failed');
            }
          }
        }
      } catch (err) {
        if (signal?.aborted) return;
        console.error('Error polling for tiling task', err);
      }
    }, 3000);

    pollingRef.current = pollInterval;
  }, [
    client.models.TilingTask,
    client.models.LocationSet,
    project.id,
    tiledLocationSetId,
    currentTileCount,
    startPollingProgress,
  ]);

  const handleRegenerateTiles = async () => {
    if (!handleCreateTask) {
      setError('Tile configuration not ready');
      return;
    }

    if (!tiledLocationSetId) {
      setError(
        'No tiled location set configured for this survey. Please contact support.',
      );
      return;
    }

    setConfirming(false);
    setError(null);
    setProcessing(true);
    setTilingStatus('processing');
    setStatusMessage('Preparing tile request...');

    try {
      const tiledRequest = await handleCreateTask();

      // Add the existing location set ID to reuse
      tiledRequest.existingLocationSetId = tiledLocationSetId;

      setStatusMessage('Submitting tile creation request...');

      // Build the payload - annotationSetId is omitted for tiling-only operations
      const payload = {
        projectId: project.id,
        queueOptions: {
          name: 'Tile Generation',
          hidden: true,
          fifo: false,
        },
        secondaryQueueOptions: null,
        allowOutside: true,
        skipLocationWithAnnotations: false,
        taskTag: 'tile-generation',
        batchSize: 200,
        zoom: null,
        locationIds: undefined,
        locationSetIds: [],
        tiledRequest,
      };

      const payloadStr = JSON.stringify(payload);
      const payloadSize = new Blob([payloadStr]).size;

      let requestPayload: string;

      if (payloadSize > PAYLOAD_SIZE_THRESHOLD) {
        setStatusMessage('Uploading tile configuration...');
        const s3Key = await uploadWorkflowFile(
          'launch-payload',
          project.id,
          payloadStr,
        );
        requestPayload = JSON.stringify({ payloadS3Key: s3Key });
      } else {
        requestPayload = payloadStr;
      }

      setStatusMessage('Tiles being created...');

      // Start polling for the tiling task immediately
      // Don't wait for lambda response due to Amplify timeout issues
      startPollingForTask();

      // Fire-and-forget the lambda call - don't await
      client.mutations
        .launchAnnotationSet({
          request: requestPayload,
        })
        .then((result) => {
          // If we get a response, try to parse the task ID for faster polling
          try {
            const resultData =
              typeof result?.data === 'string'
                ? JSON.parse(result.data)
                : result?.data;
            const body =
              typeof resultData?.body === 'string'
                ? JSON.parse(resultData.body)
                : (resultData?.body ?? resultData);

            if (body?.tilingTaskId && isActiveRef.current) {
              // Clear the generic polling and start specific task polling
              if (pollingRef.current) {
                clearInterval(pollingRef.current);
              }
              setTilingProgress({
                totalBatches: body.totalBatches ?? 0,
                completedBatches: 0,
                totalLocations: body.totalLocations ?? 0,
              });
              startPollingProgress(body.tilingTaskId);
            }
          } catch (parseErr) {
            console.log(
              'Could not parse lambda response, continuing with polling',
              parseErr,
            );
          }
        })
        .catch((err) => {
          // Log the error but don't fail - polling will find the task
          console.log(
            'Lambda call error (expected due to timeout):',
            err?.message ?? err,
          );
        });
    } catch (err: any) {
      console.error('Failed to prepare tile request', err);
      setError(err?.message ?? 'Failed to prepare tile request');
      setProcessing(false);
      setTilingStatus('failed');
    }
  };

  const progressPercent =
    tilingProgress && tilingProgress.totalBatches > 0
      ? Math.round(
          (tilingProgress.completedBatches / tilingProgress.totalBatches) * 100,
        )
      : 0;

  const hasTiles = !!currentTileCount && currentTileCount > 0;

  return (
    <>
      <div className='flex flex-col gap-2 p-4'>
        <SectionTitle className='border-b-0 pb-0'>Current tiles</SectionTitle>
        <div className='flex items-center gap-4 border border-white/15 bg-white/[0.07] px-4 py-3'>
          {loadingTileCount ? (
            <span className='flex items-center gap-2 text-muted-foreground'>
              <Spinner animation='border' size='sm' />
              Loading tiles...
            </span>
          ) : !tiledLocationSetId ? (
            <span className='text-sm text-warning'>
              This survey has no tile set, so tiles cannot be generated here.
            </span>
          ) : (
            <>
              <span className='text-2xl font-bold tabular-nums'>
                {(currentTileCount ?? 0).toLocaleString()}
              </span>
              <span className='text-xs text-muted-foreground'>
                {hasTiles && currentSettings ? (
                  <>
                    tiles · {currentSettings.horizontalTiles} ×{' '}
                    {currentSettings.verticalTiles} per image ·{' '}
                    {currentSettings.width.toLocaleString()} ×{' '}
                    {currentSettings.height.toLocaleString()} px ·{' '}
                    {currentSettings.minSidelap} px between columns,{' '}
                    {currentSettings.minOverlap} px between rows
                  </>
                ) : hasTiles ? (
                  'tiles'
                ) : (
                  'tiles · none generated yet'
                )}
              </span>
            </>
          )}
        </div>

        {error && (
          <div className='flex items-start gap-3 border border-danger bg-danger/15 px-4 py-3 text-sm'>
            <span className='flex-1'>{error}</span>
            <button
              type='button'
              aria-label='Dismiss'
              className='hover:text-primary'
              onClick={() => setError(null)}
            >
              <XIcon className='size-4' />
            </button>
          </div>
        )}

        {processing && tilingStatus === 'processing' && (
          <div className='flex flex-col gap-2 border border-white/15 bg-white/[0.07] px-4 py-3 text-sm'>
            <span className='flex items-center gap-2'>
              <Spinner animation='border' size='sm' />
              {statusMessage || 'Processing...'}
            </span>
            {tilingProgress && tilingProgress.totalBatches > 0 && (
              <>
                <Progress
                  value={progressPercent}
                  label={`${progressPercent}%`}
                />
                <span className='text-xs text-muted-foreground'>
                  Batch {tilingProgress.completedBatches} of{' '}
                  {tilingProgress.totalBatches} ·{' '}
                  {tilingProgress.totalLocations.toLocaleString()} tiles
                </span>
              </>
            )}
          </div>
        )}

        {tilingStatus === 'completed' && !processing && (
          <div className='flex items-center gap-3 border border-success bg-success/15 px-4 py-3 text-sm'>
            <span className='flex-1'>
              {statusMessage || 'Tiles created successfully!'}
            </span>
            <button
              type='button'
              aria-label='Dismiss'
              className='hover:text-primary'
              onClick={() => setTilingStatus('idle')}
            >
              <XIcon className='size-4' />
            </button>
          </div>
        )}

        {!loadingTileCount && tiledLocationSetId && (
          <>
            <SectionTitle className='mt-4 border-b-0 pb-0'>
              {hasTiles ? 'New tiles' : 'Tiles'}
            </SectionTitle>
            <TileConfiguration
              name={`${project.name} - Tiles`}
              projectId={project.id}
              existingLocationSetId={tiledLocationSetId}
              initial={currentSettings ?? undefined}
              setHandleCreateTask={setHandleCreateTask}
              setLaunchDisabled={setLaunchDisabled}
              onExpectedTilesChange={setExpectedTiles}
              disabled={processing}
            />
          </>
        )}
      </div>

      <Footer>
        {confirming ? (
          <>
            <div className='mr-auto'>
              <div>
                Delete {(currentTileCount ?? 0).toLocaleString()} tiles and
                create {expectedTiles.toLocaleString()} new ones?
              </div>
              {hasFnData && (
                <div className='text-xs text-warning'>
                  This survey's false-negative annotations, observations and
                  pool files will be deleted too.
                </div>
              )}
            </div>
            <Button
              variant='outline-light'
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button variant='danger' onClick={handleRegenerateTiles}>
              Regenerate tiles
            </Button>
          </>
        ) : (
          <>
            <Button
              variant='ghost'
              className='mr-auto'
              onClick={() => showModal(null)}
              disabled={processing}
            >
              Close
            </Button>
            <Button
              variant='primary'
              onClick={() =>
                hasTiles ? setConfirming(true) : handleRegenerateTiles()
              }
              disabled={
                launchDisabled ||
                processing ||
                checkingFnData ||
                !tiledLocationSetId
              }
            >
              {processing ? (
                <>
                  <Spinner animation='border' size='sm' />
                  Creating tiles...
                </>
              ) : hasTiles ? (
                'Regenerate tiles'
              ) : (
                'Generate tiles'
              )}
            </Button>
          </>
        )}
      </Footer>
    </>
  );
}
