/**
 * PlaylistLibraryV1 — render tests for the promises the mock makes.
 *
 * The derivation is tested in playlistOps.test.ts; these assert the things
 * only a render can prove: that the status tabs carry the right counts, that
 * the exception banner appears exactly when something is actionable and names
 * both the playlist and the screen, that a row has ONE primary action and its
 * anatomy is the mock's, that no global power switch or trash icon survived
 * into the row, and that the delivery cell never prints the mock's
 * unsupportable "Confirmed" claim.
 */

import * as React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PlaylistLibraryV1, type PlaylistLibraryV1Props } from '../PlaylistLibraryV1';
import {
  summarizeDelivery, DELIVERY_UNAVAILABLE, type DeliveryTarget, type PlaylistSummaryRow,
} from '../playlistOps';

jest.mock('@/components/playlists/PlaylistPreviewThumb', () => ({
  PlaylistPreviewThumb: () => <div data-testid="thumb" />,
}));

const target = (state: DeliveryTarget['state'], name: string): DeliveryTarget => ({
  screenId: name, name, locationName: null, online: state !== 'offline',
  ackAt: null, lastProofAt: null, pushChannel: 'live', state,
});

function row(over: Partial<PlaylistSummaryRow> = {}): PlaylistSummaryRow {
  return {
    id: 'p1', name: 'Member Promotions', kind: 'media', itemCount: 6, durationMs: 90_000,
    thumbnailUrl: null, templateSummary: null, creatorSummary: 'garlan@example.com',
    scheduleState: 'ACTIVE', statusLabel: 'ACTIVE', reviewState: null,
    reach: { screens: 4, groups: 2, locations: 0 },
    scheduleSummary: 'Weekdays · 5:00 AM–10:00 PM',
    updatedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    sourceOwnership: 'own',
    delivery: summarizeDelivery([
      target('acknowledged', 'A'), target('acknowledged', 'B'),
      target('acknowledged', 'C'), target('acknowledged', 'D'),
    ]),
    targetScreenIds: [], searchText: 'member promotions garlan',
    ...over,
  };
}

const G43_ROW = row({
  id: 'p4', name: 'Lobby Promotions', scheduleState: 'ACTIVE', statusLabel: 'ACTIVE',
  reach: { screens: 4, groups: 0, locations: 0 }, scheduleSummary: 'Always',
  searchText: 'lobby promotions',
  delivery: summarizeDelivery([
    target('acknowledged', 'A'), target('acknowledged', 'B'),
    target('acknowledged', 'C'), target('not-updated', 'G43'),
  ]),
});

const ROWS: PlaylistSummaryRow[] = [
  row(),
  row({ id: 'p2', name: 'Club Welcome', kind: 'template', templateSummary: 'Template · 1920×1080', searchText: 'club welcome' }),
  row({ id: 'p3', name: 'Class Schedule', scheduleState: 'SCHEDULED', statusLabel: 'SCHEDULED', scheduleSummary: 'Starts Sep 20 · 4:00 PM', searchText: 'class schedule' }),
  G43_ROW,
  row({
    id: 'p5', name: 'New Member Orientation', scheduleState: 'UNASSIGNED', statusLabel: 'UNASSIGNED',
    reach: { screens: 0, groups: 0, locations: 0 }, scheduleSummary: 'Not scheduled',
    delivery: summarizeDelivery([]), searchText: 'new member orientation',
  }),
];

/**
 * jsdom has no media queries, so BOTH the desktop table and the <lg card list
 * render. Every lookup below is scoped to one of them on purpose.
 */
function rowNamed(name: string): HTMLElement {
  const hit = screen.getAllByTestId('playlist-row').find((r) => r.textContent?.includes(name));
  if (!hit) throw new Error(`no row for ${name}`);
  return hit;
}

function mount(over: Partial<PlaylistLibraryV1Props> = {}) {
  const props: PlaylistLibraryV1Props = {
    rows: ROWS,
    rawById: new Map(ROWS.map((r) => [r.id, { id: r.id, name: r.name, items: [] }])),
    templateLookup: {},
    loading: false,
    error: false,
    onRetry: jest.fn(),
    onOpen: jest.fn(),
    onReviewDelivery: jest.fn(),
    onNew: jest.fn(),
    onPreview: jest.fn(),
    onDuplicate: jest.fn(),
    onExport: jest.fn(),
    onRemove: jest.fn(),
    onPublishSchedule: jest.fn(),
    onPublishToLocations: jest.fn(),
    onSubmitForReview: jest.fn(),
    onSwitchClassic: jest.fn(),
    isViewer: false,
    isContributor: false,
    isHQ: false,
    creatorOptions: ['garlan@example.com'],
    screenOptions: [{ id: 's1', name: 'G43' }],
    groupOptions: [{ id: 'g1', name: 'Lobby Wall' }],
    groupOfScreen: new Map(),
    locationNoun: 'locations',
    deliveryDerived: true,
    ...over,
  };
  const utils = render(<PlaylistLibraryV1 {...props} />);
  return { ...utils, props };
}

// ─────────────────────────────────────────────────────────────────────
describe('header + status navigation (§7.2, §7.3)', () => {
  it('summarises honestly: total and active', () => {
    mount();
    expect(screen.getByTestId('library-summary')).toHaveTextContent('5 playlists · 3 active');
  });

  it('renders all five tabs with their counts, attention overlapping active', () => {
    mount();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'All5', 'Active3', 'Scheduled1', 'Unassigned1', 'Needs attention1!',
    ]);
  });

  it('filters to the exception set when Needs attention is chosen', () => {
    mount();
    fireEvent.click(screen.getByRole('tab', { name: /Needs attention/ }));
    const rows = screen.getAllByTestId('playlist-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Lobby Promotions');
  });

  it('shows no amber flag when nothing needs attention', () => {
    mount({ rows: [row()] });
    const tab = screen.getByRole('tab', { name: /Needs attention/ });
    expect(tab.textContent).toBe('Needs attention0');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('exception banner (§7.5)', () => {
  it('names the playlist AND the screen, and links at that playlist', () => {
    const { props } = mount();
    const banner = screen.getByTestId('exception-banner');
    expect(banner).toHaveTextContent('1 playlist needs attention');
    expect(banner).toHaveTextContent(
      'Lobby Promotions is active, but G43 has not received the latest update.',
    );
    fireEvent.click(within(banner).getByRole('button', { name: 'Review delivery' }));
    expect(props.onReviewDelivery).toHaveBeenCalledWith('p4');
  });

  it('does not render when nothing is actionable', () => {
    mount({ rows: [row(), row({ id: 'p2', name: 'Second' })] });
    expect(screen.queryByTestId('exception-banner')).not.toBeInTheDocument();
  });

  it('dismissal is session-scoped only — it never resolves anything', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss for this visit/ }));
    expect(screen.queryByTestId('exception-banner')).not.toBeInTheDocument();
    // The row is still flagged; only the banner was hidden.
    expect(screen.getAllByTestId('playlist-row').some((r) => r.dataset.attention === 'true')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('row anatomy (§8.2, §29)', () => {
  it('gives each row a preview, a name, a content summary and the four facts', () => {
    mount();
    const r = rowNamed('Member Promotions');
    expect(within(r).getByTestId('thumb')).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: 'Member Promotions' })).toBeInTheDocument();
    expect(r).toHaveTextContent('6 items · 1:30');
    expect(r).toHaveTextContent('4 screens · 2 groups');   // Publishing
    expect(r).toHaveTextContent('Weekdays · 5:00 AM–10:00 PM'); // Schedule
    expect(r).toHaveTextContent('Update received on 4 of 4'); // Delivery
    expect(r).toHaveTextContent('18 min ago');              // Updated
  });

  it('describes a template playlist by its canvas', () => {
    mount();
    const r = rowNamed('Club Welcome');
    expect(r).toHaveTextContent('Template · 1920×1080');
  });

  it('has exactly ONE primary action per row — Open, or Review on an exception', () => {
    mount();
    const rows = screen.getAllByTestId('playlist-row');
    const healthy = rowNamed('Member Promotions');
    expect(within(healthy).getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(within(healthy).queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();

    const exception = rows.find((r) => r.dataset.attention === 'true')!;
    expect(within(exception).getByRole('button', { name: 'Review' })).toBeInTheDocument();
    expect(within(exception).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('the exception row is a pale surface, not a colour-only signal', () => {
    mount();
    const exception = screen.getAllByTestId('playlist-row').find((r) => r.dataset.attention === 'true')!;
    expect(exception.className).toContain('amber');
    // The state is also stated in words, twice: the pill and the cell.
    expect(within(exception).getByTestId('status-pill')).toHaveTextContent('NEEDS ATTENTION');
    expect(within(exception).getByTestId('delivery-cell')).toHaveTextContent('G43 not updated');
  });

  it('carries NO global power switch and NO persistent trash icon (§29)', () => {
    mount();
    const r = rowNamed('Member Promotions');
    expect(within(r).queryByRole('switch')).not.toBeInTheDocument();
    expect(within(r).queryByRole('checkbox')).not.toBeInTheDocument();
    for (const b of within(r).getAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/delete/i);
    }
  });

  it('the table has real column headers (§25)', () => {
    mount();
    const headers = within(screen.getByTestId('playlist-table')).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual([
      'Playlist', 'Status', 'Publishing', 'Schedule', 'Delivery', 'Updated', 'Actions',
    ]);
  });

  it('opens the workspace from the row name', () => {
    const { props } = mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Member Promotions' })[0]);
    expect(props.onOpen).toHaveBeenCalledWith('p1');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('the delivery column never overclaims (§4.3, §10)', () => {
  it('says "Update received", never the mock’s "Confirmed 4/4"', () => {
    mount();
    const cells = within(screen.getByTestId('playlist-table')).getAllByTestId('delivery-cell');
    const text = cells.map((c) => c.textContent).join(' | ');
    expect(text).toContain('Update received on 4 of 4');
    expect(text).not.toMatch(/Confirmed 4\/4/);
    expect(text).not.toMatch(/\bLIVE\b/i);
    expect(text).not.toMatch(/\bDelivered\b/i);
  });

  it('an unpublished row reads Not published, in muted tone', () => {
    mount();
    const cell = within(rowNamed('New Member Orientation')).getByTestId('delivery-cell');
    expect(cell).toHaveTextContent('Not published');
    expect(cell.dataset.tone).toBe('muted');
  });

  it('an unavailable delivery read offers a retry and is never a healthy gray (§22.5)', () => {
    const { props } = mount({
      rows: [row({ delivery: DELIVERY_UNAVAILABLE })],
    });
    const cell = within(screen.getByTestId('playlist-table')).getByTestId('delivery-cell');
    expect(cell).toHaveTextContent('Delivery status unavailable');
    expect(cell.dataset.tone).toBe('unavailable');
    fireEvent.click(within(cell).getByRole('button', { name: 'Retry delivery status' }));
    expect(props.onRetry).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('search, filters, states', () => {
  it('search narrows the list', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Search playlists'), { target: { value: 'club' } });
    const rows = screen.getAllByTestId('playlist-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Club Welcome');
  });

  it('advanced filters are behind a disclosure, not four open dropdowns (§21.2)', () => {
    mount();
    // Only the sort select is on the toolbar itself.
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    expect(screen.getByLabelText('Content type')).toBeInTheDocument();
    expect(screen.getByLabelText('Delivery')).toBeInTheDocument();
  });

  it('a failed load is an error state, never an empty library (§22.4)', () => {
    const { props } = mount({ error: true, rows: [] });
    expect(screen.getByText('Playlists couldn’t be loaded')).toBeInTheDocument();
    expect(screen.queryByText('Create your first playlist')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it('an empty library invites the first playlist (§22.2)', () => {
    mount({ rows: [] });
    expect(screen.getByText('Create your first playlist')).toBeInTheDocument();
  });

  it('no filter match offers a way back (§22.3)', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Search playlists'), { target: { value: 'zzzz' } });
    expect(screen.getByText('No playlists match these filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByTestId('playlist-row')).toHaveLength(5);
  });

  it('loading keeps the header and controls stable (§22.1)', () => {
    mount({ loading: true, rows: [] });
    expect(screen.getByRole('heading', { name: 'Playlists' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search playlists')).toBeInTheDocument();
    expect(screen.getByText('Loading playlists…')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('roles + overflow (§8.4, §22.7)', () => {
  it('a restricted viewer gets no create button and no destructive overflow entry', () => {
    mount({ isViewer: true });
    expect(screen.getByRole('button', { name: /New playlist/ })).toBeDisabled();
    fireEvent.click(within(rowNamed('Member Promotions')).getByRole('button', { name: /More actions for Member Promotions/ }));
    const menu = screen.getByRole('menu', { name: /Actions for Member Promotions/ });
    const labels = within(menu).getAllByRole('menuitem').map((i) => i.textContent);
    expect(labels).not.toContain('Remove playlist');
    expect(labels).not.toContain('Publish or schedule');
  });

  it('a contributor is offered review, not direct publishing', () => {
    mount({ isContributor: true });
    fireEvent.click(within(rowNamed('Member Promotions')).getByRole('button', { name: /More actions for Member Promotions/ }));
    const menu = screen.getByRole('menu', { name: /Actions for Member Promotions/ });
    const labels = within(menu).getAllByRole('menuitem').map((i) => i.textContent);
    expect(labels).toContain('Send for review');
    expect(labels).not.toContain('Publish or schedule');
  });

  it('every overflow entry is LABELLED, and removal is the labelled one too', () => {
    const { props } = mount();
    fireEvent.click(within(rowNamed('Member Promotions')).getByRole('button', { name: /More actions for Member Promotions/ }));
    const menu = screen.getByRole('menu', { name: /Actions for Member Promotions/ });
    for (const item of within(menu).getAllByRole('menuitem')) {
      expect((item.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove playlist' }));
    expect(props.onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
  });

  it('Escape closes the overflow and returns focus to its trigger (§25)', () => {
    mount();
    const trigger = within(rowNamed('Member Promotions')).getByRole('button', { name: /More actions for Member Promotions/ });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: /Actions for Member Promotions/ })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: /Actions for Member Promotions/ })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('the HQ fleet action shows only for an HQ tenant, with the vertical’s noun', () => {
    mount({ isHQ: false });
    expect(screen.queryByRole('button', { name: /Publish to/ })).not.toBeInTheDocument();
    document.body.innerHTML = '';
    mount({ isHQ: true, locationNoun: 'gyms' });
    expect(screen.getAllByRole('button', { name: 'Publish to gyms' }).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('rollback', () => {
  it('offers a quiet Classic view escape', () => {
    const { props } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Classic view' }));
    expect(props.onSwitchClassic).toHaveBeenCalled();
  });
});
