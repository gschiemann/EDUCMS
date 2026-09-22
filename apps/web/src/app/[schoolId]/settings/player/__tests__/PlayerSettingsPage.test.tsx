/**
 * Player & offline (§7.6) — the page contract, rendered.
 *
 * Mocked at `apiFetch`, not at the hooks, so the REAL use-api hooks run with
 * their REAL URLs and bodies. That is what proves the policy writes go to
 * `PUT /tenants/me/ota-window` + `PUT /tenants/me/canary-rollout`, and that
 * "Policy saved" is not spoken until the server has answered AND the
 * authoritative state has been re-read (§13.2).
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: any) => apiFetch(path, opts),
  getApiUrl: () => 'http://api.test/api/v1',
}));

let role = 'SCHOOL_ADMIN';
jest.mock('@/store/ui-store', () => ({
  useUIStore: (sel: any) => sel({ user: { role }, token: 'tok' }),
}));

jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 't1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/t1/settings/player',
}));

let confirmAnswer = true;
jest.mock('@/components/ui/app-dialog', () => ({
  appConfirm: jest.fn(async () => confirmAnswer),
}));

import { SettingsShellProvider, useSettingsShell } from '@/components/settings/shell/SettingsShellContext';
import PlayerSettingsPage from '../page';
import OfflinePage from '../offline/page';
import UsbLegacyPage from '../../usb/page';

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000;
const DAY = 24 * 60 * 60_000;

type Fixture = {
  screens?: any[];
  latest?: any;
  canary?: any;
  window?: any;
  autoUpdate?: boolean;
};

function serve(f: Fixture = {}) {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/tenants') return { id: 't1', name: 'Springfield' };
    if (path === '/screens') return f.screens ?? [];
    if (path === '/playlists') return [];
    if (path === '/player/latest-version') return f.latest ?? { versionName: '1.1.12', versionCode: 112, source: 'github' };
    if (path === '/tenants/me/auto-update-player') return { enabled: !!f.autoUpdate };
    if (path === '/tenants/me/ota-window') return f.window ?? { start: null, end: null, timezone: null };
    if (path === '/tenants/me/canary-rollout') return f.canary ?? { percent: 100, setAt: null, autoPromote: true, soakHours: 24 };
    if (path === '/tenants/me/usb-ingest') return { enabled: true, hasKey: true, keyRotatedAt: iso(DAY) };
    return {};
  });
}

/** Exposes the shell's registered save contract without mounting the whole shell. */
function SaveHarness() {
  const { page } = useSettingsShell();
  if (!page?.save) return null;
  return (
    <button type="button" data-testid="shell-save" onClick={() => page.save?.onSave?.()}>
      {`dirty:${page.save.dirty} saving:${page.save.saving ? 'yes' : 'no'}`}
    </button>
  );
}

function renderPage(Page: React.ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsShellProvider>
        <Page />
        <SaveHarness />
      </SettingsShellProvider>
    </QueryClientProvider>,
  );
}

/**
 * Type a maintenance-window time and settle it.
 *
 * 2026-09-22 — Start / End are `TimeField` on a fine pointer (the only path
 * jsdom can take: no matchMedia ⇒ not coarse). It is a text box that reports
 * on blur, not a native `<input type=time>` that reports every keystroke, so
 * a bare `change` leaves a DRAFT the page never receives. The blur is the
 * commit, exactly as it is for the operator. Its DISPLAY is 12-hour; the
 * value it reports — and the body the PUT carries — stays `HH:MM`.
 */
const typeWindow = (label: 'Start' | 'End', hhmm: string) => {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value: hhmm } });
  fireEvent.blur(field);
};

const online = (over: any = {}) => ({
  id: 's1',
  name: 'Lobby',
  status: 'ONLINE',
  lastPingAt: iso(20_000),
  playerVersion: '1.1.12',
  playerVersionAt: iso(5 * MIN),
  ...over,
});

beforeEach(() => {
  role = 'SCHOOL_ADMIN';
  confirmAnswer = true;
  apiFetch.mockReset();
});

describe('status model — one label per state, text always present', () => {
  const cases: Array<[string, Fixture, string]> = [
    ['current', { screens: [online()] }, 'Current'],
    ['update available', { screens: [online({ playerVersion: '1.1.9' })] }, 'Update available'],
    [
      'partially deployed',
      { screens: [online(), online({ id: 's2', playerVersion: '1.1.9' })] },
      'Partially deployed',
    ],
    [
      'rollout scheduled',
      {
        screens: [online({ playerVersion: '1.1.9' })],
        autoUpdate: true,
        window: { start: '22:00', end: '04:00', timezone: 'America/Chicago' },
      },
      'Rollout scheduled',
    ],
    [
      'canary in progress',
      {
        screens: [online({ playerVersion: '1.1.9' })],
        canary: { percent: 10, setAt: iso(2 * 3_600_000), autoPromote: true, soakHours: 24 },
      },
      'Canary in progress',
    ],
    [
      'paused',
      {
        screens: [online({ playerVersion: '1.1.9' })],
        canary: { percent: 0, setAt: iso(3_600_000), autoPromote: true, soakHours: 24 },
      },
      'Paused',
    ],
    [
      'failed on devices',
      { screens: [online({ playerVersion: '1.1.9', lastOtaErrorAt: iso(3_600_000) })] },
      'Failed on one or more devices',
    ],
    ['unknown / stale reporting', { screens: [online({ playerVersionAt: iso(3 * DAY) })] }, 'Unknown — stale reporting'],
  ];

  it.each(cases)('renders %s', async (_name, fixture, label) => {
    serve(fixture);
    renderPage(PlayerSettingsPage);
    expect(await screen.findByText(label)).toBeInTheDocument();
  });
});

it('never states a version it cannot evidence', async () => {
  serve({ latest: { versionName: null, versionCode: null, source: 'unknown' }, screens: [online()] });
  renderPage(PlayerSettingsPage);
  expect(await screen.findByText(/release feed did not answer/i)).toBeInTheDocument();
  expect(
    screen.getByText(/Rollout cannot be verified/i),
  ).toBeInTheDocument();
});

it('separates rollout verification from any policy result', async () => {
  serve({ screens: [online(), online({ id: 's2', playerVersion: '1.1.9' })] });
  renderPage(PlayerSettingsPage);
  expect(await screen.findByText('Rollout verified on 1/2 screens.')).toBeInTheDocument();
  // Nothing has been saved, so no policy claim is on screen.
  expect(screen.queryByText(/Policy saved at/)).not.toBeInTheDocument();
});

it('says "Policy saved" only after the server answers AND the state is re-read', async () => {
  serve({ screens: [online()] });
  renderPage(PlayerSettingsPage);
  await screen.findByText('Current');

  // Make the window editor dirty.
  typeWindow('Start', '22:00');
  typeWindow('End', '04:00');
  fireEvent.change(screen.getByLabelText('Timezone (IANA)'), { target: { value: 'America/Chicago' } });
  await waitFor(() => expect(screen.getByTestId('shell-save')).toHaveTextContent('dirty:1'));

  // Hold the PUT open: while it is in flight nothing may claim success.
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = () => r(); });
  apiFetch.mockImplementation(async (path: string, opts?: any) => {
    if (path === '/tenants/me/ota-window' && opts?.method === 'PUT') {
      await gate;
      return { start: '22:00', end: '04:00', timezone: 'America/Chicago' };
    }
    if (path === '/tenants') return { id: 't1', name: 'Springfield' };
    if (path === '/screens') return [online()];
    if (path === '/player/latest-version') return { versionName: '1.1.12', source: 'github' };
    if (path === '/tenants/me/auto-update-player') return { enabled: false };
    if (path === '/tenants/me/ota-window') return { start: '22:00', end: '04:00', timezone: 'America/Chicago' };
    if (path === '/tenants/me/canary-rollout') return { percent: 100, setAt: null, autoPromote: true, soakHours: 24 };
    if (path === '/tenants/me/usb-ingest') return { enabled: true, hasKey: true, keyRotatedAt: null };
    return {};
  });

  fireEvent.click(screen.getByTestId('shell-save'));
  await waitFor(() => expect(screen.getByTestId('shell-save')).toHaveTextContent('saving:yes'));
  expect(screen.queryByText(/Policy saved at/)).not.toBeInTheDocument();

  await act(async () => { release(); });
  expect(await screen.findByText(/Policy saved at .* and re-read from the server\./)).toBeInTheDocument();
  const put = apiFetch.mock.calls.find(([p, o]: any[]) => p === '/tenants/me/ota-window' && o?.method === 'PUT');
  expect(JSON.parse(put![1].body)).toEqual({ start: '22:00', end: '04:00', timezone: 'America/Chicago' });
});

it('keeps input and refuses to save a half-configured window', async () => {
  serve({ screens: [online()] });
  renderPage(PlayerSettingsPage);
  await screen.findByText('Current');
  typeWindow('Start', '22:00');
  await waitFor(() => expect(screen.getByTestId('shell-save')).toHaveTextContent('dirty:1'));
  fireEvent.click(screen.getByTestId('shell-save'));
  expect(await screen.findByText('Set start, end and time zone together, or clear all three.')).toBeInTheDocument();
  // The field KEEPS what was entered — displayed 12-hour, held as 22:00.
  expect(screen.getByLabelText('Start')).toHaveValue('10:00 PM');
  expect(apiFetch.mock.calls.some(([p, o]: any[]) => p === '/tenants/me/ota-window' && o?.method === 'PUT')).toBe(false);
});

it('a contributor gets the read-only surface and no save contract', async () => {
  role = 'CONTRIBUTOR';
  serve({ screens: [online()] });
  renderPage(PlayerSettingsPage);
  expect(await screen.findByText(/Changing these policies needs an organization administrator\./)).toBeInTheDocument();
  expect(screen.queryByTestId('shell-save')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Start')).toBeDisabled();
});

describe('offline ingest renders under both URLs', () => {
  it('at /settings/player/offline', async () => {
    serve();
    renderPage(OfflinePage);
    expect(await screen.findByText('USB ingest security')).toBeInTheDocument();
    expect(screen.getByLabelText('Target screen (optional)')).toBeInTheDocument();
  });

  it('and at the preserved /settings/usb', async () => {
    serve();
    renderPage(UsbLegacyPage);
    expect(await screen.findByText('USB ingest security')).toBeInTheDocument();
  });
});
