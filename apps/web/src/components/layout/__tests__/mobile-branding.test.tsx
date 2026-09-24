/**
 * Branding on the phone chrome (2026-09-21).
 *
 * Operator, from an iPhone: "Why do we carry none of the branding over to the
 * mobile version? Dashboard should still look good and have the logo and
 * name… make sure branding is all over mobile".
 *
 * The cause was that the logo existed in exactly ONE place — Sidebar.tsx —
 * and the sidebar is `md:`-only. So this suite grades two things:
 *
 *   1. The DESKTOP rail still draws the same mark it always did, now through
 *      <BrandMark />. That refactor is the risky half: the sidebar header is
 *      the most-looked-at chrome in the product and it must not shift.
 *   2. Each PHONE surface that had no branding now has it — and, just as
 *      important, an UNBRANDED tenant still sees exactly what they saw
 *      before (the product mark, no brand chip).
 */
import type { ComponentProps } from 'react';
import { render, screen, act, fireEvent, within } from '@testing-library/react';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));
jest.mock('next/navigation', () => ({
  usePathname: () => '/school-1/dashboard',
  useParams: () => ({ schoolId: 'school-1' }),
}));
// Wholesale mock — every hook any component under test reaches for. Extend
// this list rather than weakening an assertion when a component grows a hook.
jest.mock('@/hooks/use-api', () => ({
  // The chrome's passkey entry (2026-09-24) reads the list; none here.
  usePasskeys: () => ({ data: undefined }),
  usePendingAssets: () => ({ data: [] }),
  useSubmissions: () => ({ data: [] }),
  useTenantBranding: () => ({ data: null }),
  useTenantStatus: () => ({ data: { name: 'Iron Peak' } }),
  useNotifications: () => ({ data: { unreadCount: 0 } }),
}));
jest.mock('@/components/emergency/EmergencyTriggerModal', () => ({
  EmergencyTriggerModal: () => null,
}));
jest.mock('../SchoolSwitcher', () => ({
  SchoolSwitcher: () => <button type="button">Iron Peak HQ</button>,
}));
jest.mock('../NotificationsBell', () => ({ NotificationsBell: () => <button type="button">Alerts</button> }));
jest.mock('../ProfileEditModal', () => ({ ProfileEditModal: () => null }));
jest.mock('../../help/HelpDrawer', () => ({ HelpDrawer: () => null }));

import { Sidebar } from '../Sidebar';
import { TopToolbar } from '../TopToolbar';
import { MobileTabBar } from '../MobileTabBar';
import { useAppStore } from '@/lib/store';
import { MOBILE_SHELL_KEY } from '@/lib/mobile-shell-pref';

const LS_KEY = 'edu-cms-branding-cache-v1:t1';
const BRANDED = {
  displayName: 'Iron Peak',
  logoUrl: 'https://cdn.test/iron-peak.png',
  palette: { primary: '#0f766e', logoBackground: 'primary' },
};

function seedUser(role = 'DISTRICT_ADMIN') {
  act(() => {
    useAppStore.setState({
      user: { id: 'u1', email: 'a@b.c', role, tenantId: 't1', canTriggerPanic: false } as never,
      activeTenant: 'school-1',
      overlayOpenCount: 0,
      mobileSidebarOpen: false,
      isEmergencyActive: false,
    });
  });
}

function brand() {
  window.localStorage.setItem(LS_KEY, JSON.stringify(BRANDED));
}

beforeEach(() => {
  window.localStorage.clear();
  seedUser();
});

// ─────────────────────────────────────────────────────────────────────────

describe('the desktop rail is unchanged by the extraction', () => {
  it('still draws the tenant logo, in its own h-14 chip, with the name beside it', () => {
    brand();
    const { container } = render(<Sidebar />);
    const img = container.querySelector('img[src="https://cdn.test/iron-peak.png"]')!;
    expect(img).not.toBeNull();
    expect(img.className).toContain('object-contain');
    const chip = img.parentElement!;
    expect(chip.className).toMatch(/\bh-14\b/);
    expect(chip.className).toMatch(/max-w-\[160px\]/);
    // The header prints the name itself, so the mark must stay decorative —
    // otherwise every sidebar announces the tenant name twice.
    expect(img).toHaveAttribute('alt', '');
    expect(screen.getAllByText('Iron Peak').length).toBeGreaterThan(0);
  });

  it('honours the operator\'s logo-background choice on the chip', () => {
    brand();
    const { container } = render(<Sidebar />);
    const chip = container.querySelector('img')!.parentElement as HTMLElement;
    expect(chip.getAttribute('style')).toContain('brand-primary');
  });

  it('an unbranded tenant still gets the VenueOS mark', () => {
    render(<Sidebar />);
    expect(screen.getByTestId('brandmark-default')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('the phone header', () => {
  it('carries the tenant mark on the left of the mobile bar', async () => {
    brand();
    window.localStorage.setItem(MOBILE_SHELL_KEY, 'v1');
    const { container } = render(<TopToolbar />);
    const img = await screen.findByRole('img', { name: 'Iron Peak' });
    expect(img).toBeInTheDocument();
    // Phone only — the desktop already carries it in the rail, and two marks
    // on one screen would read as a bug.
    expect(img.closest('.md\\:hidden')).not.toBeNull();
    expect(container.querySelector('img')).toHaveAttribute('src', BRANDED.logoUrl);
  });

  it('the mark cannot squeeze the switcher, the bell or the emergency control', async () => {
    brand();
    window.localStorage.setItem(MOBILE_SHELL_KEY, 'v1');
    render(<TopToolbar />);
    const mark = await screen.findByRole('img', { name: 'Iron Peak' });
    // shrink-0 around the mark + min-w-0 on the switcher means the LOCATION
    // NAME truncates at 360px, never the controls on the right.
    const markSlot = mark.parentElement!;
    expect(markSlot.className).toMatch(/shrink-0/);
    expect(markSlot.nextElementSibling!.className).toMatch(/min-w-0/);
    // The right-hand controls are all still there and untouched.
    expect(screen.getAllByRole('button', { name: /Iron Peak HQ/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Alerts/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /emergency/i })).toBeInTheDocument();
  });

  it('an unbranded tenant sees the product mark, with no brand chip behind it', async () => {
    window.localStorage.setItem(MOBILE_SHELL_KEY, 'v1');
    render(<TopToolbar />);
    const mark = await screen.findByTestId('brandmark-default');
    // Scoped to the mark on purpose: the avatar's gradient has read
    // --brand-primary since 2026-05-25 and is not this change's business.
    expect(mark.getAttribute('style')).toBeNull();
    expect(mark.querySelector('[style*="brand-primary"]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('the More sheet identifies itself with the brand', () => {
  it.each(['v1', 'classic'])('%s shell: the sheet header carries the mark and the name', async (shell) => {
    brand();
    window.localStorage.setItem(MOBILE_SHELL_KEY, shell);
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    const sheet = await screen.findByRole('dialog');
    expect(sheet.querySelector('img[src="https://cdn.test/iron-peak.png"]')).not.toBeNull();
    expect(within(sheet).getByText('Iron Peak')).toBeInTheDocument();
  });

  it('an unbranded tenant gets the product mark in the sheet header, same as before', async () => {
    window.localStorage.setItem(MOBILE_SHELL_KEY, 'v1');
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByTestId('brandmark-default')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('the bottom tab bar paints its active state with the brand', () => {
  /**
   * globals.css remaps the WHOLE indigo scale onto the tenant palette
   * (`--color-indigo-600: var(--brand-primary-strong, …)`), and 500-950
   * consume the CONTRAST-GUARANTEED derivatives — ≥4.5:1 against white — so a
   * pale brand can never become an unreadable active tab (the 2026-07-22
   * VisionCore cream incident). That mapping is why the tab bar is already
   * brand-aware; this pins it, so a future refactor to slate/black — a colour
   * no brand can reach — fails here instead of shipping.
   */
  it.each(['v1', 'classic'])('%s shell: the active tab and its indicator ride the brand scale', (shell) => {
    window.localStorage.setItem(MOBILE_SHELL_KEY, shell);
    const { container } = render(<MobileTabBar />);
    const active = screen.getByRole('link', { current: 'page' });
    expect(active.className).toMatch(/text-indigo-\d00/);
    const indicator = active.querySelector('span[aria-hidden]')!;
    expect(indicator.className).toMatch(/bg-indigo-\d00/);
    expect(container.querySelector('[class*="bg-slate-900"]')).toBeNull();
  });
});
