/*
Shared write path for the two screens that grant survey access: the survey's
Manage Users tab and the organisation's Permission Exceptions modal.

limitedClient throws when AppSync returns an `errors` array, but a write that
AppSync rejects for authorization comes back as a null row with no errors (see
utils/optimisticCache). Every write here is therefore checked for a missing row
so a rejected change surfaces as a failure instead of looking like a success.
*/
import type { DataClient } from '../../amplify/shared/data-schema.generated';
import { fetchAllPaginatedResults } from '../utils';
import { isMissingRow } from './optimisticCache';

export type ProjectMembershipChange = {
  userId: string;
  projectId: string;
  membershipId: string | null;
  annotationAccess: boolean;
  isAdmin: boolean;
  group: string;
};

function assertWritten(result: unknown, action: string) {
  if (isMissingRow(result)) {
    throw new Error(`${action} was rejected by the server`);
  }
}

/** Creates, updates or deletes one project membership to match `change`. */
export async function applyProjectMembershipChange(
  client: DataClient,
  change: ProjectMembershipChange
): Promise<void> {
  const wantsMembership = change.annotationAccess || change.isAdmin;

  if (change.membershipId) {
    if (!wantsMembership) {
      assertWritten(
        await client.models.UserProjectMembership.delete({
          id: change.membershipId,
        }),
        'Removing access'
      );
    } else {
      assertWritten(
        await client.models.UserProjectMembership.update({
          id: change.membershipId,
          isAdmin: change.isAdmin,
        }),
        'Updating access'
      );
    }
    return;
  }

  if (!wantsMembership) return;

  // Re-read before creating so a membership added by another flow since the
  // screen loaded is updated rather than duplicated.
  const existingRows = await fetchAllPaginatedResults(
    client.models.UserProjectMembership.userProjectMembershipsByUserId,
    {
      userId: change.userId,
      filter: { projectId: { eq: change.projectId } },
    }
  );

  if (existingRows.length > 0) {
    if (existingRows.length > 1) {
      console.warn(
        `Found ${existingRows.length} memberships for user ${change.userId} in project ${change.projectId}`
      );
    }
    assertWritten(
      await client.models.UserProjectMembership.update({
        id: existingRows[0].id,
        isAdmin: change.isAdmin,
      }),
      'Updating access'
    );
    return;
  }

  assertWritten(
    await client.models.UserProjectMembership.create({
      userId: change.userId,
      projectId: change.projectId,
      isAdmin: change.isAdmin,
      group: change.group,
    }),
    'Granting access'
  );
}
