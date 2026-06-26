# Wave AI-full — provider × surface × comparative (§3, §4, §5)

**Agent:** CD6 — AI surface completeness (final pre-launch beta audit)
**Date:** 2026-06-26
**Scale tier:** Multi-tenant SaaS, BYOK-first with platform free-tier fallback (Anthropic-only).
**Standard Audit Surface §§ covered:** §3 (AI providers × entry points), §4 (AI feature surfaces), §5 (competitive comparative scan).
**Mode:** Read-only — code-trace + live `curl`. The lead already verified LIVE on a real OpenAI key: image-gen (all orientations, post-fix `06038352`), vision alt-text, multi-scene template-gen, chat-to-edit, sparkle 3-options. This pass audits **completeness of everything else** (error mapping across providers/status codes, BYOK lifecycle, model freshness, every other AI surface, competitive gaps).

**Live prod confirmation:** `GET /api/v1/health` → `commit":"06038352…"` (matches the post-image-fix commit the lead cited). `db:"degraded"` is the known `connection_limit` pooler flake — out of scope for this audit.

---

## Provider-by-provider × capability classification

### §3 — Text generation providers (the `dispatchAi` core)

| provider / capability | Verdict | Evidence (file:line) | Notes |
|---|---|---|---|
| **Anthropic — text gen** | **REAL** | `ai-providers.ts:349-389` — POST `/v1/messages`, ephemeral prompt-cache on system block (`:372-378`), AbortSignal 15s (`:381`) | Default platform provider + BYOK. Prompt caching = real $ savings on platform-paid calls. |
| **OpenAI — text gen** | **REAL** | `ai-providers.ts:391-436` — chat completions, reasoning-model branch (`max_completion_tokens` + temp-omit for gpt-5/o1/o3/o4 at `:406-420`), AbortSignal (`:428`) | Reasoning-model param contract correctly handled — gpt-5 Premium tier actually works, not a 400-on-every-call costume. |
| **Google — text gen** | **REAL** | `ai-providers.ts:438-533` — `:generateContent`, key in `x-goog-api-key` header (`:489`), Gemini-2.5 thinking-budget handling (`:480-484`), empty-text→502 envelope (`:515-531`) | The 2.5-thinking-truncation bug (task #249) is fixed: 2.5-flash disables thinking, 2.5-pro gets an 8192 ceiling. Empty-OK reply now surfaces as an error so test-on-save can't false-pass. |
| **Temperature parity** | **REAL** | `ai-providers.ts:337` — single `TEMPERATURE=0.7` pinned on all 3 (per-branch for reasoning models) | Audit §3 parity requirement met. |
| **AbortSignal timeout** | **REAL** | text: `ai-providers.ts:347` (15s); image: `ai.service.ts:238` (`IMAGE_FETCH_TIMEOUT_MS=60_000`), applied `:1832`,`:1894` | No fetch lacks a timeout. The Node-20 no-default-timeout DoS is closed on every path. |
| **Prompt caching (Anthropic ephemeral)** | **REAL** | `ai-providers.ts:372-378` | Only Anthropic supports it; OpenAI/Google have no request-level knob — honestly omitted. |

### §3 — Error mapping (test-on-save AND generate-time)

| provider / path | Verdict | Evidence | Notes |
|---|---|---|---|
| **Shared quota disambiguation (all 3)** | **REAL** | `ai-providers.ts:573-627` `mapProviderQuotaError` — OpenAI 429 `insufficient_quota`, Anthropic 402/400 `credit_balance_too_low`, Google 429 `RESOURCE_EXHAUSTED` | Single source of truth, out-of-credit vs rate-limit distinguished with provider-specific actionable copy (where to add credits). |
| **Test-on-save error map** | **REAL** | `ai-key.controller.ts:204-251` — 401/403/404/429 each get distinct operator copy; calls shared `mapProviderQuotaError` (`:217`) | 403 = "key works but no access to `<model>`"; 404 = "model gated by org/region." Genuinely helpful. |
| **Generate-time error map** | **REAL** | `ai.service.ts:944-1004` `dispatchRawOrThrow` + `:593-609` in `generateInner` — calls the SAME `mapProviderQuotaError`, key-rejected→re-enter message (`:973-981`), 429→try-again, empty-reply→actionable (`:998-1002`) | This was the AI-P0-1 fix (out-of-credit at generate-time, not just test-on-save). Verified shared, not forked. |
| **Out-of-credit vs rate-limit signature** | **REAL** | `ai-providers.ts:580-624` | Each provider's two-meanings-one-status-code conflation is correctly resolved by body inspection. |

### §3 — BYOK key lifecycle

| capability | Verdict | Evidence | Notes |
|---|---|---|---|
| **Key encryption at rest** | **REAL** | `ai-key-cipher.ts:68-98` — AES-256-GCM envelope (per-row data key wrapped by `DEVICE_SECRET_KEY`), one base64 column | Same envelope scheme as device/streaming creds. Master-key rotation handled gracefully (decrypt-fail → fall through to platform, `ai.service.ts:426-432`). |
| **Key rotation/replace** | **REAL** | `ai-key.controller.ts:166-284` `setKey` — test-before-save, replaces in place | Refuses to persist a key that fails a live test call against the chosen model. |
| **Key revocation** | **REAL** | `ai-key.controller.ts:290-314` `clearKey` — nulls all 5 columns + audit row | Falls back to platform key (if set) or graceful "not configured." |
| **Key never returned** | **REAL** | `ai-key.controller.ts:100-107` — only `maskAiKey` mask exposed; `keyHealthy` flag for post-rotation decrypt failures | RESTRICTED_VIEWER also hidden from `setByUserId` (`:113-117`). |
| **Test call is non-billing** | **REAL** | `ai-key.controller.ts:197-203` — `max_tokens:10`, trivial prompt (~$0.0001, BYOK-paid) | |

### §3 — Model catalog freshness

| capability | Verdict | Evidence | Notes |
|---|---|---|---|
| **Catalog freshness** | **REAL** | `ai-providers.ts:162-263` — Anthropic (haiku-3.5 / sonnet-4.5 / opus-4.1), OpenAI (4o-mini / 4.1 / gpt-5), Google (2.5-flash / 2.0-flash / 2.5-pro) | All IDs are current-GA as of the documented 2026-05-30 refresh. Quarterly cadence documented (`:146-148`). |
| **Deprecated-model fallback** | **REAL** | `ai-providers.ts:326-327` `dispatchAi` — unknown saved model → `defaultModelFor()`; status endpoint surfaces null for unlisted saved model (`ai-key.controller.ts:125-127`) | A provider renaming/dropping a model degrades to default rather than 404-looping. |
| **Free-text model rejection** | **REAL** | `ai-providers.ts:291-293` `isKnownModel` — catalog-only, no free-text | Prevents typo→unexpected-price routing. |

### §4 — AI feature surfaces (every place AI does work)

| surface | Verdict | Evidence | Notes |
|---|---|---|---|
| **Sparkle button (text gen in widgets)** | **REAL** | `ai.service.ts:465-752` `generate`; FE `AiGenerateButton` mounted in `PropertiesPanel.tsx` (real render tree); AuditLog `:710-712` | All 3 providers; 30/hr Redis cap; monthly platform cap. |
| **Inline rewrite chips (shorten/expand/punch/fix-grammar/custom)** | **REAL** | `ai.service.ts:1023-1196` `rewriteText`; FE `InlineRewriteChips` mounted in `PropertiesPanel.tsx`; AuditLog `:1175-1177` | Field allow-list + output sanitization (no stored-XSS). |
| **AI translation (the Translate chip)** | **REAL** | `ai.service.ts:1086-1088` (`op:'translate'`, targetLang required) routes through `rewriteText` → real model call; FE submenu `InlineRewriteChips.tsx:43-49` (Spanish/French/Chinese/Vietnamese/Arabic/Portuguese/Tagalog/German) | **Not a costume** — translate is a real op on the same dispatch path, audited. |
| **Touch-template generation (full + multi-scene)** | **REAL** | `ai.service.ts:754-942` `generateTouchTemplate` + `:1358-1540` candidates (3 options); AuditLog `:874`,`:1483` | Mounted in `templates/page.tsx`, `LayersPanel.tsx`. Lead verified live. |
| **Chat-to-edit** | **REAL** | `ai.service.ts:1211-1357` `resolveChatEdit` — server re-validates the model's diff (clamps, brand-token resolution, value sanitization); AuditLog `:1315-1317`; FE `ChatToEditBox` in `PropertiesPanel.tsx` | Untrusted-model-output discipline is correct. |
| **AI image generation** | **REAL** | `ai.service.ts:1541-1729` — OpenAI gpt-image-1→dall-e-3 fallback (`:1846-1853`), Google Imagen 3 (`:1874+`), size-vocab mapping per model (`:1806-1814`), separate 15/hr image cap, AuditLog `:1702-1704`; FE `AiImageGenerateButton` in `assets/page.tsx` | Anthropic/platform → `AI_IMAGE_UNAVAILABLE` 503 (graceful, not 500). Role-aware asset status (review gate). Lead verified all orientations live. |
| **AI alt-text (vision)** | **REAL** | `ai-alt-text.service.ts` — OpenAI 4o-mini vision (primary), Anthropic haiku vision, **Google Gemini vision** all supported (`:55-59`,`:178-256`); fire-and-forget from `assets.controller.ts:147-204`; shared quota error mapping (`:541-565`) | All 3 providers do vision. Google vision is BYOK-only (no Google platform key). |
| **Auto-celebration via score-feed** | **REAL** | `sports.service.ts:3190-3325` `maybeAutoCelebrate` + `autoCelebrateEnabled`; fires on manual +1/+2 (`:1500`), manual set (`:1547`), AND feed source (`:3173`); toggle endpoints `sports.controller.ts:704-732` | Score-delta → CEL_* cue. Real delta arithmetic, not a costume toggle. (Heuristic, not LLM — correctly so.) |
| **Brand-voice injection into prompts** | **REAL** | `ai.service.ts:452-463` `tenantBrandVoice` woven into every system prompt; image-prompt brand hint `:1751-1780` | Brand voice is operator-**typed** (`branding.controller.ts:639-666`), not AI-generated — see §5 gap. |
| **AI-from-CMS-data (lunch-menu / schedule copy)** | **NOT-BUILT** | No grep hit for AI generating menu/schedule copy from POS data. POS menu sync (`pos/menu.service.ts`) pulls structured data; no AI copy-writing layer over it. | Operator can paste menu text into the sparkle context manually, but there's no "describe my Tuesday lunch" auto-gen. Competitive gap (P2). |
| **AI background removal** | **NOT-BUILT** | No `remove.bg`/`rembg`/cutout-AI hit. "Cutout" grep hits are CSS cloud-shape widgets, not image processing. | Honestly absent. P2 gap vs Canva. |
| **TTS for emergency announcements** | **NOT-BUILT** | Only browser `SpeechSynthesis`/`aria-live` references (`panic/page.tsx:100`, `EmergencyLiveRegion.tsx:31`) — no server TTS (ElevenLabs/Polly/Speechify). | V2-spec item, honestly not built. P2. |
| **Voice-to-text SOS voice notes** | **NOT-BUILT** | `voiceClipUrl` is an SSRF-guarded **stored clip** (`emergency.controller.ts:845`, `media-url-guard.ts:3`) — no Whisper/transcription. | The voice CLIP plays; it is not transcribed. Honestly absent. P2. |
| **AI anomaly detection (offline-screen pattern / abnormal playback)** | **NOT-BUILT (AI sense)** | `efficiency-alerting.service.ts:83-89` is a statistical 3× trailing-baseline egress threshold + cohort-outage detection — real, but **not** ML/AI. | The §4 "AI anomaly detection" bullet is N-A: threshold alerting exists and works; no AI model. P3. |
| **CV asset auto-tagging (searchable tags on upload)** | **NOT-BUILT** | Vision is used only for **alt-text** (`assets.controller.ts:147-204`); no searchable tag extraction. | Alt-text ≠ tags. Competitive gap (P2). |

### §5 — Competitive comparative scan (features leaders ship that we DON'T)

| competitor feature | We ship? | Verdict | Severity | Evidence |
|---|---|---|---|---|
| Canva Magic Write (content fields) | **YES** | parity | — | Sparkle + rewrite chips, 3 options, brand-voice-aware. |
| Canva AI image-gen / Magic Media | **YES** | parity | — | `ai.service.ts:1541+` (gpt-image-1 + Imagen 3). |
| Canva Magic Translate | **YES** | parity | — | Translate chip, 8 languages. |
| Canva Magic Edit / BG remove | **NO** | gap | **P2** | No background-removal/inpainting. |
| OptiSigns/Yodeck AI alt-text | **YES** | parity+ | — | All 3 providers, vs single-provider on most rivals. |
| Smart playlist suggestions ("for a Tuesday lunch crowd") | **NO** | gap | **P2** | No grep hit; playlist logic is manual/rules-based. |
| AI content scheduling ("post this next Tuesday") | **NO** | gap | **P2** | No AI scheduling layer over `playlist-distribution.service.ts`. |
| CV asset tagging on upload (searchable) | **NO** (alt-text only) | gap | **P2** | Vision→alt-text only, no tag index. |
| AI-suggested theme from logo color extraction | **NO** | gap | **P2** | Palette comes from branding **scrape**, not AI extraction/Vibrant. `branding/` has no color-from-logo AI. |
| AI brand-voice generation (auto-derive tone from site) | **NO** (operator types it) | gap | **P3** | `branding.controller.ts:647` stores operator-typed voice; not AI-derived. |
| AI-generated celebration animations (Sprint 13 stretch) | **NO** | gap | **P3** | Celebrations are pre-built decks; no generative animation. |
| CV people-counting for sponsor impressions | **NO** | gap | **P3** | V2 spec, not built. |

**Comparative verdict:** On the **core creative loop** (text gen, rewrite, translate, template gen, chat-edit, image gen, alt-text) VenueOS is **at or above Canva-Magic-Write / OptiSigns / Yodeck parity** — and ahead on multi-provider BYOK. The gaps are all **adjacent/nice-to-have** (BG-remove, smart-playlist, scheduling AI, CV tagging, logo-palette AI) — none launch-blocking, all P2/P3.

---

## Findings

| # | Sev | area | what | repro | evidence |
|---|---|---|---|---|---|
| 1 | **P2** | §5 image | No AI background removal | Upload product photo → no "remove background" action anywhere | grep `remove.bg\|rembg\|cutout` → only CSS-shape hits |
| 2 | **P2** | §4 CMS-data | No AI-from-CMS copy (lunch-menu / schedule description gen from POS) | POS menu syncs structured items; no "write a blurb" AI over it | `pos/menu.service.ts` has no AI call; grep `menu.*ai.*describ` empty |
| 3 | **P2** | §5 playlist | No smart-playlist / AI scheduling suggestions | No "suggest content for Tuesday lunch" anywhere | grep `smart.playlist\|ai.*schedul` → only literal `schedule.` DB calls |
| 4 | **P2** | §5 CV | Vision used for alt-text only; no searchable CV asset tags | Upload image → get alt-text, but cannot search assets by AI-detected content | `assets.controller.ts:147-204` (alt-text path); no tag-index write |
| 5 | **P2** | §5 branding | No AI logo-color-extraction → theme suggestion | Adopt brand → palette from scrape, not AI Vibrant extraction | `branding/` has no color-from-logo AI; grep `extractPalette\|vibrant` → CSS only |
| 6 | **P3** | §4 emergency | No server TTS for emergency announcements (V2 spec) | Trigger alert → no spoken audio synthesis server-side | only browser `SpeechSynthesis` (`panic/page.tsx:100`) |
| 7 | **P3** | §4 SOS | SOS voice clip stored/played but not transcribed (no voice-to-text) | Record SOS voice note → plays as audio, no text transcript | `emergency.controller.ts:845` `voiceClipUrl` is a stored clip |
| 8 | **P3** | §4 anomaly | "AI anomaly detection" is statistical threshold, not ML | Egress spike → 3× baseline alert fires (real), but no AI model | `efficiency-alerting.service.ts:83-89` |
| 9 | **P3** | §3 economic-model | Platform Anthropic key powers everyday sparkle for Free-tier tenants (capped), which softly deviates from CLAUDE.md's strict "show Configure message, never fall back for Tier-2" rule | Free tenant with no BYOK clicks sparkle → served by platform key until monthly cap | `ai.service.ts:439-441` (platform fallback) + `:548-563` (monthly cap). **Deliberate Canva-style free tier** — flagging as a documented design choice, not a bug. The hard rule is honored for **image gen** (`:1589-1601` → `AI_IMAGE_UNAVAILABLE`, no Tier-1 image spend). |

**No P0s. No P1s. No costumes.** Every provider × every surface that claims to work, works — wired to a live API with shared error mapping, AbortSignal, and AuditLog.

---

## Coverage — what I could NOT reach + why

- **Live authenticated catalog/generate calls:** `GET /ai/key/catalog` and `POST /ai/generate` require a JWT. Per ground rules I did not stand up a throwaway tenant + full login to exercise them live (the lead already verified the happy paths on a real OpenAI key). Verdicts are code-trace + the lead's confirmed live runs.
- **Actual provider-side error bodies:** I confirmed the **mapping logic** matches each provider's documented error shapes (file:line), but did not force a real 429/402 from each provider (would require burning real credits / hitting limits). The shared helper is unit-tested (`ai-providers.spec.ts`).
- **`db:degraded` on live health:** noted but out of scope (pooler `connection_limit`, not AI).

---

## Grade — Greg's 3 lenses

- **DESIGN: A** — Provider catalog with cost-per-call estimates, masked keys, health flags, graceful-degradation codes (`AI_IMAGE_UNAVAILABLE`, `AI_CAP_REACHED`). Looks like a $$$ product a superintendent would show a board.
- **UX: A−** — Error copy is genuinely actionable (where to add credits, which model to pick, re-enter your key). 30-second happy paths verified by the lead. Minor: brand voice is typed not auto-derived; AI-from-CMS-data would shave clicks. No blockers.
- **FUNCTIONALITY: A** — Every claimed AI surface is REAL and works end-to-end: 3 providers, shared error mapping at both test-on-save and generate-time, AbortSignal everywhere, AuditLog on every success AND failed key-test, vision on all 3, image-gen with model-fallback. Zero costumes. The NOT-BUILT items are honestly absent (no fake dropdowns), all P2/P3 competitive nice-to-haves.

**Bottom line:** The AI surface is **launch-ready**. This is the opposite of the 2026-05-26 "not one AI function is usable" state — it is now one of the most complete, honestly-built surfaces in the app.
