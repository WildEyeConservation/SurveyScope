import { a, defineData } from '@aws-amplify/backend';
import { addUserToGroup } from '../functions/add-user-to-group/resource';
import { createGroup } from '../data/create-group/resource';
import { listUsers } from '../data/list-users/resource';
import { listGroupsForUser } from '../data/list-groups-for-user/resource';
import { removeUserFromGroup } from '../data/remove-user-from-group/resource';
import { updateUserStats } from '../functions/updateUserStats/resource';
import { monitorModelProgress } from '../functions/monitorModelProgress/resource';
import { updateProjectMemberships } from '../functions/updateProjectMemberships/resource';
import { cleanupJobs } from '../functions/cleanupJobs/resource';
import { runImageRegistration } from '../functions/runImageRegistration/resource';
import { runScoutbot } from '../functions/runScoutbot/resource';
import { deleteProject } from '../functions/deleteProject/resource';
import { generateSurveyResults } from '../functions/generateSurveyResults/resource';
import { queryWorkflowStats } from '../functions/queryWorkflowStats/resource';
import { recordWorkflowTask } from '../functions/recordWorkflowTask/resource';
import { getJwtSecret } from '../functions/getJwtSecret/resource';
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
import { updateActiveOrganizations } from '../functions/updateActiveOrganizations/resource';
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
import { generateTile } from '../storage/generateTile/resource';

const schema = a
  .schema({
    UserType: a.customType({
      name: a.string(),
      id: a.id().required(),
      email: a.string(),
      isAdmin: a.boolean(),
    }),
    Project: a
      .model({
        organizationId: a.id().required(),
        organization: a.belongsTo('Organization', 'organizationId'),
        name: a.string().required(),
        tags: a.string().array(),
        images: a.hasMany('Image', 'projectId'),
        imageFiles: a.hasMany('ImageFile', 'projectId'),
        annotations: a.hasMany('Annotation', 'projectId'),
        objects: a.hasMany('Object', 'projectId'),
        imageSets: a.hasMany('ImageSet', 'projectId'),
        annotationSets: a.hasMany('AnnotationSet', 'projectId'),
        locations: a.hasMany('Location', 'projectId'),
        locationSets: a.hasMany('LocationSet', 'projectId'),
        observations: a.hasMany('Observation', 'projectId'),
        members: a.hasMany('UserProjectMembership', 'projectId'),
        queues: a.hasMany('Queue', 'projectId'),
        shapefile: a.hasOne('Shapefile', 'projectId'),
        testConfig: a.hasOne('ProjectTestConfig', 'projectId'),
        testResults: a.hasMany('TestResult', 'projectId'),
        createdBy: a.string().required(),
        hidden: a.boolean().default(false),
        status: a.string().default('active'),
        cameras: a.hasMany('Camera', 'projectId'),
        transects: a.hasMany('Transect', 'projectId'),
        individualIdJobs: a.hasMany('IndividualIdJob', 'projectId'),
        strata: a.hasMany('Stratum', 'projectId'),
        jollyResultsMemberships: a.hasMany(
          'JollyResultsMembership',
          'surveyId'
        ),
        cameraOverlaps: a.hasMany('CameraOverlap', 'projectId'),
        shapefileExclusions: a.hasMany('ShapefileExclusions', 'projectId'),
        adminActionLogs: a.hasMany('AdminActionLog', 'projectId'),
        tiledLocationSetId: a.id(),
        pretileManifestS3Key: a.string(),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')]),
    Category: a
      .model({
        projectId: a.id().required(),
        annotationSetId: a.id().required(),
        annotationSet: a.belongsTo('AnnotationSet', 'annotationSetId'),
        name: a.string().required(),
        color: a.string(),
        shortcutKey: a.string(),
        annotations: a.hasMany('Annotation', 'categoryId'),
        annotationCount: a.integer().default(0),
        objects: a.hasMany('Object', 'categoryId'),
        locationAnnotationCounts: a.hasMany(
          'LocationAnnotationCount',
          'categoryId'
        ),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
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
        annotations: a.hasMany('AnnotationInfoTag', 'infoTagId'),
        group: a.string(),
      })
      .authorization((allow) => [
        allow.group('sysadmin'),
        allow.groupDefinedIn('group'),
      ])
      .secondaryIndexes((index) => [
        index('annotationSetId').queryField('infoTagsByAnnotationSetId'),
        index('projectId').queryField('infoTagsByProjectId'),
      ]),
    AnnotationInfoTag: a
      .model({
        annotationId: a.id().required(),
        annotation: a.belongsTo('Annotation', 'annotationId'),
        infoTagId: a.id().required(),
        infoTag: a.belongsTo('InfoTag', 'infoTagId'),
        annotationSetId: a.id().required(),
        projectId: a.id().required(),
        group: a.string(),
      })
      .identifier(['annotationId', 'infoTagId'])
      .authorization((allow) => [
        allow.group('sysadmin'),
        allow.groupDefinedIn('group'),
      ])
      .secondaryIndexes((index) => [
        index('infoTagId').queryField('annotationInfoTagsByInfoTagId'),
        index('annotationSetId').queryField(
          'annotationInfoTagsByAnnotationSetId'
        ),
      ]),
    Image: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
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
        transect: a.belongsTo('Transect', 'transectId'),
        processedBy: a.hasMany('ImageProcessedBy', 'imageId'),
        group: a.string(),
        phash: a.string(),
        tiledAt: a.datetime(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('imagesByProjectId'),
        index('projectId')
          .sortKeys(['transectId'])
          .queryField('imagesByProjectIdAndTransectId'),
      ]),
    ImageFile: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        path: a.string().required(),
        imageId: a.id(),
        key: a.string().required(),
        image: a.belongsTo('Image', 'imageId'),
        type: a.string().required(),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
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
      .identifier(['imageId', 'source'])
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
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
        annotations: a.hasMany('Annotation', 'setId'),
        annotationCount: a.integer().default(0),
        observations: a.hasMany('Observation', 'annotationSetId'),
        tasks: a.hasMany('TasksOnAnnotationSet', 'annotationSetId'),
        testPresetLocations: a.hasMany('TestPresetLocation', 'annotationSetId'),
        locationAnnotationCounts: a.hasMany(
          'LocationAnnotationCount',
          'annotationSetId'
        ),
        testResults: a.hasMany('TestResult', 'annotationSetId'),
        categories: a.hasMany('Category', 'annotationSetId'),
        infoTags: a.hasMany('InfoTag', 'annotationSetId'),
        register: a.boolean().default(false),
        jollyResultsMemberships: a.hasMany(
          'JollyResultsMembership',
          'annotationSetId'
        ),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('annotationSetsByProjectId'),
      ]),
    Annotation: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        setId: a.id().required(),
        set: a.belongsTo('AnnotationSet', 'setId'),
        source: a.string().required(),
        categoryId: a.id().required(),
        category: a.belongsTo('Category', 'categoryId'),
        imageId: a.id().required(),
        image: a.belongsTo('Image', 'imageId'),
        x: a.integer().required(),
        y: a.integer().required(),
        obscured: a.boolean(),
        oov: a.boolean(),
        objectId: a.id(),
        object: a.belongsTo('Object', 'objectId'),
        reviewCatId: a.string(),
        reviewedBy: a.string(),
        infoTags: a.hasMany('AnnotationInfoTag', 'annotationId'),
        infoTaggedBy: a.string(),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.owner(), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('setId').queryField('annotationsByAnnotationSetId'),
        index('imageId')
          .sortKeys(['setId'])
          .queryField('annotationsByImageIdAndSetId'),
        index('objectId').queryField('annotationsByObjectId'),
        index('categoryId').queryField('annotationsByCategoryId'),
      ]),
    LocationAnnotationCount: a
      .model({
        locationId: a.id().required(),
        location: a.belongsTo('Location', 'locationId'),
        categoryId: a.id().required(),
        category: a.belongsTo('Category', 'categoryId'),
        annotationSetId: a.id().required(),
        annotationSet: a.belongsTo('AnnotationSet', 'annotationSetId'),
        count: a.integer().default(0),
        group: a.string(),
      })
      .identifier(['locationId', 'categoryId', 'annotationSetId'])
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('locationId')
          .sortKeys(['annotationSetId'])
          .queryField('categoryCountsByLocationIdAndAnnotationSetId'),
      ]),
    Object: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        annotations: a.hasMany('Annotation', 'objectId'),
        categoryId: a.id().required(),
        category: a.belongsTo('Category', 'categoryId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')]),
    Location: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        imageId: a.id(),
        image: a.belongsTo('Image', 'imageId'),
        setId: a.id().required(),
        set: a.belongsTo('LocationSet', 'setId'),
        height: a.integer(),
        width: a.integer(),
        x: a.integer().required(),
        y: a.integer().required(),
        source: a.string().required(),
        confidence: a.float(),
        observations: a.hasMany('Observation', 'locationId'),
        sets: a.hasMany('LocationSetMembership', 'locationId'),
        testPresets: a.hasMany('TestPresetLocation', 'locationId'),
        annotationCounts: a.hasMany('LocationAnnotationCount', 'locationId'),
        testResults: a.hasMany('TestResult', 'locationId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
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
        project: a.belongsTo('Project', 'projectId'),
        timeTaken: a.float(),
        annotationCount: a.integer(),
        waitingTime: a.float(),
        loadingTime: a.float(),
        locationId: a.id().required(),
        location: a.belongsTo('Location', 'locationId'),
        annotationSetId: a.id().required(),
        annotationSet: a.belongsTo('AnnotationSet', 'annotationSetId'),
        source: a.string(),
        createdAt: a.string().required(),
        queueId: a.id(),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.owner(), allow.groupDefinedIn('group')])
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
        project: a.belongsTo('Project', 'projectId'),
        locations: a.hasMany('Location', 'setId'),
        memberships: a.hasMany('LocationSetMembership', 'locationSetId'),
        description: a.string(),
        locationCount: a.integer().default(0),
        tasks: a.hasMany('TasksOnAnnotationSet', 'locationSetId'),
        tilingTasks: a.hasMany('TilingTask', 'locationSetId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('locationSetsByProjectId'),
      ]),
    LocationSetMembership: a
      .model({
        locationId: a.id().required(),
        locationSetId: a.id().required(),
        location: a.belongsTo('Location', 'locationId'),
        locationSet: a.belongsTo('LocationSet', 'locationSetId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')]),
    ImageSetMembership: a
      .model({
        imageId: a.id().required(),
        imageSetId: a.id().required(),
        image: a.belongsTo('Image', 'imageId'),
        imageSet: a.belongsTo('ImageSet', 'imageSetId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('imageSetId').queryField('imageSetMembershipsByImageSetId'),
      ]),
    ImageSet: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        name: a.string().required(),
        images: a.hasMany('ImageSetMembership', 'imageSetId'),
        imageCount: a.integer().default(0),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('imageSetsByProjectId'),
      ]),
    UserProjectMembership: a
      .model({
        userId: a.string().required(),
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        isAdmin: a.boolean(),
        queueId: a.id(),
        queue: a.belongsTo('Queue', 'queueId'),
        backupQueueId: a.id(),
        backupQueue: a.belongsTo('Queue', 'backupQueueId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.authenticated().to(['listen']), allow.groupDefinedIn('group')])
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
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .identifier(['image1Id', 'image2Id'])
      .secondaryIndexes((index) => [
        index('image1Id').queryField('imageNeighboursByImage1key'),
        index('image2Id').queryField('imageNeighboursByImage2key'),
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
      .identifier(['projectId'])
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
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
      .identifier(['projectId', 'bucketKey'])
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('registrationBucketStatsByProjectId'),
      ]),
    Queue: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        name: a.string().required(),
        users: a.hasMany('UserProjectMembership', 'queueId'),
        batchSize: a.integer().default(0),
        totalBatches: a.integer().default(0),
        backupUsers: a.hasMany('UserProjectMembership', 'backupQueueId'),
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
        locationManifestS3Key: a.string(),
        emptyQueueTimestamp: a.string(),
        requeuesCompleted: a.integer().default(0),
        lastObservationAt: a.string(),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
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
      .identifier(['projectId', 'userId', 'date', 'setId'])
      .authorization((allow) => [allow.group('sysadmin'), allow.authenticated().to(['listen']), allow.groupDefinedIn('group').to(['read'])]),
    TasksOnAnnotationSet: a
      .model({
        annotationSetId: a.id().required(),
        annotationSet: a.belongsTo('AnnotationSet', 'annotationSetId'),
        locationSetId: a.id().required(),
        locationSet: a.belongsTo('LocationSet', 'locationSetId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group').to(['read'])])
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
        testPresetProjects: a.hasMany('TestPresetProject', 'projectId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .identifier(['projectId']),
    TestPresetProject: a
      .model({
        testPresetId: a.id().required(),
        testPreset: a.belongsTo('TestPreset', 'testPresetId'),
        projectId: a.id().required(),
        projectConfig: a.belongsTo('ProjectTestConfig', 'projectId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .identifier(['testPresetId', 'projectId'])
      .secondaryIndexes((index) => [
        index('projectId').queryField('testPresetsByProjectId'),
      ]),
    TestPreset: a
      .model({
        organizationId: a.id().required(),
        organization: a.belongsTo('Organization', 'organizationId'),
        name: a.string().required(),
        locations: a.hasMany('TestPresetLocation', 'testPresetId'),
        projects: a.hasMany('TestPresetProject', 'testPresetId'),
        testResults: a.hasMany('TestResult', 'testPresetId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('organizationId').queryField('testPresetsByOrganizationId'),
        index('name').queryField('testPresetsByName'),
      ]),
    TestPresetLocation: a
      .model({
        testPresetId: a.id().required(),
        testPreset: a.belongsTo('TestPreset', 'testPresetId'),
        locationId: a.id().required(),
        location: a.belongsTo('Location', 'locationId'),
        annotationSetId: a.id().required(),
        annotationSet: a.belongsTo('AnnotationSet', 'annotationSetId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .identifier(['testPresetId', 'locationId', 'annotationSetId'])
      .secondaryIndexes((index) => [
        index('testPresetId').queryField('locationsByTestPresetId'),
      ]),
    TestResult: a
      .model({
        userId: a.id().required(),
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        testPresetId: a.id().required(),
        testPreset: a.belongsTo('TestPreset', 'testPresetId'),
        locationId: a.id().required(),
        location: a.belongsTo('Location', 'locationId'),
        annotationSetId: a.id().required(),
        annotationSet: a.belongsTo('AnnotationSet', 'annotationSetId'),
        testAnimals: a.integer().required(),
        totalMissedAnimals: a.integer().required(),
        passedOnTotal: a.boolean().required(),
        categoryCounts: a.hasMany('TestResultCategoryCount', 'testResultId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
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
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .identifier(['testResultId', 'categoryName']),
    Shapefile: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        coordinates: a.float().array(),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('shapefilesByProjectId'),
      ]),

    ShapefileExclusions: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        coordinates: a.float().array(),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('shapefileExclusionsByProjectId'),
      ]),
    Camera: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        name: a.string().required(),
        focalLengthMm: a.float(),
        sensorWidthMm: a.float(),
        tiltDegrees: a.float(),
        images: a.hasMany('Image', 'cameraId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('camerasByProjectId'),
      ]),
    CameraOverlap: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        cameraAId: a.id().required(),
        cameraBId: a.id().required(),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .identifier(['cameraAId', 'cameraBId'])
      .secondaryIndexes((index) => [
        index('projectId').queryField('cameraOverlapsByProjectId'),
      ]),
    Transect: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        stratumId: a.id().required(),
        stratum: a.belongsTo('Stratum', 'stratumId'),
        images: a.hasMany('Image', 'transectId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('projectId').queryField('transectsByProjectId'),
      ]),
    Stratum: a
      .model({
        projectId: a.id().required(),
        project: a.belongsTo('Project', 'projectId'),
        name: a.string().required(),
        transects: a.hasMany('Transect', 'stratumId'),
        area: a.float(),
        baselineLength: a.float(),
        coordinates: a.float().array(),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
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
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
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
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
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
      .identifier(['surveyId', 'stratumId', 'annotationSetId', 'categoryId'])
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group').to(['read', 'update'])])
      .secondaryIndexes((index) => [
        index('surveyId').queryField('jollyResultsBySurveyId'),
      ]),
    addUserToGroup: a
      .mutation()
      .arguments({
        userId: a.string().required(),
        groupName: a.string().required(),
      })
      .authorization((allow) => [allow.group('sysadmin')])
      .handler(a.handler.function(addUserToGroup))
      .returns(a.json()),
    removeUserFromGroup: a
      .mutation()
      .arguments({
        userId: a.string().required(),
        groupName: a.string().required(),
      })
      .authorization((allow) => [allow.group('sysadmin')])
      .handler(a.handler.function(removeUserFromGroup))
      .returns(a.json()),
    createGroup: a
      .mutation()
      .arguments({
        groupName: a.string().required(),
      })
      .authorization((allow) => [allow.group('sysadmin')])
      .handler(a.handler.function(createGroup))
      .returns(a.json()),
    listUsers: a
      .query()
      .arguments({
        nextToken: a.string(),
      })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(listUsers))
      .returns(
        a.customType({
          Users: a.ref('UserType').array(),
          NextToken: a.string(),
        })
      ),
    listGroupsForUser: a
      .query()
      .arguments({
        userId: a.string().required(),
        nextToken: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin')])
      .handler(a.handler.function(listGroupsForUser))
      .returns(a.json()),
    createOrganizationMutation: a
      .mutation()
      .arguments({
        name: a.string().required(),
        description: a.string(),
        adminEmail: a.string().required(),
        registrationId: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin')])
      .handler(a.handler.function(createOrganization))
      .returns(a.json()),
    inviteUserToOrganization: a
      .mutation()
      .arguments({
        organizationId: a.string().required(),
        email: a.string().required(),
      })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(inviteUserToOrganization))
      .returns(a.json()),
    respondToInvite: a
      .mutation()
      .arguments({
        inviteId: a.string().required(),
        accept: a.boolean().required(),
      })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(respondToInvite))
      .returns(a.json()),
    removeUserFromOrganization: a
      .mutation()
      .arguments({
        organizationId: a.string().required(),
        userId: a.string().required(),
      })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(removeUserFromOrganization))
      .returns(a.json()),
    updateOrganizationMemberAdmin: a
      .mutation()
      .arguments({
        organizationId: a.string().required(),
        userId: a.string().required(),
        isAdmin: a.boolean().required(),
      })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(updateOrganizationMemberAdmin))
      .returns(a.json()),
    deleteQueueMutation: a
      .mutation()
      .arguments({ queueId: a.string().required() })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(deleteQueue))
      .returns(a.json()),
    Message: a.customType({
      content: a.string().required(),
      channelName: a.string().required(),
    }),
    publish: a
      .mutation()
      .arguments({
        channelName: a.string().required(),
        content: a.string().required(),
      })
      .returns(a.json())
      .handler(a.handler.custom({ entry: './publish.js' }))
      .authorization((allow) => [
        allow.authenticated(),
      ]),
    receive: a
      .subscription()
      .for(a.ref('publish'))
      .arguments({ namePrefix: a.string() })
      .handler(
        a.handler.custom({
          entry: './receive.js',
        })
      )
      .authorization((allow) => [allow.authenticated()]),
    Organization: a
      .model({
        name: a.string().required(),
        description: a.string(),
        memberships: a.hasMany('OrganizationMembership', 'organizationId'),
        projects: a.hasMany('Project', 'organizationId'),
        invites: a.hasMany('OrganizationInvite', 'organizationId'),
        testPresets: a.hasMany('TestPreset', 'organizationId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group("sysadmin"), allow.groupDefinedIn("group").to(['read'])]),
    OrganizationMembership: a
      .model({
        organizationId: a.id().required(),
        organization: a.belongsTo('Organization', 'organizationId'),
        userId: a.string().required(),
        isAdmin: a.boolean().default(false),
        isTested: a.boolean().default(false),
        group: a.string(),
      })
      .identifier(['organizationId', 'userId'])
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn("group").to(['read'])])
      .secondaryIndexes((index) => [
        index('userId').queryField('organizationsByUserId'),
        index('organizationId').queryField('membershipsByOrganizationId'),
      ]),
    OrganizationInvite: a
      .model({
        organizationId: a.id().required(),
        organization: a.belongsTo('Organization', 'organizationId'),
        username: a.string().required(),
        invitedBy: a.string().required(),
        status: a.string().default('pending'),
        organizationName: a.string(),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.ownerDefinedIn('username').to(['read'])])
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
      .identifier(['surveyId', 'annotationSetId'])
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn("group")]),
    JollyResultsMembership: a
      .model({
        surveyId: a.id().required(),
        annotationSetId: a.id().required(),
        survey: a.belongsTo('Project', 'surveyId'),
        annotationSet: a.belongsTo('AnnotationSet', 'annotationSetId'),
        userId: a.string().required(),
        group: a.string(),
      })
      .identifier(['surveyId', 'annotationSetId', 'userId'])
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn("group")])
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
        createdBy: a.string(),
        group: a.string(),
      })
      .identifier(['shareId'])
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group').to(['read'])])
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
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group').to(['read'])])
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
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group').to(['read'])])
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
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group').to(['read'])])
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
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group').to(['read'])])
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
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group').to(['read'])])
      .secondaryIndexes((index) => [
        index('shareId').queryField('sharedChainCategoriesByShareId'),
      ]),
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
      .authorization((allow) => [allow.owner(), allow.group('sysadmin')])
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
      })
      .authorization((allow) => [allow.owner().to(['create', 'read']), allow.group("sysadmin")])
      .secondaryIndexes((index) => [
        index('userId').queryField('clientLogsByUserId'),
      ]),
    AdminActionLog: a
      .model({
        userId: a.string().required(),
        message: a.string().required(),
        projectId: a.id(),
        project: a.belongsTo('Project', 'projectId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn("group")])
      .secondaryIndexes((index) => [
        index('projectId').queryField('adminActionLogsByProjectId'),
        index('userId').queryField('adminActionLogsByUserId'),
      ]),
    TilingTask: a
      .model({
        projectId: a.id().required(),
        locationSetId: a.id().required(),
        locationSet: a.belongsTo('LocationSet', 'locationSetId'),
        annotationSetId: a.id().required(),
        status: a.string().default('pending'),
        launchConfig: a.string().required(),
        totalBatches: a.integer().default(0),
        completedBatches: a.integer().default(0),
        totalLocations: a.integer().default(0),
        outputS3Key: a.string(),
        errorMessage: a.string(),
        batches: a.hasMany('TilingBatch', 'tilingTaskId'),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
      .secondaryIndexes((index) => [
        index('status').queryField('tilingTasksByStatus'),
        index('projectId').queryField('tilingTasksByProjectId'),
      ]),
    TilingBatch: a
      .model({
        tilingTaskId: a.id().required(),
        tilingTask: a.belongsTo('TilingTask', 'tilingTaskId'),
        batchIndex: a.integer().required(),
        status: a.string().default('pending'),
        inputS3Key: a.string().required(),
        outputS3Key: a.string(),
        locationCount: a.integer().default(0),
        createdCount: a.integer().default(0),
        errorMessage: a.string(),
        group: a.string(),
      })
      .authorization((allow) => [allow.group('sysadmin'), allow.groupDefinedIn('group')])
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
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(updateProjectMemberships)),
    runImageRegistration: a
      .mutation()
      .arguments({
        projectId: a.string().required(),
        metadata: a.string().required(),
        queueUrl: a.string().required(),
        images: a.string().array(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(runImageRegistration)),
    runScoutbot: a
      .mutation()
      .arguments({
        projectId: a.string().required(),
        bucket: a.string().required(),
        queueUrl: a.string().required(),
        images: a.string().array(),
        setId: a.string().required(),
        // Optional CCW rotation (90/180/270) applied before inference, for images
        // whose true orientation is missing from EXIF. Detection boxes are mapped
        // back to the stored frame. Used when requeueing such images.
        rotation: a.integer(),
        // Optional orientation guard for `rotation`: when true, only images whose
        // width exceeds height are rotated; when false, only those with height >
        // width; when unset, every image is rotated regardless of dimensions.
        landscape: a.boolean(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(runScoutbot)),
    runMadDetector: a
      .mutation()
      .arguments({
        projectId: a.string().required(),
        bucket: a.string().required(),
        queueUrl: a.string().required(),
        images: a.string().array(),
        setId: a.string().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(runMadDetector)),
    runStormflyDetector: a
      .mutation()
      .arguments({
        projectId: a.string().required(),
        bucket: a.string().required(),
        queueUrl: a.string().required(),
        images: a.string().array(),
        setId: a.string().required(),
        // Optional CCW rotation (90/180/270) applied before inference, for images
        // whose true orientation is missing from EXIF. Detection points are mapped
        // back to the stored frame. Used when requeueing such images.
        rotation: a.integer(),
        // Optional orientation guard for `rotation`: when true, only images whose
        // width exceeds height are rotated; when false, only those with height >
        // width; when unset, every image is rotated regardless of dimensions.
        landscape: a.boolean(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(runStormflyDetector)),
    runOwlDDetector: a
      .mutation()
      .arguments({
        projectId: a.string().required(),
        bucket: a.string().required(),
        queueUrl: a.string().required(),
        images: a.string().array(),
        setId: a.string().required(),
        rotation: a.integer(),
        landscape: a.boolean(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(runOwlDDetector)),
    runElephantDetector: a
      .mutation()
      .arguments({
        projectId: a.string().required(),
        bucket: a.string().required(),
        queueUrl: a.string().required(),
        images: a.string().array(),
        setId: a.string().required(),
        rotation: a.integer(),
        landscape: a.boolean(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(runElephantDetector)),
    deleteProjectInFull: a
      .mutation()
      .arguments({
        projectId: a.string().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(deleteProject)),
    generateSurveyResults: a
      .mutation()
      .arguments({
        surveyId: a.string().required(),
        annotationSetId: a.string().required(),
        categoryIds: a.string().array().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(generateSurveyResults)),
    // Reads the standalone workflow statistics tables, which are not Amplify
    // Data models. Returns json rather than custom types to keep the resource
    // footprint of the data stack minimal.
    queryWorkflowStats: a
      .query()
      .arguments({
        projectId: a.string().required(),
        annotationSetIds: a.string().array(),
        startDate: a.string(),
        endDate: a.string(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.group('sysadmin')])
      .handler(a.handler.function(queryWorkflowStats)),
    // Records one completed unit for workflows whose completion happens in the
    // browser. The caller names only the run and the work item: workflow type,
    // project, annotation set and organization are read from the durable run,
    // and the credited user comes from the request identity.
    recordWorkflowTask: a
      .mutation()
      .arguments({
        workflowRunId: a.string().required(),
        workItemType: a.string().required(),
        workItemId: a.string().required(),
        outcome: a.string().required(),
        idempotencyKey: a.string(),
        startedAt: a.string(),
        activeTimeMs: a.integer(),
        waitingTimeMs: a.integer(),
        skipped: a.boolean(),
        metrics: a.json(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(recordWorkflowTask)),
    // Named `snapshot...` to avoid clashing with the auto-generated `createChainShare` mutation.
    snapshotChainShare: a
      .mutation()
      .arguments({
        annotationSetId: a.string().required(),
        shareId: a.string().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.group('sysadmin')])
      .handler(a.handler.function(createChainShare)),
    // NB: reviewer Cognito group membership must be revoked separately.
    revokeChainShare: a
      .mutation()
      .arguments({
        shareId: a.string().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.group('sysadmin')])
      .handler(a.handler.function(revokeChainShare)),
    launchAnnotationSet: a
      .mutation()
      .arguments({
        request: a.string().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(launchAnnotationSet)),
    launchFalseNegatives: a
      .mutation()
      .arguments({
        request: a.string().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(launchFalseNegatives)),
    launchQCReview: a
      .mutation()
      .arguments({
        request: a.string().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(launchQCReview)),
    launchInfoTags: a
      .mutation()
      .arguments({
        request: a.string().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(launchInfoTags)),
    launchHomography: a
      .mutation()
      .arguments({
        request: a.string().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(launchHomography)),
    launchIndividualId: a
      .mutation()
      .arguments({
        request: a.string().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(launchIndividualId)),
    claimIndividualIdTransect: a
      .mutation()
      .arguments({
        jobId: a.string().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(claimIndividualIdTransect)),
    completeIndividualIdTransect: a
      .mutation()
      .arguments({
        transectRowId: a.string().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(completeIndividualIdTransect)),
    decrementIndividualIdImageUpdates: a
      .mutation()
      .arguments({ id: a.id().required(), count: a.integer().required() })
      .returns(a.integer())
      .handler(a.handler.custom({
        entry: './decrementIndividualIdImageUpdates.js',
        dataSource: a.ref('IndividualIdJob'),
      }))
      .authorization((allow) => [allow.authenticated()]),
    decrementIndividualIdRemainingTransects: a
      .mutation()
      .arguments({ id: a.id().required() })
      .returns(a.integer())
      .handler(a.handler.custom({
        entry: './decrementIndividualIdRemainingTransects.js',
        dataSource: a.ref('IndividualIdJob'),
      }))
      .authorization((allow) => [allow.authenticated()]),
    pingIndividualIdTransect: a
      .mutation()
      .arguments({ id: a.id().required() })
      .returns(a.json())
      .handler(a.handler.custom({
        entry: './pingIndividualIdTransect.js',
        dataSource: a.ref('IndividualIdTransect'),
      }))
      .authorization((allow) => [allow.authenticated()]),
    incrementQueueCount: a
      .mutation()
      .arguments({ id: a.id().required() })
      .returns(a.integer())
      .handler(a.handler.custom({
        entry: './incrementQueueCount.js',
        dataSource: a.ref('Queue'),
      }))
      .authorization((allow) => [allow.authenticated()]),
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
      .authorization((allow) => [allow.authenticated()]),
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
      .authorization((allow) => [allow.authenticated()]),
    getJwtSecret: a
      .mutation()
      .returns(a.string())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(getJwtSecret)),
    updateActiveOrganizations: a
      .mutation()
      .arguments({
        activatedOrganizationIds: a.string().array().required(),
      })
      .returns(a.json())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(updateActiveOrganizations)),
    generateTile: a
      .query()
      .arguments({
        imageKey: a.string().required(),
        imageId: a.id(),
        zs: a.integer().required().array().required(),
        rows: a.integer().required().array().required(),
        cols: a.integer().required().array().required(),
      })
      .returns(a.string().array())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(generateTile)),
    // Forces full deployment instead of hotswapping resources.
    fixDeploymentTable: a
      .model({
        name: a.string().required(),
        version: a.string().required(),
      })
      .authorization((allow) => [allow.group("sysadmin")])
  })
  .authorization((allow) => [
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
    allow.resource(getJwtSecret),
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
    allow.resource(updateActiveOrganizations),
    allow.resource(launchIndividualId),
    allow.resource(updateImageTransect),
    allow.resource(claimIndividualIdTransect),
    allow.resource(completeIndividualIdTransect),
    allow.resource(reconcileIndividualId),
    allow.resource(releaseIndividualIdTransects),
    allow.resource(createChainShare),
    allow.resource(revokeChainShare),
  ]);

export type ServerSchema = typeof schema;

interface LambdaContext {
  awsRequestId?: string;
  callbackWaitsForEmptyEventLoop: boolean;
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
export type UpdateActiveOrganizationsHandler = MutationHandler<{ activatedOrganizationIds: string[] }>;
export type LaunchIndividualIdHandler = MutationHandler<{ request: string }>;
export type ClaimIndividualIdTransectHandler = MutationHandler<{ jobId: string }>;
export type CompleteIndividualIdTransectHandler = MutationHandler<{ transectRowId: string }>;
export type CreateChainShareHandler = MutationHandler<{ annotationSetId: string; shareId: string }>;
export type RevokeChainShareHandler = MutationHandler<{ shareId: string }>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
