/**
 * The ONE Supabase origin this deploy trusts, derived from `SUPABASE_URL`
 * (2026-10-10). Two checks used to hard-code the production project's host
 * (`player-ota/field-candidate.ts`, `screens/native-shared-video.ts`), which
 * silently broke both on any other project (staging, on-prem, a rotated
 * project). The trust root is the same env var every storage call already
 * signs with the service-role key, so deriving from it keeps each check an
 * EXACT single-host match — it is not widened to "any *.supabase.co".
 *
 * Strict on shape: `https:` only, no credentials, no port other than 443, no
 * path / query / fragment. A value that is set but malformed yields null and
 * the callers fail closed — it never falls back to the default host.
 */

/** The production project — only ever used when `SUPABASE_URL` is UNSET. */
export const DEFAULT_SUPABASE_HOST = 'bhdaxzfalaycfopvcopm.supabase.co';

export interface SupabaseOrigin {
  /** `https://<host>` with no trailing slash. */
  origin: string;
  /** Lower-case hostname. */
  host: string;
  /** true when `SUPABASE_URL` was set (false = the default fallback). */
  fromEnv: boolean;
}

/**
 * Parse `SUPABASE_URL` into the trusted origin. Unset / blank → the default
 * production host (`fromEnv: false`); set but not a bare https origin → null.
 */
export function supabaseOrigin(env: NodeJS.ProcessEnv = process.env): SupabaseOrigin | null {
  const raw = (env.SUPABASE_URL ?? '').trim();
  if (!raw) {
    return { origin: `https://${DEFAULT_SUPABASE_HOST}`, host: DEFAULT_SUPABASE_HOST, fromEnv: false };
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    (u.port && u.port !== '443') ||
    (u.pathname !== '/' && u.pathname !== '') ||
    u.search ||
    u.hash ||
    !u.hostname
  ) {
    return null;
  }
  const host = u.hostname.toLowerCase();
  return { origin: `https://${host}`, host, fromEnv: true };
}
