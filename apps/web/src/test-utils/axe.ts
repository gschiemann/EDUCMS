// jest-axe does not ship TypeScript declarations. This file wraps it with
// explicit any types so the rest of the codebase stays type-safe.
// When @types/jest-axe becomes available, replace the require with a typed import.

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const jestAxe: any = require("jest-axe");

// Extend jest/vitest matchers so `expect(results).toHaveNoViolations()` works.
expect.extend(jestAxe.toHaveNoViolations);

/**
 * Assert that a rendered container has no axe accessibility violations.
 *
 * Usage in a component test:
 *   import { expectNoA11yViolations } from '@/test-utils/axe';
 *   const { container } = render(<MyComponent />);
 *   await expectNoA11yViolations(container);
 */
export async function expectNoA11yViolations(container: Element | HTMLElement): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any = await jestAxe.axe(container);
  // toHaveNoViolations is added via expect.extend above; cast to any to avoid
  // the missing-type declaration error until @types/jest-axe is available.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (expect(results) as any).toHaveNoViolations();
}
