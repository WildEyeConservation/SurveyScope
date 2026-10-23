export type DistanceCamera = {
  focalLengthMm?: number | null;
  sensorWidthMm?: number | null;
  tiltDegrees?: number | null;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export type DistanceInputs = {
  y: number | null | undefined;
  imageWidth: number | null | undefined;
  imageHeight: number | null | undefined;
  altitudeAgl: number | null | undefined;
  camera: DistanceCamera | null | undefined;
};

type ValidDistanceInputs = {
  y: number;
  imageWidth: number;
  imageHeight: number;
  altitudeAgl: number;
  camera: { focalLengthMm: number; sensorWidthMm: number; tiltDegrees: number };
};

export function hasDistanceInputs(
  inputs: DistanceInputs
): inputs is ValidDistanceInputs {
  const { y, imageWidth, imageHeight, altitudeAgl, camera } = inputs;
  return (
    !!camera &&
    isFiniteNumber(y) &&
    isFiniteNumber(imageWidth) &&
    imageWidth > 0 &&
    isFiniteNumber(imageHeight) &&
    imageHeight > 0 &&
    isFiniteNumber(altitudeAgl) &&
    altitudeAgl >= 0 &&
    isFiniteNumber(camera.focalLengthMm) &&
    camera.focalLengthMm > 0 &&
    isFiniteNumber(camera.sensorWidthMm) &&
    camera.sensorWidthMm > 0 &&
    isFiniteNumber(camera.tiltDegrees)
  );
}

// Level side-looking camera: top edge farthest away, sensor width is the long side.
export function perpendicularDistance(inputs: DistanceInputs): number | null {
  if (!hasDistanceInputs(inputs)) return null;
  const { y, imageWidth, imageHeight, altitudeAgl, camera } = inputs;

  const pixelPitchMm = camera.sensorWidthMm / Math.max(imageWidth, imageHeight);
  const offsetMm = (imageHeight / 2 - y) * pixelPitchMm;
  const angle =
    (Math.abs(camera.tiltDegrees) * Math.PI) / 180 +
    Math.atan(offsetMm / camera.focalLengthMm);
  if (angle >= Math.PI / 2) return null;

  return Math.abs(altitudeAgl * Math.tan(angle));
}
