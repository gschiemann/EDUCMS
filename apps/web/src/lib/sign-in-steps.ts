/**
 * Identifier-first sign-in — the pure, testable half (2026-10-04).
 *
 * Owner: "the sign in seems so confusing, so many options… can't you just
 * show what's enabled for the user". So the page asks for ONE thing first —
 * the email — and then shows only what applies to it:
 *
 *   email ──Continue──▶ checking ──▶ method (password form)
 *                                └─▶ method (single sign-on, password behind a link)
 *
 * What is here is everything about that which is a plain decision rather than
 * UI: the step machine, the bounded lookup, and reading the lookup's answer
 * without trusting its shape. The page (`app/login/page.tsx`) renders it.
 *
 * ── THE THREE RULES THIS FILE HOLDS ───────────────────────────────────────
 *
 * 1. THE LOOKUP CAN NEVER BLOCK A SIGN-IN. `fetchSignInOptions` resolves to
 *    `null` on a timeout (3 s), a network error, a non-200 (incl. a 429 from
 *    the throttle) or an answer it does not recognise — and `null` means "show
 *    the password form", which is exactly what the page did before any of
 *    this existed.
 *
 * 2. STEP 2 IS A FUNCTION OF THE EMAIL'S DOMAIN, NEVER OF AN ACCOUNT. The
 *    server answers from the domain only; nothing here adds a branch that
 *    could tell a known address from an unknown one.
 *
 * 3. THE EMAIL LIVES IN MEMORY. Not in the URL, not in localStorage. The only
 *    hand-off is the explicit "Forgot password?" click, which passes it to the
 *    reset page through sessionStorage and is consumed on arrival.
 */

export type SsoProvider = 'oidc' | 'saml';

export interface SsoOption {
  tenantSlug: string;
  provider: SsoProvider;
  /** "Google", "Microsoft", "Okta"… when the server recognises the issuer. */
  label: string | null;
}

export interface SignInOptions {
  sso: SsoOption | null;
  /**
   * May this organization's people still sign in with a password? Only ever
   * `false` together with single sign-on — with no SSO to offer, the password
   * form is the only way in and is always shown.
   */
  passwordAllowed: boolean;
}

export type SignInStep =
  /** Step 1 — just the email. */
  | { name: 'email' }
  /** Step 1, Continue pressed, the lookup is in flight. */
  | { name: 'checking'; email: string }
  /**
   * Step 2. `sso` non-null ⇒ single sign-on is the primary action and the
   * password form is behind "Use a password instead" (`passwordOpen`) — when
   * the organization allows a password at all (`passwordAllowed`).
   * `sso` null ⇒ the password form IS the step.
   */
  | { name: 'method'; email: string; sso: SsoOption | null; passwordAllowed: boolean; passwordOpen: boolean };

export type SignInEvent =
  | { type: 'CONTINUE'; email: string }
  /** `options: null` = the lookup failed or timed out → password form. */
  | { type: 'OPTIONS'; email: string; options: SignInOptions | null }
  | { type: 'USE_PASSWORD' }
  | { type: 'CHANGE' };

export const INITIAL_SIGN_IN_STEP: SignInStep = { name: 'email' };

/** How long "Continue" may wait on the lookup before the password form shows. */
export const SIGN_IN_OPTIONS_TIMEOUT_MS = 3_000;

/** The same normalisation the API applies to every credential email. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function signInStepReducer(step: SignInStep, event: SignInEvent): SignInStep {
  switch (event.type) {
    case 'CONTINUE': {
      const email = normalizeEmail(event.email);
      // Only from step 1, and only with something to look up. A second
      // Continue while one is in flight restarts with the newer address.
      if (step.name === 'method' || !email) return step;
      return { name: 'checking', email };
    }
    case 'OPTIONS': {
      // An answer for an address the operator has already moved on from
      // (they pressed Change, or edited and pressed Continue again) is stale.
      if (step.name !== 'checking' || step.email !== event.email) return step;
      const sso = event.options?.sso ?? null;
      // Never a dead end: with no single sign-on to offer, the password form
      // is shown whatever else the answer said.
      const passwordAllowed = sso === null || event.options?.passwordAllowed !== false;
      return { name: 'method', email: step.email, sso, passwordAllowed, passwordOpen: sso === null };
    }
    case 'USE_PASSWORD':
      if (step.name !== 'method' || !step.passwordAllowed) return step;
      return { ...step, passwordOpen: true };
    case 'CHANGE':
      return INITIAL_SIGN_IN_STEP;
    default:
      return step;
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;

/**
 * Read the lookup's answer. Anything that is not exactly the documented shape
 * is "no single sign-on" — never a thrown error, and never a half-trusted
 * value that ends up in a URL (`tenantSlug` and `provider` do).
 */
export function parseSignInOptions(data: unknown): SignInOptions {
  const NO_SSO: SignInOptions = { sso: null, passwordAllowed: true };
  const sso = (data as { sso?: unknown } | null)?.sso as
    | { tenantSlug?: unknown; provider?: unknown; label?: unknown }
    | null
    | undefined;
  if (!sso || typeof sso !== 'object') return NO_SSO;
  const { tenantSlug, provider, label } = sso;
  if (typeof tenantSlug !== 'string' || !SLUG_RE.test(tenantSlug)) return NO_SSO;
  if (provider !== 'oidc' && provider !== 'saml') return NO_SSO;
  return {
    sso: {
      tenantSlug,
      provider,
      label: typeof label === 'string' && label.trim() && label.length <= 40 ? label.trim() : null,
    },
    // Only an explicit `false` removes the password form. The API answers
    // `true` for every organization today (there is no "SSO only" switch).
    passwordAllowed: (data as { password?: unknown }).password !== false,
  };
}

type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Ask the API what applies to this email's domain. Resolves `null` — "show the
 * password form" — on ANY failure, and always within `timeoutMs`: the timer
 * races the whole call, body read included, because a `fetch` that resolved at
 * the headers and then stalled on the body would otherwise hold Continue
 * forever.
 */
export async function fetchSignInOptions(
  apiUrl: string,
  email: string,
  opts: { timeoutMs?: number; fetchImpl?: FetchLike } = {},
): Promise<SignInOptions | null> {
  const timeoutMs = opts.timeoutMs ?? SIGN_IN_OPTIONS_TIMEOUT_MS;
  const doFetch: FetchLike | undefined =
    opts.fetchImpl ?? (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : undefined);
  if (!doFetch) return null;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      try { controller?.abort(); } catch { /* nothing to abort */ }
      resolve(null);
    }, timeoutMs);
  });

  const call = (async (): Promise<SignInOptions | null> => {
    try {
      const res = await doFetch(`${apiUrl}/auth/sign-in-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!res.ok) return null;
      return parseSignInOptions(await res.json());
    } catch {
      return null;
    }
  })();

  try {
    return await Promise.race([call, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Where the browser goes to start single sign-on — the API 302s to the provider. */
export function ssoLoginUrl(apiUrl: string, sso: SsoOption): string {
  return `${apiUrl}/auth/sso/${encodeURIComponent(sso.tenantSlug)}/${sso.provider}/login`;
}

/**
 * Leave the page for the identity provider. Its own function so the page's
 * tests can observe the navigation (jsdom cannot navigate).
 */
export function leaveForSingleSignOn(url: string): void {
  window.location.assign(url);
}

// ── "Forgot password?" hand-off ─────────────────────────────────────────────
// sessionStorage, written only by that click and removed by the reset page the
// moment it reads it. Every access is wrapped: Safari private mode and
// locked-down kiosks THROW on storage, and a link must still work.

export const RESET_EMAIL_HANDOFF_KEY = 'venueos_reset_email';

export function stashEmailForReset(email: string): void {
  try {
    const value = normalizeEmail(email);
    if (value && typeof window !== 'undefined') window.sessionStorage.setItem(RESET_EMAIL_HANDOFF_KEY, value);
  } catch {
    /* no storage — the reset page just starts empty */
  }
}

export function takeEmailForReset(): string {
  try {
    if (typeof window === 'undefined') return '';
    const value = window.sessionStorage.getItem(RESET_EMAIL_HANDOFF_KEY) || '';
    window.sessionStorage.removeItem(RESET_EMAIL_HANDOFF_KEY);
    return value.length <= 254 ? value : '';
  } catch {
    return '';
  }
}
