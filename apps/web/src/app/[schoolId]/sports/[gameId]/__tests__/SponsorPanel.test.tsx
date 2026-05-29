/**
 * VenueOS Sports — SponsorPanel proof-of-play wiring test (P0, 2026-05-28).
 *
 * The real per-game proof-of-play endpoint (`GET /sports/games/:id/
 * sponsor-report`) had ZERO frontend callers — the panel only showed the
 * tenant-wide arithmetic ESTIMATE. This test proves the fix:
 *
 *   1. The panel CALLS the real endpoint (`/sports/games/<id>/sponsor-
 *      report`) with the gameId taken from the route.
 *   2. It RENDERS the real per-surface counts (board / ribbon / scorebug
 *      + total) and a cap-compliance signal — clearly distinct from the
 *      "Lifetime estimate" section.
 *   3. A CSV download button is offered for the sponsor.
 *
 * We mock the network at `apiFetch` so the REAL `use-api` hooks execute
 * with their REAL URLs (this is what proves the endpoint is hit), then
 * assert against the rendered DOM.
 */
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const GAME_ID = 'game-abc-123';

// Route params — the panel mounts without props and reads gameId here.
jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: 'school-1', gameId: GAME_ID }),
}));

// AssetPicker is only shown inside the editor modal, but it pulls heavy
// deps — stub it so the panel renders deterministically.
jest.mock('@/components/assets/AssetPicker', () => ({
  AssetPicker: () => null,
}));

// Mock the network layer, NOT the hooks — so the real use-api hooks run
// with their real URLs. The test asserts the exact path that was called.
const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (path: string, opts?: any) => apiFetch(path, opts),
}));

import { SponsorPanel } from '../SponsorPanel';

const SPONSORS = [{ id: 'sp1', name: 'Joe Pizza', weight: 1, active: true }];

const GAME_REPORT = {
  gameId: GAME_ID,
  gameStartedAt: new Date().toISOString(),
  gameDurationMin: 92,
  sponsors: [
    { sponsorId: 'sp1', name: 'Joe Pizza', board: 28, ribbon: 41, total: 69, capCompliant: true },
    { sponsorId: 'sp2', name: 'Over Cap Co', board: 5, ribbon: 200, total: 205, capCompliant: false },
  ],
};

const ESTIMATE = {
  totalGames: 3,
  totalLiveSeconds: 5400,
  sponsors: [
    { id: 'sp1', name: 'Joe Pizza', tier: 'Gold', active: true, estimatedSpots: 120, estimatedExposureSeconds: 960 },
  ],
};

function routeFetch(path: string) {
  if (path === '/sports/sponsors') return Promise.resolve(SPONSORS);
  if (path === '/sports/sponsors/report') return Promise.resolve(ESTIMATE);
  if (path === `/sports/games/${GAME_ID}/sponsor-report`) return Promise.resolve(GAME_REPORT);
  return Promise.resolve(null);
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SponsorPanel />
    </QueryClientProvider>,
  );
}

describe('SponsorPanel — real per-game proof-of-play', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((path: string) => routeFetch(path));
  });

  it('calls the real per-game sponsor-report endpoint with the route gameId', async () => {
    await act(async () => {
      renderPanel();
    });
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(`/sports/games/${GAME_ID}/sponsor-report`, undefined);
    });
  });

  it('renders the measured per-surface counts (board / ribbon / total) for the game', async () => {
    await act(async () => {
      renderPanel();
    });

    // The "Proof of play" header is the real (measured) section. Its
    // <button> is the expand toggle; scope all assertions to that section
    // so "Joe Pizza" in the sponsor LIST above doesn't create ambiguity.
    const header = await screen.findByText('Proof of play');
    // The card is: <div.card> > <button>(toggle) > <span>Proof of play.
    const section = header.closest('button')!.parentElement as HTMLElement;
    await act(async () => {
      fireEvent.click(header);
    });

    // Wait for the impression count to settle from 0 → real data, then
    // assert per-surface counts WITHIN the proof-of-play card.
    await waitFor(() => {
      expect(within(section).getByText('Over Cap Co')).toBeInTheDocument();
    });
    const card = within(section);
    expect(card.getByText('Joe Pizza')).toBeInTheDocument();
    expect(card.getByText('28')).toBeInTheDocument(); // board
    expect(card.getByText('41')).toBeInTheDocument(); // ribbon
    expect(card.getByText('69')).toBeInTheDocument(); // total
    expect(card.getByText('205')).toBeInTheDocument(); // over-cap sponsor total

    // Cap-compliance is surfaced: one "within cap" + one "over cap" marker.
    expect(card.getByLabelText('Within frequency cap')).toBeInTheDocument();
    expect(
      card.getByLabelText('Over the frequency cap for this game length'),
    ).toBeInTheDocument();

    // A CSV download is offered.
    expect(card.getByRole('button', { name: /CSV/i })).toBeInTheDocument();
  });

  it('keeps the lifetime ESTIMATE as a separate, distinctly-labeled section', async () => {
    await act(async () => {
      renderPanel();
    });
    // Real section and estimate section coexist and are NOT the same label.
    await screen.findByText('Proof of play'); // real (renders once gameId is known)
    // The estimate section returns null until its query resolves — wait for it.
    expect(await screen.findByText('Lifetime estimate')).toBeInTheDocument();
  });
});
