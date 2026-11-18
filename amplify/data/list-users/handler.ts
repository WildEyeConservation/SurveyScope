import type { ListUsersHandler } from "../resource"
import { env } from "$amplify/env/list-users"
import {
  ListUsersCommand,
  ListUsersInGroupCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider"
import type { UserType as CognitoUserType } from "@aws-sdk/client-cognito-identity-provider"

const SYSTEM_GROUPS = new Set(["sysadmin", "orgadmin"])

type Handler = ListUsersHandler
const client = new CognitoIdentityProviderClient()

function mapUser(user: CognitoUserType) {
  return {
    id: user.Username,
    name: user.Attributes?.find((attr) => attr.Name === "preferred_username")?.Value,
    email: user.Attributes?.find((attr) => attr.Name === "email")?.Value,
    isAdmin: user.Attributes?.find((attr) => attr.Name === "custom:isAdmin")?.Value === "true",
  }
}

async function listAllUsers(nextToken?: string | null) {
  const command = new ListUsersCommand({
    UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
    PaginationToken: nextToken || undefined,
  })
  const response = await client.send(command)
  return {
    Users: response.Users?.map(mapUser) as any,
    NextToken: response.PaginationToken || null,
  }
}

async function listUsersInGroup(groupName: string): Promise<CognitoUserType[]> {
  const users: CognitoUserType[] = []
  let nextToken: string | undefined
  do {
    const command = new ListUsersInGroupCommand({
      UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
      GroupName: groupName,
      NextToken: nextToken,
    })
    const response = await client.send(command)
    if (response.Users) {
      users.push(...response.Users)
    }
    nextToken = response.NextToken
  } while (nextToken)
  return users
}

export const handler: Handler = async (event) => {
  const groups = event.identity?.groups

  // No identity (API key / Lambda-to-Lambda) → full user list
  if (!event.identity) {
    return listAllUsers(event.arguments.nextToken)
  }

  // Sysadmin → full user list
  if (groups?.includes("sysadmin")) {
    return listAllUsers(event.arguments.nextToken)
  }

  // Extract org IDs (non-system groups)
  // Chain share reviewer groups are not organisations.
  const orgIds = (groups ?? []).filter(
    (g) => !SYSTEM_GROUPS.has(g) && !g.startsWith("chainshare-")
  )

  // No org groups → empty list
  if (orgIds.length === 0) {
    return { Users: [] as any, NextToken: null }
  }

  // Fetch users from each org group and deduplicate
  const allOrgUsers = await Promise.all(orgIds.map(listUsersInGroup))
  const seen = new Set<string>()
  const deduped: CognitoUserType[] = []
  for (const orgUsers of allOrgUsers) {
    for (const user of orgUsers) {
      if (user.Username && !seen.has(user.Username)) {
        seen.add(user.Username)
        deduped.push(user)
      }
    }
  }

  return {
    Users: deduped.map(mapUser) as any,
    NextToken: null,
  }
}
