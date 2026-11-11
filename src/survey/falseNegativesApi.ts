import { DataClient } from '../../amplify/shared/data-schema.generated';

export interface FalseNegativesLaunch {
  launchNo: number;
  launchedAt: string;
  percent: number;
  count: number;
}

export interface FalseNegativesSample {
  state: 'working' | 'ready' | 'failed';
  step: string | null;
  error: string | null;
  action: 'launch' | 'continue' | 'reset' | null;
  // Tiles nobody had reviewed when the sample was last worked out.
  unreviewedTiles: number;
  sampledCount: number;
  reviewedCount: number;
  // Sampled tiles that primary review reached afterwards.
  coveredCount: number;
  foundCount: number;
  pendingCount: number;
  launches: FalseNegativesLaunch[];
}

export interface FalseNegativesStatus {
  sample: FalseNegativesSample | null;
  // A False Negatives job is running on this annotation set.
  queueActive: boolean;
  // Any job on the survey blocks a new launch.
  surveyBusy: boolean;
}

export interface FalseNegativesRequest {
  action: 'launch' | 'continue' | 'reset';
  projectId: string;
  annotationSetId: string;
  samplePercent?: number;
  queueTag?: string;
  batchSize?: number;
  zoom?: number | null;
}

type Operation = (
  input: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<{ data?: unknown; errors?: { message?: string }[] }>;

// Resolved at runtime because the generated client may predate these.
function operation(
  client: DataClient,
  kind: 'queries' | 'mutations',
  name: string,
): Operation {
  const found = (client as unknown as Record<string, Record<string, unknown>>)[
    kind
  ]?.[name];
  if (typeof found !== 'function') {
    throw new Error('False Negatives is not available on this deployment yet');
  }
  return found as Operation;
}

async function call<T>(run: Promise<Awaited<ReturnType<Operation>>>) {
  const { data, errors } = await run;
  if (errors?.length) {
    throw new Error(
      errors.map((error) => error.message ?? 'Unknown error').join('; '),
    );
  }
  return (typeof data === 'string' ? JSON.parse(data) : data) as T;
}

export function fetchFalseNegativesStatus(
  client: DataClient,
  projectId: string,
  annotationSetId: string,
): Promise<FalseNegativesStatus> {
  return call(
    operation(
      client,
      'queries',
      'getFalseNegativesStatus',
    )({ projectId, annotationSetId }),
  );
}

export async function sendFalseNegativesRequest(
  client: DataClient,
  request: FalseNegativesRequest,
): Promise<void> {
  await call(
    operation(
      client,
      'mutations',
      'launchFalseNegatives',
    )({ request: JSON.stringify(request) }, { retry: false }),
  );
}

export function validSampleCount(sample: FalseNegativesSample): number {
  return Math.max(0, sample.sampledCount - sample.coveredCount);
}
