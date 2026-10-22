import pLimit from 'p-limit';
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';
Amplify.configure(outputs);
import { generateClient } from 'aws-amplify/api';
import { Schema } from './amplify/client-schema'; // Path to your backend resource definition
import type { DataClient } from '../amplify/shared/data-schema.generated';
import {
  splitCallOptions,
  startCancellable,
  type ClientCallOptions,
} from './clientCancellation';

/* Here we generate a graphQL client with the Amplify API module, and then we wrap the client methods
to limit the number of concurrent requests to the GraphQL API, as well as to check for errors.

The amplify GraphQL client reports errors in a separate errors field of the response, but TanStack Query
expects the errors to be thrown as exceptions, so we need to wrap the client in a way that throws exceptions
for error responses from the server.

The pLimit module is used to limit the number of concurrent requests to the GraphQL API. 
*/

const rawClient = generateClient<Schema>({
  authMode: 'userPool',
});
const client = rawClient as unknown as DataClient;

// Create a pLimit instance with a concurrency limit (adjust as needed)
const limit = pLimit(15);

// Expose a helper to run arbitrary async work through the same limiter
export const runWithClientLimit = async <T>(fn: () => Promise<T>): Promise<T> =>
  limit(fn);

// Custom error class for GraphQL errors
export class GraphQLError extends Error {
  readonly errors: unknown;

  constructor(errors: unknown) {
    super(JSON.stringify(errors));
    this.name = 'GraphQLError';
    this.errors = errors;
  }
}

// Function to check for GraphQL errors
export function checkForErrors<T>(result: T): T {
  const errors = (result as { errors?: unknown } | null)?.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0 : Boolean(errors);
  if (hasErrors) {
    throw new GraphQLError(errors);
  }
  return result;
}

async function executeWithRetry<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
  maxRetries: number = 4,
  baseDelay: number = 1000,
  maxDelay: number = 30000
): Promise<T> {
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const result = await operation();

      return checkForErrors(result);
    } catch (error) {
      // GraphQL validation and resolver errors are deterministic responses.
      // Retrying the same operation only delays surfacing the real error.
      if (error instanceof GraphQLError || signal?.aborted) {
        throw error;
      }

      retryCount++;
      if (retryCount === maxRetries) {
        console.error(`Operation failed after ${maxRetries} attempts:`, error);
        throw error;
      }

      const delay = Math.min(
        baseDelay * Math.pow(2, retryCount) + Math.random() * 1000,
        maxDelay
      );
      console.warn(`Retry ${retryCount}/${maxRetries} after ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Unexpected end of retry loop');
}

// Options that can be passed as the last argument to any wrapped client method.
export type { ClientCallOptions };

// Augment the generated OperationOptions so callers can pass { retry: false }
// without casting. The limitedClient wrapper consumes this at runtime.
declare module '../amplify/shared/data-schema.generated' {
  interface OperationOptions {
    retry?: boolean;
    signal?: AbortSignal;
  }

  // amplify_outputs.json is refreshed by the next backend deployment. Keep the
  // new operation typed locally until that generated introspection catches up.
  interface DataMutations {
    runOwlDDetector(
      args: {
        bucket: string;
        images?: string[] | null;
        landscape?: boolean | null;
        projectId: string;
        queueUrl: string;
        rotation?: number | null;
        setId: string;
      },
      options?: CustomOperationOptions
    ): CustomOperationResult<unknown>;
  }
}

// Recursive function to wrap client methods with retry logic
function wrapClientMethods(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  const wrappedObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'function') {
      if (key.startsWith('on') || key.startsWith('observe')) {
        // Do not wrap the onCreate, onUpdate, onDelete, functions as these are sync methods (no
        // underlying network request). It would have been better make the distinction based on
        // the return type, but that info is not available at runtime without invoking the method.
        wrappedObj[key] = value;
      } else {
        wrappedObj[key] = async (...args: unknown[]) => {
          const { args: callArgs, options } = splitCallOptions(args);
          const shouldRetry = options.retry !== false;
          const { signal } = options;

          const execute = () =>
            limit(() =>
              startCancellable(
                () => value(...callArgs),
                signal,
                (request) => rawClient.cancel(request)
              )
            );

          const result = shouldRetry
            ? await executeWithRetry(execute, signal)
            : await execute();
          signal?.throwIfAborted();
          const checkedResult = checkForErrors(result);
          return wrapClientMethods(checkedResult);
        };
      }
    } else if (typeof value === 'object') {
      if (Array.isArray(value)) {
        // Do not wrap arrays.
        wrappedObj[key] = value;
      } else if (key === 'subscriptions') {
        // Do not wrap subscriptions - they return observables, not promises.
        wrappedObj[key] = value;
      } else {
        wrappedObj[key] = wrapClientMethods(value);
      }
    } else {
      wrappedObj[key] = value;
    }
  }
  return wrappedObj;
}

// Create the limited client with wrapped methods
export const limitedClient = wrapClientMethods(client) as DataClient;
