import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { GlobalContext, TestingContext, UserContext } from '../Context';
import { Body, Footer, Header, Modal, Title } from '../Modal';
import { type FetcherType, type TaskPayload, TaskBuffer } from '../TaskBuffer';
import { fetchAllPaginatedResults } from '../utils';
import LightLocationView from './LightLocationView';
import ProjectContext from './ProjectContext';

type Props = {
  show: boolean;
  preset: { id: string; name: string };
  surveyId: string;
};

type LocationReferenceTask = TaskPayload & {
  id: string;
  message_id: string;
  location: { id: string; annotationSetId: string };
};

export default function EditLocationsModal({ show, preset, surveyId }: Props) {
  const { client, showModal } = useContext(GlobalContext)!;
  const { currentAnnoCount, setCurrentAnnoCount } = useContext(UserContext)!;
  const { organizationId } = useContext(TestingContext)!;
  const locationsRef = useRef<
    { testPresetId: string; locationId: string; annotationSetId: string }[]
  >([]);
  const locationIndexRef = useRef<number>(0);
  const [locations, setLocations] = useState<
    {
      testPresetId: string;
      locationId: string;
      annotationSetId: string;
    }[]
  >([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [maxAnnotations, setMaxAnnotations] = useState<number | ''>('');
  const [pendingCategoryId, setPendingCategoryId] = useState<string>('');
  const [pendingMaxAnnotations, setPendingMaxAnnotations] = useState<
    number | ''
  >('');
  const [removing, setRemoving] = useState(false);
  // Remounts the buffer after a removal so it pages over the shortened list.
  const [bufferKey, setBufferKey] = useState(0);
  const [poolSetIds, setPoolSetIds] = useState<string[]>([]);
  const currentLocation = useRef<{
    locationId: string;
    annotationSetId: string;
  } | null>(null);

  const fetcher: FetcherType<LocationReferenceTask> = useCallback(async () => {
    const loc = locationsRef.current[locationIndexRef.current];
    if (!loc) return null as unknown as LocationReferenceTask;
    locationIndexRef.current = locationIndexRef.current + 1;
    const id = crypto.randomUUID();
    return {
      id,
      message_id: id,
      location: {
        id: loc.locationId,
        annotationSetId: loc.annotationSetId,
      },
    };
  }, []);

  const applyFilters = useCallback(() => {
    setSelectedCategoryId(pendingCategoryId);
    setMaxAnnotations(pendingMaxAnnotations || '');
  }, [pendingCategoryId, pendingMaxAnnotations]);

  const refreshLocations = useCallback(async () => {
    setLoading(true);
    setLoadedCount(0);
    // @ts-ignore: fetchAllPaginatedResults generic inference too complex here
    const baseLocs = (await (fetchAllPaginatedResults as any)(
      // @ts-ignore: complex union types from generated client
      (client as any).models.TestPresetLocation.locationsByTestPresetId,
      {
        testPresetId: preset.id,
        selectionSet: [
          'testPresetId',
          'locationId',
          'annotationSetId',
        ] as const,
        limit: 10000,
      } as any,
    )) as any[];
    setPoolSetIds([
      ...new Set(baseLocs.map((l) => l.annotationSetId as string)),
    ]);

    // If no filters, keep as-is
    if (
      !selectedCategoryId &&
      (maxAnnotations === '' || maxAnnotations == null)
    ) {
      locationsRef.current = baseLocs;
      setLocations(baseLocs);
      locationIndexRef.current = 0;
      setIndex(0);
      setLoading(false);
      return;
    }

    // Apply filters similar to AddLocationsModal
    const filtered: {
      testPresetId: string;
      locationId: string;
      annotationSetId: string;
    }[] = [];
    const seenIds = new Set<string>();
    for (const loc of baseLocs) {
      try {
        // @ts-ignore selectionSet typing is complex in client
        const { data: location } = await (client as any).models.Location.get({
          id: loc.locationId,
          selectionSet: ['imageId', 'width', 'height', 'x', 'y'] as const,
        } as any);
        if (!location || location.width == null || location.height == null)
          continue;
        // @ts-ignore: fetchAllPaginatedResults generic inference too complex here
        const anns = (await (fetchAllPaginatedResults as any)(
          // @ts-ignore complex union types from generated client
          (client as any).models.Annotation.annotationsByImageIdAndSetId,
          {
            imageId: location.imageId,
            setId: { eq: loc.annotationSetId },
            selectionSet: ['x', 'y', 'categoryId'] as const,
          } as any,
        )) as any[];
        const minX = location.x - location.width / 2;
        const minY = location.y - location.height / 2;
        const maxX = location.x + location.width / 2;
        const maxY = location.y + location.height / 2;
        const inside = anns.filter(
          (a: any) => a.x >= minX && a.y >= minY && a.x <= maxX && a.y <= maxY,
        );
        if (
          selectedCategoryId &&
          !inside.some((a: any) => a.categoryId === selectedCategoryId)
        ) {
          setLoadedCount((c) => c + 1);
          continue;
        }
        const limit = maxAnnotations === '' ? null : Number(maxAnnotations);
        if (limit != null && inside.length > limit) {
          setLoadedCount((c) => c + 1);
          continue;
        }
        filtered.push(loc);
        if (!seenIds.has(loc.locationId)) {
          seenIds.add(loc.locationId);
          setLoadedCount(seenIds.size);
        }
      } catch {
        // ignore errors per item
      }
    }

    locationsRef.current = filtered;
    setLocations(filtered);
    locationIndexRef.current = 0;
    setIndex(0);
    setLoading(false);
  }, [client, preset.id, selectedCategoryId, maxAnnotations]);

  useEffect(() => {
    if (show) refreshLocations();
    else {
      setLocations([]);
      setIndex(0);
    }
  }, [show, preset.id, refreshLocations]);

  useEffect(() => {
    if (show) {
      setPendingCategoryId(selectedCategoryId);
      setPendingMaxAnnotations(maxAnnotations);
    }
  }, [show]);

  useEffect(() => {
    if (locations.length > 0) {
      const loc = locations[index];
      currentLocation.current = {
        locationId: loc.locationId,
        annotationSetId: loc.annotationSetId,
      };
    } else {
      currentLocation.current = null;
    }
  }, [index, locations]);

  const filtered = !!selectedCategoryId || maxAnnotations !== '';

  async function handleRemove() {
    const loc = locations[index];
    if (!loc) return;
    setRemoving(true);
    await (client as any).models.TestPresetLocation.delete({
      testPresetId: preset.id,
      locationId: loc.locationId,
      annotationSetId: loc.annotationSetId,
    } as any);
    const remaining = locations.filter((_, i) => i !== index);
    locationsRef.current = remaining;
    locationIndexRef.current = 0;
    setLocations(remaining);
    setIndex(Math.max(0, Math.min(index, remaining.length - 1)));
    setBufferKey((key) => key + 1);
    setRemoving(false);
  }

  async function saveAnnotations(cLocation: {
    locationId: string;
    annotationSetId: string;
  }) {
    // @ts-ignore selectionSet typing is complex in client
    const { data: location } = await (client as any).models.Location.get({
      id: cLocation.locationId,
      selectionSet: ['imageId', 'width', 'height', 'x', 'y'] as const,
    } as any);
    if (!location) return;

    // @ts-ignore complex union types from generated client
    const annotations = (await (fetchAllPaginatedResults as any)(
      // @ts-ignore complex union types from generated client
      (client as any).models.Annotation.annotationsByImageIdAndSetId,
      {
        imageId: location.imageId,
        setId: { eq: cLocation.annotationSetId },
        selectionSet: ['categoryId', 'x', 'y'] as const,
      } as any,
    )) as any[];

    const boundsxy: [number, number][] = [
      [location.x - location.width / 2, location.y - location.height / 2],
      [location.x + location.width / 2, location.y + location.height / 2],
    ];

    const annotationCounts: Record<string, number> = {};
    for (const annotation of annotations as any[]) {
      const isWithin =
        annotation.x >= boundsxy[0][0] &&
        annotation.y >= boundsxy[0][1] &&
        annotation.x <= boundsxy[1][0] &&
        annotation.y <= boundsxy[1][1];

      if (isWithin) {
        annotationCounts[annotation.categoryId] =
          (annotationCounts[annotation.categoryId] || 0) + 1;
      }
    }

    for (const [categoryId, count] of Object.entries(annotationCounts)) {
      // @ts-ignore complex union types from generated client
      const { data: locationAnnotationCount } = await (
        client as any
      ).models.LocationAnnotationCount.get({
        locationId: cLocation.locationId,
        categoryId,
        annotationSetId: cLocation.annotationSetId,
      } as any);

      if (locationAnnotationCount) {
        await (client as any).models.LocationAnnotationCount.update({
          locationId: cLocation.locationId,
          categoryId,
          annotationSetId: cLocation.annotationSetId,
          count,
        } as any);
      } else {
        await (client as any).models.LocationAnnotationCount.create({
          locationId: cLocation.locationId,
          categoryId,
          annotationSetId: cLocation.annotationSetId,
          count,
          group: organizationId,
        } as any);
      }
    }

    setCurrentAnnoCount({});
  }

  useEffect(() => {
    if (Object.keys(currentAnnoCount).length > 0 && currentLocation.current) {
      saveAnnotations(currentLocation.current);
    }
  }, [currentAnnoCount]);

  return (
    <ProjectContext surveyId={surveyId}>
      <Modal show={show} strict={true}>
        <Header>
          <Title>Edit Locations for {preset.name}</Title>
        </Header>
        <Body>
          <div
            className='flex flex-col gap-4 px-4 pt-0 pb-4'
            style={{ height: '75vh' }}
          >
            <div className='flex h-full flex-row gap-4'>
              {/* Left controls column */}
              <div
                className='mt-4 flex flex-col gap-4 border-r border-dark pe-4'
                style={{ width: '360px', maxWidth: '40%', overflowY: 'auto' }}
              >
                <div className='flex flex-col gap-3 border border-white/15 bg-white/[0.07] p-3'>
                  <div>
                    <Label className='mb-1'>Label</Label>
                    <NativeSelect
                      value={pendingCategoryId}
                      onChange={(e) => setPendingCategoryId(e.target.value)}
                    >
                      <option value=''>All labels</option>
                      {poolSetIds.map((setId) => (
                        <CategoryOptions key={setId} annotationSetId={setId} />
                      ))}
                    </NativeSelect>
                  </div>
                  <div>
                    <Label className='mb-1'>Max annotations</Label>
                    <Input
                      type='number'
                      min={0}
                      placeholder='No limit'
                      value={pendingMaxAnnotations}
                      onChange={(e) =>
                        setPendingMaxAnnotations(
                          e.target.value === ''
                            ? ''
                            : Number(e.target.value) || '',
                        )
                      }
                    />
                  </div>
                  <Button
                    variant='primary'
                    onClick={applyFilters}
                    disabled={loading}
                  >
                    Apply filter
                  </Button>
                  {filtered && (
                    <Button
                      variant='ghost'
                      disabled={loading}
                      onClick={() => {
                        setPendingCategoryId('');
                        setPendingMaxAnnotations('');
                        setSelectedCategoryId('');
                        setMaxAnnotations('');
                      }}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              </div>

              {/* Right image column */}
              <div className='flex h-full w-full grow flex-col'>
                {loading ? (
                  <p className='mt-4 flex items-center gap-2 p-2'>
                    <Spinner animation='border' size='sm' /> {loadedCount}{' '}
                    locations checked
                  </p>
                ) : locations.length === 0 ? (
                  <p className='mt-4 p-2 text-muted-foreground'>
                    {filtered
                      ? 'No locations match these filters.'
                      : 'No locations in this preset.'}
                  </p>
                ) : (
                  <>
                    <div className='mt-4 h-full w-full'>
                      <TaskBuffer
                        key={bufferKey}
                        index={index}
                        setIndex={setIndex}
                        fetcher={fetcher}
                        preloadN={5}
                        historyN={5}
                        renderTask={(task) => (
                          <LightLocationView
                            {...task}
                            location={task.location}
                          />
                        )}
                      />
                    </div>
                    <div className='flex w-full flex-col gap-2 pt-4'>
                      {locations[index] && (
                        <a
                          className={buttonVariants({
                            variant: 'outline-info',
                          })}
                          target='_blank'
                          href={`/surveys/${surveyId}/location/${locations[index].locationId}/${locations[index].annotationSetId}`}
                        >
                          Edit Location
                        </a>
                      )}
                      <Button
                        variant='danger'
                        onClick={handleRemove}
                        disabled={removing}
                      >
                        {removing ? 'Removing...' : 'Remove from pool'}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </Body>
        <Footer>
          <Button
            variant='ghost'
            className='mr-auto'
            onClick={() => showModal(null)}
          >
            Close
          </Button>
        </Footer>
      </Modal>
    </ProjectContext>
  );
}

function CategoryOptions({ annotationSetId }: { annotationSetId: string }) {
  const { client } = useContext(GlobalContext)!;
  const [cats, setCats] = useState<any[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const categories = (await fetchAllPaginatedResults(
        // @ts-ignore: complex union types from generated client
        (client as any).models.Category.categoriesByAnnotationSetId,
        {
          annotationSetId,
          selectionSet: ['id', 'name', 'annotationSetId'] as const,
        },
      )) as any[];
      if (!cancelled) {
        setCats(
          categories
            ?.filter((c: any) => c.annotationSetId === annotationSetId)
            ?.sort((a: any, b: any) => a.name.localeCompare(b.name)) || [],
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [annotationSetId]);
  return (
    <>
      {(Array.isArray(cats) ? (cats as any[]) : []).map((c: any) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </>
  );
}
