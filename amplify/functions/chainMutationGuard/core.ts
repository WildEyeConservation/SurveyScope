type Row = Record<string, unknown>;
export interface GuardStore {
  get(model: string, key: Row): Promise<Row | undefined>;
  find(
    model: string,
    shareId: string,
    field: string,
    value: string
  ): Promise<Row | undefined>;
  groups(username: string): Promise<string[]>;
}
export interface GuardEvent {
  identity?: { sub?: string; username?: string; groups?: string[] | null };
  fieldName: string;
  input: Row;
}

function requireValue(value: unknown): string {
  if (typeof value !== 'string' || !value)
    throw new Error('Invalid record identifier');
  return value;
}
function deny(): never {
  throw new Error('Unauthorized: record is outside your permitted share');
}

export function createGuard(store: GuardStore) {
  return async ({
    identity,
    fieldName,
    input,
  }: GuardEvent): Promise<boolean> => {
    if (!identity?.sub || !identity.username) deny();
    const sub = identity.sub;
    const isAdmin = identity.groups?.includes('sysadmin') ?? false;
    if (fieldName === 'addUserToGroup') {
      if (!isAdmin) deny();
      const group = requireValue(input.groupName);
      if (group.startsWith('chainshare-')) {
        const share = await store.get('ChainShare', {
          shareId: group.slice('chainshare-'.length),
        });
        if (share?.status !== 'active' || share.group !== group) {
          throw new Error(
            'Reviewers can only be added to a completed, active share'
          );
        }
      }
      return true;
    }
    const operation = fieldName.startsWith('create')
      ? 'create'
      : fieldName.startsWith('update')
      ? 'update'
      : 'delete';
    if (
      ![
        'createChainReviewFeedback',
        'updateChainReviewFeedback',
        'deleteChainReviewFeedback',
      ].includes(fieldName)
    )
      deny();
    const existing =
      operation === 'create'
        ? undefined
        : await store.get('ChainReviewFeedback', {
            id: requireValue(input.id),
          });
    if (operation !== 'create' && !existing) deny();
    const row = { ...existing, ...input };

    const ownerNames = [sub, identity.username, `${sub}::${identity.username}`];
    if (
      (existing && !ownerNames.includes(String(existing.owner))) ||
      ('owner' in input && !ownerNames.includes(String(input.owner)))
    )
      deny();
    if (
      existing &&
      ['shareId', 'sharedAnnotationId', 'kind', 'owner'].some(
        (key) => input[key] != null && input[key] !== existing[key]
      )
    )
      deny();
    const shareId = requireValue(row.shareId);
    const share = await store.get('ChainShare', { shareId });
    if (share?.status !== 'active' || share.group !== `chainshare-${shareId}`)
      deny();
    // Read current membership so removal cannot be bypassed with an old session.
    if (
      !isAdmin &&
      !(await store.groups(identity.username)).includes(`chainshare-${shareId}`)
    )
      deny();
    // The existing UI stores source annotation IDs, not snapshot row IDs.
    const annotation = await store.find(
      'SharedChainAnnotation',
      shareId,
      'sourceAnnotationId',
      requireValue(row.sharedAnnotationId)
    );
    if (!annotation || annotation.group !== share.group) deny();
    if (
      row.chainId != null &&
      row.chainId !== (annotation.objectId ?? annotation.sourceAnnotationId)
    )
      deny();
    if (!['obscured', 'relabel', 'comment'].includes(String(row.kind)))
      throw new Error('Invalid feedback kind');
    if (
      operation === 'create' &&
      input.id !== `${shareId}#${sub}#${row.sharedAnnotationId}#${row.kind}`
    ) {
      throw new Error('Invalid reviewer feedback identifier');
    }
    if (operation !== 'delete') {
      if (row.kind === 'obscured' && typeof row.proposedObscured !== 'boolean')
        throw new Error('Invalid obscured opinion');
      if (
        row.kind === 'comment' &&
        (typeof row.comment !== 'string' || row.comment.length > 10000)
      )
        throw new Error('Invalid comment');
      if (row.kind === 'relabel') {
        const category = await store.find(
          'SharedChainCategory',
          shareId,
          'sourceCategoryId',
          requireValue(row.proposedCategoryId)
        );
        if (!category || category.group !== share.group) deny();
      }
      for (const key of ['proposedObscured', 'proposedCategoryId', 'comment']) {
        const expected =
          row.kind === 'obscured'
            ? 'proposedObscured'
            : row.kind === 'relabel'
            ? 'proposedCategoryId'
            : 'comment';
        if (key !== expected && row[key] != null)
          throw new Error('Feedback fields do not match its kind');
      }
    }
    return true;
  };
}
