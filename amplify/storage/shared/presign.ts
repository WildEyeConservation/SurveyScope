import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

// Upload URLs are signed without a body, so default SDK checksums would be of an empty payload.
export function presignClient(config: S3ClientConfig = {}) {
  return new S3Client({
    ...config,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export interface Lifetime {
  expiresIn: number;
  expiresAt: number;
}

const DEFAULT_EXPIRY = 3600;
const MIN_EXPIRY = 60;

// Lease-only access may ask for a shorter expiry; anything invalid is ignored.
export function requestedExpiry(maxExpiresIn: unknown): number {
  return typeof maxExpiresIn === 'number' &&
    Number.isInteger(maxExpiresIn) &&
    maxExpiresIn >= MIN_EXPIRY
    ? Math.min(DEFAULT_EXPIRY, maxExpiresIn)
    : DEFAULT_EXPIRY;
}

/** One hour (or maxExpiresIn if shorter), capped by the signing credentials' own expiry. */
export async function signingLifetime(
  s3: S3Client,
  maxExpiresIn?: unknown
): Promise<Lifetime> {
  const credentials = await s3.config.credentials();
  const limit = requestedExpiry(maxExpiresIn);
  const expiresIn = Math.min(
    limit,
    credentials.expiration
      ? Math.floor((credentials.expiration.getTime() - Date.now()) / 1000) - 30
      : limit
  );
  if (expiresIn < MIN_EXPIRY) {
    throw new Error('Signing session is expiring; retry shortly');
  }
  return { expiresIn, expiresAt: Date.now() + expiresIn * 1000 };
}
