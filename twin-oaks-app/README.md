# Twin Oaks OS

**The business operating system for Twin Oaks Farm & Tech LLC** — one app
that tracks every dollar in and out, stores every receipt permanently,
separates farm costs from tech/manufacturing costs, and makes tax time a
drill-down instead of a shoebox.

> The success test: at tax time, answer **"Where did this deduction come
> from?"** in seconds — Category → Transaction → Business purpose →
> Equipment → Vendor → Date → Amount → **Original receipt**.

Built mobile-first: designed to be used every day from an iPhone or iPad
without creating extra bookkeeping work.

## What's in V1 (today)

- **Dashboard** — month/YTD revenue, expenses, net; Farm vs Tech split; flags
- **Receipts** — snap a photo → lands in the **Inbox** → categorize when you
  have time; originals stored permanently; PDF + attach-later supported
- **Expenses** — dual categorization (accounting category for the books,
  management category for "where the money really went"), business purpose,
  tax year, capital-purchase flag, connect to equipment
- **Income** — print sales, livestock sales, design work, and more
- **Equipment & assets** — profiles for tractors, printers, trailers;
  maintenance history with YTD / lifetime / cost-per-hour rollups
- **Search** — "Tractor #1 hydraulic" finds the expense, the service record,
  and the receipt
- **Tax Center** — per-year totals, category breakdowns, flagged items
  (needs review / missing receipts), capital purchases
- **Backup** — one-tap full JSON export
- **Owner login gate** — set `APP_PASSWORD` and every route requires sign-in
  (30-day session cookie); unset in local dev to skip the gate

**Tax-safety principle:** the app never decides deductibility. Uncertain
expenses default to *Requires accountant review* and stay flagged until a
human classifies them.

Full specification: [`docs/SPEC.md`](docs/SPEC.md) ·
Build status: [`docs/ROADMAP.md`](docs/ROADMAP.md)

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, server components + server actions) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS 4 |
| Database | Prisma ORM + Postgres (temporary SQLite flip documented in `prisma/schema.prisma` for offline dev) |
| Files | Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set; local disk otherwise (`src/lib/storage.ts`) |
| Auth | Owner password gate via middleware (`APP_PASSWORD`); passkeys planned |
| Money | Integer cents everywhere — never floats |

## Run it

```bash
pnpm install          # install dependencies
cp .env.example .env  # then set DATABASE_URL to a Postgres connection string
pnpm db:push          # create the schema
pnpm db:seed          # optional: sample data (tractor, printer, receipts…)
pnpm dev              # http://localhost:3000
```

No Postgres handy? See the note at the top of `prisma/schema.prisma` for the
one-line SQLite flip for offline development.

Other commands:

```bash
pnpm build       # production build (runs prisma generate first)
pnpm start       # serve the production build
pnpm typecheck   # tsc --noEmit
pnpm db:reset    # wipe dev database + reseed
```

## Repository layout

```
prisma/            schema + seed (SQLite dev database lives here, gitignored)
src/lib/           domain constants, money/date helpers, storage, prisma client
src/components/    app shell (bottom nav, quick add), shared UI primitives
src/app/           routes: dashboard, receipts, expenses, income, assets,
                   search, tax, more + /api/files + /api/export
docs/              SPEC.md (source of truth) + ROADMAP.md (build status)
var/uploads/       dev receipt storage (gitignored)
```

## Important

- **Always set `APP_PASSWORD` on any deployment.** With it unset the gate is
  disabled (dev convenience only) — never expose an ungated instance.
  Passkeys/Face ID are the planned upgrade — see `docs/ROADMAP.md`.
- **Never commit `.env`** or real financial data. The seed data is fictional.
