export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Cognito ListUsers filters embed the address in quotes, so reject quotes and backslashes.
export function isValidEmail(email: string): boolean {
  return (
    email.length <= 254 && /^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/.test(email)
  );
}
