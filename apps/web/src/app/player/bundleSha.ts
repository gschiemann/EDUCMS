/**
 * bundleSha — which page bundle is THIS player actually running?
 * (2026-08-25, "the dashboard lied to me")
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * A player fix ships in the WEB bundle, and a panel picks it up on its OWN
 * schedule: the bundle-drift detector in `page.tsx` polls `/api/build-info`
 * every ~5 min, then DEFERS the reload while content is playing (up to the
 * ~12 min staleness cap) and skips it entirely during an emergency. So for
 * up to ~20 minutes after a deploy, a freshly-fixed button and a genuinely
 * dead button look IDENTICAL from the dashboard — and nothing in telemetry
 * recorded which bundle a panel was on, so the only way to reason about it
 * was to infer panel state from deploy timestamps. That inference is what
 * turned a one-line player bug into an hour of believing the fleet was down.
 *
 * The detector always knew its own SHA; it just never told anyone. This
 * module is that read, lifted out of the effect so BOTH consumers share one
 * definition — the drift detector (which compares it) and the render-proof
 * POST (which reports it). Two different answers to "what am I running"
 * would be a new lie, so there is exactly one function.
 *
 * Pure: no React, no DOM, no network — unit-testable without mounting the
 * 9k-line player page.
 *
 * ⚠️ The `process.env.NEXT_PUBLIC_*` reads must stay written as literal
 * member expressions on `process.env`. Next inlines them at BUILD time by
 * textual substitution; a computed lookup (`process.env[name]`) is not
 * substituted and would resolve to undefined in the browser, silently
 * disabling both the drift reload AND this telemetry.
 */

/** The comparison width: `/api/build-info` returns `sha` already sliced to 12. */
export const BUNDLE_SHA_LENGTH = 12;

/**
 * Normalize a build identifier from any source (our own env,
 * `/api/build-info`) to the one form both sides compare on: lowercase, first
 * 12 chars, or null.
 *
 * ⚠️ PERMISSIVE ON PURPOSE. The obvious shape check here is "must look like a
 * hex commit SHA" — and it would be a REGRESSION. This same function now
 * gates the bundle-drift auto-reload, which has been quietly keeping the
 * fleet current since Sprint 11; a self-hosted deploy that stamps
 * `NEXT_PUBLIC_BUILD_SHA` with a build number or a tag would have its
 * auto-reload silently switched off by a hex-only rule. Losing a working
 * self-healing mechanism to tidy up a telemetry field is a bad trade.
 *
 * So the rule is BOUNDED, not narrow: a single token of
 * `[A-Za-z0-9._-]`, at most 64 chars. That accepts every real build
 * identifier (`abc123def456`, `1234`, `v1.2.3`, `release-9`) while rejecting
 * the things that actually matter downstream — whitespace, markup (`<`, `>`),
 * path separators, and anything long enough to bloat a DB row or a chip.
 *
 * null means "can't determine", and every consumer treats it as silence: the
 * drift detector skips its comparison, the dashboard chip renders nothing.
 * Never a verdict off a value we couldn't read.
 */
export function normalizeBundleSha(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(s)) return null;
  return s.toLowerCase().slice(0, BUNDLE_SHA_LENGTH);
}

/**
 * This document's baked-in bundle SHA, or null when the build didn't stamp
 * one (local dev, self-hosted builds without the env var).
 *
 * Read once per call and deliberately NOT cached in a module variable: the
 * value is compiled in, so re-reading is free, and a module-level cache
 * would make the Jest cases here order-dependent.
 */
export function readOwnBundleSha(): string | null {
  const raw =
    (process.env as Record<string, string | undefined>)
      .NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    (process.env as Record<string, string | undefined>).NEXT_PUBLIC_BUILD_SHA ||
    null;
  return normalizeBundleSha(raw);
}

/**
 * This document's baked-in BUNDLE ID — a hash of the client-bundle build
 * inputs (`apps/web/scripts/build-info.cjs`), stamped into
 * `NEXT_PUBLIC_BUNDLE_ID` before `next build`. Null when the prebuild step
 * did not run (a bare `next build`, some self-hosted setups, local dev).
 *
 * ── WHY THIS IS THE IMPORTANT ONE (2026-09-21) ──────────────────────────
 * This — not the SHA above — is the identity this player decides to RELOAD
 * on. The SHA moves on EVERY commit, including an API-only fix, a docs edit,
 * an APK change or a test-only commit, none of which can change a single
 * byte the browser downloads; the bundle id moves only when the bundle can
 * actually differ. The drift detector has compared on it since 2026-09-02.
 *
 * But the player only ever REPORTED its SHA, and the dashboard graded skew
 * on SHA equality — so after any commit that left the bundle untouched, the
 * deployed SHA moved, no player reloaded (correct), and every online screen
 * read "on an older build" forever. "App current 5/18" on a healthy fleet,
 * with a Resync that could not clear it: the screen reloads the identical
 * bundle and reports the identical SHA. Greg, 2026-09-21: "why does every
 * screen say resync on it…our app needs to self heal."
 *
 * So this function exists for the SAME reason `readOwnBundleSha` does, and
 * carries the same rule: there is EXACTLY ONE definition, shared by the
 * drift detector (which compares it) and the telemetry POST (which reports
 * it). Two answers to "what am I running" would be a new lie.
 *
 * ⚠️ The `process.env.NEXT_PUBLIC_BUNDLE_ID` read must stay a literal member
 * expression — see the file header. A computed lookup is not substituted at
 * build time and would silently disable BOTH the auto-reload and this report.
 */
export function readOwnBundleId(): string | null {
  return normalizeBundleSha(process.env.NEXT_PUBLIC_BUNDLE_ID);
}
