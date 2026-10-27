import type { ColumnKind, ValueOfKind } from './rowChunk';

export type RowScope = 'project' | 'annotationSet' | 'locationSet';

export interface RowSource {
  model: string;
  // The DynamoDB index name, which can differ from the query field.
  index: string;
  scope: RowScope;
  partitionKey: string;
  sortKey?: string;
  // Every other attribute of the index's LastEvaluatedKey; always returned.
  key: readonly string[];
  fields: Record<string, ColumnKind>;
  sortBy?: string;
  // Fields named `${prefix}.<attribute>` are read from `model` by `foreignKey`.
  join?: { prefix: string; model: string; foreignKey: string };
}

export const ROW_SOURCES = {
  imagesByProjectId: {
    model: 'Image',
    index: 'imagesByProjectId',
    scope: 'project',
    partitionKey: 'projectId',
    key: ['id'],
    sortBy: 'timestamp',
    fields: {
      id: 'str',
      cameraId: 'dict',
      transectId: 'dict',
      boundaryStatus: 'dict',
      originalPath: 'path',
      latitude: 'num',
      longitude: 'num',
      altitude_agl: 'num',
      altitude_wgs84: 'num',
      width: 'num',
      height: 'num',
      timestamp: 'delta',
      phash: 'str',
    },
  },
  annotationsByAnnotationSetId: {
    model: 'Annotation',
    index: 'annotationsBySetId',
    scope: 'annotationSet',
    partitionKey: 'setId',
    key: ['id'],
    fields: {
      id: 'str',
      imageId: 'dict',
      categoryId: 'dict',
      objectId: 'dict',
      x: 'num',
      y: 'num',
      source: 'dict',
      oov: 'bool',
      obscured: 'bool',
      owner: 'dict',
      reviewedBy: 'dict',
      infoTaggedBy: 'dict',
      createdAt: 'str',
    },
  },
  observationsByAnnotationSetId: {
    model: 'Observation',
    index: 'observationsByAnnotationSetIdAndCreatedAt',
    scope: 'annotationSet',
    partitionKey: 'annotationSetId',
    key: ['id', 'createdAt'],
    join: { prefix: 'location', model: 'Location', foreignKey: 'locationId' },
    fields: {
      id: 'str',
      createdAt: 'str',
      locationId: 'dict',
      owner: 'dict',
      source: 'dict',
      'location.imageId': 'dict',
      'location.x': 'num',
      'location.y': 'num',
      'location.width': 'num',
      'location.height': 'num',
    },
  },
  locationsBySetIdAndConfidence: {
    model: 'Location',
    index: 'locationsBySetIdAndConfidence',
    scope: 'locationSet',
    partitionKey: 'setId',
    sortKey: 'confidence',
    key: ['id', 'confidence'],
    fields: {
      id: 'str',
      confidence: 'num',
      source: 'dict',
      imageId: 'dict',
      x: 'num',
      y: 'num',
      width: 'num',
      height: 'num',
    },
  },
  locationsByProjectIdAndSource: {
    model: 'Location',
    index: 'locationsByProjectIdAndSource',
    scope: 'project',
    partitionKey: 'projectId',
    sortKey: 'source',
    key: ['id', 'source'],
    fields: {
      id: 'str',
      source: 'dict',
      imageId: 'dict',
      x: 'num',
      y: 'num',
      width: 'num',
      height: 'num',
      confidence: 'num',
    },
  },
  processedByProjectIdAndSource: {
    model: 'ImageProcessedBy',
    index: 'imageProcessedBiesByProjectIdAndSource',
    scope: 'project',
    partitionKey: 'projectId',
    sortKey: 'source',
    key: ['imageId', 'source'],
    fields: { imageId: 'str', source: 'dict' },
  },
  categoriesByProjectId: {
    model: 'Category',
    index: 'categoriesByProjectId',
    scope: 'project',
    partitionKey: 'projectId',
    key: ['id'],
    fields: { id: 'str', name: 'str' },
  },
  categoriesByAnnotationSetId: {
    model: 'Category',
    index: 'categoriesByAnnotationSetId',
    scope: 'annotationSet',
    partitionKey: 'annotationSetId',
    key: ['id'],
    fields: { id: 'str', name: 'str' },
  },
  imageNeighboursByProjectId: {
    model: 'ImageNeighbour',
    index: 'imageNeighboursByProjectId',
    scope: 'project',
    partitionKey: 'projectId',
    key: ['image1Id', 'image2Id'],
    fields: {
      image1Id: 'dict',
      image2Id: 'dict',
      homography: 'floats',
      homographySource: 'dict',
      skipped: 'bool',
      suggestedPointsKept: 'num',
      cameraPairKey: 'dict',
      registrationProcessedAt: 'str',
      registrationFailedAt: 'str',
    },
  },
} as const satisfies Record<string, RowSource>;

export type RowSourceName = keyof typeof ROW_SOURCES;
type SourceOf<S extends RowSourceName> = (typeof ROW_SOURCES)[S];
export type FieldOf<S extends RowSourceName> = keyof SourceOf<S>['fields'] &
  string;
type KeyOf<S extends RowSourceName> = SourceOf<S>['key'][number];
type KindOf<S extends RowSourceName, F> = F extends FieldOf<S>
  ? SourceOf<S>['fields'][F]
  : never;

export type RowOf<S extends RowSourceName, F extends FieldOf<S>> = {
  [K in KeyOf<S>]: ValueOfKind<KindOf<S, K>>;
} & {
  [K in Exclude<F, KeyOf<S>>]: ValueOfKind<KindOf<S, K>> | null;
};

export const SCOPE_MODELS = {
  project: 'Project',
  annotationSet: 'AnnotationSet',
  locationSet: 'LocationSet',
} as const satisfies Record<RowScope, string>;

export function rowSource(name: unknown): RowSource | undefined {
  return typeof name === 'string' &&
    Object.prototype.hasOwnProperty.call(ROW_SOURCES, name)
    ? ROW_SOURCES[name as RowSourceName]
    : undefined;
}

export function chunkFields(source: RowSource, requested: readonly string[]) {
  return Array.from(new Set([...source.key, ...requested]));
}

export function splitJoined(source: RowSource, fields: readonly string[]) {
  const prefix = source.join ? `${source.join.prefix}.` : undefined;
  const joined = prefix
    ? fields.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length))
    : [];
  const own = prefix ? fields.filter((f) => !f.startsWith(prefix)) : [...fields];
  if (joined.length && source.join) own.push(source.join.foreignKey);
  return { own: Array.from(new Set(own)), joined };
}

export function unknownFields(source: RowSource, fields: readonly string[]) {
  return fields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(source.fields, field)
  );
}
