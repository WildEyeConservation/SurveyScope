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
  query UserProjectMembershipsByUserId(
    $userId: String!
    $filter: ModelUserProjectMembershipFilterInput
    $limit: Int
    $nextToken: String
  ) {
    userProjectMembershipsByUserId(
      userId: $userId
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        projectId
        isAdmin
      }
      nextToken
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
  const organizationMembership = organization.getOrganizationMembership;
  // Someone who left the organisation keeps no access through stale survey rows.
  if (!organizationMembership) {
    throw new Error('Unauthorized: user does not belong to this organization');
  }
  if (organizationMembership.isAdmin) return;
  // Duplicate membership rows can exist; any admin row for the project counts.
  let nextToken: string | null | undefined;
  do {
    const page = await executeGraphql<{
      userProjectMembershipsByUserId?: {
        items?: ({ projectId: string; isAdmin: boolean | null } | null)[];
        nextToken?: string | null;
      } | null;
    }>(userProjectMembershipsQuery, {
      userId: identity.sub,
      filter: { projectId: { eq: project.id } },
      limit: 1000,
      nextToken,
    });
    const memberships = page.userProjectMembershipsByUserId;
    if (memberships?.items?.some((m) => m?.projectId === project.id && m.isAdmin)) {
      return;
    }
    nextToken = memberships?.nextToken;
  } while (nextToken);
  throw new Error('Unauthorized: user is not a project admin');
}
