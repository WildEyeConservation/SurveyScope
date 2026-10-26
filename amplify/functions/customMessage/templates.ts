const APP_URL = 'https://www.surveyscope.org';
const LOGO_URL = `${APP_URL}/email/wildeye-logo.png`;
const ACCENT = '#1C463D';
const TEXT = '#1f2933';
const MUTED = '#6b7280';

export interface Message {
  subject: string;
  html: string;
}

interface Placeholders {
  codeParameter: string;
  usernameParameter: string | null;
}

function layout(heading: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:${TEXT};">
<tr><td align="center" style="background:${ACCENT};padding:28px 24px;">
<img src="${LOGO_URL}" width="200" alt="WildEye" style="display:block;width:200px;max-width:100%;height:auto;border:0;">
</td></tr>
<tr><td style="padding:32px 32px 8px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:bold;">${heading}</h1>
${body}
</td></tr>
<tr><td style="padding:24px 32px 32px;font-size:12px;line-height:1.5;color:${MUTED};border-top:1px solid #e5e7eb;">
SurveyScope is built by WildEye Conservation. If you weren't expecting this email, you can ignore it.
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${text}</p>`;
}

function codeBox(label: string, value: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
<tr><td style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;padding-bottom:4px;">${label}</td></tr>
<tr><td style="background:#f3f4f6;border-radius:6px;padding:12px 16px;font-family:Menlo,Consolas,monospace;font-size:16px;">${value}</td></tr>
</table>`;
}

function button(label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
<tr><td style="background:${ACCENT};border-radius:6px;">
<a href="${APP_URL}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${label}</a>
</td></tr>
</table>`;
}

function invitation({ codeParameter, usernameParameter }: Placeholders): Message {
  return {
    subject: 'WildEye invited you to use SurveyScope',
    html: layout(
      'WildEye invited you to use SurveyScope',
      paragraph(
        'An account has been created for you on SurveyScope. Use the details below to log in.'
      ) +
        codeBox('Email', usernameParameter ?? '') +
        codeBox('Temporary password', codeParameter) +
        button('Log in to SurveyScope') +
        paragraph(
          "You'll be asked to choose a new password the first time you log in. The temporary password expires in 7 days."
        )
    ),
  };
}

function verification(
  subject: string,
  heading: string,
  intro: string,
  expiry: string,
  { codeParameter }: Placeholders
): Message {
  return {
    subject,
    html: layout(
      heading,
      paragraph(intro) +
        codeBox('Verification code', codeParameter) +
        paragraph(expiry)
    ),
  };
}

export function messageFor(
  triggerSource: string,
  placeholders: Placeholders
): Message | null {
  switch (triggerSource) {
    case 'CustomMessage_AdminCreateUser':
      return invitation(placeholders);
    case 'CustomMessage_SignUp':
    case 'CustomMessage_ResendCode':
      return verification(
        'Verify your SurveyScope account',
        'Welcome to SurveyScope',
        'Enter this code to verify your email address and finish setting up your account.',
        'This code expires in 24 hours.',
        placeholders
      );
    case 'CustomMessage_ForgotPassword':
      return verification(
        'Reset your SurveyScope password',
        'Reset your password',
        'Enter this code to choose a new password for your SurveyScope account.',
        "This code expires in 1 hour. If you didn't ask to reset your password, you can ignore this email.",
        placeholders
      );
    case 'CustomMessage_UpdateUserAttribute':
    case 'CustomMessage_VerifyUserAttribute':
      return verification(
        'Confirm your new SurveyScope email',
        'Confirm your email address',
        'Enter this code to confirm the email address on your SurveyScope account.',
        'This code expires in 24 hours.',
        placeholders
      );
    default:
      return null;
  }
}
