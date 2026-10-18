# Customer business domain implementation

Worktree: `business-customer-api`, branch `codex/business-customer-api`. No production writes, pushes or main-checkout changes.

## Contracts

All owner routes below use the existing `SUPER_ADMIN` class guard and `/api/v1/super/customers` prefix.

- Customer creation accepts optional logoUrl (HTTPS, without credentials), saved with initial branding and CUSTOMER_CREATED audit. Existing create/license patch accept `packageName`, `packagePriceCents` (fixed MONTHLY-equivalent contract total; null means per-screen monthly price × contracted seatLimit), `pooledSeats` (explicit opt-in, default false).
- GET `/invoices` before `/:id`, query q/status/page/pageSize, returns rows with customerId/customerName and invoice view, total/page/pageSize/pages.
- PATCH `/:id/branding`: displayName,primaryColor,accentColor,logoUrl. Uses existing support consent.
- POST `/:id/invites`: email, firstName?,lastName?,tenantId?. Uses existing OnboardingService invite and support consent, with existing delivery/fallback response.
- POST `/:id/starter-link/email`: email. Reuses the existing starter-link gate/token lifecycle, mails its link with EmailService. Returns url,expiresAt,email,emailDelivered; true only for configured verified-sender SENT status. A claimed account still requires consent.
- POST `/:id/locations`: name,slug?,parentId?. Uses consent; scoped parent membership checked.
- PATCH `/:id/locations/:locationId/allocation`: seatLimit integer or null. Reserves own-location seats, zero means no new screens, null shares unreserved capacity. SERIALIZABLE and bounded retry.
- Detail locations lists all descendants with parentId,depth (root children = 1),allocatedSeats,seatsUsed (own paired screens). Pool summary committedSeats includes max(reservation, actual usage) for every tenant.
- GET `/:id/payment-summary`: available/unavailable/not_applicable/not_subscribed, card masked details or null, nextPayment from Stripe preview or null, observedAt,subscriptionStatus. No fabricated estimates on provider errors.
- POST `/:id/card-seats`: quantity,confirmProration:true. Uses existing audited StripeService.setSeatQuantity, supports next-invoice proration, requires support consent. Manual local edits of live-card pricing/seat quantity are rejected.
- POST `/:id/invoices/:invoiceId/pdf`: multipart file, PDF only, 10 MiB maximum. Basic format checks and active-content rejection. Private Supabase bucket, immutable random object key, transactional metadata+audit, cleanup on failure/replacement.
- GET `/:id/invoices/:invoiceId/pdf`: scoped invoice lookup, audited 5-minute signed attachment download.
- GET `/:id/invoices/:invoiceId/document`: printable invoice data, seller VenueOS, customer, branding, saved invoice amount authoritative. Line descriptionCode is 'subscription' for frontend localization.
- GET `/api/v1/billing/account/invoices/:invoiceId/pdf`: root determined from authenticated tenant; customer cannot choose another organization.

## Security and billing constraints

Corporate pool activation is limited to invoice/PO/COMP and refuses existing independently licensed descendants. Pool checks execute in the existing serializable screen pairing transaction. Concurrent reservations share the same calculation and cannot oversubscribe the root. Existing fleets keep their preexisting behavior until pooledSeats is enabled. No emergency/support safeguard was weakened. Invoice data never mutates Stripe subscriptions. Every new privileged write is audited. Card information is masked; no card numbers/security codes enter storage.

The schema migration is Prisma-generated, additive and idempotent. PlatformCost has owner-only RLS and revokes browser roles if present. Migration applied twice successfully on isolated local PostgreSQL at port 55449. Schema checkpoint: 0cda437b.

## Checkpoints for lead review

Preserved the original Astra schema checkpoint `0cda437b` and substantive implementation `8f0c9bb7`, including all unfinished dirty files and tests on takeover. Completion checkpoints are:

- `8b3bbb0e` — harden private invoice attachments, complete negative service tests and actual PostgreSQL concurrency/isolation tests, tighten new production types, protect pool opt-out, and correct generated invoice seller branding.
- `708b47f7` — expose optional `packageName`, `packagePriceCents`, and `pooledSeats` in customer roster policy, Prisma select, and mapping, with a real PostgreSQL contract test. Strengthen generated invoice payload assertion.

No reset, discarded work, push, merge, production operation, real charge, email, or external storage write occurred. The main checkout was not modified or run. Implementation checkpoints are clean; this report is committed separately. The lead should review/cherry-pick the existing schema + implementation + completion checkpoints together; do not cherry-pick only the final fixes onto a base without the domain.

## Completed behavior and review fixes

The pre-existing implementation supplies owner-guarded customer branding, customer/descendant invitations through the established onboarding lifecycle, the existing gated starter credential email path, hierarchy-aware location creation, corporate reservations, Stripe payment summary and audited quantity delegation, private invoice attachments, printable saved-invoice data, and customer-owned attachment retrieval.

Final setup acceptance adds optional logoUrl at customer creation, using the same HTTPS/no-credentials validation as subsequent branding changes. Logo-only branding is created transactionally and the URL is recorded in CUSTOMER_CREATED. A policy case, service persistence case, and actual PostgreSQL customer-creation case cover this path; no URL is fetched.

Completion tightens new business, storage, and pool helpers to real Prisma transaction-client and model types and validates unknown request data before use. Those three production files now pass ESLint without unsafe-any suppression. Ancestor traversal is cycle-aware; breadth-first descendant traversal uses a depth map instead of searching prior rows for every child.

Corporate reservations remain serializable and retry bounded. Reservations consume max(actual usage, reservation) per tenant, and unreserved locations cannot borrow reserved capacity. Disabling a pool now refuses paired descendant screens even with no explicit reservations, preventing the old standalone pilot fallback from accidentally permitting new screens. It also refuses non-cleared reservations. Independent child licenses, card billing, and overcommitted contract reductions remain rejected. No license renewal/expiry semantics were changed.

PDF attachment metadata and its audit write share one transaction. Replacement now uses SERIALIZABLE + bounded retries so concurrent replacements re-read the current attachment before retiring it. A failed transaction removes the newly uploaded object, retaining the old attachment. Storage refuses public buckets, uses immutable random UUID PDF keys with upsert:false, and signs only a precise tenant/invoice/UUID-PDF object. Downloads are attachment links lasting five minutes; raw object paths do not appear in invoice/list views. Provider cleanup failures are surfaced by the storage abstraction, while callers keep cleanup best effort after the authoritative metadata operation.

Generated document payloads use seller `VenueOS`, plus line `descriptionCode: 'subscription'` for localization and a readable fallback. The amount saved on the invoice remains authoritative when the current contract changes. The customer billing account already exposes invoice ID and safe attachment metadata without leaking the storage key. Roster rows now include fixed package billing fields so the UI does not fall back to per-screen totals for fixed-price contracts.

## Verification evidence

All commands ran inside the isolated worktree. Final focused suite command:

```sh
CUSTOMER_DOMAIN_TEST_DATABASE_URL='postgresql://gschiemann@127.0.0.1:55449/customer_domain?connection_limit=10&pool_timeout=20' pnpm --filter api exec jest --runInBand --watchman=false --testPathPatterns 'customers/|license.pool|license.service|stripe.*spec|trial-to-paid|support-access'
```

Result: **16 suites, 342 tests passed**, including **12 actual PostgreSQL tests**. Log: `/private/tmp/customer-domain-finish-all.log`.

PostgreSQL coverage: concurrent allocations; concurrent pairings for the final corporate seat; allocation versus pairing; foreign invoice/location rejection; allocation rollback on audit FK failure; under-usage reservations; reserved capacity isolation; unsafe pool opt-out; independent license/card pool activation refusal; atomic PDF metadata rollback on audit failure with mocked external object cleanup; real roster select for fixed contract fields; and a real new customer with logo branding, an audit row, and an unclaimed owner. Existing screen pairing handler still runs `assertSeatAvailable(..., tx)` inside its existing serializable transaction; no screen controller changes were needed.

Service/security coverage additionally proves support consent failures prevent branding, invites, locations, card quantity, and starter email actions; invitation role escalation is ignored; foreign invoice uploads fail before storage; customer download tenant comes only from the authenticated organization; audit failure blocks signing; card summaries expose only masked provider details; provider failures do not fabricate payment estimates; card errors do not leak provider detail; PDFs reject false signatures, missing EOF, MIME mismatch, oversized files, obvious active content, and malformed object paths; bucket provisioning/public races fail closed.

Other commands:

```sh
pnpm --filter api exec tsc -p tsconfig.build.json --noEmit
pnpm --filter api exec eslint src/customers/customer-business.service.ts src/customers/customer-invoice-storage.service.ts src/license/license-pool.ts
node apps/api/tools/check-tenant-isolation.cjs
git diff --check
```

All final checks pass. Tenant scan: 76 tenant-owned models, zero unscoped accesses, 132 reviewed-safe uses, zero baseline growth. Earlier lint including the incumbent `license.service.ts` reported existing formatting/unsafe-any violations; no claim of repository-wide lint success. No full repository preflight, Docker build, deployed browser test, or CI run was performed by this subagent.

## Scratch cleanup and operational limitations

The explicitly local disposable PostgreSQL instance is running on port 55449, database `customer_domain`, data directory `/tmp/business-customer-pg`. Tests keep immutable audit rows and their tenant FK targets, using fresh UUIDs per test; they never delete audit records or disable immutability controls. Destroying the disposable scratch database/cluster is the cleanup boundary after lead checks. No production DB credentials were used. Do not stop the cluster until the lead has finished any integration validation that depends on it.

Storage and Stripe provider behavior is mocked. This work has not proven a real configured Supabase bucket, live/test Stripe integration, email delivery, or a deployed end-to-end workflow. PDF validation is intentionally format/magic-byte and obvious-active-content validation, not malware scanning or a full PDF parser. PDFs remain download-only attachments. Generated invoices are authoritative printable data for frontend generation, not server-rendered PDF bytes. UI and WebKit verification belongs to the lead/UI worktree. No change has shipped until lead integration, CI, deployment, and rendered behavior are verified.
