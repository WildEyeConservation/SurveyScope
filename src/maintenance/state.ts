export type MessageType = 'update' | 'information' | 'warning';
export interface MaintenanceState {
  revision: number;
  message: string;
  messageType: MessageType;
  publishAt: string | null;
  denyAccessAt: string | null;
  serverTime: string;
}
export type MaintenanceInput = Omit<
  MaintenanceState,
  'revision' | 'serverTime'
> & { expectedRevision: number };

export function maintenancePhase(state: MaintenanceState | null, now: number) {
  if (!state) return 'loading';
  if (state.denyAccessAt && Date.parse(state.denyAccessAt) <= now)
    return 'blocked';
  if (state.message && state.publishAt && Date.parse(state.publishAt) <= now)
    return 'announced';
  return 'open';
}

export function validateSchedule(input: MaintenanceInput): string | null {
  if (!input.message.trim()) return 'Enter a message.';
  if (input.message.trim().length > 2000)
    return 'Use at most 2,000 characters.';
  const publish = Date.parse(input.publishAt || '');
  if (!Number.isFinite(publish)) return 'Choose a valid announcement time.';
  if (
    input.denyAccessAt &&
    (!Number.isFinite(Date.parse(input.denyAccessAt)) ||
      Date.parse(input.denyAccessAt) < publish)
  ) {
    return 'Access must close at or after the announcement time.';
  }
  return null;
}

// Also checked by queued client calls after their component has unmounted.
let accessBlocked = true;
let workspaceDiscarded = false;
export function setMaintenanceAccessBlocked(
  blocked: boolean,
  discarded = false
) {
  accessBlocked = blocked;
  workspaceDiscarded = discarded;
}
export function canReloadForMaintenance() {
  return workspaceDiscarded;
}
export function isMaintenanceAccessBlocked() {
  return accessBlocked;
}
export function assertMaintenanceAccess() {
  if (accessBlocked)
    throw new Error('Application access is paused for maintenance.');
}
