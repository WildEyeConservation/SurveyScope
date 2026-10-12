import sharp from 'sharp';

// User selections are counter-clockwise corrections applied after the source
// image's existing EXIF orientation. The result is baked into the stored
// pixels and the output EXIF orientation is reset to 1.
const COMPOSED_ORIENTATION_BY_CCW = {
  0: [1, 2, 3, 4, 5, 6, 7, 8],
  90: [8, 5, 6, 7, 4, 1, 2, 3],
  180: [3, 4, 1, 2, 7, 8, 5, 6],
  270: [6, 7, 8, 5, 2, 3, 4, 1],
};

export function normalizeCorrection(value) {
  const correction = Number(value);
  return correction === 90 || correction === 180 || correction === 270
    ? correction
    : 0;
}

export function composedOrientation(sourceOrientation, correctionCCW) {
  const source =
    Number.isInteger(sourceOrientation) &&
    sourceOrientation >= 1 &&
    sourceOrientation <= 8
      ? sourceOrientation
      : 1;
  const correction = normalizeCorrection(correctionCCW);
  return COMPOSED_ORIENTATION_BY_CCW[correction][source - 1];
}

function applyPhysicalOrientation(pipeline, orientation) {
  switch (orientation) {
    case 2:
      return pipeline.flop();
    case 3:
      return pipeline.rotate(180);
    case 4:
      return pipeline.flip();
    case 5:
      // Sharp applies flip/flop before an explicit rotation.
      return pipeline.flip().rotate(90);
    case 6:
      return pipeline.rotate(90);
    case 7:
      return pipeline.flop().rotate(90);
    case 8:
      return pipeline.rotate(270);
    default:
      return pipeline;
  }
}

export async function normalizeImageOrientation(
  buffer,
  correctionCCW,
  failOn = 'warning'
) {
  const sourceMetadata = await sharp(buffer).metadata();
  const orientation = composedOrientation(
    sourceMetadata.orientation ?? 1,
    correctionCCW
  );

  const swapsDimensions = orientation >= 5;
  const outputWidth = swapsDimensions
    ? sourceMetadata.height
    : sourceMetadata.width;
  const outputHeight = swapsDimensions
    ? sourceMetadata.width
    : sourceMetadata.height;

  let pipeline = sharp(buffer, { failOn });
  pipeline = applyPhysicalOrientation(pipeline, orientation);

  return pipeline
    .withMetadata({ orientation: 1 })
    .withExifMerge({
      IFD0: {
        ImageWidth: String(outputWidth),
        ImageLength: String(outputHeight),
      },
      IFD2: {
        PixelXDimension: String(outputWidth),
        PixelYDimension: String(outputHeight),
      },
    })
    .jpeg({
      quality: 95,
      chromaSubsampling: sourceMetadata.chromaSubsampling ?? '4:2:0',
      progressive: sourceMetadata.isProgressive ?? false,
    })
    .toBuffer();
}

export async function normalizeDamagedImageOrientation(buffer, correctionCCW) {
  try {
    return {
      buffer: await normalizeImageOrientation(buffer, correctionCCW),
      damaged: false,
    };
  } catch (error) {
    return {
      buffer: await normalizeImageOrientation(buffer, correctionCCW, 'none'),
      damaged: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
