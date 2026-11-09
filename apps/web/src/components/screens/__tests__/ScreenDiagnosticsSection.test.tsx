/**
 * ScreenDiagnosticsSection (2026-11-08) — the drawer's Diagnostics card:
 * the verdict card in pass / warn / fail, the next steps, the storage
 * warning, the logs row, the role gate, and the en/es/zh catalogue.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import zh from '@/i18n/messages/zh.json';
import type { DiagCheck, DiagnosticsView, DiagRequestView } from '@/hooks/use-screen-diagnostics';

let view: DiagnosticsView | undefined;
let role = 'DISTRICT_ADMIN';
const mutate = jest.fn();
jest.mock('@/hooks/use-screen-diagnostics', () => ({
  useScreenDiagnostics: () => ({ data: view, isError: false }),
  useRequestDiagnostics: () => ({ mutate, isPending: false, variables: undefined }),
  fetchLogsUrl: jest.fn(async () => ({ url: 'https://signed.example/log.txt', expiresInSeconds: 300 })),
}));
jest.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: { user: { id: string; role: string } }) => unknown) => sel({ user: { id: 'u1', role } }),
}));

import { ScreenDiagnosticsSection, checkDetail } from '../ScreenDiagnosticsSection';

const chk = (id: string, group: DiagCheck['group'], status: DiagCheck['status'], values: DiagCheck['values'] = {}): DiagCheck => ({ id, group, status, values });

export const PASS_CHECKS: DiagCheck[] = [
  chk('storage', 'device', 'pass', { freeBytes: 6e9, totalBytes: 8e9 }),
  chk('clock', 'device', 'pass', { skewSec: 1 }),
  chk('certs', 'device', 'pass', { chainLength: 3, leafDaysLeft: 61 }),
  chk('network', 'network', 'pass', { transport: 'ethernet' }),
  chk('link', 'network', 'pass', { transport: 'ethernet' }),
  chk('dns', 'network', 'pass', { ms: 24, count: 2 }),
  chk('api', 'network', 'pass', { ms: 180, status: 200 }),
  chk('address', 'network', 'pass', { ipKind: 'private', ip: '10.20.x.x', gateway: '10.20.x.x' }),
  chk('webview', 'player', 'pass', { major: 120 }),
  chk('heartbeat', 'player', 'pass', { ageSec: 12 }),
  chk('manifest', 'player', 'pass', { ageSec: 40 }),
  chk('origin', 'player', 'pass', { usage: 2e7, quota: 1.6e8, percent: 13 }),
  chk('emergency', 'player', 'pass', { entries: 12, bytes: 4e6 }),
];

const run = (verdict: 'pass' | 'warn' | 'fail', checks: DiagCheck[], status: DiagRequestView['status'] = 'complete'): DiagRequestView => ({
  id: '3f2b8c1e-9a4d-4e7b-8f10-2a3b4c5d6e7f', kind: 'SELF_TEST', status, verdict: status === 'complete' ? verdict : null,
  createdAt: '2026-11-08T15:00:00.000Z', completedAt: '2026-11-08T15:00:21.000Z', checks,
});

const base = (over: Partial<DiagnosticsView> = {}): DiagnosticsView => ({
  enabled: true, canRequestLogs: true, retentionDays: 7, storage: null, selfTest: null, logs: [], ...over,
});

async function mount(canControl = true) {
  await act(async () => { render(<ScreenDiagnosticsSection screenId="scr-1" enabled canControl={canControl} />); });
}

beforeEach(() => { view = undefined; role = 'DISTRICT_ADMIN'; mutate.mockReset(); });

describe('the verdict card', () => {
  it('PASS: every check passes and no next step is shown', async () => {
    view = base({ selfTest: run('pass', PASS_CHECKS) });
    await mount();
    expect(screen.getByTestId('diag-verdict').getAttribute('data-verdict')).toBe('pass');
    expect(screen.getByTestId('diag-verdict-pill').textContent).toBe('All checks passed');
    expect(screen.getByTestId('diag-check-storage').textContent).toContain('5.6 GB free of 7.5 GB');
    expect(screen.queryByTestId('diag-next-storage')).toBeNull();
    expect(screen.getByText('Device')).toBeTruthy();
    expect(screen.getByText('Network')).toBeTruthy();
  });

  it('WARN: weak Wi-Fi and an old engine get plain-language next steps', async () => {
    const checks = PASS_CHECKS.map((c) => c.id === 'link' ? chk('link', 'network', 'warn', { transport: 'wifi', rssi: -79 })
      : c.id === 'webview' ? chk('webview', 'player', 'warn', { major: 66, legacyPolyfills: true }) : c);
    view = base({ selfTest: run('warn', checks) });
    await mount();
    expect(screen.getByTestId('diag-verdict-pill').textContent).toBe('Needs attention');
    expect(screen.getByTestId('diag-check-link').textContent).toContain('Wi-Fi signal -79 dBm');
    expect(screen.getByTestId('diag-next-link').textContent).toMatch(/closer to the Wi-Fi access point/);
    expect(screen.getByTestId('diag-check-webview').textContent).toContain('Chrome 66 · compatibility layer on');
    expect(screen.getByTestId('diag-next-webview').className).toContain('text-amber-800');
  });

  it('FAIL: a captive portal and a DNS failure say what to do, in red', async () => {
    const checks = PASS_CHECKS.map((c) => c.id === 'network' ? chk('network', 'network', 'fail', { captivePortal: true })
      : c.id === 'dns' ? chk('dns', 'network', 'fail', { ms: 6000, error: 'UnknownHostException' }) : c);
    view = base({ selfTest: run('fail', checks) });
    await mount();
    expect(screen.getByTestId('diag-verdict-pill').textContent).toBe('Problems found');
    expect(screen.getByTestId('diag-check-network').textContent).toContain('captive portal');
    expect(screen.getByTestId('diag-next-network').className).toContain('text-rose-700');
    expect(screen.getByTestId('diag-check-dns').textContent).toContain('Lookup failed (UnknownHostException)');
  });

  it('a running test says it is waiting on the screen, never a verdict', async () => {
    view = base({ selfTest: run('pass', [], 'running') });
    await mount();
    expect(screen.getByTestId('diag-selftest-running').textContent).toBe('Running on the screen…');
    expect(screen.queryByTestId('diag-verdict')).toBeNull();
    expect((screen.getByTestId('diag-run-selftest') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Run self-test asks the API for a SELF_TEST', async () => {
    view = base();
    await mount();
    fireEvent.click(screen.getByTestId('diag-run-selftest'));
    expect(mutate.mock.calls[0][0]).toEqual({ kind: 'SELF_TEST' });
  });
});

describe('storage and logs', () => {
  it('shows the pre-degradation warning when the API grades the screen almost full', async () => {
    view = base({ storage: { warning: 'almost-full', native: { freeBytes: 6e8, totalBytes: 8e9, writeOk: true, at: '2026-11-08T15:00:00Z' }, page: null } });
    await mount();
    const w = screen.getByTestId('diag-storage-warning');
    expect(w.textContent).toBe('Storage almost full: new content may not download');
    expect(w.getAttribute('data-warning')).toBe('almost-full');
  });

  it('logs: the request carries the chosen minutes; a ready bundle offers Download', async () => {
    view = base({ logs: [{ id: 'l1', kind: 'LOGS', status: 'complete', verdict: null, checks: [], createdAt: '2026-11-08T15:00:00Z', completedAt: '2026-11-08T15:01:00Z', minutes: 15, logBytes: 412_000, logAvailable: true }] });
    await mount();
    fireEvent.change(screen.getByLabelText('Last'), { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('diag-get-logs'));
    expect(mutate.mock.calls[0][0]).toEqual({ kind: 'LOGS', minutes: 30 });
    expect(screen.getByTestId('diag-log-row').textContent).toContain('Last 15 min · 402 KB');
    expect(screen.getByTestId('diag-log-download')).toBeTruthy();
  });

  it('a school admin sees no logs section (the API refuses them too)', async () => {
    role = 'SCHOOL_ADMIN';
    view = base({ canRequestLogs: false });
    await mount();
    expect(screen.queryByTestId('diag-logs')).toBeNull();
    expect(screen.getByTestId('diag-run-selftest')).toBeTruthy();
  });

  it('a contributor sees nothing at all', async () => {
    role = 'CONTRIBUTOR';
    view = base();
    await mount();
    expect(screen.queryByTestId('screen-diagnostics')).toBeNull();
  });
});

describe('the catalogue', () => {
  const ids = ['storage', 'clock', 'certs', 'network', 'link', 'dns', 'api', 'address', 'webview', 'heartbeat', 'manifest', 'origin', 'emergency'];
  it.each([['en', en], ['es', es], ['zh', zh]])('%s has a label and a next step for every check', (_l, cat) => {
    const d = (cat as any).screens.diagnostics;
    for (const id of ids) {
      expect(typeof d.check[id]).toBe('string');
      expect(typeof d.next[id]).toBe('string');
    }
    expect(d.storageAlmostFull.length).toBeGreaterThan(5);
  });
  it('every detail line renders from numbers and codes alone', () => {
    const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ''}`;
    for (const c of PASS_CHECKS) expect(checkDetail(c, t)).not.toBeNull();
  });
});
