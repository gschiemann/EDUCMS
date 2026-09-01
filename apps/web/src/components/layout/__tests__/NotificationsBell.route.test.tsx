/**
 * §M21 — on a phone the bell opens the inbox, not the squeezed dropdown.
 *
 * The dropdown is the right shape for a pointer and stays on desktop; it is
 * also exactly what §M21 forbids on a phone ("not a small desktop dropdown
 * squeezed onto a phone"), so below `md` the bell navigates instead.
 *
 * The rollback contract is the reason this is worth a test of its own: an
 * operator who chose Classic must get the behaviour they chose, at every
 * width, including on the phone.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, act } from '@testing-library/react';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const markRead = jest.fn();
const markAll = jest.fn();
jest.mock('@/hooks/use-api', () => ({
  useNotifications: () => ({
    data: {
      items: [{ id: 'n1', kind: 'INFO', title: 'Hello', body: null, link: '/screens', isRead: false, createdAt: new Date().toISOString() }],
      unreadCount: 1,
    },
  }),
  useMarkNotificationRead: () => ({ mutate: markRead }),
  useMarkAllNotificationsRead: () => ({ mutate: markAll, isPending: false }),
}));

import { NotificationsBell } from '../NotificationsBell';
import { useAppStore } from '@/lib/store';
import { MOBILE_SHELL_KEY } from '@/lib/mobile-shell-pref';

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
}

beforeEach(() => {
  push.mockClear();
  window.localStorage.clear();
  act(() => { useAppStore.setState({ activeTenant: 'hq' } as never); });
});

describe('the v1 shell on a phone', () => {
  it('navigates to the full inbox instead of opening a panel', () => {
    setWidth(390);
    render(<NotificationsBell />);
    fireEvent.click(rtl.getByRole('button', { name: /notifications/i }));
    expect(push).toHaveBeenCalledWith('/hq/notifications');
    expect(rtl.queryByRole('button', { name: /mark all read/i })).toBeNull();
  });

  it('keeps the unread badge on the bell either way', () => {
    setWidth(390);
    render(<NotificationsBell />);
    expect(rtl.getByRole('button', { name: 'Notifications (1 unread)' })).toBeInTheDocument();
  });
});

describe('everywhere the dropdown is still right', () => {
  it('a desktop width opens the panel rather than navigating', () => {
    setWidth(1280);
    render(<NotificationsBell />);
    fireEvent.click(rtl.getByRole('button', { name: /notifications/i }));
    expect(push).not.toHaveBeenCalled();
    expect(rtl.getByRole('button', { name: /mark all read/i })).toBeInTheDocument();
  });

  /** The rollback contract: Classic behaves exactly as it always did. */
  it('a phone on the CLASSIC shell keeps the dropdown it opted into', () => {
    window.localStorage.setItem(MOBILE_SHELL_KEY, 'classic');
    setWidth(390);
    render(<NotificationsBell />);
    fireEvent.click(rtl.getByRole('button', { name: /notifications/i }));
    expect(push).not.toHaveBeenCalled();
    expect(rtl.getByRole('button', { name: /mark all read/i })).toBeInTheDocument();
  });

  it('falls back to the panel when no tenant is selected — never routes to /undefined', () => {
    act(() => { useAppStore.setState({ activeTenant: null } as never); });
    setWidth(390);
    render(<NotificationsBell />);
    fireEvent.click(rtl.getByRole('button', { name: /notifications/i }));
    expect(push).not.toHaveBeenCalled();
    expect(rtl.getByRole('button', { name: /mark all read/i })).toBeInTheDocument();
  });
});
