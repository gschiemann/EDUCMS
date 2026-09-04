/**
 * SEC-010 (2026-09-04) — the ENFORCED `script-src` policy for dashboard routes.
 *
 * WHAT MOVED. `script-src` used to ship report-only with `'unsafe-inline'`, so
 * a dashboard XSS could execute freely — and the remembered bearer token is
 * JavaScript-readable for up to 30 days. On every DYNAMICALLY RENDERED route
 * it is now ENFORCED, nonce-based, and `'unsafe-inline'` is gone. (A nonce
 * makes the browser IGNORE `'unsafe-inline'` outright, so there is no half-way
 * position: either the inline bootstrap is nonced or the policy keeps the
 * keyword.)
 *
 * ── THE CONSTRAINT THAT SHAPES ALL OF THIS: PRERENDERED PAGES ────────────
 * A per-request nonce only exists on a per-request render. Next serves a
 * statically prerendered route from HTML built at deploy time, whose inline
 * flight scripts carry `nonce: $undefined` — MEASURED, not assumed: on
 * 2026-09-04, `/login` (prerendered) came back with seven un-nonced
 * `<script>self.__next_f.push(…)</script>` blocks while `/demo-school/dashboard`
 * (dynamic) came back with all of them nonced. Enforcing a nonce policy on a
 * prerendered route therefore WHITE-SCREENS it.
 *
 * The routes that carry a session — the whole `/[schoolId]/*` dashboard, which
 * is the surface this finding is actually about — render dynamically and are
 * enforced. The prerendered set is public content, and it is EXCLUDED here by
 * name rather than by hope: `tools/check-csp-prerender.cjs` reads the build's
 * own `.next/prerender-manifest.json` and fails if any prerendered route falls
 * inside the enforced set. That guard is what makes this safe to leave alone —
 * a new static page inside the enforced prefixes breaks the BUILD, not a
 * customer's screen.
 *
 * WHAT DELIBERATELY DID NOT MOVE. This policy carries `script-src` and nothing
 * else. `connect-src`, `frame-src`, `style-src`, `img-src` and the rest stay in
 * the REPORT-ONLY policy in `next.config.ts` until the collector has real fleet
 * data — `connect-src` in particular has one known false positive
 * (`FitnessMusicPlayerWidget`'s operator-typed `nowPlayingEndpoint`) and
 * enforcing it off a guess is how you blank a screen. There is no `default-src`
 * here for the same reason: it would silently become the fallback for every
 * directive this policy does NOT name, which is the opposite of a scoped
 * change. The four already-enforced directives ARE repeated below, because a
 * middleware `Content-Security-Policy` header REPLACES the one `next.config.ts`
 * sets rather than adding to it (verified against a running build) — dropping
 * them would have quietly removed `frame-ancestors` from the dashboard.
 *
 * WHY `'self'` STAYS ALONGSIDE THE NONCE (i.e. no `'strict-dynamic'`).
 * `'strict-dynamic'` would drop the host allowlist entirely and rest the whole
 * policy on nonce propagation through Next's loader. `'self'` keeps
 * same-origin `<script src>` working no matter what Next changes about chunk
 * loading, and it costs little here: this origin serves no user-uploaded
 * JavaScript (assets live in Supabase storage; the ~320 static board documents
 * under `public/` are HTML, loaded as `src` iframes, and get their own response
 * headers rather than inheriting this one).
 */

/**
 * Path prefixes that are PRERENDERED and therefore cannot carry a nonce.
 *
 * Every entry is public content — marketing, legal, help, the status page, and
 * the mobile panic page. `/panic` is on this list for a second reason on top of
 * the nonce: it is a life-safety surface that a phone loads mid-incident, and a
 * CDN-served static document is strictly more available than a per-request
 * render. Trading that for a script policy would be a bad bargain.
 *
 * These keep the REPORT-ONLY policy from `next.config.ts`, exactly as before
 * this change — so nothing regressed for them; they simply did not improve.
 */
export const CSP_UNNONCEABLE_PREFIXES = [
  '/help',
  '/guide',
  '/terms',
  '/privacy',
  '/pricing',
  '/coppa',
  '/ferpa',
  '/panic',
  '/status',
  '/launch',
  '/demo',
] as const;

/** Prerendered routes with no useful prefix of their own. */
export const CSP_UNNONCEABLE_EXACT = ['/', '/_not-found', '/_global-error'] as const;

/**
 * Does this path render dynamically (and therefore carry a nonce)?
 *
 * Exported for the unit tests and for `tools/check-csp-prerender.cjs`, which
 * runs the real build manifest through it.
 */
export function shouldEnforceScriptCsp(pathname: string): boolean {
  if ((CSP_UNNONCEABLE_EXACT as readonly string[]).includes(pathname)) return false;
  for (const prefix of CSP_UNNONCEABLE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return false;
  }
  return true;
}

/** Values that turn the enforced policy off (falls back to today's behaviour). */
function enforcementDisabled(): boolean {
  const raw = (process.env.CSP_SCRIPT_SRC_ENFORCE || '').trim().toLowerCase();
  return raw === 'off' || raw === '0' || raw === 'false' || raw === 'report';
}

/** Kept byte-identical to `cspReportDirective()` in `next.config.ts`. */
function reportDirective(): string | null {
  const off = process.env.CSP_REPORTING_DISABLED;
  if (off === '1' || off === 'true') return null;
  return 'report-uri /api/csp-report';
}

export interface ScriptCspOptions {
  nonce: string;
  /** `next dev` compiles with `eval`; production never needs it. */
  dev?: boolean;
}

/**
 * The enforced policy, or `null` when the kill switch is set.
 *
 * `null` means the middleware adds NO header at all — the deploy reverts
 * exactly to the pre-SEC-010 shape (report-only from `next.config.ts`, with
 * `'unsafe-inline'`), with no half-applied state to reason about at 2am.
 */
export function scriptSrcCsp(opts: ScriptCspOptions): string | null {
  if (enforcementDisabled()) return null;
  const dev = opts.dev ?? process.env.NODE_ENV !== 'production';
  const scriptSrc = [
    "script-src 'self'",
    `'nonce-${opts.nonce}'`,
    // `next dev`'s HMR runtime and React Refresh both eval. Production does
    // not, and must not — this is the one directive difference between them.
    dev ? "'unsafe-eval'" : '',
  ]
    .filter(Boolean)
    .join(' ');

  return [
    scriptSrc,
    // Repeated from `baselineEnforcedCsp()` in next.config.ts — see the note
    // above: this header REPLACES that one, it does not merge with it.
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    reportDirective(),
  ]
    .filter((d): d is string => Boolean(d))
    .join('; ');
}
