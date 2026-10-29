import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { GlobalContext } from './Context';
import { fetchAllPaginatedResults } from './utils';
import { useUsers } from './apiInterface';
import type { Schema } from './amplify/client-schema';
import type { AdminStatsPayload, StatCounts } from '../shared/adminStats';

export type MonthKey = string; // yyyy-LL

export interface MetricSeries {
  months: MonthKey[];
  values: number[];
}

export interface SummaryMetric {
  total: number;
  thisMonth: number;
  series: MetricSeries;
}

export interface UsersMetric extends SummaryMetric {
  uniqueLoginSeries: MetricSeries;
}

interface BreakdownCounts {
  surveys: number;
  images: number;
  annotations: number;
}

export interface ProjectBreakdownMetric {
  projectId: string;
  projectName: string;
  totals: BreakdownCounts;
  thisMonth: BreakdownCounts;
}

export interface OrganizationBreakdownMetric {
  organizationId: string;
  organizationName: string;
  totals: BreakdownCounts;
  thisMonth: BreakdownCounts;
  projects: ProjectBreakdownMetric[];
}

export interface AdminStatsData {
  loading: boolean;
  error?: string;
  updatedAt: string | null;
  months: MonthKey[];
  users: UsersMetric;
  organizations: SummaryMetric;
  surveys: SummaryMetric; // Projects
  images: SummaryMetric;
  annotations: SummaryMetric;
  breakdown: OrganizationBreakdownMetric[];
  refresh: () => void;
}

type Organization = Pick<
  Schema['Organization']['type'],
  'id' | 'name' | 'createdAt'
>;
type Project = Pick<
  Schema['Project']['type'],
  'id' | 'name' | 'createdAt' | 'organizationId' | 'tags'
> & { imageSets?: { imageCount?: number | null }[] | null };

interface Loaded {
  organizations: Organization[];
  projects: Project[];
  stats: AdminStatsPayload;
}

function buildMonthKeys(monthCount: number, now: DateTime): MonthKey[] {
  const start = now.minus({ months: monthCount - 1 }).startOf('month');
  return Array.from({ length: monthCount }, (_, i) =>
    start.plus({ months: i }).toFormat('yyyy-LL'),
  );
}

function monthKeyFromISO(iso?: string | null): MonthKey | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  return dt.isValid ? dt.toFormat('yyyy-LL') : null;
}

// Only on client.queries once a backend that defines it is deployed.
function resolveAdminStatsQuery(client: unknown) {
  const query = (client as { queries?: Record<string, unknown> }).queries
    ?.getAdminStats;
  return typeof query === 'function'
    ? (query as () => Promise<{
        data?: unknown;
        errors?: { message?: string }[];
      }>)
    : undefined;
}

function metric(
  months: MonthKey[],
  thisMonthKey: MonthKey,
  total: number,
  byMonth: (month: MonthKey) => number,
): SummaryMetric {
  return {
    total,
    thisMonth: byMonth(thisMonthKey),
    series: { months, values: months.map(byMonth) },
  };
}

const sumCounts = (
  months: Record<string, StatCounts> | undefined,
  field: keyof StatCounts,
) => Object.values(months ?? {}).reduce((sum, m) => sum + m[field], 0);

const imageCountOf = (project: Project) =>
  (project.imageSets ?? []).reduce(
    (sum, set) => sum + (set.imageCount ?? 0),
    0,
  );

export function useAdminStatsData(monthCount: number): AdminStatsData {
  const { client } = useContext(GlobalContext)!;
  const { users: cognitoUsers } = useUsers();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);

  const nowRef = useRef(DateTime.utc());
  const months = useMemo(
    () => buildMonthKeys(monthCount, nowRef.current),
    [monthCount],
  );
  const thisMonthKey = nowRef.current.toFormat('yyyy-LL');

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(undefined);
      try {
        const query = resolveAdminStatsQuery(client);
        if (!query) {
          throw new Error(
            'Admin statistics are not deployed on this backend yet.',
          );
        }
        const [organizations, projects, response] = await Promise.all([
          fetchAllPaginatedResults<Organization>(
            client.models.Organization.list,
            {
              selectionSet: ['id', 'name', 'createdAt'],
            },
          ),
          fetchAllPaginatedResults<Project>(client.models.Project.list, {
            selectionSet: [
              'id',
              'name',
              'createdAt',
              'organizationId',
              'tags',
              'imageSets.imageCount',
            ],
          }),
          query(),
        ]);
        if (response.errors?.length) {
          throw new Error(response.errors[0].message || 'Failed to load stats');
        }
        const data = response.data;
        const stats = (typeof data === 'string' ? JSON.parse(data) : data) as
          AdminStatsPayload | undefined;
        if (!cancelled) {
          setLoaded({
            organizations,
            projects,
            stats: stats ?? { projects: {}, users: {}, updatedAt: null },
          });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load stats');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [client, version]);

  const derived = useMemo(() => {
    const organizations = loaded?.organizations ?? [];
    const projects = (loaded?.projects ?? []).filter(
      (p) => !p.tags?.includes('test'),
    );
    const stats = loaded?.stats ?? { projects: {}, users: {}, updatedAt: null };
    const projectMonth = (projectId: string, month: MonthKey) =>
      stats.projects[projectId]?.[month];
    const sumMonth = (field: keyof StatCounts) => (month: MonthKey) =>
      projects.reduce(
        (sum, p) => sum + (projectMonth(p.id, month)?.[field] ?? 0),
        0,
      );
    const countCreated =
      (rows: { createdAt?: string | null }[]) => (month: MonthKey) =>
        rows.filter((row) => monthKeyFromISO(row.createdAt) === month).length;
    const userMonth =
      (field: 'newUsers' | 'activeUsers') => (month: MonthKey) =>
        stats.users[month]?.[field] ?? 0;

    const newUsers = metric(
      months,
      thisMonthKey,
      cognitoUsers.length,
      userMonth('newUsers'),
    );
    const users: UsersMetric = {
      ...newUsers,
      uniqueLoginSeries: {
        months,
        values: months.map(userMonth('activeUsers')),
      },
    };

    const projectRow = (p: Project): ProjectBreakdownMetric => ({
      projectId: p.id,
      projectName: p.name,
      totals: {
        surveys: 1,
        images: imageCountOf(p),
        annotations: sumCounts(stats.projects[p.id], 'annotations'),
      },
      thisMonth: {
        surveys: monthKeyFromISO(p.createdAt) === thisMonthKey ? 1 : 0,
        images: projectMonth(p.id, thisMonthKey)?.images ?? 0,
        annotations: projectMonth(p.id, thisMonthKey)?.annotations ?? 0,
      },
    });
    const add = (a: BreakdownCounts, b: BreakdownCounts): BreakdownCounts => ({
      surveys: a.surveys + b.surveys,
      images: a.images + b.images,
      annotations: a.annotations + b.annotations,
    });
    const zero: BreakdownCounts = { surveys: 0, images: 0, annotations: 0 };
    const breakdown: OrganizationBreakdownMetric[] = organizations.map((o) => {
      const rows = projects
        .filter((p) => p.organizationId === o.id)
        .map(projectRow);
      return {
        organizationId: o.id,
        organizationName: o.name,
        totals: rows.reduce((sum, r) => add(sum, r.totals), zero),
        thisMonth: rows.reduce((sum, r) => add(sum, r.thisMonth), zero),
        projects: rows,
      };
    });

    return {
      updatedAt: stats.updatedAt,
      users,
      organizations: metric(
        months,
        thisMonthKey,
        organizations.length,
        countCreated(organizations),
      ),
      surveys: metric(
        months,
        thisMonthKey,
        projects.length,
        countCreated(projects),
      ),
      images: metric(
        months,
        thisMonthKey,
        projects.reduce((sum, p) => sum + imageCountOf(p), 0),
        sumMonth('images'),
      ),
      annotations: metric(
        months,
        thisMonthKey,
        projects.reduce(
          (sum, p) => sum + sumCounts(stats.projects[p.id], 'annotations'),
          0,
        ),
        sumMonth('annotations'),
      ),
      breakdown,
    };
  }, [loaded, months, thisMonthKey, cognitoUsers.length]);

  return {
    loading,
    error,
    months,
    ...derived,
    refresh: () => setVersion((v) => v + 1),
  };
}
