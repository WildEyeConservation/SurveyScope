import { useMemo, useContext, useEffect, useRef, useState } from 'react';
import useTaskCompletion, { WaitingOverlay } from './useTaskCompletion';
import { SideLegend } from './Legend';
import {
  GlobalContext,
  ProjectContext,
  UserContext,
  ImageContext,
  type AnnotationsHook,
} from './Context';
import { useOptimisticUpdates } from './useOptimisticUpdates';
import { ImageContextFromHook } from './ImageContext';
import { Schema } from './amplify/client-schema';
import useImageStats from './useImageStats';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Share2, SearchCheck, RotateCcw, LogOut } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import MapLibreAnnotator from './annotator/MapLibreAnnotator';
import { useImageInfoTags } from './useInfoTags';
import type { CategoryType } from './schemaTypes';
import type {
  AnnotationLocation,
  AnnotationWorkspaceProps,
  TaskAcknowledgement,
} from './annotationTypes';
import {
  publishSharedDefaultZoom,
  subscribeToSharedDefaultZoom,
} from './defaultZoomEvents';

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
  showMapLegend?: boolean;
  infoTags?: Map<string, string[]>;
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
    showMapLegend,
    infoTags,
    stats,
    zoom,
    viewBoundsScale,
    hideNavButtons,
  } = props;
  const { onNext, waiting, waitingMessage } = useTaskCompletion({
    location,
    ack,
    next,
    visible,
    isTest,
    testPresetId,
    testSetId,
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
        next={onNext}
        prev={prev}
        hideNavButtons={hideNavButtons}
        stats={stats}
        isTest={isTest}
        allowOutside={allowOutside}
        setId={testSetId!}
        source={observationSource!}
        categories={categories}
        hideFnAnnotations={hideFnAnnotations}
        showMapLegend={showMapLegend}
        infoTags={infoTags}
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
    viewBoundsScale,
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
  const [defaultZoom, setDefaultZoom] = useState<number | null>(() => {
    if (surveyId) {
      const storedZoom = localStorage.getItem(`defaultZoom-${surveyId}`);
      if (storedZoom) {
        return Number(storedZoom);
      }
    }
    return zoom ?? null;
  });

  // TaskBuffer keeps upcoming workspaces mounted. Synchronize a shared zoom
  // save across those preloaded workspaces without rebuilding the job buffer.
  useEffect(() => {
    return subscribeToSharedDefaultZoom(
      ({ surveyId: updatedSurveyId, zoom: updatedZoom }) => {
        if (updatedSurveyId === surveyId) {
          setDefaultZoom(updatedZoom);
        }
      }
    );
  }, [surveyId]);
  const [isFalseNegativesJob, setIsFalseNegativesJob] =
    useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    async function checkQueue() {
      try {
        const membership = myMembershipHook.data?.find(
          (membership) => membership.projectId === surveyId
        );
        const queueId = membership?.queueId;
        if (!queueId) {
          if (!cancelled) setIsFalseNegativesJob(false);
          return;
        }
        const { data: q } = await client.models.Queue.get({ id: queueId });
        if (!cancelled)
          setIsFalseNegativesJob((q?.name ?? '') === 'False Negatives');
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
    [isTest, annotationSetId]
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

  // A test's annotation set may belong to another project, in which case its
  // categories must be fetched by set id for the legend, hotkeys and icons.
  useEffect(() => {
    let cancelled = false;
    async function ensureCategories() {
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
          e
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
  }, [client, annotationSetId, surveyId, projectCategories]);
  const annotationsHook = useOptimisticUpdates<
    Schema['Annotation']['type'],
    'Annotation'
  >(
    'Annotation',
    async (nextToken: string | null | undefined) =>
      client.models.Annotation.annotationsByImageIdAndSetId(
        { imageId: location.image.id, setId: { eq: location.annotationSetId } },
        { limit: 10000, nextToken }
      ),
    subscriptionFilter
  ) as unknown as AnnotationsHook;
  const stats = useImageStats(annotationsHook);

  // Source tag written onto both annotations and observations.
  const source = useMemo(() => {
    const baseSource = taskTag ? `manual-${taskTag}` : 'manual';
    return isFalseNegativesJob ? `${baseSource}-false-negative` : baseSource;
  }, [taskTag, isFalseNegativesJob]);

  // Tags are keyed off the real set: during a test the annotations live in an
  // ephemeral set, so there is nothing to look up there.
  const infoTagsByAnnotation = useImageInfoTags(
    location.image.id,
    annotationSetId
  );

  const filteredCategories = useMemo(
    () =>
      (legendCategories ?? projectCategories)?.filter(
        (c) => c.annotationSetId == annotationSetId
      ) ?? [],
    [legendCategories, projectCategories, annotationSetId]
  );

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
      <div
        className={`flex md:flex-row flex-col w-full h-full gap-4 overflow-auto ${
          legendCollapsed ? 'legend-collapsed' : 'justify-center'
        }`}
      >
        <div
          className={`flex flex-col ${
            legendCollapsed ? 'items-stretch' : 'items-center'
          } w-full h-full gap-4`}
          style={{
            maxWidth: legendCollapsed ? 'none' : '1024px',
            flex: legendCollapsed ? 1 : undefined,
          }}
        >
          <div
            className='flex flex-row justify-center items-center w-full gap-4 overflow-hidden'
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
          <AnnotationSession
            stats={stats}
            visible={visible}
            location={location}
            zoom={defaultZoom ?? undefined}
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
            hideFnAnnotations={!isFalseNegativesJob}
            showMapLegend={legendCollapsed}
            infoTags={infoTagsByAnnotation}
          />
        </div>
        <div className='flex flex-col items-center gap-4'>
          <SideLegend
            annotationSetId={annotationSetId}
            categoriesOverride={legendCategories ?? undefined}
            collapsed={legendCollapsed}
            onToggleCollapse={toggleLegendCollapsed}
          />
          {isAnnotatePath &&
            (legendCollapsed ? (
              <Button
                variant='success'
                onClick={() => navigate('/jobs')}
                className='hidden md:flex items-center justify-center'
                style={{ width: '40px', height: '40px', padding: 0 }}
                title='Save & Exit'
              >
                <LogOut size={20} />
              </Button>
            ) : (
              <div className='hidden md:block w-full ps-2'>
                <Button
                  variant='success'
                  onClick={() => navigate('/jobs')}
                  className='hidden md:block w-full'
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
        (membership) => membership.projectId === surveyId!
      );

      if (currentProjectMembership) {
        const result = window.prompt(
          'Set as default zoom for all users on this job? (y/n)'
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
      className='p-0 m-0 border-0 bg-transparent flex items-center text-white'
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
