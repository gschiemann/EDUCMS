# Twin Oaks OS — Developer Guide

## Mission

One app for all of Twin Oaks Farm & Tech LLC: every dollar tracked, every
receipt stored permanently, farm vs tech costs separated, tax time reduced to
a drill-down. The owner runs it daily from an iPhone/iPad — **mobile-first is
non-negotiable**. `docs/SPEC.md` (owner-written) is the product's source of
truth; `docs/ROADMAP.md` tracks what's actually built. Read both before
feature work.

## Ground rules

1. **Money is integer cents.** Never floats, never strings, never Decimal in
   app code. Format with `src/lib/money.ts`.
2. **The app never decides deductibility.** New expenses default to
   `NEEDS_REVIEW`. Flag and organize; the accountant decides. Never add
   "auto-deductible" logic — this is SPEC §1/§27 and a legal-safety stance.
3. **Receipts are permanent.** Originals are never deleted by app code —
   archive status instead. Deleting an expense flips its receipts back to
   `NEEDS_REVIEW`, never removes them.
4. **Enum-like values live in `src/lib/domain.ts`**, not scattered strings —
   SQLite (dev DB) has no native enums, so that file is the single source of
   truth for statuses/categories. Change them there and everywhere follows.
5. **No fake UI.** Features that don't exist yet get an honest muted note
   ("Sheep arrive in V3") or nothing — never a dead button.
6. **Dates from `<input type="date">`** go through `parseDateInput` (parses
   as local noon) so calendar days never shift across timezones.
7. **Verify before claiming done**: `pnpm typecheck && pnpm build`, seed a
   dev DB, and click through the affected flow (or curl the routes) before
   reporting a feature complete.

## Architecture

- **Next.js 15 App Router, server-first.** Pages are server components
  querying Prisma directly; mutations are server actions in per-route
  `actions.ts` files. Client components only where interactivity demands it
  (`BottomNav`, `QuickAdd`). Keep it that way — no client-side data layer
  until something genuinely needs one.
- **DB:** Prisma + Postgres (`provider = "postgresql"`). For offline dev
  without a Postgres, the schema header documents a temporary local SQLite
  flip — never commit it. Schema stays dual-compatible: no provider-specific
  types, string pseudo-enums, cents integers.
- **Files:** `src/lib/storage.ts` abstracts uploads. Vercel Blob when
  `BLOB_READ_WRITE_TOKEN` is set (storage key = blob URL); local disk under
  `var/uploads` otherwise (storage key = UUID filename served by
  `/api/files/[key]`). Render via `fileSrc()` — never hand-build file URLs.
  `isSafeStorageKey` guards traversal on the local path; keep it that way.
- **Auth:** `src/middleware.ts` + `src/lib/session.ts` + `/login`. When
  `APP_PASSWORD` is set, every route (pages AND `/api/*`) requires the signed
  session cookie; unset disables the gate for dev. The session module is
  Edge-safe (Web Crypto only) — no Node imports there. Always set
  `APP_PASSWORD` in production.
- **All DB-backed pages export `dynamic = "force-dynamic"`** — this app is
  per-request data; static generation would query the DB at build time.
- **Page files export only Next-recognized fields.** Shared helpers go in
  sibling modules (`expense-bits.ts`, `receipt-bits.tsx`), never exported
  from `page.tsx`.

## Domain cheat-sheet

- **Division:** FARM | TECH | SHARED — every expense/income/asset carries one.
- **Dual categorization (SPEC §6):** `accountingCategory` (fixed list, for
  the books) + `managementCategory` (free-form "A > B > C" drill-down path).
- **Receipt lifecycle (SPEC §3–4):** INBOX → CATEGORIZED (via "create
  expense from receipt"), or NEEDS_REVIEW / TAX_UNCERTAIN / SPLIT_PERSONAL /
  REIMBURSABLE / ARCHIVED.
- **Tax statuses (SPEC §27):** LIKELY_BUSINESS, CAPITAL_ASSET,
  MIXED_PERSONAL, NEEDS_REVIEW (default), MISSING_DOCS, NOT_DEDUCTIBLE.
- **Maintenance records** double as the hour-meter log — `addMaintenance`
  advances `Asset.currentHours` when the service hours exceed it (mileage
  logs do the same for `Asset.currentMileage`).
- **Invoices (V2):** stored status is only DRAFT | SENT | CANCELLED —
  paid/partial/overdue are DERIVED from payments + dueDate via
  `deriveInvoiceStatus` (invoice-bits.ts); never store them. Drafts are
  editable; sent invoices are financial records (line edits blocked).
  Recording a payment auto-creates a linked Income row
  (`incomeCategoryForDivision`); deleting the payment deletes that row.
  Invoice numbers are `INV-NNN` via `nextInvoiceNumber`.
- **Schema changes MUST update `src/lib/ensure-schema.ts`:** regenerate the
  DDL (`prisma migrate diff --from-empty --to-schema-datamodel
  prisma/schema.prisma --script`), keep statements idempotent (IF NOT
  EXISTS / duplicate_object guards), and point the probe at the NEWEST
  table so existing databases self-upgrade.

## Commands

```bash
pnpm dev / build / start / typecheck
pnpm db:push / db:seed / db:reset / db:generate
```

CI (`.github/workflows/ci.yml`) runs install → prisma db push (throwaway
SQLite) → seed → typecheck → build on every push/PR. Keep it green.

## Known state / next steps

- **Auth:** basic owner password gate shipped (see Architecture). Passkeys/
  Face ID still open (SPEC §32). Never deploy with `APP_PASSWORD` unset.
- **Deploy (Vercel):** the `build` script self-applies the schema on Vercel
  only — `$VERCEL` gates a `prisma db push`, preferring the unpooled
  `DATABASE_URL_UNPOOLED` the Neon integration injects (DDL through the
  pooler is unreliable); local/CI builds skip it. Project expectations:
  root directory `twin-oaks-app`, production branch = the current dev
  branch, Neon Postgres + Blob store connected, `APP_PASSWORD` set.
- OCR receipt auto-read, duplicate detection, CSV/PDF accountant package:
  deferred (see ROADMAP "V1 gaps").
- V2 = customers/invoices/payments/mileage/banking; V3 = sheep; V4 = print
  jobs. Schema additions for those go in as new models — don't overload V1
  models.
- Next 15 → 16 upgrade is a known follow-up; don't mix it into feature PRs.
