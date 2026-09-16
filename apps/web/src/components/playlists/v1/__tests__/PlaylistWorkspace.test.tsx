/**
 * PlaylistWorkspace + DeliveryPanel — the surfaces that carry the trust claims.
 *
 * What these lock down:
 *   • Three tabs exist, Content is the default, and the tab is what selects the
 *     panel — the route's job is only to hand it the right one.
 *   • The embedded editor STAYS MOUNTED behind Screens, because unmounting it
 *     would drop an unsaved edit and disarm its guard.
 *   • The Screens tab distinguishes three states that must never be conflated:
 *     the API answered, the API has not been asked (client derivation, stated
 *     out loud), and the API read FAILED (§22.5).
 *   • The signature gap is stated once under the list — the visible shape of
 *     the gap the mock's "Confirmed 4/4" would have hidden.
 *   • Pause everywhere is a labelled button whose confirmation carries the
 *     exact reach.
 */

import * as React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PlaylistWorkspace, type PlaylistWorkspaceProps } from '../PlaylistWorkspace';
import {
  summarizeDelivery, deriveDeliveryFromScreens, DELIVERY_UNAVAILABLE, pauseEverywhereCopy,
  type DeliveryTarget, type OpsScreenRef, type PlaylistSummaryRow,
} from '../playlistOps';

const NOW = Date.now();

const ROW: PlaylistSummaryRow = {
  id: 'p1', name: 'Lobby Promotions', kind: 'media', itemCount: 8, durationMs: 120_000,
  thumbnailUrl: null, templateSummary: null, creatorSummary: 'garlan@example.com',
  scheduleState: 'ACTIVE', statusLabel: 'ACTIVE', reviewState: null,
  reach: { screens: 4, groups: 0, locations: 0 }, scheduleSummary: 'Always',
  updatedAt: new Date(NOW - 12 * 60_000).toISOString(), sourceOwnership: 'own',
  delivery: summarizeDelivery([]), targetScreenIds: ['s1', 's2', 's3', 's4'], searchText: '',
  syncPlayback: false,
};

const PENDING = NOW - 12 * 60_000;
const SCREENS: OpsScreenRef[] = [
  { id: 's1', name: 'Front', status: 'ONLINE', pendingRefreshAt: new Date(PENDING).toISOString(), refreshAckMs: PENDING, lastRenderedAt: new Date(NOW - 10_000).toISOString(), renderHealth: 'OK', pushChannel: 'live' },
  { id: 's2', name: 'Back', status: 'ONLINE', pendingRefreshAt: new Date(PENDING).toISOString(), refreshAckMs: PENDING, lastRenderedAt: new Date(NOW - 10_000).toISOString(), renderHealth: 'OK', pushChannel: 'live' },
  { id: 's3', name: 'Side', status: 'ONLINE', pendingRefreshAt: new Date(PENDING).toISOString(), refreshAckMs: PENDING, lastRenderedAt: new Date(NOW - 10_000).toISOString(), renderHealth: 'OK', pushChannel: 'live' },
  { id: 's4', name: 'G43', status: 'ONLINE', pendingRefreshAt: new Date(PENDING).toISOString(), refreshAckMs: null, lastRenderedAt: new Date(NOW - 40 * 60_000).toISOString(), renderHealth: 'OK', pushChannel: 'stale' },
];

const G43_SUMMARY = summarizeDelivery([
  { screenId: 's1', name: 'Front', locationName: null, online: true, ackAt: PENDING, lastProofAt: null, pushChannel: 'live', state: 'acknowledged' },
  { screenId: 's2', name: 'Back', locationName: null, online: true, ackAt: PENDING, lastProofAt: null, pushChannel: 'live', state: 'acknowledged' },
  { screenId: 's3', name: 'Side', locationName: null, online: true, ackAt: PENDING, lastProofAt: null, pushChannel: 'live', state: 'acknowledged' },
  { screenId: 's4', name: 'G43', locationName: null, online: true, ackAt: null, lastProofAt: null, pushChannel: 'stale', state: 'not-updated' },
] as DeliveryTarget[]);

function mount(over: Partial<PlaylistWorkspaceProps> = {}) {
  // Rows follow the EFFECTIVE targets, so a case that overrides targetScreens
  // (the §15.1 two-screen fixture) renders two cards, not the module default's
  // four. Hard-coding them from SCREENS made those assertions vacuous.
  const effectiveTargets = over.targetScreens ?? SCREENS;
  const props: PlaylistWorkspaceProps = {
    row: ROW,
    loading: false,
    notFound: false,
    tab: 'content',
    onTab: jest.fn(),
    onBack: jest.fn(),
    editor: <div data-testid="embedded-editor">classic editor</div>,
    exportControl: <button type="button">Download</button>,
    ruleCount: 4,
    targetScreens: SCREENS,
    delivery: { payload: undefined, loading: false, derived: true, onRetry: jest.fn() },
    deliverySummary: G43_SUMMARY,
    onPauseEverywhere: jest.fn(),
    onResumeEverywhere: jest.fn(),
    pausePending: false,
    onRefreshScreen: jest.fn(),
    refreshingScreenId: null,
    onToggleSync: jest.fn(),
    syncPending: false,
    onAddScreens: jest.fn(),
    screenRows: effectiveTargets.map((s) => ({
      id: s.id,
      name: s.name || s.id,
      online: s.status === 'ONLINE',
      scheduleId: `sc-${s.id}`,
      viaGroupName: null,
      active: true,
    })),
    onToggleScreen: jest.fn(),
    onOpenScreen: jest.fn(),
    isViewer: false,
    ...over,
  };
  const utils = render(<PlaylistWorkspace {...props} />);
  return { ...utils, props };
}

// ─────────────────────────────────────────────────────────────────────
describe('keep screens in sync (2026-09-16 — moved off the screen group)', () => {
  // Greg: "we should move the option to keep screens in sync from the group
  // menu setting to the playlist settings...if i have different playlists
  // assigned to screens in the same group it doesnt make sense saying to keep
  // them in sync". It lives on Screens because that is the tab where "how does
  // this behave across screens" is the question being asked.
  it('is a switch on the Screens tab, reading the playlist row', () => {
    mount({ tab: 'screens' });
    expect(screen.getByRole('switch', { name: 'Keep screens in sync' }))
      .toHaveAttribute('aria-checked', 'false');
  });

  it('reads ON from the PLAYLIST — no group is consulted', () => {
    mount({ tab: 'screens', row: { ...ROW, syncPlayback: true } });
    expect(screen.getByRole('switch', { name: 'Keep screens in sync' }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('off → asks to turn it on', () => {
    const { props } = mount({ tab: 'screens' });
    fireEvent.click(screen.getByRole('switch', { name: 'Keep screens in sync' }));
    expect(props.onToggleSync).toHaveBeenCalledWith(true);
  });

  it('on → asks to turn it off', () => {
    const { props } = mount({ tab: 'screens', row: { ...ROW, syncPlayback: true } });
    fireEvent.click(screen.getByRole('switch', { name: 'Keep screens in sync' }));
    expect(props.onToggleSync).toHaveBeenCalledWith(false);
  });

  it('a viewer sees the state but cannot change it', () => {
    mount({ tab: 'screens', isViewer: true });
    expect(screen.getByRole('switch', { name: 'Keep screens in sync' })).toBeDisabled();
  });

  it('is inert while the write is in flight, so a double tap cannot race it', () => {
    mount({ tab: 'screens', syncPending: true });
    expect(screen.getByRole('switch', { name: 'Keep screens in sync' })).toBeDisabled();
  });

  it('stays off Content and Schedule — the header still carries no global switch (§12)', () => {
    // The shell test below asserts `queryByRole('switch')` is empty page-wide;
    // it holds because this control lives on Screens, not in the header.
    mount({ tab: 'content' });
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('workspace shell (§12)', () => {
  it('renders three tabs, named for what the operator is doing', () => {
    // Greg, 2026-09-16: "i dont think we need 4 buttons here… keep it simple".
    mount();
    expect(screen.getAllByRole('tab').map((t) => t.textContent))
      .toEqual(['Content', 'Screens', 'Schedule']);
  });

  it('states name, kind, schedule state, reach, schedule and last-updated', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Lobby Promotions' })).toBeInTheDocument();
    expect(screen.getByText('Media')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-status')).toHaveTextContent('ACTIVE');
    // The meta line splits its timestamp into a titled <span>, so assert on
    // the line's own text content rather than a single text node.
    expect(screen.getByRole('heading', { name: 'Lobby Promotions' }).parentElement!.parentElement!)
      .toHaveTextContent('4 screens · Always · updated 12 min ago');
  });

  it('carries NO global on/off switch in the header (§12)', () => {
    mount();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('surfaces the delivery exception under the header, with a way into it', () => {
    const { props } = mount();
    const box = screen.getByTestId('workspace-exception');
    expect(box).toHaveTextContent('G43 not updated · 3 of 4 received');
    fireEvent.click(within(box).getByRole('button', { name: 'Review screens' }));
    expect(props.onTab).toHaveBeenCalledWith('screens');
  });

  it('does not repeat the exception box on the Screens tab, which already leads with it', () => {
    mount({ tab: 'screens' });
    expect(screen.queryByTestId('workspace-exception')).not.toBeInTheDocument();
    // ...but the panel's own summary still says it.
    expect(screen.getByText('G43 not updated · 3 of 4 received')).toBeInTheDocument();
  });

  it('shows no exception box when delivery is healthy', () => {
    mount({
      deliverySummary: summarizeDelivery([
        { screenId: 'a', name: 'A', locationName: null, online: true, ackAt: 1, lastProofAt: null, pushChannel: 'live', state: 'acknowledged' },
      ] as DeliveryTarget[]),
    });
    expect(screen.queryByTestId('workspace-exception')).not.toBeInTheDocument();
  });

  it('a missing playlist is a real not-found, not an empty editor', () => {
    const { props } = mount({ notFound: true, row: null });
    expect(screen.getByRole('heading', { name: /That playlist isn’t here/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Playlists' }));
    expect(props.onBack).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('the embedded editor is never unmounted', () => {
  it('shows on Content and Schedule', () => {
    for (const tab of ['content', 'schedule'] as const) {
      const { unmount } = mount({ tab });
      expect(screen.getByTestId('workspace-editor')).not.toHaveClass('hidden');
      expect(screen.getByTestId('embedded-editor')).toBeInTheDocument();
      unmount();
    }
  });

  it('is HIDDEN, not removed, behind Screens — an unsaved edit survives', () => {
    for (const tab of ['screens'] as const) {
      const { unmount } = mount({ tab });
      // Still in the tree: unmounting the editor would drop the operator's
      // in-progress edit AND disarm its unsaved-change guard.
      expect(screen.getByTestId('embedded-editor')).toBeInTheDocument();
      expect(screen.getByTestId('workspace-editor')).toHaveClass('hidden');
      unmount();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('Screens tab — where it plays, and whether it arrived (§15)', () => {
  it('names one row per target with the evidence columns', () => {
    mount({ tab: 'screens' });
    // The table is gone (Greg: "not this ugly text mess"). A card per screen,
    // named, with its own power switch — so there are no column headers to
    // assert; the screens themselves are the assertion.
    expect(within(screen.getByTestId('delivery-table')).queryAllByRole('columnheader')).toHaveLength(0);
    for (const n of ['Front', 'Back', 'Side', 'G43']) {
      expect(screen.getByText(n)).toBeInTheDocument();
    }
    // Each row still carries what that screen reports about itself — the list
    // became a screen list, not an evidence-free one.
    const g43 = screen.getAllByTestId('delivery-row').find((r) => r.textContent?.includes('G43'))!;
    expect(g43).toHaveTextContent('Not received');
    expect(screen.getAllByTestId('delivery-row')).toHaveLength(4);
  });

  it('still states the signature gap — once, under the list, not per row', () => {
    // The gap must stay VISIBLE (it is why the mock's "Confirmed 4/4" was a
    // lie); it just no longer costs a column to say it four times.
    mount({ tab: 'screens' });
    expect(screen.queryByText('Not compared')).not.toBeInTheDocument();
    expect(
      screen.getByText(/No screen is checked against an expected copy/),
    ).toBeInTheDocument();
  });

  it('grades the G43 row as not received while the rest are received', () => {
    mount({ tab: 'screens' });
    const rows = screen.getAllByTestId('delivery-row');
    const g43 = rows.find((r) => r.textContent?.includes('G43'))!;
    expect(g43.dataset.state).toBe('not-updated');
    expect(g43).toHaveTextContent('Not received');
    expect(g43).toHaveTextContent('Instant commands not arriving');
    expect(rows.filter((r) => r.dataset.state === 'acknowledged')).toHaveLength(3);
  });

  it('says out loud when the numbers come from the screens rather than a deployment', () => {
    mount({ tab: 'screens' });
    expect(screen.getByText(/Built from each screen’s own last report/)).toBeInTheDocument();
  });

  it('a FAILED read is its own state with a retry — never a calm gray (§22.5)', () => {
    const onRetry = jest.fn();
    mount({
      tab: 'screens',
      delivery: { payload: null, loading: false, derived: false, onRetry },
      deliverySummary: DELIVERY_UNAVAILABLE,
    });
    // Said ONCE on the Screens tab — the panel leads with it, and the
    // header's copy is suppressed here so it does not read as two problems.
    expect(screen.getAllByText('Delivery status unavailable')).toHaveLength(1);
    expect(screen.queryByText(/Built from each screen’s own last report/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry delivery status' }));
    expect(onRetry).toHaveBeenCalled();
  });

  // ── The contradiction that started this (Greg, 2026-09-16) ──────────
  // His screenshot: "Not published" in a grey banner directly above a table
  // listing LED Poster 1 as reachable with a confirmed picture. The endpoint
  // answers `{latest: null}` for a playlist nobody has PUSHED, which is NOT
  // "on no screen" — but the summary counted it as an answer (NOT_PUBLISHED,
  // tone 'muted') while the table keyed off `payload?.latest` and listed the
  // screens anyway. One playlist, two sources, opposite claims.
  //
  // The fixture is deliberately NOT the shared SCREENS: those all carry
  // `pendingRefreshAt`, so every target grades 'not-updated' and the summary
  // is warn — which made an earlier version of this test vacuous (it passed
  // with the bug reinstated). These screens have NO pending push and a fresh
  // render proof, so they grade 'acknowledged' and the summary is tone 'ok'.
  const CLEAN_SCREENS: OpsScreenRef[] = [
    { id: 'c1', name: 'LED Poster 1', status: 'ONLINE', pendingRefreshAt: null, refreshAckMs: null,
      lastRenderedAt: new Date(NOW - 30_000).toISOString(), renderHealth: 'OK', pushChannel: 'live' },
    { id: 'c2', name: 'LED Poster 2', status: 'ONLINE', pendingRefreshAt: null, refreshAckMs: null,
      lastRenderedAt: new Date(NOW - 30_000).toISOString(), renderHealth: 'OK', pushChannel: 'live' },
  ];

  it('never says "Not published" over a screen it is listing (§15.1)', () => {
    mount({
      tab: 'screens',
      targetScreens: CLEAN_SCREENS,
      // What the route emits once `deliveryAnswered` requires a real `latest`.
      delivery: {
        payload: { latest: null, history: [] } as any,
        loading: false,
        derived: true,
        onRetry: jest.fn(),
      },
      deliverySummary: deriveDeliveryFromScreens(CLEAN_SCREENS),
    });

    // The screens ARE listed…
    expect(screen.getAllByTestId('delivery-row')).toHaveLength(2);
    // …so nothing may claim it reaches nothing.
    expect(screen.queryByText(/not published/i)).not.toBeInTheDocument();
    // …and nothing may claim a push that never happened. Raw summarizeDelivery
    // would print exactly this for two acknowledged targets; the anyPending
    // guard in deriveDeliveryFromScreens is what downgrades it.
    expect(screen.queryByText(/update received/i)).not.toBeInTheDocument();
    // NOTE: the honest summary label is deliberately NOT asserted here. The
    // tone gate above suppresses 'ok', so a healthy playlist shows no banner at
    // all — it opens straight onto the screen list. Asserting the label would
    // contradict that design. Each ROW still states its own picture evidence,
    // which is covered by the per-row tests below.
  });

  // Greg, 2026-09-16: "dump the open screen box and the refresh, just give me
  // the same settings icon with all the info as i get in the screens menu...try
  // to stay consistent so they arent learning new menus". The two bare buttons
  // are a ⋮ now, carrying the Screens page's own item names. §15.3 still holds:
  // the actions are NAMED, they just live one click in.
  it('offers named actions behind the same ⋮ the Screens page uses, never a generic Fix', () => {
    const { props } = mount({ tab: 'screens' });
    const g43 = screen.getAllByTestId('delivery-row').find((r) => r.textContent?.includes('G43'))!;
    fireEvent.click(within(g43).getByRole('button', { name: 'More actions for G43' }));
    for (const b of screen.getAllByRole('button')) {
      expect(b.textContent).not.toMatch(/^fix$/i);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
    expect(props.onOpenScreen).toHaveBeenCalledWith('s4');
  });

  it('the bare Refresh / Open screen buttons are gone from every row', () => {
    mount({ tab: 'screens' });
    expect(screen.queryByRole('button', { name: 'Refresh screen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Open screen/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^More actions for/ })).toHaveLength(4);
  });

  it('a viewer still reaches the menu — it is navigation, not a write', () => {
    mount({ tab: 'screens', isViewer: true });
    expect(screen.getAllByRole('button', { name: /^More actions for/ })).toHaveLength(4);
  });

  it('an unpublished playlist says so instead of showing an empty table', () => {
    mount({ tab: 'screens', targetScreens: [], ruleCount: 0 });
    expect(screen.getByText('Not published to any screen')).toBeInTheDocument();
    expect(screen.queryByTestId('delivery-table')).not.toBeInTheDocument();
  });

  // ── "add more screens easily" (Greg, 2026-09-16) ────────────────────
  // The button shipped switching to the Schedule tab and stopping there,
  // leaving the operator to find "Add schedule" for themselves — two hops to
  // do the thing the button is named after.
  it('“Add screens” opens the picker instead of switching tabs and stopping', () => {
    const { props } = mount({ tab: 'screens' });
    fireEvent.click(screen.getByRole('button', { name: /Add screens/ }));
    expect(props.onAddScreens).toHaveBeenCalled();
    // The teeth: a bare tab switch IS the regression. Restoring
    // `onTab('schedule')` here fails this line even though the click "worked".
    expect(props.onTab).not.toHaveBeenCalledWith('schedule');
  });

  it('is not offered to a viewer, who cannot publish anywhere', () => {
    mount({ tab: 'screens', isViewer: true });
    expect(screen.queryByRole('button', { name: /Add screens/ })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('Pause everywhere (§19.2)', () => {
  it('is a LABELLED button, not a switch', () => {
    const { props } = mount();
    const btn = screen.getByRole('button', { name: /Pause everywhere/ });
    expect(btn.tagName).toBe('BUTTON');
    fireEvent.click(btn);
    expect(props.onPauseEverywhere).toHaveBeenCalled();
  });

  it('states the exact reach before anything is disabled', () => {
    const copy = pauseEverywhereCopy('Lobby Promotions', ROW.reach, 4);
    expect(copy.title).toBe('Pause “Lobby Promotions” everywhere?');
    expect(copy.message).toBe(
      'This disables 4 publishing rules across 4 screens. Screens will fall back according to their schedule priority.',
    );
  });

  it('is not offered when there is nothing to pause, or to a viewer', () => {
    mount({ ruleCount: 0 });
    expect(screen.queryByRole('button', { name: /Pause everywhere/ })).not.toBeInTheDocument();
    document.body.innerHTML = '';
    mount({ isViewer: true });
    expect(screen.queryByRole('button', { name: /Pause everywhere/ })).not.toBeInTheDocument();
  });

  it('a paused playlist gets the SAME button, pointing the other way (§19.3)', () => {
    // This used to assert the opposite — that a paused playlist was pointed at
    // the Schedule tab rather than given a one-click resume. Greg overruled it
    // on 2026-09-16: "there should be the same button that says pause only if
    // its not playing it says play right...you just removed the button from
    // non active playlists". The old gate rendered the control ONLY while
    // playing, so a paused playlist had no way back on from this header.
    const { props } = mount({ row: { ...ROW, scheduleState: 'PAUSED', statusLabel: 'PAUSED' } });
    expect(screen.queryByRole('button', { name: /Pause everywhere/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Play everywhere/ }));
    expect(props.onResumeEverywhere).toHaveBeenCalled();
  });

  it('still offers nothing to a viewer, or with no publishing rule', () => {
    mount({ row: { ...ROW, scheduleState: 'PAUSED', statusLabel: 'PAUSED' }, isViewer: true });
    expect(screen.queryByRole('button', { name: /Play everywhere/ })).not.toBeInTheDocument();
  });
});
