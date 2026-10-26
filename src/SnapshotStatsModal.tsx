import { useState } from 'react';
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
import MyTable from './Table';
import exportFromJSON from 'export-from-json';

type AnnotationSet = { label: string; value: string };
type UserType = { id: string; name: string };

interface StatsEntry {
  observationCount: number;
  annotationCount: number;
  activeTime: number;
  sightingCount: number;
  searchTime: number;
  searchCount: number;
  annotationTime: number;
  waitingTime: number;
}

type Props = {
  show: boolean;
  onHide: () => void;
  projectLabel?: string;
  startDate: Date | null;
  endDate: Date | null;
  startString: string | null;
  endString: string | null;
  selectedSets?: AnnotationSet[];
  allUsers: UserType[];
  queryObservations: (
    annotationSetId: string,
    lowerLimitOverride?: string,
    upperLimitOverride?: string
  ) => Promise<any[]>;
};

export default function SnapshotStatsModal({
  show,
  onHide,
  projectLabel,
  startDate,
  endDate,
  startString,
  endString,
  selectedSets,
  allUsers,
  queryObservations,
}: Props) {
  const [snapshotStartTime, setSnapshotStartTime] = useState('00:00');
  const [snapshotEndTime, setSnapshotEndTime] = useState('23:59');
  const [snapshotStats, setSnapshotStats] = useState<
    Record<string, StatsEntry>
  >({});
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  // Format duration in milliseconds to H:MM:SS format
  const formatDuration = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const tableHeadings = [
    { content: 'Username' },
    { content: 'Time spent' },
    { content: 'Jobs completed' },
    { content: 'Average search time (s/job)' },
    { content: 'Total Annotations' },
    { content: 'Total Sightings' },
    { content: 'Total Search Time' },
    { content: 'Total Annotation Time' },
    { content: 'Locations/Sighting' },
    { content: 'Waiting time' },
  ];

  const handleRunSnapshot = async () => {
    setSnapshotLoading(true);
    const tempStats: Record<string, StatsEntry> = {};
    if (!snapshotStartTime || !snapshotEndTime || !startString || !endString) {
      setSnapshotLoading(false);
      return;
    }
    const lowerLimitDate = new Date(`${startString}T${snapshotStartTime}:00`);
    const upperLimitDate = new Date(`${endString}T${snapshotEndTime}:59`);
    const lowerLimit = lowerLimitDate.toISOString();
    const upperLimit = upperLimitDate.toISOString();
    for (const s of selectedSets || []) {
      const observations = await queryObservations(
        s.value,
        lowerLimit,
        upperLimit
      );
      observations.forEach((o: any) => {
        const ownerValue = o.owner || '';
        const userId = ownerValue.includes('::')
          ? o.owner.split('::')[1]
          : ownerValue;
        if (!userId) {
          console.warn('Observation missing owner, skipping', o);
          return;
        }
        if (!tempStats[userId]) {
          tempStats[userId] = {
            observationCount: 0,
            annotationCount: 0,
            activeTime: 0,
            sightingCount: 0,
            searchTime: 0,
            searchCount: 0,
            annotationTime: 0,
            waitingTime: 0,
          };
        }
        const entry = tempStats[userId];
        entry.observationCount += 1;
        entry.annotationCount = Math.max(0, entry.annotationCount + (o.annotationCount || 0));
        const sighting = o.annotationCount > 0 ? 1 : 0;
        entry.sightingCount += sighting;
        let timeTaken = o.timeTaken || 0;
        // Mirror lambda safeguard: drop obviously bad durations
        if (timeTaken > (sighting ? 900_000 : 120_000)) {
          timeTaken = 0;
        }
        entry.activeTime += timeTaken;
        entry.searchTime += (1 - sighting) * timeTaken;
        entry.searchCount += 1 - sighting;
        entry.annotationTime += sighting * timeTaken;
        entry.waitingTime += Math.max(0, o.waitingTime || 0);
      });
    }
    setSnapshotStats(tempStats);
    setSnapshotLoading(false);
  };

  const handleExportSnapshot = () => {
    const data = Object.keys(snapshotStats).map((userId) => {
      const statsEntry = snapshotStats[userId];
      return {
        Username: allUsers.find((u) => u.id == userId)?.name || userId,
        'Time spent': formatDuration(statsEntry.activeTime),
        'Jobs completed': statsEntry.observationCount,
        'Average search time (s/job)': (
          statsEntry.searchTime /
            1000 /
            (statsEntry.searchCount || statsEntry.observationCount || 1)
        ).toFixed(1),
        'Total Annotations': Math.max(0, statsEntry.annotationCount),
        'Total Sightings': statsEntry.sightingCount,
        'Total Search Time': formatDuration(statsEntry.searchTime),
        'Total Annotation Time': formatDuration(statsEntry.annotationTime),
        'Locations/Sighting': (
          statsEntry.observationCount / statsEntry.sightingCount || 0
        ).toFixed(1),
        'Waiting time': formatDuration(statsEntry.waitingTime),
      };
    });
    const fileName =
      `${projectLabel}_Snapshot_${startString}_${endString}_${snapshotStartTime}_${snapshotEndTime}`.replace(
        / /g,
        '_'
      );
    exportFromJSON({ data, fileName, exportType: exportFromJSON.types.csv });
  };

  return (
    <Dialog open={show} onOpenChange={(o) => !o && onHide()}>
      <DialogContent
        size='xl'
        onPointerDownOutside={(e) => e.preventDefault()}
      >
      <DialogHeader>
        <DialogTitle>Snapshot Stats for {projectLabel}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className='flex flex-col gap-2'>
          <div className='flex justify-between items-center gap-2'>
            <div style={{ width: '150px' }}>
              <label>Date: {startDate?.toLocaleDateString()}</label>
              <label>Start Time:</label>
            </div>
            <Input
              type='time'
              value={snapshotStartTime}
              onChange={(e) => setSnapshotStartTime(e.target.value)}
            />
          </div>
          <div className='flex justify-between items-center gap-2'>
            <div style={{ width: '150px' }}>
              <label>Date: {endDate?.toLocaleDateString()}</label>
              <label>End Time:</label>
            </div>
            <Input
              type='time'
              value={snapshotEndTime}
              onChange={(e) => setSnapshotEndTime(e.target.value)}
            />
          </div>
        </div>
        <div className='mt-4 overflow-x-auto'>
          <MyTable
            tableHeadings={tableHeadings}
            tableData={Object.keys(snapshotStats).map((userId) => ({
              id: userId,
              rowData: [
                allUsers.find((u) => u.id == userId)?.name,
                formatDuration(snapshotStats[userId].activeTime),
                snapshotStats[userId].observationCount,
                (
                  snapshotStats[userId].searchTime /
                    1000 /
                    (snapshotStats[userId].searchCount ||
                      snapshotStats[userId].observationCount ||
                      1)
                ).toFixed(1),
                Math.max(0, snapshotStats[userId].annotationCount),
                snapshotStats[userId].sightingCount,
                formatDuration(snapshotStats[userId].searchTime),
                formatDuration(snapshotStats[userId].annotationTime),
                (
                  snapshotStats[userId].observationCount /
                    snapshotStats[userId].sightingCount || 0
                ).toFixed(1),
                formatDuration(snapshotStats[userId].waitingTime),
              ],
            }))}
            emptyMessage="No snapshot stats. Please select time range and click 'Run Snapshot'."
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          variant='success'
          onClick={handleExportSnapshot}
          disabled={snapshotLoading || Object.keys(snapshotStats).length === 0}
        >
          Export Snapshot
        </Button>
        <Button
          variant='primary'
          onClick={handleRunSnapshot}
          disabled={snapshotLoading || !snapshotStartTime || !snapshotEndTime}
        >
          {snapshotLoading ? 'Loading...' : 'Run Snapshot'}
        </Button>
        <Button variant='dark' onClick={onHide}>
          Close
        </Button>
      </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
