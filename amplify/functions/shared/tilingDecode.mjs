import sharp from 'sharp';

// Truncated JPEGs tile with grey fill instead of failing the whole image.
export function decodeForTiling(buffer) {
  return sharp(buffer, { failOn: 'none' }).rotate();
}
