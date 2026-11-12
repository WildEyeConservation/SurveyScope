import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LogOut, RotateCcw, SearchCheck, Share2 } from 'lucide-react';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  GlobalContext,
  ImageContext,
  ProjectContext,
  UserContext,
  type AnnotationsHook,
} from './Context';
import { ImageContextFromHook } from './ImageContext';
import { SideLegend } from './Legend';
import { Schema } from './amplify/client-schema';
import type {
  AnnotationLocation,
  AnnotationWorkspaceProps,
  TaskAcknowledgement,
} from './annotationTypes';
import MapLibreAnnotator from './annotator/MapLibreAnnotator';
import { selectTestContextAnnotations } from './annotator/testContextAnnotations';
import {
  publishSharedDefaultZoom,
  storedDefaultZoom,
  subscribeToSharedDefaultZoom,
} from './defaultZoomEvents';
import type { CategoryType, ExtendedAnnotationType } from './schemaTypes';
import useImageStats from './useImageStats';
import { useImageInfoTags } from './useInfoTags';
import { useOptimisticUpdates } from './useOptimisticUpdates';
import useTaskCompletion, { WaitingOverlay } from './useTaskCompletion';
import { fetchAllPaginatedResults } from './utils';

interface AnnotationSessionProps {
  location: AnnotationLocation;
  visible: boolean;
  /** Acks the task (e.g. deletes the SQS message). Absent in read-only viewer contexts. */
  ack?: TaskAcknowledgement;
  next?: () => void;
  prev?: () => void;
  stats?: Record<string, number>;
  zoom?: number;
  viewBoundsScale?: number;
  hideNavButtons?: boolean;
  isTest?: boolean;
  testPresetId?: string;
  testSetId?: string;
  queueId?: string;
  observationId?: string;
  observationSource?: string;
  allowOutside?: boolean;
  categories: CategoryType[];
  hideFnAnnotations?: boolean;
  readonlyAnnotations?: ExtendedAnnotationType[] | null;
  showMapLegend?: boolean;
  infoTags?: Map<string, string[]>;
  embedded?: boolean;
  bearing?: number;
  onBearingChange?: (bearing: number) => void;
}

/*
Wires task-lifecycle hooks around the annotator: recording an Observation on
ack and delaying the SQS acknowledgement until the user has paged past without
returning. It must render inside ImageContextFromHook, which supplies the
timing and annotation-count state.
*/
function AnnotationSession(props: AnnotationSessionProps) {
  const {
    ack,
    next,
    prev,
    visible,
    location,
    isTest,
    testPresetId,
    testSetId,
    queueId,
    observationId,
    observationSource,
    allowOutside,
    categories,
    hideFnAnnotations,
    readonlyAnnotations,
    showMapLegend,
    infoTags,
    stats,
    zoom,
    viewBoundsScale,
    hideNavButtons,
    embedded,
    bearing,
    onBearingChange,
  } = props;
  const labelNames = useMemo(() => categories.map((c) => c.name), [categories]);
  const { onNext, waiting, waitingMessage } = useTaskCompletion({
    location,
    ack,
    next,
    visible,
    isTest,
    testPresetId,
    testSetId,
    labelNames,
    queueId,
    observationId,
    observationSource,
  });

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapLibreAnnotator
        image={location.image}
        location={location}
        visible={visible}
        zoom={zoom}
        viewBoundsScale={viewBoundsScale}
        // Embedded viewers browse images; they don't complete queue tasks.
        next={embedded ? next : onNext}
        prev={prev}
        hideNavButtons={hideNavButtons}
        stats={stats}
        isTest={isTest}
        allowOutside={allowOutside}
        setId={testSetId!}
        source={observationSource!}
        categories={categories}
        hideFnAnnotations={hideFnAnnotations}
        readonlyAnnotations={readonlyAnnotations}
        showMapLegend={showMapLegend}
        infoTags={infoTags}
        embedded={embedded}
        bearing={bearing}
        onBearingChange={onBearingChange}
      />
      {waiting && <WaitingOverlay message={waitingMessage} />}
    </div>
  );
}

export default function AnnotationWorkspace(props: AnnotationWorkspaceProps) {
  const {
    location,
    next,
    prev,
    visible,
    ack,
    allowOutside,
    zoom,
    hideNavButtons,
    testPresetId,
    isTest,
    hideZoomSetting = false,
    queueId,
    observationId,
    revalidate,
    taskTag,
    isFalseNegatives,
    viewBoundsScale,
    embedded = false,
    bearing,
    onBearingChange,
  } = props;

  const { annotationSetId } = location;
  const { client } = useContext(GlobalContext)!;
  const hasRevalidated = useRef(false);
  const localAnnotationCreated = useRef(false);
  const nextRef = useRef(next);
  const ackRef = useRef(ack);
  nextRef.current = next;
  ackRef.current = ack;

  // Queue tasks are filtered when fetched and checked once more when they
  // become visible, in case another user annotated the location meanwhile.
  // Ignore a result after local annotation creation: the revalidation query
  // can otherwise see that new row and incorrectly advance to another task.
  useEffect(() => {
    if (!visible || !revalidate || hasRevalidated.current) return;
    hasRevalidated.current = true;
    let settled = false;
    let cancelled = false;

    revalidate()
      .then((isValid: boolean) => {
        settled = true;
        if (cancelled || localAnnotationCreated.current) return;
        if (!isValid) {
          ackRef.current?.();
          nextRef.current?.();
        }
      })
      .catch((error: unknown) => {
        settled = true;
        if (!cancelled) {
          console.error('Failed to revalidate annotation task', error);
        }
      });

    return () => {
      cancelled = true;
      // If the task was hidden before its check completed, allow a fresh
      // revalidation when the user returns instead of using a stale result.
      if (!settled) hasRevalidated.current = false;
    };
  }, [visible, revalidate]);

  const { currentTaskTag, isAnnotatePath, myMembershipHook } =
    useContext(UserContext)!;
  const navigate = useNavigate();
  const { surveyId } = useParams();
  // Read localStorage synchronously so tiles are never loaded at the wrong zoom.
  const [defaultZoom, setDefaultZoom] = useState<number | null>(
    () => storedDefaultZoom(surveyId) ?? zoom ?? null,
  );

  // TaskBuffer keeps upcoming workspaces mounted. Synchronize a shared zoom
  // save across those preloaded workspaces without rebuilding the job buffer.
  useEffect(() => {
    return subscribeToSharedDefaultZoom(
      ({ surveyId: updatedSurveyId, zoom: updatedZoom }) => {
        if (updatedSurveyId === surveyId) {
          setDefaultZoom(updatedZoom);
        }
      },
    );
  }, [surveyId]);
  const [membershipQueueIsFn, setIsFalseNegativesJob] =
    useState<boolean>(false);
  // Queue tasks know their queue up front; the lookup below can lag.
  const isFalseNegativesJob = isFalseNegatives ?? membershipQueueIsFn;
  const [jobSetId, setJobSetId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function checkQueue() {
      try {
        const membership = myMembershipHook.data?.find(
          (membership) => membership.projectId === surveyId,
        );
        const queueId = membership?.queueId;
        if (!queueId) {
          if (!cancelled) setIsFalseNegativesJob(false);
          return;
        }
        const { data: q } = await client.models.Queue.get({ id: queueId });
        if (!cancelled) {
          setIsFalseNegativesJob((q?.name ?? '') === 'False Negatives');
          setJobSetId(q?.annotationSetId ?? null);
        }
      } catch {
        if (!cancelled) setIsFalseNegativesJob(false);
      }
    }
    checkQueue();
    return () => {
      cancelled = true;
    };
  }, [client.models.Queue, myMembershipHook.data, surveyId]);

  const testSetId = useMemo(
    () => (isTest ? crypto.randomUUID() : annotationSetId),
    [isTest, annotationSetId],
  );
  const {
    project,
    categoriesHook: { data: projectCategories },
    expandLegend,
    setExpandLegend,
  } = useContext(ProjectContext)!;
  const [legendCategories, setLegendCategories] = useState<
    CategoryType[] | null
  >(null);
  const legendCollapsed = !expandLegend;
  const subscriptionFilter = useMemo(() => {
    // projectId lets the server authorise users with many organisation groups.
    const conditions: Array<
      | { setId: { eq: string } }
      | { imageId: { eq: string } }
      | { projectId: { eq: string } }
    > = [{ projectId: { eq: project.id } }];
    // Tests write to an ephemeral set, so only filter by set outside test mode.
    if (!isTest) {
      conditions.push({ setId: { eq: annotationSetId } });
    }
    conditions.push({ imageId: { eq: location.image.id } });
    return { filter: { and: conditions } };
  }, [project.id, annotationSetId, location.image.id, isTest]);

  const toggleLegendCollapsed = () => {
    setExpandLegend((wasExpanded) => {
      const expanded = !wasExpanded;
      if (surveyId) {
        localStorage.setItem(`legendCollapsed-${surveyId}`, String(!expanded));
      }
      return expanded;
    });
  };

  // Use job labels to avoid revealing test answers.
  const legendSetId = isTest ? (jobSetId ?? '') : annotationSetId;

  // Fetch cross-project categories by annotation set.
  useEffect(() => {
    let cancelled = false;
    async function ensureCategories() {
      if (isTest) {
        setLegendCategories(projectCategories ?? null);
        return;
      }
      try {
        const { data: annSet } = await client.models.AnnotationSet.get({
          id: annotationSetId,
        });
        if (!annSet) {
          setLegendCategories(projectCategories ?? null);
          return;
        }
        if (annSet.projectId === (surveyId as string)) {
          if (!cancelled) {
            setLegendCategories(projectCategories ?? null);
          }
        } else {
          const { data: cats } =
            await client.models.Category.categoriesByAnnotationSetId({
              annotationSetId,
            });
          if (!cancelled) {
            setLegendCategories(cats ?? []);
          }
        }
      } catch (e) {
        console.error(
          'Failed to ensure categories for annotation set',
          annotationSetId,
          e,
        );
        if (!cancelled) {
          setLegendCategories(projectCategories ?? null);
        }
      }
    }
    ensureCategories();
    return () => {
      cancelled = true;
    };
  }, [client, annotationSetId, surveyId, projectCategories, isTest]);
  const annotationsHook = useOptimisticUpdates<
    Schema['Annotation']['type'],
    'Annotation'
  >(
    'Annotation',
    async (nextToken: string | null | undefined) =>
      // A test's working set is a fresh ephemeral set; never load the answers.
      isTest
        ? { data: [] as Schema['Annotation']['type'][], nextToken: null }
        : client.models.Annotation.annotationsByImageIdAndSetId(
            {
              imageId: location.image.id,
              setId: { eq: location.annotationSetId },
            },
            { limit: 10000, nextToken },
          ),
    subscriptionFilter,
  ) as unknown as AnnotationsHook;
  const stats = useImageStats(annotationsHook);

  const [testContext, setTestContext] = useState<{
    annotations: ExtendedAnnotationType[];
    categories: { id: string; name: string }[];
  } | null>(null);
  useEffect(() => {
    if (!isTest) return;
    let cancelled = false;
    setTestContext(null);
    Promise.all([
      fetchAllPaginatedResults(
        client.models.Annotation.annotationsByImageIdAndSetId,
        {
          imageId: location.image.id,
          setId: { eq: annotationSetId },
          limit: 10000,
        },
      ),
      fetchAllPaginatedResults(
        client.models.Category.categoriesByAnnotationSetId,
        { annotationSetId, selectionSet: ['id', 'name'] },
      ),
    ])
      .then(([annotations, categories]) => {
        if (cancelled) return;
        setTestContext({
          annotations: annotations.filter(Boolean) as ExtendedAnnotationType[],
          categories: categories.filter(Boolean),
        });
      })
      .catch((error: unknown) => {
        console.error('Failed to load test context annotations', error);
        if (!cancelled) setTestContext({ annotations: [], categories: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [isTest, client, location.image.id, annotationSetId]);

  // Source tag written onto both annotations and observations.
  const source = useMemo(() => {
    const baseSource = taskTag ? `manual-${taskTag}` : 'manual';
    return isFalseNegativesJob ? `${baseSource}-false-negative` : baseSource;
  }, [taskTag, isFalseNegativesJob]);

  // Tags are keyed off the real set: during a test the annotations live in an
  // ephemeral set, so there is nothing to look up there.
  const infoTagsByAnnotation = useImageInfoTags(
    location.image.id,
    annotationSetId,
  );

  const filteredCategories = useMemo(
    () =>
      (legendCategories ?? projectCategories)?.filter(
        (c) => c.annotationSetId == legendSetId,
      ) ?? [],
    [legendCategories, projectCategories, legendSetId],
  );

  // Browsing shows every sighting, whatever the user's job.
  const hideFnAnnotations = !embedded && !isFalseNegativesJob;

  const readonlyAnnotations = useMemo(() => {
    if (!isTest) return undefined;
    if (!testContext || filteredCategories.length === 0) return null;
    return selectTestContextAnnotations({
      annotations: testContext.annotations,
      sourceCategories: testContext.categories,
      jobCategories: filteredCategories,
      location: {
        x: location.x,
        y: location.y,
        width: location.width,
        height: location.height,
      },
      hideFnAnnotations,
    });
  }, [
    isTest,
    testContext,
    filteredCategories,
    location.x,
    location.y,
    location.width,
    location.height,
    hideFnAnnotations,
  ]);

  async function handleShare() {
    const windowUrl = new URL(window.location.href);
    let url = `${windowUrl.origin}/surveys/${surveyId}`;

    if (location.id && location.annotationSetId) {
      url = `${url}/location/${location.id}/${location.annotationSetId}`;
    } else if (location.image.id && location.annotationSetId) {
      url = `${url}/image/${location.image.id}/${location.annotationSetId}`;
    } else {
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({ url: url });
      } catch (error) {
        console.error(error);
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        alert('Link copied to clipboard');
      } catch (error) {
        console.error(error);
      }
    }
  }

  const session = (
    <AnnotationSession
      stats={stats}
      visible={visible}
      location={location}
      // Embedded viewers frame their own location; a saved zoom would refit it.
      zoom={embedded ? undefined : (defaultZoom ?? undefined)}
      viewBoundsScale={viewBoundsScale}
      prev={prev}
      next={next}
      ack={ack}
      hideNavButtons={hideNavButtons}
      testPresetId={testPresetId}
      isTest={isTest}
      testSetId={testSetId}
      queueId={queueId}
      observationId={observationId}
      observationSource={source}
      allowOutside={allowOutside}
      categories={filteredCategories}
      hideFnAnnotations={hideFnAnnotations}
      readonlyAnnotations={readonlyAnnotations}
      showMapLegend={embedded || legendCollapsed}
      infoTags={infoTagsByAnnotation}
      embedded={embedded}
      bearing={bearing}
      onBearingChange={onBearingChange}
    />
  );

  return (
    <ImageContextFromHook
      hook={annotationsHook}
      locationId={location.id}
      image={location.image}
      taskTag={taskTag}
      active={visible}
      onAnnotationCreate={() => {
        localAnnotationCreated.current = true;
      }}
    >
      {embedded ? (
        session
      ) : (
        <div
          className={`flex h-full w-full flex-col gap-4 overflow-auto md:flex-row ${
            legendCollapsed ? 'legend-collapsed' : 'justify-center'
          }`}
        >
          <div
            className={`flex flex-col ${
              legendCollapsed ? 'items-stretch' : 'items-center'
            } h-full w-full min-w-0 gap-4`}
            style={{
              maxWidth: legendCollapsed ? 'none' : '1024px',
              flex: legendCollapsed ? 1 : undefined,
            }}
          >
            <div
              className='flex w-full flex-row items-center justify-center gap-4 overflow-hidden'
              style={{ position: 'relative', height: '26px' }}
            >
              <div
                className='flex flex-row gap-2'
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                }}
              >
                <Share2
                  size={24}
                  onClick={!isTest ? handleShare : undefined}
                  style={{ cursor: 'pointer' }}
                />
              </div>
              {visible && (
                <>
                  <Badge variant='secondary'>
                    Working on:{' '}
                    {taskTag || currentTaskTag
                      ? `${taskTag || currentTaskTag}`
                      : 'Viewing image'}
                  </Badge>
                  {!hideZoomSetting && (
                    <SetDefaultZoom
                      setDefaultZoom={setDefaultZoom}
                      originalZoom={zoom ?? null}
                      adminMemberships={myMembershipHook.data
                        ?.filter((membership) => membership.isAdmin)
                        .map((membership) => ({
                          projectId: membership.projectId,
                          queueId: membership.queueId!,
                        }))}
                    />
                  )}
                </>
              )}
            </div>
            {session}
          </div>
          <div className='flex flex-col items-center gap-4'>
            <SideLegend
              annotationSetId={legendSetId}
              categoriesOverride={legendCategories ?? undefined}
              collapsed={legendCollapsed}
              onToggleCollapse={toggleLegendCollapsed}
            />
            {isAnnotatePath &&
              (legendCollapsed ? (
                <Button
                  variant='success'
                  onClick={() => navigate('/jobs')}
                  className='hidden items-center justify-center md:flex'
                  style={{ width: '40px', height: '40px', padding: 0 }}
                  title='Save & Exit'
                >
                  <LogOut size={20} />
                </Button>
              ) : (
                <div className='hidden w-full ps-2 md:block'>
                  <Button
                    variant='success'
                    onClick={() => navigate('/jobs')}
                    className='hidden w-full md:block'
                  >
                    Save & Exit
                  </Button>
                </div>
              ))}
            {/* Mobile-only Save & Exit; the pair above is hidden below md. */}
            {isAnnotatePath && (
              <Button
                variant='success'
                onClick={() => navigate('/jobs')}
                className='w-full md:hidden'
              >
                Save & Exit
              </Button>
            )}
          </div>
        </div>
      )}
    </ImageContextFromHook>
  );
}

function SetDefaultZoom({
  setDefaultZoom,
  originalZoom,
  adminMemberships,
}: {
  setDefaultZoom: (zoom: number | null) => void;
  originalZoom: number | null;
  adminMemberships: { projectId: string; queueId: string }[];
}) {
  const { zoom, setZoom } = useContext(ImageContext)!;
  const { surveyId } = useParams();
  const { client } = useContext(GlobalContext)!;
  const [storedZoom, setStoredZoom] = useState<boolean>(() => {
    if (surveyId) {
      return localStorage.getItem(`defaultZoom-${surveyId}`) !== null;
    }
    return false;
  });

  // Resync if localStorage was changed elsewhere; the zoom value itself is
  // read synchronously by the parent.
  useEffect(() => {
    const storedZoomValue = localStorage.getItem(`defaultZoom-${surveyId!}`);
    const hasStoredZoom = storedZoomValue !== null;
    if (hasStoredZoom !== storedZoom) {
      setStoredZoom(hasStoredZoom);
    }
  }, [surveyId, storedZoom]);

  const saveDefaultZoom = async () => {
    if (!storedZoom) {
      const currentProjectMembership = adminMemberships.find(
        (membership) => membership.projectId === surveyId!,
      );

      if (currentProjectMembership) {
        const result = window.prompt(
          'Set as default zoom for all users on this job? (y/n)',
        );

        if (result === null) {
          return;
        }

        if (result?.toLowerCase() === 'y') {
          try {
            const sharedZoom = Math.round(zoom);
            await client.models.Queue.update({
              id: currentProjectMembership.queueId,
              // Queue.zoom is an AppSync Int, while MapLibre reports
              // fractional zoom levels.
              zoom: sharedZoom,
            });
            setDefaultZoom(sharedZoom);
            setZoom(sharedZoom);
            publishSharedDefaultZoom({ surveyId: surveyId!, zoom: sharedZoom });
            alert('Default zoom updated.');
          } catch (error) {
            console.error('Failed to update the shared default zoom', error);
            alert('Could not update the default zoom. Please try again.');
          }
          return;
        }
      }
    }

    if (storedZoom) {
      localStorage.removeItem(`defaultZoom-${surveyId!}`);
      setStoredZoom(false);
      setDefaultZoom(originalZoom);
      setZoom(originalZoom || 1);
    } else {
      localStorage.setItem(`defaultZoom-${surveyId!}`, zoom.toString());
      setStoredZoom(true);
      setDefaultZoom(zoom);
      setZoom(zoom);
    }
  };

  return (
    <button
      className='m-0 flex items-center border-0 bg-transparent p-0 text-white'
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
      }}
      onClick={saveDefaultZoom}
    >
      {storedZoom ? <RotateCcw size={24} /> : <SearchCheck size={24} />}
      <span className='ms-2 mb-0 hidden md:block'>
        {storedZoom ? 'Reset zoom' : 'Set as default zoom'}
      </span>
    </button>
  );
}
