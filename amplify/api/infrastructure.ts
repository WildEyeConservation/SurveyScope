import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { IConstruct } from 'constructs';
import { DATA_CHANNELS } from '../../shared/dataChannels';
import { INVOKED_FUNCTIONS } from './operations';

const REFERENCE_MODELS = [
  'AnnotationSet',
  'Category',
  'LocationSet',
  'Location',
  'Image',
  'Transect',
];

function findFunction(root: IConstruct, name: string): lambda.Function {
  const found = root.node
    .findAll()
    .find(
      (c) => c instanceof lambda.Function && c.node.id === `${name}-lambda`,
    );
  if (!found) throw new Error(`No function named ${name}`);
  return found as lambda.Function;
}

// Keep the router's AppSync policy in the api stack to avoid a data/api cycle.
function moveGraphqlAccessPolicy(
  dataStack: Stack,
  stack: Stack,
  role: iam.IRole,
) {
  const policies = dataStack.node.children.filter(
    (c): c is iam.Policy =>
      c instanceof iam.Policy &&
      c.node.id.startsWith('GraphqlAccessPolicy') &&
      (c as unknown as { roles: iam.IRole[] }).roles.includes(role),
  );
  if (policies.length !== 1) {
    throw new Error(
      `Expected one GraphQL access policy for the API router, found ${policies.length}`,
    );
  }
  const [policy] = policies;
  new iam.Policy(stack, 'GraphqlAccess', {
    roles: [role],
    document: policy.document,
  });
  dataStack.node.tryRemoveChild(policy.node.id);
}

export function installApi(props: {
  router: lambda.IFunction;
  publisher: lambda.IFunction;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  tables: Record<string, dynamodb.ITable>;
  graphqlApi: IConstruct;
}) {
  const { router, publisher } = props;
  const stack = Stack.of(router);
  moveGraphqlAccessPolicy(Stack.of(props.graphqlApi), stack, router.role!);

  const leases = new dynamodb.Table(stack, 'TaskLeases', {
    partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'leaseId', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    encryption: dynamodb.TableEncryption.AWS_MANAGED,
    timeToLiveAttribute: 'deleteAfter',
    removalPolicy: RemovalPolicy.DESTROY,
  });
  leases.grantReadWriteData(router);
  (router as lambda.Function).addEnvironment(
    'TASK_LEASES_TABLE',
    leases.tableName,
  );
  // Queue names are free-form; the router checks each queue row first.
  router.addToRolePolicy(
    new iam.PolicyStatement({
      actions: [
        'sqs:ReceiveMessage',
        'sqs:DeleteMessage',
        'sqs:ChangeMessageVisibility',
        'sqs:GetQueueAttributes',
      ],
      resources: ['*'],
    }),
  );

  const referenceTables: Record<string, string> = {};
  for (const model of REFERENCE_MODELS) {
    const table = props.tables[model];
    table.grant(router, 'dynamodb:BatchGetItem');
    referenceTables[model] = table.tableName;
  }
  // Queue counters and activity need atomic and conditional updates.
  props.tables.Queue.grant(router, 'dynamodb:UpdateItem');
  referenceTables.Queue = props.tables.Queue.tableName;
  (router as lambda.Function).addEnvironment(
    'API_TABLES',
    stack.toJsonString(referenceTables),
  );

  const functionNames: Record<string, string> = {};
  for (const name of INVOKED_FUNCTIONS) {
    const fn = findFunction(stack.node.root, name);
    fn.grantInvoke(router);
    // The ARN, which grantInvoke already references, keeps stack parameters down.
    functionNames[name] = fn.functionArn;
  }
  const functionsParameter = new ssm.StringParameter(
    stack,
    'ApiOperationFunctions',
    {
      stringValue: stack.toJsonString(functionNames),
      tier: ssm.ParameterTier.ADVANCED,
    },
  );
  functionsParameter.grantRead(router);
  (router as lambda.Function).addEnvironment(
    'API_OPERATION_FUNCTIONS',
    functionsParameter.parameterName,
  );

  const httpApi = new apigw.HttpApi(stack, 'SurveyScopeApi', {
    corsPreflight: {
      allowOrigins: ['*'],
      allowHeaders: ['authorization', 'content-type'],
      allowMethods: [apigw.CorsHttpMethod.POST],
      maxAge: Duration.hours(1),
    },
  });
  httpApi.addRoutes({
    path: '/{proxy+}',
    methods: [apigw.HttpMethod.POST],
    integration: new HttpLambdaIntegration('Router', router),
    authorizer: new HttpUserPoolAuthorizer('Cognito', props.userPool, {
      userPoolClients: [props.userPoolClient],
    }),
  });

  const events = new appsync.EventApi(stack, 'DataEvents', {
    apiName: `${stack.stackName}-data-events`.slice(0, 50),
    authorizationConfig: {
      authProviders: [
        {
          authorizationType: appsync.AppSyncAuthorizationType.USER_POOL,
          cognitoConfig: { userPool: props.userPool },
        },
        { authorizationType: appsync.AppSyncAuthorizationType.IAM },
      ],
      connectionAuthModeTypes: [appsync.AppSyncAuthorizationType.USER_POOL],
      defaultSubscribeAuthModeTypes: [
        appsync.AppSyncAuthorizationType.USER_POOL,
      ],
      defaultPublishAuthModeTypes: [appsync.AppSyncAuthorizationType.IAM],
    },
  });
  events.addChannelNamespace('data', {
    subscribeHandlerConfig: {
      direct: true,
      dataSource: events.addLambdaDataSource('SubscribeAuthorizer', router),
    },
  });
  events.grantPublish(publisher);
  (publisher as lambda.Function).addEnvironment(
    'EVENTS_HTTP_DOMAIN',
    events.httpDns,
  );

  const tables = Object.keys(DATA_CHANNELS).map((model) => {
    const table = props.tables[model];
    if (!table?.tableStreamArn) throw new Error(`${model} has no stream`);
    return { model, stream: table.tableStreamArn };
  });
  const streamPolicy = new iam.Policy(stack, 'DataEventsStreamPolicy', {
    roles: [publisher.role!],
    statements: [
      new iam.PolicyStatement({
        actions: [
          'dynamodb:DescribeStream',
          'dynamodb:GetRecords',
          'dynamodb:GetShardIterator',
          'dynamodb:ListStreams',
        ],
        resources: tables.map((t) => t.stream),
      }),
    ],
  });
  for (const { model, stream } of tables) {
    const mapping = new lambda.EventSourceMapping(
      stack,
      `${model}DataEventsMapping`,
      {
        target: publisher,
        eventSourceArn: stream,
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 100,
        maxBatchingWindow: Duration.seconds(1),
        retryAttempts: 2,
        bisectBatchOnError: true,
      },
    );
    mapping.node.addDependency(streamPolicy);
  }

  return {
    apiUrl: httpApi.apiEndpoint,
    eventsUrl: `https://${events.httpDns}/event`,
  };
}
