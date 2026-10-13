import { Alert, Button } from 'react-bootstrap';
import { useContext, useEffect, useMemo, useState } from 'react';
import { Footer } from '../Modal';
import { GlobalContext } from '../Context';
import CameraMaskEditor, { type MaskTarget } from './masks/CameraMaskEditor';
import {
  MASK_HELP,
  loadStoredSample,
  strideSamples,
} from './masks/samplePreview';
import {
  parseCameraMasks,
  serializeCameraMasks,
  type CameraMasks,
} from '../types/CameraMask';
import {
  orientationGroupForDimensions,
  type ImageOrientationGroup,
} from '../types/Orientation';

const SAMPLE_PAGE_SIZE = 2000;
const SAMPLES_KEPT_PER_GROUP = 200;

type SampleImage = {
  id: string;
  width: number;
  height: number;
  originalPath?: string | null;
};

export default function EditMasks({ projectId }: { projectId: string }) {
  const { client, showModal } = useContext(GlobalContext)!;
  const [cameras, setCameras] = useState<{ id: string; name: string }[]>([]);
  const [saved, setSaved] = useState<Record<string, string | null>>({});
  const [masks, setMasks] = useState<Record<string, CameraMasks>>({});
  const [samples, setSamples] = useState<Record<string, SampleImage[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const cameraRows =
        (await client.models.Camera.camerasByProjectId({ projectId })).data ??
        [];
      const grouped: Record<string, SampleImage[]> = {};
      let nextToken: string | null | undefined;
      do {
        const result = await client.models.Image.imagesByProjectId(
          { projectId },
          {
            limit: SAMPLE_PAGE_SIZE,
            nextToken,
            selectionSet: [
              'id',
              'cameraId',
              'width',
              'height',
              'originalPath',
            ] as const,
          }
        );
        for (const image of result.data ?? []) {
          if (!image.cameraId) continue;
          const shape = orientationGroupForDimensions(
            image.width,
            image.height
          );
          const group = (grouped[`${image.cameraId}:${shape}`] ??= []);
          if (group.length < SAMPLES_KEPT_PER_GROUP) group.push(image);
        }
        nextToken = result.nextToken;
      } while (nextToken && !cancelled);
      if (cancelled) return;
      setCameras(cameraRows.map((c) => ({ id: c.id, name: c.name })));
      setMasks(
        Object.fromEntries(
          cameraRows.map((c) => [c.name, parseCameraMasks(c.masks)])
        )
      );
      setSaved(
        Object.fromEntries(
          cameraRows.map((c) => [
            c.name,
            serializeCameraMasks(parseCameraMasks(c.masks)),
          ])
        )
      );
      setSamples(grouped);
    }
    load()
      .catch((error: unknown) => {
        console.error('Failed to load camera masks', error);
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, projectId]);

  const targets = useMemo<MaskTarget[]>(
    () =>
      cameras.flatMap((camera) =>
        (['landscape', 'portrait'] as ImageOrientationGroup[])
          .filter((shape) => samples[`${camera.id}:${shape}`]?.length)
          .map((shape) => ({
            cameraName: camera.name,
            shape,
            samples: strideSamples(samples[`${camera.id}:${shape}`], 5).map(
              (image) => ({
                label: image.originalPath ?? image.id,
                load: async () => {
                  const { data: files } =
                    await client.models.ImageFile.imagesByimageId({
                      imageId: image.id,
                    });
                  const key = files.find((f) => f.type === 'image/jpeg')?.key;
                  if (!key) throw new Error('Image file not found');
                  return loadStoredSample(image, key);
                },
              })
            ),
          }))
      ),
    [cameras, samples, client]
  );

  const changed = cameras.filter(
    (camera) => serializeCameraMasks(masks[camera.name]) !== saved[camera.name]
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const camera of changed) {
        const next = serializeCameraMasks(masks[camera.name]);
        await client.models.Camera.update({ id: camera.id, masks: next });
        setSaved((prev) => ({ ...prev, [camera.name]: next }));
      }
      setJustSaved(true);
    } catch (error) {
      console.error('Failed to save camera masks', error);
      alert('Failed to save masks. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <div className='p-3'>Loading...</div>;
  }

  if (loadFailed) {
    return (
      <Alert variant='danger' className='m-3'>
        Could not load this survey&apos;s cameras. Close and reopen the survey
        to try again.
      </Alert>
    );
  }

  return (
    <>
      <div className='d-flex flex-column gap-3 p-3'>
        <p className='mb-0' style={{ fontSize: 14 }}>
          {MASK_HELP}
        </p>
        <Alert variant='warning' className='mb-0'>
          Mask changes apply to model detections the next time annotation is
          launched, and to image registration the next time it runs. Images that
          are already registered are not changed.
        </Alert>
        {justSaved && changed.length === 0 && (
          <Alert variant='success' className='mb-0'>
            Masks saved.
          </Alert>
        )}
        <CameraMaskEditor
          targets={targets}
          masks={masks}
          onChange={(cameraName, shape, polygons) => {
            setJustSaved(false);
            setMasks((prev) => ({
              ...prev,
              [cameraName]: { ...prev[cameraName], [shape]: polygons },
            }));
          }}
        />
      </div>
      <Footer>
        <Button
          variant='primary'
          onClick={handleSave}
          disabled={saving || changed.length === 0}
        >
          {saving ? 'Saving...' : 'Save Masks'}
        </Button>
        <Button
          variant='dark'
          onClick={() => showModal(null)}
          disabled={saving}
        >
          Close
        </Button>
      </Footer>
    </>
  );
}
