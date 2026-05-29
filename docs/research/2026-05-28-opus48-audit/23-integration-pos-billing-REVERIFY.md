# Integration Re-Verify — §8 POS/Commerce · §11 Billing

> Opus 4.8 read-only re-verify, 2026-05-28 (Wave 3), at HEAD a3f8533. Baseline
> (06-08, 10-11) was written BEFORE commits 22a0a3a (custom-webhook receiver),
> 4a3c01d (P1-6 honest re-tier), P2-B seat-tx retry — several baseline verdicts
> are now outdated. Verdict scale: WORKS / PARTIAL / COSTUME / NOT-BUILT(honest).

## Bottom line
The POS "costumes" the lead suspects **were real two audits ago and have since been
de-theatered.** What remains is **breadth** (only Square + BYO-webhook actually sync
among 9 POS providers) and **one real billing bug: a pilot-seat revenue leak.** The
spine (Square, Stripe billing, webhook hardening, seat enforcement) is genuinely
production-grade.

## 🚨 HIGHEST-IMPACT FINDING — pilot seat-limit revenue leak (needs Greg's number)
3-way contradiction on the free-pilot seat cap:
- `license.service.ts:33` `PILOT_SEAT_LIMIT = 1000` ← **this is what actually enforces** (`:52`)
- `billing.controller.ts:138` `activateTrial` claims `seatLimit: 3`
- CLAUDE.md free-pilot policy: "1 school / **≤5 screens** / 90 days"

→ A no-card pilot tenant can pair **~1000 screens free.** Revenue leak. The number is
a business decision (CLAUDE.md open-Q #4) — recommend setting `PILOT_SEAT_LIMIT` to
the contracted pilot cap (5 per the documented policy) and making `activateTrial`
agree. **Flagging to Greg for the number; the 1000 is clearly wrong.**

## §8 POS / Commerce
| Integration | Verdict | Evidence | Gap |
|---|---|---|---|
| **Square POS** | **WORKS** | `pos/providers/square.ts:82` OAuth, `:185` catalog, `:289` HMAC; `pos-oauth.controller.ts:113/174`; `pos.service.ts:334`; hourly `pos-sync.cron.ts:56`; consumed `MenuBoardWidget.tsx:274-294` via `/pos/items` | none — production-grade; needs SQUARE_* env |
| **Custom Webhook (BYO-POS)** | **WORKS** (baseline said 404 COSTUME — now built) | receiver `pos-oauth.controller.ts:285`; ingest `pos.service.ts:560`; constant-time secret `:511`; tested `pos-webhook.spec.ts:105-208` | `docsUrl '/docs/pos/custom-webhook-spec'` `pos.ts:254` is a DEAD LINK (spec is inline anyway) |
| Sample catalog (demo) | WORKS (demo) | seeds `PosMenuItem` | by design |
| **Toast** | **NOT-BUILT (honest)** | `pos.ts:113` `PARTNER`; API rejects `pos.service.ts:98-102`; UI "in development" no form `settings/pos/page.tsx:325-340` | needs `providers/toast.ts` — #1 breadth gap |
| **Clover** | **NOT-BUILT (honest)** (baseline "worst lie DIRECT" — FIXED) | `pos.ts:124-147` downgraded DIRECT→PARTNER w/ audit comment | needs handler |
| Lightspeed / Shopify / Stripe-catalog / MINDBODY | **NOT-BUILT (honest)** | `pos.ts:170-243` all PARTNER, rejected at API | handlers |
| Aloha (NCR) | **N-A (honest)** | `pos.ts:148-167` CLOSED, throws on connect | no public API exists |
| Promo/happy-hour dayparting | **NOT-BUILT** | no time-window logic | `PosMenuItem` time fields + widget filter |
| **AI Concierge discover/describe** | **PARTIAL — backend real, NO UI** | `discovery.service.ts:399,433` real SSRF-safe fetch+cheerio+scoring; `integrations.controller.ts:72,90` endpoints; **`grep integrations/discover apps/web/src` → 0 hits** | ~530 lines unreachable from operator. Wire an onboarding step OR remove. |
| Concierge "Connect" | **COSTUME (in data model, moot)** | only `square` has real `connectHref`; all others null; and `connectHref '/connect/square'` `discovery.service.ts:99` → route doesn't exist (only `/connect/square/done`) | moot — no UI calls it |

## §11 Billing
| Surface | Verdict | Evidence | Gap |
|---|---|---|---|
| Stripe Checkout | **WORKS** | `stripe.service.ts:214`; `billing.controller.ts:51`; UI `:112`; degrades `{enabled:false}` | none |
| Stripe Customer Portal | **WORKS** | `stripe.service.ts:254`; `:83`; clean `{noSubscription:true}` | none |
| Stripe Invoices | **WORKS** | `stripe.service.ts:271`; `:100`; `[]` when off | none |
| Stripe Webhook (idempotent+ordered+audit) | **WORKS** | `billing-webhook.controller.ts:32` rawBody, CSRF-exempt; dedup on event.id PK `stripe.service.ts:336`; out-of-order guard `:481`; audit in-tx `:524`; tested `:183-378` | none — hardened |
| License seat enforcement | **WORKS** | `screens.controller.ts:1055-1088` SERIALIZABLE pair-tx in `withDbRetry` (P2-B); `license.service.ts:99-137` 402 LICENSE_EXHAUSTED | none |
| License↔Stripe reconcile cron | **WORKS** | `license-reconcile.cron.ts:114` daily; multi-replica dedup `:198`; no-op when off | none |
| **Free pilot lifecycle** | **PARTIAL / costume-ish** | `activateTrial` `billing.controller.ts:129` is copy-only stub (writes no License); + the 1000-vs-3 seat contradiction above | wire real activation + fix seat cap |
| PCI scope (no PAN) | **WORKS (verified clean)** | card entry Stripe-hosted only; store opaque ids | SAQ-A intact |

## Costumes ranked by customer visibility
1. **Pilot seat 1000-vs-3** — not customer-visible but a REVENUE LEAK (highest impact).
2. `activateTrial` stub `billing.controller.ts:129` — low visibility, hollow success toast if wired to a button.
3. Custom-webhook `docsUrl` dead link `pos.ts:254` — visible but harmless (inline spec).
4. Concierge `connectHref '/connect/square'` → nonexistent route — moot (no UI).
- Stale comment `settings/pos/page.tsx:11-15` ("wizard accepts credentials…") — now false; doc rot only.

## ACTIONABLE FIX LIST
1. **(Greg's number) `license.service.ts:33` PILOT_SEAT_LIMIT 1000 → contracted cap (rec 5)** + make `activateTrial` seatLimit agree. Revenue leak.
2. Build `providers/toast.ts` (OAuth + handler) — biggest breadth gap, #2 QSR POS.
3. Concierge: wire `discover/describe` into an onboarding step OR remove the ~530 lines of unreachable backend. (Also fix `connectHref` → `/connect/square/done` if kept.)
4. Trivial: fix `/docs/pos/custom-webhook-spec` dead link (`pos.ts:254`) + stale `settings/pos/page.tsx:11-15` comment.

**Honest count:** POS = 2 of 2 advertised-as-ready (Square + BYO-webhook) WORK; 6 honestly marked not-ready; 1 honestly closed. Billing = 6 of 7 Stripe surfaces production-grade; only free-pilot lifecycle is soft (+ the seat leak).
