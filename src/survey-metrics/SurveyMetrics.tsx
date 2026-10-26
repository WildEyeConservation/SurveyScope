import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert } from '@/components/ui/alert';
import { badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import Select from 'react-select';
import { GlobalContext } from '../Context';
import { useUsers } from '../apiInterface';
import { fetchAllPaginatedResults } from '../utils';
import type { Schema } from '../amplify/client-schema';
import { AbortError, loadAnnotationSets } from './loaders';
import {
  STATS,
  entitiesFor,
  runReport,
  type ReportCache,
  type ReportProgress,
  type StatCost,
  type StatId,
  type SurveyReport,
} from './report';
import SurveyMetricsResults from './SurveyMetricsResults';
import type { AnnotationSetRow } from './types';
import '../AdminSurveys.css';
import './SurveyMetrics.css';

type SurveyOption = { value: string; label: string; imageCount: number };

const COST_CLASS: Record<StatCost, string> = {
  light: badgeVariants({ variant: 'secondary' }),
  heavy: cn(badgeVariants({ variant: 'warning' }), 'text-dark'),
  'very heavy': badgeVariants({ variant: 'danger' }),
};

// Survives switching admin tabs, which unmounts this component.
const cache: ReportCache = new Map();
let cachedSurveyId: string | null = null;

function elapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function SurveyMetrics() {
  const { client } = useContext(GlobalContext)!;
  const { users } = useUsers();
  const [surveys, setSurveys] = useState<SurveyOption[]>([]);
  const [loadingSurveys, setLoadingSurveys] = useState(true);
  const [survey, setSurvey] = useState<SurveyOption | null>(null);
  const [annotationSets, setAnnotationSets] = useState<AnnotationSetRow[]>([]);
  const [loadingSets, setLoadingSets] = useState(false);
  const [setId, setSetId] = useState('');
  const [selected, setSelected] = useState<Set<StatId>>(
    () => new Set<StatId>(['overview'])
  );
  const [reuseCache, setReuseCache] = useState(true);
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
            }
          ),
          fetchAllPaginatedResults<Schema['Organization']['type']>(
            client.models.Organization.list,
            { selectionSet: ['id', 'name'], limit: 10000 }
          ),
        ]);
        if (!active) return;
        const orgNames = new Map(
          organizations.map((org) => [org.id, org.name])
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
            .sort((a, b) => a.label.localeCompare(b.label))
        );
      } catch (err) {
        console.error('Failed to load surveys', err);
        if (active) {
          setError(
            err instanceof Error ? err.message : 'Failed to load surveys.'
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
    if (cachedSurveyId !== survey.value) {
      cache.clear();
      cachedSurveyId = survey.value;
    }
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
    [users]
  );

  const activeStats = useMemo(
    () =>
      STATS.filter(
        (stat) => selected.has(stat.id) && (!stat.needsSet || setId)
      ),
    [selected, setId]
  );

  const toggle = (id: StatId) =>
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
      const result = await runReport({
        surveyId: survey.value,
        annotationSetId: setId || null,
        statIds: activeStats.map((stat) => stat.id),
        imageCountHint: survey.imageCount || undefined,
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

  const renderStats = (needsSet: boolean) =>
    STATS.filter((stat) => stat.needsSet === needsSet).map((stat) => (
      <div key={stat.id} className='survey-metrics-stat flex items-start gap-2'>
        <Checkbox
          id={`survey-metric-${stat.id}`}
          className='mt-1'
          checked={selected.has(stat.id)}
          disabled={running || (needsSet && !setId)}
          onCheckedChange={() => toggle(stat.id)}
        />
        <Label htmlFor={`survey-metric-${stat.id}`} className='mb-0'>
          <span className='survey-metrics-stat-label'>{stat.label}</span>
          <span className={`ms-2 ${COST_CLASS[stat.cost]}`}>{stat.cost}</span>
          <div className='survey-metrics-stat-description'>
            {stat.description}
          </div>
        </Label>
      </div>
    ));

  const plannedEntities = entitiesFor(activeStats.map((stat) => stat.id));

  return (
    <div className='admin-surveys survey-metrics'>
      <div className='survey-metrics-pickers'>
        <div>
          <Label className='mb-1'>Survey</Label>
          <Select
            className='text-black'
            options={surveys}
            value={survey}
            onChange={setSurvey}
            isLoading={loadingSurveys}
            isDisabled={running}
            isClearable
            placeholder='Select a survey…'
          />
        </div>
        <div>
          <Label className='mb-1'>Annotation set</Label>
          <NativeSelect
            value={setId}
            onChange={(event) => setSetId(event.target.value)}
            disabled={!survey || running || loadingSets}
          >
            <option value=''>
              {loadingSets ? 'Loading…' : 'None (survey-wide stats only)'}
            </option>
            {annotationSets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className='survey-metrics-groups'>
        <div>
          <h6>Survey-wide</h6>
          {renderStats(false)}
        </div>
        <div>
          <h6>Annotation set</h6>
          {!setId && (
            <div className='survey-metrics-stat-description mb-2'>
              Select an annotation set to enable these.
            </div>
          )}
          {renderStats(true)}
        </div>
      </div>

      <div className='flex items-center gap-4 flex-wrap mb-4'>
        {running ? (
          <Button variant='outline-danger' onClick={cancel}>
            Cancel
          </Button>
        ) : (
          <Button
            variant='primary'
            onClick={fetchReport}
            disabled={!survey || activeStats.length === 0}
          >
            Fetch
          </Button>
        )}
        <div className='flex items-center gap-2'>
          <Checkbox
            id='survey-metrics-reuse'
            checked={reuseCache}
            disabled={running}
            onCheckedChange={(checked) => setReuseCache(checked === true)}
          />
          <Label htmlFor='survey-metrics-reuse' className='mb-0'>
            Reuse data already fetched for this survey
          </Label>
        </div>
        {report && !running && (
          <Button variant='outline-light' size='sm' onClick={download}>
            Download JSON
          </Button>
        )}
        {!running && survey && plannedEntities.length > 0 && (
          <span className='survey-metrics-stat-description'>
            Reads {plannedEntities.length} data set
            {plannedEntities.length === 1 ? '' : 's'} for {activeStats.length}{' '}
            stat
            {activeStats.length === 1 ? '' : 's'}.
          </span>
        )}
      </div>

      {error && (
        <Alert variant='danger' className='mb-4'>
          {error}
        </Alert>
      )}

      {progress &&
        (running || progress.tasks.some((task) => task.state === 'error')) && (
          <div className='ss-card mb-4'>
            <div className='survey-metrics-card-header'>
              <strong>
                {progress.phase === 'fetching' && 'Fetching data'}
                {progress.phase === 'computing' &&
                  `Computing ${progress.computing ?? ''} (${
                    progress.computed + 1
                  } of ${progress.toCompute})`}
                {progress.phase === 'done' && 'Finished'}
              </strong>
              {running && startedAt !== null && (
                <span className='flex items-center gap-2'>
                  <Spinner animation='border' size='sm' />
                  {elapsed(now - startedAt)}
                </span>
              )}
            </div>
            <div className='survey-metrics-card-body'>
              {progress.tasks.map((task) => (
                <div key={task.entity} className='survey-metrics-task'>
                  <div className='survey-metrics-task-label'>{task.label}</div>
                  <div className='survey-metrics-task-bar'>
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
                  </div>
                  <div className='survey-metrics-task-count'>
                    {task.state === 'pending' && 'Waiting'}
                    {task.state === 'error' && (task.error ?? 'Failed')}
                    {task.state === 'cached' &&
                      `${task.count.toLocaleString()} (reused)`}
                    {(task.state === 'running' || task.state === 'done') &&
                      `${task.count.toLocaleString()}${
                        task.total && task.state === 'running'
                          ? ` / ${task.total.toLocaleString()}`
                          : ''
                      }`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      {report && (
        <>
          <div className='survey-metrics-stat-description mb-2'>
            Generated {new Date(report.generatedAt).toLocaleString()} in{' '}
            {elapsed(report.durationMs)}
            {report.annotationSetId &&
              ` for annotation set ${
                annotationSets.find((set) => set.id === report.annotationSetId)
                  ?.name ?? report.annotationSetId
              }`}
            .
          </div>
          <SurveyMetricsResults report={report} userName={userName} />
        </>
      )}
    </div>
  );
}
