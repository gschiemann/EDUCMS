# Business/customer UI implementation

Worktree: `/Users/gschiemann/.codex/worktrees/business-customer-ui/EDU CMS`
Branch: `codex/business-customer-ui`. No push or merge authorized/performed.

## Checkpoint (in progress)

- Shared /super business shell with Overview, Customers, Invoices, Profit and Health navigation; desktop and mobile advanced tools remain accessible.
- /super is the primary portal with real customer counts, attention queues, recent customers, platform health entry. Original tenant/license/activation/storage tools preserved inside advanced section.
- Removed original seats-used-based approximate MRR stat to avoid misrepresenting contracted revenue.
- Searchable/filterable server roster retains existing query behavior; links into location hierarchy.
- Customer detail adds card/payment summary, custom packages, corporate pooled billing, location creation/allocation, consent-gated admin invites and branding alongside existing support grants/audit/license/invoice tools.
- Standalone invoice workspace with server search/status/pages, invoice creation through existing customer invoice API, ARC PDF upload/download, authoritative invoice document with print/save PDF.
- en/es/zh new strings restricted to businessConsole/customerConsole namespaces.
- Install completed independently (no generated-package symlinks); local api-types/scoreboard builds run.

## Checks and remaining work

Typecheck: `pnpm --filter web exec tsc --noEmit --pretty false` running; log `/tmp/customer-ui-tsc.log`.
Scoped lint: running; log `/tmp/customer-ui-lint.log`.
Existing customer interaction tests: running; log `/tmp/customer-ui-test.log`.

Still to complete: owner email invite + custom-package controls in customer creation, explicit prorated Stripe quantity action, new interaction coverage, remaining i18n for those features, Chromium + WebKit actual render checks on port 3261. New customer panel imports OneTimeLink from detail while detail imports panels; remove circular import if possible. Verify invoice document API response contract against domain agent. Root must integrate domain API + profit hook and validate final branch.

## Second milestone

Owner setup invitations now email after creation (separate failure state preserves successful customer creation), existing owner card supports resend, creation accepts custom package/corporate billing, and live card quantity change uses explicit proration confirmation. OneTimeLink extracted to remove component cycle. Added actual financial snapshot on /super from GET /super/business (shared ['super-business'] cache key): contracted revenue, entered monthly costs, estimated contribution/margin, overdue receivables and partial cost coverage. Existing helper roster amount now uses contracted seats/fixed package.

Checks: initial and subsequent full web TypeScript checks passed; scoped application lint passed without errors; customer interaction suite 20/20 passed including package/pool, branding, hierarchy, allocation, Stripe proration confirmation, multipart PDF and local size validation. Browser fixture render QA pending next.
