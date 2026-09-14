import type { S3Client } from '@aws-sdk/client-s3';

export interface Lifetime {
  expiresIn: number;
  expiresAt: number;
}

/** One hour, capped by the signing credentials' own expiry. */
export async function signingLifetime(s3: S3Client): Promise<Lifetime> {
  const credentials = await s3.config.credentials();
  const expiresIn = Math.min(
    3600,
    credentials.expiration
      ? Math.floor((credentials.expiration.getTime() - Date.now()) / 1000) - 30
      : 3600
  );
  if (expiresIn < 60) {
    throw new Error('Signing session is expiring; retry shortly');
  }
  return { expiresIn, expiresAt: Date.now() + expiresIn * 1000 };
}
