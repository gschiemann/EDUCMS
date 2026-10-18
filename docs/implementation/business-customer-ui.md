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
