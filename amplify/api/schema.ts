import { FOREIGN_KEYS } from './foreignKeys';

export type Row = Record<string, unknown>;

interface FieldInfo {
  name: string;
  type: unknown;
  isArray?: boolean;
  isRequired?: boolean;
  association?: {
    connectionType: 'BELONGS_TO' | 'HAS_MANY' | 'HAS_ONE';
    targetNames?: string[];
    associatedWith?: string[];
  };
}

interface ModelInfo {
  name: string;
  fields: Record<string, FieldInfo>;
  attributes?: { type: string; properties?: Record<string, unknown> }[];
  primaryKeyInfo: { primaryKeyFieldName: string; sortKeyFieldNames?: string[] };
}

export interface Introspection {
  models: Record<string, ModelInfo>;
}

export interface Relation {
  name: string;
  model: string;
  kind: 'BELONGS_TO' | 'HAS_MANY' | 'HAS_ONE';
  targetNames: string[];
}

export class SchemaInfo {
  constructor(
    private readonly introspection: Introspection,
    private readonly foreignKeys: Record<
      string,
      Record<string, string>
    > = FOREIGN_KEYS,
  ) {}

  model(name: string) {
    if (!Object.hasOwn(this.introspection.models, name))
      throw new Error(`Unknown model ${name}`);
    return this.introspection.models[name];
  }

  hasModel(name: string) {
    return Object.hasOwn(this.introspection.models, name);
  }

  hasField(model: string, field: string) {
    return Object.hasOwn(this.model(model).fields, field);
  }

  isRequired(model: string, field: string) {
    return (
      this.hasField(model, field) &&
      Boolean(this.model(model).fields[field].isRequired)
    );
  }

  primaryKey(model: string) {
    const info = this.model(model).primaryKeyInfo;
    return [info.primaryKeyFieldName, ...(info.sortKeyFieldNames ?? [])];
  }

  relation(model: string, field: string): Relation | undefined {
    const info = this.hasField(model, field)
      ? this.model(model).fields[field]
      : undefined;
    const association = info?.association;
    const type = info?.type as { model?: string } | undefined;
    if (!association || !type?.model) return undefined;
    return {
      name: field,
      model: type.model,
      kind: association.connectionType,
      targetNames: association.targetNames ?? [],
    };
  }

  belongsTo(model: string): Relation[] {
    const relations = Object.keys(this.model(model).fields)
      .map((field) => this.relation(model, field))
      .filter(
        (r): r is Relation =>
          r?.kind === 'BELONGS_TO' && r.targetNames.length === 1,
      );
    const keys = Object.hasOwn(this.foreignKeys, model)
      ? this.foreignKeys[model]
      : {};
    for (const [fk, target] of Object.entries(keys)) {
      if (!this.hasModel(target) || !this.hasField(model, fk)) continue;
      if (relations.some((r) => r.targetNames[0] === fk)) continue;
      relations.push({
        name: fk,
        model: target,
        kind: 'BELONGS_TO',
        targetNames: [fk],
      });
    }
    return relations;
  }

  belongsToByField(model: string, fkField: string): Relation | undefined {
    return this.belongsTo(model).find((r) => r.targetNames[0] === fkField);
  }

  indexFields(model: string, queryField: string): string[] | undefined {
    for (const attribute of this.model(model).attributes ?? []) {
      if (attribute.type !== 'key') continue;
      const props = attribute.properties as {
        queryField?: string;
        fields?: string[];
      };
      if (props.queryField === queryField) return props.fields;
    }
    return undefined;
  }
}
