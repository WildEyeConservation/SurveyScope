import { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { Button, Form, Spinner } from 'react-bootstrap';
import { Modal, Header, Title, Body, Footer } from '../Modal';
import { UserContext, TestingContext } from '../Context';
import { client } from '../stores/appClient';
import { showModalAction as showModal } from '../stores/modalStore';
import { fetchAllPaginatedResults } from '../utils';
import { type FetcherType, type TaskPayload, TaskBuffer } from '../TaskBuffer';
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
  const currentLocation = useRef<{
    locationId: string;
    annotationSetId: string;
  } | null>(null);

  const fetcher: FetcherType<LocationReferenceTask> = useCallback(async () => {
    const loc = locationsRef.current[locationIndexRef.current];
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
      } as any
    )) as any[];

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
          } as any
        )) as any[];
        const minX = location.x - location.width / 2;
        const minY = location.y - location.height / 2;
        const maxX = location.x + location.width / 2;
        const maxY = location.y + location.height / 2;
        const inside = anns.filter(
          (a: any) => a.x >= minX && a.y >= minY && a.x <= maxX && a.y <= maxY
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
  }, [preset.id, selectedCategoryId, maxAnnotations]);

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

  async function handleRemove() {
    const loc = locations[index];
    if (!loc) return;
    setRemoving(true);
    await (client as any).models.TestPresetLocation.delete({
      testPresetId: preset.id,
      locationId: loc.locationId,
      annotationSetId: loc.annotationSetId,
    } as any);
    await refreshLocations();
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
      } as any
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
            className='d-flex flex-column gap-3 px-3 pb-3 pt-0'
            style={{ height: '75vh' }}
          >
            {loading ? (
              <p className='d-flex align-items-center gap-2 p-2'>
                <Spinner animation='border' size='sm' /> {loadedCount} locations
                checked
              </p>
            ) : locations.length === 0 ? (
              <p>No locations in this preset.</p>
            ) : (
              <div className='d-flex flex-row gap-3 h-100'>
                {/* Left controls column */}
                <div
                  className='d-flex flex-column gap-3 border-end border-dark mt-3 pe-3'
                  style={{ width: '360px', maxWidth: '40%', overflowY: 'auto' }}
                >
                  <Form.Group className='d-flex flex-column gap-2'>
                    <Form.Group>
                      <Form.Label className='mb-0'>Label filter</Form.Label>
                      <Form.Select
                        value={pendingCategoryId}
                        onChange={(e) => setPendingCategoryId(e.target.value)}
                      >
                        <option value=''>All labels</option>
                        {locations[index] && (
                          <CategoryOptions
                            annotationSetId={locations[index].annotationSetId}
                          />
                        )}
                      </Form.Select>
                    </Form.Group>
                    <Form.Group>
                      <Form.Label className='mb-0'>Max annotations</Form.Label>
                      <Form.Control
                        type='number'
                        min={0}
                        placeholder='No limit'
                        value={pendingMaxAnnotations}
                        onChange={(e) =>
                          setPendingMaxAnnotations(
                            e.target.value === ''
                              ? ''
                              : Number(e.target.value) || ''
                          )
                        }
                      />
                    </Form.Group>
                    <Button
                      variant='primary'
                      onClick={applyFilters}
                      disabled={loading}
                    >
                      Filter
                    </Button>
                  </Form.Group>
                </div>

                {/* Right image column */}
                <div className='d-flex flex-column flex-grow-1 h-100 w-100'>
                  <Form.Group className='mt-3 h-100 w-100'>
                    <TaskBuffer
                      index={index}
                      setIndex={setIndex}
                      fetcher={fetcher}
                      preloadN={5}
                      historyN={5}
                      renderTask={(task) => (
                        <LightLocationView {...task} location={task.location} />
                      )}
                    />
                  </Form.Group>
                  <div className='d-flex flex-column w-100 gap-2 pt-3'>
                    {locations[index] && (
                      <a
                        className='btn btn-outline-info'
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
                </div>
              </div>
            )}
          </div>
        </Body>
        <Footer>
          <Button variant='dark' onClick={() => showModal(null)}>
            Close
          </Button>
        </Footer>
      </Modal>
    </ProjectContext>
  );
}

function CategoryOptions({ annotationSetId }: { annotationSetId: string }) {
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
        }
      )) as any[];
      if (!cancelled) {
        setCats(
          categories
            ?.filter((c: any) => c.annotationSetId === annotationSetId)
            ?.sort((a: any, b: any) => a.name.localeCompare(b.name)) || []
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
