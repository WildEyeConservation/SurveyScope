import { Form, Spinner, Button } from 'react-bootstrap';
import { Footer } from '../Modal';
import { useState, useContext, useEffect, useCallback, useRef } from 'react';
import { GlobalContext } from '../Context';
import Select from 'react-select';
import { parseLaunchResponse } from './launchResponse';
import {
  MODELS,
  dispatchBatches,
  findUnprocessedImages,
  type ModelValue,
  type ScanImage,
} from './processImagesScan';

const MODEL_OPTIONS = (Object.keys(MODELS) as ModelValue[]).map((value) => ({
  label: MODELS[value].label,
  value,
}));

const BATCH_SIZE = 500;
const DISPATCH_CONCURRENCY = 4;

export default function ProcessImages({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  const { client, backend, showModal } = useContext(GlobalContext)!;
  const [model, setModel] = useState<{
    label: string;
    value: ModelValue;
  } | null>(() => MODEL_OPTIONS.find((o) => o.value === 'owl-d')!);
  const [scanning, setScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [scan, setScan] = useState<{
    model: ModelValue;
    images: ScanImage[];
  } | null>(null);
  const [imagesLoaded, setImagesLoaded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusPending, setStatusPending] = useState<ModelValue | null>(null);
  const scanAbortRef = useRef(new AbortController());

  useEffect(() => {
    const controller = new AbortController();
    scanAbortRef.current = controller;
    return () => controller.abort();
  }, []);

  const findLocationSetByName = useCallback(
    async (name: string) => {
      let nextToken: string | null | undefined = undefined;
      do {
        const res = await client.models.LocationSet.locationSetsByProjectId(
          {
            projectId,
            nextToken,
          } as {
            projectId: string;
            nextToken?: string | null;
          },
          {
            selectionSet: ['id', 'name'],
            limit: 10000,
          },
        );
        const match =
          res.data?.find((ls: { name?: string | null }) => ls?.name === name) ??
          null;
        if (match) {
          return match;
        }
        nextToken = res.nextToken as string | null | undefined;
      } while (nextToken);
      return null;
    },
    [client.models.LocationSet, projectId],
  );

  const scanImages = useCallback(async () => {
    if (!model) return;
    const { signal } = scanAbortRef.current;
    setScanning(true);
    setScan(null);
    setError(null);
    setImagesLoaded(0);
    try {
      const images = await findUnprocessedImages(
        client,
        projectId,
        MODELS[model.value].source,
        {
          signal,
          onProgress: (count) => {
            if (!signal.aborted) setImagesLoaded(count);
          },
        },
      );
      if (signal.aborted) return;
      setScan({ model: model.value, images });
    } catch (err) {
      if (signal.aborted) return;
      console.error('Failed to scan images', err);
      setError('Failed to scan images, please try again.');
    } finally {
      if (!signal.aborted) setScanning(false);
    }
  }, [client, projectId, model]);

  useEffect(() => {
    // reset when model changes
    setScan(null);
    setImagesLoaded(null);
    setError(null);
  }, [model]);

  const canProcess =
    !!model &&
    !scanning &&
    !processing &&
    (statusPending === model.value ||
      (scan?.model === model.value && scan.images.length > 0));

  const dispatchImages = async (
    modelValue: ModelValue,
    images: ScanImage[],
  ) => {
    const config = MODELS[modelValue];
    const locationSetName = `${projectId}_${config.setSuffix}`;
    let locationSet = (await findLocationSetByName(locationSetName)) ?? null;
    if (!locationSet) {
      const { data: createdLocationSet } =
        await client.models.LocationSet.create({
          name: locationSetName,
          projectId: projectId,
          group: organizationId,
        });
      locationSet = createdLocationSet ?? null;
    }
    if (!locationSet?.id) {
      throw new Error('Failed to create location set');
    }
    const setId = locationSet.id;

    // Fetch project to determine organization and legacy handling
    const { data: project } = await client.models.Project.get(
      { id: projectId },
      { selectionSet: ['id', 'organizationId', 'tags'] as const },
    );
    if (!project) throw new Error('Failed to load survey');
    const projRecord = project as Record<string, unknown>;
    const projOrganizationId: string | undefined =
      typeof projRecord['organizationId'] === 'string'
        ? (projRecord['organizationId'] as string)
        : undefined;
    const tagsVal = projRecord['tags'];
    const isLegacyProject: boolean = Array.isArray(tagsVal)
      ? (tagsVal as unknown[]).some((t) => t === 'legacy')
      : false;

    const makeKey = (orig: string): string =>
      !isLegacyProject && projOrganizationId
        ? `${projOrganizationId}/${projectId}/${orig}`
        : orig;

    const bucket = backend.storage.buckets[1].bucket_name;
    const runBatch = (batchStrings: string[]) => {
      const args = { projectId, images: batchStrings, setId, bucket };
      switch (modelValue) {
        case 'scoutbotv3':
          return client.mutations.runScoutbot(
            { ...args, queueUrl: backend.custom.scoutbotTaskQueueUrl },
            { retry: false },
          );
        case 'elephant':
          return client.mutations.runElephantDetector(
            { ...args, queueUrl: backend.custom.elephantDetectorTaskQueueUrl },
            { retry: false },
          );
        case 'mad':
          return client.mutations.runMadDetector(
            { ...args, queueUrl: backend.custom.madDetectorTaskQueueUrl },
            { retry: false },
          );
        case 'owl-d':
          return client.mutations.runOwlDDetector(
            { ...args, queueUrl: backend.custom.owlDDetectorTaskQueueUrl },
            { retry: false },
          );
      }
    };

    const { queued, error: dispatchError } = await dispatchBatches(
      images,
      BATCH_SIZE,
      DISPATCH_CONCURRENCY,
      async (batch) =>
        parseLaunchResponse(
          await runBatch(
            batch.map(
              (image) => `${image.id}---${makeKey(image.originalPath)}`,
            ),
          ),
          `${config.label} dispatch failed`,
        ),
    );
    if (dispatchError) {
      setScan(null);
      throw new Error(
        `${dispatchError.message}. ${queued} of ${images.length} images were confirmed queued and others may be too; scan again once they finish to process the rest.`,
      );
    }
  };

  const processImages = async () => {
    if (!canProcess || !model) return;
    const config = MODELS[model.value];

    setProcessing(true);
    setError(null);

    try {
      if (statusPending !== model.value) {
        await dispatchImages(model.value, scan!.images);
        setScan(null);
        setStatusPending(model.value);
      }

      const { errors } = await client.models.Project.update({
        id: projectId,
        status: config.status,
      });
      if (errors?.length) {
        throw new Error(
          `Images were queued but the survey status update failed: ${errors[0].message}`,
        );
      }
      setStatusPending(null);

      client.mutations.updateProjectMemberships({
        projectId: projectId,
      });

      showModal(null);
    } catch (err) {
      console.error('Failed to process images', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong, please try again.',
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <Form className='p-3'>
        <Form.Group>
          <Form.Label className='mb-0'>Model</Form.Label>
          <Select
            value={model}
            onChange={(m) => setModel(m)}
            options={MODEL_OPTIONS}
            placeholder='Select a model'
            className='text-black'
            isDisabled={scanning || processing}
          />
          <Button
            variant='primary'
            onClick={scanImages}
            disabled={!model || scanning || processing}
            className='mt-2'
          >
            Scan
          </Button>
          {scanning ? (
            <div className='d-flex flex-column align-items-center'>
              <Spinner animation='border' role='status' />
              <p className='mb-0'>Determining images to process...</p>
              <p className='mb-1'>Found {imagesLoaded ?? 0} images</p>
            </div>
          ) : scan ? (
            scan.images.length > 0 ? (
              <p className='mb-0 mt-2'>
                Found {scan.images.length} unprocessed images
              </p>
            ) : (
              <p className='mb-0 mt-2'>All images have been processed</p>
            )
          ) : null}
          {processing && (
            <div className='d-flex flex-column align-items-center mt-2'>
              <Spinner animation='border' role='status' />
              <p className='mb-0'>Queueing images...</p>
            </div>
          )}
          {error && <p className='mb-0 mt-2 text-danger'>{error}</p>}
        </Form.Group>
      </Form>
      <Footer>
        <Button
          variant='primary'
          onClick={processImages}
          disabled={!canProcess}
        >
          {statusPending && statusPending === model?.value
            ? 'Retry status update'
            : 'Process Images'}
        </Button>
        <Button
          variant='dark'
          onClick={() => showModal(null)}
          disabled={processing}
        >
          Close
        </Button>
      </Footer>
    </>
  );
}
