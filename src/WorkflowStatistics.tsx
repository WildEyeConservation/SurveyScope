import DataTable from '@/components/DataTable';
import { cellRows, columnsFromHeadings } from '@/components/cellColumns';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { fieldBase, fieldSizes } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import exportFromJSON from 'export-from-json';
import { CameraIcon, DownloadIcon, RefreshCw, XIcon } from 'lucide-react';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { neutraliseCsvRows } from '../shared/csv';
import { GlobalContext, UserContext } from './Context';
import PageHeader from './PageHeader';
import WorkflowSnapshotModal from './WorkflowSnapshotModal';
import { useUsers } from './apiInterface';
import { LIGHT_THEME } from './survey/mapTheme';
import { fetchAllPaginatedResults } from './utils';
import { eventToCsvRow, fetchAllWorkflowEvents } from './workflowEvents';
import { WORKFLOW_REGISTRY, type WorkflowType } from './workflowRegistry';
import {
  resolveStatsQuery,
  type StatsQueryResult as QueryResult,
  type RunSummary,
  type StatsBucket,
} from './workflowStatsQuery';
import {
  buildWorkflowSections,
  localDateString,
  localDayEnd,
  localDayStart,
} from './workflowStatsSections';

/**
 * Reports the workflow-neutral statistics pipeline: completions, timing and
 * per-workflow metrics for every instrumented workflow, read from the durable
 * Workflow Run / Daily Stats tables rather than from Observations.
 *
 * Organization members can read their organization's statistics. Columns come from the shared workflow registry,
 * so newly instrumented workflows appear here without changes.
 *
 * Layout: inputs (survey, annotation sets, date range) in a filter bar;
 * results below it, with the workflow filter beside them because it narrows what
 * is shown rather than what is fetched; exports in the card footer.
 */

const FINISH_REASON_LABELS: Record<string, string> = {
  drained: 'all work done',
  'requeue-limit': 'finished with unreturned work',
  stale: 'no activity for 60 days',
  user: 'cancelled by a user',
  backfill: 'closed by backfill',
};

function formatUtc(timestamp: string | null | undefined): string {
  return timestamp ? timestamp.replace('T', ' ').slice(0, 19) : '';
}

function runStatusLabel(run: RunSummary): string {
  const reason = run.finishReason
    ? (FINISH_REASON_LABELS[run.finishReason] ?? run.finishReason)
    : undefined;
  return reason ? `${run.status} (${reason})` : run.status;
}

interface ProjectOption {
  id: string;
  name: string;
  organizationId: string;
  annotationSets?: { id: string; name: string }[];
}

type SelectOption = { label: string; value: string };

const AUTO_REFRESH_S = 30;
const MANUAL_REFRESH_COOLDOWN_MS = 5_000;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export default function WorkflowStatistics() {
  const { client } = useContext(GlobalContext)!;
  const { cognitoGroups, myMembershipHook, myOrganizationHook } =
    useContext(UserContext)!;
  const { users: allUsers } = useUsers();

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [organizationNames, setOrganizationNames] = useState<
    Record<string, string>
  >({});
  const [project, setProject] = useState<SelectOption | null>(null);
  const [selectedSets, setSelectedSets] = useState<SelectOption[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  // Until the user touches the dates, the range follows the survey: from its
  // earliest run launch to today, so an older survey never opens empty.
  const [dateRangeIsAuto, setDateRangeIsAuto] = useState(true);
  const [selectedWorkflow, setSelectedWorkflow] = useState<SelectOption | null>(
    null,
  );

  const [buckets, setBuckets] = useState<StatsBucket[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [refreshCooldown, setRefreshCooldown] = useState(false);
  const [secondsUntilSync, setSecondsUntilSync] = useState(AUTO_REFRESH_S);
  const [pageVisible, setPageVisible] = useState(
    () => document.visibilityState === 'visible',
  );
  // Selections can change faster than queries return; only the latest wins.
  const requestSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function loadProjects() {
      try {
        const [allProjects, allOrganizations] = await Promise.all([
          fetchAllPaginatedResults<ProjectOption>(client.models.Project.list, {
            selectionSet: [
              'id',
              'name',
              'organizationId',
              'annotationSets.id',
              'annotationSets.name',
            ],
            limit: 10000,
          }),
          fetchAllPaginatedResults<{ id: string; name: string }>(
            client.models.Organization.list,
            { selectionSet: ['id', 'name'], limit: 10000 },
          ),
        ]);
        if (cancelled) return;
        setProjects(
          [...allProjects].sort((left, right) =>
            (left.name ?? '').localeCompare(right.name ?? ''),
          ),
        );
        setOrganizationNames(
          Object.fromEntries(
            allOrganizations.map((organization) => [
              organization.id,
              organization.name,
            ]),
          ),
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load surveys',
          );
        }
      }
    }

    loadProjects();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const projectOptions = useMemo(
    () =>
      projects.map((candidate) => {
        const organizationName = organizationNames[candidate.organizationId];
        return {
          label: organizationName
            ? `${candidate.name} (${organizationName})`
            : candidate.name,
          value: candidate.id,
        };
      }),
    [projects, organizationNames],
  );

  const setOptions = useMemo(() => {
    const selected = projects.find(
      (candidate) => candidate.id === project?.value,
    );
    return (selected?.annotationSets ?? []).map((set) => ({
      label: set.name,
      value: set.id,
    }));
  }, [projects, project?.value]);

  const userName = useCallback(
    (userId: string) =>
      allUsers.find((candidate) => candidate.id === userId)?.name ?? userId,
    [allUsers],
  );

  // Buckets are small (one per user, day and run), so the whole history for
  // the selected sets is fetched once and the date range is applied here.
  // Changing dates is then instant and needs no round trip.
  const loadStats = useCallback(
    async (background: boolean) => {
      if (!project || selectedSets.length === 0) return;
      const sequence = ++requestSequence.current;
      const projectId = project.value;
      const annotationSetIds = selectedSets.map((set) => set.value);
      if (!background) setLoading(true);
      setError(null);
      try {
        const statsQuery = resolveStatsQuery(client);
        if (!statsQuery) {
          throw new Error(
            'The workflow statistics query is not available in this environment yet. It ships with the backend deploy that adds it.',
          );
        }
        const { data, errors } = await statsQuery({
          projectId,
          annotationSetIds,
        });
        if (sequence !== requestSequence.current) return;
        if (errors?.length) {
          throw new Error(
            errors.map((entry) => entry.message ?? 'Unknown error').join('; '),
          );
        }
        const parsed = (
          typeof data === 'string' ? JSON.parse(data) : (data ?? {})
        ) as QueryResult;
        setBuckets(parsed.buckets ?? []);
        setRuns(parsed.runs ?? []);
        setTruncated(parsed.truncated === true);
        setHasLoaded(true);
        if (!background) setSelectedWorkflow(null);
      } catch (queryError) {
        if (sequence !== requestSequence.current) return;
        setError(
          queryError instanceof Error
            ? queryError.message
            : 'Failed to load workflow statistics',
        );
        if (!background) {
          setBuckets([]);
          setRuns([]);
        }
      } finally {
        if (sequence === requestSequence.current && !background) {
          setLoading(false);
        }
      }
    },
    [client, project, selectedSets],
  );

  useEffect(() => {
    if (!project || selectedSets.length === 0) {
      requestSequence.current += 1;
      setBuckets([]);
      setRuns([]);
      setHasLoaded(false);
      return;
    }
    setSecondsUntilSync(AUTO_REFRESH_S);
    loadStats(false);
  }, [project, selectedSets, loadStats]);

  // Auto-sync countdown; paused while the tab is hidden.
  useEffect(() => {
    function onVisibilityChange() {
      const visible = document.visibilityState === 'visible';
      setPageVisible(visible);
      if (visible) setSecondsUntilSync(0);
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!hasLoaded || !pageVisible) return;
    const timer = setInterval(
      () => setSecondsUntilSync((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [hasLoaded, pageVisible]);

  useEffect(() => {
    if (!hasLoaded || !pageVisible || secondsUntilSync > 0) return;
    setSecondsUntilSync(AUTO_REFRESH_S);
    loadStats(true);
  }, [hasLoaded, pageVisible, secondsUntilSync, loadStats]);

  useEffect(() => {
    if (!refreshCooldown) return;
    const timeout = setTimeout(
      () => setRefreshCooldown(false),
      MANUAL_REFRESH_COOLDOWN_MS,
    );
    return () => clearTimeout(timeout);
  }, [refreshCooldown]);

  function refreshNow() {
    if (refreshCooldown) return;
    setRefreshCooldown(true);
    setSecondsUntilSync(AUTO_REFRESH_S);
    loadStats(true);
  }

  useEffect(() => {
    if (!dateRangeIsAuto || !hasLoaded) return;
    const launches = runs
      .map((run) => new Date(run.launchedAt).getTime())
      .filter((time) => Number.isFinite(time));
    const bucketDates = buckets
      .map((bucket) => new Date(`${bucket.date}T00:00:00`).getTime())
      .filter((time) => Number.isFinite(time));
    const earliest = Math.min(...launches, ...bucketDates);
    setStartDate(
      Number.isFinite(earliest) ? startOfLocalDay(new Date(earliest)) : null,
    );
    setEndDate(startOfLocalDay(new Date()));
  }, [dateRangeIsAuto, hasLoaded, runs, buckets]);

  function selectProject(option: SelectOption | null) {
    setProject(option);
    setSelectedWorkflow(null);
    setDateRangeIsAuto(true);
    const sets =
      projects
        .find((candidate) => candidate.id === option?.value)
        ?.annotationSets?.map((set) => ({ label: set.name, value: set.id })) ??
      [];
    // A single set needs no choice; several do, so the user picks.
    setSelectedSets(sets.length === 1 ? sets : []);
  }

  const startString = localDateString(startDate);
  const endString = localDateString(endDate);

  const bucketsInRange = useMemo(
    () =>
      buckets.filter(
        (bucket) =>
          (!startString || bucket.date >= startString) &&
          (!endString || bucket.date <= endString),
      ),
    [buckets, startString, endString],
  );

  const runOptions = useMemo(() => {
    const named = new Map<string, string>();
    runs.forEach((run) => {
      const label = WORKFLOW_REGISTRY[run.workflowType as WorkflowType]?.label;
      named.set(
        run.runId,
        `${run.displayName || run.runId}${label ? ` — ${label}` : ''}${
          run.launchedAt ? ` (${run.launchedAt.slice(0, 10)})` : ''
        }`,
      );
    });
    // A run that recorded work but is missing from the run table would
    // otherwise be unfilterable, so surface it by id.
    buckets.forEach((bucket) => {
      if (!named.has(bucket.workflowRunId)) {
        named.set(bucket.workflowRunId, bucket.workflowRunId);
      }
    });
    return [...named.entries()].map(([value, label]) => ({ label, value }));
  }, [runs, buckets]);

  const runName = useCallback(
    (runId: string) =>
      runOptions.find((option) => option.value === runId)?.label ?? runId,
    [runOptions],
  );

  const workflowOptions = useMemo(
    () =>
      [...new Set([...runs, ...buckets].map((item) => item.workflowType))]
        .map((value) => ({
          value,
          label: WORKFLOW_REGISTRY[value as WorkflowType]?.label ?? value,
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [runs, buckets],
  );

  const visibleBuckets = useMemo(
    () =>
      selectedWorkflow
        ? bucketsInRange.filter(
            (bucket) => bucket.workflowType === selectedWorkflow.value,
          )
        : bucketsInRange,
    [bucketsInRange, selectedWorkflow],
  );

  const visibleRunIds = useMemo(
    () => [
      ...new Set([
        ...runs
          .filter(
            (run) =>
              !selectedWorkflow || run.workflowType === selectedWorkflow.value,
          )
          .map((run) => run.runId),
        ...buckets
          .filter(
            (bucket) =>
              !selectedWorkflow ||
              bucket.workflowType === selectedWorkflow.value,
          )
          .map((bucket) => bucket.workflowRunId),
      ]),
    ],
    [selectedWorkflow, runs, buckets],
  );

  const workflowSections = useMemo(
    () => buildWorkflowSections(visibleBuckets, userName),
    [visibleBuckets, userName],
  );

  const runRows = useMemo(() => {
    const completionsByRun = new Map<string, number>();
    bucketsInRange.forEach((bucket) => {
      completionsByRun.set(
        bucket.workflowRunId,
        (completionsByRun.get(bucket.workflowRunId) ?? 0) +
          (bucket.workflowType === 'info-tags'
            ? (bucket.metrics.annotationsProcessed ?? 0)
            : bucket.completedUnits),
      );
    });
    // Runs with no work in the range are hidden, except ones launched in it.
    const launchedInRange = (run: RunSummary) => {
      const launchDate = localDateString(new Date(run.launchedAt));
      return (
        !!launchDate &&
        (!startString || launchDate >= startString) &&
        (!endString || launchDate <= endString)
      );
    };
    return runs
      .filter(
        (run) =>
          !selectedWorkflow || run.workflowType === selectedWorkflow.value,
      )
      .filter((run) => completionsByRun.has(run.runId) || launchedInRange(run))
      .sort((left, right) => right.launchedAt.localeCompare(left.launchedAt))
      .map((run) => ({
        id: run.runId,
        rowData: [
          run.displayName || run.runId,
          WORKFLOW_REGISTRY[run.workflowType as WorkflowType]?.label ??
            run.workflowType,
          formatUtc(run.launchedAt),
          formatUtc(run.finishedAt),
          runStatusLabel(run),
          completionsByRun.get(run.runId) ?? 0,
        ],
      }));
  }, [runs, bucketsInRange, selectedWorkflow, startString, endString]);

  const exportBaseName =
    `${project?.label ?? 'survey'}_${startString ?? 'all'}_${
      endString ?? 'all'
    }`.replace(/[\s()]/g, '_');

  // Raw events name annotators; the backend enforces the same rule.
  const projectOrganizationId = projects.find(
    (candidate) => candidate.id === project?.value,
  )?.organizationId;
  const canExportTaskEvents =
    cognitoGroups.includes('sysadmin') ||
    !!myOrganizationHook.data?.some(
      (m) => m.organizationId === projectOrganizationId && m.isAdmin,
    ) ||
    !!myMembershipHook.data?.some(
      (m) => m.projectId === project?.value && m.isAdmin,
    );

  async function exportTaskEvents() {
    if (!project || visibleRunIds.length === 0) return;
    setExportProgress('Starting…');
    setError(null);
    try {
      const events = await fetchAllWorkflowEvents(
        client,
        {
          projectId: project.value,
          runIds: visibleRunIds,
          startAt: startDate ? localDayStart(startDate) : undefined,
          endAt: endDate ? localDayEnd(endDate) : undefined,
        },
        (count) => setExportProgress(`${count.toLocaleString()} events…`),
      );
      if (events.length === 0) {
        setError('No task events in the selected period.');
        return;
      }
      exportFromJSON({
        data: neutraliseCsvRows(
          events.map((event) => eventToCsvRow(event, userName, runName)),
        ),
        fileName: `${exportBaseName}_TaskEvents`,
        exportType: exportFromJSON.types.csv,
      });
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : 'Failed to export task events',
      );
    } finally {
      setExportProgress(null);
    }
  }

  const hasResults = workflowSections.length > 0;
  const needsSetChoice =
    project !== null && selectedSets.length === 0 && setOptions.length > 1;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '1555px',
        marginTop: '16px',
        marginBottom: '16px',
      }}
    >
      <Card>
        <PageHeader title='Workflow Statistics' />
        <CardContent>
          <div className='-mx-2 flex flex-wrap items-end gap-y-4'>
            <div className='w-full px-2 md:w-1/3'>
              <label htmlFor='workflow-survey' className='mb-1 inline-block'>
                Survey
              </label>
              <Combobox
                id='workflow-survey'
                value={project}
                options={projectOptions}
                onChange={selectProject}
                placeholder='Select a survey'
              />
            </div>
            <div className='w-full px-2 md:w-1/3'>
              <label htmlFor='workflow-sets' className='mb-1 inline-block'>
                Annotation sets
              </label>
              <Combobox
                id='workflow-sets'
                value={selectedSets}
                onChange={(options) => setSelectedSets(options)}
                multiple
                disabled={!project}
                options={setOptions}
                placeholder={
                  needsSetChoice
                    ? 'Choose one or more sets'
                    : 'Select a survey first'
                }
              />
            </div>
            <div className='w-full px-2 md:w-1/3'>
              <label className='mb-1 inline-block'>Date range</label>
              <div className='flex items-center gap-2'>
                <DateField
                  value={startDate}
                  onChange={(date) => {
                    setDateRangeIsAuto(false);
                    setStartDate(date);
                  }}
                  rangeStart={startDate}
                  rangeEnd={endDate}
                  placeholder='From'
                  className='min-w-0 flex-1'
                />
                <span>–</span>
                <DateField
                  value={endDate}
                  onChange={(date) => {
                    setDateRangeIsAuto(false);
                    setEndDate(date);
                  }}
                  rangeStart={startDate}
                  rangeEnd={endDate}
                  minDate={startDate}
                  placeholder='To'
                  className='min-w-0 flex-1'
                />
              </div>
            </div>
          </div>

          {error && (
            <Alert variant='danger' className='mt-4 mb-0'>
              {error}
            </Alert>
          )}
          {truncated && (
            <Alert variant='warning' className='mt-4 mb-0'>
              This survey returned more rows than the query limit, so the
              figures below are incomplete.
            </Alert>
          )}

          <hr className='my-6' />

          {loading ? (
            <div className='flex items-center justify-center py-12'>
              <Spinner animation='border' />
              <span className='ms-4'>Loading statistics…</span>
            </div>
          ) : !project ? (
            <p className='mb-0 text-muted-foreground'>
              Select a survey to see its statistics.
            </p>
          ) : needsSetChoice ? (
            <p className='mb-0 text-muted-foreground'>
              This survey has several annotation sets. Choose the ones to report
              on.
            </p>
          ) : (
            <>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div className='flex items-center gap-2'>
                  <h5 className='mb-0'>Results</h5>
                  <small className='ms-2 text-muted-foreground'>
                    Syncs in {secondsUntilSync} s
                  </small>
                  <Button
                    variant='link'
                    size='sm'
                    style={{
                      padding: 0,
                      color: 'var(--ss-text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onClick={refreshNow}
                    disabled={refreshCooldown}
                    title='Refresh now'
                    aria-label='Refresh now'
                  >
                    <RefreshCw size={14} />
                  </Button>
                </div>
                {workflowOptions.length > 0 && (
                  <div className='flex items-center gap-2'>
                    <label htmlFor='workflow-type' className='mb-0'>
                      Workflow:
                    </label>
                    <div style={{ minWidth: '320px' }}>
                      <Combobox
                        id='workflow-type'
                        value={selectedWorkflow}
                        options={workflowOptions}
                        onChange={(option) => setSelectedWorkflow(option)}
                        clearable
                        placeholder='All workflows'
                      />
                    </div>
                  </div>
                )}
              </div>

              {workflowSections.map((section) => (
                <div key={section.workflowType} className='mt-4'>
                  <h6 className='mb-2'>{section.label}</h6>
                  <div className='overflow-x-auto'>
                    <DataTable
                      columns={columnsFromHeadings(section.headings)}
                      data={section.rows.map((row) => ({
                        id: row.id,
                        cells: row.cells,
                      }))}
                      getRowId={(row) => row.id}
                      footer={section.footer ?? undefined}
                    />
                  </div>
                </div>
              ))}

              {hasLoaded && !hasResults && (
                <Alert variant='info' className='mt-4'>
                  No workflow completions recorded for this survey and period.
                  Work done on runs launched before the pipeline was deployed is
                  only visible on the Annotation Statistics screen.
                </Alert>
              )}

              {runRows.length > 0 && (
                <div className='mt-6'>
                  <h6 className='mb-2'>Runs</h6>
                  <div className='overflow-x-auto'>
                    <DataTable
                      columns={columnsFromHeadings([
                        {
                          content: 'Run',
                          description:
                            'The job name given when the workflow was launched.',
                        },
                        {
                          content: 'Workflow',
                          description: 'The type of work this run contains.',
                        },
                        {
                          content: 'Launched (UTC)',
                          description: 'When the run was launched.',
                        },
                        {
                          content: 'Finished (UTC)',
                          description:
                            'When the run ended: its queue drained or was cancelled, or its last ChainLinker transect was completed. Blank while active.',
                        },
                        {
                          content: 'Status',
                          description:
                            'Active until the work behind the run ends. Completed runs drained their queue; cancelled runs were stopped by a user or by cleanup after 60 idle days. Runs launched before status tracking existed were closed by a one-off backfill.',
                        },
                        {
                          content: 'Completions',
                          description:
                            'Units completed in this run within the selected period, across all users.',
                        },
                      ])}
                      data={cellRows(runRows)}
                      getRowId={(row) => row.id}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
        {hasLoaded && !loading && (
          <CardFooter className='flex justify-end gap-2'>
            <Button
              variant='primary'
              onClick={() => setShowSnapshot(true)}
              disabled={visibleRunIds.length === 0 || !startDate || !endDate}
            >
              <CameraIcon className='size-4' />
              Snapshot
            </Button>
            {canExportTaskEvents && (
              <Button
                variant='outline-primary'
                onClick={exportTaskEvents}
                disabled={visibleRunIds.length === 0 || exportProgress !== null}
              >
                <DownloadIcon className='size-4' />
                {exportProgress
                  ? `Exporting… ${exportProgress}`
                  : 'Export task events'}
              </Button>
            )}
          </CardFooter>
        )}
      </Card>
      {project && (
        <WorkflowSnapshotModal
          show={showSnapshot}
          onHide={() => setShowSnapshot(false)}
          client={client}
          projectId={project.value}
          projectLabel={project.label}
          runs={visibleRunIds.map((runId) => ({
            runId,
            displayName: runName(runId),
          }))}
          startDate={startDate}
          endDate={endDate}
          userName={userName}
        />
      )}
    </div>
  );
}

function DateField({
  id,
  value,
  onChange,
  placeholder,
  rangeStart,
  rangeEnd,
  minDate,
  className,
}: {
  id?: string;
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder: string;
  rangeStart: Date | null;
  rangeEnd: Date | null;
  minDate?: Date | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('relative', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type='button'
            className={cn(
              fieldBase,
              fieldSizes.default,
              'text-left',
              value ? 'pr-8' : 'text-[#6c757d]',
            )}
          >
            {value ? format(value, 'yyyy/MM/dd') : placeholder}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className='w-auto border-black/10 bg-white p-0 text-[#212529]'
          style={LIGHT_THEME}
          align='start'
        >
          <Calendar
            mode='single'
            selected={value ?? undefined}
            defaultMonth={value ?? undefined}
            disabled={minDate ? { before: minDate } : undefined}
            modifiers={
              rangeStart && rangeEnd
                ? { inRange: { from: rangeStart, to: rangeEnd } }
                : undefined
            }
            modifiersClassNames={{ inRange: 'bg-accent' }}
            onSelect={(date) => {
              if (date) {
                // keep the previous time of day when changing the date
                if (value)
                  date.setHours(
                    value.getHours(),
                    value.getMinutes(),
                    value.getSeconds(),
                  );
                onChange(date);
              }
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {value && (
        <button
          type='button'
          aria-label='Clear'
          className='absolute top-1/2 right-2 -translate-y-1/2 text-[#6c757d] opacity-75 hover:opacity-100'
          onClick={() => onChange(null)}
        >
          <XIcon className='size-4' />
        </button>
      )}
    </div>
  );
}
