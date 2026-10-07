import { util } from '@aws-appsync/utils';

export function request(ctx) {
  // Authoritative sysadmin check. Readers share this return type for subscriptions.
  if (!ctx.identity?.claims?.['cognito:groups']?.includes('sysadmin'))
    util.unauthorized();
  const personal = ctx.info.fieldName === 'setUserAnnouncement';
  const userId = personal ? ctx.args.userId : null;
  if (personal && (!userId || userId.length > 128))
    util.error('Choose a valid recipient.', 'ValidationError');
  const { expectedRevision, messageType, publishAt, denyAccessAt } = ctx.args;
  const message = ctx.args.message.trim();
  if (expectedRevision < 0 || message.length > 2000)
    util.error('Invalid revision or message length.', 'ValidationError');
  if (!['update', 'information', 'warning'].includes(messageType))
    util.error('Invalid message type.', 'ValidationError');
  if (message && !publishAt)
    util.error('Choose when to show the message.', 'ValidationError');
  if (!message && (publishAt || denyAccessAt))
    util.error(
      'A scheduled announcement requires a message.',
      'ValidationError'
    );
  if (
    denyAccessAt &&
    (!publishAt ||
      util.time.parseISO8601ToEpochMilliSeconds(denyAccessAt) <
        util.time.parseISO8601ToEpochMilliSeconds(publishAt))
  ) {
    util.error(
      'Access cannot close before the announcement.',
      'ValidationError'
    );
  }
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      id: personal ? `user:${userId}` : 'global',
    }),
    attributeValues: util.dynamodb.toMapValues({
      ...(personal ? { userId } : {}),
      revision: expectedRevision + 1,
      message,
      messageType,
      publishAt: publishAt || null,
      denyAccessAt: denyAccessAt || null,
      updatedBy: ctx.identity.sub,
      updatedAt: util.time.nowISO8601(),
    }),
    condition: {
      expression:
        expectedRevision === 0
          ? 'attribute_not_exists(id)'
          : '#revision = :expected',
      ...(expectedRevision === 0
        ? {}
        : {
            expressionNames: { '#revision': 'revision' },
            expressionValues: util.dynamodb.toMapValues({
              ':expected': expectedRevision,
            }),
          }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return { ...ctx.result, serverTime: util.time.nowISO8601() };
}
