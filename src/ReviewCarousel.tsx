import { useEffect, useMemo, useState } from 'react';
import { client } from './stores/appClient';
import AnnotationWorkspace from './AnnotationWorkspace';
import { TaskBuffer } from './TaskBuffer';
import BufferSource from './BufferSource';
import { Spinner } from 'react-bootstrap';
import { useInfoTagData } from './useInfoTags';
import { useCategories } from './data/project';
import { useProjectId } from './data/projectScope';

type LabeledValue = { label: string; value: string };

interface ReviewCarouselProps {
  selectedAnnotationSet: string;
  selectedCategories: LabeledValue[];
  selectedUsers?: LabeledValue[];
  /** Keep only items carrying at least one of these informational tags. */
  infoTagNames?: string[];
  imageBased?: boolean;
}

interface LocationLike {
  location: {
    x: number;
    y: number;
    width: number;
    height: number;
    image: { id: string; width: number; height: number; timestamp: number };
    annotationSetId: string;
    id?: string;
  };
  taskTag?: string;
  id: string;
  /** Annotations backing this item, used to apply the info tag filter. */
  annotationIds: string[];
}

export default function ReviewCarousel({
  selectedAnnotationSet,
  selectedCategories,
  selectedUsers = [],
  infoTagNames = [],
  imageBased = true,
}: ReviewCarouselProps) {
  const projectId = useProjectId();
  const { data: categories } = useCategories(projectId);

  const [annotations, setAnnotations] = useState<LocationLike[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [locationsLoaded, setLocationsLoaded] = useState(0);

  const [index, setIndex] = useState(0);
  const [bufferSource, setBufferSource] = useState<BufferSource | null>(null);

  const { namesFor } = useInfoTagData(
    selectedAnnotationSet ? [selectedAnnotationSet] : []
  );

  // When none selected, assume all categories from the selected set
  const effectiveCategories = useMemo<LabeledValue[]>(() => {
    if (!selectedAnnotationSet) return [];
    if (selectedCategories.length > 0) return selectedCategories;
    const all = (categories ?? [])
      .filter((c) => c.annotationSetId === selectedAnnotationSet)
      .map((c) => ({ label: c.name, value: c.id }));
    return all;
  }, [selectedCategories, selectedAnnotationSet, categories]);

  // Helper to extract userId from owner field
  // If contains "::", take the part before it; otherwise the whole field is the userId
  const extractUserIdFromOwner = (owner: string | null | undefined): string | null => {
    if (!owner) return null;
    if (owner.includes('::')) {
      return owner.split('::')[0];
    }
    return owner;
  };

  // Set of selected user IDs for filtering
  const selectedUserIds = useMemo(
    () => new Set(selectedUsers.map((u) => u.value)),
    [selectedUsers]
  );

  useEffect(() => {
    let cancelled = false;

    async function fetchAnnotationsPoints() {
      setIsLoading(true);

      setLocationsLoaded(0);

      try {
        for (const { value: categoryId } of effectiveCategories) {
          let nextNextToken: string | null | undefined = undefined;
          do {
            const result =
              await client.models.Annotation.annotationsByCategoryId(
                { categoryId },
                {
                  selectionSet: [
                    'id',
                    'x',
                    'y',
                    'owner',
                    'image.id',
                    'image.width',
                    'image.height',
                    'image.timestamp',
                  ],
                  filter: { setId: { eq: selectedAnnotationSet } },
                  nextToken: nextNextToken,
                }
              );
            const { data, nextToken } = result as {
              data: Array<{
                id: string;
                x: number;
                y: number;
                owner?: string | null;
                image: {
                  id: string;
                  width: number;
                  height: number;
                  timestamp: number;
                };
              }>;
              nextToken?: string | null;
            };
            if (cancelled) return;

            // Filter by user if users are selected
            const filteredData =
              selectedUserIds.size > 0
                ? data.filter((ann) => {
                    const userId = extractUserIdFromOwner(ann.owner);
                    return userId && selectedUserIds.has(userId);
                  })
                : data;

            setAnnotations((prev) => [
              ...prev,
              ...filteredData.map(({ id, x, y, image }) => ({
                location: {
                  x,
                  y,
                  width: 100,
                  height: 100,
                  image: {
                    id: image.id,
                    width: image.width,
                    height: image.height,
                    timestamp: image.timestamp,
                  },
                  annotationSetId: selectedAnnotationSet,
                },
                id: crypto.randomUUID(),
                annotationIds: [id],
              })),
            ]);
            setLocationsLoaded((prev) => prev + filteredData.length);

            nextNextToken = nextToken ?? null;
          } while (nextNextToken);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    async function fetchImagesUnique() {
      if (!effectiveCategories.length || !selectedAnnotationSet) return;
      setIsLoading(true);

      setLocationsLoaded(0);
      try {
        // Keyed by image id: one carousel item per image, carrying every
        // annotation on it so the info tag filter can be applied afterwards.
        const byImage = new Map<string, LocationLike>();
        for (const { value: categoryId } of effectiveCategories) {
          let nextNextToken: string | null | undefined = undefined;
          do {
            const result =
              await client.models.Annotation.annotationsByCategoryId(
                { categoryId },
                {
                  selectionSet: [
                    'id',
                    'owner',
                    'image.id',
                    'image.width',
                    'image.height',
                    'image.timestamp',
                  ],
                  filter: { setId: { eq: selectedAnnotationSet } },
                  nextToken: nextNextToken,
                }
              );
            const { data, nextToken } = result as {
              data: Array<{
                id: string;
                owner?: string | null;
                image: {
                  id: string;
                  width: number;
                  height: number;
                  timestamp: number;
                };
              }>;
              nextToken?: string | null;
            };

            // Filter by user if users are selected
            const filteredData =
              selectedUserIds.size > 0
                ? data.filter((ann) => {
                    const userId = extractUserIdFromOwner(ann.owner);
                    return userId && selectedUserIds.has(userId);
                  })
                : data;

            for (const { id, image } of filteredData) {
              const existing = byImage.get(image.id);
              if (existing) {
                existing.annotationIds.push(id);
                continue;
              }
              byImage.set(image.id, {
                location: {
                  x: image.width / 2,
                  y: image.height / 2,
                  width: image.width,
                  height: image.height,
                  image: {
                    id: image.id,
                    width: image.width,
                    height: image.height,
                    timestamp: image.timestamp,
                  },
                  annotationSetId: selectedAnnotationSet,
                },
                taskTag: 'review',
                id: crypto.randomUUID(),
                annotationIds: [id],
              });
              setLocationsLoaded((prev) => prev + 1);
            }
            nextNextToken = nextToken ?? null;
          } while (nextNextToken);
        }
        if (cancelled) return;
        const locations = Array.from(byImage.values()).sort(
          (a, b) => a.location.image.timestamp - b.location.image.timestamp
        );
        setAnnotations(locations);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    // reset state on change
    setAnnotations([]);
    setBufferSource(null);
    setIndex(0);
    setLocationsLoaded(0);

    if (selectedAnnotationSet && effectiveCategories.length) {
      if (imageBased) {
        fetchImagesUnique();
      } else {
        fetchAnnotationsPoints();
      }
    }

    return () => {
      cancelled = true;
    };
  }, [selectedAnnotationSet, effectiveCategories, selectedUserIds, imageBased]);

  // Applied after fetching (rather than as part of it) so toggling a tag
  // re-slices what is already loaded instead of re-running the queries.
  const infoTagKey = infoTagNames.join(',');
  const filteredAnnotations = useMemo(() => {
    if (!infoTagNames.length) return annotations;
    const wanted = new Set(infoTagNames);
    return annotations.filter((item) =>
      item.annotationIds.some((annotationId) =>
        namesFor(selectedAnnotationSet, annotationId).some((name) =>
          wanted.has(name)
        )
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, infoTagKey, namesFor, selectedAnnotationSet]);

  useEffect(() => setIndex(0), [infoTagKey]);

  useEffect(() => {
    if (filteredAnnotations.length) {
      setBufferSource(new BufferSource(filteredAnnotations));
    }
  }, [filteredAnnotations]);

  if (!selectedAnnotationSet) {
    return (
      <div className='d-flex flex-column align-items-center justify-content-center h-100 w-100'>
        Select an annotation set to begin.
      </div>
    );
  }

  return (
    <>
      {!annotations.length && isLoading ? (
        <div className='d-flex flex-column align-items-center justify-content-center h-100 w-100 p-4'>
          <div className='text-center'>
            <div className='d-flex flex-row align-items-center justify-content-center h-100 w-100'>
              <Spinner size='sm' />
              <span className='ms-2'>
                {locationsLoaded > 0
                  ? `${locationsLoaded} items loaded so far`
                  : 'Preparing to load data'}
              </span>
            </div>
          </div>
        </div>
      ) : (
        bufferSource &&
        (filteredAnnotations.length ? (
          <div className='d-flex flex-column align-items-center h-100 w-100 mt-3'>
            <TaskBuffer
              key={
                selectedAnnotationSet +
                effectiveCategories.map((cat) => cat.value).join(',') +
                '|' +
                infoTagKey
              }
              index={index}
              setIndex={setIndex}
              fetcher={() => bufferSource.fetch()}
              preloadN={2}
              historyN={2}
              renderTask={(task) => (
                <AnnotationWorkspace
                  {...task}
                  hideZoomSetting={true}
                  // Reviewers must be able to correct or remove every annotation,
                  // including malformed coordinates outside the image bounds.
                  allowOutside
                  // Tight fit around locations for review; 0.55 keeps a small margin
                  viewBoundsScale={0.55}
                />
              )}
            />
            <div className='mt-2 w-100'>
              <input
                type='range'
                value={index}
                onChange={(e) => setIndex(parseInt(e.target.value))}
                min={0}
                max={Math.max(filteredAnnotations.length - 1, 0)}
                className='form-range'
              />
              <div style={{ textAlign: 'center' }}>
                Done with {index} out of {filteredAnnotations.length} locations
              </div>
            </div>
          </div>
        ) : (
          <div className='d-flex flex-column align-items-center justify-content-center h-100 w-100'>
            No images match the selected info tags.
          </div>
        ))
      )}
    </>
  );
}
