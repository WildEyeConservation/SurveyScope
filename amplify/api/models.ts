import { DATA_CHANNELS } from '../../shared/dataChannels';
import type { Access } from './access';
import { badRequest, forbidden } from './errors';
import type { Row, SchemaInfo } from './schema';

export interface Scope {
  projectId?: string;
  organizationId?: string;
  shareId?: string;
}

export interface RuleContext {
  access: Access;
  models: Models;
}

type Verdict = boolean | undefined;

export type Rule =
  | { survey: 'admin' | 'member' }
  | { organization: 'admin' | 'member' }
  | { self: string }
  | { results: { survey: string; set: string } }
  | { all: Rule[] }
  | {
      check: (
        ctx: RuleContext,
        row: Row,
        scope: Scope | null,
      ) => Verdict | Promise<Verdict>;
      fields?: string[];
    };

export type ScopeSpec =
  | { survey: string }
  | { organization: string }
  | { share: string }
  | { parent: string }
  | { global: true };

export interface ModelPolicy {
  scope: ScopeSpec;
  read?: Rule[];
  create?: Rule[];
  update?: Rule[];
  delete?: Rule[];
  managed?: string[];
  // onCreate also checks fields a new row sets; no rules leaves them to sysadmins.
  restricted?: { fields: string[]; rules: Rule[]; onCreate?: boolean }[];
  scan?: boolean;
  // References that may point outside the row's scope; the rules must vouch for them.
  crossScope?: string[];
  // A Lambda the AppSync pipeline runs before writes, which must answer true.
  guard?: string;
  // Set to the caller on create, as sub::username, and never changed by them.
  owner?: string;
}

export type WriteGuard = (
  fn: string,
  fieldName: string,
  input: Row,
) => Promise<boolean>;

export interface QueryOptions {
  selectionSet?: string[];
  filter?: unknown;
  limit?: number;
  nextToken?: string | null;
  sortDirection?: 'ASC' | 'DESC';
}

export interface Result<T = unknown> {
  data: T;
  nextToken?: string | null;
  errors?: unknown[];
}

export interface DataLayer {
  get(
    model: string,
    key: Row,
    options: QueryOptions,
  ): Promise<Result<Row | null>>;
  list(model: string, options: QueryOptions): Promise<Result<Row[]>>;
  query(
    model: string,
    field: string,
    input: Row,
    options: QueryOptions,
  ): Promise<Result<Row[]>>;
  create(
    model: string,
    input: Row,
    options: QueryOptions,
  ): Promise<Result<Row | null>>;
  update(
    model: string,
    input: Row,
    options: QueryOptions,
  ): Promise<Result<Row | null>>;
  delete(
    model: string,
    key: Row,
    options: QueryOptions,
  ): Promise<Result<Row | null>>;
}

type Action = 'read' | 'create' | 'update' | 'delete';

const MANAGED = ['group', 'updatedAt', '__typename'];
const isScalar = (v: unknown): v is string | number =>
  (typeof v === 'string' && v !== '') || typeof v === 'number';
const isObject = (v: unknown): v is Row =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const sameValue = (a: unknown, b: unknown) =>
  a === b ||
  (typeof a === 'object' &&
    typeof b === 'object' &&
    JSON.stringify(a) === JSON.stringify(b));

export function eqPins(filter: unknown): Row {
  const pins: Row = {};
  const visit = (f: unknown) => {
    if (!isObject(f)) return;
    for (const [key, value] of Object.entries(f)) {
      if (key === 'and' && Array.isArray(value)) value.forEach(visit);
      else if (
        key !== 'or' &&
        key !== 'not' &&
        isObject(value) &&
        isScalar(value.eq)
      ) {
        pins[key] = value.eq;
      }
    }
  };
  visit(filter);
  return pins;
}

function sanitizeOptions(raw: unknown): QueryOptions {
  if (raw === undefined || raw === null) return {};
  if (!isObject(raw)) throw badRequest('Invalid options');
  const options: QueryOptions = {};
  if (raw.selectionSet !== undefined) {
    if (
      !Array.isArray(raw.selectionSet) ||
      !raw.selectionSet.every((s) => typeof s === 'string')
    ) {
      throw badRequest('Invalid selectionSet');
    }
    options.selectionSet = raw.selectionSet as string[];
  }
  if (raw.filter !== undefined) options.filter = raw.filter;
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== 'number') throw badRequest('Invalid limit');
    options.limit = raw.limit;
  }
  if (raw.nextToken !== undefined && raw.nextToken !== null) {
    if (typeof raw.nextToken !== 'string')
      throw badRequest('Invalid nextToken');
    options.nextToken = raw.nextToken;
  }
  if (raw.sortDirection === 'ASC' || raw.sortDirection === 'DESC') {
    options.sortDirection = raw.sortDirection;
  }
  return options;
}

export class Models {
  private readonly rows = new Map<string, Promise<Row | null>>();

  constructor(
    readonly access: Access,
    private readonly data: DataLayer,
    private readonly schema: SchemaInfo,
    private readonly policies: Record<string, ModelPolicy>,
    private readonly guard?: WriteGuard,
  ) {}

  private async guarded(
    model: string,
    op: 'create' | 'update' | 'delete',
    input: Row,
  ) {
    const fn = this.policy(model).guard;
    if (!fn) return;
    if (!this.guard || !(await this.guard(fn, `${op}${model}`, input)))
      throw forbidden();
  }

  policy(model: string): ModelPolicy {
    const policy = this.policies[model];
    if (!policy || !this.schema.hasModel(model))
      throw forbidden(`${model} is not available`);
    return policy;
  }

  async run(model: string, op: string, args: unknown[]): Promise<Result> {
    const policy = this.policy(model);
    switch (op) {
      case 'get':
        return this.get(model, policy, args[0], sanitizeOptions(args[1]));
      case 'list':
        return this.list(model, sanitizeOptions(args[0]));
      case 'create':
        return this.create(model, args[0], sanitizeOptions(args[1]));
      case 'update':
        return this.update(model, args[0], sanitizeOptions(args[1]));
      case 'delete':
        return this.remove(model, args[0], sanitizeOptions(args[1]));
      default:
        if (this.schema.indexFields(model, op)) {
          return this.query(model, op, args[0], sanitizeOptions(args[1]));
        }
        throw badRequest(`Unknown operation ${model}.${op}`);
    }
  }

  async load(model: string, key: Row): Promise<Row | null> {
    const cacheKey = `${model}:${JSON.stringify(key)}`;
    if (!this.rows.has(cacheKey)) {
      this.rows.set(
        cacheKey,
        this.data.get(model, key, {}).then((result) => {
          if (result.errors?.length && !result.data) {
            throw new Error(
              `Could not read ${model}: ${JSON.stringify(result.errors)}`,
            );
          }
          return result.data;
        }),
      );
    }
    return this.rows.get(cacheKey)!;
  }

  private scopeSpec(model: string): ScopeSpec | undefined {
    const policy = this.policies[model];
    if (policy) return policy.scope;
    if (!this.schema.hasModel(model)) return undefined;
    for (const field of ['projectId', 'surveyId']) {
      if (this.schema.hasField(model, field)) return { survey: field };
    }
    if (this.schema.hasField(model, 'organizationId'))
      return { organization: 'organizationId' };
    if (this.schema.hasField(model, 'shareId')) return { share: 'shareId' };
    return undefined;
  }

  async scopeOf(model: string, row: Row, depth = 0): Promise<Scope | null> {
    const spec = this.scopeSpec(model);
    if (!spec) return null;
    if ('global' in spec) return {};
    if ('survey' in spec && isScalar(row[spec.survey])) {
      const scope: Scope = { projectId: String(row[spec.survey]) };
      if (spec.survey !== 'organizationId' && isScalar(row.organizationId)) {
        scope.organizationId = String(row.organizationId);
      }
      return scope;
    }
    if ('organization' in spec && isScalar(row[spec.organization])) {
      return { organizationId: String(row[spec.organization]) };
    }
    if ('share' in spec && isScalar(row[spec.share])) {
      return { shareId: String(row[spec.share]) };
    }
    if (depth > 3) return null;
    const preferred = 'parent' in spec ? [spec.parent] : [];
    const candidates = [
      ...preferred,
      ...this.schema.belongsTo(model).flatMap((r) => r.targetNames),
    ];
    for (const field of candidates) {
      if (!isScalar(row[field])) continue;
      const relation = this.schema.belongsToByField(model, field);
      if (!relation || !this.scopeSpec(relation.model)) continue;
      const [pk] = this.schema.primaryKey(relation.model);
      const parent = await this.load(relation.model, { [pk]: row[field] });
      if (!parent) return null;
      return this.scopeOf(relation.model, parent, depth + 1);
    }
    return null;
  }

  private async evaluate(
    rule: Rule,
    row: Row,
    scope: Scope | null,
  ): Promise<Verdict> {
    const access = this.access;
    if ('survey' in rule) {
      if (!scope?.projectId) return undefined;
      const standing = await access.surveyStanding(scope.projectId);
      return rule.survey === 'admin'
        ? standing?.role === 'admin'
        : Boolean(standing);
    }
    if ('organization' in rule) {
      const organizationId =
        scope?.organizationId ??
        (scope?.projectId
          ? await access.organizationOfProject(scope.projectId)
          : null);
      if (!organizationId) return undefined;
      const role = await access.organizationRole(organizationId);
      return rule.organization === 'admin' ? role === 'admin' : Boolean(role);
    }
    if ('self' in rule) {
      if (row[rule.self] === undefined) return undefined;
      return access.isSelf(row[rule.self]);
    }
    if ('results' in rule) {
      const survey = row[rule.results.survey];
      const set = row[rule.results.set];
      if (!isScalar(survey) || !isScalar(set)) return undefined;
      return access.canReadResults(String(survey), String(set));
    }
    if ('all' in rule) {
      const verdicts = await Promise.all(
        rule.all.map((r) => this.evaluate(r, row, scope)),
      );
      if (verdicts.some((v) => v === false)) return false;
      return verdicts.every((v) => v === true) ? true : undefined;
    }
    return rule.check({ access, models: this }, row, scope);
  }

  // Query prechecks defer row-dependent rules until results are available.
  async allows(
    model: string,
    action: Action,
    row: Row,
    strict = true,
  ): Promise<boolean> {
    if (this.access.isSysadmin) return true;
    const rules = this.policy(model)[action] ?? [];
    if (rules.length === 0) return false;
    const scope = await this.scopeOf(model, row);
    const verdicts: Verdict[] = [];
    for (const rule of rules) {
      const verdict = await this.evaluate(rule, row, scope);
      if (verdict === true) return true;
      verdicts.push(verdict);
    }
    if (strict || !verdicts.includes(undefined) || !scope) return false;
    if (scope.projectId) {
      if (await this.access.surveyStanding(scope.projectId)) return true;
      return (await this.access.resultsSets(scope.projectId)).length > 0;
    }
    if (scope.organizationId) {
      return Boolean(await this.access.organizationRole(scope.organizationId));
    }
    if (scope.shareId) return this.access.reviewsShare(scope.shareId);
    return false;
  }

  private ruleFields(rules: Rule[] = []): string[] {
    return rules.flatMap((rule) => {
      if ('self' in rule) return [rule.self];
      if ('results' in rule) return [rule.results.survey, rule.results.set];
      if ('all' in rule) return this.ruleFields(rule.all);
      if ('check' in rule) return rule.fields ?? [];
      return [];
    });
  }

  private requiredFields(model: string): string[] {
    const policy = this.policy(model);
    const spec = policy.scope as Record<string, unknown>;
    const fields = new Set<string>(this.schema.primaryKey(model));
    for (const key of ['survey', 'organization', 'share', 'parent']) {
      if (typeof spec[key] === 'string') fields.add(spec[key] as string);
    }
    if (this.schema.hasField(model, 'organizationId'))
      fields.add('organizationId');
    for (const field of this.ruleFields(policy.read)) fields.add(field);
    return [...fields].filter((f) => this.schema.hasField(model, f));
  }

  private prepareSelection(
    model: string,
    selection?: string[],
  ): string[] | undefined {
    if (!selection) return undefined;
    const out = new Set<string>();
    const nested = new Map<string, string>();
    for (const path of selection) {
      const segments = path.split('.');
      let current = model;
      let prefix = '';
      for (let i = 0; i < segments.length - 1; i++) {
        const relation = this.schema.relation(current, segments[i]);
        if (!relation || !this.policies[relation.model]?.read?.length) {
          throw forbidden(`Selection ${path} is not available`);
        }
        prefix = prefix ? `${prefix}.${segments[i]}` : segments[i];
        current = relation.model;
        nested.set(prefix, current);
      }
      const last = segments[segments.length - 1];
      if (last !== '*' && this.schema.relation(current, last)) {
        throw badRequest(`Select fields of ${path}, not the relation`);
      }
      out.add(path);
    }
    for (const field of this.requiredFields(model)) {
      if (!out.has('*')) out.add(field);
    }
    for (const [prefix, nestedModel] of nested) {
      if (out.has(`${prefix}.*`)) continue;
      for (const field of this.requiredFields(nestedModel))
        out.add(`${prefix}.${field}`);
    }
    return [...out];
  }

  private async filterNested(model: string, row: Row): Promise<Row> {
    const out: Row = { ...row };
    for (const [field, value] of Object.entries(row)) {
      const relation = this.schema.relation(model, field);
      if (!relation || value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        const kept = await this.readable(
          relation.model,
          value.filter(isObject),
        );
        out[field] = await Promise.all(
          kept.map((r) => this.filterNested(relation.model, r)),
        );
      } else if (isObject(value)) {
        out[field] = (await this.allows(relation.model, 'read', value))
          ? await this.filterNested(relation.model, value)
          : null;
      }
    }
    return out;
  }

  private async readable(model: string, rows: Row[]): Promise<Row[]> {
    const verdicts = await Promise.all(
      rows.map((row) => this.allows(model, 'read', row)),
    );
    return rows.filter((_, i) => verdicts[i]);
  }

  private async present(model: string, rows: Row[]): Promise<Row[]> {
    const kept = await this.readable(model, rows);
    return Promise.all(kept.map((row) => this.filterNested(model, row)));
  }

  private async get(
    model: string,
    policy: ModelPolicy,
    key: unknown,
    options: QueryOptions,
  ) {
    if (!isObject(key)) throw badRequest('Invalid key');
    if (!policy.read?.length && !this.access.isSysadmin) throw forbidden();
    const result = await this.data.get(model, key, {
      selectionSet: this.prepareSelection(model, options.selectionSet),
    });
    if (!result.data) return result;
    if (!(await this.allows(model, 'read', result.data))) throw forbidden();
    return { ...result, data: await this.filterNested(model, result.data) };
  }

  private async list(model: string, options: QueryOptions) {
    const pins = eqPins(options.filter);
    const scoped = await this.allows(model, 'read', pins, false);
    if (!scoped && !(this.policy(model).scan && Object.keys(pins).length === 0))
      throw forbidden();
    const result = await this.data.list(model, {
      ...options,
      selectionSet: this.prepareSelection(model, options.selectionSet),
    });
    return { ...result, data: await this.present(model, result.data ?? []) };
  }

  private async query(
    model: string,
    field: string,
    input: unknown,
    options: QueryOptions,
  ) {
    if (!isObject(input)) throw badRequest('Invalid query input');
    const pins: Row = { ...eqPins(options.filter) };
    for (const [key, value] of Object.entries(input)) {
      if (isScalar(value)) pins[key] = value;
      else if (isObject(value) && isScalar(value.eq)) pins[key] = value.eq;
    }
    // A key that names no scope cannot be refused up front; its rows are filtered.
    const allowed = await this.allows(model, 'read', pins, false);
    if (!allowed && (await this.scopeOf(model, pins))) throw forbidden();
    const result = await this.data.query(model, field, input, {
      ...options,
      selectionSet: this.prepareSelection(model, options.selectionSet),
    });
    return { ...result, data: await this.present(model, result.data ?? []) };
  }

  private writable(model: string, input: Row): Row {
    const policy = this.policy(model);
    const out: Row = { ...input };
    for (const field of [
      ...MANAGED,
      ...(policy.managed ?? []),
      ...(policy.owner ? [policy.owner] : []),
    ]) {
      delete out[field];
    }
    return out;
  }

  private async groupFor(scope: Scope): Promise<string | undefined> {
    if (scope.shareId) return `chainshare-${scope.shareId}`;
    if (scope.organizationId) return scope.organizationId;
    if (scope.projectId)
      return (
        (await this.access.organizationOfProject(scope.projectId)) ?? undefined
      );
    return undefined;
  }

  private sameScope(a: Scope | null, b: Scope | null) {
    return (
      (a?.projectId ?? null) === (b?.projectId ?? null) &&
      (a?.shareId ?? null) === (b?.shareId ?? null) &&
      (a?.organizationId ?? null) === (b?.organizationId ?? null)
    );
  }

  private async assertReferences(
    model: string,
    row: Row,
    scope: Scope | null,
    fields?: string[],
  ) {
    for (const relation of this.schema.belongsTo(model)) {
      const [fk] = relation.targetNames;
      if (relation.targetNames.length !== 1 || !isScalar(row[fk])) continue;
      if (fields && !fields.includes(fk)) continue;
      if (this.policies[model]?.crossScope?.includes(fk)) continue;
      if (!this.scopeSpec(relation.model)) continue;
      const [pk] = this.schema.primaryKey(relation.model);
      const parent = await this.load(relation.model, { [pk]: row[fk] });
      if (!parent) continue;
      const parentScope = await this.scopeOf(relation.model, parent);
      if (parentScope && !(await this.covers(scope, parentScope))) {
        throw forbidden(`${fk} belongs to another scope`);
      }
    }
  }

  private async covers(scope: Scope | null, other: Scope) {
    if (!scope) return false;
    if (other.projectId) {
      if (scope.projectId) return other.projectId === scope.projectId;
      return (
        Boolean(scope.organizationId) &&
        (await this.access.organizationOfProject(other.projectId)) ===
          scope.organizationId
      );
    }
    if (other.shareId) return other.shareId === scope.shareId;
    if (other.organizationId) {
      const organizationId =
        scope.organizationId ??
        (scope.projectId
          ? await this.access.organizationOfProject(scope.projectId)
          : null);
      return other.organizationId === organizationId;
    }
    return true;
  }

  private async assertRestricted(
    model: string,
    touched: string[],
    row: Row,
    scope: Scope | null,
    creating = false,
  ) {
    if (this.access.isSysadmin) return;
    for (const { fields, rules, onCreate } of this.policy(model).restricted ??
      []) {
      if (creating && !onCreate) continue;
      if (!fields.some((f) => touched.includes(f))) continue;
      const verdicts = await Promise.all(
        rules.map((r) => this.evaluate(r, row, scope)),
      );
      if (!verdicts.includes(true))
        throw forbidden(
          `Not allowed to ${creating ? 'set' : 'change'} ${fields.join(', ')}`,
        );
    }
  }

  private async create(model: string, input: unknown, options: QueryOptions) {
    if (!isObject(input)) throw badRequest('Invalid input');
    const row = this.writable(model, input);
    const owner = this.policy(model).owner;
    if (owner)
      row[owner] = `${this.access.actor.sub}::${this.access.actor.username}`;
    const scope = await this.scopeOf(model, row);
    if (!scope) throw badRequest(`${model} needs a scope`);
    if (!(await this.allows(model, 'create', row))) throw forbidden();
    const set = Object.keys(row).filter(
      (f) => row[f] !== undefined && row[f] !== null,
    );
    await this.assertRestricted(model, set, row, scope, true);
    await this.assertReferences(model, row, scope);
    if (this.schema.hasField(model, 'group')) {
      const group = await this.groupFor(scope);
      if (group) row.group = group;
    }
    await this.guarded(model, 'create', row);
    const result = await this.data.create(model, row, {
      selectionSet: this.prepareSelection(model, options.selectionSet),
    });
    return result.data
      ? { ...result, data: await this.filterNested(model, result.data) }
      : result;
  }

  private keyOf(model: string, input: Row): Row {
    const key: Row = {};
    for (const field of this.schema.primaryKey(model)) {
      if (!isScalar(input[field])) throw badRequest(`Missing ${field}`);
      key[field] = input[field];
    }
    return key;
  }

  private missing(model: string): Result {
    return {
      data: null,
      errors: [
        {
          errorType: 'DynamoDB:ConditionalCheckFailedException',
          message: `The ${model} does not exist`,
        },
      ],
    };
  }

  private async update(model: string, input: unknown, options: QueryOptions) {
    if (!isObject(input)) throw badRequest('Invalid input');
    const key = this.keyOf(model, input);
    const existing = (await this.data.get(model, key, {})).data;
    if (!existing) return this.missing(model);
    if (!(await this.allows(model, 'update', existing))) throw forbidden();
    const changes = this.writable(model, input);
    const merged = { ...existing, ...changes };
    const before = await this.scopeOf(model, existing);
    const after = await this.scopeOf(model, merged);
    if (!this.sameScope(before, after))
      throw forbidden('A row cannot move to another scope');
    if (!(await this.allows(model, 'update', merged))) throw forbidden();
    const changed = Object.keys(changes).filter(
      (f) => !sameValue(changes[f], existing[f]),
    );
    await this.assertRestricted(model, changed, existing, before);
    await this.assertReferences(model, merged, after, changed);
    await this.guarded(model, 'update', changes);
    const result = await this.data.update(model, changes, {
      selectionSet: this.prepareSelection(model, options.selectionSet),
    });
    return result.data
      ? { ...result, data: await this.filterNested(model, result.data) }
      : result;
  }

  private async remove(model: string, input: unknown, options: QueryOptions) {
    if (!isObject(input)) throw badRequest('Invalid input');
    const key = this.keyOf(model, input);
    const existing = (await this.data.get(model, key, {})).data;
    if (!existing) return this.missing(model);
    if (!(await this.allows(model, 'delete', existing))) throw forbidden();
    await this.guarded(model, 'delete', key);
    const result = await this.data.delete(model, key, {
      selectionSet: this.prepareSelection(model, options.selectionSet),
    });
    return result.data
      ? { ...result, data: await this.filterNested(model, result.data) }
      : result;
  }

  async canSubscribe(model: string, field: string, value: string) {
    const channels = DATA_CHANNELS[model] ?? [];
    this.policy(model);
    if (field === 'all' && value === 'all')
      return channels.includes('*') && this.access.isSysadmin;
    if (!channels.includes(field)) return false;
    return this.allows(model, 'read', { [field]: value });
  }
}
