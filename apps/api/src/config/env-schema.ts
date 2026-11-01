/**
 * env-schema.ts — the DECLARATION of every environment variable the API reads.
 *
 * WHY THIS EXISTS (Foundry mechanism #15, "kill switches + decided failure
 * directions"). Configuration used to live in prose: the 2026-10 audits found
 * the API reading far more variables than any document named, most
 * `*_DISABLED` kill switches written down nowhere, and `.env.example` missing
 * dozens of the variables `CLAUDE.md` does document. A variable that is not
 * declared cannot be reviewed, cannot be searched for in an incident, and has no
 * written answer to "what happens when it is missing?". This file is that
 * answer, in a form a machine can check.
 *
 * STATUS — DECLARATIVE ONLY. Nothing in the API imports this module at runtime:
 * it is not wired into boot, no reader consults it, no default here is applied
 * by code. Every `default` below is a COPY of what the reader falls back to,
 * transcribed from the reader (the file is named by the check, not guessed), so
 * a change here changes no behaviour. What keeps the copy honest:
 *
 *   • `apps/api/tools/check-env-declared.cjs` scans apps/api/src with the
 *     TypeScript compiler API (`env-scan.cjs`) and FAILS when the code reads a
 *     variable that has no entry here, or has a dynamic read this file does not
 *     register (`DYNAMIC_ENV_READS`). It warns on an entry nothing reads.
 *   • `env-schema.spec.ts` asserts the structural rules (no duplicates, every
 *     `*_DISABLED` is a kill switch, every kill switch has a decided direction).
 *   • `apps/api/tools/generate-env-docs.cjs` renders docs/ENVIRONMENT.md and the
 *     generated section of .env.example from this file, so neither can drift.
 *
 * TO ADD A VARIABLE: add the entry (read the reader; copy its fallback), run
 * `node apps/api/tools/check-env-declared.cjs`, then
 * `node apps/api/tools/generate-env-docs.cjs`. To retire one: set `retired`.
 *
 * ── The fields ────────────────────────────────────────────────────────────────
 *   name              UPPER_SNAKE, exactly as read.
 *   type              what the reader parses it as (see ENV_VAR_TYPES). `secret`
 *                     is a credential: never printed, never given an example.
 *   default           what the reader uses when the variable is unset or empty.
 *                     `null` = there is NO fallback value (see `note` for what
 *                     happens instead). For a flag it is the variable's own
 *                     meaning when unset: `X_DISABLED` defaults to `false`
 *                     ("not disabled"), `CSRF_ENFORCE` to `true` ("enforced").
 *   accepts           booleans only: the literal values the reader treats as
 *                     "set". Readers differ (`=== '1'`, `1|true|yes`), and a
 *                     value outside the list is silently ignored — write it down.
 *   purpose           one line, what it does and why anyone would set it.
 *   killSwitch        true for an off-switch or a mode selector that removes or
 *                     restricts a behaviour (`*_DISABLED`, `*_MODE`, `…=off`).
 *                     The Standard (Article 15) wants these SUBTRACTIVE: unset
 *                     means today's behaviour, and a switch can only take
 *                     something away, never pin or strand anyone.
 *   failureDirection  Article 15's decided direction, read from the code, not
 *                     from the name: "security gates fail closed; availability
 *                     of already-good work fails open".
 *                       'closed'  when the control this variable configures is
 *                                 absent or cannot run, the code REFUSES or
 *                                 WITHHOLDS: a required secret stops the boot
 *                                 in production, a gate stays shut, an opt-in
 *                                 capability stays off, a protection stays in
 *                                 force, the original is kept, nothing is sent.
 *                       'open'    the code CARRIES ON without it: an optional
 *                                 integration goes dormant, a limit or a check
 *                                 is not applied, a job skips its tick while the
 *                                 already-good work keeps being served.
 *                       'n/a'     it gates nothing - plain tuning, identity or
 *                                 location (a port, a timeout, a URL, a name).
 *                     A KILL SWITCH never carries 'n/a': for a switch the
 *                     direction is that of the safeguard it switches when that
 *                     safeguard cannot run (the autonomy register's column).
 *   origin            who sets it: 'operator' (default - you put it in the deploy
 *                     environment), 'platform' (Railway / the OS / the container
 *                     injects it - never put it in .env), 'internal' (the API
 *                     sets it for a child process of its own).
 *   retired           true = nothing reads it any more; the API only WARNS when
 *                     it is still set. Documented so it can be deleted with
 *                     confidence, never recommended.
 *   note              anything a reviewer needs that does not fit above: units,
 *                     bounds, what absence does when `default` is null.
 */
import { z } from 'zod';

export const ENV_VAR_TYPES = [
  'string',
  'secret',
  'url',
  'integer',
  'number',
  'boolean',
  'enum',
  'csv',
  'json',
  'path',
] as const;
export type EnvVarType = (typeof ENV_VAR_TYPES)[number];

export const FAILURE_DIRECTIONS = ['open', 'closed', 'n/a'] as const;
export type FailureDirection = (typeof FAILURE_DIRECTIONS)[number];

export const ENV_ORIGINS = ['operator', 'platform', 'internal'] as const;

/** UPPER_SNAKE - the only shape a variable name takes in this codebase. */
export const ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

export const envVarSpecSchema = z
  .strictObject({
    name: z.string().regex(ENV_NAME_RE),
    type: z.enum(ENV_VAR_TYPES),
    values: z.array(z.string().min(1)).min(2).optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).nullable(),
    accepts: z.string().min(1).max(80).optional(),
    purpose: z.string().min(10).max(260),
    killSwitch: z.boolean().optional(),
    failureDirection: z.enum(FAILURE_DIRECTIONS),
    origin: z.enum(ENV_ORIGINS).optional(),
    retired: z.boolean().optional(),
    note: z.string().min(1).max(600).optional(),
  })
  .superRefine((v, ctx) => {
    const bad = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (/[\r\n]/.test(v.purpose)) bad('purpose', 'purpose must be ONE line');
    if (v.note && /[\r\n]/.test(v.note)) bad('note', 'note must be ONE line');

    if (v.type === 'enum') {
      if (!v.values) bad('values', 'an enum declares its values');
      else if (typeof v.default === 'string' && !v.values.includes(v.default)) {
        bad(
          'default',
          `default ${JSON.stringify(v.default)} is not one of ${JSON.stringify(v.values)}`,
        );
      }
    } else if (v.values) {
      bad('values', 'only an enum declares values');
    }

    const d = v.default;
    if (d !== null) {
      if (
        v.type === 'integer' &&
        !(typeof d === 'number' && Number.isInteger(d))
      )
        bad('default', 'an integer default is a whole number');
      if (v.type === 'number' && typeof d !== 'number')
        bad('default', 'a number default is a number');
      if (v.type === 'boolean' && typeof d !== 'boolean')
        bad('default', 'a boolean default is true or false');
      if (
        !['integer', 'number', 'boolean'].includes(v.type) &&
        typeof d !== 'string'
      )
        bad('default', `a ${v.type} default is a string`);
    }
    if (v.type === 'secret' && d !== null)
      bad('default', 'a secret has no default value');
    if (v.type === 'boolean' && !v.accepts)
      bad('accepts', 'a boolean says which literal values it accepts');
    if (v.type !== 'boolean' && v.accepts)
      bad('accepts', 'only a boolean declares `accepts`');

    if (v.killSwitch && v.failureDirection === 'n/a') {
      bad(
        'failureDirection',
        'a kill switch decides its direction in advance: open or closed, never n/a',
      );
    }
    if (v.retired && v.killSwitch)
      bad('retired', 'a retired variable is not a kill switch');
  });
export type EnvVarSpec = z.infer<typeof envVarSpecSchema>;

/** The whole declaration: structurally valid entries, each name once. */
export const envVarListSchema = z
  .array(envVarSpecSchema)
  .superRefine((list, ctx) => {
    const seen = new Map<string, number>();
    list.forEach((v, i) => {
      const first = seen.get(v.name);
      if (first !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'name'],
          message: `${v.name} is declared twice (entries ${first} and ${i})`,
        });
      } else {
        seen.set(v.name, i);
      }
    });
  });

/**
 * A read the scanner cannot resolve to one literal name - the name is assembled at run time
 * (`<NAME>_PREVIOUS`, `FF_<FLAG>`) or the whole environment is handed to a function that lives in
 * another package (`playbackGateMode(process.env)`). The site must be registered here, with every
 * variable it can read, so a new dynamic read can never slip in unseen.
 * `check-env-declared.cjs` matches a row to its site by (file, expr).
 */
export const dynamicEnvReadSchema = z.strictObject({
  /** Repo-relative file containing the site. */
  file: z.string().min(1),
  /** The expression exactly as the scanner reports it (e.g. `process.env[prevName]`). */
  expr: z.string().min(1),
  /** Every variable the site can read. Each must be declared in ENV_VARS. */
  covers: z.array(z.string().regex(ENV_NAME_RE)).min(1),
  /** Why the name cannot be a literal. */
  why: z.string().min(10),
  /**
   * Repo-relative file that names the variables, when it is not `file` (a pass-through callee in
   * another package). The check verifies each covered name occurs in it.
   */
  reader: z.string().min(1).optional(),
});
export type DynamicEnvRead = z.infer<typeof dynamicEnvReadSchema>;

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  THE DECLARATIONS - one entry per variable, grouped by subsystem, alphabetical in a group.
// ═══════════════════════════════════════════════════════════════════════════════════════════
// prettier-ignore
export const ENV_VARS: readonly EnvVarSpec[] = [
  // ─── AI: platform keys, included allowance, caps, kill switches ───────────────────────────
  { name: 'AI_BOARDS_PER_SCREEN', type: 'integer', default: 10, failureDirection: 'n/a',
    purpose: 'AI boards per paired screen per UTC month on the platform key (AI plan), pooled per organisation.',
    note: 'Whole number 0-100000; anything else falls back to 10.' },
  { name: 'AI_DESIGN_REVIEW_DISABLED', type: 'boolean', default: false, accepts: '1 | true | yes', failureDirection: 'open', killSwitch: true,
    purpose: 'Kill switch for the renderer-backed review of AI-generated boards; generation itself continues unreviewed.' },
  { name: 'AI_DESIGNER_DISABLED', type: 'boolean', default: false, accepts: '1 | true | yes', failureDirection: 'open', killSwitch: true,
    purpose: 'Emergency brake: stops NEW raw-HTML AI board generation, refinement and publishing without a deploy.',
    note: 'Boards already saved keep rendering (render-side sanitiser + CSP).' },
  { name: 'AI_HOURLY_CAP', type: 'integer', default: 120, failureDirection: 'n/a',
    purpose: 'AI generations allowed per tenant per hour - an abuse guard that also applies to tenants on their own key.',
    note: 'Positive whole number; anything else falls back to 120.' },
  { name: 'AI_IMAGE_COST_USD', type: 'number', default: 0.08, failureDirection: 'n/a',
    purpose: 'What one image on the platform OpenAI key is metered at against the dollar allowance (no tokens to price).',
    note: '0-10; anything else falls back to 0.08.' },
  { name: 'AI_IMAGE_HOURLY_CAP', type: 'integer', default: 15, failureDirection: 'n/a',
    purpose: 'AI images allowed per tenant per hour (caps a runaway tenant at roughly $0.60/hr of platform spend).',
    note: 'Positive whole number; anything else falls back to 15.' },
  { name: 'AI_IMAGES_PER_SCREEN', type: 'integer', default: 20, failureDirection: 'n/a',
    purpose: 'AI images per paired screen per UTC month on the platform key (AI plan), pooled per organisation.',
    note: 'Whole number 0-100000; anything else falls back to 20.' },
  { name: 'AI_INCLUDED_USD_FLOOR', type: 'number', default: 5, failureDirection: 'n/a',
    purpose: 'Minimum included AI allowance in USD per organisation per UTC month: max(floor, paired screens x per-screen).',
    note: '0-10000; anything else falls back to 5. The hard dollar ceiling over the counted limits.' },
  { name: 'AI_INCLUDED_USD_PER_SCREEN', type: 'number', default: 2.5, failureDirection: 'n/a',
    purpose: 'Included AI allowance in USD per paired screen per UTC month, pooled across an organisation tree.',
    note: '0-10000; anything else falls back to 2.5.' },
  { name: 'AI_MODEL_SYNC_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'closed', killSwitch: true,
    purpose: 'Stops the daily vendor-feed sync that adopts new AI model versions; the catalog then stays exactly where it is.',
    note: 'Also off under NODE_ENV=test.' },
  { name: 'AI_TRIAL_BOARDS', type: 'integer', default: 2, failureDirection: 'n/a',
    purpose: 'AI boards a free trial gets on the platform key, one total for the whole trial.',
    note: 'Whole number 0-100000; anything else falls back to 2.' },
  { name: 'AI_TRIAL_IMAGES', type: 'integer', default: 2, failureDirection: 'n/a',
    purpose: 'AI images a free trial gets on the platform key, one total for the whole trial.',
    note: 'Whole number 0-100000; anything else falls back to 2.' },
  { name: 'ANTHROPIC_API_KEY', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Platform Anthropic key: powers Concierge, sparkle copy, alt text and other fast-tier AI for tenants with no key of their own.',
    note: 'Unset: AI surfaces answer "AI not configured" (503); the rest of the app keeps working. The platform never substitutes another vendor silently.' },
  { name: 'GEMINI_API_KEY', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Platform Google (Gemini) key for the AI routes that fall to Google.',
    note: 'GOOGLE_AI_API_KEY is accepted as an alias; this one wins when both are set.' },
  { name: 'GOOGLE_AI_API_KEY', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Alias of GEMINI_API_KEY, used only when GEMINI_API_KEY is unset.' },
  { name: 'OPENAI_API_KEY', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Platform OpenAI key: board design (GPT) and images on the platform key.',
    note: 'Unset: no board design on the platform key - an honest 503, never a quiet fall to Claude.' },
  { name: 'PEXELS_API_KEY', type: 'secret', default: null, failureDirection: 'open',
    purpose: 'Free Pexels key that gives photo-appropriate AI boards a real stock photo at no cost.',
    note: 'Unset: boards keep their themed gradient; every image path returns null, never throws.' },
  { name: 'RENDERER_URL', type: 'url', default: null, failureDirection: 'open',
    purpose: 'Base URL of the headless renderer service the AI design review screenshots boards with.',
    note: 'Unset, or not http(s): the review is skipped.' },

  // ─── Platform, boot, storage and public URLs ───────────────────────────────────────────────
  { name: 'ALLOWED_ORIGINS', type: 'csv', default: null, failureDirection: 'closed',
    purpose: 'CORS allow-list of dashboard origins, comma-separated; its first entry also seeds web links when no public web URL is set.',
    note: 'Production REFUSES TO BOOT when unset; development allows localhost, LAN and tunnel origins instead.' },
  { name: 'APP_PUBLIC_URL', type: 'url', default: 'http://localhost:3000', failureDirection: 'n/a',
    purpose: 'Base URL of the web dashboard used to build links in asset and trial-reminder emails.',
    note: 'Distinct from PUBLIC_WEB_URL and WEB_PUBLIC_URL, which other code reads. Unset in production means emails link to localhost.' },
  { name: 'BOOT_READY_MAX_MS', type: 'integer', default: 45000, failureDirection: 'n/a',
    purpose: 'Absolute ceiling, in ms, on how long the boot-readiness gate may hold a deploy back.',
    note: 'Must be > 0; anything else falls back to 45000.' },
  { name: 'DATABASE_URL', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Prisma connection string (Supavisor SESSION mode, port 5432, no pgbouncer=true, connection_limit=10, pool_timeout=20).',
    note: 'Production REFUSES TO BOOT when unset or when it asks for pgbouncer=true. Boot also warns on TLS spellings Prisma ignores.' },
  { name: 'DIRECT_URL', type: 'secret', default: null, failureDirection: 'open',
    purpose: 'Direct (non-pooled) Postgres URL Prisma uses for migrations; the API itself only inspects its TLS parameters at boot.',
    note: 'Read here only to warn about TLS settings Prisma silently ignores (verify-full / sslrootcert).' },
  { name: 'GIT_COMMIT_SHA', type: 'string', default: 'dev', failureDirection: 'n/a',
    purpose: 'Commit the running API was built from; reported by /health, bug reports and the Sentry release.',
    note: 'Unset: falls back to RAILWAY_GIT_COMMIT_SHA, then to "dev" (the post-restart fleet-check email records null instead).' },
  { name: 'NEXT_PUBLIC_WEB_URL', type: 'url', default: null, failureDirection: 'n/a',
    purpose: 'Second choice for the public web base URL used in invite and setup links (after PUBLIC_WEB_URL).',
    note: 'Chain: PUBLIC_WEB_URL, NEXT_PUBLIC_WEB_URL, first entry of ALLOWED_ORIGINS, then a relative link.' },
  { name: 'NODE_ENV', type: 'enum', values: ['development', 'production', 'test'], default: 'development', failureDirection: 'open',
    purpose: 'Runtime mode: production enforces the boot refusals (required secrets, origins, database URL); test switches background workers off.',
    note: 'Unset behaves as non-production: dev-only secret fallbacks and warnings instead of refusals. Never leave it unset on a deploy.' },
  { name: 'NODE_OPTIONS', type: 'string', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Node runtime flags; read only to learn the --max-old-space-size ceiling for the capacity early-warning.',
    note: 'Unset: the capacity watcher assumes an 8 GiB memory ceiling.' },
  { name: 'PORT', type: 'integer', default: 8080, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Port the API listens on (Railway injects it).' },
  { name: 'PUBLIC_API_BASE_URL', type: 'url', default: null, failureDirection: 'closed',
    purpose: 'Public base URL of this API, used for OAuth redirect URIs and the Square webhook notification URL.',
    note: 'Production without it: OAuth flows answer 503 PUBLIC_API_BASE_URL_NOT_CONFIGURED. Development derives it from the request Host header.' },
  { name: 'PUBLIC_WEB_URL', type: 'url', default: null, failureDirection: 'n/a',
    purpose: 'Public base URL of the web dashboard for invite, setup and customer-console links (first choice).',
    note: 'Chain: PUBLIC_WEB_URL, NEXT_PUBLIC_WEB_URL, first entry of ALLOWED_ORIGINS, then a relative link.' },
  { name: 'RAILWAY_DEPLOYMENT_ID', type: 'string', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Railway deployment id; keys the once-per-deploy claim of the post-restart fleet check.',
    note: 'Unset: the claim falls back to a per-process key.' },
  { name: 'RAILWAY_GIT_COMMIT_SHA', type: 'string', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Commit Railway built; the fallback for GIT_COMMIT_SHA in /health, bug reports and the fleet-check email.' },
  { name: 'RAILWAY_PUBLIC_DOMAIN', type: 'string', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Public hostname Railway assigns; the sports feed-ingest URL falls back to it when the request has no Host header.' },
  { name: 'REDIS_DISABLED', type: 'boolean', default: false, accepts: 'true', failureDirection: 'open', killSwitch: true,
    purpose: 'Treats Redis as absent: realtime drops to HTTP polling and sessions leave the Redis store, even if REDIS_URL is set.',
    note: 'Subtractive. Emergency delivery still works through the manifest polling path.' },
  { name: 'REDIS_URL', type: 'secret', default: null, failureDirection: 'open',
    purpose: 'Redis connection for realtime pub/sub fan-out, leader leases, replay claims and the session store.',
    note: 'Unset: the API boots anyway and falls back to HTTP-polling realtime (7 s connect hard-cap).' },
  { name: 'SENTRY_DSN', type: 'url', default: null, failureDirection: 'open',
    purpose: 'Sentry project DSN for API error tracking.',
    note: 'Unset: error tracking is disabled and a warning is logged at boot.' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Supabase service-role key: object storage (assets, invoices, APK delivery copies, field mirror).',
    note: 'Unset: storage calls throw "Supabase Storage not configured"; asset uploads fail.' },
  { name: 'SUPABASE_URL', type: 'url', default: null, failureDirection: 'closed',
    purpose: 'Supabase project URL: object storage, and the one trusted host for emergency-media and image-fetch allow-lists.',
    note: 'Unset: storage calls throw "Supabase Storage not configured".' },
  { name: 'UPLOAD_DIR', type: 'path', default: null, failureDirection: 'n/a',
    purpose: 'Directory for locally served uploaded files and generated archives.',
    note: 'Unset: ./uploads, and /tmp/uploads when NODE_ENV=production (resolved against the working directory) - so there is no single value to copy.' },
  { name: 'WEB_PUBLIC_URL', type: 'url', default: 'http://localhost:3000', failureDirection: 'n/a',
    purpose: 'Web dashboard URL that OAuth and SSO callbacks redirect the browser back to (POS, social, SSO).',
    note: 'Distinct from PUBLIC_WEB_URL and APP_PUBLIC_URL, which other code reads. Unset in production sends users back to localhost.' },

  // ─── Authentication, secrets, request security ─────────────────────────────────────────────
  { name: 'CSRF_ENFORCE', type: 'boolean', default: true, accepts: 'false', failureDirection: 'closed', killSwitch: true,
    purpose: 'CSRF protection on browser mutations: exactly "false" drops it to warn-mode (logged, not blocked); unset means enforced.' },
  { name: 'CSRF_WARN', type: 'boolean', default: false, accepts: 'true', failureDirection: 'closed', killSwitch: true,
    purpose: 'Alias of CSRF_ENFORCE=false: puts CSRF protection into warn-mode.' },
  { name: 'DEV_WS_ALLOW', type: 'boolean', default: false, accepts: 'true', failureDirection: 'closed',
    purpose: 'Development only: accept unsigned dev_ WebSocket tokens. Ignored when NODE_ENV=production; never set it on a deploy.' },
  { name: 'DEVICE_JWT_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Signs every paired screen\'s device JWT (180-day tokens). Required in production.',
    note: 'Min 16 chars; production REFUSES TO BOOT without it. Rotate through DEVICE_JWT_SECRET_PREVIOUS, never a straight swap (docs/SECRET-ROTATION.md).' },
  { name: 'DEVICE_SECRET_KEY', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Signs device capabilities and realtime/OTA/sports tokens, and seals every stored credential (streaming, POS, BYOK AI keys, MFA, Wi-Fi).',
    note: 'Min 16 chars (64 hex for the envelope master key); production REFUSES TO BOOT without it. Rotate through DEVICE_SECRET_KEY_PREVIOUS.' },
  { name: 'GATEWAY_SHARED_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Proves a request came through the web origin\'s player gateway, so its forwarded client IP is honoured; set the same value on web and API.',
    note: 'Min 16 chars. Unset or short: the forwarded IP is never trusted (gateway devices share one throttle key).' },
  { name: 'JWT_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Signs operator access tokens (JWT). Required in production.',
    note: 'Min 16 chars; production REFUSES TO BOOT without it.' },
  { name: 'MFA_ISSUER', type: 'string', default: 'VenueOS', failureDirection: 'n/a',
    purpose: 'Issuer name shown in an authenticator app for TOTP enrolment.' },
  { name: 'MFA_REQUIRED_ENFORCE_AFTER', type: 'string', default: '2026-10-04T00:00:00.000Z', failureDirection: 'closed', killSwitch: true,
    purpose: 'When required MFA turns blocking for admins and panic-capable users: an ISO-8601 instant, or a keyword. Break-glass: off removes the derived policy.',
    note: 'now | immediate | immediately | always = enforce at once; off | false | 0 | never | disabled | no = BREAK-GLASS (logged loudly); unparsable falls back to the built-in deadline.' },
  { name: 'PROXY_RENDER_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Signs the short-lived capability that authorises ONE Chromium render of a URL (SEC-006).',
    note: 'Min 16 chars. Unset: derives from the DEVICE_SECRET_KEY ring (shared blast radius, logged in production); the capability gate stays shut to anonymous callers.' },
  { name: 'PROXY_SSR_ALLOW_ANONYMOUS', type: 'boolean', default: false, accepts: '1 | true', failureDirection: 'closed',
    purpose: 'Lets UNAUTHENTICATED callers drive the Chromium renderer again (the pre-SEC-006 behaviour). Leave unset.',
    note: 'Any other value, including a typo, leaves the gate closed.' },
  { name: 'SESSION_BFF_SECRET', type: 'secret', default: null, failureDirection: 'open',
    purpose: 'Binds the durable-session (refresh-cookie) endpoints to the web origin\'s server; set the same value on web and API.',
    note: 'Min 16 chars. Unset is SUBTRACTIVE, never a lockout: the endpoints keep working, but the last step of the SEC-010 finding stays open.' },
  { name: 'SESSION_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Encrypts express-session cookies. Required in production.',
    note: 'Min 16 chars; production REFUSES TO BOOT without it.' },
  { name: 'SETUP_EMAIL_VERIFICATION', type: 'enum', values: ['auto', 'required', 'on', 'true', '1', 'off', 'false', '0'], default: 'auto', failureDirection: 'open', killSwitch: true,
    purpose: 'Whether first-login setup proves the new email with a 6-digit code: auto = only when mail is deliverable, required = always, off = never (break-glass).',
    note: 'on | true | 1 mean required; off | false | 0 mean off. auto switches itself on once a sending domain is verified.' },
  { name: 'SSO_ENCRYPTION_KEY', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Encrypts stored SSO provider secrets (64 hex chars, or any longer string that is hashed).',
    note: 'Min 16 chars; checked on first SSO use, not at boot. Production throws without it.' },
  { name: 'TRUSTED_PROXY_HOPS', type: 'integer', default: 2, failureDirection: 'n/a',
    purpose: 'How many trusted proxies append to X-Forwarded-For in front of the API; picks the client IP that keys every per-IP throttle and the audit IP.',
    note: 'Whole number >= 1, else 2 (the measured Railway chain). Wrong in either direction silently picks the wrong entry - re-verify when the proxy chain changes.' },

  // ─── Emergency delivery guards ─────────────────────────────────────────────────────────────
  { name: 'EMERGENCY_HASH_BACKFILL', type: 'boolean', default: true, accepts: 'off', failureDirection: 'open', killSwitch: true,
    purpose: 'Boot-time backfill of missing SHA-256 digests on managed assets so the emergency cache can verify them; "off" skips it.',
    note: 'Case-insensitive. An asset left without a digest is cached on trust: the player skips body-hash verification when the manifest digest is null.' },
  { name: 'EMERGENCY_MEDIA_ALLOWED_HOSTS', type: 'csv', default: null, failureDirection: 'closed',
    purpose: 'Extra hosts (besides the Supabase storage host) an emergency override may take its media URL from; https only.',
    note: 'Unset: only the Supabase host is accepted.' },
  { name: 'EMERGENCY_REV_RAISE', type: 'boolean', default: true, accepts: 'off | 0 | false', failureDirection: 'open', killSwitch: true,
    purpose: 'Lets the rev endpoint attach an alert descriptor so a screen raises an alert faster; off reverts to revision-move then manifest fetch.',
    note: 'SUBTRACTIVE: any other value, including a typo, leaves it ON. Off only makes raises slower, never wrong or missing.' },

  // ─── Player OTA, release policy and field builds ───────────────────────────────────────────
  { name: 'CANARY_AUTO_PROMOTE_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'closed', killSwitch: true,
    purpose: 'Stops the cron that promotes a canary player build to the fleet once its cohort looks healthy; builds then stay in canary.',
    note: 'Also off under NODE_ENV=test.' },
  { name: 'CANARY_AUTO_PROMOTE_INTERVAL_MS', type: 'integer', default: 300000, failureDirection: 'n/a',
    purpose: 'How often, in ms, the canary auto-promote cron wakes.',
    note: 'Non-numeric or 0 falls back to 5 minutes.' },
  { name: 'CANARY_MAX_ERROR_RATE', type: 'number', default: 0.2, failureDirection: 'n/a',
    purpose: 'Fraction of the canary cohort that may report an UNAUTHENTICATED error before promotion halts.',
    note: '> 0 and <= 1; anything else falls back to 0.2.' },
  { name: 'CANARY_MIN_COHORT', type: 'integer', default: 1, failureDirection: 'n/a',
    purpose: 'Smallest canary cohort that may be auto-promoted.',
    note: '>= 1; anything else falls back to 1.' },
  { name: 'GH_TOKEN', type: 'secret', default: null, failureDirection: 'open',
    purpose: 'GitHub token: lets the bug reporter open a draft fix PR and lets OTA read GitHub Releases without the unauthenticated rate limit.',
    note: 'Unset: no auto-PR; release lookups run unauthenticated (rate-limited). OTA falls back to GITHUB_TOKEN.' },
  { name: 'GITHUB_REPO', type: 'string', default: null, failureDirection: 'open',
    purpose: 'owner/repo the bug reporter opens draft fix PRs against.',
    note: 'Unset (or no GH_TOKEN): auto-PR creation is skipped.' },
  { name: 'GITHUB_TOKEN', type: 'secret', default: null, failureDirection: 'open',
    purpose: 'Fallback for GH_TOKEN when OTA reads GitHub Releases.' },
  { name: 'MANAGER_APK_QUARANTINE', type: 'csv', default: null, failureDirection: 'closed', killSwitch: true,
    purpose: 'Manager APK versions the server refuses to advertise, added to the built-in recall list.',
    note: 'SUBTRACTIVE: it can only remove an offer, never pin or name a version.' },
  { name: 'MANAGER_APK_SHA_PINS', type: 'csv', default: null, failureDirection: 'closed',
    purpose: 'Extra Manager APK digest pins as "version=sha256" pairs, merged with the committed pins.',
    note: 'A wrong or stale pin makes the server DECLINE to advertise that build; it can never advertise a bad one.' },
  { name: 'OTA_REQUIRE_DEVICE_AUTH', type: 'boolean', default: false, accepts: 'true', failureDirection: 'closed',
    purpose: 'Opt-in hard gate: refuse player update checks that do not carry a device credential (401 OTA_DEVICE_AUTH_REQUIRED).',
    note: 'Off by default; turn on only once a token-sending player build is fleet-wide.' },
  { name: 'PLAYER_APK_FIELD_CANDIDATE', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Private field APK offer: name of the committed candidate. Needs the tenant, screen and expiry variables too.',
    note: 'Unset: no field offer. Never changes the fleet stable/latest build.' },
  { name: 'PLAYER_APK_FIELD_EXPIRES_AT', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'ISO-8601 instant (24 h at most ahead) after which the private field APK offer stops.',
    note: 'Unset or unparsable: the offer window is not open.' },
  { name: 'PLAYER_APK_FIELD_SCREEN_IDS', type: 'csv', default: null, failureDirection: 'closed',
    purpose: 'Exact screen UUIDs (or "all" within the listed tenants) the private field APK may be offered to.',
    note: 'Unset: no screen is eligible.' },
  { name: 'PLAYER_APK_FIELD_TENANT_ID', type: 'csv', default: null, failureDirection: 'closed',
    purpose: 'Exact tenant UUIDs whose screens the private field APK may be offered to.',
    note: 'Unset: no tenant is eligible. Entries that are not UUIDs are ignored.' },
  { name: 'PLAYER_APK_GITHUB_REPO', type: 'string', default: 'gschiemann/EDUCMS', failureDirection: 'n/a',
    purpose: 'owner/repo whose player-v* GitHub Releases are the source of truth for the APK catalogue.' },
  { name: 'PLAYER_APK_HOST_ALLOWLIST', type: 'csv', default: null, failureDirection: 'closed',
    purpose: 'Extra hosts allowed to serve a fleet APK (a staging or on-prem mirror), added to the built-in GitHub hosts.',
    note: 'Unset: only the built-in GitHub hosts are accepted.' },
  { name: 'PLAYER_APK_QUARANTINE', type: 'csv', default: null, failureDirection: 'closed', killSwitch: true,
    purpose: 'Player APK versions the server refuses to advertise, added to the built-in recall list (a recalled build is never offered).',
    note: 'SUBTRACTIVE: it can only remove an offer, so a stale value cannot pin the fleet to a bad build.' },
  { name: 'PLAYER_APK_SHA_PINS', type: 'csv', default: null, failureDirection: 'closed',
    purpose: 'Extra player APK digest pins as "version=sha256" pairs, merged with the committed pins, for an incident when waiting for a deploy is too slow.',
    note: 'A wrong or stale pin makes the server DECLINE to advertise that build; it can never advertise a bad one.' },
  { name: 'PLAYER_APK_STORAGE_BUCKET', type: 'string', default: 'apks', failureDirection: 'n/a',
    purpose: 'Private Supabase bucket holding the fleet APK delivery copies.',
    note: '1-63 chars of a-z 0-9 _ -. The GitHub Release stays the source of truth for the catalogue and the digest.' },
  { name: 'PLAYER_APK_STORAGE_REDIRECT', type: 'boolean', default: true, accepts: 'off | false | 0', failureDirection: 'open', killSwitch: true,
    purpose: 'Serves APK downloads as signed storage redirects; "off" sends every download back through the API byte proxy.',
    note: 'SUBTRACTIVE. Nothing redirects until the object exists in storage, and it needs SUPABASE_URL and the service key.' },
  { name: 'PLAYER_APK_URL', type: 'url', default: null, failureDirection: 'closed',
    purpose: 'Explicit target for the operator "Download Player APK" link; unset follows the latest release asset.',
    note: 'Must be a same-origin relative path or an allow-listed https URL; anything else is ignored (logged) and the latest GitHub release is used (OTA-04).' },

  // ─── Player video engines and playback rollout (unset = the standard behaviour) ────────────
  { name: 'PLAYER_CONTENT_STORE', type: 'csv', default: null, failureDirection: 'closed', killSwitch: true,
    purpose: 'Who gets the APK\'s one verified content store: all, a screen UUID, -<uuid> (wins), or off | 0 | false | no (wins over everything).',
    note: 'Unset or empty = nobody (the store stays off). Needs an APK that implements it; unqualified on glass.' },
  { name: 'PLAYER_LOOP_CONTINUOUS', type: 'csv', default: 'all', failureDirection: 'open', killSwitch: true,
    purpose: 'Who gets continuous one-element MSE video repetition: unset or all = every screen; off | 0 | false | no restores the legacy selection; screen IDs restrict it.',
    note: 'The player still requires a solo, muted, unsynced H.264 MP4 and falls back to native playback per file.' },
  { name: 'PLAYER_LOOP_NATIVE', type: 'csv', default: null, failureDirection: 'open', killSwitch: true,
    purpose: 'Exact screen IDs pinned to the browser-native loop, ahead of continuous and two-deck selection (scoped comparison or rollback).',
    note: 'Unset affects no screen. "all" is NOT a wildcard here.' },
  { name: 'PLAYER_LOOP_TWODECK', type: 'csv', default: null, failureDirection: 'closed',
    purpose: 'Legacy two-deck seamless loop selection, used only when continuous is disabled or restricted: all, or exact screen IDs.',
    note: 'Unset, off | 0 | false | no, or a typo = nobody. Self-disables on T982 / Android 11, so keep it a named-screens switch.' },
  { name: 'PLAYER_NATIVE_DUAL_VIDEO', type: 'csv', default: null, failureDirection: 'closed',
    purpose: 'Exact screen UUIDs qualified for native mirrored full-screen video on a double-sided unit.',
    note: 'Unset: nobody.' },
  { name: 'PLAYER_NATIVE_FIRST', type: 'csv', default: null, failureDirection: 'open', killSwitch: true,
    purpose: 'Native-first engine override per screen: all, a screen UUID, model:<hardwareModel>, class:<vendor>/android-<n>, -<token> exclusions, or off | 0 | false | no.',
    note: 'Unset names nobody, so the APK\'s own class default applies. A negative token wins over a positive one; unknown tokens are ignored.' },
  { name: 'PLAYER_NATIVE_VIDEO', type: 'csv', default: 'faces', failureDirection: 'open', killSwitch: true,
    purpose: 'Who runs the per-face native video engine: faces (default), all, model:<hardwareModel>, a screen id, -<id> / -model:<x> exclusions, or off | 0 | false | no.',
    note: 'off wins over everything; novastar-taurus is never enrolled; web <video> takes over on any native end.' },
  { name: 'PLAYER_NATIVE_VIDEO_EXPERIMENTS', type: 'csv', default: null, failureDirection: 'closed', killSwitch: true,
    purpose: 'Native-video experiments per screen as <token>:<uuid|all>; from APK 1.1.43 -vsync-snap and -prefer-60hz are lead-only kill switches for automatic pacing.',
    note: 'Tokens: webview-invisible, surface-frame-rate, decoder-rotation, vsync-snap, prefer-60hz. A typo enables nothing; nothing hardware-qualified yet.' },
  { name: 'PLAYER_PORTRAIT_AVC_COMPAT', type: 'csv', default: null, failureDirection: 'closed',
    purpose: 'Exact screen IDs allowed a verified portrait AVC compatibility rendition on a 1080p screen (pair with native repetition).',
    note: 'Empty by default; no wildcard. 4K screens keep their primary file.' },
  { name: 'PLAYER_VENDOR_BACKLIGHT', type: 'csv', default: null, failureDirection: 'closed', killSwitch: true,
    purpose: 'Lead kill switch for true standby on a Goodview GUQ via the vendor MCU backlight: off | 0 | false | no | -all fleet-wide, -<screen uuid>,… per screen.',
    note: 'Auto-detected per box, no setting. A failed ON after our own OFF withdraws BLANK (never WAKE), so the panel stays lit.' },
  { name: 'PLAYER_VIDEO_NO_B', type: 'csv', default: null, failureDirection: 'closed',
    purpose: 'Exact screen IDs served an independently quality-checked full-resolution 30 fps AVC copy without B-frames (diagnostic; pair with PLAYER_LOOP_NATIVE).',
    note: 'Empty by default.' },
  { name: 'VIDEO_DEMOTION_BAD_PCT', type: 'number', default: 5, failureDirection: 'n/a',
    purpose: 'A settled, cached playback sample dropping at least this % of frames counts as a BAD minute for demotion.',
    note: 'Read in packages/api-types (visibleStutterThresholds). 1-100; anything else keeps 5.' },
  { name: 'VIDEO_DEMOTION_STALL_MS', type: 'number', default: 250, failureDirection: 'n/a',
    purpose: 'A sample holding stalls that add up to at least this many ms also counts as a BAD minute.',
    note: 'Read in packages/api-types (visibleStutterThresholds). 100-60000; anything else keeps 250.' },
  { name: 'VIDEO_DEMOTION_STREAK', type: 'integer', default: 3, failureDirection: 'n/a',
    purpose: 'BAD minutes in a row (same file, same screen) before the screen is moved to the lighter 1080p copy.',
    note: 'Read in packages/api-types (visibleStutterThresholds). 2-60 (floored); anything else keeps 3.' },
  { name: 'VIDEO_DEMOTION_TTL_HOURS', type: 'number', default: 72, failureDirection: 'n/a',
    purpose: 'Hours a playback demotion lasts before the manifest names the original file again; 0 = never expire.',
    note: 'Negative or non-numeric falls back to 72.' },
  { name: 'VIDEO_PLAYBACK_DEMOTION', type: 'enum', values: ['on', 'observe', 'off', '0', 'false', 'no'], default: 'on', failureDirection: 'open', killSwitch: true,
    purpose: 'Sticky demotion of a stuttering screen to its validated 1080p copy: on (default), observe (logs only), off | 0 | false | no.',
    note: 'Read in packages/api-types (playbackDemotionMode). Never for emergency content; two-sided units are recorded only.' },
  { name: 'VIDEO_PLAYBACK_GATE', type: 'enum', values: ['warn', 'enforce', 'off', '0', 'false', 'no'], default: 'warn', failureDirection: 'open', killSwitch: true,
    purpose: 'What publishing does with a video a target screen cannot play: warn (default, and for anything unrecognised), enforce (422 before any write), or off.',
    note: 'Read in packages/api-types (playbackGateMode). Enforce never applies to a two-sided unit; unknown never warns; emergency playlists are never evaluated.' },

  // ─── Screen monitoring, fleet alarms and history ───────────────────────────────────────────
  { name: 'COHORT_OUTAGE_MIN_FLEET', type: 'integer', default: 3, failureDirection: 'n/a',
    purpose: 'Smallest tenant fleet in which a burst of screens going offline is treated as ONE cohort outage rather than N screen alerts.',
    note: '`Number(x) || 3`: 0 or non-numeric falls back to 3.' },
  { name: 'COHORT_OUTAGE_PCT', type: 'number', default: 0.5, failureDirection: 'n/a',
    purpose: 'Share of a tenant\'s fleet that must cross offline inside the cohort window to count as one outage (0.5 = half).',
    note: '`Number(x) || 0.5`: 0 or non-numeric falls back to 0.5.' },
  { name: 'COHORT_OUTAGE_WINDOW_S', type: 'integer', default: 90, failureDirection: 'n/a',
    purpose: 'Rolling window, in seconds, over which offline crossings are grouped into a cohort outage.',
    note: '`Number(x) || 90`: 0 or non-numeric falls back to 90.' },
  { name: 'DISPLAY_POWER_TRIAL_ONCE', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Run ONE staff power trial 90 s after boot, as <screenId>|<wakeAfterSeconds>|<nonce> (or <screenId>|on|<nonce> for a hard POWER_ON).',
    note: 'Unset or malformed does nothing - never a guess. Goes through the same gate as the HTTP door (emergency interlock included); the nonce makes it once.' },
  { name: 'FLEET_PULSE_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the 15-minute sampler that records fleet online/offline history for the dashboard\'s Fleet pulse chart.',
    note: 'Also off under NODE_ENV=test.' },
  { name: 'OFFLINE_SCAN_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the scanner that raises SCREEN_OFFLINE notifications; the rest of the fleet view keeps working.',
    note: 'Also off under NODE_ENV=test.' },
  { name: 'OFFLINE_SCAN_INTERVAL_MS', type: 'integer', default: 60000, failureDirection: 'n/a',
    purpose: 'How often, in ms, the offline-screen scanner runs.',
    note: '`Number(x) || 60000`: 0 or non-numeric falls back to one minute.' },
  { name: 'OFFLINE_SCAN_MAX_CANDIDATES', type: 'integer', default: 5000, failureDirection: 'n/a',
    purpose: 'Cap on offline candidates read per scan tick.',
    note: '`Number(x) || 5000`.' },
  { name: 'OFFLINE_SCAN_THRESHOLD_MIN', type: 'integer', default: 5, failureDirection: 'n/a',
    purpose: 'Minutes without a check-in before a screen counts as offline for the scanner.',
    note: '`Number(x) || 5`.' },
  { name: 'PLATFORM_ALERT_EMAILS', type: 'csv', default: null, failureDirection: 'open',
    purpose: 'Owner / platform alert recipients for health, capacity, fleet-alarm and shadow-mode emails.',
    note: 'Unset: every SUPER_ADMIN\'s address is used (the last good list is cached if the database is down; with neither, the alert is dropped).' },
  { name: 'PLATFORM_HEALTH_MONITOR_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the 5-minute platform monitor that probes the database, Redis and the WS signer and emails the owner when one is down.',
    note: 'Also off under NODE_ENV=test. Leaving it off removes the "platform critical" alert path.' },
  { name: 'SCREEN_EVENTS_RETENTION_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the hourly retention sweep of screen_events (30 days / newest 2000 per screen); rows are then kept.',
    note: 'Also off under NODE_ENV=test.' },
  { name: 'STORAGE_WATCHDOG_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the periodic storage probe that alerts the owner when object storage stops answering.',
    note: 'Also off under NODE_ENV=test.' },
  { name: 'WEDGE_DETECTOR_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the wedge detector that sends a durable per-screen REFRESH_WEB to a screen with no render proof; screens are no longer auto-healed.',
    note: 'Also off under NODE_ENV=test. Render-proof guard: a cache report that is omitted is not a wedge.' },

  // ─── Customer alert emails, owner fleet alarms, outbound email ─────────────────────────────
  { name: 'CUSTOMER_ALERT_EMAILS_DISABLED', type: 'boolean', default: false, accepts: '1 | true | yes', failureDirection: 'closed', killSwitch: true,
    purpose: 'Hard kill switch over ALL customer alert emails (offline, no picture, recovery, emergency record copies).',
    note: 'Wins over CUSTOMER_ALERT_EMAILS_MODE. Owner rule: no false positives - when unsure, no email.' },
  { name: 'CUSTOMER_ALERT_EMAILS_MODE', type: 'enum', values: ['shadow', 'on', 'off'], default: 'shadow', failureDirection: 'closed', killSwitch: true,
    purpose: 'Customer alert emails: shadow (default) computes everything and emails only PLATFORM_ALERT_EMAILS what it would have sent; on emails customers; off sends nothing.',
    note: 'Any other value is shadow. Move to on only after the owner has read the shadow copies for a few days.' },
  { name: 'CUSTOMER_ALERT_EMAILS_PER_HOUR', type: 'integer', default: 6, failureDirection: 'n/a',
    purpose: 'Customer alert emails per organisation per rolling hour, then one digest.',
    note: 'Whole number 1-60; anything else falls back to 6.' },
  { name: 'DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED', type: 'boolean', default: false, accepts: '1 | true | yes', failureDirection: 'open', killSwitch: true,
    purpose: 'Turns off the owner alarm for a run of refused device credentials: nothing is recorded on the refusal paths and the evaluator never arms.',
    note: 'Owner-only alarm (never a customer). Also off under NODE_ENV=test.' },
  { name: 'POST_RESTART_FLEET_CHECK_DISABLED', type: 'boolean', default: false, accepts: '1 | true | yes', failureDirection: 'open', killSwitch: true,
    purpose: 'Turns off the owner check that emails when screens that were online before an API restart have not come back at +10 and +20 min.',
    note: 'Owner-only alarm; the boot snapshot and both checks stay off. Also off under NODE_ENV=test.' },
  { name: 'EMAIL_FROM', type: 'string', default: 'VenueOS <onboarding@resend.dev>', failureDirection: 'open',
    purpose: 'Sender for all outbound mail (invites, resets, welcome, approvals, bug emails).',
    note: 'The default only delivers to the Resend account owner; any other recipient needs a verified sending domain here.' },
  { name: 'EMAIL_REPLY_TO', type: 'string', default: null, failureDirection: 'n/a',
    purpose: 'Optional Reply-To header on outbound mail (e.g. a district IT help alias).',
    note: 'Unset: the header is omitted.' },
  { name: 'RESEND_API_KEY', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Resend API key behind every outbound email.',
    note: 'Unset: development logs mail to the console; production throws on send so the UI shows "email not configured" rather than a false "check your inbox".' },

  // ─── Billing, licence and feature flags ────────────────────────────────────────────────────
  { name: 'BILLING_PRICE_CHECK_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Skips the read-only boot check that compares each configured STRIPE_PRICE_* with the price the dashboard advertises for it.',
    note: 'The check only logs; it never changes billing. Also skipped under NODE_ENV=test or when Stripe is not configured.' },
  { name: 'FF_SPORTS_PLAYER_STATS', type: 'boolean', default: false, accepts: 'true', failureDirection: 'closed',
    purpose: 'Legacy env fallback for the sports_player_stats feature flag when GrowthBook is not configured.',
    note: 'Read as FF_<FLAG upper-cased>; exactly "true" turns the flag on. Registered under DYNAMIC_ENV_READS.' },
  { name: 'FF_TEMPLATE_BUILDER_V2', type: 'boolean', default: false, accepts: 'true', failureDirection: 'closed',
    purpose: 'Legacy env fallback for the template_builder_v2 feature flag when GrowthBook is not configured.',
    note: 'Read as FF_<FLAG upper-cased>; exactly "true" turns the flag on. Registered under DYNAMIC_ENV_READS.' },
  { name: 'GROWTHBOOK_API_HOST', type: 'url', default: null, failureDirection: 'open',
    purpose: 'Self-hosted GrowthBook API host for feature flags (needs GROWTHBOOK_CLIENT_KEY too).',
    note: 'Either one unset: a single warning at boot and flags fall back to the FF_* variables.' },
  { name: 'GROWTHBOOK_CLIENT_KEY', type: 'secret', default: null, failureDirection: 'open',
    purpose: 'GrowthBook client key for feature flags (needs GROWTHBOOK_API_HOST too).',
    note: 'Either one unset: a single warning at boot and flags fall back to the FF_* variables.' },
  { name: 'LICENSE_RECONCILE_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the daily safety-net cron that re-syncs each card subscription\'s Stripe quantity with the live paired-screen count.',
    note: 'Also off under NODE_ENV=test. The event-driven syncs on pair/unpair stay.' },
  { name: 'LICENSE_RECONCILE_INTERVAL_MS', type: 'integer', default: 60000, failureDirection: 'n/a',
    purpose: 'How often, in ms, the licence reconcile cron wakes.',
    note: '`Number(x) || 60000`: 0 or non-numeric falls back to one minute.' },
  { name: 'PILOT_SEAT_LIMIT', type: 'integer', default: 1000, failureDirection: 'open',
    purpose: 'Internal paired-screen ceiling for pilot tenants with no licence (generous on purpose; NOT the advertised 3-screen trial).',
    note: 'Positive number, floored; anything else falls back to 1000. A one-time boot log says when it is unset.' },
  { name: 'PLATFORM_ASSET_WIPE_ENABLED', type: 'boolean', default: false, accepts: '1 | true', failureDirection: 'closed',
    purpose: 'Re-enables the super-admin "Wipe ALL Assets" route for a deliberate clean slate on a non-customer deploy.',
    note: 'Unset (production): the route answers 403 and audits every refused attempt. Still needs the typed confirmation. Never set it where customers live.' },
  { name: 'STRIPE_PRICE_ANNUAL', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Stripe recurring Price id for VenueOS (no AI), $200 per screen per year.',
    note: 'Unset: card checkout is unavailable (cardBillingReady is false).' },
  { name: 'STRIPE_PRICE_ANNUAL_AI', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Stripe recurring Price id for VenueOS + AI, $250 per screen per year.',
    note: 'Both AI prices must be set for "Include AI" to be offered at checkout.' },
  { name: 'STRIPE_PRICE_MONTHLY', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Stripe recurring Price id for VenueOS (no AI), $20 per screen per month.',
    note: 'Unset: card checkout is unavailable (cardBillingReady is false).' },
  { name: 'STRIPE_PRICE_MONTHLY_AI', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Stripe recurring Price id for VenueOS + AI, $25 per screen per month.',
    note: 'Both AI prices must be set for "Include AI" to be offered at checkout.' },
  { name: 'STRIPE_SECRET_KEY', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Stripe API key. Setting it turns billing on: checkout, portal, invoices and the webhook.',
    note: 'Unset: every billing endpoint degrades gracefully ({enabled:false} / []), so a deploy without billing is unaffected.' },
  { name: 'STRIPE_WEBHOOK_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Signing secret for POST /api/v1/billing/webhook; every event is verified against it.',
    note: 'Unset: the webhook cannot verify an event and returns 400.' },
  { name: 'TRIAL_REMINDERS_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the hourly trial and dunning reminder emails to customer admins.',
    note: 'Also off under NODE_ENV=test.' },
  { name: 'TRIAL_REMINDERS_INTERVAL_MS', type: 'integer', default: 3600000, failureDirection: 'n/a',
    purpose: 'How often, in ms, the trial reminder cron wakes.',
    note: '`Number(x) || 3600000`: 0 or non-numeric falls back to one hour.' },

  // ─── Media pipeline: optimisation, posters, probes, PDF pages, upload checks ───────────────
  { name: 'MEDIA_IMAGE_MAX_DIM', type: 'integer', default: 3840, failureDirection: 'n/a',
    purpose: 'Longest edge, in px, an uploaded image is resized down to (4K photos keep their detail).',
    note: 'Positive whole number; anything else falls back to 3840.' },
  { name: 'MEDIA_IMAGE_MIN_BYTES', type: 'integer', default: 51200, failureDirection: 'n/a',
    purpose: 'Images smaller than this many bytes are not worth optimising and are left alone.',
    note: 'Positive whole number; anything else falls back to 50 KiB.' },
  { name: 'MEDIA_IMAGE_WEBP_QUALITY', type: 'integer', default: 82, failureDirection: 'n/a',
    purpose: 'WebP quality of optimised images and of every rendered PDF page.',
    note: 'Positive whole number; anything else falls back to 82.' },
  { name: 'MEDIA_POSTER_JPEG_Q', type: 'integer', default: 4, failureDirection: 'n/a',
    purpose: 'ffmpeg mjpeg -q:v for video poster frames (2 = best ... 31 = worst).',
    note: 'Positive whole number; anything else falls back to 4.' },
  { name: 'MEDIA_POSTER_MAX_WIDTH', type: 'integer', default: 640, failureDirection: 'n/a',
    purpose: 'Maximum width, in px, of a generated video poster frame.',
    note: 'Positive whole number; anything else falls back to 640.' },
  { name: 'MEDIA_POSTER_SEEK_SECONDS', type: 'integer', default: 1, failureDirection: 'n/a',
    purpose: 'Seconds into a video the poster frame is grabbed (skips the black first frame); a retry at 0 handles sub-second clips.',
    note: 'Positive whole number; anything else falls back to 1.' },
  { name: 'MEDIA_POSTER_TIMEOUT_MS', type: 'integer', default: 20000, failureDirection: 'n/a',
    purpose: 'SIGKILL budget, in ms, for one poster frame grab.',
    note: 'Positive whole number; anything else falls back to 20000.' },
  { name: 'MEDIA_PROBE_TIMEOUT_MS', type: 'integer', default: 15000, failureDirection: 'n/a',
    purpose: 'Time budget, in ms, for one ffprobe of an uploaded video.',
    note: 'Positive whole number; anything else falls back to 15000.' },
  { name: 'MEDIA_VIDEO_CRF', type: 'integer', default: 24, failureDirection: 'n/a',
    purpose: 'x264 CRF for the legacy video optimiser (lower = higher quality and bigger files; 23-26 is visually high).',
    note: 'Positive whole number; anything else falls back to 24.' },
  { name: 'MEDIA_VIDEO_MAX_HEIGHT', type: 'integer', default: 1080, failureDirection: 'n/a',
    purpose: 'Maximum height, in px, the legacy video optimiser scales a video to (aspect preserved).',
    note: 'Positive whole number; anything else falls back to 1080.' },
  { name: 'MEDIA_VIDEO_TIMEOUT_MS', type: 'integer', default: 180000, failureDirection: 'n/a',
    purpose: 'Time budget, in ms, for one legacy video optimisation run.',
    note: 'Positive whole number; anything else falls back to 180000.' },
  { name: 'PDF_PAGES_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops rendering PDF pages into screen-shaped pictures; a PDF then reaches screens as it did before this feature.',
    note: 'Android players have no PDF viewer, so a PDF shown that way draws nothing there.' },
  { name: 'PDF_PAGES_LEGACY_SWEEP_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Leaves PDFs uploaded before the pages feature exactly as they are instead of adopting them in the background sweep.' },
  { name: 'PDF_PAGES_MAX', type: 'integer', default: 60, failureDirection: 'n/a',
    purpose: 'Most pages rendered per PDF; the rest are listed as not shown (the library says "first 60 of 214").',
    note: 'Positive whole number; anything else falls back to 60.' },
  { name: 'PDF_PAGES_PER_JOB', type: 'integer', default: 6, failureDirection: 'n/a',
    purpose: 'Pages rendered per Chromium job, so no child holds a whole document\'s images.',
    note: 'Positive whole number; anything else falls back to 6.' },
  { name: 'UPLOAD_CHECK_BUDGET_MS', type: 'integer', default: 12000, failureDirection: 'open',
    purpose: 'Whole upload content check per file, in ms; at the deadline the child is killed and the upload is ACCEPTED.',
    note: 'Positive whole number; anything else falls back to 12000.' },
  { name: 'UPLOAD_CHECK_MAX_PARALLEL', type: 'integer', default: 1, failureDirection: 'n/a',
    purpose: 'ffprobe / ffmpeg children the upload check runs at once per process (this process also delivers alerts).',
    note: 'Positive whole number; anything else falls back to 1.' },
  { name: 'UPLOAD_CHECK_PROBE_MS', type: 'integer', default: 6000, failureDirection: 'open',
    purpose: 'The ffprobe step of the upload content check, in ms; a probe that times out cannot refuse the file.',
    note: 'Positive whole number; anything else falls back to 6000.' },
  { name: 'UPLOAD_CONTENT_CHECK_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Switches off the upload content check (a picture sharp can read, a video that probes and decodes, a PDF with its markers).',
    note: 'A check that could not run ACCEPTS the file (logged "[upload-check] could not check"); never invert that.' },
  { name: 'UPLOAD_HEIC_BUDGET_MS', type: 'integer', default: 30000, failureDirection: 'closed',
    purpose: 'Whole-file budget, in ms, for converting an uploaded HEIC / HEIF photo to JPEG; the child is SIGKILLed at it.',
    note: 'A conversion that cannot finish is refused (503 ASSET_IMAGE_HEIC_UNAVAILABLE); a HEIC is never stored. Positive whole number, else 30000.' },
  { name: 'VIDEO_FASTSTART_REMUX_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'closed', killSwitch: true,
    purpose: 'Stops the lossless fast-start re-mux of MP4s whose index sits after their samples.',
    note: 'A failed re-mux changes nothing and the original is kept; never applied to emergency content.' },
  { name: 'VIDEO_PROBE_AUTOHEAL_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the hourly re-probe that grades videos uploaded before the probe existed ("Playback on screens").',
    note: 'A failed probe is stamped and retried once per probe version, never hourly. Off under NODE_ENV=test.' },
  { name: 'VIDEO_TRANSCODE_DISABLED', type: 'boolean', default: false, accepts: '1 | true | on | yes', failureDirection: 'closed', killSwitch: true,
    purpose: 'Stops enqueueing AND claiming signage transcode jobs (conversion of incompatible video and screen-sized copies).',
    note: 'Subtractive only: originals are kept as they are.' },

  // ─── Sports, proof-of-play and analytics ───────────────────────────────────────────────────
  { name: 'CLOCK_ADVANCE_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the 1 s sweep that holds a running game clock when it reaches 0:00 (or its segment length) with one horn.',
    note: 'Also off under NODE_ENV=test. Without it an expired clock keeps running until the table acts.' },
  { name: 'CLOCK_ADVANCE_INTERVAL_MS', type: 'integer', default: 1000, failureDirection: 'n/a',
    purpose: 'How often, in ms, the game-clock expiry sweep runs.',
    note: '`Number(x) || 1000`: 0 or non-numeric falls back to one second.' },
  { name: 'GAME_SCHEDULE_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the sweep that puts a game\'s board on its selected screens at the armed auto-push time and gives them back after the postgame hold.',
    note: 'Also off under NODE_ENV=test. A per-game failure never kills the pass.' },
  { name: 'GAME_SCHEDULE_INTERVAL_MS', type: 'integer', default: 15000, failureDirection: 'n/a',
    purpose: 'How often, in ms, the game auto-push sweep runs.',
    note: '`Number(x) || 15000`: 0 or non-numeric falls back to 15 seconds.' },
  { name: 'PROOF_OF_PLAY_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the sampler that records what each screen is playing for proof-of-play reports.',
    note: 'Also off under NODE_ENV=test. Disabling leaves a gap in the reporting record.' },
  { name: 'PROOF_OF_PLAY_RETENTION_DAYS', type: 'integer', default: null, failureDirection: 'closed',
    purpose: 'How long RAW playback_samples rows are kept; unset, the purge never cuts ahead of the hourly rollup watermark.',
    note: 'Unset: 14 days once the hourly rollup has produced an aggregate, 90 days on an install that never rolled up. An EXPLICIT value is honoured exactly even with no rollup, so setting it can shorten retention. 0 or negative disables the purge.' },
  { name: 'PROOF_OF_PLAY_ROLLUP_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'closed', killSwitch: true,
    purpose: 'Turns off the hourly aggregation of proof-of-play samples; raw rows are then held at the 90-day default rather than shortened.',
    note: 'A stopped rollup must cost disk, never data. Also off under NODE_ENV=test.' },
  { name: 'PROOF_OF_PLAY_ROLLUP_INTERVAL_MS', type: 'integer', default: 600000, failureDirection: 'n/a',
    purpose: 'How often, in ms, the proof-of-play rollup worker wakes (leader-leased, so one replica aggregates).',
    note: '`Number(x) || 600000`.' },
  { name: 'PROOF_OF_PLAY_ROLLUP_MAX_HOURS', type: 'integer', default: 72, failureDirection: 'n/a',
    purpose: 'Hours of backlog one rollup tick may catch up, so the first run after the migration never monopolises the pool.',
    note: '`Math.floor(Number(x) || 72)`, minimum 1.' },
  { name: 'PROOF_OF_PLAY_ROLLUP_RETENTION_DAYS', type: 'integer', default: 400, failureDirection: 'n/a',
    purpose: 'How long hourly aggregate rows are kept; reports read them for older ranges.',
    note: '0 or negative disables the purge.' },
  { name: 'PROOF_OF_PLAY_SAMPLE_INTERVAL_MS', type: 'integer', default: 600000, failureDirection: 'n/a',
    purpose: 'How often, in ms, the proof-of-play sampler records a sample; analytics also uses it to turn sample counts into hours.',
    note: '`Number(x) || 600000` (10 minutes).' },
  { name: 'SPORTS_BEACON_REQUIRE_VERIFIED', type: 'boolean', default: false, accepts: '1 | true | yes', failureDirection: 'open',
    purpose: 'Refuses UNVERIFIED sponsor-impression and cue beacons outright (503 when verification state cannot be read) instead of recording them labelled.',
    note: 'Default accepts them: an OBS browser source or HDMI-driven board has no device credential. Verified-lane counts feed the contractual proof-of-play.' },
  { name: 'SPORTS_BEACON_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Signs the short-lived proof-of-play beacon capability (SEC-007); replay is rejected in Redis.',
    note: 'Min 16 chars. Falls back to SPORTS_FEED_SECRET, then to the DEVICE_SECRET_KEY ring with a production warning (shared blast radius).' },
  { name: 'SPORTS_CONSOLE_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Signs sports console share tokens, kept non-interchangeable with feed tokens.',
    note: 'Min 16 chars. Unset: derives from the DEVICE_SECRET_KEY ring with a production warning (shared blast radius).' },
  { name: 'SPORTS_FEED_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Signs vendor score-feed tokens (and is the second choice for beacon capabilities); rotating it is the global feed kill switch.',
    note: 'Min 16 chars, 64 recommended (warns when shorter). Unset: derives from the DEVICE_SECRET_KEY ring with a production warning.' },

  // ─── Capacity early-warning, efficiency and egress accounting ──────────────────────────────
  { name: 'CAPACITY_CRITICAL_PCT', type: 'number', default: 85, failureDirection: 'n/a',
    purpose: 'Percent of a plan limit at which the capacity early-warning goes critical (emails immediately on escalation).',
    note: 'If warn >= critical the pair resets to 70 / 85 so a typo cannot silence the critical tier.' },
  { name: 'CAPACITY_LIMITS', type: 'json', default: null, failureDirection: 'open',
    purpose: 'Optional JSON overriding plan limits: dbBytes, dbConnections, storageBytes, redisBytes, memoryBytes, eventLoopLagMs, pairedScreens.',
    note: 'Defaults: 8 GiB database, live max_connections, 100 GiB storage, 256 MiB or live Redis maxmemory, NODE_OPTIONS or 8 GiB memory, 250 ms loop lag, 1000 screens. Bad JSON or non-positive keys are ignored key by key. Update it the day a plan changes.' },
  { name: 'CAPACITY_WARN_PCT', type: 'number', default: 70, failureDirection: 'n/a',
    purpose: 'Percent of a plan limit at which the capacity early-warning emails the owner (at most once per metric per day).',
    note: 'If warn >= critical the pair resets to 70 / 85.' },
  { name: 'CAPACITY_WATCH_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the hourly capacity sampler (database, storage, tables, screens, Redis, API memory, event-loop lag) and its emails.',
    note: 'Also off under NODE_ENV=test. A probe that cannot run is omitted, never invented.' },
  { name: 'EFFICIENCY_FLUSH_EVERY_N', type: 'integer', default: 200, failureDirection: 'n/a',
    purpose: 'Efficiency counters are flushed after this many recorded events.',
    note: '>= 1 (floored); anything else falls back to 200.' },
  { name: 'EFFICIENCY_FLUSH_MS', type: 'integer', default: 10000, failureDirection: 'n/a',
    purpose: 'Efficiency counters are flushed at least this often, in ms.',
    note: '>= 1000; anything else falls back to 10000.' },
  { name: 'EGRESS_ANOMALY_MIN_GB', type: 'number', default: 1, failureDirection: 'n/a',
    purpose: 'Smallest hourly egress, in GB, that can be flagged as an anomaly (the 2026-05-23 cache-miss storm was 5.79 GB).',
    note: '>= 0; anything else falls back to 1.' },
  { name: 'EGRESS_BUDGET_GB', type: 'number', default: 250, failureDirection: 'n/a',
    purpose: 'Egress budget, in GB, that the efficiency alerting measures usage against (alerts at percentage thresholds of it).' },
  { name: 'SLOW_QUERY_THRESHOLD_MS', type: 'integer', default: 200, failureDirection: 'n/a',
    purpose: 'A database query slower than this many ms is logged and shown in the /super/efficiency slow-query table.',
    note: '`parseInt`; the default applies when unset.' },

  // ─── Integrations: POS, SIS, social, music, maps, business usage ───────────────────────────
  { name: 'APPLE_MUSIC_TEAM_ID', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Apple developer team id for the Apple Music business connect flow.',
    note: 'Unset: the flow answers 503 MUSIC_APPLE_NOT_CONFIGURED.' },
  { name: 'BUSINESS_RAILWAY_TOKEN', type: 'secret', default: null, failureDirection: 'open',
    purpose: 'Railway API token for the owner\'s business-usage page (provider spend).',
    note: 'Unset (with the workspace id): the Railway usage source reports not_configured.' },
  { name: 'BUSINESS_RAILWAY_WORKSPACE_ID', type: 'string', default: null, failureDirection: 'open',
    purpose: 'Railway workspace id the business-usage page reads spend for.' },
  { name: 'BUSINESS_VERCEL_PROJECT_ID', type: 'string', default: null, failureDirection: 'open',
    purpose: 'Vercel project id the business-usage page reads usage for.' },
  { name: 'BUSINESS_VERCEL_TEAM_ID', type: 'string', default: null, failureDirection: 'open',
    purpose: 'Vercel team id the business-usage page reads usage for.' },
  { name: 'BUSINESS_VERCEL_TOKEN', type: 'secret', default: null, failureDirection: 'open',
    purpose: 'Vercel API token for the owner\'s business-usage page.',
    note: 'Unset: the Vercel usage source reports not_configured.' },
  { name: 'CANVA_CLIENT_ID', type: 'string', default: null, failureDirection: 'n/a',
    purpose: 'Canva Connect OAuth client id. Today only the integrations health page reads it; the OAuth picker is not built.',
    note: 'PDF and image imports work without it.' },
  { name: 'CANVA_CLIENT_SECRET', type: 'secret', default: null, failureDirection: 'n/a',
    purpose: 'Canva Connect OAuth client secret (see CANVA_CLIENT_ID).' },
  { name: 'CLEVER_CLIENT_ID', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Clever SIS OAuth client id.',
    note: 'Unset: the Clever connect flow reports not configured.' },
  { name: 'CLEVER_CLIENT_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Clever SIS OAuth client secret.' },
  { name: 'CLEVER_CRON_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the Clever roster sync cron; already-synced data stays.',
    note: 'Also off under NODE_ENV=test.' },
  { name: 'CLEVER_ENCRYPTION_KEY', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Encrypts stored Clever district tokens.',
    note: 'Unset: any use throws "CLEVER_ENCRYPTION_KEY not configured".' },
  { name: 'CLEVER_POST_CONNECT_URL', type: 'url', default: '/', failureDirection: 'n/a',
    purpose: 'Where the browser lands after a successful Clever connect.' },
  { name: 'CLEVER_REDIRECT_URI', type: 'url', default: null, failureDirection: 'n/a',
    purpose: 'OAuth redirect URI registered with Clever.',
    note: 'Unset: derived from the request protocol and host.' },
  { name: 'CLOVER_API_BASE', type: 'url', default: null, failureDirection: 'closed',
    purpose: 'Development-only override of the Clover API base for a sandbox harness.',
    note: 'Ignored when NODE_ENV=production.' },
  { name: 'CLOVER_CLIENT_ID', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Clover OAuth client id for the POS menu-board connector.',
    note: 'Unset: connecting throws "Clover OAuth not configured".' },
  { name: 'CLOVER_CLIENT_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Clover OAuth client secret.' },
  { name: 'CLOVER_ENV', type: 'enum', values: ['production', 'sandbox'], default: 'sandbox', failureDirection: 'closed',
    purpose: 'Clover environment; only the exact value production selects the live Clover accounts host.',
    note: 'Anything else, or unset, is sandbox.' },
  { name: 'GEOCODE_AUTOHEAL_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the cron that geocodes screen locations missing coordinates.',
    note: 'Locations stay as they are; manual address pickers still work.' },
  { name: 'GOOGLE_MAPS_API_KEY', type: 'secret', default: null, failureDirection: 'open',
    purpose: 'Google Geocoding key (server-side only) for address pickers; also the key the Google Reviews app reuses (needs Places API (New)).',
    note: 'Unset: pickers fall back to OSM Nominatim (street-level, free); Google Reviews reports { enabled: false }.' },
  { name: 'GOOGLE_REVIEWS_FETCH_HOURLY_CAP', type: 'integer', default: 60, failureDirection: 'n/a',
    purpose: 'Per-tenant hourly cap on upstream Google Reviews fetches.',
    note: 'Positive whole number; anything else falls back to 60.' },
  { name: 'GOOGLE_REVIEWS_SEARCH_HOURLY_CAP', type: 'integer', default: 30, failureDirection: 'n/a',
    purpose: 'Per-tenant hourly cap on upstream Google Reviews place searches.',
    note: 'Positive whole number; anything else falls back to 30.' },
  { name: 'INSTAGRAM_APP_ID', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Meta app\'s Instagram product id ("Instagram API with Instagram Login", business and creator accounts).',
    note: 'Unset: dormant, never broken - status says { enabled: false } and authorize answers 503 SOCIAL_OAUTH_NOT_CONFIGURED.' },
  { name: 'INSTAGRAM_APP_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Meta app\'s Instagram product secret; tokens are sealed with creds-cipher and never leave the API.' },
  { name: 'LIGHTSPEED_API_BASE', type: 'url', default: null, failureDirection: 'closed',
    purpose: 'Development-only override of the Lightspeed API base for a sandbox harness.',
    note: 'Ignored when NODE_ENV=production.' },
  { name: 'LIGHTSPEED_CLIENT_ID', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Lightspeed OAuth client id for the retail connector.',
    note: 'Unset: connecting throws a "not configured" error.' },
  { name: 'LIGHTSPEED_CLIENT_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Lightspeed OAuth client secret.' },
  { name: 'LIGHTSPEED_ENV', type: 'enum', values: ['production', 'sandbox'], default: 'production', failureDirection: 'n/a',
    purpose: 'Lightspeed environment; only the exact value sandbox selects the sandbox, anything else is production.' },
  { name: 'META_APP_ID', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Meta app id for Facebook Login (the Facebook Page social app).',
    note: 'Unset: dormant, never broken - the same posture as the Instagram variables.' },
  { name: 'META_APP_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Meta app secret for Facebook Login.' },
  { name: 'POS_CRON_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the 60 s POS sync cron that pulls menu prices and availability; boards keep the last synced values.',
    note: 'Also off under NODE_ENV=test.' },
  { name: 'SHOPIFY_API_BASE', type: 'url', default: null, failureDirection: 'closed',
    purpose: 'Development-only override of the Shopify API base for a sandbox harness.',
    note: 'Ignored when NODE_ENV=production.' },
  { name: 'SHOPIFY_CLIENT_ID', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Shopify OAuth client id for the retail connector.',
    note: 'Unset: connecting throws a "not configured" error.' },
  { name: 'SHOPIFY_CLIENT_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Shopify OAuth client secret.' },
  { name: 'SOCIAL_CRON_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the hourly social cron that refreshes 60-day tokens and cached Instagram / Facebook posts; cached posts stay on screen.',
    note: 'Also off under NODE_ENV=test.' },
  { name: 'SPOTIFY_BUSINESS_CLIENT_ID', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Spotify for Business OAuth client id for the music connect flow.',
    note: 'Unset: the flow answers 503.' },
  { name: 'SPOTIFY_BUSINESS_REDIRECT_URI', type: 'url', default: null, failureDirection: 'n/a',
    purpose: 'Spotify OAuth redirect URI.',
    note: 'Unset: https://<request host>/api/v1/music/oauth/spotify/callback.' },
  { name: 'SQUARE_API_BASE', type: 'url', default: null, failureDirection: 'closed',
    purpose: 'Development-only override of the Square API base for a sandbox harness.',
    note: 'Ignored when NODE_ENV=production.' },
  { name: 'SQUARE_CLIENT_ID', type: 'string', default: null, failureDirection: 'closed',
    purpose: 'Square OAuth client id for the POS connector.',
    note: 'Unset: connecting throws a "not configured" error.' },
  { name: 'SQUARE_CLIENT_SECRET', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Square OAuth client secret.' },
  { name: 'SQUARE_ENV', type: 'enum', values: ['production', 'sandbox'], default: 'sandbox', failureDirection: 'closed',
    purpose: 'Square environment; only the exact value production selects the live Square hosts.',
    note: 'Anything else, or unset, is sandbox.' },
  { name: 'SQUARE_WEBHOOK_SIG_KEY', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Signature key that verifies Square webhook deliveries.',
    note: 'Unset: every Square webhook is rejected (logged).' },
  { name: 'WEATHER_GEOCODER_URL', type: 'url', default: 'https://nominatim.openstreetmap.org/search', failureDirection: 'n/a',
    purpose: 'Geocoder endpoint for the weather forecast feed (cached 30 days, limited to 1 request/second).' },

  // ─── Chromium render worker (inherited allowlist), SSR proxy and outbound webhooks ────────
  { name: 'CHROME_DEVEL_SANDBOX', type: 'path', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Path of the SUID sandbox helper; forwarded to the render child (allowlist) for the day the container can use it.' },
  { name: 'HOME', type: 'path', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Writable home-ish directory Chromium needs; forwarded to the render child (allowlist).' },
  { name: 'LANG', type: 'string', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Locale for text rendering and date formatting; forwarded to the render child (allowlist).' },
  { name: 'LANGUAGE', type: 'string', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Locale priority list; forwarded to the render child (allowlist).' },
  { name: 'LC_ALL', type: 'string', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Locale override; forwarded to the render child (allowlist).' },
  { name: 'LD_LIBRARY_PATH', type: 'path', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Shared-library search path Node and Chromium need; forwarded to the render child (allowlist).' },
  { name: 'PATH', type: 'path', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Executable search path; forwarded to the render child (allowlist) so Node and Chromium find their binaries.' },
  { name: 'PUPPETEER_EXECUTABLE_PATH', type: 'path', default: '/usr/bin/chromium-browser', origin: 'platform', failureDirection: 'n/a',
    purpose: 'Chromium binary the render worker launches; also forwarded to the render child (allowlist).',
    note: 'Blank is treated as unset - an empty value used to fail every job as invalid-job-message.' },
  { name: 'PUPPETEER_SKIP_CHROMIUM_DOWNLOAD', type: 'string', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Tells Puppeteer not to download a browser; forwarded to the render child (allowlist).' },
  { name: 'PUPPETEER_SKIP_DOWNLOAD', type: 'string', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Tells Puppeteer not to download a browser; forwarded to the render child (allowlist).' },
  { name: 'SSL_CERT_DIR', type: 'path', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'CA bundle directory (Alpine / musl) the render child\'s Node half needs for DNS and TLS; forwarded (allowlist).' },
  { name: 'SSL_CERT_FILE', type: 'path', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'CA bundle file (Alpine / musl) the render child\'s Node half needs for DNS and TLS; forwarded (allowlist).' },
  { name: 'TEMP', type: 'path', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Temporary directory; forwarded to the render child (allowlist).' },
  { name: 'TMP', type: 'path', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Temporary directory; forwarded to the render child (allowlist).' },
  { name: 'TMPDIR', type: 'path', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Temporary directory; forwarded to the render child (allowlist).' },
  { name: 'TZ', type: 'string', default: null, origin: 'platform', failureDirection: 'n/a',
    purpose: 'Time zone for date formatting; forwarded to the render child (allowlist).' },
  { name: 'VENUEOS_RENDER_WORKER', type: 'boolean', default: false, accepts: '1', origin: 'internal', failureDirection: 'n/a',
    purpose: 'Set to 1 by the API on the forked render child so the worker script starts itself; never set by hand.' },
  { name: 'SSR_ENABLED', type: 'boolean', default: true, accepts: 'false', failureDirection: 'open', killSwitch: true,
    purpose: 'Server-side Chromium rendering of proxied pages: exactly "false" turns it off and the proxy falls back to fetch + strip-scripts.',
    note: 'A render still needs a signed render capability (SEC-006); this switch only removes the Chromium path.' },
  { name: 'WEBHOOK_RETRY_BATCH', type: 'integer', default: 50, failureDirection: 'n/a',
    purpose: 'Webhook deliveries claimed per retry tick.',
    note: '`Number(x) || 50`.' },
  { name: 'WEBHOOK_RETRY_DISABLED', type: 'boolean', default: false, accepts: '1', failureDirection: 'open', killSwitch: true,
    purpose: 'Stops the outbound-webhook retry worker; delivery rows are the source of truth and stay armed.',
    note: 'Also off under NODE_ENV=test.' },
  { name: 'WEBHOOK_RETRY_HEARTBEAT_MS', type: 'integer', default: 10000, failureDirection: 'n/a',
    purpose: 'How often, in ms, the retry worker refreshes the lease on its in-flight rows.',
    note: 'Must be > 0, floored; anything else falls back to 10000.' },
  { name: 'WEBHOOK_RETRY_INTERVAL_MS', type: 'integer', default: 5000, failureDirection: 'n/a',
    purpose: 'Active poll cadence, in ms, of the webhook retry worker (it doubles after every empty tick up to the idle ceiling).',
    note: 'Must be > 0, floored; anything else falls back to 5000.' },
  { name: 'WEBHOOK_RETRY_MAX_IDLE_MS', type: 'integer', default: 60000, failureDirection: 'n/a',
    purpose: 'Idle ceiling, in ms, for the webhook retry poll; never above 60 s so a retry cannot be parked for minutes.',
    note: 'Clamped to between the active interval and 60000.' },
  { name: 'WEBHOOK_RETRY_RECLAIM_MS', type: 'integer', default: 120000, failureDirection: 'n/a',
    purpose: 'How long an in-flight retry row may go unrefreshed, in ms, before another worker reclaims it (a crashed worker).',
    note: 'Floored at max(30000, 4 x heartbeat).' },

  // ─── Secret-rotation windows (read through a computed name; see DYNAMIC_ENV_READS) ─────────
  { name: 'DEVICE_JWT_SECRET_PREVIOUS', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Optional rotation window for DEVICE_JWT_SECRET: the OLD value, accepted on verify only while new tokens are signed with the primary.',
    note: 'Unset = no window, byte-for-byte the old behaviour. When set it must be >= 16 chars and differ from the primary, or the boot REFUSES in every environment. Delete it once every live screen has a token on the new key (docs/SECRET-ROTATION.md).' },
  { name: 'DEVICE_SECRET_KEY_PREVIOUS', type: 'secret', default: null, failureDirection: 'closed',
    purpose: 'Optional rotation window for DEVICE_SECRET_KEY: the OLD value, accepted on verify and decrypt only; every new signature and envelope uses the primary.',
    note: 'Unset = no window. When set it must be >= 16 chars and differ from the primary, or the boot REFUSES. The leader-leased re-wrap job (POST /super/key-rotation/rewrap) proves when it can go.' },

  // ─── Retired: nothing reads these; boot only WARNS if one is still set ─────────────────────
  { name: 'PLAYER_APK_LATEST_VERSION_CODE', type: 'string', default: null, retired: true, failureDirection: 'n/a',
    purpose: 'Removed 2026-05-15: the manual OTA version-code pin. A stale value once stranded the whole fleet on an old build.',
    note: 'Inert. Delete it from the deploy environment; an OTA variable may only ever be subtractive.' },
  { name: 'PLAYER_APK_LATEST_VERSION_NAME', type: 'string', default: null, retired: true, failureDirection: 'n/a',
    purpose: 'Removed 2026-05-15: the manual OTA version-name pin (see PLAYER_APK_LATEST_VERSION_CODE).',
    note: 'Inert. Delete it from the deploy environment.' },
  { name: 'PLAYER_APK_SHA256', type: 'string', default: null, retired: true, failureDirection: 'n/a',
    purpose: 'Removed 2026-05-15: the manual OTA digest pin, superseded by the committed pins and the authenticated release asset digest.',
    note: 'Inert. Delete it from the deploy environment.' },
];

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  DYNAMIC READS - see dynamicEnvReadSchema.
// ═══════════════════════════════════════════════════════════════════════════════════════════
// prettier-ignore
export const DYNAMIC_ENV_READS: readonly DynamicEnvRead[] = [
  { file: 'apps/api/src/billing/stripe.service.ts', expr: 'process.env[spec.slot]',
    covers: ['STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_ANNUAL', 'STRIPE_PRICE_MONTHLY_AI', 'STRIPE_PRICE_ANNUAL_AI'],
    reader: 'apps/api/src/billing/price-config-check.ts',
    why: 'verifyPriceConfig loops over PRICE_SLOTS and reads each slot name; the four names are literals in price-config-check.ts.' },
  { file: 'apps/api/src/feature-flags/feature-flags.service.ts', expr: 'process.env[`FF_${flag.toUpperCase()}`]',
    covers: ['FF_TEMPLATE_BUILDER_V2', 'FF_SPORTS_PLAYER_STATS'],
    why: 'The legacy flag fallback reads FF_ + the upper-cased flag key; FLAGS in the same file lists template_builder_v2 and sports_player_stats.' },
  { file: 'apps/api/src/security/key-ring.ts', expr: 'process.env[previousSecretName(name)]',
    covers: ['DEVICE_JWT_SECRET_PREVIOUS', 'DEVICE_SECRET_KEY_PREVIOUS'],
    why: 'A rotation window is the primary secret name + _PREVIOUS (previousSecretName).' },
  { file: 'apps/api/src/security/key-ring.ts', expr: 'env[previousSecretName(DEVICE_SECRET_KEY_NAME)]',
    covers: ['DEVICE_SECRET_KEY_PREVIOUS'],
    why: 'The OTA helpers that take an explicit env read DEVICE_SECRET_KEY + _PREVIOUS.' },
  { file: 'apps/api/src/security/key-ring.ts', expr: 'process.env[prevName]',
    covers: ['DEVICE_SECRET_KEY_PREVIOUS'],
    why: 'masterKeysFor derives the previous-key name from DEVICE_SECRET_KEY_NAME.' },
  { file: 'apps/api/src/security/key-ring.ts', expr: 'env[prevName]',
    covers: ['DEVICE_JWT_SECRET_PREVIOUS', 'DEVICE_SECRET_KEY_PREVIOUS'],
    why: 'assertKeyRingsAtBoot loops over ROTATABLE_SECRETS and validates each _PREVIOUS companion.' },
  { file: 'apps/api/src/security/key-ring.ts', expr: 'env[name]',
    covers: ['DEVICE_JWT_SECRET', 'DEVICE_SECRET_KEY'],
    why: 'assertKeyRingsAtBoot compares each rotatable primary with its _PREVIOUS companion.' },
  { file: 'apps/api/src/security/required-secret.ts', expr: 'env[v.name]',
    covers: ['PLAYER_APK_LATEST_VERSION_CODE', 'PLAYER_APK_LATEST_VERSION_NAME', 'PLAYER_APK_SHA256'],
    reader: 'apps/api/src/security/required-secret.ts',
    why: 'warnRetiredEnvVars loops over RETIRED_ENV_VARS and only tests whether each retired name is still set.' },
  { file: 'apps/api/src/schedules/playback-gate.service.ts', expr: 'playbackGateMode(process.env)',
    covers: ['VIDEO_PLAYBACK_GATE'],
    reader: 'packages/api-types/src/playback-capability.ts',
    why: 'The whole environment is handed to playbackGateMode, which lives in @cms/api-types and reads VIDEO_PLAYBACK_GATE.' },
  { file: 'apps/api/src/telemetry/file-playback.ts', expr: 'visibleStutterThresholds(process.env)',
    covers: ['VIDEO_DEMOTION_BAD_PCT', 'VIDEO_DEMOTION_STALL_MS', 'VIDEO_DEMOTION_STREAK'],
    reader: 'packages/api-types/src/playback-capability.ts',
    why: 'The whole environment is handed to visibleStutterThresholds, which lives in @cms/api-types.' },
  { file: 'apps/api/src/telemetry/playback-demotion.service.ts', expr: 'visibleStutterThresholds(process.env)',
    covers: ['VIDEO_DEMOTION_BAD_PCT', 'VIDEO_DEMOTION_STALL_MS', 'VIDEO_DEMOTION_STREAK'],
    reader: 'packages/api-types/src/playback-capability.ts',
    why: 'The whole environment is handed to visibleStutterThresholds, which lives in @cms/api-types.' },
  { file: 'apps/api/src/telemetry/playback-demotion.service.ts', expr: 'playbackDemotionMode(process.env)',
    covers: ['VIDEO_PLAYBACK_DEMOTION'],
    reader: 'packages/api-types/src/playback-capability.ts',
    why: 'The whole environment is handed to playbackDemotionMode, which lives in @cms/api-types and reads VIDEO_PLAYBACK_DEMOTION.' },
];

// ═══════════════════════════════════════════════════════════════════════════════════════════
//  The same declarations as a zod schema keyed by variable name, ready to validate an
//  environment snapshot. NOT WIRED INTO BOOT (see the header). It is deliberately LENIENT: it
//  reports a value the reader would certainly mis-handle (a non-number in a number slot, an enum
//  value nobody recognises), never a missing variable, and it lets unknown variables through.
// ═══════════════════════════════════════════════════════════════════════════════════════════
function leaf(v: EnvVarSpec): z.ZodType<string | undefined> {
  const base = z.string().optional();
  const empty = (s: string | undefined) => s === undefined || s.trim() === '';
  switch (v.type) {
    case 'integer':
      return base.refine((s) => empty(s) || /^-?\d+$/.test(s!.trim()), {
        message: `${v.name} must be a whole number`,
      });
    case 'number':
      return base.refine((s) => empty(s) || Number.isFinite(Number(s)), {
        message: `${v.name} must be a number`,
      });
    case 'enum':
      return base.refine(
        (s) => empty(s) || (v.values ?? []).includes(s!.trim().toLowerCase()),
        {
          message: `${v.name} must be one of ${(v.values ?? []).join(' | ')}`,
        },
      );
    case 'url':
      return base.refine((s) => empty(s) || URL.canParse(s!.trim()), {
        message: `${v.name} must be a URL`,
      });
    case 'json':
      return base.refine(
        (s) => {
          if (empty(s)) return true;
          try {
            JSON.parse(s!);
            return true;
          } catch {
            return false;
          }
        },
        { message: `${v.name} must be JSON` },
      );
    default:
      return base;
  }
}

export function buildEnvSchema(vars: readonly EnvVarSpec[] = ENV_VARS) {
  const shape: Record<string, z.ZodType<string | undefined>> = {};
  for (const v of vars) shape[v.name] = leaf(v);
  return z.looseObject(shape);
}

/** `process.env`-shaped input in, a list of `NAME: message` problems out (empty = nothing to report). */
export function checkEnvValues(
  env: Record<string, string | undefined>,
  vars: readonly EnvVarSpec[] = ENV_VARS,
): string[] {
  const r = buildEnvSchema(vars).safeParse(env);
  return r.success
    ? []
    : r.error.issues.map((i) => `${String(i.path[0] ?? '')}: ${i.message}`);
}
