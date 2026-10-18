# Unified business console

Base commit: `30cf28c27b7743e6a66ad93fe0ca12a2f22c5b60`.

All work is isolated from the main checkout and Claude's active worktrees. Nothing is deployed or merged to master by this work session.

## Ownership

- `codex/business-console-integration`: profit API, integration, verification and handoff.
- `codex/business-customer-api`: customer billing/onboarding domain, schema and migrations (Astra).
- `codex/business-customer-ui`: unified `/super` shell, overview, customers and invoices (Sol).
- `codex/business-profit-ui`: profit and infrastructure page, hooks and translations (Luna).

## Acceptance scope

- One business workspace rooted at `/super`, with customers, invoices, profit and platform health.
- Customer creation, branding, invites and approved temporary support access.
- Corporate billing with expandable locations and real license allocation enforcement.
- Card billing visibility, contract pricing, screens and next-payment information.
- Private ARC invoice attachments, generated invoices and payment tracking.
- Contract revenue estimate, recorded infrastructure costs and capacity evidence with honest freshness.
- Every privileged mutation audited; no production schema changes during development.
- Target tests, types and rendered Chromium/WebKit validation before merge readiness.

Detailed agent reports live alongside this file. Checkpoint commits preserve work as it proceeds.

## Saved checkpoints

Customer domain report: schema checkpoint `0cda437b` adds PlatformCost, license packageName/packagePriceCents/pooledSeats, Tenant.allocatedSeats and invoice PDF metadata. Agent reports generated additive/idempotent SQL applied twice on isolated Postgres port 55449; new cost table has RLS and anon/authenticated access revoked. Independent dependencies and client generated. Lead review follows before integration.

Profit UI report: `/super/profit` uses query key `['super-business']`, coverage/unpriced disclosures and existing CapacityCard under the shared shell. Agent working on cost register and translations.
