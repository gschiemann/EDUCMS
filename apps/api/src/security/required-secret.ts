/**
 * Boot-time secret validation helper.
 *
 * WAVE-1 security hardening (sec-fix(wave1) #2): we previously had pattern:
 *   process.env.FOO || 'default_secret_value'
 * scattered across the codebase. That made it possible for a production
 * container to boot with a well-known default secret if the env var was
 * missing — i.e. anyone could forge device JWTs, session cookies, or HMAC
 * WebSocket signatures.
 *
 * Use `requireSecret(name, { devFallback })` to:
 *   - throw at boot in production when the env var is missing/empty
 *   - emit a loud warning + use the caller-supplied fallback in development
 *
 * The fallback is intentionally ONLY honored outside production. Test
 * environments (NODE_ENV=test) are treated like dev for convenience.
 */
export function requireSecret(
  name: string,
  opts: { devFallback: string; minLength?: number } = { devFallback: '' },
): string {
  const raw = process.env[name];
  const isProd = process.env.NODE_ENV === 'production';
  const minLength = opts.minLength ?? 16;

  if (raw && raw.trim().length >= minLength) {
    return raw;
  }

  if (isProd) {
    const reason = !raw
      ? `env var ${name} is not set`
      : `env var ${name} is too short (<${minLength} chars)`;
    // Fail LOUD and FAST — Railway will show this in the deploy log and the
    // container will exit before it accepts any traffic. That's the whole
    // point: no production boot with a default secret.
    throw new Error(
      `[security] refusing to start: ${reason}. Set ${name} to a cryptographically-random value (>= ${minLength} chars). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }

  // Development / test: allow the caller's dev fallback but warn loudly so
  // this never sneaks into a staging config.
  // eslint-disable-next-line no-console
  console.warn(
    `[security] ${name} is not set — falling back to a DEV-ONLY value. This must be set in production.`,
  );
  return opts.devFallback;
}

/**
 * The load-bearing secrets that MUST be present in production. CLAUDE.md
 * documents that the API "refuses to start if any of these are missing."
 */
export const BOOT_REQUIRED_SECRETS = [
  'JWT_SECRET',
  'SESSION_SECRET',
  'DEVICE_SECRET_KEY',
  'DEVICE_JWT_SECRET',
] as const;

/**
 * Validate every load-bearing secret at BOOT, not lazily.
 *
 * 2026-07-16 (launch-readiness S14): `requireSecret` was only invoked at each
 * secret's first USE. JWT_SECRET / SESSION_SECRET happen to be read during
 * module init (so they fail fast), but DEVICE_JWT_SECRET and DEVICE_SECRET_KEY
 * were validated LAZILY on the first device/WS request. A prod deploy missing
 * one of those passed the Railway healthcheck, then 500'd every device auth /
 * WS-signature call afterward — contradicting the documented boot guarantee.
 * Calling this from bootstrap() before `app.listen()` makes the guarantee
 * real: a missing secret throws at boot and the container exits before serving.
 * In dev/test each missing secret still just warns (via requireSecret).
 */
export function assertRequiredSecretsAtBoot(): void {
  for (const name of BOOT_REQUIRED_SECRETS) {
    // Values are discarded — we want the throw-in-prod side effect. The
    // devFallback only matters outside production (warn + continue).
    requireSecret(name, { devFallback: `dev_only_${name.toLowerCase()}_CHANGE_ME` });
  }
}
