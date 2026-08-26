/**
 * Render-level proof that the schedule editor tells the operator the truth
 * about "off" BEFORE they save.
 *
 * WHY THIS FILE EXISTS. On 2026-08-25 the operator saved one 07:00/14:45
 * window on a screen GROUP and got four different outcomes across five
 * panels — one dark and unrecoverable, two rebooted, two that did nothing.
 * Every one of those outcomes was predictable from the panel's own reported
 * power mechanism, and this editor showed none of it. The server now routes
 * each panel's scheduled off onto the path its hardware can survive; this
 * asserts the editor SAYS SO, in the DOM, not merely in a resolver object.
 *
 * Same discipline as ScreenDisplayControls.test.tsx next door, and for the
 * same reason (CLAUDE.md §9): a logic test passing while the string never
 * reaches the screen is this repo's signature failure.
 */

import * as React from 'react';
import { render, screen as rtl } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import en from '@/i18n/messages/en.json';
import { DisplayScheduleModal } from '../DisplayScheduleModal';

/** Verdict fixtures, in the envelope the column actually holds. */
const stored = (screenBlank: string) => ({
  schema: 1,
  reportedAt: 1_760_000_000_000,
  build: { manufacturer: 'Droidlogic', model: 'M43GUQ-CS1382D-C' },
  verdict: {
    volume: 'audiomanager',
    brightness: 'settings',
    screenBlank,
    reboot: 'none',
    hardPowerOff: 'none',
    deviceOwnerPath: 'blocked-other-owner',
  },
});

let screensFixture: any[] = [];

jest.mock('@/hooks/use-api', () => ({
  useDisplaySchedules: () => ({ data: [], isLoading: false }),
  useCreateDisplaySchedule: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateDisplaySchedule: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteDisplaySchedule: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useScreens: () => ({ data: screensFixture }),
}));

jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));

// `screens.display` holds a nested `note` object alongside its strings, so
// it is not assignable to Record<string, string> directly.
const COPY = en.screens.display as unknown as Record<string, string>;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * The two soft-off lines deliberately OPEN with the same sentence — they say
 * the same thing about the same behaviour — so identifying them by their
 * shared prefix would match either. Match the distinctive TAIL of the
 * all-panels line instead; the "some" line is identified by its counts.
 */
const SOFT_ALL = new RegExp(esc(COPY.scheduleSoftOffAll.slice(-40)));

function renderModal(target: {
  kind: 'screen' | 'group';
  id: string;
  name: string;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DisplayScheduleModal target={target} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

const SCREEN_TARGET = { kind: 'screen' as const, id: 's1', name: 'G43' };
const GROUP_TARGET = { kind: 'group' as const, id: 'g1', name: 'Front of house' };

describe('DisplayScheduleModal — what "off" will actually do', () => {
  afterEach(() => {
    screensFixture = [];
  });

  it('warns on a single panel whose power we have never proven', () => {
    // The G43's real verdict on the night of the incident.
    screensFixture = [{ id: 's1', displayCapabilities: stored('device-admin') }];
    renderModal(SCREEN_TARGET);
    expect(rtl.getByText(SOFT_ALL)).toBeInTheDocument();
  });

  it('warns on a panel that has never reported at all', () => {
    screensFixture = [{ id: 's1', displayCapabilities: null }];
    renderModal(SCREEN_TARGET);
    expect(rtl.getByText(SOFT_ALL)).toBeInTheDocument();
  });

  it('says NOTHING extra when the panel can genuinely cut its own power', () => {
    // A warning on hardware that does exactly what the operator expects is
    // noise, and noise is how a real warning stops being read.
    screensFixture = [{ id: 's1', displayCapabilities: stored('vendor-recipe') }];
    renderModal(SCREEN_TARGET);
    expect(rtl.queryByText(SOFT_ALL)).toBeNull();
  });

  it('counts a MIXED group per panel — the incident group’s own shape', () => {
    screensFixture = [
      { id: 'a', screenGroupId: 'g1', displayCapabilities: stored('vendor-recipe') },
      { id: 'b', screenGroupId: 'g1', displayCapabilities: stored('device-admin') },
      { id: 'c', screenGroupId: 'g1', displayCapabilities: stored('screen-timeout') },
      { id: 'd', screenGroupId: 'g1', displayCapabilities: null },
      // Another group's screen must not be counted.
      { id: 'e', screenGroupId: 'g2', displayCapabilities: stored('device-admin') },
    ];
    renderModal(GROUP_TARGET);
    // "3 of these 4 screens…" — resolved per member, not per group.
    expect(rtl.getByText(/\b3 of these 4\b/)).toBeInTheDocument();
    expect(rtl.queryByText(SOFT_ALL)).toBeNull();
  });

  it('reads the group through the nested relation too', () => {
    // GET /screens rows carry `screenGroupId`; the grouped list payload
    // carries `screenGroup.id`. Accept either rather than warn about nothing.
    screensFixture = [
      { id: 'a', screenGroup: { id: 'g1' }, displayCapabilities: stored('device-admin') },
    ];
    renderModal(GROUP_TARGET);
    expect(rtl.getByText(SOFT_ALL)).toBeInTheDocument();
  });

  it('warns about nothing while the fleet list is still loading', () => {
    // An empty list must not render "0 of these 0 screens".
    screensFixture = [];
    renderModal(GROUP_TARGET);
    expect(rtl.queryByText(SOFT_ALL)).toBeNull();
    expect(rtl.queryByText(/of these/)).toBeNull();
  });

  it('keeps the standing explainer — the new line adds to it, never replaces it', () => {
    screensFixture = [{ id: 's1', displayCapabilities: stored('device-admin') }];
    renderModal(SCREEN_TARGET);
    expect(
      rtl.getByText(new RegExp(COPY.scheduleExplainer.slice(0, 40))),
    ).toBeInTheDocument();
  });
});
