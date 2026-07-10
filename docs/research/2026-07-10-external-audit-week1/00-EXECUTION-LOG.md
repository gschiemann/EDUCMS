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

## State after the wave
- master `875df82b`; worktrees back to 1; tree clean; final CI watch running.
- **Week-1 audit list: ①②③④ done · ⑤ test-noise queued.**
- Next in queue: Greg's LED URL-fit on the 960×1080 daisy-chain + Peacock DRM honesty (was mid-diagnosis when the audit arrived), then Week 2-4 items (authed axe + keyboard emergency E2E, WebKit discovery over all boards, integration/data-health dashboard).
