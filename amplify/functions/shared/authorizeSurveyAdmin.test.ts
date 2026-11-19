import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeSurveyAdmin } from './authorizeSurveyAdmin';

const project = { id: 'p1', organizationId: 'o1' };
const member = { sub: 'u1', groups: ['o1'] };

function store(orgMembership: { isAdmin: boolean } | null, pages: { projectId: string; isAdmin: boolean | null }[][]) {
  const calls: Record<string, unknown>[] = [];
  const graphql = async <T>(query: string, variables: Record<string, unknown>) => {
    if (query.includes('getOrganizationMembership')) {
      return { getOrganizationMembership: orgMembership } as T;
    }
    calls.push(variables);
    const index = variables.nextToken ? Number(variables.nextToken) : 0;
    return {
      userProjectMembershipsByUserId: {
        items: pages[index] ?? [],
        nextToken: index + 1 < pages.length ? String(index + 1) : null,
      },
    } as T;
  };
  return { graphql, calls };
}

test('pages until an admin row for the project is found', async () => {
  const { graphql, calls } = store({ isAdmin: false }, [
    [{ projectId: 'p1', isAdmin: false }],
    [],
    [{ projectId: 'p1', isAdmin: true }],
  ]);
  await authorizeSurveyAdmin(member, project, graphql);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].filter, { projectId: { eq: 'p1' } });
});

test('rejects when no page holds an admin row', async () => {
  const { graphql } = store({ isAdmin: false }, [[{ projectId: 'p1', isAdmin: false }], []]);
  await assert.rejects(authorizeSurveyAdmin(member, project, graphql), /not a project admin/);
});

test('organisation admins pass, former members do not', async () => {
  await authorizeSurveyAdmin(member, project, store({ isAdmin: true }, []).graphql);
  const stale = store(null, [[{ projectId: 'p1', isAdmin: true }]]);
  await assert.rejects(authorizeSurveyAdmin(member, project, stale.graphql), /organization/);
  await assert.rejects(
    authorizeSurveyAdmin({ sub: 'u1', groups: ['o2'] }, project, store({ isAdmin: true }, []).graphql),
  );
  await authorizeSurveyAdmin({ sub: 'u1', groups: ['sysadmin'] }, project, stale.graphql);
});
