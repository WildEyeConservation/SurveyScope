import { createContext } from 'react';
import { Schema } from './amplify/client-schema'; // Path to your backend resource definition
import outputs from '../amplify_outputs.json';
import { AuthUser } from '@aws-amplify/auth';
import { SQSClient } from '@aws-sdk/client-sqs';
import type { DataClient } from '../amplify/shared/data-schema.generated';


export interface ProgressType {
  [key: string]: { value?: number; detail: JSX.Element };
}

type ClientType = DataClient;
export type BackendOutputs = Omit<typeof outputs, 'custom'> & {
  custom: typeof outputs.custom & {
    owlDDetectorTaskQueueUrl: string;
  };
};

type ModelType = keyof ClientType['models'];
export type CRUDhook<T extends ModelType> = {
  data: Schema[T]['type'][];
  create: (arg: Parameters<ClientType['models'][T]['create']>[0]) => string;
  update: (arg: Parameters<ClientType['models'][T]['update']>[0]) => void;
  delete: (arg: Parameters<ClientType['models'][T]['delete']>[0]) => void;
};
export type AnnotationsHook = CRUDhook<'Annotation'>;

export interface UserContextType {
  user: AuthUser;
  getSqsClient: () => Promise<SQSClient>;
  cognitoGroups: string[];
  myMembershipHook: CRUDhook<'UserProjectMembership'>;
  myOrganizationHook: CRUDhook<'OrganizationMembership'>;
  isOrganizationAdmin: boolean;
  jobsCompleted: number;
  setJobsCompleted: React.Dispatch<React.SetStateAction<number>>;
  isAnnotatePath: boolean;
  setIsAnnotatePath: React.Dispatch<React.SetStateAction<boolean>>;

  // user testing - maybe move to own context
  unannotatedJobs: number;
  setUnannotatedJobs: React.Dispatch<React.SetStateAction<number>>;
  currentTaskTag: string;
  setCurrentTaskTag: React.Dispatch<React.SetStateAction<string>>;
  currentAnnoCount: { [key: string]: { x: number; y: number }[] };
  setCurrentAnnoCount: React.Dispatch<
    React.SetStateAction<{ [key: string]: { x: number; y: number }[] }>
  >;
  sessionTestsResults: {
    id: string;
    locationId: string;
    annotationSetId: string;
  }[];
  setSessionTestsResults: React.Dispatch<
    React.SetStateAction<
      { id: string; locationId: string; annotationSetId: string }[]
    >
  >;
}

// export interface OrganizationContextType {
//   organizationHook: CRUDhook<'OrganizationMembership'>;
// }

export interface ProgressContextType {
  progress: ProgressType;
  setProgress: React.Dispatch<React.SetStateAction<ProgressType>>;
}

// context used for setting up testing as an organization admin (this is not used for actual testing)
export interface TestingContextType {
  organizationId: string;
  organizationProjects: Schema['Project']['type'][];
  organizationTestPresets: Schema['TestPreset']['type'][];
  organizationMembershipsHook: CRUDhook<'OrganizationMembership'>;
}

type NeighbourTransform = {
  fwd: ((c1: [number, number]) => [number, number]) | undefined;
  bwd: ((c1: [number, number]) => [number, number]) | undefined;
} | undefined;

interface ImageContextType {
  annotationsHook: AnnotationsHook;
  annoCount: number;
  startLoadingTimestamp: number;
  visibleTimestamp: number | undefined;
  fullyLoadedTimestamp: number | undefined;
  setVisibleTimestamp: React.Dispatch<React.SetStateAction<number | undefined>>;
  setFullyLoadedTimestamp: React.Dispatch<React.SetStateAction<number | undefined>>;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  prevImages:
    | {
        image: Schema['Image']['type'];
        transform: NeighbourTransform;
      }[]
    | undefined;
  nextImages:
    | {
        image: Schema['Image']['type'];
        transform: NeighbourTransform;
      }[]
    | undefined;
  queriesComplete: boolean;
}

export const UserContext = createContext<UserContextType | null>(null);
export const ProgressContext = createContext<ProgressContextType | null>(null);
export const ImageContext = createContext<ImageContextType | undefined>(
  undefined
);
export const TestingContext = createContext<TestingContextType | null>(null);
// export const OrganizationContext =
//   createContext<OrganizationContextType | null>(null);
