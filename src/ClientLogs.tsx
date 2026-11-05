import DataTable, { type DataColumn } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowRight, Download, RefreshCw, UserRound } from 'lucide-react';
import { useContext, useEffect, useMemo, useState } from 'react';
import { escapeCsvValue } from '../shared/csv';
import { GlobalContext } from './Context';
import type { Schema } from './amplify/client-schema';
import { useUsers } from './apiInterface';
import { fetchAllPaginatedResults } from './utils';

type Option = { label: string; value: string };
type ClientLog = Schema['ClientLog']['type'];

export default function ClientLogs() {
  const { client } = useContext(GlobalContext)!;
  const { users } = useUsers();

  const userOptions: Option[] = useMemo(
    () =>
      users.map((u) => ({
        label: `${u.name || u.id} (${u.email || ''})`,
        value: u.id,
      })),
    [users],
  );

  const [selectedUser, setSelectedUser] = useState<Option | null>(null);
  const [start, setStart] = useState<string>('');
  const [end, setEnd] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<ClientLog[]>([]);

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
        new Date(log.createdAt).toISOString(),
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
        } as any,
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
      result = result.filter((l) => new Date(l.createdAt).getTime() >= s);
    }
    if (end) {
      const e = new Date(end).getTime();
      result = result.filter((l) => new Date(l.createdAt).getTime() <= e);
    }
    // newest first
    return [...result].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [logs, start, end]);

  const columns = useMemo<DataColumn<ClientLog>[]>(
    () => [
      {
        id: 'timestamp',
        header: 'Timestamp',
        accessorFn: (log) => new Date(log.createdAt).getTime(),
        cell: ({ row }) =>
          new Date(row.original.createdAt).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        meta: { className: 'whitespace-nowrap' },
      },
      {
        id: 'ip',
        header: 'IP',
        accessorFn: (log) => log.ipAddress ?? '',
        meta: { className: 'font-mono text-sm' },
      },
      {
        id: 'device',
        header: 'Device',
        accessorFn: (log) => log.deviceType ?? '',
        cell: ({ row }) =>
          row.original.deviceType ? (
            <span className='rounded-full bg-white/15 px-2 py-0.5 text-sm'>
              {row.original.deviceType}
            </span>
          ) : null,
      },
      { id: 'os', header: 'OS', accessorFn: (log) => log.os ?? '' },
      {
        id: 'connection',
        header: 'Conn',
        accessorFn: (log) => log.connectionType ?? '',
      },
      {
        id: 'downlink',
        header: 'Downlink (Mb/s)',
        accessorFn: (log) => log.downlink ?? -1,
        cell: ({ row }) => row.original.downlink ?? '',
        meta: { className: 'text-right tabular-nums' },
      },
      {
        id: 'rtt',
        header: 'RTT (ms)',
        accessorFn: (log) => log.rtt ?? -1,
        cell: ({ row }) => row.original.rtt ?? '',
        meta: { className: 'text-right tabular-nums' },
      },
      {
        id: 'userAgent',
        header: 'User Agent',
        accessorFn: (log) => log.userAgent ?? '',
        enableSorting: false,
        cell: ({ row }) => (
          <div
            className='max-w-80 truncate text-muted-foreground'
            title={row.original.userAgent ?? ''}
          >
            {row.original.userAgent}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <div className='mb-4 flex items-center justify-between gap-2'>
        <h5 className='mb-0'>Client Logs</h5>
        <div className='flex gap-2'>
          <Button
            variant='outline-primary'
            onClick={() => selectedUser && loadLogs(selectedUser.value)}
            disabled={!selectedUser || loading}
          >
            <RefreshCw size={16} />
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <Button
            variant='outline-success'
            onClick={exportFilteredLogsToCsv}
            disabled={!filteredLogs.length}
          >
            <Download size={16} />
            Export CSV
          </Button>
        </div>
      </div>
      <div className='mb-4 flex flex-wrap items-end gap-2'>
        <div className='min-w-72 flex-[1.4]'>
          <Label className='mb-1'>User</Label>
          <Combobox
            options={userOptions}
            value={selectedUser}
            onChange={(option) => setSelectedUser(option)}
            placeholder='Select a user...'
            name='User'
            clearable
          />
        </div>
        <div className='min-w-52 flex-1'>
          <Label className='mb-1'>From</Label>
          <Input
            type='datetime-local'
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <ArrowRight size={16} className='mb-3 text-muted-foreground' />
        <div className='min-w-52 flex-1'>
          <Label className='mb-1'>To</Label>
          <Input
            type='datetime-local'
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        {(start || end) && (
          <Button
            variant='ghost'
            onClick={() => {
              setStart('');
              setEnd('');
            }}
          >
            Clear dates
          </Button>
        )}
      </div>

      <DataTable
        storageKey='client-logs'
        columns={columns}
        data={filteredLogs}
        getRowId={(log) => log.id}
        pageSize={10}
        initialSorting={[{ id: 'timestamp', desc: true }]}
        loading={loading}
        emptyIcon={selectedUser ? undefined : UserRound}
        emptyMessage={
          selectedUser
            ? 'No logs found for these dates'
            : 'Select a user above to see their logs'
        }
      />
    </div>
  );
}
