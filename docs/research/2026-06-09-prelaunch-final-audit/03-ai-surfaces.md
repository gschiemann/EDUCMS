# Pre-launch Final Audit — Sections 3 + 4: AI Providers × AI Feature Surfaces

**Auditor:** fresh frontier-model deep pass (2026-06-10)
**Scope:** Standard Audit Surface §3 (AI providers — every entry point × every provider) + §4 (AI feature surfaces — every place AI does work), tier discipline per the CLAUDE.md Economic Model.
**Method:** full read of `apps/api/src/ai/*` (ai.service.ts 1198 ln, ai-providers.ts 627 ln, ai-alt-text.service.ts 756 ln, ai-key.controller.ts, ai-key-cipher.ts, ai-hourly-cap.ts, ai.controller.ts), bug-analyzer, FE surfaces (AiGenerateButton, PropertiesPanel mounts, touch modal, AiKeyCard/AiProviderRow, assets page), a **node repro against the installed @nestjs/common**, **live prod curls** (venue-os.app, running master head `cf5772ae`), and **read-only prod DB forensics** (audit_logs + tenants).
**Dedup:** 2026-06-09 full-audit graded §3 A/A/A− and §4 A/A−/B+ ("mapping solid", "sparkle/touch/alt-text real"). This pass **verified** those claims and found the grades too generous on FUNCTIONALITY: one shipped safeguard is dead code, and one provider path is broken for the only live BYOK tenant.

---

## Coverage table (page 1)

| Section | Bullet | Coverage | D | UX | F | Verdict |
|---|---|---|---|---|---|---|
| 3 | Test-on-save error mapping (every status, quota disambig) | covered | A | A− | B+ | Works (prod `AI_KEY_TEST_FAILED` row 2026-06-08). Gap: network exception → raw 500, no audit row (F-5) |
| 3 | Generate-time error mapping (same disambiguation) | covered | — | C | **D** | **BROKEN — 402 out-of-credit envelope swallowed into 503 "AI service unreachable" (F-1)** |
| 3 | Out-of-credit vs rate-limit signature recognition | covered | — | — | A− | `mapProviderQuotaError` correct for all 3 providers; reaches the operator only at test-on-save + alt-text |
| 3 | AuditLog on success AND failed key tests | covered | — | — | A | Verified in code AND prod rows (AI_KEY_SET×2, AI_KEY_TEST_FAILED×1, AI_KEY_CLEARED×1, alt-text trio) |
| 3 | BYOK key encryption + rotation + revocation | covered | A | A− | A− | AES-256-GCM envelope; replace=rotate, DELETE=revoke, all audited. keyHealthy banner only on settings row, not AiKeyCard (F-8) |
| 3 | Platform free-tier accounting (multi-replica safe) | covered | — | — | A | Monthly counter in Postgres (atomic increment, documented rollover race ≤1 call); hourly caps in Redis sorted sets |
| 3 | Model catalog freshness | covered | B+ | A− | B | All ids GA; but Anthropic Premium pins Opus 4.1 (Opus 4.5 is GA, 3× cheaper), GPT-5 list price 4× overstated (F-6); gpt-5 likely unusable at 300-token budget (F-3) |
| 3 | AbortSignal timeout on every fetch | covered | — | — | A | 15s × 3 providers (dispatchAi), 5s × 3 (alt-text), 30s (bug-analyzer:647). No unguarded AI fetch found |
| 3 | Prompt caching where supported | covered | — | — | A | Anthropic ephemeral `cache_control` on text-gen + alt-text system blocks |
| 3 | Temperature parity | covered | — | — | A | 0.7 pinned all 3; correctly omitted for OpenAI reasoning models |
| 4 | Sparkle button (PropertiesPanel mounts) | covered | A− | B | B+ | WORKS — but only 4 mounts (TEXT/RICH_TEXT, ANNOUNCEMENT, TICKER, FITNESS_MOTIVATIONAL_QUOTE); EXTERNAL_HTML flagship boards + 3 of 6 intents unreachable (F-4) |
| 4 | Touch-template generation | covered | A− | B+ | A− | WORKS end-to-end (endpoint→sanitizer→SSRF guard→tx persist→builder handoff); error UX degraded by F-1 |
| 4 | AI image generation | N-A | — | — | — | Not built (known competitive gap, flagged in prior audits) |
| 4 | AI background removal | N-A | — | — | — | Not built |
| 4 | AI translation (multilingual templates) | N-A | — | — | — | Not built |
| 4 | TTS for emergency announcements | N-A | — | — | — | Not built (V2 spec) |
| 4 | Auto-celebration via score-feed | covered | — | — | B+ | Built as score-delta automation (no LLM in loop) — correct design; task #45 residual in progress |
| 4 | AI summarization of incoming context | N-A | — | — | — | Not built (V2) |
| 4 | AI-from-CMS-data (menu copy from POS etc.) | deferred-partial | — | C | C | `menu_item`/`promo`/`daypart` intents fully built server-side but mounted NOWHERE in the UI; no POS-data wiring (F-4) |
| 4 | AI alt-text / captions | covered | A− | B+ | **C+** | Real on all 3 providers; **broken for the ONLY live BYOK tenant (gemini-2.5-pro) — thinking-token truncation not fixed on the alt-text Google path (F-2)** |
| 4 | AI anomaly detection | N-A | — | — | — | Cohort outage detection exists but is statistical, not AI — honest |
| 4 | Voice-to-text for SOS | N-A | — | — | — | Not built |
| 4 | Bug-analyzer (surface not in CLAUDE.md list — added) | covered | — | — | B+ | Sonnet 4.5, 30s timeout, 20/day global Postgres-backed cap, BUG_ANALYZED audit w/ cost. Never ran in prod (no platform key — 0 rows) |
| 4 | Concierge AI explainer / diagnostic concierge (Tier-1 vision) | N-A | — | — | — | Not built — discovery.service.ts is regex/keyword classification, zero AI calls |
| — | **Tier discipline (no BYOK + free tier ⇒ "configure AI", never silent platform spend)** | covered | — | — | A− (as deployed) | See verdict below |

**Section roll-up: §3 D=A− UX=B+ F=B · §4 D=A− UX=B F=B.** (Previous audit's §3 F=A− / §4 F=B+ were too generous — F-1 and F-2 below are functional breaks in shipped safeguards.)

---

## Live / prod evidence baseline

- `curl https://venue-os.app/api/v1/health` → commit `cf5772ae` (master head) — audited code == deployed code.
- `GET /api/v1/ai/key/catalog` unauth → 401; `POST /api/v1/ai/generate` unauth → 403. Guards live.
- Prod DB (read-only): **63 tenants. 62 with no AI config + usage counters 0; exactly 1 BYOK tenant: provider=google, model=`gemini-2.5-pro`** (key set 2026-06-08).
- Prod audit_logs AI actions: AI_KEY_SET×2, AI_ALT_TEXT_FAILED×2, AI_KEY_TEST_FAILED×1, AI_KEY_CLEARED×1, AI_ALT_TEXT_GENERATED×1, AI_ALT_TEXT_SKIPPED×1, **AI_GENERATE×0, AI_TEMPLATE_GENERATED×0, BUG_ANALYZED×0** — no successful text/template generation has ever happened in production, and the bug-analyzer has never run (ANTHROPIC_API_KEY unset in prod, consistent with the 2026-06-09 audit).

---

## Findings

### F-1 (P1) — Generate-time out-of-credit disambiguation is DEAD CODE: the 402 envelope is swallowed into a generic 503 "AI service unreachable."

The AI-P0-1 fix (task #73, marked completed; comment `2026-05-26 audit AI-P0-1` at `ai.service.ts:533`) throws the structured envelope **inside** the dispatch try-block:

- `apps/api/src/ai/ai.service.ts:540-549` — `throw new HttpException({ code: 'AI_PROVIDER_OUT_OF_CREDIT', … }, HttpStatus.PAYMENT_REQUIRED)`
- `apps/api/src/ai/ai.service.ts:575-578` — the catch: `if (err instanceof ServiceUnavailableException) throw err; … throw new ServiceUnavailableException('AI service unreachable.')`

`HttpException` is the **parent** class of `ServiceUnavailableException`, so the 402 fails the `instanceof` check and is replaced. **Proven against the installed @nestjs/common**:

```
quotaErr instanceof ServiceUnavailableException = false
FINAL status seen by FE: 503 | {"message":"AI service unreachable.", …}
```

Identical pattern on the touch-template path: `ai.service.ts:800-810` (throw) vs `ai.service.ts:827-830` (catch).

Impact: a BYOK operator whose Anthropic/OpenAI/Google account runs out of money gets **"AI service unreachable."** on every sparkle/touch-template click — *worse* than the pre-fix "rate-limited" message the original P0 complained about. Both FE surfaces are already wired for the code that can never arrive (`AiGenerateButton.tsx:389`, `templates/page.tsx:919`) — costume on the server side. `ai.service.spec.ts` never tests 402 propagation (only the helper is unit-tested in `ai-providers.spec.ts`), which is how this shipped.

**Fix (2 lines):** in both catches, `if (err instanceof HttpException) throw err;` (HttpException covers ServiceUnavailableException). Add a spec: dispatch mock returns `{errorStatus: 429, errorBody: 'insufficient_quota'}` → expect rejects with `response.code === 'AI_PROVIDER_OUT_OF_CREDIT'` and status 402.

### F-2 (P1) — Gemini 2.5 thinking-token truncation fix missed the alt-text Google path — broken for the ONLY live BYOK tenant.

The 2026-06-08 fix (`ai-providers.ts:457-484`) handles the 2.5 family in `dispatchAi`: flash → `thinkingConfig:{thinkingBudget:0}`; pro → `maxOutputTokens ≥ 8192` ("With a small budget … the model can spend the ENTIRE budget thinking and return … ZERO visible text"). But `AiAltTextService.callGoogle` does its **own** fetch with `generationConfig: { maxOutputTokens: 300, temperature: 0.7 }` and **no thinking handling** (`ai-alt-text.service.ts:669`). 2.5 Pro's thinking *cannot be disabled* and routinely exceeds 300 tokens → 200 OK, empty parts → `return null` → `AI_ALT_TEXT_FAILED {error:'empty_response'}` → operator sees "Alt-text generation could not run. Make sure your AI provider key is configured" (`assets.controller.ts:1054-1061`) — the exact "key saved but AI says not configured" class the 2026-06-08 fire was about.

Live impact is concrete: the single prod BYOK tenant is `google` / `gemini-2.5-pro` (DB-verified). Their alt-text path is dead on arrival; sparkle/touch work only because those route through the fixed `dispatchAi`.

**Fix:** mirror the dispatchAi branch in `callGoogle` — `/^gemini-2\.5-flash/` → `thinkingBudget: 0`; `/^gemini-2\.5/` → `maxOutputTokens: Math.max(300, 8192)`; also surface the `finishReason` like dispatchAi does instead of silent null. **Class-sweep rule applies: there are exactly two Google fetch sites; the fix patched one.**

### F-3 (P2) — Same empty-reply class, OpenAI flavor: catalog Premium `gpt-5` likely passes test-on-save then fails every sparkle.

`dispatchAi` correctly branches reasoning params (`max_completion_tokens`, no temperature — `ai-providers.ts:406-420`) but sets **no `reasoning_effort`** and no empty-content guard on the OpenAI branch (the Google branch got one at `ai-providers.ts:515-531`; OpenAI returns `raw: json.choices[0].message.content || ''` unchecked at :435). gpt-5's default medium reasoning consumes completion budget; with test-on-save `maxTokens: 10` (`ai-key.controller.ts:197-203`) the reply is empty-but-200 → **test PASSES, key saves**; at sparkle's 300 the content is likely empty → "AI returned an empty result. Try rephrasing your context." This is the identical signature as the Gemini-2.5 bug ("test passes; every real generation fails"), unhandled for OpenAI. No live OpenAI tenant yet, so unconfirmed in prod — but the catalog actively recommends gpt-5 as the Premium tier for "AI-generated template designs."

**Fix:** send `reasoning_effort: 'minimal'` for reasoning models on our short-copy tasks (or raise `max_completion_tokens` to ≥4096 for the gpt-5 family), and port the Google empty-reply error envelope to the OpenAI branch so an empty 200 fails test-on-save.

### F-4 (P2) — Sparkle reaches 4 React widget cases only; the flagship EXTERNAL_HTML boards and 3 of 6 intents are unreachable.

Mount census (`grep AiGenerateButton apps/web/src`): exactly 4 sites, all in PropertiesPanel — `TEXT/RICH_TEXT` (intent announcement, :2499), `ANNOUNCEMENT` (:2585), `TICKER` (:2803), `FITNESS_MOTIVATIONAL_QUOTE` (intent quote, :5028).
- `ExternalHtmlTextEditor` (PropertiesPanel:2461/:6636) — the editor for every data-field on the ~107 EXTERNAL_HTML signage/kiosk/HS boards (the product's flagship template line) — has **no sparkle**. The boards most likely to need copy help (QSR menus, promos, daily specials) have zero AI assist.
- Server intents `menu_item`, `promo`, `daypart` (`ai.service.ts:91-104`, full system prompts, Zod-accepted) are mounted **nowhere** — orphaned features. This is also why "AI-from-CMS-data" (CLAUDE.md §4 bullet) grades C: the copy engine exists, the entry point doesn't.

**Fix:** add `AiGenerateButton` to ExternalHtmlTextEditor (intent inferred from field key: price/menu fields → menu_item, headline → promo/announcement), and mount menu_item/daypart on the menu-board widget editors.

### F-5 (P2) — Test-on-save: a thrown fetch error (timeout/DNS/provider outage) escapes as a raw 500 with no audit row.

`dispatchAi` only returns `{errorStatus}` for non-2xx HTTP responses; an `AbortSignal` timeout or network failure **rejects**. `AiKeyController.setKey` calls it with no try/catch (`ai-key.controller.ts:197`), so the operator pasting a key during a provider blip gets "Internal server error" instead of "provider unreachable — try again," and the `AI_KEY_TEST_FAILED` audit row (AI-P0-4) is skipped for this failure mode. Same gap on `getStatus`? No — that path doesn't dispatch. Generate paths are covered by their catch-alls.

**Fix:** wrap the test dispatch; map AbortError/TypeError → 503 "Could not reach {provider} to validate the key — try again in a minute," and write the audit row with `upstreamStatus: 'network_error'`.

### F-6 (P3) — Model catalog staleness: Anthropic Premium pins Opus 4.1; GPT-5 list prices overstated ~4×.

`ai-providers.ts:185-190` Premium = `claude-opus-4-1-20250805` at $15/$75. Claude Opus 4.5 (`claude-opus-4-5-20251101`, GA Nov 2025) is the current top tier at $5/$25 — the catalog ships the older, 3× more expensive model for "AI-generated template designs." `ai-providers.ts:215-220` lists gpt-5 at $5/$20 per 1M; OpenAI's published price is $1.25/$10 — `estCostPerCallUsd` shown to operators is ~4× too high. Catalog's own REFRESH CADENCE note (quarterly) is due. Display + spend-efficiency only; nothing breaks.

### F-7 (P3) — Tier-discipline doc divergence: code implements a badged platform free tier; CLAUDE.md says sparkle must never auto-spend the platform key.

`resolveProviderKey` (`ai.service.ts:389-397`) silently falls back to `ANTHROPIC_API_KEY` for keyless tenants, giving every tenant 200 platform-paid generations/month (Canva-style, `freeTierCap`, disclosed via the "X of 200 free" badge + 402 AI_CAP_REACHED upsell). CLAUDE.md's Economic Model (2026-05-26) says: *"If a tenant has no BYOK and is on the Free tier, sparkle should say 'Configure your AI provider' not 'fall back to platform key'"* and Tier-1 platform budget is ≤50/lifetime concierge calls. **As deployed this is moot** — prod has no platform key, so all 62 keyless tenants get the "Set up AI" affordance (verified: `getAiStatusSource` → 'none' → settings link; usage counters all 0; integrations-health says exactly this). But the day someone sets ANTHROPIC_API_KEY in prod (e.g. to turn on the bug-analyzer), every tenant silently gains a platform-paid AI tier and the decrypt-failure fallback (ai.service.ts:380-386) starts burning platform quota for BYOK tenants whose blobs break. Decide which doc/code is authoritative; if the free tier is the product, update CLAUDE.md; if not, gate the fallback behind an explicit `AI_PLATFORM_FREE_TIER=true`.

### F-8 (P3) — `keyHealthy` ("your saved key can't be decrypted — re-enter it") is surfaced on the settings index row but NOT on the AiKeyCard page itself.

API exposes it (audit-W4, `ai-key.controller.ts:100-107`); `AiProviderRow.tsx:103/:133` renders the unhealthy state on /settings; `AiKeyCard.tsx` (the /settings/ai page the row links to) has zero `keyHealthy` references — the operator lands on the management card and sees a normal-looking configured state with a generic mask. Complete the W4 fix by rendering the re-enter banner on the card.

### F-9 (P3) — Two different error codes for the same "provider out of credit" condition across surfaces.

Text-gen/touch emit `AI_PROVIDER_OUT_OF_CREDIT` (`ai.service.ts:544`); the alt-text regen endpoint emits `AI_QUOTA_EXHAUSTED` (`assets.controller.ts:1080-1087`). Each FE handler matches its own code (`AiGenerateButton.tsx:389`, `assets/page.tsx:1371`) so nothing is broken, but it forks the error-envelope vocabulary the pending "stable error-envelope discipline" task (#57) is meant to unify. Pick one code.

---

## What's verified solid (do not re-flag)

- **AbortSignal on every AI fetch** — dispatchAi 15s ×3 providers (`ai-providers.ts:347,381,428,498`), alt-text 5s ×3 (`ai-alt-text.service.ts:607,671,744`), bug-analyzer 30s (`bug-analyzer.service.ts:647`).
- **`mapProviderQuotaError` itself is correct** for OpenAI (429+insufficient_quota), Anthropic (402 / 400+credit_balance_too_low), Google (429+RESOURCE_EXHAUSTED) — and *does* reach operators at test-on-save and on the alt-text path (typed `AiAltTextQuotaError` → 402, the pattern ai.service.ts should have used).
- **AuditLog coverage real and firing in prod**: AI_KEY_SET/CLEARED/TEST_FAILED (never logs key material — provider+status only), AI_GENERATE / AI_TEMPLATE_GENERATED on success (dimensions only, no prompt content/PII), alt-text GENERATED/SKIPPED/FAILED with honest skip reasons + cost estimates, BUG_ANALYZED with token counts + cost.
- **BYOK lifecycle**: AES-256-GCM envelope (per-row data key wrapped by DEVICE_SECRET_KEY; prod boot refuses weak master), key never returned (mask only), set/replace/clear all audited, test-before-save refuses bad keys, catalog-only model ids (no free-text), saved-model-removed → fallback to provider default.
- **Caps are multi-replica safe**: 30/hr shared Redis sorted-set window across sparkle+touch+alt-text (single `ai:rl:gen:` prefix), 200/hr failure cap, monthly 200 platform cap in Postgres with atomic increment (documented ≤1-call races), fail-open policy explicit, no-slot-burn-on-failure leak-fix preserved (spec-pinned).
- **Touch-template hardening**: widget-type allowlist, percent clamps, `validatePublicUrl` SSRF guard on AI-emitted open-url/webhook targets, dangerous-scheme scrub, prototype-pollution guard, payload bounding, request-help body preserved.
- **Prompt-injection guards** at boundary: Zod schema, tone/vertical whitelists, 2000-char caps (clamped before toUpperCase).
- **FE state discipline**: AI-P0-3 "Set up AI" affordance (fail-closed to 'none' on status error), AI-P0-5 role-gated Configure, AI-P0-2 code-based modal branching, 60s status cache, abortable requests, a11y dialog (focus trap, aria-modal).
- **Anthropic prompt caching** (ephemeral system blocks) on text-gen + alt-text; **temperature parity** 0.7 w/ correct reasoning-model omission; **Google key in header never URL** + belt-and-suspenders body redaction (both Google fetch sites).
- **Gemini 2.5 thinking fix is correct where applied** (dispatchAi: test-on-save, sparkle, touch) including the Gemini empty-reply error envelope that stops empty-200 test passes.
- **KNOWN-OPEN confirmed unchanged**: platform ANTHROPIC_API_KEY unset in prod → sparkle "Set up AI" / bug-analyzer 'unconfigured' (2026-06-09 audit) — counters + zero AI_GENERATE/BUG_ANALYZED rows confirm.

## Missing features (comparative scan, §4/§5 obligations — all previously flagged, still open)

AI image generation (OptiSigns ships this), background removal, AI translation for multilingual boards, TTS emergency voice, CV auto-tagging on upload, smart playlist suggestions, AI content scheduling ("post this next Tuesday"), AI theme-from-logo suggestions, Concierge AI explainer + diagnostic concierge (Tier-1 vision in CLAUDE.md — discovery is regex-only today), voice-to-text SOS notes.

## Scope notes

Covered every §3 and §4 bullet (table above). Not exercised: a real paid-key end-to-end generation against live providers (no test keys available to this auditor; never mutate live data) — behavior inferred from full code trace + prod DB/audit forensics + the node-level exception repro. Sonnet-baseline control folder untouched per blinding rule.
