/* tslint:disable */
/* eslint-disable */
// this is an auto generated file. This will be overwritten

import * as APITypes from "./API";
type GeneratedQuery<InputType, OutputType> = string & {
  __generatedQueryInput: InputType;
  __generatedQueryOutput: OutputType;
};

export const annotationSetsByProjectId = /* GraphQL */ `query AnnotationSetsByProjectId(
  $filter: ModelAnnotationSetFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  annotationSetsByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      id
      name
      projectId
      register
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.AnnotationSetsByProjectIdQueryVariables,
  APITypes.AnnotationSetsByProjectIdQuery
>;
export const annotationsByAnnotationSetId = /* GraphQL */ `query AnnotationsByAnnotationSetId(
  $filter: ModelAnnotationFilterInput
  $limit: Int
  $nextToken: String
  $setId: ID!
  $sortDirection: ModelSortDirection
) {
  annotationsByAnnotationSetId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    setId: $setId
    sortDirection: $sortDirection
  ) {
    items {
      categoryId
      createdAt
      id
      imageId
      objectId
      obscured
      owner
      projectId
      setId
      source
      updatedAt
      x
      y
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.AnnotationsByAnnotationSetIdQueryVariables,
  APITypes.AnnotationsByAnnotationSetIdQuery
>;
export const annotationsByCategoryId = /* GraphQL */ `query AnnotationsByCategoryId(
  $categoryId: ID!
  $filter: ModelAnnotationFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  annotationsByCategoryId(
    categoryId: $categoryId
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      categoryId
      createdAt
      id
      imageId
      objectId
      obscured
      owner
      projectId
      setId
      source
      updatedAt
      x
      y
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.AnnotationsByCategoryIdQueryVariables,
  APITypes.AnnotationsByCategoryIdQuery
>;
export const annotationsByImageIdAndSetId = /* GraphQL */ `query AnnotationsByImageIdAndSetId(
  $filter: ModelAnnotationFilterInput
  $imageId: ID!
  $limit: Int
  $nextToken: String
  $setId: ModelIDKeyConditionInput
  $sortDirection: ModelSortDirection
) {
  annotationsByImageIdAndSetId(
    filter: $filter
    imageId: $imageId
    limit: $limit
    nextToken: $nextToken
    setId: $setId
    sortDirection: $sortDirection
  ) {
    items {
      categoryId
      createdAt
      id
      imageId
      objectId
      obscured
      owner
      projectId
      setId
      source
      updatedAt
      x
      y
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.AnnotationsByImageIdAndSetIdQueryVariables,
  APITypes.AnnotationsByImageIdAndSetIdQuery
>;
export const annotationsByObjectId = /* GraphQL */ `query AnnotationsByObjectId(
  $filter: ModelAnnotationFilterInput
  $limit: Int
  $nextToken: String
  $objectId: ID!
  $sortDirection: ModelSortDirection
) {
  annotationsByObjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    objectId: $objectId
    sortDirection: $sortDirection
  ) {
    items {
      categoryId
      createdAt
      id
      imageId
      objectId
      obscured
      owner
      projectId
      setId
      source
      updatedAt
      x
      y
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.AnnotationsByObjectIdQueryVariables,
  APITypes.AnnotationsByObjectIdQuery
>;
export const cameraOverlapsByProjectId = /* GraphQL */ `query CameraOverlapsByProjectId(
  $filter: ModelCameraOverlapFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  cameraOverlapsByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      cameraAId
      cameraBId
      createdAt
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.CameraOverlapsByProjectIdQueryVariables,
  APITypes.CameraOverlapsByProjectIdQuery
>;
export const camerasByProjectId = /* GraphQL */ `query CamerasByProjectId(
  $filter: ModelCameraFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  camerasByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      focalLengthMm
      id
      name
      projectId
      sensorWidthMm
      tiltDegrees
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.CamerasByProjectIdQueryVariables,
  APITypes.CamerasByProjectIdQuery
>;
export const categoriesByAnnotationSetId = /* GraphQL */ `query CategoriesByAnnotationSetId(
  $annotationSetId: ID!
  $filter: ModelCategoryFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  categoriesByAnnotationSetId(
    annotationSetId: $annotationSetId
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      annotationCount
      annotationSetId
      color
      createdAt
      id
      name
      projectId
      shortcutKey
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.CategoriesByAnnotationSetIdQueryVariables,
  APITypes.CategoriesByAnnotationSetIdQuery
>;
export const categoriesByProjectId = /* GraphQL */ `query CategoriesByProjectId(
  $filter: ModelCategoryFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  categoriesByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      annotationCount
      annotationSetId
      color
      createdAt
      id
      name
      projectId
      shortcutKey
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.CategoriesByProjectIdQueryVariables,
  APITypes.CategoriesByProjectIdQuery
>;
export const categoryCountsByLocationIdAndAnnotationSetId = /* GraphQL */ `query CategoryCountsByLocationIdAndAnnotationSetId(
  $annotationSetId: ModelIDKeyConditionInput
  $filter: ModelLocationAnnotationCountFilterInput
  $limit: Int
  $locationId: ID!
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  categoryCountsByLocationIdAndAnnotationSetId(
    annotationSetId: $annotationSetId
    filter: $filter
    limit: $limit
    locationId: $locationId
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      annotationSetId
      categoryId
      count
      createdAt
      locationId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.CategoryCountsByLocationIdAndAnnotationSetIdQueryVariables,
  APITypes.CategoryCountsByLocationIdAndAnnotationSetIdQuery
>;
export const categoryCountsByTestResultId = /* GraphQL */ `query CategoryCountsByTestResultId(
  $filter: ModelTestResultCategoryCountFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $testResultId: ID!
) {
  categoryCountsByTestResultId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    testResultId: $testResultId
  ) {
    items {
      categoryName
      createdAt
      testCount
      testResultId
      updatedAt
      userCount
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.CategoryCountsByTestResultIdQueryVariables,
  APITypes.CategoryCountsByTestResultIdQuery
>;
export const clientLogsByUserId = /* GraphQL */ `query ClientLogsByUserId(
  $filter: ModelClientLogFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $userId: String!
) {
  clientLogsByUserId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    userId: $userId
  ) {
    items {
      connectionType
      createdAt
      deviceType
      downlink
      id
      ipAddress
      os
      rtt
      updatedAt
      userAgent
      userId
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ClientLogsByUserIdQueryVariables,
  APITypes.ClientLogsByUserIdQuery
>;
export const getAnnotation = /* GraphQL */ `query GetAnnotation($id: ID!) {
  getAnnotation(id: $id) {
    category {
      annotationCount
      annotationSetId
      color
      createdAt
      id
      name
      projectId
      shortcutKey
      updatedAt
      __typename
    }
    categoryId
    createdAt
    id
    image {
      altitude_agl
      altitude_egm96
      altitude_wgs84
      cameraId
      cameraSerial
      createdAt
      exifData
      height
      id
      latitude
      longitude
      originalPath
      pitch
      projectId
      roll
      timestamp
      transectId
      updatedAt
      width
      yaw
      __typename
    }
    imageId
    object {
      categoryId
      createdAt
      id
      projectId
      updatedAt
      __typename
    }
    objectId
    obscured
    owner
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    set {
      createdAt
      id
      name
      projectId
      register
      updatedAt
      __typename
    }
    setId
    source
    updatedAt
    x
    y
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetAnnotationQueryVariables,
  APITypes.GetAnnotationQuery
>;
export const getAnnotationSet = /* GraphQL */ `query GetAnnotationSet($id: ID!) {
  getAnnotationSet(id: $id) {
    annotations {
      nextToken
      __typename
    }
    categories {
      nextToken
      __typename
    }
    createdAt
    id
    jollyResultsMemberships {
      nextToken
      __typename
    }
    locationAnnotationCounts {
      nextToken
      __typename
    }
    name
    observations {
      nextToken
      __typename
    }
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    register
    tasks {
      nextToken
      __typename
    }
    testPresetLocations {
      nextToken
      __typename
    }
    testResults {
      nextToken
      __typename
    }
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetAnnotationSetQueryVariables,
  APITypes.GetAnnotationSetQuery
>;
export const getCamera = /* GraphQL */ `query GetCamera($id: ID!) {
  getCamera(id: $id) {
    createdAt
    focalLengthMm
    id
    images {
      nextToken
      __typename
    }
    name
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    sensorWidthMm
    tiltDegrees
    updatedAt
    __typename
  }
}
` as GeneratedQuery<APITypes.GetCameraQueryVariables, APITypes.GetCameraQuery>;
export const getCameraOverlap = /* GraphQL */ `query GetCameraOverlap($cameraAId: ID!, $cameraBId: ID!) {
  getCameraOverlap(cameraAId: $cameraAId, cameraBId: $cameraBId) {
    cameraAId
    cameraBId
    createdAt
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetCameraOverlapQueryVariables,
  APITypes.GetCameraOverlapQuery
>;
export const getCategory = /* GraphQL */ `query GetCategory($id: ID!) {
  getCategory(id: $id) {
    annotationCount
    annotationSet {
      createdAt
      id
      name
      projectId
      register
      updatedAt
      __typename
    }
    annotationSetId
    annotations {
      nextToken
      __typename
    }
    color
    createdAt
    id
    locationAnnotationCounts {
      nextToken
      __typename
    }
    name
    objects {
      nextToken
      __typename
    }
    projectId
    shortcutKey
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetCategoryQueryVariables,
  APITypes.GetCategoryQuery
>;
export const getClientLog = /* GraphQL */ `query GetClientLog($id: ID!) {
  getClientLog(id: $id) {
    connectionType
    createdAt
    deviceType
    downlink
    id
    ipAddress
    os
    rtt
    updatedAt
    userAgent
    userId
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetClientLogQueryVariables,
  APITypes.GetClientLogQuery
>;
export const getImage = /* GraphQL */ `query GetImage($id: ID!) {
  getImage(id: $id) {
    altitude_agl
    altitude_egm96
    altitude_wgs84
    annotations {
      nextToken
      __typename
    }
    camera {
      createdAt
      focalLengthMm
      id
      name
      projectId
      sensorWidthMm
      tiltDegrees
      updatedAt
      __typename
    }
    cameraId
    cameraSerial
    createdAt
    exifData
    files {
      nextToken
      __typename
    }
    height
    id
    latitude
    leftNeighbours {
      nextToken
      __typename
    }
    locations {
      nextToken
      __typename
    }
    longitude
    memberships {
      nextToken
      __typename
    }
    originalPath
    pitch
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    rightNeighbours {
      nextToken
      __typename
    }
    roll
    timestamp
    transect {
      createdAt
      id
      projectId
      stratumId
      updatedAt
      __typename
    }
    transectId
    updatedAt
    width
    yaw
    __typename
  }
}
` as GeneratedQuery<APITypes.GetImageQueryVariables, APITypes.GetImageQuery>;
export const getImageCounts = /* GraphQL */ `query GetImageCounts($imageSetId: String!, $nextToken: String) {
  getImageCounts(imageSetId: $imageSetId, nextToken: $nextToken) {
    count
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetImageCountsQueryVariables,
  APITypes.GetImageCountsQuery
>;
export const getImageFile = /* GraphQL */ `query GetImageFile($id: ID!) {
  getImageFile(id: $id) {
    createdAt
    id
    image {
      altitude_agl
      altitude_egm96
      altitude_wgs84
      cameraId
      cameraSerial
      createdAt
      exifData
      height
      id
      latitude
      longitude
      originalPath
      pitch
      projectId
      roll
      timestamp
      transectId
      updatedAt
      width
      yaw
      __typename
    }
    imageId
    key
    path
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    type
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetImageFileQueryVariables,
  APITypes.GetImageFileQuery
>;
export const getImageNeighbour = /* GraphQL */ `query GetImageNeighbour($image1Id: ID!, $image2Id: ID!) {
  getImageNeighbour(image1Id: $image1Id, image2Id: $image2Id) {
    createdAt
    homography
    image1 {
      altitude_agl
      altitude_egm96
      altitude_wgs84
      cameraId
      cameraSerial
      createdAt
      exifData
      height
      id
      latitude
      longitude
      originalPath
      pitch
      projectId
      roll
      timestamp
      transectId
      updatedAt
      width
      yaw
      __typename
    }
    image1Id
    image2 {
      altitude_agl
      altitude_egm96
      altitude_wgs84
      cameraId
      cameraSerial
      createdAt
      exifData
      height
      id
      latitude
      longitude
      originalPath
      pitch
      projectId
      roll
      timestamp
      transectId
      updatedAt
      width
      yaw
      __typename
    }
    image2Id
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetImageNeighbourQueryVariables,
  APITypes.GetImageNeighbourQuery
>;
export const getImageSet = /* GraphQL */ `query GetImageSet($id: ID!) {
  getImageSet(id: $id) {
    createdAt
    id
    imageCount
    images {
      nextToken
      __typename
    }
    name
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetImageSetQueryVariables,
  APITypes.GetImageSetQuery
>;
export const getImageSetMembership = /* GraphQL */ `query GetImageSetMembership($id: ID!) {
  getImageSetMembership(id: $id) {
    createdAt
    id
    image {
      altitude_agl
      altitude_egm96
      altitude_wgs84
      cameraId
      cameraSerial
      createdAt
      exifData
      height
      id
      latitude
      longitude
      originalPath
      pitch
      projectId
      roll
      timestamp
      transectId
      updatedAt
      width
      yaw
      __typename
    }
    imageId
    imageSet {
      createdAt
      id
      imageCount
      name
      projectId
      updatedAt
      __typename
    }
    imageSetId
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetImageSetMembershipQueryVariables,
  APITypes.GetImageSetMembershipQuery
>;
export const getJollyResult = /* GraphQL */ `query GetJollyResult(
  $annotationSetId: ID!
  $categoryId: ID!
  $stratumId: ID!
  $surveyId: ID!
) {
  getJollyResult(
    annotationSetId: $annotationSetId
    categoryId: $categoryId
    stratumId: $stratumId
    surveyId: $surveyId
  ) {
    animals
    annotationSetId
    areaSurveyed
    categoryId
    createdAt
    density
    estimate
    lowerBound95
    numSamples
    standardError
    stratumId
    surveyId
    updatedAt
    upperBound95
    variance
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetJollyResultQueryVariables,
  APITypes.GetJollyResultQuery
>;
export const getJollyResultsMembership = /* GraphQL */ `query GetJollyResultsMembership(
  $annotationSetId: ID!
  $surveyId: ID!
  $userId: String!
) {
  getJollyResultsMembership(
    annotationSetId: $annotationSetId
    surveyId: $surveyId
    userId: $userId
  ) {
    annotationSet {
      createdAt
      id
      name
      projectId
      register
      updatedAt
      __typename
    }
    annotationSetId
    createdAt
    survey {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    surveyId
    updatedAt
    userId
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetJollyResultsMembershipQueryVariables,
  APITypes.GetJollyResultsMembershipQuery
>;
export const getLocation = /* GraphQL */ `query GetLocation($id: ID!) {
  getLocation(id: $id) {
    annotationCounts {
      nextToken
      __typename
    }
    confidence
    createdAt
    height
    id
    image {
      altitude_agl
      altitude_egm96
      altitude_wgs84
      cameraId
      cameraSerial
      createdAt
      exifData
      height
      id
      latitude
      longitude
      originalPath
      pitch
      projectId
      roll
      timestamp
      transectId
      updatedAt
      width
      yaw
      __typename
    }
    imageId
    observations {
      nextToken
      __typename
    }
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    set {
      createdAt
      id
      locationCount
      name
      projectId
      updatedAt
      __typename
    }
    setId
    sets {
      nextToken
      __typename
    }
    source
    testPresets {
      nextToken
      __typename
    }
    testResults {
      nextToken
      __typename
    }
    updatedAt
    width
    x
    y
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetLocationQueryVariables,
  APITypes.GetLocationQuery
>;
export const getLocationAnnotationCount = /* GraphQL */ `query GetLocationAnnotationCount(
  $annotationSetId: ID!
  $categoryId: ID!
  $locationId: ID!
) {
  getLocationAnnotationCount(
    annotationSetId: $annotationSetId
    categoryId: $categoryId
    locationId: $locationId
  ) {
    annotationSet {
      createdAt
      id
      name
      projectId
      register
      updatedAt
      __typename
    }
    annotationSetId
    category {
      annotationCount
      annotationSetId
      color
      createdAt
      id
      name
      projectId
      shortcutKey
      updatedAt
      __typename
    }
    categoryId
    count
    createdAt
    location {
      confidence
      createdAt
      height
      id
      imageId
      projectId
      setId
      source
      updatedAt
      width
      x
      y
      __typename
    }
    locationId
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetLocationAnnotationCountQueryVariables,
  APITypes.GetLocationAnnotationCountQuery
>;
export const getLocationSet = /* GraphQL */ `query GetLocationSet($id: ID!) {
  getLocationSet(id: $id) {
    createdAt
    id
    locationCount
    locations {
      nextToken
      __typename
    }
    memberships {
      nextToken
      __typename
    }
    name
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    tasks {
      nextToken
      __typename
    }
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetLocationSetQueryVariables,
  APITypes.GetLocationSetQuery
>;
export const getLocationSetMembership = /* GraphQL */ `query GetLocationSetMembership($id: ID!) {
  getLocationSetMembership(id: $id) {
    createdAt
    id
    location {
      confidence
      createdAt
      height
      id
      imageId
      projectId
      setId
      source
      updatedAt
      width
      x
      y
      __typename
    }
    locationId
    locationSet {
      createdAt
      id
      locationCount
      name
      projectId
      updatedAt
      __typename
    }
    locationSetId
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetLocationSetMembershipQueryVariables,
  APITypes.GetLocationSetMembershipQuery
>;
export const getObject = /* GraphQL */ `query GetObject($id: ID!) {
  getObject(id: $id) {
    annotations {
      nextToken
      __typename
    }
    category {
      annotationCount
      annotationSetId
      color
      createdAt
      id
      name
      projectId
      shortcutKey
      updatedAt
      __typename
    }
    categoryId
    createdAt
    id
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    updatedAt
    __typename
  }
}
` as GeneratedQuery<APITypes.GetObjectQueryVariables, APITypes.GetObjectQuery>;
export const getObservation = /* GraphQL */ `query GetObservation($id: ID!) {
  getObservation(id: $id) {
    annotationCount
    annotationSet {
      createdAt
      id
      name
      projectId
      register
      updatedAt
      __typename
    }
    annotationSetId
    createdAt
    id
    loadingTime
    location {
      confidence
      createdAt
      height
      id
      imageId
      projectId
      setId
      source
      updatedAt
      width
      x
      y
      __typename
    }
    locationId
    owner
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    timeTaken
    updatedAt
    waitingTime
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetObservationQueryVariables,
  APITypes.GetObservationQuery
>;
export const getOrganization = /* GraphQL */ `query GetOrganization($id: ID!) {
  getOrganization(id: $id) {
    createdAt
    description
    id
    invites {
      nextToken
      __typename
    }
    memberships {
      nextToken
      __typename
    }
    name
    projects {
      nextToken
      __typename
    }
    testPresets {
      nextToken
      __typename
    }
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetOrganizationQueryVariables,
  APITypes.GetOrganizationQuery
>;
export const getOrganizationInvite = /* GraphQL */ `query GetOrganizationInvite($id: ID!) {
  getOrganizationInvite(id: $id) {
    createdAt
    id
    invitedBy
    organization {
      createdAt
      description
      id
      name
      updatedAt
      __typename
    }
    organizationId
    status
    updatedAt
    username
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetOrganizationInviteQueryVariables,
  APITypes.GetOrganizationInviteQuery
>;
export const getOrganizationMembership = /* GraphQL */ `query GetOrganizationMembership($organizationId: ID!, $userId: String!) {
  getOrganizationMembership(organizationId: $organizationId, userId: $userId) {
    createdAt
    isAdmin
    isTested
    organization {
      createdAt
      description
      id
      name
      updatedAt
      __typename
    }
    organizationId
    updatedAt
    userId
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetOrganizationMembershipQueryVariables,
  APITypes.GetOrganizationMembershipQuery
>;
export const getOrganizationRegistration = /* GraphQL */ `query GetOrganizationRegistration($id: ID!) {
  getOrganizationRegistration(id: $id) {
    briefDescription
    createdAt
    id
    organizationName
    requestedBy
    status
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetOrganizationRegistrationQueryVariables,
  APITypes.GetOrganizationRegistrationQuery
>;
export const getProject = /* GraphQL */ `query GetProject($id: ID!) {
  getProject(id: $id) {
    annotationSets {
      nextToken
      __typename
    }
    annotations {
      nextToken
      __typename
    }
    cameraOverlaps {
      nextToken
      __typename
    }
    cameras {
      nextToken
      __typename
    }
    createdAt
    createdBy
    hidden
    id
    imageFiles {
      nextToken
      __typename
    }
    imageSets {
      nextToken
      __typename
    }
    images {
      nextToken
      __typename
    }
    jollyResultsMemberships {
      nextToken
      __typename
    }
    locationSets {
      nextToken
      __typename
    }
    locations {
      nextToken
      __typename
    }
    members {
      nextToken
      __typename
    }
    name
    objects {
      nextToken
      __typename
    }
    observations {
      nextToken
      __typename
    }
    organization {
      createdAt
      description
      id
      name
      updatedAt
      __typename
    }
    organizationId
    queues {
      nextToken
      __typename
    }
    shapefile {
      coordinates
      createdAt
      id
      projectId
      updatedAt
      __typename
    }
    shapefileExclusions {
      nextToken
      __typename
    }
    status
    strata {
      nextToken
      __typename
    }
    testConfig {
      accuracy
      createdAt
      deadzone
      interval
      postTestConfirmation
      projectId
      random
      testType
      updatedAt
      __typename
    }
    testResults {
      nextToken
      __typename
    }
    transects {
      nextToken
      __typename
    }
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetProjectQueryVariables,
  APITypes.GetProjectQuery
>;
export const getProjectTestConfig = /* GraphQL */ `query GetProjectTestConfig($projectId: ID!) {
  getProjectTestConfig(projectId: $projectId) {
    accuracy
    createdAt
    deadzone
    interval
    postTestConfirmation
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    random
    testPresetProjects {
      nextToken
      __typename
    }
    testType
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetProjectTestConfigQueryVariables,
  APITypes.GetProjectTestConfigQuery
>;
export const getQueue = /* GraphQL */ `query GetQueue($id: ID!) {
  getQueue(id: $id) {
    approximateSize
    backupUsers {
      nextToken
      __typename
    }
    batchSize
    createdAt
    hidden
    id
    name
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    tag
    totalBatches
    updatedAt
    url
    users {
      nextToken
      __typename
    }
    zoom
    __typename
  }
}
` as GeneratedQuery<APITypes.GetQueueQueryVariables, APITypes.GetQueueQuery>;
export const getResultSharingToken = /* GraphQL */ `query GetResultSharingToken($annotationSetId: ID!, $surveyId: ID!) {
  getResultSharingToken(
    annotationSetId: $annotationSetId
    surveyId: $surveyId
  ) {
    annotationSetId
    createdAt
    jwt
    surveyId
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetResultSharingTokenQueryVariables,
  APITypes.GetResultSharingTokenQuery
>;
export const getShapefile = /* GraphQL */ `query GetShapefile($id: ID!) {
  getShapefile(id: $id) {
    coordinates
    createdAt
    id
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetShapefileQueryVariables,
  APITypes.GetShapefileQuery
>;
export const getShapefileExclusions = /* GraphQL */ `query GetShapefileExclusions($id: ID!) {
  getShapefileExclusions(id: $id) {
    coordinates
    createdAt
    id
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetShapefileExclusionsQueryVariables,
  APITypes.GetShapefileExclusionsQuery
>;
export const getStratum = /* GraphQL */ `query GetStratum($id: ID!) {
  getStratum(id: $id) {
    area
    baselineLength
    coordinates
    createdAt
    id
    name
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    transects {
      nextToken
      __typename
    }
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetStratumQueryVariables,
  APITypes.GetStratumQuery
>;
export const getTasksOnAnnotationSet = /* GraphQL */ `query GetTasksOnAnnotationSet($id: ID!) {
  getTasksOnAnnotationSet(id: $id) {
    annotationSet {
      createdAt
      id
      name
      projectId
      register
      updatedAt
      __typename
    }
    annotationSetId
    createdAt
    id
    locationSet {
      createdAt
      id
      locationCount
      name
      projectId
      updatedAt
      __typename
    }
    locationSetId
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetTasksOnAnnotationSetQueryVariables,
  APITypes.GetTasksOnAnnotationSetQuery
>;
export const getTestPreset = /* GraphQL */ `query GetTestPreset($id: ID!) {
  getTestPreset(id: $id) {
    createdAt
    id
    locations {
      nextToken
      __typename
    }
    name
    organization {
      createdAt
      description
      id
      name
      updatedAt
      __typename
    }
    organizationId
    projects {
      nextToken
      __typename
    }
    testResults {
      nextToken
      __typename
    }
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetTestPresetQueryVariables,
  APITypes.GetTestPresetQuery
>;
export const getTestPresetLocation = /* GraphQL */ `query GetTestPresetLocation(
  $annotationSetId: ID!
  $locationId: ID!
  $testPresetId: ID!
) {
  getTestPresetLocation(
    annotationSetId: $annotationSetId
    locationId: $locationId
    testPresetId: $testPresetId
  ) {
    annotationSet {
      createdAt
      id
      name
      projectId
      register
      updatedAt
      __typename
    }
    annotationSetId
    createdAt
    location {
      confidence
      createdAt
      height
      id
      imageId
      projectId
      setId
      source
      updatedAt
      width
      x
      y
      __typename
    }
    locationId
    testPreset {
      createdAt
      id
      name
      organizationId
      updatedAt
      __typename
    }
    testPresetId
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetTestPresetLocationQueryVariables,
  APITypes.GetTestPresetLocationQuery
>;
export const getTestPresetProject = /* GraphQL */ `query GetTestPresetProject($projectId: ID!, $testPresetId: ID!) {
  getTestPresetProject(projectId: $projectId, testPresetId: $testPresetId) {
    createdAt
    projectConfig {
      accuracy
      createdAt
      deadzone
      interval
      postTestConfirmation
      projectId
      random
      testType
      updatedAt
      __typename
    }
    projectId
    testPreset {
      createdAt
      id
      name
      organizationId
      updatedAt
      __typename
    }
    testPresetId
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetTestPresetProjectQueryVariables,
  APITypes.GetTestPresetProjectQuery
>;
export const getTestResult = /* GraphQL */ `query GetTestResult($id: ID!) {
  getTestResult(id: $id) {
    annotationSet {
      createdAt
      id
      name
      projectId
      register
      updatedAt
      __typename
    }
    annotationSetId
    categoryCounts {
      nextToken
      __typename
    }
    createdAt
    id
    location {
      confidence
      createdAt
      height
      id
      imageId
      projectId
      setId
      source
      updatedAt
      width
      x
      y
      __typename
    }
    locationId
    passedOnTotal
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    testAnimals
    testPreset {
      createdAt
      id
      name
      organizationId
      updatedAt
      __typename
    }
    testPresetId
    totalMissedAnimals
    updatedAt
    userId
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetTestResultQueryVariables,
  APITypes.GetTestResultQuery
>;
export const getTestResultCategoryCount = /* GraphQL */ `query GetTestResultCategoryCount($categoryName: String!, $testResultId: ID!) {
  getTestResultCategoryCount(
    categoryName: $categoryName
    testResultId: $testResultId
  ) {
    categoryName
    createdAt
    testCount
    testResult {
      annotationSetId
      createdAt
      id
      locationId
      passedOnTotal
      projectId
      testAnimals
      testPresetId
      totalMissedAnimals
      updatedAt
      userId
      __typename
    }
    testResultId
    updatedAt
    userCount
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetTestResultCategoryCountQueryVariables,
  APITypes.GetTestResultCategoryCountQuery
>;
export const getTransect = /* GraphQL */ `query GetTransect($id: ID!) {
  getTransect(id: $id) {
    createdAt
    id
    images {
      nextToken
      __typename
    }
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    stratum {
      area
      baselineLength
      coordinates
      createdAt
      id
      name
      projectId
      updatedAt
      __typename
    }
    stratumId
    updatedAt
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetTransectQueryVariables,
  APITypes.GetTransectQuery
>;
export const getUserProjectMembership = /* GraphQL */ `query GetUserProjectMembership($id: ID!) {
  getUserProjectMembership(id: $id) {
    backupQueue {
      approximateSize
      batchSize
      createdAt
      hidden
      id
      name
      projectId
      tag
      totalBatches
      updatedAt
      url
      zoom
      __typename
    }
    backupQueueId
    createdAt
    id
    isAdmin
    project {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    projectId
    queue {
      approximateSize
      batchSize
      createdAt
      hidden
      id
      name
      projectId
      tag
      totalBatches
      updatedAt
      url
      zoom
      __typename
    }
    queueId
    updatedAt
    userId
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetUserProjectMembershipQueryVariables,
  APITypes.GetUserProjectMembershipQuery
>;
export const getUserStats = /* GraphQL */ `query GetUserStats(
  $date: AWSDate!
  $projectId: ID!
  $setId: ID!
  $userId: ID!
) {
  getUserStats(
    date: $date
    projectId: $projectId
    setId: $setId
    userId: $userId
  ) {
    activeTime
    annotationCount
    annotationTime
    createdAt
    date
    observationCount
    projectId
    searchCount
    searchTime
    setId
    sightingCount
    updatedAt
    userId
    waitingTime
    __typename
  }
}
` as GeneratedQuery<
  APITypes.GetUserStatsQueryVariables,
  APITypes.GetUserStatsQuery
>;
export const imageNeighboursByImage1key = /* GraphQL */ `query ImageNeighboursByImage1key(
  $filter: ModelImageNeighbourFilterInput
  $image1Id: ID!
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  imageNeighboursByImage1key(
    filter: $filter
    image1Id: $image1Id
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      homography
      image1Id
      image2Id
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ImageNeighboursByImage1keyQueryVariables,
  APITypes.ImageNeighboursByImage1keyQuery
>;
export const imageNeighboursByImage2key = /* GraphQL */ `query ImageNeighboursByImage2key(
  $filter: ModelImageNeighbourFilterInput
  $image2Id: ID!
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  imageNeighboursByImage2key(
    filter: $filter
    image2Id: $image2Id
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      homography
      image1Id
      image2Id
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ImageNeighboursByImage2keyQueryVariables,
  APITypes.ImageNeighboursByImage2keyQuery
>;
export const imageSetMembershipsByImageSetId = /* GraphQL */ `query ImageSetMembershipsByImageSetId(
  $filter: ModelImageSetMembershipFilterInput
  $imageSetId: ID!
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  imageSetMembershipsByImageSetId(
    filter: $filter
    imageSetId: $imageSetId
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      id
      imageId
      imageSetId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ImageSetMembershipsByImageSetIdQueryVariables,
  APITypes.ImageSetMembershipsByImageSetIdQuery
>;
export const imageSetsByProjectId = /* GraphQL */ `query ImageSetsByProjectId(
  $filter: ModelImageSetFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  imageSetsByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      id
      imageCount
      name
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ImageSetsByProjectIdQueryVariables,
  APITypes.ImageSetsByProjectIdQuery
>;
export const imagesByPath = /* GraphQL */ `query ImagesByPath(
  $filter: ModelImageFileFilterInput
  $limit: Int
  $nextToken: String
  $path: String!
  $sortDirection: ModelSortDirection
) {
  imagesByPath(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    path: $path
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      id
      imageId
      key
      path
      projectId
      type
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ImagesByPathQueryVariables,
  APITypes.ImagesByPathQuery
>;
export const imagesByProjectId = /* GraphQL */ `query ImagesByProjectId(
  $filter: ModelImageFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  imagesByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      altitude_agl
      altitude_egm96
      altitude_wgs84
      cameraId
      cameraSerial
      createdAt
      exifData
      height
      id
      latitude
      longitude
      originalPath
      pitch
      projectId
      roll
      timestamp
      transectId
      updatedAt
      width
      yaw
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ImagesByProjectIdQueryVariables,
  APITypes.ImagesByProjectIdQuery
>;
export const imagesByimageId = /* GraphQL */ `query ImagesByimageId(
  $filter: ModelImageFileFilterInput
  $imageId: ID!
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  imagesByimageId(
    filter: $filter
    imageId: $imageId
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      id
      imageId
      key
      path
      projectId
      type
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ImagesByimageIdQueryVariables,
  APITypes.ImagesByimageIdQuery
>;
export const jollyResultsByStratumId = /* GraphQL */ `query JollyResultsByStratumId(
  $filter: ModelJollyResultFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $stratumId: ID!
) {
  jollyResultsByStratumId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    stratumId: $stratumId
  ) {
    items {
      animals
      annotationSetId
      areaSurveyed
      categoryId
      createdAt
      density
      estimate
      lowerBound95
      numSamples
      standardError
      stratumId
      surveyId
      updatedAt
      upperBound95
      variance
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.JollyResultsByStratumIdQueryVariables,
  APITypes.JollyResultsByStratumIdQuery
>;
export const jollyResultsBySurveyId = /* GraphQL */ `query JollyResultsBySurveyId(
  $filter: ModelJollyResultFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $surveyId: ID!
) {
  jollyResultsBySurveyId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    surveyId: $surveyId
  ) {
    items {
      animals
      annotationSetId
      areaSurveyed
      categoryId
      createdAt
      density
      estimate
      lowerBound95
      numSamples
      standardError
      stratumId
      surveyId
      updatedAt
      upperBound95
      variance
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.JollyResultsBySurveyIdQueryVariables,
  APITypes.JollyResultsBySurveyIdQuery
>;
export const jollyResultsMembershipsBySurveyId = /* GraphQL */ `query JollyResultsMembershipsBySurveyId(
  $annotationSetId: ModelIDKeyConditionInput
  $filter: ModelJollyResultsMembershipFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $surveyId: ID!
) {
  jollyResultsMembershipsBySurveyId(
    annotationSetId: $annotationSetId
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    surveyId: $surveyId
  ) {
    items {
      annotationSetId
      createdAt
      surveyId
      updatedAt
      userId
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.JollyResultsMembershipsBySurveyIdQueryVariables,
  APITypes.JollyResultsMembershipsBySurveyIdQuery
>;
export const listAnnotationSets = /* GraphQL */ `query ListAnnotationSets(
  $filter: ModelAnnotationSetFilterInput
  $limit: Int
  $nextToken: String
) {
  listAnnotationSets(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      createdAt
      id
      name
      projectId
      register
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListAnnotationSetsQueryVariables,
  APITypes.ListAnnotationSetsQuery
>;
export const listAnnotations = /* GraphQL */ `query ListAnnotations(
  $filter: ModelAnnotationFilterInput
  $limit: Int
  $nextToken: String
) {
  listAnnotations(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      categoryId
      createdAt
      id
      imageId
      objectId
      obscured
      owner
      projectId
      setId
      source
      updatedAt
      x
      y
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListAnnotationsQueryVariables,
  APITypes.ListAnnotationsQuery
>;
export const listCameraOverlaps = /* GraphQL */ `query ListCameraOverlaps(
  $cameraAId: ID
  $cameraBId: ModelIDKeyConditionInput
  $filter: ModelCameraOverlapFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  listCameraOverlaps(
    cameraAId: $cameraAId
    cameraBId: $cameraBId
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      cameraAId
      cameraBId
      createdAt
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListCameraOverlapsQueryVariables,
  APITypes.ListCameraOverlapsQuery
>;
export const listCameras = /* GraphQL */ `query ListCameras(
  $filter: ModelCameraFilterInput
  $limit: Int
  $nextToken: String
) {
  listCameras(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      createdAt
      focalLengthMm
      id
      name
      projectId
      sensorWidthMm
      tiltDegrees
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListCamerasQueryVariables,
  APITypes.ListCamerasQuery
>;
export const listCategories = /* GraphQL */ `query ListCategories(
  $filter: ModelCategoryFilterInput
  $limit: Int
  $nextToken: String
) {
  listCategories(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      annotationCount
      annotationSetId
      color
      createdAt
      id
      name
      projectId
      shortcutKey
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListCategoriesQueryVariables,
  APITypes.ListCategoriesQuery
>;
export const listClientLogs = /* GraphQL */ `query ListClientLogs(
  $filter: ModelClientLogFilterInput
  $limit: Int
  $nextToken: String
) {
  listClientLogs(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      connectionType
      createdAt
      deviceType
      downlink
      id
      ipAddress
      os
      rtt
      updatedAt
      userAgent
      userId
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListClientLogsQueryVariables,
  APITypes.ListClientLogsQuery
>;
export const listGroupsForUser = /* GraphQL */ `query ListGroupsForUser($nextToken: String, $userId: String!) {
  listGroupsForUser(nextToken: $nextToken, userId: $userId)
}
` as GeneratedQuery<
  APITypes.ListGroupsForUserQueryVariables,
  APITypes.ListGroupsForUserQuery
>;
export const listImageFiles = /* GraphQL */ `query ListImageFiles(
  $filter: ModelImageFileFilterInput
  $limit: Int
  $nextToken: String
) {
  listImageFiles(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      createdAt
      id
      imageId
      key
      path
      projectId
      type
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListImageFilesQueryVariables,
  APITypes.ListImageFilesQuery
>;
export const listImageNeighbours = /* GraphQL */ `query ListImageNeighbours(
  $filter: ModelImageNeighbourFilterInput
  $image1Id: ID
  $image2Id: ModelIDKeyConditionInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  listImageNeighbours(
    filter: $filter
    image1Id: $image1Id
    image2Id: $image2Id
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      homography
      image1Id
      image2Id
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListImageNeighboursQueryVariables,
  APITypes.ListImageNeighboursQuery
>;
export const listImageSetMemberships = /* GraphQL */ `query ListImageSetMemberships(
  $filter: ModelImageSetMembershipFilterInput
  $limit: Int
  $nextToken: String
) {
  listImageSetMemberships(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      createdAt
      id
      imageId
      imageSetId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListImageSetMembershipsQueryVariables,
  APITypes.ListImageSetMembershipsQuery
>;
export const listImageSets = /* GraphQL */ `query ListImageSets(
  $filter: ModelImageSetFilterInput
  $limit: Int
  $nextToken: String
) {
  listImageSets(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      createdAt
      id
      imageCount
      name
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListImageSetsQueryVariables,
  APITypes.ListImageSetsQuery
>;
export const listImages = /* GraphQL */ `query ListImages(
  $filter: ModelImageFilterInput
  $limit: Int
  $nextToken: String
) {
  listImages(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      altitude_agl
      altitude_egm96
      altitude_wgs84
      cameraId
      cameraSerial
      createdAt
      exifData
      height
      id
      latitude
      longitude
      originalPath
      pitch
      projectId
      roll
      timestamp
      transectId
      updatedAt
      width
      yaw
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListImagesQueryVariables,
  APITypes.ListImagesQuery
>;
export const listJollyResults = /* GraphQL */ `query ListJollyResults(
  $filter: ModelJollyResultFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $stratumIdAnnotationSetIdCategoryId: ModelJollyResultPrimaryCompositeKeyConditionInput
  $surveyId: ID
) {
  listJollyResults(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    stratumIdAnnotationSetIdCategoryId: $stratumIdAnnotationSetIdCategoryId
    surveyId: $surveyId
  ) {
    items {
      animals
      annotationSetId
      areaSurveyed
      categoryId
      createdAt
      density
      estimate
      lowerBound95
      numSamples
      standardError
      stratumId
      surveyId
      updatedAt
      upperBound95
      variance
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListJollyResultsQueryVariables,
  APITypes.ListJollyResultsQuery
>;
export const listJollyResultsMemberships = /* GraphQL */ `query ListJollyResultsMemberships(
  $annotationSetIdUserId: ModelJollyResultsMembershipPrimaryCompositeKeyConditionInput
  $filter: ModelJollyResultsMembershipFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $surveyId: ID
) {
  listJollyResultsMemberships(
    annotationSetIdUserId: $annotationSetIdUserId
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    surveyId: $surveyId
  ) {
    items {
      annotationSetId
      createdAt
      surveyId
      updatedAt
      userId
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListJollyResultsMembershipsQueryVariables,
  APITypes.ListJollyResultsMembershipsQuery
>;
export const listLocationAnnotationCounts = /* GraphQL */ `query ListLocationAnnotationCounts(
  $categoryIdAnnotationSetId: ModelLocationAnnotationCountPrimaryCompositeKeyConditionInput
  $filter: ModelLocationAnnotationCountFilterInput
  $limit: Int
  $locationId: ID
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  listLocationAnnotationCounts(
    categoryIdAnnotationSetId: $categoryIdAnnotationSetId
    filter: $filter
    limit: $limit
    locationId: $locationId
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      annotationSetId
      categoryId
      count
      createdAt
      locationId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListLocationAnnotationCountsQueryVariables,
  APITypes.ListLocationAnnotationCountsQuery
>;
export const listLocationSetMemberships = /* GraphQL */ `query ListLocationSetMemberships(
  $filter: ModelLocationSetMembershipFilterInput
  $limit: Int
  $nextToken: String
) {
  listLocationSetMemberships(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      createdAt
      id
      locationId
      locationSetId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListLocationSetMembershipsQueryVariables,
  APITypes.ListLocationSetMembershipsQuery
>;
export const listLocationSets = /* GraphQL */ `query ListLocationSets(
  $filter: ModelLocationSetFilterInput
  $limit: Int
  $nextToken: String
) {
  listLocationSets(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      createdAt
      id
      locationCount
      name
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListLocationSetsQueryVariables,
  APITypes.ListLocationSetsQuery
>;
export const listLocations = /* GraphQL */ `query ListLocations(
  $filter: ModelLocationFilterInput
  $limit: Int
  $nextToken: String
) {
  listLocations(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      confidence
      createdAt
      height
      id
      imageId
      projectId
      setId
      source
      updatedAt
      width
      x
      y
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListLocationsQueryVariables,
  APITypes.ListLocationsQuery
>;
export const listObjects = /* GraphQL */ `query ListObjects(
  $filter: ModelObjectFilterInput
  $limit: Int
  $nextToken: String
) {
  listObjects(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      categoryId
      createdAt
      id
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListObjectsQueryVariables,
  APITypes.ListObjectsQuery
>;
export const listObservations = /* GraphQL */ `query ListObservations(
  $filter: ModelObservationFilterInput
  $limit: Int
  $nextToken: String
) {
  listObservations(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      annotationCount
      annotationSetId
      createdAt
      id
      loadingTime
      locationId
      owner
      projectId
      timeTaken
      updatedAt
      waitingTime
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListObservationsQueryVariables,
  APITypes.ListObservationsQuery
>;
export const listOrganizationInvites = /* GraphQL */ `query ListOrganizationInvites(
  $filter: ModelOrganizationInviteFilterInput
  $limit: Int
  $nextToken: String
) {
  listOrganizationInvites(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      createdAt
      id
      invitedBy
      organizationId
      status
      updatedAt
      username
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListOrganizationInvitesQueryVariables,
  APITypes.ListOrganizationInvitesQuery
>;
export const listOrganizationMemberships = /* GraphQL */ `query ListOrganizationMemberships(
  $filter: ModelOrganizationMembershipFilterInput
  $limit: Int
  $nextToken: String
  $organizationId: ID
  $sortDirection: ModelSortDirection
  $userId: ModelStringKeyConditionInput
) {
  listOrganizationMemberships(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    organizationId: $organizationId
    sortDirection: $sortDirection
    userId: $userId
  ) {
    items {
      createdAt
      isAdmin
      isTested
      organizationId
      updatedAt
      userId
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListOrganizationMembershipsQueryVariables,
  APITypes.ListOrganizationMembershipsQuery
>;
export const listOrganizationRegistrations = /* GraphQL */ `query ListOrganizationRegistrations(
  $filter: ModelOrganizationRegistrationFilterInput
  $limit: Int
  $nextToken: String
) {
  listOrganizationRegistrations(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      briefDescription
      createdAt
      id
      organizationName
      requestedBy
      status
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListOrganizationRegistrationsQueryVariables,
  APITypes.ListOrganizationRegistrationsQuery
>;
export const listOrganizations = /* GraphQL */ `query ListOrganizations(
  $filter: ModelOrganizationFilterInput
  $limit: Int
  $nextToken: String
) {
  listOrganizations(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      createdAt
      description
      id
      name
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListOrganizationsQueryVariables,
  APITypes.ListOrganizationsQuery
>;
export const listProjectTestConfigs = /* GraphQL */ `query ListProjectTestConfigs(
  $filter: ModelProjectTestConfigFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID
  $sortDirection: ModelSortDirection
) {
  listProjectTestConfigs(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      accuracy
      createdAt
      deadzone
      interval
      postTestConfirmation
      projectId
      random
      testType
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListProjectTestConfigsQueryVariables,
  APITypes.ListProjectTestConfigsQuery
>;
export const listProjects = /* GraphQL */ `query ListProjects(
  $filter: ModelProjectFilterInput
  $limit: Int
  $nextToken: String
) {
  listProjects(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      createdAt
      createdBy
      hidden
      id
      name
      organizationId
      status
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListProjectsQueryVariables,
  APITypes.ListProjectsQuery
>;
export const listQueues = /* GraphQL */ `query ListQueues(
  $filter: ModelQueueFilterInput
  $limit: Int
  $nextToken: String
) {
  listQueues(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      approximateSize
      batchSize
      createdAt
      hidden
      id
      name
      projectId
      tag
      totalBatches
      updatedAt
      url
      zoom
      annotationSetId
      locationSetId
      confidenceThreshold
      launchedCount
      observedCount
      locationManifestS3Key
      emptyQueueTimestamp
      requeuesCompleted
      lastObservationAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListQueuesQueryVariables,
  APITypes.ListQueuesQuery
>;
export const listResultSharingTokens = /* GraphQL */ `query ListResultSharingTokens(
  $annotationSetId: ModelIDKeyConditionInput
  $filter: ModelResultSharingTokenFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $surveyId: ID
) {
  listResultSharingTokens(
    annotationSetId: $annotationSetId
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    surveyId: $surveyId
  ) {
    items {
      annotationSetId
      createdAt
      jwt
      surveyId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListResultSharingTokensQueryVariables,
  APITypes.ListResultSharingTokensQuery
>;
export const listShapefileExclusions = /* GraphQL */ `query ListShapefileExclusions(
  $filter: ModelShapefileExclusionsFilterInput
  $limit: Int
  $nextToken: String
) {
  listShapefileExclusions(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      coordinates
      createdAt
      id
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListShapefileExclusionsQueryVariables,
  APITypes.ListShapefileExclusionsQuery
>;
export const listShapefiles = /* GraphQL */ `query ListShapefiles(
  $filter: ModelShapefileFilterInput
  $limit: Int
  $nextToken: String
) {
  listShapefiles(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      coordinates
      createdAt
      id
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListShapefilesQueryVariables,
  APITypes.ListShapefilesQuery
>;
export const listStrata = /* GraphQL */ `query ListStrata(
  $filter: ModelStratumFilterInput
  $limit: Int
  $nextToken: String
) {
  listStrata(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      area
      baselineLength
      coordinates
      createdAt
      id
      name
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListStrataQueryVariables,
  APITypes.ListStrataQuery
>;
export const listTasksOnAnnotationSets = /* GraphQL */ `query ListTasksOnAnnotationSets(
  $filter: ModelTasksOnAnnotationSetFilterInput
  $limit: Int
  $nextToken: String
) {
  listTasksOnAnnotationSets(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      annotationSetId
      createdAt
      id
      locationSetId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListTasksOnAnnotationSetsQueryVariables,
  APITypes.ListTasksOnAnnotationSetsQuery
>;
export const listTestPresetLocations = /* GraphQL */ `query ListTestPresetLocations(
  $filter: ModelTestPresetLocationFilterInput
  $limit: Int
  $locationIdAnnotationSetId: ModelTestPresetLocationPrimaryCompositeKeyConditionInput
  $nextToken: String
  $sortDirection: ModelSortDirection
  $testPresetId: ID
) {
  listTestPresetLocations(
    filter: $filter
    limit: $limit
    locationIdAnnotationSetId: $locationIdAnnotationSetId
    nextToken: $nextToken
    sortDirection: $sortDirection
    testPresetId: $testPresetId
  ) {
    items {
      annotationSetId
      createdAt
      locationId
      testPresetId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListTestPresetLocationsQueryVariables,
  APITypes.ListTestPresetLocationsQuery
>;
export const listTestPresetProjects = /* GraphQL */ `query ListTestPresetProjects(
  $filter: ModelTestPresetProjectFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ModelIDKeyConditionInput
  $sortDirection: ModelSortDirection
  $testPresetId: ID
) {
  listTestPresetProjects(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
    testPresetId: $testPresetId
  ) {
    items {
      createdAt
      projectId
      testPresetId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListTestPresetProjectsQueryVariables,
  APITypes.ListTestPresetProjectsQuery
>;
export const listTestPresets = /* GraphQL */ `query ListTestPresets(
  $filter: ModelTestPresetFilterInput
  $limit: Int
  $nextToken: String
) {
  listTestPresets(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      createdAt
      id
      name
      organizationId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListTestPresetsQueryVariables,
  APITypes.ListTestPresetsQuery
>;
export const listTestResultCategoryCounts = /* GraphQL */ `query ListTestResultCategoryCounts(
  $categoryName: ModelStringKeyConditionInput
  $filter: ModelTestResultCategoryCountFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $testResultId: ID
) {
  listTestResultCategoryCounts(
    categoryName: $categoryName
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    testResultId: $testResultId
  ) {
    items {
      categoryName
      createdAt
      testCount
      testResultId
      updatedAt
      userCount
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListTestResultCategoryCountsQueryVariables,
  APITypes.ListTestResultCategoryCountsQuery
>;
export const listTestResults = /* GraphQL */ `query ListTestResults(
  $filter: ModelTestResultFilterInput
  $limit: Int
  $nextToken: String
) {
  listTestResults(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      annotationSetId
      createdAt
      id
      locationId
      passedOnTotal
      projectId
      testAnimals
      testPresetId
      totalMissedAnimals
      updatedAt
      userId
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListTestResultsQueryVariables,
  APITypes.ListTestResultsQuery
>;
export const listTransects = /* GraphQL */ `query ListTransects(
  $filter: ModelTransectFilterInput
  $limit: Int
  $nextToken: String
) {
  listTransects(filter: $filter, limit: $limit, nextToken: $nextToken) {
    items {
      createdAt
      id
      projectId
      stratumId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListTransectsQueryVariables,
  APITypes.ListTransectsQuery
>;
export const listUserProjectMemberships = /* GraphQL */ `query ListUserProjectMemberships(
  $filter: ModelUserProjectMembershipFilterInput
  $limit: Int
  $nextToken: String
) {
  listUserProjectMemberships(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      backupQueueId
      createdAt
      id
      isAdmin
      projectId
      queueId
      updatedAt
      userId
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListUserProjectMembershipsQueryVariables,
  APITypes.ListUserProjectMembershipsQuery
>;
export const listUserStats = /* GraphQL */ `query ListUserStats(
  $filter: ModelUserStatsFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID
  $sortDirection: ModelSortDirection
  $userIdDateSetId: ModelUserStatsPrimaryCompositeKeyConditionInput
) {
  listUserStats(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
    userIdDateSetId: $userIdDateSetId
  ) {
    items {
      activeTime
      annotationCount
      annotationTime
      createdAt
      date
      observationCount
      projectId
      searchCount
      searchTime
      setId
      sightingCount
      updatedAt
      userId
      waitingTime
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ListUserStatsQueryVariables,
  APITypes.ListUserStatsQuery
>;
export const listUsers = /* GraphQL */ `query ListUsers($nextToken: String) {
  listUsers(nextToken: $nextToken) {
    NextToken
    Users {
      email
      id
      isAdmin
      name
      __typename
    }
    __typename
  }
}
` as GeneratedQuery<APITypes.ListUsersQueryVariables, APITypes.ListUsersQuery>;
export const locationSetsByAnnotationSetId = /* GraphQL */ `query LocationSetsByAnnotationSetId(
  $annotationSetId: ID!
  $filter: ModelTasksOnAnnotationSetFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  locationSetsByAnnotationSetId(
    annotationSetId: $annotationSetId
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      annotationSetId
      createdAt
      id
      locationSetId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.LocationSetsByAnnotationSetIdQueryVariables,
  APITypes.LocationSetsByAnnotationSetIdQuery
>;
export const locationSetsByProjectId = /* GraphQL */ `query LocationSetsByProjectId(
  $filter: ModelLocationSetFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  locationSetsByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      id
      locationCount
      name
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.LocationSetsByProjectIdQueryVariables,
  APITypes.LocationSetsByProjectIdQuery
>;
export const locationsByImageKey = /* GraphQL */ `query LocationsByImageKey(
  $confidence: ModelFloatKeyConditionInput
  $filter: ModelLocationFilterInput
  $imageId: ID!
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  locationsByImageKey(
    confidence: $confidence
    filter: $filter
    imageId: $imageId
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      confidence
      createdAt
      height
      id
      imageId
      projectId
      setId
      source
      updatedAt
      width
      x
      y
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.LocationsByImageKeyQueryVariables,
  APITypes.LocationsByImageKeyQuery
>;
export const locationsByProjectIdAndSource = /* GraphQL */ `query LocationsByProjectIdAndSource(
  $filter: ModelLocationFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
  $source: ModelStringKeyConditionInput
) {
  locationsByProjectIdAndSource(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
    source: $source
  ) {
    items {
      confidence
      createdAt
      height
      id
      imageId
      projectId
      setId
      source
      updatedAt
      width
      x
      y
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.LocationsByProjectIdAndSourceQueryVariables,
  APITypes.LocationsByProjectIdAndSourceQuery
>;
export const locationsBySetIdAndConfidence = /* GraphQL */ `query LocationsBySetIdAndConfidence(
  $confidence: ModelFloatKeyConditionInput
  $filter: ModelLocationFilterInput
  $limit: Int
  $nextToken: String
  $setId: ID!
  $sortDirection: ModelSortDirection
) {
  locationsBySetIdAndConfidence(
    confidence: $confidence
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    setId: $setId
    sortDirection: $sortDirection
  ) {
    items {
      confidence
      createdAt
      height
      id
      imageId
      projectId
      setId
      source
      updatedAt
      width
      x
      y
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.LocationsBySetIdAndConfidenceQueryVariables,
  APITypes.LocationsBySetIdAndConfidenceQuery
>;
export const locationsByTestPresetId = /* GraphQL */ `query LocationsByTestPresetId(
  $filter: ModelTestPresetLocationFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $testPresetId: ID!
) {
  locationsByTestPresetId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    testPresetId: $testPresetId
  ) {
    items {
      annotationSetId
      createdAt
      locationId
      testPresetId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.LocationsByTestPresetIdQueryVariables,
  APITypes.LocationsByTestPresetIdQuery
>;
export const membershipsByOrganizationId = /* GraphQL */ `query MembershipsByOrganizationId(
  $filter: ModelOrganizationMembershipFilterInput
  $limit: Int
  $nextToken: String
  $organizationId: ID!
  $sortDirection: ModelSortDirection
) {
  membershipsByOrganizationId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    organizationId: $organizationId
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      isAdmin
      isTested
      organizationId
      updatedAt
      userId
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.MembershipsByOrganizationIdQueryVariables,
  APITypes.MembershipsByOrganizationIdQuery
>;
export const objectsByCategoryId = /* GraphQL */ `query ObjectsByCategoryId(
  $categoryId: ID!
  $filter: ModelObjectFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  objectsByCategoryId(
    categoryId: $categoryId
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      categoryId
      createdAt
      id
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ObjectsByCategoryIdQueryVariables,
  APITypes.ObjectsByCategoryIdQuery
>;
export const observationsByAnnotationSetId = /* GraphQL */ `query ObservationsByAnnotationSetId(
  $annotationSetId: ID!
  $createdAt: ModelStringKeyConditionInput
  $filter: ModelObservationFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  observationsByAnnotationSetId(
    annotationSetId: $annotationSetId
    createdAt: $createdAt
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      annotationCount
      annotationSetId
      createdAt
      id
      loadingTime
      locationId
      owner
      projectId
      timeTaken
      updatedAt
      waitingTime
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ObservationsByAnnotationSetIdQueryVariables,
  APITypes.ObservationsByAnnotationSetIdQuery
>;
export const observationsByLocationId = /* GraphQL */ `query ObservationsByLocationId(
  $filter: ModelObservationFilterInput
  $limit: Int
  $locationId: ID!
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  observationsByLocationId(
    filter: $filter
    limit: $limit
    locationId: $locationId
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      annotationCount
      annotationSetId
      createdAt
      id
      loadingTime
      locationId
      owner
      projectId
      timeTaken
      updatedAt
      waitingTime
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ObservationsByLocationIdQueryVariables,
  APITypes.ObservationsByLocationIdQuery
>;
export const observationsByOwner = /* GraphQL */ `query ObservationsByOwner(
  $filter: ModelObservationFilterInput
  $limit: Int
  $nextToken: String
  $owner: String!
  $sortDirection: ModelSortDirection
) {
  observationsByOwner(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    owner: $owner
    sortDirection: $sortDirection
  ) {
    items {
      annotationCount
      annotationSetId
      createdAt
      id
      loadingTime
      locationId
      owner
      projectId
      timeTaken
      updatedAt
      waitingTime
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ObservationsByOwnerQueryVariables,
  APITypes.ObservationsByOwnerQuery
>;
export const organizationInvitesByUsername = /* GraphQL */ `query OrganizationInvitesByUsername(
  $filter: ModelOrganizationInviteFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $username: String!
) {
  organizationInvitesByUsername(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    username: $username
  ) {
    items {
      createdAt
      id
      invitedBy
      organizationId
      status
      updatedAt
      username
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.OrganizationInvitesByUsernameQueryVariables,
  APITypes.OrganizationInvitesByUsernameQuery
>;
export const organizationRegistrationsByStatus = /* GraphQL */ `query OrganizationRegistrationsByStatus(
  $filter: ModelOrganizationRegistrationFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $status: String!
) {
  organizationRegistrationsByStatus(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    status: $status
  ) {
    items {
      briefDescription
      createdAt
      id
      organizationName
      requestedBy
      status
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.OrganizationRegistrationsByStatusQueryVariables,
  APITypes.OrganizationRegistrationsByStatusQuery
>;
export const organizationsByUserId = /* GraphQL */ `query OrganizationsByUserId(
  $filter: ModelOrganizationMembershipFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $userId: String!
) {
  organizationsByUserId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    userId: $userId
  ) {
    items {
      createdAt
      isAdmin
      isTested
      organizationId
      updatedAt
      userId
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.OrganizationsByUserIdQueryVariables,
  APITypes.OrganizationsByUserIdQuery
>;
export const queuesByProjectId = /* GraphQL */ `query QueuesByProjectId(
  $filter: ModelQueueFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  queuesByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      approximateSize
      batchSize
      createdAt
      hidden
      id
      name
      projectId
      tag
      totalBatches
      updatedAt
      url
      zoom
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.QueuesByProjectIdQueryVariables,
  APITypes.QueuesByProjectIdQuery
>;
export const shapefileExclusionsByProjectId = /* GraphQL */ `query ShapefileExclusionsByProjectId(
  $filter: ModelShapefileExclusionsFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  shapefileExclusionsByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      coordinates
      createdAt
      id
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ShapefileExclusionsByProjectIdQueryVariables,
  APITypes.ShapefileExclusionsByProjectIdQuery
>;
export const shapefilesByProjectId = /* GraphQL */ `query ShapefilesByProjectId(
  $filter: ModelShapefileFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  shapefilesByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      coordinates
      createdAt
      id
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.ShapefilesByProjectIdQueryVariables,
  APITypes.ShapefilesByProjectIdQuery
>;
export const strataByProjectId = /* GraphQL */ `query StrataByProjectId(
  $filter: ModelStratumFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  strataByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      area
      baselineLength
      coordinates
      createdAt
      id
      name
      projectId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.StrataByProjectIdQueryVariables,
  APITypes.StrataByProjectIdQuery
>;
export const testPresetsByLocationId = /* GraphQL */ `query TestPresetsByLocationId(
  $filter: ModelTestPresetLocationFilterInput
  $limit: Int
  $locationId: ID!
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  testPresetsByLocationId(
    filter: $filter
    limit: $limit
    locationId: $locationId
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      annotationSetId
      createdAt
      locationId
      testPresetId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.TestPresetsByLocationIdQueryVariables,
  APITypes.TestPresetsByLocationIdQuery
>;
export const testPresetsByName = /* GraphQL */ `query TestPresetsByName(
  $filter: ModelTestPresetFilterInput
  $limit: Int
  $name: String!
  $nextToken: String
  $sortDirection: ModelSortDirection
) {
  testPresetsByName(
    filter: $filter
    limit: $limit
    name: $name
    nextToken: $nextToken
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      id
      name
      organizationId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.TestPresetsByNameQueryVariables,
  APITypes.TestPresetsByNameQuery
>;
export const testPresetsByOrganizationId = /* GraphQL */ `query TestPresetsByOrganizationId(
  $filter: ModelTestPresetFilterInput
  $limit: Int
  $nextToken: String
  $organizationId: ID!
  $sortDirection: ModelSortDirection
) {
  testPresetsByOrganizationId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    organizationId: $organizationId
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      id
      name
      organizationId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.TestPresetsByOrganizationIdQueryVariables,
  APITypes.TestPresetsByOrganizationIdQuery
>;
export const testPresetsByProjectId = /* GraphQL */ `query TestPresetsByProjectId(
  $filter: ModelTestPresetProjectFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  testPresetsByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      projectId
      testPresetId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.TestPresetsByProjectIdQueryVariables,
  APITypes.TestPresetsByProjectIdQuery
>;
export const testResultsByTestPresetId = /* GraphQL */ `query TestResultsByTestPresetId(
  $filter: ModelTestResultFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $testPresetId: ID!
) {
  testResultsByTestPresetId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    testPresetId: $testPresetId
  ) {
    items {
      annotationSetId
      createdAt
      id
      locationId
      passedOnTotal
      projectId
      testAnimals
      testPresetId
      totalMissedAnimals
      updatedAt
      userId
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.TestResultsByTestPresetIdQueryVariables,
  APITypes.TestResultsByTestPresetIdQuery
>;
export const testResultsByUserId = /* GraphQL */ `query TestResultsByUserId(
  $filter: ModelTestResultFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $userId: ID!
) {
  testResultsByUserId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    userId: $userId
  ) {
    items {
      annotationSetId
      createdAt
      id
      locationId
      passedOnTotal
      projectId
      testAnimals
      testPresetId
      totalMissedAnimals
      updatedAt
      userId
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.TestResultsByUserIdQueryVariables,
  APITypes.TestResultsByUserIdQuery
>;
export const transectsByProjectId = /* GraphQL */ `query TransectsByProjectId(
  $filter: ModelTransectFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  transectsByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      createdAt
      id
      projectId
      stratumId
      updatedAt
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.TransectsByProjectIdQueryVariables,
  APITypes.TransectsByProjectIdQuery
>;
export const userProjectMembershipsByProjectId = /* GraphQL */ `query UserProjectMembershipsByProjectId(
  $filter: ModelUserProjectMembershipFilterInput
  $limit: Int
  $nextToken: String
  $projectId: ID!
  $sortDirection: ModelSortDirection
) {
  userProjectMembershipsByProjectId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    projectId: $projectId
    sortDirection: $sortDirection
  ) {
    items {
      backupQueueId
      createdAt
      id
      isAdmin
      projectId
      queueId
      updatedAt
      userId
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.UserProjectMembershipsByProjectIdQueryVariables,
  APITypes.UserProjectMembershipsByProjectIdQuery
>;
export const userProjectMembershipsByUserId = /* GraphQL */ `query UserProjectMembershipsByUserId(
  $filter: ModelUserProjectMembershipFilterInput
  $limit: Int
  $nextToken: String
  $sortDirection: ModelSortDirection
  $userId: String!
) {
  userProjectMembershipsByUserId(
    filter: $filter
    limit: $limit
    nextToken: $nextToken
    sortDirection: $sortDirection
    userId: $userId
  ) {
    items {
      backupQueueId
      createdAt
      id
      isAdmin
      projectId
      queueId
      updatedAt
      userId
      __typename
    }
    nextToken
    __typename
  }
}
` as GeneratedQuery<
  APITypes.UserProjectMembershipsByUserIdQueryVariables,
  APITypes.UserProjectMembershipsByUserIdQuery
>;
