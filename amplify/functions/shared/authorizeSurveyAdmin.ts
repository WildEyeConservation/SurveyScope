const getOrganizationMembershipQuery = /* GraphQL */ `
  query GetOrganizationMembership($organizationId: ID!, $userId: String!) {
    getOrganizationMembership(
      organizationId: $organizationId
      userId: $userId
    ) {
      isAdmin
    }
  }
`;

const userProjectMembershipsQuery = /* GraphQL */ `
  query UserProjectMembershipsByUserId($userId: String!, $limit: Int) {
    userProjectMembershipsByUserId(userId: $userId, limit: $limit) {
      items {
        projectId
        isAdmin
      }
    }
  }
`;

type Identity = { sub?: string; groups?: string[] | null } | null | undefined;

// Organisation admins administer every survey of their organisation, as in the API router.
export async function authorizeSurveyAdmin(
  identity: Identity,
  project: { id: string; organizationId: string },
  executeGraphql: <T>(
    query: string,
    variables: Record<string, unknown>,
  ) => Promise<T>,
): Promise<void> {
  if (!identity?.sub) throw new Error('Unauthorized: no identity');
  const groups = identity.groups ?? [];
  if (groups.includes('sysadmin')) return;
  if (!groups.includes(project.organizationId)) {
    throw new Error('Unauthorized: user does not belong to this organization');
  }
  const organization = await executeGraphql<{
    getOrganizationMembership?: { isAdmin?: boolean | null } | null;
  }>(getOrganizationMembershipQuery, {
    organizationId: project.organizationId,
    userId: identity.sub,
  });
  if (organization.getOrganizationMembership?.isAdmin) return;
  const memberships = await executeGraphql<{
    userProjectMembershipsByUserId?: {
      items: { projectId: string; isAdmin: boolean | null }[];
    };
  }>(userProjectMembershipsQuery, { userId: identity.sub, limit: 1000 });
  const membership = memberships.userProjectMembershipsByUserId?.items?.find(
    (m) => m.projectId === project.id,
  );
  if (!membership?.isAdmin) {
    throw new Error('Unauthorized: user is not a project admin');
  }
}
