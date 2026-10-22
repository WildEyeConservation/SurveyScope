import { Form } from 'react-bootstrap';
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
  // Saved cameras, shown read-only.
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
      <Form.Group className='mt-3'>
        <Form.Label className='mb-0'>
          Camera Specifications (Optional)
        </Form.Label>
        <span className='text-muted d-block mb-2' style={{ fontSize: '12px' }}>
          Define camera specifications for each camera. If you have only one
          camera, you can define this later.
          {Object.keys(lockedSpecs).length > 0 &&
            ' Cameras saved on this survey cannot be changed here.'}
        </span>
        <div className='d-flex flex-column gap-3'>
          {cameraList.map((camera) => (
            <Form.Group
              key={camera}
              className='d-flex flex-column gap-1 border border-dark p-2 shadow-sm'
              style={{ backgroundColor: '#697582' }}
            >
              <Form.Label className='mb-0'>
                <b>{camera}</b>
              </Form.Label>
              <Form.Group>
                <Form.Label className='mb-0'>Focal Length (mm)</Form.Label>
                <Form.Control
                  type='number'
                  placeholder='Focal Length (mm)'
                  value={
                    (lockedSpecs[camera] ?? cameraSpecs[camera])?.focalLengthMm ?? 0
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
              </Form.Group>
              <Form.Group>
                <Form.Label className='mb-0'>Sensor Width (mm)</Form.Label>
                <Form.Control
                  type='number'
                  placeholder='Sensor Width (mm)'
                  value={
                    (lockedSpecs[camera] ?? cameraSpecs[camera])?.sensorWidthMm ?? 0
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
              </Form.Group>
              <Form.Group>
                <Form.Label className='mb-0'>Tilt (degrees)</Form.Label>
                <Form.Control
                  type='number'
                  placeholder='Tilt (degrees)'
                  value={
                    (lockedSpecs[camera] ?? cameraSpecs[camera])?.tiltDegrees ?? 0
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
              </Form.Group>
            </Form.Group>
          ))}
        </div>
      </Form.Group>
    </div>
  );
}
