import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { CameraSpec } from '../../FilesUploadComponent';
import {
  OrientationSample,
  type OrientationCameraGroup,
} from './OrientationReview';

const SPEC_FIELDS: { key: keyof CameraSpec; unit: string; label: string }[] = [
  { key: 'focalLengthMm', unit: 'mm', label: 'Focal length' },
  { key: 'sensorWidthMm', unit: 'mm', label: 'Sensor width' },
  { key: 'tiltDegrees', unit: '°', label: 'Tilt' },
];

export default function CameraCard({
  name,
  groups,
  rotationFor,
  onRotate,
  linkedTo,
  link,
  spec,
  onSpecChange,
  overlaps,
}: {
  name: string;
  groups: OrientationCameraGroup[];
  rotationFor: (group: OrientationCameraGroup) => number;
  onRotate: (group: OrientationCameraGroup) => void;
  /** Existing survey camera these images join, if any. */
  linkedTo?: string | null;
  /** Lets the folder be linked to an existing camera by hand. */
  link?: {
    value: string;
    options: string[];
    onChange: (camera: string) => void;
  };
  /** Saved specs are read-only; omit onSpecChange for those. */
  spec?: Partial<CameraSpec>;
  onSpecChange?: (key: keyof CameraSpec, value: number) => void;
  /** Other cameras this one may overlap; given only when there are several. */
  overlaps?: {
    cameras: { name: string; on: boolean; locked?: boolean }[];
    onToggle: (camera: string) => void;
  };
}) {
  const imageCount = groups.reduce((sum, group) => sum + group.files.length, 0);

  const lensPanel = (onSpecChange || spec) && (
    <div
      className={cn(
        'flex flex-col gap-2',
        overlaps ? 'w-60 shrink-0 border-l border-white/15 pl-5' : 'max-w-xs',
      )}
    >
      <span className='text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'>
        Lens
      </span>
      {SPEC_FIELDS.map(({ key, unit, label }) => (
        <label
          key={key}
          className='mb-0 flex items-center justify-between gap-3'
        >
          <span className='text-sm'>{label}</span>
          {onSpecChange ? (
            <div className='relative w-28'>
              <Input
                type='number'
                step='0.01'
                aria-label={`${label} of ${name}`}
                className='pr-8'
                value={spec?.[key] ?? 0}
                min={key === 'tiltDegrees' ? undefined : 0}
                onChange={(e) => onSpecChange(key, Number(e.target.value))}
              />
              <span className='pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-[#6c757d]'>
                {unit}
              </span>
            </div>
          ) : (
            <span className='text-sm'>
              {spec?.[key] ?? 0} {unit}
            </span>
          )}
        </label>
      ))}
    </div>
  );

  const overlapPicker = overlaps && (
    <div className='flex flex-col gap-2'>
      <span className='text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'>
        Overlaps with
      </span>
      <div className='flex flex-col gap-2'>
        {overlaps.cameras.map(({ name: other, on, locked }) => {
          const id = `overlap-${name}-${other}`;
          return (
            <div
              key={other}
              className='flex items-center gap-2'
              title={locked ? 'Saved on this survey' : undefined}
            >
              <Switch
                id={id}
                checked={on}
                disabled={locked}
                onCheckedChange={() => overlaps.onToggle(other)}
              />
              <Label htmlFor={id} className='mb-0 text-sm'>
                {other}
              </Label>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className='flex gap-5 border border-white/15 bg-white/[0.07] p-4'>
      {groups.length > 0 && (
        <div className='flex shrink-0 gap-3'>
          {groups.map((group) => (
            <OrientationSample
              key={group.orientationGroup}
              group={group}
              rotation={rotationFor(group)}
              onRotate={() => onRotate(group)}
            />
          ))}
        </div>
      )}
      <div className='flex min-w-0 flex-1 flex-col gap-3'>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
          <span className='truncate text-base font-semibold' title={name}>
            {name}
          </span>
          {imageCount > 0 && (
            <span className='text-xs text-muted-foreground'>
              {imageCount.toLocaleString()} image{imageCount === 1 ? '' : 's'}
            </span>
          )}
          {linkedTo && (
            <span className='border border-success px-1.5 text-xs text-success'>
              {linkedTo === name
                ? 'Existing camera'
                : `Joins existing camera ${linkedTo}`}
            </span>
          )}
        </div>
        {link && (
          <NativeSelect
            aria-label={`Existing camera for ${name}`}
            className='w-fit'
            value={link.value}
            onChange={(e) => link.onChange(e.target.value)}
          >
            <option value=''>New camera</option>
            {link.options.map((option) => (
              <option key={option} value={option}>
                Join {option}
              </option>
            ))}
          </NativeSelect>
        )}
        {!overlaps && lensPanel}
        {overlaps && overlapPicker}
      </div>
      {overlaps && lensPanel}
    </div>
  );
}
