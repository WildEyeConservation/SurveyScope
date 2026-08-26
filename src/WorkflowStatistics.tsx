import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Button, Card, Col, Row, Spinner } from 'react-bootstrap';
import Select from 'react-select';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import exportFromJSON from 'export-from-json';
import MyTable from './Table';
import { GlobalContext, UserContext } from './Context';
import { useUsers } from './apiInterface';
import { fetchAllPaginatedResults } from './utils';
import { WORKFLOW_REGISTRY, type WorkflowType } from './workflowRegistry';
import WorkflowSnapshotModal from './WorkflowSnapshotModal';
import {
  eventToCsvRow,
  fetchAllWorkflowEvents,
} from './workflowEvents';
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
 * Sysadmin-only for now. The columns come from the shared workflow registry,
 * so newly instrumented workflows appear here without changes.
 *
 * Layout: inputs (survey, annotation sets, date range) in a filter bar;
 * results below it, with the run filter beside them because it narrows what
 * is shown rather than what is fetched; exports in the card footer.
 */

interface StatsBucket {
  workflowType: string;
  annotationSetId: string;
  date: string;
  userId: string;
  workflowRunId: string;
  completedUnits: number;
  skippedUnits: number;
  activeTimeMs: number;
  waitingTimeMs: number;
  metrics: Record<string, number>;
}

interface RunSummary {
  runId: string;
  workflowType: string;
  annotationSetId: string;
  displayName: string;
  status: string;
  launchedAt: string;
  finishedAt?: string | null;
  finishReason?: string | null;
}

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
    ? FINISH_REASON_LABELS[run.finishReason] ?? run.finishReason
    : undefined;
  return reason ? `${run.status} (${reason})` : run.status;
}

interface QueryResult {
  buckets?: StatsBucket[];
  runs?: RunSummary[];
  truncated?: boolean;
}

interface QueryWorkflowStatsInput {
  projectId: string;
  annotationSetIds: string[];
  startDate?: string;
  endDate?: string;
}

// The generated client types are derived from the deployed amplify_outputs, so
// this query only appears on `client.queries` once the backend that defines it
// is deployed. Non-master branches also reuse master's outputs. Resolving it
// through a narrow local type keeps the build green in both cases and lets the
// screen explain itself if the backend is not deployed yet.
function resolveStatsQuery(client: unknown) {
  const queries = (client as { queries?: Record<string, unknown> }).queries;
  const query = queries?.queryWorkflowStats;
  return typeof query === 'function'
    ? (query as (
        input: QueryWorkflowStatsInput
      ) => Promise<{ data?: unknown; errors?: { message?: string }[] }>)
    : undefined;
}

interface ProjectOption {
  id: string;
  name: string;
  organizationId: string;
  annotationSets?: { id: string; name: string }[];
}

type SelectOption = { label: string; value: string };

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export default function WorkflowStatistics() {
  const { client } = useContext(GlobalContext)!;
  const { cognitoGroups } = useContext(UserContext)!;
  const { users: allUsers } = useUsers();
  const isSysadmin = cognitoGroups.includes('sysadmin');

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
  const [selectedRun, setSelectedRun] = useState<SelectOption | null>(null);

  const [buckets, setBuckets] = useState<StatsBucket[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [showSnapshot, setShowSnapshot] = useState(false);
  // Selections can change faster than queries return; only the latest wins.
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!isSysadmin) return;
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
            { selectionSet: ['id', 'name'], limit: 10000 }
          ),
        ]);
        if (cancelled) return;
        setProjects(
          [...allProjects].sort((left, right) =>
            (left.name ?? '').localeCompare(right.name ?? '')
          )
        );
        setOrganizationNames(
          Object.fromEntries(
            allOrganizations.map((organization) => [
              organization.id,
              organization.name,
            ])
          )
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load surveys'
          );
        }
      }
    }

    loadProjects();
    return () => {
      cancelled = true;
    };
  }, [client, isSysadmin]);

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
    [projects, organizationNames]
  );

  const setOptions = useMemo(() => {
    const selected = projects.find(
      (candidate) => candidate.id === project?.value
    );
    return (selected?.annotationSets ?? []).map((set) => ({
      label: set.name,
      value: set.id,
    }));
  }, [projects, project?.value]);

  const userName = useCallback(
    (userId: string) =>
      allUsers.find((candidate) => candidate.id === userId)?.name ?? userId,
    [allUsers]
  );

  // Buckets are small (one per user, day and run), so the whole history for
  // the selected sets is fetched once and the date range is applied here.
  // Changing dates is then instant and needs no round trip.
  useEffect(() => {
    if (!project || selectedSets.length === 0) {
      setBuckets([]);
      setRuns([]);
      setHasLoaded(false);
      return;
    }
    const sequence = ++requestSequence.current;
    const projectId = project.value;
    const annotationSetIds = selectedSets.map((set) => set.value);

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const statsQuery = resolveStatsQuery(client);
        if (!statsQuery) {
          throw new Error(
            'The workflow statistics query is not available in this environment yet. It ships with the backend deploy that adds it.'
          );
        }
        const { data, errors } = await statsQuery({
          projectId,
          annotationSetIds,
        });
        if (sequence !== requestSequence.current) return;
        if (errors?.length) {
          throw new Error(
            errors.map((entry) => entry.message ?? 'Unknown error').join('; ')
          );
        }
        const parsed = (
          typeof data === 'string' ? JSON.parse(data) : data ?? {}
        ) as QueryResult;
        setBuckets(parsed.buckets ?? []);
        setRuns(parsed.runs ?? []);
        setTruncated(parsed.truncated === true);
        setHasLoaded(true);
        setSelectedRun(null);
      } catch (queryError) {
        if (sequence !== requestSequence.current) return;
        setError(
          queryError instanceof Error
            ? queryError.message
            : 'Failed to load workflow statistics'
        );
        setBuckets([]);
        setRuns([]);
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    }
    load();
  }, [client, project, selectedSets]);

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
      Number.isFinite(earliest) ? startOfLocalDay(new Date(earliest)) : null
    );
    setEndDate(startOfLocalDay(new Date()));
  }, [dateRangeIsAuto, hasLoaded, runs, buckets]);

  function selectProject(option: SelectOption | null) {
    setProject(option);
    setSelectedRun(null);
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
          (!endString || bucket.date <= endString)
      ),
    [buckets, startString, endString]
  );

  const runOptions = useMemo(() => {
    const named = new Map<string, string>();
    runs.forEach((run) => {
      const label = WORKFLOW_REGISTRY[run.workflowType as WorkflowType]?.label;
      named.set(
        run.runId,
        `${run.displayName || run.runId}${label ? ` — ${label}` : ''}${
          run.launchedAt ? ` (${run.launchedAt.slice(0, 10)})` : ''
        }`
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
    [runOptions]
  );

  const visibleBuckets = useMemo(
    () =>
      selectedRun
        ? bucketsInRange.filter(
            (bucket) => bucket.workflowRunId === selectedRun.value
          )
        : bucketsInRange,
    [bucketsInRange, selectedRun]
  );

  const visibleRunIds = useMemo(
    () =>
      selectedRun
        ? [selectedRun.value]
        : runOptions.map((option) => option.value),
    [selectedRun, runOptions]
  );

  const workflowSections = useMemo(
    () => buildWorkflowSections(visibleBuckets, userName),
    [visibleBuckets, userName]
  );

  const runRows = useMemo(() => {
    const completionsByRun = new Map<string, number>();
    bucketsInRange.forEach((bucket) => {
      completionsByRun.set(
        bucket.workflowRunId,
        (completionsByRun.get(bucket.workflowRunId) ?? 0) +
          bucket.completedUnits
      );
    });
    return runs
      .filter((run) => !selectedRun || run.runId === selectedRun.value)
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
  }, [runs, bucketsInRange, selectedRun]);

  const exportBaseName = `${project?.label ?? 'survey'}_${startString ?? 'all'}_${
    endString ?? 'all'
  }`.replace(/[\s()]/g, '_');

  function exportDailyStats() {
    if (visibleBuckets.length === 0) return;
    const rows = visibleBuckets.map((bucket) => ({
      workflow:
        WORKFLOW_REGISTRY[bucket.workflowType as WorkflowType]?.label ??
        bucket.workflowType,
      workflowType: bucket.workflowType,
      date: bucket.date,
      user: userName(bucket.userId),
      userId: bucket.userId,
      annotationSetId: bucket.annotationSetId,
      run: runName(bucket.workflowRunId),
      workflowRunId: bucket.workflowRunId,
      completedUnits: bucket.completedUnits,
      skippedUnits: bucket.skippedUnits,
      activeTimeMs: bucket.activeTimeMs,
      waitingTimeMs: bucket.waitingTimeMs,
      ...Object.fromEntries(
        Object.entries(bucket.metrics).map(([key, value]) => [
          `metric_${key}`,
          value,
        ])
      ),
    }));
    exportFromJSON({
      data: rows,
      fileName: `${exportBaseName}_DailyStats`,
      exportType: exportFromJSON.types.csv,
    });
  }

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
        (count) => setExportProgress(`${count.toLocaleString()} events…`)
      );
      if (events.length === 0) {
        setError('No task events in the selected period.');
        return;
      }
      exportFromJSON({
        data: events.map((event) => eventToCsvRow(event, userName, runName)),
        fileName: `${exportBaseName}_TaskEvents`,
        exportType: exportFromJSON.types.csv,
      });
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : 'Failed to export task events'
      );
    } finally {
      setExportProgress(null);
    }
  }

  if (!isSysadmin) {
    return (
      <div className='p-4 text-light'>
        Workflow statistics are restricted to sysadmins.
      </div>
    );
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
        <Card.Header>
          <Card.Title className='mb-0'>
            <h4 className='mb-0'>Workflow Statistics</h4>
          </Card.Title>
        </Card.Header>
        <Card.Body>
          <Row className='g-3 align-items-end'>
            <Col md={4}>
              <label htmlFor='workflow-survey' className='form-label mb-1'>
                Survey
              </label>
              <Select
                inputId='workflow-survey'
                className='text-black'
                value={project}
                options={projectOptions}
                onChange={selectProject}
                placeholder='Select a survey'
              />
            </Col>
            <Col md={4}>
              <label htmlFor='workflow-sets' className='form-label mb-1'>
                Annotation sets
              </label>
              <Select
                inputId='workflow-sets'
                className='text-black basic-multi-select'
                value={selectedSets}
                onChange={(options) => setSelectedSets([...options])}
                isMulti
                isDisabled={!project}
                options={setOptions}
                classNamePrefix='select'
                closeMenuOnSelect={false}
                placeholder={
                  needsSetChoice
                    ? 'Choose one or more sets'
                    : 'Select a survey first'
                }
              />
            </Col>
            <Col md={4}>
              <label className='form-label mb-1'>Date range</label>
              <div className='d-flex align-items-center gap-2'>
                <DatePicker
                  selected={startDate ?? undefined}
                  onChange={(date) => {
                    setDateRangeIsAuto(false);
                    setStartDate(date);
                  }}
                  selectsStart
                  startDate={startDate ?? undefined}
                  endDate={endDate ?? undefined}
                  className='form-control'
                  isClearable
                  dateFormat='yyyy/MM/dd'
                  placeholderText='From'
                />
                <span>–</span>
                <DatePicker
                  selected={endDate ?? undefined}
                  onChange={(date) => {
                    setDateRangeIsAuto(false);
                    setEndDate(date);
                  }}
                  selectsEnd
                  startDate={startDate ?? undefined}
                  endDate={endDate ?? undefined}
                  minDate={startDate ?? undefined}
                  className='form-control'
                  isClearable
                  dateFormat='yyyy/MM/dd'
                  placeholderText='To'
                />
              </div>
            </Col>
          </Row>

          {error && (
            <Alert variant='danger' className='mt-3 mb-0'>
              {error}
            </Alert>
          )}
          {truncated && (
            <Alert variant='warning' className='mt-3 mb-0'>
              This survey returned more rows than the query limit, so the
              figures below are incomplete.
            </Alert>
          )}

          <hr className='my-4' />

          {loading ? (
            <div className='d-flex justify-content-center align-items-center py-5'>
              <Spinner animation='border' role='status'>
                <span className='visually-hidden'>Loading statistics…</span>
              </Spinner>
              <span className='ms-3'>Loading statistics…</span>
            </div>
          ) : !project ? (
            <p className='text-muted mb-0'>Select a survey to see its statistics.</p>
          ) : needsSetChoice ? (
            <p className='text-muted mb-0'>
              This survey has several annotation sets. Choose the ones to report on.
            </p>
          ) : (
            <>
              <div className='d-flex justify-content-between align-items-center flex-wrap gap-2'>
                <h5 className='mb-0'>Results</h5>
                {runOptions.length > 1 && (
                  <div className='d-flex align-items-center gap-2'>
                    <label htmlFor='workflow-run' className='mb-0'>
                      Run:
                    </label>
                    <div style={{ minWidth: '320px' }}>
                      <Select
                        inputId='workflow-run'
                        className='text-black'
                        value={selectedRun}
                        options={runOptions}
                        onChange={(option) => setSelectedRun(option)}
                        isClearable
                        placeholder='All runs'
                      />
                    </div>
                  </div>
                )}
              </div>

              {workflowSections.map((section) => (
                <div key={section.workflowType} className='mt-3'>
                  <h6 className='mb-2'>{section.label}</h6>
                  <div className='overflow-x-auto'>
                    <MyTable
                      tableHeadings={section.headings}
                      tableData={[
                        ...section.rows.map((row) => ({
                          id: row.id,
                          rowData: row.cells,
                        })),
                        {
                          id: `${section.workflowType}:__total`,
                          rowData: section.footer.map((cell, index) => (
                            <strong key={index}>{cell}</strong>
                          )),
                        },
                      ]}
                    />
                  </div>
                </div>
              ))}

              {hasLoaded && !hasResults && (
                <Alert variant='info' className='mt-3'>
                  No workflow completions recorded for this survey and period.
                  Work done on runs launched before the pipeline was deployed is
                  only visible on the Annotation Statistics screen.
                </Alert>
              )}

              {runRows.length > 0 && (
                <div className='mt-4'>
                  <h6 className='mb-2'>Runs</h6>
                  <div className='overflow-x-auto'>
                    <MyTable
                      tableHeadings={[
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
                      ]}
                      tableData={runRows}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </Card.Body>
        {hasLoaded && !loading && (
          <Card.Footer className='d-flex justify-content-center gap-2'>
            <Button
              variant='primary'
              style={{ flex: 1 }}
              onClick={() => setShowSnapshot(true)}
              disabled={visibleRunIds.length === 0 || !startDate || !endDate}
            >
              Snapshot
            </Button>
            <Button
              variant='primary'
              style={{ flex: 1 }}
              onClick={exportDailyStats}
              disabled={visibleBuckets.length === 0}
            >
              Export daily stats
            </Button>
            <Button
              variant='primary'
              style={{ flex: 1 }}
              onClick={exportTaskEvents}
              disabled={visibleRunIds.length === 0 || exportProgress !== null}
            >
              {exportProgress
                ? `Exporting… ${exportProgress}`
                : 'Export task events'}
            </Button>
          </Card.Footer>
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
