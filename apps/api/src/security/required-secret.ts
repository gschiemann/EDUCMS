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

/**
 * Env vars that were DELETED from the product and must not come back.
 *
 * `PLAYER_APK_LATEST_VERSION_CODE` / `_NAME` / `PLAYER_APK_SHA256` were the
 * old OTA "Path A": a manual, hand-maintained pin of the version the fleet
 * should be running. They were removed on 2026-05-15 because a stale value
 * silently pinned the WHOLE fleet to an old build — twice. The env var kept
 * answering confidently after the release it named had been superseded, so
 * every kiosk correctly obeyed it and nothing anywhere went red. That failure
 * mode is why `PLAYER_APK_STORAGE_REDIRECT` and `PLAYER_APK_QUARANTINE` are
 * documented in CLAUDE.md as SUBTRACTIVE ONLY: an OTA env var may remove an
 * option, never pin or name one.
 *
 * The code that read them is gone (see the 2026-05-15 note at the top of
 * `player-ota.controller.ts`); the release catalogue now comes from the
 * `player-v*` GitHub Release alone. So a value still sitting in Railway is
 * INERT today — but it is also indistinguishable, to the next operator
 * reading the variable list, from a setting that matters. This warning exists
 * so the value can be deleted with confidence, and so that re-adding one is
 * announced in the deploy log on the very next boot instead of discovered
 * from a fleet that stopped updating.
 *
 * Deliberately a WARNING, never a throw. A retired variable cannot break a
 * boot, and refusing to start over an inert string would turn a tidy-up into
 * an outage.
 */
export const RETIRED_ENV_VARS: ReadonlyArray<{ name: string; retiredOn: string; why: string }> = [
  {
    name: 'PLAYER_APK_LATEST_VERSION_CODE',
    retiredOn: '2026-05-15',
    why: 'manual OTA version pin — a stale value stranded the fleet on an old build',
  },
  {
    name: 'PLAYER_APK_LATEST_VERSION_NAME',
    retiredOn: '2026-05-15',
    why: 'manual OTA version pin — a stale value stranded the fleet on an old build',
  },
  {
    name: 'PLAYER_APK_SHA256',
    retiredOn: '2026-05-15',
    why: 'manual OTA digest pin — superseded by the committed pin / authenticated release asset digest',
  },
];

/**
 * Log a boot-time WARNING for every retired env var that is still set.
 * Returns the names found, so a caller (or a test) can assert on them.
 */
export function warnRetiredEnvVars(
  env: NodeJS.ProcessEnv = process.env,
  // eslint-disable-next-line no-console
  warn: (msg: string) => void = console.warn,
): string[] {
  const present = RETIRED_ENV_VARS.filter(
    (v) => typeof env[v.name] === 'string' && env[v.name]!.trim().length > 0,
  );
  for (const v of present) {
    warn(
      `[boot] RETIRED env var ${v.name} is still set. It was removed on ${v.retiredOn} (${v.why}) ` +
        `and NOTHING in this codebase reads it — the value is inert. Delete it from the deploy ` +
        `environment. CLAUDE.md: an OTA env var may only ever be SUBTRACTIVE; it must never pin ` +
        `or name a version.`,
    );
  }
  return present.map((v) => v.name);
}

/**
 * Warn if a database URL asks for TLS identity verification in a spelling
 * Prisma does not implement.
 *
 * MEASURED 2026-09-08 on production's own base image with Prisma 5.22.0 (the
 * full evidence table is in `packages/database/certs/README.md`): Prisma's Rust
 * engine parses its OWN parameter vocabulary — `sslaccept`, `sslcert`,
 * `sslidentity`, `sslpassword` — and silently DISCARDS libpq spellings it does
 * not recognise. A connection string carrying `sslmode=verify-full` together
 * with a deliberately WRONG root CA connected happily. So did `verify-ca`. So
 * did `verify-full` with no CA at all.
 *
 * That is the most dangerous shape a security setting can have: it reads as
 * verification in a code review, it answers a security questionnaire, and it
 * provides none of the guarantee. Anyone in the network path can still present
 * their own certificate and read every query.
 *
 * The spelling that actually works is `sslaccept=strict` + `sslcert=<CA path>`,
 * and it is verify-FULL — with the wrong CA it fails `certificate verify
 * failed`, and with the right CA but a hostname outside the certificate's SAN
 * it fails `(hostname mismatch)`.
 *
 * WARNING only, never a throw. The connection still works (encrypted, merely
 * unauthenticated), and refusing to boot over a query-string parameter would
 * turn a hardening opportunity into an outage.
 */
export function warnIneffectiveDbTlsSettings(
  env: NodeJS.ProcessEnv = process.env,
  // eslint-disable-next-line no-console
  warn: (msg: string) => void = console.warn,
): string[] {
  const flagged: string[] = [];
  for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
    const raw = env[name];
    if (typeof raw !== 'string' || raw.trim() === '') continue;

    // Parse the QUERY STRING only. The credentials live in the userinfo part
    // and must never be read, logged, or echoed by this function.
    const q = raw.indexOf('?');
    if (q === -1) continue;
    const params = new URLSearchParams(raw.slice(q + 1));

    const sslmode = (params.get('sslmode') ?? '').toLowerCase();
    const asksToVerify = sslmode === 'verify-full' || sslmode === 'verify-ca';
    const hasLibpqRoot = params.has('sslrootcert');
    const verifiesForReal = (params.get('sslaccept') ?? '').toLowerCase() === 'strict';

    if ((asksToVerify || hasLibpqRoot) && !verifiesForReal) {
      flagged.push(name);
      warn(
        `[boot] ${name} asks for TLS certificate verification in a spelling Prisma IGNORES` +
          `${asksToVerify ? ` (sslmode=${sslmode})` : ''}${hasLibpqRoot ? ' + sslrootcert' : ''}. ` +
          `This connection is ENCRYPTED but the database server is NOT AUTHENTICATED — measured, ` +
          `not assumed: Prisma 5.x connects even when handed a root CA that provably did not sign ` +
          `the server's certificate. Use Prisma's own parameters instead: ` +
          `sslmode=require&sslaccept=strict&sslcert=/etc/ssl/venueos/supabase-prod-ca-2021.crt ` +
          `(that CA ships in the production image). See packages/database/certs/README.md.`,
      );
    }
  }
  return flagged;
}
