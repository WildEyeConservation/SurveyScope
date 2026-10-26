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
