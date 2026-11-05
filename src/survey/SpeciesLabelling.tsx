import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import type { Dispatch, SetStateAction } from 'react';
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Schema } from '../amplify/client-schema';
import { GlobalContext, UserContext } from '../Context';
import { useLaunchTask } from '../useLaunchTask';
import { logAdminAction } from '../utils/adminActionLogger';
import { plural, useLaunchLabel } from './launchLabel';
import {
  AdvancedOptions,
  Banner,
  ChoiceCards,
  SettingRow,
  SwitchRow,
} from './launchParts';
import { loadLocationCandidates } from './zoomPreview';
import ZoomSetting from './ZoomSetting';

const defaultLowerConfidence = (modelValue?: string) =>
  modelValue === 'owl-d' ? 0.23 : modelValue === 'stormfly-testing' ? 0.3 : 0.6;

export default function SpeciesLabelling({
  project,
  annotationSet,
  launching,
  setLaunchDisabled,
  setSpeciesLaunchHandler,
}: {
  project: Schema['Project']['type'];
  annotationSet: Schema['AnnotationSet']['type'];
  launching: boolean;
  setLaunchDisabled: Dispatch<SetStateAction<boolean>>;
  setSpeciesLaunchHandler: Dispatch<
    SetStateAction<{
      execute: (
        onProgress: (msg: string) => void,
        onLaunchConfirmed: () => void,
      ) => Promise<void>;
    } | null>
  >;
}) {
  const { client } = useContext(GlobalContext)!;
  const { user } = useContext(UserContext)!;
  const switchId = useId();

  const [batchSize, setBatchSize] = useState<number>(200);
  const [skipLocationsWithAnnotations, setSkipLocationsWithAnnotations] =
    useState<boolean>(true);
  const [
    allowAnnotationsOutsideLocationBoundaries,
    setAllowAnnotationsOutsideLocationBoundaries,
  ] = useState<boolean>(true);
  const [viewUnobservedLocationsOnly, setViewUnobservedLocationsOnly] =
    useState<boolean>(true);
  const [taskTag, setTaskTag] = useState<string>(annotationSet.name);
  const savedZoom = (project as any).defaultZoom as number | null | undefined;
  const [zoom, setZoom] = useState<number | undefined>(savedZoom ?? undefined);
  const [lowerLimit, setLowerLimit] = useState<number>(0.6);
  const upperLimit = 1;
  const [modelGuided, setModelGuided] = useState<boolean>(true);
  const [model, setModel] = useState<{ label: string; value: string }>();
  const [modelOptions, setModelOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [locationSets, setLocationSets] = useState<any[]>([]);
  const [loadingLocationSets, setLoadingLocationSets] =
    useState<boolean>(false);

  // Global tiled location set state
  const [globalTileCount, setGlobalTileCount] = useState<number | null>(null);
  const [loadingTileCount, setLoadingTileCount] = useState<boolean>(false);

  // JSON image ID filter for tiled annotation
  const [launchImageIds, setLaunchImageIds] = useState<string[] | null>(null);

  // Get the tiled location set ID from project
  const tiledLocationSetId = (project as any).tiledLocationSetId as
    string | undefined;

  const launchTask = useLaunchTask({
    allowOutside: allowAnnotationsOutsideLocationBoundaries,
    filterObserved: viewUnobservedLocationsOnly,
    lowerLimit: lowerLimit,
    upperLimit: upperLimit,
    skipLocationWithAnnotations: skipLocationsWithAnnotations,
    taskTag: taskTag,
    annotationSetId: annotationSet.id,
    projectId: project.id,
    batchSize,
    zoom: zoom as number | undefined,
  });

  // Load global tile count when switching to tiled mode
  useEffect(() => {
    if (!tiledLocationSetId) {
      setGlobalTileCount(0);
      return;
    }

    let mounted = true;
    const locationSetIdToFetch = tiledLocationSetId;
    async function loadTileCount() {
      setLoadingTileCount(true);
      try {
        const { data } = await client.models.LocationSet.get(
          { id: locationSetIdToFetch as string },
          { selectionSet: ['locationCount'] },
        );
        if (mounted) {
          setGlobalTileCount(data?.locationCount ?? 0);
        }
      } catch (err) {
        console.error('Failed to load tile count', err);
        if (mounted) {
          setGlobalTileCount(0);
        }
      }
      if (mounted) {
        setLoadingTileCount(false);
      }
    }
    loadTileCount();
    return () => {
      mounted = false;
    };
  }, [client.models.LocationSet, tiledLocationSetId]);

  // load model options from location sets
  useEffect(() => {
    let mounted = true;
    async function fetchLocationSets() {
      setLoadingLocationSets(true);
      const { data } = (await (
        client.models.LocationSet.locationSetsByProjectId as any
      )({
        projectId: project.id,
      })) as { data: any[] };
      if (!mounted) return;
      setLocationSets(data);

      const options: { label: string; value: string }[] = [];
      for (const ls of data) {
        const n = ls.name.toLowerCase();
        if (n.includes('scoutbot')) {
          if (!options.some((o) => o.value === 'scoutbot')) {
            options.push({ label: 'ScoutBot', value: 'scoutbot' });
          }
        }
        if (n.includes('mad')) {
          if (!options.some((o) => o.value === 'mad')) {
            options.push({ label: 'MAD AI', value: 'mad' });
          }
        }
        if (n.includes('owl-d')) {
          if (!options.some((o) => o.value === 'owl-d')) {
            options.push({ label: 'OWL-D', value: 'owl-d' });
          }
        }
        if (n.includes('stormfly-testing')) {
          if (!options.some((o) => o.value === 'stormfly-testing')) {
            options.push({
              label: 'Stormfly (testing model)',
              value: 'stormfly-testing',
            });
          }
        }
        if (n.includes('elephant-detection-nadir')) {
          if (!options.some((o) => o.value === 'elephant-detection-nadir')) {
            options.push({
              label: 'Elephant Detection Nadir',
              value: 'elephant-detection-nadir',
            });
          }
        }
      }
      if (options.length === 1) {
        setModel(options[0]);
        setLowerLimit(defaultLowerConfidence(options[0].value));
      }
      setModelOptions(options);
      setLoadingLocationSets(false);
    }
    fetchLocationSets();
    return () => {
      mounted = false;
    };
  }, [client.models.LocationSet, project.id]);

  const previewLocationSetIds = useMemo<string[]>(() => {
    if (!modelGuided) return tiledLocationSetId ? [tiledLocationSetId] : [];
    if (!model?.value) return [];
    return locationSets
      .filter((ls) =>
        String(ls.name || '')
          .toLowerCase()
          .includes(model.value),
      )
      .map((ls) => ls.id);
  }, [modelGuided, tiledLocationSetId, model, locationSets]);

  // Control Launch disabled state based on mode
  useEffect(() => {
    let shouldDisable = false;

    if (modelGuided) {
      // Model guided mode
      shouldDisable =
        loadingLocationSets ||
        modelOptions.length === 0 ||
        (modelOptions.length > 1 && !model);
    } else {
      // Tiled annotation mode - check if global tiles exist
      shouldDisable =
        loadingTileCount ||
        !tiledLocationSetId ||
        (globalTileCount !== null && globalTileCount === 0);
    }

    setLaunchDisabled(shouldDisable);
  }, [
    modelGuided,
    loadingLocationSets,
    modelOptions.length,
    model,
    loadingTileCount,
    tiledLocationSetId,
    globalTileCount,
    setLaunchDisabled,
  ]);

  // Expose launch handler to parent (stable to avoid update depth loops)
  const modelGuidedRef = useRef(modelGuided);
  const modelRef = useRef(model);
  const modelOptionsLengthRef = useRef(modelOptions.length);
  const locationSetsRef = useRef(locationSets);
  const launchTaskRef = useRef(launchTask);
  const lowerLimitRef = useRef(lowerLimit);
  const batchSizeRef = useRef(batchSize);
  const skipLocationsWithAnnotationsRef = useRef(skipLocationsWithAnnotations);
  const allowAnnotationsOutsideLocationBoundariesRef = useRef(
    allowAnnotationsOutsideLocationBoundaries,
  );
  const viewUnobservedLocationsOnlyRef = useRef(viewUnobservedLocationsOnly);
  const zoomRef = useRef(zoom);
  const taskTagRef = useRef(taskTag);
  const tiledLocationSetIdRef = useRef(tiledLocationSetId);
  const launchImageIdsRef = useRef(launchImageIds);

  useEffect(() => {
    modelGuidedRef.current = modelGuided;
  }, [modelGuided]);
  useEffect(() => {
    modelRef.current = model as any;
  }, [model]);
  useEffect(() => {
    modelOptionsLengthRef.current = modelOptions.length;
  }, [modelOptions.length]);
  useEffect(() => {
    locationSetsRef.current = locationSets;
  }, [locationSets]);
  useEffect(() => {
    launchTaskRef.current = launchTask;
  }, [launchTask]);
  useEffect(() => {
    lowerLimitRef.current = lowerLimit;
  }, [lowerLimit]);
  useEffect(() => {
    batchSizeRef.current = batchSize;
  }, [batchSize]);
  useEffect(() => {
    skipLocationsWithAnnotationsRef.current = skipLocationsWithAnnotations;
  }, [skipLocationsWithAnnotations]);
  useEffect(() => {
    allowAnnotationsOutsideLocationBoundariesRef.current =
      allowAnnotationsOutsideLocationBoundaries;
  }, [allowAnnotationsOutsideLocationBoundaries]);
  useEffect(() => {
    viewUnobservedLocationsOnlyRef.current = viewUnobservedLocationsOnly;
  }, [viewUnobservedLocationsOnly]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    taskTagRef.current = taskTag;
  }, [taskTag]);
  useEffect(() => {
    tiledLocationSetIdRef.current = tiledLocationSetId;
  }, [tiledLocationSetId]);
  useEffect(() => {
    launchImageIdsRef.current = launchImageIds;
  }, [launchImageIds]);

  // The actual launch logic
  const performLaunch = useCallback(
    async (
      onProgress: (msg: string) => void,
      onLaunchConfirmed: () => void,
    ) => {
      if (modelGuidedRef.current) {
        // Model guided launch
        if (modelOptionsLengthRef.current === 0) return;
        const currentModelValue = (modelRef.current?.value ?? '') as string;
        const sets = (locationSetsRef.current || []).filter((ls: any) =>
          String(ls.name || '')
            .toLowerCase()
            .includes(currentModelValue),
        );
        if (sets.length === 0) return;
        onProgress('Initializing launch...');
        await launchTaskRef.current({
          selectedTasks: sets.map((ls: any) => ls.id),
          onProgress,
          queueOptions: {
            name: 'Model Guided',
            hidden: false,
            fifo: false,
          },
          onLaunchConfirmed,
        });
        // Log the launch action with settings
        const modelName =
          modelOptions.find((m) => m.value === currentModelValue)?.label ||
          currentModelValue;
        const settings = [
          `Confidence: ${lowerLimitRef.current}-${upperLimit}`,
          `Batch size: ${batchSizeRef.current}`,
          `Skip locations with annotations: ${skipLocationsWithAnnotationsRef.current ? 'Yes' : 'No'}`,
          `Allow annotations outside boundaries: ${allowAnnotationsOutsideLocationBoundariesRef.current ? 'Yes' : 'No'}`,
          `View unobserved only: ${viewUnobservedLocationsOnlyRef.current ? 'Yes' : 'No'}`,
          zoomRef.current !== undefined ? `Zoom: ${zoomRef.current}` : null,
          taskTagRef.current !== annotationSet.name
            ? `Job name: "${taskTagRef.current}"`
            : null,
        ]
          .filter(Boolean)
          .join(', ');

        await logAdminAction(
          client,
          user.userId,
          `Launched Model Guided queue for annotation set "${annotationSet.name}" in project "${project.name}" (Model: ${modelName}, ${settings})`,
          project.id,
          project.organizationId,
        ).catch(console.error);
      } else {
        // Tiled annotation launch - use global tiled location set
        if (!tiledLocationSetIdRef.current) {
          onProgress('No tiles configured for this survey.');
          return;
        }

        onProgress('Initializing launch...');
        await launchTaskRef.current({
          selectedTasks: [tiledLocationSetIdRef.current],
          onProgress,
          queueOptions: {
            name: 'Tiled Annotation',
            hidden: false,
            fifo: false,
          },
          onLaunchConfirmed,
          launchImageIds: launchImageIdsRef.current ?? undefined,
        });
        // Log the launch action
        await logAdminAction(
          client,
          user.userId,
          `Launched Tiled Annotation queue for annotation set "${annotationSet.name}" in project "${project.name}"`,
          project.id,
          project.organizationId,
        ).catch(console.error);
      }
    },
    [
      client,
      user.userId,
      annotationSet.name,
      project.name,
      project.id,
      modelOptions,
    ],
  );

  const performLaunchRef = useRef(performLaunch);
  useEffect(() => {
    performLaunchRef.current = performLaunch;
  }, [performLaunch]);

  useEffect(() => {
    setSpeciesLaunchHandler({
      execute: async (
        onProgress: (msg: string) => void,
        onLaunchConfirmed: () => void,
      ) => {
        await performLaunchRef.current(onProgress, onLaunchConfirmed);
        const launchedZoom = zoomRef.current ?? null;
        if (launchedZoom !== (savedZoom ?? null)) {
          await (client.models.Project.update as any)({
            id: project.id,
            defaultZoom: launchedZoom,
          }).catch(console.error);
        }
      },
    });
  }, [
    setSpeciesLaunchHandler,
    client,
    user.userId,
    annotationSet.name,
    project.name,
    project.id,
    modelOptions,
    savedZoom,
  ]);

  const noTiles = !tiledLocationSetId || globalTileCount === 0;
  const launchCount =
    launchImageIds && globalTileCount !== null ? null : globalTileCount;
  useLaunchLabel(
    modelGuided
      ? model
        ? `Launch with ${model.label}`
        : null
      : launchCount
        ? `Launch ${plural(launchCount, 'tile')}`
        : null,
    modelGuided
      ? !loadingLocationSets && modelOptions.length === 0
        ? 'Process images with a model first'
        : undefined
      : !loadingTileCount && noTiles
        ? 'Create tiles in Edit Survey › Manage Tiles first'
        : undefined,
  );

  return (
    <div className='flex flex-col gap-4 p-4'>
      <ChoiceCards
        label='Locations to annotate'
        value={modelGuided ? 'model' : 'tiled'}
        onChange={(value) => setModelGuided(value === 'model')}
        disabled={launching}
        options={[
          {
            value: 'model',
            title: 'Model guided',
            detail: loadingLocationSets
              ? 'Loading models...'
              : modelOptions.length === 0
                ? 'No processed images yet'
                : 'Annotate the locations a model found',
          },
          {
            value: 'tiled',
            title: 'Tiled',
            detail: loadingTileCount
              ? 'Loading tiles...'
              : noTiles
                ? 'No tiles yet'
                : `${plural(globalTileCount ?? 0, 'tile')} cover every image`,
          },
        ]}
      />

      {modelGuided
        ? !loadingLocationSets &&
          (modelOptions.length === 0 ? (
            <Banner tone='warning'>
              Process the images with a model in Edit Survey › Process Images
              before launching a model guided task.
            </Banner>
          ) : (
            modelOptions.length > 1 && (
              <div>
                <Label className='mb-1'>Model</Label>
                <Combobox
                  value={model ?? null}
                  onChange={(option) => {
                    setModel(option ?? undefined);
                    setLowerLimit(defaultLowerConfidence(option?.value));
                  }}
                  options={modelOptions}
                  placeholder='Select a model'
                  disabled={launching}
                  name='Model'
                />
              </div>
            )
          ))
        : !loadingTileCount &&
          noTiles && (
            <Banner tone='warning'>
              This survey has no tiles yet. Create them in Edit Survey › Manage
              Tiles.
            </Banner>
          )}

      <div className='grid gap-3 sm:grid-cols-2'>
        <div>
          <Label className='mb-1' htmlFor={`${switchId}-batch`}>
            Batch size
          </Label>
          <Input
            id={`${switchId}-batch`}
            type='number'
            title='The number of annotation jobs a user can pick up at a time'
            value={batchSize}
            onChange={(e) => setBatchSize(Number(e.target.value))}
          />
        </div>
        <ZoomSetting
          mode='level'
          zoom={zoom}
          onChange={setZoom}
          loadCandidates={() =>
            loadLocationCandidates(
              client,
              previewLocationSetIds,
              modelGuided
                ? { lower: lowerLimit, upper: upperLimit }
                : undefined,
            )
          }
          disabled={previewLocationSetIds.length === 0}
        />
      </div>

      <AdvancedOptions>
        <SettingRow
          label='Job name'
          hint='Shown on the Jobs page'
          htmlFor={`${switchId}-name`}
        >
          <Input
            id={`${switchId}-name`}
            type='text'
            value={taskTag}
            onChange={(e) => setTaskTag(e.target.value)}
          />
        </SettingRow>
        {modelGuided && (
          <SettingRow
            label='Minimum model confidence'
            hint='Locations below this are left out'
            htmlFor={`${switchId}-confidence`}
          >
            <div className='flex items-center gap-3'>
              <Slider
                aria-label='Minimum model confidence'
                min={0}
                max={1}
                step={0.01}
                value={[lowerLimit]}
                onValueChange={([lower]) => setLowerLimit(lower)}
              />
              <Input
                id={`${switchId}-confidence`}
                type='number'
                min={0}
                max={1}
                step={0.01}
                value={lowerLimit}
                onChange={(e) =>
                  setLowerLimit(
                    Math.min(1, Math.max(0, Number(e.target.value))),
                  )
                }
                className='w-24 shrink-0'
              />
            </div>
          </SettingRow>
        )}
        <SwitchRow
          label='Skip locations that already have annotations'
          checked={skipLocationsWithAnnotations}
          onChange={setSkipLocationsWithAnnotations}
        />
        <SwitchRow
          label='Allow annotations outside location boundaries'
          checked={allowAnnotationsOutsideLocationBoundaries}
          onChange={setAllowAnnotationsOutsideLocationBoundaries}
        />
        <SwitchRow
          label='Only show locations nobody has viewed'
          checked={viewUnobservedLocationsOnly}
          onChange={setViewUnobservedLocationsOnly}
        />
        {!modelGuided && process.env.NODE_ENV === 'development' && (
          <SettingRow
            label='Limit to image IDs (dev builds only)'
            hint={
              launchImageIds
                ? `${launchImageIds.length.toLocaleString()} image IDs loaded; only their tiles launch.`
                : 'A JSON array of image IDs.'
            }
          >
            <div className='flex items-center gap-3'>
              <Input
                type='file'
                accept='.json'
                disabled={launching}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (e) => {
                    try {
                      const parsed = JSON.parse(e.target?.result as string);
                      if (
                        Array.isArray(parsed) &&
                        parsed.every((id) => typeof id === 'string')
                      ) {
                        setLaunchImageIds(parsed);
                      } else {
                        alert(
                          'Invalid JSON format. Expected an array of image ID strings.',
                        );
                      }
                    } catch {
                      alert('Failed to parse JSON file.');
                    }
                  };
                  reader.readAsText(file);
                  event.target.value = '';
                }}
              />
              {launchImageIds && (
                <Button
                  variant='link'
                  className='p-0'
                  onClick={() => setLaunchImageIds(null)}
                >
                  Clear
                </Button>
              )}
            </div>
          </SettingRow>
        )}
      </AdvancedOptions>
    </div>
  );
}
