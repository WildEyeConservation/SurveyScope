/*
This file defines a custom React hook called useOptimisticUpdates that provides optimistic updates for CRUD operations on a specified model. It uses React Query 
for data fetching and caching, and AWS Amplify for the actual API calls and real-time subscriptions.
The hook sets up:
1. A query to fetch data for the specified model
2. Real-time subscriptions for create, update, and delete events
3. Mutation functions for create, update, and delete operations with optimistic updates

The optimistic updates allow the UI to update immediately in response to user actions, while still handling the actual API calls in the background. 
If an error occurs, the changes are rolled back to maintain data consistency. We implicitly assume that every table has a unique identifier field called 'id'.

This updated version adds an optional `options` parameter that accepts a compositeKey function. When provided, the compositeKey function is used to
derive a unique key for each item (e.g. combining multiple fields into a string) instead of assuming each item has a unique 'id' property.

Example usage:

// Without composite keys
const { data, create, update, delete } = useOptimisticUpdates('Todo'); 
// 'Where Todo' is the name of one of the models in the schema, If we select a nonexistent model, typescript will generate an error.

const newTodo = create({
  name: 'New Todo',
  description: 'Description of the new todo',
  completed: false,
}); // This will create a new todo item and update the data immediately, while the actual API call is made in the background.

update({
  id: '1',
  name: 'Updated Todo',
  description: 'Updated description of the todo',
  completed: true,
}); // This will update the todo item with id '1' and update the data immediately, while the actual API call is made in the background.

delete({
  id: '2',
}); // This will delete the todo item with id '2' and update the data immediately, while the actual API call is made in the background.

// With composite keys:
const compositeKey = (item: OrganizationMembership) => 
    `${item.organizationId}:${item.userId}`;
const { data, create, update, delete } = useOptimisticUpdates(
    'OrganizationMembership', listMemberships, subscriptionFilter, { compositeKey }
);
*/
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useContext, useMemo, useCallback } from 'react';
import type { Schema } from './amplify/client-schema';
import type { DataModels, SubscriptionOptions } from '../amplify/shared/data-schema.generated';
import { ProjectContext } from './Context';
import { client } from './stores/appClient';
import {
  isMissingRow,
  withRowReinstated,
  withRowRestored,
  withoutRow,
} from './utils/optimisticCache';


// Options interface to optionally pass a composite key resolver and subscription auth mode
export interface OptimisticOptions<T> {
  compositeKey?: (item: T) => string;
  authMode?: 'apiKey' | 'userPool' | 'iam' | 'identityPool' | 'lambda' | 'none';
}

export function useOptimisticUpdates<
  T,
  ModelKey extends keyof DataModels
>(
  modelKey: ModelKey,
  listFunction: (
    nextToken?: string
  ) => Promise<{ data: T[]; nextToken?: string | null }>,
  subscriptionFilter?: SubscriptionOptions<any>,
  options?: OptimisticOptions<T>,
  updateFunction?: (progress: number) => Promise<void>
) {
  const queryClient = useQueryClient();
  const queryKey = [modelKey, subscriptionFilter];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = client.models[modelKey] as any;

  // Use the compositeKey function from options if provided, otherwise use id
  const getKey = (item: any) =>
    options && options.compositeKey ? options.compositeKey(item) : item.id;

  const effectiveListFunction = useCallback(
    (nextToken?: string) => {
      return listFunction
        ? listFunction(nextToken)
        : client.models[modelKey].list({ nextToken });
    },
    [listFunction, modelKey]
  );

  const { data, ...queryResult } = useQuery({
    queryKey,
    queryFn: async () => {
      let nextToken: string | undefined = undefined;
      const allResults: T[] = [];
      do {
        const result = await effectiveListFunction(nextToken);
        allResults.push(...(result.data as T[]));
        if (updateFunction) {
          await updateFunction(allResults.length);
        }
        nextToken = result.nextToken ?? undefined;
      } while (nextToken);
      return allResults;
    },
  });
  const stableData = useMemo(() => data ?? [], [data]);

  useEffect(() => {
    const subOptions = options?.authMode
      ? ({ ...(subscriptionFilter ?? {}), authMode: options.authMode } as typeof subscriptionFilter)
      : subscriptionFilter;

    const createSub = model.onCreate(subOptions).subscribe({
      next: (data: T) => {
        if (data == null) return;
        queryClient.setQueryData<T[]>(queryKey, (old = []) => [
          ...old.filter((item) => getKey(item) !== getKey(data)),
          data,
        ]);
      },
      error: (error: unknown) => console.warn(error),
    });

    const updateSub = model.onUpdate(subOptions).subscribe({
      next: (data: T) => {
        if (data == null) return;
        queryClient.setQueryData<T[]>(queryKey, (old = []) =>
          old.map((item) =>
            getKey(item) === getKey(data) ? { ...item, ...data } : item
          )
        );
      },
      error: (error: unknown) => console.warn(error),
    });

    const deleteSub = model.onDelete(subOptions).subscribe({
      next: (data: T) => {
        if (data == null) return;
        queryClient.setQueryData<T[]>(queryKey, (old = []) =>
          old.filter((item) => getKey(item) !== getKey(data))
        );
      },
      error: (error: unknown) => console.warn(error),
    });

    return () => {
      createSub.unsubscribe();
      updateSub.unsubscribe();
      deleteSub.unsubscribe();
    };
    //eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptionFilter]);

  /*
  Rollbacks go through the pure transforms in utils/optimisticCache so a failed
  write only ever affects its own row. See that module for why a whole-list
  snapshot rollback is wrong here, and why a null row counts as a failure even
  though react-query reports the mutation as a success.
  */
  const dropFromCache = (item: T) => {
    queryClient.setQueryData<T[]>(queryKey, (old = []) =>
      withoutRow(old, item, getKey)
    );
  };

  const restoreInCache = (item: T, previousItems: T[] | undefined) => {
    queryClient.setQueryData<T[]>(queryKey, (old = []) =>
      withRowRestored(old, item, previousItems, getKey)
    );
  };

  const createMutation = useMutation({
    mutationFn: model.create,
    onMutate: async (newItem: any) => {
      newItem.id ||= crypto.randomUUID(); // If the item does not have an id, generate a random UUID for it.
      await queryClient.cancelQueries({ queryKey });
      const previousItems = queryClient.getQueryData<T[]>(queryKey);
      queryClient.setQueryData<T[]>(queryKey, (old = []) => [
        ...old,
        newItem as T,
      ]);
      return { previousItems };
    },
    onSuccess: (result: unknown, newItem: T) => {
      if (!isMissingRow(result)) return;
      console.error(
        `${String(modelKey)}.create returned no row — the write was rejected. Rolling back.`,
        newItem
      );
      dropFromCache(newItem);
    },
    onError: (err, newItem, context) => {
      console.error(err, newItem, context);
      dropFromCache(newItem);
    },
  });

  const updateMutation = useMutation({
    mutationFn: model.update,
    onMutate: async (updatedItem: T) => {
      await queryClient.cancelQueries({ queryKey });
      const previousItems = queryClient.getQueryData<T[]>(queryKey);
      queryClient.setQueryData<T[]>(queryKey, (old = []) =>
        old.map((item) =>
          getKey(item) === getKey(updatedItem)
            ? { ...item, ...updatedItem }
            : item
        )
      );
      return { previousItems };
    },
    onSuccess: (result: unknown, updatedItem: T, context) => {
      if (!isMissingRow(result)) return;
      console.error(
        `${String(modelKey)}.update returned no row — the write was rejected. Rolling back.`,
        updatedItem
      );
      restoreInCache(updatedItem, context?.previousItems);
    },
    onError: (err, updatedItem, context) => {
      console.error(err, updatedItem, context);
      restoreInCache(updatedItem, context?.previousItems);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: model.delete,
    onMutate: async (deletedItem: T) => {
      await queryClient.cancelQueries({ queryKey });
      const previousItems = queryClient.getQueryData<T[]>(queryKey);
      queryClient.setQueryData<T[]>(queryKey, (old = []) =>
        old.filter((item) => getKey(item) !== getKey(deletedItem))
      );
      return { previousItems };
    },
    onSuccess: (result: unknown, deletedItem: T) => {
      // Deliberately not resurrected. A null row here is ambiguous — deleting an
      // already-deleted row answers the same way — and a row that survives a
      // failed delete is the harmless direction: it stays in the results rather
      // than vanishing from them. Restoring the marker would instead invite the
      // user into a delete-it-again loop.
      if (!isMissingRow(result)) return;
      console.warn(
        `${String(modelKey)}.delete returned no row; the row may still exist.`,
        deletedItem
      );
    },
    onError: (err, deletedItem, context) => {
      console.error(err, deletedItem, context);
      queryClient.setQueryData<T[]>(queryKey, (old = []) =>
        withRowReinstated(old, deletedItem, context?.previousItems, getKey)
      );
    },
  });

  return {
    // Keep the empty result referentially stable while the query is loading.
    // Consumers commonly depend on `data` in effects; returning a new [] on
    // every render can otherwise create an update loop.
    data: stableData,
    meta: queryResult,
    create: (item: T) => {
      (item as any).id ||= crypto.randomUUID(); // If the item does not have an id, we generate a random UUID for it.
      createMutation.mutate(item);
      return (item as any).id as string;
    },
    update: updateMutation.mutate,
    delete: deleteMutation.mutate,
  };
}

export const useQueues = () => {
  const { project } = useContext(ProjectContext)!;
  const subscriptionFilter = useMemo(
    () => ({
      filter: { projectId: { eq: project.id } },
    }),
    [project.id]
  );

  const originalHook = useOptimisticUpdates<Schema['Queue']['type'], 'Queue'>( // eslint-disable-line @typescript-eslint/no-explicit-any
    'Queue',
    async (nextToken) =>
      client.models.Queue.list({
        filter: subscriptionFilter.filter,
        nextToken,
      }),
    subscriptionFilter
  );
  const remove = ({ id }: { id: string }) => {
    client.mutations.deleteQueueMutation({ queueId: id }).catch((err: any) =>
      console.error('deleteQueueMutation failed:', err)
    );
    originalHook.delete({ id } as Schema['Queue']['type']);
  };
  return { ...originalHook, delete: remove };
};

// // The byProject versions of the useOptimisticUpdates hook work on all classes except project itself
// type ModelTypeByProject = Exclude<keyof typeof client.models, 'Project'>;

// export function useOptimisticUpdatesByProject<T extends ModelTypeByProject>(modelName: T) {
//   return (projectId?: string) => {
//     const { currentPM } = useContext(UserContext);
//     projectId ||= currentPM?.projectId;
//     return useOptimisticUpdates<T>(
//       modelName,
//       () => client.models[modelName].byProject({ projectId }),
//       { filter: { projectId: { eq: projectId } } }
//     );
//   };
// }
