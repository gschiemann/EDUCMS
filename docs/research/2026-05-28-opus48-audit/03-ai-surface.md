# AI SURFACE AUDIT — VenueOS (Sections 3, 4, 5 + Integration Concierge)

> Opus 4.8 full-app audit, 2026-05-28. Read-only agent. Owns §3 (AI providers ×
> entry points), §4 (AI feature surfaces), §5 (competitive scan) + AI Integration
> Concierge + 3-tier economic model.

**Verification method:** traced every actual call site (`dispatchAi`,
`generateImageAltText`, `mapProviderQuotaError`, `discoverFromUrl`), grepped
mount sites per CLAUDE.md rule #9, read all 6 provider `fetch()` call sites,
confirmed schema fields back the usage counters.

---

## PAGE 1 — COVERAGE TABLE (D / UX / F)

| § | Surface | Design | UX | Functionality | Status |
|---|---|---|---|---|---|
| **3** | Anthropic provider (text gen) | A | A | A | covered |
| 3 | OpenAI provider (text gen) | A | A | B+ | covered |
| 3 | Google provider (text gen) | A | A | B+ | covered |
| 3 | Test-on-save error mapping (all 3) | A | A | A | covered |
| 3 | Generate-time error mapping (all 3) | A | A | A− | covered (shared helper) |
| 3 | Out-of-credit vs rate-limit disambig | A | A | A− | covered |
| 3 | AuditLog on success + failed key test | A | — | A | covered |
| 3 | BYOK encryption / rotation / revocation | A | A | A | covered |
| 3 | Platform free-tier accounting | B | A | **C (multi-replica unsafe)** | covered, gap |
| 3 | Model catalog freshness | B | B | B | covered, stale |
| 3 | AbortSignal on every fetch (6/6) | A | — | A | covered |
| 3 | Prompt caching | B | — | C (1 of 6 sites) | partial |
| 3 | Temperature parity | C | — | **C (only Google sets it)** | gap |
| **4** | Sparkle button (4 mounts, verified) | A | A | A | built |
| 4 | Touch-template full synthesis | A | B+ | A | built |
| 4 | AI alt-text (upload + manual regen) | A | A | B+ | built |
| 4 | AI-from-CMS-data (POS menu copy) | — | — | — | **N-A (not built)** |
| 4 | AI image gen / bg removal | — | — | — | N-A |
| 4 | AI translation (multilingual) | — | — | — | N-A |
| 4 | TTS emergency announcements | — | — | — | N-A (V2) |
| 4 | Auto-celebration via score-feed | — | — | — | **costume risk (Sprint 13 AUTO referenced, not built)** |
| 4 | AI summarization / anomaly / voice-to-text | — | — | — | N-A |
| 4 | Bug-analyzer (6th AI surface, undocumented) | B | B | B | built, SUPER-only |
| **5** | Competitive AI scan | — | — | — | see gap list |
| Concierge | `/integrations/discover` + `/describe` | B | B | **B (regex only, no AI, no audit)** | partial |
| Concierge | AI explainer / diagnostic / build-it-for-me | — | — | — | **N-A (Tier-1 vision unbuilt)** |
| Economic | Tier-1 budget never spent on Tier-2 | A | — | A | **PASS (verified)** |

---

## PER-PROVIDER ERROR-MAPPING MATRIX

`apps/api/src/ai/ai-providers.ts:452` `mapProviderQuotaError()` is the single
source of truth, called from BOTH `ai-key.controller.ts:217` (test-on-save) AND
`ai.service.ts:460,711` (generate-time + touch-template). **This is correct per
§3 ("same disambiguation, must NOT be separate code").** Matrix for the
*text-gen path*:

| Signature | Anthropic | OpenAI | Google |
|---|---|---|---|
| Out-of-credit | 402 OR 400+`credit_balance_too_low` ✅ | 429+`insufficient_quota` ✅ | 429+`RESOURCE_EXHAUSTED` ✅ |
| Rate-limit (→ null → generic msg) | (any other 429) ✅ | 429 w/o insufficient_quota ✅ | (Google can't distinguish; documented) ✅ |
| 401 invalid key (BYOK) | ✅ `ai.service.ts:477` | ✅ | ✅ |
| 403 model-no-access | ✅ test-save only | ✅ | ✅ |
| 404 model-not-found | ✅ test-save only | ✅ | ✅ |
| Key kept out of logged error body | ✅ header | ✅ header | ✅ header + regex redact `key=` (`ai-providers.ts:402`) |

**The text-gen path is genuinely solid — this passed.** The gap is in the SECOND
quota path:

| Surface | Helper used | Anthropic 429 | Google | Verdict |
|---|---|---|---|---|
| Text-gen / touch | `mapProviderQuotaError` (shared) | ✅ | ✅ | correct |
| **Alt-text** (`ai-alt-text.service.ts`) | **own duplicate logic** (`AiAltTextQuotaError`) | **❌ not handled** (only 402/400 — `:494`) | **❌ no Google vision** | **VIOLATES single-source rule** |

The alt-text service reimplements quota detection (grep: `mapProviderQuotaError`
count = **0** in that file) with narrower coverage. An Anthropic vision call that
429s out-of-credit throws a generic `Error("Anthropic 429…")` → swallowed → logs
`AI_ALT_TEXT_FAILED` with no quota signal → operator gets nothing. This is the
exact "check ALL THREE providers when you find one's gap" finding.

---

## COSTUME LIST (real-button costume / referenced-but-not-built)

1. **Integration Concierge "AI as explainer" (Tier-1)** — CLAUDE.md vision item
   #5/#6/#7 ("hover an integration → AI 1-sentence explanation," "diagnostic
   concierge explains the RED cause," "build-it-for-me"). **None exist.**
   `discover`/`describe` are regex/cheerio only. The "AI Integration Concierge"
   name promises AI; the implementation has zero AI. Not a security risk (no
   Tier-1 spend), but the marquee vision is unbuilt.
2. **Auto-celebration via crowd-audio / score-delta (Sprint 13 AUTO)** —
   referenced in §4 and the Sport Engine spec; no code. Pure spec.
3. **`connectHref: null` providers in discovery** (Toast, Clover, Lightspeed,
   Shopify, OpenTable, Resy, YouTube, Twitch, NFHS, Eventbrite, Mailchimp,
   Instagram, MaxPreps, Mindbody — 14 of ~20). The Concierge will surface "we
   found Toast on your site → **Connect**" but the button goes nowhere
   (`null`). Only Square, SomaFM, Google/MS SSO, Clever have real `connectHref`.
   Operator-facing costume: the discovery is real, the *connect* is mostly vapor.
4. **Google alt-text vision** — `ai-alt-text.service.ts:127` explicitly "Gemini
   wiring is deferred." A Google-BYOK tenant gets zero alt-text (silently falls
   to platform key or skips). Honest in code comments, invisible to operator.

---

## COMPETITIVE-GAP LIST (§5) — what leaders ship that VenueOS does NOT

| Gap | Competitor(s) | Severity |
|---|---|---|
| **AI image generation** (text→image for signage backgrounds) | OptiSigns (DALL·E), Canva Magic Media | **HIGH** — table stakes for "design a poster" in modern signage |
| **AI translation / multilingual auto-render** | ScreenCloud, OptiSigns | **HIGH** — K-12 + emergency = ESL families; V2 spec calls for multilingual emergency templates but no AI translation exists |
| **Smart playlist / scheduling suggestions** ("for a Tuesday lunch crowd") | OptiSigns AI, Yodeck (emerging) | MED |
| **CV asset auto-tagging on upload** | ScreenCloud, OptiSigns | MED — alt-text exists (vision), but no searchable tag extraction |
| **AI-suggested template themes from logo colors** | Canva, OptiSigns | MED — branding scraper extracts palette but doesn't AI-theme templates |
| **Background removal** | Canva, OptiSigns | MED |
| **Canva Magic Write parity in-field** | Canva | **LOW** — VenueOS sparkle button MATCHES this for the 4 wired intents; arguably ahead (live widget copy vs static design text) |
| **AI bg-music / voice-over generation** | emerging | LOW |

**Net competitive position:** the sparkle button + touch-template generator put
VenueOS *ahead* of Yodeck/Rise/BrightSign (zero AI) and at parity with
OptiSigns/ScreenCloud on *copy* generation. It is *behind* on AI **image** gen
and **translation** — the two highest-severity gaps.

---

## TOP 10 RANKED FIXES

**1. [HIGH/security] Concierge writes NO AuditLog — violates its own CLAUDE.md security spec.**
`apps/api/src/integrations/integrations.controller.ts:80-106` +
`discovery.service.ts:399` perform an outbound SSRF-capable `safeFetch` with zero
audit trail. CLAUDE.md Concierge spec: *"All scrape requests logged to AuditLog
with tenantId + userId + URL + outcome."* The Clever sub-module audits
(`clever.service.ts:162`); discover/describe do not. **Verify:** add audit, then
`grep "INTEGRATION_DISCOVER"` in AuditLog after a `POST /integrations/discover`.

**2. [HIGH/functionality] Alt-text quota detection duplicates instead of reusing `mapProviderQuotaError`, with broken coverage.**
`apps/api/src/ai/ai-alt-text.service.ts:494` handles Anthropic 402/400 but NOT
429; OpenAI handles 429 (`:438`); Google not handled at all. CLAUDE.md §3:
*"generate-time error mapping (same disambiguation, NOT separate code)."*
**Fix:** route alt-text non-2xx through the shared `mapProviderQuotaError`.
**Verify:** unit test feeding Anthropic 429 body → expect `AI_PROVIDER_OUT_OF_CREDIT`.

**3. [MED/functionality] Platform free-tier counter is multi-replica unsafe — Railway runs >1 dyno under load.**
`apps/api/src/ai/ai.service.ts:233-253` `bumpPlatformUsage` is a read-then-write
with documented race windows (W3 comment `:216`). The in-memory hourly cap
(`recentByTenant`, `:108`) and failure cap (`:120`) are explicitly process-local
— *useless across replicas*. CLAUDE.md §3 demands "multi-replica safe." The cost
ceiling argument holds for the monthly cap, but the **hourly 30/tenant cap is
trivially bypassed by N replicas → N×30**. **Fix:** move both caps to Redis.
**Verify:** railway replica count; if >1, the cap is fiction.

**4. [MED/functionality] Temperature parity broken across providers.**
`apps/api/src/ai/ai-providers.ts:390` — only Google sets `temperature: 0.7`.
Anthropic (`:319`) and OpenAI (`:344`) send no temperature → provider default
**1.0**. Same "Standard" tier = more random copy on Claude/GPT than Gemini.
**Fix:** add `temperature: 0.7` to all three branches. **Verify:** read the 3
request bodies post-fix.

**5. [MED/UX] Discovery surfaces "Connect" CTAs that go nowhere for 14 of ~20 providers.**
`apps/api/src/integrations/discovery.service.ts:92-354` — most
`connectHref: null`. **Fix:** render null-href candidates as "Detected
(integration coming soon)" not a Connect button. **Verify:** load Concierge
wizard against a Toast site, confirm no live Connect button.

**6. [MED/competitive] No AI image generation.** Highest-severity competitive gap
(OptiSigns/Canva ship it). **Fix:** new `POST /ai/generate-image` reusing BYOK
resolution (DALL·E 3 / Imagen 3 / SD). **Verify:** N-A until built.

**7. [MED/competitive] No AI translation despite V2 multilingual-emergency spec.**
Emergency templates are life-safety + ESL-critical; no translation path.
**Fix:** `POST /ai/translate` through the same dispatcher. **Verify:** N-A.

**8. [LOW/freshness] Model catalog is ~7–19 months stale.**
`apps/api/src/ai/ai-providers.ts:142-227` — Claude 3.5 Haiku/Sonnet (Oct 2024),
Opus 4 (May 2025). Stale-by-policy ("confirmed-working IDs only, one-file edit"),
not a bug, but Premium tier is materially behind. **Fix:** bump to confirmed-
current IDs. **Verify:** test-on-save each new ID against a live key (non-404).

**9. [LOW/cost] Prompt caching used in only 1 of 6 provider call sites.**
Only `bug-analyzer.service.ts:620` sets Anthropic `cache_control: ephemeral`.
**Fix:** add `cache_control` to the Anthropic branch of `dispatchAi`. **Verify:**
check `usage.cache_read_input_tokens` in response.

**10. [LOW/forensic] Bug-analyzer (6th AI surface) has no quota disambiguation + is undocumented in §3.**
`apps/api/src/bugs/bug-analyzer.service.ts:638` throws raw `Anthropic ${status}`.
Low priority (internal tool) but should route through the shared helper + be
added to the Standard Audit Surface enumeration.

---

## KEY VERDICTS

- **Economic model Tier-1/Tier-2 boundary: PASS.** Verified zero
  `dispatchAi`/provider calls in `apps/api/src/integrations/`. Tier-1 platform
  budget is never spent on Tier-2 actions — *because the Concierge does no AI at
  all yet*. The platform free-tier counter correctly gates ONLY
  `resolved.source === 'platform'` (`ai.service.ts:409,530`); BYOK bypasses
  cleanly. The sparkle button refuses platform fallback for none-configured
  tenants and shows "Configure your AI provider" (`AiGenerateButton.tsx:135`).
- **Sparkle button mounting: VERIFIED LIVE** (rule #9). 4 instances in
  `PropertiesPanel.tsx` (1657/1743/1961/3951) → `BuilderShell.tsx:631`. Not dead
  code. **But** only 3 intents wired (announcement ×2, ticker, quote) —
  `menu_item`, `promo`, `daypart` system prompts exist server-side with no
  PropertiesPanel mount, so restaurant/retail verticals can't reach them from
  the builder (minor §19 editability gap).
- **Strongest area:** the 3-provider text-gen error mapping + BYOK encryption
  (`ai-key-cipher.ts` envelope AES-256-GCM) + failed-key-test audit logging.
- **Weakest area:** Concierge "AI" is a misnomer (regex, no AI, no audit), and
  the alt-text service forked the quota logic instead of reusing the shared helper.
