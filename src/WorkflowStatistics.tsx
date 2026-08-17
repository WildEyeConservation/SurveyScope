import { useContext, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Spinner } from 'react-bootstrap';
import Select from 'react-select';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import exportFromJSON from 'export-from-json';
import MyTable from './Table';
import { GlobalContext, UserContext } from './Context';
import { useUsers } from './apiInterface';
import { fetchAllPaginatedResults } from './utils';
import {
  WORKFLOW_METRIC_DEFINITIONS,
  WORKFLOW_REGISTRY,
  isWorkflowType,
  type WorkflowMetricKey,
  type WorkflowType,
} from './workflowRegistry';

/**
 * Reports the workflow-neutral statistics pipeline: completions, timing and
 * per-workflow metrics for every instrumented workflow, read from the durable
 * Workflow Run / Daily Stats tables rather than from Observations.
 *
 * Sysadmin-only for now. The pipeline currently records Species Labelling and
 * False Negatives; the other workflows appear here automatically once their
 * adapters land, because the columns come from the shared workflow registry.
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

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(
    seconds
  ).padStart(2, '0')}`;
}

function localDateString(date: Date | null): string | undefined {
  if (!date) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(date.getDate()).padStart(2, '0')}`;
}

function metricLabel(key: string): string {
  return (
    WORKFLOW_METRIC_DEFINITIONS[key as WorkflowMetricKey]?.label ?? key
  );
}

function isDurationMetric(key: string): boolean {
  return (
    WORKFLOW_METRIC_DEFINITIONS[key as WorkflowMetricKey]?.unit ===
    'milliseconds'
  );
}

function formatMetric(key: string, value: number): string {
  return isDurationMetric(key) ? formatDuration(value) : String(value);
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
  const [startDate, setStartDate] = useState<Date | null>(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date;
  });
  const [endDate, setEndDate] = useState<Date | null>(new Date());
  const [selectedRun, setSelectedRun] = useState<SelectOption | null>(null);

  const [buckets, setBuckets] = useState<StatsBucket[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasQueried, setHasQueried] = useState(false);

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

  async function loadStats() {
    if (!project || selectedSets.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const statsQuery = resolveStatsQuery(client);
      if (!statsQuery) {
        setError(
          'The workflow statistics query is not available in this environment yet. It ships with the backend deploy that adds it.'
        );
        return;
      }
      const { data, errors } = await statsQuery({
        projectId: project.value,
        annotationSetIds: selectedSets.map((set) => set.value),
        startDate: localDateString(startDate),
        endDate: localDateString(endDate),
      });
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
      setHasQueried(true);
      setSelectedRun(null);
    } catch (queryError) {
      setError(
        queryError instanceof Error
          ? queryError.message
          : 'Failed to load workflow statistics'
      );
    } finally {
      setLoading(false);
    }
  }

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

  const visibleBuckets = useMemo(
    () =>
      selectedRun
        ? buckets.filter(
            (bucket) => bucket.workflowRunId === selectedRun.value
          )
        : buckets,
    [buckets, selectedRun]
  );

  // Group by workflow, then by user. The metric columns per workflow come from
  // the registry, so an instrumented workflow needs no change here.
  const workflowSections = useMemo(() => {
    const byWorkflow = new Map<string, StatsBucket[]>();
    visibleBuckets.forEach((bucket) => {
      const list = byWorkflow.get(bucket.workflowType) ?? [];
      list.push(bucket);
      byWorkflow.set(bucket.workflowType, list);
    });

    return [...byWorkflow.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([workflowType, workflowBuckets]) => {
        const definition = isWorkflowType(workflowType)
          ? WORKFLOW_REGISTRY[workflowType]
          : undefined;
        const metricKeys = definition
          ? definition.metricKeys.filter((key) =>
              workflowBuckets.some((bucket) => bucket.metrics[key] !== undefined)
            )
          : [
              ...new Set(
                workflowBuckets.flatMap((bucket) => Object.keys(bucket.metrics))
              ),
            ].sort();

        const byUser = new Map<
          string,
          {
            completedUnits: number;
            skippedUnits: number;
            activeTimeMs: number;
            waitingTimeMs: number;
            metrics: Record<string, number>;
          }
        >();
        workflowBuckets.forEach((bucket) => {
          const totals =
            byUser.get(bucket.userId) ??
            {
              completedUnits: 0,
              skippedUnits: 0,
              activeTimeMs: 0,
              waitingTimeMs: 0,
              metrics: {} as Record<string, number>,
            };
          totals.completedUnits += bucket.completedUnits;
          totals.skippedUnits += bucket.skippedUnits;
          totals.activeTimeMs += bucket.activeTimeMs;
          totals.waitingTimeMs += bucket.waitingTimeMs;
          Object.entries(bucket.metrics).forEach(([key, value]) => {
            totals.metrics[key] = (totals.metrics[key] ?? 0) + value;
          });
          byUser.set(bucket.userId, totals);
        });

        const unitPlural = definition?.unit.plural ?? 'units';
        const rows = [...byUser.entries()]
          .sort(
            ([, left], [, right]) => right.completedUnits - left.completedUnits
          )
          .map(([userId, totals]) => ({
            id: `${workflowType}:${userId}`,
            rowData: [
              allUsers.find((candidate) => candidate.id === userId)?.name ??
                userId,
              totals.completedUnits,
              totals.skippedUnits,
              formatDuration(totals.activeTimeMs),
              totals.completedUnits > 0
                ? (totals.activeTimeMs / 1000 / totals.completedUnits).toFixed(
                    1
                  )
                : '0.0',
              formatDuration(totals.waitingTimeMs),
              ...metricKeys.map((key) =>
                formatMetric(key, totals.metrics[key] ?? 0)
              ),
            ],
          }));

        const totalsRow = workflowBuckets.reduce(
          (accumulator, bucket) => {
            accumulator.completedUnits += bucket.completedUnits;
            accumulator.skippedUnits += bucket.skippedUnits;
            accumulator.activeTimeMs += bucket.activeTimeMs;
            accumulator.waitingTimeMs += bucket.waitingTimeMs;
            metricKeys.forEach((key) => {
              accumulator.metrics[key] =
                (accumulator.metrics[key] ?? 0) + (bucket.metrics[key] ?? 0);
            });
            return accumulator;
          },
          {
            completedUnits: 0,
            skippedUnits: 0,
            activeTimeMs: 0,
            waitingTimeMs: 0,
            metrics: {} as Record<string, number>,
          }
        );

        return {
          workflowType,
          label: definition?.label ?? workflowType,
          unitPlural,
          headings: [
            { content: 'Username' },
            { content: `${unitPlural} completed`, sort: true },
            { content: 'Skipped' },
            { content: 'Time spent' },
            { content: `Average (s/${definition?.unit.singular ?? 'unit'})` },
            { content: 'Waiting time' },
            ...metricKeys.map((key) => ({ content: metricLabel(key) })),
          ],
          rows,
          footer: [
            'All users',
            totalsRow.completedUnits,
            totalsRow.skippedUnits,
            formatDuration(totalsRow.activeTimeMs),
            totalsRow.completedUnits > 0
              ? (
                  totalsRow.activeTimeMs /
                  1000 /
                  totalsRow.completedUnits
                ).toFixed(1)
              : '0.0',
            formatDuration(totalsRow.waitingTimeMs),
            ...metricKeys.map((key) =>
              formatMetric(key, totalsRow.metrics[key] ?? 0)
            ),
          ],
        };
      });
  }, [visibleBuckets, allUsers]);

  const runRows = useMemo(() => {
    const completionsByRun = new Map<string, number>();
    buckets.forEach((bucket) => {
      completionsByRun.set(
        bucket.workflowRunId,
        (completionsByRun.get(bucket.workflowRunId) ?? 0) +
          bucket.completedUnits
      );
    });
    return runs
      .slice()
      .sort((left, right) => right.launchedAt.localeCompare(left.launchedAt))
      .map((run) => ({
        id: run.runId,
        rowData: [
          run.displayName || run.runId,
          WORKFLOW_REGISTRY[run.workflowType as WorkflowType]?.label ??
            run.workflowType,
          run.launchedAt ? run.launchedAt.replace('T', ' ').slice(0, 19) : '',
          run.status,
          completionsByRun.get(run.runId) ?? 0,
        ],
      }));
  }, [runs, buckets]);

  function handleExport() {
    if (visibleBuckets.length === 0) return;
    const rows = visibleBuckets.map((bucket) => ({
      workflow:
        WORKFLOW_REGISTRY[bucket.workflowType as WorkflowType]?.label ??
        bucket.workflowType,
      workflowType: bucket.workflowType,
      date: bucket.date,
      user:
        allUsers.find((candidate) => candidate.id === bucket.userId)?.name ??
        bucket.userId,
      userId: bucket.userId,
      annotationSetId: bucket.annotationSetId,
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
      fileName: `workflow-statistics-${project?.value ?? 'survey'}`,
      exportType: exportFromJSON.types.csv,
    });
  }

  if (!isSysadmin) {
    return (
      <div className='p-4 text-light'>
        Workflow statistics are restricted to sysadmins.
      </div>
    );
  }

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
          <p className='text-muted'>
            Throughput per workflow from the workflow statistics pipeline.
            Species Labelling and False Negatives are instrumented; other
            workflows appear here once their adapters are added.
          </p>

          <div className='d-flex justify-content-between align-items-center flex-wrap gap-2'>
            <div className='d-flex align-items-center gap-2'>
              <label htmlFor='workflow-start-date' className='mb-0'>
                From:
              </label>
              <DatePicker
                id='workflow-start-date'
                selected={startDate ?? undefined}
                onChange={(date) => setStartDate(date)}
                selectsStart
                startDate={startDate ?? undefined}
                endDate={endDate ?? undefined}
                className='form-control'
                isClearable
                dateFormat='yyyy/MM/dd'
                placeholderText='No start date'
              />
            </div>
            <div className='d-flex align-items-center gap-2'>
              <label htmlFor='workflow-end-date' className='mb-0'>
                To:
              </label>
              <DatePicker
                id='workflow-end-date'
                selected={endDate ?? undefined}
                onChange={(date) => setEndDate(date)}
                selectsEnd
                startDate={startDate ?? undefined}
                endDate={endDate ?? undefined}
                className='form-control'
                isClearable
                dateFormat='yyyy/MM/dd'
                placeholderText='No end date'
              />
            </div>
          </div>

          <div className='mt-3'>
            <label className='mb-2'>Select Survey</label>
            <Select
              className='text-black'
              value={project}
              options={projectOptions}
              onChange={(option) => {
                setProject(option);
                const sets =
                  projects
                    .find((candidate) => candidate.id === option?.value)
                    ?.annotationSets?.map((set) => ({
                      label: set.name,
                      value: set.id,
                    })) ?? [];
                setSelectedSets(sets);
                setBuckets([]);
                setRuns([]);
                setHasQueried(false);
              }}
            />
          </div>

          <div className='mt-3'>
            <label className='mb-2'>Select Annotation Sets</label>
            <Select
              className='text-black basic-multi-select'
              value={selectedSets}
              onChange={(options) => setSelectedSets([...options])}
              isMulti
              name='Annotation sets'
              options={setOptions}
              classNamePrefix='select'
              closeMenuOnSelect={false}
            />
          </div>

          <div className='mt-3 d-flex align-items-end gap-2 flex-wrap'>
            <Button
              variant='primary'
              onClick={loadStats}
              disabled={loading || !project || selectedSets.length === 0}
            >
              {loading ? 'Loading…' : 'Load statistics'}
            </Button>
            <Button
              variant='outline-light'
              onClick={handleExport}
              disabled={visibleBuckets.length === 0}
            >
              Export CSV
            </Button>
          </div>

          {error && (
            <Alert variant='danger' className='mt-3'>
              {error}
            </Alert>
          )}
          {truncated && (
            <Alert variant='warning' className='mt-3'>
              This survey returned more rows than the query limit, so the
              figures below are incomplete. Narrow the date range.
            </Alert>
          )}

          {runOptions.length > 0 && (
            <div className='mt-3'>
              <label className='mb-2'>Filter by run (optional)</label>
              <Select
                className='text-black'
                value={selectedRun}
                options={runOptions}
                onChange={(option) => setSelectedRun(option)}
                isClearable
                placeholder='All runs'
              />
            </div>
          )}

          {loading ? (
            <div className='d-flex justify-content-center align-items-center py-5'>
              <Spinner animation='border' role='status'>
                <span className='visually-hidden'>Loading statistics…</span>
              </Spinner>
              <span className='ms-3'>Loading statistics…</span>
            </div>
          ) : (
            <>
              {workflowSections.map((section) => (
                <div key={section.workflowType} className='mt-4'>
                  <h5 className='mb-2'>{section.label}</h5>
                  <div className='overflow-x-auto'>
                    <MyTable
                      tableHeadings={section.headings}
                      tableData={[
                        ...section.rows,
                        {
                          id: `${section.workflowType}:__total`,
                          rowData: section.footer.map((cell, index) => (
                            <strong key={index}>{cell}</strong>
                          )),
                        },
                      ]}
                      emptyMessage='No completions in this period.'
                    />
                  </div>
                </div>
              ))}

              {hasQueried && workflowSections.length === 0 && (
                <Alert variant='info' className='mt-3'>
                  No workflow completions recorded for this survey and period.
                  Work done on runs launched before the pipeline was deployed is
                  only visible on the Annotation Statistics screen.
                </Alert>
              )}

              {runRows.length > 0 && (
                <div className='mt-4'>
                  <h5 className='mb-2'>Runs</h5>
                  <div className='overflow-x-auto'>
                    <MyTable
                      tableHeadings={[
                        { content: 'Run' },
                        { content: 'Workflow' },
                        { content: 'Launched (UTC)' },
                        { content: 'Status' },
                        { content: 'Completions' },
                      ]}
                      tableData={runRows}
                      emptyMessage='No runs recorded for this survey.'
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
