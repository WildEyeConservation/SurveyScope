import { useCallback, useEffect, useMemo, useState } from 'react';
import { generateClient } from 'aws-amplify/api';
import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';
import MyTable from './Table';
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
  variables: Record<string, unknown>
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

  const sortedReports = useMemo(
    () =>
      [...reports].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [reports]
  );

  const userLabel = (report: ErrorReport) => {
    const user = users.find((u) => u.id === report.userId);
    return user?.name
      ? `${user.name} (${report.userEmail || user.email || ''})`
      : report.userEmail || report.userId;
  };

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

  const tableHeadings = [
    { content: 'Timestamp', style: { width: '15%' }, sort: true },
    { content: 'User', style: { width: '20%' }, sort: true },
    { content: 'Message', style: { width: '35%' }, sort: true },
    { content: 'Page', style: { width: '20%' }, sort: true },
    { content: 'Details', style: { width: '10%' } },
  ];

  const tableData = sortedReports.map((report) => ({
    id: report.id,
    rowData: [
      new Date(report.createdAt).toLocaleString(),
      userLabel(report),
      report.message.length > 150
        ? `${report.message.slice(0, 150)}…`
        : report.message,
      pathOf(report.url),
      <Button variant='primary' size='sm' onClick={() => setSelected(report)}>
        View
      </Button>,
    ],
  }));

  return (
    <div className='mt-2'>
      <div className='d-flex justify-content-between align-items-center mb-3'>
        <h5 className='mb-0'>Error Reports</h5>
        <Button
          variant='outline-primary'
          size='sm'
          onClick={() => void loadReports()}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>
      {loadError && (
        <p className='text-danger'>Failed to load error reports: {loadError}</p>
      )}
      <MyTable
        tableData={tableData}
        tableHeadings={tableHeadings}
        pagination={true}
        itemsPerPage={10}
        emptyMessage={loading ? 'Loading...' : 'No error reports'}
      />
      <Modal
        show={selected !== null}
        onHide={() => setSelected(null)}
        size='xl'
      >
        <Modal.Header closeButton>
          <Modal.Title>Error Report</Modal.Title>
        </Modal.Header>
        {selected && (
          <Modal.Body>
            <dl className='mb-3'>
              <dt>Timestamp</dt>
              <dd>{new Date(selected.createdAt).toLocaleString()}</dd>
              <dt>User</dt>
              <dd>
                {userLabel(selected)}
                <div className='small text-muted'>{selected.userId}</div>
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
              className='border rounded p-2 small'
              style={{
                maxHeight: '40vh',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {selected.stack || 'No stack trace available'}
            </pre>
          </Modal.Body>
        )}
        <Modal.Footer>
          <Button
            variant='danger'
            disabled={deleting}
            onClick={() => selected && void deleteReport(selected)}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
          <Button variant='dark' onClick={() => setSelected(null)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
