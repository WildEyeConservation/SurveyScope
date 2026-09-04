import { useContext, useEffect, useRef, useState } from 'react';
import ConfirmationModal from '../ConfirmationModal';
import { UserContext } from '../Context';
import { client, backendOutputs as backend } from '../stores/appClient';
import type { ImageData } from '../types/ImageData';
import {
  loadFilesFromStoredHandle,
  removeDirectoryHandle,
} from './core/dirHandles';
import { clearProjectStores, fileStore } from './core/persistence';
import { ACTIVE_PHASES, type UploadBackend } from './core/types';
import { uploadOrchestrator } from './core/UploadOrchestrator';
import {
  onUploadUiRequest,
  setUploadUiState,
  useUploadStatus,
} from './uploadUi';

// Handles resume/delete UI; transfer state lives in ./core.
export default function UploadManager() {
  const { user } = useContext(UserContext)!;
  const snapshot = useUploadStatus();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingResumeRef = useRef<{ id: string; name: string } | null>(null);
  const pendingDeleteRef = useRef<{ id: string; name: string } | null>(null);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const activeProjectId =
    snapshot && ACTIVE_PHASES.includes(snapshot.phase)
      ? snapshot.projectId
      : null;

  const startUpload = (projectId: string, files: File[]) => {
    uploadOrchestrator.start({
      client,
      backend: backend as unknown as UploadBackend,
      projectId,
      userId: user.userId,
      files,
    });
  };

  // Resume from memory or a saved folder handle before asking for a picker.
  const handleResumeRequest = async (project: { id: string; name: string }) => {
    if (uploadOrchestrator.resume(project.id)) return;

    const manifest =
      ((await fileStore.getItem(project.id)) as ImageData[]) ?? [];
    if (manifest.length > 0) {
      const files = await loadFilesFromStoredHandle(project.id);
      if (files && files.length > 0) {
        const manifestPaths = new Set(manifest.map((img) => img.originalPath));
        if (files.some((f) => manifestPaths.has(f.webkitRelativePath))) {
          startUpload(project.id, files);
          return;
        }
      }
    }

    pendingResumeRef.current = project;
    setShowResumeModal(true);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (selectedFiles && pendingResumeRef.current) {
      startUpload(pendingResumeRef.current.id, Array.from(selectedFiles));
      pendingResumeRef.current = null;
    }
  };

  const handleDeleteConfirm = async () => {
    const project = pendingDeleteRef.current;
    if (!project) return;
    pendingDeleteRef.current = null;
    const id = project.id;

    if (uploadOrchestrator.getSnapshot()?.projectId === id) {
      uploadOrchestrator.cancel();
    }
    setUploadUiState({ deletingProjectId: id, deleteStep: 0, deleteTotal: 3 });
    try {
      console.log(`Deleting project ${id}`);
      const {
        data: [imageSet],
      } = await client.models.ImageSet.imageSetsByProjectId({ projectId: id });
      await client.models.ImageSet.delete({ id: imageSet.id });
      setUploadUiState({ deleteStep: 1 });

      const { data: memberships } =
        await client.models.UserProjectMembership.userProjectMembershipsByProjectId(
          { projectId: id }
        );
      await Promise.all(
        memberships.map((membership) =>
          client.models.UserProjectMembership.delete({ id: membership.id })
        )
      );
      setUploadUiState({ deleteStep: 2 });

      await client.models.Project.delete({ id });
      setUploadUiState({ deleteStep: 3 });

      await clearProjectStores(id);
      await removeDirectoryHandle(id);
    } catch (error) {
      console.error('Error deleting project:', error);
    } finally {
      setUploadUiState({ deletingProjectId: null, deleteStep: 0, deleteTotal: 0 });
    }
  };

  useEffect(() => {
    return onUploadUiRequest((request) => {
      if (request.type === 'resume') {
        void handleResumeRequest(request.project);
      } else if (request.type === 'delete') {
        pendingDeleteRef.current = request.project;
        setShowDeleteModal(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.userId]);

  // Warn before closing the tab while an upload is running.
  useEffect(() => {
    if (!activeProjectId) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeProjectId]);

  // Keep Project.updatedAt fresh so other admins do not see a stale upload.
  useEffect(() => {
    if (!activeProjectId) return;
    const pingProject = async () => {
      try {
        const { data, errors } = await client.models.Project.update({
          id: activeProjectId,
          status: 'uploading',
        });
        if (errors?.length) {
          console.error(`Ping failed for project ${activeProjectId}:`, errors);
        } else if (!data) {
          console.error(`Ping returned no data for project ${activeProjectId}`);
        }
      } catch (error) {
        console.error('Error pinging project:', error);
      }
    };
    const pingInterval = setInterval(pingProject, 60000);
    return () => clearInterval(pingInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // Keep the screen awake while an upload is active.
  useEffect(() => {
    if (!activeProjectId) return;
    if (!('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
      } catch (err) {
        console.warn('Wake lock request failed', err);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !sentinel) {
        acquire();
      }
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (sentinel) {
        sentinel.release().catch(() => {});
        sentinel = null;
      }
    };
  }, [activeProjectId]);

  return (
    <>
      <input
        ref={fileInputRef}
        type='file'
        webkitdirectory='true'
        // @ts-expect-error Chromium-only directory picker attribute
        directory='true'
        multiple
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />
      <ConfirmationModal
        show={showResumeModal}
        onClose={() => setShowResumeModal(false)}
        onConfirm={() => fileInputRef.current?.click()}
        title='Resume upload'
        body={`Uploads were interrupted for ${pendingResumeRef.current?.name}. Would you like to resume? After confirming, please select the survey folder again. Only the files that were interrupted will be uploaded.`}
      />
      <ConfirmationModal
        show={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={() => void handleDeleteConfirm()}
        title='Delete Survey'
        body={`This will cancel the upload and delete the survey${
          pendingDeleteRef.current ? ` "${pendingDeleteRef.current.name}"` : ''
        }. This action cannot be undone.`}
      />
    </>
  );
}
