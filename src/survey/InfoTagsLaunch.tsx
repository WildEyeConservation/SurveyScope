import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Form } from 'react-bootstrap';
import { LoadingProgressCard } from './LoadingProgressCard';
import type { Schema } from '../amplify/client-schema';
import { UserContext } from '../Context';
import { client } from '../stores/appClient';
import { fetchAllPaginatedResults } from '../utils';
import type { DataClient } from '../../amplify/shared/data-schema.generated';
import { logAdminAction } from '../utils/adminActionLogger';
import { shouldIgnoreLaunchError } from './QCReview';
import { parseLaunchResponse } from './launchResponse';

type LaunchHandler = {
  execute: (
    onProgress: (message: string) => void,
    onLaunchConfirmed: () => void
  ) => Promise<void>;
};

type CategoryOption = { id: string; name: string };
type AnnotationSummary = {
  id: string;
  categoryId: string;
  imageId: string;
  infoTaggedBy: string | null;
};

export default function InfoTagsLaunch({
  project,
  annotationSet,
  launching,
  setLaunchDisabled,
  setInfoTagsLaunchHandler,
}: {
  project: Schema['Project']['type'];
  annotationSet: Schema['AnnotationSet']['type'];
  launching: boolean;
  setLaunchDisabled: (disabled: boolean) => void;
  setInfoTagsLaunchHandler: (handler: LaunchHandler | null) => void;
}) {
  const { user } = useContext(UserContext)!;
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationSummary[]>([]);
  const [infoTagCount, setInfoTagCount] = useState(0);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState(200);
  const [hidden, setHidden] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadStatus, setLoadStatus] = useState({
    categories: 0,
    categoriesDone: false,
    annotations: 0,
    annotationsDone: false,
    infoTags: 0,
    infoTagsDone: false,
  });

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setLoadStatus({
      categories: 0,
      categoriesDone: false,
      annotations: 0,
      annotationsDone: false,
      infoTags: 0,
      infoTagsDone: false,
    });
    const categoriesPromise = fetchAllPaginatedResults(
      client.models.Category.categoriesByAnnotationSetId,
      {
        annotationSetId: annotationSet.id,
        selectionSet: ['id', 'name'] as const,
        limit: 1000,
      },
      (count) => {
        if (mounted) setLoadStatus((state) => ({ ...state, categories: count }));
      }
    ).then((rows) => {
      if (mounted) {
        setLoadStatus((state) => ({
          ...state,
          categories: rows.length,
          categoriesDone: true,
        }));
      }
      return rows;
    });
    const annotationsPromise = fetchAllPaginatedResults(
      client.models.Annotation.annotationsByAnnotationSetId,
      {
        setId: annotationSet.id,
        selectionSet: [
          'id',
          'categoryId',
          'imageId',
          'infoTaggedBy',
        ] as const,
        limit: 10000,
      },
      (count) => {
        if (mounted) setLoadStatus((state) => ({ ...state, annotations: count }));
      }
    ).then((rows) => {
      if (mounted) {
        setLoadStatus((state) => ({
          ...state,
          annotations: rows.length,
          annotationsDone: true,
        }));
      }
      return rows;
    });
    const infoTagsPromise = fetchAllPaginatedResults(
      client.models.InfoTag.infoTagsByAnnotationSetId,
      {
        annotationSetId: annotationSet.id,
        selectionSet: ['id'] as const,
        limit: 1000,
      },
      (count) => {
        if (mounted) setLoadStatus((state) => ({ ...state, infoTags: count }));
      }
    ).then((rows) => {
      if (mounted) {
        setLoadStatus((state) => ({
          ...state,
          infoTags: rows.length,
          infoTagsDone: true,
        }));
      }
      return rows;
    });

    Promise.all([categoriesPromise, annotationsPromise, infoTagsPromise])
      .then(([categoryRows, annotationRows, infoTagRows]) => {
        if (!mounted) return;
        setCategories(categoryRows);
        setAnnotations(
          annotationRows.map((row) => ({
            id: row.id,
            categoryId: row.categoryId,
            imageId: row.imageId,
            infoTaggedBy: row.infoTaggedBy ?? null,
          }))
        );
        setInfoTagCount(infoTagRows.length);
      })
      .catch((error) => console.error('Failed to load info tag launch data', error))
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [annotationSet.id]);

  const availableCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of annotations) {
      counts.set(annotation.categoryId, (counts.get(annotation.categoryId) ?? 0) + 1);
    }
    return categories
      .filter((category) => counts.has(category.id))
      .map((category) => ({ ...category, count: counts.get(category.id) ?? 0 }));
  }, [annotations, categories]);

  const selected = useMemo(() => {
    const ids = new Set(selectedCategoryIds);
    return annotations.filter((annotation) => ids.has(annotation.categoryId));
  }, [annotations, selectedCategoryIds]);
  const selectedImageCount = useMemo(
    () => new Set(selected.map((annotation) => annotation.imageId)).size,
    [selected]
  );
  const taggedCount = selected.filter((annotation) => annotation.infoTaggedBy).length;
  const untaggedCount = selected.length - taggedCount;

  useEffect(() => {
    setLaunchDisabled(
      loading ||
        infoTagCount === 0 ||
        selectedCategoryIds.length === 0 ||
        untaggedCount === 0 ||
        launching
    );
  }, [
    infoTagCount,
    launching,
    loading,
    selectedCategoryIds.length,
    setLaunchDisabled,
    untaggedCount,
  ]);

  const selectionRef = useRef(selectedCategoryIds);
  const batchSizeRef = useRef(batchSize);
  const hiddenRef = useRef(hidden);
  useEffect(() => {
    selectionRef.current = selectedCategoryIds;
  }, [selectedCategoryIds]);
  useEffect(() => {
    batchSizeRef.current = batchSize;
  }, [batchSize]);
  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  useEffect(() => {
    setInfoTagsLaunchHandler({
      execute: async (onProgress, onLaunchConfirmed) => {
        const categoryIds = selectionRef.current;
        if (categoryIds.length === 0) return;
        const categoryNames = categoryIds.map(
          (id) => categories.find((category) => category.id === id)?.name ?? id
        );
        onLaunchConfirmed();
        onProgress('Submitting informational tagging request...');
        const message = await sendLaunchRequest(client, {
          projectId: project.id,
          annotationSetId: annotationSet.id,
          categoryIds,
          categoryNames,
          batchSize: batchSizeRef.current,
          hidden: hiddenRef.current,
        });
        onProgress(message ?? 'Informational tagging launch submitted');
        await logAdminAction(
          client,
          user.userId,
          `Launched Info Tags for ${categoryNames.join(', ')} in annotation set "${annotationSet.name}"`,
          project.id,
          project.organizationId
        ).catch(console.error);
      },
    });
    return () => setInfoTagsLaunchHandler(null);
  }, [
    annotationSet.id,
    annotationSet.name,
    categories,
    project.id,
    project.organizationId,
    setInfoTagsLaunchHandler,
    user.userId,
  ]);

  return (
    <div className='px-3 pb-3 pt-1'>
      <div className='d-flex flex-column gap-3 mt-2'>
        {loading ? (
          <LoadingProgressCard
            title='Loading Info Tags data...'
            rows={[
              {
                label: 'Labels',
                count: loadStatus.categories,
                done: loadStatus.categoriesDone,
              },
              {
                label: 'Annotations',
                count: loadStatus.annotations,
                done: loadStatus.annotationsDone,
              },
              {
                label: 'Info Tags',
                count: loadStatus.infoTags,
                done: loadStatus.infoTagsDone,
              },
            ]}
          />
        ) : infoTagCount === 0 ? (
          <Alert variant='warning' className='mb-0'>
            Define Info Tags first - Edit annotation set → Info Tags.
          </Alert>
        ) : availableCategories.length === 0 ? (
          <Alert variant='warning' className='mb-0'>
            No labels with annotations found for this annotation set.
          </Alert>
        ) : (
          <>
            <Form.Group>
              <Form.Label className='mb-0'>Labels to tag</Form.Label>
              <span className='text-muted d-block mb-1' style={{ fontSize: 12 }}>
                Select one or more species whose annotations should be tagged.
              </span>
              <div
                className='border border-dark rounded p-2'
                style={{ maxHeight: 220, overflowY: 'auto' }}
              >
                {availableCategories.map((category) => (
                  <Form.Check
                    key={category.id}
                    type='checkbox'
                    label={`${category.name} (${category.count})`}
                    checked={selectedCategoryIds.includes(category.id)}
                    disabled={launching}
                    onChange={(event) =>
                      setSelectedCategoryIds((current) =>
                        event.target.checked
                          ? [...current, category.id]
                          : current.filter((id) => id !== category.id)
                      )
                    }
                  />
                ))}
              </div>
            </Form.Group>

            {selected.length > 0 && (
              <div
                className='border border-dark shadow-sm p-2 text-white'
                style={{ backgroundColor: '#697582', fontSize: 12 }}
              >
                <strong>{selected.length.toLocaleString()}</strong> annotations across{' '}
                <strong>{selectedImageCount.toLocaleString()}</strong> images -{' '}
                <strong>{taggedCount.toLocaleString()}</strong> already tagged
                {untaggedCount === 0 && (
                  <div className='mt-1 text-warning'>
                    All selected annotations have already been tagged.
                  </div>
                )}
              </div>
            )}

            <Form.Switch
              label='Show Advanced Options'
              checked={showAdvancedOptions}
              onChange={() => setShowAdvancedOptions((value) => !value)}
              disabled={launching}
            />
            {showAdvancedOptions && (
              <div
                className='d-flex flex-column gap-3 border border-dark shadow-sm p-2'
                style={{ backgroundColor: '#697582' }}
              >
                <Form.Group>
                  <Form.Label className='mb-0'>Batch Size</Form.Label>
                  <span className='text-muted d-block mb-1' style={{ fontSize: 12 }}>
                    The number of images a user can pick up at a time.
                  </span>
                  <Form.Control
                    type='number'
                    min={1}
                    value={batchSize}
                    onChange={(event) => setBatchSize(Number(event.target.value))}
                    disabled={launching}
                  />
                </Form.Group>
                <Form.Switch
                  label='Hide Job From Non-Admin Workers'
                  checked={hidden}
                  onChange={() => setHidden((value) => !value)}
                  disabled={launching}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

async function sendLaunchRequest(
  client: DataClient,
  payload: Record<string, unknown>
): Promise<string | undefined> {
  try {
    const result = await client.mutations.launchInfoTags(
      { request: JSON.stringify(payload) },
      { retry: false }
    );
    const body = parseLaunchResponse(result, 'Informational tagging launch failed');
    return typeof body.message === 'string' ? body.message : undefined;
  } catch (error) {
    // A timeout does not mean the launch failed - the Lambda keeps going.
    if (shouldIgnoreLaunchError(error)) return undefined;
    throw error;
  }
}
