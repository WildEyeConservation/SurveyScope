import {
  COUNT_FIELDS,
  DAY_PREFIX,
  PROJECT_PREFIX,
  LAST_RUN_KEY,
  META_KEY,
  USER_FIELDS,
  USERS_KEY,
  monthOf,
  type AdminStatsPayload,
} from '../../../shared/adminStats';

const num = (value: unknown) => (typeof value === 'number' ? value : 0);

export function rollUp(items: Record<string, unknown>[]): AdminStatsPayload {
  const payload: AdminStatsPayload = {
    projects: {},
    users: {},
    updatedAt: null,
  };
  for (const item of items) {
    const pk = item.pk as string;
    const sk = item.sk as string;
    if (pk === META_KEY && sk === LAST_RUN_KEY) {
      payload.updatedAt = (item.updatedAt as string | undefined) ?? null;
    } else if (pk === USERS_KEY) {
      payload.users[sk] = Object.fromEntries(
        USER_FIELDS.map((field) => [field, num(item[field])]),
      ) as AdminStatsPayload['users'][string];
    } else if (pk.startsWith(PROJECT_PREFIX) && sk.startsWith(DAY_PREFIX)) {
      const months = (payload.projects[pk.slice(PROJECT_PREFIX.length)] ??= {});
      const month = monthOf(sk.slice(DAY_PREFIX.length));
      const counts = (months[month] ??= {
        images: 0,
        annotations: 0,
      });
      for (const field of COUNT_FIELDS) counts[field] += num(item[field]);
    }
  }
  return payload;
}
