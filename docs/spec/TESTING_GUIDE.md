# Testing Guide — VenueOS Integrations

How to demo every integration end-to-end without registering for vendor sandbox accounts. Use this on a fresh tenant before shipping anything customer-facing.

## TL;DR — 60-second demo

1. Sign in to your tenant.
2. Go to **Settings → Test integrations** (`/<schoolId>/settings/test-integrations`).
3. Click each "Run" button in order. Each loads realistic sample data tagged `[Sample]`.
4. Open the template builder. Drop the **Live Stream** widget on a canvas — pick one of the public-broadcaster channels. It plays.
5. Drop the **Restaurant Menu Board** widget on another canvas — flip `posSync: true` in the properties panel. The 24 sample menu items render live.
6. Done. Hit **Wipe sample data** to reset.

## What each "Run" button does

### Streaming → Public Broadcasters
- Connects the `public-broadcasters` provider (no auth)
- Auto-picks 9 free venue-friendly channels: NHK World, France 24 (EN/FR/ES), DW News, Al Jazeera English, Bloomberg, Sky News, CBS News
- Drop the **Live Stream** widget anywhere → channel picker shows these 9 → embed iframe plays YouTube live streams

### Streaming → Custom HLS (Mux test streams)
- Connects the `custom-hls` provider with Mux's open test bucket
- Adds two HLS test channels (BipBop pattern + test pattern)
- Drop the **Live Stream** widget → picks HLS playback path → hls.js polyfill kicks in on non-Safari browsers

### POS → Restaurant catalog
- Connects a `custom-webhook` POS connection tagged `[Sample] Restaurant menu`
- Seeds 24 menu items across 4 categories (Burgers / Sides / Drinks / Desserts) with real-looking names + prices + descriptions + dietary chips
- Drop the **Restaurant Menu Board** widget → flip `posSync: true` in properties → live items render. Filter by `posCategory: "Burgers"` to show one category only.

### POS → Retail catalog
- Connects another `custom-webhook` POS connection tagged `[Sample] Retail catalog`
- Seeds 18 SKUs across 3 categories (Apparel / Footwear / Accessories)
- 4 of them have `salePriceCents` set so the Price Callout widget can show strike-through pricing

### Ads → House-only
- Connects the `house-only` ad network — no third-party creative, no rev share
- Operator schedules their own ads through the existing StreamAdSlot path

### Reset
- **Wipe sample data** removes only connections tagged `[Sample]`. Production data is left alone.

## Free vs sales-led integration paths

### Free / self-serve sandbox (use today)

| Provider | Where to start |
|---|---|
| Square POS | https://developer.squareup.com — free sandbox merchant + Catalog API access |
| Stripe (billing + Terminal) | https://dashboard.stripe.com/test — free test mode forever, real card numbers rejected, test cards work |
| Clover POS | https://docs.clover.com/dev — free dev account, sandbox merchant id + token immediately |
| Lightspeed Retail | https://developers.lightspeedhq.com/retail — free sandbox; apply for OAuth client |
| Shopify POS / Admin | https://shopify.dev/docs/apps — free Partner account + dev store |
| YouTube embed | https://developers.google.com/youtube/iframe_api_reference — no account needed for public videos |
| Twitch embed | https://dev.twitch.tv/docs/embed — free dev account |
| Public broadcasters | https://www3.nhk.or.jp/nhkworld/en/live — explicitly invite venue rebroadcast, zero auth |
| Mux test HLS | https://test-streams.mux.dev — open test stream bucket |

### Sales-led (need partner conversation)

| Provider | Why |
|---|---|
| Toast POS | Toast Partner Program — application + commercial-grade vetting |
| MINDBODY (ABC Fitness) | Partner program — application required |
| Hivestack / Vistar / Place Exchange / Broadsign | Programmatic DOOH SSPs — sales-led publisher contracts |
| Atmosphere TV | Direct outreach to atmosphere.tv/partners |
| DIRECTV Business / DISH Business | Venue subscription required, not API-driven |

## Credit card workflow — testing

### What works today
- Settings → Plans & billing → click any paid tier → full Stripe Elements–style checkout form opens
- Card validation (Luhn check, expiry format, CVC, ZIP, billing email)
- Two-step flow: card details → review summary → submit
- Submit calls `POST /api/v1/billing/checkout` which:
  - **If `STRIPE_SECRET_KEY` is set:** redirects to Stripe Checkout (real charge happens there)
  - **If unset (current default):** returns a 501 + the friendly success state in the modal that explains the card was NOT charged and we'll process the subscription as soon as Stripe goes live

### What needs Stripe activation
- Real charge processing — requires creating Stripe Products + Prices for `MONTHLY` ($15/screen/mo) and `ANNUAL` ($150/screen/yr), pasting Price IDs into `LICENSE_TIERS`, and setting `STRIPE_SECRET_KEY` in API env
- Webhook handler that flips `License.status` based on `customer.subscription.*` events
- Customer Portal entry point for cancel / payment-method update

### Test cards (when Stripe goes live)
Stripe publishes test card numbers at https://docs.stripe.com/testing#cards — `4242 4242 4242 4242` (success), `4000 0000 0000 0002` (decline), etc. All work on any expiry MM/YY in the future + any CVC.

## Smoke-test checklist

Run before every prod deploy.

- [ ] Sign in → Settings → Test integrations → click each Run button → all green
- [ ] Builder → drop **Live Stream** widget → pick a public-broadcaster channel → it plays in preview
- [ ] Builder → drop **Restaurant Menu Board** widget → enable posSync → real items appear
- [ ] Settings → Plans & billing → click a paid tier → checkout modal opens, all fields validate, two-step flow works, submit shows the friendly "card not charged yet" state
- [ ] Settings → Streaming → existing connections list, channel picker works
- [ ] Settings → POS → existing connections list, sync button works
- [ ] Settings → Monetize → earnings dashboard renders (zeros are fine)
- [ ] `Settings → Test integrations → Wipe sample data` clears everything tagged `[Sample]` — production data untouched

## Pricing summary

| Tier | Price | Notes |
|---|---|---|
| **Free trial** | Free | 14 days, up to 3 screens, no card required |
| **Monthly** | $15 / screen / month | Cancel anytime |
| **Annual** | $150 / screen / year | Save 17% vs monthly |

Per-screen metering. The number of paired screens determines your bill — add or remove screens any time. Same features across all three tiers; only price + cadence differ.

Internal tiers (`COMP`, `CUSTOM`) are admin-only and never shown in the public picker.
