import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { addUserToGroup } from './functions/add-user-to-group/resource';
import { ArnFormat, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { outputBucket, inputBucket } from './storage/resource';
import { generateTile } from './storage/generateTile/resource';
import { handleS3Upload } from './storage/handleS3Upload/resource';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { AutoProcessor } from './autoProcessor';
import { postDeploy } from './functions/postDeploy/resource';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { updateUserStats } from './functions/updateUserStats/resource';
import { Policy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StartingPosition, EventSourceMapping } from 'aws-cdk-lib/aws-lambda';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { monitorModelProgress } from './functions/monitorModelProgress/resource';
import { cleanupJobs } from './functions/cleanupJobs/resource';
import { runImageRegistration } from './functions/runImageRegistration/resource';
import { runScoutbot } from './functions/runScoutbot/resource';
import { runMadDetector } from './functions/runMadDetector/resource';
import { runStormflyDetector } from './functions/runStormflyDetector/resource';
import { runOwlDDetector } from './functions/runOwlDDetector/resource';
import { runElephantDetector } from './functions/runElephantDetector/resource';
import { launchAnnotationSet } from './functions/launchAnnotationSet/resource';
import { launchFalseNegatives } from './functions/launchFalseNegatives/resource';
import { requeueProjectQueues } from './functions/requeueProjectQueues/resource';
import { monitorScoutbotDlq } from './functions/monitorScoutbotDlq/resource';
import { processTilingBatch } from './functions/processTilingBatch/resource';
import { monitorTilingTasks } from './functions/monitorTilingTasks/resource';
import { findAndRequeueMissingLocations } from './functions/findAndRequeueMissingLocations/resource';
import { reconcileFalseNegatives } from './functions/reconcileFalseNegatives/resource';
import { createOrganization } from './functions/createOrganization/resource';
import { inviteUserToOrganization } from './functions/inviteUserToOrganization/resource';
import { respondToInvite } from './functions/respondToInvite/resource';
import { removeUserFromOrganization } from './functions/removeUserFromOrganization/resource';
import { updateOrganizationMemberAdmin } from './functions/updateOrganizationMemberAdmin/resource';
import { deleteQueue } from './functions/deleteQueue/resource';
import { updateActiveOrganizations } from './functions/updateActiveOrganizations/resource';
import { launchQCReview } from './functions/launchQCReview/resource';
import { launchInfoTags } from './functions/launchInfoTags/resource';
import { launchHomography } from './functions/launchHomography/resource';
import { reconcileHomographies } from './functions/reconcileHomographies/resource';
import { registrationBucketCleanup } from './functions/registrationBucketCleanup/resource';
import { deleteRegistrationNeighbour } from './functions/deleteRegistrationNeighbour/resource';
import { processRegistrationStream } from './functions/processRegistrationStream/resource';
import { pretileImage } from './functions/pretileImage/resource';
import { refreshTiles } from './functions/refreshTiles/resource';
import { reconcilePretileLaunches } from './functions/reconcilePretileLaunches/resource';
import { extendTileLifecycles } from './functions/extendTileLifecycles/resource';
import { launchIndividualId } from './functions/launchIndividualId/resource';
import { updateImageTransect } from './functions/updateImageTransect/resource';
import { claimIndividualIdTransect } from './functions/claimIndividualIdTransect/resource';
import { completeIndividualIdTransect } from './functions/completeIndividualIdTransect/resource';
import { reconcileIndividualId } from './functions/reconcileIndividualId/resource';
import { releaseIndividualIdTransects } from './functions/releaseIndividualIdTransects/resource';
import { generateSurveyResults } from './functions/generateSurveyResults/resource';
import { queryWorkflowStats } from './functions/queryWorkflowStats/resource';
import { recordWorkflowTask } from './functions/recordWorkflowTask/resource';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Duration } from 'aws-cdk-lib';
import {
  SqsDlq,
  SqsEventSource,
} from 'aws-cdk-lib/aws-lambda-event-sources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

const backend = defineBackend({
  auth,
  data,
  addUserToGroup,
  outputBucket,
  inputBucket,
  generateTile,
  handleS3Upload,
  postDeploy,
  updateUserStats,
  monitorModelProgress,
  runImageRegistration,
  runScoutbot,
  runMadDetector,
  runStormflyDetector,
  runOwlDDetector,
  runElephantDetector,
  cleanupJobs,
  launchAnnotationSet,
  launchFalseNegatives,
  requeueProjectQueues,
  monitorScoutbotDlq,
  processTilingBatch,
  monitorTilingTasks,
  findAndRequeueMissingLocations,
  reconcileFalseNegatives,
  createOrganization,
  inviteUserToOrganization,
  respondToInvite,
  removeUserFromOrganization,
  updateOrganizationMemberAdmin,
  deleteQueue,
  updateActiveOrganizations,
  launchQCReview,
  launchInfoTags,
  launchHomography,
  reconcileHomographies,
  registrationBucketCleanup,
  deleteRegistrationNeighbour,
  processRegistrationStream,
  pretileImage,
  refreshTiles,
  reconcilePretileLaunches,
  extendTileLifecycles,
  launchIndividualId,
  updateImageTransect,
  claimIndividualIdTransect,
  completeIndividualIdTransect,
  reconcileIndividualId,
  releaseIndividualIdTransects,
  generateSurveyResults,
  queryWorkflowStats,
  recordWorkflowTask,
});

const userPoolClient = backend.auth.resources.cfnResources.cfnUserPoolClient;
userPoolClient.accessTokenValidity = 24 * 60;
userPoolClient.idTokenValidity = 24 * 60;
userPoolClient.tokenValidityUnits = {
  accessToken: 'minutes',
  idToken: 'minutes',
  refreshToken: 'days',
};

const observationTable = backend.data.resources.tables['Observation'];
const statsDataStack = Stack.of(observationTable);
const statsFunction = backend.updateUserStats.resources.lambda;
const statsFunctionStack = Stack.of(statsFunction);
const statsReceiptTable = new dynamodb.Table(
  statsFunctionStack,
  'StatsEventReceiptTable',
  {
    partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    encryption: dynamodb.TableEncryption.AWS_MANAGED,
    timeToLiveAttribute: 'expiresAt',
    pointInTimeRecovery: true,
    removalPolicy: RemovalPolicy.RETAIN,
  }
);
backend.updateUserStats.addEnvironment(
  'STATS_RECEIPT_TABLE',
  statsReceiptTable.tableName
);
// The UserStats and Queue table names are deliberately NOT injected here. The
// data stack already references this function (the Observation stream mapping
// below), so any function-stack reference to data-stack outputs is a circular
// nested-stack dependency. The handler derives the table names from each
// stream record's eventSourceARN instead, which carries the real
// Observation-<apiId>-NONE table name.

// This stack must depend on nothing: the data stack (stream mapping failure
// destination), the function stack (alarm actions), and the workflow stats
// stack (alarm actions) all import from it, so any reference out of it would
// create a nested-stack cycle.
const statsReliabilityStack = backend.createStack('DetwebStatsReliability');

// Synth-time gate: set STATS_ALARM_EMAIL in the Amplify branch environment
// (comma-separated for several recipients) to route every statistics alarm to
// email. Unset, the alarms still exist but have no action.
const statsAlarmEmails = [
  ...new Set(
    (process.env.STATS_ALARM_EMAIL ?? '')
      .split(',')
      .map((address) => address.trim())
      .filter((address) => address !== '')
  ),
];
// Fail the build rather than deploy a silently unmonitored pipeline: a typo
// entered in the console would otherwise be indistinguishable from working
// alerting until the day an alarm needed to reach someone.
for (const address of statsAlarmEmails) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new Error(
      `STATS_ALARM_EMAIL contains an invalid address: "${address}"`
    );
  }
}
const statsAlarmTopic = statsAlarmEmails.length
  ? new sns.Topic(statsReliabilityStack, 'StatsAlarmTopic', {
      displayName: 'Detweb statistics alarms',
    })
  : undefined;
for (const address of statsAlarmEmails) {
  statsAlarmTopic?.addSubscription(
    new snsSubscriptions.EmailSubscription(address)
  );
}
const withStatsAlarmAction = (alarm: cloudwatch.Alarm): cloudwatch.Alarm => {
  if (statsAlarmTopic) {
    const action = new cloudwatchActions.SnsAction(statsAlarmTopic);
    alarm.addAlarmAction(action);
    // Recovery matters as much as failure when nobody is watching: without an
    // OK action, a self-clearing alarm looks the same as an unresolved one.
    alarm.addOkAction(action);
  }
  return alarm;
};

// Failure destination for the legacy UserStats stream mapping. The handler
// throws on any record failure; without a retry bound one permanently bad
// record (for example an Observation whose Project lost its organization)
// would stall UserStats and Queue progress for its whole shard until the
// record ages out of the 24-hour stream.
const userStatsFailureQueue = new sqs.Queue(
  statsReliabilityStack,
  'UserStatsStreamFailures',
  {
    encryption: sqs.QueueEncryption.SQS_MANAGED,
    enforceSSL: true,
    retentionPeriod: Duration.days(14),
    removalPolicy: RemovalPolicy.RETAIN,
  }
);
withStatsAlarmAction(
  new cloudwatch.Alarm(statsReliabilityStack, 'UserStatsStreamFailuresVisible', {
    metric: userStatsFailureQueue.metricApproximateNumberOfMessagesVisible({
      period: Duration.minutes(5),
    }),
    threshold: 1,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  })
);

const streamPolicy = new Policy(
  statsDataStack,
  'MyDynamoDBFunctionStreamingPolicy',
  {
    statements: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:DescribeStream',
          'dynamodb:GetRecords',
          'dynamodb:GetShardIterator',
          'dynamodb:ListStreams',
        ],
        resources: ['*'],
      }),
    ],
  }
);
statsFunction.role?.attachInlinePolicy(streamPolicy);

const userStatsTableArn = statsFunctionStack.formatArn({
  service: 'dynamodb',
  resource: 'table',
  resourceName: 'UserStats-*',
});
const queueTableArn = statsFunctionStack.formatArn({
  service: 'dynamodb',
  resource: 'table',
  resourceName: 'Queue-*',
});
const statsWritePolicy = new Policy(
  statsFunctionStack,
  'UpdateUserStatsDynamoDBPolicy',
  {
    statements: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
        ],
        resources: [
          statsReceiptTable.tableArn,
          userStatsTableArn,
          queueTableArn,
        ],
      }),
    ],
  }
);
statsFunction.role?.attachInlinePolicy(statsWritePolicy);

const mapping1 = new EventSourceMapping(
  statsDataStack,
  'ObservationEventStreamMapping',
  {
    target: statsFunction,
    eventSourceArn: observationTable.tableStreamArn,
    startingPosition: StartingPosition.LATEST,
    // The handler throws on the first failed record. Bisection isolates a
    // poison record instead of letting it block the shard, the retry bound
    // hands it to the failure queue, and transaction receipts make the
    // replayed healthy records idempotent.
    bisectBatchOnError: true,
    retryAttempts: 10,
    maxRecordAge: Duration.hours(24),
    onFailure: new SqsDlq(userStatsFailureQueue),
  }
);
mapping1.node.addDependency(streamPolicy);

// Error-count alarms describe sustained degradation, not individual failures:
// this consumer processes ~50k records a day and retries transient faults
// internally, so a single self-healing error must not page anyone. The
// authoritative "something was actually lost" signals are the failure-queue
// depth alarms below, which stay deliberately hair-trigger.
withStatsAlarmAction(
  new cloudwatch.Alarm(statsFunctionStack, 'UpdateUserStatsErrors', {
    metric: statsFunction.metricErrors({ period: Duration.minutes(5) }),
    threshold: 5,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  })
);
withStatsAlarmAction(
  new cloudwatch.Alarm(statsFunctionStack, 'UpdateUserStatsIteratorAge', {
    metric: statsFunction.metric('IteratorAge', {
      period: Duration.minutes(5),
      statistic: 'Maximum',
    }),
    threshold: 15 * 60 * 1000,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  })
);

const backfillStack = backend.createStack('BackfillLocationGroup');
const locationTable = backend.data.resources.tables['Location'];
const projectTable = backend.data.resources.tables['Project'];

const backfillFn = new NodejsFunction(backfillStack, 'BackfillLocationGroupFn', {
  entry: path.join(__dirname, 'functions/backfillLocationGroup/handler.ts'),
  handler: 'handler',
  runtime: lambda.Runtime.NODEJS_20_X,
  environment: {
    LOCATION_TABLE_NAME: locationTable.tableName,
    PROJECT_TABLE_NAME: projectTable.tableName,
  },
});

backfillFn.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:Query',
    ],
    resources: [locationTable.tableArn, `${locationTable.tableArn}/index/*`],
  })
);
backfillFn.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['dynamodb:GetItem', 'dynamodb:Query'],
    resources: [projectTable.tableArn, `${projectTable.tableArn}/index/*`],
  })
);
backfillFn.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'dynamodb:DescribeStream',
      'dynamodb:GetRecords',
      'dynamodb:GetShardIterator',
      'dynamodb:ListStreams',
    ],
    resources: ['*'],
  })
);

new EventSourceMapping(backfillStack, 'LocationEventStreamMapping', {
  target: backfillFn,
  eventSourceArn: locationTable.tableStreamArn,
  startingPosition: StartingPosition.LATEST,
});

const authenticatedRole = backend.auth.resources.authenticatedUserIamRole;

const sqsAnnotatorStatement = new iam.PolicyStatement({
  actions: [
    'sqs:ReceiveMessage',
    'sqs:DeleteMessage',
    'sqs:GetQueueAttributes',
  ],
  resources: ['*'],
});

const sqsSysadminStatement = new iam.PolicyStatement({
  actions: [
    'sqs:GetQueueUrl',
    'sqs:SendMessage',
    'sqs:SendMessageBatch',
    'sqs:DeleteMessageBatch',
    'sqs:ReceiveMessage',
    'sqs:ChangeMessageVisibility',
  ],
  resources: ['*'],
});
const generalBucketArn = 'arn:aws:s3:::surveyscope';
const generalBucketArn2 = 'arn:aws:s3:::surveyscope/*';
const generalBucketPolicy = new iam.PolicyStatement({
  actions: ['s3:ListBucket', 's3:GetObject'],
  resources: [generalBucketArn, generalBucketArn2],
});

// Wildcard ARNs avoid cross-stack storage dependencies.
const groupS3ListPolicy = new iam.PolicyStatement({
  actions: ['s3:ListBucket'],
  resources: ['arn:aws:s3:::*'],
});

const groupS3ObjectsPolicy = new iam.PolicyStatement({
  actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
  resources: ['arn:aws:s3:::*/images/*'],
});

const groupS3OutputsReadPolicy = new iam.PolicyStatement({
  actions: ['s3:GetObject', 's3:DeleteObject'],
  resources: [
    'arn:aws:s3:::*/slippymaps/*',
    'arn:aws:s3:::*/heatmaps/*',
    'arn:aws:s3:::*/false-negative-manifests/*',
    'arn:aws:s3:::*/false-negative-pools/*',
    'arn:aws:s3:::*/false-negative-history/*',
    'arn:aws:s3:::*/qc-review-manifests/*',
    'arn:aws:s3:::*/jolly-status/*',
    'arn:aws:s3:::*/info-tag-manifests/*',
  ],
});

const groupS3LaunchPayloadsPolicy = new iam.PolicyStatement({
  actions: ['s3:PutObject'],
  resources: ['arn:aws:s3:::*/launch-payloads/*'],
});

const groupS3QueueManifestsPolicy = new iam.PolicyStatement({
  actions: ['s3:PutObject'],
  resources: ['arn:aws:s3:::*/queue-manifests/*'],
});

const groupEcsListPolicy = new iam.PolicyStatement({
  actions: ['ecs:ListClusters', 'ecs:DescribeClusters', 'ecs:ListServices', 'ecs:DescribeServices', 'ecs:DescribeTaskDefinition'],
  resources: ['*'],
});

authenticatedRole.addToPrincipalPolicy(sqsAnnotatorStatement);
authenticatedRole.addToPrincipalPolicy(generalBucketPolicy);

// Group roles replace the authenticated Identity Pool role.
Object.values(backend.auth.resources.groups).forEach(({ role }) => {
  role.addToPrincipalPolicy(generalBucketPolicy);
  role.addToPrincipalPolicy(groupS3ListPolicy);
  role.addToPrincipalPolicy(groupS3ObjectsPolicy);
  role.addToPrincipalPolicy(sqsAnnotatorStatement);
  role.addToPrincipalPolicy(groupS3OutputsReadPolicy);
  role.addToPrincipalPolicy(groupS3LaunchPayloadsPolicy);
  role.addToPrincipalPolicy(groupS3QueueManifestsPolicy);
});

backend.auth.resources.groups['sysadmin'].role.addToPrincipalPolicy(sqsSysadminStatement);
backend.auth.resources.groups['sysadmin'].role.addToPrincipalPolicy(groupEcsListPolicy);

const generateTileLambda = backend.generateTile.resources.lambda as lambda.Function;
const sharpLayer = new lambda.LayerVersion(
  Stack.of(generateTileLambda),
  'sharpLayer',
  {
    code: lambda.Code.fromAsset('./amplify/layers/sharp-ph200-x64'),
    description: 'Sharp layer for image processing (ph200-x86_64)',
    compatibleArchitectures: [lambda.Architecture.X86_64],
  }
);
generateTileLambda.addLayers(sharpLayer);

const handleS3UploadLambda = backend.handleS3Upload.resources.lambda as lambda.Function;
handleS3UploadLambda.addLayers(sharpLayer);
backend.handleS3Upload.resources.cfnResources.cfnFunction.addPropertyOverride(
  'ReservedConcurrentExecutions',
  50
);

const enableEcs = true;
const enableLightGlue =
  (process.env.AMPLIFY_ENABLE_ECS_LIGHTGLUE ?? 'true').toLowerCase() === 'true';
const enableScoutbot =
  (process.env.AMPLIFY_ENABLE_ECS_SCOUTBOT ?? 'true').toLowerCase() === 'true';
const enableMadDetector =
  (process.env.AMPLIFY_ENABLE_ECS_MAD ?? 'true').toLowerCase() === 'true';
const enableStormflyDetector =
  (process.env.AMPLIFY_ENABLE_ECS_STORMFLY ?? 'true').toLowerCase() === 'true';
const enableOwlDDetector =
  (process.env.AMPLIFY_ENABLE_ECS_OWL_D ?? 'true').toLowerCase() === 'true';
const enableElephantDetector =
  (process.env.AMPLIFY_ENABLE_ECS_ELEPHANT ?? 'true').toLowerCase() === 'true';
const enableJollyFargate =
  (process.env.AMPLIFY_ENABLE_JOLLY_FARGATE ?? 'true').toLowerCase() === 'true';

const envName =
  process.env.AMPLIFY_ENV ?? process.env.AWS_BRANCH ?? 'production';

const workflowStatsEnvName = envName
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 32) || 'default';
const workflowStatsStack = backend.createStack('DetwebWorkflowStats');
const workflowRunsTableName = `detweb-workflow-runs-${workflowStatsEnvName}`;

// These tables deliberately live outside the Amplify data stack. Their names
// are stable so future workflow adapters can derive their ARNs without adding
// CloudFormation exports back into the already constrained data stack.
const workflowRunsTable = new dynamodb.Table(
  workflowStatsStack,
  'WorkflowRuns',
  {
    tableName: workflowRunsTableName,
    partitionKey: {
      name: 'runId',
      type: dynamodb.AttributeType.STRING,
    },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    encryption: dynamodb.TableEncryption.AWS_MANAGED,
    pointInTimeRecovery: true,
    removalPolicy: RemovalPolicy.RETAIN,
  }
);
workflowRunsTable.addGlobalSecondaryIndex({
  indexName: 'byProjectAndLaunchedAt',
  partitionKey: {
    name: 'projectId',
    type: dynamodb.AttributeType.STRING,
  },
  sortKey: {
    name: 'launchedAt',
    type: dynamodb.AttributeType.STRING,
  },
});

for (const launchResource of [
  backend.launchAnnotationSet,
  backend.launchFalseNegatives,
  backend.monitorTilingTasks,
  backend.launchIndividualId,
]) {
  launchResource.addEnvironment(
    'WORKFLOW_RUNS_TABLE',
    workflowRunsTableName
  );
  const launchFunction = launchResource.resources.lambda;
  launchFunction.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
      resources: [
        Stack.of(launchFunction).formatArn({
          service: 'dynamodb',
          resource: 'table',
          resourceName: workflowRunsTableName,
        }),
      ],
    })
  );
}

const workflowDailyStatsTableName = `detweb-workflow-daily-stats-${workflowStatsEnvName}`;

// The reporting query reads the same tables. Names are pinned literals and the
// ARNs are formatted rather than imported, so the function stack gains no
// dependency on DetwebWorkflowStats (which would be a cycle, since that stack
// is created from this backend).
backend.queryWorkflowStats.addEnvironment(
  'WORKFLOW_RUNS_TABLE',
  workflowRunsTableName
);
backend.queryWorkflowStats.addEnvironment(
  'WORKFLOW_DAILY_STATS_TABLE',
  workflowDailyStatsTableName
);
const queryWorkflowStatsFunction = backend.queryWorkflowStats.resources.lambda;
const queryWorkflowStatsStack = Stack.of(queryWorkflowStatsFunction);
const workflowRunsArn = queryWorkflowStatsStack.formatArn({
  service: 'dynamodb',
  resource: 'table',
  resourceName: workflowRunsTableName,
});
const workflowDailyStatsArn = queryWorkflowStatsStack.formatArn({
  service: 'dynamodb',
  resource: 'table',
  resourceName: workflowDailyStatsTableName,
});
queryWorkflowStatsFunction.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['dynamodb:Query'],
    resources: [
      workflowRunsArn,
      `${workflowRunsArn}/index/*`,
      workflowDailyStatsArn,
    ],
  })
);

// The browser-facing writer needs the same three tables. It only ever reads the
// run (to derive project, set and organization) and writes the event and its
// daily projection.
const workflowEventsTableName = `detweb-workflow-events-${workflowStatsEnvName}`;
backend.recordWorkflowTask.addEnvironment(
  'WORKFLOW_RUNS_TABLE',
  workflowRunsTableName
);
backend.recordWorkflowTask.addEnvironment(
  'WORKFLOW_EVENTS_TABLE',
  workflowEventsTableName
);
backend.recordWorkflowTask.addEnvironment(
  'WORKFLOW_DAILY_STATS_TABLE',
  workflowDailyStatsTableName
);
const recordWorkflowTaskFunction = backend.recordWorkflowTask.resources.lambda;
const recordWorkflowTaskStack = Stack.of(recordWorkflowTaskFunction);
const eventsArnForWriter = recordWorkflowTaskStack.formatArn({
  service: 'dynamodb',
  resource: 'table',
  resourceName: workflowEventsTableName,
});
recordWorkflowTaskFunction.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['dynamodb:GetItem'],
    resources: [
      recordWorkflowTaskStack.formatArn({
        service: 'dynamodb',
        resource: 'table',
        resourceName: workflowRunsTableName,
      }),
    ],
  })
);
recordWorkflowTaskFunction.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
    resources: [
      eventsArnForWriter,
      recordWorkflowTaskStack.formatArn({
        service: 'dynamodb',
        resource: 'table',
        resourceName: workflowDailyStatsTableName,
      }),
    ],
  })
);

const workflowEventsTable = new dynamodb.Table(
  workflowStatsStack,
  'WorkflowTaskEvents',
  {
    tableName: workflowEventsTableName,
    partitionKey: {
      name: 'eventId',
      type: dynamodb.AttributeType.STRING,
    },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    encryption: dynamodb.TableEncryption.AWS_MANAGED,
    pointInTimeRecovery: true,
    removalPolicy: RemovalPolicy.RETAIN,
  }
);
workflowEventsTable.addGlobalSecondaryIndex({
  indexName: 'byRunAndCompletedAt',
  partitionKey: {
    name: 'workflowRunId',
    type: dynamodb.AttributeType.STRING,
  },
  sortKey: {
    name: 'completedAt',
    type: dynamodb.AttributeType.STRING,
  },
});

const workflowDailyStatsTable = new dynamodb.Table(
  workflowStatsStack,
  'WorkflowDailyStats',
  {
    tableName: workflowDailyStatsTableName,
    partitionKey: {
      name: 'scopeKey',
      type: dynamodb.AttributeType.STRING,
    },
    sortKey: {
      name: 'bucketKey',
      type: dynamodb.AttributeType.STRING,
    },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    encryption: dynamodb.TableEncryption.AWS_MANAGED,
    pointInTimeRecovery: true,
    removalPolicy: RemovalPolicy.RETAIN,
  }
);

const workflowStatsWriterLogGroup = new logs.LogGroup(
  workflowStatsStack,
  'WorkflowStatsWriterLogs',
  {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.RETAIN,
  }
);

const recordWorkflowTaskEventFunction = new NodejsFunction(
  workflowStatsStack,
  'RecordWorkflowTaskEvent',
  {
    entry: path.join(
      __dirname,
      'functions/workflowStats/recordTaskEvent.ts'
    ),
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    architecture: lambda.Architecture.ARM_64,
    timeout: Duration.seconds(15),
    memorySize: 512,
    reservedConcurrentExecutions: 25,
    tracing: lambda.Tracing.ACTIVE,
    logGroup: workflowStatsWriterLogGroup,
    bundling: {
      minify: true,
      sourceMap: true,
      externalModules: [],
    },
    environment: {
      WORKFLOW_RUNS_TABLE: workflowRunsTable.tableName,
      WORKFLOW_EVENTS_TABLE: workflowEventsTable.tableName,
      WORKFLOW_DAILY_STATS_TABLE: workflowDailyStatsTable.tableName,
      NODE_OPTIONS: '--enable-source-maps',
    },
  }
);
workflowRunsTable.grantReadData(recordWorkflowTaskEventFunction);
workflowEventsTable.grantReadWriteData(recordWorkflowTaskEventFunction);
workflowDailyStatsTable.grantReadWriteData(recordWorkflowTaskEventFunction);

withStatsAlarmAction(
  new cloudwatch.Alarm(workflowStatsStack, 'WorkflowStatsWriterErrors', {
    metric: recordWorkflowTaskEventFunction.metricErrors({
      period: Duration.minutes(5),
    }),
    threshold: 1,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  })
);
withStatsAlarmAction(
  new cloudwatch.Alarm(workflowStatsStack, 'WorkflowStatsWriterDuration', {
    metric: recordWorkflowTaskEventFunction.metricDuration({
      period: Duration.minutes(5),
      statistic: 'p99',
    }),
    threshold: 12_000,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  })
);

const workflowStatsFailureQueue = new sqs.Queue(
  workflowStatsStack,
  'WorkflowStatsProjectionFailures',
  {
    encryption: sqs.QueueEncryption.SQS_MANAGED,
    enforceSSL: true,
    retentionPeriod: Duration.days(14),
    removalPolicy: RemovalPolicy.RETAIN,
  }
);
const workflowStatsProjectorLogGroup = new logs.LogGroup(
  workflowStatsStack,
  'WorkflowStatsProjectorLogs',
  {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.RETAIN,
  }
);
const workflowStatsObservationProjector = new NodejsFunction(
  workflowStatsStack,
  'ProjectObservationWorkflowStats',
  {
    entry: path.join(
      __dirname,
      'functions/workflowStats/projectObservation.ts'
    ),
    handler: 'handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    architecture: lambda.Architecture.ARM_64,
    timeout: Duration.seconds(30),
    memorySize: 512,
    reservedConcurrentExecutions: 10,
    tracing: lambda.Tracing.ACTIVE,
    logGroup: workflowStatsProjectorLogGroup,
    bundling: {
      minify: true,
      sourceMap: true,
      externalModules: [],
    },
    environment: {
      WORKFLOW_RUNS_TABLE: workflowRunsTable.tableName,
      WORKFLOW_EVENTS_TABLE: workflowEventsTable.tableName,
      WORKFLOW_DAILY_STATS_TABLE: workflowDailyStatsTable.tableName,
      NODE_OPTIONS: '--enable-source-maps',
    },
  }
);
workflowRunsTable.grantReadData(workflowStatsObservationProjector);
workflowEventsTable.grantReadWriteData(workflowStatsObservationProjector);
workflowDailyStatsTable.grantReadWriteData(
  workflowStatsObservationProjector
);
const workflowStatsStreamGrant = observationTable.grantStreamRead(
  workflowStatsObservationProjector
);
const workflowStatsObservationMapping = new EventSourceMapping(
  workflowStatsStack,
  'WorkflowStatsObservationMapping',
  {
    target: workflowStatsObservationProjector,
    eventSourceArn: observationTable.tableStreamArn,
    startingPosition: StartingPosition.TRIM_HORIZON,
    batchSize: 25,
    bisectBatchOnError: true,
    reportBatchItemFailures: true,
    retryAttempts: 5,
    maxRecordAge: Duration.hours(24),
    parallelizationFactor: 1,
    onFailure: new SqsDlq(workflowStatsFailureQueue),
    filters: [
      lambda.FilterCriteria.filter({
        eventName: lambda.FilterRule.isEqual('INSERT'),
      }),
    ],
  }
);
workflowStatsStreamGrant.applyBefore(workflowStatsObservationMapping);

withStatsAlarmAction(
  new cloudwatch.Alarm(workflowStatsStack, 'WorkflowStatsProjectorErrors', {
    metric: workflowStatsObservationProjector.metricErrors({
      period: Duration.minutes(5),
    }),
    threshold: 1,
    evaluationPeriods: 2,
    datapointsToAlarm: 2,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  })
);
withStatsAlarmAction(
  new cloudwatch.Alarm(
    workflowStatsStack,
    'WorkflowStatsProjectorThrottles',
    {
      metric: workflowStatsObservationProjector.metricThrottles({
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }
  )
);
withStatsAlarmAction(
  new cloudwatch.Alarm(workflowStatsStack, 'WorkflowStatsProjectorDuration', {
    metric: workflowStatsObservationProjector.metricDuration({
      period: Duration.minutes(5),
      statistic: 'p99',
    }),
    threshold: 24_000,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  })
);
withStatsAlarmAction(
  new cloudwatch.Alarm(
    workflowStatsStack,
    'WorkflowStatsProjectorIteratorAge',
    {
      metric: workflowStatsObservationProjector.metric('IteratorAge', {
        period: Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 15 * 60 * 1000,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }
  )
);
withStatsAlarmAction(
  new cloudwatch.Alarm(workflowStatsStack, 'WorkflowStatsProjectionFailuresDepth', {
    metric:
      workflowStatsFailureQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
      }),
    threshold: 1,
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  })
);

let lightglueQueueUrl: string | undefined;
let scoutbotQueueUrl: string | undefined;
let madDetectorQueueUrl: string | undefined;
let stormflyDetectorQueueUrl: string | undefined;
let owlDDetectorQueueUrl: string | undefined;
let elephantDetectorQueueUrl: string | undefined;

if (enableEcs) {
  const ecsStack = backend.createStack('DetwebECS');
  const ecsTaskRole = new iam.Role(ecsStack, 'EcsTaskRole', {
    assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
  });

  const ecsvpc = new ec2.Vpc(ecsStack, 'my-cdk-vpc');
  ecsTaskRole.addManagedPolicy(
    iam.ManagedPolicy.fromAwsManagedPolicyName('AWSAppSyncInvokeFullAccess')
  );
  ecsTaskRole.addToPrincipalPolicy(
    new iam.PolicyStatement({
      actions: ['s3:ListBucket', 's3:GetObject', 's3:PutObject'],
      resources: ['arn:aws:s3:::*'],
    })
  );

  if (enableLightGlue) {
    const lightGlueAutoProcessor = new AutoProcessor(
      ecsStack,
      'GpuAutoProcessor',
      {
        vpc: ecsvpc,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.G4DN,
          ec2.InstanceSize.XLARGE
        ),
        ecsImage: ecs.ContainerImage.fromAsset(
          'containerImages/lightGlueImage'
        ),
        ecsTaskRole,
        memoryLimitMiB: 1024 * 12,
        gpuCount: 1,
        environment: {
          API_ENDPOINT: backend.data.graphqlUrl,
          BUCKET: backend.inputBucket.resources.bucket.bucketName,
          SINGLE_IMAGE_FAILURE_VISIBILITY_SECONDS:
            process.env.SCOUTBOT_SINGLE_IMAGE_FAILURE_VISIBILITY_SECONDS ?? '1800',
        },
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(
          ecs.AmiHardwareType.GPU
        ),
      }
    );

    lightGlueAutoProcessor.asg.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSAppSyncInvokeFullAccess')
    );

    lightglueQueueUrl = lightGlueAutoProcessor.queue.queueUrl;
  }

  if (enableScoutbot) {
    Repository.fromRepositoryArn(
      ecsStack,
      'ScoutbotRepo',
      'arn:aws:ecr:eu-west-2:275736403632:repository/cdk-hnb659fds-container-assets-275736403632-eu-west-2'
    );

    const scoutbotAutoProcessor = new AutoProcessor(
      ecsStack,
      'ScoutbotAutoProcessor',
      {
        vpc: ecsvpc,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.G4DN,
          ec2.InstanceSize.XLARGE
        ),
        ecsImage: ecs.ContainerImage.fromAsset('containerImages/scoutbot'),
        ecsTaskRole,
        memoryLimitMiB: 1024 * 12,
        gpuCount: 1,
        environment: {
          API_ENDPOINT: backend.data.graphqlUrl,
          BUCKET: backend.inputBucket.resources.bucket.bucketName,
        },
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(
          ecs.AmiHardwareType.GPU
        ),
        rootVolumeSize: 100,
        allowSelfRequeue: true,
      }
    );

    scoutbotAutoProcessor.asg.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSAppSyncInvokeFullAccess')
    );

    scoutbotQueueUrl = scoutbotAutoProcessor.queue.queueUrl;

    new ssm.StringParameter(ecsStack, 'ScoutbotQueueUrlParameter', {
      parameterName: `/${envName}/monitorScoutbotDlq/QueueUrl`,
      stringValue: scoutbotAutoProcessor.queue.queueUrl,
    });
  }

  if (enableMadDetector) {
    const madDetectorAutoProcessor = new AutoProcessor(
      ecsStack,
      'MadDetectorAutoProcessor',
      {
        vpc: ecsvpc,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.G4DN,
          ec2.InstanceSize.XLARGE
        ),
        ecsImage: ecs.ContainerImage.fromAsset('containerImages/madDetector'),
        ecsTaskRole,
        memoryLimitMiB: 1024 * 12,
        gpuCount: 1,
        environment: {
          API_ENDPOINT: backend.data.graphqlUrl,
          BUCKET: backend.inputBucket.resources.bucket.bucketName,
          MAD_CHECKPOINT_S3: 's3://surveyscope/2024-mad-v2/checkpoint.pth',
        },
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(
          ecs.AmiHardwareType.GPU
        ),
        rootVolumeSize: 200,
      }
    );

    madDetectorAutoProcessor.asg.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSAppSyncInvokeFullAccess')
    );

    madDetectorQueueUrl = madDetectorAutoProcessor.queue.queueUrl;
  }

  if (enableStormflyDetector) {
    const stormflyDetectorAutoProcessor = new AutoProcessor(
      ecsStack,
      'StormflyDetectorAutoProcessor',
      {
        vpc: ecsvpc,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.G4DN,
          ec2.InstanceSize.XLARGE
        ),
        ecsImage: ecs.ContainerImage.fromAsset('containerImages/stormflyDetector'),
        ecsTaskRole,
        memoryLimitMiB: 1024 * 12,
        gpuCount: 1,
        environment: {
          API_ENDPOINT: backend.data.graphqlUrl,
          STORMFLY_MODEL_S3:
            process.env.STORMFLY_MODEL_S3 ?? 's3://surveyscope/testing/stormfly.onnx',
          // Zero persists the heatmap noise floor and floods writes.
          STORMFLY_THRESHOLD: process.env.STORMFLY_THRESHOLD ?? '0.2',
          STORMFLY_BOX_SIZE: process.env.STORMFLY_BOX_SIZE ?? '64',
          // The current export has a fixed batch axis.
          STORMFLY_FP16: process.env.STORMFLY_FP16 ?? '0',
          STORMFLY_BATCH: process.env.STORMFLY_BATCH ?? '1',
        },
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(
          ecs.AmiHardwareType.GPU
        ),
        rootVolumeSize: 100,
        messagesPerTask: 10,
        maxTasks: 20,
      }
    );

    stormflyDetectorAutoProcessor.asg.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSAppSyncInvokeFullAccess')
    );
    stormflyDetectorQueueUrl = stormflyDetectorAutoProcessor.queue.queueUrl;
  }

  if (enableOwlDDetector) {
    const owlDDetectorAutoProcessor = new AutoProcessor(
      ecsStack,
      'OwlDDetectorAutoProcessor',
      {
        vpc: ecsvpc,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.G5,
          ec2.InstanceSize.XLARGE
        ),
        ecsImage: ecs.ContainerImage.fromAsset('containerImages/owlDDetector'),
        ecsTaskRole,
        memoryLimitMiB: 1024 * 12,
        gpuCount: 1,
        environment: {
          API_ENDPOINT: backend.data.graphqlUrl,
          OWL_MODEL_S3:
            process.env.OWL_D_MODEL_S3 ?? 's3://surveyscope/testing/OWL-D.pth',
          OWL_MODEL_PATH: '/workspace/model_cache/OWL-D.pth',
          OWL_MODEL_SHA256:
            process.env.OWL_D_MODEL_SHA256 ??
            'e28fc06d28fe010faefaffc5eb9bd0b85f98dad0805fca9f5256562cc3403d5b',
          OWL_VARIANT: 'owl-d',
          OWL_THRESHOLD: process.env.OWL_D_THRESHOLD ?? '0.05',
          OWL_AMP: process.env.OWL_D_AMP ?? 'fp16',
          OWL_BATCH_SIZE: process.env.OWL_D_BATCH_SIZE ?? '1',
          OWL_OVERLAP: process.env.OWL_D_OVERLAP ?? '160',
          OWL_BOX_SIZE: process.env.OWL_D_BOX_SIZE ?? '64',
        },
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(
          ecs.AmiHardwareType.GPU
        ),
        rootVolumeSize: 200,
        messagesPerTask: Number(process.env.OWL_D_MESSAGES_PER_TASK ?? '5'),
        maxTasks: Number(process.env.OWL_D_MAX_TASKS ?? '20'),
        visibilityTimeout: Duration.minutes(
          Number(process.env.OWL_D_VISIBILITY_MINUTES ?? '60')
        ),
      }
    );

    owlDDetectorAutoProcessor.asg.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSAppSyncInvokeFullAccess')
    );
    owlDDetectorQueueUrl = owlDDetectorAutoProcessor.queue.queueUrl;
  }

  if (enableElephantDetector) {
    const elephantDetectorAutoProcessor = new AutoProcessor(
      ecsStack,
      'ElephantDetectorAutoProcessor',
      {
        vpc: ecsvpc,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.G4DN,
          ec2.InstanceSize.XLARGE
        ),
        ecsImage: ecs.ContainerImage.fromAsset('containerImages/heatmapperImage'),
        ecsTaskRole,
        memoryLimitMiB: 1024 * 12,
        gpuCount: 1,
        environment: {
          API_ENDPOINT: backend.data.graphqlUrl,
          BUCKET: backend.inputBucket.resources.bucket.bucketName,
        },
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(
          ecs.AmiHardwareType.GPU
        ),
        rootVolumeSize: 100,
      }
    );

    elephantDetectorAutoProcessor.asg.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSAppSyncInvokeFullAccess')
    );
    elephantDetectorQueueUrl = elephantDetectorAutoProcessor.queue.queueUrl;
  }

  if (enableJollyFargate) {
    // Gateway endpoints are free and keep the bulk DynamoDB/S3 traffic off the
    // NAT. ECR image pulls and CloudWatch Logs still egress via NAT: interface
    // endpoints for those would cost more per month than the handful of task
    // runs this pipeline does. If NATs are ever removed from this VPC, this
    // task stops being able to start and those endpoints become mandatory.
    ecsvpc.addGatewayEndpoint('JollyDynamoDbGatewayEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });
    ecsvpc.addGatewayEndpoint('JollyS3GatewayEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    const jollyStack = backend.createStack('DetwebJollyResults');
    const resourceEnvName = envName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'default';
    const jobTableName = `detweb-jolly-jobs-${resourceEnvName}`;
    const stateMachineName = `detweb-jolly-results-${resourceEnvName}`;
    const outputBucketResource =
      backend.outputBucket.resources.bucket;
    const jollyTables = {
      Project: backend.data.resources.tables['Project'],
      Camera: backend.data.resources.tables['Camera'],
      Stratum: backend.data.resources.tables['Stratum'],
      Transect: backend.data.resources.tables['Transect'],
      Image: backend.data.resources.tables['Image'],
      Annotation: backend.data.resources.tables['Annotation'],
      JollyResult: backend.data.resources.tables['JollyResult'],
    };

    // The table name is pinned rather than CDK-generated so the launcher (which
    // lives in the data stack) can derive the ARN with formatArn instead of
    // importing it, which would make the data and Jolly stacks mutually
    // dependent. Trade-off: with RETAIN, tearing this stack down and
    // redeploying into the same environment fails on a name conflict until the
    // retained table is deleted by hand.
    const jobTable = new dynamodb.Table(jollyStack, 'JollyJobControl', {
      tableName: jobTableName,
      partitionKey: {
        name: 'jobKey',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const cluster = new ecs.Cluster(jollyStack, 'JollyCluster', {
      vpc: ecsvpc,
      containerInsights: true,
    });
    const taskRole = new iam.Role(jollyStack, 'JollyTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    const executionRole = new iam.Role(
      jollyStack,
      'JollyExecutionRole',
      {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AmazonECSTaskExecutionRolePolicy'
          ),
        ],
      }
    );
    const taskDefinition = new ecs.FargateTaskDefinition(
      jollyStack,
      'JollyTaskDefinition',
      {
        cpu: 1024,
        memoryLimitMiB: 4096,
        taskRole,
        executionRole,
        runtimePlatform: {
          operatingSystemFamily:
            ecs.OperatingSystemFamily.LINUX,
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
        },
      }
    );
    const workerLogGroup = new logs.LogGroup(
      jollyStack,
      'JollyWorkerLogs',
      {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.RETAIN,
      }
    );
    const workerContainer = taskDefinition.addContainer(
      'JollyWorker',
      {
        image: ecs.ContainerImage.fromAsset(
          'containerImages/jollyResults'
        ),
        essential: true,
        readonlyRootFilesystem: true,
        stopTimeout: Duration.seconds(60),
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: 'jolly-results',
          logGroup: workerLogGroup,
          mode: ecs.AwsLogDriverMode.BLOCKING,
        }),
        environment: {
          OUTPUTS_BUCKET_NAME: outputBucketResource.bucketName,
          JOLLY_JOB_TABLE_NAME: jobTable.tableName,
          PROJECT_TABLE_NAME: jollyTables.Project.tableName,
          CAMERA_TABLE_NAME: jollyTables.Camera.tableName,
          STRATUM_TABLE_NAME: jollyTables.Stratum.tableName,
          TRANSECT_TABLE_NAME: jollyTables.Transect.tableName,
          IMAGE_TABLE_NAME: jollyTables.Image.tableName,
          ANNOTATION_TABLE_NAME: jollyTables.Annotation.tableName,
          JOLLY_RESULT_TABLE_NAME:
            jollyTables.JollyResult.tableName,
        },
      }
    );
    const taskSecurityGroup = new ec2.SecurityGroup(
      jollyStack,
      'JollyTaskSecurityGroup',
      {
        vpc: ecsvpc,
        description:
          'Outbound-only security group for Jolly Results Fargate tasks',
        allowAllOutbound: true,
      }
    );

    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query', 'dynamodb:DescribeTable'],
        resources: Object.values(jollyTables).flatMap((table) => [
          table.tableArn,
          `${table.tableArn}/index/*`,
        ]),
      })
    );
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [jollyTables.Project.tableArn],
      })
    );
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:BatchWriteItem',
          'dynamodb:PutItem',
          'dynamodb:DeleteItem',
        ],
        resources: [jollyTables.JollyResult.tableArn],
      })
    );
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [jobTable.tableArn],
      })
    );
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        // TransactWriteItems authorizes each component operation separately.
        // The ownership guard in commitResults uses a ConditionCheck.
        actions: ['dynamodb:ConditionCheckItem'],
        resources: [jobTable.tableArn],
      })
    );
    outputBucketResource.grantReadWrite(
      taskRole,
      'jolly-status/*'
    );
    outputBucketResource.grantReadWrite(
      taskRole,
      'jolly-commits/*'
    );

    const finalizer = new NodejsFunction(
      jollyStack,
      'FinalizeJollyResults',
      {
        entry: path.join(
          __dirname,
          'functions/finalizeJollyResults/handler.ts'
        ),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: Duration.minutes(5),
        memorySize: 1024,
        environment: {
          OUTPUTS_BUCKET_NAME: outputBucketResource.bucketName,
          JOLLY_JOB_TABLE_NAME: jobTable.tableName,
          JOLLY_RESULT_TABLE_NAME:
            jollyTables.JollyResult.tableName,
        },
      }
    );
    finalizer.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [jobTable.tableArn],
      })
    );
    finalizer.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query', 'dynamodb:BatchWriteItem'],
        resources: [jollyTables.JollyResult.tableArn],
      })
    );
    outputBucketResource.grantRead(
      finalizer,
      'jolly-commits/*'
    );
    outputBucketResource.grantReadWrite(
      finalizer,
      'jolly-status/*'
    );

    const runTask = new sfnTasks.EcsRunTask(
      jollyStack,
      'RunJollyWorker',
      {
        integrationPattern: sfn.IntegrationPattern.RUN_JOB,
        cluster,
        taskDefinition,
        launchTarget: new sfnTasks.EcsFargateLaunchTarget({
          platformVersion: ecs.FargatePlatformVersion.LATEST,
        }),
        assignPublicIp: false,
        subnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        securityGroups: [taskSecurityGroup],
        containerOverrides: [
          {
            containerDefinition: workerContainer,
            environment: [
              {
                name: 'JOLLY_JOB_INPUT',
                value: sfn.JsonPath.jsonToString(
                  sfn.JsonPath.objectAt('$')
                ),
              },
            ],
          },
        ],
        taskTimeout: sfn.Timeout.duration(Duration.hours(2)),
        resultPath: '$.ecsResult',
      }
    );

    const finalizeSuccess = new sfnTasks.LambdaInvoke(
      jollyStack,
      'ValidateJollyCompletion',
      {
        lambdaFunction: finalizer,
        payload: sfn.TaskInput.fromObject({
          jobId: sfn.JsonPath.stringAt('$.jobId'),
          jobKey: sfn.JsonPath.stringAt('$.jobKey'),
          outcome: 'SUCCEEDED',
        }),
        payloadResponseOnly: true,
        resultPath: '$.finalizeResult',
        taskTimeout: sfn.Timeout.duration(Duration.minutes(5)),
      }
    );
    finalizeSuccess.addRetry({
      errors: [
        'Lambda.ServiceException',
        'Lambda.SdkClientException',
      ],
      interval: Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2,
    });
    const finalizeFailure = new sfnTasks.LambdaInvoke(
      jollyStack,
      'FinalizeJollyFailure',
      {
        lambdaFunction: finalizer,
        payload: sfn.TaskInput.fromObject({
          jobId: sfn.JsonPath.stringAt('$.jobId'),
          jobKey: sfn.JsonPath.stringAt('$.jobKey'),
          outcome: 'FAILED',
          workflowError: sfn.JsonPath.objectAt('$.workflowError'),
        }),
        payloadResponseOnly: true,
        resultPath: '$.finalizeResult',
        taskTimeout: sfn.Timeout.duration(Duration.minutes(5)),
      }
    );
    finalizeFailure.addRetry({
      errors: [
        'Lambda.ServiceException',
        'Lambda.SdkClientException',
      ],
      interval: Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2,
    });

    const completed = new sfn.Succeed(
      jollyStack,
      'JollyWorkflowCompleted'
    );
    const failed = new sfn.Fail(
      jollyStack,
      'JollyWorkflowFailed',
      {
        error: 'JollyResultsJobFailed',
        cause: 'The Jolly Results worker or rollback failed',
      }
    );
    const completionChoice = new sfn.Choice(
      jollyStack,
      'JollyCompletionValid'
    )
      .when(
        sfn.Condition.booleanEquals(
          '$.finalizeResult.ok',
          true
        ),
        completed
      )
      .otherwise(failed);

    runTask.addCatch(finalizeFailure.next(failed), {
      errors: ['States.ALL'],
      resultPath: '$.workflowError',
    });
    const workflowDefinition = runTask
      .next(finalizeSuccess)
      .next(completionChoice);
    const workflowLogGroup = new logs.LogGroup(
      jollyStack,
      'JollyWorkflowLogs',
      {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.RETAIN,
      }
    );
    const stateMachine = new sfn.StateMachine(
      jollyStack,
      'JollyStateMachine',
      {
        stateMachineName,
        stateMachineType: sfn.StateMachineType.STANDARD,
        definitionBody:
          sfn.DefinitionBody.fromChainable(workflowDefinition),
        timeout: Duration.hours(3),
        tracingEnabled: true,
        logs: {
          destination: workflowLogGroup,
          level: sfn.LogLevel.ALL,
          includeExecutionData: true,
        },
      }
    );

    new cloudwatch.Alarm(jollyStack, 'JollyWorkflowFailureAlarm', {
      metric: stateMachine.metricFailed({
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(jollyStack, 'JollyWorkflowTimeoutAlarm', {
      metric: stateMachine.metricTimedOut({
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const launcher = backend.generateSurveyResults.resources.lambda;
    const launcherStack = Stack.of(launcher);
    const launcherJobTableArn = launcherStack.formatArn({
      service: 'dynamodb',
      resource: 'table',
      resourceName: jobTableName,
    });
    const launcherStateMachineArn = launcherStack.formatArn({
      service: 'states',
      resource: 'stateMachine',
      resourceName: stateMachineName,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });
    backend.generateSurveyResults.addEnvironment(
      'JOLLY_JOB_TABLE_NAME',
      jobTableName
    );
    backend.generateSurveyResults.addEnvironment(
      'JOLLY_STATE_MACHINE_ARN',
      launcherStateMachineArn
    );
    launcher.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
        ],
        resources: [launcherJobTableArn],
      })
    );
    launcher.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['states:StartExecution'],
        resources: [launcherStateMachineArn],
      })
    );
  }
}

backend.launchAnnotationSet.addEnvironment(
  'PROCESS_TILING_BATCH_FUNCTION_NAME',
  backend.processTilingBatch.resources.lambda.functionName
);
backend.launchFalseNegatives.addEnvironment(
  'PROCESS_TILING_BATCH_FUNCTION_NAME',
  backend.processTilingBatch.resources.lambda.functionName
);

backend.runImageRegistration.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['sqs:SendMessage', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl'],
    resources: ['*'],
  })
);
backend.runScoutbot.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['sqs:SendMessage', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl'],
    resources: ['*'],
  })
);
backend.runScoutbot.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['lambda:InvokeFunction'],
    resources: ['*'],
  })
);
backend.runMadDetector.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['sqs:SendMessage', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl'],
    resources: ['*'],
  })
);
backend.runStormflyDetector.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['sqs:SendMessage', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl'],
    resources: ['*'],
  })
);
backend.runOwlDDetector.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['sqs:SendMessage', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl'],
    resources: ['*'],
  })
);
backend.runElephantDetector.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['sqs:SendMessage', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl'],
    resources: ['*'],
  })
);
backend.runMadDetector.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['lambda:InvokeFunction'],
    resources: ['*'],
  })
);
backend.cleanupJobs.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['sqs:DeleteQueue', 'sqs:GetQueueAttributes'],
    resources: ['*'],
  })
);
backend.deleteQueue.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['sqs:DeleteQueue', 'sqs:GetQueueAttributes'],
    resources: ['*'],
  })
);
backend.deleteQueue.addEnvironment(
  'RECONCILE_FALSE_NEGATIVES_FUNCTION_NAME',
  backend.reconcileFalseNegatives.resources.lambda.functionName
);
backend.deleteQueue.addEnvironment(
  'RECONCILE_HOMOGRAPHIES_FUNCTION_NAME',
  backend.reconcileHomographies.resources.lambda.functionName
);
backend.deleteQueue.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['lambda:InvokeFunction'],
    resources: [
      backend.reconcileFalseNegatives.resources.lambda.functionArn,
      backend.reconcileHomographies.resources.lambda.functionArn,
    ],
  })
);
backend.cleanupJobs.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['s3:DeleteObject'],
    resources: [
      'arn:aws:s3:::*/queue-manifests/*',
      'arn:aws:s3:::*/false-negative-manifests/*',
      'arn:aws:s3:::*/qc-review-manifests/*',
      'arn:aws:s3:::*/info-tag-manifests/*',
    ],
  })
);
backend.cleanupJobs.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['lambda:InvokeFunction'],
    resources: [backend.reconcileFalseNegatives.resources.lambda.functionArn],
  })
);
backend.cleanupJobs.addEnvironment(
  'RECONCILE_FALSE_NEGATIVES_FUNCTION_NAME',
  backend.reconcileFalseNegatives.resources.lambda.functionName
);
backend.reconcileFalseNegatives.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['s3:GetObject', 's3:PutObject'],
    resources: [
      'arn:aws:s3:::*/false-negative-pools/*',
      'arn:aws:s3:::*/false-negative-history/*',
    ],
  })
);
backend.launchAnnotationSet.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'sqs:CreateQueue',
      'sqs:SendMessage',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
    ],
    resources: ['*'],
  })
);
backend.launchFalseNegatives.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'sqs:CreateQueue',
      'sqs:SendMessage',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
    ],
    resources: ['*'],
  })
);
backend.launchAnnotationSet.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['lambda:InvokeFunction'],
    resources: ['*'],
  })
);
backend.launchFalseNegatives.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['lambda:InvokeFunction'],
    resources: ['*'],
  })
);
backend.launchFalseNegatives.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['s3:PutObject', 's3:GetObject'],
    resources: [
      'arn:aws:s3:::*/queue-manifests/*',
      'arn:aws:s3:::*/false-negative-manifests/*',
      'arn:aws:s3:::*/false-negative-pools/*',
      'arn:aws:s3:::*/false-negative-history/*',
    ],
  })
);
backend.launchQCReview.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'sqs:CreateQueue',
      'sqs:SendMessage',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
    ],
    resources: ['*'],
  })
);
backend.launchQCReview.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['s3:PutObject'],
    resources: [
      'arn:aws:s3:::*/queue-manifests/*',
      'arn:aws:s3:::*/qc-review-manifests/*',
    ],
  })
);
backend.launchInfoTags.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'sqs:CreateQueue',
      'sqs:SendMessage',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
    ],
    resources: ['*'],
  })
);
backend.launchInfoTags.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['s3:PutObject'],
    resources: [
      'arn:aws:s3:::*/queue-manifests/*',
      'arn:aws:s3:::*/info-tag-manifests/*',
    ],
  })
);
backend.launchHomography.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'sqs:CreateQueue',
      'sqs:SendMessage',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
    ],
    resources: ['*'],
  })
);
backend.launchHomography.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['s3:GetObject'],
    resources: [
      'arn:aws:s3:::*/queue-manifests/*',
    ],
  })
);
backend.cleanupJobs.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['lambda:InvokeFunction'],
    resources: [backend.reconcileHomographies.resources.lambda.functionArn],
  })
);
backend.cleanupJobs.addEnvironment(
  'RECONCILE_HOMOGRAPHIES_FUNCTION_NAME',
  backend.reconcileHomographies.resources.lambda.functionName
);
backend.launchAnnotationSet.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['s3:DeleteObject'],
    resources: [
      'arn:aws:s3:::*/false-negative-manifests/*',
      'arn:aws:s3:::*/false-negative-pools/*',
      'arn:aws:s3:::*/false-negative-history/*',
    ],
  })
);
backend.processTilingBatch.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['lambda:InvokeFunction'],
    resources: ['*'],
  })
);
backend.monitorTilingTasks.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'sqs:CreateQueue',
      'sqs:SendMessage',
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
    ],
    resources: ['*'],
  })
);
backend.requeueProjectQueues.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
      'sqs:ReceiveMessage',
      'sqs:DeleteMessage',
      'sqs:SendMessage',
      'sqs:ChangeMessageVisibility',
    ],
    resources: ['*'],
  })
);

backend.monitorScoutbotDlq.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
      'sqs:ReceiveMessage',
      'sqs:DeleteMessage',
      'sqs:SendMessage',
      'sqs:ChangeMessageVisibility',
    ],
    resources: ['*'],
  })
);
backend.monitorScoutbotDlq.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'ecs:ListClusters',
      'ecs:DescribeClusters',
      'ecs:ListServices',
      'ecs:DescribeServices',
    ],
    resources: ['*'],
  })
);
backend.monitorScoutbotDlq.addEnvironment(
  'SCOUTBOT_QUEUE_URL_PARAM',
  `/${envName}/monitorScoutbotDlq/QueueUrl`
);
backend.monitorScoutbotDlq.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['ssm:GetParameter'],
    resources: ['arn:aws:ssm:*:*:parameter/*'],
  })
);

backend.findAndRequeueMissingLocations.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'sqs:GetQueueAttributes',
      'sqs:GetQueueUrl',
      'sqs:SendMessage',
    ],
    resources: ['*'],
  })
);

const pretileStack = backend.createStack('DetwebPretile');

const pretileDlq = new sqs.Queue(pretileStack, 'PretileDlq', {
  retentionPeriod: Duration.days(14),
});

const pretileQueue = new sqs.Queue(pretileStack, 'PretileQueue', {
  // Exceeds the 600-second worker timeout.
  visibilityTimeout: Duration.seconds(700),
  retentionPeriod: Duration.days(14),
  deadLetterQueue: {
    queue: pretileDlq,
    maxReceiveCount: 3,
  },
});

const pretileImageLambda = backend.pretileImage.resources.lambda as lambda.Function;
pretileImageLambda.addEventSource(
  new SqsEventSource(pretileQueue, {
    batchSize: 1,
    reportBatchItemFailures: true,
    maxConcurrency: 200,
  })
);

pretileImageLambda.addLayers(sharpLayer);

const refreshTilesDlq = new sqs.Queue(pretileStack, 'RefreshTilesDlq', {
  retentionPeriod: Duration.days(14),
});

const refreshTilesQueue = new sqs.Queue(pretileStack, 'RefreshTilesQueue', {
  // Exceeds the 120-second worker timeout.
  visibilityTimeout: Duration.seconds(180),
  retentionPeriod: Duration.days(14),
  deadLetterQueue: {
    queue: refreshTilesDlq,
    maxReceiveCount: 3,
  },
});

const refreshTilesLambda = backend.refreshTiles.resources.lambda as lambda.Function;
refreshTilesLambda.addEventSource(
  new SqsEventSource(refreshTilesQueue, {
    batchSize: 1,
    reportBatchItemFailures: true,
    maxConcurrency: 50,
  })
);

refreshTilesLambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['sqs:SendMessage'],
    resources: [pretileQueue.queueArn],
  })
);
refreshTilesLambda.addEnvironment('PRETILE_QUEUE_URL', pretileQueue.queueUrl);


backend.extendTileLifecycles.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['sqs:SendMessage', 'sqs:SendMessageBatch'],
    resources: [refreshTilesQueue.queueArn],
  })
);
backend.extendTileLifecycles.addEnvironment('REFRESH_TILES_QUEUE_URL', refreshTilesQueue.queueUrl);

const launchLambdasUsingPretile = [
  backend.launchAnnotationSet,
  backend.launchFalseNegatives,
  backend.launchQCReview,
  backend.launchInfoTags,
  backend.launchHomography,
  backend.launchIndividualId,
];

for (const fn of launchLambdasUsingPretile) {
  fn.resources.lambda.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ['sqs:SendMessage', 'sqs:SendMessageBatch'],
      resources: [pretileQueue.queueArn, refreshTilesQueue.queueArn],
    })
  );
  fn.addEnvironment('PRETILE_QUEUE_URL', pretileQueue.queueUrl);
  fn.addEnvironment('REFRESH_TILES_QUEUE_URL', refreshTilesQueue.queueUrl);
}


const registrationStack = backend.createStack('DetwebRegistration');

const registrationDeleteDlq = new sqs.Queue(
  registrationStack,
  'RegistrationDeleteDlq',
  { retentionPeriod: Duration.days(14) }
);

const registrationDeleteQueue = new sqs.Queue(
  registrationStack,
  'RegistrationDeleteQueue',
  {
    // Exceeds the 60-second worker timeout.
    visibilityTimeout: Duration.seconds(120),
    retentionPeriod: Duration.days(14),
    deadLetterQueue: {
      queue: registrationDeleteDlq,
      maxReceiveCount: 5,
    },
  }
);

const deleteRegistrationNeighbourLambda =
  backend.deleteRegistrationNeighbour.resources.lambda as lambda.Function;
deleteRegistrationNeighbourLambda.addEventSource(
  new SqsEventSource(registrationDeleteQueue, {
    batchSize: 10,
    reportBatchItemFailures: true,
    maxConcurrency: 50,
  })
);

backend.registrationBucketCleanup.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['sqs:SendMessage', 'sqs:SendMessageBatch'],
    resources: [registrationDeleteQueue.queueArn],
  })
);
backend.registrationBucketCleanup.addEnvironment(
  'REGISTRATION_DELETE_QUEUE_URL',
  registrationDeleteQueue.queueUrl
);

backend.monitorModelProgress.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['lambda:InvokeFunction'],
    resources: [backend.registrationBucketCleanup.resources.lambda.functionArn],
  })
);
backend.monitorModelProgress.addEnvironment(
  'REGISTRATION_BUCKET_CLEANUP_FUNCTION_NAME',
  backend.registrationBucketCleanup.resources.lambda.functionName
);

const imageNeighbourTable = backend.data.resources.tables['ImageNeighbour'];

const registrationStreamPolicy = new Policy(
  Stack.of(imageNeighbourTable),
  'RegistrationStreamConsumerPolicy',
  {
    statements: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:DescribeStream',
          'dynamodb:GetRecords',
          'dynamodb:GetShardIterator',
          'dynamodb:ListStreams',
        ],
        resources: ['*'],
      }),
    ],
  }
);
backend.processRegistrationStream.resources.lambda.role?.attachInlinePolicy(
  registrationStreamPolicy
);

const registrationStreamMapping = new EventSourceMapping(
  Stack.of(imageNeighbourTable),
  'ImageNeighbourStreamMapping',
  {
    target: backend.processRegistrationStream.resources.lambda,
    eventSourceArn: imageNeighbourTable.tableStreamArn,
    startingPosition: StartingPosition.LATEST,
    // The handler isolates per-record failures.
    batchSize: 25,
  }
);
registrationStreamMapping.node.addDependency(registrationStreamPolicy);

const individualIdStack = backend.createStack('DetwebIndividualId');

const individualIdTransectUpdateDlq = new sqs.Queue(
  individualIdStack,
  'IndividualIdTransectUpdateDlq',
  { retentionPeriod: Duration.days(14) }
);

const individualIdTransectUpdateQueue = new sqs.Queue(
  individualIdStack,
  'IndividualIdTransectUpdateQueue',
  {
    // Exceeds the 120-second worker timeout.
    visibilityTimeout: Duration.seconds(180),
    retentionPeriod: Duration.days(14),
    deadLetterQueue: {
      queue: individualIdTransectUpdateDlq,
      maxReceiveCount: 5,
    },
  }
);

const updateImageTransectLambda =
  backend.updateImageTransect.resources.lambda as lambda.Function;
updateImageTransectLambda.addEventSource(
  new SqsEventSource(individualIdTransectUpdateQueue, {
    batchSize: 10,
    reportBatchItemFailures: true,
    maxConcurrency: 50,
  })
);

backend.launchIndividualId.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['sqs:SendMessage', 'sqs:SendMessageBatch'],
    resources: [individualIdTransectUpdateQueue.queueArn],
  })
);
backend.launchIndividualId.addEnvironment(
  'TRANSECT_UPDATE_QUEUE_URL',
  individualIdTransectUpdateQueue.queueUrl
);

const generalBucketName = 'surveyscope';

backend.addOutput({
  custom: {
    lightglueTaskQueueUrl: lightglueQueueUrl ?? '',
    scoutbotTaskQueueUrl: scoutbotQueueUrl ?? '',
    madDetectorTaskQueueUrl: madDetectorQueueUrl ?? '',
    stormflyDetectorTaskQueueUrl: stormflyDetectorQueueUrl ?? '',
    owlDDetectorTaskQueueUrl: owlDDetectorQueueUrl ?? '',
    elephantDetectorTaskQueueUrl: elephantDetectorQueueUrl ?? '',
    generalBucketName: generalBucketName,
  },
});
