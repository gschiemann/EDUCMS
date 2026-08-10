# Twin Oaks OS — Build Status & Roadmap

Tracks what has actually shipped against [`SPEC.md`](./SPEC.md).
Statuses: ✅ built · 🟡 partial (details noted) · ⬜ not started.

_Last updated: 2026-08-10 (initial scaffold)._

## V1 — Financial core (SPEC §33)

| Feature | Status | Notes |
|---|---|---|
| Company setup | 🟡 | Single-company app, divisions FARM/TECH/SHARED baked in; no settings screen yet |
| Dashboard | ✅ | Month + YTD revenue/expenses/net, division cards, inbox alert, needs-attention flags, recent activity, tax set-aside planning number |
| Receipt capture | ✅ | Camera capture on iPhone/iPad (`capture="environment"`), photo/PDF upload, attach-later |
| Receipt storage | ✅ | Originals stored under `var/uploads` in dev via `src/lib/storage.ts`; swap to object storage for production (same interface) |
| Receipt Inbox | ✅ | Save instantly → categorize later; Inbox / Needs-review / All tabs |
| Expenses | ✅ | Full SPEC §5 record: dual categories, division, business purpose, asset link, tax year, tax status, capital flag |
| Income | ✅ | SPEC §25 categories, division, source |
| Categories | ✅ | Accounting + management levels (`src/lib/domain.ts` is the source of truth) |
| Equipment/assets | ✅ | SPEC §9 profile fields, ACTIVE/SOLD/RETIRED status |
| Equipment maintenance | ✅ | SPEC §10 history + categories, YTD/lifetime/cost-per-hour rollups, hour-meter sync |
| Search | ✅ | Multi-term AND search across expenses, receipts, income, assets, maintenance |
| Basic tax reports | ✅ | Tax Center: per-year totals, category breakdowns, division split, flagged items, capital list |
| Receipt drill-down | ✅ | Tax Center → expense → original receipt image (SPEC §26 example works end-to-end) |
| Data backup | 🟡 | One-tap full JSON export (`/api/export`); automatic scheduled backups still to come |

### V1 gaps / conscious deferrals

- **OCR auto-read of receipts** (SPEC §3 "attempt to automatically read") — deferred; fields are quick manual entry for now. Candidate: on-device/web OCR or AI extraction in a later pass.
- **Auth / secure login** (SPEC §32) — the scaffold has no login yet. **Do not deploy publicly until auth lands.** Runs locally / on a private network in the meantime.
- **Duplicate-receipt detection** (SPEC §4) — deferred.
- **Photos/manuals on equipment profiles** (SPEC §9) — document storage generalization comes with §31.
- **Outstanding invoices / upcoming bills on dashboard** — arrives with V2 invoicing.

## V2 — Customers, invoicing, mileage, banking (SPEC §34)

⬜ Customers · ⬜ Quotes · ⬜ Invoices · ⬜ Payments · ⬜ Mileage ·
⬜ Bank transaction matching · ⬜ Better tax reports · ⬜ Accountant export
(CSV/PDF/ZIP package, SPEC §28)

## V3 — Farm / livestock (SPEC §35)

⬜ Sheep profiles · ⬜ Lambing · ⬜ Breeding · ⬜ Health records ·
⬜ Livestock sales · ⬜ Farm cost analysis

## V4 — Manufacturing (SPEC §36)

⬜ Print jobs · ⬜ Filament inventory · ⬜ Printer tracking · ⬜ Job costing ·
⬜ Production reporting · ⬜ Profit per part

## Platform follow-ups (not feature work)

- Auth (single-owner login + Face ID via passkeys/WebAuthn) — **prerequisite for any public deploy**
- Postgres (Supabase) + object storage for production; PWA manifest + icons for
  home-screen install; automatic backups; deploy target (Vercel)
- Upgrade path: Next.js 15 → 16 when the app stabilizes
