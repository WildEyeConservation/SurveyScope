import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DataClient } from '../../amplify/shared/data-schema.generated';
import { isCentreObserved } from '../../shared/locationGeometry';
import { Schema } from '../amplify/client-schema';
import { GlobalContext, UserContext } from '../Context';
import { loadRows } from '../rowChunks';
import {
  deleteFalseNegativeFiles,
  readFalseNegativeFile,
  uploadWorkflowFile,
} from '../storage/workflowFiles';
import { logAdminAction } from '../utils/adminActionLogger';
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
  const { client } = useContext(GlobalContext)!;
  const { user } = useContext(UserContext)!;

  // Global tiled location set from project
  const tiledLocationSetId = (project as any).tiledLocationSetId as
    string | undefined;

  // Queue tag
  const [queueTag, setQueueTag] = useState<string>(
    `${annotationSet.name} - False Negatives`,
  );

  // Tile count state
  const [globalTileCount, setGlobalTileCount] = useState<number | null>(null);
  const [loadingTileCount, setLoadingTileCount] = useState<boolean>(true);

  // Sampling (first launch + additional sample modes)
  const [batchSize, setBatchSize] = useState<number>(200);
  const [zoom, setZoom] = useState<number | undefined>(undefined);
  const [samplePercent, setSamplePercent] = useState<number>(5);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false);
  const [summaryError, setSummaryError] = useState(false);
  const [summaryProgress, setSummaryProgress] = useState({
    tiles: 0,
    reviewed: 0,
    annotations: 0,
    step: 0,
  });
  const [expectedTiles, setExpectedTiles] = useState<number | null>(null);
  const [candidateTiles, setCandidateTiles] = useState<number | null>(null);
  const summaryStartedRef = useRef(false);

  // FN pool + history state
  const [loadingManifests, setLoadingManifests] = useState<boolean>(true);
  const [fnPool, setFnPool] = useState<FnPool | null>(null);
  const [fnHistory, setFnHistory] = useState<FnHistory | null>(null);
  const [remainingTiles, setRemainingTiles] = useState<MinimalTile[] | null>(
    null,
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
      try {
        const pool = await readFalseNegativeFile<FnPool>(
          annotationSet.id,
          'pool',
        );
        if (!mounted) return;
        setFnPool(pool);
        const history = pool
          ? await readFalseNegativeFile<FnHistory>(
              annotationSet.id,
              'history',
            ).catch(() => null)
          : null;
        if (mounted) setFnHistory(history);
      } catch {
        // Treat unreadable manifests as first launch.
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
          { selectionSet: ['locationCount'] },
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
  }, [client.models.LocationSet, tiledLocationSetId]);

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
          annotationSet.id,
        );
        const annotationPoints = await fetchAnnotationPointsDetailed(
          client,
          annotationSet.id,
        );

        // Collect all launched tiles across all launches
        const allLaunchedTiles = fnHistory!.launches.flatMap((l) => l.items);

        const remaining = allLaunchedTiles.filter((tile) => {
          // Check if this specific tile was observed (by location ID)
          if (observedLocationIds.has(tile.id)) return false;
          const anns = annotationPoints.get(tile.imageId) || [];
          const hasAnnotation = anns.some((pt) =>
            isInsideTile(pt.x, pt.y, tile),
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
  }, [fnPool, fnHistory, client, annotationSet.id]);

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
      onProgress?: (message: string) => void,
      onCount?: (count: number) => void,
    ): Promise<MinimalTile[]> => {
      onProgress?.('Querying locations...');
      const allLocs = await loadRows(
        client,
        'locationsBySetIdAndConfidence',
        locationSetId,
        ['imageId', 'x', 'y', 'width', 'height'],
        { onProgress: onCount },
      );
      return allLocs
        .filter(
          (loc) =>
            loc.x !== 0 &&
            loc.y !== 0 &&
            (loc.width ?? 0) !== 0 &&
            (loc.height ?? 0) !== 0,
        )
        .map((loc) => ({
          id: loc.id,
          imageId: loc.imageId!,
          x: loc.x!,
          y: loc.y!,
          width: loc.width!,
          height: loc.height!,
        }));
    },
    [client],
  );

  const computeSummary = useCallback(async () => {
    if (!tiledLocationSetId) return;

    setSummaryLoading(true);
    setSummaryError(false);
    setSummaryProgress({ tiles: 0, reviewed: 0, annotations: 0, step: 0 });
    setCandidateTiles(null);
    setExpectedTiles(null);
    const progress = (change: Partial<typeof summaryProgress>) =>
      setSummaryProgress((prev) => ({ ...prev, ...change }));
    try {
      const tiles = await fetchLocationsFromSet(
        tiledLocationSetId,
        undefined,
        (count) => progress({ tiles: count }),
      );
      setExpectedTiles(tiles.length);
      progress({ tiles: tiles.length, step: 1 });

      const observationPoints = await fetchObservationPointsDetailed(
        client,
        annotationSet.id,
        (count) => progress({ reviewed: count }),
      );
      progress({ step: 2 });

      const annotationPoints = await fetchAnnotationPointsDetailed(
        client,
        annotationSet.id,
        (count) => progress({ annotations: count }),
      );
      progress({ step: 3 });

      const candidates = tiles.filter((tile) => {
        const obs = observationPoints.get(tile.imageId) || [];
        const anns = annotationPoints.get(tile.imageId) || [];
        const hasObservation = isCentreObserved(tile, obs);
        const hasAnnotation = anns.some((pt) => isInsideTile(pt.x, pt.y, tile));
        return !hasObservation && !hasAnnotation;
      });
      setCandidateTiles(candidates.length);
    } catch (error) {
      console.error('Summary calculation failed', error);
      setSummaryError(true);
    } finally {
      setSummaryLoading(false);
    }
  }, [annotationSet.id, client, fetchLocationsFromSet, tiledLocationSetId]);

  const estimatedSampleTiles = useMemo(() => {
    if (candidateTiles === null) return null;
    const normalizedPercent = Math.min(Math.max(samplePercent, 0), 100);
    const estimate = Math.floor((candidateTiles * normalizedPercent) / 100);
    return normalizedPercent > 0 && estimate === 0 && candidateTiles > 0
      ? 1
      : estimate;
  }, [candidateTiles, samplePercent]);

  // Refs for stable launch handler (avoid re-render loops)
  const modeRef = useRef(mode);
  const remainingTilesRef = useRef(remainingTiles);
  const queueTagRef = useRef(queueTag);
  const samplePercentRef = useRef(samplePercent);
  const batchSizeRef = useRef(batchSize);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
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
        onLaunchConfirmed: () => void,
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
            zoom: zoomRef.current ?? null,
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
            project.organizationId,
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
            zoom: zoomRef.current ?? null,
          };

          onProgress('Enqueuing jobs...');
          await sendLaunchFalseNegativesRequest(client, payload);
          onProgress('Launch request submitted');

          await logAdminAction(
            client,
            user.userId,
            `Launched additional ${samplePercentRef.current}% False Negatives sample for annotation set "${annotationSet.name}" in project "${project.name}"`,
            project.id,
            project.organizationId,
          ).catch(console.error);
        } else {
          // First launch mode – sample from all tiles
          onProgress('Fetching locations from global tile set...');
          const locationTiles = await fetchLocationsFromSet(
            currentTiledLocationSetId,
            onProgress,
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
            zoom: zoomRef.current ?? null,
          };

          onProgress('Enqueuing jobs...');
          await sendLaunchFalseNegativesRequest(client, payload);
          onProgress('Launch request submitted');

          await logAdminAction(
            client,
            user.userId,
            `Launched False Negatives queue for annotation set "${annotationSet.name}" in project "${project.name}" (${samplePercentRef.current}% sample)`,
            project.id,
            project.organizationId,
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
    client,
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
        'Reset all false negatives data? This will delete all observations and annotations from false negative reviews, clear the candidate pool and launch history, allowing you to start fresh. This cannot be undone.',
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
        history = await readFalseNegativeFile<FnHistory>(
          annotationSet.id,
          'history',
        ).catch(() => null);
      }

      if (history && history.launches.length > 0) {
        // Collect all launched tiles
        const allLaunchedTiles = history.launches.flatMap((l) => l.items);
        const totalTiles = allLaunchedTiles.length;

        // Helper to run promises with concurrency limit
        const runWithConcurrency = async <T,>(
          items: T[],
          fn: (item: T) => Promise<void>,
          concurrency: number,
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
                  },
                );
              const deletePromises = (data || []).map((obs) =>
                client.models.Observation.delete({ id: obs.id }),
              );
              await Promise.all(deletePromises);
              nextToken = nt as string | null | undefined;
            } while (nextToken);

            observationsDeleted++;
            if (
              observationsDeleted % 10 === 0 ||
              observationsDeleted === totalTiles
            ) {
              setResetProgress(
                `Deleting observations (${observationsDeleted}/${totalTiles} tiles)...`,
              );
            }
          },
          50,
        );

        // Delete annotations by imageId with source containing "false-negative"
        // Get unique imageIds from launched tiles
        const uniqueImageIds = Array.from(
          new Set(allLaunchedTiles.map((t) => t.imageId)),
        );
        let imagesProcessed = 0;
        setResetProgress(
          `Deleting annotations (0/${uniqueImageIds.length} images)...`,
        );

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
                  },
                );
              const deletePromises = (data || []).map((ann) =>
                client.models.Annotation.delete({ id: ann.id }),
              );
              await Promise.all(deletePromises);
              nextToken = nt as string | null | undefined;
            } while (nextToken);

            imagesProcessed++;
            if (
              imagesProcessed % 10 === 0 ||
              imagesProcessed === uniqueImageIds.length
            ) {
              setResetProgress(
                `Deleting annotations (${imagesProcessed}/${uniqueImageIds.length} images)...`,
              );
            }
          },
          50,
        );
      }

      // Delete manifests
      setResetProgress('Removing manifests...');
      await deleteFalseNegativeFiles(annotationSet.id);

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
  }, [annotationSet.id, client, fnHistory]);

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

  const batchField = (
    <div>
      <Label className='mb-1'>Batch size</Label>
      <Input
        type='number'
        title='The number of annotation jobs a user can pick up at a time'
        value={batchSize}
        onChange={(e) => setBatchSize(Number(e.target.value))}
        disabled={launching}
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
      disabled={launching || !tiledLocationSetId}
    />
  );

  // The first-launch summary runs once the tiles are known to exist.
  useEffect(() => {
    if (
      mode !== 'first-launch' ||
      !tiledLocationSetId ||
      !globalTileCount ||
      summaryStartedRef.current
    ) {
      return;
    }
    summaryStartedRef.current = true;
    computeSummary();
  }, [mode, tiledLocationSetId, globalTileCount, computeSummary]);

  useLaunchLabel(
    mode === 'first-launch' && estimatedSampleTiles
      ? `Launch ${plural(estimatedSampleTiles, 'tile')}`
      : mode === 'continue' && remainingTiles?.length
        ? `Launch ${plural(remainingTiles.length, 'remaining tile')}`
        : mode === 'additional' && additionalSampleCount
          ? `Launch ${plural(additionalSampleCount, 'tile')}`
          : null,
    showNoTilesWarning
      ? 'Create tiles in Edit Survey › Manage Tiles first'
      : mode === 'additional' && poolExhausted
        ? 'Every candidate tile has been launched'
        : undefined,
  );

  const advanced = (
    <AdvancedOptions disabled={launching}>
      <SettingRow label='Job name' hint='Shown on the Jobs page'>
        <Input
          type='text'
          aria-label='Job name'
          value={queueTag}
          onChange={(e) => setQueueTag(e.target.value)}
          disabled={launching}
        />
      </SettingRow>
      {fnPool && (
        <SettingRow
          label='Reset false negative data'
          hint='Deletes the reviews, annotations and history so you can start over.'
        >
          <Button
            variant='outline-danger'
            className='w-full'
            onClick={handleReset}
            disabled={launching || resetting}
          >
            {resetting ? (
              <>
                <Spinner animation='border' size='sm' />
                {resetProgress || 'Resetting...'}
              </>
            ) : (
              'Reset'
            )}
          </Button>
        </SettingRow>
      )}
    </AdvancedOptions>
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
          disabled={launching}
        />
        <span className='pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-[#6c757d]'>
          %
        </span>
      </div>
    </div>
  );

  return (
    <div className='flex flex-col gap-4 p-4'>
      {mode === 'loading' ? (
        <LoadingProgressCard
          title='Loading false negative history...'
          rows={[
            {
              label: 'Tiles',
              count: globalTileCount ?? 0,
              done: !loadingTileCount,
            },
            {
              label: 'Previous launches',
              count: fnHistory?.launches.length ?? 0,
              done: !loadingManifests,
            },
            ...(fnPool
              ? [
                  {
                    label: 'Tiles left from earlier launches',
                    count: remainingTiles?.length ?? 0,
                    done: !loadingRemaining && remainingTiles !== null,
                  },
                ]
              : []),
          ]}
        />
      ) : showNoTilesWarning ? (
        <Banner tone='warning'>
          This survey has no tiles yet. Create them in Edit Survey › Manage
          Tiles.
        </Banner>
      ) : mode === 'continue' ? (
        <>
          <LaunchSummary value={remainingTiles?.length.toLocaleString() ?? '—'}>
            tiles from earlier launches still need a look
            <br />
            {coveragePercent}% of the candidate pool launched across{' '}
            {plural(fnHistory?.launches.length ?? 0, 'session')}
          </LaunchSummary>
          <div className='grid gap-3 sm:grid-cols-2'>
            {batchField}
            {zoomSetting}
          </div>
          {advanced}
        </>
      ) : mode === 'additional' ? (
        <>
          <LaunchSummary value={`${coveragePercent}%`}>
            of the candidate pool launched ({totalLaunched.toLocaleString()} of{' '}
            {poolSize.toLocaleString()})
            <br />
            {poolExhausted
              ? 'Every candidate tile has been launched.'
              : `${remainingInPool.toLocaleString()} candidates can still be launched`}
          </LaunchSummary>
          {!poolExhausted && (
            <div className='grid gap-3 sm:grid-cols-3'>
              {sampleField('Additional sample of the pool')}
              {batchField}
              {zoomSetting}
            </div>
          )}
          {advanced}
        </>
      ) : (
        <>
          {summaryLoading ? (
            <LoadingProgressCard
              title='Finding tiles nobody has looked at...'
              rows={[
                {
                  label: 'Tiles',
                  count: summaryProgress.tiles,
                  done: summaryProgress.step > 0,
                },
                {
                  label: 'Reviewed locations',
                  count: summaryProgress.reviewed,
                  done: summaryProgress.step > 1,
                },
                {
                  label: 'Annotations',
                  count: summaryProgress.annotations,
                  done: summaryProgress.step > 2,
                },
              ]}
            />
          ) : summaryError ? (
            <Banner tone='danger'>
              The candidate tiles could not be worked out.{' '}
              <Button variant='link' className='p-0' onClick={computeSummary}>
                Try again
              </Button>
            </Banner>
          ) : (
            <LaunchSummary
              value={estimatedSampleTiles?.toLocaleString() ?? '—'}
            >
              tiles sampled ({samplePercent}% of{' '}
              {candidateTiles?.toLocaleString() ?? '—'} candidates)
              <br />
              Candidates are the {expectedTiles?.toLocaleString() ?? '—'} tiles
              minus those already reviewed or annotated
            </LaunchSummary>
          )}
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

type TileBounds = { x: number; y: number; width: number; height: number };

// Tile bounds of every location a human has reviewed, by image.
async function fetchObservationPointsDetailed(
  client: DataClient,
  annotationSetId: string,
  onCount?: (count: number) => void,
): Promise<Map<string, TileBounds[]>> {
  const rows = await loadRows(
    client,
    'observationsByAnnotationSetId',
    annotationSetId,
    [
      'location.imageId',
      'location.x',
      'location.y',
      'location.width',
      'location.height',
    ],
    { onProgress: onCount },
  );
  const map = new Map<string, TileBounds[]>();
  for (const row of rows) {
    const imageId = row['location.imageId'];
    if (!imageId) continue;
    const list = map.get(imageId) ?? [];
    list.push({
      x: Number(row['location.x'] ?? 0),
      y: Number(row['location.y'] ?? 0),
      width: Number(row['location.width'] ?? 0),
      height: Number(row['location.height'] ?? 0),
    });
    map.set(imageId, list);
  }
  return map;
}

// Match exact tiles, not geometric overlap.
async function fetchObservedLocationIds(
  client: DataClient,
  annotationSetId: string,
): Promise<Set<string>> {
  const rows = await loadRows(
    client,
    'observationsByAnnotationSetId',
    annotationSetId,
    ['locationId'],
  );
  return new Set(
    rows.flatMap((row) => (row.locationId ? [row.locationId] : [])),
  );
}

async function fetchAnnotationPointsDetailed(
  client: DataClient,
  annotationSetId: string,
  onCount?: (count: number) => void,
): Promise<Map<string, Array<{ x: number; y: number }>>> {
  const rows = await loadRows(
    client,
    'annotationsByAnnotationSetId',
    annotationSetId,
    ['imageId', 'x', 'y'],
    { onProgress: onCount },
  );
  const map = new Map<string, Array<{ x: number; y: number }>>();
  for (const row of rows) {
    if (!row.imageId) continue;
    const list = map.get(row.imageId) ?? [];
    list.push({ x: Number(row.x ?? 0), y: Number(row.y ?? 0) });
    map.set(row.imageId, list);
  }
  return map;
}

// Threshold in bytes above which we upload the payload to S3.
// Lambda sync limit is 6MB, but we use a conservative threshold.
const PAYLOAD_SIZE_THRESHOLD = 200 * 1024; // 200KB

async function sendLaunchFalseNegativesRequest(
  client: DataClient,
  payload: Record<string, unknown>,
) {
  const payloadStr = JSON.stringify(payload);
  const payloadSize = new Blob([payloadStr]).size;

  let requestPayload: string;

  if (payloadSize > PAYLOAD_SIZE_THRESHOLD) {
    // Upload large payload to S3 and send only the reference.
    const s3Key = await uploadWorkflowFile(
      'launch-payload',
      String(payload.projectId),
      payloadStr,
    );
    requestPayload = JSON.stringify({ payloadS3Key: s3Key });
  } else {
    requestPayload = payloadStr;
  }

  try {
    await (client as any).mutations.launchFalseNegatives(
      {
        request: requestPayload,
      },
      { retry: false },
    );
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
    /timed out|timeout|Task timed out|socket hang up/i.test(msg),
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
  tile: MinimalTileForCheck,
): boolean {
  const halfW = tile.width / 2;
  const halfH = tile.height / 2;
  const minX = tile.x - halfW;
  const maxX = tile.x + halfW;
  const minY = tile.y - halfH;
  const maxY = tile.y + halfH;
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}
