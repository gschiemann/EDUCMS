# Launch Config Checklist — the only-Greg items (~30 min total)

Day 1 deliverable, 2026-07-01. Everything below needs YOUR accounts/cards —
I can't do these for you (and per security rules, shouldn't). Do them any
time before Day 4; nothing blocks Days 1–3. Check each off and I verify
end-to-end on my side the same day.

## 1. Rotate the four boot secrets (~5 min) — Railway → API service → Variables
Generate each fresh value locally (run 4×):
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Replace: `JWT_SECRET`, `SESSION_SECRET`, `DEVICE_SECRET_KEY`, `DEVICE_JWT_SECRET`.
Then redeploy the API. NOTE: this logs every operator out once (expected)
and paired screens re-auth automatically via the repair path. Do it at a
quiet hour.

## 2. Stripe live billing (~10 min) — dashboard.stripe.com
1. Create two recurring Prices: **$15 / screen / month** and **$150 / screen / year**.
2. Developers → API keys → copy the LIVE secret key.
3. Developers → Webhooks → Add endpoint:
   `https://api-production-39a1.up.railway.app/api/v1/billing/webhook`
   subscribed to `checkout.session.completed`, `customer.subscription.*`,
   `invoice.payment_failed` → copy its signing secret.
4. Set in Railway: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`,
   `STRIPE_PRICE_ANNUAL`, `STRIPE_WEBHOOK_SECRET`.
(Test-mode first if you prefer — same steps with test keys; I'll run the
test-card flow either way.)

## 3. Email that actually delivers (~5 min) — resend.com dashboard
Verify a sending domain (e.g. `venue-os.app`): Domains → Add → add the DNS
records it shows (SPF/DKIM) wherever your DNS lives → wait for green.
Then set in Railway: `EMAIL_FROM=VenueOS <noreply@venue-os.app>`.
WITHOUT this, Resend silently drops mail to anyone but you — invites,
password resets, bug notifications all die.

## 4. Platform AI key (~2 min)
Set `ANTHROPIC_API_KEY` in Railway (a real funded key). This powers ONLY the
Tier-1 Concierge (setup-time, hard-capped) — customer creative AI stays BYOK.

## 5. Pilot seat limit (~1 min)
Set `PILOT_SEAT_LIMIT` in Railway to whatever the pilot contract says.

## 6. OPTIONAL for launch week — Google OAuth (~10 min) — console.cloud.google.com
Only if you want "Connect Google" (private Slides/Sheets/Calendar) in launch:
APIs & Services → OAuth consent screen (External, app name VenueOS) →
Credentials → Create OAuth client ID (Web application) → authorized redirect
URI: `https://api-production-39a1.up.railway.app/api/v1/integrations/google/callback`
→ send me the Client ID + Client Secret (set as `GOOGLE_OAUTH_CLIENT_ID` /
`GOOGLE_OAUTH_CLIENT_SECRET` in Railway). I build + test the same day (#259).

## 7. DECISION #273 (~1 sentence from you)
What happens to a cancelled tenant's screens? My recommendation: 30-day
grace → polite "subscription ended" board (never blank), emergency alerts
work forever. Say "yes 30" or give me your number and I'll build it Day 4.

— When each lands, tell me; I verify (webhook test event, live email send,
Concierge call, OAuth round-trip) before checking it off.
