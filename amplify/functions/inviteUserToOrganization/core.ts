import { createHash } from 'node:crypto';
import {
  APP_URL,
  button,
  escapeHtml,
  layout,
  paragraph,
} from '../shared/emailLayout';

export const SENDER = 'SurveyScope <no-reply@surveyscope.org>';

export const RECIPIENT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const ORGANIZATION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_INVITES_PER_ORGANIZATION = 20;
export const REPEAT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_REPEAT_INVITES = 3;

export type InviteLimit = 'recipient' | 'organization' | 'repeat';

export const LIMIT_MESSAGES: Record<InviteLimit, string> = {
  recipient:
    'This email address was sent an invitation in the last 24 hours. Try again tomorrow.',
  organization: `This organization has reached its limit of ${MAX_INVITES_PER_ORGANIZATION} invitations a day. Try again tomorrow.`,
  repeat: `This email address has been invited to this organization ${MAX_REPEAT_INVITES} times recently. Contact WildEye support if they need another invitation.`,
};

export class InviteLimitError extends Error {
  constructor(readonly limit: InviteLimit) {
    super(LIMIT_MESSAGES[limit]);
  }
}

export type LimitUpdate =
  | { limit: 'recipient'; key: string; expiresAt: number; now: number }
  | {
      limit: 'organization' | 'repeat';
      key: string;
      expiresAt: number;
      max: number;
    };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return (
    email.length <= 254 && /^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/.test(email)
  );
}

// Apply identical limits whether or not the address has an account.
export function limitUpdates(
  organizationId: string,
  email: string,
  nowMs: number
): LimitUpdate[] {
  const recipient = createHash('sha256')
    .update(normalizeEmail(email))
    .digest('hex');
  const day = Math.floor(nowMs / ORGANIZATION_WINDOW_MS);
  const period = Math.floor(nowMs / REPEAT_WINDOW_MS);
  return [
    {
      limit: 'recipient',
      key: `recipient#${recipient}`,
      now: Math.floor(nowMs / 1000),
      expiresAt: Math.ceil((nowMs + RECIPIENT_COOLDOWN_MS) / 1000),
    },
    {
      limit: 'organization',
      key: `organization#${organizationId}#${day}`,
      max: MAX_INVITES_PER_ORGANIZATION,
      expiresAt: Math.ceil(((day + 1) * ORGANIZATION_WINDOW_MS) / 1000),
    },
    {
      limit: 'repeat',
      key: `repeat#${organizationId}#${recipient}#${period}`,
      max: MAX_REPEAT_INVITES,
      expiresAt: Math.ceil(((period + 1) * REPEAT_WINDOW_MS) / 1000),
    },
  ];
}

export function organizationInviteEmail(organizationName: string): {
  subject: string;
  html: string;
  text: string;
} {
  const name = organizationName.replace(/\s+/g, ' ').trim();
  const heading = `${name} invited you to join them on SurveyScope`;
  const intro = `You've been invited to join ${name} on SurveyScope. Log in to accept or decline the invitation from your SurveyScope inbox.`;
  return {
    subject: heading,
    html: layout(
      escapeHtml(heading),
      paragraph(escapeHtml(intro)) + button('Log in to SurveyScope')
    ),
    text: `${intro}\n\n${APP_URL}\n\nIf you weren't expecting this email, you can ignore it.`,
  };
}

export type InviteDependencies = {
  reserve: (updates: LimitUpdate[]) => Promise<void>;
  findUser: (
    email: string
  ) => Promise<{ userId: string; email?: string } | null>;
  isMember: (userId: string) => Promise<boolean>;
  hasPendingInvite: (userId: string) => Promise<boolean>;
  createInvite: (userId: string) => Promise<string>;
  sendEmail: (to: string, organizationName: string) => Promise<void>;
};

export async function processInvite(
  dependencies: InviteDependencies,
  organizationId: string,
  rawEmail: string,
  limited: boolean,
  nowMs: number = Date.now()
): Promise<void> {
  const email = rawEmail.trim();
  if (!isValidEmail(email)) {
    throw new Error('Enter a valid email address');
  }
  // Before any lookup, so a rejection doesn't depend on the account.
  if (limited) {
    await dependencies.reserve(limitUpdates(organizationId, email, nowMs));
  }
  const user = await dependencies.findUser(email);
  if (!user) return;
  // Members are already visible to the admin.
  if (await dependencies.isMember(user.userId)) {
    throw new Error('User is already a member of this organization');
  }
  if (await dependencies.hasPendingInvite(user.userId)) return;
  const organizationName = await dependencies.createInvite(user.userId);
  try {
    await dependencies.sendEmail(user.email ?? email, organizationName);
  } catch (error) {
    console.error('Failed to send the invite email', error);
  }
}
