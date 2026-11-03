import DataTable, { type DataColumn } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

type CameraRow = {
  id: string;
  name: string;
  values: CameraFormData;
  onChange: (field: keyof CameraFormData, value: string) => void;
};

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
  const tableRows: CameraRow[] = rows.map((row) => ({
    ...row,
    values: form[row.id] ?? {},
    onChange: (field, value) => handleFormChange(row.id, field, value),
  }));
  const changedIds = rows
    .map((row) => row.id)
    .filter((id) =>
      FIELDS.some(({ key }) => form[id]?.[key] !== saved[id]?.[key]),
    );
  const complete = rows.every((row) =>
    FIELDS.every(({ key }) => form[row.id]?.[key] !== undefined),
  );
  const canSave = !saving && complete && changedIds.length > 0;

  const handleFormChange = useCallback(
    (cameraId: string, field: keyof CameraFormData, value: string) => {
      const numValue = value === '' ? undefined : parseFloat(value);
      setJustSaved(false);
      setForm((prev) => ({
        ...prev,
        [cameraId]: {
          ...prev[cameraId],
          [field]: Number.isNaN(numValue) ? undefined : numValue,
        },
      }));
    },
    [],
  );

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

  const columns = useMemo<DataColumn<CameraRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Camera',
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className='block max-w-64 truncate font-semibold'
            title={row.original.name}
          >
            {row.original.name}
          </span>
        ),
      },
      ...FIELDS.map(({ key, label, unit }): DataColumn<CameraRow> => ({
        id: key,
        header: label,
        enableSorting: false,
        meta: { className: 'w-36' },
        cell: ({ row }) => {
          const value = row.original.values[key];
          return (
            <div className='relative'>
              <Input
                type='number'
                step='0.01'
                min={key === 'tiltDegrees' ? undefined : 0}
                aria-label={`${label} of ${row.original.name}`}
                aria-invalid={value === undefined}
                className='pr-8 aria-invalid:ring-2 aria-invalid:ring-danger'
                value={value ?? ''}
                onChange={(e) => row.original.onChange(key, e.target.value)}
              />
              <span className='pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-[#6c757d]'>
                {unit}
              </span>
            </div>
          );
        },
      })),
    ],
    [],
  );

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
        <DataTable
          columns={columns}
          data={tableRows}
          getRowId={(row) => row.id}
          pageSize={false}
          rowClassName={(row) =>
            hasCameras && changedIds.includes(row.id)
              ? 'shadow-[inset_3px_0_0_var(--color-primary)]'
              : undefined
          }
        />
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
