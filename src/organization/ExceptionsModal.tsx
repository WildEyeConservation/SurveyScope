import { Modal, Body, Header, Footer, Title } from '../Modal';
import MyTable from '../Table';
import { useEffect, useState } from 'react';
import { client } from '../stores/appClient';
import { fetchAllPaginatedResults } from '../utils';
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

  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [originalPermissions, setOriginalPermissions] = useState<Permission[]>(
    []
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function fetchProjects() {
      setIsLoading(true);

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

      setIsLoading(false);
    }

    if (show) {
      fetchProjects();
    } else {
      setPermissions([]);
      setOriginalPermissions([]);
    }
  }, [show]);

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

    const permissionsToUpdate = permissions.filter(
      (p) =>
        !originalPermissions.some(
          (op) =>
            op.projectId === p.projectId &&
            op.annotationAccess === p.annotationAccess &&
            op.isAdmin === p.isAdmin
        )
    );

    for (const permission of permissionsToUpdate) {
      if (permission.membershipId) {
        if (!permission.isAdmin && !permission.annotationAccess) {
          await client.models.UserProjectMembership.delete({
            id: permission.membershipId,
          });
        } else {
          await client.models.UserProjectMembership.update({
            id: permission.membershipId,
            isAdmin: permission.isAdmin,
          });
        }
      } else {
        const { data: existingRows } =
          await client.models.UserProjectMembership.userProjectMembershipsByUserId(
            { userId: user.id },
            { filter: { projectId: { eq: permission.projectId } } }
          );

        if (existingRows && existingRows.length > 0) {
          if (existingRows.length > 1) {
            console.warn(
              `Found ${existingRows.length} memberships for user ${user.id} in project ${permission.projectId}`
            );
          }
          await client.models.UserProjectMembership.update({
            id: existingRows[0].id,
            isAdmin: permission.isAdmin,
          });
        } else {
          await client.models.UserProjectMembership.create({
            userId: user.id,
            projectId: permission.projectId,
            isAdmin: permission.isAdmin,
            group: organization.id,
          });
        }
      }
    }

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
        </div>
      </Body>
      <Footer>
        <Button variant='primary' onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
        <Button variant='dark' onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
      </Footer>
    </Modal>
  );
}
