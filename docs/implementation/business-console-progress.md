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

## Integrated verification checkpoint

All three feature branches are integrated and the finished agent worktrees archived recoverably. The integration worktree remains active; Claude's main checkout and unrelated worktrees remain untouched. Upstream master through `83448b5b` is merged into this branch.

The one portal is `/super` with shared navigation and overview panels, customer detail tabs, customer creation (including HTTPS logo and owner invitation), corporate pool allocation and pairing enforcement, live-card quantity proration, invoice ledger/print/download/upload, profit estimates, recorded costs and provider usage observations. Railway/Vercel optional scoped usage reads are now implemented; see `business-provider-usage.md`. They remain separate from the monthly cost ledger to avoid double counting.

Independent lead verification: API/web typechecks passed; 32 web tests passed; all 12 scratch PostgreSQL race/isolation/rollback tests passed; translation parity passed at 5,257 keys per language; tenant-isolation gate found zero unscoped lookups. The actual additive migration applied twice successfully. RLS read and write denial passed under a disposable non-owner role after applying migration SQL (Prisma db push alone did not install RLS, demonstrating why migration verification matters).

Combined mounted UI passed Chromium and WebKit at desktop and phone sizes: onboarding invitation POST, customer keyboard tabs/deep links, role hydration denial without privileged requests, signed PDF attachment download, one-page invoice printing, and Spanish/Chinese rendering. The profit browser suite passed both engines at 375px for create/edit/clearing nullable fields/archive/restore/provider labels and provider usage. Evidence is saved in this worktree's ignored `docs/research/2026-10-18-business-console/evidence/`, `/tmp/business-combined-evidence` and `apps/web/test-results/`. The browser harness was then strengthened to include caught route errors and an actual platform health fixture/render assertion; rerun that final harness after preflight.

Remaining: production preflight and final complete API suite (bounded workers to avoid the full suite exhausting a single 4 GiB process) are running. After they pass, rerun strengthened browser harness against the production build, save final evidence, prepare a draft PR on this branch, and watch CI to completion. No production customer operations, provider plan changes, main merge or deployment have been performed.

## Final local verification

- Complete API suite: 537 suites / 10,464 tests passed (3 suites / 30 tests intentionally skipped). Twelve local PostgreSQL tests ran separately and passed.
- Production preflight passed. API/web types, 32 focused UI tests and 15 CSP policy tests passed. Translation parity, tenant isolation, CSP prerender guard and redacted branch secret scan passed.
- The final production build exposed a nonce/prerender issue that dev mode did not: fixed by a server `/super` layout using `await connection()`, with the client shell extracted intact. Removed the now-unnecessary owner-route CSP exclusions. Every owner section independently returned executable scripts with matching request nonces; repeated requests had distinct nonces. No security policy was weakened.
- Final production Chromium and WebKit portal harness passed with zero page/route-boundary errors: actual soft navigation without reload, desktop/mobile/locales, customer tabs, denied-role request gating, owner email action, real signed-file download and one-page invoice print. Final profit production browser tests passed both engines at 375px.
- Evidence: `/tmp/business-production-evidence`, `apps/web/test-results`, and preserved ignored research evidence. No live charges, production database writes, provider plan changes, main checkout edits or production deployment.
- Optional Railway/Vercel usage requires scoped runtime credentials; the UI shows connection state and scope. Supabase billing costs are recorded manually; capacity remains measured. Stripe and private storage were verified using mocks/local tests; credential-based live integration remains a release configuration check.

## Publish checkpoint — 2026-10-18

- Incorporated current master (71dd041), retaining screen/device/ledger features and linking Field builds from the business workspace. All owner routes, including Field builds, render per request with enforced script nonces.
- Resolved the three CodeQL findings using bounded linear email parsing and anchored single-character slug trimming. Targeted service/policy/security checks: 4 suites, 106 tests passed.
- Updated the existing mobile owner regression to verify the unified business navigation and return to the correct tenant dashboard. Chromium and WebKit both pass.
- Rebuilt with `pnpm preflight`: passed. CSP prerender guard: 56 static routes, none in the enforced set. Full production portal browser harness passes in Chromium and WebKit with zero page errors; desktop/mobile, Spanish/Chinese, consent/role gate, customer tabs, PDF download and invoice print exercised. Profit cost create/edit/archive/restore checks pass in both browsers at 375px.
- Publication is pending the fresh remote CI run and production deployment verification. No live customer invitations, billing changes or costs were created for verification.
