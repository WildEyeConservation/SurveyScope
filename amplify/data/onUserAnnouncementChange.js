import { util, extensions } from '@aws-appsync/utils';

export function request(ctx) {
  if (!ctx.identity?.username) util.unauthorized();
  return { payload: null };
}

export function response(ctx) {
  // The recipient comes from verified identity, never a client-supplied filter.
  extensions.setSubscriptionFilter(
    util.transform.toSubscriptionFilter({
      userId: { eq: ctx.identity.username },
    })
  );
  return null;
}
