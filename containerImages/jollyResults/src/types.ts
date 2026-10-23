export interface CameraRecord {
  id: string;
  focalLengthMm?: number | null;
  sensorWidthMm?: number | null;
  tiltDegrees?: number | null;
}

export interface StratumRecord {
  id: string;
  name?: string | null;
  area?: number | null;
  baselineLength?: number | null;
  offEffort?: boolean | null;
  coordinates?: number[] | null;
}

export interface TransectRecord {
  id: string;
  stratumId: string;
}

export interface ImageRecord {
  id: string;
  transectId?: string | null;
  cameraId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  altitude_agl?: number | null;
  timestamp?: number | null;
  boundaryStatus?: 'inside' | 'outside' | 'excluded' | null;
}

export interface AnnotationRecord {
  id: string;
  objectId?: string | null;
  imageId: string;
  categoryId: string;
}

export interface JollyResultRecord {
  surveyId: string;
  stratumId: string;
  annotationSetId: string;
  categoryId: string;
  animals: number;
  areaSurveyed: number;
  estimate: number;
  density: number;
  variance: number;
  standardError: number;
  numSamples: number;
  lowerBound95: number;
  upperBound95: number;
  group: string;
  createdAt: string;
  updatedAt: string;
  __typename: 'JollyResult';
  'stratumId#annotationSetId#categoryId': string;
}

export interface ValidationCounts {
  excludedImages: number;
  outsideBoundary: number;
  missingTransect: number;
  missingCamera: number;
  missingPosition: number;
  missingAltitude: number;
  missingTimestamp: number;
  invalidCameraOptics: number;
  annotationsForExcludedImages: number;
}

export interface ComputationOutput {
  results: JollyResultRecord[];
  validation: ValidationCounts;
  warnings: string[];
}

export interface JobInput {
  jobId: string;
  jobKey: string;
  surveyId: string;
  annotationSetId: string;
  categoryIds: string[];
  organizationId: string;
  statusKey: string;
}

export interface JobStatus {
  jobId: string;
  surveyId: string;
  annotationSetId: string;
  status: string;
  phase: string;
  progress?: Record<string, number | string>;
  validation?: Partial<ValidationCounts>;
  warnings?: string[];
  startedAt?: string;
  updatedAt: string;
  error: string | null;
}

export type DynamoItem = Record<string, unknown>;

export interface CommitManifest {
  jobId: string;
  jobKey: string;
  surveyId: string;
  annotationSetId: string;
  tableName: string;
  createdAt: string;
  oldRows: DynamoItem[];
  newRows: DynamoItem[];
}
