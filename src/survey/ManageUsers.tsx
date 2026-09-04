import { useCallback, useEffect, useState } from 'react';
import { Button, Modal } from 'react-bootstrap';
import { client } from '../stores/appClient';
import { showModalAction as showModal } from '../stores/modalStore';
import { useUsers } from '../apiInterface';
import { fetchAllPaginatedResults } from '../utils';
import MyTable from '../Table';
import LabeledToggleSwitch from '../LabeledToggleSwitch';
import { Footer } from '../Modal';

type UserPermission = {
  userId: string;
  userName: string;
  userEmail: string;
  membershipId: string | null;
  annotationAccess: boolean;
  isAdmin: boolean;
  isOrgAdmin: boolean;
};

export default function ManageUsers({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  const { users } = useUsers();

  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  const [originalPermissions, setOriginalPermissions] = useState<
    UserPermission[]
  >([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);

  const fetchData = useCallback(async function fetchData() {
    if (!users) return;
    setIsLoading(true);

    try {
      const [orgMemberships, projectMemberships] = await Promise.all([
        fetchAllPaginatedResults(
          client.models.OrganizationMembership
            .membershipsByOrganizationId,
          {
            organizationId,
            selectionSet: ['userId', 'isAdmin'] as const,
          }
        ),
        fetchAllPaginatedResults(
          client.models.UserProjectMembership
            .userProjectMembershipsByProjectId,
          {
            projectId,
            selectionSet: ['id', 'userId', 'isAdmin'] as const,
          }
        ),
      ]);

      const userPermissions: UserPermission[] = orgMemberships.map(
        (orgMembership) => {
          const user = users.find((u) => u.id === orgMembership.userId);
          const projectMembership = projectMemberships.find(
            (pm) => pm.userId === orgMembership.userId
          );

          return {
            userId: orgMembership.userId,
            userName: user?.name ?? 'Unknown',
            userEmail: user?.email ?? '',
            membershipId: projectMembership?.id ?? null,
            annotationAccess: !!projectMembership,
            isAdmin: !!projectMembership?.isAdmin,
            isOrgAdmin: !!orgMembership.isAdmin,
          };
        }
      );

      // Sort: org admins first, then alphabetically by name
      userPermissions.sort((a, b) => {
        if (a.isOrgAdmin !== b.isOrgAdmin)
          return a.isOrgAdmin ? -1 : 1;
        return a.userName.localeCompare(b.userName);
      });

      setPermissions(userPermissions);
      setOriginalPermissions(userPermissions);
    } finally {
      setIsLoading(false);
    }
  }, [users, projectId, organizationId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hasChanges = permissions.some(
    (p) =>
      !originalPermissions.some(
        (op) =>
          op.userId === p.userId &&
          op.annotationAccess === p.annotationAccess &&
          op.isAdmin === p.isAdmin
      )
  );

  const handleSave = async () => {
    setIsSaving(true);

    try {
      const permissionsToUpdate = permissions.filter(
        (p) =>
          !originalPermissions.some(
            (op) =>
              op.userId === p.userId &&
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
        } else if (permission.annotationAccess || permission.isAdmin) {
          const { data: existingRows } =
            await client.models.UserProjectMembership.userProjectMembershipsByUserId(
              { userId: permission.userId },
              { filter: { projectId: { eq: projectId } } }
            );

          if (existingRows && existingRows.length > 0) {
            if (existingRows.length > 1) {
              console.warn(
                `Found ${existingRows.length} memberships for user ${permission.userId} in project ${projectId}`
              );
            }
            await client.models.UserProjectMembership.update({
              id: existingRows[0].id,
              isAdmin: permission.isAdmin,
            });
          } else {
            await client.models.UserProjectMembership.create({
              userId: permission.userId,
              projectId,
              isAdmin: permission.isAdmin,
              group: organizationId,
            });
          }
        }
      }

      // Refetch to get correct membershipIds for created/deleted records
      await fetchData();
    } catch (err: any) {
      alert(err.message ?? 'Failed to save permissions');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (hasChanges) {
      setShowUnsavedPrompt(true);
    } else {
      showModal(null);
    }
  };

  const handleSaveAndClose = async () => {
    setShowUnsavedPrompt(false);
    await handleSave();
    showModal(null);
  };

  const handleDiscardAndClose = () => {
    setShowUnsavedPrompt(false);
    showModal(null);
  };

  const tableData = permissions.map((permission) => ({
    id: permission.userId,
    rowData: [
      permission.userName,
      permission.userEmail,
      <LabeledToggleSwitch
        className='mb-0'
        leftLabel='No'
        rightLabel='Yes'
        checked={permission.annotationAccess}
        disabled={permission.isOrgAdmin || isSaving}
        onChange={(checked) => {
          if (permission.isAdmin && !checked) {
            // Can't remove annotation access while admin
            return;
          }
          setPermissions(
            permissions.map((p) =>
              p.userId === permission.userId
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
        disabled={permission.isOrgAdmin || isSaving}
        onChange={(checked) => {
          setPermissions(
            permissions.map((p) =>
              p.userId === permission.userId
                ? {
                    ...p,
                    isAdmin: checked,
                    annotationAccess: checked ? true : p.annotationAccess,
                  }
                : p
            )
          );
        }}
      />,
    ],
  }));

  return (
    <>
      <div className='p-3'>
        <div className='text-muted mb-3' style={{ lineHeight: 1.2 }}>
          <span style={{ fontSize: 16 }}>Manage User Access</span>
          <br />
          <span style={{ fontSize: 12 }}>
            Grant or revoke annotation and admin access for each organisation
            member on this survey.
            <br />
            Organisation admins automatically have full access and cannot be
            modified here.
            <br />
            Enabling admin access automatically grants annotation access.
          </span>
        </div>
        <MyTable
          tableHeadings={[
            { content: 'Username', sort: true },
            { content: 'Email', sort: true },
            { content: 'Annotation Access' },
            { content: 'Admin' },
          ]}
          tableData={tableData}
          pagination={true}
          emptyMessage={isLoading ? 'Loading...' : 'No users found'}
        />
      </div>
      <Footer>
        <Button
          variant='primary'
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
        <Button
          variant='dark'
          onClick={handleClose}
          disabled={isSaving}
        >
          Close
        </Button>
      </Footer>
      {showUnsavedPrompt && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            zIndex: 1055,
          }}
        />
      )}
      <Modal show={showUnsavedPrompt} onHide={() => setShowUnsavedPrompt(false)} style={{ zIndex: 1056 }}>
        <Modal.Header>
          <Modal.Title>Unsaved Changes</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          You have unsaved changes. Would you like to save before closing?
        </Modal.Body>
        <Modal.Footer>
          <Button variant='primary' onClick={handleSaveAndClose}>
            Save & Close
          </Button>
          <Button variant='danger' onClick={handleDiscardAndClose}>
            Discard
          </Button>
          <Button variant='dark' onClick={() => setShowUnsavedPrompt(false)}>
            Cancel
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
