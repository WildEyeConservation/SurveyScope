// Reject URL characters browsers normalize into off-site destinations.
export function sameAppPath(href: string | null): string | undefined {
  if (!href || !href.startsWith('/') || href.startsWith('//')) return undefined;
  for (const char of href) {
    const code = char.charCodeAt(0);
    if (char === '\\' || code <= 0x20 || code === 0x7f) return undefined;
  }
  return href;
}
