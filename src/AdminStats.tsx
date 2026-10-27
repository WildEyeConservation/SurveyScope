import { useMemo, useState } from 'react';
import Card from 'react-bootstrap/Card';
import Spinner from 'react-bootstrap/Spinner';
import Alert from 'react-bootstrap/Alert';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import { LineChart } from '@mui/x-charts/LineChart';
import { DateTime } from 'luxon';
import { useAdminStatsData } from './useAdminStatsData';

function SummaryTile(props: {
  title: string;
  total: number;
  thisMonth: number;
}) {
  return (
    <Card className='mb-3 h-100'>
      <Card.Body>
        <div className='d-flex justify-content-between align-items-baseline'>
          <div>
            <div className='text-muted small'>{props.title}</div>
            <div className='h4 mb-0'>{props.total.toLocaleString()}</div>
          </div>
          <div className='text-success'>
            +{props.thisMonth.toLocaleString()} this month
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}

function MetricChart(props: {
  title: string;
  months: string[];
  values: number[];
}) {
  return (
    <Card className='mb-3'>
      <Card.Header className='py-2'>
        <div className='fw-semibold'>{props.title}</div>
      </Card.Header>
      <Card.Body>
        <div style={{ height: 260 }}>
          <LineChart
            xAxis={[{ scaleType: 'band', data: props.months }]}
            series={[{ data: props.values, label: props.title }]}
            slotProps={{ legend: { hidden: true } }}
          />
        </div>
      </Card.Body>
    </Card>
  );
}

function OrgBreakdownTable(props: {
  breakdown: ReturnType<typeof useAdminStatsData>['breakdown'];
}) {
  const rows = props.breakdown;
  return (
    <Card className='mb-3'>
      <Card.Header className='py-2'>
        <div className='fw-semibold'>Organizations and Surveys</div>
      </Card.Header>
      <Card.Body className='p-0'>
        <div className='table-responsive'>
          <table className='table table-sm mb-0'>
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Organization</th>
                <th className='text-end'>Surveys</th>
                <th className='text-end'>Images</th>
                <th className='text-end'>Annotations</th>
                <th className='text-end'>This month</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((org) => (
                <OrgRow key={org.organizationId} org={org} />
              ))}
            </tbody>
          </table>
        </div>
      </Card.Body>
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
            <button
              className='btn btn-sm btn-outline-secondary'
              onClick={() => setOpen((o) => !o)}
            >
              {open ? '−' : '+'}
            </button>
          ) : null}
        </td>
        <td>{org.organizationName}</td>
        <td className='text-end'>{org.totals.surveys.toLocaleString()}</td>
        <td className='text-end'>{org.totals.images.toLocaleString()}</td>
        <td className='text-end'>{org.totals.annotations.toLocaleString()}</td>
        <td className='text-end'>
          {org.thisMonth.surveys.toLocaleString()} /{' '}
          {org.thisMonth.images.toLocaleString()} /{' '}
          {org.thisMonth.annotations.toLocaleString()}
        </td>
      </tr>
      {open &&
        org.projects.map((p) => (
          <tr key={p.projectId} className='table-light'>
            <td></td>
            <td className='ps-4'>{p.projectName}</td>
            <td className='text-end'>{p.totals.surveys}</td>
            <td className='text-end'>{p.totals.images.toLocaleString()}</td>
            <td className='text-end'>
              {p.totals.annotations.toLocaleString()}
            </td>
            <td className='text-end'>
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
    ],
    [data]
  );

  return (
    <div>
      <div className='d-flex align-items-end gap-3 mb-3'>
        <div>
          <Form.Label className='mb-1'>Timeframe</Form.Label>
          <Form.Select
            value={timeframe}
            onChange={(e) => setTimeframe(parseInt(e.target.value, 10))}
          >
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
            <option value={24}>Last 24 months</option>
          </Form.Select>
        </div>
        <div>
          <Form.Label className='mb-1'>Actions</Form.Label>
          <div>
            <button
              className='btn btn-outline-primary'
              onClick={data.refresh}
              disabled={data.loading}
            >
              {data.loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        {data.updatedAt && (
          <div className='text-muted small mb-2'>
            Counts updated{' '}
            {DateTime.fromISO(data.updatedAt).toRelative()}, refreshed hourly
          </div>
        )}
      </div>

      {data.error && (
        <Alert variant='danger' className='mb-3'>
          {data.error}
        </Alert>
      )}

      {data.loading ? (
        <div className='d-flex align-items-center gap-2 mb-3'>
          <Spinner animation='border' size='sm' />
          <span>Loading statistics…</span>
        </div>
      ) : null}

      <Row xs={1} md={3} lg={5} className='g-3'>
        {summary.map((m) => (
          <Col key={m.title}>
            <SummaryTile
              title={m.title}
              total={m.total}
              thisMonth={m.thisMonth}
            />
          </Col>
        ))}
      </Row>

      <Row className='g-3 mt-1'>
        <Col md={6}>
          <MetricChart
            title='New users'
            months={data.months}
            values={data.users.series.values}
          />
        </Col>
        <Col md={6}>
          <MetricChart
            title='Unique monthly logins'
            months={data.months}
            values={data.users.uniqueLoginSeries.values}
          />
        </Col>
        <Col md={6}>
          <MetricChart
            title='New organizations'
            months={data.months}
            values={data.organizations.series.values}
          />
        </Col>
        <Col md={6}>
          <MetricChart
            title='New surveys'
            months={data.months}
            values={data.surveys.series.values}
          />
        </Col>
        <Col md={6}>
          <MetricChart
            title='New images'
            months={data.months}
            values={data.images.series.values}
          />
        </Col>
        <Col md={6}>
          <MetricChart
            title='New annotations'
            months={data.months}
            values={data.annotations.series.values}
          />
        </Col>
      </Row>

      <OrgBreakdownTable breakdown={data.breakdown} />
    </div>
  );
}
