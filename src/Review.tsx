import { Combobox } from '@/components/ui/combobox';
import { useQuery } from '@tanstack/react-query';
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { useParams } from 'react-router-dom';
import { AnnotationSetDropdown } from './AnnotationSetDropDown';
import { GlobalContext, ManagementContext, ProjectContext } from './Context';

import './Review.css';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ChevronRight, PanelBottom } from 'lucide-react';
import { useUsers } from './apiInterface';
import DensityMap, { type DensitySource } from './DensityMap';
import ReviewImages from './ReviewImages';
import { CollapsedSidebar, SidebarCollapseButton } from './SidebarCollapse';
import { useSyncViewerEdits } from './sightingQueries';
import { Tab, Tabs } from './Tabs';
import { useInfoTagData } from './useInfoTags';
import { useSidebarCollapsed } from './useSidebarCollapsed';
import { fetchAllPaginatedResults } from './utils';

type Option = { label: string; value: string };

export function Review({ showAnnotationSetDropdown = true }) {
  const [selectedCategories, setSelectedCategories] = useState<Option[]>([]);
  const [selectedInfoTags, setSelectedInfoTags] = useState<Option[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Option[]>([]);
  const [tab, setTab] = useState<'images' | 'map'>('map');
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedAnnotationSet, setSelectedAnnotationSet] =
    useState<string>('');
  const [primaryOnly, setPrimaryOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();
  const primaryOnlyId = useId();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { client } = useContext(GlobalContext)!;
  const {
    categoriesHook: { data: categories },
    project,
  } = useContext(ProjectContext)!;
  useSyncViewerEdits(
    useMemo(
      () => new Map((categories ?? []).map((c) => [c.id, c.name])),
      [categories],
    ),
  );
  const { annotationSetId } = useParams();
  const {
    annotationSetsHook: { data: annotationSets },
  } = useContext(ManagementContext)!;

  // Fetch users with project membership
  const { users } = useUsers();
  const [projectMemberships, setProjectMemberships] = useState<
    { userId: string }[]
  >([]);

  // Extra annotation sets, from any survey in the organisation, overlaid on the map.
  const [overlaySetIds, setOverlaySetIds] = useState<string[]>([]);
  // Transects reported by the map (consistent numbering) + the active filter.
  const [transectOptionsRaw, setTransectOptionsRaw] = useState<
    { id: string; surveyId: string; number: number }[]
  >([]);
  const [selectedTransectIds, setSelectedTransectIds] = useState<string[]>([]);
  // Transect filter can either be a dropdown selection or free-typed numbers.
  const [transectInputMode, setTransectInputMode] = useState<
    'select' | 'input'
  >('select');
  const [transectInputText, setTransectInputText] = useState('');

  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;

    async function fetchMemberships() {
      const memberships = await fetchAllPaginatedResults(
        client.models.UserProjectMembership.userProjectMembershipsByProjectId,
        {
          projectId: project.id,
          selectionSet: ['userId'],
          limit: 1000,
        },
      );
      if (!cancelled) {
        setProjectMemberships(memberships as { userId: string }[]);
      }
    }

    fetchMemberships();
    return () => {
      cancelled = true;
    };
  }, [client, project?.id]);

  // Build user options from memberships + users lookup (deduplicated by userId)
  const userOptions = useMemo(() => {
    if (!users || !projectMemberships.length) return [];
    const seenUserIds = new Set<string>();
    return projectMemberships
      .filter((membership) => {
        if (seenUserIds.has(membership.userId)) return false;
        seenUserIds.add(membership.userId);
        return true;
      })
      .map((membership) => {
        const user = users.find((u) => u.id === membership.userId);
        return user
          ? { label: user.name || user.email || user.id, value: user.id }
          : null;
      })
      .filter((opt): opt is Option => opt !== null)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [users, projectMemberships]);

  useEffect(() => {
    if (annotationSetId && !showAnnotationSetDropdown) {
      setSelectedAnnotationSet(annotationSetId);
    }
  }, [annotationSetId, showAnnotationSetDropdown]);

  // --- Surveys of the same organization (cached) --------------------------
  const orgSurveysQuery = useQuery({
    queryKey: ['review-org-surveys', project.organizationId],
    enabled: !!project?.organizationId,
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      fetchAllPaginatedResults(client.models.Project.list, {
        filter: { organizationId: { eq: project.organizationId } },
        selectionSet: [
          'id',
          'name',
          'status',
          'annotationSets.id',
          'annotationSets.name',
        ] as const,
      }),
  });

  const orgSurveys = useMemo(
    () =>
      (
        (orgSurveysQuery.data ?? []) as {
          id: string;
          name: string;
          status?: string | null;
          annotationSets?: { id: string; name: string }[] | null;
        }[]
      ).filter((survey) => survey.status !== 'deleted'),
    [orgSurveysQuery.data],
  );

  const surveyLabel = (id: string) =>
    orgSurveys.find((survey) => survey.id === id)?.name ??
    (id === project.id ? project.name : 'Survey');

  const overlayOptions = useMemo(
    () =>
      orgSurveys
        .flatMap((survey) =>
          (survey.annotationSets ?? []).map((set) => ({
            label: `${survey.name} · ${set.name}`,
            value: set.id,
            surveyId: survey.id,
          })),
        )
        .filter((option) => option.value !== selectedAnnotationSet)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [orgSurveys, selectedAnnotationSet],
  );

  useEffect(() => {
    if (annotationSets?.length === 1) {
      setSelectedAnnotationSet((prev) => prev || annotationSets[0].id);
    }
  }, [annotationSets]);

  const mapSources = useMemo<DensitySource[]>(() => {
    const out: DensitySource[] = selectedAnnotationSet
      ? [{ surveyId: project.id, annotationSetId: selectedAnnotationSet }]
      : [];
    for (const id of overlaySetIds) {
      const option = overlayOptions.find((o) => o.value === id);
      if (option) {
        out.push({ surveyId: option.surveyId, annotationSetId: id });
      }
    }
    return out;
  }, [project.id, selectedAnnotationSet, overlaySetIds, overlayOptions]);

  const categoryNames = useMemo(
    () => selectedCategories.map((c) => c.label),
    [selectedCategories],
  );

  // Informational tags defined on the primary set. Tags are filtered by name so
  // the selection also applies to any other sets overlaid on the map.
  const { tagNames: infoTagOptionNames } = useInfoTagData(
    selectedAnnotationSet ? [selectedAnnotationSet] : [],
  );
  const infoTagOptions = useMemo<Option[]>(
    () => infoTagOptionNames.map((name) => ({ label: name, value: name })),
    [infoTagOptionNames],
  );
  const infoTagNames = useMemo(
    () => selectedInfoTags.map((t) => t.value),
    [selectedInfoTags],
  );

  // Drop selections the newly-chosen set does not define (but not while its
  // tags are still loading, which would clear the filter on every set change).
  useEffect(() => {
    if (!infoTagOptionNames.length) return;
    setSelectedInfoTags((prev) => {
      if (!prev.length) return prev;
      const valid = new Set(infoTagOptionNames);
      const next = prev.filter((tag) => valid.has(tag.value));
      return next.length === prev.length ? prev : next;
    });
  }, [infoTagOptionNames]);

  // The map reports the transects it found (with the numbering it renders); we
  // turn those into filter options and prune selections that no longer exist.
  const handleTransectsLoaded = useCallback(
    (list: { id: string; surveyId: string; number: number }[]) => {
      setTransectOptionsRaw(list);
      setSelectedTransectIds((prev) => {
        if (!prev.length) return prev;
        const valid = new Set(list.map((t) => t.id));
        const next = prev.filter((id) => valid.has(id));
        return next.length === prev.length ? prev : next;
      });
    },
    [],
  );

  const transectOptions = useMemo<Option[]>(() => {
    const multiSurvey =
      new Set(transectOptionsRaw.map((t) => t.surveyId)).size > 1;
    return [...transectOptionsRaw]
      .sort((a, b) =>
        a.surveyId === b.surveyId
          ? a.number - b.number
          : surveyLabel(a.surveyId).localeCompare(surveyLabel(b.surveyId)),
      )
      .map((t) => ({
        value: t.id,
        label: multiSurvey
          ? `${surveyLabel(t.surveyId)} · Transect ${t.number}`
          : `Transect ${t.number}`,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transectOptionsRaw, orgSurveys]);

  // Free-text mode: take comma-separated transect ids verbatim (these are the
  // ids stored in the database, not the display numbers).
  const handleTransectInputChange = (text: string) => {
    setTransectInputText(text);
    const ids = text
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    setSelectedTransectIds(ids);
  };

  // Switching modes keeps the two inputs in sync: entering input mode seeds the
  // text box from the currently-selected ids.
  const handleTransectModeToggle = (toInput: boolean) => {
    if (toInput) {
      setTransectInputText(selectedTransectIds.join(', '));
    }
    setTransectInputMode(toInput ? 'input' : 'select');
  };

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '1555px',
        marginTop: '16px',
        marginBottom: '16px',
      }}
    >
      <div className='flex h-full w-full flex-col gap-2 sm:flex-row'>
        {sidebarCollapsed && <CollapsedSidebar onExpand={toggleSidebar} />}
        <div
          className={cn(
            'flex w-full flex-col gap-2',
            sidebarCollapsed && 'sm:hidden',
          )}
          style={{
            maxWidth: '300px',
            maxHeight: 'calc(100vh - 32px)',
            overflow: 'hidden',
          }}
        >
          <Card className='hidden w-full sm:block'>
            <CardHeader className='flex flex-row items-center justify-between'>
              <CardTitle className='mb-0'>Information</CardTitle>
              <SidebarCollapseButton onClick={toggleSidebar} />
            </CardHeader>
            <CardContent className='flex flex-col gap-2'>
              <p className='mb-0'>
                <strong>Survey:</strong> {project.name}
              </p>
              <p className='mb-0'>
                <strong>Annotation Set:</strong>{' '}
                {annotationSets?.find((set) => set.id === selectedAnnotationSet)
                  ?.name ?? 'Unknown'}
              </p>
            </CardContent>
          </Card>
          <Card className='flex w-full grow flex-col' style={{ minHeight: 0 }}>
            <CardHeader>
              <CardTitle className='mb-0 flex items-center'>
                <Button
                  className='mb-0 p-0 hover:bg-transparent'
                  variant='ghost'
                  onClick={() => setShowFilters(!showFilters)}
                >
                  <PanelBottom
                    className='size-6 sm:hidden'
                    style={{
                      transform: showFilters
                        ? 'rotate(180deg)'
                        : 'rotate(0deg)',
                    }}
                  />
                </Button>
                Filters
              </CardTitle>
            </CardHeader>
            {showFilters && (
              <CardContent
                className='flex flex-col gap-2'
                style={{ overflowY: 'auto', minHeight: 0 }}
              >
                <Combobox
                  value={selectedCategories}
                  onChange={(options) => setSelectedCategories(options)}
                  multiple
                  name='Labels to review'
                  options={
                    categories
                      ?.filter(
                        (c) => c.annotationSetId === selectedAnnotationSet,
                      )
                      .map((q) => ({
                        label: q.name,
                        value: q.id,
                      })) ?? []
                  }
                  placeholder='All labels'
                />

                {/* Only tagged surveys get the filter; others would see an empty control. */}
                {infoTagOptions.length > 0 && (
                  <Combobox
                    value={selectedInfoTags}
                    onChange={(options) => setSelectedInfoTags(options)}
                    multiple
                    name='Info tags to review'
                    options={infoTagOptions}
                    placeholder='Any info tags'
                  />
                )}

                <Combobox
                  value={selectedUsers}
                  onChange={(options) => setSelectedUsers(options)}
                  multiple
                  name='Users to filter'
                  options={userOptions}
                  placeholder='All users'
                />

                {tab === 'map' && (
                  <div className='flex items-center gap-2 py-1'>
                    <Switch
                      id={primaryOnlyId}
                      checked={primaryOnly}
                      onCheckedChange={(c) => setPrimaryOnly(c)}
                    />
                    <Label htmlFor={primaryOnlyId} className='mb-0'>
                      Primary sightings only
                    </Label>
                  </div>
                )}

                {showAnnotationSetDropdown && (
                  <AnnotationSetDropdown
                    selectedSet={selectedAnnotationSet}
                    setAnnotationSet={setSelectedAnnotationSet}
                    canCreate={false}
                  />
                )}

                <div className='border-t border-white/10'>
                  <button
                    type='button'
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className='flex w-full items-center gap-2 py-2 text-left text-sm text-muted-foreground hover:text-foreground'
                  >
                    <ChevronRight
                      className={cn(
                        'size-4 transition-transform',
                        showAdvanced && 'rotate-90',
                      )}
                    />
                    More filters
                  </button>

                  {showAdvanced && (
                    <div className='flex flex-col gap-2 pb-1'>
                      {transectInputMode === 'input' ? (
                        <Input
                          type='text'
                          aria-label='Transect ids'
                          value={transectInputText}
                          onChange={(e) =>
                            handleTransectInputChange(e.target.value)
                          }
                          placeholder='Transect ids, comma-separated'
                        />
                      ) : (
                        <Combobox
                          value={selectedTransectIds.map((id) => ({
                            label:
                              transectOptions.find((o) => o.value === id)
                                ?.label ?? id,
                            value: id,
                          }))}
                          onChange={(options) =>
                            setSelectedTransectIds(options.map((v) => v.value))
                          }
                          multiple
                          name='Transects to filter'
                          options={transectOptions}
                          disabled={transectOptions.length === 0}
                          placeholder={
                            transectOptions.length === 0
                              ? 'No transects'
                              : 'All transects'
                          }
                        />
                      )}
                      <button
                        type='button'
                        className='self-end text-xs text-muted-foreground hover:text-foreground'
                        onClick={() =>
                          handleTransectModeToggle(
                            transectInputMode !== 'input',
                          )
                        }
                      >
                        {transectInputMode === 'input'
                          ? 'Pick transects from a list'
                          : 'Enter transect ids instead'}
                      </button>

                      <Combobox
                        value={overlayOptions.filter((o) =>
                          overlaySetIds.includes(o.value),
                        )}
                        onChange={(options) =>
                          setOverlaySetIds(options.map((o) => o.value))
                        }
                        multiple
                        name='Annotation sets to overlay'
                        options={overlayOptions}
                        loading={orgSurveysQuery.isLoading}
                        placeholder='Overlay other annotation sets...'
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        </div>
        <Card className='h-full w-full'>
          <CardContent>
            <Tabs
              keepMounted
              activeTab={tab === 'map' ? 0 : 1}
              onTabChange={(index) => setTab(index === 0 ? 'map' : 'images')}
            >
              <Tab label='Map'>
                <div className='h-full w-full pt-4'>
                  <DensityMap
                    sources={mapSources}
                    primaryAnnotationSetId={selectedAnnotationSet}
                    categoryNames={categoryNames}
                    infoTagNames={infoTagNames}
                    selectedUserIds={selectedUsers.map((u) => u.value)}
                    transectIds={selectedTransectIds}
                    onTransectsLoaded={handleTransectsLoaded}
                    primaryOnly={primaryOnly}
                    editable
                  />
                </div>
              </Tab>
              <Tab label='Images'>
                <ReviewImages
                  surveyId={project.id}
                  annotationSetId={selectedAnnotationSet}
                  categoryIds={selectedCategories.map((c) => c.value)}
                  userIds={selectedUsers.map((u) => u.value)}
                  infoTagNames={infoTagNames}
                  transectIds={selectedTransectIds}
                  selectedImageId={selectedImageId}
                  onSelectImage={setSelectedImageId}
                  visible={tab === 'images'}
                />
              </Tab>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
