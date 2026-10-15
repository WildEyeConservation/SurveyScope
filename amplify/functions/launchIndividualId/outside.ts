export function assignOutsideImages(
  images: Array<{ id: string; transectId: string | null }>,
  outsideTransectId: string
) {
  const imageToTransect = new Map<string, string>();
  const fanout: Array<{ imageId: string; transectId: string }> = [];
  for (const img of images) {
    imageToTransect.set(img.id, outsideTransectId);
    if (img.transectId !== outsideTransectId) {
      fanout.push({ imageId: img.id, transectId: outsideTransectId });
    }
  }
  return { imageToTransect, fanout };
}

// Older clients only receive new or reassigned outside transects.
export function includeOutsideTransect(
  clientFoundWork: boolean | undefined,
  fresh: boolean
): boolean {
  return clientFoundWork ?? fresh;
}
