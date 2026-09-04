import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Form, Spinner } from 'react-bootstrap';
import { uploadData, downloadData, remove } from 'aws-amplify/storage';
import { Schema } from '../amplify/client-schema';
import { UserContext } from '../Context';
import { client } from '../stores/appClient';
import { fetchAllPaginatedResults } from '../utils';
import { DataClient } from '../../amplify/shared/data-schema.generated';
import { logAdminAction } from '../utils/adminActionLogger';

type LaunchHandler = {
  execute: (
    onProgress: (msg: string) => void,
    onLaunchConfirmed: () => void
  ) => Promise<void>;
};

type MinimalTile = {
  id: string;
  imageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type FnPool = {
  annotationSetId: string;
  poolCreatedAt: string;
  poolSize: number;
  items: MinimalTile[];
};

type FnLaunchEntry = {
  launchedAt: string;
  launchedCount: number;
  items: MinimalTile[];
};

type FnHistory = {
  annotationSetId: string;
  poolSize: number;
  totalLaunched: number;
  launches: FnLaunchEntry[];
};

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
  const { user } = useContext(UserContext)!;

  // Global tiled location set from project
  const tiledLocationSetId = (project as any).tiledLocationSetId as
    | string
    | undefined;

  // Queue tag
  const [queueTag, setQueueTag] = useState<string>(
    `${annotationSet.name} - False Negatives`
  );

  // Tile count state
  const [globalTileCount, setGlobalTileCount] = useState<number | null>(null);
  const [loadingTileCount, setLoadingTileCount] = useState<boolean>(true);

  // Sampling (first launch + additional sample modes)
  const [batchSize, setBatchSize] = useState<number>(200);
  const [samplePercent, setSamplePercent] = useState<number>(5);
  const [showAdvancedOptions, setShowAdvancedOptions] =
    useState<boolean>(false);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false);
  const [summaryMessage, setSummaryMessage] = useState<string>('');
  const [expectedTiles, setExpectedTiles] = useState<number | null>(null);
  const [candidateTiles, setCandidateTiles] = useState<number | null>(null);
  const [estimatedSampleTiles, setEstimatedSampleTiles] = useState<
    number | null
  >(null);

  // FN pool + history state
  const [loadingManifests, setLoadingManifests] = useState<boolean>(true);
  const [fnPool, setFnPool] = useState<FnPool | null>(null);
  const [fnHistory, setFnHistory] = useState<FnHistory | null>(null);
  const [remainingTiles, setRemainingTiles] = useState<MinimalTile[] | null>(
    null
  );
  const [loadingRemaining, setLoadingRemaining] = useState<boolean>(false);

  // Derive mode from loaded manifests and remaining tiles
  let mode: 'loading' | 'first-launch' | 'continue' | 'additional';
  if (
    loadingManifests ||
    (fnPool && loadingRemaining) ||
    (fnPool && fnHistory && remainingTiles === null)
  ) {
    mode = 'loading';
  } else if (!fnPool) {
    mode = 'first-launch';
  } else if (remainingTiles && remainingTiles.length > 0) {
    mode = 'continue';
  } else {
    mode = 'additional';
  }

  // Check for existing FN pool + history manifests on mount
  useEffect(() => {
    let mounted = true;
    async function checkForFnManifests() {
      setLoadingManifests(true);
      const poolKey = `false-negative-pools/${annotationSet.id}.json`;
      try {
        const poolResult = await downloadData({
          path: poolKey,
          options: { bucket: 'outputs' },
        }).result;
        const poolText = await poolResult.body.text();
        const pool = JSON.parse(poolText) as FnPool;
        if (!mounted) return;
        setFnPool(pool);

        // Pool exists – try to load history
        const historyKey = `false-negative-history/${annotationSet.id}.json`;
        try {
          const historyResult = await downloadData({
            path: historyKey,
            options: { bucket: 'outputs' },
          }).result;
          const historyText = await historyResult.body.text();
          const history = JSON.parse(historyText) as FnHistory;
          if (mounted) setFnHistory(history);
        } catch {
          // Pool exists but no history (edge case)
          if (mounted) setFnHistory(null);
        }
      } catch {
        // No pool – first launch mode
        if (mounted) {
          setFnPool(null);
          setFnHistory(null);
        }
      }
      if (mounted) setLoadingManifests(false);
    }
    checkForFnManifests();
    return () => {
      mounted = false;
    };
  }, [annotationSet.id]);

  // Load global tile count
  useEffect(() => {
    let mounted = true;
    async function loadTileCount() {
      if (!tiledLocationSetId) {
        setGlobalTileCount(0);
        setLoadingTileCount(false);
        return;
      }
      setLoadingTileCount(true);
      try {
        const { data } = await client.models.LocationSet.get(
          { id: tiledLocationSetId },
          { selectionSet: ['locationCount'] }
        );
        if (mounted) {
          setGlobalTileCount(data?.locationCount ?? 0);
        }
      } catch (err) {
        console.error('Failed to load tile count', err);
        if (mounted) {
          setGlobalTileCount(0);
        }
      }
      if (mounted) {
        setLoadingTileCount(false);
      }
    }
    loadTileCount();
    return () => {
      mounted = false;
    };
  }, [tiledLocationSetId]);

  // Compute remaining tiles when pool + history are loaded
  useEffect(() => {
    if (!fnPool || !fnHistory) {
      setRemainingTiles(null);
      return;
    }

    let mounted = true;
    async function computeRemaining() {
      setLoadingRemaining(true);
      try {
        const observedLocationIds = await fetchObservedLocationIds(
          client,
          annotationSet.id
        );
        const annotationPoints = await fetchAnnotationPointsDetailed(
          client,
          annotationSet.id
        );

        // Collect all launched tiles across all launches
        const allLaunchedTiles = fnHistory!.launches.flatMap((l) => l.items);

        const remaining = allLaunchedTiles.filter((tile) => {
          // Check if this specific tile was observed (by location ID)
          if (observedLocationIds.has(tile.id)) return false;
          const anns = annotationPoints.get(tile.imageId) || [];
          const hasAnnotation = anns.some((pt) =>
            isInsideTile(pt.x, pt.y, tile)
          );
          return !hasAnnotation;
        });

        if (mounted) {
          setRemainingTiles(remaining);
        }
      } catch (err) {
        console.error('Failed to compute remaining tiles', err);
        if (mounted) {
          setRemainingTiles([]);
        }
      }
      if (mounted) {
        setLoadingRemaining(false);
      }
    }
    computeRemaining();
    return () => {
      mounted = false;
    };
  }, [fnPool, fnHistory, annotationSet.id]);

  // Enable/disable Launch button based on mode and state
  useEffect(() => {
    let shouldDisable = false;

    if (mode === 'loading' || loadingTileCount) {
      shouldDisable = true;
    } else if (!tiledLocationSetId || globalTileCount === 0) {
      shouldDisable = true;
    } else if (mode === 'continue') {
      shouldDisable = !remainingTiles || remainingTiles.length === 0;
    } else if (mode === 'additional') {
      // Disable if pool is fully exhausted
      const totalLaunched = fnHistory?.totalLaunched ?? 0;
      const poolSize = fnPool?.poolSize ?? 0;
      shouldDisable = totalLaunched >= poolSize;
    }

    setLaunchDisabled(shouldDisable || launching);
  }, [
    launching,
    mode,
    loadingTileCount,
    tiledLocationSetId,
    globalTileCount,
    remainingTiles,
    fnPool,
    fnHistory,
    setLaunchDisabled,
  ]);

  // Fetch locations from the global tiled set
  const fetchLocationsFromSet = useCallback(
    async (
      locationSetId: string,
      onProgress?: (message: string) => void
    ): Promise<MinimalTile[]> => {
      onProgress?.('Querying locations...');
      const allLocs = await fetchAllPaginatedResults(
        client.models.Location.locationsBySetIdAndConfidence,
        {
          setId: locationSetId,
          limit: 10000,
          selectionSet: ['id', 'imageId', 'x', 'y', 'width', 'height'] as const,
        }
      );
      return allLocs
        .filter(loc => loc.x !== 0 && loc.y !== 0 && (loc.width ?? 0) !== 0 && (loc.height ?? 0) !== 0)
        .map(loc => ({
          id: loc.id,
          imageId: loc.imageId!,
          x: loc.x,
          y: loc.y,
          width: loc.width!,
          height: loc.height!,
        }));
    },
    []
  );

  const computeSummary = useCallback(async () => {
    if (!tiledLocationSetId) return;

    setSummaryLoading(true);
    setSummaryMessage('Preparing tile data...');
    setCandidateTiles(null);
    setEstimatedSampleTiles(null);
    setExpectedTiles(null);
    try {
      setSummaryMessage('Fetching tiles...');
      const tiles = await fetchLocationsFromSet(
        tiledLocationSetId,
        setSummaryMessage
      );

      setExpectedTiles(tiles.length);

      setSummaryMessage('Fetching reviewed locations...');
      const observationPoints = await fetchObservationPointsDetailed(
        client,
        annotationSet.id
      );

      setSummaryMessage('Fetching annotations...');
      const annotationPoints = await fetchAnnotationPointsDetailed(
        client,
        annotationSet.id
      );

      setSummaryMessage('Evaluating tiles...');
      const candidates = tiles.filter((tile) => {
        const obs = observationPoints.get(tile.imageId) || [];
        const anns = annotationPoints.get(tile.imageId) || [];
        // Check if any observed location overlaps with this tile
        const hasObservation = obs.some((o) => tilesOverlap(tile, o));
        const hasAnnotation = anns.some((pt) => isInsideTile(pt.x, pt.y, tile));
        return !hasObservation && !hasAnnotation;
      });
      setCandidateTiles(candidates.length);

      const normalizedPercent = Math.min(Math.max(samplePercent, 0), 100);
      const availableTiles = candidates.length;
      let estimatedSamples = Math.floor(
        (availableTiles * normalizedPercent) / 100
      );
      if (
        normalizedPercent > 0 &&
        estimatedSamples === 0 &&
        availableTiles > 0
      ) {
        estimatedSamples = 1;
      }
      setEstimatedSampleTiles(estimatedSamples);

      setSummaryMessage('');
    } catch (error) {
      console.error('Summary calculation failed', error);
      setSummaryMessage('Unable to compute summary');
    } finally {
      setSummaryLoading(false);
    }
  }, [
    annotationSet.id,
    fetchLocationsFromSet,
    samplePercent,
    tiledLocationSetId,
  ]);

  // Refs for stable launch handler (avoid re-render loops)
  const modeRef = useRef(mode);
  const remainingTilesRef = useRef(remainingTiles);
  const queueTagRef = useRef(queueTag);
  const samplePercentRef = useRef(samplePercent);
  const batchSizeRef = useRef(batchSize);
  const tiledLocationSetIdRef = useRef(tiledLocationSetId);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    remainingTilesRef.current = remainingTiles;
  }, [remainingTiles]);
  useEffect(() => {
    queueTagRef.current = queueTag;
  }, [queueTag]);
  useEffect(() => {
    samplePercentRef.current = samplePercent;
  }, [samplePercent]);
  useEffect(() => {
    batchSizeRef.current = batchSize;
  }, [batchSize]);
  useEffect(() => {
    tiledLocationSetIdRef.current = tiledLocationSetId;
  }, [tiledLocationSetId]);

  // Expose launch handler to parent
  useEffect(() => {
    setFalseNegativesLaunchHandler({
      execute: async (
        onProgress: (msg: string) => void,
        onLaunchConfirmed: () => void
      ) => {
        const currentTiledLocationSetId = tiledLocationSetIdRef.current;
        if (!currentTiledLocationSetId) {
          onProgress('No tiles configured for this survey.');
          return;
        }

        const currentMode = modeRef.current;

        if (currentMode === 'continue') {
          // Continue mode – launch remaining tiles from unfinished session
          const remaining = remainingTilesRef.current;
          if (!remaining || remaining.length === 0) {
            alert('No remaining tiles to launch');
            return;
          }

          onLaunchConfirmed();
          onProgress(`Launching ${remaining.length} remaining tiles...`);

          const payload = {
            projectId: project.id,
            annotationSetId: annotationSet.id,
            queueOptions: {
              name: 'False Negatives',
              hidden: false,
              fifo: false,
            },
            queueTag: queueTagRef.current,
            samplePercent: 100,
            locationSetId: currentTiledLocationSetId,
            locationTiles: remaining,
            batchSize: batchSizeRef.current,
            isContinuation: true,
          };

          onProgress('Enqueuing jobs...');
          await sendLaunchFalseNegativesRequest(client, payload);
          onProgress('Launch request submitted');

          await logAdminAction(
            client,
            user.userId,
            `Continued False Negatives queue for annotation set "${annotationSet.name}" in project "${project.name}" (${remaining.length} remaining tiles)`,
            project.id,
            project.organizationId
          ).catch(console.error);
        } else if (currentMode === 'additional') {
          // Additional sample mode – Lambda loads from existing pool
          onLaunchConfirmed();
          onProgress('Launching additional sample from existing pool...');

          const payload = {
            projectId: project.id,
            annotationSetId: annotationSet.id,
            queueOptions: {
              name: 'False Negatives',
              hidden: false,
              fifo: false,
            },
            queueTag: queueTagRef.current,
            samplePercent: samplePercentRef.current,
            locationSetId: currentTiledLocationSetId,
            locationTiles: [], // Empty – Lambda loads from pool
            batchSize: batchSizeRef.current,
          };

          onProgress('Enqueuing jobs...');
          await sendLaunchFalseNegativesRequest(client, payload);
          onProgress('Launch request submitted');

          await logAdminAction(
            client,
            user.userId,
            `Launched additional ${samplePercentRef.current}% False Negatives sample for annotation set "${annotationSet.name}" in project "${project.name}"`,
            project.id,
            project.organizationId
          ).catch(console.error);
        } else {
          // First launch mode – sample from all tiles
          onProgress('Fetching locations from global tile set...');
          const locationTiles = await fetchLocationsFromSet(
            currentTiledLocationSetId,
            onProgress
          );
          if (locationTiles.length === 0) {
            alert('No locations found in the global tiled set');
            return;
          }
          onLaunchConfirmed();
          onProgress(`Found ${locationTiles.length} locations`);

          const payload = {
            projectId: project.id,
            annotationSetId: annotationSet.id,
            queueOptions: {
              name: 'False Negatives',
              hidden: false,
              fifo: false,
            },
            queueTag: queueTagRef.current,
            samplePercent: samplePercentRef.current,
            locationSetId: currentTiledLocationSetId,
            locationTiles,
            batchSize: batchSizeRef.current,
          };

          onProgress('Enqueuing jobs...');
          await sendLaunchFalseNegativesRequest(client, payload);
          onProgress('Launch request submitted');

          await logAdminAction(
            client,
            user.userId,
            `Launched False Negatives queue for annotation set "${annotationSet.name}" in project "${project.name}" (${samplePercentRef.current}% sample)`,
            project.id,
            project.organizationId
          ).catch(console.error);
        }
      },
    });
    return () => {
      setFalseNegativesLaunchHandler(null);
    };
  }, [
    annotationSet.id,
    annotationSet.name,
    fetchLocationsFromSet,
    project.id,
    project.name,
    setFalseNegativesLaunchHandler,
    user.userId,
  ]);

  // Reset progress state
  const [resetting, setResetting] = useState<boolean>(false);
  const [resetProgress, setResetProgress] = useState<string>('');

  // Reset FN data – delete observations, annotations, and manifests
  const handleReset = useCallback(async () => {
    if (
      !confirm(
        'Reset all false negatives data? This will delete all observations and annotations from false negative reviews, clear the candidate pool and launch history, allowing you to start fresh. This cannot be undone.'
      )
    ) {
      return;
    }

    setResetting(true);
    setResetProgress('Loading history...');

    try {
      // Load history if not already in state
      let history = fnHistory;
      if (!history) {
        const historyKey = `false-negative-history/${annotationSet.id}.json`;
        try {
          const historyResult = await downloadData({
            path: historyKey,
            options: { bucket: 'outputs' },
          }).result;
          const historyText = await historyResult.body.text();
          history = JSON.parse(historyText) as FnHistory;
        } catch {
          // No history exists, nothing to delete
          history = null;
        }
      }

      if (history && history.launches.length > 0) {
        // Collect all launched tiles
        const allLaunchedTiles = history.launches.flatMap((l) => l.items);
        const totalTiles = allLaunchedTiles.length;

        // Helper to run promises with concurrency limit
        const runWithConcurrency = async <T,>(
          items: T[],
          fn: (item: T) => Promise<void>,
          concurrency: number
        ): Promise<void> => {
          const queue = [...items];
          const workers = Array.from({ length: concurrency }, async () => {
            while (queue.length > 0) {
              const item = queue.shift();
              if (item !== undefined) {
                await fn(item);
              }
            }
          });
          await Promise.all(workers);
        };

        // Delete observations by locationId
        let observationsDeleted = 0;
        setResetProgress(`Deleting observations (0/${totalTiles} tiles)...`);

        await runWithConcurrency(
          allLaunchedTiles,
          async (tile) => {
            let nextToken: string | null | undefined = undefined;
            do {
              const { data, nextToken: nt } =
                await client.models.Observation.observationsByLocationId(
                  { locationId: tile.id },
                  {
                    filter: { annotationSetId: { eq: annotationSet.id } },
                    limit: 100,
                    nextToken,
                  }
                );
              const deletePromises = (data || []).map((obs) =>
                client.models.Observation.delete({ id: obs.id })
              );
              await Promise.all(deletePromises);
              nextToken = nt as string | null | undefined;
            } while (nextToken);

            observationsDeleted++;
            if (observationsDeleted % 10 === 0 || observationsDeleted === totalTiles) {
              setResetProgress(
                `Deleting observations (${observationsDeleted}/${totalTiles} tiles)...`
              );
            }
          },
          50
        );

        // Delete annotations by imageId with source containing "false-negative"
        // Get unique imageIds from launched tiles
        const uniqueImageIds = Array.from(
          new Set(allLaunchedTiles.map((t) => t.imageId))
        );
        let imagesProcessed = 0;
        setResetProgress(`Deleting annotations (0/${uniqueImageIds.length} images)...`);

        await runWithConcurrency(
          uniqueImageIds,
          async (imageId) => {
            let nextToken: string | null | undefined = undefined;
            do {
              const { data, nextToken: nt } =
                await client.models.Annotation.annotationsByImageIdAndSetId(
                  { imageId, setId: { eq: annotationSet.id } },
                  {
                    filter: { source: { contains: 'false-negative' } },
                    limit: 100,
                    nextToken,
                  }
                );
              const deletePromises = (data || []).map((ann) =>
                client.models.Annotation.delete({ id: ann.id })
              );
              await Promise.all(deletePromises);
              nextToken = nt as string | null | undefined;
            } while (nextToken);

            imagesProcessed++;
            if (imagesProcessed % 10 === 0 || imagesProcessed === uniqueImageIds.length) {
              setResetProgress(
                `Deleting annotations (${imagesProcessed}/${uniqueImageIds.length} images)...`
              );
            }
          },
          50
        );
      }

      // Delete manifests
      setResetProgress('Removing manifests...');
      const poolKey = `false-negative-pools/${annotationSet.id}.json`;
      const historyKey = `false-negative-history/${annotationSet.id}.json`;
      await remove({ path: poolKey, options: { bucket: 'outputs' } }).catch(
        () => { }
      );
      await remove({ path: historyKey, options: { bucket: 'outputs' } }).catch(
        () => { }
      );

      setFnPool(null);
      setFnHistory(null);
      setRemainingTiles(null);
      setResetProgress('');
    } catch (err) {
      console.error('Failed to reset FN data', err);
      alert('Failed to reset data. Check console for details.');
    } finally {
      setResetting(false);
    }
  }, [annotationSet.id, fnHistory]);

  // Show warning if no global tiles exist
  const showNoTilesWarning =
    !loadingTileCount && (!tiledLocationSetId || globalTileCount === 0);

  // Progress values for pool modes
  const poolSize = fnPool?.poolSize ?? 0;
  const totalLaunched = fnHistory?.totalLaunched ?? 0;
  const coveragePercent =
    poolSize > 0 ? ((totalLaunched / poolSize) * 100).toFixed(1) : '0.0';
  const remainingInPool = poolSize - totalLaunched;
  const poolExhausted = poolSize > 0 && remainingInPool <= 0;

  // For additional sample mode: compute expected new sample inline
  const additionalSampleCount = (() => {
    if (mode !== 'additional' || poolExhausted) return 0;
    const normalizedPercent = Math.min(Math.max(samplePercent, 0), 100);
    let count = Math.floor((poolSize * normalizedPercent) / 100);
    if (normalizedPercent > 0 && count === 0 && remainingInPool > 0) {
      count = 1;
    }
    return Math.min(count, remainingInPool);
  })();

  return (
    <div className='px-3 pb-3 pt-1'>
      <div className='d-flex flex-column gap-3 mt-2'>
        {mode === 'loading' ? (
          <p
            className='text-muted mb-0 text-center'
            style={{ fontSize: '12px' }}
          >
            Loading...
          </p>
        ) : showNoTilesWarning ? (
          <Alert variant='warning' className='mb-0'>
            <strong>No tiles configured.</strong>
            <p className='mb-0 mt-1' style={{ fontSize: '14px' }}>
              Please go to <strong>Edit Survey &gt; Manage Tiles</strong> to
              create tiles for this survey before launching a false negatives
              task.
            </p>
          </Alert>
        ) : mode === 'continue' ? (
          // ── Continue mode UI ──
          <div
            className='border border-dark shadow-sm p-2'
            style={{ backgroundColor: '#697582' }}
          >
            <p className='mb-0 text-white'>
              <strong>Continuing False Negatives Task</strong>
            </p>
            <p className='mb-0 mt-2 text-white' style={{ fontSize: '14px' }}>
              {coveragePercent}% of candidate pool has been covered
              ({totalLaunched} of {poolSize} candidates launched across{' '}
              {fnHistory?.launches.length ?? 0} session
              {(fnHistory?.launches.length ?? 0) !== 1 ? 's' : ''})
            </p>
            {loadingRemaining ? (
              <div className='mt-2 d-flex align-items-center gap-2 text-white'>
                <Spinner animation='border' size='sm' />
                <span style={{ fontSize: '12px' }}>
                  Calculating remaining tiles...
                </span>
              </div>
            ) : remainingTiles !== null ? (
              <div className='mt-2'>
                <p className='mb-0 text-white' style={{ fontSize: '14px' }}>
                  <strong>{remainingTiles.length}</strong> tiles remaining from
                  previous launches
                </p>
              </div>
            ) : null}
            <div className='mt-3'>
              <button
                type='button'
                className='btn btn-outline-light btn-sm'
                onClick={handleReset}
                disabled={launching || resetting}
              >
                {resetting ? (
                  <span className='d-inline-flex align-items-center'>
                    <Spinner animation='border' size='sm' className='me-2' />
                    {resetProgress || 'Resetting...'}
                  </span>
                ) : (
                  'Reset FN Data'
                )}
              </button>
            </div>
          </div>
        ) : mode === 'additional' ? (
          // ── Additional sample mode UI ──
          <>
            <div
              className='border border-dark shadow-sm p-2'
              style={{ backgroundColor: '#697582' }}
            >
              <p className='mb-0 text-white'>
                <strong>False Negatives Progress</strong>
              </p>
              <p
                className='mb-0 mt-2 text-white'
                style={{ fontSize: '14px' }}
              >
                {coveragePercent}% of candidate pool has been covered
              </p>
              <div
                className='mt-1 text-white'
                style={{ fontSize: '12px' }}
              >
                <div>
                  Pool size: <strong>{poolSize}</strong>
                </div>
                <div>
                  Launched: <strong>{totalLaunched}</strong> across{' '}
                  {fnHistory?.launches.length ?? 0} session
                  {(fnHistory?.launches.length ?? 0) !== 1 ? 's' : ''}
                </div>
                <div>
                  Remaining candidates: <strong>{remainingInPool}</strong>
                </div>
              </div>
            </div>

            {poolExhausted ? (
              <Alert variant='success' className='mb-0'>
                All candidates from the original pool have been launched.
              </Alert>
            ) : (
              <>
                <Form.Group>
                  <Form.Label className='mb-0'>
                    Additional sample size (%)
                  </Form.Label>
                  <span
                    className='text-muted d-block mb-1'
                    style={{ fontSize: '12px' }}
                  >
                    Percentage of the candidate pool ({poolSize}{' '}
                    tiles). Up to {remainingInPool} tiles can still be launched.
                  </span>
                  <Form.Control
                    type='number'
                    min={0}
                    max={100}
                    step={1}
                    value={samplePercent}
                    onChange={(e) =>
                      setSamplePercent(
                        Number((e.target as HTMLInputElement).value)
                      )
                    }
                    disabled={launching}
                  />
                </Form.Group>

                <Form.Group>
                  <Form.Switch
                    label='Show Advanced Options'
                    checked={showAdvancedOptions}
                    onChange={() => setShowAdvancedOptions(!showAdvancedOptions)}
                    disabled={launching}
                  />
                </Form.Group>

                {showAdvancedOptions && (
                  <div
                    className='d-flex flex-column gap-3 border border-dark shadow-sm p-2'
                    style={{ backgroundColor: '#697582' }}
                  >
                    <Form.Group>
                      <Form.Label className='mb-0'>Batch Size</Form.Label>
                      <span
                        className='text-muted d-block mb-1'
                        style={{ fontSize: '12px' }}
                      >
                        The number of annotation jobs a user can pick up at a
                        time.
                      </span>
                      <Form.Control
                        type='number'
                        value={batchSize}
                        onChange={(e) =>
                          setBatchSize(
                            Number((e.target as HTMLInputElement).value)
                          )
                        }
                        disabled={launching}
                      />
                    </Form.Group>
                    <Form.Group>
                      <Form.Label className='mb-0'>Job Name</Form.Label>
                      <span
                        className='text-muted d-block mb-1'
                        style={{ fontSize: '12px' }}
                      >
                        Modify this to display a different name for the job in
                        the jobs page.
                      </span>
                      <Form.Control
                        type='text'
                        value={queueTag}
                        onChange={(e) =>
                          setQueueTag((e.target as HTMLInputElement).value)
                        }
                        disabled={launching}
                      />
                    </Form.Group>
                  </div>
                )}

                <div
                  className='border border-dark shadow-sm p-2'
                  style={{ backgroundColor: '#697582' }}
                >
                  <div className='text-white' style={{ fontSize: '12px' }}>
                    <div>
                      New sample ({samplePercent}% of pool):{' '}
                      <strong>{additionalSampleCount}</strong> tiles
                    </div>
                    <div>
                      After launch: {totalLaunched + additionalSampleCount} of{' '}
                      {poolSize} launched (
                      {poolSize > 0
                        ? (
                          ((totalLaunched + additionalSampleCount) /
                            poolSize) *
                          100
                        ).toFixed(1)
                        : '0.0'}
                      %)
                    </div>
                  </div>
                </div>
              </>
            )}

            <div>
              <button
                type='button'
                className='btn btn-outline-danger btn-sm'
                onClick={handleReset}
                disabled={launching || resetting}
              >
                {resetting ? (
                  <span className='d-inline-flex align-items-center'>
                    <Spinner animation='border' size='sm' className='me-2' />
                    {resetProgress || 'Resetting...'}
                  </span>
                ) : (
                  'Reset FN Data'
                )}
              </button>
            </div>
          </>
        ) : (
          // ── First launch mode UI ──
          <>
            <div
              className='border border-dark shadow-sm p-2'
              style={{ backgroundColor: '#697582' }}
            >
              <p className='mb-0 text-white'>
                <strong>{globalTileCount}</strong> tiles available for false
                negative sampling.
              </p>
              <p className='mb-0 mt-1 text-muted' style={{ fontSize: '12px' }}>
                To modify tiles, go to Edit Survey &gt; Manage Tiles.
              </p>
            </div>

            <Form.Group>
              <Form.Label className='mb-0'>Sample size (%)</Form.Label>
              <Form.Control
                type='number'
                min={0}
                max={100}
                step={1}
                value={samplePercent}
                onChange={(e) =>
                  setSamplePercent(Number((e.target as HTMLInputElement).value))
                }
                disabled={launching}
              />
            </Form.Group>

            <Form.Group>
              <Form.Switch
                label='Show Advanced Options'
                checked={showAdvancedOptions}
                onChange={() => setShowAdvancedOptions(!showAdvancedOptions)}
                disabled={launching}
              />
            </Form.Group>

            {showAdvancedOptions && (
              <div
                className='d-flex flex-column gap-3 border border-dark shadow-sm p-2'
                style={{ backgroundColor: '#697582' }}
              >
                <Form.Group>
                  <Form.Label className='mb-0'>Batch Size</Form.Label>
                  <span
                    className='text-muted d-block mb-1'
                    style={{ fontSize: '12px' }}
                  >
                    The number of annotation jobs a user can pick up at a time.
                  </span>
                  <Form.Control
                    type='number'
                    value={batchSize}
                    onChange={(e) =>
                      setBatchSize(
                        Number((e.target as HTMLInputElement).value)
                      )
                    }
                    disabled={launching}
                  />
                </Form.Group>
                <Form.Group>
                  <Form.Label className='mb-0'>Job Name</Form.Label>
                  <span
                    className='text-muted d-block mb-1'
                    style={{ fontSize: '12px' }}
                  >
                    Modify this to display a different name for the job in the
                    jobs page.
                  </span>
                  <Form.Control
                    type='text'
                    value={queueTag}
                    onChange={(e) =>
                      setQueueTag((e.target as HTMLInputElement).value)
                    }
                    disabled={launching}
                  />
                </Form.Group>
              </div>
            )}

            <div
              className='border border-dark shadow-sm p-2'
              style={{ backgroundColor: '#697582' }}
            >
              <div className='d-flex align-items-center justify-content-between'>
                <div className='text-white' style={{ fontSize: '12px' }}>
                  <div>Expected tiles: {expectedTiles ?? '—'}</div>
                  <div>Estimated candidate tiles: {candidateTiles ?? '—'}</div>
                  <div>
                    Estimated launch ({samplePercent}%):{' '}
                    {estimatedSampleTiles ?? '—'}
                  </div>
                </div>
                <button
                  type='button'
                  className='btn btn-primary'
                  disabled={launching || summaryLoading}
                  onClick={computeSummary}
                >
                  {summaryLoading ? (
                    <span className='d-inline-flex align-items-center'>
                      <Spinner animation='border' size='sm' className='me-2' />{' '}
                      Computing summary...
                    </span>
                  ) : (
                    'Compute Summary'
                  )}
                </button>
              </div>
              {summaryMessage && (
                <div className='mt-2 text-muted' style={{ fontSize: '12px' }}>
                  {summaryMessage}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Fetch observation points - locations that humans have reviewed
// Returns a map of imageId -> array of tile bounds (locations that were observed)
async function fetchObservationPointsDetailed(
  client: DataClient,
  annotationSetId: string
): Promise<
  Map<string, Array<{ x: number; y: number; width: number; height: number }>>
> {
  const map = new Map<
    string,
    Array<{ x: number; y: number; width: number; height: number }>
  >();

  // OPTIMIZATION: Fetch observations with location data included in the same query
  // This avoids N+1 queries by including location fields in the selectionSet
  let nextToken: string | null | undefined = undefined;
  do {
    const { data, nextToken: nt } =
      await client.models.Observation.observationsByAnnotationSetId(
        { annotationSetId },
        {
          selectionSet: [
            'locationId',
            'location.id',
            'location.imageId',
            'location.width',
            'location.height',
            'location.x',
            'location.y',
          ] as const,
          limit: 10000,
          nextToken,
        }
      );
    for (const item of data || []) {
      const location = (item as any)?.location;
      if (!location?.imageId) continue;
      const imageId = location.imageId as string;
      const list = map.get(imageId) || [];
      list.push({
        x: Number(location.x ?? 0),
        y: Number(location.y ?? 0),
        width: Number(location.width ?? 0),
        height: Number(location.height ?? 0),
      });
      map.set(imageId, list);
    }
    nextToken = nt as string | null | undefined;
  } while (nextToken);

  return map;
}

// Fetch the set of location IDs that have been observed (reviewed by a human).
// Used by computeRemaining to check if a specific launched tile was reviewed,
// rather than checking geometric overlap which can match nearby tiles.
async function fetchObservedLocationIds(
  client: DataClient,
  annotationSetId: string
): Promise<Set<string>> {
  const ids = new Set<string>();
  let nextToken: string | null | undefined = undefined;
  do {
    const { data, nextToken: nt } =
      await client.models.Observation.observationsByAnnotationSetId(
        { annotationSetId },
        {
          selectionSet: ['locationId'] as const,
          limit: 10000,
          nextToken,
        }
      );
    for (const item of data || []) {
      const locationId = (item as any)?.locationId as string | undefined;
      if (locationId) {
        ids.add(locationId);
      }
    }
    nextToken = nt as string | null | undefined;
  } while (nextToken);
  return ids;
}

async function fetchAnnotationPointsDetailed(
  client: DataClient,
  annotationSetId: string
): Promise<Map<string, Array<{ x: number; y: number }>>> {
  const map = new Map<string, Array<{ x: number; y: number }>>();
  let nextToken: string | null | undefined = undefined;
  do {
    const { data, nextToken: nt } =
      await client.models.Annotation.annotationsByAnnotationSetId(
        { setId: annotationSetId },
        {
          selectionSet: ['imageId', 'x', 'y'] as const,
          limit: 10000,
          nextToken,
        }
      );
    for (const item of data || []) {
      const imageId = item?.imageId as string | undefined;
      if (!imageId) continue;
      const list = map.get(imageId) || [];
      list.push({
        x: Number(item.x ?? 0),
        y: Number(item.y ?? 0),
      });
      map.set(imageId, list);
    }
    nextToken = nt as string | null | undefined;
  } while (nextToken);
  return map;
}

// Threshold in bytes above which we upload the payload to S3.
// Lambda sync limit is 6MB, but we use a conservative threshold.
const PAYLOAD_SIZE_THRESHOLD = 200 * 1024; // 200KB

async function sendLaunchFalseNegativesRequest(
  client: DataClient,
  payload: Record<string, unknown>
) {
  const payloadStr = JSON.stringify(payload);
  const payloadSize = new Blob([payloadStr]).size;

  let requestPayload: string;

  if (payloadSize > PAYLOAD_SIZE_THRESHOLD) {
    // Upload large payload to S3 and send only the reference.
    const s3Key = `launch-payloads/${crypto.randomUUID()}.json`;
    console.log(
      `Payload size ${payloadSize} exceeds threshold, uploading to S3`,
      { key: s3Key }
    );
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

  try {
    await (client as any).mutations.launchFalseNegatives({
      request: requestPayload,
    }, { retry: false });
  } catch (error: any) {
    if (shouldIgnoreLaunchError(error)) {
      console.warn('Ignoring launch lambda timeout response', error);
      return;
    }
    throw error;
  }
}

function shouldIgnoreLaunchError(error: any): boolean {
  const messages: string[] = [];
  if (error?.message) messages.push(String(error.message));
  if (Array.isArray(error?.errors)) {
    for (const err of error.errors) {
      if (err?.message) messages.push(String(err.message));
    }
  }
  return messages.some((msg) =>
    /timed out|timeout|Task timed out|socket hang up/i.test(msg)
  );
}

type MinimalTileForCheck = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function isInsideTile(
  px: number,
  py: number,
  tile: MinimalTileForCheck
): boolean {
  const halfW = tile.width / 2;
  const halfH = tile.height / 2;
  const minX = tile.x - halfW;
  const maxX = tile.x + halfW;
  const minY = tile.y - halfH;
  const maxY = tile.y + halfH;
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

// Check if two tiles overlap (both have center x,y and width,height)
function tilesOverlap(
  tile1: MinimalTileForCheck,
  tile2: { x: number; y: number; width: number; height: number }
): boolean {
  const halfW1 = tile1.width / 2;
  const halfH1 = tile1.height / 2;
  const halfW2 = tile2.width / 2;
  const halfH2 = tile2.height / 2;

  const minX1 = tile1.x - halfW1;
  const maxX1 = tile1.x + halfW1;
  const minY1 = tile1.y - halfH1;
  const maxY1 = tile1.y + halfH1;

  const minX2 = tile2.x - halfW2;
  const maxX2 = tile2.x + halfW2;
  const minY2 = tile2.y - halfH2;
  const maxY2 = tile2.y + halfH2;

  // Check if rectangles overlap
  return minX1 < maxX2 && maxX1 > minX2 && minY1 < maxY2 && maxY1 > minY2;
}
