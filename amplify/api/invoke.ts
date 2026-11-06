import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { Actor } from './access';
import type { Result } from './models';
import type { Row } from './schema';

const lambda = new LambdaClient({});
const ssm = new SSMClient({});
let functionNames: Promise<Record<string, string>> | undefined;

function functionName(fn: string) {
  functionNames ??= ssm
    .send(
      new GetParameterCommand({ Name: process.env.API_OPERATION_FUNCTIONS }),
    )
    .then((r) => JSON.parse(r.Parameter?.Value ?? '{}'));
  return functionNames.then((names) => {
    const name = names[fn];
    if (!name) throw new Error(`No function registered for ${fn}`);
    return name;
  });
}

// Resolve organisation groups from live membership.
export function resolverIdentity(actor: Actor, organizationIds: string[]) {
  const kept = actor.groups.filter(
    (g) => g === 'sysadmin' || g === 'orgadmin' || g.startsWith('chainshare-'),
  );
  return {
    sub: actor.sub,
    username: actor.username,
    groups: [...new Set([...kept, ...organizationIds])],
    claims: actor.claims,
    issuer: actor.claims.iss,
    sourceIp: [],
    defaultAuthStrategy: 'ALLOW',
  };
}

export async function invokeFunction(
  fn: string,
  payload: unknown,
  async = false,
) {
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: await functionName(fn),
      InvocationType: async ? 'Event' : 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );
  const body = response.Payload
    ? Buffer.from(response.Payload).toString('utf8')
    : '';
  return {
    failed: Boolean(response.FunctionError),
    result: body ? JSON.parse(body) : null,
  };
}

export async function invokeResolver(
  fn: string,
  payload: {
    typeName: 'Query' | 'Mutation';
    fieldName: string;
    arguments: Row;
    identity: ReturnType<typeof resolverIdentity>;
  },
  async = false,
): Promise<Result> {
  const event = {
    ...payload,
    source: null,
    request: { headers: {}, domainName: null },
    info: {
      fieldName: payload.fieldName,
      parentTypeName: payload.typeName,
      variables: {},
      selectionSetList: [],
      selectionSetGraphQL: '',
    },
    prev: null,
    stash: {},
  };
  const { failed, result } = await invokeFunction(fn, event, async);
  if (async) return { data: { success: true } };
  if (failed) {
    return {
      data: null,
      errors: [
        {
          errorType: result?.errorType ?? 'Lambda:Unhandled',
          message: result?.errorMessage ?? 'The operation failed',
        },
      ],
    };
  }
  return { data: result };
}
