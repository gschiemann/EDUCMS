# AI Audit — BYOK + Multi-Provider (§3) + Comparative Scan (§5)

> Opus 4.8 read-only, 2026-05-29. Traced to real callers. Corroborates report 31.

## Verdict
Lead's fear ("we claim AI all over but nothing works") is **mostly WRONG for the core generate
path, mostly RIGHT for the Concierge.** Sparkle + touch-template + alt-text + BYOK are genuinely
WIRED, not costumes. The "AI Integration Concierge" IS the costume.

## 1. BYOK — WIRED ✅ (a tenant CAN make AI work today by pasting their own key)
- Settings UI real: `AiProviderRow` on `settings/page.tsx:234` → `/settings/ai` → `AiKeyCard` POSTs `/ai/key` `{provider,apiKey,model}` (`AiKeyCard.tsx:126`).
- Save real + encrypts: `AiKeyController.setKey` (`ai-key.controller.ts:166-284`) validates → fires a real `dispatchAi` test → seals via AES-256-GCM envelope (per-row data key wrapped by `DEVICE_SECRET_KEY`, `ai-key-cipher.ts:46-78`) → persists `tenants.ai_key_encrypted`. Key never returned (masked only).
- **Saved key actually USED:** `resolveProviderKey` (`ai.service.ts:317-358`) checks tenant `aiKeyEncrypted` FIRST → decrypt → `{source:'tenant'}` → into `dispatchAi` (`:477`). Confirmed for text-gen, touch-template (`:727`), alt-text (`ai-alt-text.service.ts:164`). Decrypt failure falls through to platform (no crash).
- Rotation/revocation: DELETE `/ai/key` nulls + audits (`:290-314`). Schema present (`schema.prisma:147-160`).
- Sparkle mounted on the REAL render path: `PropertiesPanel.tsx:1655,1741,1959,3984` → POST `/ai/generate` (`AiGenerateButton.tsx:280`).
- **UX caveat:** `getAiStatusSource()` **fails OPEN → 'platform'** when `/ai/key` status is unreachable (`AiGenerateButton.tsx:91-94`) → sparkle CAN render for a no-key tenant → click → 503 toast. (vs hides when the status call succeeds with source:'none'.) Minor UX, not security.

## 2. Per-provider — ALL THREE REAL ✅ (raw fetch, no SDK = correct)
| Provider | Real? | Endpoint | Test-key real? | file:line |
|---|---|---|---|---|
| Anthropic | ✅ | `/v1/messages`, `anthropic-version:2023-06-01`, `content[0].text` | ✅ `max_tokens:10` | `ai-providers.ts:311-333` |
| OpenAI | ✅ | `/v1/chat/completions`, Bearer, `choices[0].message.content` | ✅ | `:335-360` |
| Google | ✅ | `:generateContent`, `x-goog-api-key` (key off-URL), `candidates[0].content.parts` | ✅ | `:362-412` |
Test-on-save = one shared `dispatchAi` with the CHOSEN model (catches model-permission 403 at save). 

**Parity gaps (minor):** Temperature BROKEN — Google sets `0.7` (`:390`), Anthropic (`:325`) + OpenAI (`:344`) set NONE (default ~1.0) → contradicts §3 "temperature parity". Alt-text only supports OpenAI+Anthropic, NOT Google (`ai-alt-text.service.ts:17-19`) → Google-BYOK tenant gets no alt-text.

## 3. Quota / model / timeout
- AbortSignal on EVERY fetch (15s gen, 5s alt-text). ✅
- Hourly cap 30/hr + failure 200/hr = Redis sorted-set sliding window (multi-replica safe, P1-14), fails open. ✅
- Monthly platform cap 200/mo (`AI_FREE_TIER_CAP`) durable in Postgres; BYOK bypasses. ✅
- Out-of-credit vs rate-limit = single `mapProviderQuotaError` (`:452-506`) on all paths. ✅
- Model catalog slightly STALE (Anthropic Standard/Balanced = 3.5 family while 4.x exists) but graceful fallback to provider default + status surfaces removed model as null for re-pick. LOW.

## 4. §5 COMPARATIVE SCAN — where "AI everywhere" is aspirational
VenueOS ships exactly **3 real AI features**: copy-gen (sparkle), template-gen, alt-text.
| AI feature | Competitors | We ship? | Severity |
|---|---|---|---|
| AI copy gen (Magic Write equiv) | Canva, OptiSigns, ScreenCloud | ✅ real | — |
| AI full-template gen from prompt | OptiSigns, Canva | ✅ real | — |
| AI vision alt-text on upload | accessibility leaders | ✅ (OpenAI+Anthropic only, no Google) | LOW |
| **AI Integration Concierge** (flagship vision) | — (novel) | ❌ **COSTUME** | **HIGH** |
| CV asset auto-tagging | OptiSigns, ScreenCloud, BrightSign | ❌ no | MED |
| Smart playlist suggestions | OptiSigns, ScreenCloud | ❌ no | MED |
| Content-scheduling AI | OptiSigns | ❌ no | MED |
| AI theme/palette from logo | Canva Brand | ⚠️ branding scraper exists but regex/cheerio, ZERO AI | LOW |
| AI menu/schedule copy from POS data | OptiSigns+POS | ❌ no (Square pull exists, no AI copy) | MED |
| People-counting CV for sponsor impressions | ad-tech signage | ❌ no (V2) | LOW |
| AI celebration animations / TTS / voice-to-text | — | ❌ no (N-A future) | N-A |

### The Concierge is the big lie (HIGH)
`IntegrationDiscoveryService` (`discovery.service.ts`) = **pure regex keyword matching**, a `RULES` array of `{pattern,weight}` — ZERO LLM calls (no `dispatchAi`/anthropic/openai/gemini in the file). Endpoints `POST /integrations/discover|describe` are real + guarded (`integrations.controller.ts:72-106`) but **NOTHING in `apps/web/src` calls them** (grep = 0 hits) — orphan backend, no Concierge wizard/onboarding UI. The AI explainer / diagnostic / build-it-for-me (CLAUDE.md workstreams 5-7) **don't exist at all**. The most-hyped AI feature is (a) not AI, (b) unreachable.

## Bottom line + highest-value fixes
- Core AI gen (sparkle/templates/alt-text/BYOK): real, wired, well-defended (encryption/quota/timeout/error-mapping better than most products this size). Dead in prod ONLY for lack of a key.
- "AI everywhere" overruns reality on: Concierge (not AI + no UI — HIGH), CV tagging/smart playlists/scheduling-AI/POS→AI copy (absent — MED), Google-vision alt-text + temperature parity (LOW).
- Fixes: (1) wire a Concierge UI + AI explainer OR stop calling it "AI"; (2) add `temperature` to Anthropic/OpenAI branches; (3) refresh Anthropic catalog to 4.x; (4) sparkle discoverability (ghost "Set up AI").
