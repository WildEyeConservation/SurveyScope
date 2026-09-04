import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal } from 'react-bootstrap';
import exportFromJSON from 'export-from-json';
import MyTable from './Table';
import {
  eventToContribution,
  fetchAllWorkflowEvents,
} from './workflowEvents';
import {
  buildWorkflowSections,
  localDateString,
  sectionToCsvRows,
  type WorkflowSection,
} from './workflowStatsSections';

interface Props {
  show: boolean;
  onHide: () => void;
  client: unknown;
  projectId: string;
  projectLabel: string;
  runs: { runId: string; displayName: string }[];
  startDate: Date | null;
  endDate: Date | null;
  userName: (userId: string) => string;
}

/**
 * Recomputes the per-user tables for a time-of-day window, e.g. one morning
 * shift, by reading the raw task events rather than the daily buckets. The
 * window runs from the start time on the screen's "From" date to the end time
 * on its "To" date, in local time.
 */
export default function WorkflowSnapshotModal({
  show,
  onHide,
  client,
  projectId,
  projectLabel,
  runs,
  startDate,
  endDate,
  userName,
}: Props) {
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime] = useState('23:59');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<WorkflowSection[] | null>(null);

  useEffect(() => {
    if (!show) {
      setSections(null);
      setError(null);
    }
  }, [show]);

  const startString = localDateString(startDate);
  const endString = localDateString(endDate);
  const canRun = Boolean(startString && endString && runs.length > 0);

  async function runSnapshot() {
    if (!startString || !endString) return;
    setLoading(true);
    setError(null);
    setProgress(0);
    try {
      const lower = new Date(`${startString}T${startTime}:00`);
      const upper = new Date(`${endString}T${endTime}:59.999`);
      if (upper < lower) throw new Error('The end of the window is before its start.');
      const events = await fetchAllWorkflowEvents(
        client,
        {
          projectId,
          runIds: runs.map((run) => run.runId),
          startAt: lower.toISOString(),
          endAt: upper.toISOString(),
        },
        setProgress
      );
      setSections(buildWorkflowSections(events.map(eventToContribution), userName));
    } catch (snapshotError) {
      setError(
        snapshotError instanceof Error
          ? snapshotError.message
          : 'Failed to load the snapshot'
      );
    } finally {
      setLoading(false);
    }
  }

  const windowLabel = useMemo(
    () =>
      startString && endString
        ? `${startString} ${startTime} to ${endString} ${endTime}`
        : 'Set From and To dates on the statistics screen first.',
    [startString, endString, startTime, endTime]
  );

  function exportSnapshot() {
    if (!sections) return;
    sections.forEach((section) => {
      exportFromJSON({
        data: sectionToCsvRows(section),
        fileName: `${projectLabel}_${section.label}_Snapshot_${startString}_${startTime}_${endString}_${endTime}`.replace(
          /[\s:]/g,
          '_'
        ),
        exportType: exportFromJSON.types.csv,
      });
    });
  }

  return (
    <Modal show={show} onHide={onHide} size='xl' backdrop='static'>
      <Modal.Header closeButton>
        <Modal.Title>Snapshot for {projectLabel}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className='text-muted mb-3'>
          Totals for a time-of-day window, in local time. Window: {windowLabel}
        </p>
        <div className='d-flex align-items-end gap-3 flex-wrap'>
          <div>
            <label htmlFor='snapshot-start-time' className='form-label mb-1'>
              Start time on {startString ?? '—'}
            </label>
            <input
              id='snapshot-start-time'
              type='time'
              className='form-control'
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor='snapshot-end-time' className='form-label mb-1'>
              End time on {endString ?? '—'}
            </label>
            <input
              id='snapshot-end-time'
              type='time'
              className='form-control'
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </div>
          <Button
            variant='primary'
            onClick={runSnapshot}
            disabled={loading || !canRun || !startTime || !endTime}
          >
            {loading ? `Loading… ${progress} events` : 'Run snapshot'}
          </Button>
        </div>

        {error && (
          <Alert variant='danger' className='mt-3'>
            {error}
          </Alert>
        )}

        {sections?.length === 0 && (
          <Alert variant='info' className='mt-3'>
            No completions in this window.
          </Alert>
        )}

        {sections?.map((section) => (
          <div key={section.workflowType} className='mt-4'>
            <h5 className='mb-2'>{section.label}</h5>
            <div className='overflow-x-auto'>
              <MyTable
                tableHeadings={section.headings}
                tableData={[
                  ...section.rows.map((row) => ({
                    id: row.id,
                    rowData: row.cells,
                  })),
                  ...(section.footer
                    ? [
                        {
                          id: `${section.workflowType}:__total`,
                          rowData: section.footer.map((cell, index) => (
                            <strong key={index}>{cell}</strong>
                          )),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          </div>
        ))}
      </Modal.Body>
      <Modal.Footer>
        <Button
          variant='success'
          onClick={exportSnapshot}
          disabled={loading || !sections || sections.length === 0}
        >
          Export snapshot
        </Button>
        <Button variant='dark' onClick={onHide}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
