import { a, defineData } from '@aws-amplify/backend';
import { updateUserStats } from '../functions/updateUserStats/resource';
import { monitorModelProgress } from '../functions/monitorModelProgress/resource';
import { updateProjectMemberships } from '../functions/updateProjectMemberships/resource';
import { cleanupJobs } from '../functions/cleanupJobs/resource';
import { runImageRegistration } from '../functions/runImageRegistration/resource';
import { runScoutbot } from '../functions/runScoutbot/resource';
import { deleteProject } from '../functions/deleteProject/resource';
import { generateSurveyResults } from '../functions/generateSurveyResults/resource';
import { queryWorkflowEvents } from '../functions/queryWorkflowEvents/resource';
import { api } from '../api/resource';
import { runMadDetector } from '../functions/runMadDetector/resource';
import { runStormflyDetector } from '../functions/runStormflyDetector/resource';
import { runOwlDDetector } from '../functions/runOwlDDetector/resource';
import { runElephantDetector } from '../functions/runElephantDetector/resource';
import { launchAnnotationSet } from '../functions/launchAnnotationSet/resource';
import { launchFalseNegatives } from '../functions/launchFalseNegatives/resource';
import { requeueProjectQueues } from '../functions/requeueProjectQueues/resource';
import { monitorScoutbotDlq } from '../functions/monitorScoutbotDlq/resource';
import { processTilingBatch } from '../functions/processTilingBatch/resource';
import { monitorTilingTasks } from '../functions/monitorTilingTasks/resource';
import { findAndRequeueMissingLocations } from '../functions/findAndRequeueMissingLocations/resource';
import { reconcileFalseNegatives } from '../functions/reconcileFalseNegatives/resource';
import { createOrganization } from '../functions/createOrganization/resource';
import { inviteUserToOrganization } from '../functions/inviteUserToOrganization/resource';
import { respondToInvite } from '../functions/respondToInvite/resource';
import { removeUserFromOrganization } from '../functions/removeUserFromOrganization/resource';
import { updateOrganizationMemberAdmin } from '../functions/updateOrganizationMemberAdmin/resource';
import { deleteQueue } from '../functions/deleteQueue/resource';
import { cancelIndividualIdJob } from '../functions/cancelIndividualIdJob/resource';
import { syncOrganizationGroups } from '../functions/syncOrganizationGroups/resource';
import { launchQCReview } from '../functions/launchQCReview/resource';
import { launchInfoTags } from '../functions/launchInfoTags/resource';
import { launchHomography } from '../functions/launchHomography/resource';
import { reconcileHomographies } from '../functions/reconcileHomographies/resource';
import { registrationBucketCleanup } from '../functions/registrationBucketCleanup/resource';
import { processRegistrationStream } from '../functions/processRegistrationStream/resource';
import { deleteRegistrationNeighbour } from '../functions/deleteRegistrationNeighbour/resource';
import { reconcilePretileLaunches } from '../functions/reconcilePretileLaunches/resource';
import { extendTileLifecycles } from '../functions/extendTileLifecycles/resource';
import { pretileImage } from '../functions/pretileImage/resource';
import { refreshTiles } from '../functions/refreshTiles/resource';
import { launchIndividualId } from '../functions/launchIndividualId/resource';
import { updateImageTransect } from '../functions/updateImageTransect/resource';
import { claimIndividualIdTransect } from '../functions/claimIndividualIdTransect/resource';
import { completeIndividualIdTransect } from '../functions/completeIndividualIdTransect/resource';
import { reconcileIndividualId } from '../functions/reconcileIndividualId/resource';
import { releaseIndividualIdTransects } from '../functions/releaseIndividualIdTransects/resource';
import { createChainShare } from '../functions/createChainShare/resource';
import { revokeChainShare } from '../functions/revokeChainShare/resource';
import { reportClientError } from '../functions/reportClientError/resource';
import { expireInactiveQueues } from '../functions/expireInactiveQueues/resource';

// One deploy may create ~2,500 resources, so a fresh environment starts without mutations.
const DISABLED_OPERATIONS =
  process.env.AMPLIFY_FIRST_DEPLOY === 'true'
    ? (['subscriptions', 'mutations'] as const)
    : (['subscriptions'] as const);

export const schema = a
  .schema({
    Project: a
      .model({
        organizationId: a.id().required(),
        organization: a.belongsTo('Organization', 'organizationId'),
        name: a.string().required(),
        tags: a.string().array(),
        imageSets: a.hasMany('ImageSet', 'projectId'),
        annotationSets: a.hasMany('AnnotationSet', 'projectId'),
        queues: a.hasMany('Queue', 'projectId'),
        testConfig: a.hasOne('ProjectTestConfig', 'projectId'),
        createdBy: a.string().required(),
        hidden: a.boolean().default(false),
        status: a.string().default('active'),
        individualIdJobs: a.hasMany('IndividualIdJob', 'projectId'),
        tiledLocationSetId: a.id(),
        defaultZoom: a.integer(),
        pretileManifestS3Key: a.string(),
        // JSON UploadDefaults from the last upload, used to prefill the next.
        uploadDefaults: a.string(),
        // Lines dividing the boundary into strata: { nodes: [lat, lng][], edges }.
        strataNetwork: a.json(),
        // Set while image boundary statuses and strata are being recomputed.
        boundaryRecomputeRequested: a.boolean(),
        boundaryRecomputeLeaseUntil: a.datetime(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')]),
    Category: a
      .model({
        projectId: a.id().required(),
        annotationSetId: a.id().required(),
        name: a.string().required(),
        color: a.string(),
        shortcutKey: a.string(),
        annotations: a.hasMany('Annotation', 'categoryId'),
        annotationCount: a.integer().default(0),
        locationAnnotationCounts: a.hasMany(
          'LocationAnnotationCount',
          'categoryId'
        ),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('annotationSetId').queryField('categoriesByAnnotationSetId'),
        index('projectId').queryField('categoriesByProjectId'),
      ]),
    InfoTag: a
      .model({
        projectId: a.id().required(),
        annotationSetId: a.id().required(),
        annotationSet: a.belongsTo('AnnotationSet', 'annotationSetId'),
        name: a.string().required(),
        color: a.string(),
        shortcutKey: a.string(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('annotationSetId').queryField('infoTagsByAnnotationSetId'),
        index('projectId').queryField('infoTagsByProjectId'),
      ]),
    AnnotationInfoTag: a
      .model({
        annotationId: a.id().required(),
        annotation: a.belongsTo('Annotation', 'annotationId'),
        infoTagId: a.id().required(),
        annotationSetId: a.id().required(),
        projectId: a.id().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .identifier(['annotationId', 'infoTagId'])
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('infoTagId').queryField('annotationInfoTagsByInfoTagId'),
        index('annotationSetId').queryField(
          'annotationInfoTagsByAnnotationSetId'
        ),
      ]),
    Image: a
      .model({
        projectId: a.id().required(),
        latitude: a.float(),
        longitude: a.float(),
        altitude_wgs84: a.float(),
        altitude_agl: a.float(),
        altitude_egm96: a.float(),
        width: a.integer().required(),
        height: a.integer().required(),
        roll: a.float(),
        yaw: a.float(),
        pitch: a.float(),
        originalPath: a.string(),
        timestamp: a.timestamp(),
        exifData: a.string(),
        cameraSerial: a.string(),
        files: a.hasMany('ImageFile', 'imageId'),
        locations: a.hasMany('Location', 'imageId'),
        annotations: a.hasMany('Annotation', 'imageId'),
        memberships: a.hasMany('ImageSetMembership', 'imageId'),
        leftNeighbours: a.hasMany('ImageNeighbour', 'image1Id'),
        rightNeighbours: a.hasMany('ImageNeighbour', 'image2Id'),
        cameraId: a.id(),
        camera: a.belongsTo('Camera', 'cameraId'),
        transectId: a.id(),
        processedBy: a.hasMany('ImageProcessedBy', 'imageId'),
        group: a.string(),
        phash: a.string(),
        tiledAt: a.datetime(),
        // Position relative to the survey area; a missing value counts as inside.
        boundaryStatus: a.enum(['inside', 'outside', 'excluded']),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('imagesByProjectId'),
        index('projectId')
          .sortKeys(['transectId'])
          .queryField('imagesByProjectIdAndTransectId'),
      ]),
    ImageFile: a
      .model({
        projectId: a.id().required(),
        path: a.string().required(),
        imageId: a.id(),
        key: a.string().required(),
        image: a.belongsTo('Image', 'imageId'),
        type: a.string().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('imageId').queryField('imagesByimageId'),
        index('path').queryField('imagesByPath'),
      ]),
    ImageProcessedBy: a
      .model({
        imageId: a.id().required(),
        image: a.belongsTo('Image', 'imageId'),
        source: a.string().required(),
        projectId: a.id().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .identifier(['imageId', 'source'])
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId')
          .sortKeys(['source'])
          .queryField('processedByProjectIdAndSource'),
      ]),
    AnnotationSet: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        name: a.string().required(),
        infoTags: a.hasMany('InfoTag', 'annotationSetId'),
        register: a.boolean().default(false),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('annotationSetsByProjectId'),
      ]),
    Annotation: a
      .model({
        projectId: a.id().required(),
        setId: a.id().required(),
        source: a.string().required(),
        categoryId: a.id().required(),
        category: a.belongsTo('Category', 'categoryId'),
        imageId: a.id().required(),
        image: a.belongsTo('Image', 'imageId'),
        x: a.integer().required(),
        y: a.integer().required(),
        obscured: a.boolean(),
        oov: a.boolean(),
        // Outside the survey area even when its image is inside.
        outsideBoundary: a.boolean(),
        objectId: a.id(),
        reviewCatId: a.string(),
        reviewedBy: a.string(),
        infoTags: a.hasMany('AnnotationInfoTag', 'annotationId'),
        infoTaggedBy: a.string(),
        infoTagRevision: a.integer(),
        owner: a.string(),
        group: a.string(),
        // Declared so it can sort an index; still filled in automatically.
        createdAt: a.datetime().required(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('setId').queryField('annotationsByAnnotationSetId'),
        index('projectId')
          .sortKeys(['createdAt'])
          .queryField('annotationsByProjectIdAndCreatedAt'),
        index('imageId')
          .sortKeys(['setId'])
          .queryField('annotationsByImageIdAndSetId'),
        index('objectId').queryField('annotationsByObjectId'),
        index('categoryId').queryField('annotationsByCategoryId'),
      ]),
    LocationAnnotationCount: a
      .model({
        locationId: a.id().required(),
        categoryId: a.id().required(),
        category: a.belongsTo('Category', 'categoryId'),
        annotationSetId: a.id().required(),
        count: a.integer().default(0),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .identifier(['locationId', 'categoryId', 'annotationSetId'])
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('locationId')
          .sortKeys(['annotationSetId'])
          .queryField('categoryCountsByLocationIdAndAnnotationSetId'),
      ]),
    Object: a
      .model({
        projectId: a.id().required(),
        categoryId: a.id().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')]),
    Location: a
      .model({
        projectId: a.id().required(),
        imageId: a.id(),
        image: a.belongsTo('Image', 'imageId'),
        setId: a.id().required(),
        height: a.integer(),
        width: a.integer(),
        x: a.integer().required(),
        y: a.integer().required(),
        source: a.string().required(),
        confidence: a.float(),
        observations: a.hasMany('Observation', 'locationId'),
        testPresets: a.hasMany('TestPresetLocation', 'locationId'),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('imageId')
          .sortKeys(['confidence'])
          .queryField('locationsByImageKey'),
        index('setId')
          .sortKeys(['confidence'])
          .queryField('locationsBySetIdAndConfidence'),
        index('projectId')
          .sortKeys(['source'])
          .queryField('locationsByProjectIdAndSource'),
      ]),
    Observation: a
      .model({
        projectId: a.id().required(),
        owner: a.string(),
        timeTaken: a.float(),
        annotationCount: a.integer(),
        waitingTime: a.float(),
        loadingTime: a.float(),
        // Tile network timings from src/storage/tileLoadStats.ts.
        loadMetrics: a.json(),
        locationId: a.id().required(),
        location: a.belongsTo('Location', 'locationId'),
        annotationSetId: a.id().required(),
        source: a.string(),
        createdAt: a.string().required(),
        queueId: a.id(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('locationId').queryField('observationsByLocationId'),
        index('annotationSetId')
          .sortKeys(['createdAt'])
          .queryField('observationsByAnnotationSetId'),
        index('owner').queryField('observationsByOwner'),
      ]),
    LocationSet: a
      .model({
        projectId: a.id().required(),
        name: a.string().required(),
        memberships: a.hasMany('LocationSetMembership', 'locationSetId'),
        description: a.string(),
        locationCount: a.integer().default(0),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('locationSetsByProjectId'),
      ]),
    LocationSetMembership: a
      .model({
        locationId: a.id().required(),
        locationSetId: a.id().required(),
        locationSet: a.belongsTo('LocationSet', 'locationSetId'),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')]),
    ImageSetMembership: a
      .model({
        imageId: a.id().required(),
        imageSetId: a.id().required(),
        image: a.belongsTo('Image', 'imageId'),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('imageSetId').queryField('imageSetMembershipsByImageSetId'),
      ]),
    ImageSet: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        name: a.string().required(),
        imageCount: a.integer().default(0),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('imageSetsByProjectId'),
      ]),
    UserProjectMembership: a
      .model({
        userId: a.string().required(),
        projectId: a.id().required(),
        isAdmin: a.boolean(),
        queueId: a.id(),
        backupQueueId: a.id(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('userProjectMembershipsByProjectId'),
        index('userId').queryField('userProjectMembershipsByUserId'),
      ]),
    ImageNeighbour: a
      .model({
        image1Id: a.id().required(),
        image1: a.belongsTo('Image', 'image1Id'),
        image2Id: a.id().required(),
        image2: a.belongsTo('Image', 'image2Id'),
        projectId: a.id(),
        homography: a.float().array(),
        homographySource: a.string(),
        skipped: a.boolean().default(false),
        suggestedPoints1: a.float().array(),
        suggestedPoints2: a.float().array(),
        suggestedPointsKept: a.integer(),
        cameraPairKey: a.string(),
        bucketIndex: a.integer(),
        registrationProcessedAt: a.datetime(),
        registrationFailedAt: a.datetime(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .identifier(['image1Id', 'image2Id'])
      .secondaryIndexes((index) => [
        index('image1Id').queryField('imageNeighboursByImage1key'),
        index('image2Id').queryField('imageNeighboursByImage2key'),
        index('projectId').queryField('imageNeighboursByProjectId'),
        // Same-camera rows (null cameraPairKey) are intentionally not projected.
        index('cameraPairKey')
          .sortKeys(['bucketIndex'])
          .queryField('imageNeighboursByCameraPairAndBucket'),
      ]),
    RegistrationProgress: a
      .model({
        projectId: a.id().required(),
        pairsCreated: a.integer().default(0),
        pairsProcessed: a.integer().default(0),
        pendingCount: a.integer().default(0),
        lastKickoffAt: a.datetime(),
        lastChangeAt: a.datetime(),
        cleanupState: a.string().default('pending'),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .identifier(['projectId'])
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('cleanupState').queryField('registrationProgressByCleanupState'),
      ]),
    // bucketKey = "<cameraPairKey>#<bucketIndex>" — explicit field because DynamoDB PKs are 2-attribute max.
    RegistrationBucketStat: a
      .model({
        projectId: a.id().required(),
        bucketKey: a.string().required(),
        cameraPairKey: a.string().required(),
        bucketIndex: a.integer().required(),
        successCount: a.integer().default(0),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .identifier(['projectId', 'bucketKey'])
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('registrationBucketStatsByProjectId'),
      ]),
    Queue: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        name: a.string().required(),
        batchSize: a.integer().default(0),
        totalBatches: a.integer().default(0),
        url: a.url(),
        zoom: a.integer(),
        hidden: a.boolean().default(false),
        approximateSize: a.integer(),
        tag: a.string(),
        requeueAt: a.string(),
        updatedAt: a.string(),
        annotationSetId: a.id(),
        locationSetId: a.id(),
        confidenceThreshold: a.float(),
        launchedCount: a.integer(),
        observedCount: a.integer().default(0),
        infoTagProtocolVersion: a.integer(),
        locationManifestS3Key: a.string(),
        emptyQueueTimestamp: a.string(),
        requeuesCompleted: a.integer().default(0),
        lastObservationAt: a.string(),
        lastAccessedAt: a.string(),
        inactivityWarnedAt: a.string(),
        cancelAfter: a.string(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('queuesByProjectId'),
      ]),
    UserStats: a
      .model({
        projectId: a.id().required(),
        setId: a.id().required(),
        date: a.date().required(),
        userId: a.id().required(),
        observationCount: a.integer().required(),
        sightingCount: a.integer(),
        annotationTime: a.float(),
        annotationCount: a.integer().required(),
        activeTime: a.float().required(),
        searchTime: a.float(),
        searchCount: a.integer(),
        waitingTime: a.float(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .identifier(['projectId', 'userId', 'date', 'setId'])
      .authorization((allow) => [allow.group('sysadmin')]),
    TasksOnAnnotationSet: a
      .model({
        annotationSetId: a.id().required(),
        locationSetId: a.id().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('annotationSetId').queryField('locationSetsByAnnotationSetId'),
      ]),
    ProjectTestConfig: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        testType: a.string(),
        random: a.float(),
        interval: a.float(),
        deadzone: a.float(),
        postTestConfirmation: a.boolean(),
        accuracy: a.integer().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .identifier(['projectId']),
    TestPresetProject: a
      .model({
        testPresetId: a.id().required(),
        projectId: a.id().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .identifier(['testPresetId', 'projectId'])
      .secondaryIndexes((index) => [
        index('projectId').queryField('testPresetsByProjectId'),
      ]),
    TestPreset: a
      .model({
        organizationId: a.id().required(),
        name: a.string().required(),
        // Set on the pool a survey creates for itself; shared pools have none.
        ownerProjectId: a.id(),
        testResults: a.hasMany('TestResult', 'testPresetId'),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('organizationId').queryField('testPresetsByOrganizationId'),
        index('name').queryField('testPresetsByName'),
        index('ownerProjectId').queryField('testPresetsByOwnerProjectId'),
      ]),
    TestPresetLocation: a
      .model({
        testPresetId: a.id().required(),
        locationId: a.id().required(),
        location: a.belongsTo('Location', 'locationId'),
        annotationSetId: a.id().required(),
        sourceLocationId: a.id(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .identifier(['testPresetId', 'locationId', 'annotationSetId'])
      .secondaryIndexes((index) => [
        index('testPresetId').queryField('locationsByTestPresetId'),
      ]),
    TestResult: a
      .model({
        userId: a.id().required(),
        projectId: a.id().required(),
        testPresetId: a.id().required(),
        testPreset: a.belongsTo('TestPreset', 'testPresetId'),
        locationId: a.id().required(),
        annotationSetId: a.id().required(),
        testAnimals: a.integer().required(),
        totalMissedAnimals: a.integer().required(),
        passedOnTotal: a.boolean().required(),
        // Set when per-label counts were recorded for every linked label.
        labelsLinked: a.boolean(),
        categoryCounts: a.hasMany('TestResultCategoryCount', 'testResultId'),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('userId').queryField('testResultsByUserId'),
      ]),
    TestResultCategoryCount: a
      .model({
        testResultId: a.id().required(),
        testResult: a.belongsTo('TestResult', 'testResultId'),
        categoryName: a.string().required(),
        userCount: a.integer().required(),
        testCount: a.integer().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .identifier(['testResultId', 'categoryName']),
    Shapefile: a
      .model({
        projectId: a.id().required(),
        coordinates: a.float().array(),
        // Images within this many metres of the boundary count as inside.
        marginM: a.float(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('shapefilesByProjectId'),
      ]),

    ShapefileExclusions: a
      .model({
        projectId: a.id().required(),
        coordinates: a.float().array(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('shapefileExclusionsByProjectId'),
      ]),
    Camera: a
      .model({
        projectId: a.id().required(),
        name: a.string().required(),
        focalLengthMm: a.float(),
        sensorWidthMm: a.float(),
        tiltDegrees: a.float(),
        // JSON CameraMasks: polygons as fractions of the stored image, per shape.
        masks: a.string(),
        images: a.hasMany('Image', 'cameraId'),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('camerasByProjectId'),
      ]),
    CameraOverlap: a
      .model({
        projectId: a.id().required(),
        cameraAId: a.id().required(),
        cameraBId: a.id().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .identifier(['cameraAId', 'cameraBId'])
      .secondaryIndexes((index) => [
        index('projectId').queryField('cameraOverlapsByProjectId'),
      ]),
    Transect: a
      .model({
        projectId: a.id().required(),
        stratumId: a.id().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('transectsByProjectId'),
      ]),
    Stratum: a
      .model({
        projectId: a.id().required(),
        name: a.string().required(),
        area: a.float(),
        baselineLength: a.float(),
        coordinates: a.float().array(),
        // Holds images outside the survey area for chain linking; not in results.
        offEffort: a.boolean(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('strataByProjectId'),
      ]),
    IndividualIdJob: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        annotationSetId: a.id().required(),
        categoryId: a.id().required(),
        name: a.string().required(),
        status: a.string().default('launching'),
        totalTransects: a.integer().default(0),
        // ACID-decremented as transects are completed; 0 => job done.
        remainingTransects: a.integer().default(0),
        // ACID-decremented by the SQS fanout consumer; 0 => all images reassigned.
        pendingImageUpdates: a.integer().default(0),
        pretileManifestS3Key: a.string(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('individualIdJobsByProjectId'),
        index('annotationSetId').queryField('individualIdJobsByAnnotationSetId'),
      ]),
    IndividualIdTransect: a
      .model({
        jobId: a.id().required(),
        projectId: a.id().required(),
        annotationSetId: a.id().required(),
        categoryId: a.id().required(),
        transectId: a.id().required(),
        status: a.string().default('available'),
        assignedUserId: a.string(),
        assignedAt: a.string(),
        lastActiveAt: a.string(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('jobId').queryField('individualIdTransectsByJobId'),
        index('projectId').queryField('individualIdTransectsByProjectId'),
      ]),
    JollyResult: a
      .model({
        surveyId: a.id().required(),
        stratumId: a.id().required(),
        annotationSetId: a.id().required(),
        categoryId: a.id().required(),
        animals: a.integer().required(),
        areaSurveyed: a.float().required(),
        estimate: a.float().required(),
        density: a.float().required(),
        variance: a.float().required(),
        standardError: a.float().required(),
        numSamples: a.integer().required(),
        lowerBound95: a.float().required(),
        upperBound95: a.float().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .identifier(['surveyId', 'stratumId', 'annotationSetId', 'categoryId'])
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('surveyId').queryField('jollyResultsBySurveyId'),
      ]),
    ClientErrorReport: a
      .model({
        message: a.string().required(),
        stack: a.string(),
        status: a.string(),
        url: a.string(),
        userAgent: a.string(),
        userId: a.string().required(),
        userEmail: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')]),
    Organization: a
      .model({
        name: a.string().required(),
        description: a.string(),
        memberships: a.hasMany('OrganizationMembership', 'organizationId'),
        projects: a.hasMany('Project', 'organizationId'),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')]),
    OrganizationMembership: a
      .model({
        organizationId: a.id().required(),
        organization: a.belongsTo('Organization', 'organizationId'),
        userId: a.string().required(),
        isAdmin: a.boolean().default(false),
        isTested: a.boolean().default(false),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .identifier(['organizationId', 'userId'])
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('userId').queryField('organizationsByUserId'),
        index('organizationId').queryField('membershipsByOrganizationId'),
      ]),
    OrganizationInvite: a
      .model({
        organizationId: a.id().required(),
        username: a.string().required(),
        invitedBy: a.string().required(),
        status: a.string().default('pending'),
        organizationName: a.string(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('username').queryField('organizationInvitesByUsername'),
      ]),
    OrganizationRegistration: a
      .model({
        organizationName: a.string().required(),
        briefDescription: a.string().required(),
        requestedBy: a.string().required(),
        owner: a.string(),
        status: a.string().default('pending'),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('status').queryField('organizationRegistrationsByStatus'),
      ]),
    ResultSharingToken: a
      .model({
        surveyId: a.id().required(),
        annotationSetId: a.id().required(),
        jwt: a.string().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .identifier(['surveyId', 'annotationSetId'])
      .authorization((allow) => [allow.group('sysadmin')]),
    JollyResultsMembership: a
      .model({
        surveyId: a.id().required(),
        annotationSetId: a.id().required(),
        userId: a.string().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .identifier(['surveyId', 'annotationSetId', 'userId'])
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('surveyId')
          .queryField('jollyResultsMembershipsBySurveyId')
          .sortKeys(['annotationSetId']),
      ]),
    // Reviewer access is scoped via a per-share Cognito group `chainshare-<shareId>`.
    ChainShare: a
      .model({
        shareId: a.id().required(),
        surveyId: a.id().required(),
        annotationSetId: a.id().required(),
        surveyName: a.string(),
        annotationSetName: a.string(),
        status: a.string().default('active'),
        operationStartedAt: a.datetime(),
        errorMessage: a.string(),
        createdBy: a.string(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .identifier(['shareId'])
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('annotationSetId').queryField('chainSharesByAnnotationSetId'),
      ]),
    SharedChainAnnotation: a
      .model({
        shareId: a.id().required(),
        sourceAnnotationId: a.id().required(),
        x: a.integer().required(),
        y: a.integer().required(),
        imageId: a.id().required(),
        objectId: a.id(),
        categoryId: a.id().required(),
        obscured: a.boolean(),
        oov: a.boolean(),
        imageTimestamp: a.timestamp(),
        infoTags: a.string().array(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('shareId').queryField('sharedChainAnnotationsByShareId'),
      ]),
    SharedChainImage: a
      .model({
        shareId: a.id().required(),
        sourceImageId: a.id().required(),
        width: a.integer().required(),
        height: a.integer().required(),
        originalPath: a.string(),
        timestamp: a.timestamp(),
        cameraId: a.id(),
        cameraName: a.string(),
        cameraSerial: a.string(),
        // Precomputed at snapshot time; reviewers can't read ImageFile directly.
        sourceKey: a.string(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('shareId').queryField('sharedChainImagesByShareId'),
      ]),
    SharedChainLocation: a
      .model({
        shareId: a.id().required(),
        sourceLocationId: a.id().required(),
        imageId: a.id().required(),
        x: a.integer().required(),
        y: a.integer().required(),
        width: a.integer(),
        height: a.integer(),
        confidence: a.float(),
        source: a.string().required(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('shareId').queryField('sharedChainLocationsByShareId'),
      ]),
    SharedChainNeighbour: a
      .model({
        shareId: a.id().required(),
        image1Id: a.id().required(),
        image2Id: a.id().required(),
        homography: a.float().array(),
        homographySource: a.string(),
        skipped: a.boolean().default(false),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('shareId').queryField('sharedChainNeighboursByShareId'),
      ]),
    SharedChainCategory: a
      .model({
        shareId: a.id().required(),
        sourceCategoryId: a.id().required(),
        name: a.string().required(),
        color: a.string(),
        shortcutKey: a.string(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('shareId').queryField('sharedChainCategoriesByShareId'),
      ]),
    // chainMutationGuard validates current share membership, source IDs and
    // ownership before the generated owner-authorized mutation can write.
    ChainReviewFeedback: a
      .model({
        shareId: a.id().required(),
        sharedAnnotationId: a.id().required(),
        chainId: a.string(),
        kind: a.string().required(),
        proposedObscured: a.boolean(),
        proposedCategoryId: a.id(),
        comment: a.string(),
        owner: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('shareId').sortKeys(['owner']).queryField('chainReviewFeedbackByShareId'),
      ]),
    ClientLog: a
      .model({
        userId: a.string().required(),
        ipAddress: a.string(),
        userAgent: a.string(),
        deviceType: a.string(),
        os: a.string(),
        connectionType: a.string(),
        downlink: a.float(),
        rtt: a.float(),
        owner: a.string(),
        createdAt: a.datetime().required(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('userId').queryField('clientLogsByUserId'),
        index('userId')
          .sortKeys(['createdAt'])
          .queryField('clientLogsByUserIdAndCreatedAt'),
      ]),
    AdminActionLog: a
      .model({
        userId: a.string().required(),
        message: a.string().required(),
        projectId: a.id(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('adminActionLogsByProjectId'),
        index('userId').queryField('adminActionLogsByUserId'),
      ]),
    TilingTask: a
      .model({
        projectId: a.id().required(),
        locationSetId: a.id().required(),
        annotationSetId: a.id().required(),
        status: a.string().default('pending'),
        launchConfig: a.string().required(),
        totalBatches: a.integer().default(0),
        completedBatches: a.integer().default(0),
        totalLocations: a.integer().default(0),
        outputS3Key: a.string(),
        errorMessage: a.string(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('status').queryField('tilingTasksByStatus'),
        index('projectId').queryField('tilingTasksByProjectId'),
      ]),
    TilingBatch: a
      .model({
        tilingTaskId: a.id().required(),
        batchIndex: a.integer().required(),
        status: a.string().default('pending'),
        inputS3Key: a.string().required(),
        outputS3Key: a.string(),
        locationCount: a.integer().default(0),
        createdCount: a.integer().default(0),
        errorMessage: a.string(),
        group: a.string(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
      .secondaryIndexes((index) => [
        index('tilingTaskId')
          .sortKeys(['batchIndex'])
          .queryField('tilingBatchesByTaskId'),
      ]),
    updateProjectMemberships: a
      .mutation()
      .arguments({
        projectId: a.string().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.group('sysadmin')])
      .handler(a.handler.function(updateProjectMemberships)),
    decrementIndividualIdImageUpdates: a
      .mutation()
      .arguments({ id: a.id().required(), count: a.integer().required() })
      .returns(a.integer())
      .handler(a.handler.custom({
        entry: './decrementIndividualIdImageUpdates.js',
        dataSource: a.ref('IndividualIdJob'),
      }))
      .authorization((allow) => [allow.group('sysadmin')]),
    decrementIndividualIdRemainingTransects: a
      .mutation()
      .arguments({ id: a.id().required() })
      .returns(a.integer())
      .handler(a.handler.custom({
        entry: './decrementIndividualIdRemainingTransects.js',
        dataSource: a.ref('IndividualIdJob'),
      }))
      .authorization((allow) => [allow.group('sysadmin')]),
    incrementRegistrationProgress: a
      .mutation()
      .arguments({
        projectId: a.id().required(),
        pairsCreatedDelta: a.integer(),
        pairsProcessedDelta: a.integer(),
        pendingCountDelta: a.integer(),
        kickoff: a.boolean(),
        resetCleanupState: a.boolean(),
        group: a.string(),
      })
      .returns(a.json())
      .handler(a.handler.custom({
        entry: './incrementRegistrationProgress.js',
        dataSource: a.ref('RegistrationProgress'),
      }))
      .authorization((allow) => [allow.group('sysadmin')]),
    incrementRegistrationBucketStat: a
      .mutation()
      .arguments({
        projectId: a.id().required(),
        bucketKey: a.string().required(),
        cameraPairKey: a.string().required(),
        bucketIndex: a.integer().required(),
        group: a.string(),
      })
      .returns(a.json())
      .handler(a.handler.custom({
        entry: './incrementRegistrationBucketStat.js',
        dataSource: a.ref('RegistrationBucketStat'),
      }))
      .authorization((allow) => [allow.group('sysadmin')]),
    fixDeploymentTable: a
      .model({
        name: a.string().required(),
        version: a.string().required(),
      })
      .disableOperations(DISABLED_OPERATIONS)
      .authorization((allow) => [allow.group('sysadmin')])
  })
  .authorization((allow) => [
    allow.resource(api),
    allow.resource(updateUserStats),
    allow.resource(monitorModelProgress),
    allow.resource(updateProjectMemberships),
    allow.resource(cleanupJobs),
    allow.resource(runImageRegistration),
    allow.resource(runScoutbot),
    allow.resource(runMadDetector),
    allow.resource(runStormflyDetector),
    allow.resource(runOwlDDetector),
    allow.resource(runElephantDetector),
    allow.resource(launchAnnotationSet),
    allow.resource(launchFalseNegatives),
    allow.resource(launchQCReview),
    allow.resource(launchInfoTags),
    allow.resource(launchHomography),
    allow.resource(reconcileHomographies),
    allow.resource(registrationBucketCleanup),
    allow.resource(processRegistrationStream),
    allow.resource(deleteRegistrationNeighbour),
    allow.resource(reconcilePretileLaunches),
    allow.resource(extendTileLifecycles),
    allow.resource(pretileImage),
    allow.resource(refreshTiles),
    allow.resource(requeueProjectQueues),
    allow.resource(deleteProject),
    allow.resource(generateSurveyResults),
    allow.resource(monitorScoutbotDlq),
    allow.resource(processTilingBatch),
    allow.resource(monitorTilingTasks),
    allow.resource(findAndRequeueMissingLocations),
    allow.resource(reconcileFalseNegatives),
    allow.resource(createOrganization),
    allow.resource(inviteUserToOrganization),
    allow.resource(respondToInvite),
    allow.resource(removeUserFromOrganization),
    allow.resource(updateOrganizationMemberAdmin),
    allow.resource(deleteQueue),
    allow.resource(queryWorkflowEvents),
    allow.resource(cancelIndividualIdJob),
    allow.resource(syncOrganizationGroups),
    allow.resource(launchIndividualId),
    allow.resource(updateImageTransect),
    allow.resource(claimIndividualIdTransect),
    allow.resource(completeIndividualIdTransect),
    allow.resource(reconcileIndividualId),
    allow.resource(releaseIndividualIdTransects),
    allow.resource(createChainShare),
    allow.resource(revokeChainShare),
    allow.resource(reportClientError),
    allow.resource(expireInactiveQueues),
  ]);

export type ServerSchema = typeof schema;

interface LambdaContext {
  awsRequestId?: string;
  getRemainingTimeInMillis: () => number;
}

type AppSyncIdentityCognito = {
  sub: string;
  username: string;
  claims: Record<string, string>;
  groups: string[] | null;
  issuer: string;
  defaultAuthStrategy: string;
};

type MutationHandler<Args, Result = unknown> = (
  event: { arguments: Args; identity?: AppSyncIdentityCognito },
  context: LambdaContext
) => Promise<Result>;

export type AddUserToGroupHandler = MutationHandler<{ userId: string; groupName: string }>;
export type RemoveUserFromGroupHandler = MutationHandler<{ userId: string; groupName: string }>;
export type CreateGroupHandler = MutationHandler<{ groupName: string }>;

export type ListUsersHandler = MutationHandler<{ nextToken?: string | null }>;
export type ListGroupsForUserHandler = MutationHandler<{ userId: string; nextToken?: string | null }>;

export type DeleteProjectInFullHandler = MutationHandler<{ projectId: string }>;
export type GenerateSurveyResultsHandler = MutationHandler<{
  surveyId: string;
  annotationSetId: string;
  categoryIds: string[];
}>;
export type RecordWorkflowTaskHandler = MutationHandler<
  {
    workflowRunId: string;
    workItemType: string;
    workItemId: string;
    outcome: string;
    idempotencyKey?: string | null;
    startedAt?: string | null;
    activeTimeMs?: number | null;
    waitingTimeMs?: number | null;
    skipped?: boolean | null;
    metrics?: unknown;
  },
  { eventId: string; duplicate: boolean }
>;
export type LaunchAnnotationSetHandler = MutationHandler<{ request: string }>;
export type LaunchFalseNegativesHandler = MutationHandler<{ request: string }>;
export type LaunchQCReviewHandler = MutationHandler<{ request: string }>;
export type LaunchInfoTagsHandler = MutationHandler<{ request: string }>;
export type LaunchHomographyHandler = MutationHandler<{ request: string }>;
export type UpdateProjectMembershipsHandler = MutationHandler<{ projectId: string }>;
export type RunImageRegistrationHandler = MutationHandler<{ projectId: string; metadata: string; queueUrl: string; images?: string[] | null }>;
export type RunScoutbotHandler = MutationHandler<{ projectId: string; bucket: string; queueUrl: string; images?: string[] | null; setId: string; rotation?: number | null; landscape?: boolean | null }>;
export type RunMadDetectorHandler = MutationHandler<{ projectId: string; bucket: string; queueUrl: string; images?: string[] | null; setId: string }>;
export type RunStormflyDetectorHandler = MutationHandler<{ projectId: string; bucket: string; queueUrl: string; images?: string[] | null; setId: string; rotation?: number | null; landscape?: boolean | null }>;
export type RunOwlDDetectorHandler = MutationHandler<{ projectId: string; bucket: string; queueUrl: string; images?: string[] | null; setId: string; rotation?: number | null; landscape?: boolean | null }>;
export type RunElephantDetectorHandler = MutationHandler<{ projectId: string; bucket: string; queueUrl: string; images?: string[] | null; setId: string; rotation?: number | null; landscape?: boolean | null }>;

export type GetJwtSecretHandler = MutationHandler<Record<string, never>, string>;

export type CreateOrganizationHandler = MutationHandler<{ name: string; description?: string | null; adminEmail: string; registrationId?: string | null }>;
export type InviteUserToOrganizationHandler = MutationHandler<{ organizationId: string; email: string }>;
export type RespondToInviteHandler = MutationHandler<{ inviteId: string; accept: boolean }>;
export type RemoveUserFromOrganizationHandler = MutationHandler<{ organizationId: string; userId: string }>;
export type UpdateOrganizationMemberAdminHandler = MutationHandler<{ organizationId: string; userId: string; isAdmin: boolean }>;
export type DeleteQueueHandler = MutationHandler<{ queueId: string }>;
export type CancelIndividualIdJobHandler = MutationHandler<{ jobId: string }>;
export type SyncOrganizationGroupsHandler = MutationHandler<Record<string, never>>;
export type LaunchIndividualIdHandler = MutationHandler<{ request: string }>;
export type RecomputeBoundaryStatusHandler = MutationHandler<{ projectId: string }>;
export type GetRowChunkHandler = MutationHandler<
  {
    source: string;
    scopeId: string;
    fields: (string | null)[];
    beginsWith?: string | null;
    between?: (number | null)[] | null;
    betweenText?: (string | null)[] | null;
    cursor?: string | null;
  },
  { data: string; count: number; cursor: string | null }
>;
export type ClaimIndividualIdTransectHandler = MutationHandler<{ jobId: string }>;
export type CompleteIndividualIdTransectHandler = MutationHandler<{ transectRowId: string }>;
export type CreateChainShareHandler = MutationHandler<{ annotationSetId: string; shareId: string }>;
export type RevokeChainShareHandler = MutationHandler<{ shareId: string }>;
export type ReportClientErrorHandler = MutationHandler<{
  message: string;
  stack?: string | null;
  status?: string | null;
  url?: string | null;
  userAgent?: string | null;
}>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
