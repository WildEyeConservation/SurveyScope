import { useQuery } from '@tanstack/react-query';
import { useContext, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { GlobalContext, ProjectContext, UserContext } from './Context';

export default function RequireExploreAccess({
  children,
}: {
  children: ReactNode;
}) {
  const { client } = useContext(GlobalContext)!;
  const { user, myOrganizationHook } = useContext(UserContext)!;
  const { currentPM, project } = useContext(ProjectContext)!;
  const surveyAdmin = Boolean(currentPM.isAdmin);
  const organizationId = project?.organizationId;
  const liveMembership = myOrganizationHook.data.find(
    (m) => m.organizationId === organizationId,
  );
  const orgAdmin = useQuery({
    queryKey: ['explore-org-admin', organizationId, user.username],
    enabled: !surveyAdmin && !liveMembership && Boolean(organizationId),
    staleTime: 0,
    gcTime: 0,
    meta: { persist: false },
    queryFn: async () => {
      const { data } = await client.models.OrganizationMembership.get({
        organizationId: organizationId!,
        userId: user.username,
      });
      return Boolean(data?.isAdmin);
    },
  });

  const isOrgAdmin = liveMembership
    ? Boolean(liveMembership.isAdmin)
    : orgAdmin.data;
  if (surveyAdmin || isOrgAdmin) return <>{children}</>;
  if (!organizationId || (!liveMembership && orgAdmin.isLoading)) return null;
  return <Navigate to='/jobs' replace />;
}
