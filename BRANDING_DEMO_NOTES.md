# Auto-Branding — Demo Notes (Sprint 9)

"Paste your school's URL, we match it" — the single highest-delight
moment in the pilot conversation. This branch ships the full feature:
scraper, palette derivation, live preview, adopt flow, public demo.

## How to try it locally

Both API and web must be running (`pnpm dev`). The feature flag
`AUTO_BRANDING` is on by default in development.

### 1. Public demo — no login needed

```
http://localhost:3000/demo/branding
```

Paste a URL. In ~5-10 seconds the right-hand preview repaints with
that school's logo, palette, and typography. Adoption is disabled
(this pane doesn't know who you are).

### 2. Authed wizard — logs the adoption and repaints the real CMS

```
http://localhost:3000/onboarding/branding    # first-run
http://localhost:3000/<schoolId>/settings/branding   # later
```

After you click "Adopt branding," the wizard fires a `branding:update`
event and `BrandStyleInjector` instantly repaints the dashboard with
the new CSS variables — no reload.

## Curl examples

### Scrape preview (authed)

```bash
curl -X POST http://localhost:8080/api/v1/branding/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -H "X-CSRF-Token: $CSRF" \
  --cookie "csrf-token=$CSRF" \
  -d '{"url":"https://www.lcsnc.org/"}'
```

### Scrape preview (public demo — no auth, rate limited)

```bash
curl -X POST http://localhost:8080/api/v1/branding/demo/scrape \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.lcsnc.org/"}'
```

### Adopt (authed admin)

```bash
# POST the payload returned by /scrape (possibly with user overrides)
# to /adopt:
curl -X POST http://localhost:8080/api/v1/branding/adopt \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -H "X-CSRF-Token: $CSRF" \
  --cookie "csrf-token=$CSRF" \
  -d @preview.json
```

### Read current tenant branding

```bash
curl http://localhost:8080/api/v1/branding/me \
  -H "Authorization: Bearer $JWT"
```

### Derive palette from a single primary (manual picker helper)

```bash
curl -X POST http://localhost:8080/api/v1/branding/derive-palette \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -H "X-CSRF-Token: $CSRF" \
  --cookie "csrf-token=$CSRF" \
  -d '{"primaryHex":"#b22222"}'
```

### Revert to defaults

```bash
curl -X DELETE http://localhost:8080/api/v1/branding/me \
  -H "Authorization: Bearer $JWT" \
  -H "X-CSRF-Token: $CSRF" \
  --cookie "csrf-token=$CSRF"
```

## Example URLs that demo well

Real public school / district sites with rich, well-defined brands:

1. **https://www.lcsnc.org/** — Lincoln County (NC). Strong navy +
   gold, wordmark logo, consistent header.
2. **https://www.schools.nyc.gov/** — NYC DOE. Big blue brand, clear
   og:image, many stylesheets (stress-tests our 30-sheet cap).
3. **https://www.lausd.org/** — LAUSD. Distinctive red/gold, Google
   Fonts in use.

Other good stress-tests:

- **https://www.stanford.edu/** — cardinal red, serif branding, lots
  of heros.
- **https://www.mit.edu/** — tight palette, bold sans-serif.
- A coffee shop / restaurant site to preview the non-K-12 vertical
  (same scraper works for RESTAURANT tenants).

## Feature flag

`AUTO_BRANDING` key (web + OpenFeature compatible).

- **Default in development:** ON (any non-production `NODE_ENV`).
- **Default in production:** OFF.
- **Force on:** set `NEXT_PUBLIC_FF_AUTO_BRANDING=true` in the web env.
- **Force off:** set `NEXT_PUBLIC_FF_AUTO_BRANDING=false`.

`.env.local` sample for web:

```
NEXT_PUBLIC_FF_AUTO_BRANDING=true
```

The feature flag only gates the discoverability (the settings card
and landing-page button); the API endpoints themselves are role-
gated, not flag-gated, so an operator with a direct URL will still
work even if the flag is off. That's intentional — ops use while the
UI is hidden.

## Security model (short form)

- **SSRF-guarded:** `safe-fetch.ts` resolves hostnames, rejects
  private / link-local / loopback IPv4+IPv6 ranges, blocks
  non-http(s) schemes, non-80/443 ports, caps redirects at 3.
- **Byte caps:** 5MB per fetch, 2MB total stylesheet budget, 30
  stylesheets max.
- **Timeouts:** 10s scrape end-to-end, 4s per stylesheet, 6s per
  asset re-host.
- **Rate limits:** 5 scrapes per tenant per hour (in-memory sliding
  window), 50/hour global, plus NestJS throttler on the demo
  endpoint (5/min per IP).
- **Audit logging:** Every scrape (success, fail, or blocked) and
  every adopt / revert writes to `AuditLog` with tenantId, userId,
  URL, outcome, duration, and confidence scores.
- **Rehost, don't hotlink:** Logos, favicons, and og-images are
  downloaded through `safe-fetch` and re-uploaded to our Supabase
  bucket before they're stored in `TenantBranding`.
- **Demo endpoint:** `/api/v1/branding/demo/scrape` is CSRF-exempt
  (no prior session) and unauthenticated, but rides the same
  SSRF guard, rate limiter, and NestJS throttler. It never persists
  and never writes to `AuditLog` under a real tenantId.

## Known limitations (v1)

- **SPA sites** that render their brand through CSS-in-JS runtime
  (Material UI's emotion, Styled-Components) may return sparse
  stylesheet-based colors. The scraper will still pick up OG
  images and og:site_name, but the primary color may be the indigo
  fallback. Playwright-based Tier B is scoped for v2 — the hook
  point (`< 3 ranked colors → escalate`) is already present in the
  scraper's confidence calculation.
- **Sites that block scrapers** with Cloudflare "I'm Under Attack"
  or bot-fighter middleware will return 403/503. The error surfaces
  as `BRANDING_SCRAPE_FAILED` with a friendly message.
- **Icon-only sites** (no wordmark, no `<img>` with "logo" in
  alt/class) leave the logos array small. The UI falls back to a
  colored monogram of the displayName initial.
- **Fonts beyond top-200 Google Fonts** are not auto-imported —
  they fall back to the system stack. The matched family is still
  stored so an admin can upload a self-hosted webfont later.
- **Favicon `.ico` files** are re-hosted as `.ico` and served as
  the Supabase bucket mime type. Some browsers are stricter about
  `image/vnd.microsoft.icon` — we set the extension explicitly and
  it works in Chrome / Firefox / Safari.
- **Rate-limit store** is in-memory per-process. Running more than
  one API instance fragments the per-tenant quota. Redis backing
  is a follow-up; the limiter interface doesn't change.

## File map

**Backend (apps/api/src/branding/):**
- `color-utils.ts` — pure color math (parse, HSL, contrast, derive
  full 9-shade palette from one hex).
- `google-fonts.ts` — top-200 Google Fonts catalog + matcher.
- `safe-fetch.ts` — SSRF-guarded HTTP client.
- `branding-scraper.service.ts` — Tier A static scraper (cheerio +
  postcss + valueParser).
- `branding-rate-limiter.ts` — per-tenant + global sliding window.
- `branding.controller.ts` — scrape / adopt / me / demo / revert /
  derive-palette endpoints.
- `branding.module.ts` — Nest module; registered in `app.module.ts`.

**Frontend (apps/web/src/):**
- `lib/branding.ts` — shared types + SSR fetch helper + CSS-var
  converter.
- `components/branding/BrandStyleInjector.tsx` — client-side
  painter; listens to `branding:update` events.
- `components/branding/BrandingWizard.tsx` — scrape + tweak UX.
- `components/branding/BrandingLivePreview.tsx` — the animated
  mini-admin preview.
- `components/branding/palette-client.ts` — client mirror of the
  server palette derivation (used by the auth-free demo).
- `components/settings/BrandingSettingsCard.tsx` — compact card on
  /settings that links into the wizard.
- `app/demo/branding/page.tsx` — public demo route.
- `app/onboarding/branding/page.tsx` — authed first-run wizard.
- `app/[schoolId]/settings/branding/page.tsx` — authed edit page.

**Schema (packages/database/prisma/schema.prisma):**
- `TenantBranding` model (one-to-one with Tenant, cascade delete).

## Merge-back command

When you're happy with the test:

```bash
# From the repo root, NOT the worktree:
cd "C:\Users\gschi\OneDrive\Desktop\EDU CMS"
git fetch . worktree-agent-a46d3fc1:refs/heads/worktree-agent-a46d3fc1
git checkout master
git merge --no-ff worktree-agent-a46d3fc1 -m "feat(branding): auto-brand CMS from any public URL (Sprint 9)"
# Remove the worktree:
git worktree remove ".claude/worktrees/agent-a46d3fc1"
git branch -d worktree-agent-a46d3fc1
```

`git worktree list` will confirm the branch + path before merging.
