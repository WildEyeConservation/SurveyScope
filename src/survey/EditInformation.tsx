import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useQueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useState } from 'react';
import { GlobalContext } from '../Context';
import { Footer } from '../Modal';
import { loadProjectImages } from '../projectImages';
import SurveyStructure, { Camera, SectionTitle } from './SurveyStructure';

export default function EditInformation({ projectId }: { projectId: string }) {
  const { client, showModal } = useContext(GlobalContext)!;
  const [newProjectName, setNewProjectName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [structureFetching, setStructureFetching] = useState(false);
  const [structure, setStructure] = useState<Camera[]>([]);
  const [loadedCount, setLoadedCount] = useState(0);
  const [disabled, setDisabled] = useState(false);

  const queryClient = useQueryClient();

  const handleSubmit = async () => {
    const name = newProjectName.trim();
    setDisabled(true);

    const { data: project } = await client.models.Project.update({
      id: projectId,
      name,
    });

    if (project?.name === name) {
      const {
        data: [testPreset],
      } = await client.models.TestPreset.testPresetsByOwnerProjectId({
        ownerProjectId: projectId,
      });

      if (testPreset) {
        await client.models.TestPreset.update({
          id: testPreset.id,
          name,
        });
      }
    }

    await client.mutations.updateProjectMemberships({
      projectId,
    });

    setDisabled(false);
    if (project) {
      setNewProjectName(project.name);
      setSavedName(project.name);
      setJustSaved(true);
    }

    queryClient.invalidateQueries({ queryKey: ['Project'] });
    queryClient.invalidateQueries({ queryKey: ['TestPreset'] });
  };

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function getProject() {
      setFetching(true);

      const { data: project } = await client.models.Project.get(
        { id: projectId },
        { signal },
      );

      if (project) {
        setNewProjectName(project.name);
        setSavedName(project.name);
      }

      setFetching(false);
    }

    async function buildSurveyStructure() {
      setStructureFetching(true);
      setLoadedCount(0);

      try {
        const { data: cameras } = await client.models.Camera.camerasByProjectId(
          { projectId },
          { signal },
        );

        const images = await loadProjectImages(
          client,
          projectId,
          [
            'cameraId',
            'originalPath',
            'latitude',
            'longitude',
            'altitude_agl',
            'altitude_wgs84',
            'timestamp',
          ],
          { signal, onProgress: setLoadedCount },
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
        if (!signal.aborted) setStructureFetching(false);
      }
    }

    const reportError = (error: unknown) => {
      if (!signal.aborted)
        console.error('Failed to load survey information', error);
    };
    getProject().catch(reportError);
    buildSurveyStructure().catch(reportError);
    return () => controller.abort();
  }, [client, projectId]);

  const trimmedName = newProjectName.trim();
  const unsaved = !fetching && trimmedName !== savedName;

  return (
    <>
      <form
        className='flex flex-col gap-2 p-4'
        onSubmit={(event) => {
          event.preventDefault();
          if (unsaved && trimmedName) handleSubmit();
        }}
      >
        <SectionTitle>Details</SectionTitle>
        <div>
          <Label htmlFor='survey-name'>Survey name</Label>
          <Input
            id='survey-name'
            type='text'
            value={newProjectName}
            disabled={fetching || disabled}
            placeholder='A unique name for the survey'
            onChange={(event) => {
              setNewProjectName(event.target.value);
              setJustSaved(false);
            }}
          />
        </div>
        <SurveyStructure
          cameras={structure}
          projectName={newProjectName}
          loading={structureFetching}
          loadedCount={loadedCount}
        />
      </form>
      <Footer>
        <Button
          variant='ghost'
          className='mr-auto'
          onClick={() => showModal(null)}
          disabled={disabled}
        >
          Close
        </Button>
        {unsaved ? (
          <span className='text-xs text-warning'>● Unsaved name change</span>
        ) : (
          justSaved && <span className='text-xs text-success'>Saved</span>
        )}
        <Button
          variant='primary'
          onClick={handleSubmit}
          disabled={disabled || !unsaved || !trimmedName}
        >
          {disabled ? 'Saving...' : 'Save changes'}
        </Button>
      </Footer>
    </>
  );
}
