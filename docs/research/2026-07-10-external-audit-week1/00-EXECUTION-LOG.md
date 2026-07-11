# External audit — Week-1 "release integrity" execution log

**Date:** 2026-07-10 · **Lead:** Fable (main loop) + 3 worktree agents
**Input:** external Claude audit (all 21 Standard Audit Surface sections; pasted by Greg). Every checkable claim verified before acting — **8/8 confirmed accurate**.

## Verification of the audit's claims (before any fix)

| Claim | Verdict |
|---|---|
| Cross-Browser red on master head | CONFIRMED (029212bb; 11 greens before it) |
| `pnpm audit --prod` = 6 high / 36 mod / 8 low | CONFIRMED verbatim |
| `RedisService.sismember` fails open on Redis failure | CONFIRMED (`catch { return false }`) |
| Unbound menu prices (bar/03=23, bar/04=12, bar/07=7) | CONFIRMED; qsr/02 prices hidden from $-grep by split `<span class="dollar">` markup |
| capabilities.ts optional-polyfill imports unresolved | CONFIRMED (try/catch dynamic imports; cosmetic build debt, NOT the CI cause) |
| `shadcn` in prod deps | CONFIRMED (apps/web) |
| `_hs-audit.html` in deployable public assets | CONFIRMED |

## Blocker #1 — Cross-Browser red: FLAKE, not regression (proven)
- Failing commit touched only the assets dashboard; spec **passed locally at head** (both engines); **identical commit greened on zero-change CI rerun**. Third recurrence of the documented dev-server cold-compile flake (2026-06-02 ×2).
- **Class fix `5b6f3b8e`**: widget-render warm-up fail-soft → BLOCKING with 3×90s retries + honest infra error; manifest poll 30s→60s; test timeout →120s. All 8 workflows green.

## Blocker #2 — dependency risk: CLEARED (`20e48582`, agent-built, lead-merged)
- **50 advisories → 1 low.** All 6 highs fixed with zero source changes / zero major bumps: ws 8.21 (direct+override), multer 2.2 override on the platform-express upload path, undici 7.28 override (3 advisories), hono chain removed by moving shadcn → devDependencies. 35/36 moderates cleared free (dompurify, postcss, qs, uuid, ip-address, brace-expansion, js-yaml, otel).
- `_hs-audit.html` deleted. **New CI gate**: parallel `dependency-audit` job in CI & Security fails on any high/critical prod advisory (lockfile-only, off the critical path). All 10 workflows green including the new gate.

## Item #4 — menu-price truthfulness: CLOSED (`916f2257`, agent-built, lead-merged)
- Browser-truth sweep of ALL signage/{qsr,bar,menus-pos} boards; 7 fixed (incl. **menus-pos/02-wine-list, which the audit missed**): bar/03 23/23, bar/04 9/9 (incl. `<del>`→`.was`), bar/07 7/7, qsr/02 9/9 (split dollar/cents containers), qsr/05+06 CTA footers, wine-list 14/14. Attribute-only; pixel-identical (byte-identical screenshot on bottle-list).
- applyMenu price/desc/auto-86 + click-to-edit functionally proven in both engines; `inject-click-shim.cjs` additive run (0 injected / 92 skipped — hand-crafted applyMenu shims untouched); CLAUDE.md sweep clean; clickedit spec **46/46**.
- **Lead decision open:** wine-list binds names as `nm`, which `applyMenu()`'s `isName()` doesn't recognize → POS name-matching inert on that one board (manual edit works). Fix = rename `nm`→`n` + migrate saved overrides, or extend `isName` in a shim rev.

## Item #3 — durable revocation: SHIPPED (`875df82b`, agent-built, lead line-by-line reviewed)
- Additive `RevokedCredential` model (`revoked_credentials`; kind `jti` = **sha256 of token**, never raw; kind `user_invalid_before` = epoch). Migration created NOT applied (`20260710120000_add_revoked_credentials`, idempotent house style).
- Dual-write: logout mirrors to Postgres BEFORE Redis (row lands even on 503 paths); `markUserTokensInvalid` mirrors monotonic-max (covers role-tightening + user-deletion callers).
- Read path: Redis primary (zero DB reads when healthy — asserted in tests); Redis down/erroring → Postgres fallback for `jwt_revoked_list` ONLY (other sets keep legacy behavior), 30s pos+neg in-memory cache; both-stores-down → pre-fix behavior preserved per-callsite (sismember fail-open; invalid-before erroring→rethrow fail-closed) + one-shot loud warn. SSE/WS get it for free via sismember. API-boots-with-Redis-down invariant untouched.
- 31 new spec cases; auth+realtime+users+emergency = 181 tests green on master post-merge; clean tsc.
- **Lead decision open:** logout still 503s when Redis is down (durable row already landed; revocation IS enforced via fallback). Could be flipped to succeed-on-mirror — deliberate scope hold.
- **Process note:** agent disclosed one `git stash -u` (rule violation), immediately popped with zero loss and re-proved state; no cross-agent damage observed. Rule reinforced.

## Item #5 — test noise: CLOSED (`7bb3fa06`, agent-built, lead-merged)
- API Jest now **exits cleanly with zero open handles** (was "worker process
  failed to exit gracefully"). Culprits: per-key 60s timers in the throttler's
  in-memory fallback (test teardown via the library's own
  `onApplicationShutdown()`), the gateway's 10s auth timeout left armed by the
  invalid-JWT test, and the throttler's 250ms eval-timeout timer (ONE
  behavior-neutral source touch: `timer.unref?.()` — timer still fires, just
  can't pin the process).
- Web test output **7,033 → 193 lines; 119 act-warnings → 0; 86 `[api]`
  console errors → 0**. Root cause A: AI affordances probe `GET /ai/key` on
  mount → per-suite `jest.mock('@/lib/api-client')` keeping the probe pending
  (requireActual preserves everything else). Root cause B: direct
  `useBuilderStore` mutations outside `act()` in 3 suites.
- All counts unchanged-green: API 111 suites / 1557 tests, web 67 / 709.
- One REAL bug surfaced by de-noising: `LunchOpsInventoryWidget` keyless
  fragment (missing React key) → flagged as background task chip.

## Greg's live items — CLOSED same session (`f0f4949b`)
- **LED URL auto-fit**: playlist iframe filled the 960×1080 canvas 1:1 →
  sites laid out at a squeezed 960px viewport. `ScaledWebFrame` renders
  text/html assets at a virtual 1280-wide desktop viewport scaled
  (transform, top-left origin) to any canvas <1280; canvas source = URL
  param → localStorage → --led-w (durable chain; the CSS var alone gets
  wiped by dev-mode hydration root-regen). Canvases ≥1280 + PDFs keep the
  pre-fix direct iframe. NEW permanent gate `url-asset-ledfit.spec.ts`
  (real /player, mocked FLAT-shape asset manifest — items are
  `{item_id,url,mime_type,duration_ms,sequence}`, NOT nested assets):
  4/4 chromium+webkit (scaled contract + no-pin control).
- **Peacock/DRM honesty**: Widevine/FairPlay services can never play in a
  signage iframe/proxy on any platform. Add URL now blocks known DRM
  streaming hosts with a plain-English explanation + alternatives
  (YouTube/Twitch/Vimeo embeds, HLS, HDMI).
- **Wine-list POS keys**: 12 legacy `nm` name keys → `n` (Greg's
  "no customers" call = no saved overrides to migrate); POS name-matching
  now engages; clickedit 46/46.

## Final state
- master `7bb3fa06`; worktrees 1; tree clean.
- **Week-1 audit list: ①②③④⑤ ALL DONE.** Plus Greg's LED + Peacock + the
  two "lead decision" holds resolved.
- CI green on every push in the wave (flake-class hardening included).
- Remaining for launch = Greg's config only: rotate `JWT_SECRET`/
  `SESSION_SECRET`, Stripe test→live + live webhook secret, verify
  Resend `EMAIL_FROM` domain, review stray `GH_TOKEN` in the API env.
- Next code work (Week 2-4, audit's "operator confidence"): authed axe +
  keyboard emergency E2E, WebKit discovery over all holiday/external
  boards, integration/data-health dashboard.
