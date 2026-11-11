import { Access, type AccessStore, type Actor } from './access';
import type { LaunchStore } from './launch';
import type { Lease } from './leases';
import {
  Models,
  type DataLayer,
  type ModelPolicy,
  type QueryOptions,
  type WriteGuard,
} from './models';
import type { OperationContext } from './operations';
import { SchemaInfo, type Introspection, type Row } from './schema';
import type { TaskContext } from './tasks';
import type { LeaseTable, TaskQueue } from './taskStore';

type Field = Introspection['models'][string]['fields'][string];

const scalar = (name: string): Field => ({ name, type: 'String' });
const belongsTo = (name: string, model: string, fk: string): Field => ({
  name,
  type: { model },
  association: { connectionType: 'BELONGS_TO', targetNames: [fk] },
});
const hasMany = (name: string, model: string, fk: string): Field => ({
  name,
  type: { model },
  isArray: true,
  association: { connectionType: 'HAS_MANY', associatedWith: [fk] },
});

function model(
  name: string,
  fields: Field[],
  options: { key?: string[]; indexes?: Record<string, string[]> } = {},
) {
  const [pk, ...sk] = options.key ?? ['id'];
  return {
    name,
    fields: Object.fromEntries(
      [...(options.key ? [] : [scalar('id')]), ...fields].map((f) => [
        f.name,
        f,
      ]),
    ),
    attributes: [
      ...Object.entries(options.indexes ?? {}).map(
        ([queryField, keyFields]) => ({
          type: 'key',
          properties: { queryField, fields: keyFields },
        }),
      ),
    ],
    primaryKeyInfo: { primaryKeyFieldName: pk, sortKeyFieldNames: sk },
  };
}

export const introspection: Introspection = {
  models: {
    Organization: model('Organization', [
      scalar('name'),
      scalar('group'),
      hasMany('memberships', 'OrganizationMembership', 'organizationId'),
    ]),
    OrganizationMembership: model(
      'OrganizationMembership',
      [
        scalar('organizationId'),
        scalar('userId'),
        scalar('isAdmin'),
        scalar('isTested'),
        scalar('group'),
        belongsTo('organization', 'Organization', 'organizationId'),
      ],
      {
        key: ['organizationId', 'userId'],
        indexes: { organizationsByUserId: ['userId'] },
      },
    ),
    Project: model('Project', [
      scalar('name'),
      scalar('organizationId'),
      scalar('group'),
      belongsTo('organization', 'Organization', 'organizationId'),
      hasMany('queues', 'Queue', 'projectId'),
    ]),
    UserProjectMembership: model(
      'UserProjectMembership',
      [
        scalar('userId'),
        scalar('projectId'),
        scalar('isAdmin'),
        scalar('queueId'),
        scalar('backupQueueId'),
        scalar('group'),
        belongsTo('project', 'Project', 'projectId'),
        belongsTo('queue', 'Queue', 'queueId'),
        belongsTo('backupQueue', 'Queue', 'backupQueueId'),
      ],
      { indexes: { userProjectMembershipsByUserId: ['userId'] } },
    ),
    Queue: model(
      'Queue',
      [
        scalar('projectId'),
        scalar('name'),
        scalar('hidden'),
        scalar('url'),
        scalar('annotationSetId'),
        scalar('group'),
        belongsTo('project', 'Project', 'projectId'),
      ],
      { indexes: { queuesByProjectId: ['projectId'] } },
    ),
    Image: model('Image', [
      scalar('projectId'),
      scalar('group'),
      belongsTo('project', 'Project', 'projectId'),
    ]),
    Location: model('Location', [
      scalar('projectId'),
      scalar('imageId'),
      scalar('group'),
      belongsTo('image', 'Image', 'imageId'),
    ]),
    Annotation: model(
      'Annotation',
      [
        scalar('projectId'),
        scalar('imageId'),
        scalar('setId'),
        scalar('objectId'),
        scalar('owner'),
        scalar('group'),
        belongsTo('image', 'Image', 'imageId'),
        belongsTo('set', 'AnnotationSet', 'setId'),
      ],
      {
        indexes: {
          annotationsByImageIdAndSetId: ['imageId', 'setId'],
          annotationsByObjectId: ['objectId'],
        },
      },
    ),
    ImageNeighbour: model(
      'ImageNeighbour',
      [
        scalar('image1Id'),
        scalar('image2Id'),
        scalar('projectId'),
        scalar('group'),
        belongsTo('image1', 'Image', 'image1Id'),
        belongsTo('image2', 'Image', 'image2Id'),
      ],
      { key: ['image1Id', 'image2Id'] },
    ),
    IndividualIdJob: model('IndividualIdJob', [
      scalar('projectId'),
      scalar('annotationSetId'),
      scalar('status'),
      scalar('group'),
    ]),
    IndividualIdTransect: model('IndividualIdTransect', [
      scalar('projectId'),
      scalar('jobId'),
      scalar('assignedUserId'),
      scalar('status'),
      scalar('lastActiveAt'),
      scalar('group'),
    ]),
    TestResult: model('TestResult', [
      scalar('userId'),
      scalar('projectId'),
      scalar('locationId'),
      scalar('annotationSetId'),
      scalar('group'),
      belongsTo('project', 'Project', 'projectId'),
      belongsTo('location', 'Location', 'locationId'),
      belongsTo('annotationSet', 'AnnotationSet', 'annotationSetId'),
    ]),
    LocationAnnotationCount: model(
      'LocationAnnotationCount',
      [
        scalar('locationId'),
        scalar('categoryId'),
        scalar('annotationSetId'),
        scalar('count'),
        scalar('group'),
        belongsTo('location', 'Location', 'locationId'),
        belongsTo('annotationSet', 'AnnotationSet', 'annotationSetId'),
      ],
      {
        key: ['locationId', 'categoryId', 'annotationSetId'],
        indexes: {
          categoryCountsByLocationIdAndAnnotationSetId: [
            'locationId',
            'annotationSetId',
          ],
        },
      },
    ),
    Observation: model(
      'Observation',
      [
        scalar('projectId'),
        scalar('locationId'),
        scalar('annotationSetId'),
        scalar('owner'),
        scalar('group'),
        belongsTo('location', 'Location', 'locationId'),
        belongsTo('annotationSet', 'AnnotationSet', 'annotationSetId'),
      ],
      {},
    ),
    SharedChainImage: model('SharedChainImage', [
      scalar('shareId'),
      scalar('sourceImageId'),
      scalar('group'),
    ]),
    ChainShare: model(
      'ChainShare',
      [scalar('shareId'), scalar('status'), scalar('group')],
      { key: ['shareId'] },
    ),
    JollyResult: model(
      'JollyResult',
      [scalar('surveyId'), scalar('annotationSetId'), scalar('group')],
      {
        indexes: { jollyResultsBySurveyId: ['surveyId'] },
      },
    ),
    JollyResultsMembership: model(
      'JollyResultsMembership',
      [
        scalar('surveyId'),
        scalar('annotationSetId'),
        scalar('userId'),
        scalar('group'),
      ],
      {
        key: ['surveyId', 'annotationSetId', 'userId'],
        indexes: { jollyResultsMembershipsBySurveyId: ['surveyId'] },
      },
    ),
    ResultSharingToken: model(
      'ResultSharingToken',
      [
        scalar('surveyId'),
        scalar('annotationSetId'),
        scalar('jwt'),
        scalar('group'),
      ],
      { key: ['surveyId', 'annotationSetId'] },
    ),
    ChainReviewFeedback: model(
      'ChainReviewFeedback',
      [scalar('shareId'), scalar('kind'), scalar('comment'), scalar('owner')],
      { indexes: { chainReviewFeedbackByShareId: ['shareId', 'owner'] } },
    ),
    TestPresetProject: model(
      'TestPresetProject',
      [scalar('testPresetId'), scalar('projectId'), scalar('group')],
      {
        key: ['testPresetId', 'projectId'],
      },
    ),
    TestPresetLocation: model(
      'TestPresetLocation',
      [
        scalar('testPresetId'),
        scalar('locationId'),
        scalar('annotationSetId'),
        scalar('group'),
        belongsTo('testPreset', 'TestPreset', 'testPresetId'),
      ],
      { key: ['testPresetId', 'locationId', 'annotationSetId'] },
    ),
    OrganizationRegistration: model('OrganizationRegistration', [
      scalar('organizationName'),
    ]),
    AnnotationSet: model('AnnotationSet', [
      scalar('projectId'),
      scalar('name'),
      scalar('group'),
    ]),
    LocationSet: model('LocationSet', [
      scalar('projectId'),
      scalar('name'),
      scalar('group'),
    ]),
    TestPreset: model(
      'TestPreset',
      [
        scalar('organizationId'),
        scalar('name'),
        scalar('ownerProjectId'),
        scalar('group'),
      ],
      { indexes: { testPresetsByOwnerProjectId: ['ownerProjectId'] } },
    ),
    Note: model(
      'Note',
      [
        scalar('projectId'),
        scalar('text'),
        scalar('owner'),
        scalar('group'),
        belongsTo('project', 'Project', 'projectId'),
      ],
      {},
    ),
  },
};

const pick = (row: Row, filter: unknown): boolean => {
  if (!filter || typeof filter !== 'object') return true;
  return Object.entries(filter as Row).every(([key, condition]) => {
    if (key === 'and')
      return (condition as unknown[]).every((f) => pick(row, f));
    const c = condition as Row;
    return 'eq' in c ? row[key] === c.eq : true;
  });
};

export class MemoryData implements DataLayer, AccessStore {
  readonly writes: { op: string; model: string; input: Row }[] = [];
  private readonly schema: SchemaInfo;

  constructor(
    readonly tables: Record<string, Row[]>,
    readonly intro: Introspection = introspection,
  ) {
    this.schema = new SchemaInfo(intro);
  }

  private rows(model: string) {
    return (this.tables[model] ??= []);
  }

  private find(model: string, key: Row) {
    return this.rows(model).find((r) =>
      Object.entries(key).every(([k, v]) => r[k] === v),
    );
  }

  private expand(model: string, row: Row, selection?: string[]): Row {
    const out: Row = { ...row };
    for (const path of selection ?? []) {
      const [first] = path.split('.');
      const relation = this.schema.relation(model, first);
      if (!relation || (first in out && out[first] !== row[first])) continue;
      if (relation.kind === 'BELONGS_TO') {
        const [pk] = this.schema.primaryKey(relation.model);
        out[first] =
          this.find(relation.model, { [pk]: row[relation.targetNames[0]] }) ??
          null;
      } else {
        const info = this.intro.models[model].fields[first].association!;
        out[first] = this.rows(relation.model).filter(
          (r) => r[info.associatedWith![0]] === row.id,
        );
      }
    }
    return out;
  }

  async get(model: string, key: Row, options: QueryOptions) {
    const row = this.find(model, key);
    return { data: row ? this.expand(model, row, options.selectionSet) : null };
  }

  async list(model: string, options: QueryOptions) {
    return {
      data: this.rows(model)
        .filter((r) => pick(r, options.filter))
        .map((r) => this.expand(model, r, options.selectionSet)),
      nextToken: null,
    };
  }

  async query(
    model: string,
    _field: string,
    input: Row,
    options: QueryOptions,
  ) {
    return {
      data: this.rows(model)
        .filter((r) =>
          Object.entries(input).every(
            ([k, v]) => typeof v === 'object' || r[k] === v,
          ),
        )
        .filter((r) => pick(r, options.filter))
        .map((r) => this.expand(model, r, options.selectionSet)),
      nextToken: null,
    };
  }

  async create(model: string, input: Row) {
    const row = { id: `${model}-${this.rows(model).length + 1}`, ...input };
    this.rows(model).push(row);
    this.writes.push({ op: 'create', model, input });
    return { data: row };
  }

  async update(model: string, input: Row) {
    const row = this.find(model, this.key(model, input))!;
    Object.assign(row, input);
    this.writes.push({ op: 'update', model, input });
    return { data: row };
  }

  async delete(model: string, key: Row) {
    const row = this.find(model, key)!;
    this.tables[model] = this.rows(model).filter((r) => r !== row);
    this.writes.push({ op: 'delete', model, input: key });
    return { data: row };
  }

  private key(model: string, input: Row) {
    return Object.fromEntries(
      this.schema.primaryKey(model).map((k) => [k, input[k]]),
    );
  }

  async organizationMembership(organizationId: string, userId: string) {
    return (
      this.find('OrganizationMembership', { organizationId, userId }) ?? null
    );
  }

  async organizationIds(userId: string) {
    return this.rows('OrganizationMembership')
      .filter((m) => m.userId === userId)
      .map((m) => m.organizationId as string);
  }

  async project(id: string) {
    return (
      (this.find('Project', { id }) as {
        id: string;
        organizationId: string;
      }) ?? null
    );
  }

  async projectMemberships(userId: string, projectId: string) {
    return this.rows('UserProjectMembership').filter(
      (m) => m.userId === userId && m.projectId === projectId,
    );
  }

  async resultsMemberships(surveyId: string, userId: string) {
    return this.rows('JollyResultsMembership').filter(
      (m) => m.surveyId === surveyId && m.userId === userId,
    ) as { annotationSetId: string }[];
  }

  leases: Lease[] = [];

  async activeLeases(userId: string) {
    const now = Math.floor(Date.now() / 1000);
    return this.leases.filter((l) => l.userId === userId && l.expiresAt > now);
  }

  async memberProjectIds(userId: string) {
    return this.rows('UserProjectMembership')
      .filter((m) => m.userId === userId)
      .map((m) => m.projectId as string);
  }

  async presetIdsOfProject(projectId: string) {
    return this.rows('TestPresetProject')
      .filter((p) => p.projectId === projectId)
      .map((p) => p.testPresetId as string);
  }

  async presetLocations(presetId: string) {
    return this.rows('TestPresetLocation').filter(
      (p) => p.testPresetId === presetId,
    ) as {
      locationId: string;
      annotationSetId: string;
    }[];
  }
}

export function actor(username: string, groups: string[] = []): Actor {
  return { sub: username, username, groups, claims: {} };
}

export function gateway(
  data: MemoryData,
  who: Actor,
  policies: Record<string, ModelPolicy>,
  guard?: WriteGuard,
) {
  const access = new Access(who, data);
  return {
    access,
    models: new Models(
      access,
      data,
      new SchemaInfo(data.intro),
      policies,
      guard,
    ),
  };
}

export class MemoryQueue implements TaskQueue {
  readonly removed: string[] = [];
  readonly visibilities: [string, number][] = [];
  private received = 0;
  constructor(readonly messages: { body: unknown }[] = []) {}

  async receive(_url: string, _visibility: number, max: number) {
    return this.messages.splice(0, max).map((next) => {
      const id = `msg-${this.received++}`;
      return {
        messageId: id,
        receiptHandle: `receipt-${id}`,
        body: JSON.stringify(next.body),
      };
    });
  }
  async remove(_url: string, receiptHandle: string) {
    this.removed.push(receiptHandle);
  }
  async visibility(_url: string, receiptHandle: string, seconds: number) {
    this.visibilities.push([receiptHandle, seconds]);
  }
  async depth() {
    return String(this.messages.length);
  }
}

export function operationContext(
  data: MemoryData,
  who: Actor,
  policies: Record<string, ModelPolicy>,
  extra: { queue?: TaskQueue; launches?: LaunchStore } = {},
): OperationContext {
  const { access, models } = gateway(data, who, policies);
  const leases: LeaseTable = {
    async put(lease) {
      data.leases = [
        ...data.leases.filter(
          (l) => l.leaseId !== lease.leaseId || l.userId !== lease.userId,
        ),
        lease,
      ];
    },
    async get(userId, leaseId) {
      return (
        data.leases.find((l) => l.userId === userId && l.leaseId === leaseId) ??
        null
      );
    },
    active: (userId) => data.activeLeases(userId),
    async expire(userId, leaseId, expiresAt) {
      const lease = data.leases.find(
        (l) => l.userId === userId && l.leaseId === leaseId,
      );
      if (lease) lease.expiresAt = expiresAt;
    },
  };
  const tasks: TaskContext = {
    access,
    models,
    queue: extra.queue ?? new MemoryQueue(),
    leases,
    neighbours: async (imageId) =>
      (data.tables.ImageNeighbour ?? []).filter(
        (n) => n.image1Id === imageId || n.image2Id === imageId,
      ) as { image1Id: string; image2Id: string }[],
  };
  return {
    access,
    models,
    tasks,
    launches: extra.launches ?? {
      readJson: async () => ({}),
      writeJson: async () => '',
      remove: async () => {},
      projectsOf: async () => new Map(),
      imagesOf: async () => new Map(),
      dispatchTargets: async () => null,
    },
    queues: {
      recordObservation: async () => 1,
      touch: async () => true,
    },
    update: (model, input) => data.update(model, input),
  };
}
