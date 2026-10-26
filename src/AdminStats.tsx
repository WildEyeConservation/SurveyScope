import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Table } from '@/components/ui/table';
import { useAdminStatsData } from './useAdminStatsData';

function SummaryTile(props: {
  title: string;
  total: number;
  thisMonth: number;
}) {
  return (
    <Card className='mb-4 h-full'>
      <CardContent>
        <div className='flex justify-between items-baseline'>
          <div>
            <div className='text-muted-foreground text-sm'>{props.title}</div>
            <div className='text-2xl font-medium leading-tight mb-0'>{props.total.toLocaleString()}</div>
          </div>
          <div className='text-success'>
            +{props.thisMonth.toLocaleString()} this month
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricChart(props: {
  title: string;
  months: string[];
  values: number[];
}) {
  const chartData = props.months.map((month, i) => ({
    month,
    value: props.values[i],
  }));
  const chartConfig = {
    value: { label: props.title, color: 'var(--chart-2)' },
  } satisfies ChartConfig;
  return (
    <Card className='mb-4'>
      <CardHeader className='py-2'>
        <div className='font-semibold'>{props.title}</div>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className='aspect-auto h-[260px] w-full [&_.recharts-cartesian-axis-tick_text]:fill-foreground'
        >
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis dataKey='month' tickLine={false} />
            <YAxis tickLine={false} allowDecimals={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              dataKey='value'
              type='monotoneX'
              stroke='var(--color-value)'
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--color-value)' }}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function OrgBreakdownTable(props: {
  breakdown: ReturnType<typeof useAdminStatsData>['breakdown'];
}) {
  const rows = props.breakdown;
  return (
    <Card className='mb-4'>
      <CardHeader className='py-2'>
        <div className='font-semibold'>Organizations and Surveys</div>
      </CardHeader>
      <CardContent className='p-0'>
        <Table size='sm' responsive className='mb-0'>
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Organization</th>
                <th className='text-right'>Surveys</th>
                <th className='text-right'>Images</th>
                <th className='text-right'>Annotations</th>
                <th className='text-right'>This month</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((org) => (
                <OrgRow key={org.organizationId} org={org} />
              ))}
            </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}

function OrgRow(props: {
  org: ReturnType<typeof useAdminStatsData>['breakdown'][number];
}) {
  const { org } = props;
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <td>
          {org.projects.length > 0 ? (
            <Button
              variant='outline-secondary'
              size='sm'
              onClick={() => setOpen((o) => !o)}
            >
              {open ? '−' : '+'}
            </Button>
          ) : null}
        </td>
        <td>{org.organizationName}</td>
        <td className='text-right'>{org.totals.surveys.toLocaleString()}</td>
        <td className='text-right'>{org.totals.images.toLocaleString()}</td>
        <td className='text-right'>{org.totals.annotations.toLocaleString()}</td>
        <td className='text-right'>
          {org.thisMonth.surveys.toLocaleString()} /{' '}
          {org.thisMonth.images.toLocaleString()} /{' '}
          {org.thisMonth.annotations.toLocaleString()}
        </td>
      </tr>
      {open &&
        org.projects.map((p) => (
          <tr key={p.projectId} className='[--table-bg:var(--light)]'>
            <td></td>
            <td className='ps-6'>{p.projectName}</td>
            <td className='text-right'>{p.totals.surveys}</td>
            <td className='text-right'>{p.totals.images.toLocaleString()}</td>
            <td className='text-right'>
              {p.totals.annotations.toLocaleString()}
            </td>
            <td className='text-right'>
              {p.thisMonth.surveys} / {p.thisMonth.images.toLocaleString()} /{' '}
              {p.thisMonth.annotations.toLocaleString()}
            </td>
          </tr>
        ))}
    </>
  );
}

export default function AdminStats() {
  const [timeframe, setTimeframe] = useState(12);
  const data = useAdminStatsData(timeframe);

  const summary = useMemo(
    () => [
      {
        title: 'Users',
        total: data.users.total,
        thisMonth: data.users.thisMonth,
      },
      {
        title: 'Organizations',
        total: data.organizations.total,
        thisMonth: data.organizations.thisMonth,
      },
      {
        title: 'Surveys',
        total: data.surveys.total,
        thisMonth: data.surveys.thisMonth,
      },
      {
        title: 'Images',
        total: data.images.total,
        thisMonth: data.images.thisMonth,
      },
      {
        title: 'Annotations',
        total: data.annotations.total,
        thisMonth: data.annotations.thisMonth,
      },
      {
        title: 'Primary Annotations',
        total: data.primaryAnnotations.total,
        thisMonth: data.primaryAnnotations.thisMonth,
      },
    ],
    [data]
  );

  return (
    <div>
      <div className='flex items-end gap-4 mb-4'>
        <div>
          <Label className='mb-1'>Timeframe</Label>
          <NativeSelect
            value={timeframe}
            onChange={(e) => setTimeframe(parseInt(e.target.value, 10))}
          >
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
            <option value={24}>Last 24 months</option>
          </NativeSelect>
        </div>
        <div>
          <Label className='mb-1'>Actions</Label>
          <div>
            <Button
              variant='outline-primary'
              onClick={data.refresh}
              disabled={data.loading}
            >
              {data.loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </div>
      </div>

      {data.error && (
        <Alert variant='danger' className='mb-4'>
          {data.error}
        </Alert>
      )}

      {data.loading ? (
        <div className='flex items-center gap-2 mb-4'>
          <Spinner animation='border' size='sm' />
          <span>Loading statistics…</span>
        </div>
      ) : null}

      <div className='grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6'>
        {summary.map((m) => (
          <div key={m.title}>
            <SummaryTile
              title={m.title}
              total={m.total}
              thisMonth={m.thisMonth}
            />
          </div>
        ))}
      </div>

      <div className='mt-5 grid grid-cols-1 gap-4 md:grid-cols-2'>
        <div>
          <MetricChart
            title='New users'
            months={data.months}
            values={data.users.series.values}
          />
        </div>
        <div>
          <MetricChart
            title='Unique monthly logins'
            months={data.months}
            values={data.users.uniqueLoginSeries.values}
          />
        </div>
        <div>
          <MetricChart
            title='New organizations'
            months={data.months}
            values={data.organizations.series.values}
          />
        </div>
        <div>
          <MetricChart
            title='New surveys'
            months={data.months}
            values={data.surveys.series.values}
          />
        </div>
        <div>
          <MetricChart
            title='New images'
            months={data.months}
            values={data.images.series.values}
          />
        </div>
        <div>
          <MetricChart
            title='New annotations'
            months={data.months}
            values={data.annotations.series.values}
          />
        </div>
      </div>

      <OrgBreakdownTable breakdown={data.breakdown} />
    </div>
  );
}
