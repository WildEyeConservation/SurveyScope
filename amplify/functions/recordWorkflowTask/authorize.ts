export interface WorkflowRunScope {
  runId: string;
  workflowType: string;
  projectId: string;
  annotationSetId: string;
  organizationId: string;
}

export interface WorkflowTaskLookups {
  isSurveyMember(projectId: string, userId: string): Promise<boolean>;
  isOrganizationAdmin(organizationId: string, userId: string): Promise<boolean>;
  annotation(
    id: string,
  ): Promise<{ projectId?: string | null; setId?: string | null } | null>;
  imageProject(id: string): Promise<string | null>;
}

// Browser-recorded work items per workflow; other work is recorded server-side.
const ITEM_TYPES: Record<string, string> = {
  'qc-review': 'annotation',
  'info-tags': 'annotation',
  homographies: 'image-pair',
  'individual-id': 'image-pair',
};

export function pairImageIds(pairKey: string): [string, string] | null {
  for (const separator of ['::', '__']) {
    const parts = pairKey.split(separator);
    if (parts.length === 2 && parts.every((part) => part !== '')) {
      return [parts[0], parts[1]];
    }
  }
  return null;
}

export async function authorizeWorkflowTask(
  identity: { sub: string; groups: string[] },
  run: WorkflowRunScope,
  workItemType: string,
  workItemId: string,
  lookups: WorkflowTaskLookups,
): Promise<void> {
  if (!identity.groups.includes('sysadmin')) {
    const allowed =
      identity.groups.includes(run.organizationId) &&
      ((await lookups.isSurveyMember(run.projectId, identity.sub)) ||
        (await lookups.isOrganizationAdmin(run.organizationId, identity.sub)));
    if (!allowed) {
      throw new Error('Unauthorized: you are not a member of this survey');
    }
  }

  if (
    !Object.hasOwn(ITEM_TYPES, run.workflowType) ||
    ITEM_TYPES[run.workflowType] !== workItemType
  ) {
    throw new Error(
      `Work items of type ${workItemType} cannot be recorded for this workflow`,
    );
  }
  if (workItemType === 'annotation') {
    const annotation = await lookups.annotation(workItemId);
    if (
      annotation?.projectId !== run.projectId ||
      annotation?.setId !== run.annotationSetId
    ) {
      throw new Error('The annotation is not part of this workflow run');
    }
    return;
  }
  const images = pairImageIds(workItemId);
  if (!images) throw new Error('Invalid image pair');
  for (const imageId of images) {
    if ((await lookups.imageProject(imageId)) !== run.projectId) {
      throw new Error('The image pair is not part of this workflow run');
    }
  }
}

// One unit per run, work item and person, whatever key the client sends.
export function workflowTaskKey(
  workItemType: string,
  workItemId: string,
  userId: string,
): string {
  return JSON.stringify([workItemType, workItemId, userId]);
}
