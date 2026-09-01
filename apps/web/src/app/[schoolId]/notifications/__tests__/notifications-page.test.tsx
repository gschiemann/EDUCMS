/**
 * M21 — the notifications inbox, proved against the real page.
 *
 * The derivation is pinned in notificationInbox.test.ts. This grades the
 * things only a render can show: that the four §13 states are four DIFFERENT
 * screens, that the tab strip answers arrow keys (the a11y gap the
 * 2026-09-01 audit flagged across the app's other tab strips), that a tap
 * marks read and routes tenant-scoped, and that the page never promises the
 * push notifications this platform does not send.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent, within } from '@testing-library/react';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ schoolId: 'hq' }),
}));

const markRead = jest.fn();
const markAll = jest.fn();
let query: any = { data: { items: [], unreadCount: 0 }, isPending: false, isError: false, isFetching: false };
const refetch = jest.fn();

jest.mock('@/hooks/use-api', () => ({
  useNotifications: () => ({ ...query, refetch }),
  useMarkNotificationRead: () => ({ mutate: markRead, isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: markAll, isPending: false }),
}));

import NotificationsPage from '../page';

const T0 = '2026-09-01T11:00:00Z';

const ITEMS = [
  { id: 'off1', kind: 'SCREEN_OFFLINE', title: 'Screen offline: Lobby', body: 'No heartbeat since 10:02.', link: '/screens', isRead: false, createdAt: T0 },
  { id: 'rev1', kind: 'INFO', title: 'New submission awaiting your review', body: '3 item(s) submitted.', link: '/reviews?id=s1', isRead: false, createdAt: '2026-09-01T10:00:00Z' },
  { id: 'sys1', kind: 'INFRA_EVENT', title: 'Licence renewed', body: null, link: null, isRead: true, createdAt: '2026-09-01T09:00:00Z' },
];

function seed(items: any[] = ITEMS, over: any = {}) {
  query = {
    data: { items, unreadCount: items.filter((i) => !i.isRead).length },
    isPending: false, isError: false, isFetching: false, ...over,
  };
}

beforeEach(() => {
  push.mockClear(); markRead.mockClear(); markAll.mockClear(); refetch.mockClear();
  seed();
});

describe('§M21 — a full-screen inbox with real categories', () => {
  it('renders every notification with its title, age and category', () => {
    render(<NotificationsPage />);
    const rows = rtl.getAllByTestId('notification-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Screen offline: Lobby');
    expect(rows[0].textContent).toContain('No heartbeat since 10:02.');
    expect(rows[0]).toHaveAttribute('data-category', 'exceptions');
    expect(rows[0]).toHaveAttribute('data-read', 'unread');
    expect(rows[2]).toHaveAttribute('data-read', 'read');
  });

  it('offers exactly the three data-backed tabs plus All, each with its count', () => {
    render(<NotificationsPage />);
    const tabs = rtl.getAllByRole('tab').map((t) => (t.textContent || '').trim());
    expect(tabs).toEqual(['All3', 'Delivery exceptions1', 'Reviews1', 'System updates1']);
    // No fourth "Requires action" tab: nothing the server emits means that
    // distinctly, and an always-empty tab is a button-shaped lie.
    expect(rtl.queryByRole('tab', { name: /requires action/i })).toBeNull();
  });

  it('filtering to a category shows only that category', () => {
    render(<NotificationsPage />);
    fireEvent.click(rtl.getByRole('tab', { name: /Reviews/ }));
    const rows = rtl.getAllByTestId('notification-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-category', 'reviews');
  });

  it('counts unread in the header, not just total', () => {
    render(<NotificationsPage />);
    expect(rtl.getByRole('heading', { level: 1 }).parentElement!.textContent).toContain('2 unread of 3');
  });
});

describe('acting on a row', () => {
  it('marks an unread row read and routes tenant-scoped', () => {
    render(<NotificationsPage />);
    fireEvent.click(rtl.getAllByTestId('notification-row')[0]);
    expect(markRead).toHaveBeenCalledWith('off1');
    expect(push).toHaveBeenCalledWith('/hq/screens');
  });

  it('does not re-mark a row that is already read', () => {
    render(<NotificationsPage />);
    fireEvent.click(rtl.getAllByTestId('notification-row')[2]);
    expect(markRead).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled(); // that row carries no link
  });

  it('Mark all read is disabled once nothing is unread', () => {
    seed(ITEMS.map((i) => ({ ...i, isRead: true })));
    render(<NotificationsPage />);
    expect(rtl.getByRole('button', { name: /mark all read/i })).toBeDisabled();
  });

  it('Mark all read fires when there is something to clear', () => {
    render(<NotificationsPage />);
    fireEvent.click(rtl.getByRole('button', { name: /mark all read/i }));
    expect(markAll).toHaveBeenCalled();
  });
});

/**
 * The 2026-09-01 audit flagged that the app's tab strips have no arrow-key
 * contract. This one does, and this is what holds it there.
 */
describe('§18 — the tab strip is operable from the keyboard', () => {
  const tabs = () => rtl.getAllByRole('tab');

  it('uses a roving tabindex — exactly one tab is in the tab order', () => {
    render(<NotificationsPage />);
    expect(tabs().filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowRight/ArrowLeft move the selection and wrap around', () => {
    render(<NotificationsPage />);
    fireEvent.keyDown(tabs()[0], { key: 'ArrowRight' });
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tabs()[1], { key: 'ArrowLeft' });
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tabs()[0], { key: 'ArrowLeft' });
    expect(tabs()[3]).toHaveAttribute('aria-selected', 'true');
  });

  it('Home and End jump to the ends', () => {
    render(<NotificationsPage />);
    fireEvent.keyDown(tabs()[0], { key: 'End' });
    expect(tabs()[3]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tabs()[3], { key: 'Home' });
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('the strip is a labelled tablist', () => {
    render(<NotificationsPage />);
    expect(rtl.getByRole('tablist', { name: 'Notification categories' })).toBeInTheDocument();
  });
});

describe('§13 — four states, four different screens', () => {
  it('Loading is a geometry-matched skeleton, not a bare spinner', () => {
    seed([], { isPending: true, data: undefined });
    render(<NotificationsPage />);
    expect(rtl.getByTestId('notifications-skeleton')).toBeInTheDocument();
    expect(rtl.queryByTestId('notifications-empty')).toBeNull();
  });

  it('Empty explains what would appear here and offers no Clear filters', () => {
    seed([]);
    render(<NotificationsPage />);
    const empty = rtl.getByTestId('notifications-empty');
    expect(empty.textContent).toContain('No notifications yet');
    expect(within(empty).queryByRole('button')).toBeNull();
  });

  /**
   * §13: "No results — preserve search/filter context, offer Clear filters,
   * do not use the first-run empty state." A filtered-to-nothing view telling
   * an operator they have no notifications at all is simply false.
   */
  it('No results keeps the filter context and offers a way back', () => {
    seed([ITEMS[0]]); // exceptions only
    render(<NotificationsPage />);
    fireEvent.click(rtl.getByRole('tab', { name: /Reviews/ }));
    const nores = rtl.getByTestId('notifications-no-results');
    expect(nores.textContent).toContain('Nothing in this category');
    expect(rtl.queryByTestId('notifications-empty')).toBeNull();
    fireEvent.click(within(nores).getByRole('button', { name: /show all/i }));
    expect(rtl.getAllByTestId('notification-row')).toHaveLength(1);
  });

  it('API unavailable says so and keeps a retry, claiming nothing about the data', () => {
    seed([], { isError: true, data: undefined });
    render(<NotificationsPage />);
    const err = rtl.getByTestId('notifications-error');
    expect(err.textContent).toContain('Can’t load notifications');
    expect(err.textContent).toMatch(/incomplete or\s+out of date/);
    fireEvent.click(within(err).getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  /**
   * §13: "API unavailable — preserve last-known data." A failed REFETCH still
   * holds React Query's previous list. Discarding it for an error card would
   * take working information away from an operator mid-incident; the honest
   * answer is to keep the rows and label them.
   */
  it('a failed refetch that still has rows keeps them, labelled, rather than blanking the list', () => {
    seed(ITEMS, { isError: true });
    render(<NotificationsPage />);
    expect(rtl.getAllByTestId('notification-row')).toHaveLength(3);
    const stale = rtl.getByTestId('notifications-stale');
    expect(stale.textContent).toMatch(/last list this device\s+received/);
    expect(rtl.queryByTestId('notifications-error')).toBeNull();
    fireEvent.click(within(stale).getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('no staleness banner while everything is fine', () => {
    render(<NotificationsPage />);
    expect(rtl.queryByTestId('notifications-stale')).toBeNull();
  });
});

/**
 * A COUNT IS ONLY A COUNT WHEN SOMETHING WAS COUNTED — the same rule the
 * fleet home's gray tiles follow (§8.4 / §19). `buildInbox(undefined)` returns
 * zeros, and printing them while the read is in flight tells an operator their
 * inbox is empty when the truth is that nobody has looked yet.
 */
describe('§19 — unknown never renders as zero', () => {
  it('while loading, neither the header nor any tab asserts a count', () => {
    seed([], { isPending: true, data: undefined });
    render(<NotificationsPage />);
    const header = rtl.getByRole('heading', { level: 1 }).parentElement!;
    expect(header.textContent).toContain('Checking for new messages');
    expect(header.textContent).not.toMatch(/\b0\b/);
    for (const t of rtl.getAllByRole('tab')) {
      expect(t.textContent).not.toMatch(/\d/);
    }
  });

  it('after a hard failure, still no zeros', () => {
    seed([], { isError: true, data: undefined });
    render(<NotificationsPage />);
    expect(rtl.getByRole('heading', { level: 1 }).parentElement!.textContent).not.toMatch(/\b0\b/);
    for (const t of rtl.getAllByRole('tab')) expect(t.textContent).not.toMatch(/\d/);
  });

  it('a genuinely empty inbox DOES say zero — that one was measured', () => {
    seed([]);
    render(<NotificationsPage />);
    expect(rtl.getByRole('heading', { level: 1 }).parentElement!.textContent).toContain('0 messages');
    expect(rtl.getByRole('tab', { name: /^All/ }).textContent).toContain('0');
  });
});

describe('§16 — no promise this platform cannot keep', () => {
  it('states that alerts arrive only while the app is open', () => {
    render(<NotificationsPage />);
    const body = document.body.textContent || '';
    expect(body).toMatch(/won’t alert you when the\s+app is closed/);
  });

  it('never uses push-notification language anywhere on the page', () => {
    render(<NotificationsPage />);
    const body = document.body.textContent || '';
    expect(body).not.toMatch(/push notification|notify your phone|background alert/i);
  });
});

describe('§15 — reachability', () => {
  it('every control clears the 44px minimum', () => {
    const { container } = render(<NotificationsPage />);
    const controls = Array.from(container.querySelectorAll('button'));
    expect(controls.length).toBeGreaterThan(5);
    for (const c of controls) expect(c.className).toMatch(/min-h-\[(4[4-9]|[5-9]\d)px\]/);
  });
});
