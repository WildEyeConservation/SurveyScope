import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormText, Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useRef, useState } from 'react';
import { Modal, Body, Header, Footer, Title } from '../Modal';
import { GlobalContext, UserContext } from '../Context';
import { useContext, useEffect } from 'react';
import { Combobox } from '@/components/ui/combobox';
import { useUsers } from '../apiInterface';
import { fetchAllPaginatedResults } from '../utils';
import { FilesUploadForm, UploadWizardStep } from '../FilesUploadComponent';
import { logAdminAction } from '../utils/adminActionLogger';
import StepIndicator from './new-survey/StepIndicator';

const WIZARD_STEPS = [
  'Survey Details',
  'Images',
  'Location Data',
  'Survey Area',
  'Filter Images',
  'Cameras',
  'Model',
  'Checklist',
];
const ALL_MEMBERS_ANNOTATE = { value: 'Yes', label: 'Yes' };

const LOCATION_STEP = WIZARD_STEPS.indexOf('Location Data');

// Which upload-form section each wizard step shows ('none' while the modal's
// own details step is visible).
const CORE_STEPS: UploadWizardStep[] = [
  'none',
  'images',
  'georeference',
  'surveyArea',
  'filter',
  'cameras',
  'model',
  'review',
];

export default function NewSurveyModal({
  show,
  projects,
}: {
  show: boolean;
  projects: string[];
}) {
  const { myOrganizationHook, user } = useContext(UserContext)!;
  const { client, showModal } = useContext(GlobalContext)!;
  const { users: allUsers } = useUsers();

  const [filesReady, setFilesReady] = useState(false);
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState<{
    label: string;
    value: string;
  } | null>(null);
  const [organizations, setOrganizations] = useState<
    { label: string; value: string }[]
  >([]);
  const [globalAnnotationAccess, setGlobalAnnotationAccess] = useState<{
    label: string;
    value: string;
  } | null>(ALL_MEMBERS_ANNOTATE);
  const [permissionExceptions, setPermissionExceptions] = useState<
    {
      user: {
        id: string;
        name: string;
      };
      annotationAccess: boolean;
      temp: boolean;
    }[]
  >([]);
  const [users, setUsers] = useState<
    Record<
      string,
      {
        id: string;
        name: string;
      }[]
    >
  >({});
  const [loading, setLoading] = useState(false);
  const [uploadSubmitFn, setUploadSubmitFn] = useState<
    ((projectId: string) => Promise<unknown>) | null
  >(null);
  // Set once the survey exists, so a retried upload does not create another.
  const createdProjectIdRef = useRef<string | null>(null);
  const [gpsReady, setGpsReady] = useState(false);
  const [imagesReady, setImagesReady] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const [confirmLocation, setConfirmLocation] = useState<(() => void) | null>(
    null
  );
  const [stepIndex, setStepIndex] = useState(0);
  const membersCanAnnotate = globalAnnotationAccess?.value === 'Yes';
  const savedExceptions = permissionExceptions.filter((pe) => !pe.temp);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [furthestIndex, setFurthestIndex] = useState(0);
  const [checklistComplete, setChecklistComplete] = useState(false);

  const canSubmit =
    !loading && filesReady && name && organization && gpsReady && checklistComplete;

  const stepReady = (index: number): boolean => {
    switch (index) {
      case 0:
        return Boolean(name.trim() && organization);
      case 1:
        return imagesReady;
      case 2:
        return locationReady;
      case 4:
        return gpsReady;
      default:
        return true;
    }
  };

  const goNext = () => {
    if (stepIndex === 0 && projects.includes(name.toLowerCase())) {
      alert('A project with this name already exists');
      return;
    }
    const next = Math.min(stepIndex + 1, WIZARD_STEPS.length - 1);
    setStepIndex(next);
    setFurthestIndex((prev) => Math.max(prev, next));
  };

  async function startUpload(projectId: string) {
    if (!organization) return;
    setLoading(true);
    createdProjectIdRef.current = projectId;

    if (uploadSubmitFn && (await uploadSubmitFn(projectId)) === false) {
      setLoading(false);
      return;
    }

    // Create an empty tiled location set for global tiles
    const { data: tiledLocationSet } = await client.models.LocationSet.create({
      name: `${name} - Tiles`,
      projectId,
      description: JSON.stringify({ mode: 'tiled', global: true }),
      locationCount: 0,
      group: organization.value,
    });

    if (tiledLocationSet?.id) {
      // Update project with the tiled location set ID
      await client.models.Project.update({
        id: projectId,
        tiledLocationSetId: tiledLocationSet.id,
      });
    }

    setLoading(false);
    showModal(null);
  }

  async function handleSave() {
    if (!organization) return;
    if (createdProjectIdRef.current) {
      await startUpload(createdProjectIdRef.current);
      return;
    }
    if (projects.includes(name.toLowerCase())) {
      alert('A project with this name already exists');
      return;
    }

    setLoading(true);

    const { data: project } = await client.models.Project.create({
      name,
      organizationId: organization.value,
      createdBy: user.userId,
      status: 'uploading',
      group: organization.value,
    });

    if (!project) {
      alert('Failed to create survey');
      setLoading(false);
      return;
    }

    // Log project creation
    await logAdminAction(
      client,
      user.userId,
      `Created project "${name}" in organization "${organization.label}"`,
      project.id,
      organization.value
    ).catch(console.error);

    const admins = await fetchAllPaginatedResults(
      client.models.OrganizationMembership.membershipsByOrganizationId,
      {
        organizationId: organization.value,
        filter: { isAdmin: { eq: true } },
        selectionSet: ['userId'],
      }
    );

    await Promise.all(
      admins.map(async (a) => {
        await client.models.UserProjectMembership.create({
          userId: a.userId,
          projectId: project.id,
          isAdmin: true,
          group: organization.value,
        });
      })
    );

    const exceptions = permissionExceptions.filter((pe) => !pe.temp);

    await Promise.all(
      exceptions.map(async (e) => {
        if (e.annotationAccess) {
          await client.models.UserProjectMembership.create({
            userId: e.user.id,
            projectId: project.id,
            isAdmin: false,
            group: organization.value,
          });
        }
      })
    );

    // users already exclude current user and admins
    const other = (users[organization.value] ?? []).filter(
      (u) => !exceptions.some((e) => e.user.id === u.id)
    );

    if (globalAnnotationAccess?.value === 'Yes') {
      await Promise.all(
        other.map(async (u) => {
          await client.models.UserProjectMembership.create({
            userId: u.id,
            projectId: project.id,
            isAdmin: false,
            group: organization.value,
          });
        })
      );
    }

    await client.models.ProjectTestConfig.create({
      projectId: project.id,
      testType: 'interval',
      interval: 50,
      accuracy: 50,
      postTestConfirmation: false,
      group: organization.value,
    });

    const { data: testPreset } = await client.models.TestPreset.create({
      name: name,
      ownerProjectId: project.id,
      organizationId: organization.value,
      group: organization.value,
    });

    if (!testPreset) {
      alert('Failed to create test preset');
      setLoading(false);
      return;
    }

    await client.models.TestPresetProject.create({
      testPresetId: testPreset.id,
      projectId: project.id,
      group: organization.value,
    });

    client.mutations.updateProjectMemberships({
      projectId: project.id,
    });

    await startUpload(project.id);
  }

  useEffect(() => {
    if (allUsers && myOrganizationHook.data) {
      const adminOrganizations = myOrganizationHook.data.filter(
        (o) => o.isAdmin
      );

      Promise.all(
        adminOrganizations.map(
          async (o) =>
            (
              await client.models.Organization.get(
                {
                  id: o.organizationId,
                },
                {
                  selectionSet: ['name', 'id', 'memberships.*'],
                }
              )
            ).data
        )
      ).then((organizations) => {
        setOrganizations(
          organizations
            .filter((o): o is NonNullable<typeof o> => o !== null)
            .map((o) => ({
              label: o.name,
              value: o.id,
            }))
        );

        if (organizations.length === 1 && organizations[0]) {
          setOrganization({
            label: organizations[0].name,
            value: organizations[0].id,
          });
        }

        setUsers(
          organizations
            .filter((o): o is NonNullable<typeof o> => o !== null)
            .reduce(
              (acc, o) => ({
                ...acc,
                [o.id]: o.memberships
                  .filter((m: { isAdmin: boolean | null; userId: string }) => !m.isAdmin)
                  .map((m: { userId: string }) => ({
                    id: m.userId,
                    name: allUsers.find((u) => u.id === m.userId)?.name || '',
                  })),
              }),
              {}
            )
        );
      });
    }
  }, [myOrganizationHook.data, allUsers]);

  useEffect(() => {
    if (organization) {
      setPermissionExceptions([]);
    }
  }, [organization]);

  useEffect(() => {
    if (!show) {
      setName('');
      setGlobalAnnotationAccess(ALL_MEMBERS_ANNOTATE);
      setPermissionExceptions([]);
      setUploadSubmitFn(null);
      createdProjectIdRef.current = null;
      setStepIndex(0);
      setFurthestIndex(0);
      setImagesReady(false);
    }
  }, [show]);

  return (
    <Modal show={show} strict={true}>
      <Header>
        <Title>New Survey</Title>
      </Header>
      <Body>
        <form className='flex flex-col gap-2 p-4'>
          <StepIndicator
            steps={WIZARD_STEPS}
            currentIndex={stepIndex}
            furthestIndex={furthestIndex}
            onSelect={setStepIndex}
          />
          <div
            className={
              stepIndex === 0 ? 'flex flex-col gap-2' : 'hidden'
            }
          >
          <div className='grid grid-cols-[1.4fr_1fr] gap-3'>
            <div>
              <Label htmlFor='survey-name'>Survey name</Label>
              <Input
                id='survey-name'
                type='text'
                placeholder='A unique name for the survey'
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label>Organisation</Label>
              <Combobox
                value={organization}
                options={organizations}
                onChange={(option) => setOrganization(option)}
                placeholder='Select organisation'
                name='Organisation'
              />
            </div>
          </div>
          <div>
            <div className='mt-3 mb-3 border-b border-white/10 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
              Who can annotate
            </div>
            <div
              role='radiogroup'
              aria-label='Who can annotate'
              className='grid grid-cols-2 gap-2.5'
            >
              {[
                {
                  value: 'Yes',
                  title: 'All members',
                  detail: 'Everyone in the organisation can annotate this survey.',
                },
                {
                  value: 'No',
                  title: 'Only admins',
                  detail: "Members can't annotate unless added below.",
                },
              ].map((choice) => {
                const selected = membersCanAnnotate === (choice.value === 'Yes');
                return (
                  <button
                    key={choice.value}
                    type='button'
                    role='radio'
                    aria-checked={selected}
                    onClick={() => {
                      if (selected) return;
                      setGlobalAnnotationAccess({
                        value: choice.value,
                        label: choice.value,
                      });
                      setPermissionExceptions([]);
                    }}
                    className={cn(
                      'flex items-center gap-3 border px-4 py-3 text-left transition-colors',
                      selected
                        ? 'border-primary bg-primary/15'
                        : 'border-white/15 bg-white/[0.07] hover:border-white/40'
                    )}
                  >
                    <span className='flex min-w-0 flex-1 flex-col'>
                      <span className='font-semibold'>{choice.title}</span>
                      <span className='text-sm text-muted-foreground'>
                        {choice.detail}
                      </span>
                    </span>
                    {selected && (
                      <CheckIcon className='size-5 shrink-0 text-primary' />
                    )}
                  </button>
                );
              })}
            </div>
            <div className='mt-3'>
              <Label>
                {membersCanAnnotate
                  ? "Members who can't annotate"
                  : 'Members who can annotate anyway'}
              </Label>
              <Combobox
                multiple
                value={permissionExceptions.map((pe) => ({
                  label: pe.user.name,
                  value: pe.user.id,
                }))}
                options={(users[organization?.value || ''] ?? []).map((u) => ({
                  label: u.name,
                  value: u.id,
                }))}
                onChange={(selected) =>
                  setPermissionExceptions(
                    selected.map((option) => ({
                      user: { id: option.value, name: option.label },
                      annotationAccess: !membersCanAnnotate,
                      temp: false,
                    }))
                  )
                }
                disabled={!organization}
                placeholder={
                  organization ? 'Add a member…' : 'Select an organisation first'
                }
                name='Permission exceptions'
              />
              <FormText>You and organisation admins can always annotate.</FormText>
            </div>
          </div>
          </div>
          <FilesUploadForm
            setOnSubmit={setUploadSubmitFn}
            setReadyToSubmit={setFilesReady}
            setGpsDataReady={setGpsReady}
            setImagesReady={setImagesReady}
            setChecklistComplete={setChecklistComplete}
            onEditStep={(step) => {
              const index = CORE_STEPS.indexOf(step);
              if (index >= 0) setStepIndex(index);
            }}
            currentStep={CORE_STEPS[stepIndex]}
            setLocationReady={setLocationReady}
            setConfirmLocation={setConfirmLocation}
            onLocationConfirmed={() => {
              if (stepIndex === LOCATION_STEP) goNext();
            }}
            summaryDetails={[
              { text: `Named the survey ${name.trim()}`, done: !!name.trim() },
              {
                text: `Organisation: ${organization?.label ?? 'not selected'}`,
                done: !!organization,
              },
              {
                text: membersCanAnnotate
                  ? 'All members can annotate'
                  : 'Only admins can annotate',
              },
              savedExceptions.length > 0
                ? {
                    text: `${
                      membersCanAnnotate ? "Can't annotate" : 'Can annotate anyway'
                    }: ${savedExceptions.map((pe) => pe.user.name).join(', ')}`,
                    done: true,
                  }
                : { text: 'No member exceptions', done: false },
            ]}
          />
        </form>
      </Body>

      <Footer>
        {confirmingCancel ? (
          <>
            <div className='mr-auto'>
              <div>Discard this new survey?</div>
              <div className='text-xs text-muted-foreground'>
                Everything entered so far will be lost.
              </div>
            </div>
            <Button
              variant='outline-light'
              onClick={() => setConfirmingCancel(false)}
            >
              Keep editing
            </Button>
            <Button variant='danger' onClick={() => showModal(null)}>
              Discard
            </Button>
          </>
        ) : (
          <>
            <Button
              variant='ghost'
              className='mr-auto'
              onClick={() =>
                stepIndex > 0 || name.trim()
                  ? setConfirmingCancel(true)
                  : showModal(null)
              }
            >
              Cancel
            </Button>
            {stepIndex > 0 && (
              <Button
                variant='outline-light'
                disabled={loading}
                onClick={() => setStepIndex(stepIndex - 1)}
              >
                <ChevronLeftIcon className='size-4' />
                Back
              </Button>
            )}
            {stepIndex < WIZARD_STEPS.length - 1 ? (
              <Button
                variant='primary'
                disabled={!stepReady(stepIndex)}
                onClick={
                  stepIndex === LOCATION_STEP && confirmLocation
                    ? confirmLocation
                    : goNext
                }
              >
                Next
                <ChevronRightIcon className='size-4' />
              </Button>
            ) : (
              <Button variant='primary' onClick={handleSave} disabled={!canSubmit}>
                {loading ? 'Creating...' : 'Create survey'}
              </Button>
            )}
          </>
        )}
      </Footer>
    </Modal>
  );
}
