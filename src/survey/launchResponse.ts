// The launch Lambdas answer with a { statusCode, body } envelope rather than
// failing the GraphQL call, so a failed launch arrives as a resolved mutation
// and is reported as success unless the envelope is inspected.

export type LaunchMutationResult = {
  data?: unknown;
  errors?: ReadonlyArray<{ message?: string }> | null;
};

export type LaunchResponseBody = Record<string, unknown>;

export function parseLaunchResponse(
  result: LaunchMutationResult | null | undefined,
  description: string,
): LaunchResponseBody {
  const graphqlError = result?.errors?.[0]?.message;
  if (graphqlError) throw new Error(`${description}: ${graphqlError}`);

  const envelope = asObject(result?.data);
  if (!envelope) return {};

  const body = asObject(envelope.body) ?? {};
  const statusCode = envelope.statusCode;
  if (typeof statusCode === 'number' && statusCode !== 200) {
    const reason =
      stringField(body, 'error') ??
      stringField(body, 'message') ??
      `status ${statusCode}`;
    throw new Error(`${description}: ${reason}`);
  }
  return body;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value ? value : undefined;
}
