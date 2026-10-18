# Customer business domain implementation

Worktree: `business-customer-api`, branch `codex/business-customer-api`. No production writes, pushes or main-checkout changes.

## Contracts

All owner routes below use the existing `SUPER_ADMIN` class guard and `/api/v1/super/customers` prefix.

- Existing create/license patch accept `packageName`, `packagePriceCents` (fixed MONTHLY-equivalent contract total; null means per-screen monthly price × contracted seatLimit), `pooledSeats` (explicit opt-in, default false).
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
- GET `/:id/invoices/:invoiceId/document`: printable invoice data, seller ARC, customer, branding, saved invoice amount authoritative.
- GET `/api/v1/billing/account/invoices/:invoiceId/pdf`: root determined from authenticated tenant; customer cannot choose another organization.

## Security and billing constraints

Corporate pool activation is limited to invoice/PO/COMP and refuses existing independently licensed descendants. Pool checks execute in the existing serializable screen pairing transaction. Concurrent reservations share the same calculation and cannot oversubscribe the root. Existing fleets keep their preexisting behavior until pooledSeats is enabled. No emergency/support safeguard was weakened. Invoice data never mutates Stripe subscriptions. Every new privileged write is audited. Card information is masked; no card numbers/security codes enter storage.

The schema migration is Prisma-generated, additive and idempotent. PlatformCost has owner-only RLS and revokes browser roles if present. Migration applied twice successfully on isolated local PostgreSQL at port 55449. Schema checkpoint: 0cda437b.

## Checks at checkpoint

- Independent pnpm install frozen lockfile completed; own Prisma client generated and workspace dependency packages built.
- API production typecheck (`tsc -p tsconfig.build.json --noEmit`) passed before the final small route additions; rerun in progress.
- Existing customers/license focused suites: 116 tests passed (before new domain regression suites).
- Tenant-isolation AST gate passed: zero unscoped lookups, zero baseline growth.
- New real-Postgres tests exercise concurrent allocation, concurrent pairing, allocation-versus-pairing race, cross-tenant invoice/location rejection, and audit-failure rollback. Execution results updated in final checkpoint.

## Current limitations / operational validation

Stripe and private storage behaviors are exercised with mocks/local tests; no real customer charges or emails sent. No external deploy performed. PDF validation is not malware scanning; files are download-only signed attachments. Generated invoice is printable authoritative data for frontend generation, not a server-produced PDF. New database integration tests require CUSTOMER_DOMAIN_TEST_DATABASE_URL pointing to a local scratch database; default suite skips them. User-visible UI verification belongs to lead/UI worktree.
