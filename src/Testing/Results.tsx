import DataTable, { type DataColumn } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import exportFromJSON from 'export-from-json';
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useContext, useMemo, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  XAxis,
  YAxis,
  type LabelProps,
} from 'recharts';
import { neutraliseCsvRows } from '../../shared/csv';
import { useUsers } from '../apiInterface';
import { GlobalContext, TestingContext } from '../Context';
import { fetchAllPaginatedResults } from '../utils';
import {
  resolveStatsQuery,
  type StatsQueryResult,
} from '../workflowStatsQuery';

type Range = '7' | '30' | 'all' | 'custom';
type Option = { label: string; value: string };

type TestResult = {
  id: string;
  userId: string;
  createdAt: string;
  testAnimals: number;
  totalMissedAnimals: number;
  locationId: string;
  annotationSetId: string;
  testPreset: { name: string; ownerProjectId?: string | null };
  categoryCounts: {
    categoryName: string;
    userCount: number;
    testCount: number;
  }[];
};

// The statistics backend accepts at most 50 annotation sets per call.
const STATS_BATCH = 50;

type TesterRow = {
  userId: string;
  name: string;
  locations: number;
  tests: number;
  passed: number;
  passRate: number;
};

const RANGES: { value: Range; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

const dailyChart = {
  passed: { label: 'Passed', color: '#5cb85c' },
  failed: { label: 'Failed', color: '#d9534f' },
} satisfies ChartConfig;
const accuracyChart = {
  difference: { label: 'Over/under count' },
} satisfies ChartConfig;

const dayString = (date: Date) => date.toLocaleDateString('en-CA');
const percent = (value: number) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';

export default function Results() {
  const { client } = useContext(GlobalContext)!;
  const { organizationProjects, organizationMembershipsHook } =
    useContext(TestingContext)!;
  const { users } = useUsers();
  const [survey, setSurvey] = useState<Option | null>(null);
  const [range, setRange] = useState<Range>('30');
  const [copied, setCopied] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [accuracy, setAccuracy] = useState(90);
  const [ignoreOvercounts, setIgnoreOvercounts] = useState(true);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);

  const userName = (id: string) =>
    users.find((user) => user.id === id)?.name || 'Unknown user';
  const memberIds = (organizationMembershipsHook.data ?? []).map(
    (m) => m.userId,
  );

  const [start, end] = useMemo(() => {
    if (range === 'all') return [undefined, undefined];
    if (range === 'custom') return [from || undefined, to || undefined];
    const since = new Date();
    since.setDate(since.getDate() - Number(range) + 1);
    return [dayString(since), undefined];
  }, [range, from, to]);

  const resultsQuery = useQuery({
    queryKey: ['testing-results', survey?.value, memberIds.join(',')],
    enabled: !!survey && memberIds.length > 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    // Too large for localStorage, and it must be fresh.
    meta: { persist: false },
    queryFn: async () => {
      const perUser = await Promise.all(
        memberIds.map((userId) =>
          fetchAllPaginatedResults(
            client.models.TestResult.testResultsByUserId,
            {
              userId,
              filter: { projectId: { eq: survey!.value } },
              limit: 1000,
              selectionSet: [
                'id',
                'userId',
                'createdAt',
                'testAnimals',
                'totalMissedAnimals',
                'locationId',
                'annotationSetId',
                'testPreset.name',
                'testPreset.ownerProjectId',
                'categoryCounts.categoryName',
                'categoryCounts.userCount',
                'categoryCounts.testCount',
              ],
            },
          ),
        ),
      );
      return perUser.flat() as unknown as TestResult[];
    },
  });

  const statsQuery = useQuery({
    queryKey: ['testing-results-locations', survey?.value],
    enabled: !!survey,
    staleTime: 0,
    refetchOnWindowFocus: false,
    // Too large for localStorage, and it must be fresh.
    meta: { persist: false },
    queryFn: async () => {
      const query = resolveStatsQuery(client);
      if (!query) return { buckets: [], truncated: false };
      const sets = await fetchAllPaginatedResults(
        client.models.AnnotationSet.annotationSetsByProjectId,
        { projectId: survey!.value, selectionSet: ['id'] as const },
      );
      const batches: string[][] = [];
      for (let i = 0; i < sets.length; i += STATS_BATCH)
        batches.push(sets.slice(i, i + STATS_BATCH).map((set) => set.id));
      const responses = await Promise.all(
        batches.map(async (annotationSetIds) => {
          const { data, errors } = await query({
            projectId: survey!.value,
            annotationSetIds,
          });
          if (errors?.length)
            throw new Error(errors.map((e) => e.message).join('; '));
          return (
            typeof data === 'string' ? JSON.parse(data) : (data ?? {})
          ) as StatsQueryResult;
        }),
      );
      return {
        buckets: responses
          .flatMap((parsed) => parsed.buckets ?? [])
          .filter((bucket) => bucket.workflowType === 'species-labelling')
          .map(({ userId, date, completedUnits }) => ({
            userId,
            date,
            completedUnits,
          })),
        truncated: responses.some((parsed) => parsed.truncated === true),
      };
    },
  });

  const passed = (result: TestResult) => {
    const total = result.testAnimals;
    let counted = total - result.totalMissedAnimals;
    if (ignoreOvercounts && counted > total) counted = total;
    const band = accuracy / 100;
    return counted >= total * band && counted <= total * (2 - band);
  };

  const inRange = (day: string) =>
    (!start || day >= start) && (!end || day <= end);
  const results = (resultsQuery.data ?? [])
    .filter((r) => inRange(dayString(new Date(r.createdAt))))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const locationsByUser = new Map<string, number>();
  for (const bucket of statsQuery.data?.buckets ?? []) {
    if (!inRange(bucket.date)) continue;
    locationsByUser.set(
      bucket.userId,
      (locationsByUser.get(bucket.userId) ?? 0) + bucket.completedUnits,
    );
  }

  const testers: TesterRow[] = [
    ...new Set([...results.map((r) => r.userId), ...locationsByUser.keys()]),
  ].map((userId) => {
    const mine = results.filter((r) => r.userId === userId);
    const ok = mine.filter(passed).length;
    return {
      userId,
      name: userName(userId),
      locations: locationsByUser.get(userId) ?? 0,
      tests: mine.length,
      passed: ok,
      passRate: mine.length ? ok / mine.length : NaN,
    };
  });

  const focus = selectedUser
    ? results.filter((r) => r.userId === selectedUser)
    : results;
  const focusPassed = focus.filter(passed).length;

  const daily = (() => {
    const byDay = new Map<
      string,
      { day: string; passed: number; failed: number }
    >();
    for (const result of focus) {
      const day = dayString(new Date(result.createdAt));
      const entry = byDay.get(day) ?? { day, passed: 0, failed: 0 };
      if (passed(result)) entry.passed += 1;
      else entry.failed += 1;
      byDay.set(day, entry);
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  })();

  const labelAccuracy = (() => {
    const byLabel = new Map<string, { user: number; truth: number }>();
    for (const result of focus) {
      for (const c of result.categoryCounts) {
        const key = c.categoryName.toLowerCase();
        const entry = byLabel.get(key) ?? { user: 0, truth: 0 };
        entry.user += c.userCount;
        entry.truth += c.testCount;
        byLabel.set(key, entry);
      }
    }
    return [...byLabel]
      .filter(([, c]) => c.truth > 0)
      .map(([name, c]) => ({
        name,
        difference: Number(((c.user / c.truth - 1) * 100).toFixed(1)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  })();

  const differences = new Map(labelAccuracy.map((l) => [l.name, l.difference]));

  // Leaves room past the longest bar for its name.
  const accuracyDomain = (() => {
    const values = labelAccuracy.map((l) => l.difference);
    const span = Math.max(1, ...values.map(Math.abs));
    const pad = span * 0.6;
    const step = span > 10 ? 5 : 1;
    return [
      Math.floor((Math.min(0, ...values) && Math.min(...values) - pad) / step) *
        step,
      Math.ceil((Math.max(0, ...values) && Math.max(...values) + pad) / step) *
        step,
    ];
  })();

  const testerColumns = useMemo<DataColumn<TesterRow>[]>(
    () => [
      { accessorKey: 'name', header: 'User' },
      {
        accessorKey: 'locations',
        header: 'Locations done',
        meta: { className: 'text-right tabular-nums' },
        cell: ({ row }) => row.original.locations.toLocaleString(),
      },
      {
        accessorKey: 'tests',
        header: 'Tests',
        meta: { className: 'text-right tabular-nums' },
      },
      {
        accessorKey: 'passed',
        header: 'Passed',
        meta: { className: 'text-right tabular-nums' },
      },
      {
        id: 'passRate',
        // People with no tests sort below everyone else.
        accessorFn: (row) =>
          Number.isFinite(row.passRate) ? row.passRate : -1,
        header: 'Pass rate',
        meta: { className: 'w-56' },
        cell: ({ row }) => <PassRate value={row.original.passRate} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        meta: { className: 'w-28 text-center' },
        cell: ({ row }) =>
          row.original.tests > 0 && (
            <Button
              variant='info'
              onClick={() => setSelectedUser(row.original.userId)}
            >
              Details
            </Button>
          ),
      },
    ],
    [],
  );

  const testColumns = useMemo<DataColumn<TestResult>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: 'Date',
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
      },
      {
        accessorFn: (r) => r.testPreset.name,
        id: 'pool',
        header: 'Test from',
      },
      {
        accessorKey: 'testAnimals',
        header: 'Animals',
        meta: { className: 'text-right tabular-nums' },
      },
      {
        accessorFn: (r) => Math.max(r.totalMissedAnimals, 0),
        id: 'missed',
        header: 'Missed',
        meta: { className: 'text-right tabular-nums' },
      },
      {
        accessorFn: (r) => Math.max(-r.totalMissedAnimals, 0),
        id: 'over',
        header: 'Overcounted',
        meta: { className: 'text-right tabular-nums' },
      },
      {
        id: 'result',
        header: 'Result',
        enableSorting: false,
        cell: ({ row }) => <ResultBadge pass={passed(row.original)} />,
      },
      {
        id: 'link',
        header: '',
        enableSorting: false,
        meta: { className: 'w-20 text-center' },
        cell: ({ row }) => (
          <a
            href={`/surveys/${row.original.testPreset.ownerProjectId ?? survey?.value}/location/${row.original.locationId}/${row.original.annotationSetId}`}
            target='_blank'
            rel='noreferrer'
          >
            Open
          </a>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accuracy, ignoreOvercounts, survey?.value],
  );

  async function copySummary() {
    const lines = [...testers]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) =>
        [
          t.name,
          t.locations,
          t.tests,
          t.passed,
          Number.isFinite(t.passRate)
            ? `${(t.passRate * 100).toFixed(2)}%`
            : '',
        ].join(' | '),
      );
    await navigator.clipboard.writeText(
      ['User | Locations done | Tests | Passed | Pass rate', ...lines].join(
        '\n',
      ),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function exportSummary() {
    exportFromJSON({
      data: neutraliseCsvRows(
        testers.map((t) => ({
          user: t.name,
          locationsDone: t.locations,
          tests: t.tests,
          passed: t.passed,
          passRate: Number.isFinite(t.passRate)
            ? (t.passRate * 100).toFixed(2)
            : '',
        })),
      ),
      fileName: `${survey?.label}-test-results`,
      exportType: 'csv',
    });
  }

  function exportPerson() {
    exportFromJSON({
      data: neutraliseCsvRows(
        focus.map((r) => ({
          date: r.createdAt,
          testFrom: r.testPreset.name,
          testAnimals: r.testAnimals,
          missedAnimals: r.totalMissedAnimals,
          passed: passed(r),
        })),
      ),
      fileName: `${userName(selectedUser!)}-test-results`,
      exportType: 'csv',
    });
  }

  async function purge() {
    if (
      !selectedUser ||
      !confirm(
        `Delete all of ${userName(selectedUser)}'s test results on ${survey?.label}? This cannot be undone.`,
      )
    )
      return;
    setPurging(true);
    const mine = (resultsQuery.data ?? []).filter(
      (r) => r.userId === selectedUser,
    );
    await Promise.all(
      mine.flatMap((r) => [
        client.models.TestResult.delete({ id: r.id }),
        ...r.categoryCounts.map((c) =>
          client.models.TestResultCategoryCount.delete({
            testResultId: r.id,
            categoryName: c.categoryName,
          }),
        ),
      ]),
    );
    await resultsQuery.refetch();
    setPurging(false);
    setSelectedUser(null);
  }

  const loading = resultsQuery.isLoading || statsQuery.isLoading;

  return (
    <div className='mt-4 flex w-full flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <div className='w-full sm:w-72'>
          <Combobox
            value={survey}
            options={organizationProjects
              .filter((p) => !p.hidden)
              .map((p) => ({ label: p.name, value: p.id }))
              .sort((a, b) => a.label.localeCompare(b.label))}
            onChange={(option) => {
              setSurvey(option);
              setSelectedUser(null);
            }}
            placeholder='Select a survey'
            name='Survey'
          />
        </div>
        <div
          role='radiogroup'
          aria-label='Date range'
          className='inline-flex border border-white/30'
        >
          {RANGES.map((option) => (
            <button
              key={option.value}
              type='button'
              role='radio'
              aria-checked={range === option.value}
              onClick={() => setRange(option.value)}
              className={cn(
                'px-3 py-1.5 leading-normal whitespace-nowrap transition-colors',
                range === option.value
                  ? 'bg-primary text-white'
                  : 'hover:bg-white/10',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className='flex items-center gap-2'>
            <Input
              type='date'
              aria-label='From'
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className='w-40'
            />
            <span className='text-muted-foreground'>–</span>
            <Input
              type='date'
              aria-label='To'
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className='w-40'
            />
          </div>
        )}
        <div className='ml-auto flex items-center gap-3 text-sm'>
          <label className='mb-0 flex items-center gap-2'>
            Pass within
            <Input
              type='number'
              min={1}
              max={100}
              value={accuracy}
              onChange={(e) => setAccuracy(Number(e.target.value) || 0)}
              className='w-20'
            />
            %
          </label>
          <label className='mb-0 flex items-center gap-2'>
            <Checkbox
              checked={ignoreOvercounts}
              onCheckedChange={(c) => setIgnoreOvercounts(c === true)}
            />
            Ignore overcounts
          </label>
        </div>
      </div>

      {!survey ? (
        <div className='border border-white/15 bg-white/[0.07] px-4 py-6 text-center text-muted-foreground'>
          Select a survey to see its test results.
        </div>
      ) : loading ? (
        <div className='flex items-center justify-center gap-2 border border-white/15 bg-white/[0.07] px-4 py-6 text-muted-foreground'>
          <Spinner size='sm' />
          Loading test results...
        </div>
      ) : (
        <>
          <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
            <Tile label='Annotators tested'>
              {testers.filter((t) => t.tests > 0).length}
            </Tile>
            <Tile label='Tests'>{results.length.toLocaleString()}</Tile>
            <Tile label='Passed'>
              {results.filter(passed).length.toLocaleString()}
            </Tile>
            <Tile label='Pass rate'>
              {percent(results.filter(passed).length / results.length)}
            </Tile>
          </div>

          <div className='flex flex-col gap-2'>
            <div className='flex items-center justify-between'>
              <div className='flex flex-col'>
                <span className='font-semibold'>Annotators</span>
                {(statsQuery.isError || statsQuery.data?.truncated) && (
                  <span className='text-sm text-warning'>
                    {statsQuery.isError
                      ? 'Locations done could not be loaded.'
                      : 'Locations done is incomplete for this survey.'}
                  </span>
                )}
              </div>
              <div className='flex gap-2'>
                <Button
                  variant='outline-primary'
                  onClick={copySummary}
                  disabled={testers.length === 0}
                >
                  {copied ? (
                    <CheckIcon className='size-4' />
                  ) : (
                    <CopyIcon className='size-4' />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button
                  variant='outline-primary'
                  onClick={exportSummary}
                  disabled={testers.length === 0}
                >
                  <DownloadIcon className='size-4' />
                  Export
                </Button>
              </div>
            </div>
            <DataTable
              storageKey='testing-annotators'
              columns={testerColumns}
              data={testers}
              getRowId={(row) => row.userId}
              initialSorting={[{ id: 'tests', desc: true }]}
              emptyMessage='Nobody has been tested in this period.'
              highlightedRowIds={
                selectedUser ? new Set([selectedUser]) : undefined
              }
            />
          </div>

          {results.length > 0 && (
            <>
              <div className='flex items-center gap-2'>
                <span className='font-semibold'>
                  {selectedUser ? userName(selectedUser) : 'All annotators'}
                </span>
                {selectedUser && (
                  <>
                    <span className='text-sm text-muted-foreground'>
                      {focusPassed} of {focus.length} passed
                    </span>
                    <button
                      type='button'
                      aria-label='Show all annotators'
                      onClick={() => setSelectedUser(null)}
                      className='flex size-6 items-center justify-center text-muted-foreground hover:text-foreground'
                    >
                      <XIcon className='size-4' />
                    </button>
                  </>
                )}
              </div>
              <div className='grid gap-3 lg:grid-cols-2'>
                <ChartCard title='Tests per day'>
                  <ChartContainer config={dailyChart} className='h-64 w-full'>
                    <BarChart data={daily}>
                      <CartesianGrid vertical={false} strokeOpacity={0.15} />
                      <XAxis
                        dataKey='day'
                        tickLine={false}
                        axisLine={false}
                        stroke='#ebebeb'
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        stroke='#ebebeb'
                        tick={{ fontSize: 11 }}
                        width={32}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar
                        dataKey='passed'
                        stackId='a'
                        fill='var(--color-passed)'
                      />
                      <Bar
                        dataKey='failed'
                        stackId='a'
                        fill='var(--color-failed)'
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                </ChartCard>
                <ChartCard
                  title='Label accuracy'
                  hint='How much each label was over (+) or under (−) counted.'
                >
                  <ChartContainer
                    config={accuracyChart}
                    className='h-64 w-full'
                  >
                    <BarChart
                      data={labelAccuracy}
                      margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
                    >
                      <CartesianGrid vertical={false} strokeOpacity={0.15} />
                      <XAxis dataKey='name' hide />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        domain={accuracyDomain}
                        allowDecimals={false}
                        stroke='#ebebeb'
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `${v}%`}
                        width={44}
                      />
                      <ReferenceLine
                        y={0}
                        stroke='#ebebeb'
                        strokeOpacity={0.5}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value) => `${value}%`}
                          />
                        }
                      />
                      <Bar dataKey='difference' radius={3} minPointSize={1}>
                        {labelAccuracy.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={entry.difference < 0 ? '#df691a' : '#5bc0de'}
                          />
                        ))}
                        <LabelList
                          dataKey='name'
                          content={(props) => barName(props, differences)}
                        />
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                </ChartCard>
              </div>
            </>
          )}

          {selectedUser && (
            <div className='flex flex-col gap-2'>
              <div className='flex items-center justify-between gap-2'>
                <span className='font-semibold'>
                  {userName(selectedUser)}'s tests
                </span>
                <div className='flex gap-2'>
                  <Button variant='outline-primary' onClick={exportPerson}>
                    <DownloadIcon className='size-4' />
                    Export
                  </Button>
                  <Button
                    variant='outline-danger'
                    onClick={purge}
                    disabled={purging}
                  >
                    <Trash2Icon className='size-4' />
                    {purging ? 'Deleting...' : 'Delete results'}
                  </Button>
                </div>
              </div>
              <DataTable
                storageKey='testing-focus'
                columns={testColumns}
                data={focus}
                getRowId={(row) => row.id}
                initialSorting={[{ id: 'createdAt', desc: true }]}
                emptyMessage='No tests in this period.'
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='flex flex-col border border-white/15 bg-white/[0.07] px-4 py-2'>
      <span className='text-[11px] tracking-wider text-muted-foreground uppercase'>
        {label}
      </span>
      <span className='text-xl font-semibold tabular-nums'>{children}</span>
    </div>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className='flex flex-col gap-2 border border-white/15 bg-white/[0.07] p-3'>
      <div>
        <div className='font-semibold'>{title}</div>
        {hint && <div className='text-xs text-muted-foreground'>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function PassRate({ value }: { value: number }) {
  if (!Number.isFinite(value))
    return <span className='text-muted-foreground'>—</span>;
  const colour =
    value >= 0.95 ? 'bg-success' : value >= 0.85 ? 'bg-warning' : 'bg-danger';
  return (
    <div className='flex items-center gap-2'>
      <div className='h-2 w-28 bg-black/20'>
        <div
          className={cn('h-full', colour)}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className='tabular-nums'>{percent(value)}</span>
    </div>
  );
}

function ResultBadge({ pass }: { pass: boolean }) {
  return (
    <span
      className={cn(
        'px-2 py-0.5 text-xs font-semibold',
        pass ? 'bg-success/25 text-[#b6e3b6]' : 'bg-danger/25 text-[#f5b5b2]',
      )}
    >
      {pass ? 'Passed' : 'Failed'}
    </span>
  );
}

function barName(props: LabelProps, differences: Map<string, number>) {
  const x = Number(props.x);
  const y = Number(props.y);
  const width = Number(props.width);
  const height = Number(props.height);
  const name = String(props.value);
  const up = (differences.get(name) ?? 0) > 0;
  const cx = x + width / 2;
  const cy = up ? Math.min(y, y + height) - 4 : Math.max(y, y + height) + 4;
  return (
    <text
      x={cx}
      y={cy}
      transform={`rotate(-90 ${cx} ${cy})`}
      textAnchor={up ? 'start' : 'end'}
      dominantBaseline='central'
      fill='#ebebeb'
      fontSize={11}
    >
      {name}
    </text>
  );
}
