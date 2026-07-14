# VenueOS Full-App World-Class Audit and Remediation Specification

**Audit date:** 2026-07-12  
**Audit snapshot baseline:** `3f274702edb9079417b944749e3eb756a4ea9daa`  
**Repository HEAD observed at handoff:** `044eed4dfedeeb54414d50b05ee0ffb5e11936b1`  
**Production observed:** `https://venue-os.app`, API commit `7bb3fa066db9d05137166a14d0a5f770ec3859e8`—at audit time, its delta to the snapshot baseline was documentation-only; later handoff commits are not assumed deployed.  
**Audience:** product lead, engineering lead, AI development agents, QA, design, security, operations, and customer-success owners.

## Current repository drift and execution-status addendum

This report is an evidence snapshot at the audit baseline, not a claim that later commits were fully re-audited. During final assembly, `master` advanced to the handoff HEAD through a sports-focused commit series.

- The tracked credential literal was removed from the current source. That is **PARTIALLY COMPLETE containment only**. Rotation, token revocation, shared-key blast-radius migration, historical exposure analysis, and log review remain **OPEN/UNVERIFIED** until operators attach proof.
- Later sports commits report targeted water-polo, swimming, diving, and football fixes. Those changes do not close the sports scorecard or provider/hardware gates without the tests, runtime artifacts, and physical certification required below.
- Line numbers may drift after the snapshot. Re-resolve each cited symbol on the implementation branch, re-run the specified acceptance test, and update the evidence record; never dismiss a finding solely because its old line moved.
- The precise historic credential locator and introduction commit belong in a restricted incident record until revocation is proven. This distributable brief intentionally does not amplify them.

## Executive verdict

VenueOS is an unusually ambitious and substantive product. The emergency server path, offline/player foundation, Stripe backend, direct POS connectors, 19-sport engine, AI feature breadth, multi-vertical model, and template volume are real. This is not a prototype with painted buttons.

It is **not world-class or enterprise-ready end-to-end today**. The biggest problem is not lack of features; it is that breadth has outrun release integrity, product truth, consistent data contracts, template approval, and verified operator workflows.

The honest current position is:

- **Core foundation:** promising and in several areas strong.
- **Customer experience:** uneven; polished surfaces coexist with dead or misleading controls.
- **Templates:** large catalog, inconsistent quality, mostly unapproved, and too dependent on one-zone HTML.
- **Template creator/AI:** impressive breadth, but the flagship raw-HTML Designer has a serious security boundary, dead default models, weak cost accounting, and limited structural editability.
- **Integrations:** several real direct paths, many partial/bridge/coming-soon paths, and insufficient runtime verification.
- **Sports:** a real multi-sport engine, but only one generic live feed is end-to-end; hardware/provider certification and long-tail sport depth are not world-class.
- **Release confidence:** currently unreliable because green CI masks a broken lint/a11y gate and a zero-test Playwright collection.
- **Product truth:** pricing, trial limits, SAML, Clever, asset behavior, billing help, and several “live” template claims conflict with code.

### Stop-ship / immediate-response items

1. At the audit baseline, a tracked production-capable integration script exposed signing material. The literal is removed at the handoff HEAD, but the credential must still be treated as compromised until rotation/revocation and exposure review are proven.
2. AI Designer output preserves model-authored JavaScript, runs it in a script-enabled iframe, and the player accepts action messages without source/nonce/action-key validation. Disable this path until contained.
3. Default Anthropic/Google AI paths reference retired models; current image fallbacks are deprecated/retired.
4. API-generated USB bundles cannot be ingested by Android, and the promised operator PIN does not exist.
5. Web lint/a11y is false-green and root Playwright discovers zero runnable tests; all-green CI does not currently prove these gates ran.
6. Pricing/trial/SSO/Clever/assets/billing help contain material product claims that do not match shipped behavior.
7. Unapproved/demo/licensing-risk templates are active because source registration is treated as publication.

Do not add more integrations or template count until these are closed.

## Scope and evidence

This audit explicitly covers all 21 Standard Audit Surface sections. Evidence included:

- Read-only code/schema/workflow inspection across web, API, player, Android, shared packages, migrations, help, marketing, and template assets.
- Signed-in production DOM inspection of the dashboard and template gallery plus public pricing/signup/help surfaces.
- Production health check on 2026-07-12: DB and Redis both reported `ok`.
- Current GitHub workflow status: 10 named workflows green at audited HEAD, contrasted with locally reproduced gate failures.
- `pnpm audit --prod`: no high, critical, or moderate findings; one low.
- Existing targeted automated test evidence, plus fresh domain-specific sports checks reported in the appendices.
- Current official model-lifecycle documentation and official competitor feature pages.

### Verification limits

No destructive production mutations were performed. No paid AI/provider credentials, SSO IdP sandboxes, Stripe live mode, POS sandboxes, physical Daktronics/CTS hardware, Taurus unit, Android device lab, or real CAP/IPAWS partner feed was available. Browser screenshot capture was unreliable, so some visual grades are based on production DOM, source styling, existing visual ledgers, and code rather than a full pixel-by-pixel physical-display review. The broken root Playwright gate itself prevents claiming a complete product E2E run.

## Page-one coverage matrix

`Covered` means audited, not passed. `N/A—not built` means the requested integration domain does not exist and is explicitly reported rather than silently omitted.

| # | Standard Audit Surface | Coverage | Design | UX | Functionality | Honest result |
|---:|---|---|---:|---:|---:|---|
| 1 | Real-time + signed pub/sub | Covered | B | B- | C+ | Strong server HMAC gate/backstop; device verification, replay coverage, SSE token/origin, and live panic capability are incomplete |
| 2 | Storage + content pipeline | Covered | B | C+ | D+ | Hash/offline foundations exist; USB is incompatible, cache floor is not guaranteed, video pipeline is not production-grade |
| 3 | AI providers | Covered | B | C+ | D | Retired defaults, weak credential health/fallback, and call-count metering invalidate provider reliability |
| 4 | AI feature surfaces | Covered | B+ | C+ | D+ | Broad feature set; unsafe raw HTML, synchronous long jobs, partial failure opacity, and non-durable sessions |
| 5 | AI comparative scan | Covered | B | C | C- | Strong contextual generation; behind on structured editability, quality scoring, automation, governance, localization, and edge intelligence |
| 6 | Streaming integrations | Covered | B | C | C- | HLS/basic embeds exist; manual iframe path breaks, URL refresh/ad scheduling are incomplete, DASH/RTSP/NFHS/Facebook absent |
| 7 | Sports score/data | Covered | B+ | B- | B- | Real 19-sport engine; only generic feed end-to-end, provisional hardware, provider gaps, long-tail sport depth uneven |
| 8 | POS/commerce integrations | Covered | B | C | C+ | Four direct connectors are real; provider selection/binding/freshness and several promoted integrations are misleading or absent |
| 9 | Communications | Covered | B- | C | C+ | Resend and durable custom webhooks are real; SMS/push/Slack/Teams/escalation ecosystem absent |
| 10 | Auth + identity | Covered | B | C+ | B- | Argon2, revocation, sessions, TOTP exist; SAML absent, Clever partial, passkeys absent, session store not multi-replica safe |
| 11 | Billing + commerce | Covered | B | D | C | Stripe core is substantive; pricing/trial contract, dunning, PO, refunds, and customer lifecycle truth are inconsistent |
| 12 | Design imports | Covered | B- | C | C | PPTX/PDF/image parsing exists; fidelity and playlist behavior overpromise; Canva/Drive/Graph/Figma absent |
| 13 | Public alert integrations | N/A—not built | — | — | N/A | CAP/IPAWS/Raptor/RapidSOS/PA are not shipped; EULA is honest here |
| 14 | Multi-vertical | Covered | B- | B- | C+ | Shared vertical model is strong; nouns, templates, sample repair, billing names, and brand rollout are uneven |
| 15 | Cross-browser + Chromium 83 | Covered | B- | C | D+ | Useful static gates; no exact Chromium-83 or Taurus runtime, incomplete template sweep, no Android player tests |
| 16 | Forensics + audit | Covered | B- | C | C | DB immutability and many audits exist; coverage is inconsistent, TRUNCATE remains, stable idempotency/correlation is incomplete |
| 17 | Operations + DX | Covered | B | C+ | D+ | Health/deploy/dependency work is strong; false-green gates, local session/background state, boot DDL, and monoliths are serious |
| 18 | Accessibility | Covered | C | C | D | Some emergency live regions exist; enforcement is broken, baseline is 99, authed axe coverage and dialog/map keyboard UX are incomplete |
| 19 | Template/widget editability | Covered | C+ | C | C | Native primitives often good; HTML/AI/live widgets vary sharply; release catalog is not gated by editability or rights |
| 20 | Design/UX/function lenses | Covered | C+ | C | C | Surface polish is real but task completion, truth, and end-to-end behavior are inconsistent |
| 21 | Verification-before-claim | Covered | C | D | D | Strong written rule, but prior “launch-ready” reports and current green CI demonstrate the discipline is not enforced structurally |

### Grade interpretation and blocking rule

- `A` = 90–100: leading, verified, resilient, and operationally governed.
- `B` = 80–89: production-usable with bounded secondary gaps.
- `C` = 70–79: material workflow, truth, resilience, or editability gaps.
- `D` = 60–69: a primary job or trust boundary is broken/misleading.
- `F` = below 60: the primary purpose cannot be completed safely or truthfully.
- `+` and `−` denote the upper and lower thirds of a band. A `B−` is below the world-class release threshold; the minimum passing release grade is an unqualified `B` in every required dimension.
- Scores are not averaged across critical dimensions. Any `D`/`F` in security, life safety, tenant isolation, credential handling, audit/data integrity, or the feature's primary user job is a blocking failure regardless of stronger neighboring grades.

## What should be protected—not rewritten

The team should preserve and build on these strengths:

- Server-side WS HMAC verification before Redis fan-out, timestamp freshness, signed messages, and manifest polling fallback.
- Emergency trigger/clear audit and transactional state foundations.
- Production liveness/readiness/emergency-path endpoints and graceful Redis degradation.
- Dependency hardening: current production audit is free of high/critical/moderate advisories.
- Stripe event ledger/order guards, quantity reconciliation, hosted Checkout/Portal, and SAQ-A boundary.
- Argon2, durable JWT revocation fallback, TOTP/backup codes, and scoped tenant roles.
- Direct Square/Clover/Lightspeed/Shopify connector foundations and signed custom webhooks.
- Real sport definitions, game state, boards, operator controls, player bindings, stats, and celebration foundations.
- Asset hashing, image optimization/EXIF removal, and emergency/playlist cache tier concepts.
- AI breadth: copy/rewrite, structured/touch generation, Designer/refine, Concierge, image generation, alt text, limited translation, and CMS grounding.

The goal is to make these reliable and coherent—not discard them.

## Wave 0 — actions for the next 48 hours

### W0-01 — sports signing-secret incident response

**Owner:** security + backend + operations  
**Handoff status:** PARTIALLY COMPLETE—the source literal is removed; rotation, revocation, exposure analysis, shared-key migration, and verification remain OPEN/UNVERIFIED.  
**Restricted locator:** preserve the exact historic path/line/introduction commit in the access-controlled incident record; do not publish it until cryptographic revocation is proven.  
**Shared-key blast-radius files:** `apps/api/src/security/websocket-signer.service.ts:59`, `apps/api/src/realtime/redis.service.ts:69`, `apps/api/src/screens/screens.controller.ts:79-106`, `apps/api/src/screens/gpio.controller.ts:98`, `apps/api/src/ai/ai-key-cipher.ts:31+`, `apps/api/src/auth/mfa-secret-cipher.ts:31+`, `apps/api/src/streaming/creds-cipher.ts:34+`, `apps/api/src/integrations/clever/clever.service.ts:11-19`

1. Treat the tracked value as compromised; never paste it into tickets or this report. Preserve a forensic snapshot of current key identifiers, affected configuration, issued-token versions, and relevant logs before changing state.
2. Compare it securely to current/historical `SPORTS_FEED_SECRET` and `DEVICE_SECRET_KEY` values without emitting either value into logs, shell history, screenshots, tickets, or audit artifacts.
3. Freeze feed issuance/ingest or enforce one database-backed cutover epoch. Install a dedicated, versioned `SPORTS_FEED_SECRET` with at least 32 cryptographically random bytes and strict production boot validation; never fall back to a device or application key. Transactionally revoke all old feed tokens, drain every old-key replica, and verify no old replica remains before restoring ingest. Rollback may pause ingest but must never restore the compromised key.
4. Remove query-string feed authentication. Accept credentials only in a protected header or device-authenticated channel; preserve and redact proxy/CDN/WAF/analytics/referrer logs that may already contain query tokens.
5. Replace bare/non-expiring v0 credentials with an API-issued token containing tenant, game, scopes, `kid`, `jti`, issued-at, short expiry, and token version. The existing credentials endpoint and any generated curl output must stop returning/logging reusable bearer material.
6. The integration test must never receive `SPORTS_FEED_SECRET` or `DEVICE_SECRET_KEY`. It accepts only an API-issued, short-lived, game-scoped test token—or authenticates to a non-production test-token endpoint—defaults to staging, refuses a production host without recorded break-glass approval, redacts headers/bodies/tokens, and revokes the token/deletes the test game in `finally`.
7. If the exposed value ever matched `DEVICE_SECRET_KEY`, **do not blindly rotate that environment variable**. It also signs WS/Redis traffic, authenticates screens/GPIO, and wraps AI BYOK, MFA, streaming, Clever state, and possibly other credentials. Immediate replacement could break emergency/player control and permanently orphan ciphertext.
8. First inventory every `DEVICE_SECRET_KEY` consumer and count/back up every encrypted row. Introduce purpose-specific, versioned keys with new-primary/old-decrypt-only or dual-verify overlap. Rewrap and reconcile AI/MFA/streaming/other ciphertext while the old key is available; use a controlled MFA re-enrollment path if rewrap is impossible; reissue/re-pair screen/GPIO/device credentials only where required.
9. Exercise emergency trigger → signed fan-out → physical/player receipt/acknowledgement → all-clear during overlap. Retire the old `DEVICE_SECRET_KEY` only after every dependent reports the new key version, ciphertext counts/hashes reconcile, old replicas are drained, rollback evidence exists, and the emergency path remains green.
10. Review Railway/CDN/WAF ingress, deploy/CI artifacts, secret-manager access, application AuditLog/GameEvent records, and retained infrastructure logs for the full restricted exposure window. Explicitly document telemetry gaps; absence of a record is not evidence of no abuse.
11. Scan current/history source, artifacts, release bundles, caches, and shared copies. If canonical history is rewritten, first preserve a restricted forensic archive. Rotation/revocation remains the closure mechanism because existing clones cannot be recalled.
12. Add a blocking custom secret-scan rule: the existing green scanner did not catch this credential shape. Verify it with a non-secret canary fixture.

**Done when:** the old feed value and every affected issued token return 401; a short-lived scoped smoke token works and is revoked; the test has zero root-secret access and logs zero credentials; query-token auth is gone; all replicas enforce the cutover; sports uses a dedicated versioned 32-byte key; evidence review and documented telemetry gaps are complete; no encrypted BYOK, MFA, streaming, or integration credential is lost; screen/GPIO authentication works; and emergency/player control remains continuously available through the versioned shared-key cutover.

### W0-02 — disable unsafe raw AI Designer execution

**Owner:** AI/backend/player security  
**Files:** `apps/api/src/ai/designer-prompt.ts:206-247,501+`, `apps/web/src/components/widgets/WidgetRenderer.tsx:3913-3955`, `apps/web/src/app/player/page.tsx:4972`

1. Add a server-side and UI kill flag that prevents new raw Designer HTML from being generated/published.
2. Keep existing templates playable only if a security review permits; disable actions/network for untrusted legacy HTML.
3. Reject model-authored scripts, event attributes, `javascript:` URLs, SVG active content, nested frames, and active objects.
4. Bind messages to exact iframe `contentWindow`, render nonce, and server-approved action key.
5. Plan `BoardDocumentV2`; do not treat regex sanitization as the long-term boundary.

**Done when:** malicious fixture corpus executes zero model code, sends zero unauthorized action/network request, and foreign/sibling iframe messages are rejected.

### W0-03 — repair dead AI model routes

**Owner:** AI platform  
**Files:** `apps/api/src/ai/ai-providers.ts`, `apps/api/src/ai/ai.service.ts`, `apps/api/src/ai/ai-alt-text.service.ts`

1. Replace retired `claude-3-5-haiku-20241022`, shut-down `gemini-2.0-flash`, retired Imagen 3, and deprecated OpenAI image models with current, surface-compatible models.
2. Disable deprecated catalog choices before changing defaults.
3. Apply model-specific parameter profiles; do not send one global temperature/thinking shape.
4. Add staging canaries for text, structured JSON, vision, image, test-key, and error mapping.

**Done when:** every supported provider/surface returns a valid result; the chosen model/parameter profile is telemetry-visible; CI warns 60 days before retirement.

Official lifecycle evidence: [Anthropic model deprecations](https://platform.claude.com/docs/en/docs/about-claude/model-deprecations), [Google Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations), and [OpenAI model catalog](https://developers.openai.com/api/docs/models/all).

### W0-04 — disable or repair USB export/ingest

**Owner:** player/backend/Android  
**Files:** `apps/api/src/usb-export/usb-export.controller.ts`, `scripts/usb-bundler.ts`, `apps/player/app/src/main/java/com/educms/player/usb/UsbIngester.kt`, `UsbIngestActivity.kt`

1. Hide/disable the in-app USB export until a cross-language fixture passes.
2. Define one JSON Schema, generate TS/Kotlin types, and delete the divergent producer contract.
3. Add real local authorization/PIN with lockout or remove the claim.
4. Enforce screen binding, expiry, monotonic version, streaming hash verification, size/count caps, and atomic cache switch.

**Done when:** an API-produced ZIP is accepted by Android, plays fully offline, rejects wrong-screen/expired/old/corrupt bundles, and never partially replaces good content.

### W0-05 — make lint/a11y a real gate

**Owner:** frontend platform/QA  
**Files:** `apps/web/eslint.config.mjs`, `.github/workflows/ci.yml:80-100`

1. Register `jsx-a11y` in the exact flat-config object that enables its rules.
2. Remove `|| true`; preserve pipeline exit status.
3. Make a config crash fail CI before baseline counting.
4. Ratchet the 99-error baseline only downward; prohibit file-wide rule disables.

**Done when:** lint exits 0 cleanly and a config error or injected missing accessible name makes CI red.

### W0-06 — repair the E2E gate

**Owner:** QA/platform  
**Files:** `playwright.config.ts`, `tests/e2e/*.test.ts`, `tests/e2e/*.spec.ts`, `.github/workflows/ci.yml:254-286`

1. Remove/quarantine Jest/Supertest theater tests from Playwright collection.
2. Seed isolated tenant/admin/device fixtures against real routes and ephemeral Postgres/Redis.
3. Unskip login, pair, publish, emergency trigger/player receipt/all-clear, and tenant-isolation journeys.
4. Assert a minimum test count and zero unexpected skips.
5. Run on pushes and pull requests; do not mutate production.

**Done when:** `playwright test --list` succeeds above the count floor and the complete life-safety journey is blocking.

### W0-07 — product-truth correction

**Owner:** product + engineering + legal/customer success  
**Files:** public pages, signup, help MDX, integration catalogs, billing/license services

Until one server-owned capability/plan contract exists, immediately correct or remove claims about:

- $25/$20 versus $15 pricing.
- 10-screen free pilot versus 3-screen/14-day versus 5-screen/90-day versus perpetual 1,000-screen behavior.
- SAML/full SSO and automatic IdP deprovisioning.
- Clever schools/sections/schedules/webhooks beyond the first-page user sync.
- Asset SVG/500MB/Trash/export/folder-permission behavior.
- Per-building billing, PO entry, 30/90-day lifecycle, refunds, pause, deletion.
- “Live” template data without a working adapter.
- “Every action logged forever” while privileged audit coverage/TRUNCATE remain incomplete.

**Done when:** each public/help claim maps to a capability ID, owner, evidence test, status, and review date; CI rejects unregistered shipped claims.

### W0-08 — quarantine unapproved/licensing-risk templates

**Owner:** design system + product + legal  
**Files:** template registry/seed, `Template` schema, `docs/template-finalization/PROGRESS.md`, customer HTML assets

1. Hide obvious placeholders/clipping boards and demo-only Domino’s assets from new customer use.
2. Stop fresh DB seeds from equating “source exists” with ACTIVE/PUBLISHED.
3. Add an interim allowlist of reviewed production templates while `TemplateRelease` is built.
4. Quarantine the 45 high-confidence D/F V2 ghost variants or remove/disable their misleading friendly controls until edit → save → reload → player-render tests pass.

**Done when:** the gallery contains only reviewed/rights-cleared templates, no offered widget has a known D/F primary control contract, and existing customers retain an explicit legacy compatibility path.

### W0-09 — contain unbounded AI fan-out spend

**Owner:** AI platform + billing + operations  
**Files:** AI generation admission/fan-out paths, usage counters, provider dispatch

1. Disable multi-candidate fan-out or cap it to one candidate until admission is atomic.
2. Define tenant and platform hourly/daily/monthly limits in USD micros, including brief extraction, retries, images, failures where the provider bills, and every fan-out candidate.
3. In one serializable database transaction, reserve the worst-case amount before provider dispatch using an idempotency key. Reject before any call if the reservation would exceed the cap.
4. After provider completion, record actual model/token/image usage and release only the unused reservation. A crash leaves a recoverable reservation, not free unmetered capacity.
5. Add an operational kill switch, spend anomaly alert, and tenant-visible honest limit state.

**Done when:** 50 concurrent requests at the cap cannot exceed the configured platform-dollar ceiling; duplicate idempotency keys dispatch once; a worker crash/retry cannot double-spend; and no fan-out path bypasses reservation.

## Domain remediation specifications

### §1 — real-time, emergency, and signed pub/sub

**Current truth:** server-side HMAC verification before fan-out, freshness checks, Redis, SSE, and manifest polling are meaningful controls. The device boundary only checks signature presence, replay protection is partial, SSE leaks a JWT through query strings/loose CORS, and panic authorization can rely on a stale claim.

**Build instructions:**

1. Define `ControlEnvelopeV2` with `schema`, `kid`, `eventId`, `tenantId`, `scopeType`, `scopeId`, `type`, `issuedAt`, `expiresAt`, `payloadHash`, and canonical payload.
2. Sign with Ed25519; pin public keys during device pairing; deliver a signed keyring with overlap/revocation metadata.
3. Verify at the player with WebCrypto before dispatch—not merely at Redis fan-out.
4. Define a mixed-fleet migration: envelope negotiation plus dual-sign/dual-verify or equivalent compatibility, signed keyring overlap, a minimum supported player version, offline-device policy, adoption telemetry, and rollback. Do not strand a device that was offline during key/envelope rollout.
5. Require every active supported device to acknowledge V2 verification before V1 retirement. Quarantine/upgrade unsupported devices under an approved policy; do not silently count them healthy.
6. Require `eventId` and dedupe every type, including `REFRESH_WEB`, `CHECK_FOR_UPDATES`, `SYNC`, game/cue events, and reload-causing commands. Persist a bounded ledger across reloads.
7. Replace SSE query JWTs with single-use 30-second tickets or an authenticated fetch stream. Apply the central origin allowlist; never reflect arbitrary origin with credentials.
8. Add `EmergencyCapabilityGuard` that reads the current user/tenant/role/`canTriggerPanic` row for every trigger and all-clear. Define tri-state revocation-store semantics; emergency/admin writes fail closed if both stores are unavailable.
9. Propagate one correlation ID from trigger → audit/outbox → Redis → player verification → acknowledgement.

**Acceptance/metrics:** tampered, stale, wrong-scope, revoked-key, reused-event, and foreign-origin requests fail; valid messages pass on WebKit/Chromium83/current/Android. Mixed V1/V2 replay, rollback, offline-return, and key-overlap tests pass. A physical mixed-fleet trigger/receipt/all-clear drill is retained before V1 retirement, and 100% of active supported devices acknowledge V2. Emergency command receipt p95 <2 seconds; exactly-once player action; permission revocation effective immediately.

### §2 — storage, assets, offline cache, USB, floor plans, media

**Current truth:** image optimization, EXIF removal, asset hashes, service-worker tiers, and private signed floor-plan URLs are useful. USB is broken, the “1 GB emergency floor” is not a real reservation, eviction is insertion-order, null hashes are accepted, legacy floor-plan signing fails open, and videos lack a durable transcode pipeline. Asset help promises Trash/export/permissions that do not exist; deletion is immediate and destructive.

**Build instructions:**

1. Complete W0-04 and use the same bundle contract for API, CLI, and Android.
2. Add `AssetRevision`, `AssetRendition`, `AssetUsage`, `AssetDeletion`, and `MediaJob` models. Preserve originals according to a published policy.
3. Upload → virus/type validation → metadata extraction → image renditions or H.264/AAC transcode → thumbnail/poster → hash → READY. Use durable jobs, bounded retries, poison-file quarantine, and per-device codec variants.
4. Replace hard delete with dependency-aware soft delete and 30-day Trash only if that policy is actually chosen. Show impacted playlists/screens; restore must reconstitute references. A separate audited purge performs storage deletion.
5. Request persistent browser storage; expose quota/persistence; reserve emergency headroom on native Android app-private storage. Reject emergency readiness when hashes are missing.
6. Implement durable LRU metadata and protect current, next, emergency, and manifest-required assets.
7. Store floor-plan bucket/path, never a reusable URL; fail closed on signing outage. Enforce one documented role policy and audit upload/replace/delete/placement.
8. Add storage request deadlines, jittered retries, idempotent object names, and egress/latency metrics.

**Acceptance/metrics:** 2 GB low-memory USB/media fixtures do not OOM; corrupt final bundle does not replace good cache; emergency assets survive forced quota pressure; phone video reaches READY and plays on target devices; Trash/restore/purge semantics match help exactly; no signing outage returns a raw object URL.

### §3 — AI provider platform

**Current truth:** three providers, timeout handling, error classification, and some prompt caching exist. Default catalogs are stale; usage is a call counter rather than cost; fan-out can overspend; BYOK decryption failure silently consumes platform credits; UI can show an unhealthy key as Connected.

**Build instructions:**

1. Create a server-owned `AiModelCapability` registry: provider/model ID, lifecycle state/dates, surface capabilities, parameter profile, context/output, price, privacy/region, fallback policy.
2. Resolve models by job (`copy`, `brief`, `structured_board`, `designer`, `vision`, `image`, `translation`) and record the resolved policy.
3. Create versioned `AiCredential` with dedicated `AI_KEY_KEK`/KMS, `keyVersion`, health, last test/error, creator/rotator/revocation metadata. Use dual-read/rewrap rotation.
4. If configured ciphertext is unreadable, return `AI_KEY_UNREADABLE`; never silently spend platform funds. Platform fallback requires explicit tenant policy.
5. Centralize provider error mapping for test and generate paths; audit success and every failure class.
6. Add nightly live staging canaries for every advertised provider/job combination and a retirement-date gate.

**Acceptance/metrics:** every catalog option is runnable; timeout/401/403/404/429/quota/5xx map consistently; corrupt BYOK shows red and burns no platform credits; rotation needs no key re-entry; model retirement produces warning ≥60 days before shutdown.

### §4 — AI feature surfaces and template creator

**Current truth:** copy/rewrite, touch/structured boards, Designer/refine, Concierge context, image generation, alt text, limited translation, and CMS grounding exist. Background removal, TTS, controlled summarization, anomaly detection, SOS transcription, and generative celebrations do not. Long Designer calls are synchronous, not cancelable/durable; partial failures are hidden; resume is localStorage; canvas preview is hard-coded 16:9; raw HTML is not structurally editable.

**Build instructions:**

1. Complete the raw-HTML kill/containment and move the default to `BoardDocumentV2`.
2. Add `AiDesignSession`, `AiGenerationBatch`, `AiGenerationCandidate`, `AiGenerationRevision`, `AiUsageReservation`, and append-only `AiUsageLedger`.
3. `POST /ai/jobs` accepts an immutable request snapshot and idempotency key, returns `202 + jobId`; workers emit progress through SSE/WS. `DELETE /ai/jobs/:id` propagates `AbortSignal` and cancels queued candidates.
4. Reserve worst-case USD micros atomically for all fan-out candidates before dispatch; refund unused reservation after actual token/image usage. Count brief extraction and failures.
5. Persist candidate-level status, provider request ID, resolved model, actual usage/cost, latency, quality warnings, and failure reason. Never silently filter failed candidates.
6. Use shared Zod contracts in `@cms/api-types`; preserve `batchId` through persistence/keep telemetry.
7. Treat Touch/Display/Set/Designer as real modes. Concierge must not force Designer; regeneration must retain references/brand/canvas/mode.
8. Render previews from the requested canvas and orientation, not a fixed 1920×1080 16:9 frame.
9. Add evaluation gates: readability at distance, overflow, contrast, placeholder/data truth, action safety, asset rights, browser/Taurus render, and human approval.

**Acceptance/metrics:** close/cancel stops work; refresh resumes server state; duplicate request dispatches once; 50 concurrent cap-edge calls never exceed budget; every request has a ledger row; portrait/square/LED candidates match canvas; kept candidate joins to batch; zero executable model code.

### §5 — AI competitive parity

VenueOS has a credible differentiator—contextual, multi-vertical, data-grounded signage generation tied to the same CMS/player/emergency platform. The competitive bar has moved:

| Competitor evidence | What they demonstrate | VenueOS gap/response |
|---|---|---|
| [Rise Vision AI](https://www.risevision.com/ai-presentation-design-and-editing-tool-for-digital-signage) | Prompt → three branded, animated, fully customizable presentations → editor → schedule/publish | VenueOS also creates three, but raw Designer output is one HTML zone. Make structured full editing and one-click publish the default. |
| [ScreenCloud Screen Score](https://help.screencloud.com/en/articles/15030044-screen-score-evaluate-and-improve-your-digital-signage-content) | AI grades visual impact, distance readability, text economy, clarity, layout, goal/brand/CTA | Build a pre-publish VenueOS Quality Score using deterministic + AI-assisted checks and a human approval record. |
| [ScreenCloud AI features](https://help.screencloud.com/en/articles/10300880-how-to-use-and-manage-ai-features-in-screencloud) | Summarizes links, documents, images, Slack, and news for signage | Add governed source summarization, provenance, refresh policy, and approval—not generic copy only. |
| [Yodeck Magic Write](https://www.yodeck.com/docs/user-manual/magic-write-ai-copywriting-digital-signage/) | Polish, grammar, translate, tone/brand across plans | VenueOS sparkle is comparable conceptually; make translation/locale variants, RTL, and translation memory complete/reliable. |
| [OptiSigns OptiDev](https://www.optisigns.com/post/optisigns-ise-2026-best-of-show) | AI + drag/drop builds functional kiosk/data apps connected to Stripe, Shopify, BigQuery, SharePoint | VenueOS Concierge must create verified `IntegrationBinding`s, not decorative `data-source` fields. |
| [OptiSigns audience intelligence](https://www.optisigns.com/optisigns-ai) | Local facial detection, demographics, rules, audience analytics | If pursued, use privacy-by-design edge aggregation, explicit consent/policy, retention limits, and no biometric identity. |
| [BrightSign edge AI](https://www.brightsign.biz/solutions/artificial-intelligence/) | NPU-based motion/object/gaze/crowd intelligence and adaptive content | Decide whether VenueOS owns edge intelligence or integrates certified player partners; do not pretend cloud copy AI equals this category. |

**Prioritized gaps:**

- P1: structured editable generation, quality score, semantic asset tagging/search, background removal, smart playlist/schedule recommendations, locale/RTL variants, governed summarization, prompt/eval/version governance.
- P2: AI-generated celebration motion, anomaly intelligence, TTS/SOS transcription, privacy-governed audience/people-count analytics.

**Acceptance:** each claimed AI capability has a named user job, deterministic baseline, model policy, data-retention statement, cost budget, evaluation set, human-control path, and rollback.

### §6 — streaming

**Current truth:** native Safari HLS + `hls.js`, selected YouTube/Twitch/Vimeo embeds, public broadcasters, and custom HLS foundations exist. Manual iframe channel creation drops the URL; templates snapshot playback URLs instead of resolving channels; custom HLS is duplicated/PENDING; M3U upload is fiction; ad slots are schema-only; RTSP/DASH/NFHS/Facebook are absent.

**Build instructions:**

1. Fix manual iframe persistence and backfill URL-from-`externalId` channels.
2. Persist `streamingChannelId`; resolve via device-authenticated, short-lived playback contract. Refresh signed URLs and revoke centrally.
3. Collapse custom HLS into paste → validate → ACTIVE connection+channel → “add to screen” in ≤30 seconds.
4. Implement M3U parsing/upload or remove the claim.
5. Add `StreamPlaybackSession` states, bounded reconnect, backup source/slate, frame/buffer metrics, dashboard health, and player acknowledgement.
6. Add provider-specific sandbox/permissions/CSP and legal review metadata; unknown source is “unverified custom embed.”
7. Use a dedicated credential KEK with rotation.
8. Build stream-as-asset/schedule and ad-slot scheduling only after the resolver is reliable.

**Acceptance/metrics:** YouTube/Twitch/HLS connect-bind-play E2E on Chromium/WebKit; URL rotation without template save; revoked source stops inside SLA; origin failure never leaves black screen; startup/rebuffer/fatal metrics visible. In the consolidated brief, the exhaustive evidence is Part II.E.

### §7 — sports

**Current truth:** the game engine and 19-sport definitions are real. Generic HMAC JSON feed is the only end-to-end external feed. Daktronics is provisional and can default basketball/baseball to football parsing. CTS water polo is strongest; WTTC/swim timing remain partial. Named data providers are not native. Go Live copy overstates screen deployment; game state polls every 750 ms; several state/event/audit steps are not atomic; low-score sports can choose the wrong winner.

**Build instructions:**

1. Close W0-01 before any sports rollout.
2. Replace URL-parameter bridge activation/credentials with manifest-driven active-game binding and device authentication. Derive parser from `Game.sport`; reject unsupported combinations.
3. Build a console wizard with packet detection/preview, serial permission, game binding, reconnect health, and certification labels.
4. Add `Game.revision`, signed `GAME_STATE_CHANGED`, gap recovery, and polling fallback. Measure latency from correlated source receipt to rendered-player acknowledgement; target p95 <250 ms in WS mode.
5. Define `GameSourceBinding` with authority `MANUAL | CONSOLE | PROVIDER`, connection ID, priority, lease/heartbeat, failover policy, operator override, and explicit resume policy. Prevent manual/console/provider oscillation.
6. Define `ScoreFeedEnvelopeV1` with tenant/game/sport, source and source-connection IDs, source event ID/sequence, occurred/received times, expected/current revision, `kid`/signature, payload hash, state, and events. Add receipt uniqueness and per-source monotonic sequence.
7. One atomic `applyScoreCommand()` validates source authority/revision, writes snapshot, GameEvent, AuditLog, receipt, revision, cue intent, and outbox. Use additive migrations, backfill, feature flags, compatibility cohorts, and dual polling/WS rollback; never remove the old path before fleet evidence is green.
8. Bind auto-celebration idempotency to scoring event ID/revision, not a ten-second team heuristic.
9. Replace public/tokenless cue proof-of-play with a signed device/player receipt containing display session, player/screen, score event/cue intent, media/release hash, rendered-at/duration, acknowledgement status, and a database uniqueness constraint. Preview/manual cues do not count as sponsor proof unless an explicit policy says so; intended and acknowledged playback must reconcile.
10. Add `resultMode` to sport definitions and use it for API/board/ribbon/scorebug/a11y.
11. Complete sport-specific operator models in Part II.H; prioritize certified football/basketball/baseball, water polo, swimming/diving, then long-tail sport-authentic workflows.
12. Create explicit build-or-decline decisions for Sportzcast, Scorebird, Genius Sports, Sportradar, MaxPreps, and GameChanger. Any built adapter needs licensed/supported access, credential vault, signed webhook or cursor poller, rate-limit handling, team/game identity mapping, source priority, idempotency/reconciliation, revoke/disconnect, health canary, and fixtures. Never substitute scraping when no partner API exists.
13. Mark integrations `NOT_BUILT`, `Experimental`, `Beta`, `Hardware-certified`, or `Production-certified` with supported model/transport/sport, last evidence date, and limitations. `NOT_BUILT` remains the customer truth until contract/sandbox fixtures pass.

**Acceptance/metrics:** no URL secrets; restart restores console; exact sport parser; concurrent manual+feed writes honor source authority; stale/reordered state cannot roll back; failover/recovery and explicit operator takeover do not oscillate; revisions remain monotonic across replicas; one cue per score event; unauthenticated/replayed/concurrent proof-of-play cannot increment evidence and recording failure is not returned as success; exactly one receipt exists per cue+screen; correlated source-receipt-to-player-render p95 meets target; captured packet/provider fixtures and venue sign-off precede certification; the 19-sport scorecard has no C/D launch-grade functionality.

### §8 — POS and commerce integrations

**Current truth:** Square, Clover, Lightspeed X-Series, Shopify, Square webhooks, custom webhooks, and hourly sync are substantive. Toast/Stripe Catalog/Mindbody are partner/unbuilt; Aloha is manual. Shopify realtime claim is ahead of code. Template `posProvider` selection is ignored at runtime; all menu boards are forced live even if Static; BYO `{{pos.item}}` tokens have no resolver; many HTML `data-source` values are decorative.

**Build instructions:**

1. Add `IntegrationBinding(templateId, zoneId, providerConnectionId, capability, fieldMap, fallbackMode, lastVerifiedAt, version)`.
2. Runtime resolves the exact selected connection; honor OFF/Static with zero POS requests.
3. Disable non-DIRECT and unconnected choices. A partner tile can request access but cannot create a “connected” state.
4. Bind by stable external ID, not fuzzy display name; expose category/item mapper and unresolved-field report.
5. Show freshness, sync status, last good snapshot, item-level errors, and fallback mode on every board.
6. Modernize Shopify to supported GraphQL/webhooks; implement durable cursor jobs, inventory/availability, daypart/promotions, and multi-location selection.
7. Label unsupported KDS/Opera/Epic/G Suite/OpenTable/Mindbody/loyalty/ATS/reviews/kiosk boards “Sample data.”

**Acceptance/metrics:** contract sandbox per DIRECT provider; two connections select the right feed; Static performs zero requests; exact name/price/availability changes reach screen within measured SLA; stale feed visibly falls back; provider dashboard reconciles item/error counts.

### §9 — communications

**Current truth:** Resend email works and fails honestly when unset. Signed SSRF-pinned emergency webhooks with durable retry exist, but only trigger/clear events are allowed. Twilio SMS/voice, SendGrid, APNs/FCM, Slack, Teams, PagerDuty/OpsGenie are not built. Settings copy is stale.

**Build instructions:**

1. Create `NotificationEndpoint`, `NotificationPolicy`, `EscalationStep`, `NotificationEvent`, `DeliveryAttempt`, and dead-letter state.
2. Use a transactional outbox; event ID/delivery ID remain stable through retries and signatures.
3. Implement channels behind capability flags with consent, recipient verification, quiet hours, per-severity routing, templates, rate limits, and test mode.
4. Build delivery timeline UI: queued, attempted, provider accepted, delivered, failed, dead-letter, acknowledged.
5. Expand event taxonomy only with real producers/consumer contract tests.
6. For life safety, define and drill escalation policy separately from marketing/transactional messaging.

**Acceptance:** simulated incident fans out screen/email/SMS/push/webhook as configured; process death does not lose delivery; duplicate receiver effect is impossible; unsupported channels cannot be enabled; audit/correlation link every attempt.

### §10 — authentication and identity

**Current truth:** Argon2id, JWT revocation, sessions, roles, TOTP, and backup codes are meaningful. SAML always returns 503 because the library is removed; generic OIDC is real but marketing suggests preconfigured Google/Microsoft buttons. Clever syncs only first-page users and does not implement the resources/webhooks help promises. WebAuthn is absent. Default `express-session` is process-local.

**Build instructions:**

1. Remove SAML claims immediately, then either implement a maintained SAML stack or explicitly decline it. Required: signed requests/assertions, metadata/certificate rotation, audience/recipient/clock checks, replay store, wrapping-attack fixtures, logout/deprovision policy.
2. Ship tested OIDC presets for Google Workspace, Entra ID, and Okta with discovery fail-closed. Never return a dead stub client after discovery failure.
3. Put session state in Redis or use encrypted one-time transaction cookies; cross-replica login must work.
4. Add passkeys/WebAuthn with recovery, device naming, attestation policy, and audit.
5. Paginate Clever; model users/schools/sections/terms only as each is actually implemented. Apply disable/delete reconciliation rather than merely count it.
6. Ensure role, disabled-user, tenant membership, and panic capability revocation take effect across HTTP/WS/SSE without re-login.

**Acceptance:** real Google/Entra/Okta test tenants; SAML IdP suite if claimed; >1,000 Clever users with create/update/disable; role/panic revoke immediate; login initiated on replica A completes on B; passkey/backup recovery tested.

### §11 — billing, licensing, and commercial lifecycle

**Current truth:** Stripe Checkout, Portal, invoices, webhook event ledger/order guards, audit, seat reconciliation, comp seats, and SAQ-A boundaries are good. Public price/trial/seat values conflict across five sources. No-license tenants receive a perpetual 1,000-screen ACTIVE pilot; activate-trial is informational. Help invents PO/refund/grace/deletion behavior.

**Build instructions:**

1. Create server-owned `PlanCatalog`, `PlanVersion`, `Entitlement`, `EntitlementOverride`, and lifecycle `TRIALING → ACTIVE → PAST_DUE → GRACE → CANCELLED`.
2. Include start/end, trial end, seat limit, cadence, Stripe IDs, feature/integration policy, PO eligibility, grace, source, override owner/reason/expiry.
3. Public pricing, signup, `/license/tiers`, billing UI, checkout, invoices, emails, and help render the same API contract.
4. Make internal 1,000-seat pilot an explicit expiring override—not a missing-row default.
5. Before deny-by-default enforcement, inventory every tenant, deterministically backfill the intended entitlement/override, and run shadow-mode parity reports against current effective seats/features. Reconcile 100% of active tenants, including internal/demo/pilot exceptions, with accountable product/support sign-off.
6. Roll enforcement behind tenant cohorts and a feature flag. Provide an audited, time-limited support break-glass override, migration abort thresholds, and a tested rollback that restores the prior decision path without losing entitlement data.
7. Add customer-visible failed-payment/dunning timeline, banner, email, grace enforcement, recovery, and support escalation.
8. Build real PO/invoice approval and refund/credit-note paths or remove all claims and UI affordances.
9. Reconcile Stripe quantity, paired seats, entitlement, invoices, and overrides daily with alert/audit.

**Acceptance:** contract tests compare every surface; Stripe Test Clock proves trial/dunning/recovery/cancel; deterministic backfill plus shadow reporting reaches 100% active-tenant reconciliation before deny-by-default activates; staged enforcement and break-glass/rollback drills pass; only then does a missing entitlement deny production access. Duplicate/out-of-order webhooks are safe; pairing cannot oversubscribe; refunds/PO reconcile if shipped.

### §12 — design imports

**Current truth:** PPTX/PDF/image parsing, size/decompression caps, and a creator UI exist. Legacy `.ppt` is incorrectly treated as PPTX; raw presentation assets can be inserted into a playlist although unplayable; PDF extracts text but not faithful graphics while UI promises editable text/images and fallback. Canva, Google Slides/Drive, Microsoft Graph, Figma are absent; Keynote is manual export.

**Build instructions:**

1. Reject binary `.ppt` or convert inside a locked-down LibreOffice sandbox with CPU/memory/time/network limits.
2. Replace synchronous import with `ImportJob`: upload/scan → parse → render pages → fidelity diagnostics → user preview → atomic commit.
3. Always rasterize a faithful page background, then overlay extracted editable elements. Never call text-only extraction a complete import.
4. Do not create a playlist item from raw PPT/PPTX. Create renderable page assets/scenes after success.
5. Add golden fixtures for masters, groups, charts, tables, themes, custom fonts, transparency, cropping, notes, animations, multi-page PDFs, corruption, and decompression bombs.
6. Add source-link/re-sync only after real OAuth/provider adapters exist. Label Canva/Drive/Graph/Figma as N/A until then.

**Acceptance:** screenshot diff below declared threshold; every failure yields a renderable image fallback or an explicit abort; no unplayable raw presentation reaches a player; import survives worker restart and is idempotent.

### §13 — public alerts

**Coverage status:** N/A—not built. CAP, IPAWS inbound, IPAWS origination, Raptor SOS, RapidSOS, Valcom/Atlas/SingleWire are not shipped. The EULA accurately says VenueOS is supplementary and not a replacement for primary life-safety systems.

**Recommended build order:**

1. Canonical `IncidentEvent` aligned with CAP 1.2: identifier/sender/sent/status/msgType/scope/references/info/area/resource, geofence, expiry, language, severity/certainty/urgency.
2. Signed inbound CAP parser, schema validation, dedupe/replay, update/cancel references, geofence, expiry, and human review policy.
3. IPAWS test-feed consumption only after FEMA program/legal requirements are understood.
4. Partner adapters for Raptor/RapidSOS with sandbox drills and contract ownership.
5. PA/IP-speaker bridge last, with site-specific installation/certification.
6. Do not originate IPAWS unless VenueOS becomes authorized and the legal/operational decision is explicit.

**Acceptance before any claim:** FEMA sample/negative corpus, signature/replay/geofence tests, partner sandbox and physical drill, immutable incident transition audit, fail-safe behavior, documented role in the site safety plan.

### §14 — multi-vertical product depth

**Current truth:** 12 verticals have labels, alerts, sample URLs, template tags, nouns, and AI voice concepts. `DistrictSchoolsCard` computes but ignores vertical copy; sample seeding skips all repair when either POS or streaming exists; several verticals map provisionally to others; brand bulk apply is destructive with no rollback; pricing/help/nouns retain EDU assumptions.

**Build instructions:**

1. Define one canonical `VerticalProductProfile`: nouns, roles, dashboard jobs, templates, data capabilities, integrations, sample seed modules, AI voice/archetypes, emergency defaults, billing plan names, onboarding copy.
2. Either use universal “Location” terminology consistently or actually render the profile nouns; delete dead contradictory maps.
3. Seed each capability independently/idempotently through durable jobs. A partial prior seed must self-heal.
4. Require at least five approved flagship jobs per launch vertical before marketing it. Provisionally mapped verticals remain Beta/hidden.
5. Brand application becomes token binding plus preview/dry-run/contrast check/versioned batch/rollback—not destructive literal replacement.
6. Audit every route/email/help/empty state for EDU-only language under sports/QSR/retail/corporate tenants.

**Acceptance:** one generated test tenant per vertical completes signup → onboarding → first board → publish with correct nouns/data/templates/plan/AI tone; seeding reruns safely; brand batch rollback restores exact prior version.

### §15 — cross-browser, Chromium 83, and Android

**Current truth:** WebKit holiday checks and Taurus static scans are valuable. The Taurus baseline tolerates roughly 1,195 `gap` and 1,037 container-query hits; active HTML receives only a narrow scan; CI does not run exact Chromium 83 or a Taurus device; Firefox/full catalog are absent; Android CI assembles without player tests.

**Build instructions:**

1. Freeze baseline increases. Burn unsupported CSS/JS debt down by player-shipped surface; keep only issue-linked audited exceptions.
2. Run the complete active template/widget registry through the full scanner, not an 18-template/narrow subset.
3. Add archived Chromium 83 execution in a container with DOM, screenshot, console, and video playback assertions.
4. Add nightly current Chromium/WebKit/Firefox authenticated route and full-template sweeps; keep a risk-based PR subset.
5. Add a nightly/weekly real Taurus canary for pair, manifest, template render, emergency override/all-clear, OTA, HLS, and cache.
6. Add JVM contract tests and Android emulator/device-lab coverage on Android 7/9/13 and WebView 83/current for pair/offline/USB/OTA/emergency.
7. Every template release declares minimum runtime and produces engine/orientation artifacts.

**Acceptance/metrics:** a known unsupported fixture fails exact-browser/device jobs; no baseline rises; 100% published templates have current Chromium/WebKit/Chromium83 results; Android workflow runs tests rather than assemble only.

### §16 — forensic audit and tenant isolation

**Current truth:** `AuditLog`, many explicit actions, and UPDATE/DELETE immutability exist. Coverage is inconsistent/swallowed and often nontransactional; TRUNCATE remains possible; webhook retries lack stable IDs; tenant scope depends on controller convention; consistency repair is manual.

**Build instructions:**

1. Create a typed `AuditAction` taxonomy and central `AuditWriter` requiring actor, tenant, target, before/after summary, reason, correlation ID, source, and sensitivity.
2. For sensitive writes, mutation + audit + outbox occur in one database transaction. Audit insertion failure rolls back the mutation.
3. Maintain a machine-readable mutation-to-audit manifest; CI fails when a privileged controller route lacks an action/test.
4. Block TRUNCATE; restrict API DB role to INSERT/SELECT on audit; use separate retention role and chain-hashed/WORM export.
5. Add deny-by-default resource authorization and typed tenant-scoped repository methods. Ban unscoped `findUnique(id)` for tenant resources.
6. Add property/generated cross-tenant tests to every route and object identifier.
7. Persist stable event/delivery IDs through webhooks and score/control events.
8. Add leased scheduled consistency jobs for license/Stripe, coordinates, template release/assets, connection health, and orphaned references.

**Acceptance:** every privileged success creates exactly one row; forced audit failure rolls back; API role cannot update/delete/truncate; tenant-A tokens cannot read/write/probe tenant-B objects; one correlation ID traces the full effect.

### §17 — operations, DX, architecture, and observability

**Current truth:** health endpoints, dependency audit, deploy reliability, restarts, pool guidance, required secret checks, and production smoke are strong. Yet lint/E2E are false-green, fatal exceptions keep serving, sessions/background locks are process-local, boot does raw DDL, integration health is configuration-based, backups/restores are manual, telemetry redaction/correlation is shallow, and the largest modules are extreme monoliths.

Largest hotspots:

- `PropertiesPanel.tsx` — 11,026 lines.
- player page — 8,585.
- sports console — 8,372.
- `sports.service.ts` — 5,880.
- `ai.service.ts` — 5,794.
- `WidgetRenderer.tsx` — 5,351.
- template gallery — 4,932.
- board page — 4,637.
- `use-api.ts` — 4,176.
- screens controller — 3,782.

**Build instructions:**

1. Close W0-05/06 and add gate self-tests—a broken linter/test collector must fail before reporting success.
2. On uncaught exception/rejection: capture/flush telemetry, mark not-ready, drain, exit nonzero; never continue in unknown state.
3. Move sessions to Redis or stateless transaction cookies.
4. Replace correctness-critical local maps/timers with durable queues, DB/Redis leases, CAS, and unique run keys.
5. Remove runtime DDL; migrations only. Check schema version before listen/readiness.
6. Integration health states become `UNCONFIGURED`, `CONFIGURED`, `VERIFYING`, `VERIFIED`, `DEGRADED`, `REVOKED`; VERIFIED requires a recent real operation/canary.
7. Schedule encrypted off-provider DB/object metadata backup, checksums, retention, missed-run alerts, and quarterly isolated restore drills with RPO/RTO.
8. Validate all environment variables through one typed boot schema; enforce key separation.
9. Recursively redact secrets/PII/URL query values and propagate correlation IDs through HTTP/events/webhooks/player ack.
10. Split monoliths by bounded context before adding behavior. Establish size/complexity limits, dependency direction, contract tests, and code owners. No new feature should add another branch to the 11k-line panel.

**Acceptance/metrics:** two replicas produce one logical cron/action; fatal fault restarts once; migrated DB boots with zero DDL; invalid integration credentials show DEGRADED; quarterly restore meets RPO/RTO; source hotspots decrease sprint over sprint; no new file >1,000 lines without design review.

### §18 — accessibility

**Current truth:** emergency live regions, keyboard panic hold, all-clear focus trap, and non-color-only map labels are good. Enforcement is broken; baseline tolerates 99 errors; templates page disables multiple rules; axe largely sees unauthenticated shells and can empty-pass on load failure; shared/emergency dialogs and floor-plan editing are incomplete.

**Build instructions:**

1. Close W0-05 first.
2. Authenticate the axe runner with seeded state; enumerate dashboard, templates, builder/modal states, screens, floor plans, sports, billing, settings, panic/override/all-clear. Fail on redirect/load error/zero target.
3. Run Chromium and WebKit. Add keyboard journeys, not only static axe scans.
4. Burn baseline to zero; only narrow issue-linked suppressions with owner/expiry.
5. Replace `AppDialog` and emergency modal with audited WAI-ARIA primitives: name/description, initial focus, trap, inert background, return focus, nested stack, safe dismissal.
6. Make floor-plan placement/movement/detach keyboard-accessible with arrow/coarse movement and a list/form alternative announcing coordinates/state.
7. Add WCAG AA brand contrast validation and color-blind-safe map/score states.
8. Player emergency messages have live-region priorities that do not become repetitive/noisy; test with VoiceOver and NVDA.

**Acceptance:** zero blocking axe/JSX errors, no file-wide disables, keyboard-only task completion for every core flow, screen-reader emergency test, brand palettes cannot save below contrast threshold.

### §19 — templates and widget editability

**Current truth:** quality is mixed. The production review ledger lists 81 HTML templates with none approved; 133 active templates are one `EXTERNAL_HTML` zone; 55 use remote fonts; 17 lack posters; 20 have unfinished dimension content; some clip; demo-only Domino’s IP is active. Native widgets are generally more editable, but HTML/AI/data widgets vary. Template save/clone is non-atomic.

The widget registry has 702 registration attempts but only 701 unique global IDs because `retail-loyalty-qr` is silently overwritten. At least 45 concrete V2 variants expose high-confidence ghost or materially wrong friendly controls. Generic V2 array editing corrupts object arrays and numeric KPI trends; iframe boards do not inherit parent brand CSS variables; missing variant IDs silently render a fallback without persisting repair; and AI HTML hook coverage is requested but not enforced. The packaged HTML editor catalog has 113 rows/112 unique URLs, 4,044 discovered text keys, 161 image keys, zero action keys, and 35 offered boards with remote fonts. Part II.I contains the exhaustive family-by-capability matrix and exact remediation contract.

#### Catalog-universe definitions—do not mix these denominators

| Universe | Audit count | Definition / regeneration source | Which gate uses it |
|---|---:|---|---|
| Source presets | 300 unique | Unique preset IDs exported through the API system-preset registry; institutionalize the audit census as a new script under `scripts/` (suggested name `audit-template-catalog.ts`) and fail on duplicates | Source reconciliation and duplicate-ID gate |
| Active DB system presets | 297 | Query `Template` with the exact system/active predicate used by the gallery API | Legacy inventory and migration/backfill only |
| Active DB `EXTERNAL_HTML` presets | 133 | Active-system query joined to zones whose persisted type is `EXTERNAL_HTML` | Legacy-format migration/quarantine |
| Packaged editor dropdown | 113 rows / 112 URLs | `SIGNAGE_TEMPLATES.length` and unique URL count in `apps/web/src/components/widgets/signage-templates.ts` | Editor source-mode and packaged-board contract tests |
| Review-ledger boards | 81 | Parse the customer-facing rows in `docs/template-finalization/PROGRESS.md` | Interim human visual-review queue |
| Active remote-font templates | 55 | Scan HTML referenced by the active DB external-board universe for remote font origins | Active-fleet offline remediation |
| Offered remote-font boards | 35 | Scan the 112 unique packaged dropdown URLs for remote font origins | New-use editor/catalog release gate |
| Published/released templates | No durable universe yet | Future `TemplateRelease.state=PUBLISHED`; until it exists, only the explicit interim allowlist is eligible for new use | The actual customer release and “100% published” acceptance denominator |

Every automated report must emit the query/commit/timestamp and name its universe. Never divide an acceptance count by “all templates” without choosing one row above.

**Build instructions:**

1. Implement `TemplateRelease` with DRAFT/QA/APPROVED/PUBLISHED/QUARANTINED/RETIRED, rights/license, reviewer, visual hashes, capabilities, offline manifest, supported canvases, editability score.
2. Only PUBLISHED appears in the gallery. Registry reconciliation cannot publish.
3. Implement `BoardDocumentV2`; raw HTML is a labeled legacy format, never default AI output.
4. Add atomic `PUT /templates/:id/document` and `POST /templates/:id/duplicate` preserving metadata, zones, scenes, actions, data bindings, touch, revision, and snapshot.
5. Each widget release must expose:
   - text/content/typography/alignment/line-height;
   - image/media replace/fit/position;
   - background solid/gradient/image;
   - clock/countdown complete semantics;
   - list/menu/chart add/remove/reorder/bind;
   - x/y/w/h/rotation/z/opacity;
   - brand token presets;
   - live binding/freshness/fallback.
6. Explicitly distinguish an editor control that actually changes runtime from generic auto-form or nonexistent metadata. Add a click/edit/save/reload/player assertion for each field.
7. Self-host licensed fonts and require an offline asset manifest.
8. Redesign the gallery around operator jobs/canvas/integrations and show editability/live/sample/offline/last-verified badges.
9. Use the one-template 3–5 mockup → approval → fixed-canvas React port → live screenshot loop. Prefer 50 excellent releases over 297 active drafts.

**Acceptance:** every PUBLISHED template is rights-cleared, approved, at least an unqualified B in every required editability dimension, postered, offline-ready, placeholder-free, browser/canvas tested, and capability-truthful. Any D/F critical dimension blocks release and cannot be averaged away. In the consolidated brief, the visual/rights ledger is Part II.G and the exhaustive widget editability matrix is Part II.I.

### §20 — top-to-bottom design, UX, and functionality

The product needs task-level experience ownership, not page-level polish alone. Apply these instructions to every operator-facing route:

#### Public site, signup, and help

- One capability/plan contract; no hard-coded parallel truth.
- Publish only verified claims, with honest Beta/Coming Soon labels.
- Signup states exact trial, seat, billing, role, and next step.
- Help is generated/validated against capability IDs and API behavior; stale article blocks release.

#### Onboarding and dashboard

- Choose a first job from vertical profile; auto-seed idempotently; take operator directly to a working branded board.
- Dashboard prioritizes: screens needing action, content expiring, failed data integrations, approvals, and next recommended task. Avoid vanity counts without remediation.
- Every error has owner-readable cause, last-success time, and one recovery action.

#### Assets

- Upload progress/job states, preview/fidelity, usage count, rights metadata, semantic search/tags, renditions, versioning, Trash/restore if promised.
- Enforce one set of size/type limits in API, UI, and help.

#### Playlists and schedules

- One “create → target → preview → conflict review → publish” transaction.
- Visual schedule conflict/displacement preview, target-screen proof, rollback, approval, and go-dark safety.
- Remove nested-playlist documentation until the schema supports it.

#### Screens/fleet

- One-time expiring pairing code/QR with attempt limits and exact device binding. Current codes have no expiry.
- Hardware/canvas/orientation auto-detect, health timeline, last good manifest, cache/emergency readiness, integration status, remote action audit.
- Fleet batch action includes preflight, staged rollout, progress, failure isolation, retry/rollback.

#### Emergency

- Preserve fast hold/typed confirm and obvious all-clear.
- Add live permission check, device signature, exact event idempotency, accessible dialogs, target summary, drill mode, acknowledgements, and operator after-action report.

#### Templates/builder/AI

- Task-first curated gallery; structured editor; atomic save; durable AI job; data binding; quality score; one-click target/publish.
- Nontechnical operator should edit visible text by clicking it; never expose ghost JSON/meta controls.

#### Integrations/settings

- One catalog with capability status, setup requirements, verified health, last sync, affected screens/templates, disconnect impact, test action, and support path.
- “Connected” requires a successful canary, not a row.

#### Sports

- Game creation defaults by sport, recent teams/venues, scheduled time, screen preflight, console/feed wizard, realtime operator feedback, undo/replay protection, postgame summary.
- No generic sport skin marketed as complete when its scoring model is missing.

#### Mobile and accessibility

- Core jobs within one-handed navigation; no desktop-only controls; 44px targets; offline/reconnect feedback.
- Keyboard/screen-reader parity is part of the same acceptance test, not a later audit.

**Standing UX gate:** every feature names one happy path a non-IT operator completes in ≤30 seconds/a handful of clicks, records the click path and timing, and has a Playwright/browser artifact. If setup necessarily exceeds 30 seconds—hardware bridge, SAML—provide a guided checklist with auto-detection and explicit handoff, not a misleading one-click claim.

### §21 — verification-before-claim

**Current truth:** the repository contains a strong written rule, but structural enforcement is missing. A July “10/10 launch-ready” report predates/rejects current evidence: lint and Playwright can be green without running, USB is incompatible, dead models exist, and product-help claims are false.

**Build instructions:**

1. Create `CapabilityRegistry` with owner, state, evidence tests, production canary, documentation/marketing claims, last verified commit/date, supported environments, and limitations.
2. CI checks that `SHIPPED/VERIFIED` capabilities have passing evidence; `COMING_SOON/N/A` cannot render a working green action.
3. Test collectors publish test counts/skips; zero tests, config crash, redirect, or missing artifact is red.
4. Deployment verification records commit → Vercel/Railway ready → health → authenticated smoke → player/canary → rollback decision.
5. No report can say fixed/shipped/live based on code inspection alone. Use one §21 proof artifact and link it.
6. Separate `CODE_COMPLETE`, `STAGING_VERIFIED`, `PRODUCTION_VERIFIED`, and `HARDWARE_CERTIFIED` states.

**Acceptance:** every customer claim and release note resolves to a current capability evidence record; stale verification expires; CI cannot empty-pass; production and hardware status are never inferred from unit tests.

## Cross-cutting architecture the team should converge on

The same root problems repeat across AI, sports, streaming, POS, webhooks, imports, templates, and device control. Fix the classes once.

### 1. Capability registry

One typed server-owned registry drives marketing/help, integration tiles, feature flags, plans, onboarding, health, and QA status. Required states:

```text
NOT_BUILT
INTERNAL
EXPERIMENTAL
BETA
CONFIGURED
VERIFIED
PRODUCTION
HARDWARE_CERTIFIED
DEPRECATED
RETIRED
```

Each record includes owners, supported verticals/environments, limitations, dependencies, test/canary IDs, review expiry, and public copy. This eliminates “Coming soon wearing a real-button costume.”

### 2. Versioned command/event envelope

Emergency, sports, screen commands, webhooks, and integration changes use one pattern:

```text
schema + eventId + correlationId + tenant/scope + source
revision/sequence + occurredAt/issuedAt/expiresAt
idempotency key + payload hash + keyId/signature
```

Persist receipt, state change, audit, and outbox transactionally. Consumers dedupe and gap-recover.

### 3. Durable job/outbox platform

AI generation, media transcode, imports, integration sync, notifications, template QA, sample seeding, and fleet rollout need the same durable primitives:

- job/request snapshot;
- idempotency key;
- reservation/budget;
- attempts/backoff/dead-letter;
- progress/cancel;
- worker lease;
- output revision;
- audit/correlation;
- operator status/retry.

Do not build more in-process timers/maps for load-bearing work.

### 4. Structured design document

`BoardDocumentV2` becomes the stable contract between AI, builder, imports, template releases, player, and data integrations. It is versioned, validated, structurally editable, and rendered by trusted code. Raw HTML is a legacy/isolated import—not the core design model.

### 5. Integration binding and health

Every live widget uses an explicit binding to a connection and capability, with field map, version, fallback, last verified/success, and health. A decorative string such as `data-source="epic"` is not an integration.

### 6. Revisioned transactional documents

Templates, games, schedules, brand batches, and fleet changes use optimistic revisions and one server transaction. Multi-call “save” flows are replaced with complete document/command endpoints. Conflicts are surfaced; version history is reliable.

### 7. Truthful release artifacts

Templates, integrations, providers, hardware profiles, plans, and public claims each have a release manifest and evidence artifacts. Code registration alone never means publication/certification.

## Sequenced delivery plan

### Wave 0 — 0–3 days: containment and truth

- W0-01 through W0-09.
- Rotate/revoke secret; incident review.
- Disable unsafe AI raw Designer.
- Replace dead model defaults.
- Disable broken USB path.
- Repair lint/test collectors.
- Correct product/help claims.
- Quarantine unapproved/IP-risk templates.
- Disable unsafe AI fan-out until atomic dollar reservation is enforced.

**Exit gate:** no known active credential/security exposure; CI fails honestly; customer-visible claims are not materially false; broken features are disabled/labeled.

### Wave 1 — days 4–14: trust foundations

- `ControlEnvelopeV2`, device keyring, universal dedupe, SSE ticket.
- Emergency live capability guard.
- Durable job/outbox/idempotency foundation.
- Central `AuditWriter`, correlation ID, tenant repository guard.
- Typed environment schema/session store/fatal shutdown.
- `CapabilityRegistry` and `PlanCatalog` schemas.
- Root E2E seeded environment and life-safety journey.

**Dependencies:** security design review before key/envelope migration; migration/rollback plan; two-replica test environment.

**Exit gate:** exact-once signed commands, cross-replica auth/session, transactional audit/outbox, real blocking E2E, server-owned plan/capability truth.

### Wave 2 — weeks 3–6: creator and content quality

- `BoardDocumentV2` schema/renderer/editor bridge.
- AI jobs/sessions/ledger/credential KMS/provider registry.
- Atomic template save/duplicate/version.
- `TemplateRelease` and interim catalog quarantine.
- Asset/media job pipeline, renditions, Trash/version/usage.
- Full template screenshot/browser/offline/rights QA.
- Task-first gallery and one-click first-board publish.
- Fix POS connection binding and streaming channel resolver.

**Exit gate:** no executable AI code; generation is durable/accounted; 25–50 approved flagship templates; every published template ≥B editability and verified; asset/video lifecycle reliable.

### Wave 3 — weeks 7–10: integrations and commercial lifecycle

- POS exact binding, Shopify modernization, inventory/daypart/freshness.
- Streaming health/failover/custom-HLS happy path.
- Notifications policy/delivery timeline and selected channel adapters.
- OIDC presets/session hardening; Clever pagination/reconcile; SAML decision/implementation.
- Plan/trial/dunning/PO/refund truth and UI.
- Import jobs/fidelity/golden decks.
- Integration VERIFIED canaries/dashboard.

**Exit gate:** every green integration proves a recent operation; pricing/trial contract identical everywhere; direct provider E2Es; no advertised dead connector.

### Wave 4 — weeks 11–16: sports, hardware, and enterprise certification

- Manifest-driven console setup, feed envelope, game revisions/WS, atomic commands.
- Real Daktronics/CTS capture/certification and on-device tests.
- Finish top-priority sport operating models and low-score semantics.
- Exact Chromium83/Taurus and Android device-lab matrices.
- Automated backups/restores, multi-replica chaos, fleet staged rollout.
- First CAP/partner research only if product strategy approves; no premature public claim.

**Exit gate:** named hardware profiles certified with dates/fixtures; sports p95 targets; physical readability sign-off; Taurus/Android emergency/offline drills; restore RPO/RTO proven.

## Non-delegable Definition of Ready

AI development agents may analyze options and prepare ADR drafts, but they must not invent business, legal, licensing, privacy, or life-safety policy. Before an affected implementation begins, require a named accountable human approver, dated decision, and accepted ADR for:

- pricing, trials, seats, legacy-tenant migration, and break-glass entitlement policy;
- whether SAML is shipping, deferred, or removed from claims;
- asset retention, Trash/restore, legal hold, and purge timing;
- durable queue, object-storage, session-store, and key-management architecture;
- public-alert authorization/partner strategy;
- minimum supported browser/player/device/firmware floor and offline-device retirement policy;
- font, template, logo, image, and customer-brand licensing/provenance;
- emergency availability versus fail-closed behavior for each dependency-outage state.

The ADR must identify the decision owner, alternatives, safety/privacy impact, migration cohorts, rollback, evidence expiry, and reconsideration trigger. If the decision is missing, the agent may build a reversible spike or containment flag but may not silently choose policy or expose the capability to customers.

## Development-team work-package backlog

Use these as epics/issues. Each row has exactly one priority and must include the exact acceptance gates from its domain section.

| ID | Priority | Work package | Primary owner | Dependencies |
|---|---:|---|---|---|
| SEC-001 | P0 | Sports secret rotation/revocation/history/log review | Security/Ops | None—immediate |
| SEC-002 | P0 | Kill/contain AI raw HTML + action channel | AI/Player security | Feature flag |
| REL-001 | P0 | Repair ESLint/a11y and pipeline exit status | Frontend platform | None |
| REL-002 | P0 | Repair Playwright collection and life-safety E2E | QA/Platform | Seed environment |
| USB-001 | P0 | Unified USB schema, PIN, atomic ingest | Player/API/Android | Contract generation |
| TRUTH-001 | P0 | Correct public/help claims and install claim registry | Product/Docs/Eng | Capability registry |
| TPL-001 | P0 | Interim template allowlist/quarantine independent of future release schema | Design system/Legal | None—containment |
| AI-001 | P0 | Model lifecycle hotfix and provider canaries | AI platform | None |
| EVT-001 | P1 | Ed25519 ControlEnvelopeV2 and device key rotation | Security/Realtime | Pairing migration |
| EVT-002 | P1 | Universal event dedupe/revision/gap recovery | Realtime/Player | EVT-001 |
| AUTH-001 | P1 | Live emergency authorization + tri-state revocation | Auth/Emergency | Data availability policy |
| AUTH-002 | P1 | Redis sessions, OIDC presets, SAML truth/decision | Auth | Capability registry |
| AUTH-003 | P1 | WebAuthn/passkeys | Auth | AUTH-002 |
| JOB-001 | P1 | Durable jobs/outbox/idempotency platform | Backend platform | DB/queue decision |
| OBS-001 | P1 | Correlation, redaction, verified integration health | Platform/Ops | JOB-001/EVT-001 |
| AUD-001 | P1 | Central audit taxonomy/transactions/coverage | Security/Backend | JOB-001 |
| TEN-001 | P1 | Tenant-scoped repositories and generated isolation tests | Backend security | AUD-001 |
| PLAN-001A | P0 | Decide/correct present pricing, trial, and seat truth; backfill tenants; disable unsafe defaults | Billing/Product | Human pricing decision |
| PLAN-001B | P1 | Durable PlanCatalog/Entitlement lifecycle and staged enforcement | Billing/Product | PLAN-001A |
| AI-002 | P1 | AiCredential KMS, model registry, shared errors | AI platform | AI-001 |
| AI-003A | P0 | Atomic platform-dollar/fan-out reservation cap; disable fan-out until safe | AI/Billing | None—containment |
| AI-003B | P1 | Complete AiUsage ledger, actual-cost accounting, and provider reconciliation | AI/Billing | JOB-001/AI-003A |
| AI-004 | P1 | Durable design sessions/jobs/cancel/resume | AI/Web | JOB-001/AI-003B |
| DOC-001 | P1 | BoardDocumentV2 schema/validator/renderer | Editor/AI/Player | SEC-002 |
| DOC-002 | P1 | Atomic template save/clone/revision/conflicts | Editor/API | DOC-001 |
| TPL-002 | P1 | TemplateRelease, screenshot/offline/rights QA | Design/QA | DOC-001/JOB-001 |
| TPL-003 | P1 | Task-first curated gallery and quality badges | Product/Web | TPL-002 |
| WID-001 | P0 | Quarantine all 45 high-confidence D/F ghost variants or remove misleading controls | Editor/Product | None—containment |
| WID-002 | P1 | Typed WidgetDefinition source of truth, duplicate rejection, generated catalogs | Editor/API | WID-001 |
| WID-003 | P1 | Typed/migrated V2 image, photo, rich-text, sports, touch, object-array, and numeric editors | Editor/QA | WID-002 |
| WID-004 | P1 | Repair EXTERNAL_HTML source mode, brand hooks, POS bindings, and approved actions | Editor/Player | SEC-002/WID-002 |
| AST-001 | P1 | Asset jobs/renditions/hash/usage/version/Trash | Media/API/Web | JOB-001 |
| POS-001 | P1 | IntegrationBinding and exact POS resolver | POS/Editor/Player | DOC-001 |
| POS-002 | P1 | Shopify GraphQL/webhooks/freshness/dayparts | POS | POS-001/JOB-001 |
| STR-001 | P1 | Streaming iframe bug + canonical channel resolver | Streaming/Web | IntegrationBinding |
| STR-002 | P1 | Playback health/failover/telemetry | Streaming/Player | STR-001/OBS-001 |
| COM-001 | P1 | Notification policy/outbox/timeline | Communications | JOB-001 |
| IMP-001 | P1 | Durable faithful PPTX/PDF import jobs | Imports/Media | JOB-001/AST-001 |
| VERT-001 | P1 | Canonical vertical profiles and idempotent seeds | Product/Platform | Capability registry |
| A11Y-001 | P1 | Dialog primitives, authed axe, keyboard journeys | Frontend/QA | REL-001/002 |
| BROW-001 | P1 | Chromium83/current/WebKit/Firefox template matrix | QA/Player | TPL-002 |
| AND-001 | P1 | Android JVM/emulator/device-lab suite | Android/QA | USB-001/EVT-001 |
| SPT-001 | P1 | Manifest console wizard + exact parser binding | Sports/Player | SEC-001/EVT-001 |
| SPT-002 | P1 | Score source authority, envelope, revision, atomic command/outbox, staged migration | Sports/Realtime | JOB-001/EVT-002 |
| SPT-003 | P1 | Sport-authentic depth + hardware certification | Sports/Product | SPT-001/002 |
| SPT-004 | P1 | Provider build/decline gates and supported adapters for six named providers | Sports/Partnerships | SPT-002/licensing decision |
| SPT-005 | P1 | Signed device proof-of-play receipts and sponsor reconciliation | Sports/Player/Billing | SPT-002/OBS-001 |
| OPS-001 | P1 | Migrations-only boot, fatal drain/exit, replica leases | Platform/Ops | JOB-001 |
| OPS-002 | P1 | Automated backup and isolated restore drills | Ops/Security | None |
| DX-001 | P1 | Split monoliths by bounded context | Eng leadership | Contracts/tests first |

## World-class success metrics

### Safety and trust

- Zero active leaked/default production credentials; blocking current/history scan.
- 100% control events device-verified, scoped, fresh, and deduped.
- Emergency target receipt p95 <2 seconds; polling fallback drill passes.
- 100% privileged mutations mapped to transactional audit or explicitly classified nonprivileged.
- Zero cross-tenant generated-test failures.

### Release integrity

- Lint/test/a11y collectors can never empty-pass; zero unexpected skips.
- Root life-safety E2E, auth isolation, publish/player, and billing webhook journeys block every push/PR.
- Exact deployed commit and authenticated smoke artifact attached to release.
- Dependency high/critical = 0; secret scan and container gates blocking.

### Creator and templates

- First useful candidate p95 <30 seconds or a progress/resume experience with honest ETA.
- Cancel success >99%; duplicate idempotency dispatch = 0.
- AI usage ledger reconciles to provider usage/cost within 1%.
- 100% published templates approved, rights-cleared, postered, offline-ready, at least unqualified-B editable in every required dimension, and browser/canvas tested.
- Zero published placeholder/fake-live/remote-font-miss templates.
- Nontechnical first-board happy path ≤30 seconds after onboarding.

### Integrations

- 100% green/VERIFIED connections have a recent real canary timestamp.
- POS/webhook-to-screen p95 SLA declared and measured; stale fallback visible.
- Stream startup/rebuffer/fatal/fallback metrics available per screen.
- No connector/provider marketed as direct without a passing sandbox/production contract.

### Sports

- Score/feed-to-board p95 <250 ms in WS mode; <2 s screen assignment/control.
- One immutable receipt/event/audit/cue intent per score command; zero duplicate cues.
- All 19 sports use correct result semantics and have no D/C launch-grade functionality.
- Hardware-certified profiles include model/transport/sport/date/packet fixtures/venue sign-off.

### Accessibility and UX

- Zero blocking axe/JSX errors; no file-wide suppressions.
- Core operator journeys keyboard/screen-reader tested in Chromium/WebKit.
- Every feature has a named ≤30-second happy path or explicit guided/handoff exception.
- Brand application cannot save a WCAG-failing palette.

### Operations

- Two-replica chaos produces one logical scheduled/event effect.
- Fatal process faults drain/restart; no unknown-state serving.
- Quarterly restore meets declared RPO/RTO.
- No new UI/service file >1,000 lines without architectural approval; current hotspot size trends down.

## Evidence currency and expiration

Evidence is valid only for the artifact and environment it actually tested:

- Security, tenant-isolation, secret-scanning, lint, unit, contract, and CI evidence expires on any relevant code/config/dependency change and must be tied to the exact commit.
- Browser, player, offline, template screenshot, and accessibility evidence expires each release or whenever the renderer/template/runtime/browser floor changes.
- Provider/integration canaries need an explicit SLA/TTL; use 24 hours for operational health unless the provider contract justifies a different period. A stale canary cannot remain green.
- Hardware certification is scoped to model, firmware, transport, sport/profile, player version, and fixture hash; any scoped change invalidates it until replay/venue recertification.
- Backup existence is checked daily; isolated restore proof expires quarterly or after a material schema/storage/encryption change.
- Emergency trigger/receipt/all-clear drills run at least quarterly, before retiring an envelope/key/player version, and after material emergency/realtime changes.

`CapabilityRegistry` and release artifacts must store `evidenceUri`, exact commit/release/device identifiers, `verifiedAt`, `expiresAt`, verifier, limitations, and invalidation reason.

## Required issue format for AI development agents

Every agent task should be issued with this exact structure:

```markdown
Title / ID:
Priority and risk:
Dependencies and sequencing:
Required human decision / ADR / accountable approver:
User job and current failure:
Verified evidence (file:line / runtime artifact):
Scope and non-goals:
Data model / migration:
API/event contract:
UI states (loading/empty/error/partial/offline/permission):
Security, tenant, privacy, and audit requirements:
Idempotency/concurrency/multi-replica behavior:
Telemetry and success metric:
Unit/contract/integration/browser/device tests:
Compatibility cohorts and mixed-version behavior:
Rollout, feature flag, backfill, migration abort thresholds, rollback:
Evidence URI, exact artifact identifiers, and expiry:
Definition of done / §21 proof artifact:
```

Reject agent work that says “implemented” without the proof artifact, that adds a UI control without tracing the runtime consumer, or that adds a provider/template to a registry without a release/capability state.

## Final launch definition

VenueOS can honestly call itself world-class only when:

1. No P0 remains open. No P1 life-safety, security, tenant-isolation, credential, audit-integrity, or data-integrity defect remains open; affected capabilities stay disabled/contained until fixed. Risk acceptance alone does not satisfy launch.
2. Green CI proves real collection/execution, not formatted output.
3. Product/help/pricing claims are generated from verified capability/plan contracts.
4. Every published template is approved, rights-cleared, editable, truthful, offline-capable, and rendered on target browsers/canvases.
5. AI outputs trusted structure, not executable model code; jobs/cost/credentials are durable and governed.
6. Integrations say VERIFIED only after a real canary and expose freshness/fallback.
7. Emergency commands are device-verified and exactly-once with immediate capability revocation.
8. Sports hardware/provider claims have real certification, and every marketed sport has an authentic operator/board workflow.
9. A non-IT operator can perform core jobs in ≤30 seconds and a keyboard/screen-reader user can do the same.
10. Production, multi-replica, device, offline, backup/restore, and rollback evidence is current and attached.

## Embedded evidence map and optional provenance files

The consolidated AI-developer brief embeds every appendix below; use its internal Parts II.A–II.I as the authoritative execution context. The separate files are optional provenance snapshots only:

- Part II.A / `01-core-gate-findings.md` — reproduced USB/lint/E2E blockers.
- Part II.B / `02-ai-template-creator-findings.md` — AI providers, security, metering, jobs, creator/editor details.
- Part II.C / `03-catalog-business-findings.md` — product truth, POS/comms/auth/billing/imports/verticals/catalog/help.
- Part II.D / `04-core-systems-findings.md` — realtime/storage/browser/audit/ops/a11y.
- Part II.E / `05-streaming-findings.md` — streaming truth table and resolver/health specification.
- Part II.F / `06-sports-security-blocker.md` — contained credential incident runbook.
- Part II.G / `07-template-catalog-remediation.md` — visual/editability/release/QA standard and weak-board list.
- Part II.H / `08-sports-findings.md` — 19-sport grades, provider/hardware truth, console/feed architecture.
- Part II.I / `09-widget-editability-inventory.md` — exhaustive widget-family matrix and ghost-control analysis.
