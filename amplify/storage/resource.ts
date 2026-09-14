import { imageAccess } from './imageAccess/resource';
import { defineStorage } from "@aws-amplify/backend"
import { generateTile } from "./generateTile/resource"
import { handleS3Upload } from "./handleS3Upload/resource"
import { monitorModelProgress } from "../functions/monitorModelProgress/resource"
import { launchAnnotationSet } from "../functions/launchAnnotationSet/resource"
import { launchFalseNegatives } from "../functions/launchFalseNegatives/resource"
import { processTilingBatch } from "../functions/processTilingBatch/resource"
import { monitorTilingTasks } from "../functions/monitorTilingTasks/resource"
import { cleanupJobs } from "../functions/cleanupJobs/resource"
import { findAndRequeueMissingLocations } from "../functions/findAndRequeueMissingLocations/resource"
import { reconcileFalseNegatives } from "../functions/reconcileFalseNegatives/resource"
import { launchQCReview } from "../functions/launchQCReview/resource"
import { launchInfoTags } from "../functions/launchInfoTags/resource"
import { launchHomography } from "../functions/launchHomography/resource"
import { reconcileHomographies } from "../functions/reconcileHomographies/resource"
import { reconcilePretileLaunches } from "../functions/reconcilePretileLaunches/resource"
import { pretileImage } from "../functions/pretileImage/resource"
import { refreshTiles } from "../functions/refreshTiles/resource"
import { launchIndividualId } from "../functions/launchIndividualId/resource"
import { reconcileIndividualId } from "../functions/reconcileIndividualId/resource"
import { generateSurveyResults } from "../functions/generateSurveyResults/resource"

export const outputBucket = defineStorage({
  name: "outputs",
  isDefault: true,
  access: allow => ({
    'slippymaps/*': [
      allow.resource(imageAccess).to(['get', 'list']),
      allow.resource(generateTile).to(['write', 'list', 'get']),
      allow.resource(handleS3Upload).to(['write', 'list', 'get', 'delete']),
      allow.resource(pretileImage).to(['write']),
      allow.resource(refreshTiles).to(['list', 'get', 'write']),

      allow.groups(['sysadmin']).to(['read', 'write', 'delete'])
    ],
    'heatmaps/*': [
      allow.resource(monitorModelProgress).to(['read']),
      allow.authenticated.to(['read']),
      allow.groups(['sysadmin']).to(['read', 'write', 'delete'])
    ],
    'launch-payloads/*': [
      allow.authenticated.to(['write', 'read']),
      allow.resource(launchAnnotationSet).to(['read', 'delete']),
      allow.resource(launchFalseNegatives).to(['read', 'delete']),
      allow.resource(launchIndividualId).to(['read', 'delete']),
      allow.groups(['sysadmin']).to(['read', 'write', 'delete'])
    ],
    // Tiling batch input files - location data to be created
    'tiling-batches/*': [
      allow.resource(launchAnnotationSet).to(['write']),
      allow.resource(launchFalseNegatives).to(['write']),
      allow.resource(processTilingBatch).to(['read', 'delete']),
      allow.groups(['sysadmin']).to(['read', 'write', 'delete'])
    ],
    // Tiling batch output files - created location IDs
    'tiling-outputs/*': [
      allow.resource(processTilingBatch).to(['write']),
      allow.resource(monitorTilingTasks).to(['read', 'delete']),
      allow.groups(['sysadmin']).to(['read', 'write', 'delete'])
    ],
    // Queue manifests for requeue detection
    'queue-manifests/*': [
      allow.authenticated.to(['write', 'read']),
      allow.resource(launchAnnotationSet).to(['read', 'write']),
      allow.resource(launchQCReview).to(['write']),
      allow.resource(launchInfoTags).to(['write']),
      allow.resource(launchHomography).to(['read']),
      allow.resource(monitorTilingTasks).to(['write']),
      allow.resource(findAndRequeueMissingLocations).to(['read']),
      allow.resource(cleanupJobs).to(['delete']),
      allow.resource(reconcileHomographies).to(['read', 'delete']),
      allow.groups(['sysadmin']).to(['read', 'write', 'delete'])
    ],
    'jolly-status/*': [
      allow.authenticated.to(['read']),
      allow.resource(generateSurveyResults).to(['write']),
      allow.groups(['sysadmin']).to(['read', 'delete'])
    ],
    // Pretile launch manifests for tiling workflow tracking
    'pretile-launch-manifests/*': [
      allow.resource(launchAnnotationSet).to(['write']),
      allow.resource(launchFalseNegatives).to(['write']),
      allow.resource(launchQCReview).to(['write']),
      allow.resource(launchInfoTags).to(['write']),
      allow.resource(launchHomography).to(['write']),
      allow.resource(launchIndividualId).to(['write']),
      allow.resource(reconcilePretileLaunches).to(['read', 'delete']),
      allow.resource(reconcileIndividualId).to(['read', 'delete']),
      allow.groups(['sysadmin']).to(['read', 'write', 'delete'])
    ],
    // QC review manifests for tracking sampled annotations
    'qc-review-manifests/*': [
      allow.authenticated.to(['read']),
      allow.resource(launchQCReview).to(['write']),
      allow.resource(findAndRequeueMissingLocations).to(['read']),
      allow.groups(['sysadmin']).to(['read', 'write', 'delete'])
    ],
    'info-tag-manifests/*': [
      allow.authenticated.to(['read']),
      allow.resource(launchInfoTags).to(['write']),
      allow.resource(findAndRequeueMissingLocations).to(['read']),
      allow.groups(['sysadmin']).to(['read', 'write', 'delete'])
    ],
    // False negative pools for species labelling reconciliation
    'false-negative-pools/*': [
      allow.authenticated.to(['read', 'delete']),
      allow.resource(launchFalseNegatives).to(['read', 'write']),
      allow.resource(launchAnnotationSet).to(['delete']),
      allow.resource(reconcileFalseNegatives).to(['read', 'write']),
      allow.groups(['sysadmin']).to(['read', 'write', 'delete'])
    ],
    // False negative history tracking
    'false-negative-history/*': [
      allow.authenticated.to(['read', 'delete']),
      allow.resource(launchFalseNegatives).to(['read', 'write']),
      allow.resource(launchAnnotationSet).to(['delete']),
      allow.resource(reconcileFalseNegatives).to(['read', 'write']),
      allow.groups(['sysadmin']).to(['read', 'write', 'delete'])
    ]
  })
})

// export const storageOS = defineStorage({
//   name: "opensearch-backup-bucket-amplify-gen-2",
//   access: allow => ({
//     'public/*': [
//       allow.guest.to(['list', 'write', 'get'])
//     ]
//   })
// })

export const inputBucket = defineStorage({
  name: "inputs",
  access: allow => ({
    'images/*': [
      allow.resource(imageAccess).to(['get', 'write', 'list']),
      allow.resource(generateTile).to(['get']),
      // The upload handler replaces images carrying an orientation correction
      // with physically rotated pixels before downstream processing starts.
      allow.resource(handleS3Upload).to(['get', 'write']),
      allow.resource(pretileImage).to(['get']),

      allow.groups(['sysadmin']).to(['read', 'write', 'delete'])
    ]
  }),
  triggers: {
    onUpload: handleS3Upload
  }
})

