import DataTable, { type DataColumn } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { generateClient } from 'aws-amplify/api';
import {
  ArrowRight,
  Download,
  RefreshCw,
  SearchIcon,
  SearchX,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { escapeCsvValue } from '../shared/csv';
import { useUsers } from './apiInterface';
import { graphqlErrorMessage } from './reportClientErrorCore';

const client = generateClient({ authMode: 'userPool' });

const listClientErrorReportsQuery = /* GraphQL */ `
  query ListClientErrorReports($limit: Int, $nextToken: String) {
    listClientErrorReports(limit: $limit, nextToken: $nextToken) {
      items {
        id
        message
        stack
        status
        url
        userAgent
        userId
        userEmail
        createdAt
      }
      nextToken
    }
  }
`;

const deleteClientErrorReportMutation = /* GraphQL */ `
  mutation DeleteClientErrorReport($input: DeleteClientErrorReportInput!) {
    deleteClientErrorReport(input: $input) {
      id
    }
  }
`;

type ErrorReport = {
  id: string;
  message: string;
  stack?: string | null;
  status?: string | null;
  url?: string | null;
  userAgent?: string | null;
  userId: string;
  userEmail?: string | null;
  createdAt: string;
};

async function runGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  try {
    const result = (await client.graphql({ query, variables })) as {
      data?: T;
    };
    if (!result.data) throw new Error('GraphQL response missing data');
    return result.data;
  } catch (error) {
    throw new Error(graphqlErrorMessage(error));
  }
}

async function fetchAllReports(): Promise<ErrorReport[]> {
  const reports: ErrorReport[] = [];
  let nextToken: string | null | undefined;
  do {
    const data = await runGraphql<{
      listClientErrorReports: {
        items: ErrorReport[];
        nextToken?: string | null;
      };
    }>(listClientErrorReportsQuery, { limit: 1000, nextToken });
    reports.push(...data.listClientErrorReports.items);
    nextToken = data.listClientErrorReports.nextToken;
  } while (nextToken);
  return reports;
}

function pathOf(url?: string | null): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export default function ErrorReports() {
  const { users } = useUsers();
  const [reports, setReports] = useState<ErrorReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ErrorReport | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<ComboboxOption | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const loadReports = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setReports(await fetchAllReports());
    } catch (error) {
      console.error('Failed to load error reports', error);
      setLoadError(graphqlErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const userLabel = (report: ErrorReport) => {
    const user = users.find((u) => u.id === report.userId);
    return user?.name
      ? `${user.name} (${report.userEmail || user.email || ''})`
      : report.userEmail || report.userId;
  };

  const userOptions = useMemo(() => {
    const options = new Map<string, ComboboxOption>();
    for (const report of reports) {
      if (!options.has(report.userId))
        options.set(report.userId, {
          value: report.userId,
          label: userLabel(report),
        });
    }
    return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, users]);

  const filteredReports = useMemo(() => {
    const query = search.trim().toLowerCase();
    const from = start ? new Date(start).getTime() : -Infinity;
    const to = end ? new Date(end).getTime() : Infinity;
    return reports.filter((report) => {
      const time = new Date(report.createdAt).getTime();
      if (time < from || time > to) return false;
      if (selectedUser && report.userId !== selectedUser.value) return false;
      return (
        !query ||
        [report.message, report.stack, report.url, report.status]
          .filter(Boolean)
          .some((text) => text!.toLowerCase().includes(query))
      );
    });
  }, [reports, search, selectedUser, start, end]);

  const hasFilters = !!(search || selectedUser || start || end);

  function clearFilters() {
    setSearch('');
    setSelectedUser(null);
    setStart('');
    setEnd('');
  }

  function exportFilteredReportsToCsv() {
    const header = [
      'timestamp',
      'userId',
      'userEmail',
      'status',
      'url',
      'message',
      'stack',
      'userAgent',
    ];
    const rows = filteredReports.map((report) =>
      [
        new Date(report.createdAt).toISOString(),
        report.userId,
        report.userEmail || '',
        report.status || '',
        report.url || '',
        report.message,
        report.stack || '',
        report.userAgent || '',
      ]
        .map(escapeCsvValue)
        .join(','),
    );
    const csv = [header.join(','), ...rows].join('\r\n');
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'error_reports.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function deleteReport(report: ErrorReport) {
    setDeleting(true);
    try {
      await runGraphql(deleteClientErrorReportMutation, {
        input: { id: report.id },
      });
      setReports((current) => current.filter((r) => r.id !== report.id));
      setSelected(null);
    } catch (error) {
      console.error('Failed to delete error report', error);
      alert('Failed to delete the error report.');
    } finally {
      setDeleting(false);
    }
  }

  const columns: DataColumn<ErrorReport>[] = [
    {
      id: 'timestamp',
      header: 'Timestamp',
      accessorFn: (report) => new Date(report.createdAt).getTime(),
      cell: ({ row }) =>
        new Date(row.original.createdAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      meta: { className: 'whitespace-nowrap' },
    },
    { id: 'user', header: 'User', accessorFn: userLabel },
    {
      id: 'message',
      header: 'Message',
      accessorFn: (report) => report.message,
      cell: ({ row }) => (
        <div className='line-clamp-2 max-w-xl' title={row.original.message}>
          {row.original.message}
        </div>
      ),
    },
    {
      id: 'page',
      header: 'Page',
      accessorFn: (report) => pathOf(report.url),
      cell: ({ getValue }) => (
        <div className='max-w-64 truncate font-mono text-sm'>
          {getValue<string>()}
        </div>
      ),
    },
    {
      id: 'details',
      header: 'Details',
      enableSorting: false,
      cell: ({ row }) => (
        <Button variant='primary' onClick={() => setSelected(row.original)}>
          View
        </Button>
      ),
      meta: { className: 'w-px text-center' },
    },
  ];

  return (
    <div>
      <div className='mb-4 flex items-center justify-between gap-2'>
        <h5 className='mb-0'>Error Reports</h5>
        <div className='flex gap-2'>
          <Button
            variant='outline-primary'
            onClick={() => void loadReports()}
            disabled={loading}
          >
            <RefreshCw size={16} />
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <Button
            variant='outline-success'
            onClick={exportFilteredReportsToCsv}
            disabled={!filteredReports.length}
          >
            <Download size={16} />
            Export CSV
          </Button>
        </div>
      </div>
      <div className='mb-4 flex flex-wrap items-end gap-2'>
        <div className='min-w-72 flex-[1.4]'>
          <Label className='mb-1'>Search</Label>
          <div className='relative'>
            <SearchIcon className='pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-[#6c757d]' />
            <Input
              type='search'
              aria-label='Search error reports'
              placeholder='Message, stack trace, page or status…'
              className='pl-9'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className='min-w-60 flex-1'>
          <Label className='mb-1'>User</Label>
          <Combobox
            options={userOptions}
            value={selectedUser}
            onChange={setSelectedUser}
            placeholder='All users'
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
        {hasFilters && (
          <Button variant='ghost' onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>
      {loadError && (
        <p className='text-danger'>Failed to load error reports: {loadError}</p>
      )}
      <DataTable
        storageKey='error-reports'
        columns={columns}
        data={filteredReports}
        getRowId={(report) => report.id}
        pageSize={10}
        initialSorting={[{ id: 'timestamp', desc: true }]}
        loading={loading}
        emptyIcon={reports.length ? SearchX : undefined}
        emptyMessage={
          reports.length
            ? 'No error reports match these filters'
            : 'No error reports'
        }
      />
      <Dialog
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
      >
        <DialogContent size='xl'>
          <DialogHeader closeButton>
            <DialogTitle>Error Report</DialogTitle>
          </DialogHeader>
          {selected && (
            <DialogBody>
              <dl className='mb-4'>
                <dt>Timestamp</dt>
                <dd>{new Date(selected.createdAt).toLocaleString()}</dd>
                <dt>User</dt>
                <dd>
                  {userLabel(selected)}
                  <div className='text-sm text-muted-foreground'>
                    {selected.userId}
                  </div>
                </dd>
                <dt>URL</dt>
                <dd style={{ wordBreak: 'break-all' }}>
                  {selected.url || 'N/A'}
                </dd>
                <dt>Status</dt>
                <dd>{selected.status || 'N/A'}</dd>
                <dt>User Agent</dt>
                <dd>{selected.userAgent || 'N/A'}</dd>
                <dt>Message</dt>
                <dd style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {selected.message}
                </dd>
              </dl>
              <h6>Stack Trace</h6>
              <pre
                className='mb-4 border p-2 text-sm'
                style={{
                  maxHeight: '40vh',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {selected.stack || 'No stack trace available'}
              </pre>
            </DialogBody>
          )}
          <DialogFooter>
            <Button
              variant='ghost'
              className='mr-auto'
              onClick={() => setSelected(null)}
            >
              Close
            </Button>
            <Button
              variant='danger'
              disabled={deleting}
              onClick={() => selected && void deleteReport(selected)}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
