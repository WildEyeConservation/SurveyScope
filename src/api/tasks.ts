import { apiRequest } from './httpClient';

export interface ReceivedTask {
  leaseId: string;
  messageId: string;
  body: string;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const result = (await apiRequest(path, body)) as {
    data: T;
    errors?: { message?: string }[];
  };
  if (result.errors?.length) {
    throw new Error(
      result.errors.map((e) => e.message ?? 'Unknown error').join('; '),
    );
  }
  return result.data;
}

export const receiveTask = (queueId: string, visibility = 600) =>
  call<ReceivedTask | null>('/tasks/receive', { queueId, visibility });

export const receiveTasks = (queueId: string, max: number, visibility = 600) =>
  call<ReceivedTask[]>('/tasks/receive-batch', { queueId, max, visibility });

export const ackTask = (leaseId: string) =>
  call<boolean>('/tasks/ack', { leaseId });

export const setTaskVisibility = (leaseId: string, seconds: number) =>
  call<boolean>('/tasks/visibility', { leaseId, seconds });

export const queueDepths = (queueIds: string[]) =>
  call<Record<string, string>>('/tasks/depth', { queueIds });

export interface TestBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Reference annotations around the test box, shown read-only.
export interface TestContextAnnotation {
  id: string;
  x: number;
  y: number;
  source: string | null;
  categoryName: string;
}

export interface StartedTest {
  leaseId: string;
  box: TestBox;
  grown: boolean;
  context: TestContextAnnotation[];
}

// Null when the location cannot be served as this job's test.
export const startTest = (test: {
  projectId: string;
  testPresetId: string;
  locationId: string;
  annotationSetId: string;
  jobAnnotationSetId: string;
  tile?: {
    tile: { width: number; height: number };
    image: { width: number; height: number };
  };
}) => call<StartedTest | null>('/tasks/test', test);

export const submitTest = (
  leaseId: string,
  annotations: { x: number; y: number; categoryId: string }[],
) =>
  call<{ testResultId: string }>('/tasks/test/submit', {
    leaseId,
    annotations,
  });
