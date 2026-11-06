import { apiRequest } from './httpClient';

export interface ResultsLink {
  token: string;
  expiresAt: number;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const result = (await apiRequest(path, body)) as {
    data: T;
    errors?: { message?: string }[];
  };
  if (result.errors?.length) {
    throw new Error(
      result.errors.map((e) => e.message ?? 'Unknown error').join('; '),
    );
  }
  return result.data;
}

export const resultsLink = (surveyId: string, annotationSetId: string) =>
  call<ResultsLink | null>('/results/link', { surveyId, annotationSetId });

export const shareResults = (
  surveyId: string,
  annotationSetId: string,
  expiresAt: number,
) =>
  call<ResultsLink>('/results/share', { surveyId, annotationSetId, expiresAt });

export const redeemResultsLink = (token: string) =>
  call<{ surveyId: string; annotationSetId: string }>('/results/redeem', {
    token,
  });
