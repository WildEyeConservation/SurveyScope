import { Form, Spinner, Button } from 'react-bootstrap';
import { Footer } from '../Modal';
import { useState, useEffect, useCallback, useRef } from 'react';
import { client, backendOutputs as backend } from '../stores/appClient';
import { showModalAction as showModal } from '../stores/modalStore';
import Select from 'react-select';

export default function ProcessImages({ projectId, organizationId }: { projectId: string; organizationId: string }) {
  const [model, setModel] = useState<{ label: string; value: string } | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [unprocessedImages, setUnprocessedImages] = useState<
    {
      id: string;
      originalPath: string;
    }[]
  >([]);
  const [imagesLoaded, setImagesLoaded] = useState<number | null>(null);
  const [scanned, setScanned] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const isActiveRef = useRef(true);

  useEffect(() => {
    isActiveRef.current = true;
    return () => {
      isActiveRef.current = false;
    };
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
          }
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
    [projectId]
  );

  const scanImages = useCallback(async () => {
    if (!model) return;
    // New elephant results use the legacy 'heatmap' source.
    const processedSource = model.value === 'elephant' ? 'heatmap' : model.value;
    setLoading(true);
    let unprocessed: { id: string; originalPath: string }[] = [];
    let nextToken: string | null | undefined = undefined;
    let imgCount = 0;
    do {
      if (!isActiveRef.current) {
        setLoading(false);
        return;
      }
      const res = await client.models.Image.imagesByProjectId(
        { projectId },
        { selectionSet: ['id', 'originalPath', 'processedBy.source'], nextToken, limit: 10000 }
      );
      const page = (res.data ?? []).flatMap((img) =>
        img?.id && img?.originalPath && !img.processedBy?.some((p: { source: string }) => p.source === processedSource)
          ? [{ id: img.id, originalPath: img.originalPath }]
          : []
      );
      unprocessed = unprocessed.concat(page);
      nextToken = res.nextToken as string | null | undefined;
      imgCount += (res.data ?? []).length;
      setImagesLoaded(imgCount);
    } while (nextToken);

    if (!isActiveRef.current) {
      setLoading(false);
      return;
    }
    setUnprocessedImages(unprocessed);
    setLoading(false);
    setScanned(true);
  }, [projectId, model]);

  useEffect(() => {
    // reset when model changes
    setScanned(false);
    setUnprocessedImages([]);
    setImagesLoaded(null);
  }, [model]);

  const processImages = async () => {
    if (!model) {
      return;
    }

    setDisabled(true);
    setLoading(true);

    const locationSetName =
      model.value === 'elephant'
        ? `${projectId}_elephant-detection-nadir`
        : model.value === 'scoutbotv3'
          ? `${projectId}_scoutbot`
          : `${projectId}_${model.value}`;
    let locationSet =
      (await findLocationSetByName(locationSetName)) ??
      null;
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
      console.error('Failed to create location set');
      alert('Something went wrong, please try again.');
      return;
    }

    // Fetch project to determine organization and legacy handling
    const { data: project } = await client.models.Project.get(
      { id: projectId },
      { selectionSet: ['id', 'organizationId', 'tags'] as const }
    );
    const projRecord = (project ?? {}) as Record<string, unknown>;
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

    const BATCH_SIZE = 500;

    switch (model.value) {
      case 'scoutbotv3':
        for (let i = 0; i < unprocessedImages.length; i += BATCH_SIZE) {
          const batch = unprocessedImages.slice(i, i + BATCH_SIZE);
          const batchStrings = batch.map(
            (image) => `${image.id}---${makeKey(image.originalPath)}`
          );

          client.mutations.runScoutbot({
            projectId: projectId,
            images: batchStrings,
            setId: locationSet.id,
            bucket: backend.storage.buckets[1].bucket_name,
            queueUrl: backend.custom.scoutbotTaskQueueUrl,
          }, { retry: false });

          await client.models.Project.update({
            id: projectId,
            status: 'processing-scoutbot',
          });
        }
        break;
      case 'elephant':
        for (let i = 0; i < unprocessedImages.length; i += BATCH_SIZE) {
          const batch = unprocessedImages.slice(i, i + BATCH_SIZE);
          const batchStrings = batch.map(
            (image) => `${image.id}---${makeKey(image.originalPath)}`
          );

          client.mutations.runElephantDetector({
            projectId,
            images: batchStrings,
            setId: locationSet.id,
            bucket: backend.storage.buckets[1].bucket_name,
            queueUrl: backend.custom.elephantDetectorTaskQueueUrl,
          }, { retry: false });
        }

        await client.models.Project.update({
          id: projectId,
          status: 'processing-pointFinder',
        });
        break;
      case 'mad':
        for (let i = 0; i < unprocessedImages.length; i += BATCH_SIZE) {
          const batch = unprocessedImages.slice(i, i + BATCH_SIZE);
          const batchStrings = batch.map(
            (image) => `${image.id}---${makeKey(image.originalPath)}`
          );

          client.mutations.runMadDetector({
            projectId: projectId,
            images: batchStrings,
            setId: locationSet.id,
            bucket: backend.storage.buckets[1].bucket_name,
            queueUrl: backend.custom.madDetectorTaskQueueUrl,
          }, { retry: false });

          await client.models.Project.update({
            id: projectId,
            status: 'processing-mad',
          });
        }
        break;
      case 'owl-d':
        for (let i = 0; i < unprocessedImages.length; i += BATCH_SIZE) {
          const batch = unprocessedImages.slice(i, i + BATCH_SIZE);
          const batchStrings = batch.map(
            (image) => `${image.id}---${makeKey(image.originalPath)}`
          );

          client.mutations.runOwlDDetector({
            projectId,
            images: batchStrings,
            setId: locationSet.id,
            bucket: backend.storage.buckets[1].bucket_name,
            queueUrl: backend.custom.owlDDetectorTaskQueueUrl,
          }, { retry: false });
        }

        await client.models.Project.update({
          id: projectId,
          status: 'processing-owl-d',
        });
        break;
    }

    client.mutations.updateProjectMemberships({
      projectId: projectId,
    });

    setLoading(false);
    setDisabled(false);

    showModal(null);
  };

  return (
    <>
      <Form className='p-3'>
        <Form.Group>
          <Form.Label className='mb-0'>Model</Form.Label>
          <Select
            value={model}
            onChange={(m) => setModel(m)}
            options={[
              { label: 'ScoutBot', value: 'scoutbotv3' },
              { label: 'Elephant Detection Nadir', value: 'elephant' },
              { label: 'MAD', value: 'mad' },
              { label: 'OWL-D', value: 'owl-d' },
            ]}
            placeholder='Select a model'
            className='text-black'
          />
          <Button
            variant='primary'
            onClick={scanImages}
            disabled={!model || loading}
            className='mt-2'
          >
            Scan
          </Button>
          {loading ? (
            <div className='d-flex flex-column align-items-center'>
              <Spinner animation='border' role='status' />
              <p className='mb-0'>Determining images to process...</p>
              <p className='mb-1'>Found {imagesLoaded ?? 0} images</p>
            </div>
          ) : scanned ? (
            unprocessedImages.length > 0 ? (
              <p className='mb-0 mt-2'>
                Found {unprocessedImages.length} unprocessed images
              </p>
            ) : (
              <p className='mb-0 mt-2'>All images have been processed</p>
            )
          ) : null}
        </Form.Group>
      </Form>
      <Footer>
        <Button variant='primary' onClick={processImages} disabled={disabled}>
          Process Images
        </Button>
        <Button
          variant='dark'
          onClick={() => showModal(null)}
          disabled={disabled}
        >
          Close
        </Button>
      </Footer>
    </>
  );
}
