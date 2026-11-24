import sharp from 'sharp';

// The tiles are already lossy, so a second encode must lose little more.
const CROP_WEBP = { quality: 95, smartSubsample: true };

export async function composeCrop(size, pieces) {
  const layers = [];
  for (const piece of pieces) {
    const input = Buffer.from(piece.bytes);
    const { width = 0, height = 0 } = await sharp(input).metadata();
    const left = Math.max(0, piece.left);
    const top = Math.max(0, piece.top);
    const right = Math.min(size, piece.left + width);
    const bottom = Math.min(size, piece.top + height);
    if (right <= left || bottom <= top) continue;
    layers.push({
      input: await sharp(input)
        .extract({
          left: left - piece.left,
          top: top - piece.top,
          width: right - left,
          height: bottom - top,
        })
        .toBuffer(),
      left,
      top,
    });
  }
  const { data, info } = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Any gap would show where the image ends, so such crops are refused.
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return null;
  return sharp(data, { raw: info }).removeAlpha().webp(CROP_WEBP).toBuffer();
}

export async function cutCrop({ raw, info }, crop) {
  if (
    crop.left < 0 ||
    crop.top < 0 ||
    crop.left + crop.width > info.width ||
    crop.top + crop.height > info.height
  ) {
    return null;
  }
  return sharp(raw, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .extract(crop)
    .removeAlpha()
    .webp(CROP_WEBP)
    .toBuffer();
}
