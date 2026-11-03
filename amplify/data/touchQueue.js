import { util } from '@aws-appsync/utils'

export function request(ctx) {
  const groups = (ctx.identity && ctx.identity.groups) || []
  const now = util.time.nowEpochMilliSeconds()
  const names = {}
  const values = {
    ':since': util.time.epochMilliSecondsToISO8601(now - 60 * 60 * 1000),
  }
  let access = ''
  if (!groups.includes('sysadmin')) {
    if (groups.length === 0) util.unauthorized()
    names['#group'] = 'group'
    groups.forEach((group, i) => {
      values[`:g${i}`] = group
    })
    access = ` AND #group IN (${groups.map((_, i) => `:g${i}`).join(', ')})`
  }
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ id: ctx.args.id }),
    update: {
      expression: 'SET lastAccessedAt = :now REMOVE inactivityWarnedAt, cancelAfter',
      expressionValues: util.dynamodb.toMapValues({
        ':now': util.time.epochMilliSecondsToISO8601(now),
      }),
    },
    condition: {
      expression:
        'attribute_exists(id) AND (attribute_not_exists(lastAccessedAt) OR lastAccessedAt < :since OR attribute_exists(cancelAfter))' +
        access,
      expressionNames: names,
      expressionValues: util.dynamodb.toMapValues(values),
    },
  }
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') return false
    util.error(ctx.error.message, ctx.error.type)
  }
  return true
}
