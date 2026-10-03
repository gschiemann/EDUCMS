/**
 * Tenant URL labels — the words a tenant slug may never be.
 *
 * A tenant's slug is the first path segment of its dashboard
 * (`/<slug>/dashboard`), so it shares ONE namespace with every top-level route
 * the web origin serves: the Next app directories, the static folders under
 * `apps/web/public`, and the framework's own prefixes. A tenant named after one
 * of those would be unreachable at best (the static route wins the match) and
 * would shadow a real page at worst.
 *
 * THIS IS THE ONLY LIST. Every path that mints or accepts a tenant slug on the
 * API (rename, add-a-location, self-signup) and the dashboard's URL
 * canonicalizer read it from here — a second copy is how the first one drifts.
 * `apps/api/src/tenants/reserved-tenant-slugs.spec.ts` reads the web app's
 * directories from disk and fails when a new top-level route is not listed, so
 * adding a route and forgetting this file is a red test, not a claimable URL.
 */
export const RESERVED_TENANT_SLUGS: ReadonlySet<string> = new Set([
  'api', '_next', 'login', 'logout', 'signup', 'super', 'player', 'pair',
  'console', 'connect', 'demo', 'auth', 'onboarding', 'invite', 'reset-password',
  'forgot-password', 'verify-email', 'privacy', 'terms', 'templates',
  'accept-invite', 'assets', 'athlete', 'board', 'cdn', 'coppa', 'dashboard',
  'dev', 'ferpa', 'guide', 'help', 'launch', 'overlay', 'panic', 'pricing',
  'ribbon', 'schedules', 'scorebug', 'screens', 'status',
  // Static folders under apps/web/public that are served at `/<name>`.
  // `locales` is generated there by scripts/emit-locale-catalogs.cjs
  // (gitignored), so only the explicit assertion in the spec can see it in CI.
  'celebrations', 'holiday-templates', 'icons', 'locales',
]);

/** True when `slug` is a word the web origin already serves. Case-insensitive. */
export function isReservedTenantSlug(slug: string): boolean {
  return RESERVED_TENANT_SLUGS.has(slug.toLowerCase());
}

/**
 * The longest organization name `PATCH /tenants/me` accepts. The account URL is
 * derived from the name, so its bound sits beside the slug rules: the API
 * refuses a longer one (400) and the Settings field stops typing at it.
 */
export const ORGANIZATION_NAME_MAX_LENGTH = 120;
