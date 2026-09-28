export const SHARE_OPERATION_TIMEOUT_MS = 16 * 60 * 1000;
export type ShareState = {
  shareId: string;
  status?: string | null;
  operationStartedAt?: string | null;
};
export type GraphRequest = { query: string; variables?: Record<string, unknown> };
export type GraphResponse = { data?: Record<string, unknown> | null; errors?: ReadonlyArray<{ message: string }> };
export type GraphRun = (request: GraphRequest) => Promise<GraphResponse>;

function errorsMessage(errors: ReadonlyArray<{ message: string }>): string {
  return errors.map((e) => e.message).join('; ');
}

// A null mutation result means the write did not happen; a null query result
// is a legitimate "not found" that callers handle themselves.
export function checkedGraph(run: GraphRun): GraphRun {
  return async (request) => {
    let response: GraphResponse;
    try {
      response = await run(request);
    } catch (error) {
      // The Amplify client throws the raw { data, errors } response.
      const errors = (error as GraphResponse | null)?.errors;
      if (!(error instanceof Error) && errors?.length) throw new Error(errorsMessage(errors));
      throw error;
    }
    if (response.errors?.length) throw new Error(errorsMessage(response.errors));
    const isMutation = /^\s*mutation\b/.test(request.query);
    if (!response.data || (isMutation && Object.values(response.data).some((value) => value == null))) {
      throw new Error('Share operation returned no data');
    }
    return response;
  };
}

const getShare = `query ShareState($shareId: ID!) {
  getChainShare(shareId: $shareId) { shareId status operationStartedAt }
}`;
const updateShare = `mutation ShareState($input: UpdateChainShareInput!, $condition: ModelChainShareConditionInput) {
  updateChainShare(input: $input, condition: $condition) { shareId status operationStartedAt }
}`;
const createShare = `mutation ShareState($input: CreateChainShareInput!) {
  createChainShare(input: $input) { shareId status operationStartedAt }
}`;

export function isShareOperationBusy(share: ShareState, now = Date.now()): boolean {
  if (!['creating', 'revoking'].includes(share.status ?? '')) return false;
  const started = Date.parse(share.operationStartedAt ?? '');
  return Number.isFinite(started) && now - started < SHARE_OPERATION_TIMEOUT_MS;
}

export function shareLifecycle(run: GraphRun, now = () => new Date().toISOString()) {
  const change = (shareId: string, status: string, started: string, input: Record<string, unknown>) => run({
    query: updateShare,
    variables: {
      input: { shareId, ...input },
      condition: { and: [{ status: { eq: status } }, { operationStartedAt: { eq: started } }] },
    },
  });
  return {
    async create(input: Record<string, unknown>) {
      const started = now();
      await run({ query: createShare, variables: { input: {
        ...input, status: 'creating', operationStartedAt: started, group: null, errorMessage: null,
      } } });
      return started;
    },
    activate(shareId: string, started: string) {
      return change(shareId, 'creating', started, {
        status: 'active', group: `chainshare-${shareId}`, operationStartedAt: null, errorMessage: null,
      });
    },
    failCreation(shareId: string, started: string, error: unknown) {
      return change(shareId, 'creating', started, {
        status: 'failed', group: null, operationStartedAt: null,
        errorMessage: String(error instanceof Error ? error.message : error).slice(0, 2000),
      });
    },
    async revoke(shareId: string) {
      const response = await run({ query: getShare, variables: { shareId } });
      const share = response.data?.getChainShare as ShareState | undefined;
      if (!share) throw new Error('Share not found');
      if (share.status === 'revoked') return null;
      if (isShareOperationBusy(share, Date.parse(now()))) {
        throw new Error('Share operation is still running. Refresh to check its status.');
      }
      const started = now();
      await run({ query: updateShare, variables: {
        input: { shareId, status: 'revoking', group: null, operationStartedAt: started, errorMessage: null },
        condition: { and: [
          { status: share.status == null ? { attributeExists: false } : { eq: share.status } },
          { operationStartedAt: share.operationStartedAt == null ? { attributeExists: false } : { eq: share.operationStartedAt } },
        ] },
      } });
      return started;
    },
    finishRevocation(shareId: string, started: string) {
      return change(shareId, 'revoking', started, {
        status: 'revoked', operationStartedAt: null, errorMessage: null, group: null,
      });
    },
    failRevocation(shareId: string, started: string, error: unknown) {
      return change(shareId, 'revoking', started, {
        status: 'cleanupFailed', operationStartedAt: null, group: null,
        errorMessage: String(error instanceof Error ? error.message : error).slice(0, 2000),
      });
    },
  };
}

/** Wait for every writer to stop before recording failure or allowing cleanup. */
export async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;
  let failure: unknown;
  let failed = false;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && cursor < items.length) {
      const item = items[cursor++];
      try { await fn(item); } catch (error) { failed = true; failure = error; }
    }
  });
  await Promise.all(workers);
  if (failed) throw failure;
}
