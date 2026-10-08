type ErrorList = readonly { message?: string }[];

interface ExistingObservation {
  annotationSetId?: string | null;
  locationId?: string | null;
  queueId?: string | null;
}

interface PersistObservationArgs {
  create: () => Promise<{ data?: unknown; errors?: ErrorList }>;
  /** Looks up the row by its deterministic ID; omitted when there is none. */
  getExisting?: () => Promise<{ data?: ExistingObservation | null }>;
  expected: { annotationSetId: string; locationId: string; queueId?: string };
  isGraphQLError: (error: unknown) => error is { errors: unknown };
}

function describeErrors(errors: ErrorList | undefined) {
  return errors
    ?.map((error) => error.message || 'Unknown GraphQL error')
    .join('; ');
}

export async function persistObservation({
  create,
  getExisting,
  expected,
  isGraphQLError,
}: PersistObservationArgs): Promise<void> {
  let errors: ErrorList | undefined;
  try {
    const created = await create();
    if (created.data) return;
    errors = created.errors;
  } catch (error) {
    if (!isGraphQLError(error)) throw error;
    errors = Array.isArray(error.errors) ? error.errors : undefined;
  }

  // A lost response after a successful write is indistinguishable from a
  // failed create. Queued observations use a deterministic ID, so a strongly
  // identified existing row proves persistence and makes the client retry safe.
  const existing = (await getExisting?.())?.data;
  if (
    existing &&
    existing.annotationSetId === expected.annotationSetId &&
    existing.locationId === expected.locationId &&
    (existing.queueId ?? undefined) === (expected.queueId ?? undefined)
  ) {
    return;
  }

  throw new Error(
    `Failed to persist observation: ${
      describeErrors(errors) || 'no row returned'
    }`
  );
}
