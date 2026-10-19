/** Bounded, linear email shape validation for the onboarding service boundary. */
export function isValidEmail(email: string): boolean {
  if (!email || email.length > 254 || /\s/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0]) return false;
  const domain = parts[1];
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}
