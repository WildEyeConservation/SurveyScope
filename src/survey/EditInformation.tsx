import { Button, Form } from 'react-bootstrap';
import { Footer } from '../Modal';
import { useEffect, useState } from 'react';
import { client } from '../stores/appClient';
import { showModalAction as showModal } from '../stores/modalStore';
import { useQueryClient } from '@tanstack/react-query';
import { fetchAllPaginatedResults } from '../utils';
import SurveyStructure, { Camera } from './SurveyStructure';

export default function EditInformation({ projectId }: { projectId: string }) {
  const [oldProjectName, setOldProjectName] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [fetching, setFetching] = useState(false);
  const [structureFetching, setStructureFetching] = useState(false);
  const [structure, setStructure] = useState<Camera[]>([]);
  const [disabled, setDisabled] = useState(false);

  const queryClient = useQueryClient();

  const handleSubmit = async () => {
    setDisabled(true);

    const { data: project } = await client.models.Project.update({
      id: projectId,
      name: newProjectName,
    });

    if (project?.name === newProjectName) {
      const {
        data: [testPreset],
      } = await client.models.TestPreset.testPresetsByName({
        name: oldProjectName,
      });

      if (testPreset) {
        await client.models.TestPreset.update({
          id: testPreset.id,
          name: newProjectName,
        });
      }

      setOldProjectName(newProjectName);
    }

    await client.mutations.updateProjectMemberships({
      projectId,
    });

    setDisabled(false);

    queryClient.invalidateQueries({ queryKey: ['Project'] });
    queryClient.invalidateQueries({ queryKey: ['TestPreset'] });
  };

  useEffect(() => {
    async function getProject() {
      setFetching(true);

      const { data: project } = await client.models.Project.get({
        id: projectId,
      });

      if (project) {
        setOldProjectName(project.name);
        setNewProjectName(project.name);
      }

      setFetching(false);
    }

    async function buildSurveyStructure() {
      setStructureFetching(true);

      try {
        const { data: cameras } =
          await client.models.Camera.camerasByProjectId({ projectId });

        const images = await fetchAllPaginatedResults(
          client.models.Image.imagesByProjectId,
          {
            projectId,
            selectionSet: [
              'id',
              'cameraId',
              'originalPath',
              'latitude',
              'longitude',
              'altitude_agl',
              'altitude_wgs84',
              'timestamp',
            ],
            limit: 10000,
          }
        );

        const surveyCameras =
          cameras.length === 0
            ? [{ id: '0000', name: 'Survey Camera' }]
            : cameras;

        const nextStructure = surveyCameras.map((camera) => {
          const cameraImages =
            camera.id === '0000'
              ? images
              : images.filter((image) => image.cameraId === camera.id);
          const cameraFolders = new Set<string>();

          for (const image of cameraImages) {
            if (!image.originalPath) continue;
            const pathParts = (image.originalPath as string)
              .split(/[/\\]/)
              .filter((part: string) => part.length > 0);

            if (pathParts.length > 1) {
              cameraFolders.add(pathParts[pathParts.length - 2]);
            } else if (pathParts.length === 1) {
              cameraFolders.add(pathParts[0]);
            }
          }

          return {
            name: camera.name as string,
            folders: Array.from(cameraFolders).map((parentDir) => {
              const folderImages = cameraImages.filter((image) => {
                if (!image.originalPath) return false;
                const pathParts = (image.originalPath as string)
                  .split(/[/\\]/)
                  .filter((part: string) => part.length > 0);

                if (pathParts.length > 1) {
                  return pathParts[pathParts.length - 2] === parentDir;
                }

                return pathParts.length === 1 && pathParts[0] === parentDir;
              });

              return {
                path: parentDir,
                imageCount: folderImages.length,
                images: folderImages.map((image) => ({
                  id: String(image.id),
                  originalPath: (image.originalPath ?? '') as string,
                  cameraId: (image.cameraId ?? undefined) as string | undefined,
                  latitude: image.latitude,
                  longitude: image.longitude,
                  altitude_agl: image.altitude_agl,
                  altitude_wgs84: image.altitude_wgs84,
                  timestamp: image.timestamp,
                })),
              };
            }),
          } as Camera;
        });

        setStructure(nextStructure);
      } finally {
        setStructureFetching(false);
      }
    }

    getProject();
    buildSurveyStructure();
  }, [
    projectId,
  ]);

  return (
    <>
      <Form className='d-flex flex-column gap-3 p-3'>
        <div className='d-flex flex-column'>
          <label
            className='text-uppercase fw-semibold text-muted mb-1'
            style={{ letterSpacing: 0.5, fontSize: 12 }}
          >
            Survey Name
          </label>
          <Form.Control
            type='text'
            value={newProjectName}
            disabled={fetching}
            placeholder='Enter survey name'
            onChange={(event) => setNewProjectName(event.target.value)}
          />
        </div>
        <hr
          className='m-0'
          style={{ borderTop: '1px solid rgba(255, 255, 255, 0.12)', opacity: 1 }}
        />
        <SurveyStructure
          cameras={structure}
          projectName={newProjectName}
          loading={structureFetching}
        />
      </Form>
      <Footer>
        <Button variant='primary' onClick={handleSubmit} disabled={disabled}>
          Save
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
