import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadImageTileStates,
  type ImageTileState,
} from './loadImageTileStates';

function fakeApi(rows: ImageTileState[], pageSize = 1000) {
  const calls = { pages: 0, gets: 0 };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const executeGraphql = async <T>(
    query: string,
    variables: Record<string, unknown>,
  ) => {
    if (query.includes('imagesByProjectId')) {
      calls.pages++;
      const start = variables.nextToken ? Number(variables.nextToken) : 0;
      const end = start + pageSize;
      return {
        imagesByProjectId: {
          items: rows.slice(start, end),
          nextToken: end < rows.length ? String(end) : null,
        },
      } as T;
    }
    calls.gets++;
    return { getImage: byId.get(String(variables.id)) ?? null } as T;
  };
  return { calls, executeGraphql };
}

function rows(count: number, prefix = 'img'): ImageTileState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    tiledAt: i % 2 ? '2026-10-01T00:00:00.000Z' : null,
    originalPath: `path/${i}.jpg`,
  }));
}

test('small requests use per-image lookups', async () => {
  const project = rows(5000);
  const { calls, executeGraphql } = fakeApi(project);
  const ids = project.slice(0, 10).map((r) => r.id);
  const states = await loadImageTileStates('p', ids, executeGraphql);
  assert.equal(states.size, 10);
  assert.equal(calls.pages, 0);
  assert.equal(calls.gets, 10);
});

test('large requests page the project index instead of per-image lookups', async () => {
  const project = rows(5000);
  const { calls, executeGraphql } = fakeApi(project);
  const ids = project.slice(0, 3000).map((r) => r.id);
  const states = await loadImageTileStates('p', ids, executeGraphql);
  assert.equal(states.size, 3000);
  assert.deepEqual(states.get('img-1'), project[1]);
  assert.equal(calls.gets, 0);
  assert.equal(calls.pages, 3);
});

test('images not found in the project index fall back to getImage', async () => {
  const project = rows(2000);
  const other = rows(3, 'other');
  const { calls, executeGraphql } = fakeApi(project);
  const lookup = fakeApi([...project, ...other]);
  const ids = [...project.map((r) => r.id), ...other.map((r) => r.id), 'gone'];
  const states = await loadImageTileStates(
    'p',
    ids,
    async (query, variables) =>
      query.includes('imagesByProjectId')
        ? executeGraphql(query, variables)
        : lookup.executeGraphql(query, variables),
  );
  assert.equal(states.size, 2003);
  assert.ok(states.has('other-2'));
  assert.ok(!states.has('gone'));
  assert.equal(calls.pages, 2);
  assert.equal(lookup.calls.gets, 4);
});
