import DataTable, { type DataColumn } from '@/components/DataTable';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  Building2,
  Download,
  Images,
  MapPin,
  RefreshCw,
  SearchIcon,
  SearchX,
  Tags,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { escapeCsvValue } from '../shared/csv';
import SurveyLocationsMap, { type SurveyPin } from './SurveyLocationsMap';
import {
  useAdminStatsData,
  type MonthKey,
  type MonthRange,
} from './useAdminStatsData';
import { useSurveyLocations } from './useSurveyLocations';

type StatsData = ReturnType<typeof useAdminStatsData>;
type MetricKey =
  'users' | 'organizations' | 'surveys' | 'images' | 'annotations';

interface Series {
  key: string;
  label: string;
  values: number[];
}

interface MetricDef {
  key: MetricKey;
  label: string;
  icon: LucideIcon;
  total: number;
  thisMonth: number;
  series: Series[];
}

interface SurveyRow {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  createdAt: string | null;
  images: number;
  annotations: number;
  imagesThisMonth: number;
  annotationsThisMonth: number;
  located: boolean;
}

interface OrganizationRow {
  id: string;
  name: string;
  surveys: number;
  images: number;
  annotations: number;
  surveysThisMonth: number;
  imagesThisMonth: number;
  annotationsThisMonth: number;
}

type Timeframe = '6' | '12' | '24' | 'custom';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '6', label: '6M' },
  { value: '12', label: '12M' },
  { value: '24', label: '24M' },
  { value: 'custom', label: 'Custom' },
];

const monthKey = (date: DateTime) => date.toFormat('yyyy-LL');

const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)'];

const monthLabel = (month: MonthKey) =>
  DateTime.fromFormat(month, 'yyyy-LL').toFormat('LLL yy');

function Segmented<T extends string | number>(props: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role='radiogroup'
      aria-label={props.label}
      className='inline-flex border border-white/30'
    >
      {props.options.map((option) => (
        <button
          key={option.value}
          type='button'
          role='radio'
          aria-checked={props.value === option.value}
          onClick={() => props.onChange(option.value)}
          className={cn(
            'px-3 py-1.5 text-base leading-normal transition-colors',
            props.value === option.value
              ? 'bg-primary text-white'
              : 'hover:bg-white/10',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ThisMonth({ value }: { value: number }) {
  return value ? (
    <span className='text-success'>+{value.toLocaleString()}</span>
  ) : (
    <span className='text-muted-foreground'>–</span>
  );
}

function KpiTile(props: {
  metric: MetricDef;
  months: MonthKey[];
  selected: boolean;
  loading: boolean;
  onSelect: () => void;
}) {
  const { metric } = props;
  const Icon = metric.icon;
  const data = props.months.map((month, i) => ({
    month,
    value: metric.series[0].values[i],
  }));
  return (
    <button
      type='button'
      aria-pressed={props.selected}
      onClick={props.onSelect}
      className={cn(
        'flex flex-col gap-1 border bg-card p-4 text-left transition-colors',
        props.selected
          ? 'border-primary shadow-[inset_0_-3px_0_var(--color-primary)]'
          : 'border-border-subtle hover:bg-white/5',
      )}
    >
      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
        <Icon size={16} />
        {metric.label}
      </div>
      {props.loading ? (
        <Skeleton className='my-1 h-8 w-24 bg-white/10' />
      ) : (
        <div className='text-3xl leading-tight font-medium tabular-nums'>
          {metric.total.toLocaleString()}
        </div>
      )}
      <div className='text-sm'>
        <ThisMonth value={metric.thisMonth} />{' '}
        <span className='text-muted-foreground'>this month</span>
      </div>
      <ChartContainer
        config={{ value: { label: metric.label, color: 'var(--chart-1)' } }}
        className='mt-1 aspect-auto h-10 w-full'
      >
        <AreaChart
          data={data}
          margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient
              id={`spark-${metric.key}`}
              x1='0'
              y1='0'
              x2='0'
              y2='1'
            >
              <stop
                offset='0%'
                stopColor='var(--color-value)'
                stopOpacity={0.5}
              />
              <stop
                offset='100%'
                stopColor='var(--color-value)'
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <Area
            dataKey='value'
            type='monotone'
            stroke='var(--color-value)'
            strokeWidth={1.5}
            fill={`url(#spark-${metric.key})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </button>
  );
}

function TrendCard({
  metric,
  months,
}: {
  metric: MetricDef;
  months: MonthKey[];
}) {
  const config = Object.fromEntries(
    metric.series.map((s, i) => [
      s.key,
      { label: s.label, color: SERIES_COLORS[i] },
    ]),
  ) satisfies ChartConfig;
  const data = months.map((month, i) => ({
    month: monthLabel(month),
    ...Object.fromEntries(metric.series.map((s) => [s.key, s.values[i]])),
  }));
  return (
    <Card className='lg:col-span-3'>
      <CardHeader className='flex items-center justify-between py-3'>
        <div className='font-semibold'>{metric.label} per month</div>
        <div className='text-sm text-muted-foreground'>
          {metric.series[0].values
            .reduce((sum, v) => sum + v, 0)
            .toLocaleString()}{' '}
          {metric.series[0].label.toLowerCase()} in {months.length} months
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={config}
          className='aspect-auto h-[300px] w-full [&_.recharts-cartesian-axis-tick-value]:fill-foreground'
        >
          <AreaChart
            data={data}
            margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
          >
            <defs>
              {metric.series.map((s) => (
                <linearGradient
                  key={s.key}
                  id={`trend-${s.key}`}
                  x1='0'
                  y1='0'
                  x2='0'
                  y2='1'
                >
                  <stop
                    offset='0%'
                    stopColor={`var(--color-${s.key})`}
                    stopOpacity={0.4}
                  />
                  <stop
                    offset='100%'
                    stopColor={`var(--color-${s.key})`}
                    stopOpacity={0}
                  />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} strokeOpacity={0.2} />
            <XAxis
              dataKey='month'
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={48}
              tickFormatter={(v: number) => v.toLocaleString()}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            {metric.series.length > 1 && (
              <ChartLegend content={<ChartLegendContent />} />
            )}
            {metric.series.map((s) => (
              <Area
                key={s.key}
                dataKey={s.key}
                type='monotone'
                stroke={`var(--color-${s.key})`}
                strokeWidth={2}
                fill={`url(#trend-${s.key})`}
                dot={{ r: 3, fill: `var(--color-${s.key})` }}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function MapCard(props: {
  pins: SurveyPin[];
  loading: boolean;
  highlightedId: string | null;
}) {
  return (
    <Card className='lg:col-span-2'>
      <CardHeader className='py-3'>
        <div className='font-semibold'>Survey locations</div>
      </CardHeader>
      <div className='relative min-h-[332px] flex-1'>
        <SurveyLocationsMap
          pins={props.pins}
          highlightedId={props.highlightedId}
        />
        {props.loading && (
          <div className='absolute inset-0 flex items-center justify-center bg-black/30'>
            <Spinner animation='border' />
          </div>
        )}
      </div>
    </Card>
  );
}

function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const csv = [
    header.join(','),
    ...rows.map((row) => row.map(escapeCsvValue).join(',')),
  ].join('\r\n');
  const url = URL.createObjectURL(
    new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const numberColumn = <T extends object>(
  id: string,
  header: string,
  value: (row: T) => number,
  thisMonth = false,
): DataColumn<T> => ({
  id,
  header,
  accessorFn: value,
  cell: ({ getValue }) =>
    thisMonth ? (
      <ThisMonth value={getValue<number>()} />
    ) : (
      getValue<number>().toLocaleString()
    ),
  meta: { className: 'text-right tabular-nums whitespace-nowrap' },
});

function BreakdownCard(props: {
  breakdown: StatsData['breakdown'];
  locatedIds: Set<string>;
  onSurveyHover: (id: string | null) => void;
}) {
  const [view, setView] = useState<'surveys' | 'organizations'>('surveys');
  const [search, setSearch] = useState('');
  const [organization, setOrganization] = useState<ComboboxOption | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);

  const surveys = useMemo<SurveyRow[]>(
    () =>
      props.breakdown.flatMap((org) =>
        org.projects.map((p) => ({
          id: p.projectId,
          name: p.projectName,
          organizationId: org.organizationId,
          organizationName: org.organizationName,
          createdAt: p.createdAt,
          images: p.totals.images,
          annotations: p.totals.annotations,
          imagesThisMonth: p.thisMonth.images,
          annotationsThisMonth: p.thisMonth.annotations,
          located: props.locatedIds.has(p.projectId),
        })),
      ),
    [props.breakdown, props.locatedIds],
  );

  const organizations = useMemo<OrganizationRow[]>(
    () =>
      props.breakdown.map((org) => ({
        id: org.organizationId,
        name: org.organizationName,
        surveys: org.totals.surveys,
        images: org.totals.images,
        annotations: org.totals.annotations,
        surveysThisMonth: org.thisMonth.surveys,
        imagesThisMonth: org.thisMonth.images,
        annotationsThisMonth: org.thisMonth.annotations,
      })),
    [props.breakdown],
  );

  const organizationOptions = useMemo(
    () =>
      organizations
        .map((o) => ({ value: o.id, label: o.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [organizations],
  );

  const query = search.trim().toLowerCase();
  const visibleSurveys = surveys.filter(
    (s) =>
      (!organization || s.organizationId === organization.value) &&
      (!activeOnly || s.imagesThisMonth > 0 || s.annotationsThisMonth > 0) &&
      (!query ||
        s.name.toLowerCase().includes(query) ||
        s.organizationName.toLowerCase().includes(query)),
  );
  const visibleOrganizations = organizations.filter(
    (o) =>
      (!activeOnly ||
        o.surveysThisMonth > 0 ||
        o.imagesThisMonth > 0 ||
        o.annotationsThisMonth > 0) &&
      (!query || o.name.toLowerCase().includes(query)),
  );

  const showSurveysFor = (row: OrganizationRow) => {
    setOrganization({ value: row.id, label: row.name });
    setSearch('');
    setView('surveys');
  };

  const surveyColumns: DataColumn<SurveyRow>[] = [
    {
      id: 'name',
      header: 'Survey',
      accessorFn: (row) => row.name,
      cell: ({ row }) => (
        <span className='flex items-center gap-1.5'>
          {row.original.name}
          {row.original.located && (
            <MapPin
              size={14}
              className='shrink-0 text-primary'
              aria-label='On map'
            />
          )}
        </span>
      ),
    },
    {
      id: 'organization',
      header: 'Organisation',
      accessorFn: (row) => row.organizationName,
    },
    {
      id: 'createdAt',
      header: 'Created',
      accessorFn: (row) => row.createdAt ?? '',
      cell: ({ row }) =>
        row.original.createdAt
          ? DateTime.fromISO(row.original.createdAt).toLocaleString(
              DateTime.DATE_MED,
            )
          : '',
      meta: { className: 'whitespace-nowrap' },
    },
    numberColumn<SurveyRow>('images', 'Images', (r) => r.images),
    numberColumn<SurveyRow>('annotations', 'Annotations', (r) => r.annotations),
    numberColumn<SurveyRow>(
      'imagesThisMonth',
      'Images this month',
      (r) => r.imagesThisMonth,
      true,
    ),
    numberColumn<SurveyRow>(
      'annotationsThisMonth',
      'Annotations this month',
      (r) => r.annotationsThisMonth,
      true,
    ),
  ];

  const organizationColumns: DataColumn<OrganizationRow>[] = [
    {
      id: 'name',
      header: 'Organisation',
      accessorFn: (row) => row.name,
      cell: ({ row }) =>
        row.original.surveys ? (
          <button
            type='button'
            className='text-left hover:text-primary hover:underline'
            onClick={() => showSurveysFor(row.original)}
          >
            {row.original.name}
          </button>
        ) : (
          row.original.name
        ),
    },
    numberColumn<OrganizationRow>('surveys', 'Surveys', (r) => r.surveys),
    numberColumn<OrganizationRow>('images', 'Images', (r) => r.images),
    numberColumn<OrganizationRow>(
      'annotations',
      'Annotations',
      (r) => r.annotations,
    ),
    numberColumn<OrganizationRow>(
      'surveysThisMonth',
      'New surveys this month',
      (r) => r.surveysThisMonth,
      true,
    ),
    numberColumn<OrganizationRow>(
      'imagesThisMonth',
      'Images this month',
      (r) => r.imagesThisMonth,
      true,
    ),
    numberColumn<OrganizationRow>(
      'annotationsThisMonth',
      'Annotations this month',
      (r) => r.annotationsThisMonth,
      true,
    ),
  ];

  function exportCsv() {
    if (view === 'surveys') {
      downloadCsv(
        'survey_statistics.csv',
        [
          'survey',
          'organisation',
          'created',
          'images',
          'annotations',
          'imagesThisMonth',
          'annotationsThisMonth',
        ],
        visibleSurveys.map((s) => [
          s.name,
          s.organizationName,
          s.createdAt ?? '',
          s.images,
          s.annotations,
          s.imagesThisMonth,
          s.annotationsThisMonth,
        ]),
      );
    } else {
      downloadCsv(
        'organisation_statistics.csv',
        [
          'organisation',
          'surveys',
          'images',
          'annotations',
          'surveysThisMonth',
          'imagesThisMonth',
          'annotationsThisMonth',
        ],
        visibleOrganizations.map((o) => [
          o.name,
          o.surveys,
          o.images,
          o.annotations,
          o.surveysThisMonth,
          o.imagesThisMonth,
          o.annotationsThisMonth,
        ]),
      );
    }
  }

  const hasFilters = !!(search || organization || activeOnly);
  const emptyProps = {
    emptyIcon: hasFilters ? SearchX : undefined,
    emptyMessage: hasFilters ? 'Nothing matches these filters' : 'No data yet',
  };

  return (
    <Card>
      <CardHeader className='flex flex-wrap items-center justify-between gap-2 py-3'>
        <div className='font-semibold'>Breakdown</div>
        <Segmented
          label='Group by'
          options={[
            { value: 'surveys', label: 'Surveys' },
            { value: 'organizations', label: 'Organisations' },
          ]}
          value={view}
          onChange={setView}
        />
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div className='flex flex-wrap items-end gap-2'>
          <div className='min-w-72 flex-[1.4]'>
            <Label className='mb-1'>Search</Label>
            <div className='relative'>
              <SearchIcon className='pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-[#6c757d]' />
              <Input
                type='search'
                aria-label='Search breakdown'
                placeholder={
                  view === 'surveys'
                    ? 'Survey or organisation name…'
                    : 'Organisation name…'
                }
                className='pl-9'
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          {view === 'surveys' && (
            <div className='min-w-60 flex-1'>
              <Label className='mb-1'>Organisation</Label>
              <Combobox
                options={organizationOptions}
                value={organization}
                onChange={setOrganization}
                placeholder='All organisations'
                name='Organisation'
                clearable
              />
            </div>
          )}
          <label className='flex h-[38px] cursor-pointer items-center gap-2 px-2'>
            <Switch checked={activeOnly} onCheckedChange={setActiveOnly} />
            Active this month
          </label>
          <div className='ml-auto flex gap-2'>
            {hasFilters && (
              <Button
                variant='ghost'
                onClick={() => {
                  setSearch('');
                  setOrganization(null);
                  setActiveOnly(false);
                }}
              >
                Clear filters
              </Button>
            )}
            <Button
              variant='outline-success'
              onClick={exportCsv}
              disabled={
                !(view === 'surveys' ? visibleSurveys : visibleOrganizations)
                  .length
              }
            >
              <Download size={16} />
              Export CSV
            </Button>
          </div>
        </div>
        {view === 'surveys' ? (
          <DataTable
            storageKey='admin-stats-surveys'
            key='surveys'
            columns={surveyColumns}
            data={visibleSurveys}
            getRowId={(row) => row.id}
            initialSorting={[{ id: 'images', desc: true }]}
            onRowHover={props.onSurveyHover}
            {...emptyProps}
          />
        ) : (
          <DataTable
            storageKey='admin-stats-organisations'
            key='organizations'
            columns={organizationColumns}
            data={visibleOrganizations}
            getRowId={(row) => row.id}
            initialSorting={[{ id: 'images', desc: true }]}
            {...emptyProps}
          />
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminStats() {
  const [timeframe, setTimeframe] = useState<Timeframe>('12');
  const thisMonth = monthKey(DateTime.utc());
  const [customFrom, setCustomFrom] = useState(() =>
    monthKey(DateTime.utc().minus({ months: 11 })),
  );
  const [customTo, setCustomTo] = useState(thisMonth);
  const range = useMemo<MonthRange>(() => {
    if (timeframe !== 'custom')
      return {
        from: monthKey(DateTime.utc().minus({ months: Number(timeframe) - 1 })),
        to: thisMonth,
      };
    return customFrom <= customTo
      ? { from: customFrom, to: customTo }
      : { from: customTo, to: customFrom };
  }, [timeframe, customFrom, customTo, thisMonth]);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('users');
  const [hoveredSurvey, setHoveredSurvey] = useState<string | null>(null);
  const data = useAdminStatsData(range);
  const firstLoad = data.loading && !data.updatedAt;

  const metrics = useMemo<MetricDef[]>(
    () => [
      {
        key: 'users',
        label: 'Users',
        icon: UsersRound,
        total: data.users.total,
        thisMonth: data.users.thisMonth,
        series: [
          {
            key: 'newUsers',
            label: 'New users',
            values: data.users.series.values,
          },
          {
            key: 'activeUsers',
            label: 'Active users',
            values: data.users.uniqueLoginSeries.values,
          },
        ],
      },
      {
        key: 'organizations',
        label: 'Organisations',
        icon: Building2,
        total: data.organizations.total,
        thisMonth: data.organizations.thisMonth,
        series: [
          {
            key: 'organizations',
            label: 'New organisations',
            values: data.organizations.series.values,
          },
        ],
      },
      {
        key: 'surveys',
        label: 'Surveys',
        icon: MapPin,
        total: data.surveys.total,
        thisMonth: data.surveys.thisMonth,
        series: [
          {
            key: 'surveys',
            label: 'New surveys',
            values: data.surveys.series.values,
          },
        ],
      },
      {
        key: 'images',
        label: 'Images',
        icon: Images,
        total: data.images.total,
        thisMonth: data.images.thisMonth,
        series: [
          {
            key: 'images',
            label: 'Images uploaded',
            values: data.images.series.values,
          },
        ],
      },
      {
        key: 'annotations',
        label: 'Annotations',
        icon: Tags,
        total: data.annotations.total,
        thisMonth: data.annotations.thisMonth,
        series: [
          {
            key: 'annotations',
            label: 'Annotations made',
            values: data.annotations.series.values,
          },
        ],
      },
    ],
    [data],
  );

  const projects = useMemo(
    () =>
      data.breakdown.flatMap((org) =>
        org.projects.map((p) => ({
          id: p.projectId,
          name: p.projectName,
          organizationName: org.organizationName,
        })),
      ),
    [data.breakdown],
  );
  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const { locations, loading: locating } = useSurveyLocations(projectIds);
  const pins = useMemo<SurveyPin[]>(
    () =>
      projects.flatMap((p) => {
        const location = locations.get(p.id);
        return location ? [{ ...p, ...location }] : [];
      }),
    [projects, locations],
  );
  const locatedIds = useMemo(() => new Set(locations.keys()), [locations]);

  const metric = metrics.find((m) => m.key === selectedMetric)!;

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h5 className='mb-0'>Statistics</h5>
        <div className='flex flex-wrap items-center gap-3'>
          {data.updatedAt && (
            <span className='text-sm text-muted-foreground'>
              Counts updated {DateTime.fromISO(data.updatedAt).toRelative()},
              refreshed hourly
            </span>
          )}
          <Segmented
            label='Timeframe'
            options={TIMEFRAMES}
            value={timeframe}
            onChange={setTimeframe}
          />
          {timeframe === 'custom' && (
            <div className='flex items-center gap-2'>
              <Input
                type='month'
                aria-label='From month'
                className='w-44'
                value={customFrom}
                max={customTo}
                onChange={(e) =>
                  e.target.value && setCustomFrom(e.target.value)
                }
              />
              <span className='text-muted-foreground'>to</span>
              <Input
                type='month'
                aria-label='To month'
                className='w-44'
                value={customTo}
                min={customFrom}
                max={thisMonth}
                onChange={(e) => e.target.value && setCustomTo(e.target.value)}
              />
            </div>
          )}
          <Button
            variant='outline-primary'
            onClick={data.refresh}
            disabled={data.loading}
          >
            <RefreshCw
              size={16}
              className={cn(data.loading && 'animate-spin')}
            />
            {data.loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {data.error && <Alert variant='danger'>{data.error}</Alert>}

      <div className='grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5'>
        {metrics.map((m) => (
          <KpiTile
            key={m.key}
            metric={m}
            months={data.months}
            selected={m.key === selectedMetric}
            loading={firstLoad}
            onSelect={() => setSelectedMetric(m.key)}
          />
        ))}
      </div>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-5'>
        <TrendCard metric={metric} months={data.months} />
        <MapCard
          pins={pins}
          loading={firstLoad || locating}
          highlightedId={hoveredSurvey}
        />
      </div>

      <BreakdownCard
        breakdown={data.breakdown}
        locatedIds={locatedIds}
        onSurveyHover={setHoveredSurvey}
      />
    </div>
  );
}
