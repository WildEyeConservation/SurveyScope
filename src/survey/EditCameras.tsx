import { Form, Alert, Button } from 'react-bootstrap';
import { useState, useEffect } from 'react';
import { Footer } from '../Modal';
import { client } from '../stores/appClient';
import { showModalAction as showModal } from '../stores/modalStore';
import { Schema } from '../amplify/client-schema';

interface CameraFormData {
  focalLengthMm?: number;
  sensorWidthMm?: number;
  tiltDegrees?: number;
}

interface CameraFormDataMap {
  [cameraId: string]: CameraFormData;
}

export default function EditCameras({ projectId, organizationId }: { projectId: string; organizationId: string }) {
  const [cameras, setCameras] = useState<Schema['Camera']['type'][]>([]);
  const [cameraFormDataMap, setCameraFormDataMap] = useState<CameraFormDataMap>(
    {}
  );
  const [isLoading, setIsLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    async function getCameras() {
      const { data: cameras } = await client.models.Camera.camerasByProjectId({
        projectId,
      });
      setCameras(cameras);

      // Populate form with camera data
      const formDataMap: CameraFormDataMap = {};

      if (cameras.length > 0) {
        // Populate form with all existing cameras' data
        cameras.forEach((camera) => {
          formDataMap[camera.id] = {
            focalLengthMm: camera.focalLengthMm ?? undefined,
            sensorWidthMm: camera.sensorWidthMm ?? undefined,
            tiltDegrees: camera.tiltDegrees ?? undefined,
          };
        });
      } else {
        // Initialize form data for new camera
        formDataMap['new-camera'] = {
          focalLengthMm: undefined,
          sensorWidthMm: undefined,
          tiltDegrees: undefined,
        };
      }

      setCameraFormDataMap(formDataMap);

      setIsLoading(false);
    }

    getCameras();
  }, [projectId]);

  const handleFormChange = (
    cameraId: string,
    field: keyof CameraFormData,
    value: string
  ) => {
    const numValue = value === '' ? undefined : parseFloat(value);
    setCameraFormDataMap((prev) => ({
      ...prev,
      [cameraId]: {
        ...prev[cameraId],
        [field]: numValue,
      },
    }));
  };

  const handleSubmit = async () => {
    setDisabled(true);
    // Validate all camera form data
    if (cameras.length === 0) {
      // Validate new camera data
      const newCameraData = cameraFormDataMap['new-camera'];
      if (
        newCameraData?.focalLengthMm === undefined ||
        newCameraData?.sensorWidthMm === undefined ||
        newCameraData?.tiltDegrees === undefined
      ) {
        alert('Please fill in all fields for the new camera');
        setDisabled(false);
        return;
      }
    } else {
      // Validate existing camera data
      for (const camera of cameras) {
        const formData = cameraFormDataMap[camera.id];
        if (
          formData?.focalLengthMm === undefined ||
          formData?.sensorWidthMm === undefined ||
          formData?.tiltDegrees === undefined
        ) {
          alert(`Please fill in all fields for camera "${camera.name}"`);
          setDisabled(false);
          return;
        }
      }
    }

    if (cameras.length === 0) {
      // Create new camera and link all project images
      const { data: newCamera } = await client.models.Camera.create({
        projectId,
        name: 'Survey Camera',
        focalLengthMm: cameraFormDataMap['new-camera']?.focalLengthMm,
        sensorWidthMm: cameraFormDataMap['new-camera']?.sensorWidthMm,
        tiltDegrees: cameraFormDataMap['new-camera']?.tiltDegrees,
        group: organizationId,
      });

      if (newCamera) {
        // Fetch all project images and link them to the new camera
        const { data: images } = await client.models.Image.imagesByProjectId({
          projectId,
        });

        // Update each image to link to the new camera
        await Promise.all(
          images.map((image) =>
            client.models.Image.update({
              id: image.id,
              cameraId: newCamera.id,
            })
          )
        );
      }
    } else {
      // Update all existing cameras
      await Promise.all(
        cameras.map((camera) => {
          const formData = cameraFormDataMap[camera.id];
          return client.models.Camera.update({
            id: camera.id,
            focalLengthMm: formData.focalLengthMm,
            sensorWidthMm: formData.sensorWidthMm,
            tiltDegrees: formData.tiltDegrees,
          });
        })
      );
    }

    setDisabled(false);
  };

  if (isLoading) {
    return <div className='p-3'>Loading...</div>;
  }

  const hasCameras = cameras.length > 0;

  return (
    <>
      <Form className='d-flex flex-column gap-3 p-3'>
        {hasCameras ? (
          <>
            <Alert variant='warning' className='mb-0'>
              <strong>Warning:</strong> Updating camera details will require you
              to recalculate your Jolly II results.
            </Alert>

            {cameras.map((camera, index) => {
              const formData = cameraFormDataMap[camera.id];
              return (
                <div
                  key={camera.id}
                  className='border rounded p-3 shadow-sm'
                  style={{ backgroundColor: '#697582' }}
                >
                  <h5 className='mb-3'>
                    Camera {index + 1}: {camera.name}
                  </h5>

                  <div className='row g-3'>
                    <div className='col-md-4'>
                      <Form.Group>
                        <Form.Label className='mb-0'>
                          Focal Length (mm)
                        </Form.Label>
                        <Form.Control
                          type='number'
                          step='0.01'
                          value={
                            formData?.focalLengthMm != null
                              ? formData.focalLengthMm.toString()
                              : ''
                          }
                          onChange={(e) =>
                            handleFormChange(
                              camera.id,
                              'focalLengthMm',
                              e.target.value
                            )
                          }
                          placeholder='Enter focal length'
                        />
                      </Form.Group>
                    </div>

                    <div className='col-md-4'>
                      <Form.Group>
                        <Form.Label className='mb-0'>
                          Sensor Width (mm)
                        </Form.Label>
                        <Form.Control
                          type='number'
                          step='0.01'
                          value={
                            formData?.sensorWidthMm != null
                              ? formData.sensorWidthMm.toString()
                              : ''
                          }
                          onChange={(e) =>
                            handleFormChange(
                              camera.id,
                              'sensorWidthMm',
                              e.target.value
                            )
                          }
                          placeholder='Enter sensor width'
                        />
                      </Form.Group>
                    </div>

                    <div className='col-md-4'>
                      <Form.Group>
                        <Form.Label className='mb-0'>Tilt (degrees)</Form.Label>
                        <Form.Control
                          type='number'
                          step='0.01'
                          value={
                            formData?.tiltDegrees != null
                              ? formData.tiltDegrees.toString()
                              : ''
                          }
                          onChange={(e) =>
                            handleFormChange(
                              camera.id,
                              'tiltDegrees',
                              e.target.value
                            )
                          }
                          placeholder='Enter tilt'
                        />
                      </Form.Group>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <>
            <Alert variant='info' className='mb-0'>
              No cameras found. Adding a new camera named "Survey Camera".
            </Alert>

            <div className='border rounded p-3'>
              <h5 className='mb-3'>New Camera: Survey Camera</h5>

              <div className='row g-3'>
                <div className='col-md-4'>
                  <Form.Group>
                    <Form.Label className='mb-0'>Focal Length (mm)</Form.Label>
                    <Form.Control
                      type='number'
                      step='0.01'
                      value={
                        cameraFormDataMap['new-camera']?.focalLengthMm != null
                          ? cameraFormDataMap[
                              'new-camera'
                            ].focalLengthMm!.toString()
                          : ''
                      }
                      onChange={(e) =>
                        handleFormChange(
                          'new-camera',
                          'focalLengthMm',
                          e.target.value
                        )
                      }
                      placeholder='Enter focal length'
                    />
                  </Form.Group>
                </div>

                <div className='col-md-4'>
                  <Form.Group>
                    <Form.Label className='mb-0'>Sensor Width (mm)</Form.Label>
                    <Form.Control
                      type='number'
                      step='0.01'
                      value={
                        cameraFormDataMap['new-camera']?.sensorWidthMm != null
                          ? cameraFormDataMap[
                              'new-camera'
                            ].sensorWidthMm!.toString()
                          : ''
                      }
                      onChange={(e) =>
                        handleFormChange(
                          'new-camera',
                          'sensorWidthMm',
                          e.target.value
                        )
                      }
                      placeholder='Enter sensor width'
                    />
                  </Form.Group>
                </div>

                <div className='col-md-4'>
                  <Form.Group>
                    <Form.Label className='mb-0'>Tilt (degrees)</Form.Label>
                    <Form.Control
                      type='number'
                      step='0.01'
                      value={
                        cameraFormDataMap['new-camera']?.tiltDegrees != null
                          ? cameraFormDataMap[
                              'new-camera'
                            ].tiltDegrees!.toString()
                          : ''
                      }
                      onChange={(e) =>
                        handleFormChange(
                          'new-camera',
                          'tiltDegrees',
                          e.target.value
                        )
                      }
                      placeholder='Enter tilt'
                    />
                  </Form.Group>
                </div>
              </div>
            </div>
          </>
        )}
      </Form>
      <Footer>
        <Button variant='primary' onClick={handleSubmit} disabled={disabled}>
          Save Cameras
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
