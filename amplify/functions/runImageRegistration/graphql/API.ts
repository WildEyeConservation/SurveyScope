/* tslint:disable */
/* eslint-disable */
//  This file was automatically generated and should not be edited.

export type ModelAnnotationSetFilterInput = {
  and?: Array< ModelAnnotationSetFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  name?: ModelStringInput | null,
  not?: ModelAnnotationSetFilterInput | null,
  or?: Array< ModelAnnotationSetFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  register?: ModelBooleanInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelIntInput = {
  attributeExists?: boolean | null,
  attributeType?: ModelAttributeTypes | null,
  between?: Array< number | null > | null,
  eq?: number | null,
  ge?: number | null,
  gt?: number | null,
  le?: number | null,
  lt?: number | null,
  ne?: number | null,
};

export enum ModelAttributeTypes {
  _null = "_null",
  binary = "binary",
  binarySet = "binarySet",
  bool = "bool",
  list = "list",
  map = "map",
  number = "number",
  numberSet = "numberSet",
  string = "string",
  stringSet = "stringSet",
}


export type ModelStringInput = {
  attributeExists?: boolean | null,
  attributeType?: ModelAttributeTypes | null,
  beginsWith?: string | null,
  between?: Array< string | null > | null,
  contains?: string | null,
  eq?: string | null,
  ge?: string | null,
  gt?: string | null,
  le?: string | null,
  lt?: string | null,
  ne?: string | null,
  notContains?: string | null,
  size?: ModelSizeInput | null,
};

export type ModelSizeInput = {
  between?: Array< number | null > | null,
  eq?: number | null,
  ge?: number | null,
  gt?: number | null,
  le?: number | null,
  lt?: number | null,
  ne?: number | null,
};

export type ModelIDInput = {
  attributeExists?: boolean | null,
  attributeType?: ModelAttributeTypes | null,
  beginsWith?: string | null,
  between?: Array< string | null > | null,
  contains?: string | null,
  eq?: string | null,
  ge?: string | null,
  gt?: string | null,
  le?: string | null,
  lt?: string | null,
  ne?: string | null,
  notContains?: string | null,
  size?: ModelSizeInput | null,
};

export type ModelBooleanInput = {
  attributeExists?: boolean | null,
  attributeType?: ModelAttributeTypes | null,
  eq?: boolean | null,
  ne?: boolean | null,
};

export enum ModelSortDirection {
  ASC = "ASC",
  DESC = "DESC",
}


export type ModelAnnotationSetConnection = {
  __typename: "ModelAnnotationSetConnection",
  items:  Array<AnnotationSet | null >,
  nextToken?: string | null,
};

export type AnnotationSet = {
  __typename: "AnnotationSet",
  annotations?: ModelAnnotationConnection | null,
  categories?: ModelCategoryConnection | null,
  createdAt: string,
  id: string,
  jollyResultsMemberships?: ModelJollyResultsMembershipConnection | null,
  locationAnnotationCounts?: ModelLocationAnnotationCountConnection | null,
  name: string,
  observations?: ModelObservationConnection | null,
  project?: Project | null,
  projectId: string,
  register?: boolean | null,
  tasks?: ModelTasksOnAnnotationSetConnection | null,
  testPresetLocations?: ModelTestPresetLocationConnection | null,
  testResults?: ModelTestResultConnection | null,
  updatedAt: string,
};

export type ModelAnnotationConnection = {
  __typename: "ModelAnnotationConnection",
  items:  Array<Annotation | null >,
  nextToken?: string | null,
};

export type Annotation = {
  __typename: "Annotation",
  category?: Category | null,
  categoryId: string,
  createdAt: string,
  id: string,
  image?: Image | null,
  imageId: string,
  object?: Object | null,
  objectId?: string | null,
  obscured?: boolean | null,
  owner?: string | null,
  project?: Project | null,
  projectId: string,
  set?: AnnotationSet | null,
  setId: string,
  source: string,
  updatedAt: string,
  x: number,
  y: number,
};

export type Category = {
  __typename: "Category",
  annotationCount?: number | null,
  annotationSet?: AnnotationSet | null,
  annotationSetId: string,
  annotations?: ModelAnnotationConnection | null,
  color?: string | null,
  createdAt: string,
  id: string,
  locationAnnotationCounts?: ModelLocationAnnotationCountConnection | null,
  name: string,
  objects?: ModelObjectConnection | null,
  projectId: string,
  shortcutKey?: string | null,
  updatedAt: string,
};

export type ModelLocationAnnotationCountConnection = {
  __typename: "ModelLocationAnnotationCountConnection",
  items:  Array<LocationAnnotationCount | null >,
  nextToken?: string | null,
};

export type LocationAnnotationCount = {
  __typename: "LocationAnnotationCount",
  annotationSet?: AnnotationSet | null,
  annotationSetId: string,
  category?: Category | null,
  categoryId: string,
  count?: number | null,
  createdAt: string,
  location?: Location | null,
  locationId: string,
  updatedAt: string,
};

export type Location = {
  __typename: "Location",
  annotationCounts?: ModelLocationAnnotationCountConnection | null,
  confidence?: number | null,
  createdAt: string,
  height?: number | null,
  id: string,
  image?: Image | null,
  imageId?: string | null,
  observations?: ModelObservationConnection | null,
  project?: Project | null,
  projectId: string,
  set?: LocationSet | null,
  setId: string,
  sets?: ModelLocationSetMembershipConnection | null,
  source: string,
  testPresets?: ModelTestPresetLocationConnection | null,
  testResults?: ModelTestResultConnection | null,
  updatedAt: string,
  width?: number | null,
  x: number,
  y: number,
};

export type Image = {
  __typename: "Image",
  altitude_agl?: number | null,
  altitude_egm96?: number | null,
  altitude_wgs84?: number | null,
  annotations?: ModelAnnotationConnection | null,
  camera?: Camera | null,
  cameraId?: string | null,
  cameraSerial?: string | null,
  createdAt: string,
  exifData?: string | null,
  files?: ModelImageFileConnection | null,
  height: number,
  id: string,
  latitude?: number | null,
  leftNeighbours?: ModelImageNeighbourConnection | null,
  locations?: ModelLocationConnection | null,
  longitude?: number | null,
  memberships?: ModelImageSetMembershipConnection | null,
  originalPath?: string | null,
  pitch?: number | null,
  project?: Project | null,
  projectId: string,
  rightNeighbours?: ModelImageNeighbourConnection | null,
  roll?: number | null,
  timestamp?: number | null,
  transect?: Transect | null,
  transectId?: string | null,
  updatedAt: string,
  width: number,
  yaw?: number | null,
};

export type Camera = {
  __typename: "Camera",
  createdAt: string,
  focalLengthMm?: number | null,
  id: string,
  images?: ModelImageConnection | null,
  name: string,
  project?: Project | null,
  projectId: string,
  sensorWidthMm?: number | null,
  tiltDegrees?: number | null,
  updatedAt: string,
};

export type ModelImageConnection = {
  __typename: "ModelImageConnection",
  items:  Array<Image | null >,
  nextToken?: string | null,
};

export type Project = {
  __typename: "Project",
  annotationSets?: ModelAnnotationSetConnection | null,
  annotations?: ModelAnnotationConnection | null,
  cameraOverlaps?: ModelCameraOverlapConnection | null,
  cameras?: ModelCameraConnection | null,
  createdAt: string,
  createdBy: string,
  hidden?: boolean | null,
  id: string,
  imageFiles?: ModelImageFileConnection | null,
  imageSets?: ModelImageSetConnection | null,
  images?: ModelImageConnection | null,
  jollyResultsMemberships?: ModelJollyResultsMembershipConnection | null,
  locationSets?: ModelLocationSetConnection | null,
  locations?: ModelLocationConnection | null,
  members?: ModelUserProjectMembershipConnection | null,
  name: string,
  objects?: ModelObjectConnection | null,
  observations?: ModelObservationConnection | null,
  organization?: Organization | null,
  organizationId: string,
  queues?: ModelQueueConnection | null,
  shapefile?: Shapefile | null,
  shapefileExclusions?: ModelShapefileExclusionsConnection | null,
  status?: string | null,
  strata?: ModelStratumConnection | null,
  tags?: Array< string | null > | null,
  testConfig?: ProjectTestConfig | null,
  testResults?: ModelTestResultConnection | null,
  transects?: ModelTransectConnection | null,
  updatedAt: string,
};

export type ModelCameraOverlapConnection = {
  __typename: "ModelCameraOverlapConnection",
  items:  Array<CameraOverlap | null >,
  nextToken?: string | null,
};

export type CameraOverlap = {
  __typename: "CameraOverlap",
  cameraAId: string,
  cameraBId: string,
  createdAt: string,
  project?: Project | null,
  projectId: string,
  updatedAt: string,
};

export type ModelCameraConnection = {
  __typename: "ModelCameraConnection",
  items:  Array<Camera | null >,
  nextToken?: string | null,
};

export type ModelImageFileConnection = {
  __typename: "ModelImageFileConnection",
  items:  Array<ImageFile | null >,
  nextToken?: string | null,
};

export type ImageFile = {
  __typename: "ImageFile",
  createdAt: string,
  id: string,
  image?: Image | null,
  imageId?: string | null,
  key: string,
  path: string,
  project?: Project | null,
  projectId: string,
  type: string,
  updatedAt: string,
};

export type ModelImageSetConnection = {
  __typename: "ModelImageSetConnection",
  items:  Array<ImageSet | null >,
  nextToken?: string | null,
};

export type ImageSet = {
  __typename: "ImageSet",
  createdAt: string,
  id: string,
  imageCount?: number | null,
  images?: ModelImageSetMembershipConnection | null,
  name: string,
  project?: Project | null,
  projectId: string,
  updatedAt: string,
};

export type ModelImageSetMembershipConnection = {
  __typename: "ModelImageSetMembershipConnection",
  items:  Array<ImageSetMembership | null >,
  nextToken?: string | null,
};

export type ImageSetMembership = {
  __typename: "ImageSetMembership",
  createdAt: string,
  id: string,
  image?: Image | null,
  imageId: string,
  imageSet?: ImageSet | null,
  imageSetId: string,
  updatedAt: string,
};

export type ModelJollyResultsMembershipConnection = {
  __typename: "ModelJollyResultsMembershipConnection",
  items:  Array<JollyResultsMembership | null >,
  nextToken?: string | null,
};

export type JollyResultsMembership = {
  __typename: "JollyResultsMembership",
  annotationSet?: AnnotationSet | null,
  annotationSetId: string,
  createdAt: string,
  survey?: Project | null,
  surveyId: string,
  updatedAt: string,
  userId: string,
};

export type ModelLocationSetConnection = {
  __typename: "ModelLocationSetConnection",
  items:  Array<LocationSet | null >,
  nextToken?: string | null,
};

export type LocationSet = {
  __typename: "LocationSet",
  createdAt: string,
  description?: string | null,
  id: string,
  locationCount?: number | null,
  locations?: ModelLocationConnection | null,
  memberships?: ModelLocationSetMembershipConnection | null,
  name: string,
  project?: Project | null,
  projectId: string,
  tasks?: ModelTasksOnAnnotationSetConnection | null,
  updatedAt: string,
};

export type ModelLocationConnection = {
  __typename: "ModelLocationConnection",
  items:  Array<Location | null >,
  nextToken?: string | null,
};

export type ModelLocationSetMembershipConnection = {
  __typename: "ModelLocationSetMembershipConnection",
  items:  Array<LocationSetMembership | null >,
  nextToken?: string | null,
};

export type LocationSetMembership = {
  __typename: "LocationSetMembership",
  createdAt: string,
  id: string,
  location?: Location | null,
  locationId: string,
  locationSet?: LocationSet | null,
  locationSetId: string,
  updatedAt: string,
};

export type ModelTasksOnAnnotationSetConnection = {
  __typename: "ModelTasksOnAnnotationSetConnection",
  items:  Array<TasksOnAnnotationSet | null >,
  nextToken?: string | null,
};

export type TasksOnAnnotationSet = {
  __typename: "TasksOnAnnotationSet",
  annotationSet?: AnnotationSet | null,
  annotationSetId: string,
  createdAt: string,
  id: string,
  locationSet?: LocationSet | null,
  locationSetId: string,
  updatedAt: string,
};

export type ModelUserProjectMembershipConnection = {
  __typename: "ModelUserProjectMembershipConnection",
  items:  Array<UserProjectMembership | null >,
  nextToken?: string | null,
};

export type UserProjectMembership = {
  __typename: "UserProjectMembership",
  backupQueue?: Queue | null,
  backupQueueId?: string | null,
  createdAt: string,
  id: string,
  isAdmin?: boolean | null,
  project?: Project | null,
  projectId: string,
  queue?: Queue | null,
  queueId?: string | null,
  updatedAt: string,
  userId: string,
};

export type Queue = {
  __typename: "Queue",
  approximateSize?: number | null,
  backupUsers?: ModelUserProjectMembershipConnection | null,
  batchSize?: number | null,
  createdAt: string,
  hidden?: boolean | null,
  id: string,
  name: string,
  project?: Project | null,
  projectId: string,
  tag?: string | null,
  totalBatches?: number | null,
  updatedAt: string,
  url?: string | null,
  users?: ModelUserProjectMembershipConnection | null,
  zoom?: number | null,
};

export type ModelObjectConnection = {
  __typename: "ModelObjectConnection",
  items:  Array<Object | null >,
  nextToken?: string | null,
};

export type Object = {
  __typename: "Object",
  annotations?: ModelAnnotationConnection | null,
  category?: Category | null,
  categoryId: string,
  createdAt: string,
  id: string,
  project?: Project | null,
  projectId: string,
  updatedAt: string,
};

export type ModelObservationConnection = {
  __typename: "ModelObservationConnection",
  items:  Array<Observation | null >,
  nextToken?: string | null,
};

export type Observation = {
  __typename: "Observation",
  annotationCount?: number | null,
  annotationSet?: AnnotationSet | null,
  annotationSetId: string,
  createdAt: string,
  id: string,
  loadingTime?: number | null,
  location?: Location | null,
  locationId: string,
  owner?: string | null,
  project?: Project | null,
  projectId: string,
  timeTaken?: number | null,
  updatedAt: string,
  waitingTime?: number | null,
};

export type Organization = {
  __typename: "Organization",
  createdAt: string,
  description?: string | null,
  id: string,
  invites?: ModelOrganizationInviteConnection | null,
  memberships?: ModelOrganizationMembershipConnection | null,
  name: string,
  projects?: ModelProjectConnection | null,
  testPresets?: ModelTestPresetConnection | null,
  updatedAt: string,
};

export type ModelOrganizationInviteConnection = {
  __typename: "ModelOrganizationInviteConnection",
  items:  Array<OrganizationInvite | null >,
  nextToken?: string | null,
};

export type OrganizationInvite = {
  __typename: "OrganizationInvite",
  createdAt: string,
  id: string,
  invitedBy: string,
  organization?: Organization | null,
  organizationId: string,
  status?: string | null,
  updatedAt: string,
  username: string,
};

export type ModelOrganizationMembershipConnection = {
  __typename: "ModelOrganizationMembershipConnection",
  items:  Array<OrganizationMembership | null >,
  nextToken?: string | null,
};

export type OrganizationMembership = {
  __typename: "OrganizationMembership",
  createdAt: string,
  isAdmin?: boolean | null,
  isTested?: boolean | null,
  organization?: Organization | null,
  organizationId: string,
  updatedAt: string,
  userId: string,
};

export type ModelProjectConnection = {
  __typename: "ModelProjectConnection",
  items:  Array<Project | null >,
  nextToken?: string | null,
};

export type ModelTestPresetConnection = {
  __typename: "ModelTestPresetConnection",
  items:  Array<TestPreset | null >,
  nextToken?: string | null,
};

export type TestPreset = {
  __typename: "TestPreset",
  createdAt: string,
  id: string,
  locations?: ModelTestPresetLocationConnection | null,
  name: string,
  organization?: Organization | null,
  organizationId: string,
  projects?: ModelTestPresetProjectConnection | null,
  testResults?: ModelTestResultConnection | null,
  updatedAt: string,
};

export type ModelTestPresetLocationConnection = {
  __typename: "ModelTestPresetLocationConnection",
  items:  Array<TestPresetLocation | null >,
  nextToken?: string | null,
};

export type TestPresetLocation = {
  __typename: "TestPresetLocation",
  annotationSet?: AnnotationSet | null,
  annotationSetId: string,
  createdAt: string,
  location?: Location | null,
  locationId: string,
  testPreset?: TestPreset | null,
  testPresetId: string,
  updatedAt: string,
};

export type ModelTestPresetProjectConnection = {
  __typename: "ModelTestPresetProjectConnection",
  items:  Array<TestPresetProject | null >,
  nextToken?: string | null,
};

export type TestPresetProject = {
  __typename: "TestPresetProject",
  createdAt: string,
  projectConfig?: ProjectTestConfig | null,
  projectId: string,
  testPreset?: TestPreset | null,
  testPresetId: string,
  updatedAt: string,
};

export type ProjectTestConfig = {
  __typename: "ProjectTestConfig",
  accuracy: number,
  createdAt: string,
  deadzone?: number | null,
  interval?: number | null,
  postTestConfirmation?: boolean | null,
  project?: Project | null,
  projectId: string,
  random?: number | null,
  testPresetProjects?: ModelTestPresetProjectConnection | null,
  testType?: string | null,
  updatedAt: string,
};

export type ModelTestResultConnection = {
  __typename: "ModelTestResultConnection",
  items:  Array<TestResult | null >,
  nextToken?: string | null,
};

export type TestResult = {
  __typename: "TestResult",
  annotationSet?: AnnotationSet | null,
  annotationSetId: string,
  categoryCounts?: ModelTestResultCategoryCountConnection | null,
  createdAt: string,
  id: string,
  location?: Location | null,
  locationId: string,
  passedOnTotal: boolean,
  project?: Project | null,
  projectId: string,
  testAnimals: number,
  testPreset?: TestPreset | null,
  testPresetId: string,
  totalMissedAnimals: number,
  updatedAt: string,
  userId: string,
};

export type ModelTestResultCategoryCountConnection = {
  __typename: "ModelTestResultCategoryCountConnection",
  items:  Array<TestResultCategoryCount | null >,
  nextToken?: string | null,
};

export type TestResultCategoryCount = {
  __typename: "TestResultCategoryCount",
  categoryName: string,
  createdAt: string,
  testCount: number,
  testResult?: TestResult | null,
  testResultId: string,
  updatedAt: string,
  userCount: number,
};

export type ModelQueueConnection = {
  __typename: "ModelQueueConnection",
  items:  Array<Queue | null >,
  nextToken?: string | null,
};

export type Shapefile = {
  __typename: "Shapefile",
  coordinates?: Array< number | null > | null,
  createdAt: string,
  id: string,
  project?: Project | null,
  projectId: string,
  updatedAt: string,
};

export type ModelShapefileExclusionsConnection = {
  __typename: "ModelShapefileExclusionsConnection",
  items:  Array<ShapefileExclusions | null >,
  nextToken?: string | null,
};

export type ShapefileExclusions = {
  __typename: "ShapefileExclusions",
  coordinates?: Array< number | null > | null,
  createdAt: string,
  id: string,
  project?: Project | null,
  projectId: string,
  updatedAt: string,
};

export type ModelStratumConnection = {
  __typename: "ModelStratumConnection",
  items:  Array<Stratum | null >,
  nextToken?: string | null,
};

export type Stratum = {
  __typename: "Stratum",
  area?: number | null,
  baselineLength?: number | null,
  coordinates?: Array< number | null > | null,
  createdAt: string,
  id: string,
  name: string,
  project?: Project | null,
  projectId: string,
  transects?: ModelTransectConnection | null,
  updatedAt: string,
};

export type ModelTransectConnection = {
  __typename: "ModelTransectConnection",
  items:  Array<Transect | null >,
  nextToken?: string | null,
};

export type Transect = {
  __typename: "Transect",
  createdAt: string,
  id: string,
  images?: ModelImageConnection | null,
  project?: Project | null,
  projectId: string,
  stratum?: Stratum | null,
  stratumId: string,
  updatedAt: string,
};

export type ModelImageNeighbourConnection = {
  __typename: "ModelImageNeighbourConnection",
  items:  Array<ImageNeighbour | null >,
  nextToken?: string | null,
};

export type ImageNeighbour = {
  __typename: "ImageNeighbour",
  createdAt: string,
  homography?: Array< number | null > | null,
  image1?: Image | null,
  image1Id: string,
  image2?: Image | null,
  image2Id: string,
  updatedAt: string,
};

export type ModelCategoryConnection = {
  __typename: "ModelCategoryConnection",
  items:  Array<Category | null >,
  nextToken?: string | null,
};

export type ModelAnnotationFilterInput = {
  and?: Array< ModelAnnotationFilterInput | null > | null,
  categoryId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  imageId?: ModelIDInput | null,
  not?: ModelAnnotationFilterInput | null,
  objectId?: ModelIDInput | null,
  obscured?: ModelBooleanInput | null,
  or?: Array< ModelAnnotationFilterInput | null > | null,
  owner?: ModelStringInput | null,
  projectId?: ModelIDInput | null,
  setId?: ModelIDInput | null,
  source?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
  x?: ModelIntInput | null,
  y?: ModelIntInput | null,
};

export type ModelIDKeyConditionInput = {
  beginsWith?: string | null,
  between?: Array< string | null > | null,
  eq?: string | null,
  ge?: string | null,
  gt?: string | null,
  le?: string | null,
  lt?: string | null,
};

export type ModelCameraOverlapFilterInput = {
  and?: Array< ModelCameraOverlapFilterInput | null > | null,
  cameraAId?: ModelIDInput | null,
  cameraBId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  not?: ModelCameraOverlapFilterInput | null,
  or?: Array< ModelCameraOverlapFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelCameraFilterInput = {
  and?: Array< ModelCameraFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  focalLengthMm?: ModelFloatInput | null,
  id?: ModelIDInput | null,
  name?: ModelStringInput | null,
  not?: ModelCameraFilterInput | null,
  or?: Array< ModelCameraFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  sensorWidthMm?: ModelFloatInput | null,
  tiltDegrees?: ModelFloatInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelFloatInput = {
  attributeExists?: boolean | null,
  attributeType?: ModelAttributeTypes | null,
  between?: Array< number | null > | null,
  eq?: number | null,
  ge?: number | null,
  gt?: number | null,
  le?: number | null,
  lt?: number | null,
  ne?: number | null,
};

export type ModelCategoryFilterInput = {
  and?: Array< ModelCategoryFilterInput | null > | null,
  annotationCount?: ModelIntInput | null,
  annotationSetId?: ModelIDInput | null,
  color?: ModelStringInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  name?: ModelStringInput | null,
  not?: ModelCategoryFilterInput | null,
  or?: Array< ModelCategoryFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  shortcutKey?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelLocationAnnotationCountFilterInput = {
  and?: Array< ModelLocationAnnotationCountFilterInput | null > | null,
  annotationSetId?: ModelIDInput | null,
  categoryId?: ModelIDInput | null,
  count?: ModelIntInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  locationId?: ModelIDInput | null,
  not?: ModelLocationAnnotationCountFilterInput | null,
  or?: Array< ModelLocationAnnotationCountFilterInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelTestResultCategoryCountFilterInput = {
  and?: Array< ModelTestResultCategoryCountFilterInput | null > | null,
  categoryName?: ModelStringInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  not?: ModelTestResultCategoryCountFilterInput | null,
  or?: Array< ModelTestResultCategoryCountFilterInput | null > | null,
  testCount?: ModelIntInput | null,
  testResultId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
  userCount?: ModelIntInput | null,
};

export type ModelClientLogFilterInput = {
  and?: Array< ModelClientLogFilterInput | null > | null,
  connectionType?: ModelStringInput | null,
  createdAt?: ModelStringInput | null,
  deviceType?: ModelStringInput | null,
  downlink?: ModelFloatInput | null,
  id?: ModelIDInput | null,
  ipAddress?: ModelStringInput | null,
  not?: ModelClientLogFilterInput | null,
  or?: Array< ModelClientLogFilterInput | null > | null,
  os?: ModelStringInput | null,
  rtt?: ModelFloatInput | null,
  updatedAt?: ModelStringInput | null,
  userAgent?: ModelStringInput | null,
  userId?: ModelStringInput | null,
};

export type ModelClientLogConnection = {
  __typename: "ModelClientLogConnection",
  items:  Array<ClientLog | null >,
  nextToken?: string | null,
};

export type ClientLog = {
  __typename: "ClientLog",
  connectionType?: string | null,
  createdAt: string,
  deviceType?: string | null,
  downlink?: number | null,
  id: string,
  ipAddress?: string | null,
  os?: string | null,
  rtt?: number | null,
  updatedAt: string,
  userAgent?: string | null,
  userId: string,
};

export type GetImageCountsReturnType = {
  __typename: "GetImageCountsReturnType",
  count?: number | null,
  nextToken?: string | null,
};

export type JollyResult = {
  __typename: "JollyResult",
  animals: number,
  annotationSetId: string,
  areaSurveyed: number,
  categoryId: string,
  createdAt: string,
  density: number,
  estimate: number,
  lowerBound95: number,
  numSamples: number,
  standardError: number,
  stratumId: string,
  surveyId: string,
  updatedAt: string,
  upperBound95: number,
  variance: number,
};

export type OrganizationRegistration = {
  __typename: "OrganizationRegistration",
  briefDescription: string,
  createdAt: string,
  id: string,
  organizationName: string,
  requestedBy: string,
  status?: string | null,
  updatedAt: string,
};

export type ResultSharingToken = {
  __typename: "ResultSharingToken",
  annotationSetId: string,
  createdAt: string,
  jwt: string,
  surveyId: string,
  updatedAt: string,
};

export type UserStats = {
  __typename: "UserStats",
  activeTime: number,
  annotationCount: number,
  annotationTime?: number | null,
  createdAt: string,
  date: string,
  observationCount: number,
  projectId: string,
  searchCount?: number | null,
  searchTime?: number | null,
  setId: string,
  sightingCount?: number | null,
  updatedAt: string,
  userId: string,
  waitingTime?: number | null,
};

export type ModelImageNeighbourFilterInput = {
  and?: Array< ModelImageNeighbourFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  homography?: ModelFloatInput | null,
  id?: ModelIDInput | null,
  image1Id?: ModelIDInput | null,
  image2Id?: ModelIDInput | null,
  not?: ModelImageNeighbourFilterInput | null,
  or?: Array< ModelImageNeighbourFilterInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelImageSetMembershipFilterInput = {
  and?: Array< ModelImageSetMembershipFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  imageId?: ModelIDInput | null,
  imageSetId?: ModelIDInput | null,
  not?: ModelImageSetMembershipFilterInput | null,
  or?: Array< ModelImageSetMembershipFilterInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelImageSetFilterInput = {
  and?: Array< ModelImageSetFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  imageCount?: ModelIntInput | null,
  name?: ModelStringInput | null,
  not?: ModelImageSetFilterInput | null,
  or?: Array< ModelImageSetFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelImageFileFilterInput = {
  and?: Array< ModelImageFileFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  imageId?: ModelIDInput | null,
  key?: ModelStringInput | null,
  not?: ModelImageFileFilterInput | null,
  or?: Array< ModelImageFileFilterInput | null > | null,
  path?: ModelStringInput | null,
  projectId?: ModelIDInput | null,
  type?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelImageFilterInput = {
  altitude_agl?: ModelFloatInput | null,
  altitude_egm96?: ModelFloatInput | null,
  altitude_wgs84?: ModelFloatInput | null,
  and?: Array< ModelImageFilterInput | null > | null,
  cameraId?: ModelIDInput | null,
  cameraSerial?: ModelStringInput | null,
  createdAt?: ModelStringInput | null,
  exifData?: ModelStringInput | null,
  height?: ModelIntInput | null,
  id?: ModelIDInput | null,
  latitude?: ModelFloatInput | null,
  longitude?: ModelFloatInput | null,
  not?: ModelImageFilterInput | null,
  or?: Array< ModelImageFilterInput | null > | null,
  originalPath?: ModelStringInput | null,
  pitch?: ModelFloatInput | null,
  projectId?: ModelIDInput | null,
  roll?: ModelFloatInput | null,
  timestamp?: ModelIntInput | null,
  transectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
  width?: ModelIntInput | null,
  yaw?: ModelFloatInput | null,
};

export type ModelJollyResultFilterInput = {
  and?: Array< ModelJollyResultFilterInput | null > | null,
  animals?: ModelIntInput | null,
  annotationSetId?: ModelIDInput | null,
  areaSurveyed?: ModelFloatInput | null,
  categoryId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  density?: ModelFloatInput | null,
  estimate?: ModelFloatInput | null,
  id?: ModelIDInput | null,
  lowerBound95?: ModelFloatInput | null,
  not?: ModelJollyResultFilterInput | null,
  numSamples?: ModelIntInput | null,
  or?: Array< ModelJollyResultFilterInput | null > | null,
  standardError?: ModelFloatInput | null,
  stratumId?: ModelIDInput | null,
  surveyId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
  upperBound95?: ModelFloatInput | null,
  variance?: ModelFloatInput | null,
};

export type ModelJollyResultConnection = {
  __typename: "ModelJollyResultConnection",
  items:  Array<JollyResult | null >,
  nextToken?: string | null,
};

export type ModelJollyResultsMembershipFilterInput = {
  and?: Array< ModelJollyResultsMembershipFilterInput | null > | null,
  annotationSetId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  not?: ModelJollyResultsMembershipFilterInput | null,
  or?: Array< ModelJollyResultsMembershipFilterInput | null > | null,
  surveyId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
  userId?: ModelStringInput | null,
};

export type ModelJollyResultPrimaryCompositeKeyConditionInput = {
  beginsWith?: ModelJollyResultPrimaryCompositeKeyInput | null,
  between?: Array< ModelJollyResultPrimaryCompositeKeyInput | null > | null,
  eq?: ModelJollyResultPrimaryCompositeKeyInput | null,
  ge?: ModelJollyResultPrimaryCompositeKeyInput | null,
  gt?: ModelJollyResultPrimaryCompositeKeyInput | null,
  le?: ModelJollyResultPrimaryCompositeKeyInput | null,
  lt?: ModelJollyResultPrimaryCompositeKeyInput | null,
};

export type ModelJollyResultPrimaryCompositeKeyInput = {
  annotationSetId?: string | null,
  categoryId?: string | null,
  stratumId?: string | null,
};

export type ModelJollyResultsMembershipPrimaryCompositeKeyConditionInput = {
  beginsWith?: ModelJollyResultsMembershipPrimaryCompositeKeyInput | null,
  between?: Array< ModelJollyResultsMembershipPrimaryCompositeKeyInput | null > | null,
  eq?: ModelJollyResultsMembershipPrimaryCompositeKeyInput | null,
  ge?: ModelJollyResultsMembershipPrimaryCompositeKeyInput | null,
  gt?: ModelJollyResultsMembershipPrimaryCompositeKeyInput | null,
  le?: ModelJollyResultsMembershipPrimaryCompositeKeyInput | null,
  lt?: ModelJollyResultsMembershipPrimaryCompositeKeyInput | null,
};

export type ModelJollyResultsMembershipPrimaryCompositeKeyInput = {
  annotationSetId?: string | null,
  userId?: string | null,
};

export type ModelLocationAnnotationCountPrimaryCompositeKeyConditionInput = {
  beginsWith?: ModelLocationAnnotationCountPrimaryCompositeKeyInput | null,
  between?: Array< ModelLocationAnnotationCountPrimaryCompositeKeyInput | null > | null,
  eq?: ModelLocationAnnotationCountPrimaryCompositeKeyInput | null,
  ge?: ModelLocationAnnotationCountPrimaryCompositeKeyInput | null,
  gt?: ModelLocationAnnotationCountPrimaryCompositeKeyInput | null,
  le?: ModelLocationAnnotationCountPrimaryCompositeKeyInput | null,
  lt?: ModelLocationAnnotationCountPrimaryCompositeKeyInput | null,
};

export type ModelLocationAnnotationCountPrimaryCompositeKeyInput = {
  annotationSetId?: string | null,
  categoryId?: string | null,
};

export type ModelLocationSetMembershipFilterInput = {
  and?: Array< ModelLocationSetMembershipFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  locationId?: ModelIDInput | null,
  locationSetId?: ModelIDInput | null,
  not?: ModelLocationSetMembershipFilterInput | null,
  or?: Array< ModelLocationSetMembershipFilterInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelLocationSetFilterInput = {
  and?: Array< ModelLocationSetFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  description?: ModelStringInput | null,
  id?: ModelIDInput | null,
  locationCount?: ModelIntInput | null,
  name?: ModelStringInput | null,
  not?: ModelLocationSetFilterInput | null,
  or?: Array< ModelLocationSetFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelLocationFilterInput = {
  and?: Array< ModelLocationFilterInput | null > | null,
  confidence?: ModelFloatInput | null,
  createdAt?: ModelStringInput | null,
  height?: ModelIntInput | null,
  id?: ModelIDInput | null,
  imageId?: ModelIDInput | null,
  not?: ModelLocationFilterInput | null,
  or?: Array< ModelLocationFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  setId?: ModelIDInput | null,
  source?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
  width?: ModelIntInput | null,
  x?: ModelIntInput | null,
  y?: ModelIntInput | null,
};

export type ModelObjectFilterInput = {
  and?: Array< ModelObjectFilterInput | null > | null,
  categoryId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  not?: ModelObjectFilterInput | null,
  or?: Array< ModelObjectFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelObservationFilterInput = {
  and?: Array< ModelObservationFilterInput | null > | null,
  annotationCount?: ModelIntInput | null,
  annotationSetId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  loadingTime?: ModelFloatInput | null,
  locationId?: ModelIDInput | null,
  not?: ModelObservationFilterInput | null,
  or?: Array< ModelObservationFilterInput | null > | null,
  owner?: ModelStringInput | null,
  projectId?: ModelIDInput | null,
  timeTaken?: ModelFloatInput | null,
  updatedAt?: ModelStringInput | null,
  waitingTime?: ModelFloatInput | null,
};

export type ModelOrganizationInviteFilterInput = {
  and?: Array< ModelOrganizationInviteFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  invitedBy?: ModelStringInput | null,
  not?: ModelOrganizationInviteFilterInput | null,
  or?: Array< ModelOrganizationInviteFilterInput | null > | null,
  organizationId?: ModelIDInput | null,
  status?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
  username?: ModelStringInput | null,
};

export type ModelOrganizationMembershipFilterInput = {
  and?: Array< ModelOrganizationMembershipFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  isAdmin?: ModelBooleanInput | null,
  isTested?: ModelBooleanInput | null,
  not?: ModelOrganizationMembershipFilterInput | null,
  or?: Array< ModelOrganizationMembershipFilterInput | null > | null,
  organizationId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
  userId?: ModelStringInput | null,
};

export type ModelStringKeyConditionInput = {
  beginsWith?: string | null,
  between?: Array< string | null > | null,
  eq?: string | null,
  ge?: string | null,
  gt?: string | null,
  le?: string | null,
  lt?: string | null,
};

export type ModelOrganizationRegistrationFilterInput = {
  and?: Array< ModelOrganizationRegistrationFilterInput | null > | null,
  briefDescription?: ModelStringInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  not?: ModelOrganizationRegistrationFilterInput | null,
  or?: Array< ModelOrganizationRegistrationFilterInput | null > | null,
  organizationName?: ModelStringInput | null,
  requestedBy?: ModelStringInput | null,
  status?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelOrganizationRegistrationConnection = {
  __typename: "ModelOrganizationRegistrationConnection",
  items:  Array<OrganizationRegistration | null >,
  nextToken?: string | null,
};

export type ModelOrganizationFilterInput = {
  and?: Array< ModelOrganizationFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  description?: ModelStringInput | null,
  id?: ModelIDInput | null,
  name?: ModelStringInput | null,
  not?: ModelOrganizationFilterInput | null,
  or?: Array< ModelOrganizationFilterInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelOrganizationConnection = {
  __typename: "ModelOrganizationConnection",
  items:  Array<Organization | null >,
  nextToken?: string | null,
};

export type ModelProjectTestConfigFilterInput = {
  accuracy?: ModelIntInput | null,
  and?: Array< ModelProjectTestConfigFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  deadzone?: ModelFloatInput | null,
  id?: ModelIDInput | null,
  interval?: ModelFloatInput | null,
  not?: ModelProjectTestConfigFilterInput | null,
  or?: Array< ModelProjectTestConfigFilterInput | null > | null,
  postTestConfirmation?: ModelBooleanInput | null,
  projectId?: ModelIDInput | null,
  random?: ModelFloatInput | null,
  testType?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelProjectTestConfigConnection = {
  __typename: "ModelProjectTestConfigConnection",
  items:  Array<ProjectTestConfig | null >,
  nextToken?: string | null,
};

export type ModelProjectFilterInput = {
  and?: Array< ModelProjectFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  createdBy?: ModelStringInput | null,
  hidden?: ModelBooleanInput | null,
  id?: ModelIDInput | null,
  name?: ModelStringInput | null,
  not?: ModelProjectFilterInput | null,
  or?: Array< ModelProjectFilterInput | null > | null,
  organizationId?: ModelIDInput | null,
  status?: ModelStringInput | null,
  tags?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelQueueFilterInput = {
  and?: Array< ModelQueueFilterInput | null > | null,
  approximateSize?: ModelIntInput | null,
  batchSize?: ModelIntInput | null,
  createdAt?: ModelStringInput | null,
  hidden?: ModelBooleanInput | null,
  id?: ModelIDInput | null,
  name?: ModelStringInput | null,
  not?: ModelQueueFilterInput | null,
  or?: Array< ModelQueueFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  tag?: ModelStringInput | null,
  totalBatches?: ModelIntInput | null,
  updatedAt?: ModelStringInput | null,
  url?: ModelStringInput | null,
  zoom?: ModelIntInput | null,
};

export type ModelResultSharingTokenFilterInput = {
  and?: Array< ModelResultSharingTokenFilterInput | null > | null,
  annotationSetId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  jwt?: ModelStringInput | null,
  not?: ModelResultSharingTokenFilterInput | null,
  or?: Array< ModelResultSharingTokenFilterInput | null > | null,
  surveyId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelResultSharingTokenConnection = {
  __typename: "ModelResultSharingTokenConnection",
  items:  Array<ResultSharingToken | null >,
  nextToken?: string | null,
};

export type ModelShapefileExclusionsFilterInput = {
  and?: Array< ModelShapefileExclusionsFilterInput | null > | null,
  coordinates?: ModelFloatInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  not?: ModelShapefileExclusionsFilterInput | null,
  or?: Array< ModelShapefileExclusionsFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelShapefileFilterInput = {
  and?: Array< ModelShapefileFilterInput | null > | null,
  coordinates?: ModelFloatInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  not?: ModelShapefileFilterInput | null,
  or?: Array< ModelShapefileFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelShapefileConnection = {
  __typename: "ModelShapefileConnection",
  items:  Array<Shapefile | null >,
  nextToken?: string | null,
};

export type ModelStratumFilterInput = {
  and?: Array< ModelStratumFilterInput | null > | null,
  area?: ModelFloatInput | null,
  baselineLength?: ModelFloatInput | null,
  coordinates?: ModelFloatInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  name?: ModelStringInput | null,
  not?: ModelStratumFilterInput | null,
  or?: Array< ModelStratumFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelTasksOnAnnotationSetFilterInput = {
  and?: Array< ModelTasksOnAnnotationSetFilterInput | null > | null,
  annotationSetId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  locationSetId?: ModelIDInput | null,
  not?: ModelTasksOnAnnotationSetFilterInput | null,
  or?: Array< ModelTasksOnAnnotationSetFilterInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelTestPresetLocationFilterInput = {
  and?: Array< ModelTestPresetLocationFilterInput | null > | null,
  annotationSetId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  locationId?: ModelIDInput | null,
  not?: ModelTestPresetLocationFilterInput | null,
  or?: Array< ModelTestPresetLocationFilterInput | null > | null,
  testPresetId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelTestPresetLocationPrimaryCompositeKeyConditionInput = {
  beginsWith?: ModelTestPresetLocationPrimaryCompositeKeyInput | null,
  between?: Array< ModelTestPresetLocationPrimaryCompositeKeyInput | null > | null,
  eq?: ModelTestPresetLocationPrimaryCompositeKeyInput | null,
  ge?: ModelTestPresetLocationPrimaryCompositeKeyInput | null,
  gt?: ModelTestPresetLocationPrimaryCompositeKeyInput | null,
  le?: ModelTestPresetLocationPrimaryCompositeKeyInput | null,
  lt?: ModelTestPresetLocationPrimaryCompositeKeyInput | null,
};

export type ModelTestPresetLocationPrimaryCompositeKeyInput = {
  annotationSetId?: string | null,
  locationId?: string | null,
};

export type ModelTestPresetProjectFilterInput = {
  and?: Array< ModelTestPresetProjectFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  not?: ModelTestPresetProjectFilterInput | null,
  or?: Array< ModelTestPresetProjectFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  testPresetId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelTestPresetFilterInput = {
  and?: Array< ModelTestPresetFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  name?: ModelStringInput | null,
  not?: ModelTestPresetFilterInput | null,
  or?: Array< ModelTestPresetFilterInput | null > | null,
  organizationId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelTestResultFilterInput = {
  and?: Array< ModelTestResultFilterInput | null > | null,
  annotationSetId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  locationId?: ModelIDInput | null,
  not?: ModelTestResultFilterInput | null,
  or?: Array< ModelTestResultFilterInput | null > | null,
  passedOnTotal?: ModelBooleanInput | null,
  projectId?: ModelIDInput | null,
  testAnimals?: ModelIntInput | null,
  testPresetId?: ModelIDInput | null,
  totalMissedAnimals?: ModelIntInput | null,
  updatedAt?: ModelStringInput | null,
  userId?: ModelIDInput | null,
};

export type ModelTransectFilterInput = {
  and?: Array< ModelTransectFilterInput | null > | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  not?: ModelTransectFilterInput | null,
  or?: Array< ModelTransectFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  stratumId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type ModelUserProjectMembershipFilterInput = {
  and?: Array< ModelUserProjectMembershipFilterInput | null > | null,
  backupQueueId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  id?: ModelIDInput | null,
  isAdmin?: ModelBooleanInput | null,
  not?: ModelUserProjectMembershipFilterInput | null,
  or?: Array< ModelUserProjectMembershipFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  queueId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
  userId?: ModelStringInput | null,
};

export type ModelUserStatsFilterInput = {
  activeTime?: ModelFloatInput | null,
  and?: Array< ModelUserStatsFilterInput | null > | null,
  annotationCount?: ModelIntInput | null,
  annotationTime?: ModelFloatInput | null,
  createdAt?: ModelStringInput | null,
  date?: ModelStringInput | null,
  id?: ModelIDInput | null,
  not?: ModelUserStatsFilterInput | null,
  observationCount?: ModelIntInput | null,
  or?: Array< ModelUserStatsFilterInput | null > | null,
  projectId?: ModelIDInput | null,
  searchCount?: ModelIntInput | null,
  searchTime?: ModelFloatInput | null,
  setId?: ModelIDInput | null,
  sightingCount?: ModelIntInput | null,
  updatedAt?: ModelStringInput | null,
  userId?: ModelIDInput | null,
  waitingTime?: ModelFloatInput | null,
};

export type ModelUserStatsPrimaryCompositeKeyConditionInput = {
  beginsWith?: ModelUserStatsPrimaryCompositeKeyInput | null,
  between?: Array< ModelUserStatsPrimaryCompositeKeyInput | null > | null,
  eq?: ModelUserStatsPrimaryCompositeKeyInput | null,
  ge?: ModelUserStatsPrimaryCompositeKeyInput | null,
  gt?: ModelUserStatsPrimaryCompositeKeyInput | null,
  le?: ModelUserStatsPrimaryCompositeKeyInput | null,
  lt?: ModelUserStatsPrimaryCompositeKeyInput | null,
};

export type ModelUserStatsPrimaryCompositeKeyInput = {
  date?: string | null,
  setId?: string | null,
  userId?: string | null,
};

export type ModelUserStatsConnection = {
  __typename: "ModelUserStatsConnection",
  items:  Array<UserStats | null >,
  nextToken?: string | null,
};

export type ListUsersReturnType = {
  __typename: "ListUsersReturnType",
  NextToken?: string | null,
  Users?:  Array<UserType | null > | null,
};

export type UserType = {
  __typename: "UserType",
  email?: string | null,
  id: string,
  isAdmin?: boolean | null,
  name?: string | null,
};

export type ModelFloatKeyConditionInput = {
  between?: Array< number | null > | null,
  eq?: number | null,
  ge?: number | null,
  gt?: number | null,
  le?: number | null,
  lt?: number | null,
};

export type ModelAnnotationConditionInput = {
  and?: Array< ModelAnnotationConditionInput | null > | null,
  categoryId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  imageId?: ModelIDInput | null,
  not?: ModelAnnotationConditionInput | null,
  objectId?: ModelIDInput | null,
  obscured?: ModelBooleanInput | null,
  or?: Array< ModelAnnotationConditionInput | null > | null,
  owner?: ModelStringInput | null,
  projectId?: ModelIDInput | null,
  setId?: ModelIDInput | null,
  source?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
  x?: ModelIntInput | null,
  y?: ModelIntInput | null,
};

export type CreateAnnotationInput = {
  categoryId: string,
  id?: string | null,
  imageId: string,
  objectId?: string | null,
  obscured?: boolean | null,
  projectId: string,
  setId: string,
  source: string,
  x: number,
  y: number,
};

export type ModelAnnotationSetConditionInput = {
  and?: Array< ModelAnnotationSetConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  name?: ModelStringInput | null,
  not?: ModelAnnotationSetConditionInput | null,
  or?: Array< ModelAnnotationSetConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  register?: ModelBooleanInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateAnnotationSetInput = {
  id?: string | null,
  name: string,
  projectId: string,
  register?: boolean | null,
};

export type ModelCameraConditionInput = {
  and?: Array< ModelCameraConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  focalLengthMm?: ModelFloatInput | null,
  name?: ModelStringInput | null,
  not?: ModelCameraConditionInput | null,
  or?: Array< ModelCameraConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  sensorWidthMm?: ModelFloatInput | null,
  tiltDegrees?: ModelFloatInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateCameraInput = {
  focalLengthMm?: number | null,
  id?: string | null,
  name: string,
  projectId: string,
  sensorWidthMm?: number | null,
  tiltDegrees?: number | null,
};

export type ModelCameraOverlapConditionInput = {
  and?: Array< ModelCameraOverlapConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  not?: ModelCameraOverlapConditionInput | null,
  or?: Array< ModelCameraOverlapConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateCameraOverlapInput = {
  cameraAId: string,
  cameraBId: string,
  projectId: string,
};

export type ModelCategoryConditionInput = {
  and?: Array< ModelCategoryConditionInput | null > | null,
  annotationCount?: ModelIntInput | null,
  annotationSetId?: ModelIDInput | null,
  color?: ModelStringInput | null,
  createdAt?: ModelStringInput | null,
  name?: ModelStringInput | null,
  not?: ModelCategoryConditionInput | null,
  or?: Array< ModelCategoryConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  shortcutKey?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateCategoryInput = {
  annotationCount?: number | null,
  annotationSetId: string,
  color?: string | null,
  id?: string | null,
  name: string,
  projectId: string,
  shortcutKey?: string | null,
};

export type ModelClientLogConditionInput = {
  and?: Array< ModelClientLogConditionInput | null > | null,
  connectionType?: ModelStringInput | null,
  createdAt?: ModelStringInput | null,
  deviceType?: ModelStringInput | null,
  downlink?: ModelFloatInput | null,
  ipAddress?: ModelStringInput | null,
  not?: ModelClientLogConditionInput | null,
  or?: Array< ModelClientLogConditionInput | null > | null,
  os?: ModelStringInput | null,
  rtt?: ModelFloatInput | null,
  updatedAt?: ModelStringInput | null,
  userAgent?: ModelStringInput | null,
  userId?: ModelStringInput | null,
};

export type CreateClientLogInput = {
  connectionType?: string | null,
  deviceType?: string | null,
  downlink?: number | null,
  id?: string | null,
  ipAddress?: string | null,
  os?: string | null,
  rtt?: number | null,
  userAgent?: string | null,
  userId: string,
};

export type ModelImageConditionInput = {
  altitude_agl?: ModelFloatInput | null,
  altitude_egm96?: ModelFloatInput | null,
  altitude_wgs84?: ModelFloatInput | null,
  and?: Array< ModelImageConditionInput | null > | null,
  cameraId?: ModelIDInput | null,
  cameraSerial?: ModelStringInput | null,
  createdAt?: ModelStringInput | null,
  exifData?: ModelStringInput | null,
  height?: ModelIntInput | null,
  latitude?: ModelFloatInput | null,
  longitude?: ModelFloatInput | null,
  not?: ModelImageConditionInput | null,
  or?: Array< ModelImageConditionInput | null > | null,
  originalPath?: ModelStringInput | null,
  pitch?: ModelFloatInput | null,
  projectId?: ModelIDInput | null,
  roll?: ModelFloatInput | null,
  timestamp?: ModelIntInput | null,
  transectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
  width?: ModelIntInput | null,
  yaw?: ModelFloatInput | null,
};

export type CreateImageInput = {
  altitude_agl?: number | null,
  altitude_egm96?: number | null,
  altitude_wgs84?: number | null,
  cameraId?: string | null,
  cameraSerial?: string | null,
  exifData?: string | null,
  height: number,
  id?: string | null,
  latitude?: number | null,
  longitude?: number | null,
  originalPath?: string | null,
  pitch?: number | null,
  projectId: string,
  roll?: number | null,
  timestamp?: number | null,
  transectId?: string | null,
  width: number,
  yaw?: number | null,
};

export type ModelImageFileConditionInput = {
  and?: Array< ModelImageFileConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  imageId?: ModelIDInput | null,
  key?: ModelStringInput | null,
  not?: ModelImageFileConditionInput | null,
  or?: Array< ModelImageFileConditionInput | null > | null,
  path?: ModelStringInput | null,
  projectId?: ModelIDInput | null,
  type?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateImageFileInput = {
  id?: string | null,
  imageId?: string | null,
  key: string,
  path: string,
  projectId: string,
  type: string,
};

export type ModelImageNeighbourConditionInput = {
  and?: Array< ModelImageNeighbourConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  homography?: ModelFloatInput | null,
  not?: ModelImageNeighbourConditionInput | null,
  or?: Array< ModelImageNeighbourConditionInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateImageNeighbourInput = {
  group?: string | null,
  homography?: Array< number | null > | null,
  image1Id: string,
  image2Id: string,
};

export type ModelImageSetConditionInput = {
  and?: Array< ModelImageSetConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  imageCount?: ModelIntInput | null,
  name?: ModelStringInput | null,
  not?: ModelImageSetConditionInput | null,
  or?: Array< ModelImageSetConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateImageSetInput = {
  id?: string | null,
  imageCount?: number | null,
  name: string,
  projectId: string,
};

export type ModelImageSetMembershipConditionInput = {
  and?: Array< ModelImageSetMembershipConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  imageId?: ModelIDInput | null,
  imageSetId?: ModelIDInput | null,
  not?: ModelImageSetMembershipConditionInput | null,
  or?: Array< ModelImageSetMembershipConditionInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateImageSetMembershipInput = {
  id?: string | null,
  imageId: string,
  imageSetId: string,
};

export type ModelJollyResultConditionInput = {
  and?: Array< ModelJollyResultConditionInput | null > | null,
  animals?: ModelIntInput | null,
  areaSurveyed?: ModelFloatInput | null,
  createdAt?: ModelStringInput | null,
  density?: ModelFloatInput | null,
  estimate?: ModelFloatInput | null,
  lowerBound95?: ModelFloatInput | null,
  not?: ModelJollyResultConditionInput | null,
  numSamples?: ModelIntInput | null,
  or?: Array< ModelJollyResultConditionInput | null > | null,
  standardError?: ModelFloatInput | null,
  updatedAt?: ModelStringInput | null,
  upperBound95?: ModelFloatInput | null,
  variance?: ModelFloatInput | null,
};

export type CreateJollyResultInput = {
  animals: number,
  annotationSetId: string,
  areaSurveyed: number,
  categoryId: string,
  density: number,
  estimate: number,
  lowerBound95: number,
  numSamples: number,
  standardError: number,
  stratumId: string,
  surveyId: string,
  upperBound95: number,
  variance: number,
};

export type ModelJollyResultsMembershipConditionInput = {
  and?: Array< ModelJollyResultsMembershipConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  not?: ModelJollyResultsMembershipConditionInput | null,
  or?: Array< ModelJollyResultsMembershipConditionInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateJollyResultsMembershipInput = {
  annotationSetId: string,
  surveyId: string,
  userId: string,
};

export type ModelLocationConditionInput = {
  and?: Array< ModelLocationConditionInput | null > | null,
  confidence?: ModelFloatInput | null,
  createdAt?: ModelStringInput | null,
  height?: ModelIntInput | null,
  imageId?: ModelIDInput | null,
  not?: ModelLocationConditionInput | null,
  or?: Array< ModelLocationConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  setId?: ModelIDInput | null,
  source?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
  width?: ModelIntInput | null,
  x?: ModelIntInput | null,
  y?: ModelIntInput | null,
};

export type CreateLocationInput = {
  confidence?: number | null,
  height?: number | null,
  id?: string | null,
  imageId?: string | null,
  projectId: string,
  setId: string,
  source: string,
  width?: number | null,
  x: number,
  y: number,
};

export type ModelLocationAnnotationCountConditionInput = {
  and?: Array< ModelLocationAnnotationCountConditionInput | null > | null,
  count?: ModelIntInput | null,
  createdAt?: ModelStringInput | null,
  not?: ModelLocationAnnotationCountConditionInput | null,
  or?: Array< ModelLocationAnnotationCountConditionInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateLocationAnnotationCountInput = {
  annotationSetId: string,
  categoryId: string,
  count?: number | null,
  locationId: string,
};

export type ModelLocationSetConditionInput = {
  and?: Array< ModelLocationSetConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  description?: ModelStringInput | null,
  locationCount?: ModelIntInput | null,
  name?: ModelStringInput | null,
  not?: ModelLocationSetConditionInput | null,
  or?: Array< ModelLocationSetConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateLocationSetInput = {
  description?: string | null,
  id?: string | null,
  locationCount?: number | null,
  name: string,
  projectId: string,
};

export type ModelLocationSetMembershipConditionInput = {
  and?: Array< ModelLocationSetMembershipConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  locationId?: ModelIDInput | null,
  locationSetId?: ModelIDInput | null,
  not?: ModelLocationSetMembershipConditionInput | null,
  or?: Array< ModelLocationSetMembershipConditionInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateLocationSetMembershipInput = {
  id?: string | null,
  locationId: string,
  locationSetId: string,
};

export type ModelObjectConditionInput = {
  and?: Array< ModelObjectConditionInput | null > | null,
  categoryId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  not?: ModelObjectConditionInput | null,
  or?: Array< ModelObjectConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateObjectInput = {
  categoryId: string,
  id?: string | null,
  projectId: string,
};

export type ModelObservationConditionInput = {
  and?: Array< ModelObservationConditionInput | null > | null,
  annotationCount?: ModelIntInput | null,
  annotationSetId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  loadingTime?: ModelFloatInput | null,
  locationId?: ModelIDInput | null,
  not?: ModelObservationConditionInput | null,
  or?: Array< ModelObservationConditionInput | null > | null,
  owner?: ModelStringInput | null,
  projectId?: ModelIDInput | null,
  timeTaken?: ModelFloatInput | null,
  updatedAt?: ModelStringInput | null,
  waitingTime?: ModelFloatInput | null,
};

export type CreateObservationInput = {
  annotationCount?: number | null,
  annotationSetId: string,
  createdAt?: string | null,
  id?: string | null,
  loadingTime?: number | null,
  locationId: string,
  owner?: string | null,
  projectId: string,
  timeTaken?: number | null,
  waitingTime?: number | null,
};

export type ModelOrganizationConditionInput = {
  and?: Array< ModelOrganizationConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  description?: ModelStringInput | null,
  name?: ModelStringInput | null,
  not?: ModelOrganizationConditionInput | null,
  or?: Array< ModelOrganizationConditionInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateOrganizationInput = {
  description?: string | null,
  id?: string | null,
  name: string,
};

export type ModelOrganizationInviteConditionInput = {
  and?: Array< ModelOrganizationInviteConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  invitedBy?: ModelStringInput | null,
  not?: ModelOrganizationInviteConditionInput | null,
  or?: Array< ModelOrganizationInviteConditionInput | null > | null,
  organizationId?: ModelIDInput | null,
  status?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
  username?: ModelStringInput | null,
};

export type CreateOrganizationInviteInput = {
  id?: string | null,
  invitedBy: string,
  organizationId: string,
  status?: string | null,
  username: string,
};

export type ModelOrganizationMembershipConditionInput = {
  and?: Array< ModelOrganizationMembershipConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  isAdmin?: ModelBooleanInput | null,
  isTested?: ModelBooleanInput | null,
  not?: ModelOrganizationMembershipConditionInput | null,
  or?: Array< ModelOrganizationMembershipConditionInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateOrganizationMembershipInput = {
  isAdmin?: boolean | null,
  isTested?: boolean | null,
  organizationId: string,
  userId: string,
};

export type ModelOrganizationRegistrationConditionInput = {
  and?: Array< ModelOrganizationRegistrationConditionInput | null > | null,
  briefDescription?: ModelStringInput | null,
  createdAt?: ModelStringInput | null,
  not?: ModelOrganizationRegistrationConditionInput | null,
  or?: Array< ModelOrganizationRegistrationConditionInput | null > | null,
  organizationName?: ModelStringInput | null,
  requestedBy?: ModelStringInput | null,
  status?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateOrganizationRegistrationInput = {
  briefDescription: string,
  id?: string | null,
  organizationName: string,
  requestedBy: string,
  status?: string | null,
};

export type ModelProjectConditionInput = {
  and?: Array< ModelProjectConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  createdBy?: ModelStringInput | null,
  hidden?: ModelBooleanInput | null,
  name?: ModelStringInput | null,
  not?: ModelProjectConditionInput | null,
  or?: Array< ModelProjectConditionInput | null > | null,
  organizationId?: ModelIDInput | null,
  status?: ModelStringInput | null,
  tags?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateProjectInput = {
  createdBy: string,
  hidden?: boolean | null,
  id?: string | null,
  name: string,
  organizationId: string,
  status?: string | null,
  tags?: Array< string | null > | null,
};

export type ModelProjectTestConfigConditionInput = {
  accuracy?: ModelIntInput | null,
  and?: Array< ModelProjectTestConfigConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  deadzone?: ModelFloatInput | null,
  interval?: ModelFloatInput | null,
  not?: ModelProjectTestConfigConditionInput | null,
  or?: Array< ModelProjectTestConfigConditionInput | null > | null,
  postTestConfirmation?: ModelBooleanInput | null,
  random?: ModelFloatInput | null,
  testType?: ModelStringInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateProjectTestConfigInput = {
  accuracy: number,
  deadzone?: number | null,
  interval?: number | null,
  postTestConfirmation?: boolean | null,
  projectId: string,
  random?: number | null,
  testType?: string | null,
};

export type ModelQueueConditionInput = {
  and?: Array< ModelQueueConditionInput | null > | null,
  approximateSize?: ModelIntInput | null,
  batchSize?: ModelIntInput | null,
  createdAt?: ModelStringInput | null,
  hidden?: ModelBooleanInput | null,
  name?: ModelStringInput | null,
  not?: ModelQueueConditionInput | null,
  or?: Array< ModelQueueConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  tag?: ModelStringInput | null,
  totalBatches?: ModelIntInput | null,
  updatedAt?: ModelStringInput | null,
  url?: ModelStringInput | null,
  zoom?: ModelIntInput | null,
};

export type CreateQueueInput = {
  approximateSize?: number | null,
  batchSize?: number | null,
  hidden?: boolean | null,
  id?: string | null,
  name: string,
  projectId: string,
  tag?: string | null,
  totalBatches?: number | null,
  url?: string | null,
  zoom?: number | null,
};

export type ModelResultSharingTokenConditionInput = {
  and?: Array< ModelResultSharingTokenConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  jwt?: ModelStringInput | null,
  not?: ModelResultSharingTokenConditionInput | null,
  or?: Array< ModelResultSharingTokenConditionInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateResultSharingTokenInput = {
  annotationSetId: string,
  jwt: string,
  surveyId: string,
};

export type ModelShapefileConditionInput = {
  and?: Array< ModelShapefileConditionInput | null > | null,
  coordinates?: ModelFloatInput | null,
  createdAt?: ModelStringInput | null,
  not?: ModelShapefileConditionInput | null,
  or?: Array< ModelShapefileConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateShapefileInput = {
  coordinates?: Array< number | null > | null,
  id?: string | null,
  projectId: string,
};

export type ModelShapefileExclusionsConditionInput = {
  and?: Array< ModelShapefileExclusionsConditionInput | null > | null,
  coordinates?: ModelFloatInput | null,
  createdAt?: ModelStringInput | null,
  not?: ModelShapefileExclusionsConditionInput | null,
  or?: Array< ModelShapefileExclusionsConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateShapefileExclusionsInput = {
  coordinates?: Array< number | null > | null,
  id?: string | null,
  projectId: string,
};

export type ModelStratumConditionInput = {
  and?: Array< ModelStratumConditionInput | null > | null,
  area?: ModelFloatInput | null,
  baselineLength?: ModelFloatInput | null,
  coordinates?: ModelFloatInput | null,
  createdAt?: ModelStringInput | null,
  name?: ModelStringInput | null,
  not?: ModelStratumConditionInput | null,
  or?: Array< ModelStratumConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateStratumInput = {
  area?: number | null,
  baselineLength?: number | null,
  coordinates?: Array< number | null > | null,
  id?: string | null,
  name: string,
  projectId: string,
};

export type ModelTasksOnAnnotationSetConditionInput = {
  and?: Array< ModelTasksOnAnnotationSetConditionInput | null > | null,
  annotationSetId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  locationSetId?: ModelIDInput | null,
  not?: ModelTasksOnAnnotationSetConditionInput | null,
  or?: Array< ModelTasksOnAnnotationSetConditionInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateTasksOnAnnotationSetInput = {
  annotationSetId: string,
  id?: string | null,
  locationSetId: string,
};

export type ModelTestPresetConditionInput = {
  and?: Array< ModelTestPresetConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  name?: ModelStringInput | null,
  not?: ModelTestPresetConditionInput | null,
  or?: Array< ModelTestPresetConditionInput | null > | null,
  organizationId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateTestPresetInput = {
  id?: string | null,
  name: string,
  organizationId: string,
};

export type ModelTestPresetLocationConditionInput = {
  and?: Array< ModelTestPresetLocationConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  not?: ModelTestPresetLocationConditionInput | null,
  or?: Array< ModelTestPresetLocationConditionInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateTestPresetLocationInput = {
  annotationSetId: string,
  locationId: string,
  testPresetId: string,
};

export type ModelTestPresetProjectConditionInput = {
  and?: Array< ModelTestPresetProjectConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  not?: ModelTestPresetProjectConditionInput | null,
  or?: Array< ModelTestPresetProjectConditionInput | null > | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateTestPresetProjectInput = {
  projectId: string,
  testPresetId: string,
};

export type ModelTestResultConditionInput = {
  and?: Array< ModelTestResultConditionInput | null > | null,
  annotationSetId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  locationId?: ModelIDInput | null,
  not?: ModelTestResultConditionInput | null,
  or?: Array< ModelTestResultConditionInput | null > | null,
  passedOnTotal?: ModelBooleanInput | null,
  projectId?: ModelIDInput | null,
  testAnimals?: ModelIntInput | null,
  testPresetId?: ModelIDInput | null,
  totalMissedAnimals?: ModelIntInput | null,
  updatedAt?: ModelStringInput | null,
  userId?: ModelIDInput | null,
};

export type CreateTestResultInput = {
  annotationSetId: string,
  id?: string | null,
  locationId: string,
  passedOnTotal: boolean,
  projectId: string,
  testAnimals: number,
  testPresetId: string,
  totalMissedAnimals: number,
  userId: string,
};

export type ModelTestResultCategoryCountConditionInput = {
  and?: Array< ModelTestResultCategoryCountConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  not?: ModelTestResultCategoryCountConditionInput | null,
  or?: Array< ModelTestResultCategoryCountConditionInput | null > | null,
  testCount?: ModelIntInput | null,
  updatedAt?: ModelStringInput | null,
  userCount?: ModelIntInput | null,
};

export type CreateTestResultCategoryCountInput = {
  categoryName: string,
  testCount: number,
  testResultId: string,
  userCount: number,
};

export type ModelTransectConditionInput = {
  and?: Array< ModelTransectConditionInput | null > | null,
  createdAt?: ModelStringInput | null,
  not?: ModelTransectConditionInput | null,
  or?: Array< ModelTransectConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  stratumId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
};

export type CreateTransectInput = {
  id?: string | null,
  projectId: string,
  stratumId: string,
};

export type ModelUserProjectMembershipConditionInput = {
  and?: Array< ModelUserProjectMembershipConditionInput | null > | null,
  backupQueueId?: ModelIDInput | null,
  createdAt?: ModelStringInput | null,
  isAdmin?: ModelBooleanInput | null,
  not?: ModelUserProjectMembershipConditionInput | null,
  or?: Array< ModelUserProjectMembershipConditionInput | null > | null,
  projectId?: ModelIDInput | null,
  queueId?: ModelIDInput | null,
  updatedAt?: ModelStringInput | null,
  userId?: ModelStringInput | null,
};

export type CreateUserProjectMembershipInput = {
  backupQueueId?: string | null,
  id?: string | null,
  isAdmin?: boolean | null,
  projectId: string,
  queueId?: string | null,
  userId: string,
};

export type ModelUserStatsConditionInput = {
  activeTime?: ModelFloatInput | null,
  and?: Array< ModelUserStatsConditionInput | null > | null,
  annotationCount?: ModelIntInput | null,
  annotationTime?: ModelFloatInput | null,
  createdAt?: ModelStringInput | null,
  not?: ModelUserStatsConditionInput | null,
  observationCount?: ModelIntInput | null,
  or?: Array< ModelUserStatsConditionInput | null > | null,
  searchCount?: ModelIntInput | null,
  searchTime?: ModelFloatInput | null,
  sightingCount?: ModelIntInput | null,
  updatedAt?: ModelStringInput | null,
  waitingTime?: ModelFloatInput | null,
};

export type CreateUserStatsInput = {
  activeTime: number,
  annotationCount: number,
  annotationTime?: number | null,
  date: string,
  observationCount: number,
  projectId: string,
  searchCount?: number | null,
  searchTime?: number | null,
  setId: string,
  sightingCount?: number | null,
  userId: string,
  waitingTime?: number | null,
};

export type DeleteAnnotationInput = {
  id: string,
};

export type DeleteAnnotationSetInput = {
  id: string,
};

export type DeleteCameraInput = {
  id: string,
};

export type DeleteCameraOverlapInput = {
  cameraAId: string,
  cameraBId: string,
};

export type DeleteCategoryInput = {
  id: string,
};

export type DeleteClientLogInput = {
  id: string,
};

export type DeleteImageInput = {
  id: string,
};

export type DeleteImageFileInput = {
  id: string,
};

export type DeleteImageNeighbourInput = {
  image1Id: string,
  image2Id: string,
};

export type DeleteImageSetInput = {
  id: string,
};

export type DeleteImageSetMembershipInput = {
  id: string,
};

export type DeleteJollyResultInput = {
  annotationSetId: string,
  categoryId: string,
  stratumId: string,
  surveyId: string,
};

export type DeleteJollyResultsMembershipInput = {
  annotationSetId: string,
  surveyId: string,
  userId: string,
};

export type DeleteLocationInput = {
  id: string,
};

export type DeleteLocationAnnotationCountInput = {
  annotationSetId: string,
  categoryId: string,
  locationId: string,
};

export type DeleteLocationSetInput = {
  id: string,
};

export type DeleteLocationSetMembershipInput = {
  id: string,
};

export type DeleteObjectInput = {
  id: string,
};

export type DeleteObservationInput = {
  id: string,
};

export type DeleteOrganizationInput = {
  id: string,
};

export type DeleteOrganizationInviteInput = {
  id: string,
};

export type DeleteOrganizationMembershipInput = {
  organizationId: string,
  userId: string,
};

export type DeleteOrganizationRegistrationInput = {
  id: string,
};

export type DeleteProjectInput = {
  id: string,
};

export type DeleteProjectTestConfigInput = {
  projectId: string,
};

export type DeleteQueueInput = {
  id: string,
};

export type DeleteResultSharingTokenInput = {
  annotationSetId: string,
  surveyId: string,
};

export type DeleteShapefileInput = {
  id: string,
};

export type DeleteShapefileExclusionsInput = {
  id: string,
};

export type DeleteStratumInput = {
  id: string,
};

export type DeleteTasksOnAnnotationSetInput = {
  id: string,
};

export type DeleteTestPresetInput = {
  id: string,
};

export type DeleteTestPresetLocationInput = {
  annotationSetId: string,
  locationId: string,
  testPresetId: string,
};

export type DeleteTestPresetProjectInput = {
  projectId: string,
  testPresetId: string,
};

export type DeleteTestResultInput = {
  id: string,
};

export type DeleteTestResultCategoryCountInput = {
  categoryName: string,
  testResultId: string,
};

export type DeleteTransectInput = {
  id: string,
};

export type DeleteUserProjectMembershipInput = {
  id: string,
};

export type DeleteUserStatsInput = {
  date: string,
  projectId: string,
  setId: string,
  userId: string,
};

export type Message = {
  __typename: "Message",
  channelName: string,
  content: string,
};

export type UpdateAnnotationInput = {
  categoryId?: string | null,
  id: string,
  imageId?: string | null,
  objectId?: string | null,
  obscured?: boolean | null,
  projectId?: string | null,
  setId?: string | null,
  source?: string | null,
  x?: number | null,
  y?: number | null,
};

export type UpdateAnnotationSetInput = {
  id: string,
  name?: string | null,
  projectId?: string | null,
  register?: boolean | null,
};

export type UpdateCameraInput = {
  focalLengthMm?: number | null,
  id: string,
  name?: string | null,
  projectId?: string | null,
  sensorWidthMm?: number | null,
  tiltDegrees?: number | null,
};

export type UpdateCameraOverlapInput = {
  cameraAId: string,
  cameraBId: string,
  projectId?: string | null,
};

export type UpdateCategoryInput = {
  annotationCount?: number | null,
  annotationSetId?: string | null,
  color?: string | null,
  id: string,
  name?: string | null,
  projectId?: string | null,
  shortcutKey?: string | null,
};

export type UpdateClientLogInput = {
  connectionType?: string | null,
  deviceType?: string | null,
  downlink?: number | null,
  id: string,
  ipAddress?: string | null,
  os?: string | null,
  rtt?: number | null,
  userAgent?: string | null,
  userId?: string | null,
};

export type UpdateImageInput = {
  altitude_agl?: number | null,
  altitude_egm96?: number | null,
  altitude_wgs84?: number | null,
  cameraId?: string | null,
  cameraSerial?: string | null,
  exifData?: string | null,
  height?: number | null,
  id: string,
  latitude?: number | null,
  longitude?: number | null,
  originalPath?: string | null,
  pitch?: number | null,
  projectId?: string | null,
  roll?: number | null,
  timestamp?: number | null,
  transectId?: string | null,
  width?: number | null,
  yaw?: number | null,
};

export type UpdateImageFileInput = {
  id: string,
  imageId?: string | null,
  key?: string | null,
  path?: string | null,
  projectId?: string | null,
  type?: string | null,
};

export type UpdateImageNeighbourInput = {
  homography?: Array< number | null > | null,
  image1Id: string,
  image2Id: string,
};

export type UpdateImageSetInput = {
  id: string,
  imageCount?: number | null,
  name?: string | null,
  projectId?: string | null,
};

export type UpdateImageSetMembershipInput = {
  id: string,
  imageId?: string | null,
  imageSetId?: string | null,
};

export type UpdateJollyResultInput = {
  animals?: number | null,
  annotationSetId: string,
  areaSurveyed?: number | null,
  categoryId: string,
  density?: number | null,
  estimate?: number | null,
  lowerBound95?: number | null,
  numSamples?: number | null,
  standardError?: number | null,
  stratumId: string,
  surveyId: string,
  upperBound95?: number | null,
  variance?: number | null,
};

export type UpdateJollyResultsMembershipInput = {
  annotationSetId: string,
  surveyId: string,
  userId: string,
};

export type UpdateLocationInput = {
  confidence?: number | null,
  height?: number | null,
  id: string,
  imageId?: string | null,
  projectId?: string | null,
  setId?: string | null,
  source?: string | null,
  width?: number | null,
  x?: number | null,
  y?: number | null,
};

export type UpdateLocationAnnotationCountInput = {
  annotationSetId: string,
  categoryId: string,
  count?: number | null,
  locationId: string,
};

export type UpdateLocationSetInput = {
  description?: string | null,
  id: string,
  locationCount?: number | null,
  name?: string | null,
  projectId?: string | null,
};

export type UpdateLocationSetMembershipInput = {
  id: string,
  locationId?: string | null,
  locationSetId?: string | null,
};

export type UpdateObjectInput = {
  categoryId?: string | null,
  id: string,
  projectId?: string | null,
};

export type UpdateObservationInput = {
  annotationCount?: number | null,
  annotationSetId?: string | null,
  createdAt?: string | null,
  id: string,
  loadingTime?: number | null,
  locationId?: string | null,
  owner?: string | null,
  projectId?: string | null,
  timeTaken?: number | null,
  waitingTime?: number | null,
};

export type UpdateOrganizationInput = {
  description?: string | null,
  id: string,
  name?: string | null,
};

export type UpdateOrganizationInviteInput = {
  id: string,
  invitedBy?: string | null,
  organizationId?: string | null,
  status?: string | null,
  username?: string | null,
};

export type UpdateOrganizationMembershipInput = {
  isAdmin?: boolean | null,
  isTested?: boolean | null,
  organizationId: string,
  userId: string,
};

export type UpdateOrganizationRegistrationInput = {
  briefDescription?: string | null,
  id: string,
  organizationName?: string | null,
  requestedBy?: string | null,
  status?: string | null,
};

export type UpdateProjectInput = {
  createdBy?: string | null,
  hidden?: boolean | null,
  id: string,
  name?: string | null,
  organizationId?: string | null,
  status?: string | null,
  tags?: Array< string | null > | null,
};

export type UpdateProjectTestConfigInput = {
  accuracy?: number | null,
  deadzone?: number | null,
  interval?: number | null,
  postTestConfirmation?: boolean | null,
  projectId: string,
  random?: number | null,
  testType?: string | null,
};

export type UpdateQueueInput = {
  approximateSize?: number | null,
  batchSize?: number | null,
  hidden?: boolean | null,
  id: string,
  name?: string | null,
  projectId?: string | null,
  tag?: string | null,
  totalBatches?: number | null,
  url?: string | null,
  zoom?: number | null,
};

export type UpdateResultSharingTokenInput = {
  annotationSetId: string,
  jwt?: string | null,
  surveyId: string,
};

export type UpdateShapefileInput = {
  coordinates?: Array< number | null > | null,
  id: string,
  projectId?: string | null,
};

export type UpdateShapefileExclusionsInput = {
  coordinates?: Array< number | null > | null,
  id: string,
  projectId?: string | null,
};

export type UpdateStratumInput = {
  area?: number | null,
  baselineLength?: number | null,
  coordinates?: Array< number | null > | null,
  id: string,
  name?: string | null,
  projectId?: string | null,
};

export type UpdateTasksOnAnnotationSetInput = {
  annotationSetId?: string | null,
  id: string,
  locationSetId?: string | null,
};

export type UpdateTestPresetInput = {
  id: string,
  name?: string | null,
  organizationId?: string | null,
};

export type UpdateTestPresetLocationInput = {
  annotationSetId: string,
  locationId: string,
  testPresetId: string,
};

export type UpdateTestPresetProjectInput = {
  projectId: string,
  testPresetId: string,
};

export type UpdateTestResultInput = {
  annotationSetId?: string | null,
  id: string,
  locationId?: string | null,
  passedOnTotal?: boolean | null,
  projectId?: string | null,
  testAnimals?: number | null,
  testPresetId?: string | null,
  totalMissedAnimals?: number | null,
  userId?: string | null,
};

export type UpdateTestResultCategoryCountInput = {
  categoryName: string,
  testCount?: number | null,
  testResultId: string,
  userCount?: number | null,
};

export type UpdateTransectInput = {
  id: string,
  projectId?: string | null,
  stratumId?: string | null,
};

export type UpdateUserProjectMembershipInput = {
  backupQueueId?: string | null,
  id: string,
  isAdmin?: boolean | null,
  projectId?: string | null,
  queueId?: string | null,
  userId?: string | null,
};

export type UpdateUserStatsInput = {
  activeTime?: number | null,
  annotationCount?: number | null,
  annotationTime?: number | null,
  date: string,
  observationCount?: number | null,
  projectId: string,
  searchCount?: number | null,
  searchTime?: number | null,
  setId: string,
  sightingCount?: number | null,
  userId: string,
  waitingTime?: number | null,
};

export type ModelSubscriptionAnnotationFilterInput = {
  and?: Array< ModelSubscriptionAnnotationFilterInput | null > | null,
  categoryId?: ModelSubscriptionIDInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  imageId?: ModelSubscriptionIDInput | null,
  objectId?: ModelSubscriptionIDInput | null,
  obscured?: ModelSubscriptionBooleanInput | null,
  or?: Array< ModelSubscriptionAnnotationFilterInput | null > | null,
  owner?: ModelStringInput | null,
  projectId?: ModelSubscriptionIDInput | null,
  setId?: ModelSubscriptionIDInput | null,
  source?: ModelSubscriptionStringInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  x?: ModelSubscriptionIntInput | null,
  y?: ModelSubscriptionIntInput | null,
};

export type ModelSubscriptionIDInput = {
  beginsWith?: string | null,
  between?: Array< string | null > | null,
  contains?: string | null,
  eq?: string | null,
  ge?: string | null,
  gt?: string | null,
  in?: Array< string | null > | null,
  le?: string | null,
  lt?: string | null,
  ne?: string | null,
  notContains?: string | null,
  notIn?: Array< string | null > | null,
};

export type ModelSubscriptionStringInput = {
  beginsWith?: string | null,
  between?: Array< string | null > | null,
  contains?: string | null,
  eq?: string | null,
  ge?: string | null,
  gt?: string | null,
  in?: Array< string | null > | null,
  le?: string | null,
  lt?: string | null,
  ne?: string | null,
  notContains?: string | null,
  notIn?: Array< string | null > | null,
};

export type ModelSubscriptionBooleanInput = {
  eq?: boolean | null,
  ne?: boolean | null,
};

export type ModelSubscriptionIntInput = {
  between?: Array< number | null > | null,
  eq?: number | null,
  ge?: number | null,
  gt?: number | null,
  in?: Array< number | null > | null,
  le?: number | null,
  lt?: number | null,
  ne?: number | null,
  notIn?: Array< number | null > | null,
};

export type ModelSubscriptionAnnotationSetFilterInput = {
  and?: Array< ModelSubscriptionAnnotationSetFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  name?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionAnnotationSetFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  register?: ModelSubscriptionBooleanInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionCameraFilterInput = {
  and?: Array< ModelSubscriptionCameraFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  focalLengthMm?: ModelSubscriptionFloatInput | null,
  id?: ModelSubscriptionIDInput | null,
  name?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionCameraFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  sensorWidthMm?: ModelSubscriptionFloatInput | null,
  tiltDegrees?: ModelSubscriptionFloatInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionFloatInput = {
  between?: Array< number | null > | null,
  eq?: number | null,
  ge?: number | null,
  gt?: number | null,
  in?: Array< number | null > | null,
  le?: number | null,
  lt?: number | null,
  ne?: number | null,
  notIn?: Array< number | null > | null,
};

export type ModelSubscriptionCameraOverlapFilterInput = {
  and?: Array< ModelSubscriptionCameraOverlapFilterInput | null > | null,
  cameraAId?: ModelSubscriptionIDInput | null,
  cameraBId?: ModelSubscriptionIDInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionCameraOverlapFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionCategoryFilterInput = {
  and?: Array< ModelSubscriptionCategoryFilterInput | null > | null,
  annotationCount?: ModelSubscriptionIntInput | null,
  annotationSetId?: ModelSubscriptionIDInput | null,
  color?: ModelSubscriptionStringInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  name?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionCategoryFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  shortcutKey?: ModelSubscriptionStringInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionClientLogFilterInput = {
  and?: Array< ModelSubscriptionClientLogFilterInput | null > | null,
  connectionType?: ModelSubscriptionStringInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  deviceType?: ModelSubscriptionStringInput | null,
  downlink?: ModelSubscriptionFloatInput | null,
  id?: ModelSubscriptionIDInput | null,
  ipAddress?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionClientLogFilterInput | null > | null,
  os?: ModelSubscriptionStringInput | null,
  rtt?: ModelSubscriptionFloatInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  userAgent?: ModelSubscriptionStringInput | null,
  userId?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionImageFilterInput = {
  altitude_agl?: ModelSubscriptionFloatInput | null,
  altitude_egm96?: ModelSubscriptionFloatInput | null,
  altitude_wgs84?: ModelSubscriptionFloatInput | null,
  and?: Array< ModelSubscriptionImageFilterInput | null > | null,
  cameraId?: ModelSubscriptionIDInput | null,
  cameraSerial?: ModelSubscriptionStringInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  exifData?: ModelSubscriptionStringInput | null,
  height?: ModelSubscriptionIntInput | null,
  id?: ModelSubscriptionIDInput | null,
  latitude?: ModelSubscriptionFloatInput | null,
  longitude?: ModelSubscriptionFloatInput | null,
  or?: Array< ModelSubscriptionImageFilterInput | null > | null,
  originalPath?: ModelSubscriptionStringInput | null,
  pitch?: ModelSubscriptionFloatInput | null,
  projectId?: ModelSubscriptionIDInput | null,
  roll?: ModelSubscriptionFloatInput | null,
  timestamp?: ModelSubscriptionIntInput | null,
  transectId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  width?: ModelSubscriptionIntInput | null,
  yaw?: ModelSubscriptionFloatInput | null,
};

export type ModelSubscriptionImageFileFilterInput = {
  and?: Array< ModelSubscriptionImageFileFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  imageId?: ModelSubscriptionIDInput | null,
  key?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionImageFileFilterInput | null > | null,
  path?: ModelSubscriptionStringInput | null,
  projectId?: ModelSubscriptionIDInput | null,
  type?: ModelSubscriptionStringInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionImageNeighbourFilterInput = {
  and?: Array< ModelSubscriptionImageNeighbourFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  homography?: ModelSubscriptionFloatInput | null,
  id?: ModelSubscriptionIDInput | null,
  image1Id?: ModelSubscriptionIDInput | null,
  image2Id?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionImageNeighbourFilterInput | null > | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionImageSetFilterInput = {
  and?: Array< ModelSubscriptionImageSetFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  imageCount?: ModelSubscriptionIntInput | null,
  name?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionImageSetFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionImageSetMembershipFilterInput = {
  and?: Array< ModelSubscriptionImageSetMembershipFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  imageId?: ModelSubscriptionIDInput | null,
  imageSetId?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionImageSetMembershipFilterInput | null > | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionJollyResultFilterInput = {
  and?: Array< ModelSubscriptionJollyResultFilterInput | null > | null,
  animals?: ModelSubscriptionIntInput | null,
  annotationSetId?: ModelSubscriptionIDInput | null,
  areaSurveyed?: ModelSubscriptionFloatInput | null,
  categoryId?: ModelSubscriptionIDInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  density?: ModelSubscriptionFloatInput | null,
  estimate?: ModelSubscriptionFloatInput | null,
  id?: ModelSubscriptionIDInput | null,
  lowerBound95?: ModelSubscriptionFloatInput | null,
  numSamples?: ModelSubscriptionIntInput | null,
  or?: Array< ModelSubscriptionJollyResultFilterInput | null > | null,
  standardError?: ModelSubscriptionFloatInput | null,
  stratumId?: ModelSubscriptionIDInput | null,
  surveyId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  upperBound95?: ModelSubscriptionFloatInput | null,
  variance?: ModelSubscriptionFloatInput | null,
};

export type ModelSubscriptionJollyResultsMembershipFilterInput = {
  and?: Array< ModelSubscriptionJollyResultsMembershipFilterInput | null > | null,
  annotationSetId?: ModelSubscriptionIDInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionJollyResultsMembershipFilterInput | null > | null,
  surveyId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  userId?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionLocationFilterInput = {
  and?: Array< ModelSubscriptionLocationFilterInput | null > | null,
  confidence?: ModelSubscriptionFloatInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  height?: ModelSubscriptionIntInput | null,
  id?: ModelSubscriptionIDInput | null,
  imageId?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionLocationFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  setId?: ModelSubscriptionIDInput | null,
  source?: ModelSubscriptionStringInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  width?: ModelSubscriptionIntInput | null,
  x?: ModelSubscriptionIntInput | null,
  y?: ModelSubscriptionIntInput | null,
};

export type ModelSubscriptionLocationAnnotationCountFilterInput = {
  and?: Array< ModelSubscriptionLocationAnnotationCountFilterInput | null > | null,
  annotationSetId?: ModelSubscriptionIDInput | null,
  categoryId?: ModelSubscriptionIDInput | null,
  count?: ModelSubscriptionIntInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  locationId?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionLocationAnnotationCountFilterInput | null > | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionLocationSetFilterInput = {
  and?: Array< ModelSubscriptionLocationSetFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  description?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  locationCount?: ModelSubscriptionIntInput | null,
  name?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionLocationSetFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionLocationSetMembershipFilterInput = {
  and?: Array< ModelSubscriptionLocationSetMembershipFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  locationId?: ModelSubscriptionIDInput | null,
  locationSetId?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionLocationSetMembershipFilterInput | null > | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionObjectFilterInput = {
  and?: Array< ModelSubscriptionObjectFilterInput | null > | null,
  categoryId?: ModelSubscriptionIDInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionObjectFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionObservationFilterInput = {
  and?: Array< ModelSubscriptionObservationFilterInput | null > | null,
  annotationCount?: ModelSubscriptionIntInput | null,
  annotationSetId?: ModelSubscriptionIDInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  loadingTime?: ModelSubscriptionFloatInput | null,
  locationId?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionObservationFilterInput | null > | null,
  owner?: ModelStringInput | null,
  projectId?: ModelSubscriptionIDInput | null,
  timeTaken?: ModelSubscriptionFloatInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  waitingTime?: ModelSubscriptionFloatInput | null,
};

export type ModelSubscriptionOrganizationFilterInput = {
  and?: Array< ModelSubscriptionOrganizationFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  description?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  name?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionOrganizationFilterInput | null > | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionOrganizationInviteFilterInput = {
  and?: Array< ModelSubscriptionOrganizationInviteFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  invitedBy?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionOrganizationInviteFilterInput | null > | null,
  organizationId?: ModelSubscriptionIDInput | null,
  status?: ModelSubscriptionStringInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  username?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionOrganizationMembershipFilterInput = {
  and?: Array< ModelSubscriptionOrganizationMembershipFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  isAdmin?: ModelSubscriptionBooleanInput | null,
  isTested?: ModelSubscriptionBooleanInput | null,
  or?: Array< ModelSubscriptionOrganizationMembershipFilterInput | null > | null,
  organizationId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  userId?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionOrganizationRegistrationFilterInput = {
  and?: Array< ModelSubscriptionOrganizationRegistrationFilterInput | null > | null,
  briefDescription?: ModelSubscriptionStringInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionOrganizationRegistrationFilterInput | null > | null,
  organizationName?: ModelSubscriptionStringInput | null,
  requestedBy?: ModelSubscriptionStringInput | null,
  status?: ModelSubscriptionStringInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionProjectFilterInput = {
  and?: Array< ModelSubscriptionProjectFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  createdBy?: ModelSubscriptionStringInput | null,
  hidden?: ModelSubscriptionBooleanInput | null,
  id?: ModelSubscriptionIDInput | null,
  name?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionProjectFilterInput | null > | null,
  organizationId?: ModelSubscriptionIDInput | null,
  status?: ModelSubscriptionStringInput | null,
  tags?: ModelSubscriptionStringInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionProjectTestConfigFilterInput = {
  accuracy?: ModelSubscriptionIntInput | null,
  and?: Array< ModelSubscriptionProjectTestConfigFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  deadzone?: ModelSubscriptionFloatInput | null,
  id?: ModelSubscriptionIDInput | null,
  interval?: ModelSubscriptionFloatInput | null,
  or?: Array< ModelSubscriptionProjectTestConfigFilterInput | null > | null,
  postTestConfirmation?: ModelSubscriptionBooleanInput | null,
  projectId?: ModelSubscriptionIDInput | null,
  random?: ModelSubscriptionFloatInput | null,
  testType?: ModelSubscriptionStringInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionQueueFilterInput = {
  and?: Array< ModelSubscriptionQueueFilterInput | null > | null,
  approximateSize?: ModelSubscriptionIntInput | null,
  batchSize?: ModelSubscriptionIntInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  hidden?: ModelSubscriptionBooleanInput | null,
  id?: ModelSubscriptionIDInput | null,
  name?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionQueueFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  tag?: ModelSubscriptionStringInput | null,
  totalBatches?: ModelSubscriptionIntInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  url?: ModelSubscriptionStringInput | null,
  zoom?: ModelSubscriptionIntInput | null,
};

export type ModelSubscriptionResultSharingTokenFilterInput = {
  and?: Array< ModelSubscriptionResultSharingTokenFilterInput | null > | null,
  annotationSetId?: ModelSubscriptionIDInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  jwt?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionResultSharingTokenFilterInput | null > | null,
  surveyId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionShapefileFilterInput = {
  and?: Array< ModelSubscriptionShapefileFilterInput | null > | null,
  coordinates?: ModelSubscriptionFloatInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionShapefileFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionShapefileExclusionsFilterInput = {
  and?: Array< ModelSubscriptionShapefileExclusionsFilterInput | null > | null,
  coordinates?: ModelSubscriptionFloatInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionShapefileExclusionsFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionStratumFilterInput = {
  and?: Array< ModelSubscriptionStratumFilterInput | null > | null,
  area?: ModelSubscriptionFloatInput | null,
  baselineLength?: ModelSubscriptionFloatInput | null,
  coordinates?: ModelSubscriptionFloatInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  name?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionStratumFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionTasksOnAnnotationSetFilterInput = {
  and?: Array< ModelSubscriptionTasksOnAnnotationSetFilterInput | null > | null,
  annotationSetId?: ModelSubscriptionIDInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  locationSetId?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionTasksOnAnnotationSetFilterInput | null > | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionTestPresetFilterInput = {
  and?: Array< ModelSubscriptionTestPresetFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  name?: ModelSubscriptionStringInput | null,
  or?: Array< ModelSubscriptionTestPresetFilterInput | null > | null,
  organizationId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionTestPresetLocationFilterInput = {
  and?: Array< ModelSubscriptionTestPresetLocationFilterInput | null > | null,
  annotationSetId?: ModelSubscriptionIDInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  locationId?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionTestPresetLocationFilterInput | null > | null,
  testPresetId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionTestPresetProjectFilterInput = {
  and?: Array< ModelSubscriptionTestPresetProjectFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionTestPresetProjectFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  testPresetId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionTestResultFilterInput = {
  and?: Array< ModelSubscriptionTestResultFilterInput | null > | null,
  annotationSetId?: ModelSubscriptionIDInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  locationId?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionTestResultFilterInput | null > | null,
  passedOnTotal?: ModelSubscriptionBooleanInput | null,
  projectId?: ModelSubscriptionIDInput | null,
  testAnimals?: ModelSubscriptionIntInput | null,
  testPresetId?: ModelSubscriptionIDInput | null,
  totalMissedAnimals?: ModelSubscriptionIntInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  userId?: ModelSubscriptionIDInput | null,
};

export type ModelSubscriptionTestResultCategoryCountFilterInput = {
  and?: Array< ModelSubscriptionTestResultCategoryCountFilterInput | null > | null,
  categoryName?: ModelSubscriptionStringInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionTestResultCategoryCountFilterInput | null > | null,
  testCount?: ModelSubscriptionIntInput | null,
  testResultId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  userCount?: ModelSubscriptionIntInput | null,
};

export type ModelSubscriptionTransectFilterInput = {
  and?: Array< ModelSubscriptionTransectFilterInput | null > | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  or?: Array< ModelSubscriptionTransectFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  stratumId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionUserProjectMembershipFilterInput = {
  and?: Array< ModelSubscriptionUserProjectMembershipFilterInput | null > | null,
  backupQueueId?: ModelSubscriptionIDInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  isAdmin?: ModelSubscriptionBooleanInput | null,
  or?: Array< ModelSubscriptionUserProjectMembershipFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  queueId?: ModelSubscriptionIDInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  userId?: ModelSubscriptionStringInput | null,
};

export type ModelSubscriptionUserStatsFilterInput = {
  activeTime?: ModelSubscriptionFloatInput | null,
  and?: Array< ModelSubscriptionUserStatsFilterInput | null > | null,
  annotationCount?: ModelSubscriptionIntInput | null,
  annotationTime?: ModelSubscriptionFloatInput | null,
  createdAt?: ModelSubscriptionStringInput | null,
  date?: ModelSubscriptionStringInput | null,
  id?: ModelSubscriptionIDInput | null,
  observationCount?: ModelSubscriptionIntInput | null,
  or?: Array< ModelSubscriptionUserStatsFilterInput | null > | null,
  projectId?: ModelSubscriptionIDInput | null,
  searchCount?: ModelSubscriptionIntInput | null,
  searchTime?: ModelSubscriptionFloatInput | null,
  setId?: ModelSubscriptionIDInput | null,
  sightingCount?: ModelSubscriptionIntInput | null,
  updatedAt?: ModelSubscriptionStringInput | null,
  userId?: ModelSubscriptionIDInput | null,
  waitingTime?: ModelSubscriptionFloatInput | null,
};

export type AnnotationSetsByProjectIdQueryVariables = {
  filter?: ModelAnnotationSetFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type AnnotationSetsByProjectIdQuery = {
  annotationSetsByProjectId?:  {
    __typename: "ModelAnnotationSetConnection",
    items:  Array< {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type AnnotationsByAnnotationSetIdQueryVariables = {
  filter?: ModelAnnotationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  setId: string,
  sortDirection?: ModelSortDirection | null,
};

export type AnnotationsByAnnotationSetIdQuery = {
  annotationsByAnnotationSetId?:  {
    __typename: "ModelAnnotationConnection",
    items:  Array< {
      __typename: "Annotation",
      categoryId: string,
      createdAt: string,
      id: string,
      imageId: string,
      objectId?: string | null,
      obscured?: boolean | null,
      owner?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      x: number,
      y: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type AnnotationsByCategoryIdQueryVariables = {
  categoryId: string,
  filter?: ModelAnnotationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type AnnotationsByCategoryIdQuery = {
  annotationsByCategoryId?:  {
    __typename: "ModelAnnotationConnection",
    items:  Array< {
      __typename: "Annotation",
      categoryId: string,
      createdAt: string,
      id: string,
      imageId: string,
      objectId?: string | null,
      obscured?: boolean | null,
      owner?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      x: number,
      y: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type AnnotationsByImageIdAndSetIdQueryVariables = {
  filter?: ModelAnnotationFilterInput | null,
  imageId: string,
  limit?: number | null,
  nextToken?: string | null,
  setId?: ModelIDKeyConditionInput | null,
  sortDirection?: ModelSortDirection | null,
};

export type AnnotationsByImageIdAndSetIdQuery = {
  annotationsByImageIdAndSetId?:  {
    __typename: "ModelAnnotationConnection",
    items:  Array< {
      __typename: "Annotation",
      categoryId: string,
      createdAt: string,
      id: string,
      imageId: string,
      objectId?: string | null,
      obscured?: boolean | null,
      owner?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      x: number,
      y: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type AnnotationsByObjectIdQueryVariables = {
  filter?: ModelAnnotationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  objectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type AnnotationsByObjectIdQuery = {
  annotationsByObjectId?:  {
    __typename: "ModelAnnotationConnection",
    items:  Array< {
      __typename: "Annotation",
      categoryId: string,
      createdAt: string,
      id: string,
      imageId: string,
      objectId?: string | null,
      obscured?: boolean | null,
      owner?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      x: number,
      y: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type CameraOverlapsByProjectIdQueryVariables = {
  filter?: ModelCameraOverlapFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type CameraOverlapsByProjectIdQuery = {
  cameraOverlapsByProjectId?:  {
    __typename: "ModelCameraOverlapConnection",
    items:  Array< {
      __typename: "CameraOverlap",
      cameraAId: string,
      cameraBId: string,
      createdAt: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type CamerasByProjectIdQueryVariables = {
  filter?: ModelCameraFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type CamerasByProjectIdQuery = {
  camerasByProjectId?:  {
    __typename: "ModelCameraConnection",
    items:  Array< {
      __typename: "Camera",
      createdAt: string,
      focalLengthMm?: number | null,
      id: string,
      name: string,
      projectId: string,
      sensorWidthMm?: number | null,
      tiltDegrees?: number | null,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type CategoriesByAnnotationSetIdQueryVariables = {
  annotationSetId: string,
  filter?: ModelCategoryFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type CategoriesByAnnotationSetIdQuery = {
  categoriesByAnnotationSetId?:  {
    __typename: "ModelCategoryConnection",
    items:  Array< {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type CategoriesByProjectIdQueryVariables = {
  filter?: ModelCategoryFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type CategoriesByProjectIdQuery = {
  categoriesByProjectId?:  {
    __typename: "ModelCategoryConnection",
    items:  Array< {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type CategoryCountsByLocationIdAndAnnotationSetIdQueryVariables = {
  annotationSetId?: ModelIDKeyConditionInput | null,
  filter?: ModelLocationAnnotationCountFilterInput | null,
  limit?: number | null,
  locationId: string,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type CategoryCountsByLocationIdAndAnnotationSetIdQuery = {
  categoryCountsByLocationIdAndAnnotationSetId?:  {
    __typename: "ModelLocationAnnotationCountConnection",
    items:  Array< {
      __typename: "LocationAnnotationCount",
      annotationSetId: string,
      categoryId: string,
      count?: number | null,
      createdAt: string,
      locationId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type CategoryCountsByTestResultIdQueryVariables = {
  filter?: ModelTestResultCategoryCountFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  testResultId: string,
};

export type CategoryCountsByTestResultIdQuery = {
  categoryCountsByTestResultId?:  {
    __typename: "ModelTestResultCategoryCountConnection",
    items:  Array< {
      __typename: "TestResultCategoryCount",
      categoryName: string,
      createdAt: string,
      testCount: number,
      testResultId: string,
      updatedAt: string,
      userCount: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ClientLogsByUserIdQueryVariables = {
  filter?: ModelClientLogFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  userId: string,
};

export type ClientLogsByUserIdQuery = {
  clientLogsByUserId?:  {
    __typename: "ModelClientLogConnection",
    items:  Array< {
      __typename: "ClientLog",
      connectionType?: string | null,
      createdAt: string,
      deviceType?: string | null,
      downlink?: number | null,
      id: string,
      ipAddress?: string | null,
      os?: string | null,
      rtt?: number | null,
      updatedAt: string,
      userAgent?: string | null,
      userId: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type GetAnnotationQueryVariables = {
  id: string,
};

export type GetAnnotationQuery = {
  getAnnotation?:  {
    __typename: "Annotation",
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    object?:  {
      __typename: "Object",
      categoryId: string,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    objectId?: string | null,
    obscured?: boolean | null,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    setId: string,
    source: string,
    updatedAt: string,
    x: number,
    y: number,
  } | null,
};

export type GetAnnotationSetQueryVariables = {
  id: string,
};

export type GetAnnotationSetQuery = {
  getAnnotationSet?:  {
    __typename: "AnnotationSet",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    categories?:  {
      __typename: "ModelCategoryConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    register?: boolean | null,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    testPresetLocations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type GetCameraQueryVariables = {
  id: string,
};

export type GetCameraQuery = {
  getCamera?:  {
    __typename: "Camera",
    createdAt: string,
    focalLengthMm?: number | null,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    sensorWidthMm?: number | null,
    tiltDegrees?: number | null,
    updatedAt: string,
  } | null,
};

export type GetCameraOverlapQueryVariables = {
  cameraAId: string,
  cameraBId: string,
};

export type GetCameraOverlapQuery = {
  getCameraOverlap?:  {
    __typename: "CameraOverlap",
    cameraAId: string,
    cameraBId: string,
    createdAt: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type GetCategoryQueryVariables = {
  id: string,
};

export type GetCategoryQuery = {
  getCategory?:  {
    __typename: "Category",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    color?: string | null,
    createdAt: string,
    id: string,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    projectId: string,
    shortcutKey?: string | null,
    updatedAt: string,
  } | null,
};

export type GetClientLogQueryVariables = {
  id: string,
};

export type GetClientLogQuery = {
  getClientLog?:  {
    __typename: "ClientLog",
    connectionType?: string | null,
    createdAt: string,
    deviceType?: string | null,
    downlink?: number | null,
    id: string,
    ipAddress?: string | null,
    os?: string | null,
    rtt?: number | null,
    updatedAt: string,
    userAgent?: string | null,
    userId: string,
  } | null,
};

export type GetImageQueryVariables = {
  id: string,
};

export type GetImageQuery = {
  getImage?:  {
    __typename: "Image",
    altitude_agl?: number | null,
    altitude_egm96?: number | null,
    altitude_wgs84?: number | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    camera?:  {
      __typename: "Camera",
      createdAt: string,
      focalLengthMm?: number | null,
      id: string,
      name: string,
      projectId: string,
      sensorWidthMm?: number | null,
      tiltDegrees?: number | null,
      updatedAt: string,
    } | null,
    cameraId?: string | null,
    cameraSerial?: string | null,
    createdAt: string,
    exifData?: string | null,
    files?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    height: number,
    id: string,
    latitude?: number | null,
    leftNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    longitude?: number | null,
    memberships?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    originalPath?: string | null,
    pitch?: number | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    rightNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    roll?: number | null,
    timestamp?: number | null,
    transect?:  {
      __typename: "Transect",
      createdAt: string,
      id: string,
      projectId: string,
      stratumId: string,
      updatedAt: string,
    } | null,
    transectId?: string | null,
    updatedAt: string,
    width: number,
    yaw?: number | null,
  } | null,
};

export type GetImageCountsQueryVariables = {
  imageSetId: string,
  nextToken?: string | null,
};

export type GetImageCountsQuery = {
  getImageCounts?:  {
    __typename: "GetImageCountsReturnType",
    count?: number | null,
    nextToken?: string | null,
  } | null,
};

export type GetImageFileQueryVariables = {
  id: string,
};

export type GetImageFileQuery = {
  getImageFile?:  {
    __typename: "ImageFile",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    key: string,
    path: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    type: string,
    updatedAt: string,
  } | null,
};

export type GetImageNeighbourQueryVariables = {
  image1Id: string,
  image2Id: string,
};

export type GetImageNeighbourQuery = {
  getImageNeighbour?:  {
    __typename: "ImageNeighbour",
    createdAt: string,
    homography?: Array< number | null > | null,
    image1?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image1Id: string,
    image2?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image2Id: string,
    updatedAt: string,
  } | null,
};

export type GetImageSetQueryVariables = {
  id: string,
};

export type GetImageSetQuery = {
  getImageSet?:  {
    __typename: "ImageSet",
    createdAt: string,
    id: string,
    imageCount?: number | null,
    images?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type GetImageSetMembershipQueryVariables = {
  id: string,
};

export type GetImageSetMembershipQuery = {
  getImageSetMembership?:  {
    __typename: "ImageSetMembership",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    imageSet?:  {
      __typename: "ImageSet",
      createdAt: string,
      id: string,
      imageCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    imageSetId: string,
    updatedAt: string,
  } | null,
};

export type GetJollyResultQueryVariables = {
  annotationSetId: string,
  categoryId: string,
  stratumId: string,
  surveyId: string,
};

export type GetJollyResultQuery = {
  getJollyResult?:  {
    __typename: "JollyResult",
    animals: number,
    annotationSetId: string,
    areaSurveyed: number,
    categoryId: string,
    createdAt: string,
    density: number,
    estimate: number,
    lowerBound95: number,
    numSamples: number,
    standardError: number,
    stratumId: string,
    surveyId: string,
    updatedAt: string,
    upperBound95: number,
    variance: number,
  } | null,
};

export type GetJollyResultsMembershipQueryVariables = {
  annotationSetId: string,
  surveyId: string,
  userId: string,
};

export type GetJollyResultsMembershipQuery = {
  getJollyResultsMembership?:  {
    __typename: "JollyResultsMembership",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    survey?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    surveyId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type GetLocationQueryVariables = {
  id: string,
};

export type GetLocationQuery = {
  getLocation?:  {
    __typename: "Location",
    annotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    confidence?: number | null,
    createdAt: string,
    height?: number | null,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    setId: string,
    sets?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    source: string,
    testPresets?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
    width?: number | null,
    x: number,
    y: number,
  } | null,
};

export type GetLocationAnnotationCountQueryVariables = {
  annotationSetId: string,
  categoryId: string,
  locationId: string,
};

export type GetLocationAnnotationCountQuery = {
  getLocationAnnotationCount?:  {
    __typename: "LocationAnnotationCount",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    count?: number | null,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    updatedAt: string,
  } | null,
};

export type GetLocationSetQueryVariables = {
  id: string,
};

export type GetLocationSetQuery = {
  getLocationSet?:  {
    __typename: "LocationSet",
    createdAt: string,
    description?: string | null,
    id: string,
    locationCount?: number | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type GetLocationSetMembershipQueryVariables = {
  id: string,
};

export type GetLocationSetMembershipQuery = {
  getLocationSetMembership?:  {
    __typename: "LocationSetMembership",
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type GetObjectQueryVariables = {
  id: string,
};

export type GetObjectQuery = {
  getObject?:  {
    __typename: "Object",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type GetObservationQueryVariables = {
  id: string,
};

export type GetObservationQuery = {
  getObservation?:  {
    __typename: "Observation",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    loadingTime?: number | null,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    timeTaken?: number | null,
    updatedAt: string,
    waitingTime?: number | null,
  } | null,
};

export type GetOrganizationQueryVariables = {
  id: string,
};

export type GetOrganizationQuery = {
  getOrganization?:  {
    __typename: "Organization",
    createdAt: string,
    description?: string | null,
    id: string,
    invites?:  {
      __typename: "ModelOrganizationInviteConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelOrganizationMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    projects?:  {
      __typename: "ModelProjectConnection",
      nextToken?: string | null,
    } | null,
    testPresets?:  {
      __typename: "ModelTestPresetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type GetOrganizationInviteQueryVariables = {
  id: string,
};

export type GetOrganizationInviteQuery = {
  getOrganizationInvite?:  {
    __typename: "OrganizationInvite",
    createdAt: string,
    id: string,
    invitedBy: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    status?: string | null,
    updatedAt: string,
    username: string,
  } | null,
};

export type GetOrganizationMembershipQueryVariables = {
  organizationId: string,
  userId: string,
};

export type GetOrganizationMembershipQuery = {
  getOrganizationMembership?:  {
    __typename: "OrganizationMembership",
    createdAt: string,
    isAdmin?: boolean | null,
    isTested?: boolean | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type GetOrganizationRegistrationQueryVariables = {
  id: string,
};

export type GetOrganizationRegistrationQuery = {
  getOrganizationRegistration?:  {
    __typename: "OrganizationRegistration",
    briefDescription: string,
    createdAt: string,
    id: string,
    organizationName: string,
    requestedBy: string,
    status?: string | null,
    updatedAt: string,
  } | null,
};

export type GetProjectQueryVariables = {
  id: string,
};

export type GetProjectQuery = {
  getProject?:  {
    __typename: "Project",
    annotationSets?:  {
      __typename: "ModelAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    cameraOverlaps?:  {
      __typename: "ModelCameraOverlapConnection",
      nextToken?: string | null,
    } | null,
    cameras?:  {
      __typename: "ModelCameraConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    createdBy: string,
    hidden?: boolean | null,
    id: string,
    imageFiles?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    imageSets?:  {
      __typename: "ModelImageSetConnection",
      nextToken?: string | null,
    } | null,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationSets?:  {
      __typename: "ModelLocationSetConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    members?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    queues?:  {
      __typename: "ModelQueueConnection",
      nextToken?: string | null,
    } | null,
    shapefile?:  {
      __typename: "Shapefile",
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    shapefileExclusions?:  {
      __typename: "ModelShapefileExclusionsConnection",
      nextToken?: string | null,
    } | null,
    status?: string | null,
    strata?:  {
      __typename: "ModelStratumConnection",
      nextToken?: string | null,
    } | null,
    tags?: Array< string | null > | null,
    testConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type GetProjectTestConfigQueryVariables = {
  projectId: string,
};

export type GetProjectTestConfigQuery = {
  getProjectTestConfig?:  {
    __typename: "ProjectTestConfig",
    accuracy: number,
    createdAt: string,
    deadzone?: number | null,
    interval?: number | null,
    postTestConfirmation?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    random?: number | null,
    testPresetProjects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testType?: string | null,
    updatedAt: string,
  } | null,
};

export type GetQueueQueryVariables = {
  id: string,
};

export type GetQueueQuery = {
  getQueue?:  {
    __typename: "Queue",
    approximateSize?: number | null,
    backupUsers?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    batchSize?: number | null,
    createdAt: string,
    hidden?: boolean | null,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tag?: string | null,
    totalBatches?: number | null,
    updatedAt: string,
    url?: string | null,
    users?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    zoom?: number | null,
  } | null,
};

export type GetResultSharingTokenQueryVariables = {
  annotationSetId: string,
  surveyId: string,
};

export type GetResultSharingTokenQuery = {
  getResultSharingToken?:  {
    __typename: "ResultSharingToken",
    annotationSetId: string,
    createdAt: string,
    jwt: string,
    surveyId: string,
    updatedAt: string,
  } | null,
};

export type GetShapefileQueryVariables = {
  id: string,
};

export type GetShapefileQuery = {
  getShapefile?:  {
    __typename: "Shapefile",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type GetShapefileExclusionsQueryVariables = {
  id: string,
};

export type GetShapefileExclusionsQuery = {
  getShapefileExclusions?:  {
    __typename: "ShapefileExclusions",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type GetStratumQueryVariables = {
  id: string,
};

export type GetStratumQuery = {
  getStratum?:  {
    __typename: "Stratum",
    area?: number | null,
    baselineLength?: number | null,
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type GetTasksOnAnnotationSetQueryVariables = {
  id: string,
};

export type GetTasksOnAnnotationSetQuery = {
  getTasksOnAnnotationSet?:  {
    __typename: "TasksOnAnnotationSet",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type GetTestPresetQueryVariables = {
  id: string,
};

export type GetTestPresetQuery = {
  getTestPreset?:  {
    __typename: "TestPreset",
    createdAt: string,
    id: string,
    locations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    projects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type GetTestPresetLocationQueryVariables = {
  annotationSetId: string,
  locationId: string,
  testPresetId: string,
};

export type GetTestPresetLocationQuery = {
  getTestPresetLocation?:  {
    __typename: "TestPresetLocation",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type GetTestPresetProjectQueryVariables = {
  projectId: string,
  testPresetId: string,
};

export type GetTestPresetProjectQuery = {
  getTestPresetProject?:  {
    __typename: "TestPresetProject",
    createdAt: string,
    projectConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type GetTestResultQueryVariables = {
  id: string,
};

export type GetTestResultQuery = {
  getTestResult?:  {
    __typename: "TestResult",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    categoryCounts?:  {
      __typename: "ModelTestResultCategoryCountConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    passedOnTotal: boolean,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testAnimals: number,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    totalMissedAnimals: number,
    updatedAt: string,
    userId: string,
  } | null,
};

export type GetTestResultCategoryCountQueryVariables = {
  categoryName: string,
  testResultId: string,
};

export type GetTestResultCategoryCountQuery = {
  getTestResultCategoryCount?:  {
    __typename: "TestResultCategoryCount",
    categoryName: string,
    createdAt: string,
    testCount: number,
    testResult?:  {
      __typename: "TestResult",
      annotationSetId: string,
      createdAt: string,
      id: string,
      locationId: string,
      passedOnTotal: boolean,
      projectId: string,
      testAnimals: number,
      testPresetId: string,
      totalMissedAnimals: number,
      updatedAt: string,
      userId: string,
    } | null,
    testResultId: string,
    updatedAt: string,
    userCount: number,
  } | null,
};

export type GetTransectQueryVariables = {
  id: string,
};

export type GetTransectQuery = {
  getTransect?:  {
    __typename: "Transect",
    createdAt: string,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    stratum?:  {
      __typename: "Stratum",
      area?: number | null,
      baselineLength?: number | null,
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    stratumId: string,
    updatedAt: string,
  } | null,
};

export type GetUserProjectMembershipQueryVariables = {
  id: string,
};

export type GetUserProjectMembershipQuery = {
  getUserProjectMembership?:  {
    __typename: "UserProjectMembership",
    backupQueue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    backupQueueId?: string | null,
    createdAt: string,
    id: string,
    isAdmin?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    queue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    queueId?: string | null,
    updatedAt: string,
    userId: string,
  } | null,
};

export type GetUserStatsQueryVariables = {
  date: string,
  projectId: string,
  setId: string,
  userId: string,
};

export type GetUserStatsQuery = {
  getUserStats?:  {
    __typename: "UserStats",
    activeTime: number,
    annotationCount: number,
    annotationTime?: number | null,
    createdAt: string,
    date: string,
    observationCount: number,
    projectId: string,
    searchCount?: number | null,
    searchTime?: number | null,
    setId: string,
    sightingCount?: number | null,
    updatedAt: string,
    userId: string,
    waitingTime?: number | null,
  } | null,
};

export type ImageNeighboursByImage1keyQueryVariables = {
  filter?: ModelImageNeighbourFilterInput | null,
  image1Id: string,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type ImageNeighboursByImage1keyQuery = {
  imageNeighboursByImage1key?:  {
    __typename: "ModelImageNeighbourConnection",
    items:  Array< {
      __typename: "ImageNeighbour",
      createdAt: string,
      homography?: Array< number | null > | null,
      image1Id: string,
      image2Id: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ImageNeighboursByImage2keyQueryVariables = {
  filter?: ModelImageNeighbourFilterInput | null,
  image2Id: string,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type ImageNeighboursByImage2keyQuery = {
  imageNeighboursByImage2key?:  {
    __typename: "ModelImageNeighbourConnection",
    items:  Array< {
      __typename: "ImageNeighbour",
      createdAt: string,
      homography?: Array< number | null > | null,
      image1Id: string,
      image2Id: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ImageSetMembershipsByImageSetIdQueryVariables = {
  filter?: ModelImageSetMembershipFilterInput | null,
  imageSetId: string,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type ImageSetMembershipsByImageSetIdQuery = {
  imageSetMembershipsByImageSetId?:  {
    __typename: "ModelImageSetMembershipConnection",
    items:  Array< {
      __typename: "ImageSetMembership",
      createdAt: string,
      id: string,
      imageId: string,
      imageSetId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ImageSetsByProjectIdQueryVariables = {
  filter?: ModelImageSetFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type ImageSetsByProjectIdQuery = {
  imageSetsByProjectId?:  {
    __typename: "ModelImageSetConnection",
    items:  Array< {
      __typename: "ImageSet",
      createdAt: string,
      id: string,
      imageCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ImagesByPathQueryVariables = {
  filter?: ModelImageFileFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  path: string,
  sortDirection?: ModelSortDirection | null,
};

export type ImagesByPathQuery = {
  imagesByPath?:  {
    __typename: "ModelImageFileConnection",
    items:  Array< {
      __typename: "ImageFile",
      createdAt: string,
      id: string,
      imageId?: string | null,
      key: string,
      path: string,
      projectId: string,
      type: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ImagesByProjectIdQueryVariables = {
  filter?: ModelImageFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type ImagesByProjectIdQuery = {
  imagesByProjectId?:  {
    __typename: "ModelImageConnection",
    items:  Array< {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ImagesByimageIdQueryVariables = {
  filter?: ModelImageFileFilterInput | null,
  imageId: string,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type ImagesByimageIdQuery = {
  imagesByimageId?:  {
    __typename: "ModelImageFileConnection",
    items:  Array< {
      __typename: "ImageFile",
      createdAt: string,
      id: string,
      imageId?: string | null,
      key: string,
      path: string,
      projectId: string,
      type: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type JollyResultsByStratumIdQueryVariables = {
  filter?: ModelJollyResultFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  stratumId: string,
};

export type JollyResultsByStratumIdQuery = {
  jollyResultsByStratumId?:  {
    __typename: "ModelJollyResultConnection",
    items:  Array< {
      __typename: "JollyResult",
      animals: number,
      annotationSetId: string,
      areaSurveyed: number,
      categoryId: string,
      createdAt: string,
      density: number,
      estimate: number,
      lowerBound95: number,
      numSamples: number,
      standardError: number,
      stratumId: string,
      surveyId: string,
      updatedAt: string,
      upperBound95: number,
      variance: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type JollyResultsBySurveyIdQueryVariables = {
  filter?: ModelJollyResultFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  surveyId: string,
};

export type JollyResultsBySurveyIdQuery = {
  jollyResultsBySurveyId?:  {
    __typename: "ModelJollyResultConnection",
    items:  Array< {
      __typename: "JollyResult",
      animals: number,
      annotationSetId: string,
      areaSurveyed: number,
      categoryId: string,
      createdAt: string,
      density: number,
      estimate: number,
      lowerBound95: number,
      numSamples: number,
      standardError: number,
      stratumId: string,
      surveyId: string,
      updatedAt: string,
      upperBound95: number,
      variance: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type JollyResultsMembershipsBySurveyIdQueryVariables = {
  annotationSetId?: ModelIDKeyConditionInput | null,
  filter?: ModelJollyResultsMembershipFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  surveyId: string,
};

export type JollyResultsMembershipsBySurveyIdQuery = {
  jollyResultsMembershipsBySurveyId?:  {
    __typename: "ModelJollyResultsMembershipConnection",
    items:  Array< {
      __typename: "JollyResultsMembership",
      annotationSetId: string,
      createdAt: string,
      surveyId: string,
      updatedAt: string,
      userId: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListAnnotationSetsQueryVariables = {
  filter?: ModelAnnotationSetFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListAnnotationSetsQuery = {
  listAnnotationSets?:  {
    __typename: "ModelAnnotationSetConnection",
    items:  Array< {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListAnnotationsQueryVariables = {
  filter?: ModelAnnotationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListAnnotationsQuery = {
  listAnnotations?:  {
    __typename: "ModelAnnotationConnection",
    items:  Array< {
      __typename: "Annotation",
      categoryId: string,
      createdAt: string,
      id: string,
      imageId: string,
      objectId?: string | null,
      obscured?: boolean | null,
      owner?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      x: number,
      y: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListCameraOverlapsQueryVariables = {
  cameraAId?: string | null,
  cameraBId?: ModelIDKeyConditionInput | null,
  filter?: ModelCameraOverlapFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type ListCameraOverlapsQuery = {
  listCameraOverlaps?:  {
    __typename: "ModelCameraOverlapConnection",
    items:  Array< {
      __typename: "CameraOverlap",
      cameraAId: string,
      cameraBId: string,
      createdAt: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListCamerasQueryVariables = {
  filter?: ModelCameraFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListCamerasQuery = {
  listCameras?:  {
    __typename: "ModelCameraConnection",
    items:  Array< {
      __typename: "Camera",
      createdAt: string,
      focalLengthMm?: number | null,
      id: string,
      name: string,
      projectId: string,
      sensorWidthMm?: number | null,
      tiltDegrees?: number | null,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListCategoriesQueryVariables = {
  filter?: ModelCategoryFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListCategoriesQuery = {
  listCategories?:  {
    __typename: "ModelCategoryConnection",
    items:  Array< {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListClientLogsQueryVariables = {
  filter?: ModelClientLogFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListClientLogsQuery = {
  listClientLogs?:  {
    __typename: "ModelClientLogConnection",
    items:  Array< {
      __typename: "ClientLog",
      connectionType?: string | null,
      createdAt: string,
      deviceType?: string | null,
      downlink?: number | null,
      id: string,
      ipAddress?: string | null,
      os?: string | null,
      rtt?: number | null,
      updatedAt: string,
      userAgent?: string | null,
      userId: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListGroupsForUserQueryVariables = {
  nextToken?: string | null,
  userId: string,
};

export type ListGroupsForUserQuery = {
  listGroupsForUser?: string | null,
};

export type ListImageFilesQueryVariables = {
  filter?: ModelImageFileFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListImageFilesQuery = {
  listImageFiles?:  {
    __typename: "ModelImageFileConnection",
    items:  Array< {
      __typename: "ImageFile",
      createdAt: string,
      id: string,
      imageId?: string | null,
      key: string,
      path: string,
      projectId: string,
      type: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListImageNeighboursQueryVariables = {
  filter?: ModelImageNeighbourFilterInput | null,
  image1Id?: string | null,
  image2Id?: ModelIDKeyConditionInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type ListImageNeighboursQuery = {
  listImageNeighbours?:  {
    __typename: "ModelImageNeighbourConnection",
    items:  Array< {
      __typename: "ImageNeighbour",
      createdAt: string,
      homography?: Array< number | null > | null,
      image1Id: string,
      image2Id: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListImageSetMembershipsQueryVariables = {
  filter?: ModelImageSetMembershipFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListImageSetMembershipsQuery = {
  listImageSetMemberships?:  {
    __typename: "ModelImageSetMembershipConnection",
    items:  Array< {
      __typename: "ImageSetMembership",
      createdAt: string,
      id: string,
      imageId: string,
      imageSetId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListImageSetsQueryVariables = {
  filter?: ModelImageSetFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListImageSetsQuery = {
  listImageSets?:  {
    __typename: "ModelImageSetConnection",
    items:  Array< {
      __typename: "ImageSet",
      createdAt: string,
      id: string,
      imageCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListImagesQueryVariables = {
  filter?: ModelImageFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListImagesQuery = {
  listImages?:  {
    __typename: "ModelImageConnection",
    items:  Array< {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListJollyResultsQueryVariables = {
  filter?: ModelJollyResultFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  stratumIdAnnotationSetIdCategoryId?: ModelJollyResultPrimaryCompositeKeyConditionInput | null,
  surveyId?: string | null,
};

export type ListJollyResultsQuery = {
  listJollyResults?:  {
    __typename: "ModelJollyResultConnection",
    items:  Array< {
      __typename: "JollyResult",
      animals: number,
      annotationSetId: string,
      areaSurveyed: number,
      categoryId: string,
      createdAt: string,
      density: number,
      estimate: number,
      lowerBound95: number,
      numSamples: number,
      standardError: number,
      stratumId: string,
      surveyId: string,
      updatedAt: string,
      upperBound95: number,
      variance: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListJollyResultsMembershipsQueryVariables = {
  annotationSetIdUserId?: ModelJollyResultsMembershipPrimaryCompositeKeyConditionInput | null,
  filter?: ModelJollyResultsMembershipFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  surveyId?: string | null,
};

export type ListJollyResultsMembershipsQuery = {
  listJollyResultsMemberships?:  {
    __typename: "ModelJollyResultsMembershipConnection",
    items:  Array< {
      __typename: "JollyResultsMembership",
      annotationSetId: string,
      createdAt: string,
      surveyId: string,
      updatedAt: string,
      userId: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListLocationAnnotationCountsQueryVariables = {
  categoryIdAnnotationSetId?: ModelLocationAnnotationCountPrimaryCompositeKeyConditionInput | null,
  filter?: ModelLocationAnnotationCountFilterInput | null,
  limit?: number | null,
  locationId?: string | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type ListLocationAnnotationCountsQuery = {
  listLocationAnnotationCounts?:  {
    __typename: "ModelLocationAnnotationCountConnection",
    items:  Array< {
      __typename: "LocationAnnotationCount",
      annotationSetId: string,
      categoryId: string,
      count?: number | null,
      createdAt: string,
      locationId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListLocationSetMembershipsQueryVariables = {
  filter?: ModelLocationSetMembershipFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListLocationSetMembershipsQuery = {
  listLocationSetMemberships?:  {
    __typename: "ModelLocationSetMembershipConnection",
    items:  Array< {
      __typename: "LocationSetMembership",
      createdAt: string,
      id: string,
      locationId: string,
      locationSetId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListLocationSetsQueryVariables = {
  filter?: ModelLocationSetFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListLocationSetsQuery = {
  listLocationSets?:  {
    __typename: "ModelLocationSetConnection",
    items:  Array< {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListLocationsQueryVariables = {
  filter?: ModelLocationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListLocationsQuery = {
  listLocations?:  {
    __typename: "ModelLocationConnection",
    items:  Array< {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListObjectsQueryVariables = {
  filter?: ModelObjectFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListObjectsQuery = {
  listObjects?:  {
    __typename: "ModelObjectConnection",
    items:  Array< {
      __typename: "Object",
      categoryId: string,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListObservationsQueryVariables = {
  filter?: ModelObservationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListObservationsQuery = {
  listObservations?:  {
    __typename: "ModelObservationConnection",
    items:  Array< {
      __typename: "Observation",
      annotationCount?: number | null,
      annotationSetId: string,
      createdAt: string,
      id: string,
      loadingTime?: number | null,
      locationId: string,
      owner?: string | null,
      projectId: string,
      timeTaken?: number | null,
      updatedAt: string,
      waitingTime?: number | null,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListOrganizationInvitesQueryVariables = {
  filter?: ModelOrganizationInviteFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListOrganizationInvitesQuery = {
  listOrganizationInvites?:  {
    __typename: "ModelOrganizationInviteConnection",
    items:  Array< {
      __typename: "OrganizationInvite",
      createdAt: string,
      id: string,
      invitedBy: string,
      organizationId: string,
      status?: string | null,
      updatedAt: string,
      username: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListOrganizationMembershipsQueryVariables = {
  filter?: ModelOrganizationMembershipFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  organizationId?: string | null,
  sortDirection?: ModelSortDirection | null,
  userId?: ModelStringKeyConditionInput | null,
};

export type ListOrganizationMembershipsQuery = {
  listOrganizationMemberships?:  {
    __typename: "ModelOrganizationMembershipConnection",
    items:  Array< {
      __typename: "OrganizationMembership",
      createdAt: string,
      isAdmin?: boolean | null,
      isTested?: boolean | null,
      organizationId: string,
      updatedAt: string,
      userId: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListOrganizationRegistrationsQueryVariables = {
  filter?: ModelOrganizationRegistrationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListOrganizationRegistrationsQuery = {
  listOrganizationRegistrations?:  {
    __typename: "ModelOrganizationRegistrationConnection",
    items:  Array< {
      __typename: "OrganizationRegistration",
      briefDescription: string,
      createdAt: string,
      id: string,
      organizationName: string,
      requestedBy: string,
      status?: string | null,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListOrganizationsQueryVariables = {
  filter?: ModelOrganizationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListOrganizationsQuery = {
  listOrganizations?:  {
    __typename: "ModelOrganizationConnection",
    items:  Array< {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListProjectTestConfigsQueryVariables = {
  filter?: ModelProjectTestConfigFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type ListProjectTestConfigsQuery = {
  listProjectTestConfigs?:  {
    __typename: "ModelProjectTestConfigConnection",
    items:  Array< {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListProjectsQueryVariables = {
  filter?: ModelProjectFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListProjectsQuery = {
  listProjects?:  {
    __typename: "ModelProjectConnection",
    items:  Array< {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListQueuesQueryVariables = {
  filter?: ModelQueueFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListQueuesQuery = {
  listQueues?:  {
    __typename: "ModelQueueConnection",
    items:  Array< {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListResultSharingTokensQueryVariables = {
  annotationSetId?: ModelIDKeyConditionInput | null,
  filter?: ModelResultSharingTokenFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  surveyId?: string | null,
};

export type ListResultSharingTokensQuery = {
  listResultSharingTokens?:  {
    __typename: "ModelResultSharingTokenConnection",
    items:  Array< {
      __typename: "ResultSharingToken",
      annotationSetId: string,
      createdAt: string,
      jwt: string,
      surveyId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListShapefileExclusionsQueryVariables = {
  filter?: ModelShapefileExclusionsFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListShapefileExclusionsQuery = {
  listShapefileExclusions?:  {
    __typename: "ModelShapefileExclusionsConnection",
    items:  Array< {
      __typename: "ShapefileExclusions",
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListShapefilesQueryVariables = {
  filter?: ModelShapefileFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListShapefilesQuery = {
  listShapefiles?:  {
    __typename: "ModelShapefileConnection",
    items:  Array< {
      __typename: "Shapefile",
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListStrataQueryVariables = {
  filter?: ModelStratumFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListStrataQuery = {
  listStrata?:  {
    __typename: "ModelStratumConnection",
    items:  Array< {
      __typename: "Stratum",
      area?: number | null,
      baselineLength?: number | null,
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListTasksOnAnnotationSetsQueryVariables = {
  filter?: ModelTasksOnAnnotationSetFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListTasksOnAnnotationSetsQuery = {
  listTasksOnAnnotationSets?:  {
    __typename: "ModelTasksOnAnnotationSetConnection",
    items:  Array< {
      __typename: "TasksOnAnnotationSet",
      annotationSetId: string,
      createdAt: string,
      id: string,
      locationSetId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListTestPresetLocationsQueryVariables = {
  filter?: ModelTestPresetLocationFilterInput | null,
  limit?: number | null,
  locationIdAnnotationSetId?: ModelTestPresetLocationPrimaryCompositeKeyConditionInput | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  testPresetId?: string | null,
};

export type ListTestPresetLocationsQuery = {
  listTestPresetLocations?:  {
    __typename: "ModelTestPresetLocationConnection",
    items:  Array< {
      __typename: "TestPresetLocation",
      annotationSetId: string,
      createdAt: string,
      locationId: string,
      testPresetId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListTestPresetProjectsQueryVariables = {
  filter?: ModelTestPresetProjectFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId?: ModelIDKeyConditionInput | null,
  sortDirection?: ModelSortDirection | null,
  testPresetId?: string | null,
};

export type ListTestPresetProjectsQuery = {
  listTestPresetProjects?:  {
    __typename: "ModelTestPresetProjectConnection",
    items:  Array< {
      __typename: "TestPresetProject",
      createdAt: string,
      projectId: string,
      testPresetId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListTestPresetsQueryVariables = {
  filter?: ModelTestPresetFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListTestPresetsQuery = {
  listTestPresets?:  {
    __typename: "ModelTestPresetConnection",
    items:  Array< {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListTestResultCategoryCountsQueryVariables = {
  categoryName?: ModelStringKeyConditionInput | null,
  filter?: ModelTestResultCategoryCountFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  testResultId?: string | null,
};

export type ListTestResultCategoryCountsQuery = {
  listTestResultCategoryCounts?:  {
    __typename: "ModelTestResultCategoryCountConnection",
    items:  Array< {
      __typename: "TestResultCategoryCount",
      categoryName: string,
      createdAt: string,
      testCount: number,
      testResultId: string,
      updatedAt: string,
      userCount: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListTestResultsQueryVariables = {
  filter?: ModelTestResultFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListTestResultsQuery = {
  listTestResults?:  {
    __typename: "ModelTestResultConnection",
    items:  Array< {
      __typename: "TestResult",
      annotationSetId: string,
      createdAt: string,
      id: string,
      locationId: string,
      passedOnTotal: boolean,
      projectId: string,
      testAnimals: number,
      testPresetId: string,
      totalMissedAnimals: number,
      updatedAt: string,
      userId: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListTransectsQueryVariables = {
  filter?: ModelTransectFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListTransectsQuery = {
  listTransects?:  {
    __typename: "ModelTransectConnection",
    items:  Array< {
      __typename: "Transect",
      createdAt: string,
      id: string,
      projectId: string,
      stratumId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListUserProjectMembershipsQueryVariables = {
  filter?: ModelUserProjectMembershipFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
};

export type ListUserProjectMembershipsQuery = {
  listUserProjectMemberships?:  {
    __typename: "ModelUserProjectMembershipConnection",
    items:  Array< {
      __typename: "UserProjectMembership",
      backupQueueId?: string | null,
      createdAt: string,
      id: string,
      isAdmin?: boolean | null,
      projectId: string,
      queueId?: string | null,
      updatedAt: string,
      userId: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListUserStatsQueryVariables = {
  filter?: ModelUserStatsFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId?: string | null,
  sortDirection?: ModelSortDirection | null,
  userIdDateSetId?: ModelUserStatsPrimaryCompositeKeyConditionInput | null,
};

export type ListUserStatsQuery = {
  listUserStats?:  {
    __typename: "ModelUserStatsConnection",
    items:  Array< {
      __typename: "UserStats",
      activeTime: number,
      annotationCount: number,
      annotationTime?: number | null,
      createdAt: string,
      date: string,
      observationCount: number,
      projectId: string,
      searchCount?: number | null,
      searchTime?: number | null,
      setId: string,
      sightingCount?: number | null,
      updatedAt: string,
      userId: string,
      waitingTime?: number | null,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ListUsersQueryVariables = {
  nextToken?: string | null,
};

export type ListUsersQuery = {
  listUsers?:  {
    __typename: "ListUsersReturnType",
    NextToken?: string | null,
    Users?:  Array< {
      __typename: "UserType",
      email?: string | null,
      id: string,
      isAdmin?: boolean | null,
      name?: string | null,
    } | null > | null,
  } | null,
};

export type LocationSetsByAnnotationSetIdQueryVariables = {
  annotationSetId: string,
  filter?: ModelTasksOnAnnotationSetFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type LocationSetsByAnnotationSetIdQuery = {
  locationSetsByAnnotationSetId?:  {
    __typename: "ModelTasksOnAnnotationSetConnection",
    items:  Array< {
      __typename: "TasksOnAnnotationSet",
      annotationSetId: string,
      createdAt: string,
      id: string,
      locationSetId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type LocationSetsByProjectIdQueryVariables = {
  filter?: ModelLocationSetFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type LocationSetsByProjectIdQuery = {
  locationSetsByProjectId?:  {
    __typename: "ModelLocationSetConnection",
    items:  Array< {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type LocationsByImageKeyQueryVariables = {
  confidence?: ModelFloatKeyConditionInput | null,
  filter?: ModelLocationFilterInput | null,
  imageId: string,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type LocationsByImageKeyQuery = {
  locationsByImageKey?:  {
    __typename: "ModelLocationConnection",
    items:  Array< {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type LocationsByProjectIdAndSourceQueryVariables = {
  filter?: ModelLocationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
  source?: ModelStringKeyConditionInput | null,
};

export type LocationsByProjectIdAndSourceQuery = {
  locationsByProjectIdAndSource?:  {
    __typename: "ModelLocationConnection",
    items:  Array< {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type LocationsBySetIdAndConfidenceQueryVariables = {
  confidence?: ModelFloatKeyConditionInput | null,
  filter?: ModelLocationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  setId: string,
  sortDirection?: ModelSortDirection | null,
};

export type LocationsBySetIdAndConfidenceQuery = {
  locationsBySetIdAndConfidence?:  {
    __typename: "ModelLocationConnection",
    items:  Array< {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type LocationsByTestPresetIdQueryVariables = {
  filter?: ModelTestPresetLocationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  testPresetId: string,
};

export type LocationsByTestPresetIdQuery = {
  locationsByTestPresetId?:  {
    __typename: "ModelTestPresetLocationConnection",
    items:  Array< {
      __typename: "TestPresetLocation",
      annotationSetId: string,
      createdAt: string,
      locationId: string,
      testPresetId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type MembershipsByOrganizationIdQueryVariables = {
  filter?: ModelOrganizationMembershipFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  organizationId: string,
  sortDirection?: ModelSortDirection | null,
};

export type MembershipsByOrganizationIdQuery = {
  membershipsByOrganizationId?:  {
    __typename: "ModelOrganizationMembershipConnection",
    items:  Array< {
      __typename: "OrganizationMembership",
      createdAt: string,
      isAdmin?: boolean | null,
      isTested?: boolean | null,
      organizationId: string,
      updatedAt: string,
      userId: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ObjectsByCategoryIdQueryVariables = {
  categoryId: string,
  filter?: ModelObjectFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type ObjectsByCategoryIdQuery = {
  objectsByCategoryId?:  {
    __typename: "ModelObjectConnection",
    items:  Array< {
      __typename: "Object",
      categoryId: string,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ObservationsByAnnotationSetIdQueryVariables = {
  annotationSetId: string,
  createdAt?: ModelStringKeyConditionInput | null,
  filter?: ModelObservationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type ObservationsByAnnotationSetIdQuery = {
  observationsByAnnotationSetId?:  {
    __typename: "ModelObservationConnection",
    items:  Array< {
      __typename: "Observation",
      annotationCount?: number | null,
      annotationSetId: string,
      createdAt: string,
      id: string,
      loadingTime?: number | null,
      locationId: string,
      owner?: string | null,
      projectId: string,
      timeTaken?: number | null,
      updatedAt: string,
      waitingTime?: number | null,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ObservationsByLocationIdQueryVariables = {
  filter?: ModelObservationFilterInput | null,
  limit?: number | null,
  locationId: string,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type ObservationsByLocationIdQuery = {
  observationsByLocationId?:  {
    __typename: "ModelObservationConnection",
    items:  Array< {
      __typename: "Observation",
      annotationCount?: number | null,
      annotationSetId: string,
      createdAt: string,
      id: string,
      loadingTime?: number | null,
      locationId: string,
      owner?: string | null,
      projectId: string,
      timeTaken?: number | null,
      updatedAt: string,
      waitingTime?: number | null,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ObservationsByOwnerQueryVariables = {
  filter?: ModelObservationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  owner: string,
  sortDirection?: ModelSortDirection | null,
};

export type ObservationsByOwnerQuery = {
  observationsByOwner?:  {
    __typename: "ModelObservationConnection",
    items:  Array< {
      __typename: "Observation",
      annotationCount?: number | null,
      annotationSetId: string,
      createdAt: string,
      id: string,
      loadingTime?: number | null,
      locationId: string,
      owner?: string | null,
      projectId: string,
      timeTaken?: number | null,
      updatedAt: string,
      waitingTime?: number | null,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type OrganizationInvitesByUsernameQueryVariables = {
  filter?: ModelOrganizationInviteFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  username: string,
};

export type OrganizationInvitesByUsernameQuery = {
  organizationInvitesByUsername?:  {
    __typename: "ModelOrganizationInviteConnection",
    items:  Array< {
      __typename: "OrganizationInvite",
      createdAt: string,
      id: string,
      invitedBy: string,
      organizationId: string,
      status?: string | null,
      updatedAt: string,
      username: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type OrganizationRegistrationsByStatusQueryVariables = {
  filter?: ModelOrganizationRegistrationFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  status: string,
};

export type OrganizationRegistrationsByStatusQuery = {
  organizationRegistrationsByStatus?:  {
    __typename: "ModelOrganizationRegistrationConnection",
    items:  Array< {
      __typename: "OrganizationRegistration",
      briefDescription: string,
      createdAt: string,
      id: string,
      organizationName: string,
      requestedBy: string,
      status?: string | null,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type OrganizationsByUserIdQueryVariables = {
  filter?: ModelOrganizationMembershipFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  userId: string,
};

export type OrganizationsByUserIdQuery = {
  organizationsByUserId?:  {
    __typename: "ModelOrganizationMembershipConnection",
    items:  Array< {
      __typename: "OrganizationMembership",
      createdAt: string,
      isAdmin?: boolean | null,
      isTested?: boolean | null,
      organizationId: string,
      updatedAt: string,
      userId: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type QueuesByProjectIdQueryVariables = {
  filter?: ModelQueueFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type QueuesByProjectIdQuery = {
  queuesByProjectId?:  {
    __typename: "ModelQueueConnection",
    items:  Array< {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ShapefileExclusionsByProjectIdQueryVariables = {
  filter?: ModelShapefileExclusionsFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type ShapefileExclusionsByProjectIdQuery = {
  shapefileExclusionsByProjectId?:  {
    __typename: "ModelShapefileExclusionsConnection",
    items:  Array< {
      __typename: "ShapefileExclusions",
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type ShapefilesByProjectIdQueryVariables = {
  filter?: ModelShapefileFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type ShapefilesByProjectIdQuery = {
  shapefilesByProjectId?:  {
    __typename: "ModelShapefileConnection",
    items:  Array< {
      __typename: "Shapefile",
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type StrataByProjectIdQueryVariables = {
  filter?: ModelStratumFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type StrataByProjectIdQuery = {
  strataByProjectId?:  {
    __typename: "ModelStratumConnection",
    items:  Array< {
      __typename: "Stratum",
      area?: number | null,
      baselineLength?: number | null,
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type TestPresetsByLocationIdQueryVariables = {
  filter?: ModelTestPresetLocationFilterInput | null,
  limit?: number | null,
  locationId: string,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type TestPresetsByLocationIdQuery = {
  testPresetsByLocationId?:  {
    __typename: "ModelTestPresetLocationConnection",
    items:  Array< {
      __typename: "TestPresetLocation",
      annotationSetId: string,
      createdAt: string,
      locationId: string,
      testPresetId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type TestPresetsByNameQueryVariables = {
  filter?: ModelTestPresetFilterInput | null,
  limit?: number | null,
  name: string,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
};

export type TestPresetsByNameQuery = {
  testPresetsByName?:  {
    __typename: "ModelTestPresetConnection",
    items:  Array< {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type TestPresetsByOrganizationIdQueryVariables = {
  filter?: ModelTestPresetFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  organizationId: string,
  sortDirection?: ModelSortDirection | null,
};

export type TestPresetsByOrganizationIdQuery = {
  testPresetsByOrganizationId?:  {
    __typename: "ModelTestPresetConnection",
    items:  Array< {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type TestPresetsByProjectIdQueryVariables = {
  filter?: ModelTestPresetProjectFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type TestPresetsByProjectIdQuery = {
  testPresetsByProjectId?:  {
    __typename: "ModelTestPresetProjectConnection",
    items:  Array< {
      __typename: "TestPresetProject",
      createdAt: string,
      projectId: string,
      testPresetId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type TestResultsByTestPresetIdQueryVariables = {
  filter?: ModelTestResultFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  testPresetId: string,
};

export type TestResultsByTestPresetIdQuery = {
  testResultsByTestPresetId?:  {
    __typename: "ModelTestResultConnection",
    items:  Array< {
      __typename: "TestResult",
      annotationSetId: string,
      createdAt: string,
      id: string,
      locationId: string,
      passedOnTotal: boolean,
      projectId: string,
      testAnimals: number,
      testPresetId: string,
      totalMissedAnimals: number,
      updatedAt: string,
      userId: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type TestResultsByUserIdQueryVariables = {
  filter?: ModelTestResultFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  userId: string,
};

export type TestResultsByUserIdQuery = {
  testResultsByUserId?:  {
    __typename: "ModelTestResultConnection",
    items:  Array< {
      __typename: "TestResult",
      annotationSetId: string,
      createdAt: string,
      id: string,
      locationId: string,
      passedOnTotal: boolean,
      projectId: string,
      testAnimals: number,
      testPresetId: string,
      totalMissedAnimals: number,
      updatedAt: string,
      userId: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type TransectsByProjectIdQueryVariables = {
  filter?: ModelTransectFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type TransectsByProjectIdQuery = {
  transectsByProjectId?:  {
    __typename: "ModelTransectConnection",
    items:  Array< {
      __typename: "Transect",
      createdAt: string,
      id: string,
      projectId: string,
      stratumId: string,
      updatedAt: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type UserProjectMembershipsByProjectIdQueryVariables = {
  filter?: ModelUserProjectMembershipFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  projectId: string,
  sortDirection?: ModelSortDirection | null,
};

export type UserProjectMembershipsByProjectIdQuery = {
  userProjectMembershipsByProjectId?:  {
    __typename: "ModelUserProjectMembershipConnection",
    items:  Array< {
      __typename: "UserProjectMembership",
      backupQueueId?: string | null,
      createdAt: string,
      id: string,
      isAdmin?: boolean | null,
      projectId: string,
      queueId?: string | null,
      updatedAt: string,
      userId: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type UserProjectMembershipsByUserIdQueryVariables = {
  filter?: ModelUserProjectMembershipFilterInput | null,
  limit?: number | null,
  nextToken?: string | null,
  sortDirection?: ModelSortDirection | null,
  userId: string,
};

export type UserProjectMembershipsByUserIdQuery = {
  userProjectMembershipsByUserId?:  {
    __typename: "ModelUserProjectMembershipConnection",
    items:  Array< {
      __typename: "UserProjectMembership",
      backupQueueId?: string | null,
      createdAt: string,
      id: string,
      isAdmin?: boolean | null,
      projectId: string,
      queueId?: string | null,
      updatedAt: string,
      userId: string,
    } | null >,
    nextToken?: string | null,
  } | null,
};

export type AddUserToGroupMutationVariables = {
  groupName: string,
  userId: string,
};

export type AddUserToGroupMutation = {
  addUserToGroup?: string | null,
};

export type CreateAnnotationMutationVariables = {
  condition?: ModelAnnotationConditionInput | null,
  input: CreateAnnotationInput,
};

export type CreateAnnotationMutation = {
  createAnnotation?:  {
    __typename: "Annotation",
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    object?:  {
      __typename: "Object",
      categoryId: string,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    objectId?: string | null,
    obscured?: boolean | null,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    setId: string,
    source: string,
    updatedAt: string,
    x: number,
    y: number,
  } | null,
};

export type CreateAnnotationSetMutationVariables = {
  condition?: ModelAnnotationSetConditionInput | null,
  input: CreateAnnotationSetInput,
};

export type CreateAnnotationSetMutation = {
  createAnnotationSet?:  {
    __typename: "AnnotationSet",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    categories?:  {
      __typename: "ModelCategoryConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    register?: boolean | null,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    testPresetLocations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type CreateCameraMutationVariables = {
  condition?: ModelCameraConditionInput | null,
  input: CreateCameraInput,
};

export type CreateCameraMutation = {
  createCamera?:  {
    __typename: "Camera",
    createdAt: string,
    focalLengthMm?: number | null,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    sensorWidthMm?: number | null,
    tiltDegrees?: number | null,
    updatedAt: string,
  } | null,
};

export type CreateCameraOverlapMutationVariables = {
  condition?: ModelCameraOverlapConditionInput | null,
  input: CreateCameraOverlapInput,
};

export type CreateCameraOverlapMutation = {
  createCameraOverlap?:  {
    __typename: "CameraOverlap",
    cameraAId: string,
    cameraBId: string,
    createdAt: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type CreateCategoryMutationVariables = {
  condition?: ModelCategoryConditionInput | null,
  input: CreateCategoryInput,
};

export type CreateCategoryMutation = {
  createCategory?:  {
    __typename: "Category",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    color?: string | null,
    createdAt: string,
    id: string,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    projectId: string,
    shortcutKey?: string | null,
    updatedAt: string,
  } | null,
};

export type CreateClientLogMutationVariables = {
  condition?: ModelClientLogConditionInput | null,
  input: CreateClientLogInput,
};

export type CreateClientLogMutation = {
  createClientLog?:  {
    __typename: "ClientLog",
    connectionType?: string | null,
    createdAt: string,
    deviceType?: string | null,
    downlink?: number | null,
    id: string,
    ipAddress?: string | null,
    os?: string | null,
    rtt?: number | null,
    updatedAt: string,
    userAgent?: string | null,
    userId: string,
  } | null,
};

export type CreateGroupMutationVariables = {
  groupName: string,
};

export type CreateGroupMutation = {
  createGroup?: string | null,
};

export type CreateImageMutationVariables = {
  condition?: ModelImageConditionInput | null,
  input: CreateImageInput,
};

export type CreateImageMutation = {
  createImage?:  {
    __typename: "Image",
    altitude_agl?: number | null,
    altitude_egm96?: number | null,
    altitude_wgs84?: number | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    camera?:  {
      __typename: "Camera",
      createdAt: string,
      focalLengthMm?: number | null,
      id: string,
      name: string,
      projectId: string,
      sensorWidthMm?: number | null,
      tiltDegrees?: number | null,
      updatedAt: string,
    } | null,
    cameraId?: string | null,
    cameraSerial?: string | null,
    createdAt: string,
    exifData?: string | null,
    files?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    height: number,
    id: string,
    latitude?: number | null,
    leftNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    longitude?: number | null,
    memberships?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    originalPath?: string | null,
    pitch?: number | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    rightNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    roll?: number | null,
    timestamp?: number | null,
    transect?:  {
      __typename: "Transect",
      createdAt: string,
      id: string,
      projectId: string,
      stratumId: string,
      updatedAt: string,
    } | null,
    transectId?: string | null,
    updatedAt: string,
    width: number,
    yaw?: number | null,
  } | null,
};

export type CreateImageFileMutationVariables = {
  condition?: ModelImageFileConditionInput | null,
  input: CreateImageFileInput,
};

export type CreateImageFileMutation = {
  createImageFile?:  {
    __typename: "ImageFile",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    key: string,
    path: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    type: string,
    updatedAt: string,
  } | null,
};

export type CreateImageNeighbourMutationVariables = {
  condition?: ModelImageNeighbourConditionInput | null,
  input: CreateImageNeighbourInput,
};

export type CreateImageNeighbourMutation = {
  createImageNeighbour?:  {
    __typename: "ImageNeighbour",
    createdAt: string,
    homography?: Array< number | null > | null,
    image1?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image1Id: string,
    image2?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image2Id: string,
    updatedAt: string,
  } | null,
};

export type CreateImageSetMutationVariables = {
  condition?: ModelImageSetConditionInput | null,
  input: CreateImageSetInput,
};

export type CreateImageSetMutation = {
  createImageSet?:  {
    __typename: "ImageSet",
    createdAt: string,
    id: string,
    imageCount?: number | null,
    images?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type CreateImageSetMembershipMutationVariables = {
  condition?: ModelImageSetMembershipConditionInput | null,
  input: CreateImageSetMembershipInput,
};

export type CreateImageSetMembershipMutation = {
  createImageSetMembership?:  {
    __typename: "ImageSetMembership",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    imageSet?:  {
      __typename: "ImageSet",
      createdAt: string,
      id: string,
      imageCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    imageSetId: string,
    updatedAt: string,
  } | null,
};

export type CreateJollyResultMutationVariables = {
  condition?: ModelJollyResultConditionInput | null,
  input: CreateJollyResultInput,
};

export type CreateJollyResultMutation = {
  createJollyResult?:  {
    __typename: "JollyResult",
    animals: number,
    annotationSetId: string,
    areaSurveyed: number,
    categoryId: string,
    createdAt: string,
    density: number,
    estimate: number,
    lowerBound95: number,
    numSamples: number,
    standardError: number,
    stratumId: string,
    surveyId: string,
    updatedAt: string,
    upperBound95: number,
    variance: number,
  } | null,
};

export type CreateJollyResultsMembershipMutationVariables = {
  condition?: ModelJollyResultsMembershipConditionInput | null,
  input: CreateJollyResultsMembershipInput,
};

export type CreateJollyResultsMembershipMutation = {
  createJollyResultsMembership?:  {
    __typename: "JollyResultsMembership",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    survey?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    surveyId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type CreateLocationMutationVariables = {
  condition?: ModelLocationConditionInput | null,
  input: CreateLocationInput,
};

export type CreateLocationMutation = {
  createLocation?:  {
    __typename: "Location",
    annotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    confidence?: number | null,
    createdAt: string,
    height?: number | null,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    setId: string,
    sets?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    source: string,
    testPresets?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
    width?: number | null,
    x: number,
    y: number,
  } | null,
};

export type CreateLocationAnnotationCountMutationVariables = {
  condition?: ModelLocationAnnotationCountConditionInput | null,
  input: CreateLocationAnnotationCountInput,
};

export type CreateLocationAnnotationCountMutation = {
  createLocationAnnotationCount?:  {
    __typename: "LocationAnnotationCount",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    count?: number | null,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    updatedAt: string,
  } | null,
};

export type CreateLocationSetMutationVariables = {
  condition?: ModelLocationSetConditionInput | null,
  input: CreateLocationSetInput,
};

export type CreateLocationSetMutation = {
  createLocationSet?:  {
    __typename: "LocationSet",
    createdAt: string,
    description?: string | null,
    id: string,
    locationCount?: number | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type CreateLocationSetMembershipMutationVariables = {
  condition?: ModelLocationSetMembershipConditionInput | null,
  input: CreateLocationSetMembershipInput,
};

export type CreateLocationSetMembershipMutation = {
  createLocationSetMembership?:  {
    __typename: "LocationSetMembership",
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type CreateObjectMutationVariables = {
  condition?: ModelObjectConditionInput | null,
  input: CreateObjectInput,
};

export type CreateObjectMutation = {
  createObject?:  {
    __typename: "Object",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type CreateObservationMutationVariables = {
  condition?: ModelObservationConditionInput | null,
  input: CreateObservationInput,
};

export type CreateObservationMutation = {
  createObservation?:  {
    __typename: "Observation",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    loadingTime?: number | null,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    timeTaken?: number | null,
    updatedAt: string,
    waitingTime?: number | null,
  } | null,
};

export type CreateOrganizationMutationVariables = {
  condition?: ModelOrganizationConditionInput | null,
  input: CreateOrganizationInput,
};

export type CreateOrganizationMutation = {
  createOrganization?:  {
    __typename: "Organization",
    createdAt: string,
    description?: string | null,
    id: string,
    invites?:  {
      __typename: "ModelOrganizationInviteConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelOrganizationMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    projects?:  {
      __typename: "ModelProjectConnection",
      nextToken?: string | null,
    } | null,
    testPresets?:  {
      __typename: "ModelTestPresetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type CreateOrganizationInviteMutationVariables = {
  condition?: ModelOrganizationInviteConditionInput | null,
  input: CreateOrganizationInviteInput,
};

export type CreateOrganizationInviteMutation = {
  createOrganizationInvite?:  {
    __typename: "OrganizationInvite",
    createdAt: string,
    id: string,
    invitedBy: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    status?: string | null,
    updatedAt: string,
    username: string,
  } | null,
};

export type CreateOrganizationMembershipMutationVariables = {
  condition?: ModelOrganizationMembershipConditionInput | null,
  input: CreateOrganizationMembershipInput,
};

export type CreateOrganizationMembershipMutation = {
  createOrganizationMembership?:  {
    __typename: "OrganizationMembership",
    createdAt: string,
    isAdmin?: boolean | null,
    isTested?: boolean | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type CreateOrganizationRegistrationMutationVariables = {
  condition?: ModelOrganizationRegistrationConditionInput | null,
  input: CreateOrganizationRegistrationInput,
};

export type CreateOrganizationRegistrationMutation = {
  createOrganizationRegistration?:  {
    __typename: "OrganizationRegistration",
    briefDescription: string,
    createdAt: string,
    id: string,
    organizationName: string,
    requestedBy: string,
    status?: string | null,
    updatedAt: string,
  } | null,
};

export type CreateProjectMutationVariables = {
  condition?: ModelProjectConditionInput | null,
  input: CreateProjectInput,
};

export type CreateProjectMutation = {
  createProject?:  {
    __typename: "Project",
    annotationSets?:  {
      __typename: "ModelAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    cameraOverlaps?:  {
      __typename: "ModelCameraOverlapConnection",
      nextToken?: string | null,
    } | null,
    cameras?:  {
      __typename: "ModelCameraConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    createdBy: string,
    hidden?: boolean | null,
    id: string,
    imageFiles?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    imageSets?:  {
      __typename: "ModelImageSetConnection",
      nextToken?: string | null,
    } | null,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationSets?:  {
      __typename: "ModelLocationSetConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    members?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    queues?:  {
      __typename: "ModelQueueConnection",
      nextToken?: string | null,
    } | null,
    shapefile?:  {
      __typename: "Shapefile",
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    shapefileExclusions?:  {
      __typename: "ModelShapefileExclusionsConnection",
      nextToken?: string | null,
    } | null,
    status?: string | null,
    strata?:  {
      __typename: "ModelStratumConnection",
      nextToken?: string | null,
    } | null,
    tags?: Array< string | null > | null,
    testConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type CreateProjectTestConfigMutationVariables = {
  condition?: ModelProjectTestConfigConditionInput | null,
  input: CreateProjectTestConfigInput,
};

export type CreateProjectTestConfigMutation = {
  createProjectTestConfig?:  {
    __typename: "ProjectTestConfig",
    accuracy: number,
    createdAt: string,
    deadzone?: number | null,
    interval?: number | null,
    postTestConfirmation?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    random?: number | null,
    testPresetProjects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testType?: string | null,
    updatedAt: string,
  } | null,
};

export type CreateQueueMutationVariables = {
  condition?: ModelQueueConditionInput | null,
  input: CreateQueueInput,
};

export type CreateQueueMutation = {
  createQueue?:  {
    __typename: "Queue",
    approximateSize?: number | null,
    backupUsers?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    batchSize?: number | null,
    createdAt: string,
    hidden?: boolean | null,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tag?: string | null,
    totalBatches?: number | null,
    updatedAt: string,
    url?: string | null,
    users?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    zoom?: number | null,
  } | null,
};

export type CreateResultSharingTokenMutationVariables = {
  condition?: ModelResultSharingTokenConditionInput | null,
  input: CreateResultSharingTokenInput,
};

export type CreateResultSharingTokenMutation = {
  createResultSharingToken?:  {
    __typename: "ResultSharingToken",
    annotationSetId: string,
    createdAt: string,
    jwt: string,
    surveyId: string,
    updatedAt: string,
  } | null,
};

export type CreateShapefileMutationVariables = {
  condition?: ModelShapefileConditionInput | null,
  input: CreateShapefileInput,
};

export type CreateShapefileMutation = {
  createShapefile?:  {
    __typename: "Shapefile",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type CreateShapefileExclusionsMutationVariables = {
  condition?: ModelShapefileExclusionsConditionInput | null,
  input: CreateShapefileExclusionsInput,
};

export type CreateShapefileExclusionsMutation = {
  createShapefileExclusions?:  {
    __typename: "ShapefileExclusions",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type CreateStratumMutationVariables = {
  condition?: ModelStratumConditionInput | null,
  input: CreateStratumInput,
};

export type CreateStratumMutation = {
  createStratum?:  {
    __typename: "Stratum",
    area?: number | null,
    baselineLength?: number | null,
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type CreateTasksOnAnnotationSetMutationVariables = {
  condition?: ModelTasksOnAnnotationSetConditionInput | null,
  input: CreateTasksOnAnnotationSetInput,
};

export type CreateTasksOnAnnotationSetMutation = {
  createTasksOnAnnotationSet?:  {
    __typename: "TasksOnAnnotationSet",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type CreateTestPresetMutationVariables = {
  condition?: ModelTestPresetConditionInput | null,
  input: CreateTestPresetInput,
};

export type CreateTestPresetMutation = {
  createTestPreset?:  {
    __typename: "TestPreset",
    createdAt: string,
    id: string,
    locations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    projects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type CreateTestPresetLocationMutationVariables = {
  condition?: ModelTestPresetLocationConditionInput | null,
  input: CreateTestPresetLocationInput,
};

export type CreateTestPresetLocationMutation = {
  createTestPresetLocation?:  {
    __typename: "TestPresetLocation",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type CreateTestPresetProjectMutationVariables = {
  condition?: ModelTestPresetProjectConditionInput | null,
  input: CreateTestPresetProjectInput,
};

export type CreateTestPresetProjectMutation = {
  createTestPresetProject?:  {
    __typename: "TestPresetProject",
    createdAt: string,
    projectConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type CreateTestResultMutationVariables = {
  condition?: ModelTestResultConditionInput | null,
  input: CreateTestResultInput,
};

export type CreateTestResultMutation = {
  createTestResult?:  {
    __typename: "TestResult",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    categoryCounts?:  {
      __typename: "ModelTestResultCategoryCountConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    passedOnTotal: boolean,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testAnimals: number,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    totalMissedAnimals: number,
    updatedAt: string,
    userId: string,
  } | null,
};

export type CreateTestResultCategoryCountMutationVariables = {
  condition?: ModelTestResultCategoryCountConditionInput | null,
  input: CreateTestResultCategoryCountInput,
};

export type CreateTestResultCategoryCountMutation = {
  createTestResultCategoryCount?:  {
    __typename: "TestResultCategoryCount",
    categoryName: string,
    createdAt: string,
    testCount: number,
    testResult?:  {
      __typename: "TestResult",
      annotationSetId: string,
      createdAt: string,
      id: string,
      locationId: string,
      passedOnTotal: boolean,
      projectId: string,
      testAnimals: number,
      testPresetId: string,
      totalMissedAnimals: number,
      updatedAt: string,
      userId: string,
    } | null,
    testResultId: string,
    updatedAt: string,
    userCount: number,
  } | null,
};

export type CreateTransectMutationVariables = {
  condition?: ModelTransectConditionInput | null,
  input: CreateTransectInput,
};

export type CreateTransectMutation = {
  createTransect?:  {
    __typename: "Transect",
    createdAt: string,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    stratum?:  {
      __typename: "Stratum",
      area?: number | null,
      baselineLength?: number | null,
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    stratumId: string,
    updatedAt: string,
  } | null,
};

export type CreateUserProjectMembershipMutationVariables = {
  condition?: ModelUserProjectMembershipConditionInput | null,
  input: CreateUserProjectMembershipInput,
};

export type CreateUserProjectMembershipMutation = {
  createUserProjectMembership?:  {
    __typename: "UserProjectMembership",
    backupQueue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    backupQueueId?: string | null,
    createdAt: string,
    id: string,
    isAdmin?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    queue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    queueId?: string | null,
    updatedAt: string,
    userId: string,
  } | null,
};

export type CreateUserStatsMutationVariables = {
  condition?: ModelUserStatsConditionInput | null,
  input: CreateUserStatsInput,
};

export type CreateUserStatsMutation = {
  createUserStats?:  {
    __typename: "UserStats",
    activeTime: number,
    annotationCount: number,
    annotationTime?: number | null,
    createdAt: string,
    date: string,
    observationCount: number,
    projectId: string,
    searchCount?: number | null,
    searchTime?: number | null,
    setId: string,
    sightingCount?: number | null,
    updatedAt: string,
    userId: string,
    waitingTime?: number | null,
  } | null,
};

export type DeleteAnnotationMutationVariables = {
  condition?: ModelAnnotationConditionInput | null,
  input: DeleteAnnotationInput,
};

export type DeleteAnnotationMutation = {
  deleteAnnotation?:  {
    __typename: "Annotation",
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    object?:  {
      __typename: "Object",
      categoryId: string,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    objectId?: string | null,
    obscured?: boolean | null,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    setId: string,
    source: string,
    updatedAt: string,
    x: number,
    y: number,
  } | null,
};

export type DeleteAnnotationSetMutationVariables = {
  condition?: ModelAnnotationSetConditionInput | null,
  input: DeleteAnnotationSetInput,
};

export type DeleteAnnotationSetMutation = {
  deleteAnnotationSet?:  {
    __typename: "AnnotationSet",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    categories?:  {
      __typename: "ModelCategoryConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    register?: boolean | null,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    testPresetLocations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type DeleteCameraMutationVariables = {
  condition?: ModelCameraConditionInput | null,
  input: DeleteCameraInput,
};

export type DeleteCameraMutation = {
  deleteCamera?:  {
    __typename: "Camera",
    createdAt: string,
    focalLengthMm?: number | null,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    sensorWidthMm?: number | null,
    tiltDegrees?: number | null,
    updatedAt: string,
  } | null,
};

export type DeleteCameraOverlapMutationVariables = {
  condition?: ModelCameraOverlapConditionInput | null,
  input: DeleteCameraOverlapInput,
};

export type DeleteCameraOverlapMutation = {
  deleteCameraOverlap?:  {
    __typename: "CameraOverlap",
    cameraAId: string,
    cameraBId: string,
    createdAt: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type DeleteCategoryMutationVariables = {
  condition?: ModelCategoryConditionInput | null,
  input: DeleteCategoryInput,
};

export type DeleteCategoryMutation = {
  deleteCategory?:  {
    __typename: "Category",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    color?: string | null,
    createdAt: string,
    id: string,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    projectId: string,
    shortcutKey?: string | null,
    updatedAt: string,
  } | null,
};

export type DeleteClientLogMutationVariables = {
  condition?: ModelClientLogConditionInput | null,
  input: DeleteClientLogInput,
};

export type DeleteClientLogMutation = {
  deleteClientLog?:  {
    __typename: "ClientLog",
    connectionType?: string | null,
    createdAt: string,
    deviceType?: string | null,
    downlink?: number | null,
    id: string,
    ipAddress?: string | null,
    os?: string | null,
    rtt?: number | null,
    updatedAt: string,
    userAgent?: string | null,
    userId: string,
  } | null,
};

export type DeleteImageMutationVariables = {
  condition?: ModelImageConditionInput | null,
  input: DeleteImageInput,
};

export type DeleteImageMutation = {
  deleteImage?:  {
    __typename: "Image",
    altitude_agl?: number | null,
    altitude_egm96?: number | null,
    altitude_wgs84?: number | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    camera?:  {
      __typename: "Camera",
      createdAt: string,
      focalLengthMm?: number | null,
      id: string,
      name: string,
      projectId: string,
      sensorWidthMm?: number | null,
      tiltDegrees?: number | null,
      updatedAt: string,
    } | null,
    cameraId?: string | null,
    cameraSerial?: string | null,
    createdAt: string,
    exifData?: string | null,
    files?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    height: number,
    id: string,
    latitude?: number | null,
    leftNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    longitude?: number | null,
    memberships?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    originalPath?: string | null,
    pitch?: number | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    rightNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    roll?: number | null,
    timestamp?: number | null,
    transect?:  {
      __typename: "Transect",
      createdAt: string,
      id: string,
      projectId: string,
      stratumId: string,
      updatedAt: string,
    } | null,
    transectId?: string | null,
    updatedAt: string,
    width: number,
    yaw?: number | null,
  } | null,
};

export type DeleteImageFileMutationVariables = {
  condition?: ModelImageFileConditionInput | null,
  input: DeleteImageFileInput,
};

export type DeleteImageFileMutation = {
  deleteImageFile?:  {
    __typename: "ImageFile",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    key: string,
    path: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    type: string,
    updatedAt: string,
  } | null,
};

export type DeleteImageNeighbourMutationVariables = {
  condition?: ModelImageNeighbourConditionInput | null,
  input: DeleteImageNeighbourInput,
};

export type DeleteImageNeighbourMutation = {
  deleteImageNeighbour?:  {
    __typename: "ImageNeighbour",
    createdAt: string,
    homography?: Array< number | null > | null,
    image1?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image1Id: string,
    image2?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image2Id: string,
    updatedAt: string,
  } | null,
};

export type DeleteImageSetMutationVariables = {
  condition?: ModelImageSetConditionInput | null,
  input: DeleteImageSetInput,
};

export type DeleteImageSetMutation = {
  deleteImageSet?:  {
    __typename: "ImageSet",
    createdAt: string,
    id: string,
    imageCount?: number | null,
    images?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type DeleteImageSetMembershipMutationVariables = {
  condition?: ModelImageSetMembershipConditionInput | null,
  input: DeleteImageSetMembershipInput,
};

export type DeleteImageSetMembershipMutation = {
  deleteImageSetMembership?:  {
    __typename: "ImageSetMembership",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    imageSet?:  {
      __typename: "ImageSet",
      createdAt: string,
      id: string,
      imageCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    imageSetId: string,
    updatedAt: string,
  } | null,
};

export type DeleteJollyResultMutationVariables = {
  condition?: ModelJollyResultConditionInput | null,
  input: DeleteJollyResultInput,
};

export type DeleteJollyResultMutation = {
  deleteJollyResult?:  {
    __typename: "JollyResult",
    animals: number,
    annotationSetId: string,
    areaSurveyed: number,
    categoryId: string,
    createdAt: string,
    density: number,
    estimate: number,
    lowerBound95: number,
    numSamples: number,
    standardError: number,
    stratumId: string,
    surveyId: string,
    updatedAt: string,
    upperBound95: number,
    variance: number,
  } | null,
};

export type DeleteJollyResultsMembershipMutationVariables = {
  condition?: ModelJollyResultsMembershipConditionInput | null,
  input: DeleteJollyResultsMembershipInput,
};

export type DeleteJollyResultsMembershipMutation = {
  deleteJollyResultsMembership?:  {
    __typename: "JollyResultsMembership",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    survey?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    surveyId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type DeleteLocationMutationVariables = {
  condition?: ModelLocationConditionInput | null,
  input: DeleteLocationInput,
};

export type DeleteLocationMutation = {
  deleteLocation?:  {
    __typename: "Location",
    annotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    confidence?: number | null,
    createdAt: string,
    height?: number | null,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    setId: string,
    sets?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    source: string,
    testPresets?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
    width?: number | null,
    x: number,
    y: number,
  } | null,
};

export type DeleteLocationAnnotationCountMutationVariables = {
  condition?: ModelLocationAnnotationCountConditionInput | null,
  input: DeleteLocationAnnotationCountInput,
};

export type DeleteLocationAnnotationCountMutation = {
  deleteLocationAnnotationCount?:  {
    __typename: "LocationAnnotationCount",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    count?: number | null,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    updatedAt: string,
  } | null,
};

export type DeleteLocationSetMutationVariables = {
  condition?: ModelLocationSetConditionInput | null,
  input: DeleteLocationSetInput,
};

export type DeleteLocationSetMutation = {
  deleteLocationSet?:  {
    __typename: "LocationSet",
    createdAt: string,
    description?: string | null,
    id: string,
    locationCount?: number | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type DeleteLocationSetMembershipMutationVariables = {
  condition?: ModelLocationSetMembershipConditionInput | null,
  input: DeleteLocationSetMembershipInput,
};

export type DeleteLocationSetMembershipMutation = {
  deleteLocationSetMembership?:  {
    __typename: "LocationSetMembership",
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type DeleteObjectMutationVariables = {
  condition?: ModelObjectConditionInput | null,
  input: DeleteObjectInput,
};

export type DeleteObjectMutation = {
  deleteObject?:  {
    __typename: "Object",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type DeleteObservationMutationVariables = {
  condition?: ModelObservationConditionInput | null,
  input: DeleteObservationInput,
};

export type DeleteObservationMutation = {
  deleteObservation?:  {
    __typename: "Observation",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    loadingTime?: number | null,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    timeTaken?: number | null,
    updatedAt: string,
    waitingTime?: number | null,
  } | null,
};

export type DeleteOrganizationMutationVariables = {
  condition?: ModelOrganizationConditionInput | null,
  input: DeleteOrganizationInput,
};

export type DeleteOrganizationMutation = {
  deleteOrganization?:  {
    __typename: "Organization",
    createdAt: string,
    description?: string | null,
    id: string,
    invites?:  {
      __typename: "ModelOrganizationInviteConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelOrganizationMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    projects?:  {
      __typename: "ModelProjectConnection",
      nextToken?: string | null,
    } | null,
    testPresets?:  {
      __typename: "ModelTestPresetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type DeleteOrganizationInviteMutationVariables = {
  condition?: ModelOrganizationInviteConditionInput | null,
  input: DeleteOrganizationInviteInput,
};

export type DeleteOrganizationInviteMutation = {
  deleteOrganizationInvite?:  {
    __typename: "OrganizationInvite",
    createdAt: string,
    id: string,
    invitedBy: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    status?: string | null,
    updatedAt: string,
    username: string,
  } | null,
};

export type DeleteOrganizationMembershipMutationVariables = {
  condition?: ModelOrganizationMembershipConditionInput | null,
  input: DeleteOrganizationMembershipInput,
};

export type DeleteOrganizationMembershipMutation = {
  deleteOrganizationMembership?:  {
    __typename: "OrganizationMembership",
    createdAt: string,
    isAdmin?: boolean | null,
    isTested?: boolean | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type DeleteOrganizationRegistrationMutationVariables = {
  condition?: ModelOrganizationRegistrationConditionInput | null,
  input: DeleteOrganizationRegistrationInput,
};

export type DeleteOrganizationRegistrationMutation = {
  deleteOrganizationRegistration?:  {
    __typename: "OrganizationRegistration",
    briefDescription: string,
    createdAt: string,
    id: string,
    organizationName: string,
    requestedBy: string,
    status?: string | null,
    updatedAt: string,
  } | null,
};

export type DeleteProjectMutationVariables = {
  condition?: ModelProjectConditionInput | null,
  input: DeleteProjectInput,
};

export type DeleteProjectMutation = {
  deleteProject?:  {
    __typename: "Project",
    annotationSets?:  {
      __typename: "ModelAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    cameraOverlaps?:  {
      __typename: "ModelCameraOverlapConnection",
      nextToken?: string | null,
    } | null,
    cameras?:  {
      __typename: "ModelCameraConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    createdBy: string,
    hidden?: boolean | null,
    id: string,
    imageFiles?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    imageSets?:  {
      __typename: "ModelImageSetConnection",
      nextToken?: string | null,
    } | null,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationSets?:  {
      __typename: "ModelLocationSetConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    members?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    queues?:  {
      __typename: "ModelQueueConnection",
      nextToken?: string | null,
    } | null,
    shapefile?:  {
      __typename: "Shapefile",
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    shapefileExclusions?:  {
      __typename: "ModelShapefileExclusionsConnection",
      nextToken?: string | null,
    } | null,
    status?: string | null,
    strata?:  {
      __typename: "ModelStratumConnection",
      nextToken?: string | null,
    } | null,
    tags?: Array< string | null > | null,
    testConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type DeleteProjectInFullMutationVariables = {
  projectId: string,
};

export type DeleteProjectInFullMutation = {
  deleteProjectInFull?: string | null,
};

export type DeleteProjectTestConfigMutationVariables = {
  condition?: ModelProjectTestConfigConditionInput | null,
  input: DeleteProjectTestConfigInput,
};

export type DeleteProjectTestConfigMutation = {
  deleteProjectTestConfig?:  {
    __typename: "ProjectTestConfig",
    accuracy: number,
    createdAt: string,
    deadzone?: number | null,
    interval?: number | null,
    postTestConfirmation?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    random?: number | null,
    testPresetProjects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testType?: string | null,
    updatedAt: string,
  } | null,
};

export type DeleteQueueMutationVariables = {
  condition?: ModelQueueConditionInput | null,
  input: DeleteQueueInput,
};

export type DeleteQueueMutation = {
  deleteQueue?:  {
    __typename: "Queue",
    approximateSize?: number | null,
    backupUsers?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    batchSize?: number | null,
    createdAt: string,
    hidden?: boolean | null,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tag?: string | null,
    totalBatches?: number | null,
    updatedAt: string,
    url?: string | null,
    users?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    zoom?: number | null,
  } | null,
};

export type DeleteResultSharingTokenMutationVariables = {
  condition?: ModelResultSharingTokenConditionInput | null,
  input: DeleteResultSharingTokenInput,
};

export type DeleteResultSharingTokenMutation = {
  deleteResultSharingToken?:  {
    __typename: "ResultSharingToken",
    annotationSetId: string,
    createdAt: string,
    jwt: string,
    surveyId: string,
    updatedAt: string,
  } | null,
};

export type DeleteShapefileMutationVariables = {
  condition?: ModelShapefileConditionInput | null,
  input: DeleteShapefileInput,
};

export type DeleteShapefileMutation = {
  deleteShapefile?:  {
    __typename: "Shapefile",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type DeleteShapefileExclusionsMutationVariables = {
  condition?: ModelShapefileExclusionsConditionInput | null,
  input: DeleteShapefileExclusionsInput,
};

export type DeleteShapefileExclusionsMutation = {
  deleteShapefileExclusions?:  {
    __typename: "ShapefileExclusions",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type DeleteStratumMutationVariables = {
  condition?: ModelStratumConditionInput | null,
  input: DeleteStratumInput,
};

export type DeleteStratumMutation = {
  deleteStratum?:  {
    __typename: "Stratum",
    area?: number | null,
    baselineLength?: number | null,
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type DeleteTasksOnAnnotationSetMutationVariables = {
  condition?: ModelTasksOnAnnotationSetConditionInput | null,
  input: DeleteTasksOnAnnotationSetInput,
};

export type DeleteTasksOnAnnotationSetMutation = {
  deleteTasksOnAnnotationSet?:  {
    __typename: "TasksOnAnnotationSet",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type DeleteTestPresetMutationVariables = {
  condition?: ModelTestPresetConditionInput | null,
  input: DeleteTestPresetInput,
};

export type DeleteTestPresetMutation = {
  deleteTestPreset?:  {
    __typename: "TestPreset",
    createdAt: string,
    id: string,
    locations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    projects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type DeleteTestPresetLocationMutationVariables = {
  condition?: ModelTestPresetLocationConditionInput | null,
  input: DeleteTestPresetLocationInput,
};

export type DeleteTestPresetLocationMutation = {
  deleteTestPresetLocation?:  {
    __typename: "TestPresetLocation",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type DeleteTestPresetProjectMutationVariables = {
  condition?: ModelTestPresetProjectConditionInput | null,
  input: DeleteTestPresetProjectInput,
};

export type DeleteTestPresetProjectMutation = {
  deleteTestPresetProject?:  {
    __typename: "TestPresetProject",
    createdAt: string,
    projectConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type DeleteTestResultMutationVariables = {
  condition?: ModelTestResultConditionInput | null,
  input: DeleteTestResultInput,
};

export type DeleteTestResultMutation = {
  deleteTestResult?:  {
    __typename: "TestResult",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    categoryCounts?:  {
      __typename: "ModelTestResultCategoryCountConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    passedOnTotal: boolean,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testAnimals: number,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    totalMissedAnimals: number,
    updatedAt: string,
    userId: string,
  } | null,
};

export type DeleteTestResultCategoryCountMutationVariables = {
  condition?: ModelTestResultCategoryCountConditionInput | null,
  input: DeleteTestResultCategoryCountInput,
};

export type DeleteTestResultCategoryCountMutation = {
  deleteTestResultCategoryCount?:  {
    __typename: "TestResultCategoryCount",
    categoryName: string,
    createdAt: string,
    testCount: number,
    testResult?:  {
      __typename: "TestResult",
      annotationSetId: string,
      createdAt: string,
      id: string,
      locationId: string,
      passedOnTotal: boolean,
      projectId: string,
      testAnimals: number,
      testPresetId: string,
      totalMissedAnimals: number,
      updatedAt: string,
      userId: string,
    } | null,
    testResultId: string,
    updatedAt: string,
    userCount: number,
  } | null,
};

export type DeleteTransectMutationVariables = {
  condition?: ModelTransectConditionInput | null,
  input: DeleteTransectInput,
};

export type DeleteTransectMutation = {
  deleteTransect?:  {
    __typename: "Transect",
    createdAt: string,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    stratum?:  {
      __typename: "Stratum",
      area?: number | null,
      baselineLength?: number | null,
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    stratumId: string,
    updatedAt: string,
  } | null,
};

export type DeleteUserProjectMembershipMutationVariables = {
  condition?: ModelUserProjectMembershipConditionInput | null,
  input: DeleteUserProjectMembershipInput,
};

export type DeleteUserProjectMembershipMutation = {
  deleteUserProjectMembership?:  {
    __typename: "UserProjectMembership",
    backupQueue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    backupQueueId?: string | null,
    createdAt: string,
    id: string,
    isAdmin?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    queue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    queueId?: string | null,
    updatedAt: string,
    userId: string,
  } | null,
};

export type DeleteUserStatsMutationVariables = {
  condition?: ModelUserStatsConditionInput | null,
  input: DeleteUserStatsInput,
};

export type DeleteUserStatsMutation = {
  deleteUserStats?:  {
    __typename: "UserStats",
    activeTime: number,
    annotationCount: number,
    annotationTime?: number | null,
    createdAt: string,
    date: string,
    observationCount: number,
    projectId: string,
    searchCount?: number | null,
    searchTime?: number | null,
    setId: string,
    sightingCount?: number | null,
    updatedAt: string,
    userId: string,
    waitingTime?: number | null,
  } | null,
};

export type GenerateSurveyResultsMutationVariables = {
  annotationSetId: string,
  categoryIds: Array< string | null >,
  surveyId: string,
};

export type GenerateSurveyResultsMutation = {
  generateSurveyResults?: string | null,
};

export type GetJwtSecretMutationVariables = {
};

export type GetJwtSecretMutation = {
  getJwtSecret?: string | null,
};

export type ProcessImagesMutationVariables = {
  model: string,
  s3key: string,
  threshold?: number | null,
};

export type ProcessImagesMutation = {
  processImages?: string | null,
};

export type PublishMutationVariables = {
  channelName: string,
  content: string,
};

export type PublishMutation = {
  publish?:  {
    __typename: "Message",
    channelName: string,
    content: string,
  } | null,
};

export type RemoveUserFromGroupMutationVariables = {
  groupName: string,
  userId: string,
};

export type RemoveUserFromGroupMutation = {
  removeUserFromGroup?: string | null,
};

export type RunHeatmapperMutationVariables = {
  images?: Array< string | null > | null,
};

export type RunHeatmapperMutation = {
  runHeatmapper?: string | null,
};

export type RunImageRegistrationMutationVariables = {
  metadata: string,
  projectId: string,
  queueUrl: string,
};

export type RunImageRegistrationMutation = {
  runImageRegistration?: string | null,
};

export type RunMadDetectorMutationVariables = {
  bucket: string,
  images?: Array< string | null > | null,
  projectId: string,
  queueUrl: string,
  setId: string,
};

export type RunMadDetectorMutation = {
  runMadDetector?: string | null,
};

export type RunScoutbotMutationVariables = {
  bucket: string,
  images?: Array< string | null > | null,
  projectId: string,
  queueUrl: string,
  setId: string,
};

export type RunScoutbotMutation = {
  runScoutbot?: string | null,
};

export type UpdateAnnotationMutationVariables = {
  condition?: ModelAnnotationConditionInput | null,
  input: UpdateAnnotationInput,
};

export type UpdateAnnotationMutation = {
  updateAnnotation?:  {
    __typename: "Annotation",
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    object?:  {
      __typename: "Object",
      categoryId: string,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    objectId?: string | null,
    obscured?: boolean | null,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    setId: string,
    source: string,
    updatedAt: string,
    x: number,
    y: number,
  } | null,
};

export type UpdateAnnotationSetMutationVariables = {
  condition?: ModelAnnotationSetConditionInput | null,
  input: UpdateAnnotationSetInput,
};

export type UpdateAnnotationSetMutation = {
  updateAnnotationSet?:  {
    __typename: "AnnotationSet",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    categories?:  {
      __typename: "ModelCategoryConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    register?: boolean | null,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    testPresetLocations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type UpdateCameraMutationVariables = {
  condition?: ModelCameraConditionInput | null,
  input: UpdateCameraInput,
};

export type UpdateCameraMutation = {
  updateCamera?:  {
    __typename: "Camera",
    createdAt: string,
    focalLengthMm?: number | null,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    sensorWidthMm?: number | null,
    tiltDegrees?: number | null,
    updatedAt: string,
  } | null,
};

export type UpdateCameraOverlapMutationVariables = {
  condition?: ModelCameraOverlapConditionInput | null,
  input: UpdateCameraOverlapInput,
};

export type UpdateCameraOverlapMutation = {
  updateCameraOverlap?:  {
    __typename: "CameraOverlap",
    cameraAId: string,
    cameraBId: string,
    createdAt: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type UpdateCategoryMutationVariables = {
  condition?: ModelCategoryConditionInput | null,
  input: UpdateCategoryInput,
};

export type UpdateCategoryMutation = {
  updateCategory?:  {
    __typename: "Category",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    color?: string | null,
    createdAt: string,
    id: string,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    projectId: string,
    shortcutKey?: string | null,
    updatedAt: string,
  } | null,
};

export type UpdateClientLogMutationVariables = {
  condition?: ModelClientLogConditionInput | null,
  input: UpdateClientLogInput,
};

export type UpdateClientLogMutation = {
  updateClientLog?:  {
    __typename: "ClientLog",
    connectionType?: string | null,
    createdAt: string,
    deviceType?: string | null,
    downlink?: number | null,
    id: string,
    ipAddress?: string | null,
    os?: string | null,
    rtt?: number | null,
    updatedAt: string,
    userAgent?: string | null,
    userId: string,
  } | null,
};

export type UpdateImageMutationVariables = {
  condition?: ModelImageConditionInput | null,
  input: UpdateImageInput,
};

export type UpdateImageMutation = {
  updateImage?:  {
    __typename: "Image",
    altitude_agl?: number | null,
    altitude_egm96?: number | null,
    altitude_wgs84?: number | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    camera?:  {
      __typename: "Camera",
      createdAt: string,
      focalLengthMm?: number | null,
      id: string,
      name: string,
      projectId: string,
      sensorWidthMm?: number | null,
      tiltDegrees?: number | null,
      updatedAt: string,
    } | null,
    cameraId?: string | null,
    cameraSerial?: string | null,
    createdAt: string,
    exifData?: string | null,
    files?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    height: number,
    id: string,
    latitude?: number | null,
    leftNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    longitude?: number | null,
    memberships?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    originalPath?: string | null,
    pitch?: number | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    rightNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    roll?: number | null,
    timestamp?: number | null,
    transect?:  {
      __typename: "Transect",
      createdAt: string,
      id: string,
      projectId: string,
      stratumId: string,
      updatedAt: string,
    } | null,
    transectId?: string | null,
    updatedAt: string,
    width: number,
    yaw?: number | null,
  } | null,
};

export type UpdateImageFileMutationVariables = {
  condition?: ModelImageFileConditionInput | null,
  input: UpdateImageFileInput,
};

export type UpdateImageFileMutation = {
  updateImageFile?:  {
    __typename: "ImageFile",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    key: string,
    path: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    type: string,
    updatedAt: string,
  } | null,
};

export type UpdateImageNeighbourMutationVariables = {
  condition?: ModelImageNeighbourConditionInput | null,
  input: UpdateImageNeighbourInput,
};

export type UpdateImageNeighbourMutation = {
  updateImageNeighbour?:  {
    __typename: "ImageNeighbour",
    createdAt: string,
    homography?: Array< number | null > | null,
    image1?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image1Id: string,
    image2?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image2Id: string,
    updatedAt: string,
  } | null,
};

export type UpdateImageSetMutationVariables = {
  condition?: ModelImageSetConditionInput | null,
  input: UpdateImageSetInput,
};

export type UpdateImageSetMutation = {
  updateImageSet?:  {
    __typename: "ImageSet",
    createdAt: string,
    id: string,
    imageCount?: number | null,
    images?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type UpdateImageSetMembershipMutationVariables = {
  condition?: ModelImageSetMembershipConditionInput | null,
  input: UpdateImageSetMembershipInput,
};

export type UpdateImageSetMembershipMutation = {
  updateImageSetMembership?:  {
    __typename: "ImageSetMembership",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    imageSet?:  {
      __typename: "ImageSet",
      createdAt: string,
      id: string,
      imageCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    imageSetId: string,
    updatedAt: string,
  } | null,
};

export type UpdateJollyResultMutationVariables = {
  condition?: ModelJollyResultConditionInput | null,
  input: UpdateJollyResultInput,
};

export type UpdateJollyResultMutation = {
  updateJollyResult?:  {
    __typename: "JollyResult",
    animals: number,
    annotationSetId: string,
    areaSurveyed: number,
    categoryId: string,
    createdAt: string,
    density: number,
    estimate: number,
    lowerBound95: number,
    numSamples: number,
    standardError: number,
    stratumId: string,
    surveyId: string,
    updatedAt: string,
    upperBound95: number,
    variance: number,
  } | null,
};

export type UpdateJollyResultsMembershipMutationVariables = {
  condition?: ModelJollyResultsMembershipConditionInput | null,
  input: UpdateJollyResultsMembershipInput,
};

export type UpdateJollyResultsMembershipMutation = {
  updateJollyResultsMembership?:  {
    __typename: "JollyResultsMembership",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    survey?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    surveyId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type UpdateLocationMutationVariables = {
  condition?: ModelLocationConditionInput | null,
  input: UpdateLocationInput,
};

export type UpdateLocationMutation = {
  updateLocation?:  {
    __typename: "Location",
    annotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    confidence?: number | null,
    createdAt: string,
    height?: number | null,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    setId: string,
    sets?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    source: string,
    testPresets?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
    width?: number | null,
    x: number,
    y: number,
  } | null,
};

export type UpdateLocationAnnotationCountMutationVariables = {
  condition?: ModelLocationAnnotationCountConditionInput | null,
  input: UpdateLocationAnnotationCountInput,
};

export type UpdateLocationAnnotationCountMutation = {
  updateLocationAnnotationCount?:  {
    __typename: "LocationAnnotationCount",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    count?: number | null,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    updatedAt: string,
  } | null,
};

export type UpdateLocationSetMutationVariables = {
  condition?: ModelLocationSetConditionInput | null,
  input: UpdateLocationSetInput,
};

export type UpdateLocationSetMutation = {
  updateLocationSet?:  {
    __typename: "LocationSet",
    createdAt: string,
    description?: string | null,
    id: string,
    locationCount?: number | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type UpdateLocationSetMembershipMutationVariables = {
  condition?: ModelLocationSetMembershipConditionInput | null,
  input: UpdateLocationSetMembershipInput,
};

export type UpdateLocationSetMembershipMutation = {
  updateLocationSetMembership?:  {
    __typename: "LocationSetMembership",
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type UpdateObjectMutationVariables = {
  condition?: ModelObjectConditionInput | null,
  input: UpdateObjectInput,
};

export type UpdateObjectMutation = {
  updateObject?:  {
    __typename: "Object",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type UpdateObservationMutationVariables = {
  condition?: ModelObservationConditionInput | null,
  input: UpdateObservationInput,
};

export type UpdateObservationMutation = {
  updateObservation?:  {
    __typename: "Observation",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    loadingTime?: number | null,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    timeTaken?: number | null,
    updatedAt: string,
    waitingTime?: number | null,
  } | null,
};

export type UpdateOrganizationMutationVariables = {
  condition?: ModelOrganizationConditionInput | null,
  input: UpdateOrganizationInput,
};

export type UpdateOrganizationMutation = {
  updateOrganization?:  {
    __typename: "Organization",
    createdAt: string,
    description?: string | null,
    id: string,
    invites?:  {
      __typename: "ModelOrganizationInviteConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelOrganizationMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    projects?:  {
      __typename: "ModelProjectConnection",
      nextToken?: string | null,
    } | null,
    testPresets?:  {
      __typename: "ModelTestPresetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type UpdateOrganizationInviteMutationVariables = {
  condition?: ModelOrganizationInviteConditionInput | null,
  input: UpdateOrganizationInviteInput,
};

export type UpdateOrganizationInviteMutation = {
  updateOrganizationInvite?:  {
    __typename: "OrganizationInvite",
    createdAt: string,
    id: string,
    invitedBy: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    status?: string | null,
    updatedAt: string,
    username: string,
  } | null,
};

export type UpdateOrganizationMembershipMutationVariables = {
  condition?: ModelOrganizationMembershipConditionInput | null,
  input: UpdateOrganizationMembershipInput,
};

export type UpdateOrganizationMembershipMutation = {
  updateOrganizationMembership?:  {
    __typename: "OrganizationMembership",
    createdAt: string,
    isAdmin?: boolean | null,
    isTested?: boolean | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type UpdateOrganizationRegistrationMutationVariables = {
  condition?: ModelOrganizationRegistrationConditionInput | null,
  input: UpdateOrganizationRegistrationInput,
};

export type UpdateOrganizationRegistrationMutation = {
  updateOrganizationRegistration?:  {
    __typename: "OrganizationRegistration",
    briefDescription: string,
    createdAt: string,
    id: string,
    organizationName: string,
    requestedBy: string,
    status?: string | null,
    updatedAt: string,
  } | null,
};

export type UpdateProjectMutationVariables = {
  condition?: ModelProjectConditionInput | null,
  input: UpdateProjectInput,
};

export type UpdateProjectMutation = {
  updateProject?:  {
    __typename: "Project",
    annotationSets?:  {
      __typename: "ModelAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    cameraOverlaps?:  {
      __typename: "ModelCameraOverlapConnection",
      nextToken?: string | null,
    } | null,
    cameras?:  {
      __typename: "ModelCameraConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    createdBy: string,
    hidden?: boolean | null,
    id: string,
    imageFiles?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    imageSets?:  {
      __typename: "ModelImageSetConnection",
      nextToken?: string | null,
    } | null,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationSets?:  {
      __typename: "ModelLocationSetConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    members?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    queues?:  {
      __typename: "ModelQueueConnection",
      nextToken?: string | null,
    } | null,
    shapefile?:  {
      __typename: "Shapefile",
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    shapefileExclusions?:  {
      __typename: "ModelShapefileExclusionsConnection",
      nextToken?: string | null,
    } | null,
    status?: string | null,
    strata?:  {
      __typename: "ModelStratumConnection",
      nextToken?: string | null,
    } | null,
    tags?: Array< string | null > | null,
    testConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type UpdateProjectMembershipsMutationVariables = {
  projectId: string,
};

export type UpdateProjectMembershipsMutation = {
  updateProjectMemberships?: string | null,
};

export type UpdateProjectTestConfigMutationVariables = {
  condition?: ModelProjectTestConfigConditionInput | null,
  input: UpdateProjectTestConfigInput,
};

export type UpdateProjectTestConfigMutation = {
  updateProjectTestConfig?:  {
    __typename: "ProjectTestConfig",
    accuracy: number,
    createdAt: string,
    deadzone?: number | null,
    interval?: number | null,
    postTestConfirmation?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    random?: number | null,
    testPresetProjects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testType?: string | null,
    updatedAt: string,
  } | null,
};

export type UpdateQueueMutationVariables = {
  condition?: ModelQueueConditionInput | null,
  input: UpdateQueueInput,
};

export type UpdateQueueMutation = {
  updateQueue?:  {
    __typename: "Queue",
    approximateSize?: number | null,
    backupUsers?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    batchSize?: number | null,
    createdAt: string,
    hidden?: boolean | null,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tag?: string | null,
    totalBatches?: number | null,
    updatedAt: string,
    url?: string | null,
    users?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    zoom?: number | null,
  } | null,
};

export type UpdateResultSharingTokenMutationVariables = {
  condition?: ModelResultSharingTokenConditionInput | null,
  input: UpdateResultSharingTokenInput,
};

export type UpdateResultSharingTokenMutation = {
  updateResultSharingToken?:  {
    __typename: "ResultSharingToken",
    annotationSetId: string,
    createdAt: string,
    jwt: string,
    surveyId: string,
    updatedAt: string,
  } | null,
};

export type UpdateShapefileMutationVariables = {
  condition?: ModelShapefileConditionInput | null,
  input: UpdateShapefileInput,
};

export type UpdateShapefileMutation = {
  updateShapefile?:  {
    __typename: "Shapefile",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type UpdateShapefileExclusionsMutationVariables = {
  condition?: ModelShapefileExclusionsConditionInput | null,
  input: UpdateShapefileExclusionsInput,
};

export type UpdateShapefileExclusionsMutation = {
  updateShapefileExclusions?:  {
    __typename: "ShapefileExclusions",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type UpdateStratumMutationVariables = {
  condition?: ModelStratumConditionInput | null,
  input: UpdateStratumInput,
};

export type UpdateStratumMutation = {
  updateStratum?:  {
    __typename: "Stratum",
    area?: number | null,
    baselineLength?: number | null,
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type UpdateTasksOnAnnotationSetMutationVariables = {
  condition?: ModelTasksOnAnnotationSetConditionInput | null,
  input: UpdateTasksOnAnnotationSetInput,
};

export type UpdateTasksOnAnnotationSetMutation = {
  updateTasksOnAnnotationSet?:  {
    __typename: "TasksOnAnnotationSet",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type UpdateTestPresetMutationVariables = {
  condition?: ModelTestPresetConditionInput | null,
  input: UpdateTestPresetInput,
};

export type UpdateTestPresetMutation = {
  updateTestPreset?:  {
    __typename: "TestPreset",
    createdAt: string,
    id: string,
    locations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    projects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type UpdateTestPresetLocationMutationVariables = {
  condition?: ModelTestPresetLocationConditionInput | null,
  input: UpdateTestPresetLocationInput,
};

export type UpdateTestPresetLocationMutation = {
  updateTestPresetLocation?:  {
    __typename: "TestPresetLocation",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type UpdateTestPresetProjectMutationVariables = {
  condition?: ModelTestPresetProjectConditionInput | null,
  input: UpdateTestPresetProjectInput,
};

export type UpdateTestPresetProjectMutation = {
  updateTestPresetProject?:  {
    __typename: "TestPresetProject",
    createdAt: string,
    projectConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type UpdateTestResultMutationVariables = {
  condition?: ModelTestResultConditionInput | null,
  input: UpdateTestResultInput,
};

export type UpdateTestResultMutation = {
  updateTestResult?:  {
    __typename: "TestResult",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    categoryCounts?:  {
      __typename: "ModelTestResultCategoryCountConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    passedOnTotal: boolean,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testAnimals: number,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    totalMissedAnimals: number,
    updatedAt: string,
    userId: string,
  } | null,
};

export type UpdateTestResultCategoryCountMutationVariables = {
  condition?: ModelTestResultCategoryCountConditionInput | null,
  input: UpdateTestResultCategoryCountInput,
};

export type UpdateTestResultCategoryCountMutation = {
  updateTestResultCategoryCount?:  {
    __typename: "TestResultCategoryCount",
    categoryName: string,
    createdAt: string,
    testCount: number,
    testResult?:  {
      __typename: "TestResult",
      annotationSetId: string,
      createdAt: string,
      id: string,
      locationId: string,
      passedOnTotal: boolean,
      projectId: string,
      testAnimals: number,
      testPresetId: string,
      totalMissedAnimals: number,
      updatedAt: string,
      userId: string,
    } | null,
    testResultId: string,
    updatedAt: string,
    userCount: number,
  } | null,
};

export type UpdateTransectMutationVariables = {
  condition?: ModelTransectConditionInput | null,
  input: UpdateTransectInput,
};

export type UpdateTransectMutation = {
  updateTransect?:  {
    __typename: "Transect",
    createdAt: string,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    stratum?:  {
      __typename: "Stratum",
      area?: number | null,
      baselineLength?: number | null,
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    stratumId: string,
    updatedAt: string,
  } | null,
};

export type UpdateUserProjectMembershipMutationVariables = {
  condition?: ModelUserProjectMembershipConditionInput | null,
  input: UpdateUserProjectMembershipInput,
};

export type UpdateUserProjectMembershipMutation = {
  updateUserProjectMembership?:  {
    __typename: "UserProjectMembership",
    backupQueue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    backupQueueId?: string | null,
    createdAt: string,
    id: string,
    isAdmin?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    queue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    queueId?: string | null,
    updatedAt: string,
    userId: string,
  } | null,
};

export type UpdateUserStatsMutationVariables = {
  condition?: ModelUserStatsConditionInput | null,
  input: UpdateUserStatsInput,
};

export type UpdateUserStatsMutation = {
  updateUserStats?:  {
    __typename: "UserStats",
    activeTime: number,
    annotationCount: number,
    annotationTime?: number | null,
    createdAt: string,
    date: string,
    observationCount: number,
    projectId: string,
    searchCount?: number | null,
    searchTime?: number | null,
    setId: string,
    sightingCount?: number | null,
    updatedAt: string,
    userId: string,
    waitingTime?: number | null,
  } | null,
};

export type OnCreateAnnotationSubscriptionVariables = {
  filter?: ModelSubscriptionAnnotationFilterInput | null,
  owner?: string | null,
};

export type OnCreateAnnotationSubscription = {
  onCreateAnnotation?:  {
    __typename: "Annotation",
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    object?:  {
      __typename: "Object",
      categoryId: string,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    objectId?: string | null,
    obscured?: boolean | null,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    setId: string,
    source: string,
    updatedAt: string,
    x: number,
    y: number,
  } | null,
};

export type OnCreateAnnotationSetSubscriptionVariables = {
  filter?: ModelSubscriptionAnnotationSetFilterInput | null,
};

export type OnCreateAnnotationSetSubscription = {
  onCreateAnnotationSet?:  {
    __typename: "AnnotationSet",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    categories?:  {
      __typename: "ModelCategoryConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    register?: boolean | null,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    testPresetLocations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnCreateCameraSubscriptionVariables = {
  filter?: ModelSubscriptionCameraFilterInput | null,
};

export type OnCreateCameraSubscription = {
  onCreateCamera?:  {
    __typename: "Camera",
    createdAt: string,
    focalLengthMm?: number | null,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    sensorWidthMm?: number | null,
    tiltDegrees?: number | null,
    updatedAt: string,
  } | null,
};

export type OnCreateCameraOverlapSubscriptionVariables = {
  filter?: ModelSubscriptionCameraOverlapFilterInput | null,
};

export type OnCreateCameraOverlapSubscription = {
  onCreateCameraOverlap?:  {
    __typename: "CameraOverlap",
    cameraAId: string,
    cameraBId: string,
    createdAt: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnCreateCategorySubscriptionVariables = {
  filter?: ModelSubscriptionCategoryFilterInput | null,
};

export type OnCreateCategorySubscription = {
  onCreateCategory?:  {
    __typename: "Category",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    color?: string | null,
    createdAt: string,
    id: string,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    projectId: string,
    shortcutKey?: string | null,
    updatedAt: string,
  } | null,
};

export type OnCreateClientLogSubscriptionVariables = {
  filter?: ModelSubscriptionClientLogFilterInput | null,
};

export type OnCreateClientLogSubscription = {
  onCreateClientLog?:  {
    __typename: "ClientLog",
    connectionType?: string | null,
    createdAt: string,
    deviceType?: string | null,
    downlink?: number | null,
    id: string,
    ipAddress?: string | null,
    os?: string | null,
    rtt?: number | null,
    updatedAt: string,
    userAgent?: string | null,
    userId: string,
  } | null,
};

export type OnCreateImageSubscriptionVariables = {
  filter?: ModelSubscriptionImageFilterInput | null,
};

export type OnCreateImageSubscription = {
  onCreateImage?:  {
    __typename: "Image",
    altitude_agl?: number | null,
    altitude_egm96?: number | null,
    altitude_wgs84?: number | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    camera?:  {
      __typename: "Camera",
      createdAt: string,
      focalLengthMm?: number | null,
      id: string,
      name: string,
      projectId: string,
      sensorWidthMm?: number | null,
      tiltDegrees?: number | null,
      updatedAt: string,
    } | null,
    cameraId?: string | null,
    cameraSerial?: string | null,
    createdAt: string,
    exifData?: string | null,
    files?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    height: number,
    id: string,
    latitude?: number | null,
    leftNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    longitude?: number | null,
    memberships?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    originalPath?: string | null,
    pitch?: number | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    rightNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    roll?: number | null,
    timestamp?: number | null,
    transect?:  {
      __typename: "Transect",
      createdAt: string,
      id: string,
      projectId: string,
      stratumId: string,
      updatedAt: string,
    } | null,
    transectId?: string | null,
    updatedAt: string,
    width: number,
    yaw?: number | null,
  } | null,
};

export type OnCreateImageFileSubscriptionVariables = {
  filter?: ModelSubscriptionImageFileFilterInput | null,
};

export type OnCreateImageFileSubscription = {
  onCreateImageFile?:  {
    __typename: "ImageFile",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    key: string,
    path: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    type: string,
    updatedAt: string,
  } | null,
};

export type OnCreateImageNeighbourSubscriptionVariables = {
  filter?: ModelSubscriptionImageNeighbourFilterInput | null,
};

export type OnCreateImageNeighbourSubscription = {
  onCreateImageNeighbour?:  {
    __typename: "ImageNeighbour",
    createdAt: string,
    homography?: Array< number | null > | null,
    image1?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image1Id: string,
    image2?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image2Id: string,
    updatedAt: string,
  } | null,
};

export type OnCreateImageSetSubscriptionVariables = {
  filter?: ModelSubscriptionImageSetFilterInput | null,
};

export type OnCreateImageSetSubscription = {
  onCreateImageSet?:  {
    __typename: "ImageSet",
    createdAt: string,
    id: string,
    imageCount?: number | null,
    images?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnCreateImageSetMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionImageSetMembershipFilterInput | null,
};

export type OnCreateImageSetMembershipSubscription = {
  onCreateImageSetMembership?:  {
    __typename: "ImageSetMembership",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    imageSet?:  {
      __typename: "ImageSet",
      createdAt: string,
      id: string,
      imageCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    imageSetId: string,
    updatedAt: string,
  } | null,
};

export type OnCreateJollyResultSubscriptionVariables = {
  filter?: ModelSubscriptionJollyResultFilterInput | null,
};

export type OnCreateJollyResultSubscription = {
  onCreateJollyResult?:  {
    __typename: "JollyResult",
    animals: number,
    annotationSetId: string,
    areaSurveyed: number,
    categoryId: string,
    createdAt: string,
    density: number,
    estimate: number,
    lowerBound95: number,
    numSamples: number,
    standardError: number,
    stratumId: string,
    surveyId: string,
    updatedAt: string,
    upperBound95: number,
    variance: number,
  } | null,
};

export type OnCreateJollyResultsMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionJollyResultsMembershipFilterInput | null,
};

export type OnCreateJollyResultsMembershipSubscription = {
  onCreateJollyResultsMembership?:  {
    __typename: "JollyResultsMembership",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    survey?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    surveyId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type OnCreateLocationSubscriptionVariables = {
  filter?: ModelSubscriptionLocationFilterInput | null,
};

export type OnCreateLocationSubscription = {
  onCreateLocation?:  {
    __typename: "Location",
    annotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    confidence?: number | null,
    createdAt: string,
    height?: number | null,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    setId: string,
    sets?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    source: string,
    testPresets?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
    width?: number | null,
    x: number,
    y: number,
  } | null,
};

export type OnCreateLocationAnnotationCountSubscriptionVariables = {
  filter?: ModelSubscriptionLocationAnnotationCountFilterInput | null,
};

export type OnCreateLocationAnnotationCountSubscription = {
  onCreateLocationAnnotationCount?:  {
    __typename: "LocationAnnotationCount",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    count?: number | null,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    updatedAt: string,
  } | null,
};

export type OnCreateLocationSetSubscriptionVariables = {
  filter?: ModelSubscriptionLocationSetFilterInput | null,
};

export type OnCreateLocationSetSubscription = {
  onCreateLocationSet?:  {
    __typename: "LocationSet",
    createdAt: string,
    description?: string | null,
    id: string,
    locationCount?: number | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnCreateLocationSetMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionLocationSetMembershipFilterInput | null,
};

export type OnCreateLocationSetMembershipSubscription = {
  onCreateLocationSetMembership?:  {
    __typename: "LocationSetMembership",
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type OnCreateObjectSubscriptionVariables = {
  filter?: ModelSubscriptionObjectFilterInput | null,
};

export type OnCreateObjectSubscription = {
  onCreateObject?:  {
    __typename: "Object",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnCreateObservationSubscriptionVariables = {
  filter?: ModelSubscriptionObservationFilterInput | null,
  owner?: string | null,
};

export type OnCreateObservationSubscription = {
  onCreateObservation?:  {
    __typename: "Observation",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    loadingTime?: number | null,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    timeTaken?: number | null,
    updatedAt: string,
    waitingTime?: number | null,
  } | null,
};

export type OnCreateOrganizationSubscriptionVariables = {
  filter?: ModelSubscriptionOrganizationFilterInput | null,
};

export type OnCreateOrganizationSubscription = {
  onCreateOrganization?:  {
    __typename: "Organization",
    createdAt: string,
    description?: string | null,
    id: string,
    invites?:  {
      __typename: "ModelOrganizationInviteConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelOrganizationMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    projects?:  {
      __typename: "ModelProjectConnection",
      nextToken?: string | null,
    } | null,
    testPresets?:  {
      __typename: "ModelTestPresetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnCreateOrganizationInviteSubscriptionVariables = {
  filter?: ModelSubscriptionOrganizationInviteFilterInput | null,
};

export type OnCreateOrganizationInviteSubscription = {
  onCreateOrganizationInvite?:  {
    __typename: "OrganizationInvite",
    createdAt: string,
    id: string,
    invitedBy: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    status?: string | null,
    updatedAt: string,
    username: string,
  } | null,
};

export type OnCreateOrganizationMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionOrganizationMembershipFilterInput | null,
};

export type OnCreateOrganizationMembershipSubscription = {
  onCreateOrganizationMembership?:  {
    __typename: "OrganizationMembership",
    createdAt: string,
    isAdmin?: boolean | null,
    isTested?: boolean | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type OnCreateOrganizationRegistrationSubscriptionVariables = {
  filter?: ModelSubscriptionOrganizationRegistrationFilterInput | null,
};

export type OnCreateOrganizationRegistrationSubscription = {
  onCreateOrganizationRegistration?:  {
    __typename: "OrganizationRegistration",
    briefDescription: string,
    createdAt: string,
    id: string,
    organizationName: string,
    requestedBy: string,
    status?: string | null,
    updatedAt: string,
  } | null,
};

export type OnCreateProjectSubscriptionVariables = {
  filter?: ModelSubscriptionProjectFilterInput | null,
};

export type OnCreateProjectSubscription = {
  onCreateProject?:  {
    __typename: "Project",
    annotationSets?:  {
      __typename: "ModelAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    cameraOverlaps?:  {
      __typename: "ModelCameraOverlapConnection",
      nextToken?: string | null,
    } | null,
    cameras?:  {
      __typename: "ModelCameraConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    createdBy: string,
    hidden?: boolean | null,
    id: string,
    imageFiles?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    imageSets?:  {
      __typename: "ModelImageSetConnection",
      nextToken?: string | null,
    } | null,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationSets?:  {
      __typename: "ModelLocationSetConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    members?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    queues?:  {
      __typename: "ModelQueueConnection",
      nextToken?: string | null,
    } | null,
    shapefile?:  {
      __typename: "Shapefile",
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    shapefileExclusions?:  {
      __typename: "ModelShapefileExclusionsConnection",
      nextToken?: string | null,
    } | null,
    status?: string | null,
    strata?:  {
      __typename: "ModelStratumConnection",
      nextToken?: string | null,
    } | null,
    tags?: Array< string | null > | null,
    testConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnCreateProjectTestConfigSubscriptionVariables = {
  filter?: ModelSubscriptionProjectTestConfigFilterInput | null,
};

export type OnCreateProjectTestConfigSubscription = {
  onCreateProjectTestConfig?:  {
    __typename: "ProjectTestConfig",
    accuracy: number,
    createdAt: string,
    deadzone?: number | null,
    interval?: number | null,
    postTestConfirmation?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    random?: number | null,
    testPresetProjects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testType?: string | null,
    updatedAt: string,
  } | null,
};

export type OnCreateQueueSubscriptionVariables = {
  filter?: ModelSubscriptionQueueFilterInput | null,
};

export type OnCreateQueueSubscription = {
  onCreateQueue?:  {
    __typename: "Queue",
    approximateSize?: number | null,
    backupUsers?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    batchSize?: number | null,
    createdAt: string,
    hidden?: boolean | null,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tag?: string | null,
    totalBatches?: number | null,
    updatedAt: string,
    url?: string | null,
    users?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    zoom?: number | null,
  } | null,
};

export type OnCreateResultSharingTokenSubscriptionVariables = {
  filter?: ModelSubscriptionResultSharingTokenFilterInput | null,
};

export type OnCreateResultSharingTokenSubscription = {
  onCreateResultSharingToken?:  {
    __typename: "ResultSharingToken",
    annotationSetId: string,
    createdAt: string,
    jwt: string,
    surveyId: string,
    updatedAt: string,
  } | null,
};

export type OnCreateShapefileSubscriptionVariables = {
  filter?: ModelSubscriptionShapefileFilterInput | null,
};

export type OnCreateShapefileSubscription = {
  onCreateShapefile?:  {
    __typename: "Shapefile",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnCreateShapefileExclusionsSubscriptionVariables = {
  filter?: ModelSubscriptionShapefileExclusionsFilterInput | null,
};

export type OnCreateShapefileExclusionsSubscription = {
  onCreateShapefileExclusions?:  {
    __typename: "ShapefileExclusions",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnCreateStratumSubscriptionVariables = {
  filter?: ModelSubscriptionStratumFilterInput | null,
};

export type OnCreateStratumSubscription = {
  onCreateStratum?:  {
    __typename: "Stratum",
    area?: number | null,
    baselineLength?: number | null,
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnCreateTasksOnAnnotationSetSubscriptionVariables = {
  filter?: ModelSubscriptionTasksOnAnnotationSetFilterInput | null,
};

export type OnCreateTasksOnAnnotationSetSubscription = {
  onCreateTasksOnAnnotationSet?:  {
    __typename: "TasksOnAnnotationSet",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type OnCreateTestPresetSubscriptionVariables = {
  filter?: ModelSubscriptionTestPresetFilterInput | null,
};

export type OnCreateTestPresetSubscription = {
  onCreateTestPreset?:  {
    __typename: "TestPreset",
    createdAt: string,
    id: string,
    locations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    projects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnCreateTestPresetLocationSubscriptionVariables = {
  filter?: ModelSubscriptionTestPresetLocationFilterInput | null,
};

export type OnCreateTestPresetLocationSubscription = {
  onCreateTestPresetLocation?:  {
    __typename: "TestPresetLocation",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type OnCreateTestPresetProjectSubscriptionVariables = {
  filter?: ModelSubscriptionTestPresetProjectFilterInput | null,
};

export type OnCreateTestPresetProjectSubscription = {
  onCreateTestPresetProject?:  {
    __typename: "TestPresetProject",
    createdAt: string,
    projectConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type OnCreateTestResultSubscriptionVariables = {
  filter?: ModelSubscriptionTestResultFilterInput | null,
};

export type OnCreateTestResultSubscription = {
  onCreateTestResult?:  {
    __typename: "TestResult",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    categoryCounts?:  {
      __typename: "ModelTestResultCategoryCountConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    passedOnTotal: boolean,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testAnimals: number,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    totalMissedAnimals: number,
    updatedAt: string,
    userId: string,
  } | null,
};

export type OnCreateTestResultCategoryCountSubscriptionVariables = {
  filter?: ModelSubscriptionTestResultCategoryCountFilterInput | null,
};

export type OnCreateTestResultCategoryCountSubscription = {
  onCreateTestResultCategoryCount?:  {
    __typename: "TestResultCategoryCount",
    categoryName: string,
    createdAt: string,
    testCount: number,
    testResult?:  {
      __typename: "TestResult",
      annotationSetId: string,
      createdAt: string,
      id: string,
      locationId: string,
      passedOnTotal: boolean,
      projectId: string,
      testAnimals: number,
      testPresetId: string,
      totalMissedAnimals: number,
      updatedAt: string,
      userId: string,
    } | null,
    testResultId: string,
    updatedAt: string,
    userCount: number,
  } | null,
};

export type OnCreateTransectSubscriptionVariables = {
  filter?: ModelSubscriptionTransectFilterInput | null,
};

export type OnCreateTransectSubscription = {
  onCreateTransect?:  {
    __typename: "Transect",
    createdAt: string,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    stratum?:  {
      __typename: "Stratum",
      area?: number | null,
      baselineLength?: number | null,
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    stratumId: string,
    updatedAt: string,
  } | null,
};

export type OnCreateUserProjectMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionUserProjectMembershipFilterInput | null,
};

export type OnCreateUserProjectMembershipSubscription = {
  onCreateUserProjectMembership?:  {
    __typename: "UserProjectMembership",
    backupQueue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    backupQueueId?: string | null,
    createdAt: string,
    id: string,
    isAdmin?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    queue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    queueId?: string | null,
    updatedAt: string,
    userId: string,
  } | null,
};

export type OnCreateUserStatsSubscriptionVariables = {
  filter?: ModelSubscriptionUserStatsFilterInput | null,
};

export type OnCreateUserStatsSubscription = {
  onCreateUserStats?:  {
    __typename: "UserStats",
    activeTime: number,
    annotationCount: number,
    annotationTime?: number | null,
    createdAt: string,
    date: string,
    observationCount: number,
    projectId: string,
    searchCount?: number | null,
    searchTime?: number | null,
    setId: string,
    sightingCount?: number | null,
    updatedAt: string,
    userId: string,
    waitingTime?: number | null,
  } | null,
};

export type OnDeleteAnnotationSubscriptionVariables = {
  filter?: ModelSubscriptionAnnotationFilterInput | null,
  owner?: string | null,
};

export type OnDeleteAnnotationSubscription = {
  onDeleteAnnotation?:  {
    __typename: "Annotation",
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    object?:  {
      __typename: "Object",
      categoryId: string,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    objectId?: string | null,
    obscured?: boolean | null,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    setId: string,
    source: string,
    updatedAt: string,
    x: number,
    y: number,
  } | null,
};

export type OnDeleteAnnotationSetSubscriptionVariables = {
  filter?: ModelSubscriptionAnnotationSetFilterInput | null,
};

export type OnDeleteAnnotationSetSubscription = {
  onDeleteAnnotationSet?:  {
    __typename: "AnnotationSet",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    categories?:  {
      __typename: "ModelCategoryConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    register?: boolean | null,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    testPresetLocations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnDeleteCameraSubscriptionVariables = {
  filter?: ModelSubscriptionCameraFilterInput | null,
};

export type OnDeleteCameraSubscription = {
  onDeleteCamera?:  {
    __typename: "Camera",
    createdAt: string,
    focalLengthMm?: number | null,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    sensorWidthMm?: number | null,
    tiltDegrees?: number | null,
    updatedAt: string,
  } | null,
};

export type OnDeleteCameraOverlapSubscriptionVariables = {
  filter?: ModelSubscriptionCameraOverlapFilterInput | null,
};

export type OnDeleteCameraOverlapSubscription = {
  onDeleteCameraOverlap?:  {
    __typename: "CameraOverlap",
    cameraAId: string,
    cameraBId: string,
    createdAt: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteCategorySubscriptionVariables = {
  filter?: ModelSubscriptionCategoryFilterInput | null,
};

export type OnDeleteCategorySubscription = {
  onDeleteCategory?:  {
    __typename: "Category",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    color?: string | null,
    createdAt: string,
    id: string,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    projectId: string,
    shortcutKey?: string | null,
    updatedAt: string,
  } | null,
};

export type OnDeleteClientLogSubscriptionVariables = {
  filter?: ModelSubscriptionClientLogFilterInput | null,
};

export type OnDeleteClientLogSubscription = {
  onDeleteClientLog?:  {
    __typename: "ClientLog",
    connectionType?: string | null,
    createdAt: string,
    deviceType?: string | null,
    downlink?: number | null,
    id: string,
    ipAddress?: string | null,
    os?: string | null,
    rtt?: number | null,
    updatedAt: string,
    userAgent?: string | null,
    userId: string,
  } | null,
};

export type OnDeleteImageSubscriptionVariables = {
  filter?: ModelSubscriptionImageFilterInput | null,
};

export type OnDeleteImageSubscription = {
  onDeleteImage?:  {
    __typename: "Image",
    altitude_agl?: number | null,
    altitude_egm96?: number | null,
    altitude_wgs84?: number | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    camera?:  {
      __typename: "Camera",
      createdAt: string,
      focalLengthMm?: number | null,
      id: string,
      name: string,
      projectId: string,
      sensorWidthMm?: number | null,
      tiltDegrees?: number | null,
      updatedAt: string,
    } | null,
    cameraId?: string | null,
    cameraSerial?: string | null,
    createdAt: string,
    exifData?: string | null,
    files?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    height: number,
    id: string,
    latitude?: number | null,
    leftNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    longitude?: number | null,
    memberships?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    originalPath?: string | null,
    pitch?: number | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    rightNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    roll?: number | null,
    timestamp?: number | null,
    transect?:  {
      __typename: "Transect",
      createdAt: string,
      id: string,
      projectId: string,
      stratumId: string,
      updatedAt: string,
    } | null,
    transectId?: string | null,
    updatedAt: string,
    width: number,
    yaw?: number | null,
  } | null,
};

export type OnDeleteImageFileSubscriptionVariables = {
  filter?: ModelSubscriptionImageFileFilterInput | null,
};

export type OnDeleteImageFileSubscription = {
  onDeleteImageFile?:  {
    __typename: "ImageFile",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    key: string,
    path: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    type: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteImageNeighbourSubscriptionVariables = {
  filter?: ModelSubscriptionImageNeighbourFilterInput | null,
};

export type OnDeleteImageNeighbourSubscription = {
  onDeleteImageNeighbour?:  {
    __typename: "ImageNeighbour",
    createdAt: string,
    homography?: Array< number | null > | null,
    image1?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image1Id: string,
    image2?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image2Id: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteImageSetSubscriptionVariables = {
  filter?: ModelSubscriptionImageSetFilterInput | null,
};

export type OnDeleteImageSetSubscription = {
  onDeleteImageSet?:  {
    __typename: "ImageSet",
    createdAt: string,
    id: string,
    imageCount?: number | null,
    images?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteImageSetMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionImageSetMembershipFilterInput | null,
};

export type OnDeleteImageSetMembershipSubscription = {
  onDeleteImageSetMembership?:  {
    __typename: "ImageSetMembership",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    imageSet?:  {
      __typename: "ImageSet",
      createdAt: string,
      id: string,
      imageCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    imageSetId: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteJollyResultSubscriptionVariables = {
  filter?: ModelSubscriptionJollyResultFilterInput | null,
};

export type OnDeleteJollyResultSubscription = {
  onDeleteJollyResult?:  {
    __typename: "JollyResult",
    animals: number,
    annotationSetId: string,
    areaSurveyed: number,
    categoryId: string,
    createdAt: string,
    density: number,
    estimate: number,
    lowerBound95: number,
    numSamples: number,
    standardError: number,
    stratumId: string,
    surveyId: string,
    updatedAt: string,
    upperBound95: number,
    variance: number,
  } | null,
};

export type OnDeleteJollyResultsMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionJollyResultsMembershipFilterInput | null,
};

export type OnDeleteJollyResultsMembershipSubscription = {
  onDeleteJollyResultsMembership?:  {
    __typename: "JollyResultsMembership",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    survey?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    surveyId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type OnDeleteLocationSubscriptionVariables = {
  filter?: ModelSubscriptionLocationFilterInput | null,
};

export type OnDeleteLocationSubscription = {
  onDeleteLocation?:  {
    __typename: "Location",
    annotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    confidence?: number | null,
    createdAt: string,
    height?: number | null,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    setId: string,
    sets?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    source: string,
    testPresets?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
    width?: number | null,
    x: number,
    y: number,
  } | null,
};

export type OnDeleteLocationAnnotationCountSubscriptionVariables = {
  filter?: ModelSubscriptionLocationAnnotationCountFilterInput | null,
};

export type OnDeleteLocationAnnotationCountSubscription = {
  onDeleteLocationAnnotationCount?:  {
    __typename: "LocationAnnotationCount",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    count?: number | null,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteLocationSetSubscriptionVariables = {
  filter?: ModelSubscriptionLocationSetFilterInput | null,
};

export type OnDeleteLocationSetSubscription = {
  onDeleteLocationSet?:  {
    __typename: "LocationSet",
    createdAt: string,
    description?: string | null,
    id: string,
    locationCount?: number | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnDeleteLocationSetMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionLocationSetMembershipFilterInput | null,
};

export type OnDeleteLocationSetMembershipSubscription = {
  onDeleteLocationSetMembership?:  {
    __typename: "LocationSetMembership",
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteObjectSubscriptionVariables = {
  filter?: ModelSubscriptionObjectFilterInput | null,
};

export type OnDeleteObjectSubscription = {
  onDeleteObject?:  {
    __typename: "Object",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteObservationSubscriptionVariables = {
  filter?: ModelSubscriptionObservationFilterInput | null,
  owner?: string | null,
};

export type OnDeleteObservationSubscription = {
  onDeleteObservation?:  {
    __typename: "Observation",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    loadingTime?: number | null,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    timeTaken?: number | null,
    updatedAt: string,
    waitingTime?: number | null,
  } | null,
};

export type OnDeleteOrganizationSubscriptionVariables = {
  filter?: ModelSubscriptionOrganizationFilterInput | null,
};

export type OnDeleteOrganizationSubscription = {
  onDeleteOrganization?:  {
    __typename: "Organization",
    createdAt: string,
    description?: string | null,
    id: string,
    invites?:  {
      __typename: "ModelOrganizationInviteConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelOrganizationMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    projects?:  {
      __typename: "ModelProjectConnection",
      nextToken?: string | null,
    } | null,
    testPresets?:  {
      __typename: "ModelTestPresetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnDeleteOrganizationInviteSubscriptionVariables = {
  filter?: ModelSubscriptionOrganizationInviteFilterInput | null,
};

export type OnDeleteOrganizationInviteSubscription = {
  onDeleteOrganizationInvite?:  {
    __typename: "OrganizationInvite",
    createdAt: string,
    id: string,
    invitedBy: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    status?: string | null,
    updatedAt: string,
    username: string,
  } | null,
};

export type OnDeleteOrganizationMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionOrganizationMembershipFilterInput | null,
};

export type OnDeleteOrganizationMembershipSubscription = {
  onDeleteOrganizationMembership?:  {
    __typename: "OrganizationMembership",
    createdAt: string,
    isAdmin?: boolean | null,
    isTested?: boolean | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type OnDeleteOrganizationRegistrationSubscriptionVariables = {
  filter?: ModelSubscriptionOrganizationRegistrationFilterInput | null,
};

export type OnDeleteOrganizationRegistrationSubscription = {
  onDeleteOrganizationRegistration?:  {
    __typename: "OrganizationRegistration",
    briefDescription: string,
    createdAt: string,
    id: string,
    organizationName: string,
    requestedBy: string,
    status?: string | null,
    updatedAt: string,
  } | null,
};

export type OnDeleteProjectSubscriptionVariables = {
  filter?: ModelSubscriptionProjectFilterInput | null,
};

export type OnDeleteProjectSubscription = {
  onDeleteProject?:  {
    __typename: "Project",
    annotationSets?:  {
      __typename: "ModelAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    cameraOverlaps?:  {
      __typename: "ModelCameraOverlapConnection",
      nextToken?: string | null,
    } | null,
    cameras?:  {
      __typename: "ModelCameraConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    createdBy: string,
    hidden?: boolean | null,
    id: string,
    imageFiles?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    imageSets?:  {
      __typename: "ModelImageSetConnection",
      nextToken?: string | null,
    } | null,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationSets?:  {
      __typename: "ModelLocationSetConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    members?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    queues?:  {
      __typename: "ModelQueueConnection",
      nextToken?: string | null,
    } | null,
    shapefile?:  {
      __typename: "Shapefile",
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    shapefileExclusions?:  {
      __typename: "ModelShapefileExclusionsConnection",
      nextToken?: string | null,
    } | null,
    status?: string | null,
    strata?:  {
      __typename: "ModelStratumConnection",
      nextToken?: string | null,
    } | null,
    tags?: Array< string | null > | null,
    testConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnDeleteProjectTestConfigSubscriptionVariables = {
  filter?: ModelSubscriptionProjectTestConfigFilterInput | null,
};

export type OnDeleteProjectTestConfigSubscription = {
  onDeleteProjectTestConfig?:  {
    __typename: "ProjectTestConfig",
    accuracy: number,
    createdAt: string,
    deadzone?: number | null,
    interval?: number | null,
    postTestConfirmation?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    random?: number | null,
    testPresetProjects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testType?: string | null,
    updatedAt: string,
  } | null,
};

export type OnDeleteQueueSubscriptionVariables = {
  filter?: ModelSubscriptionQueueFilterInput | null,
};

export type OnDeleteQueueSubscription = {
  onDeleteQueue?:  {
    __typename: "Queue",
    approximateSize?: number | null,
    backupUsers?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    batchSize?: number | null,
    createdAt: string,
    hidden?: boolean | null,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tag?: string | null,
    totalBatches?: number | null,
    updatedAt: string,
    url?: string | null,
    users?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    zoom?: number | null,
  } | null,
};

export type OnDeleteResultSharingTokenSubscriptionVariables = {
  filter?: ModelSubscriptionResultSharingTokenFilterInput | null,
};

export type OnDeleteResultSharingTokenSubscription = {
  onDeleteResultSharingToken?:  {
    __typename: "ResultSharingToken",
    annotationSetId: string,
    createdAt: string,
    jwt: string,
    surveyId: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteShapefileSubscriptionVariables = {
  filter?: ModelSubscriptionShapefileFilterInput | null,
};

export type OnDeleteShapefileSubscription = {
  onDeleteShapefile?:  {
    __typename: "Shapefile",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteShapefileExclusionsSubscriptionVariables = {
  filter?: ModelSubscriptionShapefileExclusionsFilterInput | null,
};

export type OnDeleteShapefileExclusionsSubscription = {
  onDeleteShapefileExclusions?:  {
    __typename: "ShapefileExclusions",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteStratumSubscriptionVariables = {
  filter?: ModelSubscriptionStratumFilterInput | null,
};

export type OnDeleteStratumSubscription = {
  onDeleteStratum?:  {
    __typename: "Stratum",
    area?: number | null,
    baselineLength?: number | null,
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnDeleteTasksOnAnnotationSetSubscriptionVariables = {
  filter?: ModelSubscriptionTasksOnAnnotationSetFilterInput | null,
};

export type OnDeleteTasksOnAnnotationSetSubscription = {
  onDeleteTasksOnAnnotationSet?:  {
    __typename: "TasksOnAnnotationSet",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteTestPresetSubscriptionVariables = {
  filter?: ModelSubscriptionTestPresetFilterInput | null,
};

export type OnDeleteTestPresetSubscription = {
  onDeleteTestPreset?:  {
    __typename: "TestPreset",
    createdAt: string,
    id: string,
    locations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    projects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnDeleteTestPresetLocationSubscriptionVariables = {
  filter?: ModelSubscriptionTestPresetLocationFilterInput | null,
};

export type OnDeleteTestPresetLocationSubscription = {
  onDeleteTestPresetLocation?:  {
    __typename: "TestPresetLocation",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteTestPresetProjectSubscriptionVariables = {
  filter?: ModelSubscriptionTestPresetProjectFilterInput | null,
};

export type OnDeleteTestPresetProjectSubscription = {
  onDeleteTestPresetProject?:  {
    __typename: "TestPresetProject",
    createdAt: string,
    projectConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteTestResultSubscriptionVariables = {
  filter?: ModelSubscriptionTestResultFilterInput | null,
};

export type OnDeleteTestResultSubscription = {
  onDeleteTestResult?:  {
    __typename: "TestResult",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    categoryCounts?:  {
      __typename: "ModelTestResultCategoryCountConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    passedOnTotal: boolean,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testAnimals: number,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    totalMissedAnimals: number,
    updatedAt: string,
    userId: string,
  } | null,
};

export type OnDeleteTestResultCategoryCountSubscriptionVariables = {
  filter?: ModelSubscriptionTestResultCategoryCountFilterInput | null,
};

export type OnDeleteTestResultCategoryCountSubscription = {
  onDeleteTestResultCategoryCount?:  {
    __typename: "TestResultCategoryCount",
    categoryName: string,
    createdAt: string,
    testCount: number,
    testResult?:  {
      __typename: "TestResult",
      annotationSetId: string,
      createdAt: string,
      id: string,
      locationId: string,
      passedOnTotal: boolean,
      projectId: string,
      testAnimals: number,
      testPresetId: string,
      totalMissedAnimals: number,
      updatedAt: string,
      userId: string,
    } | null,
    testResultId: string,
    updatedAt: string,
    userCount: number,
  } | null,
};

export type OnDeleteTransectSubscriptionVariables = {
  filter?: ModelSubscriptionTransectFilterInput | null,
};

export type OnDeleteTransectSubscription = {
  onDeleteTransect?:  {
    __typename: "Transect",
    createdAt: string,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    stratum?:  {
      __typename: "Stratum",
      area?: number | null,
      baselineLength?: number | null,
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    stratumId: string,
    updatedAt: string,
  } | null,
};

export type OnDeleteUserProjectMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionUserProjectMembershipFilterInput | null,
};

export type OnDeleteUserProjectMembershipSubscription = {
  onDeleteUserProjectMembership?:  {
    __typename: "UserProjectMembership",
    backupQueue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    backupQueueId?: string | null,
    createdAt: string,
    id: string,
    isAdmin?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    queue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    queueId?: string | null,
    updatedAt: string,
    userId: string,
  } | null,
};

export type OnDeleteUserStatsSubscriptionVariables = {
  filter?: ModelSubscriptionUserStatsFilterInput | null,
};

export type OnDeleteUserStatsSubscription = {
  onDeleteUserStats?:  {
    __typename: "UserStats",
    activeTime: number,
    annotationCount: number,
    annotationTime?: number | null,
    createdAt: string,
    date: string,
    observationCount: number,
    projectId: string,
    searchCount?: number | null,
    searchTime?: number | null,
    setId: string,
    sightingCount?: number | null,
    updatedAt: string,
    userId: string,
    waitingTime?: number | null,
  } | null,
};

export type OnUpdateAnnotationSubscriptionVariables = {
  filter?: ModelSubscriptionAnnotationFilterInput | null,
  owner?: string | null,
};

export type OnUpdateAnnotationSubscription = {
  onUpdateAnnotation?:  {
    __typename: "Annotation",
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    object?:  {
      __typename: "Object",
      categoryId: string,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    objectId?: string | null,
    obscured?: boolean | null,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    setId: string,
    source: string,
    updatedAt: string,
    x: number,
    y: number,
  } | null,
};

export type OnUpdateAnnotationSetSubscriptionVariables = {
  filter?: ModelSubscriptionAnnotationSetFilterInput | null,
};

export type OnUpdateAnnotationSetSubscription = {
  onUpdateAnnotationSet?:  {
    __typename: "AnnotationSet",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    categories?:  {
      __typename: "ModelCategoryConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    register?: boolean | null,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    testPresetLocations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnUpdateCameraSubscriptionVariables = {
  filter?: ModelSubscriptionCameraFilterInput | null,
};

export type OnUpdateCameraSubscription = {
  onUpdateCamera?:  {
    __typename: "Camera",
    createdAt: string,
    focalLengthMm?: number | null,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    sensorWidthMm?: number | null,
    tiltDegrees?: number | null,
    updatedAt: string,
  } | null,
};

export type OnUpdateCameraOverlapSubscriptionVariables = {
  filter?: ModelSubscriptionCameraOverlapFilterInput | null,
};

export type OnUpdateCameraOverlapSubscription = {
  onUpdateCameraOverlap?:  {
    __typename: "CameraOverlap",
    cameraAId: string,
    cameraBId: string,
    createdAt: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateCategorySubscriptionVariables = {
  filter?: ModelSubscriptionCategoryFilterInput | null,
};

export type OnUpdateCategorySubscription = {
  onUpdateCategory?:  {
    __typename: "Category",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    color?: string | null,
    createdAt: string,
    id: string,
    locationAnnotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    projectId: string,
    shortcutKey?: string | null,
    updatedAt: string,
  } | null,
};

export type OnUpdateClientLogSubscriptionVariables = {
  filter?: ModelSubscriptionClientLogFilterInput | null,
};

export type OnUpdateClientLogSubscription = {
  onUpdateClientLog?:  {
    __typename: "ClientLog",
    connectionType?: string | null,
    createdAt: string,
    deviceType?: string | null,
    downlink?: number | null,
    id: string,
    ipAddress?: string | null,
    os?: string | null,
    rtt?: number | null,
    updatedAt: string,
    userAgent?: string | null,
    userId: string,
  } | null,
};

export type OnUpdateImageSubscriptionVariables = {
  filter?: ModelSubscriptionImageFilterInput | null,
};

export type OnUpdateImageSubscription = {
  onUpdateImage?:  {
    __typename: "Image",
    altitude_agl?: number | null,
    altitude_egm96?: number | null,
    altitude_wgs84?: number | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    camera?:  {
      __typename: "Camera",
      createdAt: string,
      focalLengthMm?: number | null,
      id: string,
      name: string,
      projectId: string,
      sensorWidthMm?: number | null,
      tiltDegrees?: number | null,
      updatedAt: string,
    } | null,
    cameraId?: string | null,
    cameraSerial?: string | null,
    createdAt: string,
    exifData?: string | null,
    files?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    height: number,
    id: string,
    latitude?: number | null,
    leftNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    longitude?: number | null,
    memberships?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    originalPath?: string | null,
    pitch?: number | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    rightNeighbours?:  {
      __typename: "ModelImageNeighbourConnection",
      nextToken?: string | null,
    } | null,
    roll?: number | null,
    timestamp?: number | null,
    transect?:  {
      __typename: "Transect",
      createdAt: string,
      id: string,
      projectId: string,
      stratumId: string,
      updatedAt: string,
    } | null,
    transectId?: string | null,
    updatedAt: string,
    width: number,
    yaw?: number | null,
  } | null,
};

export type OnUpdateImageFileSubscriptionVariables = {
  filter?: ModelSubscriptionImageFileFilterInput | null,
};

export type OnUpdateImageFileSubscription = {
  onUpdateImageFile?:  {
    __typename: "ImageFile",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    key: string,
    path: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    type: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateImageNeighbourSubscriptionVariables = {
  filter?: ModelSubscriptionImageNeighbourFilterInput | null,
};

export type OnUpdateImageNeighbourSubscription = {
  onUpdateImageNeighbour?:  {
    __typename: "ImageNeighbour",
    createdAt: string,
    homography?: Array< number | null > | null,
    image1?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image1Id: string,
    image2?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    image2Id: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateImageSetSubscriptionVariables = {
  filter?: ModelSubscriptionImageSetFilterInput | null,
};

export type OnUpdateImageSetSubscription = {
  onUpdateImageSet?:  {
    __typename: "ImageSet",
    createdAt: string,
    id: string,
    imageCount?: number | null,
    images?:  {
      __typename: "ModelImageSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateImageSetMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionImageSetMembershipFilterInput | null,
};

export type OnUpdateImageSetMembershipSubscription = {
  onUpdateImageSetMembership?:  {
    __typename: "ImageSetMembership",
    createdAt: string,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId: string,
    imageSet?:  {
      __typename: "ImageSet",
      createdAt: string,
      id: string,
      imageCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    imageSetId: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateJollyResultSubscriptionVariables = {
  filter?: ModelSubscriptionJollyResultFilterInput | null,
};

export type OnUpdateJollyResultSubscription = {
  onUpdateJollyResult?:  {
    __typename: "JollyResult",
    animals: number,
    annotationSetId: string,
    areaSurveyed: number,
    categoryId: string,
    createdAt: string,
    density: number,
    estimate: number,
    lowerBound95: number,
    numSamples: number,
    standardError: number,
    stratumId: string,
    surveyId: string,
    updatedAt: string,
    upperBound95: number,
    variance: number,
  } | null,
};

export type OnUpdateJollyResultsMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionJollyResultsMembershipFilterInput | null,
};

export type OnUpdateJollyResultsMembershipSubscription = {
  onUpdateJollyResultsMembership?:  {
    __typename: "JollyResultsMembership",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    survey?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    surveyId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type OnUpdateLocationSubscriptionVariables = {
  filter?: ModelSubscriptionLocationFilterInput | null,
};

export type OnUpdateLocationSubscription = {
  onUpdateLocation?:  {
    __typename: "Location",
    annotationCounts?:  {
      __typename: "ModelLocationAnnotationCountConnection",
      nextToken?: string | null,
    } | null,
    confidence?: number | null,
    createdAt: string,
    height?: number | null,
    id: string,
    image?:  {
      __typename: "Image",
      altitude_agl?: number | null,
      altitude_egm96?: number | null,
      altitude_wgs84?: number | null,
      cameraId?: string | null,
      cameraSerial?: string | null,
      createdAt: string,
      exifData?: string | null,
      height: number,
      id: string,
      latitude?: number | null,
      longitude?: number | null,
      originalPath?: string | null,
      pitch?: number | null,
      projectId: string,
      roll?: number | null,
      timestamp?: number | null,
      transectId?: string | null,
      updatedAt: string,
      width: number,
      yaw?: number | null,
    } | null,
    imageId?: string | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    set?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    setId: string,
    sets?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    source: string,
    testPresets?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
    width?: number | null,
    x: number,
    y: number,
  } | null,
};

export type OnUpdateLocationAnnotationCountSubscriptionVariables = {
  filter?: ModelSubscriptionLocationAnnotationCountFilterInput | null,
};

export type OnUpdateLocationAnnotationCountSubscription = {
  onUpdateLocationAnnotationCount?:  {
    __typename: "LocationAnnotationCount",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    count?: number | null,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateLocationSetSubscriptionVariables = {
  filter?: ModelSubscriptionLocationSetFilterInput | null,
};

export type OnUpdateLocationSetSubscription = {
  onUpdateLocationSet?:  {
    __typename: "LocationSet",
    createdAt: string,
    description?: string | null,
    id: string,
    locationCount?: number | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelLocationSetMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tasks?:  {
      __typename: "ModelTasksOnAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnUpdateLocationSetMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionLocationSetMembershipFilterInput | null,
};

export type OnUpdateLocationSetMembershipSubscription = {
  onUpdateLocationSetMembership?:  {
    __typename: "LocationSetMembership",
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateObjectSubscriptionVariables = {
  filter?: ModelSubscriptionObjectFilterInput | null,
};

export type OnUpdateObjectSubscription = {
  onUpdateObject?:  {
    __typename: "Object",
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    category?:  {
      __typename: "Category",
      annotationCount?: number | null,
      annotationSetId: string,
      color?: string | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      shortcutKey?: string | null,
      updatedAt: string,
    } | null,
    categoryId: string,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateObservationSubscriptionVariables = {
  filter?: ModelSubscriptionObservationFilterInput | null,
  owner?: string | null,
};

export type OnUpdateObservationSubscription = {
  onUpdateObservation?:  {
    __typename: "Observation",
    annotationCount?: number | null,
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    loadingTime?: number | null,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    owner?: string | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    timeTaken?: number | null,
    updatedAt: string,
    waitingTime?: number | null,
  } | null,
};

export type OnUpdateOrganizationSubscriptionVariables = {
  filter?: ModelSubscriptionOrganizationFilterInput | null,
};

export type OnUpdateOrganizationSubscription = {
  onUpdateOrganization?:  {
    __typename: "Organization",
    createdAt: string,
    description?: string | null,
    id: string,
    invites?:  {
      __typename: "ModelOrganizationInviteConnection",
      nextToken?: string | null,
    } | null,
    memberships?:  {
      __typename: "ModelOrganizationMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    projects?:  {
      __typename: "ModelProjectConnection",
      nextToken?: string | null,
    } | null,
    testPresets?:  {
      __typename: "ModelTestPresetConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnUpdateOrganizationInviteSubscriptionVariables = {
  filter?: ModelSubscriptionOrganizationInviteFilterInput | null,
};

export type OnUpdateOrganizationInviteSubscription = {
  onUpdateOrganizationInvite?:  {
    __typename: "OrganizationInvite",
    createdAt: string,
    id: string,
    invitedBy: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    status?: string | null,
    updatedAt: string,
    username: string,
  } | null,
};

export type OnUpdateOrganizationMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionOrganizationMembershipFilterInput | null,
};

export type OnUpdateOrganizationMembershipSubscription = {
  onUpdateOrganizationMembership?:  {
    __typename: "OrganizationMembership",
    createdAt: string,
    isAdmin?: boolean | null,
    isTested?: boolean | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    updatedAt: string,
    userId: string,
  } | null,
};

export type OnUpdateOrganizationRegistrationSubscriptionVariables = {
  filter?: ModelSubscriptionOrganizationRegistrationFilterInput | null,
};

export type OnUpdateOrganizationRegistrationSubscription = {
  onUpdateOrganizationRegistration?:  {
    __typename: "OrganizationRegistration",
    briefDescription: string,
    createdAt: string,
    id: string,
    organizationName: string,
    requestedBy: string,
    status?: string | null,
    updatedAt: string,
  } | null,
};

export type OnUpdateProjectSubscriptionVariables = {
  filter?: ModelSubscriptionProjectFilterInput | null,
};

export type OnUpdateProjectSubscription = {
  onUpdateProject?:  {
    __typename: "Project",
    annotationSets?:  {
      __typename: "ModelAnnotationSetConnection",
      nextToken?: string | null,
    } | null,
    annotations?:  {
      __typename: "ModelAnnotationConnection",
      nextToken?: string | null,
    } | null,
    cameraOverlaps?:  {
      __typename: "ModelCameraOverlapConnection",
      nextToken?: string | null,
    } | null,
    cameras?:  {
      __typename: "ModelCameraConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    createdBy: string,
    hidden?: boolean | null,
    id: string,
    imageFiles?:  {
      __typename: "ModelImageFileConnection",
      nextToken?: string | null,
    } | null,
    imageSets?:  {
      __typename: "ModelImageSetConnection",
      nextToken?: string | null,
    } | null,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    jollyResultsMemberships?:  {
      __typename: "ModelJollyResultsMembershipConnection",
      nextToken?: string | null,
    } | null,
    locationSets?:  {
      __typename: "ModelLocationSetConnection",
      nextToken?: string | null,
    } | null,
    locations?:  {
      __typename: "ModelLocationConnection",
      nextToken?: string | null,
    } | null,
    members?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    objects?:  {
      __typename: "ModelObjectConnection",
      nextToken?: string | null,
    } | null,
    observations?:  {
      __typename: "ModelObservationConnection",
      nextToken?: string | null,
    } | null,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    queues?:  {
      __typename: "ModelQueueConnection",
      nextToken?: string | null,
    } | null,
    shapefile?:  {
      __typename: "Shapefile",
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      projectId: string,
      updatedAt: string,
    } | null,
    shapefileExclusions?:  {
      __typename: "ModelShapefileExclusionsConnection",
      nextToken?: string | null,
    } | null,
    status?: string | null,
    strata?:  {
      __typename: "ModelStratumConnection",
      nextToken?: string | null,
    } | null,
    tags?: Array< string | null > | null,
    testConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnUpdateProjectTestConfigSubscriptionVariables = {
  filter?: ModelSubscriptionProjectTestConfigFilterInput | null,
};

export type OnUpdateProjectTestConfigSubscription = {
  onUpdateProjectTestConfig?:  {
    __typename: "ProjectTestConfig",
    accuracy: number,
    createdAt: string,
    deadzone?: number | null,
    interval?: number | null,
    postTestConfirmation?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    random?: number | null,
    testPresetProjects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testType?: string | null,
    updatedAt: string,
  } | null,
};

export type OnUpdateQueueSubscriptionVariables = {
  filter?: ModelSubscriptionQueueFilterInput | null,
};

export type OnUpdateQueueSubscription = {
  onUpdateQueue?:  {
    __typename: "Queue",
    approximateSize?: number | null,
    backupUsers?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    batchSize?: number | null,
    createdAt: string,
    hidden?: boolean | null,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    tag?: string | null,
    totalBatches?: number | null,
    updatedAt: string,
    url?: string | null,
    users?:  {
      __typename: "ModelUserProjectMembershipConnection",
      nextToken?: string | null,
    } | null,
    zoom?: number | null,
  } | null,
};

export type OnUpdateResultSharingTokenSubscriptionVariables = {
  filter?: ModelSubscriptionResultSharingTokenFilterInput | null,
};

export type OnUpdateResultSharingTokenSubscription = {
  onUpdateResultSharingToken?:  {
    __typename: "ResultSharingToken",
    annotationSetId: string,
    createdAt: string,
    jwt: string,
    surveyId: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateShapefileSubscriptionVariables = {
  filter?: ModelSubscriptionShapefileFilterInput | null,
};

export type OnUpdateShapefileSubscription = {
  onUpdateShapefile?:  {
    __typename: "Shapefile",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateShapefileExclusionsSubscriptionVariables = {
  filter?: ModelSubscriptionShapefileExclusionsFilterInput | null,
};

export type OnUpdateShapefileExclusionsSubscription = {
  onUpdateShapefileExclusions?:  {
    __typename: "ShapefileExclusions",
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateStratumSubscriptionVariables = {
  filter?: ModelSubscriptionStratumFilterInput | null,
};

export type OnUpdateStratumSubscription = {
  onUpdateStratum?:  {
    __typename: "Stratum",
    area?: number | null,
    baselineLength?: number | null,
    coordinates?: Array< number | null > | null,
    createdAt: string,
    id: string,
    name: string,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    transects?:  {
      __typename: "ModelTransectConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnUpdateTasksOnAnnotationSetSubscriptionVariables = {
  filter?: ModelSubscriptionTasksOnAnnotationSetFilterInput | null,
};

export type OnUpdateTasksOnAnnotationSetSubscription = {
  onUpdateTasksOnAnnotationSet?:  {
    __typename: "TasksOnAnnotationSet",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    id: string,
    locationSet?:  {
      __typename: "LocationSet",
      createdAt: string,
      description?: string | null,
      id: string,
      locationCount?: number | null,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    locationSetId: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateTestPresetSubscriptionVariables = {
  filter?: ModelSubscriptionTestPresetFilterInput | null,
};

export type OnUpdateTestPresetSubscription = {
  onUpdateTestPreset?:  {
    __typename: "TestPreset",
    createdAt: string,
    id: string,
    locations?:  {
      __typename: "ModelTestPresetLocationConnection",
      nextToken?: string | null,
    } | null,
    name: string,
    organization?:  {
      __typename: "Organization",
      createdAt: string,
      description?: string | null,
      id: string,
      name: string,
      updatedAt: string,
    } | null,
    organizationId: string,
    projects?:  {
      __typename: "ModelTestPresetProjectConnection",
      nextToken?: string | null,
    } | null,
    testResults?:  {
      __typename: "ModelTestResultConnection",
      nextToken?: string | null,
    } | null,
    updatedAt: string,
  } | null,
};

export type OnUpdateTestPresetLocationSubscriptionVariables = {
  filter?: ModelSubscriptionTestPresetLocationFilterInput | null,
};

export type OnUpdateTestPresetLocationSubscription = {
  onUpdateTestPresetLocation?:  {
    __typename: "TestPresetLocation",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    createdAt: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateTestPresetProjectSubscriptionVariables = {
  filter?: ModelSubscriptionTestPresetProjectFilterInput | null,
};

export type OnUpdateTestPresetProjectSubscription = {
  onUpdateTestPresetProject?:  {
    __typename: "TestPresetProject",
    createdAt: string,
    projectConfig?:  {
      __typename: "ProjectTestConfig",
      accuracy: number,
      createdAt: string,
      deadzone?: number | null,
      interval?: number | null,
      postTestConfirmation?: boolean | null,
      projectId: string,
      random?: number | null,
      testType?: string | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateTestResultSubscriptionVariables = {
  filter?: ModelSubscriptionTestResultFilterInput | null,
};

export type OnUpdateTestResultSubscription = {
  onUpdateTestResult?:  {
    __typename: "TestResult",
    annotationSet?:  {
      __typename: "AnnotationSet",
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      register?: boolean | null,
      updatedAt: string,
    } | null,
    annotationSetId: string,
    categoryCounts?:  {
      __typename: "ModelTestResultCategoryCountConnection",
      nextToken?: string | null,
    } | null,
    createdAt: string,
    id: string,
    location?:  {
      __typename: "Location",
      confidence?: number | null,
      createdAt: string,
      height?: number | null,
      id: string,
      imageId?: string | null,
      projectId: string,
      setId: string,
      source: string,
      updatedAt: string,
      width?: number | null,
      x: number,
      y: number,
    } | null,
    locationId: string,
    passedOnTotal: boolean,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    testAnimals: number,
    testPreset?:  {
      __typename: "TestPreset",
      createdAt: string,
      id: string,
      name: string,
      organizationId: string,
      updatedAt: string,
    } | null,
    testPresetId: string,
    totalMissedAnimals: number,
    updatedAt: string,
    userId: string,
  } | null,
};

export type OnUpdateTestResultCategoryCountSubscriptionVariables = {
  filter?: ModelSubscriptionTestResultCategoryCountFilterInput | null,
};

export type OnUpdateTestResultCategoryCountSubscription = {
  onUpdateTestResultCategoryCount?:  {
    __typename: "TestResultCategoryCount",
    categoryName: string,
    createdAt: string,
    testCount: number,
    testResult?:  {
      __typename: "TestResult",
      annotationSetId: string,
      createdAt: string,
      id: string,
      locationId: string,
      passedOnTotal: boolean,
      projectId: string,
      testAnimals: number,
      testPresetId: string,
      totalMissedAnimals: number,
      updatedAt: string,
      userId: string,
    } | null,
    testResultId: string,
    updatedAt: string,
    userCount: number,
  } | null,
};

export type OnUpdateTransectSubscriptionVariables = {
  filter?: ModelSubscriptionTransectFilterInput | null,
};

export type OnUpdateTransectSubscription = {
  onUpdateTransect?:  {
    __typename: "Transect",
    createdAt: string,
    id: string,
    images?:  {
      __typename: "ModelImageConnection",
      nextToken?: string | null,
    } | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    stratum?:  {
      __typename: "Stratum",
      area?: number | null,
      baselineLength?: number | null,
      coordinates?: Array< number | null > | null,
      createdAt: string,
      id: string,
      name: string,
      projectId: string,
      updatedAt: string,
    } | null,
    stratumId: string,
    updatedAt: string,
  } | null,
};

export type OnUpdateUserProjectMembershipSubscriptionVariables = {
  filter?: ModelSubscriptionUserProjectMembershipFilterInput | null,
};

export type OnUpdateUserProjectMembershipSubscription = {
  onUpdateUserProjectMembership?:  {
    __typename: "UserProjectMembership",
    backupQueue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    backupQueueId?: string | null,
    createdAt: string,
    id: string,
    isAdmin?: boolean | null,
    project?:  {
      __typename: "Project",
      createdAt: string,
      createdBy: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      organizationId: string,
      status?: string | null,
      tags?: Array< string | null > | null,
      updatedAt: string,
    } | null,
    projectId: string,
    queue?:  {
      __typename: "Queue",
      approximateSize?: number | null,
      batchSize?: number | null,
      createdAt: string,
      hidden?: boolean | null,
      id: string,
      name: string,
      projectId: string,
      tag?: string | null,
      totalBatches?: number | null,
      updatedAt: string,
      url?: string | null,
      zoom?: number | null,
    } | null,
    queueId?: string | null,
    updatedAt: string,
    userId: string,
  } | null,
};

export type OnUpdateUserStatsSubscriptionVariables = {
  filter?: ModelSubscriptionUserStatsFilterInput | null,
};

export type OnUpdateUserStatsSubscription = {
  onUpdateUserStats?:  {
    __typename: "UserStats",
    activeTime: number,
    annotationCount: number,
    annotationTime?: number | null,
    createdAt: string,
    date: string,
    observationCount: number,
    projectId: string,
    searchCount?: number | null,
    searchTime?: number | null,
    setId: string,
    sightingCount?: number | null,
    updatedAt: string,
    userId: string,
    waitingTime?: number | null,
  } | null,
};

export type ReceiveSubscriptionVariables = {
};

export type ReceiveSubscription = {
  receive?:  {
    __typename: "Message",
    channelName: string,
    content: string,
  } | null,
};
