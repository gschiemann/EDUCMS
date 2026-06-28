# Signage Concierge — conversational, reference-driven AI template intake

**Date:** 2026-06-28
**Goal (Greg):** Stop the fixed-question wizard. Make template intake a *conversation* with an AI that knows the end-game (great digital signage). As the customer talks, the agent asks the right next question, accepts **reference URLs and image uploads** for the look they want, and keeps building until it has enough that **all 3 generated candidates meet their expectations.**

## What already exists (reuse verbatim — verified by the 2026-06-28 map)

- **Generation pipeline:** `POST /templates/generate-touch/candidates` fans out up to 3 art-director boards (vertical-aware directives), `refine-signage` is chat-to-edit on one candidate, `create-from-candidate` persists. The LLM only emits an `ArtDirectorSpec`; the `@cms/signage-design` engine owns geometry/type/color/contrast.
- **Voice injection:** `prependVoices(base, vertical, brandVoice)` + `VERTICAL_VOICE` + `brandVoiceClause`. `tenantBrandVoice()` / `tenantBrandColors()`.
- **Caps/audit/spend:** `resolveProviderKey`, `dispatchRawOrThrow`, `checkFailureCap`, `windowCount/recordEvent` (30/hr), `readPlatformUsage/bumpPlatformUsage` (monthly free-tier), AuditLog rows.
- **URL reference:** `BrandingScraperService.scrape(url)` → `{displayName, tagline, logos, palette, colors, fonts, heroImages, confidence}`. Mature, SSRF-guarded.
- **Vision:** `AiAltTextService` is the ONLY image-input path — per-provider wire framing (`callOpenAi`/`callAnthropic`/`callGoogle`) + `resolveProvider` (BYOK→platform). Vision-capable on all 3 catalog Standard models.
- **FE state machine:** `templates/page.tsx` intake→3-candidate→pick→refine→persist. `buildIntakeRequestFields(answers)`. `ScaledTemplateThumbnail` freeze preview. `friendlyAiError`. `AiIntakeWizard` (6-step form — kept as fallback).

## The 4 gaps to close

1. **Multi-turn dispatch.** `dispatchAi({system,userPrompt})` is single-turn. Add `dispatchAiMessages(provider,{apiKey,model,system,messages,maxTokens})` threading a `{role,content}[]` array through all 3 provider branches (Anthropic `messages[]`, OpenAI `messages[]`, Google `contents[]`). Keep `dispatchAi` untouched (load-bearing).
2. **Concierge service + endpoint.** `SignageConciergeService.chat({tenantId, messages, references})` → resolves key, builds `CONCIERGE_SYSTEM_PROMPT` (full archetype/theme/widget vocabulary + vertical affinity + brand voice + brand colors), injects reference summaries, calls `dispatchAiMessages`, parses a JSON envelope, enforces caps/audit. Endpoint `POST /templates/concierge/chat`.
   - **Turn envelope (model returns JSON):** `{ reply: string, intake: ConciergeIntake, missing: string[], ready: boolean, brief?: string }`. `reply` = the next thing to say/ask (ONE focused question, building on what's known). `intake` = progressively-filled structured directives. `ready` = enough to nail it. `brief` = the synthesized design brief (rich prompt) used at generate time.
3. **Reference → design.** Two summarizer endpoints returning a compact `ReferenceSummary` the FE stashes and passes back into chat:
   - `POST /templates/concierge/reference/url` → `BrandingScraperService.scrape` → `{kind:'url', name, tagline, palette[], fonts, heroImageUrl?, note}`.
   - `POST /templates/concierge/reference/image` → generalized vision (`AiAltTextService.analyzeDesignReference`) → `{kind:'image', mood, palette[], archetypeHint?, note}`.
   Summaries are injected into the concierge context so the LLM "sees" the brand/style and auto-fills `intake.palette` etc.
4. **Chat transcript UI.** `SignageConcierge.tsx` — messages list, input, paste-URL + upload-image affordances, a live "what I've gathered" chip strip, and a **Generate 3 boards** button. On generate it maps accumulated `intake` + `brief` → `buildIntakeRequestFields` → existing `generate-touch/candidates` (count 3). After generation the chat persists for refine. `AiIntakeWizard` stays behind a "Use the guided form instead" toggle.

## Why this hits "all 3 candidates meet expectations"
The 3-candidate fan-out already biases each take to a different archetype/mood. Today it's fed a thin free-text prompt + sparse intake. The concierge feeds it a **rich brief + structured directives + reference-derived palette/imagery/mood**, so every one of the 3 starts from the customer's actual intent and look — not a guess.

## Build order (additive — never regress the working generate path)
1. BE: `dispatchAiMessages` in `ai-providers.ts`.
2. BE: contract types in `packages/api-types`.
3. BE: `AiAltTextService.analyzeDesignReference` (generalized vision).
4. BE: `signage-concierge.service.ts` + wire into AiModule.
5. BE: controller endpoints in `templates.controller.ts`.
6. FE: hooks in `use-api.ts`; `ai-intake-contract.ts` extension.
7. FE: `SignageConcierge.tsx` + wire into `templates/page.tsx` (concierge default, wizard fallback).
8. Review (adversarial) → tsc/lint → push → CI green → live-verify on venue-os.app.

## Caps note
Each interview turn = 1 LLM call vs the 30/hr cap; concierge is prompted to gather efficiently (don't drag it out). BYOK tenants pay their own provider. Generation (3 boards) is image-free; only an accepted board pays for a real background photo.
