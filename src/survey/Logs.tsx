import { useContext, useEffect, useState, useMemo, useRef } from 'react';
import { Button, Form, Card, Spinner } from 'react-bootstrap';
import { GlobalContext } from '../Context';
import { Schema } from '../amplify/client-schema';
import { fetchAllPaginatedResults } from '../utils';
import { Download } from 'lucide-react';
import exportFromJSON from 'export-from-json';
import { neutraliseCsvRows } from '../../shared/csv';
import { useUsers } from '../apiInterface';
import MyTable from '../Table';
import { Footer } from '../Modal';

export default function Logs({ projectId }: { projectId: string }) {
  const { client, showModal } = useContext(GlobalContext)!;
  const { users } = useUsers();
  const [logs, setLogs] = useState<Schema['AdminActionLog']['type'][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userMap = useMemo(() => {
    return users.reduce((acc, user) => {
      acc[user.id] = user.name ?? '';
      return acc;
    }, {} as Record<string, string>);
  }, [users]);
  
  // Date range filters
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('00:00');
  const [endTime, setEndTime] = useState<string>('23:59');

  const abortRef = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    return () => controller.abort();
  }, []);

  // Set default date range to today
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    setStartDate(today);
    setEndDate(today);
  }, []);

  const fetchLogs = async () => {
    if (!startDate || !endDate) {
      setError('Please select both start and end dates');
      return;
    }

    const { signal } = abortRef.current;
    setLoading(true);
    setError(null);

    try {
      // Build date-time strings for filtering
      const startDateTime = `${startDate}T${startTime}:00.000Z`;
      const endDateTime = `${endDate}T${endTime}:59.999Z`;

      // Query logs by projectId with createdAt filter
      // Note: We query all logs for the project, then filter by date range
      // since the index has createdAt as sort key
      const allLogs = await fetchAllPaginatedResults(
        client.models.AdminActionLog.adminActionLogsByProjectId,
        {
          projectId,
          filter: {
            createdAt: {
              ge: startDateTime,
              le: endDateTime,
            },
          },
          selectionSet: ['id', 'userId', 'message', 'createdAt', 'projectId'],
          signal,
        }
      ).catch(async (err) => {
        if (signal.aborted) throw err;
        // Fallback: if query fails, try listing all and filtering client-side
        const allProjectLogs = await fetchAllPaginatedResults(
          client.models.AdminActionLog.list,
          {
            filter: {
              projectId: { eq: projectId },
            },
            selectionSet: ['id', 'userId', 'message', 'createdAt', 'projectId'],
            signal,
          }
        );
        return allProjectLogs.filter((log) => {
          const logDate = new Date(log.createdAt ?? '');
          const start = new Date(startDateTime);
          const end = new Date(endDateTime);
          return logDate >= start && logDate <= end;
        });
      });

      // Sort by createdAt descending (newest first)
      const sortedLogs = allLogs.sort((a, b) => {
        const dateA = new Date(a.createdAt ?? '').getTime();
        const dateB = new Date(b.createdAt ?? '').getTime();
        return dateB - dateA;
      });

      setLogs(sortedLogs);
    } catch (err) {
      if (signal.aborted) return;
      console.error('Error fetching logs:', err);
      setError('Failed to fetch logs. Please try again.');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    if (startDate && endDate) {
      fetchLogs();
    }
  }, [projectId]); // Only fetch on mount or when projectId changes

  const handleDownload = () => {
    if (logs.length === 0) {
      alert('No logs to download');
      return;
    }

    // Format logs for export
    const exportData = logs.map((log) => ({
      Timestamp: new Date(log.createdAt ?? '').toLocaleString(),
      'User Name': userMap[log.userId] || log.userId,
      'User ID': log.userId,
      Message: log.message,
      'Project ID': log.projectId || '',
    }));

    exportFromJSON({
      data: neutraliseCsvRows(exportData),
      fileName: `admin-logs-${projectId}-${startDate}-to-${endDate}`,
      exportType: exportFromJSON.types.csv,
    });
  };

  const formatTimestamp = (timestamp: string | null | undefined) => {
    return new Date(timestamp ?? '').toLocaleString();
  };

  // Convert logs to tableData format
  const tableData = useMemo(() => {
    return logs.map((log) => ({
      id: log.id,
      rowData: [
        formatTimestamp(log.createdAt),
        userMap[log.userId] || log.userId,
        <span style={{ whiteSpace: 'pre-wrap' }}>{log.message}</span>,
      ],
    }));
  }, [logs, userMap]);

  const tableHeadings = [
    { content: 'Timestamp', sort: true },
    { content: 'User', sort: true },
    { content: 'Message', sort: false },
  ];

  return (
    <div className="d-flex flex-column gap-3">
      <Card>
        <Card.Header>
          <h5 className="mb-0">Filter Logs</h5>
        </Card.Header>
        <Card.Body>
          <div className="d-flex flex-column flex-md-row gap-3 align-items-md-end">
            <div className="flex-grow-1">
              <Form.Label>Start Date</Form.Label>
              <Form.Control
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex-grow-1">
              <Form.Label>Start Time</Form.Label>
              <Form.Control
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="flex-grow-1">
              <Form.Label>End Date</Form.Label>
              <Form.Control
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex-grow-1">
              <Form.Label>End Time</Form.Label>
              <Form.Control
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
            <div>
              <Button onClick={fetchLogs} disabled={loading}>
                {loading ? (
                  <>
                    <Spinner size="sm" className="me-2" />
                    Loading...
                  </>
                ) : (
                  'Apply Filter'
                )}
              </Button>
            </div>
          </div>
        </Card.Body>
      </Card>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <h5 className="mb-0">Admin Action Logs</h5>
          <Button
            variant="primary"
            size="sm"
            onClick={handleDownload}
            disabled={logs.length === 0}
          >
            <Download size={16} className="me-1" />
            Download CSV
          </Button>
        </Card.Header>
        <Card.Body>
          {loading ? (
            <div className="text-center py-4">
              <Spinner />
            </div>
          ) : (
            <MyTable
              tableHeadings={tableHeadings}
              tableData={tableData}
              pagination={true}
              itemsPerPage={25}
              emptyMessage="No logs found for the selected date range."
            />
          )}
        </Card.Body>
      </Card>
      <Footer>
        <Button variant='dark' onClick={() => showModal(null)}>
          Close
        </Button>
      </Footer>
    </div>
  );
}
