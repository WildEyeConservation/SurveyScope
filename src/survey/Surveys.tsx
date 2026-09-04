import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../session';
import {
  useIsOrganizationAdmin,
  useMyMemberships,
} from '../data/memberships';
import { client } from '../stores/appClient';
import { showModalAction, useModalToShow } from '../stores/modalStore';
import {
  setSurveysCompactMode,
  setSurveysOrganizationFilter,
  setSurveysSearch,
  setSurveysSortBy,
  useSurveysCompactMode,
  useSurveysOrganizationFilter,
  useSurveysSearch,
  useSurveysSortBy,
} from '../stores/surveysUiStore';
import {
  requestDelete,
  requestResume,
  useActiveUploadProjectId,
  useUploadUi,
} from '../upload/uploadUi.ts';
import { Schema } from '../amplify/client-schema.ts';
import { Card, Button, Form } from 'react-bootstrap';
import MyTable from '../Table.tsx';
import NewSurveyModal from './NewSurveyModal.tsx';
import { useNavigate } from 'react-router-dom';
import FilesUploadComponent from '../FilesUploadComponent.tsx';
import ConfirmationModal from '../ConfirmationModal.tsx';
import AnnotationSetResults from '../AnnotationSetResults.tsx';
import AnnotationCountModal from '../AnnotationCountModal.tsx';
import EditAnnotationSetModal from '../EditAnnotationSet.tsx';
import AddAnnotationSetModal from './AddAnnotationSetModal.tsx';
import LaunchAnnotationSetModal from './LaunchAnnotationSetModal.tsx';
import EditSurveyModal from './editSurveyModal.tsx';
import { SquareArrowOutUpRight, X, Play, Trash, Minimize2, Maximize2 } from 'lucide-react';
import { Badge } from 'react-bootstrap';
import localforage from 'localforage';
import ProjectProgress from '../user/ProjectProgress.tsx';
import IndividualIdProgress from '../individual-id/IndividualIdProgress.tsx';
import { logAdminAction } from '../utils/adminActionLogger.ts';
import { deleteInfoTagDataForSet } from '../infoTags.ts';

const PROJECT_SELECTION_SET = [
  'id',
  'name',
  'organizationId',
  'organization.name',
  'status',
  'updatedAt',
  'createdAt',
  'tiledLocationSetId',
  'annotationSets.id',
  'annotationSets.name',
  'queues.id',
  'queues.url',
  'queues.name',
  'queues.tag',
  'queues.batchSize',
  'queues.totalBatches',
  'queues.launchedCount',
  'queues.observedCount',
  'queues.requeuesCompleted',
  'queues.emptyQueueTimestamp',
  'individualIdJobs.id',
  'individualIdJobs.status',
  'imageSets.imageCount',
] as const;

const projectQueryKey = (id: string) => ['surveys-project-details', id] as const;

const fileStoreUploaded = localforage.createInstance({
  name: 'fileStoreUploaded',
  storeName: 'filesUploaded',
});

export default function Surveys() {
  const modalToShow = useModalToShow();
  const showModal = showModalAction;
  const myProjectsHook = useMyMemberships();
  const isOrganizationAdmin = useIsOrganizationAdmin();
  const { user } = useSession();
  const activeUploadProjectId = useActiveUploadProjectId();
  const { deletingProjectId } = useUploadUi();
  const uploadActive = activeUploadProjectId !== null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(0);
  const [selectedProject, setSelectedProject] = useState<
    Schema['Project']['type'] | null
  >(null);
  const [fromStaleUpload, setFromStaleUpload] = useState(false);
  const [selectedAnnotationSet, setSelectedAnnotationSet] = useState<
    Schema['AnnotationSet']['type'] | null
  >(null);

  // Surveys table prefs live in surveysUiStore (persisted, versioned) so this
  // page subscribes selectively instead of owning localStorage effects.
  const search = useSurveysSearch();
  const setSearch = setSurveysSearch;
  const sortBy = useSurveysSortBy();
  const setSortBy = setSurveysSortBy;
  const organizationFilter = useSurveysOrganizationFilter();
  const setOrganizationFilter = setSurveysOrganizationFilter;
  const compactMode = useSurveysCompactMode();
  const setCompactMode = setSurveysCompactMode;
  const [hasUploadedFiles, setHasUploadedFiles] = useState<{
    [projectId: string]: boolean;
  }>({});
  const [scanningProjects, setScanningProjects] = useState<Set<string>>(new Set());
  const getIsMobile = () =>
    typeof window !== 'undefined' ? window.innerWidth < 1024 : false;

  const [isMobile, setIsMobile] = useState(getIsMobile);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      setIsMobile(getIsMobile());
    };

    handleResize();

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const adminProjectIds = useMemo(
    () =>
      myProjectsHook.data
        ?.filter((project) => project.isAdmin)
        .map((project) => project.projectId) ?? [],
    [myProjectsHook.data]
  );

  const membershipUpdatedAtByProjectRef = useRef<Map<
    string,
    string | null | undefined
  > | null>(null);

  useEffect(() => {
    if (!myProjectsHook.data) return;

    const currentUpdatedAtByProject = new Map(
      myProjectsHook.data.map((membership) => [
        membership.projectId,
        membership.updatedAt,
      ] as const)
    );
    const previousUpdatedAtByProject = membershipUpdatedAtByProjectRef.current;

    // The detail queries populate alongside the first membership result, so
    // invalidating that initial population would immediately duplicate them.
    if (previousUpdatedAtByProject === null) {
      membershipUpdatedAtByProjectRef.current = currentUpdatedAtByProject;
      return;
    }

    currentUpdatedAtByProject.forEach((updatedAt, projectId) => {
      if (
        previousUpdatedAtByProject.has(projectId) &&
        previousUpdatedAtByProject.get(projectId) !== updatedAt
      ) {
        queryClient.invalidateQueries({ queryKey: projectQueryKey(projectId) });
      }
    });

    membershipUpdatedAtByProjectRef.current = currentUpdatedAtByProject;
  }, [myProjectsHook.data, queryClient]);

  const projectQueries = useQueries({
    queries: adminProjectIds.map((id) => ({
      queryKey: projectQueryKey(id),
      queryFn: async () => {
        const { data } = await client.models.Project.get(
          { id },
          { selectionSet: PROJECT_SELECTION_SET as unknown as string[] }
        );
        return data;
      },
      // Poll every 60s while a project is uploading so other viewers see the uploader's heartbeat
      refetchInterval: (query: { state: { data?: Schema['Project']['type'] | null } }) =>
        query.state.data?.status === 'uploading' ? 60000 : false,
    })),
  });

  const projects = useMemo(
    () =>
      projectQueries
        .map((q) => q.data)
        .filter((p): p is Schema['Project']['type'] => p != null),
    [projectQueries]
  );

  // Projects with an in-flight Individual ID job (status 'active' or
  // 'launching'). Used to lock the survey down like any other active job.
  // Derived from the project's own selection set (individualIdJobs) — no
  // per-project query needed.
  const projectsWithIndividualIdJob = useMemo(
    () =>
      new Set(
        projects
          .filter((p) =>
            ((p as any).individualIdJobs ?? []).some(
              (j: { status?: string | null }) =>
                j.status === 'active' || j.status === 'launching'
            )
          )
          .map((p) => p.id)
      ),
    [projects]
  );

  const organizationOptions = useMemo(
    () =>
      Array.from(
        new Map(
          projects.map((project) => [
            project.organizationId,
            project.organization.name,
          ])
        ).entries()
      ).map(([id, name]) => ({ id, name })),
    [projects]
  );

  // Helper to optimistically update a single project in the React Query cache.
  const updateProjectInCache = (
    projectId: string,
    updater: (
      prev: Schema['Project']['type'] | undefined
    ) => Schema['Project']['type'] | undefined
  ) => {
    queryClient.setQueryData(projectQueryKey(projectId), updater);
  };

  const projectIdsKey = projects.map((p) => p.id).sort().join(',');
  useEffect(() => {
    if (!projectIdsKey) return;
    let cancelled = false;
    (async () => {
      const ids = projectIdsKey.split(',');
      const entries = await Promise.all(
        ids.map(async (id) => {
          const uploaded = Boolean(await fileStoreUploaded.getItem(id));
          return [id, uploaded] as const;
        })
      );
      if (cancelled) return;
      setHasUploadedFiles(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [projectIdsKey]);


  async function deleteProject(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    const projectName = project?.name || 'Unknown';

    updateProjectInCache(projectId, (prev) =>
      prev ? { ...prev, status: 'deleting' } : prev
    );

    await client.models.Project.update({
      id: projectId,
      status: 'deleting',
    });

    await logAdminAction(
      client,
      user.userId,
      `Deleted project "${projectName}" (ID: ${projectId})`,
      projectId,
      project?.organizationId || ''
    );

    client.mutations
      .deleteProjectInFull({ projectId: projectId }, { retry: false })
      .catch(() => {});
  }

  async function deleteAnnotationSet(
    projectId: string,
    annotationSetId: string
  ) {
    const project = projects.find((p) => p.id === projectId);
    const annotationSet = project?.annotationSets.find(
      (set: { id: string }) => set.id === annotationSetId
    );
    const annotationSetName = annotationSet?.name || 'Unknown';
    const projectName = project?.name || 'Unknown';

    // Info tags and their annotation links hang off the set and are not
    // cascaded by the delete, so clear them before the set itself goes. If they
    // cannot be cleared, keep the set rather than orphaning them.
    try {
      await deleteInfoTagDataForSet(client, annotationSetId);
    } catch (error) {
      console.error('Failed to delete info tags for annotation set', error);
      alert(
        `Could not delete "${annotationSetName}": its informational tags could not be removed. Please try again.`
      );
      return;
    }

    await client.models.AnnotationSet.delete({ id: annotationSetId });

    await logAdminAction(
      client,
      user.userId,
      `Deleted annotation set "${annotationSetName}" from project "${projectName}"`,
      projectId,
      project?.organizationId || ''
    );

    updateProjectInCache(projectId, (prev) =>
      prev
        ? {
            ...prev,
            annotationSets: prev.annotationSets.filter(
              (set: { id: string }) => set.id !== annotationSetId
            ),
          }
        : prev
    );
  }

  async function handleCancelJob() {
    const previousStatus = selectedProject!.status;
    updateProjectInCache(selectedProject!.id, (prev) =>
      prev ? { ...prev, status: 'updating' } : prev
    );

    try {
      // cancel an Individual ID job if one is in flight
      try {
        const { data: iidJobs } = await (
          client.models as any
        ).IndividualIdJob.individualIdJobsByProjectId(
          { projectId: selectedProject!.id },
          { selectionSet: ['id', 'status'] }
        );
        const iidJob = (iidJobs || []).find(
          (j: any) => j.status === 'active' || j.status === 'launching'
        );
        if (iidJob) {
          // The mutation closes the job's workflow run as well. Generated
          // client types come from the deployed outputs, so it is resolved at
          // runtime; before that deploy the direct update still works.
          const cancelJob = (
            client.mutations as unknown as Record<string, unknown>
          ).cancelIndividualIdJob;
          if (typeof cancelJob === 'function') {
            const { errors } = await (
              cancelJob as (args: { jobId: string }) => Promise<{
                errors?: { message?: string }[];
              }>
            )({ jobId: iidJob.id });
            if (errors?.length) {
              throw new Error(errors.map((e) => e.message).join('; '));
            }
          } else {
            await (client.models as any).IndividualIdJob.update({
              id: iidJob.id,
              status: 'cancelled',
            });
          }
          await logAdminAction(
            client,
            user.userId,
            `Cancelled ChainLinker job for project "${selectedProject!.name}"`,
            selectedProject!.id,
            selectedProject!.organizationId
          );
          return;
        }
      } catch (e) {
        console.error('Failed to cancel Individual ID job', e);
      }

      const job = selectedProject?.queues[0];

      if (!job?.url) {
        alert('An unknown error occurred. Please try again later.');
        return;
      }

      await client.mutations.deleteQueueMutation({ queueId: job.id });
      await logAdminAction(
        client,
        user.userId,
        `Cancelled queue job "${job.tag || job.name || 'Unknown'}" for project "${selectedProject!.name}"`,
        selectedProject!.id,
        selectedProject!.organizationId
      );
    } catch (error) {
      updateProjectInCache(selectedProject!.id, (prev) =>
        prev ? { ...prev, status: previousStatus } : prev
      );
      alert('An unknown error occurred. Please try again later.');
      console.error(error);
    } finally {
      await client.mutations.updateProjectMemberships({
        projectId: selectedProject!.id,
      });
    }
  }

  const filteredProjects = projects.filter((project) => {
    const searchLower = search.toLowerCase();
    const matchesStatus =
      project.status !== 'deleted' && project.status !== 'hidden';
    const matchesOrganization =
      !organizationFilter || project.organizationId === organizationFilter;
    const matchesAnnotationSet = project.annotationSets.some((set: { name: string }) =>
      set.name.toLowerCase().includes(searchLower)
    );
    const matchesSearch =
      searchLower === '' ||
      project.name.toLowerCase().includes(searchLower) ||
      project.organization.name.toLowerCase().includes(searchLower) ||
      matchesAnnotationSet;

    return matchesStatus && matchesOrganization && matchesSearch;
  });

  const sortedProjects = [...filteredProjects].sort((a, b) => {
    if (sortBy === 'createdAt') {
      return new Date(b.createdAt ?? '').getTime() - new Date(a.createdAt ?? '').getTime();
    }
    if (sortBy === 'createdAt-reverse') {
      return new Date(a.createdAt ?? '').getTime() - new Date(b.createdAt ?? '').getTime();
    }
    if (sortBy === 'name') {
      return a.name.localeCompare(b.name);
    }
    if (sortBy === 'name-reverse') {
      return b.name.localeCompare(a.name);
    }
    if (sortBy === 'activeJobs') {
      const hasJobA = a.queues.length > 0 || projectsWithIndividualIdJob.has(a.id);
      const hasJobB = b.queues.length > 0 || projectsWithIndividualIdJob.has(b.id);
      if (hasJobA !== hasJobB) return hasJobA ? -1 : 1;
      return new Date(b.createdAt ?? '').getTime() - new Date(a.createdAt ?? '').getTime();
    }
    return 0;
  });

  function renderAnnotationSetActions(
    project: Schema['Project']['type'],
    annotationSet: Schema['AnnotationSet']['type'],
    disabled: boolean,
    hasJobs: boolean,
    options: { wrap?: boolean; size?: 'sm' } = {}
  ) {
    // Mobile view should never be compact, so ignore compactMode when isMobile is true
    const effectiveCompactMode = isMobile ? false : compactMode;
    const { wrap = false, size = effectiveCompactMode ? 'sm' : undefined } = options;
    const gapClass = effectiveCompactMode ? 'gap-1' : 'gap-2';

    return (
      <div className={`d-flex ${wrap ? 'flex-wrap w-100' : 'flex-wrap'} ${gapClass}`}>
        <Button
          size={size}
          variant='primary'
          onClick={() => {
            setSelectedAnnotationSet(annotationSet);
            showModal('annotationCount');
          }}
          disabled={disabled || hasJobs}
        >
          Details
        </Button>
        <Button
          size={size}
          variant='primary'
          onClick={() => {
            setSelectedProject(project);
            setSelectedAnnotationSet(annotationSet);
            showModal('launchAnnotationSet');
          }}
          disabled={disabled || hasJobs}
        >
          Launch
        </Button>
        <Button
          size={size}
          variant='primary'
          onClick={() => {
            setSelectedProject(project);
            setSelectedAnnotationSet(annotationSet);
            showModal('editAnnotationSet');
          }}
          disabled={disabled || hasJobs}
        >
          Edit
        </Button>
        <Button
          size={size}
          variant='primary'
          onClick={() => {
            setSelectedProject(project);
            setSelectedAnnotationSet({ id: annotationSet.id, name: annotationSet.name } as Schema['AnnotationSet']['type']);
            showModal('annotationSetResults');
          }}
          disabled={disabled || hasJobs}
        >
          Results
        </Button>
        <Button
          size={size}
          variant='danger'
          onClick={() => {
            setSelectedProject(project);
            setSelectedAnnotationSet(annotationSet);
            showModal('deleteAnnotationSet');
          }}
          disabled={disabled || hasJobs}
        >
          <Trash />
        </Button>
      </div>
    );
  }

  function renderAnnotationSets(
    project: Schema['Project']['type'],
    disabled: boolean,
    hasJobs: boolean,
    options: { wrap?: boolean; size?: 'sm' } = {}
  ) {
    // Mobile view should never be compact, so ignore compactMode when isMobile is true
    const effectiveCompactMode = isMobile ? false : compactMode;
    const { wrap = false, size = effectiveCompactMode ? 'sm' : undefined } = options;
    const sortedAnnotationSets = [...project.annotationSets].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const gapClass = effectiveCompactMode ? 'gap-1' : 'gap-2';
    const borderClass = effectiveCompactMode ? 'pt-1' : 'pt-2';

    return (
      <div className={`d-flex flex-column ${gapClass} flex-grow-1`}>
        {isMobile && sortedAnnotationSets.length === 0 && (
          <Badge
            bg='secondary'
            style={{ width: 'fit-content', fontSize: '12px' }}
          >
            None
          </Badge>
        )}
        {sortedAnnotationSets.map((annotationSet, i) => (
          <div
            className={`d-flex flex-column ${gapClass} ${i === 0 ? '' : `border-top border-light ${borderClass}`
              }`}
            key={annotationSet.id}
          >
            <div className={`d-flex justify-content-between align-items-center ${gapClass} flex-wrap`}>
              <div style={{ fontSize: '16px' }}>{annotationSet.name}</div>
              {!hasJobs &&
                renderAnnotationSetActions(
                  project,
                  annotationSet,
                  disabled,
                  hasJobs,
                  { wrap, size }
                )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderProjectActions(
    project: Schema['Project']['type'],
    disabled: boolean,
    hasJobs: boolean,
    showResumeButton: boolean,
    showPauseButton: boolean,
    isStale: boolean,
    options: { wrap?: boolean; size?: 'sm' } = {}
  ) {
    // Mobile view should never be compact, so ignore compactMode when isMobile is true
    const effectiveCompactMode = isMobile ? false : compactMode;
    const { wrap = false, size = effectiveCompactMode ? 'sm' : undefined } = options;
    const gapClass = effectiveCompactMode ? 'gap-1' : 'gap-2';
    const containerClass = wrap
      ? `d-flex flex-wrap ${gapClass} w-100`
      : `d-flex ${gapClass} flex-wrap`;

    return (
      <div className={containerClass}>
        {project.status !== 'uploading' ? (
          <>
            <Button
              size={size}
              variant='primary'
              onClick={() => {
                setSelectedProject(project);
                showModal('editSurvey');
              }}
              disabled={
                process.env.NODE_ENV !== 'development' && (disabled || hasJobs)
              }
            >
              Edit
            </Button>
            <Button
              size={size}
              variant='primary'
              onClick={() => {
                setSelectedProject(project);
                showModal('addFiles');
              }}
              disabled={
                process.env.NODE_ENV !== 'development' && (disabled || hasJobs)
              }
            >
              Add files
            </Button>
            <Button
              size={size}
              variant='primary'
              onClick={() => {
                setSelectedProject(project);
                showModal('addAnnotationSet');
              }}
              disabled={disabled || hasJobs}
            >
              Add Annotation Set
            </Button>
            <Button
              size={size}
              variant='danger'
              onClick={() => {
                setSelectedProject(project);
                showModal('deleteSurvey');
              }}
              disabled={disabled || hasJobs}
            >
              <Trash />
            </Button>
          </>
        ) : (
          <>
            {!showPauseButton && (showResumeButton || isStale) && (
              <Button
                size={size}
                variant='info'
                onClick={() => {
                  if (showResumeButton) {
                    requestResume({ id: project.id, name: project.name });
                    return;
                  }

                  setFromStaleUpload(true);
                  setSelectedProject(project);
                  showModal('addFiles');
                }}
              >
                <Play />
              </Button>
            )}
            {isStale && (
              <Button
                size={size}
                variant='danger'
                disabled={deletingProjectId === project.id}
                onClick={() => {
                  requestDelete({ id: project.id, name: project.name });
                }}
              >
                <Trash />
              </Button>
            )}
          </>
        )}
      </div>
    );
  }

  const tableData = sortedProjects.map((project) => {
    const disabled =
      project.status === 'uploading' ||
      project.status?.includes('processing') ||
      project.status === 'launching' ||
      project.status === 'updating' ||
      project.status === 'deleting';

    const hasQueueOrRegisterJob =
      project.status !== 'launching' && project.queues.length > 0;
    const hasIndividualIdJob = projectsWithIndividualIdJob.has(project.id);
    // Combined signal used to lock the survey row down (disable Edit/Add/
    // Delete, hide per-set actions) exactly like any other active job.
    const hasJobs = hasQueueOrRegisterJob || hasIndividualIdJob;

    const showResumeButton =
      !uploadActive &&
      project.status === 'uploading' &&
      hasUploadedFiles[project.id];

    const showPauseButton =
      activeUploadProjectId === project.id && project.status === 'uploading';

    const isStale =
      project.status === 'uploading' &&
      new Date(project.updatedAt ?? '').getTime() < Date.now() - 1000 * 60 * 5;

    const gapClass = compactMode ? 'gap-1' : 'gap-2';
    const columnGapClass = compactMode ? 'gap-1' : 'gap-3';
    const badgeFontSize = compactMode ? '11px' : '14px';

    return {
      id: project.id,
      rowData: [
        <div className={`d-flex justify-content-between align-items-start align-items-lg-center ${gapClass} flex-wrap`}>
          <div className={`d-flex flex-column ${compactMode ? 'gap-0' : 'gap-1'}`}>
            {compactMode ? (
              <h6 className={`mb-0 ${isMobile ? 'fw-semibold' : ''}`}>
                {project.name}
              </h6>
            ) : (
              <h5 className={`mb-0 ${isMobile ? 'fw-semibold' : ''}`}>
                {project.name}
              </h5>
            )}
            {!compactMode && (
              <div className='d-flex flex-column'>
                <i style={{ fontSize: '14px' }}>{project.organization.name}</i>
                {project.status !== 'uploading' && (
                  <i style={{ fontSize: '14px' }}>
                    Images: {project.imageSets?.[0]?.imageCount || 0}
                  </i>
                )}
              </div>
            )}
            {project.status !== 'active' && (
              <Badge
                style={{ fontSize: badgeFontSize, width: 'fit-content' }}
                bg={'info'}
              >
                {project.status === 'launching'
                  ? 'Launching - please wait'
                  : project.status?.includes('processing')
                    ? 'Processing'
                    : project.status?.replace(/\b\w/g, (char) =>
                      char.toUpperCase()
                    )}
              </Badge>
            )}
          </div>
          {renderProjectActions(
            project,
            disabled,
            hasJobs,
            showResumeButton,
            showPauseButton,
            isStale
          )}
        </div>,
        <div className={`d-flex flex-column flex-md-row ${columnGapClass}`}>
          {renderAnnotationSets(project, disabled, hasJobs)}
          {hasQueueOrRegisterJob && (
            <div
              className={`d-flex flex-row align-items-center ${gapClass} w-100`}
              style={{ maxWidth: '500px' }}
            >
              <div className='flex-grow-1'>
                <ProjectProgress
                  queue={project.queues[0]}
                  onScanningChange={(isScanning) => {
                    setScanningProjects(prev => {
                      const next = new Set(prev);
                      isScanning ? next.add(project.id) : next.delete(project.id);
                      return next;
                    });
                  }}
                />
              </div>
              <div className={`d-flex ${gapClass} flex-wrap justify-content-end`}>
                <Button
                  size={compactMode ? 'sm' : undefined}
                  className='flex align-items-center justify-content-center'
                  disabled={disabled || scanningProjects.has(project.id)}
                  variant='primary'
                  onClick={() => navigate(`/jobs`)}
                >
                  <SquareArrowOutUpRight />
                </Button>
                <Button
                  size={compactMode ? 'sm' : undefined}
                  className='flex align-items-center justify-content-center'
                  disabled={disabled || scanningProjects.has(project.id)}
                  variant='danger'
                  onClick={() => {
                    setSelectedProject(project);
                    showModal('deleteJob');
                  }}
                >
                  <X />
                </Button>
              </div>
            </div>
          )}
          {project.status === 'active' && hasIndividualIdJob && (
            <div
              className={`d-flex flex-row align-items-center ${gapClass} w-100`}
              style={{ maxWidth: '500px' }}
            >
              <div className='flex-grow-1'>
                <IndividualIdProgress projectId={project.id} />
              </div>
              <div className={`d-flex ${gapClass} flex-wrap justify-content-end`}>
                <Button
                  size={compactMode ? 'sm' : undefined}
                  className='flex align-items-center justify-content-center'
                  variant='primary'
                  onClick={() => navigate(`/jobs`)}
                >
                  <SquareArrowOutUpRight />
                </Button>
                <Button
                  size={compactMode ? 'sm' : undefined}
                  className='flex align-items-center justify-content-center'
                  variant='danger'
                  onClick={() => {
                    setSelectedProject(project);
                    showModal('deleteJob');
                  }}
                >
                  <X />
                </Button>
              </div>
            </div>
          )}
        </div>,
      ],
    };
  });

  const renderProjectCard = (project: Schema['Project']['type']) => {
    const disabled =
      project.status === 'uploading' ||
      project.status?.includes('processing') ||
      project.status === 'launching' ||
      project.status === 'updating' ||
      project.status === 'deleting';

    const hasQueueOrRegisterJob =
      project.status !== 'launching' && project.queues.length > 0;
    const hasIndividualIdJob = projectsWithIndividualIdJob.has(project.id);
    // Combined signal used to lock the survey row down (disable Edit/Add/
    // Delete, hide per-set actions) exactly like any other active job.
    const hasJobs = hasQueueOrRegisterJob || hasIndividualIdJob;

    const showResumeButton =
      !uploadActive &&
      project.status === 'uploading' &&
      hasUploadedFiles[project.id];

    const showPauseButton =
      activeUploadProjectId === project.id && project.status === 'uploading';

    const isStale =
      project.status === 'uploading' &&
      new Date(project.updatedAt ?? '').getTime() < Date.now() - 1000 * 60 * 5;

    return (
      <Card
        key={project.id}
        className='shadow-sm'
        style={{ backgroundColor: '#6F7B89', color: '#fff', border: 'none' }}
      >
        <Card.Body className='d-flex flex-column gap-3'>
          <div className='d-flex flex-column gap-2'>
            <div className='d-flex justify-content-between align-items-start align-items-lg-center gap-2 flex-wrap'>
              <div className='d-flex flex-column gap-1'>
                <h5 className={`mb-0 ${isMobile ? 'fw-semibold' : ''}`}>
                  {project.name}
                </h5>
                <div className='text-muted' style={{ fontSize: '14px' }}>
                  {project.organization.name}
                </div>
                {project.status !== 'uploading' && (
                  <div className='text-muted' style={{ fontSize: '14px' }}>
                    Images: {project.imageSets?.[0]?.imageCount || 0}
                  </div>
                )}
                {project.status !== 'active' && (
                  <Badge
                    style={{ fontSize: '14px', width: 'fit-content' }}
                    bg={'info'}
                  >
                    {project.status === 'launching'
                      ? 'Launching - please wait'
                      : project.status?.includes('processing')
                        ? 'Processing'
                        : project.status?.replace(/\b\w/g, (char) =>
                          char.toUpperCase()
                        )}
                  </Badge>
                )}
              </div>
              {renderProjectActions(
                project,
                disabled,
                hasJobs,
                showResumeButton,
                showPauseButton,
                isStale,
                { wrap: true, size: 'sm' }
              )}
            </div>
            {hasQueueOrRegisterJob && (
              <div
                className={`d-flex flex-row align-items-center gap-2 ${isMobile ? 'pt-3 border-top border-light' : ''
                  }`}
              >
                <div className='flex-grow-1'>
                  <ProjectProgress
                    queue={project.queues[0]}
                    onScanningChange={(isScanning) => {
                      setScanningProjects(prev => {
                        const next = new Set(prev);
                        isScanning ? next.add(project.id) : next.delete(project.id);
                        return next;
                      });
                    }}
                  />
                </div>
                <div className='d-flex gap-2 flex-wrap justify-content-end'>
                  <Button
                    size='sm'
                    className='flex align-items-center justify-content-center'
                    disabled={disabled || scanningProjects.has(project.id)}
                    variant='primary'
                    onClick={() => navigate(`/jobs`)}
                  >
                    <SquareArrowOutUpRight />
                  </Button>
                  <Button
                    size='sm'
                    className='flex align-items-center justify-content-center'
                    disabled={disabled || scanningProjects.has(project.id)}
                    variant='danger'
                    onClick={() => {
                      setSelectedProject(project);
                      showModal('deleteJob');
                    }}
                  >
                    <X />
                  </Button>
                </div>
              </div>
            )}
            {project.status === 'active' && hasIndividualIdJob && (
              <div
                className={`d-flex flex-row align-items-center gap-2 ${isMobile ? 'pt-3 border-top border-light' : ''
                  }`}
              >
                <div className='flex-grow-1'>
                  <IndividualIdProgress projectId={project.id} />
                </div>
                <div className='d-flex gap-2 flex-wrap justify-content-end'>
                  <Button
                    size='sm'
                    className='flex align-items-center justify-content-center'
                    variant='primary'
                    onClick={() => navigate(`/jobs`)}
                  >
                    <SquareArrowOutUpRight />
                  </Button>
                  <Button
                    size='sm'
                    className='flex align-items-center justify-content-center'
                    variant='danger'
                    onClick={() => {
                      setSelectedProject(project);
                      showModal('deleteJob');
                    }}
                  >
                    <X />
                  </Button>
                </div>
              </div>
            )}
          </div>
          <div
            className={`d-flex flex-column gap-2 ${isMobile ? 'pt-3 border-top border-light' : ''
              }`}
          >
            <div className='fw-semibold'>Annotation Sets</div>
            {renderAnnotationSets(project, disabled, hasJobs, {
              wrap: true,
              size: 'sm',
            })}
          </div>
        </Card.Body>
      </Card>
    );
  };

  const emptyMessage = 'You are not an admin of any surveys.';

  if (projects.length === 0 && !isOrganizationAdmin) {
    return <div>You are not authorized to access this page.</div>;
  }

  return (
    <>
      <div
        style={{
          width: '100%',
          maxWidth: '1555px',
          marginTop: '16px',
          marginBottom: '16px',
        }}
      >
        <Card>
          <Card.Header className='d-flex flex-column flex-lg-row align-items-lg-center gap-3'>
            <Card.Title
              className='mb-0 flex-shrink-0'
              style={{ whiteSpace: 'nowrap' }}
            >
              <h4 className='mb-0'>Your Surveys</h4>
            </Card.Title>
            <div className='d-flex flex-column flex-lg-row gap-2 w-100 w-lg-auto ms-lg-auto justify-content-lg-end align-items-lg-center'>
              <Form.Control
                className='w-100'
                type='text'
                style={{
                  minWidth: 0,
                  width: '100%',
                  maxWidth: isMobile ? '100%' : '250px',
                }}
                placeholder='Search'
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Form.Select
                className='w-100 w-lg-auto'
                value={organizationFilter}
                onChange={(e) => setOrganizationFilter(e.target.value)}
                style={{
                  minWidth: 0,
                  width: '100%',
                  maxWidth: isMobile ? '100%' : '250px',
                }}
              >
                <option value=''>All organisations</option>
                {organizationOptions.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </Form.Select>
              <Form.Select
                className='w-100 w-lg-auto'
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  minWidth: 0,
                  width: '100%',
                  maxWidth: isMobile ? '100%' : '250px',
                }}
              >
                <option value='createdAt'>Created (newest first)</option>
                <option value='createdAt-reverse'>
                  Created (oldest first)
                </option>
                <option value='name'>Name (A-Z)</option>
                <option value='name-reverse'>Name (Z-A)</option>
                <option value='activeJobs'>Active jobs first</option>
              </Form.Select>
              {!isMobile && (
                <Button
                  variant='info'
                  // size='sm'
                  onClick={() => setCompactMode(!compactMode)}
                  title={compactMode ? 'Expand view' : 'Compact view'}
                  style={{
                    minWidth: 'fit-content',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {compactMode ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
                </Button>
              )}
            </div>
          </Card.Header>
          <Card.Body
            className={
              isMobile
                ? 'd-flex flex-column gap-3 p-3'
                : 'overflow-x-auto overflow-y-visible'
            }
          >
            {isMobile ? (
              sortedProjects.length > 0 ? (
                <div className='d-flex flex-column gap-3'>
                  {sortedProjects.map((project) => renderProjectCard(project))}
                </div>
              ) : (
                <div className='text-center py-3'>
                  <h5 className='mb-0'>{emptyMessage}</h5>
                </div>
              )
            ) : (
              <MyTable
                tableHeadings={[
                  { content: 'Survey', style: { width: '50%' } },
                  { content: 'Annotation Sets', style: { width: '50%' } },
                ]}
                tableData={tableData}
                pagination={true}
                itemsPerPage={5}
                emptyMessage={emptyMessage}
              />
            )}
          </Card.Body>
          {isOrganizationAdmin && (
            <Card.Footer className='d-flex justify-content-center'>
              <div className='d-inline-block'>
                <Button variant='primary' onClick={() => showModal('newSurvey')}
                >
                  New Survey
                </Button>
              </div>
            </Card.Footer>
          )}
        </Card>
        {/* {process.env.NODE_ENV === 'development' && <UploadIntegrityChecker />} */}
      </div>
      <NewSurveyModal
        show={modalToShow === 'newSurvey'}
        projects={projects.map((project) => project.name.toLowerCase())}
      />
      <ConfirmationModal
        show={modalToShow === 'deleteSurvey'}
        onClose={() => {
          showModal(null);
          setSelectedProject(null);
        }}
        onConfirm={() => deleteProject(selectedProject!.id)}
        title='Delete Survey'
        body={
          <p className='mb-0'>
            Are you sure you want to delete {selectedProject?.name}?
            <br />
            This action cannot be undone.
          </p>
        }
      />
      <ConfirmationModal
        show={modalToShow === 'deleteAnnotationSet'}
        onClose={() => {
          showModal(null);
          setSelectedProject(null);
          setSelectedAnnotationSet(null);
        }}
        onConfirm={() =>
          deleteAnnotationSet(selectedProject!.id, selectedAnnotationSet!.id)
        }
        title='Delete Annotation Set'
        body={
          <p className='mb-0'>
            Are you sure you want to delete {selectedAnnotationSet?.name}?
            <br />
            This action cannot be undone.
          </p>
        }
      />
      <ConfirmationModal
        show={modalToShow === 'deleteJob'}
        title='Cancel Associated Job'
        body={
          <p className='mb-0'>
            Are you sure you want to cancel the job associated with{' '}
            {selectedProject?.name}?
            <br />
            You can re-launch the job later.
          </p>
        }
        onConfirm={() => handleCancelJob()}
        onClose={() => {
          showModal(null);
          setSelectedProject(null);
        }}
      />
      {selectedProject && (
        <FilesUploadComponent
          show={modalToShow === 'addFiles'}
          fromStaleUpload={fromStaleUpload}
          handleClose={() => {
            showModal(null);
            setSelectedProject(null);
            setFromStaleUpload(false);
          }}
          project={{ id: selectedProject.id, name: selectedProject.name }}
        />
      )}
      {selectedProject && selectedAnnotationSet && (
        <AnnotationSetResults
          show={modalToShow === 'annotationSetResults'}
          onClose={() => {
            showModal(null);
            setSelectedProject(null);
            setSelectedAnnotationSet(null);
          }}
          annotationSet={selectedAnnotationSet}
          surveyId={selectedProject.id}
        />
      )}
      {selectedAnnotationSet && (
        <AnnotationCountModal
          setId={selectedAnnotationSet.id}
          show={modalToShow === 'annotationCount'}
          handleClose={() => {
            showModal(null);
            setSelectedAnnotationSet(null);
          }}
        />
      )}
      {selectedAnnotationSet && selectedProject && (
        <EditAnnotationSetModal
          show={modalToShow === 'editAnnotationSet'}
          handleClose={() => {
            showModal(null);
            setSelectedProject(null);
            setSelectedAnnotationSet(null);
          }}
          project={selectedProject}
          categories={selectedProject.categories}
          annotationSet={selectedAnnotationSet}
          setAnnotationSet={(annotationSet) => {
            if (!selectedProject) return;
            updateProjectInCache(selectedProject.id, (prev) =>
              prev
                ? {
                    ...prev,
                    annotationSets: prev.annotationSets.map((set: { id: string }) =>
                      set.id === annotationSet.id ? annotationSet : set
                    ),
                  }
                : prev
            );
          }}
          setEditSurveyTab={setTab}
        />
      )}
      {selectedProject && (
        <AddAnnotationSetModal
          show={modalToShow === 'addAnnotationSet'}
          onClose={() => {
            showModal(null);
            setSelectedProject(null);
          }}
          project={selectedProject}
          allProjects={projects}
          addAnnotationSet={(annotationSet) => {
            if (!selectedProject) return;
            updateProjectInCache(selectedProject.id, (prev) =>
              prev
                ? {
                    ...prev,
                    annotationSets: [
                      ...prev.annotationSets,
                      {
                        id: annotationSet.id,
                        name: annotationSet.name,
                      } as (typeof prev.annotationSets)[number],
                    ],
                  }
                : prev
            );
            // Log asynchronously without blocking
            logAdminAction(
              client,
              user.userId,
              `Added annotation set "${annotationSet.name}" to project "${selectedProject?.name}"`,
              selectedProject?.id || '',
              selectedProject?.organizationId || ''
            ).catch(console.error);
          }}
        />
      )}
      {selectedProject && selectedAnnotationSet && (
        <LaunchAnnotationSetModal
          show={modalToShow === 'launchAnnotationSet'}
          annotationSet={selectedAnnotationSet}
          project={selectedProject}
          onOptimisticStatus={(projectId, status) => {
            updateProjectInCache(projectId, (prev) =>
              prev ? { ...prev, status } : prev
            );
            setSelectedProject((prev) =>
              prev && prev.id === projectId ? { ...prev, status } : prev
            );
          }}
        />
      )}
      {selectedProject && (
        <EditSurveyModal
          show={modalToShow === 'editSurvey'}
          onClose={() => {
            showModal(null);
            // setSelectedProject(null);
          }}
          project={selectedProject}
          openTab={tab}
        />
      )}
    </>
  );
}
