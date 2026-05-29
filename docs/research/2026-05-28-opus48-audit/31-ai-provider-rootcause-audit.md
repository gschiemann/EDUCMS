# AI Provider Audit — Root Cause of "nothing works" (Standard Audit Surface §3)

> Opus 4.8 read-only, 2026-05-29. Verified against the LIVE Railway deploy + every
> claim traced to real callers. Latest AI commit `7e5d025`.

## BOTTOM LINE — why does NOTHING work
**Pure CONFIGURATION gap, not a code bug.** The AI subsystem is genuinely well-built
(8 audit-fix commits, structured error codes, SSRF guards, Redis rate limits, AuditLog
on every path). **Set ONE key on Railway and every AI feature starts working.** Today
nothing works because:

1. **Railway prod `api` service has NO AI key** — no `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   or `GEMINI/GOOGLE` key (confirmed against live vars + the exact names the code reads:
   `ai.service.ts:353`, `ai-alt-text.service.ts:174,178`).
2. **No tenant BYOK key** (opt-in via `/settings/ai`, currently unused) → `resolveProviderKey()`
   returns `null` (`ai.service.ts:357`). With neither key:
   - **The sparkle button does NOT EVEN RENDER** — `getUsage()` → `source:'none'` (`ai.service.ts:306`)
     → `AiGenerateButton.tsx:131` `if (aiSource === 'none') return null`. So the operator's literal
     experience is **the AI button is invisible** — a big part of "I can't even find it / nothing works."
   - Touch-template "Generate" IS visible → `POST /templates/generate-touch` → 503 "AI is not configured…
     Settings → AI provider" (`ai.service.ts:678`) — correct messaging.

**No code path is broken independent of the config gap.**

## Key-resolution table
| Feature | Endpoint | Key source | Dies w/o key? | Gating correct? |
|---|---|---|---|---|
| Sparkle generate | `POST /ai/generate` | BYOK first, else platform `ANTHROPIC_API_KEY` (`ai.service.ts:317-358`) | Yes — **button hidden entirely** | Partial — hides cleanly (AI-P0-3) but ZERO signal AI exists |
| Touch-template generate | `POST /templates/generate-touch` | same | Yes → 503 | Correct (visible + clear error) |
| AI alt-text on upload | upload → `AiAltTextService` | BYOK (openai/anthropic) else platform `OPENAI_API_KEY`→`ANTHROPIC_API_KEY` | Yes — silently skipped, `AI_ALT_TEXT_SKIPPED` audit, upload still succeeds | Correct (fire-and-forget) |
| BYOK test-on-save | `POST /ai/key` | key being tested | N/A | Correct + thorough |
| Integration Concierge | `/integrations/*` | **NONE — makes no AI call** | N/A | Discovery = regex rules; the "AI explainer/diagnostic/build-it-for-me" vision is **unbuilt** |

**Drift vs CLAUDE.md:** env-table says `ANTHROPIC_API_KEY` "powers the sparkle button"; code is actually BETTER (BYOK-first + platform fallback). The real drift: the Concierge (spec'd Tier-1 platform AI) makes **zero AI calls** = vaporware.

## Would it work WITH a key? — per provider (clients in `ai-providers.ts:289-417`)
- **Anthropic** ✅ `/v1/messages`, `x-api-key`, `anthropic-version:2023-06-01`, valid models (`claude-3-5-haiku-20241022`, `-sonnet-`, `claude-opus-4-20250514`).
- **OpenAI** ✅ `/v1/chat/completions`, Bearer. ⚠️ the `gpt-5` catalog tier likely 400s on `max_tokens` (reasoning models want `max_completion_tokens`); default `gpt-4o-mini` + `gpt-4.1` fine. Low sev.
- **Google/Gemini** ✅ `:generateContent`, `x-goog-api-key` (kept out of URL/errors), `maxOutputTokens`, valid models (`gemini-2.5-flash/-2.0-flash/-2.5-pro`).
- **AbortSignal timeout** present on all (15s gen, 5s alt-text). **No code bug would break a valid key.**

## Error mapping / accounting (strong)
- Test-on-save + generate-time SHARE `mapProviderQuotaError()` (`ai-providers.ts:452`) — out-of-credit (OpenAI insufficient_quota / Anthropic credit_balance_too_low,402 / Google RESOURCE_EXHAUSTED) vs rate-limit(429) disambiguated identically on all paths incl alt-text.
- Structured codes surface to UI: `AI_PROVIDER_OUT_OF_CREDIT`, `AI_CAP_REACHED`, `AI_FAILURE_CAP_REACHED`, 503, BYOK-401. FE branches on `e.code` first.
- AuditLog on success AND failed key test (`AI_GENERATE/_TEMPLATE_GENERATED/_KEY_SET/_KEY_CLEARED/_KEY_TEST_FAILED/_ALT_TEXT_*`), all best-effort.
- **3-tier model:** Tier-1 platform cap in Postgres (durable, default 200/mo via `AI_FREE_TIER_CAP`, never triggers today — no platform key); Tier-2 BYOK AES-256-GCM (complete); Tier-3 future. Hourly caps (30/hr success,200/hr fail) in **Redis sorted sets** (multi-replica safe, P1-14).

## Lower-severity (do NOT block a key working)
1. **Sparkle invisible when unconfigured** — defensible (AI-P0-3) but operator can't discover AI. Render a ghost "Set up AI"→`/settings/ai` instead of `return null` (`AiGenerateButton.tsx:131`). Likely a big chunk of "nothing works = can't find it."
2. No Anthropic prompt caching (cosmetic at this token size).
3. Temperature parity: Google 0.7, others default (~1.0). Minor.
4. Concierge AI unbuilt (regex only).
5. `gpt-5` `max_tokens`→`max_completion_tokens` (default tier unaffected).

## FIX LIST
**Make AI work TODAY (config only — no code change):**
1. **Set `ANTHROPIC_API_KEY` on Railway `api`** (platform fallback key; powers sparkle + touch-template). Optionally `OPENAI_API_KEY` for alt-text's cheapest path. ~30s redeploy → sparkle appears + generation works for every tenant, zero per-tenant setup.
2. Optionally set `AI_FREE_TIER_CAP` (default 200/tenant/mo) to size platform spend.
3. (Zero-platform-spend alt) each pilot tenant pastes their own key at `/settings/ai` — BYOK works fully today, just opt-in/unused.

**Optional code (quality, not blockers):**
4. Ghost "Set up AI" affordance instead of hiding sparkle (`AiGenerateButton.tsx:131`) — HIGH UX value (discoverability).
5. `gpt-5` → `max_completion_tokens` (`ai-providers.ts:346`) or drop from catalog.
6. Wire Concierge discovery/explain to `AiService` on the platform key if that vision is in scope.
