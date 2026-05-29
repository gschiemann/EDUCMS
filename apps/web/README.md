# VenueOS Web (`apps/web`)

Next.js 16 (App Router) + React 19 dashboard and player. This is every
customer-facing browser surface: the admin dashboard, the template
builder, the mobile panic page, and the kiosk **player** route that runs
on screens (including NovaStar Taurus LED controllers).

- **Runtime:** Next.js 16 App Router, React 19, Zustand, React Query,
  Tailwind CSS 4, shadcn/Base UI, dnd-kit
- **Port:** `3000` (or `$PORT`)
- **Deployed on:** Vercel
- **Talks to:** the `apps/api` NestJS server via `NEXT_PUBLIC_API_URL`

> One workspace in a pnpm + Turborepo monorepo. Run commands from the
> **repo root** unless noted. The source of truth for architecture and the
> hard-won rules (template-builder render tree, Chromium-83 / Taurus CSS
> constraints, cross-browser/WebKit) is the root
> [`CLAUDE.md`](../../CLAUDE.md) — read it before changing anything here.

## Local dev

From the repo root:

```bash
pnpm install
pnpm dev:web          # next dev on :3000
```

Or from this directory:

```bash
pnpm dev              # next dev
```

Open <http://localhost:3000>. You'll usually want the API running too —
`pnpm dev` from the repo root starts both API and web in parallel.

## Build & run (production)

```bash
pnpm --filter web run build     # next build (fails on TS errors — see below)
pnpm --filter web run start     # next start
```

Vercel runs the build on every push to `master`. Next.js fails the
production build on **any** TypeScript error, so always run
`pnpm preflight` (repo root) before pushing — it runs the same web type
check CI does.

## Tests & checks

```bash
pnpm --filter web run lint                 # eslint
pnpm --filter web run test:cross-browser   # WebKit holiday-bridge protocol checks
pnpm --filter web run test:e2e             # Playwright
pnpm --filter web run a11y:ci              # axe-core accessibility audit
pnpm --filter web run lhci                 # Lighthouse CI
```

**Cross-browser is non-negotiable.** `test:cross-browser` runs the
holiday-bridge checks in WebKit and blocks merge in CI. Anything shipped to
the player route must also survive **Chromium 83–87** (Taurus) — never use
the `inset` shorthand / `inset-*` Tailwind class in widget or player styles.
The full rule set (rule #9 render-tree, rule #10 Taurus CSS) is in CLAUDE.md.

## Environment

| Variable | Why it matters |
|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of the `apps/api` server. **If unset the frontend falls back to localhost** — set it in Vercel or the dashboard shows "Can't reach the server." |

Other `NEXT_PUBLIC_*` flags exist for feature gating — see
[`CLAUDE.md`](../../CLAUDE.md) and [`docs/FEATURE_FLAGS.md`](../../docs/FEATURE_FLAGS.md).
Never commit `.env*` — the repo is **public**.

## Route map

```
src/app/
  [schoolId]/        tenant-scoped dashboard (screens, playlists,
                     templates, assets, reviews, settings, billing)
  player/            the kiosk render surface (Taurus / Android / browser)
  (panic / mobile)   hold-to-trigger emergency page
src/components/
  widgets/           WidgetRenderer + per-widget components + variants-register
  template-builder/  BuilderShell → VariantPicker (the live widgets panel)
  player/            player chrome, scaler, kiosk splash
public/
  sw-player.js       service worker — offline cache tiers (playlist + emergency)
```

## Editing the template builder (read first)

The widgets panel renders **`VariantPicker`** (reads
`components/widgets/variants-register.ts`), **not** `WidgetPalette.tsx`
(dead code). Editing the wrong file ships nothing while CI stays green.
Always `grep -rn '<ComponentName'` to confirm a component is actually
mounted before editing it, and verify user-visible changes in the rendered
DOM. See CLAUDE.md rule #9.

## If the deployed app breaks

- "Can't reach the server" → check `NEXT_PUBLIC_API_URL` in Vercel env, redeploy.
- Build failed on Vercel → almost always a TS error `pnpm preflight` would have caught.
- Player blank / 0×0 widgets on a Taurus wall → a `inset`/`gap` Chromium-83 landmine (rule #10).
