import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeProject,
  assertFileOwnership,
  requireStorageUser,
  safeSourceKey,
  uploadSourceKey,
  type ImageFileRow,
  type ImageRow,
  type ProjectRow,
} from './authorization';

const project: ProjectRow = {
  id: 'project-a',
  organizationId: 'org-a',
  group: 'org-a',
  tags: [],
};
const image: ImageRow = {
  id: 'image-a',
  projectId: 'project-a',
  group: 'org-a',
  width: 1024,
  height: 768,
};
const fileFor = (
  key: string,
  overrides: Partial<ImageFileRow> = {}
): ImageFileRow => ({
  id: 'file-a',
  imageId: image.id,
  projectId: project.id,
  group: project.group,
  key,
  path: key,
  ...overrides,
});

test('storage requires a Cognito user; missing identity is never an internal bypass', () => {
  for (const identity of [null, {}, { accountId: '123' }, { sub: '' }]) {
    assert.throws(() => requireStorageUser(identity), /Unauthorized/);
  }
  assert.throws(
    () =>
      authorizeProject(
        requireStorageUser({ sub: 'u', groups: ['org-b'] }),
        project
      ),
    /Unauthorized/
  );
  authorizeProject(
    requireStorageUser({ sub: 'u', groups: ['org-a'] }),
    project
  );
  authorizeProject(
    requireStorageUser({ sub: 'admin', groups: ['sysadmin'] }),
    project
  );
});

test('a project whose group is not its organization is never authorized', () => {
  const user = requireStorageUser({ sub: 'u', groups: ['org-a'] });
  assert.throws(() => authorizeProject(user, undefined), /Unauthorized/);
  assert.throws(
    () => authorizeProject(user, { ...project, group: 'org-b' }),
    /Unauthorized/
  );
  assert.throws(
    () => authorizeProject(user, { ...project, group: undefined }),
    /Unauthorized/
  );
});

test('a permitted image id cannot be paired with another image file or organization', () => {
  const key = 'org-a/project-a/photo.jpg';
  const file = fileFor(key);
  assertFileOwnership(file, image, project, key);
  assert.throws(() =>
    assertFileOwnership({ ...file, imageId: 'other' }, image, project, key)
  );
  assert.throws(() =>
    assertFileOwnership(
      fileFor('org-b/p/photo.jpg'),
      image,
      project,
      'org-b/p/photo.jpg'
    )
  );
  assert.throws(() =>
    assertFileOwnership(file, image, project, 'different-key')
  );
  assert.throws(() =>
    assertFileOwnership(file, { ...image, group: 'org-b' }, project, key)
  );
});

test('legacy keys remain unchanged but still need the exact owned file association', () => {
  const legacy = { ...project, tags: ['legacy'] };
  const key = 'old-survey/camera/photo.jpg';
  assert.equal(uploadSourceKey(legacy, key), key);
  assertFileOwnership(fileFor(key), image, legacy, key);
  assert.throws(() =>
    assertFileOwnership(
      fileFor(key, { projectId: 'other-project' }),
      image,
      legacy,
      key
    )
  );
  assert.equal(uploadSourceKey(project, key), `org-a/project-a/${key}`);
});

test('rejects traversal and legacy writes into the modern namespace', () => {
  for (const key of [
    '../photo.jpg',
    'a/../b',
    '/absolute',
    'a/./b',
    'a\\b',
    'a\0b',
    '',
    'x'.repeat(1100),
  ]) {
    assert.throws(() => safeSourceKey(key));
  }
  assert.throws(() =>
    uploadSourceKey(
      { ...project, tags: ['legacy'] },
      '63cfbd73-4ac1-4960-9e2c-a88eefaa4e21/78acfd87-1d59-4366-900a-67c5ac656b6d/photo.jpg'
    )
  );
});
