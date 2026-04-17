# Accessibility

This project targets **WCAG 2.2 AA** compliance for a K-12 digital signage CMS.

## Tools in place

| Tool | Purpose |
|------|---------|
| `eslint-plugin-jsx-a11y` | Static analysis — catches missing alt text, unlabelled inputs, non-interactive div click handlers, and other authoring errors at lint time |
| `@axe-core/react` | Development-only runtime overlay — highlights violations in the browser console when running `next dev` |
| `jest-axe` | Unit/integration test helper — assert no axe violations against rendered component trees |

## Running a11y lint locally

```bash
pnpm --filter web lint
```

Errors from `jsx-a11y/*` rules fail the build. Warnings are informational.

To list only a11y violations:

```bash
pnpm --filter web lint 2>&1 | grep "jsx-a11y/"
```

## Using `expectNoA11yViolations` in tests

Import the helper from `@/test-utils/axe` in any component test:

```typescript
import { render } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test-utils/axe';
import { MyComponent } from './MyComponent';

it('has no accessibility violations', async () => {
  const { container } = render(<MyComponent />);
  await expectNoA11yViolations(container);
});
```

The helper runs axe-core against the container and calls `expect(results).toHaveNoViolations()`. Any axe violation fails the test.

## WCAG 2.2 AA success criteria we target

- **1.1.1** Non-text content: all images have meaningful `alt` text
- **1.3.1** Info and relationships: form inputs are programmatically associated with labels via `htmlFor`/`id`
- **2.1.1** Keyboard: all interactive elements are reachable and operable by keyboard alone
- **2.4.3** Focus order: focus sequence is logical and predictable
- **2.4.6** Headings and labels: form inputs have descriptive labels
- **4.1.2** Name, role, value: custom interactive elements expose correct ARIA role and accessible name

## Roadmap

**Sprint 2** will address the deferred violations logged in `docs/ACCESSIBILITY_TODO.md`:

- Convert `<div onClick>` patterns in the asset library, playlist editor, screen manager, and template editor to native `<button>` elements or add `role="button"` + keyboard handlers
- Add `htmlFor`/`id` pairs to all widget config inputs in the template editor
- Replace all `autoFocus` props with `useEffect`-based focus management

**Sprint 3** will add automated axe runs in Playwright E2E tests (already planned in the test strategy), giving full-page coverage of server-rendered output.

## Sprint 6 — Automated axe-core in CI (Live)

A headless Playwright + `@axe-core/playwright` script runs on every pull request and fails the build on any error-level (critical/serious) violation. Warnings are surfaced in the log but do not block merges yet.

### Run locally

```bash
# 1. Build + start the web app
pnpm --filter web build
pnpm --filter web start &

# 2. Wait for it to come up on localhost:3000, then run the audit
pnpm a11y:ci
```

The script hits five routes: `/login`, `/dashboard`, `/screens`, `/<schoolId>/templates`, `/player`. To point at a deployed preview, set `A11Y_BASE_URL=https://your-preview.vercel.app` before running.

### CI workflow

- File: `.github/workflows/a11y.yml`
- Trigger: pull requests against `main`, `master`, `develop`
- Failure condition: any violation with `impact === 'critical'` or `impact === 'serious'`
- Warnings (`moderate`, `minor`) are logged but pass

### Updating the allowed-warnings list

When a rule is a known false positive for our UI (e.g. the kiosk `/player` canvas intentionally hides landmarks), add the rule ID to the `DISABLED_RULES` array at the top of `apps/web/scripts/a11y-audit.ts`. Keep the list short and add a one-line comment explaining *why* the rule is suppressed — PR reviewers should push back on any unjustified entries.

For per-page exceptions, prefer fixing the page over disabling the rule globally. If suppression is unavoidable, use an `AxeBuilder.disableRules()` call scoped inside `auditRoute` rather than the global list.

### Tightening the gate

Once the baseline is clean we should:

1. Remove `continue-on-error` on the Lighthouse workflow so the accessibility category there also blocks.
2. Start failing on `moderate`-impact violations too (flip the threshold in `a11y-audit.ts`).
3. Extend the route list to cover the template builder and playlist editor once Sprint 5 lands.

