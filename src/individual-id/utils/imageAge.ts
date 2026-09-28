export function isOlder(
  a: { timestamp?: number | null; originalPath?: string | null },
  b: { timestamp?: number | null; originalPath?: string | null }
): boolean {
  const at = a.timestamp ?? null;
  const bt = b.timestamp ?? null;
  if (at !== null && bt !== null) {
    if (at !== bt) return at < bt;
    // tie: fall through to originalPath
  } else {
    // at least one missing — treat as same-age
    return false;
  }
  if (a.originalPath && b.originalPath) {
    return a.originalPath < b.originalPath;
  }
  return false;
}
