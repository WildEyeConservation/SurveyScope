import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Download, Lock, Play, Square } from 'lucide-react';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Schema } from '../amplify/client-schema';
import { useUsers } from '../apiInterface';
import { GlobalContext, UserContext } from '../Context';
import { fetchAllPaginatedResults } from '../utils';
import { openReportCache, type ReportCache } from './cache';
import {
  AbortError,
  BAND_WIDTHS,
  DEFAULT_BAND_WIDTHS,
  DETECTORS,
  loadAnnotationSets,
  type BandWidths,
} from './loaders';
import {
  TILES,
  entitiesFor,
  includedTiles,
  runReport,
  type ReportProgress,
  type StatCost,
  type StatTile,
  type SurveyReport,
} from './report';
import SurveyMetricsResults from './SurveyMetricsResults';
import type { AnnotationSetRow } from './types';

type SurveyOption = { value: string; label: string; imageCount: number };

const COST_CLASS: Record<StatCost, string> = {
  light: 'border-white/30 text-muted-foreground',
  heavy: 'border-warning/60 text-warning',
  'very heavy': 'border-danger/70 text-danger',
};

// Survives switching admin tabs, which unmounts this component.
let opened: { scope: string; cache: Promise<ReportCache> } | null = null;

function cacheFor(scope: string): Promise<ReportCache> {
  if (opened?.scope !== scope) {
    opened = { scope, cache: openReportCache(scope) };
  }
  return opened.cache;
}

function elapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function SurveyMetrics() {
  const { client } = useContext(GlobalContext)!;
  const userId = useContext(UserContext)?.user.userId ?? '';
  const { users } = useUsers();
  const [surveys, setSurveys] = useState<SurveyOption[]>([]);
  const [loadingSurveys, setLoadingSurveys] = useState(true);
  const [survey, setSurvey] = useState<SurveyOption | null>(null);
  const [annotationSets, setAnnotationSets] = useState<AnnotationSetRow[]>([]);
  const [loadingSets, setLoadingSets] = useState(false);
  const [setId, setSetId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(['overview']),
  );
  const [reuseCache, setReuseCache] = useState(true);
  const [bandWidths, setBandWidths] = useState<BandWidths>(DEFAULT_BAND_WIDTHS);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ReportProgress | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [report, setReport] = useState<SurveyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [projects, organizations] = await Promise.all([
          fetchAllPaginatedResults<Schema['Project']['type']>(
            client.models.Project.list,
            {
              selectionSet: [
                'id',
                'name',
                'organizationId',
                'imageSets.imageCount',
              ],
              limit: 10000,
            },
          ),
          fetchAllPaginatedResults<Schema['Organization']['type']>(
            client.models.Organization.list,
            { selectionSet: ['id', 'name'], limit: 10000 },
          ),
        ]);
        if (!active) return;
        const orgNames = new Map(
          organizations.map((org) => [org.id, org.name]),
        );
        setSurveys(
          projects
            .map((project) => ({
              value: project.id,
              label: `${project.name} (${
                orgNames.get(project.organizationId) ?? 'Unknown organisation'
              })`,
              imageCount: (
                (project.imageSets as unknown as {
                  imageCount?: number | null;
                }[]) ?? []
              ).reduce((sum, set) => sum + (set.imageCount ?? 0), 0),
            }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
      } catch (err) {
        console.error('Failed to load surveys', err);
        if (active) {
          setError(
            err instanceof Error ? err.message : 'Failed to load surveys.',
          );
        }
      } finally {
        if (active) setLoadingSurveys(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    setAnnotationSets([]);
    setSetId('');
    setReport(null);
    setProgress(null);
    setError(null);
    if (!survey) return;
    const abort = new AbortController();
    setLoadingSets(true);
    loadAnnotationSets(survey.value, {
      signal: abort.signal,
      onProgress: () => {},
    })
      .then((sets) => {
        if (abort.signal.aborted) return;
        setAnnotationSets(sets.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((err) => {
        if (abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadingSets(false);
      });
    return () => abort.abort();
  }, [survey]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const userName = useCallback(
    (owner: string) => {
      const parts = owner.split('::');
      const user = users.find((candidate) => parts.includes(candidate.id));
      return user?.name || user?.email || parts[parts.length - 1];
    },
    [users],
  );

  const offered = useMemo(
    () => TILES.filter((tile) => !tile.needsSet || setId),
    [setId],
  );
  const included = useMemo(
    () =>
      includedTiles(
        offered.filter((tile) => selected.has(tile.id)),
        offered,
      ),
    [offered, selected],
  );
  const activeTiles = useMemo(
    () =>
      offered.filter((tile) => selected.has(tile.id) || included.has(tile.id)),
    [offered, selected, included],
  );
  const activeStats = useMemo(
    () => [...new Set(activeTiles.flatMap((tile) => tile.stats))],
    [activeTiles],
  );

  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const fetchReport = async () => {
    if (!survey || activeStats.length === 0) return;
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setError(null);
    setReport(null);
    setProgress(null);
    setStartedAt(Date.now());
    setNow(Date.now());
    try {
      const cache = await cacheFor(`${userId}:${survey.value}`);
      const result = await runReport({
        surveyId: survey.value,
        annotationSetId: setId || null,
        statIds: activeStats,
        imageCountHint: survey.imageCount || undefined,
        bandWidths,
        cache,
        reuseCache,
        signal: abort.signal,
        onProgress: setProgress,
      });
      if (!abort.signal.aborted) setReport(result);
    } catch (err) {
      if (abort.signal.aborted) return;
      if (!(err instanceof AbortError)) {
        console.error('Survey metrics failed', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setRunning(false);
      }
    }
  };

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setProgress(null);
  };

  const download = () => {
    if (!report || !survey) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `survey-metrics_${
      survey.value
    }_${report.generatedAt.replace(/[:.]/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const statTile = (stat: StatTile) => {
    const parents = included.get(stat.id);
    const unavailable = running || (stat.needsSet && !setId);
    const checked = selected.has(stat.id) || Boolean(parents);
    return (
      <label
        key={stat.id}
        htmlFor={`survey-metric-${stat.id}`}
        className={cn(
          'flex items-start gap-3 border p-3 transition-colors',
          checked && !unavailable
            ? 'border-primary bg-primary/10'
            : 'border-white/15',
          unavailable && 'opacity-50',
          unavailable || parents
            ? 'cursor-not-allowed'
            : 'cursor-pointer hover:bg-white/5',
        )}
      >
        <Checkbox
          id={`survey-metric-${stat.id}`}
          className='mt-0.5'
          checked={checked}
          disabled={unavailable || Boolean(parents)}
          onCheckedChange={() => toggle(stat.id)}
        />
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <span className='font-semibold'>{stat.label}</span>
            <span
              className={cn(
                'rounded-full border px-2 text-xs leading-5',
                COST_CLASS[stat.cost],
              )}
            >
              {stat.cost}
            </span>
          </div>
          <div className='mt-1 text-sm text-muted-foreground'>
            {stat.description}
          </div>
          {parents && (
            <div className='mt-1 flex items-center gap-1.5 text-sm'>
              <Lock size={12} className='shrink-0' />
              <span>
                Included with {parents.map((tile) => tile.label).join(' and ')}:
                its data is already being read.
              </span>
            </div>
          )}
        </div>
      </label>
    );
  };

  const plannedEntities = entitiesFor(activeStats);
  const usesBands = activeStats.some(
    (id) => id === 'detectorOutput' || id === 'confidenceCoverage',
  );
  const setName = (id: string) =>
    annotationSets.find((set) => set.id === id)?.name ?? id;
  const setOptions = annotationSets.map((set) => ({
    value: set.id,
    label: set.name,
  }));

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between gap-2'>
        <h5 className='mb-0'>Survey Metrics</h5>
        {report && !running && (
          <Button variant='outline-success' onClick={download}>
            <Download size={16} />
            Download JSON
          </Button>
        )}
      </div>

      <div className='flex flex-wrap items-end gap-2'>
        <div className='min-w-72 flex-[1.4]'>
          <Label className='mb-1'>Survey</Label>
          <Combobox
            options={surveys}
            value={survey}
            onChange={(option) =>
              setSurvey(
                surveys.find((item) => item.value === option?.value) ?? null,
              )
            }
            loading={loadingSurveys}
            disabled={running}
            clearable
            placeholder='Select a survey…'
            name='Survey'
          />
        </div>
        <div className='min-w-60 flex-1'>
          <Label className='mb-1'>Annotation set</Label>
          <Combobox
            options={setOptions}
            value={setOptions.find((option) => option.value === setId) ?? null}
            onChange={(option) => setSetId(option?.value ?? '')}
            loading={loadingSets}
            disabled={!survey || running}
            clearable
            placeholder={
              survey ? 'None (survey-wide only)' : 'Select a survey first'
            }
            name='Annotation set'
          />
        </div>
      </div>

      <Card>
        <CardHeader className='flex flex-wrap items-center justify-between gap-2 py-3'>
          <div className='font-semibold'>Metrics to fetch</div>
          <div className='flex gap-1 text-sm'>
            <Button
              variant='ghost'
              size='sm'
              disabled={running}
              onClick={() =>
                setSelected(
                  new Set(
                    TILES.filter((tile) => tile.cost === 'light').map(
                      (tile) => tile.id,
                    ),
                  ),
                )
              }
            >
              Light only
            </Button>
            <Button
              variant='ghost'
              size='sm'
              disabled={running}
              onClick={() => setSelected(new Set(TILES.map((tile) => tile.id)))}
            >
              All
            </Button>
            <Button
              variant='ghost'
              size='sm'
              disabled={running}
              onClick={() => setSelected(new Set())}
            >
              None
            </Button>
          </div>
        </CardHeader>
        <CardContent className='grid gap-4 lg:grid-cols-2'>
          <div className='flex flex-col gap-2'>
            <div className='text-sm font-semibold tracking-wide text-muted-foreground uppercase'>
              Survey-wide
            </div>
            {TILES.filter((tile) => !tile.needsSet).map(statTile)}
          </div>
          <div className='flex flex-col gap-2'>
            <div className='text-sm font-semibold tracking-wide text-muted-foreground uppercase'>
              Annotation set
              {setId && (
                <span className='ml-2 tracking-normal normal-case'>
                  {setName(setId)}
                </span>
              )}
            </div>
            {!setId && (
              <div className='text-sm text-muted-foreground'>
                Pick an annotation set above to enable these.
              </div>
            )}
            {TILES.filter((tile) => tile.needsSet).map(statTile)}
          </div>
        </CardContent>
        {usesBands && (
          <div className='flex flex-col gap-2 border-t border-border-subtle px-4 py-3'>
            <div className='text-sm font-semibold tracking-wide text-muted-foreground uppercase'>
              Confidence band width
            </div>
            <div className='flex flex-wrap gap-x-6 gap-y-2'>
              {DETECTORS.map((detector) => (
                <div key={detector.prefix} className='flex items-center gap-2'>
                  <span>{detector.label}</span>
                  <div
                    role='radiogroup'
                    aria-label={`${detector.label} confidence band width`}
                    className='inline-flex border border-white/30'
                  >
                    {BAND_WIDTHS.map((width) => (
                      <button
                        key={width}
                        type='button'
                        role='radio'
                        disabled={running}
                        aria-checked={bandWidths[detector.prefix] === width}
                        onClick={() =>
                          setBandWidths((previous) => ({
                            ...previous,
                            [detector.prefix]: width,
                          }))
                        }
                        className={cn(
                          'px-2.5 py-1 text-sm tabular-nums transition-colors disabled:opacity-60',
                          bandWidths[detector.prefix] === width
                            ? 'bg-primary text-white'
                            : 'enabled:hover:bg-white/10',
                        )}
                      >
                        {width.toFixed(2)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className='flex flex-wrap items-center gap-4 border-t border-border-subtle px-4 py-3'>
          <label className='flex cursor-pointer items-center gap-2'>
            <Switch
              checked={reuseCache}
              disabled={running}
              onCheckedChange={setReuseCache}
            />
            Reuse data already fetched for this survey
          </label>
          <div className='ml-auto flex items-center gap-3'>
            {!running && survey && plannedEntities.length > 0 && (
              <span className='text-sm text-muted-foreground'>
                {activeTiles.length} metric
                {activeTiles.length === 1 ? '' : 's'}, reading{' '}
                {plannedEntities.length} data set
                {plannedEntities.length === 1 ? '' : 's'}
              </span>
            )}
            {running ? (
              <Button variant='outline-danger' onClick={cancel}>
                <Square size={14} />
                Cancel
              </Button>
            ) : (
              <Button
                variant='primary'
                onClick={fetchReport}
                disabled={!survey || activeTiles.length === 0}
              >
                <Play size={14} />
                Fetch
              </Button>
            )}
          </div>
        </div>
      </Card>

      {error && <Alert variant='danger'>{error}</Alert>}

      {progress &&
        (running || progress.tasks.some((task) => task.state === 'error')) && (
          <Card>
            <CardHeader className='flex items-center justify-between py-3'>
              <div className='font-semibold'>
                {progress.phase === 'fetching' && 'Fetching data'}
                {progress.phase === 'computing' &&
                  `Computing ${progress.computing ?? ''} (${
                    progress.computed + 1
                  } of ${progress.toCompute})`}
                {progress.phase === 'done' && 'Finished'}
              </div>
              {running && startedAt !== null && (
                <span className='flex items-center gap-2 text-sm tabular-nums'>
                  <Spinner animation='border' size='sm' />
                  {elapsed(now - startedAt)}
                </span>
              )}
            </CardHeader>
            <CardContent className='flex flex-col gap-2'>
              {progress.tasks.map((task) => (
                <div
                  key={task.entity}
                  className='grid grid-cols-[minmax(140px,220px)_1fr_minmax(120px,auto)] items-center gap-3 text-sm'
                >
                  <div>{task.label}</div>
                  <Progress
                    value={
                      task.state === 'done' || task.state === 'cached'
                        ? 100
                        : task.total
                          ? Math.min(100, (task.count / task.total) * 100)
                          : task.state === 'running'
                            ? 100
                            : 0
                    }
                    animated={task.state === 'running' && !task.total}
                    striped={task.state === 'running' && !task.total}
                    variant={
                      task.state === 'error'
                        ? 'danger'
                        : task.state === 'done' || task.state === 'cached'
                          ? 'success'
                          : undefined
                    }
                  />
                  <div
                    className={cn(
                      'text-right [overflow-wrap:anywhere] tabular-nums',
                      task.state === 'pending' && 'text-muted-foreground',
                      task.state === 'error' && 'text-danger',
                    )}
                  >
                    {task.state === 'pending' && 'Waiting'}
                    {task.state === 'error' && (task.error ?? 'Failed')}
                    {task.state === 'cached' &&
                      `${task.count.toLocaleString()} (reused, from ${
                        task.fetchedAt
                          ? new Date(task.fetchedAt).toLocaleString()
                          : 'earlier'
                      })`}
                    {(task.state === 'running' || task.state === 'done') &&
                      `${task.count.toLocaleString()}${
                        task.total && task.state === 'running'
                          ? ` / ${task.total.toLocaleString()}`
                          : ''
                      }`}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

      {report && (
        <SurveyMetricsResults
          report={report}
          userName={userName}
          summary={`Generated ${new Date(report.generatedAt).toLocaleString()} in ${elapsed(report.durationMs)}${
            report.annotationSetId
              ? ` for annotation set ${setName(report.annotationSetId)}`
              : ''
          }`}
        />
      )}
    </div>
  );
}
