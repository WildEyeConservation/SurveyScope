import MyTable from './Table';
import { useEffect, useState } from 'react';
import { useMyMemberships, useMyOrganizations } from './data/memberships';
import { client } from './stores/appClient';
import { showModalAction as showModal, useModalToShow } from './stores/modalStore';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import type { UserStatsType } from './schemaTypes';
import exportFromJSON from 'export-from-json';
import { useUsers } from './apiInterface';
import Select from 'react-select';
import { Card, Button, Spinner } from 'react-bootstrap';
import SnapshotStatsModal from './SnapshotStatsModal';
import { fetchAllPaginatedResults } from './utils';

export default function UserStats() {
  const myOrganizationHook = useMyOrganizations();
  const myMembershipHook = useMyMemberships();
  const modalToShow = useModalToShow();
  const { users: allUsers } = useUsers();
  const [projects, setProjects] = useState<
    {
      id: string;
      name: string;
      annotationSets?: { id: string; name: string }[];
      organization: { name: string };
    }[]
  >([]);
  const [project, setProject] = useState<{
    label: string;
    value: string;
  } | null>(null);
  const [stats, setStats] = useState<
    Record<
      string,
      { observationCount: number; annotationCount: number; activeTime: number; sightingCount: number; searchTime: number; annotationTime: number; waitingTime: number }
    >
  >({});
  const [startDate, setStartDate] = useState<Date | null>(new Date());
  const [endDate, setEndDate] = useState<Date | null>(new Date());
  const [userStats, setUserStats] = useState<UserStatsType[]>([]);

  const [selectedSets, setSelectedSets] = useState<
    | {
      label: string;
      value: string;
    }[]
    | undefined
  >([]);

  // State for export loading
  const [exporting, setExporting] = useState(false);
  // State for initial fetch loading
  const [loadingStats, setLoadingStats] = useState(true);

  // Check if user is admin for the selected project
  const isProjectAdmin = project
    ? myMembershipHook.data?.find((m) => m.projectId === project.value)
      ?.isAdmin || false
    : false;

  const startString = startDate
    ? `${startDate?.getFullYear()}-${String(startDate?.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(startDate?.getDate()).padStart(2, '0')}`
    : null;
  const endString = endDate
    ? `${endDate?.getFullYear()}-${String(endDate?.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(endDate?.getDate()).padStart(2, '0')}`
    : null;

  useEffect(() => {
    async function loadProjects() {
      const userProjects = [
        ...new Set(myMembershipHook.data?.map((m) => m.projectId) || []),
      ];

      const projectPromises = userProjects.map((projectId) =>
        client.models.Project.get(
          { id: projectId },
          {
            selectionSet: [
              'id',
              'name',
              'annotationSets.id',
              'annotationSets.name',
              'organization.name',
            ] as string[],
          }
        )
      );

      const projectResults = await Promise.all(projectPromises);
      const validProjects = projectResults
        .map((result) => result.data)
        .filter(
          (project): project is NonNullable<typeof project> => project !== null
        );

      setProjects(validProjects as typeof projects);
    }

    loadProjects();
  }, [myOrganizationHook.data]);

  // Rapid fetch for initial data, then individual subscriptions for updates
  useEffect(() => {
    let cancelled = false;
    const subs: { unsubscribe: () => void }[] = [];
    const selectedSetIds = new Set(
      selectedSets?.map((set) => set.value) ?? []
    );
    const selectedProjectId = project?.value;

    // Reset state when selectedSets changes
    setUserStats([]);
    setLoadingStats(true);

    // Rapid fetch for initial data - only when annotation sets are selected
    async function rapidFetch() {
      // Only fetch if we have selected sets
      if (!selectedSets || selectedSets.length === 0) {
        setLoadingStats(false);
        return;
      }

      try {
        // Build filter for selected setIds
        const setIdConditions = selectedSets.map((set) => ({
          setId: { eq: set.value },
        }));
        const filter = { or: setIdConditions };

        const fetched = await fetchAllPaginatedResults<UserStatsType>(
          client.models.UserStats.list,
          { filter, limit: 10000 }
        );
        if (!cancelled) {
          setUserStats(fetched);
          setLoadingStats(false);
        }
      } catch (error) {
        console.error('Error fetching UserStats:', error);
        if (!cancelled) {
          setLoadingStats(false);
        }
      }
    }

    rapidFetch();

    // onUpdate - add or replace by composite key. The statistics aggregator
    // creates rows atomically in DynamoDB and emits a key-only AppSync update,
    // so the first live event for a new row can be an update.
    subs.push(
      client.models.UserStats.onUpdate().subscribe({
        next: (updatedItem) => {
          if (
            !cancelled &&
            updatedItem &&
            updatedItem.projectId === selectedProjectId &&
            selectedSetIds.has(updatedItem.setId)
          ) {
            setUserStats((prev) => {
              const exists = prev.some(
                (s) =>
                  s.userId === updatedItem.userId &&
                  s.date === updatedItem.date &&
                  s.setId === updatedItem.setId &&
                  s.projectId === updatedItem.projectId
              );
              if (!exists) return [...prev, updatedItem];
              return prev.map((s) =>
                s.userId === updatedItem.userId &&
                s.date === updatedItem.date &&
                s.setId === updatedItem.setId &&
                s.projectId === updatedItem.projectId
                  ? { ...s, ...updatedItem }
                  : s
              );
            });
          }
        },
        error: (error) => console.error('UserStats onUpdate error:', error),
      })
    );

    // Subscribe to real-time updates via custom pub/sub channels per annotation set
    // if (selectedSets && selectedSets.length > 0) {
    //   for (const set of selectedSets) {
    //     subs.push(
    //       client.subscriptions
    //         .receive({ namePrefix: `${set.value}-userstats` })
    //         .subscribe({
    //           next: (event) => {
    //             if (!cancelled && event?.content) {
    //               try {
    //                 const data = JSON.parse(event.content) as UserStatsType;
    //                 setUserStats((prev) => {
    //                   const exists = prev.some(
    //                     (s) =>
    //                       s.userId === data.userId &&
    //                       s.date === data.date &&
    //                       s.setId === data.setId &&
    //                       s.projectId === data.projectId
    //                   );
    //                   if (exists) {
    //                     return prev.map((s) =>
    //                       s.userId === data.userId &&
    //                         s.date === data.date &&
    //                         s.setId === data.setId &&
    //                         s.projectId === data.projectId
    //                         ? { ...s, ...data }
    //                         : s
    //                     );
    //                   }
    //                   return [...prev, data];
    //                 });
    //               } catch (e) {
    //                 console.error('Failed to parse userstats message:', e);
    //               }
    //             }
    //           },
    //           error: (error) =>
    //             console.error('UserStats receive error:', error),
    //         })
    //     );
    //   }
    // }

    return () => {
      cancelled = true;
      subs.forEach((sub) => sub.unsubscribe());
    };
  }, [project?.value, selectedSets]);

  useEffect(() => {
    // Compute all stats synchronously, then set state once
    const newStats: typeof stats = {};

    if (project && selectedSets && selectedSets.length > 0) {
      userStats
        .filter((s) => s != null)
        .forEach((s) => {
          if (
            !startString ||
            (s.date >= startString && (!endString || s.date <= endString))
          ) {
            if (selectedSets.some((set) => set.value === s.setId)) {
              if (!newStats[s.userId]) {
                newStats[s.userId] = {
                  observationCount: 0,
                  annotationCount: 0,
                  activeTime: 0,
                  sightingCount: 0,
                  searchTime: 0,
                  annotationTime: 0,
                  waitingTime: 0,
                };
              }
              newStats[s.userId].observationCount += s.observationCount;
              newStats[s.userId].annotationCount = Math.max(
                0,
                newStats[s.userId].annotationCount + s.annotationCount
              );
              newStats[s.userId].activeTime += s.activeTime;
              newStats[s.userId].sightingCount += s.sightingCount || 0;
              newStats[s.userId].searchTime += s.searchTime || 0;
              newStats[s.userId].annotationTime += s.annotationTime || 0;
              newStats[s.userId].waitingTime += s.waitingTime || 0;
            }
          }
        });
    }

    setStats(newStats);
  }, [project, startDate, endDate, userStats, selectedSets]);

  // Format duration in milliseconds to H:MM:SS format
  const formatDuration = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const tableData = Object.keys(stats).map((userId) => ({
    id: userId,
    rowData: [
      allUsers.find((u) => u.id == userId)?.name,
      formatDuration(stats[userId].activeTime),
      stats[userId].observationCount,
      (
        stats[userId].searchTime / 1000 / stats[userId].observationCount || 0
      ).toFixed(1),
      Math.max(0, stats[userId].annotationCount),
      stats[userId].sightingCount,
      formatDuration(stats[userId].searchTime),
      formatDuration(stats[userId].annotationTime),
      (
        stats[userId].observationCount / stats[userId].sightingCount || 0
      ).toFixed(1),
      formatDuration(stats[userId].waitingTime),
    ],
  }));

  const tableHeadings = [
    { content: 'Username', style: undefined },
    { content: 'Time spent', style: undefined },
    { content: `Jobs completed`, style: undefined },
    { content: 'Average search time (s/job)', style: undefined },
    { content: 'Total Annotations', style: undefined },
    { content: 'Total Sightings', style: undefined },
    { content: 'Total Search Time', style: undefined },
    { content: 'Total Annotation Time', style: undefined },
    { content: 'Locations/Sighting', style: undefined },
    { content: 'Waiting time', style: undefined },
  ];

  async function queryObservations(
    annotationSetId: string,
    lowerLimitOverride?: string,
    upperLimitOverride?: string
  ): Promise<any[]> {
    const lower = lowerLimitOverride ?? `${startString}T00:00:00Z`;
    const upper = upperLimitOverride ?? `${endString}T23:59:59Z`;
    const allObs = await fetchAllPaginatedResults(
      client.models.Observation.observationsByAnnotationSetId,
      {
        annotationSetId,
        createdAt: { between: [lower, upper] },
        limit: 10000,
        selectionSet: [
          'createdAt', 'annotationCount', 'timeTaken', 'waitingTime', 'owner', 'locationId',
          'location.id', 'location.confidence',
        ] as const,
      }
    );
    return allObs.map(o => ({
      createdAt: o.createdAt,
      annotationCount: o.annotationCount,
      timeTaken: o.timeTaken,
      waitingTime: o.waitingTime,
      owner: o.owner,
      locationId: o.locationId,
      confidence: (o as any).location?.confidence ?? null,
    }));
  }

  const handleExportDetailedStats = () => {
    if (!project || !selectedSets || selectedSets.length === 0) return;

    const setLabelMap = new Map(selectedSets.map((s) => [s.value, s.label]));
    const userLookup = new Map(allUsers.map((u) => [u.id, u.name]));

    const filtered = userStats
      .filter((s) => s != null)
      .filter((s) => {
        if (!selectedSets.some((set) => set.value === s.setId)) return false;
        if (startString && s.date < startString) return false;
        if (endString && s.date > endString) return false;
        return true;
      });

    const rows = filtered
      .map((s) => ({
        date: s.date,
        username: userLookup.get(s.userId) || s.userId,
        annotationSet: setLabelMap.get(s.setId) || s.setId,
        time_spent: formatDuration(s.activeTime),
        activeTime_ms: s.activeTime,
        jobs_completed: s.observationCount,
        avg_search_s_per_job:
          s.observationCount > 0
            ? ((s.searchTime || 0) / s.observationCount / 1000).toFixed(1)
            : '0.0',
        total_annotations: Math.max(0, s.annotationCount),
        total_sightings: s.sightingCount || 0,
        total_search_time: formatDuration(s.searchTime || 0),
        searchTime_ms: s.searchTime || 0,
        total_annotation_time: formatDuration(s.annotationTime || 0),
        annotationTime_ms: s.annotationTime || 0,
        locations_per_sighting:
          (s.sightingCount || 0) > 0
            ? (s.observationCount / s.sightingCount!).toFixed(1)
            : '0.0',
        waiting_time: formatDuration(s.waitingTime || 0),
        waitingTime_ms: s.waitingTime || 0,
      }))
      .sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : a.username < b.username ? -1 : 1
      );

    const fileName =
      `${project.label}_DetailedStats_${startString || 'all'}_${endString || 'all'}`.replace(
        / /g,
        '_'
      );
    exportFromJSON({ data: rows, fileName, exportType: exportFromJSON.types.csv });
  };

  const handleExportData = async () => {
    // Start export loading
    setExporting(true);
    try {
      const userLookup = new Map<string, string>();
      allUsers.forEach((u) => {
        userLookup.set(u.id, u.name || u.id);
        userLookup.set(u.id + '::' + u.id, u.name || u.id);
      });
      for (const annotationSetId of selectedSets?.map((s) => s.value) || []) {
        const observations = await queryObservations(annotationSetId);
        const fileName =
          `${project?.label}_Observations_${startString}_${endString}`.replace(
            / /g,
            '_'
          );
        const exportType = exportFromJSON.types.csv;
        exportFromJSON({
          data: observations.map((o) => {
            const { confidence, ...rest } = o;
            return {
              ...rest,
              annotationCount: Math.max(0, o.annotationCount || 0),
              owner: userLookup.get(o.owner),
              locationConfidence: confidence,
            };
          }),
          fileName,
          exportType,
        });
      }
    } finally {
      // End export loading
      setExporting(false);
    }
  };

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '1555px',
        marginTop: '16px',
        marginBottom: '16px',
      }}
    >
      <Card>
        <Card.Header>
          <Card.Title className='mb-0'>
            <h4 className='mb-0'>Annotation Statistics</h4>
          </Card.Title>
        </Card.Header>
        <Card.Body>
          <div className='d-flex justify-content-between align-items-center flex-wrap gap-2'>
            <div className='d-flex align-items-center gap-2'>
              <label htmlFor='start-date' className='mb-0'>
                From:
              </label>
              <DatePicker
                id='start-date'
                selected={startDate ?? undefined}
                onChange={(date) => setStartDate(date)}
                selectsStart
                startDate={startDate ?? undefined}
                endDate={endDate ?? undefined}
                className='form-control'
                isClearable
                dateFormat='yyyy/MM/dd'
                placeholderText='No start date'
              />
            </div>
            <div className='d-flex align-items-center gap-2'>
              <label htmlFor='end-date' className='mb-0'>
                To:
              </label>
              <DatePicker
                id='end-date'
                selected={endDate ?? undefined}
                onChange={(date) => setEndDate(date)}
                selectsEnd
                startDate={startDate ?? undefined}
                endDate={endDate ?? undefined}
                className='form-control'
                isClearable
                dateFormat='yyyy/MM/dd'
                placeholderText='No end date'
              />
            </div>
          </div>

          <div className='mt-3'>
            <label className='mb-2'>Select Survey</label>
            <Select
              className='text-black'
              value={project}
              options={projects.map((p) => ({
                label: `${p.name} (${p.organization.name})`,
                value: p.id,
              }))}
              onChange={(e) => {
                setProject(e);
                const sets = projects
                  .find((p) => p.id === e?.value)
                  ?.annotationSets?.map((s) => ({ label: s.name, value: s.id })) || [];
                setSelectedSets(sets);
              }}
              styles={{
                valueContainer: (base) => ({
                  ...base,
                  overflowY: 'auto',
                }),
              }}
            />
          </div>

          <div className='mt-3'>
            <label className=''>Select Annotation Sets</label>
            <Select
              className='text-black basic-multi-select'
              value={selectedSets}
              onChange={(e) => setSelectedSets([...e])}
              isMulti
              name='Annotation sets'
              options={
                projects
                  .find((p) => p.id == project?.value)
                  ?.annotationSets?.map((s) => ({
                    label: s.name,
                    value: s.id,
                  })) || []
              }
              classNamePrefix='select'
              closeMenuOnSelect={false}
              styles={{
                valueContainer: (base) => ({
                  ...base,
                  overflowY: 'auto',
                }),
              }}
            />
          </div>

          <div className='mt-3 overflow-x-auto'>
            {loadingStats ? (
              <div className='d-flex justify-content-center align-items-center py-5'>
                <Spinner animation='border' role='status'>
                  <span className='visually-hidden'>Loading stats...</span>
                </Spinner>
                <span className='ms-3'>Loading stats...</span>
              </div>
            ) : (
              <MyTable
                tableHeadings={tableHeadings}
                tableData={tableData}
                emptyMessage={
                  project && selectedSets && selectedSets.length > 0
                    ? 'No stats found'
                    : 'Select a survey and annotation sets to view stats'
                }
              />
            )}
          </div>
        </Card.Body>
        {isProjectAdmin && selectedSets && selectedSets.length > 0 && !loadingStats && (
          <Card.Footer className='d-flex justify-content-center gap-2'>
            <Button
              variant='primary'
              style={{ flex: 1 }}
              onClick={() => showModal('snapshotStats')}
              disabled={!project || !selectedSets?.length}
            >
              Snapshot
            </Button>
            <Button
              variant='primary'
              style={{ flex: 1 }}
              onClick={handleExportDetailedStats}
              disabled={!project || !selectedSets?.length || loadingStats}
            >
              Export Daily Stats
            </Button>
            <Button
              variant='primary'
              style={{ flex: 1 }}
              onClick={handleExportData}
              disabled={exporting}
            >
              {exporting ? 'Loading...' : 'Export Raw Observation Data'}
            </Button>
          </Card.Footer>
        )}
      </Card>
      <SnapshotStatsModal
        show={modalToShow === 'snapshotStats'}
        onHide={() => showModal(null)}
        projectLabel={project?.label}
        startDate={startDate}
        endDate={endDate}
        startString={startString}
        endString={endString}
        selectedSets={selectedSets}
        allUsers={allUsers.map((u) => ({ id: u.id, name: u.name || u.id }))}
        queryObservations={queryObservations}
      />
    </div>
  );
}
