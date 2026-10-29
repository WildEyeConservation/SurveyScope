export const COUNT_FIELDS = ['images', 'annotations'] as const;
export type CountField = (typeof COUNT_FIELDS)[number];
export type StatCounts = Record<CountField, number>;

export const USER_FIELDS = ['newUsers', 'activeUsers'] as const;
export type UserField = (typeof USER_FIELDS)[number];
export type UserMonthCounts = Record<UserField, number>;

// Stats table keys: one row per project per UTC day, one per UTC month for users.
export const PROJECT_PREFIX = 'PROJECT#';
export const projectKey = (projectId: string) =>
  `${PROJECT_PREFIX}${projectId}`;
export const DAY_PREFIX = 'DAY#';
export const USERS_KEY = 'USERS';
export const META_KEY = 'META';
export const LAST_RUN_KEY = 'LAST_RUN';

export interface AdminStatsPayload {
  // projectId -> yyyy-LL -> counts
  projects: Record<string, Record<string, StatCounts>>;
  // yyyy-LL -> counts
  users: Record<string, UserMonthCounts>;
  updatedAt: string | null;
}

export const dayOf = (iso: string) => iso.slice(0, 10);
export const monthOf = (dayOrIso: string) => dayOrIso.slice(0, 7);
