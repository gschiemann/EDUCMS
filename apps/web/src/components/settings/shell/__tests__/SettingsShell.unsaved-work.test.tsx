/**
 * The Settings shell's dirty state reaches the unsaved-work registry.
 *
 * StaleBundleWatcher asks `hasUnsavedWork()` before a deploy may reload a
 * hidden tab on its own. The shell registers the same answer its
 * `beforeunload` guard uses; this pins that wiring through a real page
 * registration, and that unmounting the shell unregisters it.
 */
import React from 'react';
import { render } from '@testing-library/react';

const ROUTER = { push: jest.fn(), replace: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => ROUTER,
  usePathname: () => '/x/settings/branding',
}));

import { SettingsShellProvider } from '../SettingsShellContext';
import { SettingsPageFrame } from '../SettingsPageFrame';
import { hasUnsavedWork } from '@/lib/unsaved-work';

function Page({ dirty }: { dirty: boolean | number }) {
  return (
    <SettingsPageFrame section="brand" title="Organization brand" save={{ dirty }}>
      <div>body</div>
    </SettingsPageFrame>
  );
}

describe('Settings shell → unsaved-work registry', () => {
  it('reports the registered page as dirty exactly while it is dirty', () => {
    const view = render(
      <SettingsShellProvider>
        <Page dirty={0} />
      </SettingsShellProvider>,
    );
    expect(hasUnsavedWork()).toBe(false);

    view.rerender(
      <SettingsShellProvider>
        <Page dirty={2} />
      </SettingsShellProvider>,
    );
    expect(hasUnsavedWork()).toBe(true);

    view.rerender(
      <SettingsShellProvider>
        <Page dirty={false} />
      </SettingsShellProvider>,
    );
    expect(hasUnsavedWork()).toBe(false);
  });

  it('unregisters when the shell unmounts', () => {
    const view = render(
      <SettingsShellProvider>
        <Page dirty />
      </SettingsShellProvider>,
    );
    expect(hasUnsavedWork()).toBe(true);
    view.unmount();
    expect(hasUnsavedWork()).toBe(false);
  });
});
