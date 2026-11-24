import { useCallback, useContext } from 'react';
import { UserContext } from './Context';

export function useCanExplore() {
  const user = useContext(UserContext);
  const memberships = user?.myMembershipHook.data;
  const organizations = user?.myOrganizationHook.data;
  return useCallback(
    (projectId: string, organizationId?: string | null) =>
      Boolean(
        memberships?.some((m) => m.projectId === projectId && m.isAdmin) ||
        (organizationId &&
          organizations?.some(
            (m) => m.organizationId === organizationId && m.isAdmin,
          )),
      ),
    [memberships, organizations],
  );
}
