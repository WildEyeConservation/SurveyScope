import { EncryptJWT, jwtDecrypt } from 'jose';
import { createHash } from 'node:crypto';
import {
  arrangeItems,
  cropFits,
  isModelSource,
  matchingCategories,
  NOTEBOOK_LIMIT,
  sampleAcrossSurveys,
  type NotebookCandidate,
  type NotebookCrop,
  type NotebookExample,
  type NotebookExamples,
} from '../../shared/speciesNotebook';
import type { Access } from './access';
import { badRequest, forbidden } from './errors';
import type { DataLayer, Result } from './models';
import type { Row } from './schema';

export interface NotebookContext {
  access: Access;
  data: DataLayer;
  secret: () => string;
  images: {
    crop(
      imageId: string,
      point: { x: number; y: number },
    ): Promise<NotebookCrop | null>;
  };
}

type Category = {
  id: string;
  name: string;
  color?: string | null;
  projectId: string;
  annotationSetId: string;
};

type Candidate = NotebookCandidate & {
  x: number;
  y: number;
  setId: string;
  categoryId: string;
};

const TOKEN_LIFETIME = '30m';
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as Promise<T>;
  const value = load();
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

function required(args: Row, name: string) {
  const value = args[name];
  if (typeof value !== 'string' || value === '')
    throw badRequest(`Missing ${name}`);
  return value;
}

async function pages(
  load: (nextToken: string | null) => Promise<Result<Row[]>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  let nextToken: string | null = null;
  do {
    const page = await load(nextToken);
    if (page.errors?.length && !page.data)
      throw new Error(JSON.stringify(page.errors));
    rows.push(...(page.data ?? []));
    nextToken = page.nextToken ?? null;
  } while (nextToken);
  return rows;
}

function categoriesOf(data: DataLayer, projectId: string) {
  return cached(`categories:${projectId}`, async () =>
    (
      await pages((nextToken) =>
        data.query(
          'Category',
          'categoriesByProjectId',
          { projectId },
          {
            selectionSet: [
              'id',
              'name',
              'color',
              'projectId',
              'annotationSetId',
            ],
            limit: 1000,
            nextToken,
          },
        ),
      )
    ).map((row) => row as unknown as Category),
  );
}

function otherSurveys(data: DataLayer, organizationId: string) {
  return cached(`surveys:${organizationId}`, async () =>
    (
      await pages((nextToken) =>
        data.list('Project', {
          filter: { organizationId: { eq: organizationId } },
          selectionSet: ['id', 'status'],
          limit: 1000,
          nextToken,
        }),
      )
    )
      .filter((row) => row.status !== 'deleted')
      .map((row) => String(row.id)),
  );
}

function imageSize(data: DataLayer, id: string) {
  return cached(`image:${id}`, async () => {
    const image = (
      await data.get('Image', { id }, { selectionSet: ['width', 'height'] })
    ).data;
    return {
      width: Number(image?.width) || 0,
      height: Number(image?.height) || 0,
    };
  });
}

// No paging, so callers cannot ask for more examples.
function firstAnnotations(data: DataLayer, categoryId: string, limit: number) {
  return cached(`annotations:${categoryId}:${limit}`, async () => {
    const candidates = await firstPage(data, categoryId, limit * 2);
    const fits = await Promise.all(
      candidates.map(async (c) =>
        cropFits(c, await imageSize(data, c.imageId)),
      ),
    );
    return candidates.filter((_, i) => fits[i]).slice(0, limit);
  });
}

async function firstPage(data: DataLayer, categoryId: string, limit: number) {
  const page = await data.query(
    'Annotation',
    'annotationsByCategoryId',
    { categoryId },
    {
      selectionSet: [
        'id',
        'x',
        'y',
        'imageId',
        'setId',
        'categoryId',
        'projectId',
        'objectId',
        'source',
        'reviewedBy',
        'reviewCatId',
        'createdAt',
        'oov',
      ],
      limit,
    },
  );
  if (page.errors?.length && !page.data)
    throw new Error(JSON.stringify(page.errors));
  return (page.data ?? [])
    .slice(0, limit)
    .filter(
      (row) =>
        !row.oov &&
        typeof row.imageId === 'string' &&
        typeof row.x === 'number' &&
        typeof row.y === 'number',
    )
    .map((row): Candidate => ({
      id: String(row.id),
      x: row.x as number,
      y: row.y as number,
      imageId: row.imageId as string,
      setId: String(row.setId),
      categoryId: String(row.categoryId),
      projectId: String(row.projectId),
      objectId: (row.objectId as string | null) ?? null,
      source: (row.source as string | null) ?? null,
      createdAt: (row.createdAt as string | null) ?? null,
      reviewed: Boolean(row.reviewedBy || row.reviewCatId),
    }));
}

const tokenKey = (ctx: NotebookContext) =>
  new Uint8Array(
    createHash('sha256').update(`species-notebook:${ctx.secret()}`).digest(),
  );

// Encrypted, so the client cannot read the image or position inside.
async function exampleToken(
  ctx: NotebookContext,
  surveyId: string,
  item: Candidate,
) {
  return new EncryptJWT({
    s: surveyId,
    i: item.imageId,
    x: item.x,
    y: item.y,
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setSubject(ctx.access.actor.sub)
    .setIssuedAt()
    .setExpirationTime(TOKEN_LIFETIME)
    .encrypt(tokenKey(ctx));
}

// A crop could show a test answer, so images holding the caller's tests are left out.
async function testImages(ctx: NotebookContext) {
  return new Set((await ctx.access.testPool()).boxes.keys());
}

async function toExample(
  ctx: NotebookContext,
  surveyId: string,
  item: Candidate,
  borrowed: boolean,
): Promise<NotebookExample> {
  const example: NotebookExample = {
    token: await exampleToken(ctx, surveyId, item),
    reviewed: item.reviewed,
    model: isModelSource(item.source),
    borrowed,
  };
  if (await ctx.access.isSurveyAdmin(item.projectId)) {
    example.explore = {
      projectId: item.projectId,
      imageId: item.imageId,
      annotationSetId: item.setId,
      categoryId: item.categoryId,
    };
  }
  return example;
}

async function borrowedCategories(
  ctx: NotebookContext,
  surveyId: string,
): Promise<Category[]> {
  const organizationId = await ctx.access.organizationOfProject(surveyId);
  if (!organizationId) return [];
  const surveys = (await otherSurveys(ctx.data, organizationId)).filter(
    (id) => id !== surveyId,
  );
  return (
    await Promise.all(surveys.map((id) => categoriesOf(ctx.data, id)))
  ).flat();
}

export async function labels(ctx: NotebookContext, args: Row): Promise<Result> {
  const surveyId = required(args, 'projectId');
  await ctx.access.requireSurveyMember(surveyId);
  const names = new Set(
    (await borrowedCategories(ctx, surveyId)).map((c) => c.name),
  );
  return { data: { names: [...names].sort() } };
}

export async function examples(
  ctx: NotebookContext,
  args: Row,
): Promise<Result> {
  const surveyId = required(args, 'projectId');
  const name = required(args, 'name');
  await ctx.access.requireSurveyMember(surveyId);
  const tested = await testImages(ctx);
  const usable = (items: Candidate[]) =>
    items.filter((item) => !tested.has(item.imageId));
  const own = (await categoriesOf(ctx.data, surveyId)).filter(
    (c) => c.name === name,
  );
  const found: Candidate[] = [];
  for (const category of own) {
    const left = NOTEBOOK_LIMIT - found.length;
    if (left <= 0) break;
    found.push(...usable(await firstAnnotations(ctx.data, category.id, left)));
  }
  let items = arrangeItems(found);
  let borrowedSurveys = 0;
  if (items.length === 0) {
    const matches = matchingCategories(
      name,
      await borrowedCategories(ctx, surveyId),
      surveyId,
    ).slice(0, NOTEBOOK_LIMIT);
    const per = Math.max(1, Math.floor(NOTEBOOK_LIMIT / matches.length));
    const borrowed = usable(
      (
        await Promise.all(
          matches.map((c) => firstAnnotations(ctx.data, c.id, per)),
        )
      ).flat(),
    );
    items = sampleAcrossSurveys(borrowed, NOTEBOOK_LIMIT);
    borrowedSurveys = new Set(borrowed.map((item) => item.projectId)).size;
  }
  const result: NotebookExamples = {
    examples: await Promise.all(
      items.map((item) =>
        toExample(ctx, surveyId, item, item.projectId !== surveyId),
      ),
    ),
    borrowedSurveys,
  };
  return { data: result };
}

export async function crop(ctx: NotebookContext, args: Row): Promise<Result> {
  const token = required(args, 'token');
  let claims: Row;
  try {
    claims = (await jwtDecrypt(token, tokenKey(ctx))).payload;
  } catch {
    throw forbidden('This example has expired');
  }
  if (
    claims.sub !== ctx.access.actor.sub ||
    typeof claims.s !== 'string' ||
    typeof claims.i !== 'string' ||
    typeof claims.x !== 'number' ||
    typeof claims.y !== 'number'
  )
    throw forbidden();
  // Leaving the survey ends access to its examples.
  await ctx.access.requireSurveyMember(claims.s);
  if ((await testImages(ctx)).has(claims.i)) throw forbidden();
  return {
    data: await ctx.images.crop(claims.i, { x: claims.x, y: claims.y }),
  };
}
