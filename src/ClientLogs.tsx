import { useEffect, useMemo, useState } from 'react';
import Select from 'react-select';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import MyTable from './Table';
import { client } from './stores/appClient';
import { useUsers } from './apiInterface';
import { fetchAllPaginatedResults } from './utils';
import type { Schema } from './amplify/client-schema';

type Option = { label: string; value: string };

export default function ClientLogs() {
  const { users } = useUsers();

  const userOptions: Option[] = useMemo(
    () =>
      users.map((u) => ({
        label: `${u.name || u.id} (${u.email || ''})`,
        value: u.id,
      })),
    [users]
  );

  const [selectedUser, setSelectedUser] = useState<Option | null>(null);
  const [start, setStart] = useState<string>('');
  const [end, setEnd] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<Schema['ClientLog']['type'][]>([]);

  function escapeCsvValue(value: unknown): string {
    const stringValue =
      value === null || value === undefined ? '' : String(value);
    const needsQuoting = /[",\n\r]/.test(stringValue);
    const escaped = stringValue.replace(/"/g, '""');
    return needsQuoting ? `"${escaped}"` : escaped;
  }

  function exportFilteredLogsToCsv() {
    if (!filteredLogs.length) return;

    const header = [
      'timestamp',
      'userId',
      'userName',
      'ipAddress',
      'deviceType',
      'os',
      'connectionType',
      'downlink',
      'rtt',
      'userAgent',
    ];

    const rows = filteredLogs.map((log) => {
      const user = users.find((u) => u.id === log.userId);
      return [
        new Date(log.createdAt as any).toISOString(),
        log.userId,
        user?.name || '',
        log.ipAddress || '',
        log.deviceType || '',
        log.os || '',
        log.connectionType || '',
        log.downlink ?? '',
        log.rtt ?? '',
        log.userAgent || '',
      ]
        .map(escapeCsvValue)
        .join(',');
    });

    const csv = [header.join(','), ...rows].join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const usernamePart =
      selectedUser?.label?.replace(/[^a-z0-9-_]+/gi, '_') || 'all';
    link.download = `client_logs_${usernamePart}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function loadLogs(userId: string) {
    setLoading(true);
    try {
      const data = await fetchAllPaginatedResults(
        client.models.ClientLog.clientLogsByUserId as any,
        {
          userId,
          selectionSet: [
            'id',
            'userId',
            'ipAddress',
            'userAgent',
            'deviceType',
            'os',
            'connectionType',
            'downlink',
            'rtt',
            'createdAt',
          ],
          limit: 10000,
        } as any
      );
      setLogs(data as any);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedUser) {
      loadLogs(selectedUser.value);
    } else {
      setLogs([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUser?.value]);

  const filteredLogs = useMemo(() => {
    let result = logs;
    if (start) {
      const s = new Date(start).getTime();
      result = result.filter(
        (l) => new Date(l.createdAt as any).getTime() >= s
      );
    }
    if (end) {
      const e = new Date(end).getTime();
      result = result.filter(
        (l) => new Date(l.createdAt as any).getTime() <= e
      );
    }
    // newest first
    return [...result].sort(
      (a, b) =>
        new Date(b.createdAt as any).getTime() -
        new Date(a.createdAt as any).getTime()
    );
  }, [logs, start, end]);

  const tableHeadings = [
    { content: 'Timestamp', sort: true },
    { content: 'User', sort: true },
    { content: 'IP', sort: true },
    { content: 'Device', sort: true },
    { content: 'OS', sort: true },
    { content: 'Conn', sort: true },
    { content: 'Downlink (Mb/s)', sort: true },
    { content: 'RTT (ms)', sort: true },
    { content: 'User Agent' },
  ];

  const tableData = filteredLogs.map((log) => {
    const user = users.find((u) => u.id === log.userId);
    return {
      id: log.id,
      rowData: [
        new Date(log.createdAt as any).toLocaleString(),
        user?.name || log.userId,
        log.ipAddress || '',
        log.deviceType || '',
        log.os || '',
        log.connectionType || '',
        (log.downlink ?? '').toString(),
        (log.rtt ?? '').toString(),
        log.userAgent || '',
      ],
    };
  });

  return (
    <div className='mt-2'>
      <h5>Client Logs</h5>
      <div className='d-flex gap-2 align-items-end flex-wrap mb-3'>
        <div style={{ minWidth: 300 }}>
          <Form.Label className='mb-1'>User</Form.Label>
          <Select
            options={userOptions}
            value={selectedUser}
            onChange={(opt) => setSelectedUser(opt as Option)}
            placeholder='Select a user...'
            isClearable
            className='text-black'
          />
        </div>
        <div>
          <Form.Label className='mb-1'>Start</Form.Label>
          <Form.Control
            type='datetime-local'
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <Form.Label className='mb-1'>End</Form.Label>
          <Form.Control
            type='datetime-local'
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <div className='d-flex gap-2'>
          <Button
            variant='secondary'
            onClick={() => {
              setStart('');
              setEnd('');
            }}
          >
            Clear Filters
          </Button>
          <Button
            variant='primary'
            onClick={() => selectedUser && loadLogs(selectedUser.value)}
            disabled={!selectedUser || loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <Button
            variant='success'
            onClick={exportFilteredLogsToCsv}
            disabled={!filteredLogs.length}
          >
            Export CSV
          </Button>
        </div>
      </div>

      <MyTable
        tableHeadings={tableHeadings as any}
        tableData={tableData}
        pagination={true}
        itemsPerPage={10}
        emptyMessage={
          selectedUser
            ? loading
              ? 'Loading…'
              : 'No logs found for selection'
            : 'Select a user to view logs'
        }
      />
    </div>
  );
}
