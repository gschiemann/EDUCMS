# VenueOS Full-App Audit — Master Synthesis (tools-enabled)

_2026-05-30 · 5 worktree-isolated read-only agents, every claim file:line-traced · lead-reviewed_
_Domain map: the Standard Audit Surface (CLAUDE.md §1–21). No section silently scoped down._

## Page 1 — Coverage table (21 sections × Design / UX / Functionality)

| # | Section | D | UX | F | Status | Report |
|---|---|---|---|---|---|---|
| 1 | Real-time + emergency | B | B | B+ | Covered | 01 |
| 2 | Storage + egress | B | B | C+ | Covered | 02 |
| 3 | AI providers | A | B | A− | Covered | 02 |
| 4 | AI feature surfaces | B | B | B | Covered | 02 |
| 5 | AI competitive scan | N/A | N/A | C | Covered | 02 |
| 6 | Streaming | B | B | B | Covered | 03 |
| 7 | Sports / data | A | B | B | Covered | 03 |
| 8 | POS / commerce | B | B | B/C | Covered | 03 |
| 9 | Communications | C | C | **F** | Covered | 03 |
| 10 | Auth + identity | B | B | B+ | Covered | 04 |
| 11 | Billing + commerce | B | B | B+ | Covered | 04 |
| 12 | Design imports | B | B | C | Covered | 03 |
| 13 | Public alert integrations | N/A | N/A | N/A | **NOT-BUILT** | 03 |
| 14 | Multi-vertical surface | B | B | B+ | Covered | 05 |
| 15 | Cross-browser / Taurus | A | A | B+ | Covered | 01 |
| 16 | Forensic / audit | C | C | B | Covered | 04 |
| 17 | Operational / DX | A | A | A− | Covered | 01 |
| 18 | Accessibility / a11y | C | C | C | Covered | 05 |
| 19 | Template + widget editability | A− | A− | B+ | Covered | 05 |
| 20 | Design/UX/Functionality lenses | — | — | — | This table | all |
| 21 | Verification-Before-Claim | N/A | B | B | Covered | 05 |

**Lowest-graded sections (the real work): §9 Communications (F), §13 Public alerts (not built), §18 a11y (C across), §2 storage-F (C+), §16 forensic-D/UX (C), §5 AI-competitive (C).**

---

## P0 — fix before scaling to "hundreds of customers"

| # | § | Finding | Where | Fix | Risk to fix |
|---|---|---|---|---|---|
| P0-1 | 16 | **Audit log is NOT immutable at the DB.** CLAUDE.md claims "UPDATE/DELETE blocked at storage" — no such trigger exists. App-layer never mutates audit rows, but a DB-access actor / compromised API could. A documented safeguard that isn't real (the exact "theater" class the lead flagged 2026-05-21). | no migration has it | One migration: `BEFORE UPDATE OR DELETE ON audit_logs` → RAISE. | Low — app never updates/deletes audit rows (confirmed). DDL on prod = needs apply-window. |
| P0-2 | 9 | **Twilio + Slack are costumes.** Health shows DEGRADED when env keys are set (implies "ready, misconfigured"), but there is **zero send code**. A district setting `TWILIO_ACCOUNT_SID` for SMS emergency alerts gets nothing. | `integrations-health.controller.ts:694` | Status → COMING_SOON regardless of env; pull the env vars from CLAUDE.md until built. | Trivial / honesty. |
| P0-3 | 13 | **CAP / IPAWS / RapidSOS / Raptor all NOT built.** Emergency is closed-loop (VenueOS → own screens only). Any sales material implying gov-alert ingestion is false. | — | Sales-copy guardrail; roadmap item. | Decision, not code. |
| P0-4 | 2 | **Player bypasses the new CDN proxy** (the egress fix's residual). The kiosk fleet — highest-traffic consumer — still hits Supabase origin per PoP cache-miss; transforms/proxy only wired into the dashboard. | `player/page.tsx:4714,5191` | `resolveAssetUrl()` at player asset sites + set `NEXT_PUBLIC_ASSET_CDN`. | Low (helper no-ops until env set). |
| P0-5 | 18 | **a11y regression-gate is blind.** Warning baseline = 999 ("permissive ceiling," never run) → CI passes anything ≤999. Zero protection against moderate/minor a11y regressions. | `a11y-warning-baseline.json` | Run `pnpm a11y:ci`, record real count, lower from 999. | Low. |

## P1

| # | § | Finding | Where |
|---|---|---|---|
| P1-1 | 10 | OIDC callback CSRF — skips state check when session lost → code-injection login-as-anyone. Fix before any tenant enables OIDC. | `sso.service.ts:373` |
| P1-2 | 1 | SSE fallback drops **group-scoped** emergencies (handles tenant/device only) → group lockdown not real-time on SSE (5–10s poll backstop). 1-line fix. | `sse.service.ts:115` |
| P1-3 | 7 | Sports feed token not revocable — permanent machine write to score/clock, no rotation/expiry. | `sports-feed-token.ts` |
| P1-4 | 12 | Multi-page PDF import takes page 1 only — every Canva/Slides export is multi-page → under-delivers the literal operator ask. | `imports.controller.ts:239` |
| P1-5 | 2 | Video transcoding deferred — >50MB is a soft warning, ffmpeg exists but not on upload path. Biggest remaining egress risk at scale. | `media-optimization.service.ts:41` |
| P1-6 | 18 | a11y audit skips the **builder** — the most complex interactive surface isn't tested. | `a11y-audit.ts:44` |
| P1-7 | 6 | Soundtrack-Your-Brand OAuth tile is green but connect 400s. | `streaming.ts:326` |
| P1-8 | 8 | Square OAuth CSRF state in in-process Map → intermittent failure on multi-replica. | `pos-oauth.controller.ts:81` |
| P1-9 | 3 | Bug-analyzer pinned to stale `claude-3-5-sonnet-20241022` vs catalog Sonnet-4.5. 1-line bump = cheaper + better. | `bug-analyzer.service.ts:74` |
| P1-? | 6 | StreamingWidget ad-overlay `backdrop-filter: blur(4px)` — Taurus violation **IF** that widget ships to a Taurus LED wall (confirm first per CLAUDE.md scope). | `StreamingWidget.tsx:395` |

## Quick wins surfaced (zero/near-zero risk)
- **§17 — flip API Jest to blocking.** `continue-on-error: true` (`deploy-reliability.yml:129`) means failing tests don't block merge. The suite is **now green** (lead fixed the 2 stale specs today) → flip it.
- **§15 — pre-commit Tailwind `inset-0` grep** + tighten the stale RetailWidgets baseline (1→0).
- **§3 — bug-analyzer model bump** (P1-9, 1 line).
- **§14 — terms page** vertical-agnostic copy (chip already spawned).

## Verified strong (NOT theater — traced to real callers)
- **Emergency core** — atomic trigger/clear, cross-tenant scope, `@AllowPanicBypass` holds, `verifyWsHmac` real on every replica's pmessage, ms-timestamp parity, all 9 player message types, per-eventId dedup, manifest-as-truth ALL_CLEAR.
- **§19 editability A−/B+** — the "can't edit a single word" complaint is **fixed**; no widget below B; universal text-style footer + brand-var swatches.
- **§15 Taurus** — gate clean, 0 real inset violations.
- **§17 ops A−** — boot-secret + pool-sizing + ALLOWED_ORIGINS enforced at prod boot; full CI suite; OTA tag-sync guard.
- **§8 Square POS** — fully real end-to-end (OAuth, catalog poll, HMAC webhook, idempotency, refresh).
- **§3 AI providers A−** — one shared quota-error mapper across all 3, Redis caps, fresh catalog, BYOK AES-256-GCM, AbortSignal everywhere.
- **§11 Billing B+** — webhook idempotency + out-of-order guard + AuditLog-in-same-tx; SERIALIZABLE seat ceiling; PCI clean.
- **§5** — VenueOS **leads** on AI-copy-in-editor, full-template-from-text, auto alt-text, BYOK multi-provider (no competitor ships these in-editor).

## Honest "costume vs real" ledger (sales-critical)
REAL: Square POS · custom-webhook POS · YouTube/Twitch/HLS/public-broadcaster streaming · Resend email · outbound webhook (emergency.* only) · all AI surfaces.
COSTUME (looks wired, isn't): Twilio · Slack · Soundtrack-Your-Brand · Toast/Clover/Lightspeed/Shopify/Stripe-Catalog (honestly PARTNER-gated) · Vimeo/RTSP connect · Canva OAuth.
NOT-BUILT (don't imply): CAP/IPAWS/RapidSOS/Raptor · Daktronics/Sportzcast/Genius/MaxPreps/GameChanger · Teams/APNs/FCM/Sendgrid/PagerDuty · multi-page PDF · Slides/PPT-Online/Figma · Stripe Terminal · NFHS/Facebook-Live.
