import DataTable from '@/components/DataTable';
import { columnsFromHeadings } from '@/components/cellColumns';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { Spinner } from '@/components/ui/spinner';
import exportFromJSON from 'export-from-json';
import { DownloadIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { neutraliseCsvRows } from '../shared/csv';
import { fetchWorkflowTotals } from './workflowEvents';
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
      if (upper < lower)
        throw new Error('The end of the window is before its start.');
      const totals = await fetchWorkflowTotals(
        client,
        {
          projectId,
          runIds: runs.map((run) => run.runId),
          startAt: lower.toISOString(),
          endAt: upper.toISOString(),
        },
        setProgress,
      );
      setSections(buildWorkflowSections(totals, userName));
    } catch (snapshotError) {
      setError(
        snapshotError instanceof Error
          ? snapshotError.message
          : 'Failed to load the snapshot',
      );
    } finally {
      setLoading(false);
    }
  }

  function exportSnapshot() {
    if (!sections) return;
    sections.forEach((section) => {
      exportFromJSON({
        data: neutraliseCsvRows(sectionToCsvRows(section)),
        fileName:
          `${projectLabel}_${section.label}_Snapshot_${startString}_${startTime}_${endString}_${endTime}`.replace(
            /[\s:]/g,
            '_',
          ),
        exportType: exportFromJSON.types.csv,
      });
    });
  }

  return (
    <Dialog open={show} onOpenChange={(o) => !o && onHide()}>
      <DialogContent size='xl' onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader closeButton>
          <DialogTitle>Snapshot · {projectLabel}</DialogTitle>
        </DialogHeader>
        <DialogBody className='flex flex-col gap-4'>
          {!startString || !endString ? (
            <Alert variant='info'>
              Pick a date range on the statistics page first.
            </Alert>
          ) : (
            <div className='flex flex-wrap items-end gap-3'>
              {(
                [
                  ['From', startString, startTime, setStartTime],
                  ['To', endString, endTime, setEndTime],
                ] as const
              ).map(([label, date, time, setTime]) => (
                <div key={label}>
                  <Label htmlFor={`snapshot-${label}`} className='mb-1'>
                    {label}
                  </Label>
                  <div className='flex'>
                    <span className='flex items-center border border-r-0 border-white/30 bg-white/[0.07] px-3 tabular-nums'>
                      {date}
                    </span>
                    <Input
                      id={`snapshot-${label}`}
                      type='time'
                      className='w-36'
                      value={time}
                      onChange={(event) => setTime(event.target.value)}
                    />
                  </div>
                </div>
              ))}
              <Button
                variant='primary'
                onClick={runSnapshot}
                disabled={loading || !canRun || !startTime || !endTime}
              >
                {loading ? (
                  <>
                    <Spinner size='sm' />
                    {progress.toLocaleString()} completions read
                  </>
                ) : (
                  'Run snapshot'
                )}
              </Button>
              <span className='basis-full text-xs text-muted-foreground'>
                Dates come from the statistics page; pick the times of day here,
                in local time.
              </span>
            </div>
          )}

          {error && <Alert variant='danger'>{error}</Alert>}

          {sections?.length === 0 && (
            <Alert variant='info'>No completions in this window.</Alert>
          )}

          {sections?.map((section) => (
            <div key={section.workflowType}>
              <div className='mb-2 font-semibold'>{section.label}</div>
              <div className='overflow-x-auto'>
                <DataTable
                  storageKey={`workflow-snapshot-${section.workflowType}`}
                  columns={columnsFromHeadings(section.headings)}
                  data={section.rows.map((row) => ({
                    id: row.id,
                    cells: row.cells,
                  }))}
                  getRowId={(row) => row.id}
                  footer={section.footer ?? undefined}
                />
              </div>
            </div>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant='ghost' className='mr-auto' onClick={onHide}>
            Close
          </Button>
          <Button
            variant='outline-primary'
            onClick={exportSnapshot}
            disabled={loading || !sections || sections.length === 0}
          >
            <DownloadIcon className='size-4' />
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
