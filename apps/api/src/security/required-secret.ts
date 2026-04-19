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
