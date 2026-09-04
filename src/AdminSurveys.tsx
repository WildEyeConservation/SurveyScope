import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { client } from './stores/appClient';
import { fetchAllPaginatedResults } from './utils';
import type { Schema } from './amplify/client-schema';
import './AdminSurveys.css';

type ProjectType = Schema['Project']['type'];

type GroupedSurveys = {
  orgId: string;
  orgName: string;
  surveys: ProjectType[];
};

export default function AdminSurveys() {
  const [projects, setProjects] = useState<ProjectType[]>([]);
  const [orgNames, setOrgNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<
    { variant: 'success' | 'danger'; text: string } | null
  >(null);
  const [updatingProjectId, setUpdatingProjectId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    if (!client) return;
    setIsLoading(true);
    setError(null);
    setBanner(null);
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
            'imageSets.id',
            'imageSets.name',
            'imageSets.imageCount',
          ],
          limit: 10000,
        }),
        fetchAllPaginatedResults<Schema['Organization']['type']>(
          client.models.Organization.list,
          {
            selectionSet: ['id', 'name'],
            limit: 10000,
          }
        ),
      ]);

      const orgMap = allOrganizations.reduce<Record<string, string>>(
        (acc, org) => {
          if (org.id) acc[org.id] = org.name || 'Unnamed organization';
          return acc;
        },
        {}
      );

      setProjects(allProjects);
      setOrgNames(orgMap);
    } catch (err) {
      console.error('Failed to load surveys', err);
      setError(err instanceof Error ? err.message : 'Failed to load surveys.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!client) return;
    void loadData();
  }, [loadData]);

  const groupedSurveys = useMemo<GroupedSurveys[]>(() => {
    if (!projects.length) return [];
    const groups = projects.reduce<Record<string, GroupedSurveys>>(
      (acc, project) => {
        const orgId = project.organizationId || 'unassigned';
        if (!acc[orgId]) {
          acc[orgId] = {
            orgId,
            orgName: project.organizationId
              ? orgNames[project.organizationId] || 'Unknown organization'
              : 'Unassigned',
            surveys: [],
          };
        }
        acc[orgId].surveys.push(project);
        return acc;
      },
      {}
    );
    return Object.values(groups).sort((a, b) =>
      a.orgName.localeCompare(b.orgName)
    );
  }, [projects, orgNames]);

  const searchLower = search.toLowerCase().trim();
  const filteredGroups = useMemo(() => {
    if (!searchLower) return groupedSurveys;
    return groupedSurveys
      .map((group) => {
        const orgMatches = group.orgName.toLowerCase().includes(searchLower);
        const matchingSurveys = orgMatches
          ? group.surveys
          : group.surveys.filter((s) =>
              (s.name ?? '').toLowerCase().includes(searchLower)
            );
        if (matchingSurveys.length === 0) return null;
        return { ...group, surveys: matchingSurveys };
      })
      .filter((g): g is GroupedSurveys => g !== null);
  }, [groupedSurveys, searchLower]);

  const isExpanded = (orgId: string) => {
    if (searchLower) return true;
    return expanded[orgId] ?? false;
  };

  const toggleExpanded = (orgId: string) => {
    setExpanded((prev) => ({ ...prev, [orgId]: !(prev[orgId] ?? false) }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    filteredGroups.forEach((g) => {
      all[g.orgId] = true;
    });
    setExpanded(all);
  };
  const collapseAll = () => setExpanded({});

  const handleUpdateStatus = async (project: ProjectType) => {
    if (!client || !project.id) return;
    const nextStatus = window.prompt(
      `Update status for "${project.name}"`,
      project.status ?? ''
    );
    if (nextStatus === null) return;
    const trimmedStatus = nextStatus.trim();
    if (!trimmedStatus) {
      alert('Status cannot be empty.');
      return;
    }

    setUpdatingProjectId(project.id);
    setBanner(null);
    try {
      await client.models.Project.update({
        id: project.id,
        status: trimmedStatus,
      });
      await client.mutations.updateProjectMemberships({
        projectId: project.id,
      });
      setBanner({
        variant: 'success',
        text: `Updated status for "${project.name}".`,
      });
      await loadData();
    } catch (err) {
      console.error('Failed to update project status', err);
      setBanner({
        variant: 'danger',
        text:
          err instanceof Error ? err.message : 'Unable to update survey status.',
      });
    } finally {
      setUpdatingProjectId(null);
    }
  };

  if (!client) {
    return (
      <Alert variant='warning' className='mb-0'>
        Unable to load surveys because the admin client is not available.
      </Alert>
    );
  }

  const totalSurveys = filteredGroups.reduce(
    (n, g) => n + g.surveys.length,
    0
  );

  return (
    <div className='admin-surveys'>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <Form.Control
          type='text'
          placeholder='Search by organisation or survey…'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320, flex: '0 1 auto' }}
        />
        <Button
          size='sm'
          variant='outline-light'
          onClick={expandAll}
          disabled={filteredGroups.length === 0}
        >
          Expand all
        </Button>
        <Button
          size='sm'
          variant='outline-light'
          onClick={collapseAll}
          disabled={filteredGroups.length === 0}
        >
          Collapse all
        </Button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--ss-text-dim)' }}>
          {filteredGroups.length} org{filteredGroups.length === 1 ? '' : 's'} {'|'}{' '}
          {totalSurveys} survey{totalSurveys === 1 ? '' : 's'}
        </span>
        <Button
          variant='link'
          size='sm'
          style={{
            padding: 0,
            color: 'var(--ss-text-muted)',
            display: 'flex',
            alignItems: 'center',
          }}
          onClick={loadData}
          disabled={isLoading}
          title='Refresh'
        >
          <RefreshCw size={14} className={isLoading ? 'spinning' : undefined} />
        </Button>
      </div>

      {error && (
        <Alert variant='danger' className='mb-3'>
          {error}
        </Alert>
      )}
      {banner && (
        <Alert
          variant={banner.variant === 'success' ? 'success' : 'danger'}
          onClose={() => setBanner(null)}
          dismissible
          className='mb-3'
        >
          {banner.text}
        </Alert>
      )}

      {isLoading && projects.length === 0 ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: 48,
            gap: 12,
            alignItems: 'center',
          }}
        >
          <Spinner animation='border' size='sm' />
          <span style={{ fontSize: 13, color: 'var(--ss-text-dim)' }}>
            Loading surveys…
          </span>
        </div>
      ) : filteredGroups.length === 0 ? (
        <Alert variant='info'>
          {searchLower ? 'No matching surveys.' : 'No surveys found.'}
        </Alert>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredGroups.map((group) => {
            const expanded = isExpanded(group.orgId);
            return (
              <div
                key={group.orgId}
                className='ss-card'
                style={{ padding: 0, overflow: 'hidden' }}
              >
                <div
                  onClick={() => toggleExpanded(group.orgId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    borderBottom: expanded
                      ? '1px solid var(--ss-border)'
                      : 'none',
                    userSelect: 'none',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    {expanded ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                    <strong>{group.orgName}</strong>
                  </div>
                  <span className='ss-pill'>
                    {group.surveys.length} survey
                    {group.surveys.length === 1 ? '' : 's'}
                  </span>
                </div>
                {expanded && (
                  <div style={{ overflowX: 'auto' }}>
                    <table className='ss-data-table'>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th style={{ textAlign: 'right' }}>Images</th>
                          <th style={{ whiteSpace: 'nowrap' }}>Created</th>
                          <th style={{ whiteSpace: 'nowrap' }}>Updated</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...group.surveys]
                          .sort(
                            (a, b) =>
                              new Date(b.createdAt || 0).getTime() -
                              new Date(a.createdAt || 0).getTime()
                          )
                          .map((survey) => (
                            <tr key={survey.id}>
                              <td style={{ fontWeight: 500 }}>{survey.name}</td>
                              <td style={{ textAlign: 'right' }}>
                                {formatImageCount(survey)}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {formatDate(survey.createdAt)}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {formatDate(survey.updatedAt)}
                              </td>
                              <td>{survey.status || 'N/A'}</td>
                              <td style={{ textAlign: 'right' }}>
                                <Button
                                  size='sm'
                                  variant='primary'
                                  onClick={() => handleUpdateStatus(survey)}
                                  disabled={updatingProjectId === survey.id}
                                >
                                  {updatingProjectId === survey.id ? (
                                    <>
                                      <Spinner
                                        animation='border'
                                        size='sm'
                                        className='me-2'
                                      />
                                      Updating
                                    </>
                                  ) : (
                                    'Update Status'
                                  )}
                                </Button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatDate(value?: string | null): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatImageCount(project: ProjectType): string {
  const sets =
    (project.imageSets as { imageCount?: number | null }[] | undefined) ?? [];
  if (!sets.length) return '0';
  const total = sets.reduce((sum, set) => sum + (set.imageCount ?? 0), 0);
  return total.toLocaleString();
}
