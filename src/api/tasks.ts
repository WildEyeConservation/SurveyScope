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

export const startTest = (test: {
  projectId: string;
  testPresetId: string;
  locationId: string;
  annotationSetId: string;
}) => call<{ leaseId: string }>('/tasks/test', test);
