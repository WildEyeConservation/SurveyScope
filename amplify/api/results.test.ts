import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { authorizeRequest } from '../functions/shared/authorizeRequest';
import { ApiError } from './errors';
import { resolverIdentity } from './invoke';
import { Authorized, OPERATIONS } from './operations';
import { POLICIES } from './policies';
import * as results from './results';
import { actor, gateway, MemoryData, operationContext } from './testing';

function fixture() {
  return new MemoryData({
    OrganizationMembership: [
      { organizationId: 'org1', userId: 'admin', isAdmin: true },
      { organizationId: 'org1', userId: 'member', isAdmin: false },
    ],
    Project: [{ id: 'p1', organizationId: 'org1' }],
    UserProjectMembership: [{ id: 'm1', userId: 'member', projectId: 'p1' }],
    AnnotationSet: [
      { id: 'a1', projectId: 'p1' },
      { id: 'a2', projectId: 'p1' },
    ],
    JollyResult: [
      { id: 'r1', surveyId: 'p1', annotationSetId: 'a1' },
      { id: 'r2', surveyId: 'p1', annotationSetId: 'a2' },
    ],
    JollyResultsMembership: [],
    ResultSharingToken: [],
    ChainReviewFeedback: [
      { id: 'f1', shareId: 's1', owner: 'someone::someone', kind: 'comment' },
    ],
  });
}

const resultsContext = (data: MemoryData, user: string) => ({
  ...gateway(data, actor(user), POLICIES),
  data,
  secret: () => 'test-secret',
});

const denied = (promise: Promise<unknown>) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof ApiError && e.status === 403,
  );

describe('results sharing', () => {
  it('signs links for survey admins and grants the set to whoever redeems one', async () => {
    const data = fixture();
    const expiresAt = Date.now() + 3600_000;
    await denied(
      results.share(resultsContext(data, 'member'), {
        surveyId: 'p1',
        annotationSetId: 'a1',
        expiresAt,
      }),
    );
    const shared = await results.share(resultsContext(data, 'admin'), {
      surveyId: 'p1',
      annotationSetId: 'a1',
      expiresAt,
    });
    const { token } = shared.data as { token: string };
    const again = await results.link(resultsContext(data, 'admin'), {
      surveyId: 'p1',
      annotationSetId: 'a1',
    });
    assert.equal((again.data as { token: string }).token, token);

    const outsider = () => gateway(data, actor('outsider'), POLICIES).models;
    await denied(outsider().run('JollyResult', 'get', [{ id: 'r1' }]));
    await results.redeem(resultsContext(data, 'outsider'), { token });
    await outsider().run('JollyResult', 'get', [{ id: 'r1' }]);
    await denied(outsider().run('JollyResult', 'get', [{ id: 'r2' }]));
    const listed = await outsider().run(
      'JollyResult',
      'jollyResultsBySurveyId',
      [{ surveyId: 'p1' }],
    );
    assert.deepEqual(
      (listed.data as { id: string }[]).map((r) => r.id),
      ['r1'],
    );
    await denied(
      results.redeem(resultsContext(data, 'outsider'), { token: `${token}x` }),
    );
  });

  it('lets results readers fetch only their sets as row chunks', async () => {
    const data = fixture();
    data.tables.JollyResultsMembership.push({
      surveyId: 'p1',
      annotationSetId: 'a1',
      userId: 'reader',
    });
    const ctx = operationContext(data, actor('reader'), POLICIES);
    const verdict = await OPERATIONS.getRowChunk.authorize(ctx, {
      source: 'annotationsByAnnotationSetId',
      scopeId: 'a1',
    });
    assert.ok(verdict instanceof Authorized);
    const identity = resolverIdentity(
      actor('reader'),
      verdict.grant.groups ?? [],
    );
    authorizeRequest(identity, 'org1');
    await denied(
      OPERATIONS.getRowChunk.authorize(ctx, {
        source: 'annotationsByAnnotationSetId',
        scopeId: 'a2',
      }),
    );
    await denied(
      OPERATIONS.getRowChunk.authorize(ctx, {
        source: 'observationsByAnnotationSetId',
        scopeId: 'a1',
      }),
    );
    await OPERATIONS.getRowChunk.authorize(ctx, {
      source: 'imagesByProjectId',
      scopeId: 'p1',
    });
    await denied(
      OPERATIONS.getRowChunk.authorize(
        operationContext(data, actor('member'), POLICIES),
        { source: 'imagesByProjectId', scopeId: 'p1' },
      ),
    );
  });
});

describe('chain review feedback', () => {
  it('keeps reviewers to their own opinions and runs the share guard on writes', async () => {
    const data = fixture();
    const calls: [string, string, Record<string, unknown>][] = [];
    const reviewer = (allow = true) =>
      gateway(
        data,
        actor('rev', ['chainshare-s1']),
        POLICIES,
        async (fn, field, input) => {
          calls.push([fn, field, input]);
          return allow;
        },
      ).models;
    await reviewer().run('ChainReviewFeedback', 'create', [
      { id: 'f2', shareId: 's1', kind: 'comment' },
    ]);
    assert.deepEqual(calls[0].slice(0, 2), [
      'chainMutationGuard',
      'createChainReviewFeedback',
    ]);
    assert.equal(calls[0][2].owner, 'rev::rev');
    const mine = await reviewer().run(
      'ChainReviewFeedback',
      'chainReviewFeedbackByShareId',
      [{ shareId: 's1' }],
    );
    assert.deepEqual(
      (mine.data as { id: string }[]).map((f) => f.id),
      ['f2'],
    );
    await denied(
      reviewer().run('ChainReviewFeedback', 'update', [
        { id: 'f1', comment: 'x' },
      ]),
    );
    await denied(
      reviewer(false).run('ChainReviewFeedback', 'update', [
        { id: 'f2', comment: 'x' },
      ]),
    );
    await denied(
      gateway(data, actor('member'), POLICIES).models.run(
        'ChainReviewFeedback',
        'chainReviewFeedbackByShareId',
        [{ shareId: 's1' }],
      ),
    );
  });
});
