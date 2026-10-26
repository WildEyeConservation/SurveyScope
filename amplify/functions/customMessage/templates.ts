import { button, codeBox, layout, paragraph } from '../shared/emailLayout';

export interface Message {
  subject: string;
  html: string;
}

interface Placeholders {
  codeParameter: string;
  usernameParameter: string | null;
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
