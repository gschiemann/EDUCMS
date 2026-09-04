/**
 * SEC-010 (2026-09-04) — the ENFORCED `script-src` policy for dashboard routes.
 *
 * WHAT MOVED. `script-src` used to ship report-only with `'unsafe-inline'`, so
 * a dashboard XSS could execute freely — and the remembered bearer token is
 * JavaScript-readable for up to 30 days. It is now ENFORCED, nonce-based, and
 * `'unsafe-inline'` is gone. (A nonce makes the browser IGNORE
 * `'unsafe-inline'` outright, so there is no half-way position: either the
 * inline bootstrap is nonced or the policy has to keep the keyword.)
 *
 * WHAT DELIBERATELY DID NOT MOVE. This policy carries `script-src` and nothing
 * else. `connect-src`, `frame-src`, `style-src`, `img-src` and the rest stay in
 * the REPORT-ONLY policy in `next.config.ts` until the collector has real
 * fleet data — `connect-src` in particular has one known false positive
 * (`FitnessMusicPlayerWidget`'s operator-typed `nowPlayingEndpoint`) and
 * enforcing it off a guess is how you blank a screen. There is no `default-src`
 * here for the same reason: `default-src` would silently become the fallback
 * for every directive this policy does NOT name, which is the opposite of a
 * scoped change.
 *
 * WHY `'self'` STAYS ALONGSIDE THE NONCE (i.e. no `'strict-dynamic'`).
 * `'strict-dynamic'` would drop the host allowlist entirely and lean the whole
 * policy on nonce propagation through Next's loader. `'self'` keeps
 * same-origin `<script src>` working no matter what Next changes about chunk
 * loading, and it costs almost nothing here: this origin serves no
 * user-uploaded JavaScript (assets live in Supabase storage; the ~320 static
 * board documents under `public/` are HTML, loaded as `src` iframes, and get
 * their own response headers rather than inheriting this one).
 *
 * SCOPE. Dashboard documents only. Excluded, each for a concrete reason:
 *   • `/player` — a life-safety surface with its own policy, still report-only.
 *     It is also the route the Chromium-83 Taurus units load, and it injects
 *     its own inline polyfills through the middleware body-rewrite path.
 *   • the static board documents under `public/` — served straight off the CDN
 *     with no request through Next's renderer, so there is nothing to nonce.
 *   • `/_next/`, `/api/` — assets and JSON; a script policy on them is a no-op.
 */

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

  return [scriptSrc, reportDirective()].filter((d): d is string => Boolean(d)).join('; ');
}
