/**
 * /super/field-builds — the panel's state, rendered over a fake API.
 *
 * Mocked at `apiFetch`, not at the hooks, so the REAL use-api hooks run with
 * their real URLs and bodies. Proves: owner-only (no request for anyone
 * else); the registered builds show size, digest prefix, CI link and mirror
 * state; the arm form preselects the newest allowed + mirrored build, lists
 * only reachable organizations and sends the exact body; server refusals are
 * shown in words; the open window shows its countdown and each screen's
 * version and push state; Push now waits out the settle time, never offers a
 * screen already on the build, and sends one screen with the chosen
 * update-hours option; Cancel goes through the confirm dialog.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const T0 = Date.UTC(2026, 9, 18, 15, 0, 0);
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const S2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const S3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const W1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const iso = (ms: number) => new Date(ms).toISOString();

const CANDIDATES = [
  { versionName: '1.1.42-field.1', versionCode: 10142, sha256: 'ab12cd34ef56' + '0'.repeat(52), size: 2_420_475, sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/42', allowed: true, blockedReason: null, mirror: { state: 'missing', httpStatus: 404, checkedAt: iso(T0) } },
  { versionName: '1.1.41-field.1', versionCode: 10141, sha256: 'ff00ee11dd22' + '1'.repeat(52), size: 2_403_987, sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/41', allowed: true, blockedReason: null, mirror: { state: 'present', httpStatus: 200, checkedAt: iso(T0) } },
  { versionName: '1.1.40-field.1', versionCode: 10140, sha256: '99'.repeat(32), size: 2_403_987, sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/40', allowed: false, blockedReason: 'version-quarantined:1.1.40-field.1', mirror: { state: 'present', httpStatus: 200, checkedAt: iso(T0) } },
];
const LIMITS = { minMinutes: 5, maxMinutes: 1440, maxPushScreens: 10, pushSettleMs: 12_000, gateTtlMs: 10_000 };
const NO_VARIABLES = { configured: false, candidate: null, tenantIds: [], screens: [], expiresAt: null, live: false };
const ACTIVE = {
  id: W1,
  candidate: '1.1.42-field.1',
  candidateSha256: CANDIDATES[0].sha256,
  versionCode: 10142,
  tenants: [{ id: T1, name: 'Bench' }],
  allScreens: false,
  screenIds: [S1, S2],
  armedAt: iso(T0 - 60_000),
  expiresAt: iso(T0 + 2 * 3_600_000),
  armedBy: { userId: 'super-1', email: 'owner@example.test' },
  cancelledAt: null,
  cancelledBy: null,
  note: 'pacing soak',
  state: 'active',
  pushReadyAt: iso(T0 - 48_000),
};
const screenRow = (patch: Record<string, unknown>) => ({
  tenantId: T1,
  tenantName: 'Bench',
  status: 'ONLINE',
  online: true,
  lastPingAt: iso(T0 - 5_000),
  playerVersion: '1.1.29',
  playerVersionCode: 10129,
  playerVersionAt: iso(T0 - 60_000),
  forceApkUpdatePendingAt: null,
  forceApkUpdateHold: null,
  forceApkUpdateHoldAt: null,
  forceApkUpdateHoldReason: null,
  forceApkUpdateOfferCount: 0,
  forceApkUpdateLastOfferAt: null,
  forceApkUpdateTargetVersion: null,
  ...patch,
});
const SCREENS = [
  screenRow({ id: S1, name: 'Lobby' }),
  screenRow({ id: S2, name: 'Gym', playerVersion: '1.1.42-field.1', playerVersionCode: 10142, forceApkUpdatePendingAt: iso(T0 - 30_000), forceApkUpdateOfferCount: 1 }),
  screenRow({ id: S3, name: 'Cafe', online: false }),
];

let role = 'SUPER_ADMIN';
let windows: any;
let armError: any = null;
const calls: Array<{ path: string; method: string; body?: any }> = [];
const apiFetch = jest.fn(async (path: string, opts: any = {}) => {
  const method = opts.method ?? 'GET';
  calls.push({ path, method, body: opts.body ? JSON.parse(opts.body) : undefined });
  if (path === '/super/field-builds/windows' && method === 'GET') return windows;
  if (path === '/super/field-builds/candidates') return { candidates: CANDIDATES };
  if (path.startsWith('/super/field-builds/screens?')) return { screens: SCREENS, unreachable: [] };
  if (path === '/tenants/accessible') {
    return {
      current: T1,
      tenants: [
        { id: T1, name: 'Bench', slug: 'bench', parentId: null, supportAccess: 'internal' },
        { id: T2, name: 'Some Customer', slug: 'customer', parentId: null, supportAccess: null },
      ],
    };
  }
  if (path === '/super/field-builds/windows' && method === 'POST') {
    if (armError) throw armError;
    return { ...ACTIVE, id: 'new-window' };
  }
  if (path === `/super/field-builds/windows/${W1}/push`) {
    const body = JSON.parse(opts.body);
    return { results: body.screenIds.map((id: string) => ({ screenId: id, name: 'x', armed: true, published: true, corrId: 'field-1', pushAt: iso(T0) })) };
  }
  if (path === `/super/field-builds/windows/${W1}/cancel`) return { window: { ...ACTIVE, state: 'cancelled' }, cancelled: true, pushesCancelled: [S1] };
  throw new Error(`unexpected ${method} ${path}`);
});
jest.mock('@/lib/api-client', () => ({ apiFetch: (p: string, o?: any) => apiFetch(p, o), getApiUrl: () => 'http://api.test/api/v1' }));
jest.mock('@/lib/store', () => ({ useAppStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'super-1', role } }) }));
const appConfirm = jest.fn(async (_o?: any) => true);
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: (o: any) => appConfirm(o) }));

import {
  FieldBuildsPanel,
  clockOffset,
  defaultCandidate,
  errorKey,
  pushBlock,
  splitDuration,
  windowScreens,
} from '../FieldBuildsPanel';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  // Freeze the clock only: React Query and the 1 s ticker keep real timers.
  jest.useFakeTimers({
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
  });
  jest.setSystemTime(T0);
  role = 'SUPER_ADMIN';
  windows = { now: iso(T0), effective: 'none', active: null, windows: [], variables: NO_VARIABLES, limits: LIMITS };
  armError = null;
  calls.length = 0;
  apiFetch.mockClear();
  appConfirm.mockClear();
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe('pure helpers', () => {
  it('splits a countdown, reads the server clock offset, and picks the default build', () => {
    expect(splitDuration(2 * 3_600_000 + 5 * 60_000 + 7_000)).toEqual({ h: 2, m: 5, s: 7 });
    expect(splitDuration(-5)).toEqual({ h: 0, m: 0, s: 0 });
    expect(clockOffset(iso(T0 + 1_500), T0)).toBe(1_500);
    expect(clockOffset(undefined, T0)).toBe(0);
    expect(defaultCandidate(CANDIDATES as any)).toBe('1.1.41-field.1');
    expect(defaultCandidate([{ ...CANDIDATES[0] }] as any)).toBe('1.1.42-field.1');
    expect(defaultCandidate([CANDIDATES[2]] as any)).toBe('');
  });

  it('scopes a window to its screens and says why a push is unavailable', () => {
    const named = windowScreens({ allScreens: false, screenIds: [S2, 'gone'], tenants: [] }, SCREENS as any);
    expect(named.map((x) => [x.id, x.screen?.name ?? null])).toEqual([[S2, 'Gym'], ['gone', null]]);
    const all = windowScreens({ allScreens: true, screenIds: [], tenants: [{ id: T1, name: null }] }, [
      ...SCREENS,
      screenRow({ id: 'r', name: 'Revoked', status: 'REVOKED' }),
      screenRow({ id: 'o', name: 'Other', tenantId: T2 }),
    ] as any);
    expect(all.map((x) => x.id)).toEqual([S1, S2, S3]);
    expect(pushBlock(SCREENS[0] as any, ACTIVE, T0)).toBeNull();
    expect(pushBlock(SCREENS[1] as any, ACTIVE, T0)).toBe('on-build');
    expect(pushBlock(SCREENS[0] as any, { ...ACTIVE, pushReadyAt: iso(T0 + 1) }, T0)).toBe('settling');
    expect(pushBlock({ ...SCREENS[0], status: 'REVOKED' } as any, ACTIVE, T0)).toBe('revoked');
    expect(errorKey({ code: 'FIELD_BUILD_WINDOW_ACTIVE' })).toBe('FIELD_BUILD_WINDOW_ACTIVE');
    expect(errorKey({ code: 'SOMETHING_ELSE' })).toBe('generic');
    expect(errorKey(new Error('x'))).toBe('generic');
  });
});

describe('/super/field-builds panel', () => {
  it('is owner-only and makes no request for anyone else', async () => {
    role = 'DISTRICT_ADMIN';
    wrap(<FieldBuildsPanel />);
    expect(await screen.findByText('Owner-only area')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('lists the registered builds with size, digest prefix, CI link and mirror state', async () => {
    wrap(<FieldBuildsPanel />);
    const section = (await screen.findByRole('heading', { name: 'Registered builds' })).closest('section')!;
    await within(section).findByText('1.1.42-field.1');
    const row42 = within(section).getByText('1.1.42-field.1').closest('li')!;
    expect(within(row42).getByText('2.3 MB')).toBeInTheDocument();
    expect(within(row42).getByText('SHA-256 ab12cd34ef56…')).toBeInTheDocument();
    expect(within(row42).getByRole('link', { name: /CI run/ })).toHaveAttribute('href', 'https://github.com/gschiemann/EDUCMS/actions/runs/42');
    expect(within(row42).getByText('Not mirrored')).toBeInTheDocument();
    const row41 = within(section).getByText('1.1.41-field.1').closest('li')!;
    expect(within(row41).getByText('Mirrored')).toBeInTheDocument();
    const row40 = within(section).getByText('1.1.40-field.1').closest('li')!;
    expect(within(row40).getByText('Blocked by fleet policy')).toBeInTheDocument();
  });

  it('with nothing offered, arms a window for chosen screens with the exact body', async () => {
    wrap(<FieldBuildsPanel />);
    expect(await screen.findByText('No field build is being offered. Every screen gets the ordinary releases.')).toBeInTheDocument();
    const form = (await screen.findByRole('heading', { name: 'Arm a window' })).closest('section')!;
    const build = within(form).getByRole('combobox', { name: 'Build' }) as HTMLSelectElement;
    await waitFor(() => expect(build.value).toBe('1.1.41-field.1'));
    // The blocked build is not offered; the unmirrored one says so.
    expect(within(build).queryByRole('option', { name: /1\.1\.40/ })).toBeNull();
    expect(within(build).getByRole('option', { name: '1.1.42-field.1 — not in storage' })).toBeInTheDocument();
    // Only organizations VenueOS support can reach.
    const bench = await within(form).findByRole('checkbox', { name: 'Bench' });
    expect(within(form).queryByRole('checkbox', { name: 'Some Customer' })).toBeNull();
    const submit = within(form).getByRole('button', { name: 'Arm window' });
    expect(submit).toBeDisabled();
    fireEvent.click(bench);
    fireEvent.click(await within(form).findByRole('checkbox', { name: /Lobby/ }));
    fireEvent.change(within(form).getByRole('combobox', { name: 'Open for' }), { target: { value: '60' } });
    fireEvent.change(within(form).getByRole('textbox', { name: 'Note (optional)' }), { target: { value: '  soak  ' } });
    expect(within(form).getByText('Offers 1.1.41-field.1 to 1 screen in 1 organization for 1 hour. Nothing installs until you push a screen.')).toBeInTheDocument();
    fireEvent.click(submit);
    await within(form).findByText('Window armed. Push a screen when it is ready.');
    const post = calls.find((c) => c.method === 'POST' && c.path === '/super/field-builds/windows');
    expect(post?.body).toEqual({ candidate: '1.1.41-field.1', tenantIds: [T1], screens: [S1], durationMinutes: 60, note: 'soak' });
  });

  it('arms "every screen" as the word all, and shows a refusal in words', async () => {
    armError = Object.assign(new Error('A window is already open.'), { code: 'FIELD_BUILD_WINDOW_ACTIVE', status: 409 });
    wrap(<FieldBuildsPanel />);
    const form = (await screen.findByRole('heading', { name: 'Arm a window' })).closest('section')!;
    await waitFor(() => expect((within(form).getByRole('combobox', { name: 'Build' }) as HTMLSelectElement).value).toBe('1.1.41-field.1'));
    fireEvent.click(await within(form).findByRole('checkbox', { name: 'Bench' }));
    fireEvent.click(within(form).getByRole('radio', { name: 'Every screen of these organizations' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Arm window' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('A window is already open. Cancel it before arming another.');
    const post = calls.find((c) => c.method === 'POST' && c.path === '/super/field-builds/windows');
    expect(post?.body).toMatchObject({ screens: 'all', durationMinutes: 240 });
    expect(post?.body).not.toHaveProperty('note');
  });

  it('says when the Railway variables are what is being offered', async () => {
    windows = {
      ...windows,
      effective: 'variables',
      variables: { configured: true, candidate: '1.1.41-field.1', tenantIds: [T1], screens: [S1], expiresAt: iso(T0 + 3_600_000), live: true },
    };
    wrap(<FieldBuildsPanel />);
    expect(await screen.findByText(/No window is open here\. The Railway variables offer 1\.1\.41-field\.1 until/)).toBeInTheDocument();
  });

  describe('with a window open', () => {
    beforeEach(() => {
      windows = { ...windows, effective: 'window', active: ACTIVE, windows: [ACTIVE] };
    });

    it('shows the countdown, the screens, their versions and push state; no arm form', async () => {
      wrap(<FieldBuildsPanel />);
      expect(await screen.findByText('Window open for 1.1.42-field.1')).toBeInTheDocument();
      expect(screen.getByText('2 h 0 min')).toBeInTheDocument();
      expect(screen.getByText('Note: pacing soak')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Arm a window' })).toBeNull();
      const list = (await screen.findByRole('heading', { name: 'Screens in this window' })).closest('section')!;
      const lobby = (await within(list).findByText('Lobby')).closest('li')!;
      expect(within(lobby).getByText(/Player 1\.1\.29/)).toBeInTheDocument();
      expect(within(lobby).getByText('No push')).toBeInTheDocument();
      expect(within(lobby).getByRole('button', { name: 'Push now to Lobby' })).toBeEnabled();
      const gym = within(list).getByText('Gym').closest('li')!;
      expect(within(gym).getByText('On this build')).toBeInTheDocument();
      expect(within(gym).getByText('Offered')).toBeInTheDocument();
      expect(within(gym).getByRole('button', { name: 'Push now to Gym' })).toBeDisabled();
      // A screen of the organization that the window does not name is not listed.
      expect(within(list).queryByText('Cafe')).toBeNull();
    });

    it('pushes ONE screen with the chosen update-hours option', async () => {
      wrap(<FieldBuildsPanel />);
      const list = (await screen.findByRole('heading', { name: 'Screens in this window' })).closest('section')!;
      fireEvent.click(within(list).getByRole('checkbox', { name: /Install outside the organization's update hours/ }));
      fireEvent.click(await within(list).findByRole('button', { name: 'Push now to Lobby' }));
      expect(await within(list).findByText('Push sent. The screen checks for it now.')).toBeInTheDocument();
      const push = calls.find((c) => c.path === `/super/field-builds/windows/${W1}/push`);
      expect(push).toMatchObject({ method: 'POST', body: { screenIds: [S1], overrideWindow: true } });
    });

    it('right after arming, Push now waits until every server has the window', async () => {
      windows = { ...windows, active: { ...ACTIVE, pushReadyAt: iso(T0 + 5_000) } };
      wrap(<FieldBuildsPanel />);
      const list = (await screen.findByRole('heading', { name: 'Screens in this window' })).closest('section')!;
      const button = await within(list).findByRole('button', { name: 'Push now to Lobby' });
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Ready in 5 s');
    });

    it('cancels through the confirm dialog and reports the pushes cancelled with it', async () => {
      wrap(<FieldBuildsPanel />);
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel window' }));
      await waitFor(() => expect(appConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cancel the window for 1.1.42-field.1?', tone: 'danger' })));
      expect(await screen.findByText('Window cancelled, along with 1 waiting push.')).toBeInTheDocument();
      expect(calls.find((c) => c.path === `/super/field-builds/windows/${W1}/cancel`)).toMatchObject({ method: 'POST', body: {} });
    });

    it('a declined confirm sends nothing', async () => {
      appConfirm.mockResolvedValueOnce(false);
      wrap(<FieldBuildsPanel />);
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel window' }));
      await waitFor(() => expect(appConfirm).toHaveBeenCalled());
      expect(calls.some((c) => c.path.endsWith('/cancel'))).toBe(false);
    });
  });
});
