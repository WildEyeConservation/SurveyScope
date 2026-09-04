import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Schema } from '../amplify/client-schema';
import { useSession } from '../session';
import { client } from '../stores/appClient';
import { useOptimisticUpdates } from '../useOptimisticUpdates';

export function useMyMemberships() {
  const { user } = useSession();
  const subscriptionFilter = useMemo(
    () => ({
      filter: { userId: { eq: user.username } },
    }),
    [user.username]
  );

  return useOptimisticUpdates<
    Schema['UserProjectMembership']['type'],
    'UserProjectMembership'
  >(
    'UserProjectMembership',
    async (nextToken) =>
      client.models.UserProjectMembership.userProjectMembershipsByUserId(
        { userId: user.username },
        { nextToken }
      ),
    subscriptionFilter,
    {
      compositeKey: (membership) =>
        membership.userId && membership.projectId
          ? `${membership.userId}:${membership.projectId}`
          : membership.id,
    }
  );
}

export function useMyOrganizations() {
  const { user, cognitoGroups, isSysadmin } = useSession();
  const subscriptionFilter = useMemo(
    () => ({
      filter: { userId: { eq: user.username } },
    }),
    [user.username]
  );
  const allOrganizationHook = useOptimisticUpdates<
    Schema['OrganizationMembership']['type'],
    'OrganizationMembership'
  >(
    'OrganizationMembership',
    async (nextToken) =>
      client.models.OrganizationMembership.organizationsByUserId(
        { userId: user.username },
        { nextToken }
      ),
    subscriptionFilter,
    {
      compositeKey: (membership) =>
        `${membership.organizationId}:${membership.userId}`,
    }
  );
  const activeCognitoOrgIds = useMemo(
    () =>
      new Set(
        cognitoGroups.filter(
          (group) => group !== 'sysadmin' && group !== 'orgadmin'
        )
      ),
    [cognitoGroups]
  );

  return useMemo(
    () => ({
      ...allOrganizationHook,
      data: isSysadmin
        ? allOrganizationHook.data
        : allOrganizationHook.data.filter((membership) =>
            activeCognitoOrgIds.has(membership.organizationId)
          ),
    }),
    [allOrganizationHook, activeCognitoOrgIds, isSysadmin]
  );
}

export function useIsOrganizationAdmin() {
  return useMyOrganizations().data.some((membership) => membership.isAdmin);
}

export function useCurrentMembership(projectId: string | undefined) {
  const { user } = useSession();
  const userId = user.userId;

  return useQuery({
    queryKey: ['currentPM', userId, projectId],
    queryFn: async () => {
      if (!userId || !projectId) return null;
      const {
        data: [membership],
      } =
        await client.models.UserProjectMembership.userProjectMembershipsByUserId(
          { userId },
          { filter: { projectId: { eq: projectId } } }
        );
      return membership ?? null;
    },
    enabled: Boolean(userId && projectId),
    staleTime: 30_000,
  });
}
