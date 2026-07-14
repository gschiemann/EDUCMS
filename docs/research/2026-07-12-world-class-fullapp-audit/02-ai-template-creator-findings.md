# AI + Template Creator Audit Checkpoint

**Audit baseline:** `3f274702`  
**Scope:** Standard Audit Surface §§3–5 plus the template creator, Concierge, Designer, provider, key-management, metering, persistence, and editor handoff paths. Sections outside this lane are covered in the master report.

| § | Coverage | Design | UX | Function | Honest verdict |
|---|---|---:|---:|---:|---|
| 3. Providers | Covered | B | C+ | D | Several default/current paths are broken by retired models; controls are not cost-grade |
| 4. AI surfaces | Covered | B+ | C+ | D+ | Impressive breadth, but the flagship Designer has a P0 execution boundary |
| 5. Comparative | Covered | B | C | C− | Ahead in contextual generation; behind in deterministic editability, governance, localization, and automation |

## P0 — retired models break live AI paths

The catalog's “current GA” comments are materially wrong:

- Anthropic Standard is `claude-3-5-haiku-20241022`, retired February 19, 2026: `apps/api/src/ai/ai-providers.ts:149`, `apps/api/src/ai/ai-providers.ts:170`. Platform-funded text falls back to this default at `apps/api/src/ai/ai.service.ts:544`, so platform text, Concierge, structured generation, and Designer calls can fail.
- Anthropic vision also pins the retired model at `apps/api/src/ai/ai-alt-text.service.ts:457`.
- Google Balanced pins `gemini-2.0-flash`, shut down June 1, 2026: `apps/api/src/ai/ai-providers.ts:248`.
- Google image generation pins `imagen-3.0-generate-002`, shut down November 10, 2025: `apps/api/src/ai/ai.service.ts:4217`.
- OpenAI image generation uses deprecated `gpt-image-1`, then deprecated `dall-e-3`: `apps/api/src/ai/ai.service.ts:4132`, `apps/api/src/ai/ai.service.ts:4196`.
- Anthropic Premium Opus 4.1 retires August 5, 2026: `apps/api/src/ai/ai-providers.ts:185`. A naïve swap to a current Opus can also fail because every Anthropic call sends `temperature: 0.7` at `apps/api/src/ai/ai-providers.ts:441`; current Opus-family parameter support must be resolved from model capabilities rather than assumed globally.

Official lifecycle references: [Anthropic](https://platform.claude.com/docs/en/about-claude/model-deprecations), [Google](https://ai.google.dev/gemini-api/docs/deprecations), [OpenAI models](https://developers.openai.com/api/docs/models), [GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2).

### Required implementation

1. Hotfix provider IDs and disable dead catalog options immediately.
2. Replace literal model arrays with a capability/lifecycle registry containing `surface`, vision/image/structured-output support, parameter profile, release/deprecation/retirement dates, fallback IDs, pricing, and maximum output.
3. Route by surface. Concierge/brief extraction should use a fast model; Designer may use premium; vision must use a vision-capable model; image generation must use a current image model.
4. Never silently substitute a removed tenant-selected model at `apps/api/src/ai/ai-providers.ts:375`. Return a lifecycle warning or apply an explicitly approved compatible fallback.
5. Add nightly live staging canaries for test-key, text, multi-turn, structured JSON, vision, and image generation across every supported provider.

**Acceptance:** every provider/surface combination returns a usable result; CI fails when a configured model retires within 60 days; resolved model and parameter profile appear in generation telemetry.

## P0 — AI-authored JavaScript can control the player

This is the most serious creator finding.

- The Designer prompt requests inline JavaScript: `apps/api/src/ai/designer-prompt.ts:206`, `apps/api/src/ai/designer-prompt.ts:247`.
- The sanitizer deliberately preserves arbitrary inline scripts: `apps/api/src/ai/designer-prompt.ts:501`. A test locks that behavior in at `apps/api/src/ai/designer-prompt.spec.ts:100`.
- Generated HTML executes in `sandbox="allow-scripts"`: `apps/web/src/components/widgets/WidgetRenderer.tsx:3944`; candidate picker `apps/web/src/app/[schoolId]/templates/page.tsx:1689`; full-screen preview `apps/web/src/app/[schoolId]/templates/page.tsx:2568`.
- The parent sends brand, text, image, and action mappings into that document with wildcard `postMessage`: `apps/web/src/components/widgets/WidgetRenderer.tsx:3913`.
- The player accepts any `educms-action` message from any window without checking `event.source`, iframe identity, nonce, or approved action key: `apps/web/src/app/player/page.tsx:4972`.
- That payload reaches actions including URL opening, scene/template navigation, public webhooks, and help requests: `apps/web/src/app/player/page.tsx:299`.

A generated script can post an action on load; no visitor tap is required. Null-origin sandboxing blocks cookies and parent DOM access, but not `postMessage`, outbound requests, or CPU denial-of-service.

### Required implementation

1. Disable raw Designer generation behind a kill flag until containment lands.
2. Strip every model-authored `<script>`, event-handler attribute, `javascript:` URL, SVG script/event vector, nested frame, and active object.
3. Inject only a trusted VenueOS scale/edit runtime after sanitization.
4. Add strict `srcdoc` CSP: `default-src 'none'`; restricted same-origin/rehosted images and fonts; no `connect-src`; only a nonce-bearing trusted runtime.
5. Bind action listeners to the exact iframe `contentWindow`.
6. The iframe may emit `{actionKey, renderNonce}` only. The parent resolves `actionKey` against the server-saved action map; never accept an action object from the iframe.
7. Long term, move Designer output to a validated `BoardDocumentV2` AST—text, image, shape, list, live binding, approved animation, and action nodes—not HTML.

**Acceptance:** a malicious inline/onload/SVG/CSS/postMessage payload corpus produces zero executable model code; messages from sibling or foreign frames are rejected; no action can execute without an approved key; outbound network requests from generated boards are zero.

## P0 — atomic dollar/fan-out reservation and containment (`AI-003A`)

- Monthly usage is a call counter on `Tenant`, not tokens or dollars: `packages/database/prisma/schema.prisma:167`, `apps/api/src/ai/ai.service.ts:404`.
- The UI estimates every call as a 300-token generation: `apps/api/src/ai/ai-providers.ts:76`, `apps/web/src/components/settings/AiKeyCard.tsx:219`.
- Designer launches three parallel 16,000-visible-token calls: `apps/api/src/ai/ai.service.ts:3048`. GPT-5 receives another 12,000-token reasoning allowance: `apps/api/src/ai/ai-providers.ts:492`.
- Fan-outs check only `used >= cap`, then launch all candidates and increment afterward: touch `apps/api/src/ai/ai.service.ts:2057`, structured `apps/api/src/ai/ai.service.ts:2581`, Designer `apps/api/src/ai/ai.service.ts:2981`.
- Redis checks and increments are separate and fail open: `apps/api/src/ai/ai-hourly-cap.ts:80`, `apps/api/src/ai/ai-hourly-cap.ts:102`.
- Brief extraction consumes paid model calls but intentionally consumes neither hourly nor monthly quota: `apps/api/src/ai/ai.service.ts:2779`, `apps/api/src/ai/ai.service.ts:2833`.

### Required containment

Disable multi-candidate fan-out or cap it to one until admission is atomic. Define tenant and platform hourly/daily/monthly ceilings in USD micros. In one serializable transaction, reserve the worst-case cost of brief extraction, retries, images, failures billed by the provider, and all N fan-out candidates before any provider call. Use an idempotency key, reject before dispatch when the cap would be exceeded, release only unused reservation after actual usage, retain recoverable reservations across crashes, and provide an operational kill switch. BYOK may bypass platform-dollar caps only—not abuse/concurrency limits or telemetry.

**P0 acceptance:** 50 concurrent cap-edge requests never exceed the configured platform-dollar ceiling; duplicate idempotency keys dispatch once; a crash/retry cannot double-spend; every dispatch path, including brief extraction and fan-out, requires a reservation; disabling the kill switch prevents all new paid calls.

## P1 — durable usage ledger, actual-cost accounting, and reconciliation (`AI-003B`)

Add immutable `AiGeneration` and append-only `AiUsageLedger` records with tenant/user/surface/provider/resolved model, idempotency key, batch/candidate, prompt/cache/reasoning/output token classes, image count, USD micros, provider request ID, latency, status, error code, reservation/refund, BYOK/platform funding source, and reconciliation state. Persist candidate-level failures rather than filtering them. Reconcile the ledger to provider usage/invoices and surface honest tenant/operator spend.

**P1 acceptance:** every successful, failed, timed-out, canceled, and retried provider request has a correlated ledger row; reserved/actual/refunded amounts balance; displayed tenant spend and platform totals reconcile to provider usage/cost within 1%; discrepancies alert and cannot be silently discarded.

## P1 — BYOK can silently become platform-funded

- AI credentials share `DEVICE_SECRET_KEY` and have no key version: `apps/api/src/ai/ai-key-cipher.ts:15`, `apps/api/src/ai/ai-key-cipher.ts:30`.
- Decryption failure silently falls through to the platform key: `apps/api/src/ai/ai.service.ts:519`. Alt-text does the same: `apps/api/src/ai/ai-alt-text.service.ts:229`.
- The backend returns `keyHealthy:false`, but the UI type omits it and always renders green “Connected”: `apps/web/src/components/settings/AiKeyCard.tsx:32`, `apps/web/src/components/settings/AiKeyCard.tsx:203`.
- Test-key network/timeout exceptions occur outside the mapped/audited `errorStatus` branch: `apps/api/src/ai/ai-key.controller.ts:191`, `apps/api/src/ai/ai-key.controller.ts:198`.

### Required implementation

Create versioned `AiCredential` rows encrypted with dedicated `AI_KEY_KEK` or KMS; store provider, key version, health, last test, error code, creator/rotator/revocation metadata. Never silently fund a configured-but-unreadable BYOK tenant. Return `AI_KEY_UNREADABLE`; require explicit operator choice to use platform credits. Use transactional audit/outbox writes and shared provider error classification.

**Acceptance:** KEK dual-read/rewrap rotation succeeds without key re-entry; corrupt ciphertext shows a blocking red state and does not increment platform usage; timeouts/401/403/404/429/5xx all produce structured, audited results.

Already good: provider fetches have timeouts; Anthropic system prompts use ephemeral caching. Temperature handling is only partially correct because it is model-family hardcoded.

## P1 — generator UX, jobs, cancel, and telemetry are incomplete

- Three long Designer calls run synchronously in one request with no durable job or cancel: `apps/api/src/ai/ai.service.ts:3051`.
- Partial failures are hidden by `Promise.allSettled`; only requested/returned counts are audited: `apps/api/src/ai/ai.service.ts:3082`, `apps/api/src/ai/ai.service.ts:3109`.
- Brief extraction may finish after modal closure and then launch generation: `apps/web/src/app/[schoolId]/templates/page.tsx:935`.
- `aiBusy` excludes brief, chat, references, and refinement: `apps/web/src/app/[schoolId]/templates/page.tsx:674`.
- Backend drops `batchId`: `apps/api/src/templates/templates.controller.ts:1280`; frontend expects it at `apps/web/src/hooks/use-api.ts:1616`, making keep telemetry undefined at `apps/web/src/app/[schoolId]/templates/page.tsx:869`.
- Concierge always forces raw Designer despite Touch/Display/Set controls: `apps/web/src/app/[schoolId]/templates/page.tsx:1017`. Designer persistence always sets touch false: `apps/api/src/templates/templates.controller.ts:1338`.
- Resume stores partial state in localStorage and clears saved IDs: `apps/web/src/app/[schoolId]/templates/page.tsx:760`. Regenerate reconstructs from wizard state and loses Concierge references/mode: `apps/web/src/app/[schoolId]/templates/page.tsx:989`.
- Candidate thumbnails hardcode 16:9 and 1920×1080: `apps/web/src/app/[schoolId]/templates/page.tsx:1680`.

### Required implementation

Introduce durable `AiDesignSession`, `AiGenerationBatch`, and candidate revisions. `POST /ai/jobs` returns `202 + jobId`; poll/SSE status; cancel propagates `AbortSignal`; immutable request snapshot includes mode, canvas, prompt, references, confirmed brief, engine, model policy, and idempotency key. Put shared Zod response contracts in `@cms/api-types`. Surface partial failure, cost, warnings, resolved model, and quality status.

**Acceptance:** close/cancel stops queued work; refresh resumes server state; repeated Save is idempotent; Touch/Display/Set/Designer each persist the advertised mode; portrait/square/custom previews match canvas; every keep joins to its generation batch.

## Template editability and competitive gaps

Raw Designer persists as one `EXTERNAL_HTML` zone at `apps/api/src/templates/templates.controller.ts:1324`, so it cannot deliver Canva-class structural editing. Switching that zone to a packaged URL does not clear `html` at `apps/web/src/components/template-builder/PropertiesPanel.tsx:2553`, while the renderer prioritizes inline HTML at `apps/web/src/components/widgets/WidgetRenderer.tsx:3944`. “Save as copy” also omits data-source fields and persists touch settings only when a background exists: `apps/web/src/components/template-builder/BuilderShell.tsx:585`, `apps/web/src/components/template-builder/BuilderShell.tsx:604`.

Make structured AST generation the default; quarantine legacy HTML as limited-editability content. Add atomic template save/clone endpoints preserving metadata, zones, scenes, actions, data bindings, and touch settings.

### §4 inventory

- **Built:** copy generation, rewrite, chat edit, touch synthesis, structured signage/sets, Designer/refine, Concierge URL/image context, OpenAI/Google image generation, alt text, limited translation, CMS menu/address grounding.
- **Not built:** background removal, TTS, V2 controlled summarization, AI anomaly detection, SOS transcription.
- **Clarification:** auto-celebration is deterministic, not generative AI.

### §5 competitive gaps

- **P1:** background removal; semantic asset tagging/search; smart playlist and scheduling recommendations; locale variants/RTL/translation memory; deterministic structured design; generation evals and approval governance.
- **P2:** generative celebration animation; privacy-governed people counting; anomaly intelligence; TTS and voice transcription.

## Recommended sequence

1. Immediately disable unsafe raw Designer, repair retired models, and meter brief extraction.
2. Ship credential/provider and spend-ledger foundations.
3. Add durable jobs, sessions, cancellation, idempotency, and shared contracts.
4. Replace raw HTML with `BoardDocumentV2` and enforce rendered quality gates in Chromium 83, current Chromium, and WebKit.
