# Overnight autonomous fix campaign — 2026-06-27 → 28

Greg: "finish all the fixing and all the beta testing, work all night, I'm going to sleep." Autonomous; the Mac display slept when he did, so on-glass camera verify is DEFERRED to morning (macOS screen-capture returns nil while the display sleeps). All code work + server-side verification continued.

## ⭐ KEYSTONE — why fixes never reached the LED (FIXED + server-confirmed)
`ddbc047c` `export const dynamic='force-dynamic'` on the player route. The `/player` HTML was statically prerendered → Vercel edge-cached it (live-observed `x-vercel-cache: HIT, age 21170` ≈ 6h stale) → kiosks always loaded an OLD bundle, so every emergency/AI fix shipped today was invisible on glass. Now `/player` = `x-vercel-cache: MISS, age 0` on every fetch (confirmed live). The deployed bundle already contained the fixes (grep'd the live chunks for the fix marker — present). Pairs with `8cca2b96` (kiosk cache-busting reload, 6h→12min). DURABLE LESSON: `Cache-Control: no-store` does NOT stop Vercel edge-caching a statically-prerendered route — use `force-dynamic` for always-fresh routes (esp. the kiosk player).

## MERGED + CI-green tonight
- `c5da4f1a` AI render i18n — CJK/Arabic Noto webfonts (injected once, Taurus-safe) + RTL-aware SignageText (auto dir from copy) + refine-never-drops-a-SET's-scenes guard (+prompt rule). 84 AI tests.
- `d84001e6` Mobile UX P1s — media-picker toolbar reachable, settings drawer on-screen, playlist-wizard selection count surfaced. CSS/layout only.
- `a0048255` Branding/SVG — preserve scraped VECTOR logos on adopt (don't rasterize); clarify SVG-upload UX (sanitized or honest message). 63 branding tests.
- (earlier tonight) emergency wave `ca7d0aa4`+`5f0a2adf`+`89c0c1c8` (scale-to-fit every emergency surface + opaque inline backdrop), AI-design `ce72f961` (surface-css depth), force-dynamic `ddbc047c`, kiosk-reload `8cca2b96`.

## HELD for Greg's review (do NOT merge unattended)
- **Lane 1 content-delivery** branch `worktree-wf_56f783bb-97c-1` (`708005f5`): schedule GROUP-supersession precedence (`schedule-precedence.ts`) + null-hash asset `cache_version` freshness token (`asset-cache-version.ts`, touches `sw-player.js` + emergency-assets precache + `player/page.tsx`). 96 tests pass, but it changes CORE content resolution for every screen + touches the player SW + emergency precache, and can't be glass-verified while the display sleeps. Review the diff + live-verify (publish a group schedule → reaches a member screen with a stale per-screen pin; re-upload a URL asset → screen refreshes) before merging. Also note its emergency-precache touch warrants the CLAUDE.md emergency review.
- **Excluded from unattended overnight (need Greg's call — auth/billing):** MFA legacy-account guard; Stripe webhook DLQ.

## Wave 2 in flight (`wlpc223a6`)
Address-picker US-street geocoding fix; emergency-broadcast SUCCESS-path E2E test; RESTAURANT vertical re-audit (the 1 of 12 that didn't return in the beta). Avoids the held-lane-1 files. Lead audits + merges clean diffs on return.

## Wave 2 RESULT (`wlpc223a6`) — 2 of 3 lanes returned, 1 merged
- **MERGED `945347d7`** — emergency-broadcast SUCCESS-path test (task #206). Pure additive spec, 296 lines. Re-ran in the real tree: **44/44 emergency tests pass**. Pushed, **CI GREEN** (Deploy Reliability exit 0).
- **HELD for Greg — geocoding/address-picker** branch `worktree-wf_ed49045e-b0a-1` (`980646f5`): the real fix for **MOBILE BUG 2 (#216)** — 3 root causes (signup geocode 401'd because the proxy was JWT-guarded → never used Google; Geocoding-API can't match partial as-you-type → added Places Autocomplete; no manual lat/lng escape hatch). tsc clean + 5 unit tests. **Held because it (a) removes `@UseGuards(JwtAuthGuard)` from the `search` route — an AUTH-guard change — and (b) raises metered Google spend** (Places = up to 6 calls/keystroke-search). Both well-mitigated (20/min per-IP throttle, OSM fallback, mirrors the existing public signup endpoint) but both are exactly what Greg wants to sign off himself. One-command merge tomorrow: `git cherry-pick 980646f5`.
- **RESTAURANT re-audit — finding was a FALSE POSITIVE (verified).** The haiku Explore agent claimed RESTAURANT_* widgets fall back to EXTERNAL_HTML costumes. Verified against code: they are real React widgets rendered by `WidgetRenderer.tsx:632-635`, registered + vertical-filtered in `VariantPicker.tsx` (`verticalForWidgetType`), with PropertiesPanel editing. RESTAURANT is in the STRONG group (consistent with QSR). **The genuine "costume" verticals are only WORSHIP / HEALTHCARE / HOSPITALITY / CORPORATE** — each maps to a single EXTERNAL_HTML widget type (no per-widget React pack). RETAIL / GYM(FITNESS_*) / BAR / SPORTS all have real packs. This is the verify-before-build rule paying off — avoided a wasted build wave.

## Wave 3 plan (safe, non-conflicting, non-auth/billing, non-design-batch)
From 02-DEEPWAVE2 Lane 3, filtered to what's safe to do unattended (held-lane-1 files AVOIDED: screens.controller, sw-player.js, player/page.tsx, offline-cache.ts):
- **L-A (test):** schedule-publish controller integration test (publish → manifest reflects) + group-supersession member-pin-deactivation unit test (line 51-53/57-59 — "comment says fixed, no test proves it"). TEST FILES ONLY → no held-lane conflict; also de-risks held lane 1 review.
- **L-B (SVG, security boundary → HOLD):** wire `AssetSanitizerService` (exists, zero callers) into the asset upload path + re-enable SVG with strict scrub + thorough security tests → the Domino's vector-logo fix (#223). Ship the honest-UX interim message now; HOLD the sanitizer-enable for review (stored-XSS attack surface — never auto-merge unattended).
- **L-C (mobile verify+fix):** confirm tonight's `d84001e6` actually fixed #215 (media-picker toolbar) and #217 (settings drawer off left edge); fix any residual. Mobile CSS only.

## OWED at morning
1. On-glass emergency verify (display was asleep) — trigger device-scoped lockdown on the 960×1080 LED, confirm full + readable + opaque; the kiosk should already be on the fixed bundle via the dynamic /player + cache-bust reload.
2. Review/merge held lane 1 (content-delivery) after live verify.
3. Review/merge held geocoding (#216) — auth-guard relaxation + metered-cost, your call.
4. Greg-decisions: MFA legacy guard, Stripe DLQ.
5. Remaining 00-BETA-FINDINGS per-vertical depth — the 4 genuine costume verticals (WORSHIP/HEALTHCARE/HOSPITALITY/CORPORATE) need real per-widget React packs, which is DESIGN work requiring your approval loop (no batching) — queued, not done unattended.
