export type ImageOrientationGroup = 'landscape' | 'portrait';

export type CameraOrientationRotations = Record<
  string,
  Partial<Record<ImageOrientationGroup, number>>
>;

/** Read compatibility for uploads paused before shape groups were introduced. */
export type PersistedCameraOrientationRotations =
  CameraOrientationRotations | Record<string, number>;

/** Groups by the source image's displayed dimensions, not EXIF tag values. */
export function orientationGroupForDimensions(
  width: number,
  height: number,
): ImageOrientationGroup {
  return height > width ? 'portrait' : 'landscape';
}

export function normalizeQuarterTurn(rotation: number | undefined): number {
  const normalized = (((rotation ?? 0) % 360) + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270
    ? normalized
    : 0;
}

export function orientationCorrectionFor(
  rotations: PersistedCameraOrientationRotations | undefined,
  cameraName: string,
  orientationGroup: ImageOrientationGroup,
): number {
  const cameraRotation = rotations?.[cameraName];
  if (typeof cameraRotation === 'number') {
    return normalizeQuarterTurn(cameraRotation);
  }
  return normalizeQuarterTurn(cameraRotation?.[orientationGroup]);
}
