import { useParams } from 'react-router-dom';
import {
  useEffect,
  useState,
  useContext,
  useMemo,
  useRef,
  useCallback,
} from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { AnnotationSetDropdown } from './AnnotationSetDropDown';
import Select, { MultiValue, type CSSObjectWithLabel } from 'react-select';
import { ProjectContext, ManagementContext } from './Context';
import { client } from './stores/appClient';
import { Form } from 'react-bootstrap';
import './Review.css';
import { Card } from 'react-bootstrap';
import Button from 'react-bootstrap/Button';
import { PanelBottom, ChevronRight } from 'lucide-react';
import { Tab, Tabs } from './Tabs';
import ReviewCarousel from './ReviewCarousel';
import DensityMap, { type DensitySource } from './DensityMap';
import { useUsers } from './apiInterface';
import { fetchAllPaginatedResults } from './utils';
import { useInfoTagData } from './useInfoTags';

type Option = { label: string; value: string };

// Render react-select menus in a body portal with a high z-index so they are
// not clipped by the scrollable Filters card. The portal escapes the
// `text-black` container class, so option/value text colours are set here to
// keep the dropdown readable.
const menuPortalStyles = {
  menuPortal: (base: CSSObjectWithLabel) => ({ ...base, zIndex: 9999 }),
  option: (
    base: CSSObjectWithLabel,
    state: { isSelected: boolean; isFocused: boolean }
  ) => ({
    ...base,
    color: '#000',
    backgroundColor: state.isSelected
      ? '#cfe2ff'
      : state.isFocused
        ? '#e9ecef'
        : '#fff',
  }),
  input: (base: CSSObjectWithLabel) => ({ ...base, color: '#000' }),
  singleValue: (base: CSSObjectWithLabel) => ({ ...base, color: '#000' }),
};

export function Review({ showAnnotationSetDropdown = true }) {
  const [selectedCategories, setSelectedCategories] = useState<Option[]>([]);
  const [selectedInfoTags, setSelectedInfoTags] = useState<Option[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Option[]>([]);
  const [tab, setTab] = useState<'carousel' | 'map'>('map');
  const [selectedAnnotationSet, setSelectedAnnotationSet] =
    useState<string>('');
  const [imageBased] = useState(true);
  const [primaryOnly, setPrimaryOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const {
    categoriesHook: { data: categories },
    project,
  } = useContext(ProjectContext)!;
  const { annotationSetId } = useParams();
  const {
    annotationSetsHook: { data: annotationSets },
  } = useContext(ManagementContext)!;

  // Fetch users with project membership
  const { users } = useUsers();
  const [projectMemberships, setProjectMemberships] = useState<
    { userId: string }[]
  >([]);

  // --- Advanced multi-survey selection ------------------------------------
  // Surveys (of the same organization) whose data is overlaid on the map, and
  // the annotation set(s) selected within each. The current survey is selected
  // by default and tracks the primary annotation set chosen below.
  const [selectedSurveyIds, setSelectedSurveyIds] = useState<string[]>([]);
  const [setsBySurvey, setSetsBySurvey] = useState<Record<string, string[]>>(
    {}
  );
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
        }
      );
      if (!cancelled) {
        setProjectMemberships(memberships as { userId: string }[]);
      }
    }

    fetchMemberships();
    return () => {
      cancelled = true;
    };
  }, [project?.id]);

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
        selectionSet: ['id', 'name', 'status'],
      }),
  });

  const surveyOptions = useMemo<Option[]>(() => {
    const data = (orgSurveysQuery.data ?? []) as {
      id: string;
      name: string;
      status?: string | null;
    }[];
    return data
      .filter((p) => p.status !== 'deleted')
      .map((p) => ({ label: p.name, value: p.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [orgSurveysQuery.data]);

  const surveyLabel = (id: string) =>
    surveyOptions.find((o) => o.value === id)?.label ??
    (id === project.id ? project.name : 'Survey');

  // --- Annotation sets per selected survey (one cached query each) --------
  // Keyed by surveyId, so adding/removing a survey only fetches the new one.
  const setQueries = useQueries({
    queries: selectedSurveyIds.map((sid) => ({
      queryKey: ['review-survey-sets', sid],
      staleTime: 5 * 60 * 1000,
      queryFn: () =>
        fetchAllPaginatedResults(
          client.models.AnnotationSet.annotationSetsByProjectId,
          { projectId: sid, selectionSet: ['id', 'name'] }
        ),
    })),
  });

  const surveyIdsKey = selectedSurveyIds.join(',');
  const setQueryLenKey = setQueries
    .map((q) => (q.data ? (q.data as Array<unknown>).length : 0))
    .join(',');

  const setOptionsBySurvey = useMemo<Record<string, Option[]>>(() => {
    const out: Record<string, Option[]> = {};
    selectedSurveyIds.forEach((sid, i) => {
      const data = (setQueries[i]?.data ?? []) as {
        id: string;
        name: string;
      }[];
      out[sid] = data
        .map((s) => ({ label: s.name, value: s.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyIdsKey, setQueryLenKey]);

  // Default the survey selection to the current survey once it is known.
  useEffect(() => {
    if (!project?.id) return;
    setSelectedSurveyIds((prev) => (prev.length ? prev : [project.id]));
  }, [project?.id]);

  // Keep the current survey's set selection in sync with the primary set
  // chosen below (replacing the previously-synced primary, keeping extras).
  const prevPrimaryRef = useRef<string>('');
  useEffect(() => {
    if (!project?.id) return;
    setSetsBySurvey((prev) => {
      const current = prev[project.id] ?? [];
      const withoutOld = current.filter((id) => id !== prevPrimaryRef.current);
      const next = selectedAnnotationSet
        ? Array.from(new Set([selectedAnnotationSet, ...withoutOld]))
        : withoutOld;
      prevPrimaryRef.current = selectedAnnotationSet;
      const unchanged =
        next.length === current.length &&
        next.every((id, i) => id === current[i]);
      return unchanged ? prev : { ...prev, [project.id]: next };
    });
  }, [selectedAnnotationSet, project?.id]);

  // When a selected survey exposes exactly one annotation set, auto-select it.
  // For the current survey this drives the primary set (which then syncs into
  // the map + carousel via the effect above); for others it fills the row.
  useEffect(() => {
    selectedSurveyIds.forEach((sid) => {
      const opts = setOptionsBySurvey[sid];
      if (!opts || opts.length !== 1) return;
      const only = opts[0].value;
      if (sid === project.id) {
        setSelectedAnnotationSet((prev) => prev || only);
      } else {
        setSetsBySurvey((prev) =>
          prev[sid]?.length ? prev : { ...prev, [sid]: [only] }
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setOptionsBySurvey, surveyIdsKey, project.id]);

  const handleSurveysChange = (newValue: MultiValue<Option>) => {
    const ids = newValue.map((v) => v.value);
    setSelectedSurveyIds(ids);
    // Drop set selections for surveys no longer selected.
    setSetsBySurvey((prev) => {
      const next: Record<string, string[]> = {};
      for (const id of ids) if (prev[id]) next[id] = prev[id];
      return next;
    });
  };

  const handleSetsChange = (surveyId: string, newValue: MultiValue<Option>) => {
    setSetsBySurvey((prev) => ({
      ...prev,
      [surveyId]: newValue.map((v) => v.value),
    }));
  };

  // Flatten the selection into the (survey, set) sources the map renders.
  const mapSources = useMemo<DensitySource[]>(() => {
    const out: DensitySource[] = [];
    for (const sid of selectedSurveyIds) {
      for (const aid of setsBySurvey[sid] ?? []) {
        out.push({ surveyId: sid, annotationSetId: aid });
      }
    }
    return out;
  }, [selectedSurveyIds, setsBySurvey]);

  const categoryNames = useMemo(
    () => selectedCategories.map((c) => c.label),
    [selectedCategories]
  );

  // Informational tags defined on the primary set. Tags are filtered by name so
  // the selection also applies to any other sets overlaid on the map.
  const { tagNames: infoTagOptionNames } = useInfoTagData(
    selectedAnnotationSet ? [selectedAnnotationSet] : []
  );
  const infoTagOptions = useMemo<Option[]>(
    () => infoTagOptionNames.map((name) => ({ label: name, value: name })),
    [infoTagOptionNames]
  );
  const infoTagNames = useMemo(
    () => selectedInfoTags.map((t) => t.value),
    [selectedInfoTags]
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
    []
  );

  const transectOptions = useMemo<Option[]>(() => {
    const multiSurvey =
      new Set(transectOptionsRaw.map((t) => t.surveyId)).size > 1;
    return [...transectOptionsRaw]
      .sort((a, b) =>
        a.surveyId === b.surveyId
          ? a.number - b.number
          : surveyLabel(a.surveyId).localeCompare(surveyLabel(b.surveyId))
      )
      .map((t) => ({
        value: t.id,
        label: multiSurvey
          ? `${surveyLabel(t.surveyId)} · Transect ${t.number}`
          : `Transect ${t.number}`,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transectOptionsRaw, surveyOptions]);

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
      <div className='w-100 h-100 d-flex flex-column flex-sm-row gap-2'>
        <div
          className='d-flex flex-column gap-2 w-100'
          style={{
            maxWidth: '300px',
            maxHeight: 'calc(100vh - 32px)',
            overflow: 'hidden',
          }}
        >
          <Card className='d-sm-block d-none w-100'>
            <Card.Header>
              <Card.Title className='mb-0'>Information</Card.Title>
            </Card.Header>
            <Card.Body className='d-flex flex-column gap-2'>
              <p className='mb-0'>
                <strong>Survey:</strong> {project.name}
              </p>
              <p className='mb-0'>
                <strong>Annotation Set:</strong>{' '}
                {annotationSets?.find((set) => set.id === selectedAnnotationSet)
                  ?.name ?? 'Unknown'}
              </p>
            </Card.Body>
          </Card>
          <Card
            className='w-100 flex-grow-1 d-flex flex-column'
            style={{ minHeight: 0 }}
          >
            <Card.Header>
              <Card.Title className='mb-0 d-flex align-items-center'>
                <Button
                  className='p-0 mb-0'
                  variant='outline'
                  onClick={() => setShowFilters(!showFilters)}
                >
                  <PanelBottom
                    className='d-sm-none'
                    style={{
                      transform: showFilters
                        ? 'rotate(180deg)'
                        : 'rotate(0deg)',
                    }}
                  />
                </Button>
                Filters
              </Card.Title>
            </Card.Header>
            {showFilters && (
              <Card.Body
                className='d-flex flex-column gap-2'
                style={{ overflowY: 'auto', minHeight: 0 }}
              >
                <div className='w-100'>
                  <Form.Label>Labels</Form.Label>
                  <Select
                    value={selectedCategories}
                    onChange={(newValue: MultiValue<Option>) =>
                      setSelectedCategories([...(newValue as Option[])])
                    }
                    isMulti
                    name='Labels to review'
                    options={categories
                      ?.filter(
                        (c) => c.annotationSetId === selectedAnnotationSet
                      )
                      .map((q) => ({
                        label: q.name,
                        value: q.id,
                      }))}
                    className='text-black w-100'
                    closeMenuOnSelect={false}
                    menuPortalTarget={document.body}
                    styles={menuPortalStyles}
                  />
                  {tab === 'map' && (
                    <Form.Switch
                      label='Primary sightings only'
                      className='mt-3'
                      checked={primaryOnly}
                      onChange={(e) => setPrimaryOnly(e.target.checked)}
                    />
                  )}
                </div>

                {/* Only surveys that have been informationally tagged get the
                    filter - everyone else would see an empty control. */}
                {infoTagOptions.length > 0 && (
                  <div className='w-100'>
                    <Form.Label>Info Tags</Form.Label>
                    <Select
                      value={selectedInfoTags}
                      onChange={(newValue: MultiValue<Option>) =>
                        setSelectedInfoTags([...(newValue as Option[])])
                      }
                      isMulti
                      name='Info tags to review'
                      options={infoTagOptions}
                      className='text-black w-100'
                      closeMenuOnSelect={false}
                      placeholder='Any tags'
                      menuPortalTarget={document.body}
                      styles={menuPortalStyles}
                    />
                    <Form.Text muted>
                      Keeps sightings carrying any of the selected tags.
                    </Form.Text>
                  </div>
                )}

                <div className='w-100'>
                  <Form.Label>Users</Form.Label>
                  <Select
                    value={selectedUsers}
                    onChange={(newValue: MultiValue<Option>) =>
                      setSelectedUsers([...(newValue as Option[])])
                    }
                    isMulti
                    name='Users to filter'
                    options={userOptions}
                    className='text-black w-100'
                    closeMenuOnSelect={false}
                    placeholder='All users'
                    menuPortalTarget={document.body}
                    styles={menuPortalStyles}
                  />
                </div>

                {showAnnotationSetDropdown && (
                  <AnnotationSetDropdown
                    selectedSet={selectedAnnotationSet}
                    setAnnotationSet={setSelectedAnnotationSet}
                    canCreate={false}
                  />
                )}

                {/* Advanced: overlay data from other surveys on the map. */}
                <div className='w-100 border-top pt-2 mt-1'>
                  <Button
                    variant='outline'
                    className='p-0 d-flex align-items-center gap-1 w-100 text-start'
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    style={{ boxShadow: 'none' }}
                  >
                    <ChevronRight
                      size={16}
                      style={{
                        transition: 'transform 0.15s',
                        transform: showAdvanced
                          ? 'rotate(90deg)'
                          : 'rotate(0deg)',
                      }}
                    />
                    <span className='fw-semibold'>Advanced</span>
                  </Button>

                  {showAdvanced && (
                    <div className='d-flex flex-column gap-2 mt-2'>
                      <div className='w-100'>
                        <Form.Label className='mb-1'>Surveys</Form.Label>
                        <Select
                          value={selectedSurveyIds.map((id) => ({
                            label: surveyLabel(id),
                            value: id,
                          }))}
                          onChange={handleSurveysChange}
                          isMulti
                          name='Surveys to overlay'
                          options={surveyOptions}
                          isLoading={orgSurveysQuery.isLoading}
                          className='text-black w-100'
                          closeMenuOnSelect={false}
                          placeholder='Add surveys…'
                          menuPortalTarget={document.body}
                          styles={menuPortalStyles}
                        />
                        <Form.Text muted>
                          Overlay sightings from other surveys in this
                          organization.
                        </Form.Text>
                      </div>

                      {selectedSurveyIds.map((sid, i) => (
                        <div className='w-100' key={sid}>
                          <Form.Label className='mb-1'>
                            {surveyLabel(sid)}
                          </Form.Label>
                          <Select
                            value={(setsBySurvey[sid] ?? []).map((aid) => ({
                              label:
                                setOptionsBySurvey[sid]?.find(
                                  (o) => o.value === aid
                                )?.label ?? aid,
                              value: aid,
                            }))}
                            onChange={(newValue: MultiValue<Option>) =>
                              handleSetsChange(sid, newValue)
                            }
                            isMulti
                            name={`Annotation sets for ${surveyLabel(sid)}`}
                            options={setOptionsBySurvey[sid] ?? []}
                            isLoading={setQueries[i]?.isLoading}
                            className='text-black w-100'
                            closeMenuOnSelect={false}
                            placeholder='Select annotation sets…'
                            menuPortalTarget={document.body}
                            styles={menuPortalStyles}
                          />
                        </div>
                      ))}

                      <div className='w-100'>
                        <div className='d-flex align-items-center justify-content-between mb-1'>
                          <Form.Label className='mb-0'>Transects</Form.Label>
                          <Form.Switch
                            label='Enter id'
                            checked={transectInputMode === 'input'}
                            onChange={(e) =>
                              handleTransectModeToggle(e.target.checked)
                            }
                          />
                        </div>
                        {transectInputMode === 'input' ? (
                          <Form.Control
                            type='text'
                            value={transectInputText}
                            onChange={(e) =>
                              handleTransectInputChange(e.target.value)
                            }
                            placeholder='Transect id(s), comma-separated'
                          />
                        ) : (
                          <Select
                            value={selectedTransectIds.map((id) => ({
                              label:
                                transectOptions.find((o) => o.value === id)
                                  ?.label ?? id,
                              value: id,
                            }))}
                            onChange={(newValue: MultiValue<Option>) =>
                              setSelectedTransectIds(
                                newValue.map((v) => v.value)
                              )
                            }
                            isMulti
                            name='Transects to filter'
                            options={transectOptions}
                            isDisabled={transectOptions.length === 0}
                            className='text-black w-100'
                            closeMenuOnSelect={false}
                            placeholder={
                              transectOptions.length === 0
                                ? 'No transects'
                                : 'All transects'
                            }
                            menuPortalTarget={document.body}
                            styles={menuPortalStyles}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Card.Body>
            )}
          </Card>
        </div>
        <Card className='h-100 w-100'>
          <Card.Body>
            <Tabs
              onTabChange={(tab) => {
                switch (tab) {
                  case 0:
                    setTab('map');
                    break;
                  case 1:
                    setTab('carousel');
                    break;
                }
              }}
            >
              <Tab label='Map'>
                <div className='h-100 w-100 pt-3'>
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
              <Tab label='Carousel'>
                <ReviewCarousel
                  selectedAnnotationSet={selectedAnnotationSet}
                  selectedCategories={selectedCategories}
                  selectedUsers={selectedUsers}
                  infoTagNames={infoTagNames}
                  imageBased={imageBased}
                />
              </Tab>
            </Tabs>
          </Card.Body>
        </Card>
      </div>
    </div>
  );
}
