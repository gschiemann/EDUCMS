# Audit — §2 Storage/Egress · §3 AI Providers · §4 AI Surfaces · §5 AI Competitive

_Agent a14bdeaabbb0e2d53 · read-only, file:line-traced · 2026-05-30_

## Coverage (D/UX/F)
| Section | D | UX | F |
|---|---|---|---|
| §2 Storage/egress | B | B | C+ |
| §3 AI providers | A | B | A− |
| §4 AI surfaces | B | B | B |
| §5 AI competitive | N/A | N/A | C |

## §2 Storage / Egress

> **LIVE VERIFICATION 2026-05-31 (lead, curl against the live CDN) — supersedes the "no-cache" premise.**
> Curled two real objects from the `assets` bucket: the **oldest** (2026-04-17 `…/a4993d3f….png`) and a **recent** jpeg. Both now serve `cache-control: public, max-age=31536000[, immutable]`, and Supabase's CDN returns `cf-cache-status: HIT` on the 2nd fetch. The earlier "Supabase serves no-cache regardless of upload cacheControl" finding is **no longer reproducible** — Pro's Smart CDN + the upload-header fix (`supabase-storage.service.ts`) + the backfill resolved it. Browsers/kiosks now cache for a year (kills the 59× re-download multiplier that caused the 5.79 GB blowout). **The egress root cause is fixed at the source, verified live — not just in code.**
> Consequence for **P0-4 below:** downgraded. The player's raw Supabase URLs are ALREADY cacheable + CDN-cached, so the player does not bleed repeat-egress. The CDN-proxy wiring (now shipped, `05946ee`, images-only, inert until `NEXT_PUBLIC_ASSET_CDN` set) is belt-and-suspenders for cross-kiosk edge dedup, NOT urgent. Real remaining risk at scale = **large video** (no transcode + caches less effectively) — that's P1 below.

**Correct + in place:** image egress 3-layer (upload `cache-control: max-age=31536000` `supabase-storage.service.ts:224` + render/image transforms `asset-image.ts` wired into 9 dashboard surfaces + Vercel edge proxy `cdn/assets/[...path]/route.ts`); video `preload="none"` on all dashboard tiles; sharp image-optimization at ingest (`media-optimization.service.ts`, 1920px cap q85 EXIF-strip); real self-verifying backfill (`super-license.controller.ts:262`); SW two-tier cache (EMERGENCY never-evict 1GB floor + PLAYLIST LRU 5GB, range-aware `rangeResponseFromCached`, stable query-stripped keys).

**Findings:**
- **P0/P1 — player route bypasses the CDN proxy.** `player/page.tsx:4714-4715,5191-5192` use raw Supabase public URLs; `resolveAssetUrl`/`/cdn/assets` only wired into PropertiesPanel + AssetPicker (dashboard). The highest-traffic consumer (kiosk fleet) hits Supabase origin on each PoP cache-miss. (Per-kiosk loops are covered by the SW range cache; this is cross-kiosk first-load de-dup at scale.) Fix: `resolveAssetUrl(fileUrl)` at the player asset-resolution sites — once `NEXT_PUBLIC_ASSET_CDN` is set (helper no-ops until then).
- **P1 — video transcoding deferred.** `media-optimization.service.ts:41` "does NOT transcode video"; >50MB is a soft warning not a reject (`assets.controller.ts:780`). ffmpeg code exists (`:344`) but only via `optimize()`, not the upload path. Biggest remaining egress risk at scale. Fix: async ffmpeg queue.
- **P2 — Vercel edge cache for large video unverified** (matches lead's live test: 28MB video = MISS). P2 — `resolveAssetUrl` has zero call sites yet. P3 — backfill is SUPER_ADMIN one-shot, no nightly cron. P3 — USB sneakernet = bundler script only (`scripts/usb-bundler.ts`), no player-side mount/PIN/verify UI.

## §3 AI Providers — A− (excellent, near-complete)
Verified: test-on-save AND generate-time use the **SAME** `mapProviderQuotaError()` (3 providers, not forked); out-of-credit vs rate-limit disambiguation complete (OpenAI insufficient_quota / Anthropic 402+credit_balance / Google RESOURCE_EXHAUSTED); AuditLog on success+fail+clear for keys/generate/template/alt-text; AES-256-GCM envelope BYOK (`ai-key-cipher.ts`); Redis sliding-window hourly cap shared across all 3 surfaces (fail-open); `AbortSignal.timeout` on every AI fetch; model catalog refreshed 2026-05-30 (Sonnet 4.5 / gpt-5 / gemini-2.5); Anthropic ephemeral prompt-cache; Google key in `x-goog-api-key` header (not URL) + REDACTED in errors; temperature 0.7 parity (omitted for OpenAI reasoning models).
- **P1 — bug analyzer stale model:** `bug-analyzer.service.ts:74` `claude-3-5-sonnet-20241022` (Oct-2024) vs catalog Sonnet-4.5. One-line bump → cheaper+better.
- P2 — BYOK master-key rotation has no runbook (graceful "re-enter key" fallback exists). P2 — `OPENAI_API_KEY` (platform alt-text key) missing from CLAUDE.md env table.

## §4 AI Surfaces — B (all live, verified)
Sparkle button REAL (4 PropertiesPanel mount points, test proves no-call when source:none); touch-template REAL (`templates.controller.ts:845`, sanitized); alt-text REAL (3 providers, fire-and-forget on upload + per-asset regenerate); bug analyzer REAL.
- P2 — Google alt-text supported backend but not surfaced in UX. P3 — Integration Concierge is **regex-only, no LLM** — the AI-explanation vision (Concierge workstream 5) not built.

## §5 Competitive — VenueOS LEADS where it matters
**Advantages no competitor (Yodeck/OptiSigns/Rise/ScreenCloud/BrightSign) has:** AI copy-gen *in the live widget editor*, full-template-from-text, auto alt-text on upload, BYOK multi-provider, daypart-aware gen, bug AI-triage.
**Gaps (P2, OptiSigns is closest competitor):** AI background removal (OptiSigns ships it), CV asset auto-tagging (index alt-text as searchable tags), smart playlist suggestions (roadmap), AI theme-from-logo (currently heuristic not AI).

## Top items
- **P0/P1:** wire the player asset URLs through `resolveAssetUrl` (CDN proxy) — the high-traffic consumer is the one NOT using it.
- **P1:** async video transcode queue; bug-analyzer model bump.
- **P2:** AI background removal + CV tagging (competitive); document OPENAI_API_KEY + key-rotation runbook.
