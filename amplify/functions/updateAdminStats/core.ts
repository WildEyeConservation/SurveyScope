import { dayOf, monthOf } from '../../../shared/adminStats';

export type Counts = Record<string, number>;

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dayOf(d.toISOString());
}

export function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  const d = new Date(`${first}-01T00:00:00.000Z`);
  while (monthOf(d.toISOString()) <= last) {
    months.push(monthOf(d.toISOString()));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return months;
}

export function imagesToday(
  imageCount: number,
  rows: Map<string, Counts>,
  today: string,
): number {
  let before = 0;
  for (const [day, counts] of rows) {
    if (day < today) before += counts.images ?? 0;
  }
  return imageCount - before;
}

export function daysBetween(first: string, last: string): string[] {
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

export function tallyByDay(
  createdAts: (string | undefined)[],
  field: string,
  into: Map<string, Counts>,
): void {
  for (const createdAt of createdAts) {
    if (!createdAt) continue;
    const day = dayOf(createdAt);
    const counts = into.get(day) ?? {};
    counts[field] = (counts[field] ?? 0) + 1;
    into.set(day, counts);
  }
}

export function changedFields(
  stored: Counts | undefined,
  desired: Counts,
): Counts {
  const changed: Counts = {};
  for (const [field, value] of Object.entries(desired)) {
    if ((stored?.[field] ?? 0) !== value) changed[field] = value;
  }
  return changed;
}

export function desiredRows(
  stored: Map<string, Counts>,
  recount: Map<string, Counts>,
  fields: readonly string[],
  covers: (key: string) => boolean,
): Map<string, Counts> {
  const desired = new Map<string, Counts>();
  const keys = new Set([...stored.keys(), ...recount.keys()]);
  for (const key of keys) {
    if (!covers(key)) continue;
    const counts: Counts = {};
    for (const field of fields) counts[field] = recount.get(key)?.[field] ?? 0;
    desired.set(key, counts);
  }
  return desired;
}
