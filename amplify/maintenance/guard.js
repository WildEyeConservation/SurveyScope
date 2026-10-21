import { util, runtime } from '@aws-appsync/utils';

export function request(ctx) {
  // Trusted service IAM callers must be able to finish background jobs. Browser
  // identity-pool callers do not receive this exemption.
  const service =
    util.authType() === 'IAM Authorization' && !ctx.identity?.cognitoIdentityId;
  const sysadmin =
    ctx.identity?.claims?.['cognito:groups']?.includes('sysadmin');
  if (service || sysadmin) runtime.earlyReturn(ctx.prev.result);
  if (!ctx.identity?.username) util.unauthorized();
  return {
    operation: 'BatchGetItem',
    tables: {
      [ctx.env.MAINTENANCE_TABLE]: {
        keys: ['global', `user:${ctx.identity.username}`].map((id) =>
          util.dynamodb.toMapValues({ id })
        ),
        consistentRead: true,
      },
    },
  };
}

export function response(ctx) {
  const table = ctx.env.MAINTENANCE_TABLE;
  const states = ctx.result?.data?.[table];
  if (
    ctx.error ||
    !states ||
    states.length !== 2 ||
    ctx.result?.unprocessedKeys?.[table]?.length
  )
    util.error(
      'Unable to check application availability.',
      'MaintenanceUnavailable'
    );
  for (const state of states) {
    if (
      state?.denyAccessAt &&
      util.time.parseISO8601ToEpochMilliSeconds(state.denyAccessAt) <=
        util.time.nowEpochMilliSeconds()
    ) {
      util.error(
        'Your access to SurveyScope is temporarily paused.',
        'MaintenanceInProgress'
      );
    }
  }
  return ctx.prev.result;
}
