import localforage from 'localforage';

// Chromium directory handles let resume reattach folders without EXIF rescans.
// The DOM lib does not fully cover this API, so declare the needed shape.
interface DirectoryHandleLike {
  readonly kind: 'directory' | 'file';
  readonly name: string;
  queryPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  values(): AsyncIterableIterator<DirectoryHandleLike | FileHandleLike>;
}

interface FileHandleLike {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
}

const dirHandleStore = localforage.createInstance({
  name: 'uploadDirHandles',
  storeName: 'handles',
});

export function supportsDirectoryPicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
      'function'
  );
}

export async function pickDirectory(): Promise<DirectoryHandleLike | null> {
  if (!supportsDirectoryPicker()) return null;
  try {
    return await (
      window as unknown as {
        showDirectoryPicker: (opts?: {
          mode?: string;
        }) => Promise<DirectoryHandleLike>;
      }
    ).showDirectoryPicker({ mode: 'read' });
  } catch {
    // User dismissed the picker.
    return null;
  }
}

export async function saveDirectoryHandle(
  projectId: string,
  handle: unknown
): Promise<void> {
  try {
    // FileSystemDirectoryHandle is structured-cloneable into IndexedDB.
    await dirHandleStore.setItem(projectId, handle);
  } catch (err) {
    console.warn('Failed to persist directory handle:', err);
  }
}

export async function removeDirectoryHandle(projectId: string): Promise<void> {
  try {
    await dirHandleStore.removeItem(projectId);
  } catch {
    /* best-effort */
  }
}

/** Returns restored files, or null when the picker fallback is required. */
export async function loadFilesFromStoredHandle(
  projectId: string
): Promise<File[] | null> {
  let handle: DirectoryHandleLike | null;
  try {
    handle = (await dirHandleStore.getItem(projectId)) as
      | DirectoryHandleLike
      | null;
  } catch {
    return null;
  }
  if (!handle || handle.kind !== 'directory') return null;

  try {
    if (handle.queryPermission && handle.requestPermission) {
      let state = await handle.queryPermission({ mode: 'read' });
      if (state === 'prompt') {
        state = await handle.requestPermission({ mode: 'read' });
      }
      if (state !== 'granted') return null;
    }
    return await collectFilesFromHandle(handle);
  } catch (err) {
    console.warn('Failed to restore files from directory handle:', err);
    return null;
  }
}

/** Walks a directory handle into Files with input-style webkitRelativePath. */
export async function collectFilesFromHandle(
  handle: DirectoryHandleLike,
  onProgress?: (found: number) => void
): Promise<File[]> {
  const files: File[] = [];
  const walk = async (dir: DirectoryHandleLike, prefix: string) => {
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') {
        const file = await (entry as FileHandleLike).getFile();
        // webkitRelativePath is an empty-string prototype getter on files
        // that didn't come from an <input webkitdirectory>; shadow it with
        // an own property carrying the reconstructed path.
        Object.defineProperty(file, 'webkitRelativePath', {
          value: `${prefix}${entry.name}`,
          configurable: true,
        });
        files.push(file);
        if (files.length % 250 === 0) onProgress?.(files.length);
      } else {
        await walk(
          entry as DirectoryHandleLike,
          `${prefix}${entry.name}/`
        );
      }
    }
  };
  await walk(handle, `${handle.name}/`);
  return files;
}
