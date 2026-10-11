# Legal pages for every customer type + public API docs (2026-10-11)

Branch: `worktree-agent-a390cc4eec7aca063` (on `6dcd104d`). Nothing pushed, production untouched.

| commit | job |
|---|---|
| `c07fae4f` | Job 1: Terms, Privacy, new DPA, FERPA, COPPA, EULA fixes |
| `3c18eeac` | Job 2: public REST API + webhooks reference, Developer docs card |

> **Attorney review is required before launch.** These were written by an AI, not a lawyer.
> The wording is standard and conservative, with no certifications claimed (no SOC 2, ISO or
> FedRAMP), but a few sentences are real commitments that counsel should approve on purpose (see §4).
> The pages still show the existing "boilerplate, not legal advice" banner (`LegalPage.tsx`).
> Remove it only after review.

## 1. Placeholders to fill in (one file)

`apps/web/src/lib/legal-entity.ts` holds everything the documents say about the company:

| constant | value now | used by |
|---|---|---|
| `LEGAL_ENTITY.companyLegalName` | `[COMPANY LEGAL NAME]` | /terms, /privacy, /dpa, /terms/eula ("Licensor") |
| `LEGAL_ENTITY.mailingAddress` | `[MAILING ADDRESS]` | /terms, /privacy, /dpa |
| `LEGAL_CONTACTS.legal` | `legal@venue-os.app` | /terms, EULA |
| `LEGAL_CONTACTS.privacy / security / support` | `privacy@` / `security@` / `support@venue-os.app` | all pages |
| `LEGAL_LAST_UPDATED` | `October 11, 2026` | all five pages |
| `SUBPROCESSORS` | 12 entries | DPA Annex B |

**About legal@:** MX for venue-os.app is Forward Email, and its routing rule is an encrypted TXT
record, so I could not read it from DNS. The only aliases confirmed as forwarding (memory,
2026-10-10) are support@, security@ and privacy@. **Treat legal@ as not existing.** Before launch,
either add the alias in Forward Email or point `LEGAL_CONTACTS.legal` somewhere else. Retired from
the legal pages because they were never set up: `dsr@`, `ferpa@`, `coppa@`, `contracts@` and the
EULA's `legal@educms.example`. The help article `billing.md` still uses **billing@venue-os.app**,
which is not confirmed either. I left it unchanged because it is out of scope, but it needs the
same check.

## 2. What changed (Job 1)

- **/terms** has been rewritten around "Customer" (any organization, every vertical named),
  "Authorized Users", "Customer Content" and "Customer Data":
  - **Pricing** is stated as $25/Screen/month or $240/Screen/year ($20/month).
  - **Purchase orders, invoicing, volume pricing and custom terms** are Enterprise plans. The
    phantom "District plan" is gone.
  - **Trial, billing and non-payment** match the billing code: view-only, screens keep playing, and
    emergency alerts stay available (`trial-policy.ts`, `billing-gate.interceptor.ts`).
  - **Uptime:** the hard "99.9%" is replaced by "specific uptime commitments only in an Enterprise
    agreement".
  - **Section 9, Educational institutions**, holds the obligations that apply only to schools:
    - FERPA school official (34 CFR §99.31(a)(1)(i)(B)) and COPPA school consent.
    - Student names and photos on public sports screens are hidden by default until an admin
      attests. This matches `StudentPrivacySettingsCard` and the 2026-09-27 rule.
    - The student-data commitments.
    - A public-entity carve-out for indemnity and governing law.
- **/privacy** has been rewritten for all customers:
  - Processor role, the categories of data collected and an AI-features section. Customer content
    is never used to train models. A customer's own BYOK key is that customer's own provider.
  - Sub-processors link to DPA Annex B.
  - Personnel access requires customer-approved support access, with break-glass that is notified
    and audited. This matches the support-access work that just landed.
  - Retention follows the code (§5 below), with a short student-data section.
- **/dpa (new)** is one DPA for schools and businesses:
  - Roles, instructions, confidentiality and personnel, security measures, sub-processors with 30
    days' notice and a right to object, assistance, 72-hour incident notice, return and deletion,
    and audits by questionnaire.
  - §10 covers educational institutions: FERPA, COPPA, directory default-deny and state DPAs.
  - Annex A describes the processing. Annex B is a table rendered from `SUBPROCESSORS`.
  - Added to `CSP_UNNONCEABLE_PREFIXES` because it is a prerendered public page, and linked from
    the footer and the signup footer.
- **/ferpa and /coppa** keep their school framing:
  - They add the directory-information default-deny and the customer-approved personnel access.
  - All contacts now go to privacy@.
  - The unverified "AES-256" claim and the "regular third-party vulnerability scans" claim are
    removed.
- **/terms/eula** has had only these fixes: "EDU CMS" becomes the product name, the Licensor
  becomes `companyLegalName`, and the contact becomes `LEGAL_CONTACTS.legal`. No disclaimer or
  liability text was touched, per the file's own "do not soften" header. `EULA_VERSION` was not
  bumped, so nobody is forced to re-accept.
- `LegalPage.tsx` banner: "your own district or company's" counsel now reads "your own
  organization's" counsel.
- Test: `apps/web/src/lib/__tests__/legal-pages.test.tsx` renders all five pages. It pins:
  - no District plan, no retired addresses and no certification claims;
  - every-vertical wording, the pricing and Enterprise POs;
  - placeholders read from the constant;
  - every sub-processor rendered;
  - `/dpa` outside the enforced CSP.

## 3. Sub-processors, with evidence

| Provider | Evidence in code/env | Listed as |
|---|---|---|
| Supabase (AWS us-east) | `DATABASE_URL`, `SUPABASE_URL`, storage buckets; the 2026-10-05 security overview gives the region | Always |
| Railway (US West) | `railway.json`, `scripts/railway-start.sh`; Redis also runs here (`REDIS_URL`, security overview) | Always |
| Vercel | web hosting, `apps/web/vercel.json` | Always |
| GitHub | `.github/workflows/db-backup.yml`: nightly **encrypted** dump kept 30 days as an Actions artifact | Always (encrypted backups only) |
| Resend | `RESEND_API_KEY`, `EmailService` | Always |
| Sentry | `apps/api/src/sentry.ts`, `apps/web/sentry.*.config.ts` (PII redaction, replays off) | Always |
| Stripe | `apps/api/src/billing/stripe.service.ts` | When paying by card |
| OpenAI, Google Gemini, Anthropic | `ai-platform-keys.ts` (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`) | Only with VenueOS-provided AI |
| Google Maps Platform | `GOOGLE_MAPS_API_KEY`, `/geocode` proxy; Places API (New) for the Google Reviews app | When an address is looked up or Reviews is used |
| OpenStreetMap Nominatim | `geocoding.service.ts:150,307`, `screens.controller.ts:4127` | Only as the fallback for address lookup |
| Pexels | `ai/stock-image.service.ts` (search words only) | Only for AI board stock photos |
| Meta (Instagram/Facebook) | `INSTAGRAM_APP_*`, `META_APP_*`, `integrations/social/meta-http.ts` | Only when the customer connects an account |

Deliberately **not** listed:
- **Twilio and SendGrid:** no send code exists (`integrations-health.controller.ts:711`).
- **GrowthBook:** it is only "configured if env set", and flags carry no customer data. Verify
  whether production has `GROWTHBOOK_*` set before adding it.
- **Redis Labs and Upstash** (the old privacy page named them): Redis is on Railway.
- **Clever, Microsoft and the customer's SSO, POS, streaming and calendar providers:** these are
  the customer's own providers, and the DPA §5 says so.
- **Open-Meteo:** the screen's browser fetches weather from it directly. It is a content source,
  not a processor.

## 4. Commitments counsel should approve on purpose

- **72-hour** incident notice (DPA §7, FERPA). The old FERPA page already had it.
- **30 days' notice** of a new sub-processor, plus a right to object with a **refund of prepaid
  fees** (DPA §5).
- **At least 90 days** of export after termination, then deletion. Backups expire in 30 days.
  Note that automatic post-termination deletion is not built: `PLATFORM_ASSET_WIPE_ENABLED` is off
  by default, so deletion today is manual or on request.
- "Emergency alert features remain available while an account is view-only." This matches
  `billing-gate.interceptor.ts`, which exempts `/emergency`.
- **Governing law conflict:**
  - **/terms:** the Customer's state, unless a signed agreement says otherwise. This was kept from
    the old page and suits public schools.
  - **EULA:** **Delaware law plus AAA arbitration plus a class waiver**.
  - Counsel must pick one; I did not touch the EULA's clause.

## 5. Retention statements, with code

- **Playback (proof-of-play):** raw records are kept 14 days (`DEFAULT_RAW_RETENTION_DAYS`) and
  hourly totals 400 days (`DEFAULT_ROLLUP_RETENTION_DAYS`) in
  `analytics/proof-of-play-rollup.service.ts`. The pages say "about 14 days / about 13 months".
- **Audit logs:** immutable, enforced by DB triggers in migrations `20260531000000_audit_logs_immutable`,
  `20260609000000_dedupe_audit_immutability_triggers` and `20260717120000_audit_logs_block_truncate`.
  The pages say "life of the account, cannot be edited or deleted through the Service". The old
  "minimum three years" claim was replaced.
- **Backups:** nightly, encrypted, kept 30 days (`db-backup.yml`).
- **No purge found for request logs**, so the pages make no specific claim about them.

## 6. API surface documented (Job 2)

**Competitors, briefly:**
- **Yodeck:** REST API at `app.yodeck.com/api/v1` for Premium/Enterprise. Tokens are tied to a
  role and shown once.
- **OptiSigns:** a GraphQL API with Bearer keys, permissions set at creation, and SDKs.
- **ScreenCloud:** a GraphQL API whose token comes from the Studio DEVELOPER tab.
- None of the three clearly documents webhooks.

Our model (a role-bound key, shown once, Bearer auth) matches theirs. Signed webhooks are a plus.

**Page:** `apps/web/src/content/help/api-and-webhooks.md` is served at `/help/api-and-webhooks`,
under the Integrations category in the help center. It is linked from:
- Settings → Developer & audit, where the old "Documentation (coming soon)" card is replaced with
  i18n keys `settings.cc.developer.apiDocsTitle/apiDocsBlurb` in en, es and zh;
- the marketing footer, under Resources.

There is no OpenAPI generator in the repo, so the page is hand-written.

**Auth model:**
- Keys look like `vos_` followed by 32 hex characters and are sent as `Authorization: Bearer`
  (`jwt-auth.guard.ts:187`).
- Only a Super Admin (DISTRICT_ADMIN) can create keys.
- A key has a role (Super Admin, Admin, Editor or Viewer), default 90 days of life with a
  365-day maximum, and the 9 scopes from `api-key-scopes.ts`. `null` scopes means unrestricted.
- Scoped keys are default-deny for any path that is not mapped.
- `/api/v1/emergency*` is refused for every key (`API_KEY_DENIED_PATH_PREFIXES`).
- Mutations are audited with `apiKeyId`.

**Rate limit:** 600 requests per minute per client IP (`app.module.ts` ThrottlerModule), lower on
some routes, with a 429 when exceeded.

**Endpoints documented.** Each was checked to work with `req.user.id = null`, the right role and
the right scope:

| Endpoint | Scope | Role | Notes |
|---|---|---|---|
| `GET /screens` | `screens:read` | Editor+ | |
| `GET /playlists`, `GET /playlists/{id}` | `content:read` | | |
| `POST /playlists` | `content:write` | | `createdByUserId` is nullable |
| `PUT /playlists/{id}/items` | `content:write` | | `PlaylistReorderItemsSchema`; an Editor key on a live playlist hits the approval gate, and the docs say so |
| `GET /assets` (`take`, `skip`, `q`) | `content:read` | | |
| `GET /schedules` | `content:read` | | |
| `GET /stats/overview` | `analytics:read` | Admin+ | |
| `GET /audit`, `GET /audit/export` | `analytics:read` | Admin+ | |

**Webhooks:**
- Only `emergency.triggered` is delivered, for tenant-scope alerts, once per affected tenant.
- Headers: `X-VenueOS-Event`, `-Delivery-Id`, `-Timestamp`, `-Signature: sha256=HMAC(secret, "${ts}.${body}")`.
- Body: `{tenantId, event, timestamp, data}`.
- Delivery: 8-second timeout, retries after 5 s, 30 s and 2 min (4 attempts). Retries have the
  same body and signature but a new Delivery-Id.
- The page includes verification examples in Node and Python.

**Test:** `help-content.test.ts` now pins the scopes, the auth header, the expiry, the signature
recipe, the emergency refusal and the emergency.cleared caveat.

## 7. Gaps found (not fixed; each needs its own change)

1. **`emergency.cleared` is offered but never sent.**
   - It is in `WebhooksService.ALLOWED_EVENTS` and in the dashboard's event picker, but nothing
     calls `dispatch(..., 'emergency.cleared')`; the only dispatch is
     `emergency.controller.ts:1464`.
   - A customer who subscribes waits forever. The docs say "not delivered yet".
   - The fix touches the emergency controller, so it needs the emergency-review sign-off from
     CLAUDE.md.
2. **API keys cannot create assets.**
   - `POST /assets/url`, `/assets/upload` and `/assets/complete-upload` write
     `uploadedByUserId: req.user.id`, which is null for a key.
   - `Asset.uploadedByUserId` is a required column (`String`, not `String?`), so the call fails
     with a 500.
   - The docs say "uploading new media is not available to API keys yet".
3. **Possibly the same null-user problem elsewhere.** Other write routes may write
   `req.user.id` into required columns; I did not sweep them all. The docs list only the verified
   routes.
4. **The `billing@venue-os.app` alias is unconfirmed**, as is legal@ (§1).

## 8. Verification

- `apps/web`: `npx tsc --noEmit` passes clean. It was run unfiltered after `pnpm install` and
  building `packages/{api-types,scoreboard-cts,signage-design}`.
- Jest:
  - `legal-pages.test.tsx`: 10 tests pass.
  - `csp-script-policy.test.ts`: passes.
  - `content/help` suite: passes, with the new API test.
  - `settings-command-center-pages.test.tsx`: 7 tests pass.
- `node apps/web/tools/check-i18n-parity.cjs`: OK (4,327 keys).
- `pnpm --filter web lint`: 42 jsx-a11y errors, equal to the `.a11y-baseline` of 42. My files add
  no new lint errors; the developer page's pre-existing `any`s are unchanged.
- `check-mobile-perf.cjs`: clean.
- I ran `next dev` locally and checked in WebKit (Playwright):
  - `/terms`, `/privacy`, `/dpa`, `/ferpa`, `/coppa`, `/terms/eula`, `/help` and
    `/help/api-and-webhooks` all return 200.
  - At 1325 px and 390 px there is no horizontal page overflow and no page errors.
  - The DPA table and the code blocks render, and code blocks scroll inside their box.
- **Not run:** `next build` (the CSP prerender check, `check-csp-prerender.cjs`).
  - `/dpa` is in the prefix list, so it should pass.
  - CI's web-build job will confirm.
