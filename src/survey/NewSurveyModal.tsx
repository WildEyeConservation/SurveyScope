import { Button, Form } from 'react-bootstrap';
import { useState } from 'react';
import { Modal, Body, Header, Footer, Title } from '../Modal';
import { useSession } from '../session';
import { useMyOrganizations } from '../data/memberships';
import { client } from '../stores/appClient';
import { showModalAction as showModal } from '../stores/modalStore';
import { useEffect } from 'react';
import Select from 'react-select';
import LabeledToggleSwitch from '../LabeledToggleSwitch';
import MyTable from '../Table';
import { useUsers } from '../apiInterface';
import { fetchAllPaginatedResults } from '../utils';
import { FilesUploadForm, UploadWizardStep } from '../FilesUploadComponent';
import { saveShapefileForProject } from '../utils/shapefileUtils';
import { logAdminAction } from '../utils/adminActionLogger';
import StepIndicator from './new-survey/StepIndicator';

const WIZARD_STEPS = [
  'Survey Details',
  'Images',
  'Location Data',
  'Cameras',
  'Review & Create',
];

// Which upload-form section each wizard step shows ('none' while the modal's
// own details step is visible).
const CORE_STEPS: UploadWizardStep[] = [
  'none',
  'images',
  'georeference',
  'cameras',
  'review',
];

export default function NewSurveyModal({
  show,
  projects,
}: {
  show: boolean;
  projects: string[];
}) {
  const myOrganizationHook = useMyOrganizations();
  const { user } = useSession();
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
  } | null>(null);
  const [addPermissionExceptions, setAddPermissionExceptions] = useState(false);
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
    ((projectId: string) => Promise<void>) | null
  >(null);
  const [gpsReady, setGpsReady] = useState(false);
  const [imagesReady, setImagesReady] = useState(false);
  const [shapefileLatLngs, setShapefileLatLngs] =
    useState<[number, number][]>();
  const [stepIndex, setStepIndex] = useState(0);
  const [furthestIndex, setFurthestIndex] = useState(0);

  const canSubmit = !loading && filesReady && name && organization && gpsReady;

  const stepReady = (index: number): boolean => {
    switch (index) {
      case 0:
        return Boolean(name.trim() && organization);
      case 1:
        return imagesReady;
      case 2:
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

  async function handleSave() {
    if (!organization) return;
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

    if (uploadSubmitFn) {
      await uploadSubmitFn(project.id);
    }

    // If a shapefile was provided during upload, save it to the project now
    if (shapefileLatLngs && shapefileLatLngs.length > 0) {
      await saveShapefileForProject(client, project.id, shapefileLatLngs, organization.value);
    }

    // Create an empty tiled location set for global tiles
    const { data: tiledLocationSet } = await client.models.LocationSet.create({
      name: `${name} - Tiles`,
      projectId: project.id,
      description: JSON.stringify({ mode: 'tiled', global: true }),
      locationCount: 0,
      group: organization.value,
    });

    if (tiledLocationSet?.id) {
      // Update project with the tiled location set ID
      await client.models.Project.update({
        id: project.id,
        tiledLocationSetId: tiledLocationSet.id,
      });
    }

    setLoading(false);
    showModal(null);
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
      setAddPermissionExceptions(false);
    }
  }, [organization]);

  useEffect(() => {
    if (!show) {
      setName('');
      setGlobalAnnotationAccess(null);
      setAddPermissionExceptions(false);
      setPermissionExceptions([]);
      setUploadSubmitFn(null);
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
        <Form className='d-flex flex-column gap-2 p-3'>
          <StepIndicator
            steps={WIZARD_STEPS}
            currentIndex={stepIndex}
            furthestIndex={furthestIndex}
            onSelect={setStepIndex}
          />
          {/* d-none (not inline display) because d-flex is !important */}
          <div
            className={
              stepIndex === 0 ? 'd-flex flex-column gap-2' : 'd-none'
            }
          >
          <Form.Group>
            <Form.Label>Name</Form.Label>
            <Form.Control
              type='text'
              placeholder='Enter a unique identifying name for the survey.'
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label>Organisation</Form.Label>
            <Select
              className='text-black'
              value={organization}
              options={organizations}
              onChange={(e) => setOrganization(e)}
              styles={{
                valueContainer: (base) => ({
                  ...base,
                  overflowY: 'auto',
                }),
              }}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label className='mb-0'>Permissions</Form.Label>
            <span
              className='text-muted d-block mb-1'
              style={{ fontSize: 12, lineHeight: 1.2 }}
            >
              Select the user permissions for all organisation members excluding
              yourself and admins.
            </span>
            <div className='mb-2'>
              <Form.Label style={{ fontSize: 14 }}>
                Annotation Access:
              </Form.Label>
              <Select
                className='text-black'
                value={globalAnnotationAccess}
                placeholder='Default (No)'
                options={[
                  { value: 'Yes', label: 'Yes' },
                  { value: 'No', label: 'No' },
                ]}
                onChange={(e) => setGlobalAnnotationAccess(e)}
                styles={{
                  valueContainer: (base) => ({
                    ...base,
                    overflowY: 'auto',
                  }),
                }}
              />
            </div>
            <Form.Switch
              style={{ fontSize: 14 }}
              id='addPermissionExceptions'
              label='Add Permission Exceptions'
              checked={addPermissionExceptions}
              onChange={(e) => {
                if (!organization) {
                  alert('Please select an organisation first');
                  return;
                }
                setAddPermissionExceptions(e.target.checked);
                if (!e.target.checked) {
                  setPermissionExceptions([]);
                }
              }}
            />
            {addPermissionExceptions && (
              <>
                <MyTable
                  tableHeadings={[
                    { content: 'Username', style: { width: '33%' } },
                    { content: 'Annotation Access', style: { width: '33%' } },
                    { content: 'Remove Exception', style: { width: '33%' } },
                  ]}
                  tableData={permissionExceptions.map((exception) => ({
                    id: exception.user.id,
                    rowData: [
                      <Select
                        className='text-black'
                        value={{
                          label: exception.user.name,
                          value: exception.user.id,
                        }}
                        options={users[organization?.value || '']
                          ?.filter(
                            (u) =>
                              !permissionExceptions.some(
                                (pe) => pe.user.id === u.id
                              )
                          )
                          .map((u) => ({
                            label: u.name,
                            value: u.id,
                          }))}
                        onChange={(selected) => {
                          setPermissionExceptions(
                            permissionExceptions.map((pe) =>
                              pe.user.id === exception.user.id
                                ? {
                                    ...pe,
                                    user: {
                                      ...pe.user,
                                      id: selected?.value || pe.user.id,
                                      name: selected?.label || pe.user.name,
                                    },
                                    temp: false,
                                  }
                                : pe
                            )
                          );
                        }}
                      />,
                      <LabeledToggleSwitch
                        className='mb-0'
                        leftLabel='No'
                        rightLabel='Yes'
                        checked={exception.annotationAccess}
                        onChange={(checked) => {
                          setPermissionExceptions(
                            permissionExceptions.map((pe) =>
                              pe.user.id === exception.user.id
                                ? { ...pe, annotationAccess: checked }
                                : pe
                            )
                          );
                        }}
                      />,
                      <Button
                        variant='danger'
                        size='sm'
                        onClick={() => {
                          setPermissionExceptions(
                            permissionExceptions.filter(
                              (e) => e.user.id !== exception.user.id
                            )
                          );
                        }}
                      >
                        Remove
                      </Button>,
                    ],
                  }))}
                />
                <Button
                  variant='info'
                  size='sm'
                  onClick={() => {
                    if (permissionExceptions.some((e) => e.temp)) {
                      alert(
                        'Please complete the current permission exception before adding another'
                      );
                      return;
                    }
                    setPermissionExceptions([
                      ...permissionExceptions,
                      {
                        user: {
                          id: crypto.randomUUID(),
                          name: 'Select a user',
                        },
                        annotationAccess: false,
                        temp: true,
                      },
                    ]);
                  }}
                >
                  +
                </Button>
              </>
            )}
          </Form.Group>
          </div>
          <FilesUploadForm
            setOnSubmit={setUploadSubmitFn}
            setReadyToSubmit={setFilesReady}
            setGpsDataReady={setGpsReady}
            setImagesReady={setImagesReady}
            currentStep={CORE_STEPS[stepIndex]}
            onShapefileParsed={(latLngs) => setShapefileLatLngs(latLngs)}
            summaryDetails={[
              { label: 'Survey name', value: name.trim() || 'Not entered' },
              {
                label: 'Organisation',
                value: organization?.label || 'Not selected',
              },
              { label: 'GPS', value: gpsReady ? 'Exists' : 'Missing' },
              {
                label: 'Default annotation access',
                value: globalAnnotationAccess?.label || 'No',
              },
              {
                label: 'Permission exceptions',
                value: String(
                  permissionExceptions.filter((exception) => !exception.temp)
                    .length
                ),
              },
            ]}
          />
        </Form>
      </Body>

      <Footer>
        {stepIndex > 0 && (
          <Button
            variant='secondary'
            disabled={loading}
            onClick={() => setStepIndex(stepIndex - 1)}
          >
            Back
          </Button>
        )}
        {stepIndex < WIZARD_STEPS.length - 1 ? (
          <Button
            variant='primary'
            disabled={!stepReady(stepIndex)}
            onClick={goNext}
          >
            Next
          </Button>
        ) : (
          <Button variant='primary' onClick={handleSave} disabled={!canSubmit}>
            {loading ? 'Creating...' : 'Create'}
          </Button>
        )}
        <Button variant='dark' onClick={() => showModal(null)}>
          Cancel
        </Button>
      </Footer>
    </Modal>
  );
}
