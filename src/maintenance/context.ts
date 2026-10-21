import { createContext, useContext } from 'react';
import type { MaintenanceInput, MaintenanceState } from './state';

interface MaintenanceContextValue {
  state: MaintenanceState | null;
  userState: MaintenanceState | null;
  now: number;
  error: string | null;
  refresh: () => Promise<void>;
  save: (input: MaintenanceInput) => Promise<void>;
  isSysadmin: boolean;
}
export const MaintenanceContext = createContext<MaintenanceContextValue | null>(
  null
);
export function useSystemMaintenance() {
  const value = useContext(MaintenanceContext);
  if (!value) throw new Error('System maintenance provider is missing.');
  return value;
}
