# Catalog, Business, Integration, and Product-Truth Audit Checkpoint

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

## P0 — establish one product-truth contract

Public pricing is incompatible with itself and the running entitlement model:

- Public pricing is $25/$20 monthly and $250/$200 annually at `apps/web/src/app/pricing/page.tsx:8-17`, `:31-46`, `:62-79`; the homepage repeats it at `apps/web/src/app/page.tsx:463-467`.
- Shared billing catalog is $15/month and $150/year, 14 days/3 screens at `packages/api-types/src/billing.ts:24-27`, `:61-104`.
- A tenant with no license receives a 1,000-screen, perpetual ACTIVE pilot at `apps/api/src/license/license.service.ts:23-56`; “activate trial” explicitly commits nothing at `apps/api/src/billing/billing.controller.ts:129-160`.
- Signup promises “first 10 screens” at `apps/web/src/app/signup/page.tsx:265`; help promises per-building billing and a 30-day pilot at `apps/web/src/content/help/billing.md:10-23`; the roadmap proposes ≤5 screens/90 days at `docs/roadmap/ROADMAP.md:765-768`.

### Required implementation

Create a server-owned `PlanCatalog` and entitlement state machine (`TRIALING → ACTIVE → PAST_DUE → GRACE → CANCELLED`) with `startsAt`, `trialEndsAt`, `seatLimit`, cadence, Stripe price IDs, PO eligibility, and feature policy. Public pages, signup, billing UI, and API must consume the same serialized catalog. Make the 1,000-seat internal pilot an explicit expiring tenant override, never the no-row default.

Before deny-by-default, inventory every tenant and deterministically backfill the intended entitlement/override. Run shadow-mode parity against current effective seats/features, reconcile 100% of active tenants with accountable product/support sign-off, then enforce in feature-flagged cohorts. Provide an audited time-limited support break-glass override, migration abort thresholds, and a tested rollback that restores the prior decision path without losing new entitlement data.

**Acceptance:** a contract test renders identical price/trial/seat values in `/pricing`, `/signup`, `/license/tiers`, billing tiles, and Checkout line items; Stripe Test Clock proves trial expiry/dunning. Only after deterministic backfill, shadow-mode parity, 100% active-tenant reconciliation, staged cohort enforcement, and successful break-glass/rollback drills may a missing entitlement row deny production access.

## §8 — POS and commerce

### Working

Square, Clover, Lightspeed X-Series, and Shopify connectors are registered at `apps/api/src/pos/providers/registry.ts:63-105`; Square signed webhook and custom-webhook ingestion exist at `apps/api/src/pos/pos-oauth.controller.ts:271-403`, `:406-500`; hourly sync covers registered connectors at `apps/api/src/pos/pos-sync.cron.ts:55-73`.

### Open gaps

- Toast, Stripe Catalog, and Mindbody are partner/unbuilt at `packages/api-types/src/pos.ts:109-123`, `:221-255`; Aloha is manual/closed at `:152-169`. Settings nevertheless says all auto-update at `apps/web/src/app/[schoolId]/settings/page.tsx:293-295`.
- Shopify claims `realtimeUpdates:true` while its own comment says its webhook is not wired and the REST API is legacy at `packages/api-types/src/pos.ts:195-217`.
- Every QSR/bar/menu URL is forced live even when the operator selects Static: `apps/web/src/components/widgets/WidgetRenderer.tsx:3888-3892`. The saved `posProvider` is ignored because `usePosMenuItems` accepts no provider/connection at `apps/web/src/lib/menu/use-pos-menu-items.ts:49-98`.
- The provider picker enables unconnected partner choices at `apps/web/src/components/template-builder/PropertiesPanel.tsx:6919-6951`.
- BYO binding writes `{{pos.item:…}}` tokens at `PropertiesPanel.tsx:7372-7413`, but no runtime resolver exists.
- Packaged boards using `data-source="opera-pms|epic|gsuite|kds|opentable|mindbody|loyalty|ats|reviews|kiosk-api"` are decorative; runtime only injects POS menus.

### Required implementation

Add `IntegrationBinding(templateId, zoneId, providerConnectionId, capability, fieldMap, fallbackMode, lastVerifiedAt)`. Runtime must resolve the selected connection, honor OFF, and expose freshness/error state. Disable non-DIRECT or unconnected choices. Implement Shopify GraphQL plus provider webhooks, durable cursor jobs, inventory/low-stock, and daypart/promo rules. Label every unsupported board “Sample data,” never “Live.”

**Acceptance:** sandbox contract suite for each DIRECT provider; selecting Static produces zero POS requests; two simultaneous POS connections return the selected feed; exact external-ID binding updates price/name/availability; webhook-to-screen SLA and stale-feed fallback are measured.

## §9 — communications

### Working

Resend email is real and fails honestly when unconfigured at `apps/api/src/email/email.service.ts:356-440`. Signed, SSRF-pinned, durable emergency webhooks with retries exist at `apps/api/src/webhooks/webhook-dispatch.service.ts:29-52`, `:87-247` and `apps/api/src/webhooks/webhook-retry.worker.ts:137-307`.

### Open gaps

Only `emergency.triggered` and `emergency.cleared` are allowed at `apps/api/src/webhooks/webhooks.service.ts:13-33`. Twilio, SendGrid, APNs/FCM, Slack, Teams, and PagerDuty/OpsGenie are N/A. Settings incorrectly says webhooks are “coming next release” at `apps/web/src/app/[schoolId]/settings/page.tsx:375-392`.

### Required implementation

Introduce `NotificationEndpoint`, `NotificationPolicy`, `EscalationStep`, and `DeliveryAttempt`, plus adapters with consent, quiet hours, recipient/audience rules, idempotency, DLQ, test mode, and delivery timeline. Expand the webhook event taxonomy only when producers and tests exist.

**Acceptance:** a simulated incident fans out differentiated screen/email/SMS/push/webhook payloads; retries survive process death; UI shows delivered/failed/dead-letter; unsupported channels cannot be enabled.

## §10 — authentication and identity

### Working

Argon2id, durable JWT revocation, sessions, and full TOTP/backup-code MFA exist: `apps/api/src/users/users.controller.ts:203-204`; `apps/api/src/realtime/redis.service.ts:227-395`; `apps/api/src/main.ts:164`; `apps/api/src/auth/mfa.controller.ts:116-568`.

### Open gaps

- SAML is intentionally unavailable because the library was removed; every request ends in an honest 503 at `apps/api/src/sso/sso.service.ts:9-19`, `:244-293`. Help says “fully supported” at `apps/web/src/content/help/sso.md:40-57`.
- OIDC is generic and real, but public “Google, Microsoft & SSO out of the box” copy at `apps/web/src/app/page.tsx:368-372` implies preconfigured social buttons.
- WebAuthn/passkeys are absent.
- Clever fetches only the first page of users (`limit=1000`) at `apps/api/src/integrations/clever/clever-http.client.ts:81-85` and runs nightly at `clever-sync.cron.ts:5-12`; help falsely claims schools, sections, bell schedules, terms, and delta webhooks at `apps/web/src/content/help/clever.md:10-39`.

### Required implementation

Either ship maintained SAML with signed AuthnRequest/assertion, metadata/certificate rotation, and real IdP E2E tests, or remove it everywhere. Add WebAuthn. Paginate Clever and model each claimed resource before restoring help copy.

**Acceptance:** real Google/Entra/Okta test tenants; logout/role/panic-capability revocation across HTTP/WS/SSE; SAML wrapping/replay tests; Clever >1,000-user reconciliation and deletion tests.

## §11 — billing

Stripe Checkout, Portal, invoices, event ledger/order guards/audit, and daily quantity reconciliation are substantive: `packages/database/prisma/schema.prisma:551-601`; `apps/api/src/billing/license-reconcile.cron.ts:5-54`. PCI scope is SAQ-A; comp seats exist.

Beyond the product-truth repair, add a customer-visible dunning/grace timeline, a real PO workflow or remove PO claims, and a refund/credit-note policy and API. Help currently invents PO entry, cancellation, 90-day grace, deletion, and refunds at `apps/web/src/content/help/billing.md:25-55`.

**Acceptance:** duplicate/out-of-order webhook suite; pair/unpair quantity reconciliation; failed-payment banner/email/grace enforcement; PO approval audit; refund/credit-note reconciliation.

## §12 — design imports

PPTX/PDF/image parsing exists, with slide/zone and decompression caps.

### Open defects

- Legacy `.ppt` is accepted as PPTX at `apps/api/src/imports/imports.controller.ts:80-109`; binary PPT cannot be parsed and falls through to an IMAGE zone.
- A raw playlist asset is always created first at `apps/api/src/imports/imports.controller.ts:266-314`; a PPTX “Add to Playlist” item is therefore unplayable.
- PDF only extracts text, not page graphics, at `apps/api/src/imports/imports.controller.ts:369-383`, while UI promises fully editable text/images and image fallback at `apps/web/src/app/[schoolId]/templates/imports/page.tsx:184-188`, `:328-332`, `:429-432`.
- Canva, Drive/Slides, Graph, and Figma are N/A. Keynote is export-only.

### Required implementation

Reject `.ppt` or convert it through isolated LibreOffice. Make import an asynchronous `ImportJob` with preview, fidelity warnings, virus scan, and atomic commit. Rasterize each page for faithful fallback, then overlay extracted editable elements. Add source-link/re-sync only after OAuth adapters exist.

**Acceptance:** golden decks covering masters, groups, tables, charts, fonts, transparency, and multi-page PDF; screenshot-diff threshold; no raw PPT/PPTX playlist item; parse failure creates a renderable page image with an explicit warning.

## §13 — public alerts

CAP, IPAWS, Raptor, RapidSOS, and PA/IP-speaker integrations are all **N/A—not built**. The EULA correctly disclaims them at `apps/web/src/app/terms/eula/page.tsx:100-115`.

Recommended build order: canonical CAP-1.2-compatible `IncidentEvent`; signed inbound CAP parser with geofence/dedupe/expiry; IPAWS test-feed consumption; Raptor/RapidSOS partner adapter; PA bridge last. Outbound IPAWS remains prohibited unless FEMA-authorized.

**Acceptance:** FEMA sample corpus, invalid-signature/replay/geofence tests, partner sandbox drill, and immutable transition audit.

## §14 — multi-vertical

All 12 vertical labels, alert defaults, and sample URLs exist at `packages/api-types/src/verticals.ts:40-194`, `:351-364`; AI voices cover all at `apps/api/src/ai/ai.service.ts:217-243`.

### Open gaps

- `DistrictSchoolsCard` contains vertical copy but deliberately ignores it and always returns Location/Primary at `apps/web/src/components/settings/DistrictSchoolsCard.tsx:106-190`.
- Sample seeding skips everything if either POS or streaming already exists at `apps/api/src/sample-data/sample-data.service.ts:65-100`; partial failures never self-heal.
- Veterinary/real-estate/museum are provisionally mapped to other verticals at `apps/api/src/templates/ensure-system-presets.ts:105-132`.
- Bulk brand apply is destructive and creates no template-version rollback: `apps/api/src/branding/branding.controller.ts:704-865`.

### Required implementation

Decide on universal nouns or enforce the canonical vertical nouns; delete the contradictory dead map. Seed each capability idempotently through durable jobs. Add per-widget brand bindings, contrast validation, dry-run visual diff, and batch rollback.

## §19 — catalog and editability

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

### Required implementation

Create a versioned release manifest with `DRAFT/QA/APPROVED/PUBLISHED/QUARANTINED`, rights/license owner, approver, screenshot hash, supported integrations, offline asset manifest, and minimum editability score. Replace boot mutation with an explicit reconcile migration. Add atomic `PUT /templates/:id/design` and clone endpoints covering metadata, zones, scenes, revision, and snapshot in one transaction.

**Acceptance:** every published template has rights approval, poster, Chromium/WebKit landscape/portrait screenshots, zero overflow/placeholders/console errors, offline screenshot parity, ≥B editability, and every declared “live” capability backed by an adapter test.

## Public-help cleanup and §21 verification discipline

Help is not trustworthy enough to publish:

- Asset limits/SVG/trash/export claims conflict with code: `apps/web/src/content/help/assets.md:10-57` versus `apps/api/src/assets/assets.controller.ts:71-127`, `:1181-1264`.
- Getting Started says 17 templates and SCHOOL_ADMIN signup at `apps/web/src/content/help/getting-started.md:14-35`, while signup creates DISTRICT_ADMIN.
- Invite help invents bulk invite/disable and broad delete access at `apps/web/src/content/help/invite-users.md:22-58`.
- Emergency help says each player verifies the signature, but the client only checks signature presence at `apps/web/src/app/player/page.tsx:4293-4305`, `:4332-4341`; full verification is server-side at `apps/api/src/realtime/redis.service.ts:182-203`.

Create a claim registry with owner, evidence link, capability status, and review date; CI must reject public claims not backed by a registered capability/test.

**Verification limitation:** these are code/database findings. No fix should be called shipped until CI is green and provider sandbox plus Chromium/WebKit/offline screenshots satisfy Standard Audit Surface §21.
