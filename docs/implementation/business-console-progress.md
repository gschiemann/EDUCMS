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

## Usage checkpoint and continuation

Account five-hour usage reached 87% during implementation; agents were instructed to checkpoint immediately. Keep these worktrees until review/integration is finished. Do not remove any unrelated Claude or Codex worktree. User explicitly requires no interference with Claude's main checkout.

Lead API commits: `c283fc59` adds audited cost ledger and contract profit report, followed by lint/freshness fixes. Schema checkpoint `0cda437b` is integrated as `d0298d84`. Profit UI first commit `1f58b31d` was reviewed; fixes requested for clearing nullable form fields, custom provider name preservation, localized recommendations/dates, source badges, and Chromium/WebKit rendered checks. Await its follow-up before integrating.

Lead checks completed: independent pnpm install, Prisma generate, api-types/scoreboard-cts/signage-design builds, API tsc, 27 business policy/service/auth tests. Target eslint initially found test stub/format issues which were corrected and rerun. No production database changes, no branch pushes, no PR/merge/deploy.

Next: read each agent's tracked report and diff, integrate their commits individually onto `codex/business-console-integration`, resolve only additive i18n namespace conflicts, regenerate Prisma, run relevant API/web tests and types, then exercise real rendered `/super`, customer detail, invoices and profit in Chromium and WebKit with fixtures. Check pool allocation pairing invariants and private PDF routes. Full preflight and CI are still required before publication. Automatic third-party provider bill ingestion is not implemented; costs are recorded estimates, capacity uses the existing measured hourly sampler.
