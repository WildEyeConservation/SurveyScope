import DataTable, { type DataColumn } from '@/components/DataTable';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Pencil, RefreshCw, SearchIcon, SearchX } from 'lucide-react';
import { DateTime } from 'luxon';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Schema } from './amplify/client-schema';
import { GlobalContext } from './Context';
import { fetchAllPaginatedResults } from './utils';

type ProjectType = Schema['Project']['type'];

interface SurveyRow {
  project: ProjectType;
  id: string;
  name: string;
  organizationName: string;
  images: number;
  createdAt: string | null;
  updatedAt: string | null;
  status: string;
  isTest: boolean;
}

const KNOWN_STATUSES = [
  'active',
  'uploading',
  'launching',
  'processing',
  'updating',
  'deleting',
];

const imageCountOf = (project: ProjectType) =>
  ((project.imageSets as { imageCount?: number | null }[] | undefined) ?? [])
    .map((set) => set.imageCount ?? 0)
    .reduce((sum, n) => sum + n, 0);

const formatDate = (value: string | null) =>
  value ? DateTime.fromISO(value).toLocaleString(DateTime.DATE_MED) : '';

function StatusDialog(props: {
  survey: SurveyRow | null;
  onClose: () => void;
  onSave: (survey: SurveyRow, status: string) => Promise<void>;
}) {
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (props.survey) setStatus(props.survey.status);
  }, [props.survey]);

  const trimmed = status.trim();
  const unchanged = trimmed === props.survey?.status;
  const save = async () => {
    if (!props.survey || !trimmed || unchanged) return;
    setSaving(true);
    try {
      await props.onSave(props.survey, trimmed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!props.survey} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <DialogHeader closeButton>
          <DialogTitle>Update status</DialogTitle>
        </DialogHeader>
        <DialogBody className='flex flex-col gap-3'>
          <div className='text-muted-foreground'>
            {props.survey?.name} ({props.survey?.organizationName})
          </div>
          <div>
            <Label className='mb-1' htmlFor='survey-status'>
              Status
            </Label>
            <Input
              id='survey-status'
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />
          </div>
          <div className='flex flex-wrap gap-1'>
            {KNOWN_STATUSES.map((s) => (
              <button
                key={s}
                type='button'
                onClick={() => setStatus(s)}
                className={cn(
                  'border border-white/30 px-2 py-0.5 text-sm transition-colors',
                  trimmed === s ? 'bg-primary text-white' : 'hover:bg-white/10',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant='ghost' className='mr-auto' onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant='primary'
            disabled={saving || !trimmed || unchanged}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminSurveys() {
  const { client } = useContext(GlobalContext)!;
  const [projects, setProjects] = useState<ProjectType[]>([]);
  const [orgNames, setOrgNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    variant: 'success' | 'danger';
    text: string;
  } | null>(null);
  const [search, setSearch] = useState('');
  const [organization, setOrganization] = useState<ComboboxOption | null>(null);
  const [status, setStatus] = useState<ComboboxOption | null>(null);
  const [hideTest, setHideTest] = useState(false);
  const [editing, setEditing] = useState<SurveyRow | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allProjects, allOrganizations] = await Promise.all([
        fetchAllPaginatedResults<ProjectType>(client.models.Project.list, {
          selectionSet: [
            'id',
            'name',
            'createdAt',
            'updatedAt',
            'status',
            'organizationId',
            'tags',
            'imageSets.imageCount',
          ],
          limit: 10000,
        }),
        fetchAllPaginatedResults<Schema['Organization']['type']>(
          client.models.Organization.list,
          { selectionSet: ['id', 'name'], limit: 10000 },
        ),
      ]);
      setProjects(allProjects);
      setOrgNames(
        Object.fromEntries(
          allOrganizations.map((org) => [
            org.id,
            org.name || 'Unnamed organisation',
          ]),
        ),
      );
    } catch (err) {
      console.error('Failed to load surveys', err);
      setError(err instanceof Error ? err.message : 'Failed to load surveys.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const rows = useMemo<SurveyRow[]>(
    () =>
      projects.map((project) => ({
        project,
        id: project.id,
        name: project.name ?? '',
        organizationName: project.organizationId
          ? orgNames[project.organizationId] || 'Unknown organisation'
          : 'Unassigned',
        images: imageCountOf(project),
        createdAt: project.createdAt ?? null,
        updatedAt: project.updatedAt ?? null,
        status: project.status ?? '',
        isTest: !!project.tags?.includes('test'),
      })),
    [projects, orgNames],
  );

  const organizationOptions = useMemo(
    () =>
      [...new Set(rows.map((r) => r.organizationName))]
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ value: name, label: name })),
    [rows],
  );
  const statusOptions = useMemo(
    () =>
      [...new Set(rows.map((r) => r.status).filter(Boolean))]
        .sort()
        .map((s) => ({ value: s, label: s })),
    [rows],
  );

  const query = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      (!organization || r.organizationName === organization.value) &&
      (!status || r.status === status.value) &&
      (!hideTest || !r.isTest) &&
      (!query ||
        r.name.toLowerCase().includes(query) ||
        r.organizationName.toLowerCase().includes(query) ||
        r.id.includes(query)),
  );
  const hasFilters = !!(search || organization || status || hideTest);
  const testCount = rows.filter((r) => r.isTest).length;

  const patchProject = (id: string, patch: Partial<ProjectType>) =>
    setProjects((current) =>
      current.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );

  const toggleTest = async (row: SurveyRow, isTest: boolean) => {
    const previous = row.project.tags ?? [];
    const others = previous.filter((t) => t !== 'test');
    const tags = isTest ? [...others, 'test'] : others;
    patchProject(row.id, { tags });
    setBanner(null);
    try {
      const { errors } = await client.models.Project.update({
        id: row.id,
        tags,
      });
      if (errors?.length) throw new Error(errors[0].message);
    } catch (err) {
      console.error('Failed to update test tag', err);
      patchProject(row.id, { tags: previous });
      setBanner({
        variant: 'danger',
        text: `Unable to update "${row.name}".`,
      });
    }
  };

  const saveStatus = async (row: SurveyRow, nextStatus: string) => {
    setBanner(null);
    try {
      const { data, errors } = await client.models.Project.update({
        id: row.id,
        status: nextStatus,
      });
      if (errors?.length) throw new Error(errors[0].message);
      await client.mutations.updateProjectMemberships({ projectId: row.id });
      patchProject(row.id, {
        status: nextStatus,
        ...(data?.updatedAt ? { updatedAt: data.updatedAt } : {}),
      });
      setEditing(null);
      setBanner({
        variant: 'success',
        text: `"${row.name}" is now ${nextStatus}.`,
      });
    } catch (err) {
      console.error('Failed to update project status', err);
      setBanner({
        variant: 'danger',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to update survey status.',
      });
    }
  };

  const columns: DataColumn<SurveyRow>[] = [
    {
      id: 'name',
      header: 'Survey',
      accessorFn: (row) => row.name,
      cell: ({ row }) => (
        <div className='min-w-40'>
          <div className='font-medium'>{row.original.name}</div>
          <div className='font-mono text-xs text-muted-foreground'>
            {row.original.id}
          </div>
        </div>
      ),
    },
    {
      id: 'organization',
      header: 'Organisation',
      accessorFn: (row) => row.organizationName,
    },
    {
      id: 'images',
      header: 'Images',
      accessorFn: (row) => row.images,
      cell: ({ getValue }) => getValue<number>().toLocaleString(),
      meta: { className: 'text-right tabular-nums' },
    },
    {
      id: 'createdAt',
      header: 'Created',
      accessorFn: (row) => row.createdAt ?? '',
      cell: ({ row }) => formatDate(row.original.createdAt),
      meta: { className: 'whitespace-nowrap' },
    },
    {
      id: 'updatedAt',
      header: 'Updated',
      accessorFn: (row) => row.updatedAt ?? '',
      cell: ({ row }) =>
        row.original.updatedAt ? (
          <span
            title={DateTime.fromISO(row.original.updatedAt).toLocaleString(
              DateTime.DATETIME_MED,
            )}
          >
            {DateTime.fromISO(row.original.updatedAt).toRelative()}
          </span>
        ) : null,
      meta: { className: 'whitespace-nowrap' },
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (row) => row.status,
      cell: ({ row }) => (
        <button
          type='button'
          title='Change status'
          onClick={() => setEditing(row.original)}
          className={cn(
            'group inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm transition-colors',
            row.original.status === 'active'
              ? 'bg-success/20 text-success hover:bg-success/30'
              : 'bg-warning/20 text-warning hover:bg-warning/30',
          )}
        >
          {row.original.status || 'none'}
          <Pencil size={12} className='opacity-60 group-hover:opacity-100' />
        </button>
      ),
    },
    {
      id: 'test',
      header: 'Test',
      accessorFn: (row) => (row.isTest ? 1 : 0),
      cell: ({ row }) => (
        <Switch
          aria-label={`Mark ${row.original.name} as a test survey`}
          checked={row.original.isTest}
          onCheckedChange={(checked) => void toggleTest(row.original, checked)}
        />
      ),
      meta: {
        className: 'w-px text-center',
        description: 'Test surveys are left out of the statistics',
      },
    },
  ];

  return (
    <div>
      <div className='mb-4 flex items-center justify-between gap-2'>
        <h5 className='mb-0'>Surveys</h5>
        <Button
          variant='outline-primary'
          onClick={() => void loadData()}
          disabled={loading}
        >
          <RefreshCw size={16} className={cn(loading && 'animate-spin')} />
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>
      <div className='mb-4 flex flex-wrap items-end gap-2'>
        <div className='min-w-72 flex-[1.4]'>
          <Label className='mb-1'>Search</Label>
          <div className='relative'>
            <SearchIcon className='pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-[#6c757d]' />
            <Input
              type='search'
              aria-label='Search surveys'
              placeholder='Survey, organisation or ID…'
              className='pl-9'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className='min-w-60 flex-1'>
          <Label className='mb-1'>Organisation</Label>
          <Combobox
            options={organizationOptions}
            value={organization}
            onChange={setOrganization}
            placeholder='All organisations'
            name='Organisation'
            clearable
          />
        </div>
        <div className='min-w-44'>
          <Label className='mb-1'>Status</Label>
          <Combobox
            options={statusOptions}
            value={status}
            onChange={setStatus}
            placeholder='Any status'
            name='Status'
            clearable
          />
        </div>
        <label className='flex h-[38px] cursor-pointer items-center gap-2 px-2'>
          <Switch checked={hideTest} onCheckedChange={setHideTest} />
          Hide test surveys
          {testCount > 0 && (
            <span className='text-muted-foreground'>({testCount})</span>
          )}
        </label>
        {hasFilters && (
          <Button
            variant='ghost'
            onClick={() => {
              setSearch('');
              setOrganization(null);
              setStatus(null);
              setHideTest(false);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {error && (
        <Alert variant='danger' className='mb-4'>
          {error}
        </Alert>
      )}
      {banner && (
        <Alert
          variant={banner.variant}
          onClose={() => setBanner(null)}
          className='mb-4'
        >
          {banner.text}
        </Alert>
      )}

      <DataTable
        columns={columns}
        data={visible}
        getRowId={(row) => row.id}
        pageSize={25}
        initialSorting={[{ id: 'createdAt', desc: true }]}
        loading={loading && projects.length === 0}
        loadingMessage='Loading surveys…'
        emptyIcon={hasFilters ? SearchX : undefined}
        emptyMessage={
          hasFilters ? 'No surveys match these filters' : 'No surveys found'
        }
      />

      <StatusDialog
        survey={editing}
        onClose={() => setEditing(null)}
        onSave={saveStatus}
      />
    </div>
  );
}
