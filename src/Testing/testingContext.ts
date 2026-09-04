import { createContext } from 'react';
import type { Schema } from '../amplify/client-schema';
import type { CRUDhook } from '../data/types';

export interface TestingContextType {
  organizationId: string;
  organizationProjects: Schema['Project']['type'][];
  organizationTestPresets: Schema['TestPreset']['type'][];
  organizationMembershipsHook: CRUDhook<'OrganizationMembership'>;
}

export const TestingContext = createContext<TestingContextType | null>(null);
