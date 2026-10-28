import type { CreateOrganizationHandler } from '../../data/resource';
import { env } from '$amplify/env/createOrganization';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  CreateGroupCommand,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';

const createOrganizationMutation = /* GraphQL */ `
  mutation CreateOrganization($input: CreateOrganizationInput!) {
    createOrganization(input: $input) { id name group }
  }
`;

const createOrganizationMembershipMutation = /* GraphQL */ `
  mutation CreateOrganizationMembership($input: CreateOrganizationMembershipInput!) {
    createOrganizationMembership(input: $input) { organizationId userId group }
  }
`;

const updateOrganizationRegistrationMutation = /* GraphQL */ `
  mutation UpdateOrganizationRegistration($input: UpdateOrganizationRegistrationInput!) {
    updateOrganizationRegistration(input: $input) { id status }
  }
`;

Amplify.configure(
  {
    API: {
      GraphQL: {
        endpoint: env.AMPLIFY_DATA_GRAPHQL_ENDPOINT,
        region: env.AWS_REGION,
        defaultAuthMode: 'iam',
      },
    },
  },
  {
    Auth: {
      credentialsProvider: {
        getCredentialsAndIdentityId: async () => ({
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            sessionToken: env.AWS_SESSION_TOKEN,
          },
        }),
        clearCredentialsAndIdentityId: () => {
          /* noop */
        },
      },
    },
  }
);

const gqlClient = generateClient({ authMode: 'iam' });
const cognitoClient = new CognitoIdentityProviderClient();

async function executeGraphql<T>(
  query: string,
  variables: Record<string, any>
): Promise<T> {
  const response = (await gqlClient.graphql({
    query,
    variables,
  } as any)) as GraphQLResult<T>;
  if (response.errors && response.errors.length > 0) {
    throw new Error(
      `GraphQL error: ${JSON.stringify(response.errors.map((err) => err.message))}`
    );
  }
  if (!response.data) {
    throw new Error('GraphQL response missing data');
  }
  return response.data;
}

export const handler: CreateOrganizationHandler = async (event) => {
  try {
    console.log('Invoked createOrganization with event:', JSON.stringify(event));
    const { name, description, adminEmail, registrationId } = event.arguments;

    // 1. Look up user by email in Cognito
    const listResult = await cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
        Filter: `email = "${adminEmail}"`,
        Limit: 1,
      })
    );

    const cognitoUser = listResult.Users?.[0];
    if (!cognitoUser?.Username) {
      throw new Error(`User with email ${adminEmail} not found`);
    }
    const userId = cognitoUser.Username;

    // 2. Generate UUID and create Organization
    const orgId = randomUUID();
    await executeGraphql(createOrganizationMutation, {
      input: { id: orgId, name, description, group: orgId },
    });

    // 3. Create Cognito group = org ID
    await cognitoClient.send(
      new CreateGroupCommand({
        GroupName: orgId,
        UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
      })
    );

    // 4. Add admin user to Cognito group
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        Username: userId,
        GroupName: orgId,
        UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
      })
    );

    // 5. Create OrganizationMembership
    await executeGraphql(createOrganizationMembershipMutation, {
      input: {
        organizationId: orgId,
        userId,
        isAdmin: true,
        group: orgId,
      },
    });

    // 6. If registrationId, approve the registration
    if (registrationId) {
      await executeGraphql(updateOrganizationRegistrationMutation, {
        input: { id: registrationId, status: 'approved' },
      });
    }

    console.log(`Organization ${orgId} created successfully for ${adminEmail}`);
    return JSON.stringify({ success: true, organizationId: orgId });
  } catch (err) {
    console.error('createOrganization failed:', err instanceof Error ? err.message : String(err));
    throw err instanceof Error ? err : new Error(String(err));
  }
};
