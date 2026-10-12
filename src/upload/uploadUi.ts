import { useSyncExternalStore } from 'react';
import type { SessionSnapshot } from './core/types';
import { uploadOrchestrator } from './core/UploadOrchestrator';
import { createExclusive } from './exclusive';

// Request bus plus external stores for uploader UI state.

export type UploadUiRequest =
  | { type: 'resume'; project: { id: string; name: string } }
  | { type: 'delete'; project: { id: string; name: string } };

type RequestListener = (request: UploadUiRequest) => void;

const requestListeners = new Set<RequestListener>();

export function onUploadUiRequest(listener: RequestListener): () => void {
  requestListeners.add(listener);
  return () => requestListeners.delete(listener);
}

export function requestResume(project: { id: string; name: string }): void {
  for (const listener of requestListeners) listener({ type: 'resume', project });
}

export function requestDelete(project: { id: string; name: string }): void {
  for (const listener of requestListeners) listener({ type: 'delete', project });
}

export interface UploadUiState {
  resumingProjectId: string | null;
  deletingProjectId: string | null;
  deleteStep: number;
  deleteTotal: number;
}

let uiState: UploadUiState = {
  resumingProjectId: null,
  deletingProjectId: null,
  deleteStep: 0,
  deleteTotal: 0,
};
const uiListeners = new Set<() => void>();

export function setUploadUiState(patch: Partial<UploadUiState>): void {
  uiState = { ...uiState, ...patch };
  for (const listener of uiListeners) listener();
}

function subscribeUi(listener: () => void): () => void {
  uiListeners.add(listener);
  return () => uiListeners.delete(listener);
}

export const withResuming = createExclusive((projectId) =>
  setUploadUiState({ resumingProjectId: projectId })
);

export function useUploadUi(): UploadUiState {
  return useSyncExternalStore(subscribeUi, () => uiState);
}

function subscribeStatus(listener: () => void): () => void {
  return uploadOrchestrator.subscribe(() => listener());
}

export function useUploadStatus(): SessionSnapshot | null {
  return useSyncExternalStore(subscribeStatus, () =>
    uploadOrchestrator.getSnapshot()
  );
}

/** Primitive snapshot for views that only care which project is uploading. */
export function useActiveUploadProjectId(): string | null {
  return useSyncExternalStore(subscribeStatus, () => {
    const snapshot = uploadOrchestrator.getSnapshot();
    return snapshot && uploadOrchestrator.isActive()
      ? snapshot.projectId
      : null;
  });
}
