# Billing made simple — trial → paid (2026-10-11)

Greg's question: *"When customers sign up, is the workflow to get cards simple? If they do the
trial, is it easy for them to convert to paid? Make sure this is simple."*
Pricing: $25 / screen / month or $240 / screen / year.

**Short answer (before):** no. There was no trial at all. A self-serve signup got a free,
never-ending, 1,000-screen "pilot", nothing ever told anyone a trial existed or was ending, and
the only way to pay was to find Settings → Billing yourself. Card checkout existed and was
PCI-correct, but it charged on day one, a failed card could lock the whole dashboard
(including the page that fixes it), and a full plan had no "add a screen" step.

**After (this branch):** a real 14-day / 3-screen trial, a quiet one-line "12 days left · Add
payment" on every dashboard page (desktop + iPhone), a one-sheet Monthly/Annual choice that
opens Stripe Checkout pre-filled, billing that starts on the trial's original end date, "You're
all set" on return, reminder emails at 7 days / 1 day / ended (en/es/zh), a clear grace period
and view-only mode that never touches screens or emergency alerts, and "Add 1 screen and pair"
inline in the pairing dialog. All of it is dormant until Stripe is configured — production
today is unchanged.

Branch: `worktree-agent-a6c38a1e766b284f7` · commits `a7f4a6fa`, `8febdf4f`, `4f727e7a`,
`46f1a9a7` (on top of `f7f3500b`). Not pushed.

---

## 1. Audit — the path a brand-new self-serve customer lived (before)

Line numbers are at `f7f3500b`.

| # | Step | What happened | Where | Stuck? |
|---|---|---|---|---|
| A1 | Sign up | Tenant + admin created. **No License row, no trial clock.** | `apps/api/src/onboarding/onboarding.service.ts:235-276` | — |
| A2 | "Trial" | A no-license tenant is the internal **PILOT: 1,000 screens, never expires** (`PILOT_SEAT_LIMIT` default 1000). The advertised "14 days / 3 screens" (`packages/api-types/src/billing.ts` FREE_TRIAL) was enforced nowhere. | `apps/api/src/license/license.service.ts:47, 79` | Revenue leak: nobody ever has to pay |
| A3 | "Start trial" | `POST /billing/activate-trial` is a read-only probe that commits nothing (`committed: false`). | `apps/api/src/billing/billing.controller.ts:254-262` | — |
| A4 | How much trial is left | Nowhere. No banner, no date, no email. | — | **Yes** — the customer never learns a trial exists |
| A5 | Add a card | Only by finding Settings → Billing → a tier tile → "Choose Monthly/Annual". | `apps/web/src/app/[schoolId]/settings/billing/page.tsx` | More than a click; not discoverable |
| A6 | Checkout | Stripe-hosted (good, SAQ-A). But: **billing starts immediately** (no `trial_end`), quantity fixed at paired screens (not adjustable), email not pre-filled. | `apps/api/src/billing/stripe.service.ts:272-283` | Paying early cost trial days |
| A7 | Back from Stripe | "Subscription started. Your plan updates here within a few seconds — **refresh if it hasn't yet**." | `billing/page.tsx:322-330` | Asks the operator to refresh |
| A8 | Trial ends, no card | Nothing happens (there is no trial). | — | — |
| A9 | Card fails later | `past_due` → PAST_DUE (pairing blocked, `license.service.ts:199`). But Stripe `unpaid` / `paused` → **SUSPENDED**, which is the owner's suspension: every dashboard call 403s and the user is sent to `/account-suspended` — **including the Billing page they need to fix the card** (`/billing` is not in the suspension exempt list). | `stripe.service.ts:652`, `customers/customer-console.policy.ts:544` | **Dead end** |
| A10 | Dunning UX | No banner, no "update card" anywhere outside Billing → Manage billing. | — | Yes |
| A11 | Pair a screen beyond plan | Card subscribers: `seatLimit` 100,000 and the Stripe quantity **silently followed every pair/unpair** — no dead end, but the bill changed without the customer being told. Pilot/trial: raw `LICENSE_EXHAUSTED` text in red; the web never read the code. | `stripe.service.ts:115, 178-219, 799`; `screens/page.tsx:247`; `pair/page.tsx:56` | Dead-end text, no action |
| A12 | Change plan / quantity | Customer Portal (exists). | `stripe.service.ts portalForTenant` | OK |
| A13 | Billing page for a trial | A FREE_TRIAL License would have been treated as a paid plan (`hasPaidPlan` only excluded PILOT) and shown "$0.00 per month". | `billing/page.tsx:255, 514` | (latent) |
| A14 | Docs | Service header still said $15 / $150. | `stripe.service.ts:16-17` | — |
| A15 | Invoice / PO / Comp | Correctly excluded from checkout by the console work (`cardCheckoutAllowed`). | `billing.controller.ts` | OK — kept |

Not changed, reported (pre-existing, bigger than this task): **A16 — multi-location self-serve.**
`assertSeatAvailable` and the Stripe quantity count only the tenant that owns the License. A
school / location created under a self-serve organisation has no License of its own, so it falls
back to the 1,000-screen PILOT and its screens are neither capped nor billed
(`license.service.ts getEffective` + `stripe.service.ts seatCount`). The trial-ended / read-only
gates added here DO follow the parent (they read `orgAccount().governing`); the seat count does
not. See Decision 7.

---

## 2. What changed (after)

### The rules — one pure function
`apps/api/src/billing/trial-policy.ts` (`billingStateOf`) decides
`none | offline | trial | trial_card | trial_ended | locked | active | past_due | cancelled | suspended`
and whether pairing is blocked / the dashboard is read-only. The banner, the Billing page, the
pairing gate, the read-only gate and the reminder emails all call it. 22 tests
(`trial-policy.spec.ts`).

**Nothing is enforced unless card billing is live** (`cardBillingReady()` = `STRIPE_SECRET_KEY`
+ `STRIPE_PRICE_MONTHLY` + `STRIPE_PRICE_ANNUAL`). Nobody can be locked out for not paying on a
deploy where they cannot pay.

### Data (additive migration)
`packages/database/prisma/migrations/20261011120000_license_trial/migration.sql` — three columns
on `licenses`: `trial_ends_at`, `trial_notice_stage` (int, default 0), `notice_locale`. Generated
with `prisma migrate diff`, made idempotent, `lock_timeout 5s`. **Proven on a scratch Postgres 16:
applied twice, both exit 0.** Sorts after `20261010210000_screen_drill_content`.

### API
| Change | File |
|---|---|
| Signup starts a real trial (FREE_TRIAL, 14 days, 3 screens, CARD, signup language) + `BILLING_TRIAL_STARTED` audit row — **only when card billing is live**; otherwise signup is byte-for-byte what it was | `onboarding/onboarding.service.ts`, `api-types SignupInputSchema.locale` |
| Checkout: `subscription_data.trial_end` = original trial end (clamped to Stripe's 48 h floor; none once expired), quantity = paired screens and **adjustable** (min = paired, max 1000), `customer_email` pre-filled, `payment_method_collection: always`, `locale: auto` | `billing/stripe.service.ts checkoutForTenant` |
| `GET /billing/summary` — the one read for banner / Billing page / pair dialog; `canManage` per role; `canCheckout` false for INVOICE/PO/COMP and while Stripe is off | `billing/billing.controller.ts` |
| `POST /billing/seats` (`{add:1}` or `{quantity}`) — Stripe `subscriptionItems.update` with `create_prorations`, seatLimit written at once, `BILLING_SEATS_CHANGED` audit row; refused below paired, when past due, for non-card | `stripe.service.ts setSeatQuantity`, controller |
| **Seats = Stripe quantity.** Webhook writes `seatLimit = quantity` and mirrors `trial_end` → `trialEndsAt`. The quantity sync is now **raise-only** (never takes pre-bought seats away; still corrects drift up) | `stripe.service.ts` |
| Stripe `unpaid` / `paused` → **PAST_DUE** (was SUSPENDED = whole-dashboard lock incl. Billing) | `stripe.service.ts mapSubscriptionStatus` |
| Pairing after an ended trial → `402 TRIAL_ENDED {canUpgrade}`; a full plan → `LICENSE_EXHAUSTED` with `canAddSeat` + price (card) or `canUpgrade` (trial); a trial's 3-screen cap does not bind while billing is off | `license/license.service.ts` |
| Read-only gate (global interceptor): locked trial / cancelled plan → people's mutations `402 BILLING_READ_ONLY`. Exempt: every GET, devices, SUPER_ADMIN, `/emergency`, `/panic-content`, `/billing`, `/license`, `/auth`, `/users/me`, `/bugs`, health, CSRF. Fails open. Off unless billing is live | `billing/billing-gate.interceptor.ts` |
| Reminder emails: 7 days, 1 day, ended — en/es/zh; hourly, **leader-leased** (`LEASE.TRIAL_REMINDERS`), off under `NODE_ENV=test` / `TRIAL_REMINDERS_DISABLED=1` / billing off; each stage **claimed atomically before sending** (at most once across replicas); placeholder `.invalid` addresses skipped; `BILLING_TRIAL_NOTICE_SENT` audit row | `billing/trial-reminder.cron.ts`, `billing/trial-emails.ts`, `email.service.ts sendBillingNotice` |

### Web
| Change | File |
|---|---|
| **TrialStatusBar** under the top toolbar, every dashboard page, desktop + iPhone. Trial: neutral one-liner, "Hide until tomorrow" while > 3 days left. Ended / view-only / past due / plan ended: amber/red, not dismissible. Contributors see "Ask an admin". Nothing for paying, invoice, comp or pilot customers. One cached read, no poll, no blur (mobile-perf guard green) | `components/billing/TrialStatusBar.tsx`, `components/layout/DashboardLayout.tsx` |
| **AddPaymentDialog** — bottom sheet on phone, modal on desktop: Annual pre-selected with "Save $60 per screen", Monthly; "2 screens × $240 = $480 per year"; "You won't be charged until Oct 25 — you keep every trial day"; "Continue to secure checkout" → Stripe. With Stripe off: "Billing isn't set up yet" + sales email, never a dead button | `components/billing/AddPaymentDialog.tsx` |
| **BillingStatusCard** at the top of Settings → Billing: days left + screens used + Add payment; **"You're all set"** on return from Stripe (one re-read after 4 s, no poll); Update card (portal) for past due; Restart plan for cancelled | `components/billing/BillingStatusCard.tsx`, `settings/billing/page.tsx` |
| **SeatLimitNotice** in both pairing flows: full card plan → "Add 1 screen ($25/month) and pair" (adds the seat, retries the pair); trial full / ended → Add payment | `components/billing/SeatLimitNotice.tsx`, `[schoolId]/screens/page.tsx`, `pair/page.tsx` |
| Billing page: FREE_TRIAL is not a paid plan (no portal button, "No charge during your free trial.") | `settings/billing/page.tsx` |
| Signup sends the page language for the emails | `signup/page.tsx` |
| `billingTrial.*` in en / es / zh (55 keys each) | `i18n/messages/*.json` |

### What "limited" means, exactly
| State | When | Screens | Emergency | Dashboard | Pair new screens |
|---|---|---|---|---|---|
| trial | day 0–14 | play | works | full | up to 3 |
| trial_card | card added during trial | play | works | full | adds seats (prorated, $0 until trial end) |
| trial_ended | trial over, no card, days 1–7 | play | works | **full** | **blocked** (Add payment) |
| locked | > 7 days after trial end, no card | play | works | **view-only** (all GETs; billing, auth, emergency still usable) | blocked |
| past_due | card failed, Stripe retrying | play | works | full | blocked (existing rule) |
| cancelled | card subscription ended | play | works | **view-only** | blocked |
| any | Stripe not configured | play | works | full | not blocked by billing |

Screens are never gated (device principals skip every gate; the manifest path is untouched);
emergency routes are exempt for people too.

---

## 3. The happy path, click by click (trial → paid)

1. `/signup` → organisation, email, password, industry → **Create account**. Lands on the
   dashboard; a 14-day / 3-screen trial is running. Top of every page:
   *"14 days left in your free trial · Add payment"*.
2. Screens → **Pair screen** → code → paired (up to 3; the 4th shows "Your free trial includes 3
   screens · Add payment" inline).
3. Tap **Add payment** (top bar, Billing page, or pair dialog). Sheet: **Annual** pre-selected —
   "$240 per screen / year · Save $60 per screen"; "2 screens × $240 = $480 per year";
   "You won't be charged until Oct 25 — you keep every trial day."
4. Tap **Continue to secure checkout** → Stripe Checkout (email pre-filled, screen count
   adjustable) → card → **Start trial / Subscribe**.
5. Back on Settings → Billing: **"You're all set. Your card is saved. Billing starts Oct 25."**
   The top bar disappears.
6. Oct 25: Stripe charges automatically; the webhook flips the plan to active. Nothing to do.

Three taps plus typing a card on Stripe's page — inside the 30-second budget.

Adding a screen later: Pair screen → "Your plan covers 3 screens · **Add 1 screen ($25/month) and
pair**" → one tap → paired. Changing monthly↔annual, lowering screens, card, invoices, cancel:
Settings → Billing → **Manage billing** (Stripe Customer Portal).

---

## 4. What Greg must configure in Stripe (test mode first)

1. **Product** "VenueOS screen" with two **recurring, per-unit (licensed)** prices, USD:
   - $25.00 / month → `STRIPE_PRICE_MONTHLY`
   - $240.00 / year → `STRIPE_PRICE_ANNUAL`
   Do **not** put a trial on the prices — the API sets `trial_end` per customer.
2. API env (Railway): `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`,
   `STRIPE_WEBHOOK_SECRET`. **All three of key + both prices** must be set before trials start or
   anything is enforced. Also confirm `APP_PUBLIC_URL` (the email links) and a **verified Resend
   sending domain** (`EMAIL_FROM`) — on the shared `onboarding@resend.dev` sender the reminders
   only reach the Resend account owner.
3. **Webhook** → `POST https://<api>/api/v1/billing/webhook`, events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded` (AI board packs),
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`,
   `invoice.paid`. (`customer.subscription.trial_will_end` is not needed — our own emails cover it.)
4. **Customer Portal** (Settings → Billing → Customer portal): allow updating payment methods;
   show invoice history; **allow subscription updates → quantity** (and both prices as switchable
   products so monthly ↔ annual works), proration "prorate"; cancellation **at end of billing
   period**; set the default return link to the dashboard.
5. **Revenue recovery**: Smart Retries on; failed-payment and expiring-card customer emails on;
   "if all retries fail" → **cancel the subscription** (→ view-only, screens keep playing) or
   **mark unpaid** (→ stays past-due: pairing blocked, editing kept) — Decision 3.
6. Receipts: enable "successful payments" emails. Optional: Stripe Tax.
7. Test with card `4242 4242 4242 4242` (test mode only) — sign up, pair, Add payment, return,
   check the License row (`tier MONTHLY/ANNUAL, seatLimit = quantity, trial_ends_at`).

Suggested CLAUDE.md lines (not edited by this agent): add `TRIAL_REMINDERS_DISABLED` /
`TRIAL_REMINDERS_INTERVAL_MS` to the env table and a note under "Stripe billing setup" that a
trial starts at signup only while key + both prices are set.

---

## 5. Decisions for Greg

1. **Trial = 14 days / 3 screens** (the advertised catalogue numbers, `TRIAL_DAYS` /
   `TRIAL_SCREENS` in `trial-policy.ts`). Keep, or e.g. 30 days / 5 screens for venues?
2. **Grace 7 days after the trial, then view-only.** Pairing stops the day the trial ends.
3. **Cancelled card plan → view-only** (screens keep playing their last content forever). And
   Stripe's "all retries failed" action: cancel (→ view-only) or mark unpaid (→ past due).
4. **Seats are now what the customer pays for** (Stripe quantity), added explicitly with one tap;
   unpairing no longer silently lowers the bill (they lower it in the portal). Before, the bill
   silently tracked every pair/unpair. Alternative: go back to auto-tracking and drop the "Add 1
   screen" step. Recommend keeping explicit seats (no surprise invoices).
5. **< 48 h of trial left when paying**: Stripe's floor means up to ~2 extra free days rather
   than an early charge.
6. **Existing customers are untouched**: no-license pilots stay free/unlimited; tenants that sign
   up while Stripe is off stay pilots too. When Stripe goes live you need a way to put them on a
   trial (a console action or a one-off script) — not built.
7. **Multi-location self-serve (A16)**: screens in schools/locations under a self-serve
   organisation are not counted or billed today. Recommend org-level seat counting before
   self-serve multi-location goes live.
8. **Stripe `unpaid`/`paused` now map to PAST_DUE**, not the owner's SUSPENDED lock — so a
   billing problem never hides the page that fixes it. Owner suspension is unchanged.

---

## 6. Verification

- API `tsc --noEmit -p tsconfig.build.json`: clean.
- Web `tsc --noEmit` (unfiltered): clean.
- API suites: `trial-policy.spec.ts` (22), `trial-to-paid.spec.ts` (18 — checkout params incl.
  `trial_end` + quantity, webhook trial→active / past_due / unpaid / canceled, seat add with
  proration + audit, raise-only sync, reminder scheduling + once-only + exclusions, TRIAL_ENDED /
  canAddSeat pairing payloads, read-only gate exemptions), `billing.controller.trial.spec.ts`
  (10 — summary per state, invoice/PO/comp exclusion for seats + checkout, Stripe-off), onboarding
  (+2), plus every existing billing / license / customers / onboarding suite: green. Negative
  control: breaking the emergency exemption turns `trial-to-paid.spec.ts` red.
- Web suites: `components/billing/__tests__/trial-status-bar.test.tsx` (9),
  `settings/billing/__tests__/trial-billing.test.tsx` (4), existing billing page suites: green.
- Full API Jest: 482 suites / 9,362 tests passed (2 skipped suites are pre-existing). The one
  failure on the first run was the SEC-009 coverage guard flagging `billing.controller.ts` (it now
  reads `license` / `user` by the session's ids) — documented in `DOCUMENTED_GAPS` with the reason
  and the covering specs; tenant-isolation suites then 519/519.
- Full web Jest: 520 suites / 7,817 tests passed.
- i18n parity: OK (4186 keys, en/es/zh). jsx-a11y errors: **42 = baseline**. Mobile-perf guard: OK.
- Migration: applied twice on a scratch Postgres 16, both exit 0.
- **Not done:** no browser walk (no local Stripe keys / seeded stack in this worktree; never
  entered card data) — the states are proven over the real components and controllers with fakes.
  Needs a Stripe test-mode run (section 4, step 7) and a WebKit / iPhone look at the bar and sheet
  before calling it shipped. Not pushed.
