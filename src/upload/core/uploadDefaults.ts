import type { AltitudeUnit } from '../altitudeFilter';
import { unwrap } from './retry';
import type { UploadClient } from './types';
import {
  normalizeQuarterTurn,
  type CameraOrientationRotations,
} from '../../types/Orientation';

export interface UploadDefaults {
  altitudeInMeters?: boolean;
  altitudeType?: string;
  altitudeFilter?: {
    enabled: boolean;
    target: string;
    deviation: string;
    unit: AltitudeUnit;
  };
  trimToBoundary?: boolean;
  folderCameraMapping?: Record<string, string>;
  rotations?: CameraOrientationRotations;
}

const ALTITUDE_TYPES = ['egm96', 'wgs84', 'agl'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function parseUploadDefaults(raw: unknown): UploadDefaults | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  const result: UploadDefaults = {};
  if (typeof value.altitudeInMeters === 'boolean') {
    result.altitudeInMeters = value.altitudeInMeters;
  }
  if (
    typeof value.altitudeType === 'string' &&
    ALTITUDE_TYPES.includes(value.altitudeType)
  ) {
    result.altitudeType = value.altitudeType;
  }
  const filter = value.altitudeFilter;
  if (
    isRecord(filter) &&
    typeof filter.enabled === 'boolean' &&
    typeof filter.target === 'string' &&
    typeof filter.deviation === 'string' &&
    (filter.unit === 'm' || filter.unit === 'ft')
  ) {
    result.altitudeFilter = {
      enabled: filter.enabled,
      target: filter.target,
      deviation: filter.deviation,
      unit: filter.unit,
    };
  }
  if (typeof value.trimToBoundary === 'boolean') {
    result.trimToBoundary = value.trimToBoundary;
  }
  if (isRecord(value.folderCameraMapping)) {
    result.folderCameraMapping = Object.fromEntries(
      Object.entries(value.folderCameraMapping).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1] !== ''
      )
    );
  }
  if (isRecord(value.rotations)) {
    result.rotations = Object.fromEntries(
      Object.entries(value.rotations).flatMap(([camera, groups]) => {
        if (!isRecord(groups)) return [];
        const corrections = Object.fromEntries(
          (['landscape', 'portrait'] as const).flatMap((group) => {
            const rotation = normalizeQuarterTurn(Number(groups[group]));
            return rotation ? [[group, rotation]] : [];
          })
        );
        return Object.keys(corrections).length > 0
          ? [[camera, corrections]]
          : [];
      })
    );
  }
  return result;
}

// Keeps saved entries for cameras and folders this upload does not cover.
export function mergeUploadDefaults(
  saved: UploadDefaults | null,
  next: UploadDefaults,
  uploadedCameras: string[],
  uploadedFolders: string[]
): UploadDefaults {
  const rotations = { ...saved?.rotations };
  for (const camera of uploadedCameras) delete rotations[camera];
  const mapping = { ...saved?.folderCameraMapping };
  for (const folder of uploadedFolders) delete mapping[folder];
  return {
    ...next,
    folderCameraMapping: { ...mapping, ...next.folderCameraMapping },
    rotations: { ...rotations, ...next.rotations },
  };
}

export function mappingForFolders(
  mapping: Record<string, string> | undefined,
  folders: string[]
): Record<string, string> {
  return Object.fromEntries(
    folders.flatMap((folder) =>
      mapping && Object.prototype.hasOwnProperty.call(mapping, folder)
        ? [[folder, mapping[folder]]]
        : []
    )
  );
}

// Throws when the read fails, so callers never mistake it for no defaults.
export async function fetchUploadDefaults(
  client: Pick<UploadClient, 'models'>,
  projectId: string
): Promise<UploadDefaults | null> {
  const project = unwrap<{ uploadDefaults?: string | null }>(
    await client.models.Project.get(
      { id: projectId },
      { selectionSet: ['uploadDefaults'] as const }
    )
  );
  return parseUploadDefaults(project.uploadDefaults);
}
