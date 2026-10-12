// A null scan result is a failed file.
export async function sampleSuccessfulScans<T, U>(
  files: T[],
  sampleSize: number,
  scan: (file: T) => Promise<U | null>
): Promise<{ sample: U[]; consumed: number }> {
  const sample: U[] = [];
  let consumed = 0;
  while (sample.length < sampleSize && consumed < files.length) {
    const batch = files.slice(consumed, consumed + sampleSize);
    consumed += batch.length;
    const results = await Promise.all(batch.map(scan));
    sample.push(...results.filter((r): r is Awaited<U> => r !== null));
  }
  return { sample, consumed };
}
