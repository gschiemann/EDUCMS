# VenueOS World-Class Full-App Remediation — Single-File AI Developer Brief

> Complete audit and execution handoff assembled 2026-07-12.
>
> Audit snapshot: `3f274702edb9079417b944749e3eb756a4ea9daa`.
>
> Repository HEAD observed at final handoff: `044eed4dfedeeb54414d50b05ee0ffb5e11936b1`.
>
> This is the self-contained execution document. It embeds the master program and all detailed evidence. Separate appendix files are optional provenance snapshots, not required reading.

## Status semantics

- `OPEN/UNVERIFIED` means no acceptable proof artifact has closed the finding.
- `PARTIALLY COMPLETE` means a bounded sub-action landed but the risk/acceptance contract remains open.
- `COMPLETE` is allowed only when the specified acceptance evidence exists at the exact tested commit/environment/device.
- Later commits do not close snapshot findings by implication; re-resolve symbols and execute the stated tests.

## Instructions to the AI development team

1. Treat every `P0` as a release blocker. Begin with credential containment, unsafe AI HTML isolation, USB incompatibility, real release gates, truthful plans/capabilities, unsafe AI spend fan-out, and catalog/widget quarantine.
2. Never expose, locate publicly, quote, log, or recommit the historic sports signing material. The precise locator stays in the restricted incident record until rotation/revocation is proven.
3. Never hand a root signing key to an integration test. Use only API-issued, short-lived, game-scoped test credentials and the safe sequence in Part II.F.
4. Preserve emergency/life-safety safeguards. Key/envelope/player migrations require mixed-fleet support, physical trigger/receipt/all-clear evidence, and a rollback that never restores a compromised key.
5. Do not invent business, legal, licensing, privacy, retention, supported-device, or life-safety policy. Satisfy the Non-delegable Definition of Ready before implementation.
6. Implement in dependency order. Do not expand template/integration count while security, data contracts, editability truth, and release gates remain unresolved.
7. Convert each work package into issues using the included format: one priority, dependencies, ADR/approver, migration cohorts/abort thresholds, rollback, evidence URI, expiry, and acceptance proof.
8. A feature is not complete because it renders once. It must edit/save/reload/publish, reach the player, work offline where promised, survive replay/reconnect/mixed versions, remain tenant-safe, and expose operational evidence.
9. Remove, disable, or honestly label every broken, experimental, provisional, unsupported, or coming-soon control. Catalog breadth is not a substitute for functioning workflows.
10. Re-verify file locations against the implementation branch because line numbers drift. The described contracts/failure modes and required evidence remain authoritative.
11. Submit small reversible changes. Every P0 and every P1 needs rollback and proof that existing boards, devices, schedules, emergencies, and customer data remain compatible.
12. Do not declare “world class” until every Final Launch Definition gate and every applicable Part II acceptance test is objectively green and unexpired.

## Table of contents

- [Part I — Master remediation specification](#part-i--master-remediation-specification)
- [Part II.A — Core release-gate evidence](#part-iia--core-release-gate-evidence)
- [Part II.B — AI and template-creator evidence](#part-iib--ai-and-template-creator-evidence)
- [Part II.C — Catalog, integrations, and business-truth evidence](#part-iic--catalog-integrations-and-business-truth-evidence)
- [Part II.D — Core systems evidence](#part-iid--core-systems-evidence)
- [Part II.E — Streaming evidence](#part-iie--streaming-evidence)
- [Part II.F — Restricted-locator-safe sports incident runbook](#part-iif--restricted-locator-safe-sports-incident-runbook)
- [Part II.G — Template catalog remediation ledger](#part-iig--template-catalog-remediation-ledger)
- [Part II.H — Sports-engine and integration evidence](#part-iih--sports-engine-and-integration-evidence)
- [Part II.I — Exhaustive widget editability inventory](#part-iii--exhaustive-widget-editability-inventory)

---


## Part I — Master remediation specification

### VenueOS Full-App World-Class Audit and Remediation Specification

**Audit date:** 2026-07-12
**Audit snapshot baseline:** `3f274702edb9079417b944749e3eb756a4ea9daa`
**Repository HEAD observed at handoff:** `044eed4dfedeeb54414d50b05ee0ffb5e11936b1`
**Production observed:** `https://venue-os.app`, API commit `7bb3fa066db9d05137166a14d0a5f770ec3859e8`—at audit time, its delta to the snapshot baseline was documentation-only; later handoff commits are not assumed deployed.
**Audience:** product lead, engineering lead, AI development agents, QA, design, security, operations, and customer-success owners.

#### Current repository drift and execution-status addendum

This report is an evidence snapshot at the audit baseline, not a claim that later commits were fully re-audited. During final assembly, `master` advanced to the handoff HEAD through a sports-focused commit series.

- The tracked credential literal was removed from the current source. That is **PARTIALLY COMPLETE containment only**. Rotation, token revocation, shared-key blast-radius migration, historical exposure analysis, and log review remain **OPEN/UNVERIFIED** until operators attach proof.
- Later sports commits report targeted water-polo, swimming, diving, and football fixes. Those changes do not close the sports scorecard or provider/hardware gates without the tests, runtime artifacts, and physical certification required below.
- Line numbers may drift after the snapshot. Re-resolve each cited symbol on the implementation branch, re-run the specified acceptance test, and update the evidence record; never dismiss a finding solely because its old line moved.
- The precise historic credential locator and introduction commit belong in a restricted incident record until revocation is proven. This distributable brief intentionally does not amplify them.

#### Executive verdict

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

##### Stop-ship / immediate-response items

1. At the audit baseline, a tracked production-capable integration script exposed signing material. The literal is removed at the handoff HEAD, but the credential must still be treated as compromised until rotation/revocation and exposure review are proven.
2. AI Designer output preserves model-authored JavaScript, runs it in a script-enabled iframe, and the player accepts action messages without source/nonce/action-key validation. Disable this path until contained.
3. Default Anthropic/Google AI paths reference retired models; current image fallbacks are deprecated/retired.
4. API-generated USB bundles cannot be ingested by Android, and the promised operator PIN does not exist.
5. Web lint/a11y is false-green and root Playwright discovers zero runnable tests; all-green CI does not currently prove these gates ran.
6. Pricing/trial/SSO/Clever/assets/billing help contain material product claims that do not match shipped behavior.
7. Unapproved/demo/licensing-risk templates are active because source registration is treated as publication.

Do not add more integrations or template count until these are closed.

#### Scope and evidence

This audit explicitly covers all 21 Standard Audit Surface sections. Evidence included:

- Read-only code/schema/workflow inspection across web, API, player, Android, shared packages, migrations, help, marketing, and template assets.
- Signed-in production DOM inspection of the dashboard and template gallery plus public pricing/signup/help surfaces.
- Production health check on 2026-07-12: DB and Redis both reported `ok`.
- Current GitHub workflow status: 10 named workflows green at audited HEAD, contrasted with locally reproduced gate failures.
- `pnpm audit --prod`: no high, critical, or moderate findings; one low.
- Existing targeted automated test evidence, plus fresh domain-specific sports checks reported in the appendices.
- Current official model-lifecycle documentation and official competitor feature pages.

##### Verification limits

No destructive production mutations were performed. No paid AI/provider credentials, SSO IdP sandboxes, Stripe live mode, POS sandboxes, physical Daktronics/CTS hardware, Taurus unit, Android device lab, or real CAP/IPAWS partner feed was available. Browser screenshot capture was unreliable, so some visual grades are based on production DOM, source styling, existing visual ledgers, and code rather than a full pixel-by-pixel physical-display review. The broken root Playwright gate itself prevents claiming a complete product E2E run.

#### Page-one coverage matrix

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

##### Grade interpretation and blocking rule

- `A` = 90–100: leading, verified, resilient, and operationally governed.
- `B` = 80–89: production-usable with bounded secondary gaps.
- `C` = 70–79: material workflow, truth, resilience, or editability gaps.
- `D` = 60–69: a primary job or trust boundary is broken/misleading.
- `F` = below 60: the primary purpose cannot be completed safely or truthfully.
- `+` and `−` denote the upper and lower thirds of a band. A `B−` is below the world-class release threshold; the minimum passing release grade is an unqualified `B` in every required dimension.
- Scores are not averaged across critical dimensions. Any `D`/`F` in security, life safety, tenant isolation, credential handling, audit/data integrity, or the feature's primary user job is a blocking failure regardless of stronger neighboring grades.

#### What should be protected—not rewritten

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

#### Wave 0 — actions for the next 48 hours

##### W0-01 — sports signing-secret incident response

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

##### W0-02 — disable unsafe raw AI Designer execution

**Owner:** AI/backend/player security
**Files:** `apps/api/src/ai/designer-prompt.ts:206-247,501+`, `apps/web/src/components/widgets/WidgetRenderer.tsx:3913-3955`, `apps/web/src/app/player/page.tsx:4972`

1. Add a server-side and UI kill flag that prevents new raw Designer HTML from being generated/published.
2. Keep existing templates playable only if a security review permits; disable actions/network for untrusted legacy HTML.
3. Reject model-authored scripts, event attributes, `javascript:` URLs, SVG active content, nested frames, and active objects.
4. Bind messages to exact iframe `contentWindow`, render nonce, and server-approved action key.
5. Plan `BoardDocumentV2`; do not treat regex sanitization as the long-term boundary.

**Done when:** malicious fixture corpus executes zero model code, sends zero unauthorized action/network request, and foreign/sibling iframe messages are rejected.

##### W0-03 — repair dead AI model routes

**Owner:** AI platform
**Files:** `apps/api/src/ai/ai-providers.ts`, `apps/api/src/ai/ai.service.ts`, `apps/api/src/ai/ai-alt-text.service.ts`

1. Replace retired `claude-3-5-haiku-20241022`, shut-down `gemini-2.0-flash`, retired Imagen 3, and deprecated OpenAI image models with current, surface-compatible models.
2. Disable deprecated catalog choices before changing defaults.
3. Apply model-specific parameter profiles; do not send one global temperature/thinking shape.
4. Add staging canaries for text, structured JSON, vision, image, test-key, and error mapping.

**Done when:** every supported provider/surface returns a valid result; the chosen model/parameter profile is telemetry-visible; CI warns 60 days before retirement.

Official lifecycle evidence: [Anthropic model deprecations](https://platform.claude.com/docs/en/docs/about-claude/model-deprecations), [Google Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations), and [OpenAI model catalog](https://developers.openai.com/api/docs/models/all).

##### W0-04 — disable or repair USB export/ingest

**Owner:** player/backend/Android
**Files:** `apps/api/src/usb-export/usb-export.controller.ts`, `scripts/usb-bundler.ts`, `apps/player/app/src/main/java/com/educms/player/usb/UsbIngester.kt`, `UsbIngestActivity.kt`

1. Hide/disable the in-app USB export until a cross-language fixture passes.
2. Define one JSON Schema, generate TS/Kotlin types, and delete the divergent producer contract.
3. Add real local authorization/PIN with lockout or remove the claim.
4. Enforce screen binding, expiry, monotonic version, streaming hash verification, size/count caps, and atomic cache switch.

**Done when:** an API-produced ZIP is accepted by Android, plays fully offline, rejects wrong-screen/expired/old/corrupt bundles, and never partially replaces good content.

##### W0-05 — make lint/a11y a real gate

**Owner:** frontend platform/QA
**Files:** `apps/web/eslint.config.mjs`, `.github/workflows/ci.yml:80-100`

1. Register `jsx-a11y` in the exact flat-config object that enables its rules.
2. Remove `|| true`; preserve pipeline exit status.
3. Make a config crash fail CI before baseline counting.
4. Ratchet the 99-error baseline only downward; prohibit file-wide rule disables.

**Done when:** lint exits 0 cleanly and a config error or injected missing accessible name makes CI red.

##### W0-06 — repair the E2E gate

**Owner:** QA/platform
**Files:** `playwright.config.ts`, `tests/e2e/*.test.ts`, `tests/e2e/*.spec.ts`, `.github/workflows/ci.yml:254-286`

1. Remove/quarantine Jest/Supertest theater tests from Playwright collection.
2. Seed isolated tenant/admin/device fixtures against real routes and ephemeral Postgres/Redis.
3. Unskip login, pair, publish, emergency trigger/player receipt/all-clear, and tenant-isolation journeys.
4. Assert a minimum test count and zero unexpected skips.
5. Run on pushes and pull requests; do not mutate production.

**Done when:** `playwright test --list` succeeds above the count floor and the complete life-safety journey is blocking.

##### W0-07 — product-truth correction

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

##### W0-08 — quarantine unapproved/licensing-risk templates

**Owner:** design system + product + legal
**Files:** template registry/seed, `Template` schema, `docs/template-finalization/PROGRESS.md`, customer HTML assets

1. Hide obvious placeholders/clipping boards and demo-only Domino’s assets from new customer use.
2. Stop fresh DB seeds from equating “source exists” with ACTIVE/PUBLISHED.
3. Add an interim allowlist of reviewed production templates while `TemplateRelease` is built.
4. Quarantine the 45 high-confidence D/F V2 ghost variants or remove/disable their misleading friendly controls until edit → save → reload → player-render tests pass.

**Done when:** the gallery contains only reviewed/rights-cleared templates, no offered widget has a known D/F primary control contract, and existing customers retain an explicit legacy compatibility path.

##### W0-09 — contain unbounded AI fan-out spend

**Owner:** AI platform + billing + operations
**Files:** AI generation admission/fan-out paths, usage counters, provider dispatch

1. Disable multi-candidate fan-out or cap it to one candidate until admission is atomic.
2. Define tenant and platform hourly/daily/monthly limits in USD micros, including brief extraction, retries, images, failures where the provider bills, and every fan-out candidate.
3. In one serializable database transaction, reserve the worst-case amount before provider dispatch using an idempotency key. Reject before any call if the reservation would exceed the cap.
4. After provider completion, record actual model/token/image usage and release only the unused reservation. A crash leaves a recoverable reservation, not free unmetered capacity.
5. Add an operational kill switch, spend anomaly alert, and tenant-visible honest limit state.

**Done when:** 50 concurrent requests at the cap cannot exceed the configured platform-dollar ceiling; duplicate idempotency keys dispatch once; a worker crash/retry cannot double-spend; and no fan-out path bypasses reservation.

#### Domain remediation specifications

##### §1 — real-time, emergency, and signed pub/sub

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

##### §2 — storage, assets, offline cache, USB, floor plans, media

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

##### §3 — AI provider platform

**Current truth:** three providers, timeout handling, error classification, and some prompt caching exist. Default catalogs are stale; usage is a call counter rather than cost; fan-out can overspend; BYOK decryption failure silently consumes platform credits; UI can show an unhealthy key as Connected.

**Build instructions:**

1. Create a server-owned `AiModelCapability` registry: provider/model ID, lifecycle state/dates, surface capabilities, parameter profile, context/output, price, privacy/region, fallback policy.
2. Resolve models by job (`copy`, `brief`, `structured_board`, `designer`, `vision`, `image`, `translation`) and record the resolved policy.
3. Create versioned `AiCredential` with dedicated `AI_KEY_KEK`/KMS, `keyVersion`, health, last test/error, creator/rotator/revocation metadata. Use dual-read/rewrap rotation.
4. If configured ciphertext is unreadable, return `AI_KEY_UNREADABLE`; never silently spend platform funds. Platform fallback requires explicit tenant policy.
5. Centralize provider error mapping for test and generate paths; audit success and every failure class.
6. Add nightly live staging canaries for every advertised provider/job combination and a retirement-date gate.

**Acceptance/metrics:** every catalog option is runnable; timeout/401/403/404/429/quota/5xx map consistently; corrupt BYOK shows red and burns no platform credits; rotation needs no key re-entry; model retirement produces warning ≥60 days before shutdown.

##### §4 — AI feature surfaces and template creator

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

##### §5 — AI competitive parity

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

##### §6 — streaming

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

##### §7 — sports

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

##### §8 — POS and commerce integrations

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

##### §9 — communications

**Current truth:** Resend email works and fails honestly when unset. Signed SSRF-pinned emergency webhooks with durable retry exist, but only trigger/clear events are allowed. Twilio SMS/voice, SendGrid, APNs/FCM, Slack, Teams, PagerDuty/OpsGenie are not built. Settings copy is stale.

**Build instructions:**

1. Create `NotificationEndpoint`, `NotificationPolicy`, `EscalationStep`, `NotificationEvent`, `DeliveryAttempt`, and dead-letter state.
2. Use a transactional outbox; event ID/delivery ID remain stable through retries and signatures.
3. Implement channels behind capability flags with consent, recipient verification, quiet hours, per-severity routing, templates, rate limits, and test mode.
4. Build delivery timeline UI: queued, attempted, provider accepted, delivered, failed, dead-letter, acknowledged.
5. Expand event taxonomy only with real producers/consumer contract tests.
6. For life safety, define and drill escalation policy separately from marketing/transactional messaging.

**Acceptance:** simulated incident fans out screen/email/SMS/push/webhook as configured; process death does not lose delivery; duplicate receiver effect is impossible; unsupported channels cannot be enabled; audit/correlation link every attempt.

##### §10 — authentication and identity

**Current truth:** Argon2id, JWT revocation, sessions, roles, TOTP, and backup codes are meaningful. SAML always returns 503 because the library is removed; generic OIDC is real but marketing suggests preconfigured Google/Microsoft buttons. Clever syncs only first-page users and does not implement the resources/webhooks help promises. WebAuthn is absent. Default `express-session` is process-local.

**Build instructions:**

1. Remove SAML claims immediately, then either implement a maintained SAML stack or explicitly decline it. Required: signed requests/assertions, metadata/certificate rotation, audience/recipient/clock checks, replay store, wrapping-attack fixtures, logout/deprovision policy.
2. Ship tested OIDC presets for Google Workspace, Entra ID, and Okta with discovery fail-closed. Never return a dead stub client after discovery failure.
3. Put session state in Redis or use encrypted one-time transaction cookies; cross-replica login must work.
4. Add passkeys/WebAuthn with recovery, device naming, attestation policy, and audit.
5. Paginate Clever; model users/schools/sections/terms only as each is actually implemented. Apply disable/delete reconciliation rather than merely count it.
6. Ensure role, disabled-user, tenant membership, and panic capability revocation take effect across HTTP/WS/SSE without re-login.

**Acceptance:** real Google/Entra/Okta test tenants; SAML IdP suite if claimed; >1,000 Clever users with create/update/disable; role/panic revoke immediate; login initiated on replica A completes on B; passkey/backup recovery tested.

##### §11 — billing, licensing, and commercial lifecycle

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

##### §12 — design imports

**Current truth:** PPTX/PDF/image parsing, size/decompression caps, and a creator UI exist. Legacy `.ppt` is incorrectly treated as PPTX; raw presentation assets can be inserted into a playlist although unplayable; PDF extracts text but not faithful graphics while UI promises editable text/images and fallback. Canva, Google Slides/Drive, Microsoft Graph, Figma are absent; Keynote is manual export.

**Build instructions:**

1. Reject binary `.ppt` or convert inside a locked-down LibreOffice sandbox with CPU/memory/time/network limits.
2. Replace synchronous import with `ImportJob`: upload/scan → parse → render pages → fidelity diagnostics → user preview → atomic commit.
3. Always rasterize a faithful page background, then overlay extracted editable elements. Never call text-only extraction a complete import.
4. Do not create a playlist item from raw PPT/PPTX. Create renderable page assets/scenes after success.
5. Add golden fixtures for masters, groups, charts, tables, themes, custom fonts, transparency, cropping, notes, animations, multi-page PDFs, corruption, and decompression bombs.
6. Add source-link/re-sync only after real OAuth/provider adapters exist. Label Canva/Drive/Graph/Figma as N/A until then.

**Acceptance:** screenshot diff below declared threshold; every failure yields a renderable image fallback or an explicit abort; no unplayable raw presentation reaches a player; import survives worker restart and is idempotent.

##### §13 — public alerts

**Coverage status:** N/A—not built. CAP, IPAWS inbound, IPAWS origination, Raptor SOS, RapidSOS, Valcom/Atlas/SingleWire are not shipped. The EULA accurately says VenueOS is supplementary and not a replacement for primary life-safety systems.

**Recommended build order:**

1. Canonical `IncidentEvent` aligned with CAP 1.2: identifier/sender/sent/status/msgType/scope/references/info/area/resource, geofence, expiry, language, severity/certainty/urgency.
2. Signed inbound CAP parser, schema validation, dedupe/replay, update/cancel references, geofence, expiry, and human review policy.
3. IPAWS test-feed consumption only after FEMA program/legal requirements are understood.
4. Partner adapters for Raptor/RapidSOS with sandbox drills and contract ownership.
5. PA/IP-speaker bridge last, with site-specific installation/certification.
6. Do not originate IPAWS unless VenueOS becomes authorized and the legal/operational decision is explicit.

**Acceptance before any claim:** FEMA sample/negative corpus, signature/replay/geofence tests, partner sandbox and physical drill, immutable incident transition audit, fail-safe behavior, documented role in the site safety plan.

##### §14 — multi-vertical product depth

**Current truth:** 12 verticals have labels, alerts, sample URLs, template tags, nouns, and AI voice concepts. `DistrictSchoolsCard` computes but ignores vertical copy; sample seeding skips all repair when either POS or streaming exists; several verticals map provisionally to others; brand bulk apply is destructive with no rollback; pricing/help/nouns retain EDU assumptions.

**Build instructions:**

1. Define one canonical `VerticalProductProfile`: nouns, roles, dashboard jobs, templates, data capabilities, integrations, sample seed modules, AI voice/archetypes, emergency defaults, billing plan names, onboarding copy.
2. Either use universal “Location” terminology consistently or actually render the profile nouns; delete dead contradictory maps.
3. Seed each capability independently/idempotently through durable jobs. A partial prior seed must self-heal.
4. Require at least five approved flagship jobs per launch vertical before marketing it. Provisionally mapped verticals remain Beta/hidden.
5. Brand application becomes token binding plus preview/dry-run/contrast check/versioned batch/rollback—not destructive literal replacement.
6. Audit every route/email/help/empty state for EDU-only language under sports/QSR/retail/corporate tenants.

**Acceptance:** one generated test tenant per vertical completes signup → onboarding → first board → publish with correct nouns/data/templates/plan/AI tone; seeding reruns safely; brand batch rollback restores exact prior version.

##### §15 — cross-browser, Chromium 83, and Android

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

##### §16 — forensic audit and tenant isolation

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

##### §17 — operations, DX, architecture, and observability

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

##### §18 — accessibility

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

##### §19 — templates and widget editability

**Current truth:** quality is mixed. The production review ledger lists 81 HTML templates with none approved; 133 active templates are one `EXTERNAL_HTML` zone; 55 use remote fonts; 17 lack posters; 20 have unfinished dimension content; some clip; demo-only Domino’s IP is active. Native widgets are generally more editable, but HTML/AI/data widgets vary. Template save/clone is non-atomic.

The widget registry has 702 registration attempts but only 701 unique global IDs because `retail-loyalty-qr` is silently overwritten. At least 45 concrete V2 variants expose high-confidence ghost or materially wrong friendly controls. Generic V2 array editing corrupts object arrays and numeric KPI trends; iframe boards do not inherit parent brand CSS variables; missing variant IDs silently render a fallback without persisting repair; and AI HTML hook coverage is requested but not enforced. The packaged HTML editor catalog has 113 rows/112 unique URLs, 4,044 discovered text keys, 161 image keys, zero action keys, and 35 offered boards with remote fonts. Part II.I contains the exhaustive family-by-capability matrix and exact remediation contract.

###### Catalog-universe definitions—do not mix these denominators

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

##### §20 — top-to-bottom design, UX, and functionality

The product needs task-level experience ownership, not page-level polish alone. Apply these instructions to every operator-facing route:

###### Public site, signup, and help

- One capability/plan contract; no hard-coded parallel truth.
- Publish only verified claims, with honest Beta/Coming Soon labels.
- Signup states exact trial, seat, billing, role, and next step.
- Help is generated/validated against capability IDs and API behavior; stale article blocks release.

###### Onboarding and dashboard

- Choose a first job from vertical profile; auto-seed idempotently; take operator directly to a working branded board.
- Dashboard prioritizes: screens needing action, content expiring, failed data integrations, approvals, and next recommended task. Avoid vanity counts without remediation.
- Every error has owner-readable cause, last-success time, and one recovery action.

###### Assets

- Upload progress/job states, preview/fidelity, usage count, rights metadata, semantic search/tags, renditions, versioning, Trash/restore if promised.
- Enforce one set of size/type limits in API, UI, and help.

###### Playlists and schedules

- One “create → target → preview → conflict review → publish” transaction.
- Visual schedule conflict/displacement preview, target-screen proof, rollback, approval, and go-dark safety.
- Remove nested-playlist documentation until the schema supports it.

###### Screens/fleet

- One-time expiring pairing code/QR with attempt limits and exact device binding. Current codes have no expiry.
- Hardware/canvas/orientation auto-detect, health timeline, last good manifest, cache/emergency readiness, integration status, remote action audit.
- Fleet batch action includes preflight, staged rollout, progress, failure isolation, retry/rollback.

###### Emergency

- Preserve fast hold/typed confirm and obvious all-clear.
- Add live permission check, device signature, exact event idempotency, accessible dialogs, target summary, drill mode, acknowledgements, and operator after-action report.

###### Templates/builder/AI

- Task-first curated gallery; structured editor; atomic save; durable AI job; data binding; quality score; one-click target/publish.
- Nontechnical operator should edit visible text by clicking it; never expose ghost JSON/meta controls.

###### Integrations/settings

- One catalog with capability status, setup requirements, verified health, last sync, affected screens/templates, disconnect impact, test action, and support path.
- “Connected” requires a successful canary, not a row.

###### Sports

- Game creation defaults by sport, recent teams/venues, scheduled time, screen preflight, console/feed wizard, realtime operator feedback, undo/replay protection, postgame summary.
- No generic sport skin marketed as complete when its scoring model is missing.

###### Mobile and accessibility

- Core jobs within one-handed navigation; no desktop-only controls; 44px targets; offline/reconnect feedback.
- Keyboard/screen-reader parity is part of the same acceptance test, not a later audit.

**Standing UX gate:** every feature names one happy path a non-IT operator completes in ≤30 seconds/a handful of clicks, records the click path and timing, and has a Playwright/browser artifact. If setup necessarily exceeds 30 seconds—hardware bridge, SAML—provide a guided checklist with auto-detection and explicit handoff, not a misleading one-click claim.

##### §21 — verification-before-claim

**Current truth:** the repository contains a strong written rule, but structural enforcement is missing. A July “10/10 launch-ready” report predates/rejects current evidence: lint and Playwright can be green without running, USB is incompatible, dead models exist, and product-help claims are false.

**Build instructions:**

1. Create `CapabilityRegistry` with owner, state, evidence tests, production canary, documentation/marketing claims, last verified commit/date, supported environments, and limitations.
2. CI checks that `SHIPPED/VERIFIED` capabilities have passing evidence; `COMING_SOON/N/A` cannot render a working green action.
3. Test collectors publish test counts/skips; zero tests, config crash, redirect, or missing artifact is red.
4. Deployment verification records commit → Vercel/Railway ready → health → authenticated smoke → player/canary → rollback decision.
5. No report can say fixed/shipped/live based on code inspection alone. Use one §21 proof artifact and link it.
6. Separate `CODE_COMPLETE`, `STAGING_VERIFIED`, `PRODUCTION_VERIFIED`, and `HARDWARE_CERTIFIED` states.

**Acceptance:** every customer claim and release note resolves to a current capability evidence record; stale verification expires; CI cannot empty-pass; production and hardware status are never inferred from unit tests.

#### Cross-cutting architecture the team should converge on

The same root problems repeat across AI, sports, streaming, POS, webhooks, imports, templates, and device control. Fix the classes once.

##### 1. Capability registry

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

##### 2. Versioned command/event envelope

Emergency, sports, screen commands, webhooks, and integration changes use one pattern:

```text
schema + eventId + correlationId + tenant/scope + source
revision/sequence + occurredAt/issuedAt/expiresAt
idempotency key + payload hash + keyId/signature
```

Persist receipt, state change, audit, and outbox transactionally. Consumers dedupe and gap-recover.

##### 3. Durable job/outbox platform

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

##### 4. Structured design document

`BoardDocumentV2` becomes the stable contract between AI, builder, imports, template releases, player, and data integrations. It is versioned, validated, structurally editable, and rendered by trusted code. Raw HTML is a legacy/isolated import—not the core design model.

##### 5. Integration binding and health

Every live widget uses an explicit binding to a connection and capability, with field map, version, fallback, last verified/success, and health. A decorative string such as `data-source="epic"` is not an integration.

##### 6. Revisioned transactional documents

Templates, games, schedules, brand batches, and fleet changes use optimistic revisions and one server transaction. Multi-call “save” flows are replaced with complete document/command endpoints. Conflicts are surfaced; version history is reliable.

##### 7. Truthful release artifacts

Templates, integrations, providers, hardware profiles, plans, and public claims each have a release manifest and evidence artifacts. Code registration alone never means publication/certification.

#### Sequenced delivery plan

##### Wave 0 — 0–3 days: containment and truth

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

##### Wave 1 — days 4–14: trust foundations

- `ControlEnvelopeV2`, device keyring, universal dedupe, SSE ticket.
- Emergency live capability guard.
- Durable job/outbox/idempotency foundation.
- Central `AuditWriter`, correlation ID, tenant repository guard.
- Typed environment schema/session store/fatal shutdown.
- `CapabilityRegistry` and `PlanCatalog` schemas.
- Root E2E seeded environment and life-safety journey.

**Dependencies:** security design review before key/envelope migration; migration/rollback plan; two-replica test environment.

**Exit gate:** exact-once signed commands, cross-replica auth/session, transactional audit/outbox, real blocking E2E, server-owned plan/capability truth.

##### Wave 2 — weeks 3–6: creator and content quality

- `BoardDocumentV2` schema/renderer/editor bridge.
- AI jobs/sessions/ledger/credential KMS/provider registry.
- Atomic template save/duplicate/version.
- `TemplateRelease` and interim catalog quarantine.
- Asset/media job pipeline, renditions, Trash/version/usage.
- Full template screenshot/browser/offline/rights QA.
- Task-first gallery and one-click first-board publish.
- Fix POS connection binding and streaming channel resolver.

**Exit gate:** no executable AI code; generation is durable/accounted; 25–50 approved flagship templates; every published template ≥B editability and verified; asset/video lifecycle reliable.

##### Wave 3 — weeks 7–10: integrations and commercial lifecycle

- POS exact binding, Shopify modernization, inventory/daypart/freshness.
- Streaming health/failover/custom-HLS happy path.
- Notifications policy/delivery timeline and selected channel adapters.
- OIDC presets/session hardening; Clever pagination/reconcile; SAML decision/implementation.
- Plan/trial/dunning/PO/refund truth and UI.
- Import jobs/fidelity/golden decks.
- Integration VERIFIED canaries/dashboard.

**Exit gate:** every green integration proves a recent operation; pricing/trial contract identical everywhere; direct provider E2Es; no advertised dead connector.

##### Wave 4 — weeks 11–16: sports, hardware, and enterprise certification

- Manifest-driven console setup, feed envelope, game revisions/WS, atomic commands.
- Real Daktronics/CTS capture/certification and on-device tests.
- Finish top-priority sport operating models and low-score semantics.
- Exact Chromium83/Taurus and Android device-lab matrices.
- Automated backups/restores, multi-replica chaos, fleet staged rollout.
- First CAP/partner research only if product strategy approves; no premature public claim.

**Exit gate:** named hardware profiles certified with dates/fixtures; sports p95 targets; physical readability sign-off; Taurus/Android emergency/offline drills; restore RPO/RTO proven.

#### Non-delegable Definition of Ready

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

#### Development-team work-package backlog

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

#### World-class success metrics

##### Safety and trust

- Zero active leaked/default production credentials; blocking current/history scan.
- 100% control events device-verified, scoped, fresh, and deduped.
- Emergency target receipt p95 <2 seconds; polling fallback drill passes.
- 100% privileged mutations mapped to transactional audit or explicitly classified nonprivileged.
- Zero cross-tenant generated-test failures.

##### Release integrity

- Lint/test/a11y collectors can never empty-pass; zero unexpected skips.
- Root life-safety E2E, auth isolation, publish/player, and billing webhook journeys block every push/PR.
- Exact deployed commit and authenticated smoke artifact attached to release.
- Dependency high/critical = 0; secret scan and container gates blocking.

##### Creator and templates

- First useful candidate p95 <30 seconds or a progress/resume experience with honest ETA.
- Cancel success >99%; duplicate idempotency dispatch = 0.
- AI usage ledger reconciles to provider usage/cost within 1%.
- 100% published templates approved, rights-cleared, postered, offline-ready, at least unqualified-B editable in every required dimension, and browser/canvas tested.
- Zero published placeholder/fake-live/remote-font-miss templates.
- Nontechnical first-board happy path ≤30 seconds after onboarding.

##### Integrations

- 100% green/VERIFIED connections have a recent real canary timestamp.
- POS/webhook-to-screen p95 SLA declared and measured; stale fallback visible.
- Stream startup/rebuffer/fatal/fallback metrics available per screen.
- No connector/provider marketed as direct without a passing sandbox/production contract.

##### Sports

- Score/feed-to-board p95 <250 ms in WS mode; <2 s screen assignment/control.
- One immutable receipt/event/audit/cue intent per score command; zero duplicate cues.
- All 19 sports use correct result semantics and have no D/C launch-grade functionality.
- Hardware-certified profiles include model/transport/sport/date/packet fixtures/venue sign-off.

##### Accessibility and UX

- Zero blocking axe/JSX errors; no file-wide suppressions.
- Core operator journeys keyboard/screen-reader tested in Chromium/WebKit.
- Every feature has a named ≤30-second happy path or explicit guided/handoff exception.
- Brand application cannot save a WCAG-failing palette.

##### Operations

- Two-replica chaos produces one logical scheduled/event effect.
- Fatal process faults drain/restart; no unknown-state serving.
- Quarterly restore meets declared RPO/RTO.
- No new UI/service file >1,000 lines without architectural approval; current hotspot size trends down.

#### Evidence currency and expiration

Evidence is valid only for the artifact and environment it actually tested:

- Security, tenant-isolation, secret-scanning, lint, unit, contract, and CI evidence expires on any relevant code/config/dependency change and must be tied to the exact commit.
- Browser, player, offline, template screenshot, and accessibility evidence expires each release or whenever the renderer/template/runtime/browser floor changes.
- Provider/integration canaries need an explicit SLA/TTL; use 24 hours for operational health unless the provider contract justifies a different period. A stale canary cannot remain green.
- Hardware certification is scoped to model, firmware, transport, sport/profile, player version, and fixture hash; any scoped change invalidates it until replay/venue recertification.
- Backup existence is checked daily; isolated restore proof expires quarterly or after a material schema/storage/encryption change.
- Emergency trigger/receipt/all-clear drills run at least quarterly, before retiring an envelope/key/player version, and after material emergency/realtime changes.

`CapabilityRegistry` and release artifacts must store `evidenceUri`, exact commit/release/device identifiers, `verifiedAt`, `expiresAt`, verifier, limitations, and invalidation reason.

#### Required issue format for AI development agents

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

#### Final launch definition

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

#### Embedded evidence map and optional provenance files

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

---

## Part II.A — Core release-gate evidence

### Core gate findings — verified 2026-07-12

Scope: read-only full-app audit. These findings were surfaced by the core
reviewer before its usage window ended and independently reproduced by the
lead against current `master`.

#### 1. In-app USB export cannot be ingested by the Android player

- The API bundle manifest uses `version: 1`, nested
  `playlists[].items[].asset`, and `storagePath`
  (`apps/api/src/usb-export/usb-export.controller.ts`).
- The Android ingester requires `schema: "edu-cms-usb-bundle/v1"`,
  `bundleVersion`, a top-level `assets[]`, and `localPath`
  (`apps/player/app/src/main/java/com/educms/player/usb/UsbIngester.kt`).
- Therefore an in-app-generated, correctly signed bundle is rejected before
  any content is copied. The standalone `scripts/usb-bundler.ts` emits the
  Android contract, proving the repository has two incompatible producers.
- The API-generated README says the player prompts for an admin PIN, while
  `UsbIngestActivity.kt` explicitly says no PIN prompt exists yet.

#### 2. Accessibility lint is false-green

- `pnpm --filter web lint` exits 2 because the ESLint flat-config object that
  enables `jsx-a11y/*` rules does not register the `jsx-a11y` plugin in that
  same object.
- `.github/workflows/ci.yml` pipes lint through `tee ... || true`, then only
  counts formatted `jsx-a11y/` rule violations. A configuration crash produces
  zero matching violations and the job prints success.

Lead reproduction:

```text
ESLint: 9.39.4
A configuration object specifies rule "jsx-a11y/alt-text", but could not find plugin "jsx-a11y".
Exit status 2
```

#### 3. Root Playwright E2E gate discovers zero runnable tests

- `pnpm exec playwright test --list` exits 1 and reports five
  `ReferenceError: describe is not defined` failures from
  `tests/e2e/*.test.ts`; those files use Jest globals and Supertest mock tokens
  inside the Playwright test directory.
- Several real `*.spec.ts` auth, publish, screen, and emergency scenarios are
  explicitly skipped and still contain Sprint-2 TODOs.
- The resulting listing is `Total: 0 tests in 0 files`.
- `.github/workflows/ci.yml` runs this root E2E job only on pull requests, so
  direct pushes to `master` do not exercise it.

These are release-integrity blockers because green CI currently does not mean
the lint or end-to-end gates executed successfully.

---

## Part II.B — AI and template-creator evidence

### AI + Template Creator Audit Checkpoint

**Audit baseline:** `3f274702`
**Scope:** Standard Audit Surface §§3–5 plus the template creator, Concierge, Designer, provider, key-management, metering, persistence, and editor handoff paths. Sections outside this lane are covered in the master report.

| § | Coverage | Design | UX | Function | Honest verdict |
|---|---|---:|---:|---:|---|
| 3. Providers | Covered | B | C+ | D | Several default/current paths are broken by retired models; controls are not cost-grade |
| 4. AI surfaces | Covered | B+ | C+ | D+ | Impressive breadth, but the flagship Designer has a P0 execution boundary |
| 5. Comparative | Covered | B | C | C− | Ahead in contextual generation; behind in deterministic editability, governance, localization, and automation |

#### P0 — retired models break live AI paths

The catalog's “current GA” comments are materially wrong:

- Anthropic Standard is `claude-3-5-haiku-20241022`, retired February 19, 2026: `apps/api/src/ai/ai-providers.ts:149`, `apps/api/src/ai/ai-providers.ts:170`. Platform-funded text falls back to this default at `apps/api/src/ai/ai.service.ts:544`, so platform text, Concierge, structured generation, and Designer calls can fail.
- Anthropic vision also pins the retired model at `apps/api/src/ai/ai-alt-text.service.ts:457`.
- Google Balanced pins `gemini-2.0-flash`, shut down June 1, 2026: `apps/api/src/ai/ai-providers.ts:248`.
- Google image generation pins `imagen-3.0-generate-002`, shut down November 10, 2025: `apps/api/src/ai/ai.service.ts:4217`.
- OpenAI image generation uses deprecated `gpt-image-1`, then deprecated `dall-e-3`: `apps/api/src/ai/ai.service.ts:4132`, `apps/api/src/ai/ai.service.ts:4196`.
- Anthropic Premium Opus 4.1 retires August 5, 2026: `apps/api/src/ai/ai-providers.ts:185`. A naïve swap to a current Opus can also fail because every Anthropic call sends `temperature: 0.7` at `apps/api/src/ai/ai-providers.ts:441`; current Opus-family parameter support must be resolved from model capabilities rather than assumed globally.

Official lifecycle references: [Anthropic](https://platform.claude.com/docs/en/about-claude/model-deprecations), [Google](https://ai.google.dev/gemini-api/docs/deprecations), [OpenAI models](https://developers.openai.com/api/docs/models), [GPT Image 2](https://developers.openai.com/api/docs/models/gpt-image-2).

##### Required implementation

1. Hotfix provider IDs and disable dead catalog options immediately.
2. Replace literal model arrays with a capability/lifecycle registry containing `surface`, vision/image/structured-output support, parameter profile, release/deprecation/retirement dates, fallback IDs, pricing, and maximum output.
3. Route by surface. Concierge/brief extraction should use a fast model; Designer may use premium; vision must use a vision-capable model; image generation must use a current image model.
4. Never silently substitute a removed tenant-selected model at `apps/api/src/ai/ai-providers.ts:375`. Return a lifecycle warning or apply an explicitly approved compatible fallback.
5. Add nightly live staging canaries for test-key, text, multi-turn, structured JSON, vision, and image generation across every supported provider.

**Acceptance:** every provider/surface combination returns a usable result; CI fails when a configured model retires within 60 days; resolved model and parameter profile appear in generation telemetry.

#### P0 — AI-authored JavaScript can control the player

This is the most serious creator finding.

- The Designer prompt requests inline JavaScript: `apps/api/src/ai/designer-prompt.ts:206`, `apps/api/src/ai/designer-prompt.ts:247`.
- The sanitizer deliberately preserves arbitrary inline scripts: `apps/api/src/ai/designer-prompt.ts:501`. A test locks that behavior in at `apps/api/src/ai/designer-prompt.spec.ts:100`.
- Generated HTML executes in `sandbox="allow-scripts"`: `apps/web/src/components/widgets/WidgetRenderer.tsx:3944`; candidate picker `apps/web/src/app/[schoolId]/templates/page.tsx:1689`; full-screen preview `apps/web/src/app/[schoolId]/templates/page.tsx:2568`.
- The parent sends brand, text, image, and action mappings into that document with wildcard `postMessage`: `apps/web/src/components/widgets/WidgetRenderer.tsx:3913`.
- The player accepts any `educms-action` message from any window without checking `event.source`, iframe identity, nonce, or approved action key: `apps/web/src/app/player/page.tsx:4972`.
- That payload reaches actions including URL opening, scene/template navigation, public webhooks, and help requests: `apps/web/src/app/player/page.tsx:299`.

A generated script can post an action on load; no visitor tap is required. Null-origin sandboxing blocks cookies and parent DOM access, but not `postMessage`, outbound requests, or CPU denial-of-service.

##### Required implementation

1. Disable raw Designer generation behind a kill flag until containment lands.
2. Strip every model-authored `<script>`, event-handler attribute, `javascript:` URL, SVG script/event vector, nested frame, and active object.
3. Inject only a trusted VenueOS scale/edit runtime after sanitization.
4. Add strict `srcdoc` CSP: `default-src 'none'`; restricted same-origin/rehosted images and fonts; no `connect-src`; only a nonce-bearing trusted runtime.
5. Bind action listeners to the exact iframe `contentWindow`.
6. The iframe may emit `{actionKey, renderNonce}` only. The parent resolves `actionKey` against the server-saved action map; never accept an action object from the iframe.
7. Long term, move Designer output to a validated `BoardDocumentV2` AST—text, image, shape, list, live binding, approved animation, and action nodes—not HTML.

**Acceptance:** a malicious inline/onload/SVG/CSS/postMessage payload corpus produces zero executable model code; messages from sibling or foreign frames are rejected; no action can execute without an approved key; outbound network requests from generated boards are zero.

#### P0 — atomic dollar/fan-out reservation and containment (`AI-003A`)

- Monthly usage is a call counter on `Tenant`, not tokens or dollars: `packages/database/prisma/schema.prisma:167`, `apps/api/src/ai/ai.service.ts:404`.
- The UI estimates every call as a 300-token generation: `apps/api/src/ai/ai-providers.ts:76`, `apps/web/src/components/settings/AiKeyCard.tsx:219`.
- Designer launches three parallel 16,000-visible-token calls: `apps/api/src/ai/ai.service.ts:3048`. GPT-5 receives another 12,000-token reasoning allowance: `apps/api/src/ai/ai-providers.ts:492`.
- Fan-outs check only `used >= cap`, then launch all candidates and increment afterward: touch `apps/api/src/ai/ai.service.ts:2057`, structured `apps/api/src/ai/ai.service.ts:2581`, Designer `apps/api/src/ai/ai.service.ts:2981`.
- Redis checks and increments are separate and fail open: `apps/api/src/ai/ai-hourly-cap.ts:80`, `apps/api/src/ai/ai-hourly-cap.ts:102`.
- Brief extraction consumes paid model calls but intentionally consumes neither hourly nor monthly quota: `apps/api/src/ai/ai.service.ts:2779`, `apps/api/src/ai/ai.service.ts:2833`.

##### Required containment

Disable multi-candidate fan-out or cap it to one until admission is atomic. Define tenant and platform hourly/daily/monthly ceilings in USD micros. In one serializable transaction, reserve the worst-case cost of brief extraction, retries, images, failures billed by the provider, and all N fan-out candidates before any provider call. Use an idempotency key, reject before dispatch when the cap would be exceeded, release only unused reservation after actual usage, retain recoverable reservations across crashes, and provide an operational kill switch. BYOK may bypass platform-dollar caps only—not abuse/concurrency limits or telemetry.

**P0 acceptance:** 50 concurrent cap-edge requests never exceed the configured platform-dollar ceiling; duplicate idempotency keys dispatch once; a crash/retry cannot double-spend; every dispatch path, including brief extraction and fan-out, requires a reservation; disabling the kill switch prevents all new paid calls.

#### P1 — durable usage ledger, actual-cost accounting, and reconciliation (`AI-003B`)

Add immutable `AiGeneration` and append-only `AiUsageLedger` records with tenant/user/surface/provider/resolved model, idempotency key, batch/candidate, prompt/cache/reasoning/output token classes, image count, USD micros, provider request ID, latency, status, error code, reservation/refund, BYOK/platform funding source, and reconciliation state. Persist candidate-level failures rather than filtering them. Reconcile the ledger to provider usage/invoices and surface honest tenant/operator spend.

**P1 acceptance:** every successful, failed, timed-out, canceled, and retried provider request has a correlated ledger row; reserved/actual/refunded amounts balance; displayed tenant spend and platform totals reconcile to provider usage/cost within 1%; discrepancies alert and cannot be silently discarded.

#### P1 — BYOK can silently become platform-funded

- AI credentials share `DEVICE_SECRET_KEY` and have no key version: `apps/api/src/ai/ai-key-cipher.ts:15`, `apps/api/src/ai/ai-key-cipher.ts:30`.
- Decryption failure silently falls through to the platform key: `apps/api/src/ai/ai.service.ts:519`. Alt-text does the same: `apps/api/src/ai/ai-alt-text.service.ts:229`.
- The backend returns `keyHealthy:false`, but the UI type omits it and always renders green “Connected”: `apps/web/src/components/settings/AiKeyCard.tsx:32`, `apps/web/src/components/settings/AiKeyCard.tsx:203`.
- Test-key network/timeout exceptions occur outside the mapped/audited `errorStatus` branch: `apps/api/src/ai/ai-key.controller.ts:191`, `apps/api/src/ai/ai-key.controller.ts:198`.

##### Required implementation

Create versioned `AiCredential` rows encrypted with dedicated `AI_KEY_KEK` or KMS; store provider, key version, health, last test, error code, creator/rotator/revocation metadata. Never silently fund a configured-but-unreadable BYOK tenant. Return `AI_KEY_UNREADABLE`; require explicit operator choice to use platform credits. Use transactional audit/outbox writes and shared provider error classification.

**Acceptance:** KEK dual-read/rewrap rotation succeeds without key re-entry; corrupt ciphertext shows a blocking red state and does not increment platform usage; timeouts/401/403/404/429/5xx all produce structured, audited results.

Already good: provider fetches have timeouts; Anthropic system prompts use ephemeral caching. Temperature handling is only partially correct because it is model-family hardcoded.

#### P1 — generator UX, jobs, cancel, and telemetry are incomplete

- Three long Designer calls run synchronously in one request with no durable job or cancel: `apps/api/src/ai/ai.service.ts:3051`.
- Partial failures are hidden by `Promise.allSettled`; only requested/returned counts are audited: `apps/api/src/ai/ai.service.ts:3082`, `apps/api/src/ai/ai.service.ts:3109`.
- Brief extraction may finish after modal closure and then launch generation: `apps/web/src/app/[schoolId]/templates/page.tsx:935`.
- `aiBusy` excludes brief, chat, references, and refinement: `apps/web/src/app/[schoolId]/templates/page.tsx:674`.
- Backend drops `batchId`: `apps/api/src/templates/templates.controller.ts:1280`; frontend expects it at `apps/web/src/hooks/use-api.ts:1616`, making keep telemetry undefined at `apps/web/src/app/[schoolId]/templates/page.tsx:869`.
- Concierge always forces raw Designer despite Touch/Display/Set controls: `apps/web/src/app/[schoolId]/templates/page.tsx:1017`. Designer persistence always sets touch false: `apps/api/src/templates/templates.controller.ts:1338`.
- Resume stores partial state in localStorage and clears saved IDs: `apps/web/src/app/[schoolId]/templates/page.tsx:760`. Regenerate reconstructs from wizard state and loses Concierge references/mode: `apps/web/src/app/[schoolId]/templates/page.tsx:989`.
- Candidate thumbnails hardcode 16:9 and 1920×1080: `apps/web/src/app/[schoolId]/templates/page.tsx:1680`.

##### Required implementation

Introduce durable `AiDesignSession`, `AiGenerationBatch`, and candidate revisions. `POST /ai/jobs` returns `202 + jobId`; poll/SSE status; cancel propagates `AbortSignal`; immutable request snapshot includes mode, canvas, prompt, references, confirmed brief, engine, model policy, and idempotency key. Put shared Zod response contracts in `@cms/api-types`. Surface partial failure, cost, warnings, resolved model, and quality status.

**Acceptance:** close/cancel stops queued work; refresh resumes server state; repeated Save is idempotent; Touch/Display/Set/Designer each persist the advertised mode; portrait/square/custom previews match canvas; every keep joins to its generation batch.

#### Template editability and competitive gaps

Raw Designer persists as one `EXTERNAL_HTML` zone at `apps/api/src/templates/templates.controller.ts:1324`, so it cannot deliver Canva-class structural editing. Switching that zone to a packaged URL does not clear `html` at `apps/web/src/components/template-builder/PropertiesPanel.tsx:2553`, while the renderer prioritizes inline HTML at `apps/web/src/components/widgets/WidgetRenderer.tsx:3944`. “Save as copy” also omits data-source fields and persists touch settings only when a background exists: `apps/web/src/components/template-builder/BuilderShell.tsx:585`, `apps/web/src/components/template-builder/BuilderShell.tsx:604`.

Make structured AST generation the default; quarantine legacy HTML as limited-editability content. Add atomic template save/clone endpoints preserving metadata, zones, scenes, actions, data bindings, and touch settings.

##### §4 inventory

- **Built:** copy generation, rewrite, chat edit, touch synthesis, structured signage/sets, Designer/refine, Concierge URL/image context, OpenAI/Google image generation, alt text, limited translation, CMS menu/address grounding.
- **Not built:** background removal, TTS, V2 controlled summarization, AI anomaly detection, SOS transcription.
- **Clarification:** auto-celebration is deterministic, not generative AI.

##### §5 competitive gaps

- **P1:** background removal; semantic asset tagging/search; smart playlist and scheduling recommendations; locale variants/RTL/translation memory; deterministic structured design; generation evals and approval governance.
- **P2:** generative celebration animation; privacy-governed people counting; anomaly intelligence; TTS and voice transcription.

#### Recommended sequence

1. Immediately disable unsafe raw Designer, repair retired models, and meter brief extraction.
2. Ship credential/provider and spend-ledger foundations.
3. Add durable jobs, sessions, cancellation, idempotency, and shared contracts.
4. Replace raw HTML with `BoardDocumentV2` and enforce rendered quality gates in Chromium 83, current Chromium, and WebKit.

---

## Part II.C — Catalog, integrations, and business-truth evidence

### Catalog, Business, Integration, and Product-Truth Audit Checkpoint

**Audit baseline:** `3f274702`
**Method:** read-only code and database inspection. Current catalog: 300 unique source presets, 297 active system presets in the database, 133 active `EXTERNAL_HTML` boards, and 55 active boards using remote Google/Typekit fonts. This checkpoint distinguishes working capability from roadmap/demo behavior.

| § | Status | Design | UX | Function |
|---|---|---:|---:|---:|
| 8 POS | Covered | B | C | C+ |
| 9 Communications | Covered | B- | C | C+ |
| 10 Auth | Covered | B | C+ | B- |
| 11 Billing | Covered | B | D | C |
| 12 Imports | Covered | B- | C | C |
| 13 Public alerts | N/A—not built | — | — | — |
| 14 Multi-vertical | Covered | B- | B- | C+ |
| 19 Editability/catalog | Covered | C+ | C | C |
| 20 Lenses | Covered above | — | — | — |
| 21 Verification | Code/DB only | — | — | — |

#### P0 — establish one product-truth contract

Public pricing is incompatible with itself and the running entitlement model:

- Public pricing is $25/$20 monthly and $250/$200 annually at `apps/web/src/app/pricing/page.tsx:8-17`, `:31-46`, `:62-79`; the homepage repeats it at `apps/web/src/app/page.tsx:463-467`.
- Shared billing catalog is $15/month and $150/year, 14 days/3 screens at `packages/api-types/src/billing.ts:24-27`, `:61-104`.
- A tenant with no license receives a 1,000-screen, perpetual ACTIVE pilot at `apps/api/src/license/license.service.ts:23-56`; “activate trial” explicitly commits nothing at `apps/api/src/billing/billing.controller.ts:129-160`.
- Signup promises “first 10 screens” at `apps/web/src/app/signup/page.tsx:265`; help promises per-building billing and a 30-day pilot at `apps/web/src/content/help/billing.md:10-23`; the roadmap proposes ≤5 screens/90 days at `docs/roadmap/ROADMAP.md:765-768`.

##### Required implementation

Create a server-owned `PlanCatalog` and entitlement state machine (`TRIALING → ACTIVE → PAST_DUE → GRACE → CANCELLED`) with `startsAt`, `trialEndsAt`, `seatLimit`, cadence, Stripe price IDs, PO eligibility, and feature policy. Public pages, signup, billing UI, and API must consume the same serialized catalog. Make the 1,000-seat internal pilot an explicit expiring tenant override, never the no-row default.

Before deny-by-default, inventory every tenant and deterministically backfill the intended entitlement/override. Run shadow-mode parity against current effective seats/features, reconcile 100% of active tenants with accountable product/support sign-off, then enforce in feature-flagged cohorts. Provide an audited time-limited support break-glass override, migration abort thresholds, and a tested rollback that restores the prior decision path without losing new entitlement data.

**Acceptance:** a contract test renders identical price/trial/seat values in `/pricing`, `/signup`, `/license/tiers`, billing tiles, and Checkout line items; Stripe Test Clock proves trial expiry/dunning. Only after deterministic backfill, shadow-mode parity, 100% active-tenant reconciliation, staged cohort enforcement, and successful break-glass/rollback drills may a missing entitlement row deny production access.

#### §8 — POS and commerce

##### Working

Square, Clover, Lightspeed X-Series, and Shopify connectors are registered at `apps/api/src/pos/providers/registry.ts:63-105`; Square signed webhook and custom-webhook ingestion exist at `apps/api/src/pos/pos-oauth.controller.ts:271-403`, `:406-500`; hourly sync covers registered connectors at `apps/api/src/pos/pos-sync.cron.ts:55-73`.

##### Open gaps

- Toast, Stripe Catalog, and Mindbody are partner/unbuilt at `packages/api-types/src/pos.ts:109-123`, `:221-255`; Aloha is manual/closed at `:152-169`. Settings nevertheless says all auto-update at `apps/web/src/app/[schoolId]/settings/page.tsx:293-295`.
- Shopify claims `realtimeUpdates:true` while its own comment says its webhook is not wired and the REST API is legacy at `packages/api-types/src/pos.ts:195-217`.
- Every QSR/bar/menu URL is forced live even when the operator selects Static: `apps/web/src/components/widgets/WidgetRenderer.tsx:3888-3892`. The saved `posProvider` is ignored because `usePosMenuItems` accepts no provider/connection at `apps/web/src/lib/menu/use-pos-menu-items.ts:49-98`.
- The provider picker enables unconnected partner choices at `apps/web/src/components/template-builder/PropertiesPanel.tsx:6919-6951`.
- BYO binding writes `{{pos.item:…}}` tokens at `PropertiesPanel.tsx:7372-7413`, but no runtime resolver exists.
- Packaged boards using `data-source="opera-pms|epic|gsuite|kds|opentable|mindbody|loyalty|ats|reviews|kiosk-api"` are decorative; runtime only injects POS menus.

##### Required implementation

Add `IntegrationBinding(templateId, zoneId, providerConnectionId, capability, fieldMap, fallbackMode, lastVerifiedAt)`. Runtime must resolve the selected connection, honor OFF, and expose freshness/error state. Disable non-DIRECT or unconnected choices. Implement Shopify GraphQL plus provider webhooks, durable cursor jobs, inventory/low-stock, and daypart/promo rules. Label every unsupported board “Sample data,” never “Live.”

**Acceptance:** sandbox contract suite for each DIRECT provider; selecting Static produces zero POS requests; two simultaneous POS connections return the selected feed; exact external-ID binding updates price/name/availability; webhook-to-screen SLA and stale-feed fallback are measured.

#### §9 — communications

##### Working

Resend email is real and fails honestly when unconfigured at `apps/api/src/email/email.service.ts:356-440`. Signed, SSRF-pinned, durable emergency webhooks with retries exist at `apps/api/src/webhooks/webhook-dispatch.service.ts:29-52`, `:87-247` and `apps/api/src/webhooks/webhook-retry.worker.ts:137-307`.

##### Open gaps

Only `emergency.triggered` and `emergency.cleared` are allowed at `apps/api/src/webhooks/webhooks.service.ts:13-33`. Twilio, SendGrid, APNs/FCM, Slack, Teams, and PagerDuty/OpsGenie are N/A. Settings incorrectly says webhooks are “coming next release” at `apps/web/src/app/[schoolId]/settings/page.tsx:375-392`.

##### Required implementation

Introduce `NotificationEndpoint`, `NotificationPolicy`, `EscalationStep`, and `DeliveryAttempt`, plus adapters with consent, quiet hours, recipient/audience rules, idempotency, DLQ, test mode, and delivery timeline. Expand the webhook event taxonomy only when producers and tests exist.

**Acceptance:** a simulated incident fans out differentiated screen/email/SMS/push/webhook payloads; retries survive process death; UI shows delivered/failed/dead-letter; unsupported channels cannot be enabled.

#### §10 — authentication and identity

##### Working

Argon2id, durable JWT revocation, sessions, and full TOTP/backup-code MFA exist: `apps/api/src/users/users.controller.ts:203-204`; `apps/api/src/realtime/redis.service.ts:227-395`; `apps/api/src/main.ts:164`; `apps/api/src/auth/mfa.controller.ts:116-568`.

##### Open gaps

- SAML is intentionally unavailable because the library was removed; every request ends in an honest 503 at `apps/api/src/sso/sso.service.ts:9-19`, `:244-293`. Help says “fully supported” at `apps/web/src/content/help/sso.md:40-57`.
- OIDC is generic and real, but public “Google, Microsoft & SSO out of the box” copy at `apps/web/src/app/page.tsx:368-372` implies preconfigured social buttons.
- WebAuthn/passkeys are absent.
- Clever fetches only the first page of users (`limit=1000`) at `apps/api/src/integrations/clever/clever-http.client.ts:81-85` and runs nightly at `clever-sync.cron.ts:5-12`; help falsely claims schools, sections, bell schedules, terms, and delta webhooks at `apps/web/src/content/help/clever.md:10-39`.

##### Required implementation

Either ship maintained SAML with signed AuthnRequest/assertion, metadata/certificate rotation, and real IdP E2E tests, or remove it everywhere. Add WebAuthn. Paginate Clever and model each claimed resource before restoring help copy.

**Acceptance:** real Google/Entra/Okta test tenants; logout/role/panic-capability revocation across HTTP/WS/SSE; SAML wrapping/replay tests; Clever >1,000-user reconciliation and deletion tests.

#### §11 — billing

Stripe Checkout, Portal, invoices, event ledger/order guards/audit, and daily quantity reconciliation are substantive: `packages/database/prisma/schema.prisma:551-601`; `apps/api/src/billing/license-reconcile.cron.ts:5-54`. PCI scope is SAQ-A; comp seats exist.

Beyond the product-truth repair, add a customer-visible dunning/grace timeline, a real PO workflow or remove PO claims, and a refund/credit-note policy and API. Help currently invents PO entry, cancellation, 90-day grace, deletion, and refunds at `apps/web/src/content/help/billing.md:25-55`.

**Acceptance:** duplicate/out-of-order webhook suite; pair/unpair quantity reconciliation; failed-payment banner/email/grace enforcement; PO approval audit; refund/credit-note reconciliation.

#### §12 — design imports

PPTX/PDF/image parsing exists, with slide/zone and decompression caps.

##### Open defects

- Legacy `.ppt` is accepted as PPTX at `apps/api/src/imports/imports.controller.ts:80-109`; binary PPT cannot be parsed and falls through to an IMAGE zone.
- A raw playlist asset is always created first at `apps/api/src/imports/imports.controller.ts:266-314`; a PPTX “Add to Playlist” item is therefore unplayable.
- PDF only extracts text, not page graphics, at `apps/api/src/imports/imports.controller.ts:369-383`, while UI promises fully editable text/images and image fallback at `apps/web/src/app/[schoolId]/templates/imports/page.tsx:184-188`, `:328-332`, `:429-432`.
- Canva, Drive/Slides, Graph, and Figma are N/A. Keynote is export-only.

##### Required implementation

Reject `.ppt` or convert it through isolated LibreOffice. Make import an asynchronous `ImportJob` with preview, fidelity warnings, virus scan, and atomic commit. Rasterize each page for faithful fallback, then overlay extracted editable elements. Add source-link/re-sync only after OAuth adapters exist.

**Acceptance:** golden decks covering masters, groups, tables, charts, fonts, transparency, and multi-page PDF; screenshot-diff threshold; no raw PPT/PPTX playlist item; parse failure creates a renderable page image with an explicit warning.

#### §13 — public alerts

CAP, IPAWS, Raptor, RapidSOS, and PA/IP-speaker integrations are all **N/A—not built**. The EULA correctly disclaims them at `apps/web/src/app/terms/eula/page.tsx:100-115`.

Recommended build order: canonical CAP-1.2-compatible `IncidentEvent`; signed inbound CAP parser with geofence/dedupe/expiry; IPAWS test-feed consumption; Raptor/RapidSOS partner adapter; PA bridge last. Outbound IPAWS remains prohibited unless FEMA-authorized.

**Acceptance:** FEMA sample corpus, invalid-signature/replay/geofence tests, partner sandbox drill, and immutable transition audit.

#### §14 — multi-vertical

All 12 vertical labels, alert defaults, and sample URLs exist at `packages/api-types/src/verticals.ts:40-194`, `:351-364`; AI voices cover all at `apps/api/src/ai/ai.service.ts:217-243`.

##### Open gaps

- `DistrictSchoolsCard` contains vertical copy but deliberately ignores it and always returns Location/Primary at `apps/web/src/components/settings/DistrictSchoolsCard.tsx:106-190`.
- Sample seeding skips everything if either POS or streaming already exists at `apps/api/src/sample-data/sample-data.service.ts:65-100`; partial failures never self-heal.
- Veterinary/real-estate/museum are provisionally mapped to other verticals at `apps/api/src/templates/ensure-system-presets.ts:105-132`.
- Bulk brand apply is destructive and creates no template-version rollback: `apps/api/src/branding/branding.controller.ts:704-865`.

##### Required implementation

Decide on universal nouns or enforce the canonical vertical nouns; delete the contradictory dead map. Seed each capability idempotently through durable jobs. Add per-widget brand bindings, contrast validation, dry-run visual diff, and batch rollback.

#### §19 — catalog and editability

Catalog quality is uneven, not universally weak. Strong sports/high-school designs coexist with release blockers:

- No rights/approval/release metadata exists in `Template` at `packages/database/prisma/schema.prisma:1141-1225`.
- A fresh database seeds every source preset ACTIVE at `apps/api/src/templates/ensure-system-presets.ts:343-394`, including the explicit sandbox at `apps/api/src/templates/system-presets.ts:1477-1492`.
- Domino’s imagery is marked pilot-demo-only at `apps/web/public/templates/signage/qsr/img/dominos/CREDITS.txt:1-5` but is active in QSR/Restaurant.
- Seventeen active external boards lack posters; gallery falls back to a live iframe on 404 at `apps/web/src/components/templates/ScaledTemplateThumbnail.tsx:87-119`, `:212-235`.
- Fifty-five active boards depend on remote fonts; the service worker does not cache cross-origin misses or HTML/fonts at `apps/web/public/sw-player.js:289-317`.
- Save is two requests, leaving a race/partial-write window at `apps/web/src/components/template-builder/BuilderShell.tsx:288-355`; Save As silently collapses scenes on errors at `:561-677`.
- The CTS template-level source control edits nonexistent metadata at `apps/web/src/components/template-builder/PropertiesPanel.tsx:1072-1141`; `Template` has no data-source columns.
- Switching inline AI HTML to a packaged URL does not clear `html`; the renderer prioritizes `srcdoc` at `apps/web/src/components/widgets/WidgetRenderer.tsx:3939-3955`.

Widget grades: native primitives A-/B+; native lists/menus B+; V2 industry widgets B; sports/live widgets B; packaged external HTML B-/C depending on hook coverage; AI inline HTML D/C-. Anything external/AI without a complete field census, structural editing, and verified binding remains below the launch standard.

##### Required implementation

Create a versioned release manifest with `DRAFT/QA/APPROVED/PUBLISHED/QUARANTINED`, rights/license owner, approver, screenshot hash, supported integrations, offline asset manifest, and minimum editability score. Replace boot mutation with an explicit reconcile migration. Add atomic `PUT /templates/:id/design` and clone endpoints covering metadata, zones, scenes, revision, and snapshot in one transaction.

**Acceptance:** every published template has rights approval, poster, Chromium/WebKit landscape/portrait screenshots, zero overflow/placeholders/console errors, offline screenshot parity, ≥B editability, and every declared “live” capability backed by an adapter test.

#### Public-help cleanup and §21 verification discipline

Help is not trustworthy enough to publish:

- Asset limits/SVG/trash/export claims conflict with code: `apps/web/src/content/help/assets.md:10-57` versus `apps/api/src/assets/assets.controller.ts:71-127`, `:1181-1264`.
- Getting Started says 17 templates and SCHOOL_ADMIN signup at `apps/web/src/content/help/getting-started.md:14-35`, while signup creates DISTRICT_ADMIN.
- Invite help invents bulk invite/disable and broad delete access at `apps/web/src/content/help/invite-users.md:22-58`.
- Emergency help says each player verifies the signature, but the client only checks signature presence at `apps/web/src/app/player/page.tsx:4293-4305`, `:4332-4341`; full verification is server-side at `apps/api/src/realtime/redis.service.ts:182-203`.

Create a claim registry with owner, evidence link, capability status, and review date; CI must reject public claims not backed by a registered capability/test.

**Verification limitation:** these are code/database findings. No fix should be called shipped until CI is green and provider sandbox plus Chromium/WebKit/offline screenshots satisfy Standard Audit Surface §21.

---

## Part II.D — Core systems evidence

### Core Systems Audit Checkpoint

**Audit baseline:** `3f274702edb9079417b944749e3eb756a4ea9daa`
**Scope:** Standard Audit Surface §§1, 2, 15–18. Read-only.

#### §1 — real-time and signed pub/sub

| Priority | Finding | Evidence | Required fix | Acceptance test |
|---|---|---|---|---|
| P1 | The player does not cryptographically authenticate commands at the device boundary; it only checks that a signature exists. | `apps/api/src/security/ws-signature.ts:12`; `apps/web/src/app/player/page.tsx:4293` | Introduce a versioned Ed25519 envelope with `keyId`, canonical payload, event ID, issue/expiry times, and pinned public keys delivered during pairing. Verify with WebCrypto before executing any control event. Add rotation and revocation. | Tampered payload, arbitrary signature, unknown/revoked key, stale event, and mismatched tenant/screen all fail. Valid commands work on WebKit, Android WebView, Chromium 83, and current Chromium. |
| P1 | Replay protection covers only selected event types. `REFRESH_WEB`, `CHECK_FOR_UPDATES`, game-state, and cue events can be replayed. | `apps/web/src/app/player/page.tsx:4324`, `:4430` | Require unique `eventId` and freshness validation for every signed event. Deduplicate every event type and persist a bounded replay ledger across reloads for reload-causing commands. | Sending one valid envelope 100 times causes exactly one action. Replaying it after reload causes no second reload. |
| P1 | SSE places the device JWT in the query string and reflects arbitrary origins while allowing credentials. | `apps/api/src/realtime/sse.controller.ts:12`, `:102` | Exchange the device JWT for a 30-second, single-use SSE ticket, or use an authenticated fetch stream. Apply the central origin allowlist and redact URL query values. | Device JWT never appears in access logs, telemetry, browser history, or referrers. Expired/reused tickets fail. Unapproved origins receive no CORS grant. |
| P1 | Emergency authorization relies on the potentially stale `canTriggerPanic` claim in a long-lived JWT. | `apps/api/src/auth/rbac.guard.ts:49`; `apps/api/src/emergency/emergency.controller.ts:352` | Add a dedicated emergency-capability guard that reads current user status, tenant membership, role, and panic capability from the database for every trigger and clear. Fail closed. | Revoking panic permission immediately causes an existing JWT to receive 403; no re-login is required. |
| P1 | Revocation-store failure semantics are internally contradictory and can fail open. | `apps/api/src/realtime/redis.service.ts:225`; `apps/api/src/auth/jwt-auth.guard.ts:83` | Return a tri-state result or throw when both Redis and DB are unavailable. Life-safety/admin mutations must fail closed; define and test a separate availability policy for device reads. | With Redis and DB revocation checks unavailable, emergency mutations are rejected and never accidentally authorized. |

Verified controls already present: canonical HMAC and timing-safe comparison, timestamp freshness, Redis verification before fan-out, device JWT/revocation/live-screen checks, manifest polling fallback, and broad player event handling.

#### §2 — storage, offline content, and media

| Priority | Finding | Evidence | Required fix | Acceptance test |
|---|---|---|---|---|
| P0 | API-generated USB bundles are incompatible with the Android ingester. The schemas and asset layouts do not match. | `apps/api/src/usb-export/usb-export.controller.ts:282`; `apps/player/app/src/main/java/com/educms/player/usb/UsbIngester.kt:86` | Define one versioned JSON Schema and generate TypeScript/Kotlin models from it. Include `schema`, `bundleVersion`, top-level asset index, hashes, local paths, screen binding, and emergency metadata. | An actual API ZIP fixture is accepted by the Android ingester, verifies every hash, and plays offline. Unknown future versions reject clearly. |
| P0 | Documentation claims USB PIN protection, but Android opens the picker without a PIN challenge. | `apps/api/src/usb-export/usb-export.controller.ts:363`; `apps/player/app/src/main/java/com/educms/player/usb/UsbIngestActivity.kt:19` | Add locally enrolled admin authentication or a salted, slow-hashed PIN verifier with retry limits and lockout. Require elevated approval for emergency bundles. Correct the documentation immediately. | No USB file is inspected or copied before authorization. Wrong-PIN and lockout tests pass; the correct PIN permits import. |
| P1 | The ingester does not enforce bundle expiration, target screen, or rollback protection. | `apps/api/src/usb-export/usb-export.controller.ts:341`; `apps/player/app/src/main/java/com/educms/player/usb/UsbIngester.kt:86` | Enforce exact device/screen binding, expiry, and a monotonic signed generation counter. Provide a deliberate local override procedure for invalid device clocks. | Expired, other-screen, and older signed bundles reject; a current exact-screen bundle succeeds. |
| P1 | USB ingestion reads files fully into memory and mutates the live cache incrementally. A late failure can leave partial content. | `apps/player/app/src/main/java/com/educms/player/usb/UsbIngester.kt:66`, `:131` | Stream each asset while hashing; enforce file, count, and aggregate limits. Stage the entire bundle and atomically switch the active pointer only after complete verification. | A 2 GB low-memory test does not OOM. Corrupting the final asset leaves the previous active bundle byte-identical. |
| P1 | The advertised 1 GB emergency cache floor is only a reporting constant, not reserved durable space. | `apps/web/public/sw-player.js:74`, `:606` | Request persistent storage, inspect quota before caching, prioritize emergency bytes, retain headroom, and expose persistence/quota state. Native Android should use app-private storage for the hard guarantee. | Under forced quota pressure, ordinary playlist content is evicted while every emergency asset remains available offline. |
| P2 | Cache eviction is insertion-order despite being described as LRU. | `apps/web/public/sw-player.js:342` | Track durable `lastAccess` metadata and protect current, next, emergency, and manifest-required assets. | After re-accessing A, pressure evicts older unused B—not A or current/next content. |
| P1 | Assets with missing hashes are cached without integrity verification. | `apps/web/public/sw-player.js:500` | Complete hash backfill and enforce hashes at the data boundary. Emergency content must reject null integrity; ordinary legacy content should be quarantined or visibly degraded. | An emergency manifest containing a null hash can never report ready. Managed asset creation cannot produce a null hash. |
| P1 | Floor-plan URL signing fails open to the original stored URL; legacy public URLs can escape. RBAC policy is inconsistent with the ADMIN-only comment. | `apps/api/src/floor-plans/floor-plans.controller.ts:230`, `:256` | Migrate objects to private storage; store bucket/path rather than URL; fail closed if signing fails. Resolve and enforce the intended role policy. | Legacy public object URLs return 404. A signer outage never returns the original URL. Unauthorized contributors are denied if policy is admin-only. |
| P1 | There is no production-grade upload transcoding pipeline for video. | `apps/api/src/storage/media-optimization.service.ts:40` | Add durable asynchronous jobs for validation, H.264/AAC renditions, thumbnails, status, retries, poison-file quarantine, and device-capability variants. | Large phone video transitions `PROCESSING → READY`, plays on target hardware, resumes after worker failure, and preserves/quarantines the original. |
| P2 | Storage REST requests lack explicit timeouts and bounded retries. | `apps/api/src/storage/supabase-storage.service.ts:356`, `:521` | Add `AbortSignal` deadlines, bounded jittered retries, idempotent object naming, and latency/error metrics. | A hung request aborts within budget; one transient failure retries without duplicate objects. |

Verified controls already present: private signed floor-plan URLs for current records, upload cache headers, image resize/EXIF removal, SHA-256 service-worker checks for hashed assets, and reset/backfill verification wiring.

#### §15 — cross-browser and Taurus

| Priority | Finding | Evidence | Required fix | Acceptance test |
|---|---|---|---|---|
| P1 | The Taurus check allows 1,195 `gap` and 1,037 container-query compatibility violations as baseline debt. | `apps/web/tools/check-taurus-safety.cjs:210`; `apps/web/tools/taurus-safety-baseline.json` | Run a measured burn-down to audited exceptions only. Replace unsupported layout features with tested longhand/flex/pixel-scale equivalents. Prohibit baseline increases. | Totals decrease monotonically; every modified widget has an exact Chromium 83/Taurus screenshot comparison. |
| P1 | Active external HTML templates receive only a narrow inset check, not the full compatibility scan. | `apps/web/tools/check-taurus-safety.cjs:39`; `apps/web/src/components/widgets/signage-templates.ts:18` | Scan every active registered HTML template for the complete unsupported-feature set and compile explicit fallbacks. | All active registered URLs pass the full scanner and render legibly with nonzero layout on Chromium 83. |
| P1 | CI does not execute the product on Chromium 83 or a Taurus device. The Taurus job is a static Node scanner. | `.github/workflows/taurus-safety.yml:18`; `.github/workflows/cross-browser.yml:167` | Add an archived Chromium 83 container and nightly real-device Taurus canary with DOM and screenshot assertions. | A known unsupported fixture fails in both exact-browser and device jobs; the production registry sweep passes. |
| P2 | Firefox is intentionally absent and the full active-template registry is not rendered across engines. | `.github/workflows/cross-browser.yml:23` | Add nightly Firefox/WebKit/Chromium authenticated route and template sweeps, retaining a risk-based PR subset. | Each supported engine and orientation produces a route/template result artifact. |
| P1 | Android CI only compiles the APK; there are no player tests. | `.github/workflows/android-player-apk.yml:85`; `apps/player/app/build.gradle.kts:219` | Add JVM contract tests and Android emulator/device-lab tests across Android 7/9/13 and WebView 83/current for pairing, offline, USB, OTA, and emergency flows. | CI executes tests instead of only `assemble`; a deliberate USB-schema or emergency-handler regression fails. |

#### §16 — forensics, auditability, and isolation

| Priority | Finding | Evidence | Required fix | Acceptance test |
|---|---|---|---|---|
| P1 | Privileged mutations have inconsistent or swallowed audit logging and are often not transactional with the mutation. | `apps/api/src/streaming/streaming.service.ts:90`; `apps/api/src/floor-plans/floor-plans.controller.ts:540`; `apps/api/src/usb-export/usb-export.controller.ts:384` | Introduce a central `AuditWriter` and action taxonomy. Execute sensitive mutation plus audit insert in one DB transaction. Add a CI audit-coverage manifest. | Every successful privileged mutation produces exactly one correlated row. Forced audit-insert failure rolls back the sensitive mutation. |
| P1 | Audit immutability blocks UPDATE/DELETE but explicitly leaves TRUNCATE possible. | `packages/database/prisma/migrations/20260531000000_audit_logs_immutable/migration.sql:21` | Add a `BEFORE TRUNCATE` guard. Restrict the API DB role to INSERT/SELECT. Use a separate audited retention role and chain-hashed/WORM export. | API role cannot update, delete, or truncate audit rows. Retention succeeds only through the controlled privileged workflow. |
| P1 | Webhook retries create a new delivery ID each attempt and provide no stable event idempotency key. | `apps/api/src/webhooks/webhook-dispatch.service.ts:119`, `:190` | Persist a stable `eventId` and `deliveryId` before the first attempt; reuse both in body, header, and signature for retries. | A success followed by lost acknowledgment retries with the same ID and creates one receiver-side effect. |
| P1 | Cross-tenant isolation remains controller convention rather than a deny-by-default resource policy. | `apps/api/src/auth/rbac.guard.ts:115` | Add a resource-authorization service that resolves ownership for every ID/slug route. Provide typed tenant-scoped repository helpers and forbid unscoped lookups. | Generated tenant-A-token/tenant-B-resource tests return 403/404 for every route, with no mutation or information leakage. |
| P2 | Address/coordinate repair is manual rather than a durable consistency process. | `apps/api/src/app.module.ts:41`; `apps/api/src/geocode-backfill/geocode-backfill.controller.ts:33` | Add a scheduled consistency job with a distributed lease, dry-run report, bounded retries, and audit summary. | Injected drift is repaired once; two replicas still execute one logical run. |

#### §17 — operations and reliability

| Priority | Finding | Evidence | Required fix | Acceptance test |
|---|---|---|---|---|
| P0 | Web lint is false-green. The flat config cannot resolve `jsx-a11y`, and CI masks lint failure with `|| true`. | `apps/web/eslint.config.mjs:5`; `.github/workflows/ci.yml:80` | Register the plugin in the active flat config, remove error masking, preserve the linter exit status, then eliminate the baseline. | Clean lint exits 0. A config error or one injected violation makes CI red. |
| P0 | Root Playwright E2E collection is broken by Jest globals and mock/nonexistent routes; core real scenarios are skipped. | `playwright.config.ts:7`; `tests/e2e/all-clear.test.ts:1`; `tests/e2e/panic-trigger.spec.ts:22` | Port or delete theater tests, import `@playwright/test`, use ephemeral Postgres/Redis and real routes/users, and fail when unexpected skip counts rise. | Collection has no errors and exceeds a defined minimum. Real trigger → player receipt → all-clear passes. |
| P1 | Uncaught exceptions and unhandled rejections are logged while the process continues serving. | `apps/api/src/main.ts:21` | Capture/flush telemetry, mark readiness false, drain connections, and exit nonzero. Handle expected promise failures locally. | Injected fatal error causes exactly one controlled exit/restart and no post-fault traffic serving. |
| P1 | `express-session` uses the process-local default store, making SSO state replica- and restart-dependent. | `apps/api/src/main.ts:162` | Use Redis-backed sessions with secure TTL/prefixing, or encrypted stateless one-time OIDC transaction cookies. | Login initiated on replica A and completed on B succeeds; replay fails; restart behavior is explicit and tested. |
| P1 | Multiple background processes rely on local maps/timers and will duplicate or race when replicas increase. | `apps/api/src/sports/clock-advance.service.ts:23`; `apps/api/src/player-ota/canary-auto-promote.ts:35`; `apps/api/src/screens/screen-wedge-detector.cron.ts:204` | Move correctness to durable queues, DB leases/CAS operations, and unique run keys. Do not rely on in-process locks. | Two API processes produce one logical promotion, recovery, clock advance, sample, and sync per event/window. |
| P1 | Runtime bootstrap performs raw schema DDL even though Railway already applies migrations. | `apps/api/src/main.ts:287`; `apps/api/src/prisma/prisma.service.ts:46` | Move all DDL to migrations, remove boot-time schema mutation after deployment verification, and add a pre-listen schema-version check. | Migrated DB boots with zero DDL. A missing migration blocks readiness/deployment before traffic. |
| P1 | Integration health reports READY from configuration or a database row rather than a verified end-to-end operation. | `apps/api/src/health/integrations-health.controller.ts:272`, `:362` | Separate `CONFIGURED`, `VERIFIED`, and `DEGRADED`. Add bounded active probes and timestamps for last successful real operation. | Invalid credentials return degraded. READY/VERIFIED requires a successful upload, playback, sync, or event canary as appropriate. |
| P1 | Backup automation and restoration verification remain manual/planned. | `docs/BACKUP_AND_ROLLBACK.md:118` | Schedule encrypted off-provider dumps with checksums, retention, missed-run alerts, and quarterly isolated restore drills against declared RPO/RTO. | A fresh dump restores into an isolated DB; schema, critical row counts, and sampled hashes pass, with measured restore duration. |
| P1 | Required-secret validation is not fully centralized at boot; some secrets are first demanded on request paths. | `apps/api/src/devices/devices.controller.ts:107`; `apps/api/src/realtime/sse.controller.ts:55` | Add one typed environment schema executed before application construction. Validate presence, format, length, and key separation; expose optional features as explicitly disabled. | Table-driven production tests removing each required secret fail before the server listens. |
| P1 | Telemetry redaction is shallow and there is no universal correlation ID spanning HTTP, Redis, webhook, and player acknowledgment. | `apps/api/src/sentry.ts:4`; `apps/api/src/common/all-exceptions.filter.ts:136` | Recursively redact sensitive keys and URL values, adopt a PII allowlist, issue `X-Request-ID`, and propagate correlation IDs through event envelopes and callbacks. | Nested secrets and `?token=` never reach captured events. One ID traces API request through player acknowledgment. |

The largest source files are also a material operational/maintainability risk: `PropertiesPanel.tsx` is 11,026 lines, the player page 8,585, the sports console 8,372, `sports.service.ts` 5,880, `ai.service.ts` 5,794, `WidgetRenderer.tsx` 5,351, the templates page 4,932, board page 4,637, `use-api.ts` 4,176, and `screens.controller.ts` 3,782. Split these by bounded domain before adding more behavior; new features should not continue accumulating in these monoliths.

#### §18 — accessibility

| Priority | Finding | Evidence | Required fix | Acceptance test |
|---|---|---|---|---|
| P0 | Accessibility lint enforcement is nonfunctional because of the same ESLint configuration and CI-masking defect. | `apps/web/eslint.config.mjs:5`; `.github/workflows/ci.yml:80` | Repair lint first and make accessibility violations blocking. | One missing accessible name reliably makes CI fail. |
| P1 | Axe coverage audits mostly unauthenticated shells, and page-load failures can produce an empty “pass.” | `apps/web/scripts/a11y-audit.ts:35`, `:71` | Seed/login with saved auth state, enumerate authenticated routes and important modal states, fail on redirects/load errors, and run in Chromium plus WebKit. | Templates, builder, screens, floor plans, sports, and emergency states are audited after authentication; a deliberate violation fails. |
| P1 | The project tolerates 99 accessibility errors and disables multiple rules across the entire large templates page. | `apps/web/scripts/a11y-warning-baseline.json`; `apps/web/src/app/[schoolId]/templates/page.tsx:1` | Burn the baseline to zero. Allow only narrowly scoped, issue-linked, expiring suppressions. Move recurring interaction behavior into accessible primitives. | Zero JSX accessibility errors and no file-wide accessibility disables. |
| P1 | `EmergencyTriggerModal` lacks complete dialog semantics, focus containment, and return-to-invoker behavior. | `apps/web/src/components/emergency/EmergencyTriggerModal.tsx:154` | Rebuild with an audited alert-dialog primitive, accessible title/description, initial focus, trap, return focus, and protected dismissal behavior appropriate to life safety. | Keyboard and screen-reader tests prove focus containment, typed-confirm activation, announced result, and focus restoration. |
| P1 | Shared `AppDialog` does not consistently restore focus or trap prompt focus, and can lack a valid accessible name/input label. | `apps/web/src/components/ui/app-dialog.tsx:170`, `:251` | Replace it with one WAI-ARIA-compliant dialog primitive supporting inert background, focus stack/return, required names/descriptions, and nested dialogs. | Confirm, alert, prompt, and nested-dialog keyboard suites pass the ARIA pattern. |
| P1 | Floor-plan placement and movement are effectively pointer-only. | `apps/web/src/components/floor-plans/EmbeddedFloorPlanView.tsx:650`, `:730` | Add keyboard selection, place/move/detach commands, arrow-key movement with coarse modifier, and a form/list alternative announcing coordinates and state. | A keyboard-only user can place, move, configure, and detach a screen; a screen reader announces coordinates and save status. |

Verified controls already present include emergency live regions, keyboard-capable panic hold interaction, the all-clear overlay focus trap, and map status labels that are not color-only.

#### First implementation wave

Start with the P0s: unify and authenticate USB bundles; repair lint and accessibility enforcement; repair E2E collection and make the real life-safety journey blocking. Those failures currently invalidate major parts of the project’s claimed safety and release assurance.

---

## Part II.E — Streaming evidence

### Streaming Integration Audit Checkpoint

**Audit baseline:** `3f274702`
**Standard Audit Surface §6 status:** Covered. Read-only code inspection; no provider credentials, protected streams, venue hardware, or DRM sources were exercised.

| Lens | Grade | Honest verdict |
|---|---:|---|
| Design | B | The settings experience is visually polished and unusually candid about bridge/closed providers. |
| UX | C | A basic HLS/public-broadcaster path exists, but connection → channel → template requires duplicated steps and several promises do not match the runtime. |
| Functionality | C− | HLS and selected iframe embeds work in principle; DASH/RTSP/NFHS/Facebook are absent, manual YouTube/Twitch channel creation is broken, signed URL refresh is not implemented, and ad-slot scheduling is schema-only. |

#### Capability inventory

| Capability | Status | Evidence / truth |
|---|---|---|
| HLS / M3U8 | Built, incomplete | Native Safari HLS plus lazy `hls.js` fallback at `apps/web/src/components/widgets/StreamingWidget.tsx:192-245`. No durable runtime health/failover/canary proof. |
| MPEG-DASH | N/A—not built | Explicitly rejected at `StreamingWidget.tsx:147-161` and `apps/api/src/streaming/streaming.service.ts:462-472`. |
| RTSP / RTMP | N/A—not built | Renderer shows “requires transcode” at `StreamingWidget.tsx:135-145`; no gateway service exists. |
| YouTube | Partially built | URL normalization exists at `StreamingWidget.tsx:281-303`, but manual channel persistence drops its URL; see P1 below. |
| Twitch | Partially built | Embed normalization exists at `StreamingWidget.tsx:304-312`, but the same persistence defect applies. No Chromium-83 or real-host canary. |
| Vimeo | Assisted/partial | Embed normalization exists at `StreamingWidget.tsx:313-318`; OAuth is explicitly unbuilt and cataloged PARTNER. |
| Facebook Live | N/A—not built | No provider/normalizer/runtime path. |
| Periscope | N/A/obsolete | No path; the discontinued service should be removed from the standing product checklist rather than promised. |
| Public broadcasters | Built, needs canaries/legal registry | Curated YouTube-live presets exist in `packages/api-types/src/streaming-presets.ts`; no continuous embed-availability canary. |
| NFHS Network | N/A—not built as a software integration | Hardware copy describes HDMI capture, but there is no NFHS adapter, OAuth, data path, or overlay contract. |
| Webcam URL | Partial generic fallback | An arbitrary public HTTP(S) URL may fall through to iframe; no explicit webcam capability, permission model, or tested formats. |
| Stream as scheduled playlist asset | N/A—not built | Streaming is a template widget/channel snapshot, not an `Asset`/playlist item with scheduling and offline semantics. |
| RTSP responder share link | N/A—not built | No responder bridge, authorization, transcoder lifecycle, or temporary share-link path. |
| Scheduled stream ad overlays | Schema/demo-only | `StreamAdSlot` exists at `packages/database/prisma/schema.prisma:1670-1692`; no CRUD/controller/scheduling UI exists, and the settings header calls it future work. |

#### P1 — manual YouTube/Twitch/Vimeo channel creation drops the playback URL

The primary “paste a URL” path is broken:

1. The settings flow detects an iframe URL, but sends `playbackUrl: undefined` at `apps/web/src/app/[schoolId]/settings/streaming/page.tsx:762-773`.
2. `StreamingService.addChannel` persists the missing value without deriving it from `externalId` at `apps/api/src/streaming/streaming.service.ts:223-251`.
3. The template picker copies that missing value into widget config at `apps/web/src/components/template-builder/PropertiesPanel.tsx:5060-5069`.
4. The widget requires `playbackUrl` or `embedUrl` and otherwise renders “No channel selected” at `apps/web/src/components/widgets/StreamingWidget.tsx:118-133`.

##### Required implementation

- Store a canonical source URL for every channel, regardless of playback kind.
- Derive `embedUrl` server-side through a shared canonicalizer; never duplicate provider parsing in settings and renderer.
- Add one browser E2E per DIRECT iframe provider: connect → paste → validate → add channel → bind widget → render in player.
- Backfill existing iframe channels whose URL survived only in `externalId`.

**Acceptance:** a real public YouTube and Twitch URL persists, reopens, previews, and plays after a full reload and on the paired-player route.

#### P1 — the runtime snapshots a URL; it does not resolve a channel

Comments claim channel IDs resolve through `/streaming/channels/:id`, including signed-URL refresh (`WidgetRenderer.tsx:99-103` and `PropertiesPanel.tsx:9525-9528`). The actual widget never fetches a channel. The editor copies `playbackUrl` into template JSON once at `PropertiesPanel.tsx:5060-5069`, and `StreamingWidget` only reads that snapshot. `resolvePlayback` is user-JWT-protected and simply returns the stored URL at `apps/api/src/streaming/streaming.service.ts:281-295`; no device-authenticated resolver or signed URL refresh exists.

##### Required implementation

- Persist only `streamingChannelId` in the design document.
- Resolve playback through a device-authenticated endpoint included in the player manifest or a short-lived device URL.
- Track channel version, credential health, expiry, last verification, and backup URL.
- Refresh signed URLs before expiry without requiring template resave/redeploy.
- When a connection/channel is revoked, every player must stop using the stale snapshot immediately.

**Acceptance:** rotate a signed HLS URL while a player is live; the player changes URL without editing the template. Revoking the channel replaces playback with the configured fallback within the SLA.

#### P1 — Custom HLS and IPTV UX overpromise

- A Custom HLS connection stores the URL inside encrypted credentials but does not create a channel. The operator must paste the same URL again in “Pick channels.”
- Custom-HLS connections remain `PENDING` forever because only `none`/`iframeOnly` auto-activate at `apps/api/src/streaming/streaming.service.ts:134-150`, even when the URL validator succeeds.
- The catalog says “Upload a .m3u / .m3u8 playlist file” at `packages/api-types/src/streaming.ts:388-400`; the UI only exposes a text URL at `apps/web/src/app/[schoolId]/settings/streaming/page.tsx:618-625`, and there is no playlist-file parser/import.
- The settings hero says “We handle the setup” at `apps/web/src/app/[schoolId]/settings/streaming/page.tsx:150-155`, but the bridge workflow requires an external capture device, mini-PC, ffmpeg/HLS server, repeated URL entry, channel selection, and manual widget binding.

##### Required implementation

Collapse HLS into one transaction: paste URL → validate → create ACTIVE connection + canonical channel → offer “Add to a screen.” Implement a real bounded M3U parser if the upload claim remains; otherwise rename the provider to “HLS channel URL.” Provide a downloadable, supported bridge appliance only when it actually exists and is supportable.

**Acceptance:** a nontechnical operator goes from one `.m3u8` URL to a playing screen in ≤30 seconds without entering the URL twice or visiting the template builder.

#### P1 — no production playback health, recovery, or observability

The HLS widget surfaces fatal errors as an 11px overlay (`StreamingWidget.tsx:229-260`) but has no explicit recovery state machine, backup source, operator alert, black-frame/frozen-frame detection, acknowledgement, or stream SLA telemetry. Provider/catalog health is configuration-driven rather than a continuously verified playback operation.

##### Required implementation

Create a `StreamPlaybackSession` state machine with `CONNECTING`, `PLAYING`, `BUFFERING`, `DEGRADED`, `FAILED`, and `FALLBACK`; bounded exponential recovery; fatal-media recovery; backup channel/slate; and player acknowledgements. Measure startup time, rebuffer ratio, fatal rate, last decoded frame, audio state, and URL-expiry refresh. Expose a fleet “stream health” view and alerts.

**Acceptance:** kill the origin, rotate the URL, corrupt a segment, and restore it. The screen never stays black, uses the declared fallback, and the dashboard shows the same state with timestamps.

#### P1 — arbitrary iframe fallback and hard-coded legal status need governance

Unknown public HTTP(S) URLs are accepted with a warning at `apps/api/src/streaming/streaming.service.ts:475-482`, then rendered as an unsandboxed iframe if selected (`StreamingWidget.tsx:266-320`). Commercial-use legality is a hard-coded catalog boolean with no review date, counsel owner, terms version, or evidence artifact in `packages/api-types/src/streaming.ts`.

##### Required implementation

- Allowlist playback adapters and explicitly classify generic iframe content separately from streaming.
- Apply provider-specific sandbox/permission policy and a restrictive frame CSP.
- Add `termsReviewedAt`, `termsUrl`, `reviewer`, `allowedUse`, and `overlayPolicy` to the provider release manifest.
- Default unknown sources to “unverified custom embed,” never to a green venue-safe claim.

#### P1 — streaming credentials reuse the device-token secret

Streaming envelope encryption wraps credentials with `DEVICE_SECRET_KEY` and has no key version at `apps/api/src/streaming/creds-cipher.ts:10-25`, `:33-45`. This prevents clean separation and rotation.

Use a dedicated KMS/`STREAMING_CREDENTIAL_KEK`, store key version, support dual-read/rewrap rotation, and audit create/test/rotate/revoke. Never return a silently empty object on credential JSON parse failure (`creds-cipher.ts:83-93`).

#### Test and release gate

No focused streaming service/widget/settings tests were found. Add:

1. Unit contract tests for URL canonicalization and provider capability policy.
2. API tests for tenant scope, validation, connection status, audit, channel lifecycle, and device playback resolution.
3. Browser E2E for HLS, YouTube, Twitch, fallback, revoked channel, and autoplay policy in Chromium/WebKit.
4. Chromium-83/Taurus playback canary for H.264 HLS and a supported iframe provider.
5. Nightly external canaries for every curated public broadcaster, recording “provider unavailable” separately from product regression.

#### Recommended sequence

1. Fix iframe URL persistence and remove false IPTV/upload claims.
2. Replace URL snapshots with device-authenticated channel resolution.
3. Collapse the HLS happy path and add health/recovery telemetry.
4. Build real ad-slot scheduling and stream-as-asset semantics only after the core resolver is durable.
5. Treat DASH, RTSP responder bridge, NFHS, and Facebook as explicit roadmap work—not shipped integrations.

---

## Part II.F — Restricted-locator-safe sports incident runbook

### Sports Security Blocker — Tracked Feed-Signing Secret

**Severity:** P0 / credential exposure
**Audit snapshot:** `3f274702`; current handoff HEAD has removed the literal from source.
**Status:** PARTIALLY COMPLETE—source removal is complete; rotation, revocation, exposure review, shared-key migration, and verification remain OPEN/UNVERIFIED.

At the audit snapshot, a tracked production-capable integration script exposed signing material. The value, exact historic locator, and introduction commit are intentionally **not reproduced in this distributable report**; keep them in the restricted incident record until revocation is cryptographically proven. The feed-token implementation also allowed fallback from the sports signing key to the shared device key, so the blast radius may extend far beyond sports.

#### Immediate incident response

1. Open a restricted incident record with incident commander, accountable approvers, environment inventory, and exact timeline. Treat the credential as compromised; do not wait to prove abuse. Preserve a forensic snapshot of key identifiers/fingerprints, configuration, token versions, encrypted-row counts, and relevant logs before changing state.
2. Determine in a non-logging, access-controlled process whether the value matches any current/historical sports or device key. Never emit either value into shell history, screenshots, tickets, audit artifacts, or generated reports.
3. Freeze issuance/ingest or enforce one database-backed cutover epoch. Install a dedicated versioned sports key with at least 32 cryptographically random bytes and strict boot validation. Transactionally revoke old tokens, drain all old replicas, verify none remains, then re-enable ingest with one short-lived smoke credential. Monitor rejected old-key/old-epoch attempts. Rollback may pause service but must never restore the compromised key.
4. Remove query-string token authentication and preserve/redact proxy, CDN, WAF, analytics, browser-history/referrer, and application records that may already contain tokens. Accept protected headers or device-authenticated channels only.
5. Replace bare/non-expiring tokens with API-issued tenant/game/scope-bound credentials containing `kid`, `jti`, issued-at, short expiry, and token version. Do not return reusable curl commands containing credentials.
6. The live integration test must have zero root-key access. It accepts only an API-issued short-lived game-scoped token, defaults to staging, requires recorded break-glass approval for a production host, redacts request/response credentials, and revokes the token/deletes the test game in `finally`.
7. If the exposed value ever served as the shared device key, **do not blindly rotate it**. It also protects WS/Redis signing, screen/GPIO HMAC, AI BYOK, MFA secrets, streaming credentials, Clever state, and other wrapped material.
8. Inventory every shared-key consumer and back up/count every encrypted row. Introduce purpose-specific versioned keys with new-primary/old-decrypt-only or dual-verify support before retirement.
9. Rewrap and reconcile all decryptable records; use an approved MFA re-enrollment path where rewrap is impossible; reissue/re-pair devices only where required. Record old/new key version, object counts/hashes, and reversible checkpoints.
10. Exercise emergency trigger, signed fan-out, physical/player receipt/acknowledgement, and all-clear during overlap. Retire the old shared key only after every dependent is migrated, old replicas are drained, and the emergency path is proven healthy.
11. Preserve/review Railway/CDN/WAF ingress, deploy/CI artifacts, secret-manager access, application AuditLog/GameEvent, and infrastructure records from earliest possible public/deployed exposure through final-replica cutover. Record telemetry gaps explicitly; missing logs are not proof of no abuse. Document affected environments/games, abuse assessment, and the accountable customer/legal notification decision.
12. Search source history, build artifacts, release bundles, caches, and shared copies. If canonical history is rewritten, retain a restricted forensic archive first. Revocation—not history rewriting—is the closure control because clones cannot be recalled.
13. Enable blocking current/history secret scanning and prove the rule with a non-secret canary fixture.

#### Structural remediation

- Give sports feed keys their own versioned KMS/secret-manager identity; require at least 32 random bytes; never fall back to the device key.
- Put `kid`, issuer, tenant ID, game ID, scopes, token version, issued-at, expiry, and unique `jti` in every feed token.
- Validate exact tenant/game/scope and current key/token version for every ingest operation.
- Support overlapping-key rotation with an explicit, short migration window; then retire the old key.
- Add rate limits, replay/idempotency protection, source/device enrollment, and a visible feed-connection health/audit timeline.
- Record source IP/proxy chain, non-reversible token fingerprint, outcome/reason, correlation ID, game/tenant, and accepted sequence without logging bearer material.

#### Acceptance gates

- The old key and every old bare-v0, structured, expiring, and non-expiring token fail in every environment and replica; a game created during cutover cannot accept the old epoch.
- A new short-lived tenant/game/scope token succeeds only for its intended operation; cross-game, cross-tenant, expired, replayed, malformed, and revoked credentials fail consistently.
- The integration test has no root-secret access, defaults to non-production, logs no credential, and always revokes/cleans up.
- Query-string tokens are rejected; a protected header/device-auth path succeeds.
- Every replica enforces the same cutover epoch; no old-key replica remains; rollback never reinstalls the compromised key.
- Every old deployment and secret-manager key version is retired; no signer key or bearer token exists in source, stdout, generated reports/curl commands, URLs, CI logs, artifacts, or telemetry.
- No AI BYOK, MFA secret, streaming credential, Clever flow, or other encrypted dependent is lost or rendered undecryptable.
- Screen/GPIO authentication and signed WS/Redis traffic work across the key overlap and after retirement.
- Emergency trigger, player receipt, acknowledgement, and all-clear remain continuously available and are verified before shared-key retirement.
- A repository/history secret scan is clean, and an injected canary secret makes CI fail.
- Infrastructure/application evidence, telemetry gaps, affected environments/games, abuse assessment, and customer/legal notification decision are recorded; absence of logs is never reported as proof of no abuse.
- Rotation/revocation is exercised in staging, then production evidence records exact cutover time, environment/replica fingerprints, smoke/rejection results, and responsible approvers before the incident is called remediated.

---

## Part II.G — Template catalog remediation ledger

### Template Catalog and Creator — World-Class Remediation Specification

#### Honest verdict

The catalog is large, but size is masking quality and release-discipline problems. It contains some genuinely strong sports/high-school work, yet it is not a curated world-class library today.

- 300 unique source presets were found; 297 system presets are active in the database.
- 133 active presets are a single `EXTERNAL_HTML` zone rather than structurally editable native boards.
- 55 active boards depend on remote Google/Typekit fonts and therefore cannot promise offline visual fidelity.
- The production review ledger at `docs/template-finalization/PROGRESS.md:22-75` lists 81 customer-facing HTML templates: 80 are pending and the Domino’s board is still only “in review.” None is stamped approved.
- Fresh databases activate every source preset at `apps/api/src/templates/ensure-system-presets.ts:343-394`; release status is not connected to approval.
- Seventeen active external boards lack posters, so the gallery can fall back to live iframes at `apps/web/src/components/templates/ScaledTemplateThumbnail.tsx:87-119`, `:212-235`.
- The Domino’s asset pack explicitly says “pilot-demo-only” at `apps/web/public/templates/signage/qsr/img/dominos/CREDITS.txt:1-5` but is active in customer verticals.
- No rights owner, license, reviewer, visual-baseline hash, last-validation time, supported-data contract, or release state exists on `Template` at `packages/database/prisma/schema.prisma:1141-1225`.

The production gallery’s signed-in DOM also shows the result of catalog-first rather than task-first design: a very long scroll of repetitive cards and canvas controls with weak curation, many one-zone 3840×2160 wrappers, and no reliable distinction between “beautiful sample,” “fully editable,” and “connected live data.”

#### Known weak/unfinished boards to triage first

##### Dimension-placeholder boards

The following active HTML boards contain visible dimension-placeholder content or equivalent unfinished measurements and must be quarantined or repaired first:

- `signage/bar/05`
- `signage/corporate/07`
- `signage/fashion/01`, `02`, `04`, `05`, `07`, `08`
- `signage/hospitality/01`, `02`, `04`, `05`, `07`, `10`
- `signage/menus-pos/03`
- `signage/qsr/01`, `02`, `04`, `05`, `06`

##### Confirmed clipping candidates

- `signage/qsr/02`
- `signage/qsr/04`
- `signage/hospitality/05`

##### Truth/offline candidates

- Twenty-four active boards describe a static or unsupported source as “live.” These must be relabeled “Sample data” until an adapter test backs the claim.
- Fifty-five active boards use remote fonts; self-host licensed font files or switch to bundled fallbacks.
- Seventeen active external boards have no poster; do not ship a gallery card without an approved poster and screenshot matrix.
- The Domino’s board and asset pack require a customer/brand license before production publication. Demo/reference assets must live in a non-production catalog.

#### P0 — install a release state between source code and the customer gallery

Add a versioned `TemplateRelease` or equivalent manifest:

```text
id
templateId
sourceRevision
state: DRAFT | QA | APPROVED | PUBLISHED | QUARANTINED | RETIRED
verticals[]
jobsToBeDone[]
supportedCanvases[]
supportedDataCapabilities[]
editabilityScore
offlineReady
rightsOwner
licenseType
licenseEvidenceUrl
reviewedByUserId
reviewedAt
visualBaselineHashes{}
browserResults{}
lastIntegrationCanaryAt
releaseNotes
```

Only `PUBLISHED` releases may appear in the customer gallery. `ensure-system-presets` must reconcile source metadata without silently publishing new code. A sandbox preset must never become customer-visible because it exists in an array.

**Acceptance:** a newly added preset is invisible to customers until a named reviewer approves rights, visuals, editability, offline behavior, and data truth. Quarantine removes it from new use without breaking existing customer instances.

#### P0 — define the visual-quality bar

Every template needs a single scorecard with blocking thresholds:

1. **Three-second comprehension:** one obvious message hierarchy; primary content recognizable from across the room.
2. **Viewing-distance typography:** for 1920×1080 signage, default body text normally ≥32–42 px and important headlines ≥64 px; exceptions require a screenshot at target physical size. Never inherit dashboard-sized 12–16 px text.
3. **Safe area:** no critical content in the outer 5%; support overscan and LED seams.
4. **Contrast:** WCAG AA minimum for informational text; life-safety states use a stricter tested palette. Brand application must not reduce contrast below threshold.
5. **Composition:** no generic “rounded rectangle + shadow” layout as the theme. The metaphor must be visible in the structure, typography, imagery, and motion.
6. **Density:** one primary and at most two secondary messages per scene unless the job is explicitly a menu, schedule, or leaderboard.
7. **Motion:** purposeful, bounded, and reduced-motion aware; no continuous GPU-heavy animation without a measured frame budget.
8. **Truth:** no fabricated names, prices, scores, wait times, records, or “live” indicators on a player. Unbound data renders a neutral empty state.
9. **Offline fidelity:** zero unapproved runtime network dependencies; fonts, textures, posters, and media available locally.
10. **Aspect fidelity:** native layouts or approved adaptations for landscape, portrait, 4K, and LED canvases—never a blindly squeezed 16:9 scene.

**Blocking screenshot matrix:** 1920×1080, 1080×1920, 3840×2160, and the supported LED canvas such as 960×1080; current Chromium, WebKit, and Chromium 83/Taurus. Compare the player render, not only the builder thumbnail.

#### P0 — make editability a release gate, not a renderer feature

Every visible element needs a stable field identity and operator control:

- Text: content, font family, size, weight, color, alignment, line-height, letter spacing, and overflow behavior.
- Image/video: asset picker or URL, fit, position, focal point, crop, mute/loop where relevant, and alt/caption metadata.
- Background: solid, two-stop gradient minimum, image, opacity/overlay, and brand tokens.
- Lists/menus/charts: add, remove, reorder, import, bind, and empty-state controls.
- Geometry: x/y/w/h, rotation, z-index, opacity, lock, group, duplicate, and safe-area guides.
- Live data: exact connection/capability binding, refresh time, fallback mode, last good value, and “sample vs live” state.
- Brand: every color field offers brand-primary/accent/neutral tokens, not only a raw hex value.

Native primitives currently land around A-/B+; native lists/menus B+; V2/sports widgets around B; packaged HTML ranges B-/C; AI inline HTML is D/C-. A release below B in any required editability category must stay out of the production catalog.

#### P0 — replace raw AI HTML with a structured design document

The Designer currently persists one `EXTERNAL_HTML` zone at `apps/api/src/templates/templates.controller.ts:1324`. This prevents Canva-class structural editing and creates the script/action security boundary documented in embedded Part II.B of the consolidated brief.

Define `BoardDocumentV2` as a versioned AST with trusted node types:

```text
BoardDocument
  canvas + safeArea + scenes
  tokens: brand, typography, spacing, motion
  nodes:
    Text | RichText | Image | Video | Shape | Group
    List | Menu | Table | Chart
    Clock | Countdown | Weather
    LiveBinding | Conditional | Repeater
    TrustedAnimation | ApprovedAction
```

The model emits JSON matching a strict schema; the server validates size, nesting, URLs, bindings, contrast, overflow risk, action policy, and data provenance; a trusted renderer compiles it. Raw HTML remains a quarantined legacy import format with limited-editability labeling.

#### P1 — redesign the gallery around operator jobs

Replace the giant preset scroll with a task-first flow:

1. Ask: “What are you putting on a screen?”—welcome, menu, score, schedule, promo, wayfinding, emergency, live stream, kiosk.
2. Auto-filter by tenant vertical, screen orientation/resolution, connected integrations, and audience.
3. Show 5–8 curated recommendations, not hundreds of equal-weight cards.
4. Every card displays:
   - approved poster—not a live iframe;
   - “Fully editable,” “Limited HTML editing,” or “Image-only”;
   - “Live with Square connection” versus “Sample data”;
   - orientation/canvas support;
   - offline-ready status;
   - last verified date;
   - accessibility/editability score.
5. Preview with real tenant brand and either connected tenant data or an unmistakable demo-data banner.
6. Primary CTA is contextual: “Use for tonight’s game,” “Connect your menu,” or “Schedule on Lobby TV”—not a generic “Open builder.”

**Acceptance:** a new nontechnical operator finds, brands, edits, and schedules the right board in under 30 seconds with no documentation.

#### P1 — use the mandated one-template iteration loop

Do not batch-redesign the 297 active presets. For each flagship:

1. Produce 3–5 1920×1080 HTML mockups using fixed scene pixels and real fonts/assets.
2. Obtain explicit visual approval.
3. Port the approved scene through the fixed-canvas `transform: scale()` renderer.
4. Screenshot the live React/player version next to the approved mockup.
5. Stamp approval in code and in `TemplateRelease`.

Start with five jobs that create most commercial value per vertical; retire or hide long-tail variants until reviewed. A smaller catalog of 50 excellent, truthful, editable templates is far stronger than 297 uneven ones.

#### P1 — self-host and preflight all template assets

- Bundle licensed font subsets and declare fallbacks; no remote Google/Typekit dependency on player surfaces.
- Generate an `offlineAssetManifest` per release and have the service worker verify every hash.
- Reject missing assets, 404 posters, remote script tags, unapproved network origins, and oversized animation/media.
- Track rights/license provenance for every photo, logo, font, icon, and stock asset.

#### P1 — atomic template document persistence

Current Save writes metadata and zones separately at `apps/web/src/components/template-builder/BuilderShell.tsx:288-355`; Save As can silently collapse scenes and omit data-source/touch fields at `:561-677`.

Add:

- `PUT /templates/:id/document`—transactionally writes document, metadata, scenes, actions, bindings, revision, and version snapshot with `expectedRevision`.
- `POST /templates/:id/duplicate`—server-side deep copy preserving the same complete contract.
- idempotency keys, optimistic revision checks, conflict UI, and durable autosave revisions.

**Acceptance:** inject a failure at every internal write boundary; either the old complete document or new complete document remains—never a hybrid. Duplicate/Save As round-trips byte-equivalent semantics.

#### Automated QA pipeline

For every candidate `TemplateRelease`:

1. Validate schema, field census, action allowlist, bindings, asset rights, and local asset hashes.
2. Render every supported canvas in current Chromium, WebKit, and Chromium 83.
3. Fail on console error, uncaught exception, placeholder text, overflow, zero-size primary content, remote network miss, missing font, invalid link, or sample/live ambiguity.
4. Run contrast, keyboard, reduced-motion, and screen-reader checks where interactive.
5. Run a binding contract fixture for each declared integration.
6. Produce posters and signed visual artifacts from the same release commit.
7. Require human visual approval after automation passes.

#### Definition of done for one world-class template

- Approved design reference and owner.
- Rights/license record complete.
- ≥B in every editability category.
- No model-authored executable code.
- No unbound fabricated live data.
- All assets hash-verified and offline-capable.
- All target canvases/browsers pass screenshot and overflow gates.
- Brand injection passes contrast and visual review.
- Connected-data and disconnected/fallback states both pass.
- Gallery poster and metadata accurately describe capability.
- Nontechnical create/edit/publish happy path is recorded and under 30 seconds.

---

## Part II.H — Sports-engine and integration evidence

### Sports and Live-Data Audit Checkpoint

**Audit baseline:** `3f274702`
**Scope:** Standard Audit Surface §7 and all 19 sports in the engine. Grades are code-based; physical venue displays, provider sandboxes, and hardware consoles were not available.

**Handoff drift:** current `master` contains later targeted sports fixes and source-literal removal. Treat the grades/findings below as the snapshot backlog until each later change passes the stated runtime, migration, multi-replica, and hardware acceptance evidence; do not close items from commit messages alone.

#### Blunt verdict

The 19-sport engine is real—not a façade. It has database-backed game state, operator controls, screen assignment, player bindings, sport definitions, live boards, stats sanitization, auto-celebrations, and substantial automated coverage.

It is not yet world-class in live sports operations:

- Only the generic signed JSON feed is genuinely end-to-end.
- Daktronics support is provisional, limited to three sports, and can silently use the wrong sport parser.
- CTS water-polo support is the strongest hardware path, but some profiles and swimming-timing integration remain partial.
- Sportzcast, Scorebird, Genius Sports, Sportradar, MaxPreps, and GameChanger are not implemented as native integrations.
- Console activation depends on hand-constructed URL parameters and feed credentials.
- Important state changes are not consistently atomic, idempotent, audited, or pushed in real time.
- Cross-country and golf can show the wrong winner treatment because final-result logic assumes the higher score wins.
- Several long-tail sports are generic skins over the common engine rather than sport-authentic operating products.

#### 19-sport scorecard

| Sport | Design | Operator UX | Functional depth | Principal gap |
|---|---:|---:|---:|---|
| Football | B+ | B | B | Daktronics provisional; no certified down/distance/play-clock workflow |
| Basketball | B+ | B | B | Daktronics can default to football parsing; full fouls/bonus/stat-feed mapping incomplete |
| Baseball | B | B | B | No provider-certified line-score/count/base-state ingest |
| Softball | B | B | B | Shares generic baseball foundations; no certified console/provider adapter |
| Soccer | B+ | B | B | No native data provider; discipline/substitution depth is limited |
| Volleyball | B | B | B- | Per-set history is explicitly missing |
| Wrestling | B- | B- | B- | Needs bout history, weight-class workflow, and authoritative team-total reconciliation |
| Hockey | B+ | B | B | No certified clock/penalty hardware or cloud adapter |
| Lacrosse | B | B | B | Generic goal-sport depth; penalty/possession workflows need expansion |
| Field hockey | B- | B | B | Generic goal-sport presentation and feed coverage |
| Water polo | A- | B- | B | Deepest console path, but bridge setup remains manual and WTTC is provisional |
| Pickleball | B | B | B- | Needs complete game/set/match history and serving-side validation |
| Track & field | B | B- | B- | Needs event/heat/lane management and timing-system integration |
| Swimming | A- | B- | B- | Strong board/lane UI, but CTS timing parser is not wired end-to-end |
| Diving | B+ | B- | B- | Judge pad exists; no certified timing/scoring-system ingest |
| Cross-country | C+ | C | C | No finish-order/displacer board; low-score winner handling is incomplete |
| Gymnastics | C+ | C | C+ | No apparatus-specific board or rotation workflow |
| Golf | C+ | C | C | No hole/player scorecard; final winner logic can incorrectly favor the higher score |
| Competitive cheer | C+ | C | C+ | No judging rubric, deduction workflow, or routine-specific presentation |

Long-tail debt is explicitly recorded in `apps/web/src/app/board/[gameId]/__tests__/sport-board-parity.test.tsx:292-315`, which calls out missing cross-country finish order, golf scorecard, gymnastics apparatus, and cheer judging surfaces. Volleyball set history is marked absent in `apps/web/src/components/widgets/sports/SportElementWidgets.sports.tsx:285-317`.

#### Integration truth table

| Integration | Honest status | Evidence |
|---|---|---|
| Generic HMAC JSON feed | Implemented | Token issuance/auth/rate limiting/ingest/UI credentials at `apps/api/src/sports/sports.controller.ts:477-543`, `sports-board.controller.ts:271-313`, `sports-feed-token.ts:104-190`, `sports.service.ts:3511-3647` |
| Daktronics All Sport | Experimental/provisional | Football, basketball, and baseball maps exist, but offsets are unfield-verified at `packages/scoreboard-cts/src/daktronics/offsets.ts:26-35`; profile is provisional at `console-profiles.ts:165-179` |
| CTS Gen6/System6 water polo | Implemented in code; limited certification evidence | Classic decoder and real-wire legacy fixtures exist |
| CTS Gen7 RS-232 water polo | Implemented in code; limited certification evidence | Uses the classic decoder |
| CTS WTTC Gen7/WA2 | Provisional | Venue capture is pending at `packages/scoreboard-cts/src/console-profiles.ts:150-163` |
| CTS swimming timing | Partial library/API only | Parser and server endpoint exist; no client/bridge producer wires them together |
| Sportzcast | N/A—not built | No native adapter/parser; product health data says coming soon |
| Scorebird | N/A—not built | No native adapter/parser; only possible through customer middleware/generic feed |
| Genius Sports | N/A—not built | No credentials, webhook, poller, mapper, or reconciliation module |
| Sportradar | N/A—not built | No provider adapter or data-mapping layer |
| MaxPreps | N/A—not built | Discovery/coming-soon references only; no schedule, roster, or result sync |
| GameChanger | N/A—not built | No import/sync adapter; future-facing comments only |

The integration-health UI at `apps/api/src/health/integrations-health.controller.ts:810-878` treats Daktronics and named providers as coming soon, while provisional Daktronics code exists. Add explicit `NOT_BUILT`, `Experimental`, `Beta`, `Hardware-certified`, and `Production-certified` states, supported models/transports/sports, last-certification date, and limitations.

#### P0 — tracked sports feed-signing secret

At the audit snapshot, a tracked production-capable integration script exposed signing material. The literal is removed at the current handoff HEAD, but rotation, token revocation, shared-key blast-radius migration, exposure review, and scanner verification remain open. The value and precise historic locator are not reproduced; keep them in the restricted incident record until revocation is proven. The complete safe runbook is embedded as Part II.F.

#### P1 — provider adapters require explicit build-or-decline decisions

Sportzcast, Scorebird, Genius Sports, Sportradar, MaxPreps, and GameChanger are named but not native integrations. For each, product/partnerships must either record `DECLINED/UNAVAILABLE` with truthful customer copy or build a supported adapter with licensed API access, a versioned credential vault, webhook signature verification or durable cursor polling, rate-limit/backoff handling, team/game identity mapping, source priority, idempotency/reconciliation, disconnect/revoke, canary health, and contract fixtures. Do not scrape a provider that offers no supported partner API.

**Acceptance:** the integration remains `NOT_BUILT` and cannot appear connected until sandbox/contract fixtures pass; a revoked connection stops ingest; replay/out-of-order provider events are safe; team/game mismatches enter a visible reconciliation queue; marketing/help status is generated from the same capability record.

#### P1 — console setup is not operationally complete

The player mounts the console bridge only when its URL contains `?cts=1` at `apps/web/src/app/player/page.tsx:7887-7912`. Persistent ingest also requires manually supplied `game` and `feedToken` query parameters. The game setup page tells operators to construct this URL at `apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx:7510-7571`.

The screen UI stores only `Screen.config.consoleProfile` at `apps/web/src/app/[schoolId]/screens/page.tsx:601-721`. The manifest carries the profile but not a complete active-game/console binding at `apps/api/src/screens/screens.controller.ts:3230-3240`. Selecting a console in UI therefore does not activate it.

Daktronics adds a correctness failure: `CtsBridge` defaults to football unless a `dakSport` prop/query value exists at `apps/web/src/components/player/CtsBridge.tsx:364-375`, `:424-429`, but the player does not pass that sport. Basketball/baseball packets can be interpreted with football offsets.

##### Required implementation

- Mount the bridge from manifest configuration, not URL flags.
- Add a secure device-authenticated score-snapshot endpoint resolving `Screen.activeBoardGameId` server-side.
- Never place feed credentials in URLs, history, or logs.
- Derive parser sport from the active `Game.sport`; reject unsupported combinations rather than defaulting.
- Build an operator pairing wizard: select console, grant serial permission, detect packets, preview decoded fields, bind game, verify ingest, show reconnect health.
- Persist `consoleProfile`, `transport`, `sportMode:auto`, active-game binding, and certification metadata.
- Capture real packets for every supported model/sport and create golden replay fixtures before certification.

**Acceptance:** configure a Daktronics basketball console without URL editing; the player selects the basketball map. Restart restores binding. Switching to an incompatible sport is blocked. No secret appears in URL/logs. Disconnect/reconnect status reaches the dashboard within five seconds.

#### P1 — game publishing and screen binding

The underlying binding is real:

- `Screen.activeBoardGameId` and surface fields: `packages/database/prisma/schema.prisma:864-875`.
- Show/hide logic: `apps/api/src/sports/sports.service.ts:1152-1271`.
- Board/ribbon/scorebug manifest generation: `apps/api/src/screens/screens.controller.ts:2392-2467`, `:2930-2970`.
- Template-zone game binding: `apps/web/src/components/widgets/sports/GameStateContext.tsx:36-77`, `:115-195`, `:231-265`.

Show/hide updates the database without a corresponding audit event or signed `SYNC`; players discover the change by manifest reconciliation. The UI says “Going live starts the game on every screen” at `sports/[gameId]/page.tsx:7480-7504`, but the handler only updates status at `:493-503`; it does not assign/notify screens.

##### Required implementation

Put screen assignment, game state, and AuditLog creation in one transaction. After commit, send signed tenant/device `SYNC`. Either make Go Live deploy to an explicitly reviewed screen set or change the copy. Show a preflight list of affected screens/surfaces and expose partial-failure retry.

**Acceptance:** assignment, takeover, surface change, and removal reach physical players at p95 <2 seconds, survive reconnect, and create immutable audit entries.

#### P1 — state integrity and real-time architecture

Boards fetch public game state every 750 ms; the service uses a per-process one-second cache at `apps/api/src/sports/sports.service.ts:203-224`, `:493-525` and `apps/web/src/components/widgets/sports/GameStateContext.tsx:113-188`. This works at small scale but is not multi-replica real time. A controller comment claiming feed ingest broadcasts signed pub/sub does not match implementation.

Build a versioned event path:

- Add `Game.revision`.
- Hydrate once from a snapshot.
- Publish signed `GAME_STATE_CHANGED` events through Redis-backed WS/SSE with revision, event ID, source, server timestamp, and snapshot.
- Detect revision gaps and rehydrate.
- Retain polling only as degraded fallback.
- Invalidate caches across replicas.
- Ship additive schema migrations and backfill revision/source state before enforcement. Roll out behind compatibility cohorts with dual polling/WS operation, adoption/error telemetry, abort thresholds, and a rollback that preserves monotonic state.

**Acceptance:** correlated source/API receipt to rendered-player acknowledgement p95 <250 ms in WS mode; revisions strictly monotonic; duplicate/reordered/delayed events never roll back state; reconnect misses nothing; compatibility-cohort rollback loses no state; 100 viewers do not generate ~133 snapshot requests/second.

#### P1 — feed transaction and idempotency model

The generic feed accepts coarse absolute score/clock/segment state but no provider event ID, sequence, originating timestamp, stat payload, or idempotency receipt. A delayed request can overwrite newer state.

Create a source authority model and shared envelope. `GameSourceBinding` must record authority (`MANUAL | CONSOLE | PROVIDER`), `sourceConnectionId`, priority, lease/heartbeat, failover behavior, operator override, and explicit resume policy.

```ts
{
  schema: 'venueos.score.v1',
  tenantId,
  gameId,
  source,
  sourceConnectionId,
  sourceEventId,
  sequence,
  occurredAt,
  receivedAt,
  expectedRevision,
  currentRevision,
  kid,
  signature,
  payloadHash,
  sport,
  state,
  events,
}
```

Add `Game.revision`, a unique receipt on `(gameId, sourceConnectionId, sourceEventId)`, per-source last sequence, and one atomic `applyScoreCommand()` used by manual scoring, generic feed, Daktronics, CTS, and future adapters. It must validate tenant/game/signature, source authority/lease, expected revision, monotonicity, and payload hash; then update snapshot, insert immutable `GameEvent`, write audit, register receipt, increment revision, and enqueue the outbound event as one logical operation.

Today several paths update state then insert `GameEvent`, including score adjustment at `apps/api/src/sports/sports.service.ts:1543-1619`; a crash can leave changed state without complete forensic history.

**Acceptance:** concurrent manual and feed commands obey the declared authority; a stale provider cannot overwrite a current console; lease expiry fails over exactly once; provider recovery does not seize control until policy permits; an explicit operator takeover/resume is audited and cannot oscillate; stale/reordered clocks and revisions never roll state backward.

#### P1 — auto-celebration idempotency

Auto-celebration is real. Sport definitions contain point mappings and feed/console paths invoke them. Gaps:

- Enablement is cached per process, so replicas can disagree.
- The ten-second duplicate guard is team/time-based, not origin-event-based.
- A legitimate second score in ten seconds can be suppressed.
- Concurrent manual increments can compute the wrong delta and miss a cue.
- Cue behavior is not tied to a durable revision/event ID.

Persist the toggle. Correlate cue intent to the scoring event ID/revision. Enforce unique `(gameId, scoreEventId, cueType)`, generate score state and cue intent in the same transaction, deliver through an outbox, and track player acknowledgement/proof-of-play separately.

**Acceptance:** duplicate, reordered, concurrent, and replayed score commands produce exactly one correct celebration per event across two API replicas.

#### P1 — sponsor proof-of-play is not trustworthy

The cue-fired receipt path at `apps/api/src/sports/sports-board.controller.ts:84-140` accepts a known cue ID without device authentication and can return `{ok:true}` even when the recording service drops/fails. The service uses read-before-insert time-window dedupe at `apps/api/src/sports/sports.service.ts:5065-5140`, which is raceable across replicas. A caller who learns a game/cue ID can inflate sponsor evidence.

Replace it with a signed device/player receipt containing `displaySessionId`, `playerId`, `screenId`, `gameId`, `scoreEventId`, `cueIntentId`, media/release hash, `renderedAt`, rendered duration, acknowledgement status, and an idempotency key. Enforce a database unique constraint on the policy-defined cue+screen/session identity. Authenticate/authorize the screen, validate active assignment and release hash, return an error if durable recording fails, and reconcile intended, dispatched, acknowledged, rendered, and failed counts. Preview/manual cues do not count as billable sponsor proof unless the commercial policy explicitly permits it.

**Acceptance:** unauthenticated, wrong-screen, stale-session, replayed, and concurrent receipts cannot increment proof; exactly one durable receipt exists per cue+screen policy key across two replicas; a failed insert is not reported as success; the sponsor report reconciles intended versus acknowledged/rendered playback and exposes missing receipts.

#### P1 — incorrect low-score winner handling

Cross-country and golf require low-score semantics. The board has a local exception at `apps/web/src/app/board/[gameId]/page.tsx:247-264`, but API final-cue selection (`apps/api/src/sports/sports.service.ts:3840-3858`) and ribbon final treatment (`apps/web/src/app/ribbon/[gameId]/page.tsx:2655-2715`) still favor the higher score.

Add declarative semantics to `SportDefinition`:

```ts
resultMode: 'higher_wins' | 'lower_wins' | 'ranked_finish' | 'judged'
```

Use it consistently in API cue selection, board, ribbon, scorebug, leaderboards, accessibility text, and postgame summaries.

**Acceptance:** golf low score, cross-country scoring/ties, judged sports, ordinary high-score sports, and no-winner exhibitions all resolve correctly.

#### Sport depth required for world-class status

- **Volleyball/pickleball:** durable set/game history, current server, side switching, match point, win-by-two validation.
- **Wrestling:** bout ledger, weight classes, periods/overtime, penalties, result-to-team-score reconciliation.
- **Baseball/softball:** inning line score, balls/strikes/outs, base occupancy, pitcher/batter, R/H/E.
- **Basketball:** team/player fouls, bonus/double bonus, possession, shot clock, timeout inventory.
- **Football:** down, distance, ball-on, possession, play clock, timeout inventory.
- **Hockey/lacrosse/field hockey/water polo:** penalties/ejections, power play, shot/possession clocks as applicable.
- **Track/swimming:** meet/event/heat/lane/entrant model, seed/final, timing import, DQ and record flags.
- **Diving:** judge-count variants, degree of difficulty, dropped scores, round totals, dive order.
- **Cross-country:** finish order, displacement scoring, team totals, tie-break, low-score semantics.
- **Golf:** player/team scorecards, hole/par/to-par, low-score semantics.
- **Gymnastics:** rotation/apparatus scores, team aggregate, start-value/deduction breakdown.
- **Cheer:** rubric categories, judge panels, deductions, routine order, final standings.

#### Verification performed

Passing test evidence reported by the sports audit lane:

- Scoreboard CTS package: 5 suites / 88 tests.
- API sports engine/service/timing/stats: 4 suites / 260 tests.
- Web sport parity, LanePad, DivingJudgePad: 3 suites / 88 tests.
- Web no-fake-data and game-binding: 2 suites / 36 tests.

Important limitation: nearly all are synthetic or DOM tests. Legacy CTS uses captured open-repository fixtures, not a current VenueOS venue certification.

Not validated:

- Physical Daktronics/CTS consoles or actual kiosks/LED processors.
- WTTC, USB/RS-232/RS-485 adapters.
- Serial behavior across Safari, Firefox, Chromium, and Android WebView.
- Provider sandboxes/licensed production feeds.
- Multi-replica races/failover.
- Physical viewing-distance readability.

The desktop-browser path conditionally uses `navigator.serial`, so it remains limited to compatible browser/kiosk environments. `CtsBridge` also feature-detects a native `window.EduCmsNative.ctsSerial*` transport and auto-connects `/dev/tty*` devices for the Taurus/Android player at `apps/web/src/components/player/CtsBridge.tsx:102-147,575-903`; that native path exists in code but was not exercised on hardware in this audit. Production support therefore requires a certified Chromium Web Serial matrix and a certified Taurus/Android native-bridge matrix, or a separate local gateway/agent that owns serial communication and emits signed VenueOS envelopes.

---

## Part II.I — Exhaustive widget editability inventory

### Widget and Editor Editability Inventory

**Audit baseline:** `3f274702`
**Method:** read-only registry, renderer, builder, PropertiesPanel, V2 registry, HTML-discovery, and app-insertion trace. No files changed.

#### Source-of-truth result

- The actual Widgets tab is `VariantPicker`, mounted at `apps/web/src/components/template-builder/BuilderShell.tsx:906-920`, `:1210-1217`.
- It derives types/tiles from the in-memory variant registry and inserts zones at `VariantPicker.tsx:199-354`, `:415-527`; registry contract/list functions are `apps/web/src/components/widgets/variants.ts:29-105`.
- Registrations come from `apps/web/src/components/widgets/variants-register.ts`, not `template-builder/constants.ts`. `WIDGET_GROUPS` is labels/icons only at `constants.ts:50-57`.
- Actual Widgets palette: **74 persisted widget types**.
- `WidgetRenderer` handles **180 persisted types**; every palette type renders, so palette → runtime ghosts = **0**.
- V2 contributes **243 concrete variants**, collapsed into canonical persisted types by `variants-register.ts:814-929`.
- PropertiesPanel nominally covers all 180 renderer types: **99 explicit cases + 39 MS/default auto-forms + 33 themed auto-forms + 9 generic V2 forms**. Five additional explicit `PHOTO_*` cases are dead.

This means the problem is not “nothing is wired.” The deeper problem is that canonicalization can route a visually distinct V2 variant into an editor built for a different config shape, producing friendly-looking controls that do not update the fields the renderer consumes.

#### Actual Widgets palette — all 74 persisted types

| Family | Persisted types | Registry evidence |
|---|---|---|
| Core/media/design (24) | `TEXT, RICH_TEXT, IMAGE, IMAGE_CAROUSEL, VIDEO, VIDEO_CAROUSEL, WEBPAGE, CLOCK, WEATHER, COUNTDOWN, ANNOUNCEMENT, TICKER, CALENDAR, BELL_SCHEDULE, LUNCH_MENU, STAFF_SPOTLIGHT, LOGO, TOUCH_POINT, SHAPE, ICON, DECORATION, HOUSE_AD_BANNER, MUSIC_PLAYER, EXTERNAL_HTML` | `variants-register.ts:43-209`, `:210-812`, `:934-1010` |
| Sports (13) | `SCOREBOARD, SCORE_HOME, SCORE_AWAY, GAME_CLOCK, GAME_SEGMENT, GAME_STAT, SWIM_LANE_GRID, DIVE_LEADERBOARD, SWIM_RELAY_EXCHANGE, SWIM_SPLITS_PANEL, SWIM_RECORD_LINE, DIVE_JUDGES_PANEL, STADIUM_MEET_BOARD` | `variants-register.ts:1012-1608`; primitives `:1287-1438`; stadium `:1440-1487`; scoreboards `:1489-1608` |
| Food service (6) | `RESTAURANT_MENU_BOARD, RESTAURANT_COMBO_CAROUSEL, RESTAURANT_WAIT_TIME, RESTAURANT_LOYALTY_TICKER, RESTAURANT_SPECIALS_CALLOUT, RESTAURANT_ALLERGY_LEGEND` | `variants-register.ts:1656-1725` |
| Bar (6) | `BAR_TAP_LIST, BAR_COCKTAIL_MENU, BAR_HAPPY_HOUR_COUNTDOWN, BAR_GAME_DAY_SCHEDULE, BAR_EVENT_TONIGHT, BAR_TRIVIA_SCOREBOARD` | `variants-register.ts:1727-1794` |
| Retail/fashion (7) | `RETAIL_PRODUCT_GRID, RETAIL_PRICE_CALLOUT, RETAIL_SALE_COUNTDOWN, RETAIL_WAYFINDING_MAP, RETAIL_LOYALTY_QR, RETAIL_LOOKBOOK_CAROUSEL, RETAIL_STOREFRONT_HOURS` | `variants-register.ts:1796-1876` |
| Gym integrations (9) | `FITNESS_CLASS_SCHEDULE, FITNESS_MUSIC_PLAYER, FITNESS_LIVE_TV, FITNESS_AD_BANNER, FITNESS_TRAINING_VIDEO, FITNESS_WORKOUT_TIMER, FITNESS_MOTIVATIONAL_QUOTE, FITNESS_APP_LIBRARY, FITNESS_STICK_LAUNCHER` | `variants-register.ts:1878-1978` |
| V2-only canonical families (9) | `CELEBRATION, HEALTHCARE, CORPORATE, HOSPITALITY, WORSHIP, CHART, RETAIL, BACKGROUND, LIVE_DATA` | map/register loop `variants-register.ts:844-929` |

Fast Add is separate and narrower: `TEXT, IMAGE, VIDEO, WEBPAGE, TOUCH_QR → TOUCH_POINT`; its “Shape” inserts a colored `TEXT`, not `SHAPE` at `apps/web/src/components/template-builder/AddSidebar.tsx:75-117`. Virtual touch/decor aliases are normalized by `useBuilderStore.ts:425-540`.

#### Renderer/editability matrix — all 180 persisted types

Legend:

- **E** — explicit PropertiesPanel switch at `PropertiesPanel.tsx:2484-6036`.
- **M** — `MS_DEFAULTS_BY_TYPE` auto-form at `:207-257`, `:6276-6396`.
- **T** — themed auto-form using `themed-widget-defaults.ts:69-456`, rendered at `PropertiesPanel.tsx:6397-6531`.
- **V** — generic V2 defaults/style auto-form at `PropertiesPanel.tsx:6037-6274`.
- **X** — EXTERNAL_HTML field/image/action discovery.

`WidgetRenderer` tries a registered variant first at `WidgetRenderer.tsx:543-584`, then the master switch.

##### Core/media — 28, explicit

**E**, except `EXTERNAL_HTML` is **E+X**:

`TOUCH_POINT, CLOCK, WEATHER, COUNTDOWN, TEXT, RICH_TEXT, ANNOUNCEMENT, TICKER, BELL_SCHEDULE, LUNCH_MENU, CALENDAR, STAFF_SPOTLIGHT, IMAGE, IMAGE_CAROUSEL, VIDEO, VIDEO_CAROUSEL, STREAMING, HOUSE_AD_BANNER, MUSIC_PLAYER, LOGO, WEBPAGE, EXTERNAL_HTML, RSS_FEED, SOCIAL_FEED, PLAYLIST, DECORATION, SHAPE, ICON`

Renderer: `WidgetRenderer.tsx:598-657`.

##### Generic/sports/legacy touch — 27, explicit

**E**:

`HOLIDAY, QUOTE, STATS, MENU_ITEM, SCOREBOARD, SCORE_HOME, SCORE_AWAY, GAME_CLOCK, GAME_SEGMENT, GAME_STAT, SWIM_LANE_GRID, DIVE_LEADERBOARD, SWIM_RELAY_EXCHANGE, SWIM_SPLITS_PANEL, SWIM_RECORD_LINE, DIVE_JUDGES_PANEL, STADIUM_MEET_BOARD, SCHEDULE_GRID, ATTENDANCE, BIRTHDAYS, HONOR_ROLL, TOUCH_BUTTON, TOUCH_MENU, ROOM_FINDER, ON_SCREEN_KEYBOARD, WAYFINDING_MAP, QUICK_POLL`

Renderer: `WidgetRenderer.tsx:661-690`.

##### K-12/full-scene — 73

Renderer: `WidgetRenderer.tsx:692-767`.

- **E**, 16: `ANIMATED_WELCOME, ANIMATED_WELCOME_MS, ANIMATED_WELCOME_HS, ANIMATED_WELCOME_HS_PORTRAIT, ANIMATED_WELCOME_MS_PORTRAIT, ANIMATED_CAFETERIA, ANIMATED_CAFETERIA_PORTRAIT, ANIMATED_BACKGROUND`, plus landscapes `HS_VARSITY, HS_BROADCAST, HS_YEARBOOK, HS_TERMINAL, HS_TRANSIT, HS_GALLERY, HS_BLUEPRINT, HS_ZINE`.
- **M**, 39 total across K-12/fitness: all 16 `MS_{ARCADE,ATLAS,FIELDNOTES,GREENHOUSE,HOMEROOM,PAPER,PLAYLIST,STUDIO}` landscape/portrait and eight `HS_*_PORTRAIT`; map `PropertiesPanel.tsx:207-256`.
- **T**, 33: direct entries `ANIMATED_HALLWAY_SCHEDULE{,_PORTRAIT}, ANIMATED_BELL_SCHEDULE{,_PORTRAIT}, ANIMATED_BUS_BOARD, ANIMATED_MORNING_NEWS, ANIMATED_ACHIEVEMENT_SHOWCASE, ANIMATED_MAIN_ENTRANCE, ANIMATED_CAFETERIA_CHALKBOARD, ANIMATED_CAFETERIA_FOODTRUCK{,_PORTRAIT}, ANIMATED_CAFETERIA_MS, ANIMATED_CAFETERIA_HS, ANIMATED_WELCOME_PORTRAIT, BULLETIN_{HALLWAY,CAFETERIA}, SCRAPBOOK_{HALLWAY,CAFETERIA}, STORYBOOK_{HALLWAY,CAFETERIA}` plus 13 portrait aliases at `themed-widget-defaults.ts:438-456`.

##### Vertical dedicated — 43

Renderer: `WidgetRenderer.tsx:769-821`.

- **E**, 28: nine gym-integration, six restaurant, six bar, seven retail palette types listed above.
- **M**, 15 fitness scenes: `FITNESS_STADIUM, FITNESS_IRON, FITNESS_MARQUEE, FITNESS_CHANNEL_GUIDE, FITNESS_DISCOTHEQUE, FITNESS_LOCKER, FITNESS_SPLASH, FITNESS_TELEMETRY, FITNESS_CRAG, FITNESS_CORNERMAN, FITNESS_RECESS, FITNESS_REFORMER, FITNESS_TRAILHEAD, FITNESS_VAULT, FITNESS_LOBBY` at `PropertiesPanel.tsx:224-241`.

##### V2 canonical fallbacks — 9

**V**:

`CELEBRATION, HEALTHCARE, CORPORATE, HOSPITALITY, WORSHIP, CHART, RETAIL, BACKGROUND, LIVE_DATA`

Renderer: `WidgetRenderer.tsx:822-880`, cases `:844-852`.

A universal raw-JSON fallback also mounts at `PropertiesPanel.tsx:895`, implementation `:8386-8415`. Raw JSON is a developer escape hatch, not operator-grade editability.

#### V2 concrete inventory — all 243

Registry assembly: `apps/web/src/components/widgets/v2/registry.ts:684-726`; canonical registration: `variants-register.ts:844-929`.

- **70 core:** five each, generally `NEON/PAPER/CRAYON/GLASS/OPS`: `CLOCK_*` (`v2/registry.ts:223-229`), `HEADLINE_*` (`:231-238`), `ANN_*` (`:240-247`), `CAL_*` (`:249-256`), `STAFF_*` (`:258-265`), `CD_*` (`:267-274`), `LOGO_*` (`:276-283`), `TICKER_*` (`:285-292`), `WX_*` (`:294-301`), `PHOTO_*` (`:303-310`), `RT_*` (`:312-319`), `IMG_*` (`:321-328`), `LUNCH_*` (`:330-337`), `BELL_*` (`:339-346`).
- **76 celebrations:** baseball 8 (`:358-367`), football 8 (`:369-378`), basketball 8 (`:380-389`), hockey 6 (`:395-402`), soccer 6 (`:404-411`), other sport/status 40 (`:553-595`).
- **Healthcare 7:** `NOW_SERVING, WAIT_TIMES_BOARD, PROVIDER_SPOTLIGHT, PATIENT_EDUCATION, VISITOR_HOURS, CODE_BANNER, INSURANCE_ACCEPTED` (`:413-437`).
- **Corporate 7:** `ROOM_SCHEDULE, VISITOR_WELCOME, KPI_TILE, SALES_LEADERBOARD, DOOR_SIGN, OKR_TRACKER, TEAM_ANNIVERSARIES` (`:439-454`).
- **Hospitality 5:** `HOTEL_WELCOME, DAILY_EVENTS_BOARD, AMENITY_HOURS, CHECK_IN_OUT_TIMES, LOCAL_ATTRACTIONS` (`:457-468`).
- **Worship 6:** `SERVICE_TIMES, SERMON_TITLE_CARD, HYMN_BOARD, GIVING_THERMOMETER, SCRIPTURE_VERSE, PRAYER_REQUEST_QR` (`:470-484`).
- **Retail 8:** `RETAIL_SALE_SEAL, RETAIL_PRICE_TAG, RETAIL_PRODUCT, RETAIL_FLASH_COUNTDOWN, RETAIL_STORE_HOURS, RETAIL_LOYALTY_QR, RETAIL_NEW_ARRIVALS, RETAIL_PROMO_STRIP` (`:487-501`).
- **Scoreboards 3:** `SCOREBOARD_HS, SCOREBOARD_COLLEGE, SCOREBOARD_PRO` (`:505-510`).
- **Charts 5:** `CHART_BAR, CHART_DONUT_GAUGE, CHART_LINE, CHART_PROGRESS, CHART_COUNTUP` (`:511-518`).
- **Sports venue 17:** `STADIUM_SCOREBOARD, RIBBON_TICKER, RIBBON_SPONSOR, RIBBON_FAN_SHOUTOUT, PLAYER_CARD, STARTING_LINEUP, STAT_COMPARISON, OUT_OF_TOWN_SCORES, KISS_CAM, NOISE_METER, IN_GAME_PROMO, SPONSOR_TAKEOVER, HOME_SCHEDULE, STANDINGS_BOARD, CONCESSION_WAITS, GATE_WAYFINDING, GOAL_CELEBRATION` (`:522-545`).
- **Backgrounds 17:** `BG_*` (`:597-621`).
- **Live data 8:** `SPORTS_SCOREBOARD, STOCK_TICKER, CRYPTO_TICKER, NEWS_HEADLINES, AIR_QUALITY, WORLD_CLOCKS, FX_RATES, TRAFFIC_CAM` (`:623-638`).
- **Touch/engage 10:** `PHOTO_BOOTH, SIGN_IN_PAD, LANGUAGE_PICKER, ACCESSIBILITY_TRAY, NPS_SMILEY, TRIVIA_GAME, SPIN_TO_WIN, DIRECTORY_SEARCH, WAYFINDING_FLOOR_MAP, DONATION_THERMOMETER` (`:640-657`).
- **Transit 4:** `DEPARTURES_BOARD, FLIGHT_STATUS_HERO, TRANSIT_DEPARTURES, PARKING_AVAILABILITY` (`:659-670`).

Only **143/243** V2 variants reach the generic V2 auto-form—the nine V2-only canonical families, with transit folded into `LIVE_DATA`. The other **100** map to 15 canonical types with earlier explicit cases, bypassing generic defaults/style; V2 universal style controls are also suppressed at `PropertiesPanel.tsx:6571-6574`.

#### EXTERNAL_HTML editability

- Palette registration: `variants-register.ts:88-102`.
- Explicit picker/editor: `PropertiesPanel.tsx:2492-2636`.
- Same-origin packaged catalog: **113 boards**, `apps/web/src/components/widgets/signage-templates.ts:17-149`.
- Discovery parses inline HTML or fetches URL (`PropertiesPanel.tsx:7065-7104`), discovers `[data-field]` (`:7113-7139`), image slots (`:7141-7167`), actions (`:7169-7181`), supports click-to-locate (`:7193-7257`), then renders text/style/image/action editors (`:7259-7590`).
- Runtime transports brand/text/style/image/action overrides through query parameters/postMessage/srcdoc at `WidgetRenderer.tsx:3801-3984`.

This is a useful compatibility layer, but field discovery does not equal structural editing. The operator cannot freely rearrange internal nodes, and runtime/action safety remains a blocking concern.

#### High-confidence ghost or broken controls

##### 1. Dead public widget catalog

API `WIDGET_TYPE_CATALOG` at `apps/api/src/templates/templates.controller.ts:2719-2865` is exposed at `:694-702`; frontend hook exists at `apps/web/src/hooks/use-api.ts:1125-1129` but has no caller. It includes `EMPTY`, which has no renderer. The actual palette is `variants-register.ts`.

**Fix:** delete the dead catalog or generate all catalog/palette/renderer/editor metadata from one typed registry. Add a registry parity test.

##### 2. Five dead PropertiesPanel cases

`PHOTO_NEON/PAPER/CRAYON/GLASS/OPS` at `PropertiesPanel.tsx:3775-3797` can never run. V2 photos canonicalize to `IMAGE` at `variants-register.ts:859-861`; `WidgetRenderer` has no `PHOTO_*` cases.

**Fix:** preserve concrete variant identity in the zone document and route to the correct schema, or delete dead cases.

##### 3. At least 45 V2 variants expose misleading/no-op friendly controls

- Ten photo/image variants map to `IMAGE`; editor writes `assetUrl/fitMode/assetName` at `PropertiesPanel.tsx:3818-3825`, while V2 images read `url/fit/alt/caption/eyebrow` at `v2/ImageWidgets.tsx:10-24` and photos read `photos/title/rotateMs` at `v2/PhotoWidgets.tsx:11-28`.
- Five rich-text variants map to `RICH_TEXT`; editor writes `content/title/html` at `PropertiesPanel.tsx:2638-2742`, while V2 reads `body/title/eyebrow/signature/style` at `v2/RichTextWidgets.tsx:11-36`.
- Twenty scoreboard/sports-venue variants map to `SCOREBOARD`; special IDs recognized by the explicit case are only `sb-*`, `scoreboard-main`, `ribbon-main`, `scorebug-main` at `PropertiesPanel.tsx:3220-3232`. V2 IDs fall to legacy fields at `:3718-3725`, while V2 scoreboard reads `gameId/tier/bannerText/style` at `v2/SportsScoreboardWidgets.tsx:60-70`.
- Ten touch/engage variants map to `TOUCH_POINT`; editor shows hotspot/icon fields at `PropertiesPanel.tsx:3859-3953`, not variant fields such as PhotoBooth `frames/countdownSec/deliveries/brandOverlay/style` at `v2/TouchEngageWidgets.tsx:15-20`, `:37-41`.
- The generic V2-form comment says scoreboards are covered at `PropertiesPanel.tsx:6038-6042`, but the earlier explicit `SCOREBOARD` case prevents that.

**Fix:** every variant supplies a shared runtime/editor schema; the panel renders controls from that schema, and field-path contract tests prove the edited value reaches the exact renderer field after save/reload/player render. Do not canonicalize variants with incompatible config shapes.

##### 4. Template-level live-data controls do not persist

Store defines `meta.dataSource/dataUrl/dataFormat` at `useBuilderStore.ts:19-32`; BuilderShell reads nonexistent top-level template fields and sends them at `BuilderShell.tsx:170-176`, `:316-323`; controller omits them at `templates.controller.ts:2293-2308`; Prisma `Template` has no fields at `schema.prisma:1141-1194`. Controls at `PropertiesPanel.tsx:955-1424` reset after reload. Zone-level `posSync/customSync/customUrl` does persist.

**Fix:** either add versioned document-level bindings to `BoardDocumentV2` and persistence, or remove the controls. Add save → reload → player proof.

##### 5. EXTERNAL_HTML POS binding tokens have no resolver

Editor writes `{{pos.item:<externalId>.<field>}}` at `PropertiesPanel.tsx:7372-7413`; no evaluation path was found, only a type comment at `menu-console-api.ts:60-66`. Runtime transports the token through `textOverrides` at `WidgetRenderer.tsx:3830-3876`, so it can display literally.

**Fix:** replace string tokens with typed `IntegrationBinding` references resolved server/player-side, or implement and test a safe token resolver. Never expose a binding UI without a consumer.

##### 6. EXTERNAL_HTML “Switch template” can be a no-op

Dropdown writes `{url}` only at `PropertiesPanel.tsx:2553-2558`; renderer prioritizes existing `config.html` and continues `srcdoc` at `WidgetRenderer.tsx:3801-3809`, `:3939-3955`.

**Fix:** make source mode explicit (`inline` or `packaged`); switching mode clears/archives the conflicting field transactionally and shows a confirmation if content will change.

##### 7. Fast Add Shape catalog drift

Fast Add says no standalone shape and inserts `TEXT` at `AddSidebar.tsx:75-95`, while real `SHAPE` is registered at `variants-register.ts:115-146`, rendered at `WidgetRenderer.tsx:652-657`, and editable at `PropertiesPanel.tsx:4156-4243`.

**Fix:** Fast Add uses the same registry insertion action as VariantPicker; no hand-built duplicate catalog.

##### 8. Type-union drift

`WidgetType` at `apps/web/src/components/widgets/themes/registry.ts:21-110` omits multiple dedicated vertical types; registrations compensate with `as any` from `variants-register.ts:1666+`.

**Fix:** generate the union from the registry or use a typed discriminated registry; eliminate `as any` registration escapes.

#### Apps insertion surface

Apps are separate from the Widgets palette: 19 definitions, 15 enabled, four social apps coming soon at `apps/web/src/components/apps/app-registry.ts:267-855`. Enabled apps insert `STREAMING`, `WEBPAGE`, `TOUCH_POINT`, `CLOCK`, `COUNTDOWN`, `WEATHER`, or `RSS_FEED` through schema-driven forms at `AppConfigForm.tsx:81-187`, `:388-448`, `:527-575`.

Consequences:

- `STREAMING` and `RSS_FEED` are reachable even though absent from VariantPicker.
- `SOCIAL_FEED` currently is not reachable through an enabled app.
- App registry, widget palette, renderer, and editor need one capability graph so reachability is intentional/tested.

#### Criterion-by-family/variant capability matrix

This is the release matrix promised by `WID-001/003/004`. It grades the operator-facing contract, not only rendering. `N/A` means the capability is genuinely irrelevant to that family. `I-Geo` is geometry of elements inside the widget; `O-Geo` is the outer zone/canvas geometry. `Bind` covers live/provider/game data binding plus freshness/fallback. Evidence abbreviations: `PP-E/M/T/V/X` are the editor mechanisms defined above; `WR` is `WidgetRenderer`; `REG` is `variants-register.ts`; `V2` is the concrete V2 component/registry; `HTML` is the EXTERNAL_HTML discovery/iframe path.

Any applicable criterion below an unqualified `B` blocks production release and maps to the work package in the final column. A strong aggregate cannot average away a D/F primary criterion.

| Family / concrete variants | Editor / evidence | Text | Media | BG | Time | Lists | I-Geo | O-Geo | Brand | Bind | Overall | Release decision |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Native `TEXT`, `RICH_TEXT` | PP-E; WR core | A | N/A | A | N/A | N/A | N/A | A | A | N/A | B+ | Release after generated field-path proof (`WID-002`) |
| Native `ANNOUNCEMENT`, `TICKER`, `QUOTE`, `STATS`, `MENU_ITEM` | PP-E; WR core/legacy | A | N/A | B | N/A | B | N/A | A | A | N/A | B+ | Release after `WID-002` parity suite |
| Native `STAFF_SPOTLIGHT`, `LOGO` | PP-E; WR core | B | A | B | N/A | N/A | N/A | A | A | N/A | B | Release with parity proof |
| Native `CLOCK`, `COUNTDOWN`, `WEATHER` | PP-E; WR core | B | N/A | A | A | N/A | N/A | A | A | B | A- | Release with timezone/fallback tests |
| `CALENDAR`, `SCHEDULE_GRID`, `ATTENDANCE`, `BIRTHDAYS`, `HONOR_ROLL` | PP-E; WR legacy | B | N/A | B | B | A | N/A | A | A | B | A- | Release with structured-list/binding tests |
| Native `LUNCH_MENU`, `BELL_SCHEDULE` | PP-E; WR core | A | B | B | A | A | N/A | A | A | B | A- | Release after POS/static truth tests |
| Native `IMAGE`, `IMAGE_CAROUSEL`, `VIDEO`, `VIDEO_CAROUSEL` | PP-E; WR core | B | A | N/A | B | A | N/A | A | N/A | N/A | A- | Release with asset/player parity |
| `STREAMING`, `WEBPAGE`, `RSS_FEED`, `SOCIAL_FEED`, `PLAYLIST`, `HOUSE_AD_BANNER`, `MUSIC_PLAYER` | PP-E/App; WR core | B | B | B | B | B | N/A | A | B | B- | B- | Block until resolver/freshness/source truth reaches B (`WID-004`) |
| `SHAPE`, `ICON`, `DECORATION`, `HOLIDAY`, `ANIMATED_BACKGROUND` | PP-E; WR core/legacy | B | N/A | A | N/A | N/A | B | A | A | N/A | A- | Release after Fast Add uses registry (`WID-002`) |
| Native `TOUCH_POINT` visual variants | PP-E + action; REG | B | N/A | A | N/A | N/A | B | A | A | B | B+ | Release with action/source/nonce tests |
| `TOUCH_BUTTON`, `TOUCH_MENU`, `ROOM_FINDER`, `ON_SCREEN_KEYBOARD`, `WAYFINDING_MAP`, `QUICK_POLL` | PP-E; WR legacy | A | B | A | N/A | A | B | A | A | B | B+ | Release with keyboard/action persistence tests |
| V2 mirrored core: five each `CLOCK_*`, `HEADLINE_*`, `ANN_*`, `CAL_*`, `CD_*`, `LOGO_*`, `TICKER_*`, `WX_*`, `LUNCH_*` | PP-E canonical adapter; V2 | A | B | B | A | A | N/A | A | B | B | B+ | Release only after generated per-variant contract tests (`WID-002`) |
| V2 Staff: `STAFF_NEON/PAPER/CRAYON/GLASS/OPS` | PP-E canonical; V2 | C | A | B | N/A | N/A | N/A | A | B | N/A | C+ | Block; add exact typed adapter (`WID-003`) |
| V2 Bell: `BELL_NEON/PAPER/CRAYON/GLASS/OPS` | PP-E canonical; V2 | B | N/A | B | A | C | N/A | A | B | N/A | B- | Block; structured schedule editor (`WID-003`) |
| V2 Image: `IMG_NEON/PAPER/CRAYON/GLASS/OPS` | Wrong PP-E `IMAGE`; V2 ImageWidgets | C | F | C | N/A | N/A | N/A | A | C | N/A | F | Quarantine now (`WID-001`); typed URL/fit/alt/caption adapter (`WID-003`) |
| V2 Photo: `PHOTO_NEON/PAPER/CRAYON/GLASS/OPS` | Wrong PP-E `IMAGE`; dead PHOTO cases; V2 PhotoWidgets | C | F | C | C | F | N/A | A | C | N/A | F | Quarantine now (`WID-001`); typed `photos[]` editor (`WID-003`) |
| V2 Rich Text: `RT_NEON/PAPER/CRAYON/GLASS/OPS` | Wrong PP-E `RICH_TEXT`; V2 RichTextWidgets | D | N/A | C | N/A | N/A | N/A | A | C | N/A | D | Quarantine now (`WID-001`); body/eyebrow/signature adapter (`WID-003`) |
| Animated Welcome/Cafeteria landscape+portrait | PP-E; WR full scene | A | A | A | A | A | D | A | A | N/A | B- | Block internal structural release until manifest/editor exists (`WID-003`/`TPL-002`) |
| Other animated/themed K-12 scenes | PP-T; WR full scene | A | A | B | A | A | D | A | A | N/A | B- | Block internal structural release (`WID-003`/`TPL-002`) |
| HS landscapes: `VARSITY/BROADCAST/YEARBOOK/TERMINAL/TRANSIT/GALLERY/BLUEPRINT/ZINE` | PP-E; WR scene | A | B | B | A | A | D | A | A | B | B- | Block internal structure/fallback gaps (`WID-003`) |
| HS portrait counterparts | PP-M; WR scene | A | B | B | A | C | D | A | A | B | B- | Block; typed scene manifest (`WID-003`) |
| MS landscape/portrait 16 scene types | PP-M; WR scene | B | B | B | B | C | D | A | B | N/A | C+ | Block; replace defaults reflection/scene monolith (`WID-003`) |
| Fitness full scenes 15 | PP-M; WR scene | B | B | B | B | C | D | A | B | B | C+ | Block; typed scene manifest and bindings (`WID-003`) |
| Fitness functional 9 | PP-E; WR vertical | A | A | B | A | A | N/A | A | A | B | B+ | Release after integration/player parity |
| Restaurant dedicated 6 | PP-E; WR vertical | A | A | B | A | A | N/A | A | A | B- | B- | Block exact POS selection/freshness (`WID-004`) |
| Bar dedicated 6 | PP-E; WR vertical | A | A | B | A | A | N/A | A | A | B | B+ | Release after live schedule/feed fixtures |
| Retail/fashion dedicated 7 | PP-E; WR vertical | A | A | B | A | A | N/A | A | A | B | B+ | Release after data/QR fixtures |
| Native `scoreboard-main` | PP-E + game bind; WR sports | A | B | A | A | A | N/A | A | A | B | B+ | Release after exact game/source tests |
| Native `ribbon-main`, `scorebug-main` | Binding-only PP-E; WR sports | F | F | F | A | F | N/A | A | C | B | D | Block; dedicated editors (`WID-003`) |
| Composable `sb-*` scoreboard elements | PP-E/CTS; WR sports | A | B | A | A | A | B | A | A | A | B+ | Release after source-authority/player tests |
| `SCORE_HOME`, `SCORE_AWAY`, `GAME_CLOCK`, `GAME_SEGMENT`, `GAME_STAT` | PP-E; WR sports | A | N/A | A | A | N/A | N/A | A | A | A | A- | Release after revision/replay tests |
| Swim/dive/stadium lane, split, relay, record, judge, leaderboard types | PP-E; WR sports | A | B | A | A | A | B | A | A | B | B+ | Release only with timing/hardware certification |
| V2 `SCOREBOARD_HS/COLLEGE/PRO` | Wrong PP-E `SCOREBOARD`; V2 SportsScoreboard | F | N/A | C | F | F | N/A | A | C | F | F | Quarantine now (`WID-001`); typed game/tier/banner editor (`WID-003`) |
| V2 Sports Venue 17 IDs in quarantine manifest | Wrong PP-E `SCOREBOARD`; V2 SportsVenue | F | F | C | F | F | D | A | C | F | F | Quarantine now (`WID-001`); per-widget schemas (`WID-003`) |
| V2 Celebrations 76 | PP-V; V2 registry/components | B | N/A | A | B | C | N/A | A | A | B | B- | Block until typed event/content contract reaches B (`WID-003`) |
| V2 Healthcare/Corporate/Hospitality/Worship scalar or string-list widgets | PP-V; V2 | B | B | A | B | B | N/A | A | A | B- | B- | Block binding/semantic controls below B (`WID-003/004`) |
| V2 object-list widgets: wait times, hours, insurance, rooms, sales, OKRs, anniversaries, events, amenities, attractions, services, hymns | PP-V defaults reflection; V2 | C | B | A | C | F | N/A | A | A | C | D | Block; typed object-list add/remove/reorder/migration (`WID-003`) |
| V2 Corporate KPI | PP-V; V2 | B | N/A | A | N/A | F | N/A | A | A | C | C- | Block numeric-array preservation/binding (`WID-003`) |
| V2 Charts 5 | PP-V; V2 ChartsWidgets | C | N/A | A | N/A | F | N/A | A | A | C | D | Block typed series/stat editors (`WID-003`) |
| V2 Retail simple: sale seal, price tag, promo strip | PP-V; V2 | A | N/A | A | N/A | N/A | N/A | A | A | C | B- | Block live-price/source truth (`WID-004`) |
| V2 Retail product/countdown/hours/loyalty/new arrivals | PP-V; V2 | C | F | A | F | F | N/A | A | A | D | D | Block typed media/time/list/binding (`WID-003/004`) |
| V2 Backgrounds 17 | PP-V; V2 | N/A | B | A | N/A | N/A | N/A | A | A | N/A | B | Release after offline asset/brand tests |
| V2 Live Data 8 + Transit 4 | PP-V; V2 | C | C | A | C | C | N/A | A | A | C | C- | Block real binding/freshness/fallback and typed fields (`WID-003/004`) |
| V2 Touch & Engage 10 IDs in quarantine manifest | Wrong PP-E `TOUCH_POINT`; V2 TouchEngage | F | F | C | F | F | D | A | C | F | F | Quarantine now (`WID-001`); per-widget action/content schemas (`WID-003/004`) |
| Packaged `EXTERNAL_HTML` 113 rows/112 URLs | PP-E+X; HTML discovery/iframe | B | B | B | C | F | F | A | C | D | C | Block source mode, collections, brand bridge, actions, POS, offline (`WID-004`/`TPL-002`) |
| AI-generated inline HTML | PP-E+X when hooks survive; Designer/HTML | C | C | B | C | F | F | A | C | F | D | Disable raw path; migrate to BoardDocumentV2 (`SEC-002`/`DOC-001`/`WID-004`) |

#### `WID-001` exact 45-variant quarantine manifest

This manifest is machine-readable and release-blocking. These IDs must be hidden from new use or have misleading controls removed until their typed editor contract passes edit → save → reload → player-render evidence.

```json
{
  "workPackage": "WID-001",
  "count": 45,
  "releaseDecision": "QUARANTINE",
  "groups": {
    "v2Image": ["IMG_NEON", "IMG_PAPER", "IMG_CRAYON", "IMG_GLASS", "IMG_OPS"],
    "v2Photo": ["PHOTO_NEON", "PHOTO_PAPER", "PHOTO_CRAYON", "PHOTO_GLASS", "PHOTO_OPS"],
    "v2RichText": ["RT_NEON", "RT_PAPER", "RT_CRAYON", "RT_GLASS", "RT_OPS"],
    "v2Scoreboard": ["SCOREBOARD_HS", "SCOREBOARD_COLLEGE", "SCOREBOARD_PRO"],
    "v2SportsVenue": [
      "STADIUM_SCOREBOARD", "RIBBON_TICKER", "RIBBON_SPONSOR", "RIBBON_FAN_SHOUTOUT",
      "PLAYER_CARD", "STARTING_LINEUP", "STAT_COMPARISON", "OUT_OF_TOWN_SCORES",
      "KISS_CAM", "NOISE_METER", "IN_GAME_PROMO", "SPONSOR_TAKEOVER",
      "HOME_SCHEDULE", "STANDINGS_BOARD", "CONCESSION_WAITS", "GATE_WAYFINDING",
      "GOAL_CELEBRATION"
    ],
    "v2TouchEngage": [
      "PHOTO_BOOTH", "SIGN_IN_PAD", "LANGUAGE_PICKER", "ACCESSIBILITY_TRAY", "NPS_SMILEY",
      "TRIVIA_GAME", "SPIN_TO_WIN", "DIRECTORY_SEARCH", "WAYFINDING_FLOOR_MAP",
      "DONATION_THERMOMETER"
    ]
  }
}
```

#### Required systemic remediation

1. Define one typed `WidgetDefinition` with persisted type, variant ID, renderer, editor schema, defaults, capability requirements, data bindings, player compatibility, and release status.
2. Generate Widget palette, Fast Add, Apps insertion, API catalog, TypeScript union, PropertiesPanel form, documentation, and registry parity tests from it.
3. Preserve concrete variant ID/config schema in `BoardDocumentV2`; never map incompatible variants into a shared type without an explicit adapter.
4. Every editor field declares its renderer-consumed path. CI performs edit → serialize → API save → reload → player-render assertion.
5. Add a full widget standard suite for text/image/background/clock/countdown/list/geometry/brand/binding controls.
6. Remove raw JSON from ordinary operator UX; keep it behind a developer role/flag.
7. Make reachability explicit: palette/app/template-only/internal/deprecated. Unreachable/dead controls fail CI.

#### Release acceptance

- Registry parity: zero palette/runtime/editor ghosts; zero dead public catalog entries; zero `as any` registrations.
- Field-path parity: every friendly control changes a renderer-consumed field after save/reload.
- Standard editability: each published widget scores at least an unqualified `B` for every applicable criterion; any D/F primary criterion blocks regardless of aggregate.
- Variant completeness: all 243 V2 variants either have a compatible typed schema/editor or are not published.
- Integration truth: every live-data control persists and resolves to a tested adapter.
- Source switching: inline/package modes are deterministic and reversible.
- Cross-browser/player matrix: every published widget renders on declared canvases/engines with no fake data, overflow, console errors, or remote asset misses.

---

## End of execution brief

The remediation is complete only when the Final Launch Definition in Part I is satisfied and every applicable domain acceptance test in Part II passes with current, retained evidence.
