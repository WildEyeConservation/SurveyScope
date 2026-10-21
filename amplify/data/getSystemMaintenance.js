import { util } from '@aws-appsync/utils';

function recipient(ctx) {
  if (ctx.info.fieldName !== 'getUserAnnouncement') return null;
  const ownId = ctx.identity?.username;
  const userId = ctx.args.userId || ownId;
  if (
    !ownId ||
    (userId !== ownId &&
      !ctx.identity?.claims?.['cognito:groups']?.includes('sysadmin'))
  )
    util.unauthorized();
  return userId;
}

export function request(ctx) {
  const userId = recipient(ctx);
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      id: userId ? `user:${userId}` : 'global',
    }),
    consistentRead: true,
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const userId = recipient(ctx);
  return {
    ...(userId ? { userId } : {}),
    ...(ctx.result || {
      revision: 0,
      message: '',
      messageType: 'update',
      publishAt: null,
      denyAccessAt: null,
    }),
    serverTime: util.time.nowISO8601(),
  };
}
