import type { UploadClient } from './types';

// Resolves image camera IDs from folder paths and optional folder mappings.
export interface CameraResolver {
  resolveCameraName(originalPath: string): string | undefined;
  resolveCameraId(originalPath: string): string | undefined;
}

export async function buildCameraResolver(
  client: UploadClient,
  projectId: string,
  folderCameraMapping: Record<string, string>
): Promise<CameraResolver> {
  const { data: existingCameras } =
    await client.models.Camera.camerasByProjectId({ projectId });

  const cameraNameToId: Record<string, string> = {};
  (existingCameras || []).forEach((cam) => {
    if (cam?.name && cam?.id) cameraNameToId[cam.name] = cam.id;
  });
  const knownCameraNames = Object.keys(cameraNameToId);
  const singleCamera = (existingCameras || []).length === 1;

  const extractCameraNameFromPath = (path: string): string | null => {
    const parts = path.split('/');
    if (parts.length > 1) parts.pop(); // remove filename
    for (let i = parts.length - 1; i >= 0; i--) {
      const seg = parts[i];
      const mapped = folderCameraMapping[seg];
      if (mapped && knownCameraNames.includes(mapped)) return mapped;
      if (knownCameraNames.includes(seg)) return seg;
    }
    return null;
  };

  const resolveCameraName = (originalPath: string): string | undefined => {
    const cameraName = singleCamera
      ? 'Survey Camera'
      : extractCameraNameFromPath(originalPath);
    return cameraName ?? undefined;
  };

  return {
    resolveCameraName,
    resolveCameraId(originalPath: string): string | undefined {
      const cameraName = resolveCameraName(originalPath);
      return cameraName ? cameraNameToId[cameraName] : undefined;
    },
  };
}

export type CameraWrite = 'reuse' | 'update' | 'create';

// The form hides spec inputs for existing cameras, so a missing spec means
// "leave the saved values alone", not zero.
export function planCameraWrite(
  cameraExists: boolean,
  isMapped: boolean,
  hasEnteredSpec: boolean
): CameraWrite {
  if (isMapped) return 'reuse';
  if (!cameraExists) return 'create';
  return hasEnteredSpec ? 'update' : 'reuse';
}
