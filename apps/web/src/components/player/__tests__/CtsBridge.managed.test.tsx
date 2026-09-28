/**
 * K12-F32 — the scoreboard console bridge, driven by the manifest binding:
 * it decodes with the table for the GAME'S sport (never a default), posts
 * with the screen's device credential (no feed token, nothing in a URL),
 * says why when it will not decode, and gets off the glass once the console
 * is confirmed and live. Bytes go in through the APK's native serial path —
 * the same path an ECBox3576 uses — and are real RTD frames.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { MockDaktronicsFeed } from '@cms/scoreboard-cts';

jest.mock('@/app/player/nativeBridge', () => ({
  nativeHas: jest.fn(() => true),
  nativeCallOr: jest.fn(async (fallback: unknown, method: string) =>
    method === 'ctsSerialEnabled' ? true : method === 'ctsSerialStatus' ? JSON.stringify({ open: true }) : fallback,
  ),
  nativeCall: jest.fn(async () => JSON.stringify({ ok: true })),
  nativeFire: jest.fn(),
}));

import { CtsBridge } from '../CtsBridge';
import type { ManagedConsoleBinding } from '@/app/player/scoreboardConsole';

const BASKETBALL: ManagedConsoleBinding = {
  gameId: 'game-hoops',
  sport: 'basketball',
  sportName: 'Basketball',
  consoleProfile: 'daktronics-allsport',
  decoder: 'daktronics',
  decoderSport: 'basketball',
  supportedSportNames: ['Football', 'Basketball', 'Baseball', 'Softball'],
  confirmed: false,
};

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

function answer(status: number, body: Record<string, unknown>) {
  fetchMock.mockResolvedValue({ status, ok: status < 300, json: async () => body });
}

function mount(props: Partial<React.ComponentProps<typeof CtsBridge>> = {}) {
  return render(
    <CtsBridge
      screenId="screen-1"
      apiRoot="https://api.test"
      deviceToken="stale-token"
      getDeviceToken={() => 'fresh-device-token'}
      {...props}
    />,
  );
}

/** Push encoded RTD frames through the APK's native bytes callback. */
function pushNative(bytes: Uint8Array) {
  const w = window as unknown as { __ctsSerialBytes?: (b64: string) => void };
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  act(() => w.__ctsSerialBytes!(btoa(bin)));
}

async function connected() {
  await waitFor(() =>
    expect((window as unknown as { __ctsSerialBytes?: unknown }).__ctsSerialBytes).toBeInstanceOf(Function),
  );
}

it('decodes with the game’s own table and posts with the DEVICE credential — no feed token, no URL', async () => {
  answer(200, { ok: true, accepted: false, preview: true, reason: 'awaiting confirmation' });
  mount({ managed: BASKETBALL, gameId: BASKETBALL.gameId, consoleProfile: 'daktronics-allsport' });
  await connected();
  new MockDaktronicsFeed(pushNative).pushInitialState('basketball', { clock: '7:15', period: 2, homeScore: 45, awayScore: 38 });

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://api.test/api/v1/sports/scoreboard-console/screen-1/snapshot');
  expect(init.headers.Authorization).toBe('Bearer fresh-device-token');
  expect(init.headers['x-feed-token']).toBeUndefined();
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({ decoder: 'daktronics', decoderSport: 'basketball', sport: 'basketball' });
  expect(body.link).toMatchObject({ status: 'connected', native: true });
  // The preview answer is what the box tells the person standing at it.
  expect(await screen.findByTestId('cts-bridge-message')).toHaveTextContent(
    "Sending a preview — confirm it in the game's console",
  );
});

it('a console with no table for the game’s sport decodes nothing and says so', async () => {
  answer(200, { ok: true, accepted: true });
  mount({
    managed: { ...BASKETBALL, sport: 'volleyball', sportName: 'Volleyball', decoderSport: null },
    gameId: BASKETBALL.gameId,
    consoleProfile: 'daktronics-allsport',
  });
  await connected();
  expect(screen.getByTestId('cts-bridge-message')).toHaveTextContent(
    'This console reads Football, Basketball, Baseball, Softball only — it cannot read Volleyball.',
  );
  new MockDaktronicsFeed(pushNative).pushInitialState('basketball', { homeScore: 45 });
  await new Promise((r) => setTimeout(r, 300));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('LEGACY: a Daktronics console with no ?dakSport= is no longer decoded as football', async () => {
  answer(200, { ok: true, accepted: true });
  mount({ gameId: 'g-legacy', feedToken: 'tok', consoleProfile: 'daktronics-allsport' });
  await connected();
  expect(screen.getByTestId('cts-bridge-message')).toHaveTextContent('This console has no game.');
  new MockDaktronicsFeed(pushNative).pushInitialState('football', { homeScore: 7 });
  await new Promise((r) => setTimeout(r, 300));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('a refused decoder is shown, never hidden', async () => {
  answer(409, { code: 'CONSOLE_DECODER_MISMATCH', message: 'x' });
  mount({ managed: { ...BASKETBALL, confirmed: true }, gameId: BASKETBALL.gameId, consoleProfile: 'daktronics-allsport' });
  await connected();
  new MockDaktronicsFeed(pushNative).pushInitialState('basketball', { homeScore: 45 });
  expect(await screen.findByTestId('cts-bridge-message')).toHaveTextContent(
    'The game needs a different decoder',
  );
});

it('confirmed, connected and live: the panel leaves the glass', async () => {
  answer(200, { ok: true, accepted: true });
  mount({ managed: { ...BASKETBALL, confirmed: true }, gameId: BASKETBALL.gameId, consoleProfile: 'daktronics-allsport' });
  await connected();
  new MockDaktronicsFeed(pushNative).pushInitialState('basketball', { homeScore: 45 });
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole('region', { name: /scoreboard bridge/i })).not.toBeInTheDocument());
});

it('sends a link heartbeat every 5 s when nothing else went out', async () => {
  jest.useFakeTimers();
  try {
    answer(200, { ok: true, accepted: false, reason: 'heartbeat' });
    mount({ managed: BASKETBALL, gameId: BASKETBALL.gameId, consoleProfile: 'daktronics-allsport' });
    await connected();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      decoder: 'daktronics',
      decoderSport: 'basketball',
      link: { status: 'connected', bytes: 0, native: true, goodFrames: 0, badFrames: 0 },
    });
  } finally {
    jest.useRealTimers();
  }
});
