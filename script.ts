#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

/* -------------------------------------------------------------------------- */
/*                               Type Definitions                             */
/* -------------------------------------------------------------------------- */
type TypeReference =
  | string
  | {
      enum?: string;
      model?: string;
      nonModel?: string;
      input?: string;
      customType?: string;
    };

interface FieldDefinition {
  name: string;
  type: TypeReference;
  isArray?: boolean;
  isArrayNullable?: boolean;
  isRequired?: boolean;
  isReadOnly?: boolean;
  association?: Record<string, unknown> | null;
}

interface ModelDefinition {
  name: string;
  fields: Record<string, FieldDefinition>;
  attributes?: Array<Record<string, any>>;
  primaryKeyInfo?: {
    primaryKeyFieldName: string;
    sortKeyFieldNames?: string[];
    isCustomPrimaryKey?: boolean;
  };
}

interface EnumDefinition {
  name: string;
  values: string[];
}

interface NonModelDefinition {
  name: string;
  fields: Record<string, FieldDefinition>;
}

interface InputDefinition {
  name: string;
  attributes: Record<string, FieldDefinition>;
}

interface OperationDefinition {
  name: string;
  isArray?: boolean;
  isRequired?: boolean;
  type: TypeReference;
  arguments?: Record<string, FieldDefinition>;
}

interface IntrospectionData {
  models: Record<string, ModelDefinition>;
  enums: Record<string, EnumDefinition>;
  nonModels: Record<string, NonModelDefinition>;
  inputs?: Record<string, InputDefinition>;
  queries?: Record<string, OperationDefinition>;
  mutations?: Record<string, OperationDefinition>;
  subscriptions?: Record<string, OperationDefinition>;
}

/* -------------------------------------------------------------------------- */
/*                               File Resolution                               */
/* -------------------------------------------------------------------------- */
const projectRoot = process.cwd();
const amplifyOutputsPath = path.join(projectRoot, 'amplify_outputs.json');
const typesOutputPath = path.join(projectRoot, 'amplify', 'shared', 'types.ts');
const schemaOutputPath = path.join(
  projectRoot,
  'amplify',
  'shared',
  'data-schema.generated.ts'
);

if (!fs.existsSync(amplifyOutputsPath)) {
  throw new Error(
    `Could not locate amplify_outputs.json at ${amplifyOutputsPath}. Run 'npm run config' first.`
  );
}

const amplifyOutputs = JSON.parse(
  fs.readFileSync(amplifyOutputsPath, 'utf-8')
) as { data?: { model_introspection?: IntrospectionData } };
const introspection = amplifyOutputs.data?.model_introspection;

if (!introspection) {
  throw new Error(
    'amplify_outputs.json is missing data.model_introspection. Run `npm run config` to refresh Amplify outputs.'
  );
}

// Extend the checked-in schema locally to keep generation deterministic.
const scalarField = (
  name: string,
  type: string,
  isRequired = false,
  extra: Partial<FieldDefinition> = {}
): FieldDefinition => ({
  name,
  type,
  isRequired,
  ...extra
});
const modelField = (
  name: string,
  model: string,
  association: Record<string, unknown>,
  isArray = false
): FieldDefinition => ({
  name,
  type: { model },
  isArray,
  isArrayNullable: isArray,
  isRequired: false,
  association
});
const timestamps = {
  createdAt: scalarField('createdAt', 'AWSDateTime', false, {
    isReadOnly: true
  }),
  updatedAt: scalarField('updatedAt', 'AWSDateTime', false, {
    isReadOnly: true
  })
};
const indexAttribute = (queryField: string, fields: string[]) => ({
  type: 'key',
  properties: { name: queryField, queryField, fields }
});

introspection.models.Annotation.fields.infoTaggedBy = scalarField(
  'infoTaggedBy',
  'String'
);
introspection.models.Annotation.fields.infoTagRevision = scalarField('infoTagRevision', 'Int');
introspection.models.Annotation.fields.infoTags = modelField(
  'infoTags',
  'AnnotationInfoTag',
  { connectionType: 'HAS_MANY', associatedWith: ['annotationId'] },
  true
);
introspection.models.AnnotationSet.fields.infoTags = modelField(
  'infoTags',
  'InfoTag',
  { connectionType: 'HAS_MANY', associatedWith: ['annotationSetId'] },
  true
);
introspection.models.SharedChainAnnotation.fields.infoTags = scalarField(
  'infoTags',
  'String',
  false,
  { isArray: true, isArrayNullable: true }
);

introspection.models.InfoTag = {
  name: 'InfoTag',
  fields: {
    id: scalarField('id', 'ID', true),
    projectId: scalarField('projectId', 'ID', true),
    annotationSetId: scalarField('annotationSetId', 'ID', true),
    annotationSet: modelField('annotationSet', 'AnnotationSet', {
      connectionType: 'BELONGS_TO',
      targetNames: ['annotationSetId']
    }),
    name: scalarField('name', 'String', true),
    color: scalarField('color', 'String'),
    shortcutKey: scalarField('shortcutKey', 'String'),
    annotations: modelField(
      'annotations',
      'AnnotationInfoTag',
      { connectionType: 'HAS_MANY', associatedWith: ['infoTagId'] },
      true
    ),
    group: scalarField('group', 'String'),
    ...timestamps
  },
  attributes: [
    { type: 'model', properties: {} },
    indexAttribute('infoTagsByAnnotationSetId', ['annotationSetId']),
    indexAttribute('infoTagsByProjectId', ['projectId'])
  ],
  primaryKeyInfo: {
    primaryKeyFieldName: 'id',
    sortKeyFieldNames: [],
    isCustomPrimaryKey: false
  }
};

introspection.models.AnnotationInfoTag = {
  name: 'AnnotationInfoTag',
  fields: {
    annotationId: scalarField('annotationId', 'ID', true),
    annotation: modelField('annotation', 'Annotation', {
      connectionType: 'BELONGS_TO',
      targetNames: ['annotationId']
    }),
    infoTagId: scalarField('infoTagId', 'ID', true),
    infoTag: modelField('infoTag', 'InfoTag', {
      connectionType: 'BELONGS_TO',
      targetNames: ['infoTagId']
    }),
    annotationSetId: scalarField('annotationSetId', 'ID', true),
    projectId: scalarField('projectId', 'ID', true),
    group: scalarField('group', 'String'),
    ...timestamps
  },
  attributes: [
    { type: 'model', properties: {} },
    indexAttribute('annotationInfoTagsByInfoTagId', ['infoTagId']),
    indexAttribute('annotationInfoTagsByAnnotationSetId', ['annotationSetId'])
  ],
  primaryKeyInfo: {
    primaryKeyFieldName: 'annotationId',
    sortKeyFieldNames: ['infoTagId'],
    isCustomPrimaryKey: true
  }
};

introspection.mutations = introspection.mutations ?? {};
introspection.mutations.launchInfoTags = {
  name: 'launchInfoTags',
  isArray: false,
  type: 'AWSJSON',
  isRequired: false,
  arguments: {
    request: scalarField('request', 'String', true)
  }
};
introspection.mutations.infoTagWork = {
  name: 'infoTagWork', isArray: false, type: 'AWSJSON', isRequired: false,
  arguments: { request: scalarField('request', 'String', true) },
};

/* -------------------------------------------------------------------------- */
/*                                    Utils                                   */
/* -------------------------------------------------------------------------- */
const scalarMap: Record<string, string> = {
  ID: 'string',
  String: 'string',
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean',
  AWSDateTime: 'string',
  AWSDate: 'string',
  AWSTime: 'string',
  AWSTimestamp: 'number',
  AWSEmail: 'string',
  AWSURL: 'string',
  AWSPhone: 'string',
  AWSIPAddress: 'string',
  AWSJSON: 'any'
};

const READONLY_FIELD_NAMES = new Set(['createdat', 'updatedat']);

const SINGLE_INDENT = '  ';

function indent(text: string, depth = 1): string {
  if (!text) {
    return '';
  }
  const padding = SINGLE_INDENT.repeat(depth);
  return text
    .split('\n')
    .map((line) => (line ? padding + line : line))
    .join('\n');
}

function sortKeys<T>(record: Record<string, T> | undefined): string[] {
  return record ? Object.keys(record).sort((a, b) => a.localeCompare(b)) : [];
}

function addNullUnion(type: string): string {
  return type.includes('null') ? type : `${type} | null`;
}

type TypeReferenceMode = 'local' | 'namespaced';

function resolveTypeName(
  reference: TypeReference,
  mode: TypeReferenceMode = 'local'
): string {
  const qualify = (name: string) =>
    mode === 'namespaced' ? `SchemaTypes.${name}` : name;
  if (typeof reference === 'string') {
    return scalarMap[reference] ?? 'any';
  }

  if (reference.enum) {
    return qualify(reference.enum);
  }
  if (reference.model) {
    return qualify(reference.model);
  }
  if (reference.nonModel) {
    return qualify(reference.nonModel);
  }
  if (reference.input) {
    return qualify(reference.input);
  }
  if (reference.customType) {
    return qualify(reference.customType);
  }

  return 'any';
}

interface FieldTypingOptions {
  forceOptional?: boolean;
  treatAsInput?: boolean;
  mode?: TypeReferenceMode;
}

function getFieldTyping(
  field: FieldDefinition,
  options: FieldTypingOptions = {}
): { type: string; optional: boolean } {
  const baseType = resolveTypeName(field.type, options.mode);
  const isArray = Boolean(field.isArray);
  const isRequired = Boolean(field.isRequired);
  let type = baseType;

  if (isArray) {
    type = `${baseType}[]`;
    if (field.isArrayNullable || !isRequired || options.forceOptional) {
      type = addNullUnion(type);
    }
  } else if (!isRequired || options.forceOptional) {
    type = addNullUnion(baseType);
  }

  if (options.treatAsInput && !isRequired) {
    type = addNullUnion(type);
  }

  return {
    type,
    optional: options.forceOptional ? true : !isRequired
  };
}

function getPrimaryKeyFields(model: ModelDefinition): string[] {
  const primary = model.primaryKeyInfo;
  if (!primary) {
    return ['id'];
  }
  const sortKeys = primary.sortKeyFieldNames ?? [];
  return [primary.primaryKeyFieldName, ...sortKeys];
}

function shouldIncludeFieldInInput(field: FieldDefinition): boolean {
  return !field.association;
}

function buildObjectType(
  fields: Array<[string, FieldDefinition]>,
  options: FieldTypingOptions = {}
): string {
  if (!fields.length) {
    return '{}';
  }

  const lines: string[] = ['{'];

  for (const [fieldName, field] of fields) {
    const { type, optional } = getFieldTyping(field, options);
    lines.push(
      `${SINGLE_INDENT}${fieldName}${optional ? '?' : ''}: ${type};`
    );
  }

  lines.push('}');
  return lines.join('\n');
}

function toPascalCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_\s]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
}

/* -------------------------------------------------------------------------- */
/*                          Types File (types.ts)                             */
/* -------------------------------------------------------------------------- */
function buildTypesFile(intro: IntrospectionData): string {
  const lines: string[] = [];
  lines.push(
    "// Auto-generated file from scripts/generate-amplify-types.ts",
    "// Do not edit manually. Run 'npm run generate-types' to regenerate.",
    ''
  );

  const enumNames = sortKeys(intro.enums);
  if (enumNames.length) {
    lines.push('// Enums');
    for (const enumName of enumNames) {
      const definition = intro.enums[enumName];
      lines.push(`export const ${enumName} = {`);
      for (const value of definition.values) {
        const literal = JSON.stringify(value);
        lines.push(`${SINGLE_INDENT}${value}: ${literal},`);
      }
      lines.push(`} as const;`);
      lines.push(
        `export type ${enumName} = (typeof ${enumName})[keyof typeof ${enumName}];`
      );
      lines.push('');
    }
  }

  const nonModelNames = sortKeys(intro.nonModels);
  if (nonModelNames.length) {
    lines.push('// Non-Model Types');
    for (const nonModelName of nonModelNames) {
      const definition = intro.nonModels[nonModelName];
      const fieldEntries = sortKeys(definition.fields).map((name) => [
        name,
        definition.fields[name]
      ]) as Array<[string, FieldDefinition]>;

      lines.push(`export interface ${nonModelName} {`);
      for (const [fieldName, field] of fieldEntries) {
        const { type, optional } = getFieldTyping(field, { mode: 'local' });
        lines.push(
          `${SINGLE_INDENT}${fieldName}${optional ? '?' : ''}: ${type};`
        );
      }
      lines.push('}', '');
    }
  }

  const inputNames = sortKeys(intro.inputs);
  if (inputNames.length) {
    lines.push('// Input Types');
    for (const inputName of inputNames) {
      const definition = intro.inputs![inputName];
      const fieldEntries = sortKeys(definition.attributes).map((name) => [
        name,
        definition.attributes[name]
      ]) as Array<[string, FieldDefinition]>;

      lines.push(`export interface ${inputName} {`);
      for (const [fieldName, field] of fieldEntries) {
        const { type, optional } = getFieldTyping(field, {
          treatAsInput: true,
          mode: 'local'
        });
        lines.push(
          `${SINGLE_INDENT}${fieldName}${optional ? '?' : ''}: ${type};`
        );
      }
      lines.push('}', '');
    }
  }

  const modelNames = sortKeys(intro.models);
  if (modelNames.length) {
    lines.push('// Models');

    for (const modelName of modelNames) {
      const model = intro.models[modelName];
      const fieldEntries = sortKeys(model.fields).map((fieldName) => [
        fieldName,
        model.fields[fieldName]
      ]) as Array<[string, FieldDefinition]>;

      lines.push(`export interface ${modelName} {`);
      for (const [fieldName, field] of fieldEntries) {
        if (field.association) {
          lines.push(`${SINGLE_INDENT}${fieldName}?: any;`);
          continue;
        }
        const { type, optional } = getFieldTyping(field, { mode: 'local' });
        lines.push(
          `${SINGLE_INDENT}${fieldName}${optional ? '?' : ''}: ${type};`
        );
      }
      lines.push(`${SINGLE_INDENT}[key: string]: any;`);
      lines.push('}');
      lines.push('');
    }

    for (const modelName of modelNames) {
      const model = intro.models[modelName];
      const fieldEntries = sortKeys(model.fields).map((fieldName) => [
        fieldName,
        model.fields[fieldName]
      ]) as Array<[string, FieldDefinition]>;

      // Create input
      lines.push(`export interface Create${modelName}Input {`);
      const primaryFieldsForCreate = getPrimaryKeyFields(model);
      const isDefaultAutoId =
        primaryFieldsForCreate.length === 1 &&
        primaryFieldsForCreate[0] === 'id' &&
        model.primaryKeyInfo?.isCustomPrimaryKey !== true;
      for (const [fieldName, field] of fieldEntries) {
        if (!shouldIncludeFieldInInput(field)) {
          continue;
        }
        const isReadOnlyField = Boolean(field.isReadOnly) || READONLY_FIELD_NAMES.has(fieldName.toLowerCase());
        const isAutoIdField = isDefaultAutoId && fieldName === 'id';
        const { type, optional } = getFieldTyping(field, {
          mode: 'local',
          // If the model uses the default auto-generated 'id' primary key,
          // make 'id' optional for create inputs so callers don't need to supply it.
          forceOptional: isReadOnlyField || isAutoIdField
        });
        lines.push(
          `${SINGLE_INDENT}${fieldName}${optional ? '?' : ''}: ${type};`
        );
      }
      lines.push(`${SINGLE_INDENT}[key: string]: any;`);
      lines.push('}', '');

      // Update input
      lines.push(`export interface Update${modelName}Input {`);
      const primaryFields = getPrimaryKeyFields(model);
      for (const primaryField of primaryFields) {
        const fieldDefinition = model.fields[primaryField];
        const { type } = getFieldTyping(fieldDefinition, { mode: 'local' });
        lines.push(`${SINGLE_INDENT}${primaryField}: ${type.replace(' | null', '')};`);
      }
      for (const [fieldName, field] of fieldEntries) {
        if (!shouldIncludeFieldInInput(field)) {
          continue;
        }
        if (primaryFields.includes(fieldName)) {
          continue;
        }
        const { type } = getFieldTyping(field, {
          forceOptional: true,
          mode: 'local'
        });
        lines.push(`${SINGLE_INDENT}${fieldName}?: ${type};`);
      }
      lines.push(`${SINGLE_INDENT}[key: string]: any;`);
      lines.push('}', '');

      // Delete input
      lines.push(`export interface Delete${modelName}Input {`);
      const deleteFields = getPrimaryKeyFields(model);
      for (const deleteField of deleteFields) {
        const fieldDefinition = model.fields[deleteField];
        const { type } = getFieldTyping(fieldDefinition, { mode: 'local' });
        lines.push(`${SINGLE_INDENT}${deleteField}: ${type.replace(' | null', '')};`);
      }
      lines.push('}', '');
    }
  }

  // Schema map
  lines.push('export interface Schema {');
  lines.push(`${SINGLE_INDENT}models: {`);
  for (const modelName of modelNames) {
    lines.push(`${SINGLE_INDENT.repeat(2)}${modelName}: {`);
    lines.push(
      `${SINGLE_INDENT.repeat(3)}type: ${modelName};`
    );
    lines.push(
      `${SINGLE_INDENT.repeat(3)}createInput: Create${modelName}Input;`
    );
    lines.push(
      `${SINGLE_INDENT.repeat(3)}updateInput: Update${modelName}Input;`
    );
    lines.push(
      `${SINGLE_INDENT.repeat(3)}deleteInput: Delete${modelName}Input;`
    );
    lines.push(`${SINGLE_INDENT.repeat(2)}};`);
  }
  lines.push(`${SINGLE_INDENT}};`);

  lines.push(`${SINGLE_INDENT}enums: {`);
  for (const enumName of enumNames) {
    lines.push(
      `${SINGLE_INDENT.repeat(2)}${enumName}: typeof ${enumName};`
    );
  }
  lines.push(`${SINGLE_INDENT}};`);

  lines.push(`${SINGLE_INDENT}nonModels: {`);
  for (const nonModelName of nonModelNames) {
    lines.push(
      `${SINGLE_INDENT.repeat(2)}${nonModelName}: ${nonModelName};`
    );
  }
  lines.push(`${SINGLE_INDENT}};`);

  if (inputNames.length) {
    lines.push(`${SINGLE_INDENT}inputs: {`);
    for (const inputName of inputNames) {
      lines.push(
        `${SINGLE_INDENT.repeat(2)}${inputName}: ${inputName};`
      );
    }
    lines.push(`${SINGLE_INDENT}};`);
  }

  lines.push('}');

  return `${lines.join('\n')}`.replace(/\n{3,}/g, '\n\n');
}

/* -------------------------------------------------------------------------- */
/*                        Data Schema File (client types)                     */
/* -------------------------------------------------------------------------- */
function buildDataSchemaFile(intro: IntrospectionData): string {
  const modelNames = sortKeys(intro.models);
  const enumNames = sortKeys(intro.enums);
  const queryNames = sortKeys(intro.queries);
  const mutationNames = sortKeys(intro.mutations);
  const subscriptionNames = sortKeys(intro.subscriptions);

  const lines: string[] = [];
  lines.push(
    "// Auto-generated file from scripts/generate-amplify-types.ts",
    "// Do not edit manually. Run 'npm run generate-types' to regenerate.",
    '',
    "import type { Observable } from 'rxjs';",
    "import type * as SchemaTypes from './types.js';",
    ''
  );

  lines.push(
    'type FullSchema = SchemaTypes.Schema;',
    'export type Schema = FullSchema["models"];',
    'type SchemaEnums = FullSchema["enums"];',
    ''
  );

  lines.push(
    'export type ModelName = keyof Schema;',
    'type ModelType<Name extends keyof Schema> = Schema[Name]["type"];',
    'type ModelCreateInput<Name extends keyof Schema> = Schema[Name]["createInput"];',
    'type ModelUpdateInput<Name extends keyof Schema> = Schema[Name]["updateInput"];',
    'type ModelDeleteInput<Name extends keyof Schema> = Schema[Name]["deleteInput"];',
    ''
  );

  lines.push(
    'export interface GraphQLFormattedError {',
    `${SINGLE_INDENT}message: string;`,
    `${SINGLE_INDENT}errorType?: string;`,
    `${SINGLE_INDENT}errorInfo?: Record<string, unknown> | null;`,
    `${SINGLE_INDENT}path?: ReadonlyArray<string | number>;`,
    `${SINGLE_INDENT}locations?: ReadonlyArray<{ line: number; column: number }>;`,
    `${SINGLE_INDENT}extensions?: Record<string, unknown>;`,
    '}',
    ''
  );

  lines.push(
    "export type AuthMode = 'apiKey' | 'iam' | 'identityPool' | 'oidc' | 'userPool' | 'lambda' | 'none';",
    ''
  );

  lines.push(
    'export interface RequestOptions {',
    `${SINGLE_INDENT}url: string;`,
    `${SINGLE_INDENT}queryString: string;`,
    `${SINGLE_INDENT}method?: string;`,
    '}',
    ''
  );

  lines.push(
    'export type CustomHeaders =',
    `${SINGLE_INDENT}Record<string, string>`,
    `${SINGLE_INDENT}| ((request?: RequestOptions) => Promise<Record<string, string>>);`,
    ''
  );

  lines.push(
    'type SelectionSet<Model> = ReadonlyArray<Extract<keyof Model, string> | string>;',
    ''
  );

  lines.push(
    'export interface OperationOptions {',
    `${SINGLE_INDENT}authMode?: AuthMode;`,
    `${SINGLE_INDENT}authToken?: string;`,
    `${SINGLE_INDENT}headers?: CustomHeaders;`,
    '}',
    ''
  );

  lines.push(
    'export interface MutationOptions<Model> extends OperationOptions {',
    `${SINGLE_INDENT}selectionSet?: SelectionSet<Model>;`,
    '}',
    ''
  );

  lines.push(
    'export interface GetOptions<Model> extends OperationOptions {',
    `${SINGLE_INDENT}selectionSet?: SelectionSet<Model>;`,
    '}',
    ''
  );

  lines.push(
    'export type ModelSortDirection = ' + "'ASC' | 'DESC';",
    ''
  );

  lines.push(
    'export interface ListOptions<Model> extends OperationOptions {',
    `${SINGLE_INDENT}filter?: ModelFilter<Model>;`,
    `${SINGLE_INDENT}sortDirection?: ModelSortDirection;`,
    `${SINGLE_INDENT}limit?: number;`,
    `${SINGLE_INDENT}nextToken?: string | null;`,
    `${SINGLE_INDENT}selectionSet?: SelectionSet<Model>;`,
    '}',
    ''
  );

  lines.push(
    'export interface ObserveQueryOptions<Model> extends OperationOptions {',
    `${SINGLE_INDENT}filter?: ModelFilter<Model>;`,
    `${SINGLE_INDENT}selectionSet?: SelectionSet<Model>;`,
    '}',
    ''
  );

  lines.push(
    'export interface SubscriptionOptions<Model> extends OperationOptions {',
    `${SINGLE_INDENT}filter?: ModelFilter<Model>;`,
    `${SINGLE_INDENT}selectionSet?: SelectionSet<Model>;`,
    '}',
    ''
  );

  lines.push(
    'export interface CustomOperationOptions extends OperationOptions {',
    `${SINGLE_INDENT}selectionSet?: ReadonlyArray<string>;`,
    '}',
    ''
  );

  lines.push(
    'export type MutationResult<T> = Promise<{',
    `${SINGLE_INDENT}data: T | null;`,
    `${SINGLE_INDENT}errors?: GraphQLFormattedError[];`,
    `${SINGLE_INDENT}extensions?: Record<string, unknown>;`,
    '}>;',
    ''
  );

  lines.push(
    'export type ListResult<T> = Promise<{',
    `${SINGLE_INDENT}data: T[];`,
    `${SINGLE_INDENT}nextToken?: string | null;`,
    `${SINGLE_INDENT}errors?: GraphQLFormattedError[];`,
    `${SINGLE_INDENT}extensions?: Record<string, unknown>;`,
    '}>;',
    ''
  );

  lines.push(
    'export type CustomOperationResult<T> = Promise<{',
    `${SINGLE_INDENT}data: T | null;`,
    `${SINGLE_INDENT}errors?: GraphQLFormattedError[];`,
    `${SINGLE_INDENT}extensions?: Record<string, unknown>;`,
    '}>;',
    ''
  );

  lines.push(
    'export type SubscriptionResult<T> = Observable<T>;',
    'export type ObserveQueryResult<T> = Observable<{ items: T[]; isSynced: boolean }>;'
  );
  lines.push('');

  // Filter helpers
  lines.push(
    'export interface StringFilter {',
    `${SINGLE_INDENT}eq?: string | null;`,
    `${SINGLE_INDENT}ne?: string | null;`,
  `${SINGLE_INDENT}contains?: string;`,
  `${SINGLE_INDENT}notContains?: string;`,
  `${SINGLE_INDENT}beginsWith?: string;`,
  `${SINGLE_INDENT}in?: string[];`,
  `${SINGLE_INDENT}ge?: string;`,
  `${SINGLE_INDENT}gt?: string;`,
  `${SINGLE_INDENT}le?: string;`,
  `${SINGLE_INDENT}lt?: string;`,
  `${SINGLE_INDENT}between?: [string, string];`,
  `${SINGLE_INDENT}attributeExists?: boolean;`,
    '}',
    ''
  );
  lines.push(
    'export interface NumberFilter {',
    `${SINGLE_INDENT}eq?: number | null;`,
    `${SINGLE_INDENT}ne?: number | null;`,
    `${SINGLE_INDENT}le?: number;`,
    `${SINGLE_INDENT}lt?: number;`,
    `${SINGLE_INDENT}ge?: number;`,
    `${SINGLE_INDENT}gt?: number;`,
    `${SINGLE_INDENT}between?: [number, number];`,
    `${SINGLE_INDENT}attributeExists?: boolean;`,
    '}',
    ''
  );
  lines.push(
    'export interface BooleanFilter {',
    `${SINGLE_INDENT}eq?: boolean | null;`,
    `${SINGLE_INDENT}ne?: boolean | null;`,
    `${SINGLE_INDENT}attributeExists?: boolean;`,
    '}',
    ''
  );

  lines.push(
    'type FieldFilter<Value> =',
    `${SINGLE_INDENT}Value extends (infer Item)[] ? FieldFilter<Item> :`,
    `${SINGLE_INDENT}Value extends number | null | undefined ? NumberFilter :`,
    `${SINGLE_INDENT}Value extends boolean | null | undefined ? BooleanFilter :`,
    `${SINGLE_INDENT}Value extends string | null | undefined ? StringFilter :`,
    `${SINGLE_INDENT}never;`,
    ''
  );

  lines.push(
    'export type ModelFilter<Model> = {',
    `${SINGLE_INDENT}and?: ModelFilter<Model>[];`,
    `${SINGLE_INDENT}or?: ModelFilter<Model>[];`,
    `${SINGLE_INDENT}not?: ModelFilter<Model>;`,
    `} & {`,
    `${SINGLE_INDENT}[Key in keyof Model as FieldFilter<Model[Key]> extends never ? never : Key]?: FieldFilter<Model[Key]>;`,
    '};',
    ''
  );

  lines.push('export type ModelSubscriptionFilter<Model> = ModelFilter<Model>;');
  lines.push('');

  lines.push(
    'type SecondaryIndexOperations<',
    `${SINGLE_INDENT}Model,`,
    `${SINGLE_INDENT}IndexMap extends object`,
    '> = keyof IndexMap extends never',
    `${SINGLE_INDENT}? {}`,
    `${SINGLE_INDENT}: {`,
    `${SINGLE_INDENT.repeat(2)}[K in keyof IndexMap]: (`,
    `${SINGLE_INDENT.repeat(3)}input: IndexMap[K],`,
    `${SINGLE_INDENT.repeat(3)}options?: ListOptions<Model>`,
    `${SINGLE_INDENT.repeat(2)}) => ListResult<Model>;`,
    `${SINGLE_INDENT}};`,
    ''
  );

  lines.push(
    'type BaseModelOperations<Name extends keyof Schema> = {',
    `${SINGLE_INDENT}create(`,
    `${SINGLE_INDENT.repeat(2)}input: ModelCreateInput<Name>,`,
    `${SINGLE_INDENT.repeat(2)}options?: MutationOptions<ModelType<Name>>`,
    `${SINGLE_INDENT}): MutationResult<ModelType<Name>>;`,
    `${SINGLE_INDENT}update(`,
    `${SINGLE_INDENT.repeat(2)}input: ModelUpdateInput<Name>,`,
    `${SINGLE_INDENT.repeat(2)}options?: MutationOptions<ModelType<Name>>`,
    `${SINGLE_INDENT}): MutationResult<ModelType<Name>>;`,
    `${SINGLE_INDENT}delete(`,
    `${SINGLE_INDENT.repeat(2)}identifier: ModelDeleteInput<Name>,`,
    `${SINGLE_INDENT.repeat(2)}options?: MutationOptions<ModelType<Name>>`,
    `${SINGLE_INDENT}): MutationResult<ModelType<Name>>;`,
    `${SINGLE_INDENT}get(`,
    `${SINGLE_INDENT.repeat(2)}identifier: ModelDeleteInput<Name>,`,
    `${SINGLE_INDENT.repeat(2)}options?: GetOptions<ModelType<Name>>`,
    `${SINGLE_INDENT}): MutationResult<ModelType<Name>>;`,
    `${SINGLE_INDENT}list(`,
    `${SINGLE_INDENT.repeat(2)}options?: ListOptions<ModelType<Name>>`,
    `${SINGLE_INDENT}): ListResult<ModelType<Name>>;`,
    `${SINGLE_INDENT}onCreate(`,
    `${SINGLE_INDENT.repeat(2)}options?: SubscriptionOptions<ModelType<Name>>`,
    `${SINGLE_INDENT}): SubscriptionResult<ModelType<Name>>;`,
    `${SINGLE_INDENT}onUpdate(`,
    `${SINGLE_INDENT.repeat(2)}options?: SubscriptionOptions<ModelType<Name>>`,
    `${SINGLE_INDENT}): SubscriptionResult<ModelType<Name>>;`,
    `${SINGLE_INDENT}onDelete(`,
    `${SINGLE_INDENT.repeat(2)}options?: SubscriptionOptions<ModelType<Name>>`,
    `${SINGLE_INDENT}): SubscriptionResult<ModelType<Name>>;`,
    `${SINGLE_INDENT}observeQuery(`,
    `${SINGLE_INDENT.repeat(2)}options?: ObserveQueryOptions<ModelType<Name>>`,
    `${SINGLE_INDENT}): ObserveQueryResult<ModelType<Name>>;`,
    '};',
    ''
  );

  // Model-specific operations with secondary indexes
  const modelSectionLines: string[] = [];
  for (const modelName of modelNames) {
    const model = intro.models[modelName];
    const indexAttributes = (model.attributes ?? []).filter(
      (attr) => attr?.type === 'key' && attr?.properties?.queryField
    );

    if (indexAttributes.length) {
      modelSectionLines.push(`export interface ${modelName}SecondaryIndexInputs {`);
      for (const attr of indexAttributes) {
        const queryField: string = attr.properties.queryField;
        const fields: string[] = attr.properties.fields ?? [];
        const requiredField = fields[0];
        const additionalFields = fields.slice(1);
        modelSectionLines.push(`${SINGLE_INDENT}${queryField}: {`);
        if (requiredField) {
          modelSectionLines.push(
            `${SINGLE_INDENT.repeat(2)}${requiredField}: ModelType<'${modelName}'>['${requiredField}'];`
          );
        }
        for (const fieldName of additionalFields) {
          modelSectionLines.push(
            `${SINGLE_INDENT.repeat(2)}${fieldName}?: FieldFilter<ModelType<'${modelName}'>['${fieldName}']>;`
          );
        }
        if (!fields.length) {
          modelSectionLines.push(`${SINGLE_INDENT.repeat(2)}// No indexed fields defined`);
        }
        modelSectionLines.push(`${SINGLE_INDENT}};`);
      }
      modelSectionLines.push('}', '');
    }

    const indexTypeName = indexAttributes.length
      ? `${modelName}SecondaryIndexInputs`
      : 'Record<string, never>';

    modelSectionLines.push(
      `export type ${modelName}ModelOperations = BaseModelOperations<'${modelName}'> & SecondaryIndexOperations<` +
        `ModelType<'${modelName}'>, ${indexTypeName}>;`
    );
    modelSectionLines.push('');
  }
  lines.push(...modelSectionLines);

  // DataModels interface
  lines.push('export interface DataModels {');
  for (const modelName of modelNames) {
    lines.push(
      `${SINGLE_INDENT}${modelName}: ${modelName}ModelOperations;`
    );
  }
  lines.push('}', '');

  // Enums helper
  lines.push(
    'type EnumValue<Name extends keyof SchemaEnums> = SchemaEnums[Name][keyof SchemaEnums[Name]];',
    'export type DataEnums = {',
    `${SINGLE_INDENT}[Name in keyof SchemaEnums]: {`,
    `${SINGLE_INDENT.repeat(2)}values: () => Array<EnumValue<Name>>;`,
    `${SINGLE_INDENT}};`,
    '};',
    ''
  );

  const customOperationLines = (
    operationType: 'queries' | 'mutations',
    names: string[]
  ) => {
    if (!names.length) {
      lines.push(
        `export type ${operationType === 'queries' ? 'DataQueries' : 'DataMutations'} = Record<string, never>;`,
        ''
      );
      return;
    }

    lines.push(
      `export interface ${operationType === 'queries' ? 'DataQueries' : 'DataMutations'} {`
    );
    for (const name of names) {
      const definition = intro[operationType]![name];
      const args = sortKeys(definition.arguments).map((argName) => [
        argName,
        definition.arguments![argName]
      ]) as Array<[string, FieldDefinition]>;
      const hasArgs = args.length > 0;
      const argsOptional = hasArgs && args.every(([, field]) => !field.isRequired);
      const resultBase = resolveTypeName(definition.type, 'namespaced');
      const resultType = definition.isArray ? `${resultBase}[]` : resultBase;

      lines.push(`${SINGLE_INDENT}${name}(`);
      if (hasArgs) {
        lines.push(
          `${SINGLE_INDENT.repeat(2)}args${argsOptional ? '?' : ''}: {`
        );
        for (const [argName, field] of args) {
        const { type, optional } = getFieldTyping(field, {
          forceOptional: !field.isRequired,
          treatAsInput: true,
          mode: 'namespaced'
        });
          lines.push(
            `${SINGLE_INDENT.repeat(3)}${argName}${optional ? '?' : ''}: ${type};`
          );
        }
        lines.push(`${SINGLE_INDENT.repeat(2)}},`);
      }
      lines.push(
        `${SINGLE_INDENT.repeat(2)}options?: CustomOperationOptions`
      );
      lines.push(
        `${SINGLE_INDENT}): CustomOperationResult<${resultType}>;`
      );
    }
    lines.push('}', '');
  };

  customOperationLines('queries', queryNames);
  customOperationLines('mutations', mutationNames);

  if (!subscriptionNames.length) {
    lines.push('export type DataSubscriptions = Record<string, never>;');
  } else {
    lines.push('export interface DataSubscriptions {');
    for (const name of subscriptionNames) {
      const definition = intro.subscriptions![name];
      const args = sortKeys(definition.arguments).map((argName) => [
        argName,
        definition.arguments![argName]
      ]) as Array<[string, FieldDefinition]>;
      const hasArgs = args.length > 0;
      const argsOptional = hasArgs && args.every(([, field]) => !field.isRequired);
      const resultBase = resolveTypeName(definition.type, 'namespaced');
      const resultType = definition.isArray ? `${resultBase}[]` : resultBase;

      lines.push(`${SINGLE_INDENT}${name}(`);
      if (hasArgs) {
        lines.push(
          `${SINGLE_INDENT.repeat(2)}args${argsOptional ? '?' : ''}: {`
        );
        for (const [argName, field] of args) {
          const { type, optional } = getFieldTyping(field, {
            forceOptional: !field.isRequired,
            treatAsInput: true,
            mode: 'namespaced'
          });
          lines.push(
            `${SINGLE_INDENT.repeat(3)}${argName}${optional ? '?' : ''}: ${type};`
          );
        }
        lines.push(`${SINGLE_INDENT.repeat(2)}},`);
      }
      lines.push(
        `${SINGLE_INDENT.repeat(2)}options?: SubscriptionOptions<${resultType}>`
      );
      lines.push(
        `${SINGLE_INDENT}): SubscriptionResult<${resultType}>;`
      );
    }
    lines.push('}');
  }
  lines.push('export type DataConversations = Record<string, never>;');
  lines.push('export type DataGenerations = Record<string, never>;');
  lines.push('');

  lines.push('export interface DataClient {');
  lines.push(`${SINGLE_INDENT}models: DataModels;`);
  lines.push(`${SINGLE_INDENT}enums: DataEnums;`);
  lines.push(`${SINGLE_INDENT}queries: DataQueries;`);
  lines.push(`${SINGLE_INDENT}mutations: DataMutations;`);
  lines.push(`${SINGLE_INDENT}subscriptions: DataSubscriptions;`);
  lines.push(`${SINGLE_INDENT}conversations: DataConversations;`);
  lines.push(`${SINGLE_INDENT}generations: DataGenerations;`);
  lines.push('}', '');

  return `${lines.join('\n')}`.replace(/\n{3,}/g, '\n\n');
}

/* -------------------------------------------------------------------------- */
/*                                   Main                                     */
/* -------------------------------------------------------------------------- */
const typesFileContent = buildTypesFile(introspection);
const schemaFileContent = buildDataSchemaFile(introspection);

// Ensure output directories exist before writing files
for (const dir of new Set([
  path.dirname(typesOutputPath),
  path.dirname(schemaOutputPath)
])) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

fs.writeFileSync(typesOutputPath, `${typesFileContent}\n`);
fs.writeFileSync(schemaOutputPath, `${schemaFileContent}\n`);

console.log(`✅ Generated Amplify types at ${typesOutputPath}`);
console.log(`✅ Generated Amplify data schema at ${schemaOutputPath}`);
