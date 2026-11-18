import pLimit from 'p-limit';

// Above this many images, paging the project index beats one getImage per image.
const PROJECT_SCAN_THRESHOLD = 500;

export type ImageTileState = {
  id: string;
  projectId?: string | null;
  tiledAt: string | null;
  originalPath: string | null;
};

type ExecuteGraphql = <T>(
  query: string,
  variables: Record<string, unknown>,
) => Promise<T>;

const getImageQuery = /* GraphQL */ `
  query GetImage($id: ID!) {
    getImage(id: $id) {
      id
      projectId
      tiledAt
      originalPath
    }
  }
`;

const imagesByProjectIdQuery = /* GraphQL */ `
  query ImagesByProjectId($projectId: ID!, $nextToken: String) {
    imagesByProjectId(
      projectId: $projectId
      limit: 1000
      nextToken: $nextToken
    ) {
      items {
        id
        tiledAt
        originalPath
      }
      nextToken
    }
  }
`;

type ImagesPage = {
  imagesByProjectId?: {
    items: ImageTileState[];
    nextToken?: string | null;
  } | null;
};

export async function loadImageTileStates(
  projectId: string,
  imageIds: string[],
  executeGraphql: ExecuteGraphql,
): Promise<Map<string, ImageTileState>> {
  const wanted = new Set(imageIds);
  const states = new Map<string, ImageTileState>();

  if (wanted.size > PROJECT_SCAN_THRESHOLD) {
    let nextToken: string | null = null;
    do {
      const data: ImagesPage = await executeGraphql<ImagesPage>(
        imagesByProjectIdQuery,
        {
          projectId,
          nextToken,
        },
      );
      for (const row of data.imagesByProjectId?.items ?? []) {
        if (row && wanted.has(row.id)) states.set(row.id, row);
      }
      nextToken = data.imagesByProjectId?.nextToken ?? null;
    } while (nextToken && states.size < wanted.size);
  }

  const remaining = Array.from(wanted).filter((id) => !states.has(id));
  const limit = pLimit(20);
  await Promise.all(
    remaining.map((id) =>
      limit(async () => {
        const data = await executeGraphql<{ getImage?: ImageTileState | null }>(
          getImageQuery,
          { id },
        );
        // Images of another project count as missing.
        const image = data.getImage;
        if (
          image &&
          (image.projectId == null || image.projectId === projectId)
        ) {
          states.set(id, image);
        }
      }),
    ),
  );

  return states;
}
