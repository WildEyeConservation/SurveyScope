import { Form, Button, Spinner, Alert, ProgressBar } from 'react-bootstrap';
import { Footer } from '../Modal';
import { useState, useEffect, useCallback, useRef } from 'react';
import { client } from '../stores/appClient';
import { showModalAction as showModal } from '../stores/modalStore';
import { Schema } from '../amplify/client-schema';
import TileConfiguration from '../TileConfiguration';
import type { TiledLaunchRequest } from '../types/LaunchTask';
import { uploadData, downloadData } from 'aws-amplify/storage';

// Threshold in bytes above which we upload the payload to S3.
const PAYLOAD_SIZE_THRESHOLD = 200 * 1024; // 200KB

type TilingTaskStatus = 'idle' | 'processing' | 'completed' | 'failed';

export default function ManageTiles({
  project,
}: {
  project: Schema['Project']['type'];
}) {

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
  const [loadingTileCount, setLoadingTileCount] = useState(true);
  const [handleCreateTask, setHandleCreateTask] = useState<
    (() => Promise<TiledLaunchRequest>) | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [hasFnData, setHasFnData] = useState(false);
  const [checkingFnData, setCheckingFnData] = useState(true);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const isActiveRef = useRef(true);

  // Get the tiled location set ID from project
  const tiledLocationSetId = project.tiledLocationSetId;

  useEffect(() => {
    isActiveRef.current = true;
    return () => {
      isActiveRef.current = false;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Load current tile count
  useEffect(() => {
    async function loadTileCount() {
      if (!tiledLocationSetId) {
        setCurrentTileCount(0);
        setLoadingTileCount(false);
        return;
      }
      try {
        const { data } = await client.models.LocationSet.get(
          { id: tiledLocationSetId },
          { selectionSet: ['locationCount'] }
        );
        setCurrentTileCount(data?.locationCount ?? 0);
      } catch (err) {
        console.error('Failed to load tile count', err);
        setCurrentTileCount(0);
      }
      setLoadingTileCount(false);
    }
    loadTileCount();
  }, [tiledLocationSetId]);

  // Check for active tiling tasks on mount
  useEffect(() => {
    async function checkActiveTilingTask() {
      if (!tiledLocationSetId) return;
      try {
        const { data: tasks } = await
          client.models.TilingTask.tilingTasksByProjectId(
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
            }
          );

        // Find active task for our location set
        const activeTask = tasks?.find(
          (t) =>
            t.locationSetId === tiledLocationSetId &&
            (t.status === 'pending' || t.status === 'processing')
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
        console.error('Failed to check active tiling tasks', err);
      }
    }
    checkActiveTilingTask();
  }, [project.id, tiledLocationSetId]);

  // Check if any annotation sets in this project have FN data
  useEffect(() => {
    let mounted = true;
    async function checkForFnData() {
      setCheckingFnData(true);
      try {
        const { data: annotationSets } =
          await client.models.AnnotationSet.annotationSetsByProjectId(
            { projectId: project.id },
            { selectionSet: ['id'], limit: 100 }
          );
        if (!annotationSets?.length || !mounted) return;

        for (const as of annotationSets) {
          try {
            await downloadData({
              path: `false-negative-pools/${as.id}.json`,
              options: { bucket: 'outputs' },
            }).result;
            // If download succeeds, FN data exists
            if (mounted) setHasFnData(true);
            return;
          } catch {
            // No pool for this annotation set, continue checking
          }
        }
      } catch (err) {
        console.error('Failed to check for FN data', err);
      } finally {
        if (mounted) setCheckingFnData(false);
      }
    }
    checkForFnData();
    return () => {
      mounted = false;
    };
  }, [project.id]);

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

        try {
          const { data: task } = await
            client.models.TilingTask
              .get(
                { id: tilingTaskId },
                {
                  selectionSet: [
                    'id',
                    'status',
                    'totalBatches',
                    'completedBatches',
                    'totalLocations',
                    'errorMessage',
                  ],
                }
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
                { selectionSet: ['locationCount'] }
              );
              setCurrentTileCount(ls?.locationCount ?? 0);
            }
          } else if (task.status === 'failed') {
            clearInterval(pollInterval);
            setTilingStatus('failed');
            setProcessing(false);
            setError(task.errorMessage ?? 'Tiling failed');
          }
        } catch (err) {
          console.error('Error polling tiling task', err);
        }
      }, 3000); // Poll every 3 seconds

      pollingRef.current = pollInterval;
    },
    [tiledLocationSetId]
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
      try {
        const { data: tasks } = await
          client.models.TilingTask
            .tilingTasksByProjectId(
              { projectId: project.id },
              {
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
              }
            );

        // Find the most recent active task for our location set
        const activeTask = tasks
          ?.filter(
            (t) =>
              t.locationSetId === tiledLocationSetId &&
              (t.status === 'pending' || t.status === 'processing')
          )
          .sort(
            (a, b) =>
              new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
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
              { selectionSet: ['locationCount'] }
            );
            const newCount = ls?.locationCount ?? 0;
            if (newCount > 0 && newCount !== currentTileCount) {
              setCurrentTileCount(newCount);
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
        console.error('Error polling for tiling task', err);
      }
    }, 3000);

    pollingRef.current = pollInterval;
  }, [
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
        'No tiled location set configured for this survey. Please contact support.'
      );
      return;
    }

    // Confirm with user if there are existing tiles
    if (currentTileCount && currentTileCount > 0) {
      const message = hasFnData
        ? `This will delete all ${currentTileCount} existing tiles and create new ones. All false-negative data (annotations, observations, and pool files) will also be permanently deleted. Are you sure you want to continue?`
        : `This will delete all ${currentTileCount} existing tiles and create new ones. Are you sure you want to continue?`;
      const confirmed = window.confirm(message);
      if (!confirmed) return;
    }

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
        // Upload large payload to S3
        const s3Key = `launch-payloads/${crypto.randomUUID()}.json`;
        setStatusMessage('Uploading tile configuration...');
        await uploadData({
          path: s3Key,
          data: payloadStr,
          options: {
            bucket: 'outputs',
            contentType: 'application/json',
          },
        }).result;
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
                : resultData?.body ?? resultData;

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
            console.log('Could not parse lambda response, continuing with polling', parseErr);
          }
        })
        .catch((err) => {
          // Log the error but don't fail - polling will find the task
          console.log('Lambda call error (expected due to timeout):', err?.message ?? err);
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
        (tilingProgress.completedBatches / tilingProgress.totalBatches) * 100
      )
      : 0;

  return (
    <>
      <div className='p-3'>
        {/* Current status */}
        <div className='mb-3'>
          <h6>Current Tile Status</h6>
          {loadingTileCount ? (
            <div className='d-flex align-items-center gap-2'>
              <Spinner animation='border' size='sm' />
              <span>Loading...</span>
            </div>
          ) : !tiledLocationSetId ? (
            <Alert variant='warning'>
              No tile location set configured for this survey. Tiles will be
              created when you click "Generate Tiles".
            </Alert>
          ) : (
            <p className='mb-0'>
              <strong>{currentTileCount ?? 0}</strong> tiles currently in this
              survey
            </p>
          )}
        </div>

        {/* FN data warning */}
        {hasFnData && currentTileCount != null && currentTileCount > 0 && (
          <Alert variant='warning'>
            <strong>Warning:</strong> This project has existing false-negative
            data (annotations, observations, and pool files). Regenerating tiles
            will permanently delete all false-negative work.
          </Alert>
        )}

        {/* Error display */}
        {error && (
          <Alert variant='danger' dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Progress display */}
        {processing && tilingStatus === 'processing' && (
          <div className='mb-3'>
            <Alert variant='info'>
              <div className='d-flex align-items-center gap-2 mb-2'>
                <Spinner animation='border' size='sm' />
                <span>{statusMessage || 'Processing...'}</span>
              </div>
              {tilingProgress && tilingProgress.totalBatches > 0 && (
                <>
                  <ProgressBar
                    now={progressPercent}
                    label={`${progressPercent}%`}
                    className='mb-2'
                  />
                  <small>
                    Batch {tilingProgress.completedBatches} of{' '}
                    {tilingProgress.totalBatches} ({tilingProgress.totalLocations}{' '}
                    total tiles)
                  </small>
                </>
              )}
            </Alert>
          </div>
        )}

        {/* Success message */}
        {tilingStatus === 'completed' && !processing && (
          <Alert variant='success' dismissible onClose={() => setTilingStatus('idle')}>
            {statusMessage || 'Tiles created successfully!'}
          </Alert>
        )}

        {/* Tile configuration */}
        <Form.Group className='mb-3'>
          <h6>Tile Configuration</h6>
          <TileConfiguration
            name={`${project.name} - Tiles`}
            projectId={project.id}
            existingLocationSetId={tiledLocationSetId ?? undefined}
            setHandleCreateTask={setHandleCreateTask}
            setLaunchDisabled={setLaunchDisabled}
            disabled={processing}
          />
        </Form.Group>
      </div>

      <Footer>
        <Button
          variant='primary'
          onClick={handleRegenerateTiles}
          disabled={launchDisabled || processing || checkingFnData}
        >
          {processing ? (
            <>
              <Spinner animation='border' size='sm' className='me-2' />
              Creating Tiles...
            </>
          ) : currentTileCount && currentTileCount > 0 ? (
            'Regenerate Tiles'
          ) : (
            'Generate Tiles'
          )}
        </Button>
        <Button
          variant='dark'
          onClick={() => showModal(null)}
          disabled={processing}
        >
          Close
        </Button>
      </Footer>
    </>
  );
}

