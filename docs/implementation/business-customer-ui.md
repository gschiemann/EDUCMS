# Unified business/customer portal implementation

Branch: `codex/business-customer-ui`.
Worktree: `/Users/gschiemann/.codex/worktrees/business-customer-ui/EDU CMS`.
Base: `30cf28c2`. Checkpoints: `edddcff0288f459e7cec1f448c572e9fade19819`, `7817712a162dcdde0d6f5ac4cc086ba9b1fe639b`.
No merge, push, deployment, production API mutation, or credential use performed.

## Final behavior

`/super` is the single business landing portal. Its common responsive shell links Overview, Customers, Invoices, Profit & costs, Platform health, plus advanced platform/AI/issue/simulator tools on both desktop and mobile. The shell waits for client hydration and confirmed SUPER_ADMIN before mounting privileged children. APIs remain authoritative.

The overview shows server-filtered customer totals/attention queues, recent customers, platform screen status, and the financial summary from GET `/super/business`, sharing query key `['super-business']` with the profit area. Financial figures are contracted monthly revenue, entered monthly costs, estimated contribution/margin, and overdue receivables; partial cost coverage is stated. Removed the old occupied-screen-based approximate MRR tile. All existing tenant tri-state selection, comp/upgrade, activation and storage tools remain mounted in the expandable advanced section. Sidebar links open that section even when already on `/super`.

The customer roster retains debounced server search, filters, sorting and paging. Monetary roster estimates now use the fixed package price or contracted screen licenses rather than occupied screens. Location counts link directly to the location section.

Customer details use an accessible keyboard-navigable section tablist (arrow/Home/End keys; hash deep links) while preserving mounted forms and unsaved field state. Sections cover billing/package, location hierarchy and screen reservations, people/owner invites, branding, consent-based setup access and audited activity. Existing suspend/reactivate, support-consent/break-glass safeguards, owner links, license editing and invoice tracking remain available. Card details/next payment display only provider data; unavailable states are honest.

Creation supports initial display name, HTTPS logo URL, primary/accent colors, custom package/fixed price, billing terms and corporate pool. Optional owner email sends the setup link after successful customer creation; returned regenerated URL is authoritative. Email failure preserves the created customer and original copyable link. Existing customers can resend setup invitations; additional-admin invites/branding/location operations use consent-gated APIs. Live card seat changes require an explicit confirmation explaining the prorated adjustment on the next invoice; manual license saves do not send a competing Stripe seat count.

`/super/invoices` is a first-class workspace with global server search/status/paging, invoice creation for a chosen searchable customer, status tracking, signed attachment downloads and multipart ARC PDF upload (local size/extension checks plus authoritative server validation). `/super/invoices/[id]?customer=...` reads the authoritative document and offers print/save PDF. Generated seller is VenueOS; subscription descriptionCode is translated. Source ARC attachments retain the clear Upload ARC PDF action, while general invoice labels no longer claim every invoice came from ARC. Downloads navigate to a signed attachment URL in the current window to avoid Safari popup timing restrictions; server signs with download:fileName.

Customer mutations invalidate detail/roster/invoices, business summary and legacy tenant caches. No polling was introduced.

## Verification

- Independent frozen-lockfile install succeeded; generated local Prisma client, api-types and scoreboard-cts builds. No symlinks to main checkout generated packages.
- Full web `pnpm --filter web exec tsc --noEmit --pretty false`: passed; final successful result in `/tmp/customer-ui-tsc-release.log`.
- Scoped ESLint covers all changed application TS/TSX source including `/super/page.tsx`: final result `/tmp/customer-ui-lint-release.log` passed with zero errors/warnings (no auto-fix used).
- `pnpm --filter web exec jest --runInBand src/app/super/__tests__ src/app/super/customers/__tests__`: **4 suites / 28 tests pass**. Covers legacy tri-state selection and no-wipe guard; denied-role/no-poll/filter behavior; license/invoice/suspension links; fixed package/pool changes; branding and nested location creation; screen reservations; explicit Stripe proration; actual multipart PDF and size refusal; full initial branding/owner email and delivery-failure preservation. Lead explicitly assigned the legacy selection test compatibility change; it exercises the real expanded legacy section and mocks the independently tested overview.
- `git diff --check`: passed.
- en/es/zh customerConsole and businessConsole recursive key parity: passed. Regenerated local public locale catalogs with `node scripts/emit-locale-catalogs.cjs` (run from apps/web).

## Mounted browser verification

Reusable tracked harness: `apps/web/src/components/super/__tests__/business-workspace.browser.cjs`.

Start the isolated web dev server, then run from repository root:

```bash
BUSINESS_UI_URL=http://localhost:3275 BUSINESS_UI_EVIDENCE=/tmp/business-combined-evidence node apps/web/src/components/super/__tests__/business-workspace.browser.cjs
```

Default server URL is localhost:3261, default evidence folder `/tmp/business-workspace-evidence`. Every API response is a public fictional fixture, and the harness serves a public attachment fixture using a temporary loopback HTTP server. Actual HTTP is necessary for WebKit download events (route-fulfilled downloads did not reliably emit them).

Chromium and WebKit both passed desktop 1440px and mobile 390px route renders, no horizontal document overflow, owner email POST workflow, invoice PDF download while retaining workspace URL, generated invoice print, keyboard tab/deep-link behavior, translated Spanish/Chinese overview, and denied role making zero `/super/*` requests. No browser page errors. Chromium printed PDF has one A4 page (no extra blank page); print screenshots hide workspace navigation. Overview, mobile detail and invoice screen/print screenshots were visually inspected.

Evidence includes `report.json`, `{chromium,webkit}-overview-desktop.png`, `*-c1-mobile.png`, `*-invoice-document-desktop.png`, `*-invoice-print.png`, `*-{es,zh}-mobile.png`, route screenshots and `invoice-print.pdf` under the configured evidence folder. Final rerun log: `/tmp/customer-ui-browser-release.log`.

## Integration boundaries and remaining proof

Root must integrate the customer domain endpoints and migration and the separate profit UI/API commits. UI contracts were coordinated with domain agents; files were not cherry-picked into this worktree. Real Stripe/SMTP/Supabase writes, real customer consent and final combined API integration were not exercised with production credentials. Browser fixtures prove mounted UI behavior, not those providers. No release/deployment claim is made; root owns merge, CI, deployment proof and worktree cleanup. Existing advanced tools retain their existing legacy copy and functionality.
