import { useCallback, useContext, useEffect, useState } from 'react';
import { Alert, Button, Modal } from 'react-bootstrap';
import { GlobalContext } from '../Context';
import { useUsers } from '../apiInterface';
import { fetchAllPaginatedResults } from '../utils';
import { applyProjectMembershipChange } from '../utils/projectMembershipWrites';
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
  const { client, showModal } = useContext(GlobalContext)!;
  const { users } = useUsers();

  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  const [originalPermissions, setOriginalPermissions] = useState<
    UserPermission[]
  >([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [saveResult, setSaveResult] = useState<{
    variant: 'success' | 'danger';
    message: string;
  } | null>(null);

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
  }, [users, client, projectId, organizationId]);

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

  // Returns true only when every change was written.
  const handleSave = async () => {
    setIsSaving(true);
    setSaveResult(null);

    const permissionsToUpdate = permissions.filter(
      (p) =>
        !originalPermissions.some(
          (op) =>
            op.userId === p.userId &&
            op.annotationAccess === p.annotationAccess &&
            op.isAdmin === p.isAdmin
        )
    );

    // Keep going past a failed user so one rejection doesn't silently skip
    // everyone after it; report exactly who didn't save.
    const failed: string[] = [];
    for (const permission of permissionsToUpdate) {
      try {
        await applyProjectMembershipChange(client, {
          userId: permission.userId,
          projectId,
          membershipId: permission.membershipId,
          annotationAccess: permission.annotationAccess,
          isAdmin: permission.isAdmin,
          group: organizationId,
        });
      } catch (err) {
        console.error(
          `Failed to save survey access for user ${permission.userId}`,
          err
        );
        failed.push(permission.userName);
      }
    }

    try {
      // Refetch so the toggles show what was actually saved.
      await fetchData();
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
    return failed.length === 0;
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
    // Stay open on failure so the error is seen.
    if (await handleSave()) showModal(null);
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
          setSaveResult(null);
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
          setSaveResult(null);
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
        {saveResult && (
          <Alert variant={saveResult.variant} className='mt-3 mb-0'>
            {saveResult.message}
          </Alert>
        )}
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
