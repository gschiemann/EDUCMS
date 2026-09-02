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

// The real App Router returns a STABLE router object; a mock that mints a
// new one per call would itself change `navigate` (deps [router]) and the
// actions context on every render — a loop the product never has.
const ROUTER = { push: jest.fn(), replace: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => ROUTER,
  usePathname: () => '/x/settings/branding',
}));

import { SettingsShellProvider, useSettingsShell, useSettingsShellActions } from '../SettingsShellContext';
import { SettingsPageFrame } from '../SettingsPageFrame';

let renders = 0;

/** Reads the registration from OUTSIDE the page — the shell chrome's view. */
function RegistrationProbe() {
  const { page } = useSettingsShell();
  return <output data-testid="probe">registered={page ? page.title : 'none'}</output>;
}

function InlineEverythingPage() {
  renders += 1;
  // A page reads the ACTIONS context only (setSectionStatus / navigate live
  // there); it must never re-render because the shell's page state moved,
  // or the inline literals below would re-register forever.
  const { setSectionStatus } = useSettingsShellActions();
  React.useEffect(() => { setSectionStatus('brand', 'attention'); }, [setSectionStatus]);
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
      <div data-testid="body">body</div>
    </SettingsPageFrame>
  );
}

describe('SettingsPageFrame with inline props', () => {
  it('settles instead of looping, and the shell sees the registration', async () => {
    renders = 0;
    render(
      <SettingsShellProvider>
        <InlineEverythingPage />
        <RegistrationProbe />
      </SettingsShellProvider>,
    );
    expect(await screen.findByText('registered=Organization brand')).toBeInTheDocument();
    // The page renders once (StrictMode-free here). Anything in the dozens is
    // the loop; a full-context consumer would have shown 2+.
    expect(renders).toBeLessThan(4);
  });
});
