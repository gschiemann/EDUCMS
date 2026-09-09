# Accessibility

This project targets **WCAG 2.2 AA** compliance.

## Tools in place

| Tool | Status | Purpose |
|------|--------|---------|
| `eslint-plugin-jsx-a11y` | **Wired** | Static analysis — catches missing alt text, unlabelled inputs, non-interactive div click handlers at lint time. Rules configured in `apps/web/eslint.config.mjs:22-47` |
| `@axe-core/react` | **Wired** | Development-only runtime overlay — logs violations to the browser console under `next dev`. Registered in `apps/web/src/app/layout.tsx:10-15`, guarded on `NODE_ENV === 'development'` |
| `@axe-core/playwright` | **Wired** | Drives the route-level CI audit — `apps/web/scripts/a11y-audit.ts` |
| `jest-axe` | **Installed, unused** | Listed in `apps/web/package.json:86` but imported nowhere under `apps/web/src`, and `apps/web/jest.setup.ts` registers only `@testing-library/jest-dom` — `toHaveNoViolations` is not available in the Jest suite as it stands |

There is **no component-level axe test helper.** Earlier revisions of this file
told you to `import { expectNoA11yViolations } from '@/test-utils/axe'`. That
module does not exist (`apps/web/src/test-utils/` is not a directory) and the
symbol has zero call sites in the repo. Do not write a test against it.

If you want component-level axe coverage, wiring it is real work: add
`expect.extend(toHaveNoViolations)` to `apps/web/jest.setup.ts`, then write the
helper. Until someone does that, component a11y is covered by the lint rules
above and the route audit below.

## Running a11y lint locally

```bash
pnpm --filter web lint
```

Most `jsx-a11y/*` rules are set to `"error"` and fail the lint run.
`mouse-events-have-key-events`, `no-autofocus`, and
`no-noninteractive-element-interactions` are `"warn"`
(`apps/web/eslint.config.mjs:35,37,40`).

To list only a11y findings:

```bash
pnpm --filter web lint 2>&1 | grep "jsx-a11y/"
```

## Automated axe-core route audit

`apps/web/scripts/a11y-audit.ts` boots headless Chromium, **logs in as the
seeded SUPER_ADMIN**, visits every route in `ROUTES`, and runs axe against each.

### The routes it covers

Eleven routes, not five (`a11y-audit.ts:92-107`):

`/login` · `/dashboard` · `/screens` · `/<seedTenant>/templates` ·
`/<seedTenant>/templates/builder/<seedTemplate>` · `/player` · `/panic` ·
`/<seedTenant>/emergency/broadcast` · `/<seedTenant>/reviews` ·
`/onboarding/branding` · `/<seedTenant>/screens?view=map`

### Run locally

Unauthenticated (fast, but every tenant-scoped route renders the client-side
redirect-to-login shell rather than the real page):

```bash
pnpm --filter web build
pnpm --filter web start &
pnpm a11y:ci
```

Full authenticated run — what CI does. Without a reachable API the login
attempt fails fast, logs a warning, and degrades to unauthenticated scanning:

```bash
pnpm db:push && pnpm db:seed
pnpm --filter api build && pnpm --filter api run start:prod &
pnpm --filter web build && pnpm --filter web start &
A11Y_REQUIRE_LOGIN=1 pnpm a11y:ci
```

`A11Y_REQUIRE_LOGIN=1` makes a failed login fail the build instead of silently
losing authenticated coverage — CI sets it (`a11y.yml:178`). Point at a deployed
preview with `A11Y_BASE_URL=https://your-preview.vercel.app`. Credentials
default to the seeded `admin@springfield.edu` and are overridable via
`A11Y_ADMIN_EMAIL` / `A11Y_ADMIN_PASSWORD` (`a11y-audit.ts:68-69`).

### Failure condition — it is a ratchet, not zero-tolerance

The audit does **not** fail on any error-level violation. It compares counts
against a committed baseline in `apps/web/scripts/a11y-warning-baseline.json`:

- `errorBaseline: 10` — critical/serious violations. Build fails only when the
  count **exceeds** it (`a11y-audit.ts:289-296`).
- `warningBaseline: 2` — moderate/minor violations. These **do** block:
  exceeding the baseline fails the build too (`a11y-audit.ts:307-314`).

Both baselines are **DOWN-only**. Never raise either without fixing the specific
regression and updating the `note` field explaining what changed. That note
currently carries a per-violation breakdown of all 10 errors and 2 warnings
measured 2026-08-24, including why each was not fixed (emergency-system routes
need lead sign-off; widget render trees are Taurus-shipped surfaces).

Violations are counted once per `(route, rule)` pair, not per DOM node.

### CI workflow

- File: `.github/workflows/a11y.yml` ("Accessibility (axe-core)")
- Triggers: pull requests against `main`, `master`, `develop` **and** a nightly
  run at 07:30 UTC (`a11y.yml:14-17`). The push-to-master trigger was replaced
  by the nightly sweep on 2026-08-04, so a direct push to master is caught
  within a day rather than on the push.
- The job stands up an ephemeral Postgres, runs `pnpm db:push` + `pnpm db:seed`,
  boots the built API and web, then runs `pnpm a11y:ci` (`a11y.yml:113-172`).

### Suppressing a rule

`DISABLED_RULES` in `apps/web/scripts/a11y-audit.ts:110-114` is currently
**empty** — nothing is globally suppressed. If you add an entry, add a one-line
comment saying why; reviewers should push back on any unjustified entry.

For a single page, prefer fixing the page. If suppression is unavoidable, use an
`AxeBuilder.disableRules()` call scoped inside `auditRoute` (`:123-149`) rather
than the global list.

## WCAG 2.2 AA success criteria we target

- **1.1.1** Non-text content: all images have meaningful `alt` text
- **1.3.1** Info and relationships: form inputs are programmatically associated
  with labels via `htmlFor`/`id`
- **2.1.1** Keyboard: all interactive elements are reachable and operable by
  keyboard alone
- **2.4.3** Focus order: focus sequence is logical and predictable
- **2.4.6** Headings and labels: form inputs have descriptive labels
- **4.1.2** Name, role, value: custom interactive elements expose correct ARIA
  role and accessible name

## Known open work

`docs/ACCESSIBILITY_TODO.md` records the earlier per-file backlog as resolved.
What is actually still open is the baseline itself — the 10 errors and 2
warnings enumerated in `apps/web/scripts/a11y-warning-baseline.json`. Read that
`note` field before starting a11y work; it names the file and the reason for
each.

Ways to tighten the gate from here:

1. Lower `errorBaseline` / `warningBaseline` as violations are fixed. The script
   prints "Errors reduced" / "Warnings reduced" when the live count drops below
   the committed number — that is your cue to commit the lower value.
2. Remove `continue-on-error: true` from the Lighthouse workflow
   (`.github/workflows/lighthouse.yml:61`) so its accessibility category blocks
   too.
3. Wire component-level axe coverage in Jest (see "Tools in place" above) — the
   route audit cannot reach a component that no audited route renders.
