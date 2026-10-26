import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Select from 'react-select';
import { Schema } from '../amplify/client-schema';
import { GlobalContext, UserContext } from '../Context';
import { useLaunchTask } from '../useLaunchTask';
import LabeledToggleSwitch from '../LabeledToggleSwitch';
import { logAdminAction } from '../utils/adminActionLogger';
import { loadLocationCandidates } from './zoomPreview';
import ZoomSetting from './ZoomSetting';

const defaultLowerConfidence = (modelValue?: string) =>
  modelValue === 'owl-d' ? 0.2 : modelValue === 'stormfly-testing' ? 0.3 : 0.6;

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
        onLaunchConfirmed: () => void
      ) => Promise<void>;
    } | null>
  >;
}) {
  const { client } = useContext(GlobalContext)!;
  const { user } = useContext(UserContext)!;
  const switchId = useId();

  const [batchSize, setBatchSize] = useState<number>(200);
  const [showAdvancedOptions, setShowAdvancedOptions] =
    useState<boolean>(false);
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
  const [upperLimit, setUpperLimit] = useState<number>(1);
  const [hidden, setHidden] = useState<boolean>(false);
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
    | string
    | undefined;

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
    if (modelGuided) return;
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
          { selectionSet: ['locationCount'] }
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
  }, [client.models.LocationSet, tiledLocationSetId, modelGuided]);

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
          .includes(model.value)
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
  const hiddenRef = useRef(hidden)
  const lowerLimitRef = useRef(lowerLimit);
  const upperLimitRef = useRef(upperLimit);
  const batchSizeRef = useRef(batchSize);
  const skipLocationsWithAnnotationsRef = useRef(skipLocationsWithAnnotations);
  const allowAnnotationsOutsideLocationBoundariesRef = useRef(allowAnnotationsOutsideLocationBoundaries);
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
    hiddenRef.current = hidden;
  }, [hidden]);
  useEffect(() => {
    lowerLimitRef.current = lowerLimit;
  }, [lowerLimit]);
  useEffect(() => {
    upperLimitRef.current = upperLimit;
  }, [upperLimit]);
  useEffect(() => {
    batchSizeRef.current = batchSize;
  }, [batchSize]);
  useEffect(() => {
    skipLocationsWithAnnotationsRef.current = skipLocationsWithAnnotations;
  }, [skipLocationsWithAnnotations]);
  useEffect(() => {
    allowAnnotationsOutsideLocationBoundariesRef.current = allowAnnotationsOutsideLocationBoundaries;
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
      onLaunchConfirmed: () => void
    ) => {
      if (modelGuidedRef.current) {
        // Model guided launch
        if (modelOptionsLengthRef.current === 0) return;
        const currentModelValue = (modelRef.current?.value ?? '') as string;
        const sets = (locationSetsRef.current || []).filter((ls: any) =>
          String(ls.name || '')
            .toLowerCase()
            .includes(currentModelValue)
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
        const modelName = modelOptions.find((m) => m.value === currentModelValue)?.label || currentModelValue;
        const settings = [
          `Confidence: ${lowerLimitRef.current}-${upperLimitRef.current}`,
          `Batch size: ${batchSizeRef.current}`,
          `Skip locations with annotations: ${skipLocationsWithAnnotationsRef.current ? 'Yes' : 'No'}`,
          `Allow annotations outside boundaries: ${allowAnnotationsOutsideLocationBoundariesRef.current ? 'Yes' : 'No'}`,
          `View unobserved only: ${viewUnobservedLocationsOnlyRef.current ? 'Yes' : 'No'}`,
          zoomRef.current !== undefined ? `Zoom: ${zoomRef.current}` : null,
          taskTagRef.current !== annotationSet.name ? `Job name: "${taskTagRef.current}"` : null,
        ].filter(Boolean).join(', ');

        await logAdminAction(
          client,
          user.userId,
          `Launched Model Guided queue for annotation set "${annotationSet.name}" in project "${project.name}" (Model: ${modelName}, ${settings})`,
          project.id,
          project.organizationId
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
            hidden: hiddenRef.current,
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
          project.organizationId
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
    ]
  );

  const performLaunchRef = useRef(performLaunch);
  useEffect(() => {
    performLaunchRef.current = performLaunch;
  }, [performLaunch]);

  useEffect(() => {
    setSpeciesLaunchHandler({
      execute: async (onProgress: (msg: string) => void, onLaunchConfirmed: () => void) => {
        await performLaunchRef.current(onProgress, onLaunchConfirmed);
        const launchedZoom = zoomRef.current ?? null;
        if (launchedZoom !== (savedZoom ?? null)) {
          await (client.models.Project.update as any)({
            id: project.id,
            defaultZoom: launchedZoom,
          }).catch(console.error);
        }
      }
    });
  }, [setSpeciesLaunchHandler, client, user.userId, annotationSet.name, project.name, project.id, modelOptions, savedZoom]);

  return (
    <div className='px-4 pb-4 pt-1'>
      <div className='flex flex-col gap-4 mt-2'>
        <div>
          <Label className='mb-0'>Batch Size</Label>
          <span
            className='text-muted-foreground block mb-1'
            style={{ fontSize: '12px' }}
          >
            The number of annotation jobs a user can pick up at a time.
          </span>
          <Input
            type='number'
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
              modelGuided ? { lower: lowerLimit, upper: upperLimit } : undefined
            )
          }
          disabled={previewLocationSetIds.length === 0}
        />
      </div>

      <div className='flex flex-col mt-2'>
        <div>
          <div className='mb-0.5 flex items-center gap-2'>
            <Switch
              id={`${switchId}-advanced`}
              checked={showAdvancedOptions}
              onCheckedChange={() => setShowAdvancedOptions(!showAdvancedOptions)}
            />
            <Label htmlFor={`${switchId}-advanced`} className='mb-0'>
              Show Advanced Options
            </Label>
          </div>
        </div>
      </div>

      {showAdvancedOptions && (
        <div
          className='flex flex-col gap-4 border border-dark shadow-sm p-2'
          style={{ backgroundColor: '#697582' }}
        >
          <div>
            <Label className='mb-0'>Job Name</Label>
            <span
              className='text-muted-foreground block mb-1'
              style={{ fontSize: '12px' }}
            >
              Modify this to display a different name for the job in the jobs
              page.
            </span>
            <Input
              type='text'
              value={taskTag}
              onChange={(e) => setTaskTag(e.target.value)}
            />
          </div>
          {modelGuided &&
            <div>
              <Label className='mb-0'>
                Filter by confidence value:
              </Label>
              <span
                className='text-muted-foreground block mb-1'
                style={{ fontSize: '12px' }}
              >
                Filter images by confidence value.
              </span>
              <div className='flex items-center gap-2'>
                <Input
                  type='number'
                  min={0}
                  max={1}
                  step={0.01}
                  value={lowerLimit}
                  onChange={(e) => setLowerLimit(Number(e.target.value))}
                  style={{ width: '80px' }}
                />
                <span>to</span>
                <Input
                  type='number'
                  min={0}
                  max={1}
                  step={0.01}
                  value={upperLimit}
                  onChange={(e) => setUpperLimit(Number(e.target.value))}
                  style={{ width: '80px' }}
                />
              </div>
            </div>
          }
          <div>
            <div className='mb-0.5 flex items-center gap-2'>
              <Switch
                id={`${switchId}-skip`}
                checked={skipLocationsWithAnnotations}
                onCheckedChange={() => setSkipLocationsWithAnnotations(!skipLocationsWithAnnotations)}
              />
              <Label htmlFor={`${switchId}-skip`} className='mb-0'>
                Skip Locations With Annotations
              </Label>
            </div>
          </div>
          <div>
            <div className='mb-0.5 flex items-center gap-2'>
              <Switch
                id={`${switchId}-outside`}
                checked={allowAnnotationsOutsideLocationBoundaries}
                onCheckedChange={() => setAllowAnnotationsOutsideLocationBoundaries(!allowAnnotationsOutsideLocationBoundaries)}
              />
              <Label htmlFor={`${switchId}-outside`} className='mb-0'>
                Allow Annotations Outside Location Boundaries
              </Label>
            </div>
          </div>
          <div>
            <div className='mb-0.5 flex items-center gap-2'>
              <Switch
                id={`${switchId}-unobserved`}
                checked={viewUnobservedLocationsOnly}
                onCheckedChange={() => setViewUnobservedLocationsOnly(!viewUnobservedLocationsOnly)}
              />
              <Label htmlFor={`${switchId}-unobserved`} className='mb-0'>
                View Unobserved Locations Only
              </Label>
            </div>
          </div>
          <div>
            <div className='mb-0.5 flex items-center gap-2'>
              <Switch
                id={`${switchId}-hidden`}
                checked={hidden}
                onCheckedChange={() => setHidden(!hidden)}
              />
              <Label htmlFor={`${switchId}-hidden`} className='mb-0'>
                Hide Job From Non-Admin Workers
              </Label>
            </div>
          </div>
        </div>
      )}

      <LabeledToggleSwitch
        className='m-0 border-t pt-2 mt-2 border-dark'
        leftLabel='Model Guided'
        rightLabel='Tiled Annotation'
        checked={!modelGuided}
        onChange={(checked) => {
          setModelGuided(!checked);
        }}
      />

      {modelGuided ? (
        loadingLocationSets ? (
          <p
            className='text-muted-foreground mb-0 mt-2 text-center'
            style={{ fontSize: '12px' }}
          >
            Loading models...
          </p>
        ) : modelOptions.length > 1 ? (
          <div>
            <Label className='mb-0'>Model</Label>
            <Select
              value={model as any}
              onChange={(m) => {
                const selectedModel = m ?? undefined;
                setModel(selectedModel);
                setLowerLimit(defaultLowerConfidence(selectedModel?.value));
              }}
              options={modelOptions}
              placeholder='Select a model'
              className='text-black'
              isDisabled={launching}
            />
          </div>
        ) : (
          modelOptions.length === 0 && (
            <p
              className='text-muted-foreground mb-0 mt-2 text-center'
              style={{ fontSize: '12px' }}
            >
              You must first process your images before launching a model guided
              task.
            </p>
          )
        )
      ) : (
        <div className='mt-2'>
          {loadingTileCount ? (
            <p
              className='text-muted-foreground mb-0 text-center'
              style={{ fontSize: '12px' }}
            >
              Loading tile information...
            </p>
          ) : !tiledLocationSetId || globalTileCount === 0 ? (
            <Alert variant='warning' className='mb-0'>
              <strong>No tiles configured.</strong>
              <p className='mb-0 mt-1' style={{ fontSize: '14px' }}>
                Please go to <strong>Edit Survey &gt; Manage Tiles</strong> to
                create tiles for this survey before launching a tiled annotation
                task.
              </p>
            </Alert>
          ) : (
            <div
              className='border border-dark shadow-sm p-2'
              style={{ backgroundColor: '#697582' }}
            >
              <p className='mb-0 text-white'>
                <strong>{globalTileCount}</strong> tiles available for
                annotation.
              </p>
              <p className='mb-0 mt-1 text-muted-foreground' style={{ fontSize: '12px' }}>
                To modify tiles, go to Edit Survey &gt; Manage Tiles.
              </p>
              {process.env.NODE_ENV === 'development' && (
                <div className='mt-2'>
                  <Label className='mb-0 text-white' style={{ fontSize: '13px' }}>
                    Filter by Image IDs (optional)
                  </Label>
                  <span
                    className='text-muted-foreground block mb-1'
                    style={{ fontSize: '12px' }}
                  >
                    Upload a JSON file containing an array of image IDs to only
                    launch tiles from those images.
                  </span>
                  <div className='flex items-center gap-2'>
                    <Input
                      type='file'
                      accept='.json'
                      size='sm'
                      disabled={launching}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (e) => {
                          try {
                            const content = e.target?.result as string;
                            const parsed = JSON.parse(content);
                            if (
                              Array.isArray(parsed) &&
                              parsed.every((id) => typeof id === 'string')
                            ) {
                              setLaunchImageIds(parsed);
                            } else {
                              alert(
                                'Invalid JSON format. Expected an array of image ID strings.'
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
                        variant='outline-light'
                        size='sm'
                        onClick={() => setLaunchImageIds(null)}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  {launchImageIds && (
                    <p
                      className='mb-0 mt-1 text-white'
                      style={{ fontSize: '12px' }}
                    >
                      <strong>{launchImageIds.length}</strong> image IDs loaded
                      — only tiles from these images will be launched.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
