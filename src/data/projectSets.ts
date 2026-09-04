import { useMemo } from 'react';
import type { Schema } from '../amplify/client-schema';
import { client } from '../stores/appClient';
import { useOptimisticUpdates } from '../useOptimisticUpdates';

export function useProjectMemberships(projectId: string | undefined) {
  const subscriptionFilter = useMemo(
    () => ({ filter: { projectId: { eq: projectId } } }),
    [projectId]
  );

  return useOptimisticUpdates<
    Schema['UserProjectMembership']['type'],
    'UserProjectMembership'
  >(
    'UserProjectMembership',
    async (nextToken) =>
      client.models.UserProjectMembership.list({
        filter: subscriptionFilter.filter,
        nextToken,
      }),
    subscriptionFilter
  );
}

export function useImageSets(projectId: string | undefined) {
  const subscriptionFilter = useMemo(
    () => ({ filter: { projectId: { eq: projectId } } }),
    [projectId]
  );

  return useOptimisticUpdates<Schema['ImageSet']['type'], 'ImageSet'>(
    'ImageSet',
    async (nextToken) =>
      client.models.ImageSet.list({
        filter: subscriptionFilter.filter,
        nextToken,
      }),
    subscriptionFilter
  );
}

export function useLocationSets(projectId: string | undefined) {
  const subscriptionFilter = useMemo(
    () => ({ filter: { projectId: { eq: projectId } } }),
    [projectId]
  );

  return useOptimisticUpdates<Schema['LocationSet']['type'], 'LocationSet'>(
    'LocationSet',
    async (nextToken) =>
      client.models.LocationSet.list({
        filter: subscriptionFilter.filter,
        nextToken,
      }),
    subscriptionFilter
  );
}

export function useAnnotationSets(projectId: string | undefined) {
  const subscriptionFilter = useMemo(
    () => ({ filter: { projectId: { eq: projectId } } }),
    [projectId]
  );

  return useOptimisticUpdates<
    Schema['AnnotationSet']['type'],
    'AnnotationSet'
  >(
    'AnnotationSet',
    async (nextToken) =>
      client.models.AnnotationSet.list({
        filter: subscriptionFilter.filter,
        nextToken,
      }),
    subscriptionFilter
  );
}

export function useQueues(projectId: string | undefined) {
  const subscriptionFilter = useMemo(
    () => ({ filter: { projectId: { eq: projectId } } }),
    [projectId]
  );
  const originalHook = useOptimisticUpdates<
    Schema['Queue']['type'],
    'Queue'
  >(
    'Queue',
    async (nextToken) =>
      client.models.Queue.list({
        filter: subscriptionFilter.filter,
        nextToken,
      }),
    subscriptionFilter
  );
  const remove = ({ id }: { id: string }) => {
    client.mutations.deleteQueueMutation({ queueId: id }).catch((error) =>
      console.error('deleteQueueMutation failed:', error)
    );
    originalHook.delete({ id } as Schema['Queue']['type']);
  };

  return { ...originalHook, delete: remove };
}
