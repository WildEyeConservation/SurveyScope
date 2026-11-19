import { apiRequest } from './httpClient';

export interface ReceivedTask {
  leaseId: string;
  messageId: string;
  body: string;
}

// Raised when the server holds back work until the annotator takes a test.
export class TestDueError extends Error {}

async function request<T>(path: string, body: unknown) {
  const result = (await apiRequest(path, body)) as {
    data: T;
    testDue?: boolean;
    errors?: { errorType?: string; message?: string }[];
  };
  if (result.errors?.length) {
    const message = result.errors
      .map((e) => e.message ?? 'Unknown error')
      .join('; ');
    if (result.errors.some((e) => e.errorType === 'TestDue'))
      throw new TestDueError(message);
    throw new Error(message);
  }
  return result;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  return (await request<T>(path, body)).data;
}

export const receiveTask = (queueId: string, visibility = 600) =>
  call<ReceivedTask | null>('/tasks/receive', { queueId, visibility });

export const receiveTasks = (queueId: string, max: number, visibility = 600) =>
  call<ReceivedTask[]>('/tasks/receive-batch', { queueId, max, visibility });

// Says whether a test is now due, so the queue can serve one.
export const ackTask = async (leaseId: string) =>
  Boolean((await request<boolean>('/tasks/ack', { leaseId })).testDue);

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
  testPresetId: string;
  annotationSetId: string;
  location: { id: string };
  box: TestBox;
  grown: boolean;
  context: TestContextAnnotation[];
}

// The server picks the test; null when there is none for this job.
export const startTest = (test: {
  projectId: string;
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
