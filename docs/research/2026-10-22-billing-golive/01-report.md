# Billing go-live readiness — 2026-10-22

Scope: the whole paid path (checkout monthly / annual, with and without AI; Customer Portal;
invoices; the webhook — signature, idempotency, ordering, `License` sync incl. `aiIncluded` from the
PRICE id, past due / dunning, cancellation; invoice / PO / comp customers; seats vs paired screens;
trial expiry) before the owner switches Stripe to live keys.

## Short answer

- **No Stripe TEST key exists on this machine** (no `STRIPE_*` in `.env` / `apps/api/.env`, no
  `stripe` CLI). Per the brief I did not request one, and **nothing here talked to Stripe's servers**.
  So Checkout, the Customer Portal, `invoices.list` and `invoices.pay` are **not** proven against
  Stripe — they are proven only by the existing unit specs and by `tsc` against the pinned SDK types
  (`stripe` 22.1.1, API `2026-04-22.dahlia`). The owner's test-mode run is step 1 of the checklist.
- **The webhook IS proven end to end, locally**: the real API build, the real route
  (`POST /api/v1/billing/webhook`, raw body), real signature verification, a scratch Postgres with all
  158 migrations applied, events signed with the Stripe SDK's own test-header helper. **18/18** after
  the fixes (16/18 before — the two failures were real bugs, below).
- **Two webhook bugs fixed, one go-live safety check added, stale public copy corrected.**

## 1. What was exercised, and the results

Harness: API built from this branch (`node dist/main`, port 8091), DB `billing_golive_scratch`
(`prisma migrate deploy`, 158 migrations), a FAKE secret key (`sk_test_LOCALFAKE…` — the SDK
constructs offline; any call back to Stripe fails, which exercises the documented fallbacks), local
`STRIPE_WEBHOOK_SECRET`, four local price ids. Script: signs each event, POSTs it, reads `licenses` /
`processed_stripe_events` / `audit_logs` back. A fresh tenant per run (the `audit_logs`
append-only trigger refused my first cleanup — confirming DB-level audit immutability works).

| # | Scenario | Result |
|---|---|---|
| 1 | No `stripe-signature` header | 400 `BILLING_WEBHOOK_MISSING_SIGNATURE` |
| 2 | Signed with the wrong secret | 400 `BILLING_WEBHOOK_VERIFICATION_FAILED` |
| 3 | `customer.subscription.created` (trialing, VenueOS + AI monthly, qty 3) on a FREE_TRIAL license | MONTHLY / ACTIVE / CARD / seats 3 / `aiIncluded=true` / 2500¢ / trial end mirrored |
| 4 | Same event id re-delivered | 200 `{duplicate:true}`, nothing written |
| 5 | Update → annual without AI, qty 5 | ANNUAL / `aiIncluded=false` / seats 5 / 1667¢ effective |
| 6 | An OLDER update delivered late | `staleOutOfOrder`, license unchanged |
| 7 | Unknown (custom) price id | `aiIncluded` left as it was |
| 8 | Portal update with no `metadata.tenantId` | tenant recovered by customer id |
| 9 | `invoice.payment_failed` (Stripe unreachable → event-implied) | PAST_DUE, dunning invoice + time stamped |
| 10 | Stale `subscription.updated` (active) after the failure | refused by the watermark, stays PAST_DUE |
| 11 | `invoice.paid` | ACTIVE, dunning cleared |
| 12 | `checkout.session.completed` while Stripe is unreachable | 500 **and the idempotency claim is released** (Stripe's retry does real work — BILL-01) |
| 13 | `customer.subscription.deleted` | CANCELLED |
| 14 | Re-subscribe (new subscription, same customer) | ACTIVE on the new subscription |
| 15 | Late `invoice.payment_failed` of the OLD subscription | **was PAST_DUE → fixed: ignored, stays ACTIVE** |
| 16 | Re-subscribe with no trial clears the old trial end | **was kept → fixed: null** |
| 17 | Every applied event wrote an AuditLog row | yes (created ×2, updated ×4, deleted, paid, payment_failed) |

Also checked: the production route answers an unsigned POST with 400 `BILLING_WEBHOOK_MISSING_SIGNATURE`
(`api-production-39a1.up.railway.app`) — the route and raw-body parser are live there.

Not exercised against Stripe (needs a test key): Checkout session creation (both periods × AI on/off,
`trial_end`, adjustable quantity), Portal (incl. the `payment_method_update` flow), `invoices.list`,
`invoices.pay` retry, `subscriptionItems.update` (seats, AI switch), and the price check below.

## 2. Bugs fixed (`apps/api/src/billing/`)

1. **A late invoice of an earlier subscription knocked a paying customer off their plan.** The invoice
   handler finds the License by CUSTOMER id; a customer who restarts keeps the customer and gets a new
   subscription (Checkout cancels the leftover `unpaid` one). A late `invoice.payment_failed` of the old
   subscription re-fetched it (`canceled` → **CANCELLED = view-only**) or, with Stripe unreachable, fell
   back to **PAST_DUE**, and wrote that onto the new paid plan. Now an invoice whose subscription is not
   the License's current one is acknowledged and logged, never applied (`stripe.service.ts`
   `applyInvoicePaymentStatus`).
2. **A phantom trial after a re-subscribe.** `trialEndsAt` was written only when the subscription had a
   `trial_end`, so a plan with no trial kept the OLD trial date. `billingStateOf` then read "card on
   file + trial end in the future" as `trial_card`: the Billing page told a customer charged today that
   "billing starts <old date>", and `aiEntitlementOf` gave a plan WITHOUT AI the trial AI allowance on
   our keys. `trialEndsAt` now mirrors the subscription, null included (`syncLicenseFromSubscription`).
3. **Go-live safety: the configured prices are now checked against the advertised ones**
   (`price-config-check.ts`, new). Nothing tied the four `STRIPE_PRICE_*` ids to the $20 / $200 / $25 /
   $250 the dashboard, `/pricing` and the Terms quote — a mistyped amount, a yearly price in the monthly
   slot, a test price under a live key, a metered or tiered price, or only one AI price would have gone
   live silently. Each slot is checked for amount, USD, recurring, interval (every 1 month / year),
   licensed per-unit, active, livemode = key mode; a trial on the price is a warning; one AI price
   without the other fails. Runs once 5 s after boot (Railway log line `billing: price check OK …` or
   `billing: PRICE CHECK FAILED …`; never blocks boot; off under `NODE_ENV=test` or
   `BILLING_PRICE_CHECK_DISABLED=1`) and on demand at **`GET /api/v1/billing/config-check`**
   (SUPER_ADMIN only — also says whether `STRIPE_WEBHOOK_SECRET` is set). Never returns or logs the
   key (Stripe's masked key fragment is stripped from its error text).
4. **Stale public copy.**
   - The free trial's AI allowance is **2 board designs + 2 images** (`AI_TRIAL_BOARDS` / `_IMAGES`,
     owner decision, commit `e837db11`), but `/pricing` (FAQ), the catalog feature list
     (`packages/api-types/src/billing.ts` — shown on the Billing page), and two help pages still said
     **10 + 10**. Corrected; a spec now ties the catalog claim to `aiPlanLimits()` defaults.
   - `capability-registry.ts` `pricing-plan-truth` claim still said $25 / $240. Corrected; pinned.

Tests: `price-config-check.spec.ts` (new, 19), `stripe.service.spec.ts` (+8), `ai-plan.spec.ts` (+1),
`packages/api-types/src/billing.spec.ts` (+2). All billing suites 188/188; web billing / pricing / help
suites 43/43. No new user-facing dashboard strings (the config check is a staff-only API answer), so
no i18n keys were needed; the corrected copy was English-only before (static `/pricing` FAQ, catalog
feature list, help Markdown).

## 3. Price consistency (every surface checked)

| Surface | VenueOS | VenueOS + AI | OK |
|---|---|---|---|
| `ai-plan.ts` PLAN_PRICES / `trial-policy.ts` (what `/billing/summary` serves the dashboard) | 2000 / 20000 | 2500 / 25000 | yes |
| `packages/api-types` LICENSE_TIERS (Billing page tier cards) | $20 / $200 | $25 / $250 | yes |
| `/pricing` page + metadata + FAQ | $20 / $200 | $25 / $250 | yes |
| Landing page, Terms, help `billing.md`, `generate-with-ai.md` | $20 / $200 | $25 / $250 | yes |
| Add-payment sheet, seat notice, AI plan card | from `/billing/summary` | same | yes |
| Capability registry claim | was $25 / $240 | — | **fixed** |
| Trial AI allowance in public copy | was 10 + 10 | — | **fixed → 2 + 2** |

What a customer is CHARGED is the Stripe Price — now checked by item 3.

## 4. The owner's go-live checklist

Do it all in **test mode first**, then repeat 1–4 in live mode with the live key.

1. **Products and prices** (Stripe → Product catalog). Two products are clearest — "VenueOS" and
   "VenueOS + AI" — each with two prices. Every price: **Recurring**, **Standard pricing / per unit**
   (not package, not tiered, not usage-based), **USD**, **no free trial on the price** (VenueOS sets
   each customer's trial end itself).
   - VenueOS **$20.00 / month** → `STRIPE_PRICE_MONTHLY`
   - VenueOS **$200.00 / year** → `STRIPE_PRICE_ANNUAL`
   - VenueOS + AI **$25.00 / month** → `STRIPE_PRICE_MONTHLY_AI`
   - VenueOS + AI **$250.00 / year** → `STRIPE_PRICE_ANNUAL_AI`
   Set both AI prices or neither (with one, the AI plan is hidden and the price check fails).
2. **Webhook** (Developers → Webhooks → Add endpoint):
   `https://api-production-39a1.up.railway.app/api/v1/billing/webhook` (or the API's custom domain if
   it has one — the URL must reach the Railway API, never the Vercel web origin). Events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`, `invoice.payment_succeeded`, `invoice.paid`. Copy its signing secret.
3. **Railway → API service → Variables**: `STRIPE_SECRET_KEY` (`sk_test_…`, later `sk_live_…`),
   `STRIPE_WEBHOOK_SECRET` (`whsec_…` of THAT endpoint — test and live endpoints have different
   secrets), the four `STRIPE_PRICE_*`. Nothing goes on Vercel. Key + both non-AI prices together are
   what switch on trials at signup and every billing gate (`cardBillingReady`), so set them in one
   change. Also confirm `EMAIL_FROM` is on a verified sending domain, or the trial / card-failure
   emails reach only the Resend account owner.
4. **Verify after the deploy**: the Railway log shows `billing: price check OK (test key; AI plan
   offered)`, or sign in as SUPER_ADMIN and open `GET /api/v1/billing/config-check` — `ok: true`,
   `webhookSecretSet: true`. Any `PRICE CHECK FAILED` line names the slot and the exact fix.
5. **Customer Portal** (Settings → Billing → Customer portal): allow updating payment methods;
   show invoice history; allow **subscription updates → quantity**, and add all four prices as
   switchable (monthly ↔ annual, with ↔ without AI — the webhook stamps `aiIncluded` from the price);
   proration: prorate; cancellation: **at end of billing period**; business name / links / return URL.
6. **Revenue recovery** (Settings → Billing → Subscriptions and emails): Smart Retries on; failed-
   payment and expiring-card emails on; "if all retries fail" → **cancel the subscription** (VenueOS
   treats `unpaid` the same way — view-only, screens keep playing). Receipts for successful payments on.
7. **Test run in test mode** (card `4242 4242 4242 4242`, any future date, any CVC):
   a. sign up → trial banner; pair a screen; Settings → Billing → Add payment → Monthly, AI off →
      Stripe Checkout → back: "You're all set", License `MONTHLY`, seats = quantity, `trialEndsAt` =
      the trial's original end;
   b. Portal → switch to annual with AI → License `ANNUAL`, `aiIncluded=true`;
   c. pair past the seat count → "Add 1 screen" → quantity +1, prorated;
   d. card `4000 0000 0000 0341` (attaches, then fails) → after the trial / next invoice: PAST_DUE
      banner, "Update card" → `4242…` → "You're all set";
   e. Portal → cancel → at period end (use a Stripe test clock to fast-forward) CANCELLED = view-only;
      Add payment again → new subscription, ACTIVE (the leftover is cancelled first);
   f. an INVOICE / PO / COMP customer (set in the owner console) sees no card checkout (409
      `BILLING_NOT_CARD` from the API).
8. **Go live**: create the same four prices in live mode (live and test ids differ), a live webhook
   endpoint, swap the five variables, confirm step 4 says `live key` and OK.

## 5. Open items for the owner (not changed here)

- **Multi-location self-serve seats (A16, 2026-10-11 report).** Seats and the Stripe quantity count
  only the tenant that owns the License; screens in locations under a self-serve organisation are not
  counted or billed. Needs org-level seat counting before self-serve multi-location is sold.
- **Cancelling during the card trial.** With the portal set to cancel "at end of billing period"
  (step 5) the trial runs to its end, then the subscription is deleted → CANCELLED → view-only at once
  — a card-less trial instead gets 7 days of grace before view-only. An IMMEDIATE cancellation (portal
  set to "immediately", or done from the Stripe dashboard) makes it view-only the same minute. Decide
  whether a cancelled card trial should get the same 7-day grace.
- **Existing no-license pilot tenants stay free/unlimited** when Stripe goes live; there is no
  console action to put them on a trial or plan.
- **More than 1,000 paired screens** makes Checkout's adjustable-quantity minimum exceed its maximum
  (Stripe would refuse). Not a self-serve case today.
- Suggested `CLAUDE.md` additions (lead's call): the `BILLING_PRICE_CHECK_DISABLED` lever and
  `GET /billing/config-check` under "Stripe billing setup".

## Files

- `apps/api/src/billing/stripe.service.ts` — fixes 1–2, price check + boot log
- `apps/api/src/billing/price-config-check.ts` (+ `.spec.ts`) — the pure price rules
- `apps/api/src/billing/billing.controller.ts` — `GET /billing/config-check`
- `apps/api/src/billing/stripe.service.spec.ts`, `ai-plan.spec.ts` — regression tests
- `packages/api-types/src/billing.ts`, `capability-registry.ts`, `billing.spec.ts` — copy + pins
- `apps/web/src/app/pricing/page.tsx`, `apps/web/src/content/help/{billing,generate-with-ai}.md` — copy
