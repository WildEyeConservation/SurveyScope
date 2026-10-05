import { createHash } from 'node:crypto';

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_STACK_LENGTH = 20000;
export const MAX_FIELD_LENGTH = 2000;
// SNS subject limit.
export const MAX_SUBJECT_LENGTH = 100;

export const MAX_REPORTS_PER_USER_PER_WINDOW = 10;
export const LIMIT_WINDOW_MS = 60 * 60 * 1000;

export type ClientErrorArguments = {
  message: string;
  stack?: string | null;
  status?: string | null;
  url?: string | null;
  userAgent?: string | null;
};

export type ClientErrorReport = {
  message: string;
  stack?: string;
  status?: string;
  url?: string;
  userAgent?: string;
  userId: string;
  userEmail?: string;
};

export function bounded(
  value: string | null | undefined,
  maxLength: number
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}… [truncated]`
    : trimmed;
}

export function buildReport(
  args: ClientErrorArguments,
  userId: string,
  userEmail?: string
): ClientErrorReport {
  return {
    message: bounded(args.message, MAX_MESSAGE_LENGTH) ?? 'Unknown error',
    stack: bounded(args.stack, MAX_STACK_LENGTH),
    status: bounded(args.status, MAX_FIELD_LENGTH),
    url: bounded(args.url, MAX_FIELD_LENGTH),
    userAgent: bounded(args.userAgent, MAX_FIELD_LENGTH),
    userId,
    userEmail,
  };
}

export function limiterKeys(
  userId: string,
  args: ClientErrorArguments,
  nowMs: number
): { duplicate: string; rate: string; expiresAt: number } {
  const window = Math.floor(nowMs / LIMIT_WINDOW_MS);
  const fingerprint = createHash('sha256')
    .update(`${args.message}\n${args.stack ?? ''}`)
    .digest('hex');
  return {
    duplicate: `duplicate#${userId}#${window}#${fingerprint}`,
    rate: `rate#${userId}#${window}`,
    expiresAt: Math.ceil(((window + 2) * LIMIT_WINDOW_MS) / 1000),
  };
}

export function buildNotification(
  report: ClientErrorReport,
  environment: string,
  reportId: string | undefined
): { subject: string; message: string } {
  return {
    // SNS subjects must be single-line printable ASCII.
    subject: `[SurveyScope ${environment}] Client error: ${report.message}`
      .replace(/[^\x20-\x7E]+/g, ' ')
      .slice(0, MAX_SUBJECT_LENGTH),
    message: [
      'A user reached the SurveyScope error page.',
      '',
      `Environment: ${environment}`,
      `User: ${report.userEmail ?? 'unknown email'} (${report.userId})`,
      `URL: ${report.url ?? 'N/A'}`,
      `Status: ${report.status ?? 'N/A'}`,
      `User agent: ${report.userAgent ?? 'N/A'}`,
      `Report ID: ${reportId ?? 'not saved - see the function logs'}`,
      '',
      `Message: ${report.message}`,
      '',
      'Stack trace:',
      report.stack ?? 'No stack trace available',
    ].join('\n'),
  };
}

export type Reservation = {
  release: () => Promise<void>;
};

export type LimiterStore = {
  claimDuplicate: (key: string, expiresAt: number) => Promise<boolean>;
  incrementRate: (
    key: string,
    expiresAt: number,
    max: number
  ) => Promise<boolean>;
  releaseDuplicate: (key: string) => Promise<void>;
};

export function createReserve(
  store: LimiterStore,
  now: () => number = Date.now
): ReportDependencies['reserve'] {
  return async (userId, args) => {
    const keys = limiterKeys(userId, args, now());
    const release = async () => {
      try {
        await store.releaseDuplicate(keys.duplicate);
      } catch (error) {
        console.error('Failed to release the client error claim', error);
      }
    };
    try {
      // Duplicate first, so a crash loop on one error leaves the rate budget.
      if (!(await store.claimDuplicate(keys.duplicate, keys.expiresAt))) {
        return null;
      }
      if (
        !(await store.incrementRate(
          keys.rate,
          keys.expiresAt,
          MAX_REPORTS_PER_USER_PER_WINDOW
        ))
      ) {
        return null;
      }
    } catch (error) {
      // Fail open.
      console.error('Client error limiter failed; accepting the report', error);
    }
    return { release };
  };
}

export type ReportDependencies = {
  reserve: (
    userId: string,
    args: ClientErrorArguments
  ) => Promise<Reservation | null>;
  lookUpEmail: (userId: string) => Promise<string | undefined>;
  save: (report: ClientErrorReport) => Promise<string | undefined>;
  notify?: (subject: string, message: string) => Promise<void>;
};

export type ReportOutcome = {
  id?: string;
  notified: boolean;
  throttled: boolean;
};

export async function processClientError(
  dependencies: ReportDependencies,
  userId: string,
  args: ClientErrorArguments,
  environment: string
): Promise<ReportOutcome> {
  const reservation = await dependencies.reserve(userId, args);
  if (!reservation) {
    return { notified: false, throttled: true };
  }

  let userEmail: string | undefined;
  try {
    userEmail = await dependencies.lookUpEmail(userId);
  } catch (error) {
    console.warn('Could not look up the reporting user email', error);
  }
  const report = buildReport(args, userId, userEmail);

  let id: string | undefined;
  let saveError: unknown;
  try {
    id = await dependencies.save(report);
  } catch (error) {
    saveError = error;
    console.error('Failed to save the client error report', error, report);
  }

  let notified = false;
  if (dependencies.notify) {
    const { subject, message } = buildNotification(report, environment, id);
    try {
      await dependencies.notify(subject, message);
      notified = true;
    } catch (error) {
      console.error('Failed to send the client error notification', error);
    }
  }

  if (saveError && !notified) await reservation.release();
  if (saveError) throw saveError;
  return { id, notified, throttled: false };
}
