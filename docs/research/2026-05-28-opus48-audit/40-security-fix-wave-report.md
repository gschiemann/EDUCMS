# Security Fix Wave — launch-blockers + hardening (agent aa00ecf238d94c013)

> Branch `worktree-agent-aa00ecf238d94c013`, commit `0c61090`. Reviewed + merged by lead — see merge record at bottom.

Closes the launch-blockers + hardening items from audit reports 35 / 37 / 38.

## Per-fix status
| # | Fix | Source finding | Status |
|---|---|---|---|
| 1 | **Webhook SSRF + body-exfil (P0)** | #35 launch-blocker, task #58 | ✅ |
| 2 | **Floor plans → signed short-TTL URLs (P0)** | #37 F-1 (conditional blocker) | ✅ |
| 3 | **next → 16.2.6** | dep CVE | ✅ |
| 4 | **Impression CSRF-exempt + per-game rate limit** | #37 R-1 / R-2 | ✅ |
| 5 | **SVG out of Supabase bucket allowlist** | #37 U-1 | ✅ |
| 6 | **SSE revocation NODE_ENV gate** | #38 LOW-1 | ✅ |
| 7 | **Dev-fallback gating — sports-feed-token + clever** | P3 | ✅ |
| 8 | **Proxy error HTML-escape** | #35 minor | ✅ |
| 9 | **passport-saml CVSS-10 → `enabled` hard-gate STOPGAP** | #37/#38 | ✅ (full v5 migration deferred) |

## The load-bearing fix — webhook SSRF (#1)
- New `safeFetchPost()` in `branding/safe-fetch.ts:155` — POST with the same up-front `validatePublicUrl` + DNS-resolve + connect-time `ssrfSafeLookup` pin as `safeFetch` (rebind-proof), no redirect-follow, bounded body discard.
- `webhooks/webhook-dispatch.service.ts:189` `attemptDelivery` routes **every** send (first + all `WebhookRetryWorker` retries) through `safeFetchPost`. A URL whose DNS later flips to `169.254.169.254`/`10.x`/`::1` is refused at delivery time.
- Anti-exfil: `lastError`/`lastDeliveryError` now store generic `"HTTP <status>"` / `"destination refused (not publicly reachable)"` — never `res.text()` or the resolved private IP (`:222-244`).
- `webhooks/webhooks.service.ts:73` create-time validator extended to full `validatePublicUrl` private-range block, now runs in **all** envs (was prod-only string match).

## Floor-plan signed URLs (#2) — no migration
`supabase-storage.service.ts` gained `createSignedUrl(path, ttl)` + `pathFromObjectUrl()`. `floor-plans.controller.ts` `list`/`getOne`/`create` return a 15-min signed URL generated on read from the stored path; DB still holds the path-derived URL; upload untouched; falls back to stored URL if signing fails (page never blanks).

## Lockfile
`apps/web/package.json` `next` `16.2.3` → `^16.2.6`; `pnpm-lock.yaml` resolved `next@16.2.6` (confirmed). `@next/eslint-plugin-next`/`eslint-config-next` stayed 16.2.3 (devDeps, not vulnerable runtime).

## Proof the agent ran (re-verified by lead at merge)
- New `webhook-dispatch.ssrf.spec.ts` — real `safeFetchPost` rejects 7 internal-IP targets + bad scheme/port, asserts no IP/body leak.
- New `sse.controller.spec.ts` — revocation runs with `NODE_ENV=test`.
- Extended impression spec (per-game 80/10s, per-game isolation), CSRF spec (impression + cts-cue-fired exempt; CRUD still gated), SSO spec (3 enabled-gate tests).
- `jest` on touched/new specs: 6 suites / 58 tests pass (+ SSO 21).
- `rm tsconfig.build.tsbuildinfo && tsc --noEmit --project tsconfig.build.json`: clean.
- Web `tsc --noEmit`: clean (after building `@cms/scoreboard-cts` — stale `dist/`, unrelated).
- Rule #10 inset grep: clean (no player/widget styles touched).

## Deferred (flagged)
- **passport-saml v5 migration** (`@node-saml/passport-saml`, API-incompatible). Only the `config.enabled` hard-gate on the callback implemented, with `// SECURITY: migrate off vulnerable passport-saml@3 (CVE-2025-54419) before enabling SAML` at `sso.service.ts:214`. 0 SAML-enabled tenants → vulnerable verifier unreachable. Full migration = separate task.

## Pre-existing failures (NOT introduced — verified identical on clean base via git stash)
`sso.service.spec.ts upsertConfig` ×2 (`$transaction` not mocked), `realtime.gateway.spec.ts` ×1, `sports.service.spec.ts` ×1, + one pre-existing `tsc` strict-null in `sso.service.spec.ts:87` (excluded by build-project tsconfig).

## Greg's remaining action
Rotate `JWT_SECRET` / `SESSION_SECRET` on Railway (logs out all sessions) — operator action, not code.

---
## MERGE RECORD (lead, 2026-05-29)
Diff reviewed file-by-file (20 files, +740/-125). Verdict: high-quality, accept all 9 fixes. The SSRF fix correctly mirrors the proven `safeFetch` (up-front validate + DNS pre-resolve + connect-time `ssrfSafeLookup` rebind pin), no redirect-follow, bounded body discard, signature headers preserved, and stores only `HTTP <status>` so no internal body/IP leaks back to the operator UI. CSRF exemptions land *together* with the per-game throttle (R-1/R-2 not split). SAML `enabled` hard-gate is the correct interim control (0 enabled tenants → vulnerable verifier unreachable).

**Cherry-picked** `0c61090` → master `e9cd7a2`. **Verified locally before push:**
- Clean non-incremental API tsc (`rm tsbuildinfo && tsc --project tsconfig.build.json`): PASS
- Security specs (webhook-dispatch.ssrf, webhook-dispatch.service, sse.controller, sponsor-impression, csrf.middleware): 5 suites / 50 tests PASS
- `pnpm preflight` (lockfile frozen-check + 4 workspace builds + API build + web build 53/53 pages): EXIT 0
- Rule #10 inset grep: no player/widget styles touched

**Residuals noted (non-blocking follow-ups, NOT launch gates):**
1. Floor-plan objects still live in a PUBLIC bucket — signed-URL-on-read means the permanent public URL is never *transmitted* to clients (only a 15-min signed variant), but the underlying object is still readable IF its path is guessed. Full fix = private bucket migration. Adequate for launch; the leak vector (URL in history/referrer/cache) is closed.
2. `SponsorsController.impressionHits` Map never deletes dead game-id keys (arrays are pruned, keys aren't) — slow per-pod growth bounded by distinct games seen since boot × small array. Pods restart on deploy; single-pilot scale is tiny. Follow-up: periodic sweep or LRU cap.
3. Create-time webhook validator now blocks private IPs + non-80/443 ports in ALL envs → local webhook testing needs a public tunnel (ngrok). Correct security posture; minor DX note.

**Pushed to origin/master** — CI + Railway + Vercel verification pending (see chat for green confirmation).
