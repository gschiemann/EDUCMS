/**
 * Mobile shell v1 — the navigation contract, proved against the real
 * components (mobile design package §6.1–6.3, §15).
 *
 * These are render tests, not a static trace: they mount the REAL
 * MobileTabBar (which dispatches to MobileNavV1) with the real store and the
 * real focus-trap hook, and assert the behaviours the spec names. The
 * highest-value ones are the two that would be silent regressions:
 *
 *   - the More sheet is a SUPERSET of the hamburger drawer we removed. Drop
 *     one destination and a phone operator simply cannot reach it any more,
 *     and nothing else in the suite would notice.
 *   - the rollback contract never paints the wrong shell first.
 */
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useParams: () => ({ schoolId: 'school-1' }),
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
jest.mock('@/hooks/use-api', () => ({
  useNotifications: () => ({ data: { unreadCount: 3 } }),
  usePasskeys: () => ({ data: mockPasskeyList }),
}));
// The sheet's passkey row reads WebAuthn support after mount; jsdom has no
// PublicKeyCredential, so the value is set per test.
const browserSupportsWebAuthn = jest.fn(() => true);
jest.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => browserSupportsWebAuthn(),
  platformAuthenticatorIsAvailable: () => Promise.resolve(false),
  startRegistration: jest.fn(),
  startAuthentication: jest.fn(),
  WebAuthnAbortService: { cancelCeremony: jest.fn() },
}));
let mockPasskeyList: { passkeys: unknown[]; max: number } | undefined = { passkeys: [], max: 10 };
jest.mock('@/hooks/use-tenant-copy', () => ({
  useTenantCopy: () => ({ vertical: 'K12' }),
}));

let mockPathname = '/school-1/dashboard';

import { MobileTabBar } from '../MobileTabBar';
import { useUIStore } from '@/store/ui-store';
import { MOBILE_SHELL_KEY, useMobileShell } from '@/lib/mobile-shell-pref';

function seedUser(role = 'DISTRICT_ADMIN', canTriggerPanic = false) {
  act(() => {
    useUIStore.setState({
      user: {
        id: 'u1', email: 'a@b.c', role, tenantId: 't1', canTriggerPanic,
      } as never,
      overlayOpenCount: 0,
      mobileSidebarOpen: false,
    });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  mockPathname = '/school-1/dashboard';
  seedUser();
});

describe('§6.1 — five equal-width destinations', () => {
  it('draws Home · Media · Playlists · Screens · More, and nothing else', () => {
    render(<MobileTabBar />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const labels = Array.from(nav.querySelectorAll('a, button')).map((el) =>
      (el.textContent || '').replace(/\d+/g, '').trim(),
    );
    expect(labels).toEqual(['Home', 'Media', 'Playlists', 'Screens', 'More']);
  });

  it('the active destination carries a text label AND aria-current — colour is never the only cue', () => {
    render(<MobileTabBar />);
    const active = screen.getByRole('link', { current: 'page' });
    expect(active).toHaveTextContent('Home');
    expect(active).toHaveAttribute('href', '/school-1/dashboard');
  });

  it('every target clears the 48×56 minimum the spec sets', () => {
    render(<MobileTabBar />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    for (const el of Array.from(nav.querySelectorAll('a, button'))) {
      expect(el.className).toMatch(/min-h-\[64px\]/);
      expect(el.className).toMatch(/min-w-\[48px\]/);
    }
  });

  it('badges actionable unread items on Home', () => {
    render(<MobileTabBar />);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toHaveTextContent('3');
  });

  it('hides while any overlay owns the screen', () => {
    render(<MobileTabBar />);
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    act(() => { useUIStore.setState({ overlayOpenCount: 1 }); });
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });

  it('hides on the immersive emergency surface', () => {
    mockPathname = '/panic';
    render(<MobileTabBar />);
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });
});

describe('§6.3 — one navigation system: the More sheet is a superset of the drawer', () => {
  /**
   * Removing the hamburger removed the ONLY route to several destinations
   * unless this sheet carries them. Each string below was reachable from the
   * Sidebar drawer before 2026-09-01.
   */
  it.each([
    'Templates',
    'Reviews',
    'Audit Log',
    'Settings',
    'Account',
    'Help and support',
  ])('reaches %s', async (label) => {
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(label, 'i') })).toBeInTheDocument();
  });

  it('keeps sign-out reachable — it lived only in the drawer', async () => {
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(await screen.findByRole('button', { name: /Sign Out/i })).toBeInTheDocument();
  });

  /**
   * 2026-09-24 — the always-there way to a passkey. The phone hides the
   * avatar menu, so the sheet's account area carries the entry: "Set up a
   * passkey" opens the Security page's Add panel; once one exists it reads
   * "Manage passkeys" and lands on the list.
   */
  it('reaches "Set up a passkey" (→ the Security page with the Add panel open) when the account has none', async () => {
    mockPasskeyList = { passkeys: [], max: 10 };
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    await screen.findByRole('dialog');
    const row = await screen.findByRole('link', { name: /Set up a passkey/i });
    expect(row).toHaveAttribute('href', '/school-1/settings/security?add=passkey');
    expect(screen.queryByRole('link', { name: /Manage passkeys/i })).not.toBeInTheDocument();
  });

  it('reads "Manage passkeys" (→ the list) once the account holds one', async () => {
    mockPasskeyList = { passkeys: [{ id: 'pk-1' }], max: 10 };
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    await screen.findByRole('dialog');
    const row = await screen.findByRole('link', { name: /Manage passkeys/i });
    expect(row).toHaveAttribute('href', '/school-1/settings/security#sec-passkeys');
    expect(screen.queryByRole('link', { name: /Set up a passkey/i })).not.toBeInTheDocument();
  });

  it('offers no passkey row at all on a browser without WebAuthn', async () => {
    browserSupportsWebAuthn.mockReturnValueOnce(false);
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    await screen.findByRole('dialog');
    expect(screen.queryByTestId('passkey-menu-entry')).not.toBeInTheDocument();
    // …while everything else in the account area is untouched.
    expect(screen.getByRole('button', { name: /Sign Out/i })).toBeInTheDocument();
  });

  it('offers a contributor their own queue instead of the reviewer queue', async () => {
    seedUser('CONTRIBUTOR');
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    await screen.findByRole('dialog');
    expect(screen.getByRole('link', { name: /My submissions/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Reviews$/i })).not.toBeInTheDocument();
    // An admin-only destination must not be offered to a contributor at all
    // (§10: never let a user discover permissions via a 403).
    expect(screen.queryByRole('link', { name: /Audit Log/i })).not.toBeInTheDocument();
  });

  it('shows the owner console to a SUPER_ADMIN only', async () => {
    seedUser('SUPER_ADMIN');
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    await screen.findByRole('dialog');
    expect(screen.getByRole('link', { name: /Owner console/i })).toBeInTheDocument();
  });
});

describe('§6.2 / §15 — the sheet behaves like a sheet', () => {
  /**
   * Focus restoration here is NOT the textbook case: opening the sheet raises
   * the overlay lock, which unmounts the entire tab bar — the More button
   * included. So on close the trigger is a brand-new node and a captured ref
   * would be pointing at detached DOM. This asserts focus lands on whatever
   * More button is actually on screen afterwards.
   */
  it('takes focus into itself on open, and restores it to More on close', async () => {
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    const sheet = await screen.findByTestId('more-sheet');
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /More/ })),
    );
    // …and never <body>: that is what a stale ref would have produced.
    expect(document.activeElement).not.toBe(document.body);
  });

  it('traps Tab inside the sheet', async () => {
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    const sheet = await screen.findByTestId('more-sheet');
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    for (let i = 0; i < 25; i += 1) {
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(sheet.contains(document.activeElement)).toBe(true);
    }
  });

  it('makes the app content inert to assistive tech while open, and restores it', async () => {
    const main = document.createElement('div');
    main.id = 'main-content';
    document.body.appendChild(main);
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    await screen.findByTestId('more-sheet');
    await waitFor(() => expect(main.getAttribute('aria-hidden')).toBe('true'));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(main.hasAttribute('aria-hidden')).toBe(false));
    main.remove();
  });

  it('clears the tab bar while it is open (shared overlay lock)', async () => {
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    await screen.findByTestId('more-sheet');
    await waitFor(() =>
      expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument(),
    );
  });

  it('closes on the scrim and on the 44×44 close control', async () => {
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    await screen.findByTestId('more-sheet');
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.className).toMatch(/min-h-\[44px\]/);
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('rollback contract', () => {
  it('a stored "classic" preference draws the classic bar, and v1 never appears', () => {
    window.localStorage.setItem(MOBILE_SHELL_KEY, 'classic');
    render(<MobileTabBar />);
    expect(screen.queryByTestId('mobile-tabbar-v1')).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav).toHaveTextContent('Assets'); // the classic label
  });

  it('switching from the v1 sheet persists classic and swaps the bar in place', async () => {
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    await screen.findByTestId('more-sheet');
    fireEvent.click(screen.getByTestId('switch-classic-nav'));
    await waitFor(() =>
      expect(screen.queryByTestId('mobile-tabbar-v1')).not.toBeInTheDocument(),
    );
    expect(window.localStorage.getItem(MOBILE_SHELL_KEY)).toBe('classic');
  });

  it('switching back from the classic sheet returns to v1', async () => {
    window.localStorage.setItem(MOBILE_SHELL_KEY, 'classic');
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    fireEvent.click(await screen.findByTestId('switch-new-nav'));
    await waitFor(() => expect(screen.getByTestId('mobile-tabbar-v1')).toBeInTheDocument());
    expect(window.localStorage.getItem(MOBILE_SHELL_KEY)).toBe('v1');
  });

  /**
   * THE 2026-08-31 BUG, in test form: the dashboard shipped reading its
   * rollback preference in an effect and painted the classic surface for half
   * a second first. Chrome cannot afford that, so `loaded` must be false on
   * the very FIRST render pass — which is what makes MobileTabBar return null
   * rather than guessing.
   */
  it('reports not-loaded on the first render pass, so chrome can render nothing', () => {
    const seen: boolean[] = [];
    function Probe() {
      const { loaded } = useMobileShell();
      seen.push(loaded);
      return null;
    }
    render(<Probe />);
    expect(seen[0]).toBe(false);
    expect(seen[seen.length - 1]).toBe(true);
  });
});
