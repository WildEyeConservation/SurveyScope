import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ApiError } from './errors';
import type { ModelPolicy } from './models';
import { POLICIES } from './policies';
import { actor, gateway, MemoryData } from './testing';

const policies: Record<string, ModelPolicy> = {
  ...POLICIES,
  Project: {
    scope: { survey: 'id' },
    read: [{ survey: 'member' }, { organization: 'admin' }],
    update: [{ survey: 'admin' }],
    scan: true,
  },
  Queue: {
    scope: { survey: 'projectId' },
    read: [{ survey: 'member' }],
    create: [{ survey: 'admin' }],
  },
  Note: {
    scope: { survey: 'projectId' },
    read: [{ survey: 'member' }],
    create: [{ survey: 'member' }],
    owner: 'owner',
  },
};

function fixture() {
  return new MemoryData({
    Organization: [
      { id: 'org1', name: 'One' },
      { id: 'org2', name: 'Two' },
    ],
    OrganizationMembership: [
      { organizationId: 'org1', userId: 'orgAdmin', isAdmin: true },
      { organizationId: 'org1', userId: 'surveyAdmin', isAdmin: false },
      { organizationId: 'org1', userId: 'annotator', isAdmin: false },
      { organizationId: 'org1', userId: 'bystander', isAdmin: false },
      { organizationId: 'org2', userId: 'outsider', isAdmin: true },
    ],
    Project: [
      { id: 'p1', name: 'Survey one', organizationId: 'org1' },
      { id: 'p2', name: 'Survey two', organizationId: 'org2' },
    ],
    UserProjectMembership: [
      { id: 'm1', userId: 'surveyAdmin', projectId: 'p1', isAdmin: true },
      { id: 'm2', userId: 'annotator', projectId: 'p1', isAdmin: false },
      { id: 'm3', userId: 'leaver', projectId: 'p1', isAdmin: true },
    ],
    Queue: [
      { id: 'q1', projectId: 'p1', name: 'Queue one' },
      { id: 'q2', projectId: 'p2', name: 'Queue two' },
    ],
  });
}

const as = (data: MemoryData, user: string, groups: string[] = []) =>
  gateway(data, actor(user, groups), policies);

async function denied(promise: Promise<unknown>, status = 403) {
  await assert.rejects(
    promise,
    (e: unknown) => e instanceof ApiError && e.status === status,
  );
}

describe('survey standing', () => {
  it('follows the ladder from the database', async () => {
    const data = fixture();
    const role = async (user: string) =>
      (await as(data, user).access.surveyStanding('p1'))?.role ?? null;
    assert.equal(await role('orgAdmin'), 'admin');
    assert.equal(await role('surveyAdmin'), 'admin');
    assert.equal(await role('annotator'), 'annotator');
    assert.equal(await role('bystander'), null);
    assert.equal(await role('outsider'), null);
    assert.equal(
      await role('leaver'),
      null,
      'a survey row outlives organisation membership',
    );
    assert.equal(
      (await as(data, 'nobody', ['sysadmin']).access.surveyStanding('p1'))
        ?.role,
      'admin',
    );
  });
});

describe('production policies', () => {
  it('keep membership queues inside their survey before Queue has a policy', async () => {
    const data = fixture();
    const { models } = gateway(data, actor('annotator'), POLICIES);
    await denied(
      models.run('UserProjectMembership', 'update', [
        { id: 'm2', queueId: 'q2' },
      ]),
    );
    await denied(
      models.run('UserProjectMembership', 'update', [
        { id: 'm2', backupQueueId: 'q2' },
      ]),
    );
    await models.run('UserProjectMembership', 'update', [
      { id: 'm2', backupQueueId: 'q1' },
    ]);
  });

  it("let an organisation admin look up a member's memberships in their surveys only", async () => {
    const data = fixture();
    data.tables.UserProjectMembership.push({
      id: 'm4',
      userId: 'annotator',
      projectId: 'p2',
    });
    const lookup = (user: string) =>
      gateway(data, actor(user), POLICIES).models.run(
        'UserProjectMembership',
        'userProjectMembershipsByUserId',
        [{ userId: 'annotator' }],
      );
    const ids = async (user: string) =>
      ((await lookup(user)).data as { id: string }[]).map((m) => m.id);
    assert.deepEqual(await ids('orgAdmin'), ['m2']);
    assert.deepEqual(await ids('bystander'), []);
    assert.deepEqual(await ids('outsider'), ['m4']);
    const subscribe = gateway(data, actor('orgAdmin'), POLICIES).models;
    assert.equal(
      await subscribe.canSubscribe(
        'UserProjectMembership',
        'userId',
        'annotator',
      ),
      false,
    );
  });
});

describe('survey configuration', () => {
  it('hides hidden queues from annotators', async () => {
    const data = fixture();
    data.tables.Queue.push({
      id: 'q3',
      projectId: 'p1',
      name: 'Hidden',
      hidden: true,
    });
    const list = async (user: string) =>
      (
        (
          await gateway(data, actor(user), POLICIES).models.run(
            'Queue',
            'list',
            [{ filter: { projectId: { eq: 'p1' } } }],
          )
        ).data as { id: string }[]
      ).map((q) => q.id);
    assert.deepEqual(await list('annotator'), ['q1']);
    assert.deepEqual(await list('surveyAdmin'), ['q1', 'q3']);
    const annotator = gateway(data, actor('annotator'), POLICIES).models;
    assert.equal(
      await annotator.canSubscribe('Queue', 'projectId', 'p1'),
      false,
    );
    await denied(annotator.run('Queue', 'update', [{ id: 'q1', zoom: 3 }]));
  });

  it("lets a survey admin rename only their own survey's test preset", async () => {
    const data = fixture();
    data.tables.TestPreset = [
      { id: 't1', organizationId: 'org1', ownerProjectId: 'p1', name: 'One' },
      { id: 't2', organizationId: 'org1', name: 'Shared' },
    ];
    const { models } = gateway(data, actor('surveyAdmin'), POLICIES);
    const own = await models.run('TestPreset', 'testPresetsByOwnerProjectId', [
      { ownerProjectId: 'p1' },
    ]);
    assert.deepEqual(
      (own.data as { id: string }[]).map((t) => t.id),
      ['t1'],
    );
    await models.run('TestPreset', 'update', [{ id: 't1', name: 'Renamed' }]);
    await denied(
      models.run('TestPreset', 'update', [{ id: 't1', ownerProjectId: 'p2' }]),
    );
    await denied(
      models.run('TestPreset', 'update', [{ id: 't2', name: 'Mine' }]),
    );
  });
});

describe('model gateway', () => {
  it('lets annotators read their own memberships only', async () => {
    const data = fixture();
    const { models } = as(data, 'annotator');
    const own = await models.run(
      'UserProjectMembership',
      'userProjectMembershipsByUserId',
      [{ userId: 'annotator' }],
    );
    assert.deepEqual(
      (own.data as { id: string }[]).map((m) => m.id),
      ['m2'],
    );
    const others = await models.run(
      'UserProjectMembership',
      'userProjectMembershipsByUserId',
      [{ userId: 'surveyAdmin' }],
    );
    assert.deepEqual(others.data, []);
    const survey = await models.run('UserProjectMembership', 'list', [
      { filter: { projectId: { eq: 'p1' } } },
    ]);
    assert.deepEqual(
      (survey.data as { id: string }[]).map((m) => m.id),
      ['m2'],
    );
    await denied(
      as(data, 'bystander').models.run('UserProjectMembership', 'list', [
        { filter: { projectId: { eq: 'p1' } } },
      ]),
    );
  });

  it('lets annotators pick a queue but not promote themselves', async () => {
    const data = fixture();
    const { models } = as(data, 'annotator');
    await models.run('UserProjectMembership', 'update', [
      { id: 'm2', queueId: 'q1' },
    ]);
    assert.equal(data.tables.UserProjectMembership[1].queueId, 'q1');
    await denied(
      models.run('UserProjectMembership', 'update', [
        { id: 'm2', isAdmin: true },
      ]),
    );
    await denied(
      models.run('UserProjectMembership', 'update', [
        { id: 'm2', queueId: 'q2' },
      ]),
    );
    await denied(
      models.run('UserProjectMembership', 'update', [
        { id: 'm1', queueId: 'q1' },
      ]),
    );
  });

  it('lets survey admins manage memberships within their survey only', async () => {
    const data = fixture();
    const { models } = as(data, 'surveyAdmin');
    await models.run('UserProjectMembership', 'create', [
      { userId: 'bystander', projectId: 'p1', isAdmin: false, group: 'org2' },
    ]);
    assert.equal(data.tables.UserProjectMembership.at(-1)!.group, 'org1');
    await denied(
      models.run('UserProjectMembership', 'create', [
        { userId: 'bystander', projectId: 'p2' },
      ]),
    );
    await denied(
      models.run('UserProjectMembership', 'update', [
        { id: 'm2', projectId: 'p2' },
      ]),
    );
  });

  it('refuses unscoped lists unless the model allows a filtered scan', async () => {
    const data = fixture();
    const { models } = as(data, 'annotator');
    await denied(models.run('UserProjectMembership', 'list', [{}]));
    const projects = await models.run('Project', 'list', [{}]);
    assert.deepEqual(
      (projects.data as { id: string }[]).map((p) => p.id),
      ['p1'],
    );
    const organizations = await models.run('Organization', 'list', [{}]);
    assert.deepEqual(
      (organizations.data as { id: string }[]).map((o) => o.id),
      ['org1'],
    );
  });

  it('drops nested rows the caller cannot read', async () => {
    const data = fixture();
    const { models } = as(data, 'bystander');
    const org = await models.run('Organization', 'get', [
      { id: 'org1' },
      { selectionSet: ['id', 'memberships.*'] },
    ]);
    assert.equal(
      (org.data as { memberships: unknown[] }).memberships.length,
      4,
    );
    await denied(models.run('Project', 'get', [{ id: 'p1' }]));
    const admin = await as(data, 'orgAdmin').models.run('Project', 'get', [
      { id: 'p1' },
      { selectionSet: ['id', 'queues.*'] },
    ]);
    assert.equal((admin.data as { queues: unknown[] }).queues.length, 1);
  });

  it('sets the owner and organisation group on the server', async () => {
    const data = fixture();
    const { models } = as(data, 'annotator');
    await models.run('Note', 'create', [
      { projectId: 'p1', text: 'hi', owner: 'surveyAdmin' },
    ]);
    assert.deepEqual(data.writes.at(-1)!.input, {
      projectId: 'p1',
      text: 'hi',
      owner: 'annotator::annotator',
      group: 'org1',
    });
  });

  it('refuses rows referencing another survey', async () => {
    const data = fixture();
    const { models } = as(data, 'orgAdmin');
    await denied(
      models.run('UserProjectMembership', 'create', [
        { userId: 'annotator', projectId: 'p1', queueId: 'q2' },
      ]),
    );
  });

  it('keeps organisation admin rights out of generic updates', async () => {
    const data = fixture();
    const { models } = as(data, 'orgAdmin');
    await models.run('OrganizationMembership', 'update', [
      {
        organizationId: 'org1',
        userId: 'annotator',
        isTested: true,
        isAdmin: true,
      },
    ]);
    assert.deepEqual(data.tables.OrganizationMembership[2], {
      organizationId: 'org1',
      userId: 'annotator',
      isAdmin: false,
      isTested: true,
    });
    await denied(
      as(data, 'annotator').models.run('OrganizationMembership', 'update', [
        { organizationId: 'org1', userId: 'annotator', isTested: false },
      ]),
    );
  });

  it('authorises realtime channels like the matching list', async () => {
    const data = fixture();
    const annotator = as(data, 'annotator').models;
    assert.equal(
      await annotator.canSubscribe(
        'UserProjectMembership',
        'userId',
        'annotator',
      ),
      true,
    );
    assert.equal(
      await annotator.canSubscribe(
        'UserProjectMembership',
        'userId',
        'surveyAdmin',
      ),
      false,
    );
    assert.equal(
      await annotator.canSubscribe('UserProjectMembership', 'projectId', 'p1'),
      false,
    );
    assert.equal(
      await annotator.canSubscribe(
        'OrganizationMembership',
        'organizationId',
        'org1',
      ),
      true,
    );
    assert.equal(
      await annotator.canSubscribe(
        'OrganizationMembership',
        'organizationId',
        'org2',
      ),
      false,
    );
    assert.equal(
      await annotator.canSubscribe('OrganizationRegistration', 'all', 'all'),
      false,
    );
    assert.equal(
      await as(data, 'x', ['sysadmin']).models.canSubscribe(
        'OrganizationRegistration',
        'all',
        'all',
      ),
      true,
    );
  });

  it('only lets sysadmins use models without rules', async () => {
    const data = fixture();
    await denied(
      as(data, 'orgAdmin').models.run('OrganizationRegistration', 'list', [{}]),
    );
    await denied(as(data, 'orgAdmin').models.run('Missing', 'list', [{}]));
    const result = await as(data, 'x', ['sysadmin']).models.run(
      'OrganizationRegistration',
      'list',
      [{}],
    );
    assert.deepEqual(result.data, []);
  });
});
