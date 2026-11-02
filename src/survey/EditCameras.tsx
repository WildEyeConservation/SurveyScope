import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useContext, useEffect, useState } from 'react';
import { GlobalContext } from '../Context';
import { Footer } from '../Modal';
import { Schema } from '../amplify/client-schema';
import { loadProjectImages } from '../projectImages';
import { SectionTitle } from './SurveyStructure';

interface CameraFormData {
  focalLengthMm?: number;
  sensorWidthMm?: number;
  tiltDegrees?: number;
}

type CameraFormDataMap = Record<string, CameraFormData>;

const NEW_CAMERA = 'new-camera';
const FIELDS: { key: keyof CameraFormData; label: string; unit: string }[] = [
  { key: 'focalLengthMm', label: 'Focal length', unit: 'mm' },
  { key: 'sensorWidthMm', label: 'Sensor width', unit: 'mm' },
  { key: 'tiltDegrees', label: 'Tilt', unit: '°' },
];
const GRID = 'minmax(0, 1fr) repeat(3, minmax(84px, 130px))';

export default function EditCameras({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  const { client, showModal } = useContext(GlobalContext);
  const [cameras, setCameras] = useState<Schema['Camera']['type'][]>([]);
  const [form, setForm] = useState<CameraFormDataMap>({});
  const [saved, setSaved] = useState<CameraFormDataMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function getCameras() {
      const { data: cameras } = await client.models.Camera.camerasByProjectId(
        { projectId },
        { signal: controller.signal },
      );
      setCameras(cameras);

      const formDataMap: CameraFormDataMap = {};
      for (const camera of cameras) {
        formDataMap[camera.id] = {
          focalLengthMm: camera.focalLengthMm ?? undefined,
          sensorWidthMm: camera.sensorWidthMm ?? undefined,
          tiltDegrees: camera.tiltDegrees ?? undefined,
        };
      }
      if (cameras.length === 0) formDataMap[NEW_CAMERA] = {};

      setForm(formDataMap);
      setSaved(formDataMap);
      setIsLoading(false);
    }

    getCameras().catch((error) => {
      if (!controller.signal.aborted)
        console.error('Failed to load cameras', error);
    });
    return () => controller.abort();
  }, [client, projectId]);

  const hasCameras = cameras.length > 0;
  const rows = hasCameras
    ? cameras.map((camera) => ({ id: camera.id, name: camera.name }))
    : [{ id: NEW_CAMERA, name: 'Survey Camera' }];
  const changedIds = rows
    .map((row) => row.id)
    .filter((id) =>
      FIELDS.some(({ key }) => form[id]?.[key] !== saved[id]?.[key]),
    );
  const complete = rows.every((row) =>
    FIELDS.every(({ key }) => form[row.id]?.[key] !== undefined),
  );
  const canSave = !saving && complete && changedIds.length > 0;

  const handleFormChange = (
    cameraId: string,
    field: keyof CameraFormData,
    value: string,
  ) => {
    const numValue = value === '' ? undefined : parseFloat(value);
    setJustSaved(false);
    setForm((prev) => ({
      ...prev,
      [cameraId]: {
        ...prev[cameraId],
        [field]: Number.isNaN(numValue) ? undefined : numValue,
      },
    }));
  };

  const handleSubmit = async () => {
    if (!canSave) return;
    setSaving(true);

    if (!hasCameras) {
      const { data: newCamera } = await client.models.Camera.create({
        projectId,
        name: 'Survey Camera',
        ...form[NEW_CAMERA],
        group: organizationId,
      });

      if (newCamera) {
        const images = await loadProjectImages(client, projectId, []);
        await Promise.all(
          images.map((image) =>
            client.models.Image.update({
              id: image.id,
              cameraId: newCamera.id,
            }),
          ),
        );
        setCameras([newCamera]);
        const next = { [newCamera.id]: form[NEW_CAMERA] };
        setForm(next);
        setSaved(next);
        setJustSaved(true);
      }
    } else {
      await Promise.all(
        changedIds.map((id) =>
          client.models.Camera.update({ id, ...form[id] }),
        ),
      );
      setSaved(form);
      setJustSaved(true);
    }

    setSaving(false);
  };

  if (isLoading) {
    return <div className='p-4 text-muted-foreground'>Loading cameras...</div>;
  }

  return (
    <>
      <form
        className='flex flex-col gap-2 p-4'
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <SectionTitle className='border-b-0 pb-0'>Lens settings</SectionTitle>
        <div className='border border-dark bg-white/[0.07]'>
          <div
            className='grid gap-3 border-b border-dark bg-dark px-3 py-2 text-[11px] font-semibold tracking-wider text-white/85 uppercase'
            style={{ gridTemplateColumns: GRID }}
          >
            <span>Camera</span>
            {FIELDS.map(({ key, label }) => (
              <span key={key}>{label}</span>
            ))}
          </div>
          {rows.map((row) => (
            <div
              key={row.id}
              className={cn(
                'grid items-center gap-3 border-b border-white/[0.08] px-3 py-2 last:border-b-0',
                changedIds.includes(row.id) &&
                  hasCameras &&
                  'shadow-[inset_3px_0_0_var(--color-primary)]',
              )}
              style={{ gridTemplateColumns: GRID }}
            >
              <span className='truncate font-semibold' title={row.name}>
                {row.name}
              </span>
              {FIELDS.map(({ key, label, unit }) => {
                const value = form[row.id]?.[key];
                return (
                  <div key={key} className='relative'>
                    <Input
                      type='number'
                      step='0.01'
                      min={key === 'tiltDegrees' ? undefined : 0}
                      aria-label={`${label} of ${row.name}`}
                      aria-invalid={value === undefined}
                      className='pr-8 aria-invalid:ring-2 aria-invalid:ring-danger'
                      value={value ?? ''}
                      onChange={(e) =>
                        handleFormChange(row.id, key, e.target.value)
                      }
                    />
                    <span className='pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-[#6c757d]'>
                      {unit}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {!hasCameras && (
          <div className='text-xs text-muted-foreground'>
            Saving creates a camera for all images in this survey.
          </div>
        )}
        {hasCameras && changedIds.length > 0 && (
          <div className='text-xs text-warning'>
            ⚠ Jolly II results will need recalculating after you save.
          </div>
        )}
        {!complete && (
          <div className='text-xs text-danger'>
            Fill in every field before saving.
          </div>
        )}
      </form>
      <Footer>
        <Button
          variant='ghost'
          className='mr-auto'
          onClick={() => showModal(null)}
          disabled={saving}
        >
          Close
        </Button>
        {hasCameras && changedIds.length > 0 ? (
          <span className='text-xs text-warning'>
            ● {changedIds.length} camera{changedIds.length === 1 ? '' : 's'}{' '}
            changed
          </span>
        ) : (
          justSaved && <span className='text-xs text-success'>Saved</span>
        )}
        <Button variant='primary' onClick={handleSubmit} disabled={!canSave}>
          {saving ? 'Saving...' : 'Save changes'}
        </Button>
      </Footer>
    </>
  );
}
