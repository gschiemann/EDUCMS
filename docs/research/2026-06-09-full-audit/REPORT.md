# VenueOS Full Audit — 2026-06-09

**Method:** 4 parallel read-only agents (API security, web frontend, player/packages reliability, CI/tests/hygiene) + independent spot-verification of every Critical/High claim against code. Cross-checked against your own audit history (2026-05-28 Opus 4.8 synthesis, SECURITY_GAPS.md, 2026-06-08 launch-readiness, 2026-06-09 RBAC reviewer) so this report doesn't re-litigate what's already tracked.

**One-paragraph verdict:** The engineering spine is world-class already — tenant isolation is complete with no IDOR found, JWT revocation fails closed, the emergency HMAC chain is real, both 2026-05-28 life-safety P0s (emergency media caching, kiosk alert delivery over SSE/poll) are verifiably FIXED, and the SECURITY_GAPS register is honest (every "not a gap" claim traced true). What separates you from world-class today is not code — it's four operational/config blockers (secrets, Stripe mode, pilot creds), an inverted test pyramid with no coverage gate, one 6,000-line god-component, and repo hygiene that undercuts the professionalism of everything else.

---

## P0 — Do before any new customer touches prod (config, not code)

These four are from your own 2026-06-08 launch-readiness audit; I re-verified what I could and they remain open.

1. **Rotate the credentials that lived in `.codex/config.toml`.** The file is now gitignored (verified: `git check-ignore` passes for both `.codex/config.toml` and `AGENTS.md`), but ignoring ≠ rotating. If the Supabase service-role JWT, DB password, Railway token, and GitHub PAT haven't been rotated since 06-08, do it now. ~30 min.
2. **Regenerate `JWT_SECRET` / `SESSION_SECRET`.** The `super_secure_beta_..._2026_xYz` pattern is guessable; a forged JWT is cross-tenant account takeover. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` ×2, set on Railway. Note this invalidates all sessions — fine, do it pre-launch.
3. **Stripe is still in test mode.** Real cards fail on Upgrade. Run the go-live test-card pass (verify the webhook upserts License → ACTIVE), then swap to live keys + live webhook secret.
4. **Pilot credentials are printed in a public-repo doc.** Verified live: `docs/CUSTOMER_PILOT_GUIDE.md:13-14,42-43,165` — `chuck@/larry@agceducation.com` / `12345678`, and these accounts can trigger emergencies. Rotate the passwords, redact the doc, and reconsider whether the pilot guide belongs in a public repo at all (ties into G4: repo-public decision).

---

## What I verified is genuinely solid (so you don't re-spend effort here)

- **Tenant isolation:** ~10 controllers sampled (assets, templates, playlists, sponsors, devices, branding, billing) — every Prisma query scoped by `tenantId` from the authenticated principal. **No IDOR found.**
- **Prior P0s fixed and traced:** P0-1 emergency media caching (`screens.controller.ts:3447-3467` ships real `fileHash`, `sw-player.js:509-529` honors `sha256:null`); P0-2 kiosk alert delivery (device-JWT `GET /emergency/messages` at `emergency.controller.ts:1282-1333`, EmergencyOverlay polls with bearer token, per-screen overrides persisted); P0-3 themed-widget editability (17 widgets now have array/image field editors); P0-8 `inset-[4%]` Taurus regression; P1-9 emergency console aria-live + focus trap. Also fixed since: device-auth on `/emergency-assets`, `/cache-status`, `/render-proof`; SW cache atomicity across upgrades; Range-request support for offline video.
- **Security plumbing:** JWT revocation fail-closed in every env; AuditLog immutability triggers; login/logout audit rows; SSRF defense with DNS-rebind pin; Argon2id; TOTP MFA with encrypted secrets; CSRF double-submit; CORS fail-closed; SVG blocked at upload and bucket; constant-time compares throughout.
- **Reliability engineering:** full-jitter exponential backoff on reconnect (no thundering herd); 30s freshness window + eventId replay dedup + clock-skew offset on the player; SW only commits set-hash after all assets verify.
- **CI:** gitleaks (blocking), taurus-safety ratchet, a11y baseline gate, lockfile-drift check, unit tests blocking since 05-29 (612 tests green).
- **G8 (player-side signature presence check):** confirmed acceptable as designed — the server-side HMAC gate at the Redis fan-out is the real control.

**Correction to a sub-agent claim:** "missing index on `ScreenEmergencyOverride.screenId`" is **false** — `screenId` is `@unique` (schema.prisma:~1444), which creates an index. `Screen.screenGroupId` is also indexed. No emergency-path index emergency.

---

## HIGH — real risk or high leverage, this sprint

**Security**

- **H1. Panic-capability staleness (your P1-1, still open).** Revoking `canTriggerPanic` doesn't revoke the user's existing tokens; the claim stays live up to 30 days (`rbac.guard.ts:69-74`, `jwt-auth.guard.ts:113-118`). Wire the user-update path that flips this flag to the existing per-user invalid-before epoch. Related: revocation is a silent no-op on Redis-less deploys — at minimum WARN at boot when `REDIS_URL` is unset.
- **H2. Input validation is selective, not mandatory.** The global `SanitizationPipe` (app.module.ts:220) sanitizes HTML but doesn't structurally validate; Zod schemas exist only on some endpoints. Make schema validation mandatory on every POST/PUT/PATCH (decorator or global strategy) to close mass-assignment surface.
- **H3. Guard hardening, two small holes:** (a) `jwt-auth.guard.ts:140-156` never asserts `tenantId` is non-empty after decode — add a throw; (b) `ApiKeysService` is `@Optional()` in the guard (jwt-auth.guard.ts:23) — a module load failure would silently disable API-key verification; make it required in prod.
- **H4. Open-redirect on Clever callback.** `clever.controller.ts:81` redirects to `process.env.CLEVER_POST_CONNECT_URL ?? '/'` unvalidated. Enforce relative-path-only.
- **H5. Fail-open limits:** AI hourly cap returns 0-enforcement when Redis is down (`ai-hourly-cap.ts:60-76`); sponsor impression limiter is in-process memory (`sponsors.controller.ts:65-67`). Both fine on one replica — but they're security boundaries the moment you scale. Move to Redis / fail-closed before adding a second replica (matches your G5).
- **H6. Device JWT in plain localStorage** on the player. Acceptable trade-off for a kiosk (no user data on device), but document it as an accepted risk in SECURITY_GAPS.md so a district reviewer hears it from you first.

**Quality / CI**

- **H7. Inverted test pyramid, no coverage gate.** 64 spec files for 218 API source files (~29% by file count); services layer mostly untested at unit level; security e2e covers only SVG-XSS + WS-replay (no IDOR/SSRF/authz suites despite those being your crown jewels). Add `--coverage` with a 60% line threshold to ci.yml and ratchet monthly; add a small authz/IDOR regression suite.
- **H8. Missing CI gates:** no dedicated `tsc --noEmit`, no `pnpm audit` gate, Trivy is `continue-on-error: true`. Each is a 30-minute fix. Also taurus-safety doesn't scan `public/templates/**` — 117 boards unscanned while new K-12 boards ship `color-mix()`/`aspect-ratio` with no Chromium-83 fallback (your P1-6; this is how the next field regression ships).
- **H9. PropertiesPanel.tsx is 6,000+ lines.** The single biggest maintainability risk in the codebase — every widget-editing bug funnels through it. Extract per-widget-type editor modules behind a registry; do it incrementally (one widget family per PR).
- **H10. Migration-ordering bug on audit triggers (your P1-1 from 06-08).** Duplicate immutability triggers from 05-26 and 05-31 coexist and block user deletion with a 500. One migration to drop the older pair; verify `pg_trigger` shows exactly one set.

---

## MEDIUM

- **M1. Repo hygiene — tracked junk.** Verified tracked: `diff.txt` (104 KB), `git_stat.txt` (378 KB), four empty `_tmp_*` files, 4 root `.bat` scripts, 5 ad-hoc `check*/test-*.mjs` harnesses, `sunny-meadow-preview.html`, `lockdown-alert-*.png`, root `.DS_Store`, 4 `AUDIT_*.txt`/`MORNING_SUMMARY` dumps, and **94 files under `scratch/`** despite the ignore rule. One cleanup commit: `git rm --cached` the lot, move audit dumps into `docs/research/`, move `.bat` to `scripts/windows/`. (`.claude/worktrees/` is NOT tracked — local bloat only, ~46 MB you can delete.)
- **M2. Docs sprawl: 40+ root .md files,** several carrying their own "stale" banners (LAUNCH_STATUS.md). World-class repos have one README → ARCHITECTURE map. Archive stale specs under `docs/archive/`, keep the living set (SECURITY_BASELINE, SECURITY_GAPS, THREAT_MODEL, CLAUDE.md) discoverable from README.
- **M3. dompurify 3.3.3** carries 5 moderate XSS-bypass advisories in a prod sanitizer path (low reachability). Bump ≥3.4.0.
- **M4. SanitizationPipe over-sanitizes** every string in every body (`security/sanitization.pipe.ts`) — can corrupt structured payloads and costs latency. Target user-facing fields only.
- **M5. Frontend robustness:** silent error-swallowing in several fetch chains (webhooks, help requests); no dynamic imports for 50+ widgets (bundle bloat — lazy-load heavy renderers like hls.js/shaka where not already); ~50 files with `: any`. Add an eslint budget for `any` and a `no-restricted-syntax` guard requiring sanitization next to `dangerouslySetInnerHTML` (30 call sites today, all currently sanitized — keep it that way mechanically).
- **M6. Dockerfile lacks a `HEALTHCHECK`** (Railway covers it today; portability gap if you ever leave Railway). Compose/railway secrets are clean.
- **M7. Cold-start UX (your P1-4):** new tenants land on an all-zero dashboard; `seedForNewTenant` is also fire-and-forget (`void`) — `await` it and seed one demo Screen + starter Playlist per vertical.
- **M8. Data retention (your P1-7):** `playback_samples`, `sponsor_impressions`, `ad_impressions`, `touch_events` grow unbounded; `ad_revenue_daily` rollup missing so ad dashboards read empty. One nightly worker covers both.
- **M9. CTS parser:** `parseInt` without finite/range checks (`scoreboard-cts/src/parser.ts:95,133,503`). Trusted input, but NaN propagation is a cheap fix.
- **M10. RBAC review loop (06-09 audit) is effectively dead** — Submit-for-Review only exists for playlists, Viewer 403s on content, Editor can't create playlists. Phase-1 plan in `docs/research/2026-06-09-rbac-reviewer/` is right; execute it.

## LOW

- Pin `"engines": {"node": ">=20"}` in root package.json; add `.editorconfig`; add lint-staged to pre-commit (lint currently CI-only); Express 4.18.2 → 4.22.x at root; delete stale local branch `fix/deep-widget-...`; centralize pagination validation; tighten CSP `frameSrc` from blanket `https:` to known origins; separate "code version" vs "cache-bust counter" in sw-player.js comments; CLEVER post-connect URL doc; `PILOT_SEAT_LIMIT` flip + one real License upsert to prove the write path; Integration Concierge backend has zero frontend callers (dark feature — ship the UI or remove).

---

## The path to world-class (opinionated, in order)

1. **Week 0 (hours):** the four P0 config items. Nothing else matters until a stolen `.codex` credential can't burn you and Stripe takes real money.
2. **Week 1:** H1 panic-revocation + H10 trigger migration (life-safety + data-integrity), H8 CI gates (each ~30 min), M1 hygiene commit (one hour, instantly more professional to any district IT reviewer who clones the public repo — and they will, it's public).
3. **Weeks 2–3:** H2 mandatory Zod validation, H7 coverage gate + authz regression suite, start the PropertiesPanel decomposition.
4. **Before scaling past one replica:** H5 Redis counters — treat as a hard precondition, it's a security boundary.
5. **Strategic, from your own 05-28 synthesis (still the truth):** breadth honesty — the gap between ~30 clickable providers and ~3 wired end-to-end is the biggest credibility risk with real customers. Either build the top-3 requested (Clover sync first — it's marked ready and silently doesn't sync, the worst kind), or relabel tiles honestly the way you already did with DIRECT/PARTNER/BRIDGE/CLOSED. Your gap-register discipline ("a control is either SHIPPED with a file:line cite or a GAP") is genuinely rare — extend that exact standard from security to the integration catalog and the product is world-class in honesty as well as engineering.

*Standard caveat: spot-verified Critical/High items against code; Medium/Low items carry agent-reported cites — re-verify file:line before large refactors.*
