import { list } from 'aws-amplify/storage';
import type { ProjectKeyInfo } from './projectKeys';

// Lists existing project paths from S3; listing errors must throw for retry.
export async function listUploadedOriginalPaths(args: {
  projectId: string;
  keyInfo: ProjectKeyInfo;
  /** originalPaths selected for this project; results are restricted to these. */
  localPaths: Set<string>;
}): Promise<Set<string>> {
  const { projectId, keyInfo, localPaths } = args;
  const { organizationId, isLegacyProject } = keyInfo;

  const allItems: { path: string }[] = [];

  if (!isLegacyProject && organizationId) {
    // New structure: everything lives under the org/project prefix.
    const listPrefix = `images/${organizationId}/${projectId}/`;
    const { items } = await list({
      path: listPrefix,
      options: { bucket: 'inputs', listAll: true },
    });
    // Large resumed surveys can exceed the argument limit of push(...items).
    for (const item of items) allItems.push(item);
  } else {
    // Legacy: keys are raw originalPaths; limit listing to the top-level
    // folders of the selected files to avoid cross-project contamination.
    const topLevelPrefixes = Array.from(
      new Set(
        Array.from(localPaths)
          .map((p) => (p.split(/[/\\]/)[0] || '').trim())
          .filter((p) => p.length > 0)
      )
    );
    for (const prefix of topLevelPrefixes) {
      const { items } = await list({
        path: `images/${prefix}/`,
        options: { bucket: 'inputs', listAll: true },
      });
      for (const item of items) allItems.push(item);
    }
  }

  const uploaded = new Set<string>();
  const newPrefix =
    !isLegacyProject && organizationId
      ? `${organizationId}/${projectId}/`
      : null;
  for (const item of allItems) {
    const keyWithoutImages = item.path.substring('images/'.length);
    let candidate = keyWithoutImages;
    if (newPrefix) {
      if (!keyWithoutImages.startsWith(newPrefix)) continue;
      candidate = keyWithoutImages.substring(newPrefix.length);
    }
    if (localPaths.has(candidate)) {
      uploaded.add(candidate);
    }
  }
  return uploaded;
}
