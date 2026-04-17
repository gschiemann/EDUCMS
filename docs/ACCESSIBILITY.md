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
