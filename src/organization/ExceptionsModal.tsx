import { Modal, Body, Header, Footer, Title } from '../Modal';
import MyTable from '../Table';
import { useCallback, useContext, useEffect, useState } from 'react';
import { GlobalContext } from '../Context';
import { fetchAllPaginatedResults } from '../utils';
import { applyProjectMembershipChange } from '../utils/projectMembershipWrites';
import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import LabeledToggleSwitch from '../LabeledToggleSwitch';

type Permission = {
  membershipId: string | null;
  projectName: string;
  projectId: string;
  annotationAccess: boolean;
  isAdmin: boolean;
};

export default function ExceptionsModal({
  show,
  onClose,
  user,
  organization,
}: {
  show: boolean;
  onClose: () => void;
  user: { id: string; name: string };
  organization: { id: string; name: string };
}) {
  const { client } = useContext(GlobalContext)!;

  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [originalPermissions, setOriginalPermissions] = useState<Permission[]>(
    []
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [saveResult, setSaveResult] = useState<{
    variant: 'success' | 'danger';
    message: string;
  } | null>(null);

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      const projects = await fetchAllPaginatedResults(
        client.models.Project.list,
        {
          selectionSet: ['id', 'name', 'status'],
          filter: {
            organizationId: {
              eq: organization.id,
            },
          },
        }
      );

      const validProjects = projects.filter(
        (project) => project.status !== 'deleted'
      );

      if (validProjects.length > 0) {
        const userProjectMemberships = await fetchAllPaginatedResults(
          client.models.UserProjectMembership.userProjectMembershipsByUserId,
          {
            userId: user.id,
            selectionSet: ['id', 'projectId', 'isAdmin'],
          }
        );

        const projectPermissions = validProjects.map((project) => {
          const membership = userProjectMemberships.find(
            (m) => m.projectId === project.id
          );
          return {
            projectName: project.name,
            projectId: project.id,
            membershipId: membership?.id ?? null,
            annotationAccess: !!membership,
            isAdmin: !!membership?.isAdmin,
          };
        });

        setOriginalPermissions(projectPermissions);
        setPermissions(projectPermissions);
      }
    } finally {
      setIsLoading(false);
    }
  }, [client, organization.id, user.id]);

  useEffect(() => {
    if (show) {
      fetchProjects();
    } else {
      setPermissions([]);
      setOriginalPermissions([]);
      setSaveResult(null);
    }
  }, [show, fetchProjects]);

  const hasChanges = permissions.some(
    (p) =>
      !originalPermissions.some(
        (op) =>
          op.projectId === p.projectId &&
          op.annotationAccess === p.annotationAccess &&
          op.isAdmin === p.isAdmin
      )
  );

  const handleClose = () => {
    if (
      hasChanges &&
      !window.confirm(
        'You have unsaved changes. Close without saving? Click Save first to apply them.'
      )
    ) {
      return;
    }
    onClose();
  };

  const tableData = permissions.map((permission) => ({
    id: permission.projectId,
    rowData: [
      permission.projectName,
      <LabeledToggleSwitch
        className='mb-0'
        leftLabel='No'
        rightLabel='Yes'
        checked={permission.annotationAccess}
        disabled={isSaving}
        onChange={(checked) => {
          if (permission.isAdmin) {
            alert('Admins have unrestricted access');
            return;
          }
          setSaveResult(null);
          setPermissions(
            permissions.map((p) =>
              p.projectId === permission.projectId
                ? { ...p, annotationAccess: checked }
                : p
            )
          );
        }}
      />,
      <LabeledToggleSwitch
        className='mb-0'
        leftLabel='No'
        rightLabel='Yes'
        checked={permission.isAdmin}
        disabled={isSaving}
        onChange={(checked) => {
          setSaveResult(null);
          setPermissions(
            permissions.map((p) =>
              p.projectId === permission.projectId
                ? { ...p, isAdmin: checked, annotationAccess: true }
                : p
            )
          );
        }}
      />,
    ],
  }));

  const handleSave = async () => {
    setIsSaving(true);
    setSaveResult(null);

    const permissionsToUpdate = permissions.filter(
      (p) =>
        !originalPermissions.some(
          (op) =>
            op.projectId === p.projectId &&
            op.annotationAccess === p.annotationAccess &&
            op.isAdmin === p.isAdmin
        )
    );

    // Keep going past a failed survey so one rejection doesn't silently skip
    // the rest; report exactly which surveys didn't save.
    const failed: string[] = [];
    for (const permission of permissionsToUpdate) {
      try {
        await applyProjectMembershipChange(client, {
          userId: user.id,
          projectId: permission.projectId,
          membershipId: permission.membershipId,
          annotationAccess: permission.annotationAccess,
          isAdmin: permission.isAdmin,
          group: organization.id,
        });
      } catch (err) {
        console.error(
          `Failed to save access to survey ${permission.projectId} for user ${user.id}`,
          err
        );
        failed.push(permission.projectName);
      }
    }

    try {
      // Reload so the toggles show what was actually saved.
      await fetchProjects();
    } catch (err) {
      console.error('Failed to reload survey access', err);
    }

    setSaveResult(
      failed.length > 0
        ? {
            variant: 'danger',
            message: `Could not save access for: ${failed.join(', ')}. Please try again.`,
          }
        : { variant: 'success', message: 'Access saved.' }
    );
    setIsSaving(false);
  };

  return (
    <Modal show={show} strict={true} size='lg'>
      <Header>
        <Title>
          Permission Exceptions for {user.name} ({organization.name})
        </Title>
      </Header>
      <Body>
        <div className='p-3'>
          <div className='text-muted mb-3' style={{ lineHeight: 1.2 }}>
            <span style={{ fontSize: 16 }}>Instructions</span>
            <br />
            <span style={{ fontSize: 12 }}>
              Select the surveys and the level of access you would like to give
              the user for each survey.
              <br />
              This will override the default access level for the user for the
              selected surveys.
            </span>
          </div>
          <MyTable
            tableHeadings={[
              { content: 'Survey', sort: true },
              { content: 'Annotation Access' },
              { content: 'Admin' },
            ]}
            tableData={tableData}
            pagination={true}
            emptyMessage={isLoading ? 'Loading...' : 'No surveys found'}
          />
          {saveResult && (
            <Alert variant={saveResult.variant} className='mt-3 mb-0'>
              {saveResult.message}
            </Alert>
          )}
        </div>
      </Body>
      <Footer>
        <Button
          variant='primary'
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
        <Button variant='dark' onClick={handleClose} disabled={isSaving}>
          Close
        </Button>
      </Footer>
    </Modal>
  );
}
