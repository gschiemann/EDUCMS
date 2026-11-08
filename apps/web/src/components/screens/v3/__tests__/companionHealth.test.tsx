/**
 * The companion line (2026-11-08, companionHealth.ts): the pure grading, then
 * the REAL ScreenDetailDrawer's Device card ("a green test is not proof of a
 * mount", CLAUDE.md #9). Every fixture is made up.
 */
import * as React from 'react';
import { act, render, screen as rtl } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScreenDetailDrawer } from '../ScreenDetailDrawer';
import { buildScreenOps, type OpsScreen } from '../screenOps';
import { companionHealthLine, type ManagerHealthReport } from '../companionHealth';

jest.mock('@/hooks/use-api', () => ({
  useRefreshWeb: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateScreen: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useSetScreenOrientation: () => ({ mutate: jest.fn(), isPending: false }),
  useForceApkUpdate: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteScreen: () => ({ mutate: jest.fn(), isPending: false }),
  useScreenEvents: () => ({ data: { events: [] }, isLoading: false, isError: false }),
  useScreenDeviceInventory: () => ({ data: undefined, isLoading: false, isError: false }),
  useScreenPlaybackCapability: () => ({ data: undefined, isLoading: false, isError: false }),
  useScreenInterruptions: () => ({ data: undefined, isLoading: false, isError: false }),
  useScreenUsbEvents: () => ({ data: undefined, isLoading: false, isError: false }),
  useClearPlaybackDemotion: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', role: 'SCHOOL_ADMIN' } }),
}));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: () => {} }));
jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn(async () => ({ success: true })) }));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn(async () => true) }));

const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

function health(over: Partial<ManagerHealthReport> = {}): ManagerHealthReport {
  return {
    schema: 1,
    reportedAt: iso(NOW - 2 * MIN),
    version: '1.1.66-field.1',
    watchdogTickAt: iso(NOW - 2 * MIN - 10_000),
    relaunches: { total: 0, recent: [] },
    rollback: null,
    quarantined: [],
    installPermission: true,
    installTapPendingSince: null,
    ...over,
  };
}
const input = (h: ManagerHealthReport | null, over: Record<string, unknown> = {}) => ({
  managerHealth: h,
  managerHealthAt: h?.reportedAt ?? null,
  lastPingAt: iso(NOW - 10_000),
  ...over,
});

describe('companionHealthLine', () => {
  it('no report (an older build) says nothing', () => {
    expect(companionHealthLine(input(null), NOW)).toBeNull();
    expect(companionHealthLine({ managerHealth: { schema: 2 } as never }, NOW)).toBeNull();
  });

  it('a ticking watchdog with no restarts is healthy', () => {
    expect(companionHealthLine(input(health()), NOW)).toEqual({ key: 'healthy', hint: undefined });
  });

  it('counts this week\'s restarts and names the latest reason', () => {
    const line = companionHealthLine(input(health({
      relaunches: { total: 9, recent: [
        { at: iso(NOW - 8 * DAY), reason: 'player-unresponsive' },
        { at: iso(NOW - 3 * DAY), reason: 'player-unresponsive' },
        { at: iso(NOW - DAY), reason: 'player-unresponsive' },
      ] },
    })), NOW);
    expect(line).toEqual({ key: 'healthyRestarts', values: { count: 2, reason: 'unresponsive' }, hint: undefined });
  });

  it('a pending Install tap comes first, as a warning', () => {
    const line = companionHealthLine(input(health({ installTapPendingSince: iso(NOW - 12 * MIN) })), NOW)!;
    expect(line.key).toBe('tapPending');
    expect(line.tone).toBe('warn');
    expect(line.values).toEqual({ ago: '12m' });
  });

  it('a fresh report with a silent watchdog says not reporting', () => {
    const line = companionHealthLine(input(health({ watchdogTickAt: iso(NOW - 40 * MIN) })), NOW)!;
    expect(line.key).toBe('notReporting');
    expect(line.tone).toBe('warn');
  });

  it('a report that stopped while the screen checks in is not reporting; while the screen is quiet it is only "last reported"', () => {
    const stale = health({ reportedAt: iso(NOW - 2 * 60 * MIN) });
    expect(companionHealthLine(input(stale), NOW)!.key).toBe('notReporting');
    const quiet = companionHealthLine(input(stale, { lastPingAt: iso(NOW - 2 * 60 * MIN) }), NOW)!;
    expect(quiet.key).toBe('lastReported');
    expect(quiet.tone).toBeUndefined();
  });

  it('a held-back build and a missing install permission are quiet hints', () => {
    expect(companionHealthLine(input(health({ quarantined: [10165] })), NOW)!.hint).toEqual({ key: 'quarantined', values: { count: 1 } });
    expect(companionHealthLine(input(health({ installPermission: false })), NOW)!.hint).toEqual({ key: 'noInstallPermission' });
  });
});

// ── the real drawer ─────────────────────────────────────────────────────

function screenRow(over: Partial<OpsScreen> = {}) {
  const screen: OpsScreen = {
    id: 'scr-companion-1', name: 'Test hallway screen', status: 'ONLINE',
    lastPingAt: iso(NOW - 8_000),
    renderHealth: 'OK', renderStale: false,
    lastRenderedAt: iso(NOW - 20_000), lastRenderedHash: 'content:9f2',
    pendingRefreshAt: null, pushChannel: 'live', authState: 'PROVEN',
    hardwareModel: 'Test Wall Display', resolution: '3840x2160',
    playerVersion: '1.1.66-field.1', managerVersion: '1.1.66-field.1',
    ...over,
  };
  return buildScreenOps({ screens: [screen], schedules: [], playlists: [], deployedSha: null, now: NOW }).rows[0];
}

function renderDrawer(row: ReturnType<typeof screenRow>) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ScreenDetailDrawer
        row={row} placeName="Test group" previewHref={null} canControl groups={[]} now={NOW}
        onClose={jest.fn()} onOpenDisplaySchedule={jest.fn()} pushState={undefined} onPushApk={jest.fn()}
        apkPending={false} onRefreshWeb={jest.fn()} refreshWebPending={false}
      />
    </QueryClientProvider>,
  );
  const d = rtl.getByTestId('screen-technical-details') as HTMLDetailsElement;
  act(() => {
    d.open = true;
    d.dispatchEvent(new Event('toggle'));
  });
}

const fact = (key: string) => document.querySelector(`[data-device-fact="${key}"]`);

beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

describe('ScreenDetailDrawer → Device card → Companion', () => {
  it('an old build keeps the version-only line and adds no companion row', () => {
    renderDrawer(screenRow());
    expect(fact('player')!.textContent).toContain('Manager 1.1.66-field.1');
    expect(fact('companion')).toBeNull();
  });

  it('says how the companion did this week, right under the version row', () => {
    const h = health({ relaunches: { total: 2, recent: [
      { at: iso(NOW - 2 * DAY), reason: 'player-unresponsive' },
      { at: iso(NOW - DAY), reason: 'player-unresponsive' },
    ] } });
    renderDrawer(screenRow({ managerHealth: h, managerHealthAt: h.reportedAt }));
    const row = fact('companion')!;
    expect(row.textContent).toBe('Companion healthy · restarted the player 2 times this week (it stopped responding)');
    const keys = Array.from(document.querySelectorAll('[data-device-fact]')).map((n) => n.getAttribute('data-device-fact'));
    expect(keys.indexOf('companion')).toBe(keys.indexOf('player') + 1);
  });

  it('shows a pending Install tap as a warning', () => {
    const h = health({ installTapPendingSince: iso(NOW - 5 * MIN) });
    renderDrawer(screenRow({ managerHealth: h, managerHealthAt: h.reportedAt }));
    expect(fact('companion')!.textContent).toContain('Waiting for an Install tap on the panel (for 5m)');
    expect(fact('companion')!.querySelector('p')!.className).toContain('text-amber-800');
  });
});
