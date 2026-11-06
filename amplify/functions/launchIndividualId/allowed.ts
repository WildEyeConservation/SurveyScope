// Null when the client sent no incomplete set, so every transect is allowed.
export function allowedTransectIds(
  payload: { incompleteTransectIds?: string[]; incompleteImageIds?: string[] },
  imageToTransect: Map<string, string>,
): Set<string> | null {
  const { incompleteTransectIds, incompleteImageIds } = payload;
  if (
    !Array.isArray(incompleteTransectIds) &&
    !Array.isArray(incompleteImageIds)
  )
    return null;
  const allow = new Set(incompleteTransectIds ?? []);
  for (const imageId of incompleteImageIds ?? []) {
    const transectId = imageToTransect.get(imageId);
    if (transectId) allow.add(transectId);
  }
  return allow;
}
