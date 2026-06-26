# Wave B3 — AI graceful-degradation

**Surface tested:** the AI no-provider-key degradation contract — the path a tenant with NO BYOK key (and a prod with NO platform key) hits across every AI surface. This is the OPPOSITE of the live happy-path (which was verified on a real OpenAI BYOK key earlier this session).

**Scale tier:** single fresh throwaway tenant (RESTAURANT vertical), DISTRICT_ADMIN role, zero AI config. Created live via `POST /api/v1/signup`.

**Standard Audit Surface §§ covered:**
- **§3 AI providers — every entry point × every provider** (no-key resolution, error mapping, platform-key Tier-1 vs BYOK Tier-2 boundary). COVERED.
- **§4 AI feature surfaces** (sparkle/generate, touch-template single + 3-candidate, inline rewrite, chat-to-edit, image gen, alt-text regenerate). COVERED.
- **§20 Design/UX/Functionality lenses** on the degradation path. COVERED.
- **§21 Verification-before-claim** — every finding has a live curl repro + file:line. COVERED.
- N-A for §1/§2/§5–§19 (out of this agent's scope — other B-wave agents).

---

## Step-by-step what I did

1. Read the full backend degradation logic: `ai.service.ts` (2589 lines — `resolveProviderKey`, `generate`, `generateTouchTemplate(+Candidates)`, `rewriteText`, `resolveChatEdit`, `generateImage`), `ai.controller.ts`, `ai-key.controller.ts`, `ai-alt-text.service.ts`, and the templates controller's `generate-touch` / `generate-touch/candidates` endpoints.
2. Read every FE AI component: `AiGenerateButton.tsx` (sparkle + `getAiStatusSource` gating), `AiImageGenerateButton.tsx`, `ChatToEditBox.tsx`, `InlineRewriteChips.tsx`, `AiProviderRow.tsx`/`AiKeyCard.tsx` (settings), and the assets-page alt-text Regenerate handler.
3. Traced the error-envelope mapping: `all-exceptions.filter.ts` (server `code` derivation) → `api-client.ts` `apiFetch` (`err.code`/`err.status`/`err.body`/`err.message`) → each FE branch.
4. Created a fresh no-key tenant on **live prod** and curled `GET /ai/key`, `GET /ai/key/catalog`, `POST /ai/generate`, `POST /ai/text/rewrite`, `POST /ai/edit/resolve`, `POST /ai/image`, `POST /templates/generate-touch`, `POST /templates/generate-touch/candidates`, uploaded a PNG, and called `POST /assets/:id/generate-alt-text`. Also fired malformed bodies to confirm validation (not 500s).

---

## The decisive finding (the Economic-Model boundary)

**Live prod has NO platform `ANTHROPIC_API_KEY` set.** `GET /ai/key` on the no-key tenant returns:

```json
{ "configured": false, "platformFallbackAvailable": false,
  "usage": { "source": "none", "used": 0, "cap": null, "resetAt": null } }
```

Because `resolveProviderKey` (ai.service.ts:439-443) only falls back to `process.env.ANTHROPIC_API_KEY`, and that env is unset, a no-BYOK tenant resolves to **`source: 'none'`, never `'platform'`**. Consequence chain, all verified:

- **No platform-budget leak is even possible** — there is no platform key to spend. The CLAUDE.md Economic-Model invariant ("the platform must NEVER silently spend Tier-1 budget on a Tier-2 sparkle action") holds **by configuration**, not just by code. Every Tier-2 surface (sparkle/rewrite/chat-edit/image) returns 503 "not configured" instead of quietly billing our Anthropic key. ✅
- The FE `getAiStatusSource()` returns `'none'` → the sparkle renders only the unobtrusive **"Set up AI"** link (a plain `<a>` to `/[schoolId]/settings/ai` that never calls `/ai/generate`), and `AiImageGenerateButton` renders **nothing**. ✅
- Every server endpoint degrades to an honest 503 with a "configure your provider" message — **no 500 stacks, no "falling back to platform key" lie.** ✅

**Caveat for the lead (not a defect, a deploy-gate):** the entire safety of the Tier boundary depends on `ANTHROPIC_API_KEY` staying unset on prod. The moment someone sets it, every no-BYOK tenant flips to `source: 'platform'` and the full sparkle button silently spends our Anthropic budget on Tier-2 actions (the FE comment literally says `'platform' means we pay`). That's by design (the 200/mo free-tier cap exists for it), but it is a one-env-var flip from "honest degradation" to "platform pays for everyone." Worth a conscious launch decision.

---

## Findings table

| # | Sev | area | what | repro | evidence |
|---|-----|------|------|-------|----------|
| 1 | **P2** | error-code stability | The no-key **"AI is not configured"** path is the ONE AI error that ships a generic `code: "Service Unavailable"` (NestJS `ServiceUnavailableException`'s default `error` field), NOT a stable domain code. The FE catches it only by **message-regex** `/not configured/i` (`AiGenerateButton.tsx:396`). An i18n pass or a reworded server string silently breaks the "ask your admin" branch → operator falls to the generic "AI request failed" else-branch. Every OTHER AI error (`AI_IMAGE_UNAVAILABLE`, `AI_CAP_REACHED`, `AI_PROVIDER_OUT_OF_CREDIT`, `AI_ALT_TEXT_UNAVAILABLE`, `AI_IMAGE_CAP_REACHED`, `AI_FAILURE_CAP_REACHED`) correctly carries a stable code. | `curl -X POST .../ai/generate` (no key) → `{"code":"Service Unavailable","message":"AI is not configured..."}` (status 503). FE branch is message-regex, not code. | `ai.service.ts:483` (throws `ServiceUnavailableException` with no `code`); `all-exceptions.filter.ts:88` (`code = anyResp.error` → `"Service Unavailable"`); `AiGenerateButton.tsx:396`, `AiImageGenerateButton.tsx:159` (regex `/not configured/i`) |
| 2 | **P2** | env-config gate (informational) | Tier-1/Tier-2 safety is enforced by `ANTHROPIC_API_KEY` being **unset** on prod, not by code. If it's ever set, all no-BYOK tenants silently consume platform Anthropic credit on Tier-2 sparkle/rewrite/chat-edit. Not a bug today (`platformFallbackAvailable:false` confirms unset) — flagged so the lead makes it a conscious launch decision, and so a future "let's add a free trial key" doesn't quietly cross the line. | `GET /ai/key` → `"platformFallbackAvailable": false`, `usage.source: "none"`. | `ai.service.ts:439-443` (only fallback is `process.env.ANTHROPIC_API_KEY`); `AiGenerateButton.tsx:33` FE comment "source 'platform' means we pay" |

**No P0s. No P1s.** Both findings are P2 hardening items, not launch blockers. The degradation contract is functionally correct end-to-end on live prod.

---

## What I verified clean (live curl, no-key tenant)

| Endpoint | Result | Honest? |
|---|---|---|
| `GET /ai/key` | `configured:false, source:none, platformFallbackAvailable:false` | ✅ |
| `POST /ai/generate` | 503 "AI is not configured. Add your provider API key in Settings → Integrations…" | ✅ no 500, no lie |
| `POST /ai/text/rewrite` | 503 same honest message | ✅ |
| `POST /ai/edit/resolve` (chat-to-edit) | 503 same honest message | ✅ |
| `POST /ai/image` | 503 "AI is not configured. Add your provider API key in Settings → AI provider…" | ✅ |
| `POST /templates/generate-touch` | 503 honest message | ✅ |
| `POST /templates/generate-touch/candidates` (3-candidate fan-out) | 503 honest message | ✅ |
| `POST /assets/:id/generate-alt-text` | 503 `code: AI_ALT_TEXT_UNAVAILABLE` + "configure your AI provider key" | ✅ stable code + honest msg |
| `POST /ai/image {prompt:""}` (malformed) | 400 `ValidationError` | ✅ no 500 |
| `POST /ai/generate {missing context}` (malformed) | 400 `ValidationError` | ✅ no 500 |
| Image asset upload (no key) | 200, asset created | ✅ alt-text is fire-and-forget; no-key never breaks upload |

**Affordance hiding (AI-P0-3 / AI-P0-5) — still enforced:**
- Sparkle: `source==='none'` renders "Set up AI" link only (`AiGenerateButton.tsx:180-193`); image button renders nothing (`AiImageGenerateButton.tsx:57`).
- The 2026-05-29 fail-open fix is intact: a status-fetch error returns `'none'` (not the old `'platform'`), so an unreachable `/ai/key` can never render an active button that 503s on click (`AiGenerateButton.tsx:104`).
- Settings Configure CTA gated to `SUPER_ADMIN | DISTRICT_ADMIN | SCHOOL_ADMIN` on FE (`AiProviderRow.tsx:30,53,174`), matching the server `@RequireRoles` on `POST/DELETE /ai/key`.
- `RESTRICTED_VIEWER` excluded from `POST /ai/generate|text/rewrite|edit/resolve|image` (`ai.controller.ts:96-101,117-122,137-142,162-167`) and from alt-text regen (`assets.controller.ts:1018`).

**BYOK-Anthropic image sub-case (graceful, code-verified):** a tenant WITH an Anthropic BYOK key hitting `/ai/image` gets `AI_IMAGE_UNAVAILABLE` (503, not 500) with a "switch to OpenAI/Google" message — `ai.service.ts:1589-1601`; FE shows the amber "needs OpenAI or Google" card (`AiImageGenerateButton.tsx:148-152,195-213`). Could not curl this sub-case live (would require saving a real Anthropic key, out of scope), but the branch is unambiguous and the alt-text path proves the same `null`-provider→structured-503 discipline works live.

**No-retry-storm confirmed:** all AI endpoints are POST → `apiFetch` sets `retryOn5xx = !isMutation = false` (`api-client.ts:114`), so the 503 surfaces immediately — no 3× retry delay on the degradation path.

---

## Coverage — what I could NOT reach + why

- **BYOK provider-error live paths** (bad-key 401 → "re-enter", out-of-credit 402 → `AI_PROVIDER_OUT_OF_CREDIT`, 429 rate-limit): not exercised live — requires saving real/invalid provider keys and burning real credit. Code-verified instead via the shared `mapProviderQuotaError` + `dispatchRawOrThrow` paths (`ai.service.ts:944-1004`), which every surface funnels through identically. The session's already-verified happy-path covers the success side.
- **BYOK-Anthropic `/ai/image` → AI_IMAGE_UNAVAILABLE** live: not exercised (would need a saved Anthropic key); branch is code-verified + the alt-text live 503 proves the structured-degradation plumbing works on prod.
- **Monthly-cap-exhausted (`AI_CAP_REACHED` 402) live**: not reachable on a no-key tenant (cap only applies to `source==='platform'`, which prod has none of). Code-verified across all 6 surfaces.
- **CONTRIBUTOR/RESTRICTED_VIEWER live RBAC rejection**: not exercised (would need the invite flow to mint a lower-priv user); confirmed by reading the `@RequireRoles` decorators against the live success on a DISTRICT_ADMIN token.

---

## Grade per Greg's 3 lenses (the degradation path)

- **Design: A** — the "Set up AI" link and the amber "needs OpenAI/Google" image card are tasteful, on-brand, never a raw error toast. Looks like a paid product even when AI is off.
- **UX: A−** — every dead-end routes the operator to the exact fix (Settings → AI provider, tenant-scoped link). Single −: the "not configured" copy says "Settings → **Integrations**" on text/rewrite/chat-edit but "Settings → **AI provider**" on image/alt-text — minor wording drift for the same destination (cosmetic, not a blocker).
- **Functionality: A** — every surface degrades to an honest 503 with no 500s, no platform-budget leak, affordances correctly hidden, no retry storm. The only nits are P2 hardening (one missing stable code; an env-gate worth a conscious decision).

**Throwaway tenant** `b3-ai-degradation-audit` (id `d03b7591-…`) is inert (no screens/playlists/games) and touches nothing real — safe to leave or reap.
