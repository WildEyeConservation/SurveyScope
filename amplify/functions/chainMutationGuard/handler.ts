import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createGuard } from './core';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const tables: Record<string, string> = JSON.parse(process.env.GUARD_TABLES!);
const indexes: Record<string, string> = JSON.parse(process.env.GUARD_INDEXES!);

export const handler = createGuard({
  async get(model, key) {
    return (
      await db.send(
        new GetCommand({
          TableName: tables[model],
          Key: key,
          ConsistentRead: true,
        })
      )
    ).Item;
  },
  async find(model, shareId, field, value) {
    let cursor: Record<string, unknown> | undefined;
    do {
      const page = await db.send(
        new QueryCommand({
          TableName: tables[model],
          IndexName: indexes[model],
          KeyConditionExpression: 'shareId = :share',
          FilterExpression: '#field = :value',
          ExpressionAttributeNames: { '#field': field },
          ExpressionAttributeValues: { ':share': shareId, ':value': value },
          ExclusiveStartKey: cursor,
        })
      );
      if (page.Items?.length) return page.Items[0];
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    return undefined;
  },
  async groups(username) {
    const groups: string[] = [];
    let nextToken: string | undefined;
    do {
      const page = await cognito.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: process.env.USER_POOL_ID,
          Username: username,
          NextToken: nextToken,
        })
      );
      for (const group of page.Groups ?? [])
        if (group.GroupName) groups.push(group.GroupName);
      nextToken = page.NextToken;
    } while (nextToken);
    return groups;
  },
});
