/**
 * Which `signup.errors.*` message a failed `POST /signup` should show.
 *
 * The API answers in English with no error codes (onboarding.service.ts throws
 * `BadRequestException('Slug is required.')`, `ConflictException('That slug is
 * already taken.')` …, and the Zod pipe adds `issues[]`), so the page used to
 * print those sentences verbatim to every reader in every language. This maps
 * each answer the API can give to a translated message; anything it does not
 * recognise falls back to the server's own words (better than nothing), and
 * `signup-errors.test.ts` reads the API source so a reworded server message
 * turns this red instead of silently falling back to English.
 *
 * Pure: no React, no fetch.
 */
export type SignupErrorKey =
  | 'nameRequired'
  | 'slugRequired'
  | 'slugTaken'
  | 'emailInvalid'
  | 'emailTaken'
  | 'industry'
  | 'checkFields'
  | 'tooMany'
  | 'generic';

/** The exact sentences `OnboardingService.signup` throws, and what each one means. */
export const SIGNUP_SERVER_MESSAGES: Readonly<Record<string, SignupErrorKey>> = {
  'Organization name is required.': 'nameRequired',
  'Slug is required.': 'slugRequired',
  'A valid admin email is required.': 'emailInvalid',
  'Invalid vertical.': 'industry',
  'That slug is already taken.': 'slugTaken',
  'An account with that email already exists.': 'emailTaken',
};

/** Zod `issues[].path` → message, for the fields the form owns. */
const FIELD_KEYS: Readonly<Record<string, SignupErrorKey>> = {
  districtName: 'nameRequired',
  slug: 'slugRequired',
  adminEmail: 'emailInvalid',
  vertical: 'industry',
};

export interface SignupErrorBody {
  message?: unknown;
  issues?: Array<{ path?: unknown }> | unknown;
}

/**
 * `{ key }` when the answer is one we can say in the reader's language,
 * `{ raw }` when only the server's own sentence is available.
 */
export function signupErrorFor(status: number, body: SignupErrorBody | null | undefined): { key: SignupErrorKey } | { raw: string } {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const known = message ? SIGNUP_SERVER_MESSAGES[message] : undefined;
  if (known) return { key: known };

  if (status === 429) return { key: 'tooMany' };

  const issues = Array.isArray(body?.issues) ? (body?.issues as Array<{ path?: unknown }>) : [];
  if (issues.length > 0) {
    for (const issue of issues) {
      const field = typeof issue?.path === 'string' ? issue.path.split('.')[0] : '';
      if (FIELD_KEYS[field]) return { key: FIELD_KEYS[field] };
    }
    return { key: 'checkFields' };
  }

  if (status >= 500 || !message) return { key: 'generic' };
  return { raw: message };
}
