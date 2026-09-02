/**
 * SettingsPageFrame must not loop when a page passes INLINE props.
 *
 * Three category agents hit this independently on 2026-09-02: a page that
 * hands the frame a literal `context` node, `searchItems` array or `save`
 * object re-registers on every render, registration was a provider
 * setState, the page re-rendered as a context consumer, and React threw
 * "Maximum update depth exceeded". The fix is two-fold (see
 * SettingsShellContext.tsx): the frame reads `registerPage` from a context
 * whose value never changes, and `registerPage` returns the previous state
 * when the registration is field-wise identical. This test renders the
 * worst case — inline everything, AND the page consuming the full shell
 * context — and asserts it settles.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/x/settings/branding',
}));

import { SettingsShellProvider, useSettingsShell } from '../SettingsShellContext';
import { SettingsPageFrame } from '../SettingsPageFrame';

let renders = 0;

function InlineEverythingPage() {
  renders += 1;
  // Consuming the FULL context is the pathological case: every page-state
  // change used to re-render this component and mint fresh literals below.
  const { page } = useSettingsShell();
  return (
    <SettingsPageFrame
      section="brand"
      title="Organization brand"
      description="Inline description"
      scope={{ kind: 'organization', label: 'Acme' }}
      save={{ dirty: 0, saving: false, onSave: () => {}, onDiscard: () => {} }}
      context={<div data-testid="ctx">rail</div>}
      searchItems={[{ label: 'Logo', anchor: 'logo' }]}
    >
      <div data-testid="body">registered={page ? page.title : 'none'}</div>
    </SettingsPageFrame>
  );
}

describe('SettingsPageFrame with inline props', () => {
  it('settles instead of looping, and the shell sees the registration', async () => {
    renders = 0;
    render(
      <SettingsShellProvider>
        <InlineEverythingPage />
      </SettingsShellProvider>,
    );
    expect(await screen.findByText('registered=Organization brand')).toBeInTheDocument();
    // A bounded number of renders: mount + the one re-render the registration
    // causes for a full-context consumer. Anything in the dozens is the loop.
    expect(renders).toBeLessThan(6);
  });
});
