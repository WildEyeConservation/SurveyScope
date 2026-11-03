import DataTable, { type DataColumn } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import exportFromJSON from 'export-from-json';
import { DownloadIcon, SearchIcon } from 'lucide-react';
import { useContext, useEffect, useMemo, useState } from 'react';
import { neutraliseCsvRows } from '../../shared/csv';
import { Schema } from '../amplify/client-schema';
import { useUsers } from '../apiInterface';
import { GlobalContext } from '../Context';
import { Footer } from '../Modal';
import { fetchAllPaginatedResults } from '../utils';

type Range = 'today' | 'week' | 'month' | 'all' | 'custom';

const RANGES: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
];

const formatTimestamp = (timestamp: string | null | undefined) =>
  new Date(timestamp ?? '').toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

// Bounds in UTC for the user's local days.
function rangeBounds(range: Range, from: string, to: string) {
  const startOfDay = (day: string) => new Date(`${day}T00:00:00`);
  const endOfDay = (day: string) => new Date(`${day}T23:59:59.999`);
  const today = isoDay(new Date());
  const daysAgo = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return isoDay(date);
  };
  const [start, end] =
    range === 'today'
      ? [today, today]
      : range === 'week'
        ? [daysAgo(6), today]
        : range === 'month'
          ? [daysAgo(29), today]
          : range === 'custom'
            ? [from, to]
            : [null, null];
  if (!start || !end) return null;
  return {
    ge: startOfDay(start).toISOString(),
    le: endOfDay(end).toISOString(),
  };
}

export default function Logs({ projectId }: { projectId: string }) {
  const { client, showModal } = useContext(GlobalContext)!;
  const { users } = useUsers();
  const [logs, setLogs] = useState<Schema['AdminActionLog']['type'][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('month');
  const [from, setFrom] = useState(() => isoDay(new Date()));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [search, setSearch] = useState('');

  const userMap = useMemo(
    () =>
      Object.fromEntries(
        users.map((user) => [user.id, user.name ?? '']),
      ) as Record<string, string>,
    [users],
  );

  useEffect(() => {
    const bounds = rangeBounds(range, from, to);
    if (range === 'custom' && (!from || !to || from > to)) return;
    const controller = new AbortController();
    const { signal } = controller;
    const selectionSet = [
      'id',
      'userId',
      'message',
      'createdAt',
      'projectId',
    ] as const;
    setLoading(true);
    setError(null);
    fetchAllPaginatedResults(
      client.models.AdminActionLog.adminActionLogsByProjectId,
      {
        projectId,
        ...(bounds ? { filter: { createdAt: bounds } } : {}),
        selectionSet,
        signal,
      },
    )
      .catch(async (err) => {
        if (signal.aborted) throw err;
        // Fallback: list the project's logs and filter them here.
        const allProjectLogs = await fetchAllPaginatedResults(
          client.models.AdminActionLog.list,
          { filter: { projectId: { eq: projectId } }, selectionSet, signal },
        );
        return bounds
          ? allProjectLogs.filter(
              (log) =>
                (log.createdAt ?? '') >= bounds.ge &&
                (log.createdAt ?? '') <= bounds.le,
            )
          : allProjectLogs;
      })
      .then((allLogs) => {
        if (signal.aborted) return;
        setLogs(
          [...allLogs].sort((a, b) =>
            (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
          ),
        );
      })
      .catch((err) => {
        if (signal.aborted) return;
        console.error('Error fetching logs:', err);
        setError('The logs could not be loaded. Please try again.');
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client, projectId, range, from, to]);

  const query = search.trim().toLowerCase();
  // The name lives in the row so rows refresh once users have loaded.
  const visible = useMemo(
    () =>
      logs
        .map((log) => ({ ...log, userName: userMap[log.userId] || log.userId }))
        .filter(
          (log) =>
            !query ||
            (log.message ?? '').toLowerCase().includes(query) ||
            log.userName.toLowerCase().includes(query),
        ),
    [logs, userMap, query],
  );

  const handleDownload = () => {
    exportFromJSON({
      data: neutraliseCsvRows(
        visible.map((log) => ({
          Timestamp: new Date(log.createdAt ?? '').toLocaleString(),
          'User Name': userMap[log.userId] || log.userId,
          'User ID': log.userId,
          Message: log.message,
          'Project ID': log.projectId || '',
        })),
      ),
      fileName: `admin-logs-${projectId}-${range === 'custom' ? `${from}-to-${to}` : range}`,
      exportType: exportFromJSON.types.csv,
    });
  };

  const columns = useMemo<DataColumn<(typeof visible)[number]>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: 'Time',
        meta: { className: 'w-44 whitespace-nowrap tabular-nums' },
        cell: ({ row }) => formatTimestamp(row.original.createdAt),
      },
      {
        accessorKey: 'userName',
        header: 'User',
        meta: { className: 'max-w-40 truncate' },
      },
      {
        accessorKey: 'message',
        header: 'Message',
        meta: { className: 'whitespace-pre-wrap' },
      },
    ],
    [],
  );

  return (
    <>
      <div className='flex flex-col gap-3 p-4'>
        <div className='flex flex-wrap items-center gap-3'>
          <div className='relative min-w-48 flex-1'>
            <SearchIcon className='pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-[#6c757d]' />
            <Input
              type='search'
              aria-label='Search logs'
              placeholder='Search messages or users…'
              className='pl-9'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
                  'px-3 py-1.5 text-base leading-normal transition-colors',
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
            <div className='flex items-center gap-2 text-sm'>
              <Input
                type='date'
                aria-label='From'
                className='w-40'
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className='text-muted-foreground'>to</span>
              <Input
                type='date'
                aria-label='To'
                className='w-40'
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          )}
          <Button
            variant='outline-light'
            onClick={handleDownload}
            disabled={loading || visible.length === 0}
          >
            <DownloadIcon className='size-3.5' />
            Export CSV
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={error ? [] : visible}
          getRowId={(log) => log.id}
          initialSorting={[{ id: 'createdAt', desc: true }]}
          loading={loading}
          loadingMessage={
            <span className='flex items-center gap-2'>
              <Spinner animation='border' size='sm' />
              Loading logs...
            </span>
          }
          emptyMessage={
            error ? (
              <span className='text-danger'>{error}</span>
            ) : logs.length ? (
              'No entries match your search.'
            ) : (
              'Nothing was logged in this period.'
            )
          }
        />
      </div>
      <Footer>
        <Button
          variant='ghost'
          className='mr-auto'
          onClick={() => showModal(null)}
        >
          Close
        </Button>
      </Footer>
    </>
  );
}
