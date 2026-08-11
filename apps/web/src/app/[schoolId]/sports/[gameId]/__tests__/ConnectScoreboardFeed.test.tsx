/**
 * ConnectScoreboardFeed — guided scoreboard-feed setup card
 * (Inputs-wave GUIDED, 2026-08-10).
 *
 * Proves the operator happy path end-to-end against a mocked network:
 *   1. Mint-on-open hits GET /sports/games/:id/feed-credentials and
 *      renders the URL + token + curl (the ≤30s happy path: open → copy).
 *   2. Vendor chips (Sportzcast / Scorebird / generic) swap ONLY the
 *      recipe text — the credential block is identical for every vendor
 *      (HONESTY rule: recipe cards, not native adapters).
 *   3. The status row derives from stats.feed: "Waiting for first
 *      packet…" with no stamp, "Receiving" with a fresh one.
 *   4. Regenerate = revoke-and-replace: POSTs the existing revoke
 *      endpoint and swaps in the fresh token it returns + Rotated notice.
 *   5. The sessionStorage revoke-sticky flag pins the revoked panel on
 *      remount instead of silently auto-minting (ShareConsoleLink
 *      precedent).
 *
 * Network is mocked at apiFetch so the component's REAL request paths
 * are asserted (SponsorPanel.test.tsx pattern).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const GAME_ID = 'game-feed-1';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: unknown) => apiFetch(path, opts),
}));

import { ConnectScoreboardFeed } from '../ConnectScoreboardFeed';

const CREDS = {
  gameId: GAME_ID,
  ingestUrl: `https://api.example.com/api/v1/sports/board/${GAME_ID}/feed`,
  tokenHeader: 'x-feed-token',
  token: '0.1700000000.2592000.aabbccddeeff0011',
  tokenTtlSeconds: 2_592_000,
  expiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
  feedTokenVersion: 0,
  curlExample: `curl -X POST "https://api.example.com/api/v1/sports/board/${GAME_ID}/feed" -H "x-feed-token: 0.1700000000.2592000.aabbccddeeff0011" -H "Content-Type: application/json" -d '{"homeScore":14}'`,
  accepts: ['homeScore', 'awayScore', 'clockMs', 'clockRunning', 'segment'],
};

const REVOKED = {
  success: true,
  feedTokenVersion: 1,
  token: '1.1700000500.2592000.112233445566aabb',
  tokenExpiresAt: new Date(Date.now() + 2_592_000_000).toISOString(),
};

beforeEach(() => {
  apiFetch.mockReset();
  sessionStorage.clear();
});

function mockMintOk() {
  apiFetch.mockImplementation((path: string) => {
    if (path === `/sports/games/${GAME_ID}/feed-credentials`) return Promise.resolve(CREDS);
    if (path === `/sports/games/${GAME_ID}/revoke-feed-token`) return Promise.resolve(REVOKED);
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

// The token / URL legitimately appear in TWO places (the Header line and
// the curl example), so all credential-text queries use the *AllByText
// variants.
const tokenRe = (token: string) => new RegExp(token.replace(/\./g, '\\.'));

it('mints on open and renders URL + token + waiting status (the 30s happy path)', async () => {
  mockMintOk();
  render(<ConnectScoreboardFeed gameId={GAME_ID} stats={{}} />);

  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith(`/sports/games/${GAME_ID}/feed-credentials`, undefined),
  );
  expect((await screen.findAllByText(tokenRe(CREDS.ingestUrl))).length).toBeGreaterThan(0);
  expect(screen.getAllByText(tokenRe(CREDS.token)).length).toBeGreaterThan(0);
  // No packet yet → the waiting state.
  expect(screen.getByTestId('feed-status-row')).toHaveTextContent('Waiting for first packet…');
  // Copy affordance present.
  expect(screen.getByRole('button', { name: /copy url \+ token/i })).toBeInTheDocument();
});

it('vendor chips swap ONLY the instructions — the credential stays identical', async () => {
  mockMintOk();
  render(<ConnectScoreboardFeed gameId={GAME_ID} stats={{}} />);
  await screen.findAllByText(tokenRe(CREDS.token));

  // Default chip: Sportzcast instructions.
  expect(screen.getByText(/Sportzcast cloud portal/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Scorebird' }));
  expect(screen.getByText(/Scorebird dashboard/i)).toBeInTheDocument();
  expect(screen.queryByText(/Sportzcast cloud portal/i)).not.toBeInTheDocument();
  // Same token still shown — one credential for every vendor.
  expect(screen.getAllByText(tokenRe(CREDS.token)).length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole('button', { name: 'Anything else' }));
  expect(screen.getByText(/Anything that can POST JSON works/i)).toBeInTheDocument();
  expect(screen.getAllByText(tokenRe(CREDS.token)).length).toBeGreaterThan(0);
  // Exactly one mint — chip swaps are client-side only.
  expect(apiFetch).toHaveBeenCalledTimes(1);
});

it('shows Receiving when stats.feed carries a fresh stamp', async () => {
  mockMintOk();
  const stats = {
    feed: {
      lastPacketAt: new Date(Date.now() - 2_000).toISOString(),
      source: 'feed',
      accepted: true,
    },
  };
  render(<ConnectScoreboardFeed gameId={GAME_ID} stats={stats} />);
  await screen.findAllByText(tokenRe(CREDS.token));
  expect(screen.getByTestId('feed-status-row')).toHaveTextContent(/Receiving/);
});

it('Regenerate revokes-and-replaces: hits the revoke endpoint, swaps in the fresh token, shows Rotated', async () => {
  mockMintOk();
  render(<ConnectScoreboardFeed gameId={GAME_ID} stats={{}} />);
  await screen.findAllByText(tokenRe(CREDS.token));

  fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
  // Confirm step spells out the kill-switch semantics before firing.
  expect(screen.getByText(/kills every credential already deployed/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /yes — revoke & replace/i }));

  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith(
      `/sports/games/${GAME_ID}/revoke-feed-token`,
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  // The REPLACEMENT token renders; the dead one is gone.
  expect((await screen.findAllByText(tokenRe(REVOKED.token))).length).toBeGreaterThan(0);
  expect(screen.queryByText(tokenRe(CREDS.token))).not.toBeInTheDocument();
  expect(screen.getByText(/Rotated/)).toBeInTheDocument();
  // Replacement rendered → the sticky flag is cleared again.
  expect(sessionStorage.getItem(`venueos_feed_revoked_${GAME_ID}`)).toBeNull();
});

it('holds at the revoked panel on remount while the sticky flag is set — no silent auto-mint', async () => {
  mockMintOk();
  sessionStorage.setItem(`venueos_feed_revoked_${GAME_ID}`, '1');
  render(<ConnectScoreboardFeed gameId={GAME_ID} stats={{}} />);

  expect(
    await screen.findByText(/All feed credentials for this game are revoked/i),
  ).toBeInTheDocument();
  expect(apiFetch).not.toHaveBeenCalled();

  // The explicit click re-arms.
  fireEvent.click(screen.getByRole('button', { name: /create new credentials/i }));
  await screen.findAllByText(tokenRe(CREDS.token));
  expect(apiFetch).toHaveBeenCalledWith(`/sports/games/${GAME_ID}/feed-credentials`, undefined);
  expect(sessionStorage.getItem(`venueos_feed_revoked_${GAME_ID}`)).toBeNull();
});

it('surfaces a retryable error state when the mint fails', async () => {
  apiFetch.mockRejectedValueOnce(new Error('boom'));
  render(<ConnectScoreboardFeed gameId={GAME_ID} stats={{}} />);
  expect(await screen.findByText(/couldn.t load the feed credentials/i)).toBeInTheDocument();

  mockMintOk();
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect((await screen.findAllByText(tokenRe(CREDS.token))).length).toBeGreaterThan(0);
});
