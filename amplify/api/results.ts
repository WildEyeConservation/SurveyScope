import { jwtVerify, SignJWT } from 'jose';
import type { Access } from './access';
import { badRequest, forbidden } from './errors';
import type { DataLayer, Models } from './models';
import type { Row } from './schema';

export interface ResultsContext {
  access: Access;
  models: Models;
  data: DataLayer;
  secret: () => string;
}

const MAX_LIFETIME_MS = 31 * 24 * 3600 * 1000;

function ids(args: Row) {
  const { surveyId, annotationSetId } = args;
  if (typeof surveyId !== 'string' || typeof annotationSetId !== 'string') {
    throw badRequest('surveyId and annotationSetId are required');
  }
  return { surveyId, annotationSetId };
}

async function administeredSet(ctx: ResultsContext, args: Row) {
  const { surveyId, annotationSetId } = ids(args);
  await ctx.access.requireSurveyAdmin(surveyId);
  const set = await ctx.models.load('AnnotationSet', { id: annotationSetId });
  if (set?.projectId !== surveyId) throw forbidden();
  return { surveyId, annotationSetId };
}

async function readToken(ctx: ResultsContext, token: string) {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(ctx.secret()),
    );
    return payload;
  } catch {
    return null;
  }
}

async function currentLink(
  ctx: ResultsContext,
  surveyId: string,
  annotationSetId: string,
) {
  const row = (
    await ctx.data.get('ResultSharingToken', { surveyId, annotationSetId }, {})
  ).data;
  if (typeof row?.jwt !== 'string') return null;
  const payload = await readToken(ctx, row.jwt);
  if (!payload?.exp) return null;
  return { token: row.jwt, expiresAt: payload.exp * 1000 };
}

export async function link(ctx: ResultsContext, args: Row) {
  const { surveyId, annotationSetId } = await administeredSet(ctx, args);
  return { data: await currentLink(ctx, surveyId, annotationSetId) };
}

export async function share(ctx: ResultsContext, args: Row) {
  const { surveyId, annotationSetId } = await administeredSet(ctx, args);
  const expiresAt = Number(args.expiresAt);
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + MAX_LIFETIME_MS
  ) {
    throw badRequest('The link must expire within a month');
  }
  const existing = await currentLink(ctx, surveyId, annotationSetId);
  if (existing && existing.expiresAt > Date.now()) return { data: existing };
  const token = await new SignJWT({ type: 'jolly', surveyId, annotationSetId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(new TextEncoder().encode(ctx.secret()));
  const organizationId = await ctx.access.organizationOfProject(surveyId);
  const key = { surveyId, annotationSetId };
  await ctx.data.delete('ResultSharingToken', key, {});
  await ctx.data.create(
    'ResultSharingToken',
    { ...key, jwt: token, group: organizationId },
    {},
  );
  return { data: { token, expiresAt: Math.floor(expiresAt / 1000) * 1000 } };
}

export async function redeem(ctx: ResultsContext, args: Row) {
  if (typeof args.token !== 'string') throw badRequest('Missing token');
  const payload = await readToken(ctx, args.token);
  if (
    payload?.type !== 'jolly' ||
    typeof payload.surveyId !== 'string' ||
    typeof payload.annotationSetId !== 'string'
  ) {
    throw forbidden('The results link is invalid or has expired');
  }
  const surveyId = payload.surveyId;
  const annotationSetId = payload.annotationSetId;
  const stored = (
    await ctx.data.get('ResultSharingToken', { surveyId, annotationSetId }, {})
  ).data;
  if (stored?.jwt !== args.token)
    throw forbidden('The results link is invalid or has expired');
  const userId = ctx.access.userId;
  const key = { surveyId, annotationSetId, userId };
  const existing = (await ctx.data.get('JollyResultsMembership', key, {})).data;
  if (!existing) {
    const group = await ctx.access.organizationOfProject(surveyId);
    await ctx.data.create('JollyResultsMembership', { ...key, group }, {});
  }
  return { data: { surveyId, annotationSetId } };
}
