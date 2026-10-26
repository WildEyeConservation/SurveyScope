import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMemo } from 'react';
import { CameraSpec } from './FilesUploadComponent';

export default function CameraSpecification({
  cameraSelection,
  cameraSpecs,
  setCameraSpecs,
  lockedSpecs = {},
}: {
  cameraSelection: [string, string[]];
  cameraSpecs: Record<string, CameraSpec>;
  setCameraSpecs: React.Dispatch<
    React.SetStateAction<Record<string, CameraSpec>>
  >;
  lockedSpecs?: Record<string, CameraSpec>;
}) {
  const cameraList = useMemo(
    () => [
      ...Object.keys(lockedSpecs).sort(),
      ...cameraSelection[1].filter((name) => !(name in lockedSpecs)).sort(),
    ],
    [cameraSelection, lockedSpecs]
  );

  function handleCameraSpecChange(
    camera: string,
    spec: keyof CameraSpec,
    value: number
  ) {
    setCameraSpecs((specs) => {
      const newSpecs = { ...specs };
      newSpecs[camera] = { ...newSpecs[camera], [spec]: value };

      return newSpecs;
    });
  }

  return (
    <div>
      <div className='mt-4'>
        <Label className='mb-0'>
          Camera Specifications (Optional)
        </Label>
        <span className='text-muted-foreground block mb-2' style={{ fontSize: '12px' }}>
          Define camera specifications for each camera. If you have only one
          camera, you can define this later.
          {Object.keys(lockedSpecs).length > 0 &&
            ' Cameras saved on this survey cannot be changed here.'}
        </span>
        <div className='flex flex-col gap-4'>
          {cameraList.map((camera) => (
            <div
              key={camera}
              className='flex flex-col gap-1 border border-dark p-2 shadow-sm'
              style={{ backgroundColor: '#697582' }}
            >
              <Label className='mb-0'>
                <b>{camera}</b>
              </Label>
              <div>
                <Label className='mb-0'>Focal Length (mm)</Label>
                <Input
                  type='number'
                  placeholder='Focal Length (mm)'
                  value={
                    (lockedSpecs[camera] ?? cameraSpecs[camera])
                      ?.focalLengthMm ?? 0
                  }
                  disabled={camera in lockedSpecs}
                  onChange={(e) =>
                    handleCameraSpecChange(
                      camera,
                      'focalLengthMm',
                      Number(e.target.value)
                    )
                  }
                  step='0.01'
                />
              </div>
              <div>
                <Label className='mb-0'>Sensor Width (mm)</Label>
                <Input
                  type='number'
                  placeholder='Sensor Width (mm)'
                  value={
                    (lockedSpecs[camera] ?? cameraSpecs[camera])
                      ?.sensorWidthMm ?? 0
                  }
                  disabled={camera in lockedSpecs}
                  onChange={(e) =>
                    handleCameraSpecChange(
                      camera,
                      'sensorWidthMm',
                      Number(e.target.value)
                    )
                  }
                  step='0.01'
                />
              </div>
              <div>
                <Label className='mb-0'>Tilt (degrees)</Label>
                <Input
                  type='number'
                  placeholder='Tilt (degrees)'
                  value={
                    (lockedSpecs[camera] ?? cameraSpecs[camera])?.tiltDegrees ??
                    0
                  }
                  disabled={camera in lockedSpecs}
                  onChange={(e) =>
                    handleCameraSpecChange(
                      camera,
                      'tiltDegrees',
                      Number(e.target.value)
                    )
                  }
                  step='0.01'
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
