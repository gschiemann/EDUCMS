# A1 — Brand-new one-user operator first-run journey

**Wave:** A · **Agent:** A1 · **Date:** 2026-06-26
**Surface:** First-run — landing → signup → onboarding/branding wizard (paste URL → scrape → adopt) → dashboard → getting-started guide
**Scale tier:** S1 (single user, single throwaway tenant, zero existing data)
**Target:** LIVE PROD — `https://venue-os.app` / API `https://api-production-39a1.up.railway.app/api/v1`
**Method:** Real-browser Playwright journey through the actual UI (no auth seeding — filled the signup form like a human, rode the wizard, adopted branding). Ran **chromium** + **webkit**. Self-provisioned isolated Retail-vertical throwaway tenants (`a1-acme-<rand>`, `a1+<rand>@venue-os.app`). Greg's Dodgers tenant untouched.

## Verdict

The happy path **works end-to-end on both engines (10/10 steps, 0 failures, 0 5xx)**. A non-IT operator can go landing → branded dashboard in well under 3 minutes and a handful of clicks. The signup form and the branding wizard are genuinely well-built (clean split-screen signup, live dashboard preview that repaints as you scan, palette/logo/font extraction that actually pulls the right brand). This is the strongest first-run I've tested.

The findings are all **polish / vertical-fit**, not blockers. The two that matter: (1) for any non-K12 vertical the scraped marketing copy lands verbatim as the tenant's display-name + tagline with no nudge to fix it, so the operator's own dashboard reads like the scraped company's homepage; (2) the onboarding wizard + the getting-started guide are still hardcoded K-12 ("yourschool.org", school sample URLs, "new K-12 districts", FERPA), shown to Retail/QSR/Sports operators.

## What I did (step by step)

1. Loaded `https://venue-os.app/` (landing) — renders, title "VenueOS — the operating system for every screen you run".
2. Loaded `/signup` — clean, professional split layout; "Free pilot — first 10 screens, no card".
3. Filled the form as a Retail operator: industry = "Retail store or chain", name "Acme … Stores", auto-slug, email (+tag), first/last name, 8+ char password ×2. Form reflavored labels to the vertical ("Store or chain name").
4. Clicked **Create workspace** → auto-logged-in, redirected to `/onboarding/branding`. ✅
5. Onboarding/branding page loaded ("Make it feel like home. Paste your website — we'll do the rest.").
6. Pasted a real site (`starbucks.com` on chromium, `target.com` on webkit) and clicked **Scan**.
7. ~10s later: palette extracted (correct brand green/red), 6 logo candidates found, confidence bars, and a **live dashboard preview** showing the new brand. ✅
8. Clicked **Adopt branding** → redirected to `/<slug>/dashboard?branded=1` with the brand applied. ✅
9. Dashboard reached, branded, with a visible **"Getting started" 3-step card** (Connect a Screen / Upload Content / Build a Playlist). ✅
10. `/guide/getting-started` reachable and renders. ✅

Evidence dir (screenshots + report.json):
`/private/tmp/claude-501/-Users-gschiemann-Desktop-EDU-CMS/4129bcd1-4636-4065-90ea-207bae54cd20/scratchpad/a1/firstrun-chromium-1782503400354/`
(webkit run: same parent dir, `firstrun-webkit-*`). Journey script: `apps/web/scripts/beta/_a1-firstrun-run.mjs`.

## Findings

| # | Sev | Area | What | Repro | Evidence |
|---|-----|------|------|-------|----------|
| A1-1 | P1 | Branding adopt / data quality | After adopting branding from a commercial site, the scraped page `<title>` becomes the tenant **displayName** and the `og:description`/meta-description becomes the **tagline** — verbatim. The operator's own dashboard then reads sidebar="Starbucks Coffee Company", hero="Welcome back to Starbucks Coffee Company", subtitle="Explore our handcrafted drinks, order ahead, sign up for Starbucks® Rewards, manage your gift card…". Their org name "Acme Stores" is silently overwritten. It IS editable (a "Name & tagline" card lower in the wizard), but the marketing-copy default is the surprise and most operators won't scroll/edit. | Sign up (any non-K12 vertical) → paste `starbucks.com` (or `target.com`) → Scan → Adopt → land on dashboard. | `10-dashboard-reached.png` (chromium): "Welcome back to Starbucks Coffee Company / Explore our menu of handcrafted drinks…". webkit reproduced with Target ("Shop Target online and in-…"). Root cause: `apps/api/src/branding/branding-scraper.service.ts:459-469` tagline = `og:description \|\| meta description`. |
| A1-2 | P1 | Onboarding wizard / vertical-fit | The onboarding branding wizard is shown K-12 chrome to **every** vertical: placeholder `https://www.yourschool.org`, "Try an example: Lincoln County (NC) · Harvard · Stanford" (all schools), and copy "…so the CMS looks like yours". The per-vertical example map already exists (`EXAMPLES_BY_VERTICAL` has GYM/RETAIL/etc.) but the onboarding page mounts `<BrandingWizard mode="authed" />` **without the `vertical` prop**, so it falls back to K-12. A Retail/Sports operator on their very first screen sees school URLs. | Sign up as Retail → land on `/onboarding/branding`. | `05-onboarding-branding-load.png`: "yourschool.org", "Lincoln County (NC) / Harvard / Stanford". Source: `apps/web/src/app/onboarding/branding/page.tsx:41` (no `vertical=`), `apps/web/src/components/branding/BrandingWizard.tsx:539` (hardcoded placeholder), `:122-124` + `:193-200` (vertical map exists, unused here). |
| A1-3 | P1 | Onboarding preview / stale brand | The wizard's "Live preview" mock-browser shows the URL **`edusignage.app/your-venue-signage/dashboard`** — the retired legacy domain (product is now `venue-os.app`) — and the preview body is hardcoded K-12 sample chrome ("Hallways / Cafeteria / Auditorium / Gym Entry", "Emergency system green · 23 screens online"). On first impression it signals "this is an old school product" and the wrong domain. | Land on `/onboarding/branding`, look at the Live preview pane. | `05-onboarding-branding-load.png`: address bar reads `edusignage.app/your-venue-signage/dashboard`. |
| A1-4 | P1 | Getting-started guide / vertical-fit | `/guide/getting-started` is entirely K-12: cover says "A printable walkthrough for **new K-12 districts**… go from a fresh login to a **hallway display**"; chapters reference district/FERPA/cafeteria-menu/teacher-of-the-week. A Retail/QSR/Sports operator who opens the guide (or the dashboard "Getting started" card links there) gets school-only instructions. | Open `/guide/getting-started` on any non-K12 tenant. | `11-getting-started-guide.png` (cover: "new K-12 districts"). Source: `apps/web/src/app/guide/getting-started/page.tsx` — hardcoded K-12 copy throughout, e.g. CoverPage line 166, all Chapters. |
| A1-5 | P2 | Auth timing / console noise | On the freshly-authed `/onboarding/branding` load, `GET /branding/me` returns **401 Unauthorized** (console error + "[api] Request failed (non-network) … Unauthorized") before settling. Appears to be a token-attach race right after the auto-login redirect (the page still functions). Not user-visible, but it's a real 401 on an authed user's first request and pollutes telemetry. | Sign up → land on onboarding → check console. | Both runs: `consoleErrors[0..1]` = `401 ()` + `branding/me … Unauthorized`. Self-recovers (adopt + dashboard succeed). |
| A1-6 | P2 | Signup form length / mobile ergonomics | The signup form is long (industry, name, slug, first, last, email, phone, **address autocomplete**, password, confirm) — 10 fields, with only email/name/slug/password/vertical actually required by the API. Phone + address are optional but unmarked-as-skippable visually beyond "(optional)". For the "30-second happy path" standard this is a lot of scrolling, especially on the 390px viewport; the required-vs-optional split could be collapsed (progressive disclosure). | `/signup`, scroll the form. | `03-signup-fill.png` shows the full field stack; API only requires `districtName/adminEmail/password/vertical` (`onboarding.service.ts:111-124`). |
| A1-7 | P2 | Branding scrape resilience | Scraped logo/favicon images are fetched **client-side** for the live preview and get blocked by the source site's CORS (`apple-touch-icon*.png … blocked by CORS`, `ERR_BLOCKED_BY_ORB`). The adopt path re-hosts server-side so the final result is fine, but the preview can show a broken/missing logo tile depending on the site, and it generates a burst of console/network errors. | Scan a CORS-strict site (starbucks.com, target.com). | chromium `netFailures`: 8× `apple-touch-icon*.png — net::ERR_FAILED`; webkit: `Cannot load image …favicon.ico due to access control checks`. |

## What works well (not findings — credit where due)

- **Signup → onboarding → dashboard redirect chain is correct and never dead-ends** (the onboarding page has a working "Skip for now →"). No bounce-to-login, no broken handoff.
- **The branding scrape genuinely works on live commercial sites** — correct palette, multiple logo candidates, font detection, WCAG-contrast enforcement on adopt, live repainting preview. This is the "app almost does the work for them" north-star, delivered.
- **Vertical reflavoring of the signup form copy** ("Store or chain name", "your whole store") is in place and good.
- **Dashboard "Getting started" 3-step card** is present on the fresh tenant — the right next-action nudge.
- **Cross-browser:** WebKit ran the identical journey 10/10 with no WebKit-specific crash (no `removeChild`/`parentNode` class issue on this surface). Rule #1 satisfied for the first-run surface.

## Coverage gaps + why

- **Email deliverability** (welcome email on signup) — NOT verified end-to-end. `signup()` calls `emailService.sendWelcome`, but prod email delivery depends on `RESEND_API_KEY`/`EMAIL_FROM` config (Greg-only). Out of scope for a UI journey; flagged as N-A.
- **Address autocomplete actually geocoding** — not exercised (left address blank; it's optional). Covered by Mobile-bug task #216 already.
- **Adopt → "Apply brand to templates"** — visible only after re-opening the wizard in edit mode (`isEditingAdopted`); the first-run adopt does not surface it, so I confirmed it exists in source but didn't drive it (belongs to a brand/templates agent).
- **Did not test signup validation edge cases** (duplicate slug/email 409, weak password, rate-limit 429) beyond the happy path — those are API-contract tests, partially covered by `onboarding-validation.spec.ts`.

## Grades

- **Design: A−** — signup + wizard look like a real $$$ product; the only blemishes are the stale `edusignage.app` domain in the preview chrome and K-12-flavored sample chrome shown to other verticals.
- **UX: A−** — clear, near-zero-friction happy path that beats the 30-second standard for the core moves; docked for the long signup form and the wizard not nudging the operator to fix the auto-adopted marketing-copy tagline.
- **Functionality: A** — every step works end-to-end on both engines, scrape+adopt+brand-apply all function, no 5xx, no dead ends. The 401/CORS console noise is cosmetic, not functional breakage.
