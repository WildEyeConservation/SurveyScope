import {
  GraphQLResult,
  GraphqlSubscriptionResult,
} from '@aws-amplify/api-graphql';
import { Matrix, multiply } from 'mathjs';

export type UnknownGraphQLResponse =
  | GraphQLResult<any>
  | GraphqlSubscriptionResult<any>;

type PaginatedQueryResult<T> = {
  data: T[];
  nextToken?: string | null;
};

function splitInputAndOptions(params: any): { input?: any; options: any } {
  if (!params) {
    return { input: undefined, options: {} };
  }
  const {
    filter,
    sortDirection,
    limit,
    nextToken: _nt,
    selectionSet,
    ...rest
  } = params;
  const input = Object.keys(rest).length ? rest : undefined;
  const options: any = {};
  if (filter !== undefined) options.filter = filter;
  if (sortDirection !== undefined) options.sortDirection = sortDirection;
  if (limit !== undefined) options.limit = limit;
  if (selectionSet !== undefined) options.selectionSet = selectionSet;
  return { input, options };
}

export async function fetchAllPaginatedResults<T>(
  queryFn:
    | ((options?: any) => Promise<PaginatedQueryResult<T>>)
    | ((input: any, options?: any) => Promise<PaginatedQueryResult<T>>),
  params?: any,
  setStepsCompleted?: (steps: number) => void
): Promise<T[]> {
  let allResults: T[] = [];
  let nextToken: string | null | undefined = undefined;
  let stepCount = 0;

  const { signal, ...queryParams } = params ?? {};
  const { input, options: baseOptions } = splitInputAndOptions(
    params ? queryParams : undefined
  );
  const callOptions = signal ? [{ signal }] : [];

  do {
    signal?.throwIfAborted();
    const options: Record<string, any> = { ...baseOptions, nextToken };
    const result: PaginatedQueryResult<T> =
      input === undefined
        ? await (queryFn as any)(options, ...callOptions)
        : await (queryFn as any)(input, options, ...callOptions);
    allResults = allResults.concat(result.data);
    nextToken = result.nextToken;
    stepCount += result.data.length;

    if (setStepsCompleted) {
      setStepsCompleted(stepCount);
    }
  } while (nextToken);

  return allResults;
}
// ReturnTypeOfFirstElementWithX is inferred as number
export const makeTransform =
  (H: Matrix) =>
  (c1: [number, number]): [number, number] => {
    const result = multiply(H, [c1[0], c1[1], 1]).valueOf() as number[];
    return [result[0] / result[2], result[1] / result[2]];
  };

export const array2Matrix = (hc: number[] | null): number[][] | null => {
  if (hc && hc.length == 9) {
    const hcCopy = [...hc]; // Create a shallow copy of the input array
    const matrix = [];
    while (hcCopy.length) matrix.push(hcCopy.splice(0, 3));
    return matrix; // Removed unnecessary intermediate variable
  } else {
    return null;
  }
};

// ReturnTypeOfFirstElementWithX is inferred as number

/**
 * Whether a point falls within a location's bounds. Locations store a centre
 * point plus width/height, so the test is against half-extents. The boundary
 * itself counts as inside.
 */
export function isWithinLocationBounds(
  point: { x: number; y: number },
  location: {
    x: number;
    y: number;
    width?: number | null;
    height?: number | null;
  }
): boolean {
  return (
    Math.abs(point.x - location.x) <= (location.width ?? 0) / 2 &&
    Math.abs(point.y - location.y) <= (location.height ?? 0) / 2
  );
}

/**
 * Map the user's currently selected category onto the annotation set actually
 * being written to. If the selected category belongs to another set, fall back
 * to the same-named category in the target set, then to that set's 'Unknown'.
 */
export function resolveCategoryIdForSet(
  currentCategory: {
    id: string;
    name: string;
    annotationSetId?: string | null;
  },
  categories: Array<{
    id: string;
    name: string;
    annotationSetId?: string | null;
  }>,
  targetSetId: string
): string {
  if (currentCategory.annotationSetId === targetSetId)
    return currentCategory.id;
  const sameName = categories.find(
    (c) => c.annotationSetId === targetSetId && c.name === currentCategory.name
  );
  if (sameName) return sameName.id;
  const unknown = categories.find(
    (c) =>
      c.annotationSetId === targetSetId && c.name.toLowerCase() === 'unknown'
  );
  return unknown?.id ?? currentCategory.id;
}
