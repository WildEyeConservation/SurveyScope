import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { Size } from '../shared/testTileBounds';
import { startTest } from './api/tasks';
import { GlobalContext, ProjectContext } from './Context';
import type { Identifiable } from './TaskBuffer';
import { fetchAllPaginatedResults } from './utils';

export type TestCandidate = {
  locationId: string;
  annotationSetId: string;
  testPresetId: string;
};

export type TileSample = { tile: Size; image: Size };
// Set in jobs whose tests are grown to a tile; answers no sample while unknown.
export type TileSource = () => TileSample | undefined;

export default function useTesting(
  growRef?: MutableRefObject<TileSource | undefined>,
) {
  const { currentPM, project } = useContext(ProjectContext)!;
  const { client } = useContext(GlobalContext)!;

  // Use ref for index to prevent race conditions when multiple fetcher calls happen concurrently
  const iRef = useRef(0);
  const [zoom, setZoom] = useState<number | undefined>(undefined);
  const setupPromiseRef = useRef<Promise<void>>(Promise.resolve());

  const primaryCandidates = useRef<TestCandidate[]>([]);
  const currentLocation = useRef<TestCandidate | null>(null);
  const unfitRef = useRef<Set<string>>(new Set());
  // Tests are answered with this set's labels.
  const jobSetIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    async function setup() {
      unfitRef.current = new Set();
      jobSetIdRef.current = undefined;
      if (currentPM.queueId) {
        const { data: queue } = await client.models.Queue.get({
          id: currentPM.queueId,
        });
        if (queue?.zoom) setZoom(queue.zoom);
        jobSetIdRef.current = queue?.annotationSetId ?? undefined;
      }

      const { data: config } = await client.models.ProjectTestConfig.get({
        projectId: project.id,
      });

      if (!config) {
        return;
      }

      const presets = await fetchAllPaginatedResults(
        client.models.TestPresetProject.testPresetsByProjectId,
        {
          projectId: project.id,
          selectionSet: ['testPresetId'],
        },
      );

      await fetchPrimaryLocations(presets);
    }

    setupPromiseRef.current = setup();
  }, [currentPM]);

  async function fetchPrimaryLocations(presets: { testPresetId: string }[]) {
    const testedLocations = await fetchAllPaginatedResults(
      client.models.TestResult.testResultsByUserId,
      {
        userId: currentPM.userId,
        selectionSet: [
          'locationId',
          'createdAt',
          'testPresetId',
          'annotationSetId',
        ] as const,
      },
    );

    const seenLocations = testedLocations
      .filter(
        (l) =>
          l !== null && presets.some((p) => p.testPresetId === l.testPresetId),
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt ?? 0).getTime() -
          new Date(a.createdAt ?? 0).getTime(),
      )
      .filter(
        (location, index, self) =>
          index === self.findIndex((t) => t.locationId === location.locationId),
      )
      .reverse();

    const testLocations = [];
    for (const preset of presets) {
      const locations = await fetchAllPaginatedResults(
        client.models.TestPresetLocation.locationsByTestPresetId,
        {
          testPresetId: preset.testPresetId,
          selectionSet: ['locationId', 'createdAt', 'annotationSetId'] as const,
        },
      );

      testLocations.push(
        ...locations.map((l) => ({
          locationId: l.locationId,
          createdAt: l.createdAt,
          annotationSetId: l.annotationSetId,
          testPresetId: preset.testPresetId,
        })),
      );
    }

    // Lookup of valid current test preset-location pairs
    const testKeys = new Set(
      testLocations.map((l) => `${l.testPresetId}:${l.locationId}`),
    );

    // newest test locations, that have not yet been seen, are first up in the array
    const locations = testLocations
      .filter(
        (l) =>
          l !== null &&
          !seenLocations.some((sl) => sl.locationId === l.locationId),
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt ?? 0).getTime() -
          new Date(a.createdAt ?? 0).getTime(),
      );

    // add seen locations to the end of the array as backup (only if still part of current test presets)
    for (const seenLocation of seenLocations) {
      const key = `${seenLocation.testPresetId}:${seenLocation.locationId}`;
      if (testKeys.has(key)) {
        locations.push({
          locationId: seenLocation.locationId,
          createdAt: seenLocation.createdAt,
          annotationSetId: seenLocation.annotationSetId,
          testPresetId: seenLocation.testPresetId,
        });
      }
    }

    primaryCandidates.current = locations.map((l) => ({
      locationId: l.locationId,
      annotationSetId: l.annotationSetId,
      testPresetId: l.testPresetId,
    }));
  }

  // The server refuses tests the job's labels cannot answer, or that do not fit a tile.
  const getTestLocation = useCallback(async () => {
    const candidateEntries = [...primaryCandidates.current];
    const length = candidateEntries.length;
    const jobAnnotationSetId = jobSetIdRef.current;
    if (length === 0 || !jobAnnotationSetId) return null;
    const grow = growRef?.current;
    const tile = grow?.();
    if (grow && !tile) return null;

    // Capture and immediately increment the index to prevent race conditions
    // when multiple concurrent fetcher calls happen
    const startIndex = iRef.current;
    iRef.current = (startIndex + 1) % length;

    for (let attempt = 0; attempt < length; attempt++) {
      const currentIndex = (startIndex + attempt) % length;
      const entry = candidateEntries[currentIndex];
      if (unfitRef.current.has(entry.locationId)) continue;
      const started = await startTest({
        projectId: project.id,
        ...entry,
        jobAnnotationSetId,
        ...(tile ? { tile } : {}),
      });
      if (started) {
        iRef.current = (currentIndex + 1) % length;
        return { entry, started };
      }
      unfitRef.current.add(entry.locationId);
    }
    return null;
  }, [growRef, project.id]);

  const fetcher = useCallback(async (): Promise<Identifiable | null> => {
    const picked = await getTestLocation();
    currentLocation.current = picked?.entry ?? null;
    if (!picked) {
      console.warn('No location found for testing');
      return null;
    }
    const { entry: location, started } = picked;

    const id = crypto.randomUUID();
    const body = {
      id: id,
      message_id: id,
      location: {
        id: location.locationId,
        annotationSetId: location.annotationSetId,
      },
      allowOutside: true,
      taskTag: '',
      skipLocationWithAnnotations: false,
      zoom: zoom,
      testPresetId: location.testPresetId,
      testLeaseId: started.leaseId,
      testBox: started.grown ? started.box : undefined,
      testContext: started.context,
      ack: () => {
        console.log('Ack successful for test');
      },
      isTest: true,
    };
    return body;
  }, [getTestLocation, zoom]);

  const fetchWhenReady = useCallback(async (): Promise<Identifiable | null> => {
    await setupPromiseRef.current;
    if (primaryCandidates.current.length === 0) return null;
    return fetcher();
  }, [fetcher]);

  return {
    fetcher: fetchWhenReady,
    fetchedLocation: currentLocation.current,
  };
}
