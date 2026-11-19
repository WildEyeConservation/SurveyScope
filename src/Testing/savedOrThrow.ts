// Data writes report failures as values; a test's answer key must not be half saved.
export function savedOrThrow(
  result: { data?: unknown; errors?: { message?: string }[] } | undefined,
  what: string,
) {
  if (!result?.data || result.errors?.length) {
    const reason = result?.errors?.map((e) => e.message).join('; ');
    throw new Error(`Could not ${what}${reason ? `: ${reason}` : ''}`);
  }
}
