/**
 * Shared harness for the Settings Command Center Workspace pages.
 *
 * Mocks at `apiFetch`, never at the hooks, so the REAL queries run with
 * their REAL URLs — that is what proves a CONTRIBUTOR fires no admin-only
 * request and that the mutations hit the endpoints their server guards
 * expect.
 */
import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsShellProvider, useSettingsShell } from '../../shell/SettingsShellContext';

export function renderInShell(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsShellProvider>
        {ui}
        <SaveProbe />
      </SettingsShellProvider>
    </QueryClientProvider>,
  );
}

/**
 * The Save button lives in the shell header, which these suites do not
 * mount. This probe surfaces the same registration the header reads, so a
 * dirty count can be asserted without rendering the whole shell.
 */
export function SaveProbe() {
  const { page } = useSettingsShell();
  const dirty = page?.save?.dirty ?? 0;
  return <output data-testid="save-probe">{String(dirty)}</output>;
}

export function Wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
