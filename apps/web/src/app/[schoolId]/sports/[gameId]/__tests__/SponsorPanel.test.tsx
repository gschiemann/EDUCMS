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
    {
      sponsorId: 'sp1',
      name: 'Joe Pizza',
      board: 28,
      ribbon: 41,
      total: 69,
      verified: 60,
      unverified: 9,
      capCompliant: true,
    },
    {
      sponsorId: 'sp2',
      name: 'Over Cap Co',
      board: 5,
      ribbon: 200,
      total: 205,
      verified: 0,
      unverified: 205,
      capCompliant: false,
    },
  ],
  evidence: {
    verified: 60,
    unverified: 214,
    total: 274,
    basis: 'verified',
    requireVerifiedIngest: false,
    note: 'Unverified impressions … they are not proof of play and are not included in the verified total.',
  },
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

  /** Open the proof-of-play card and return a `within` scope for it. */
  async function openProofCard() {
    // The "Proof of play" header's <button> is the expand toggle; scope all
    // assertions to that section so "Joe Pizza" in the sponsor LIST above
    // doesn't create ambiguity.
    const header = await screen.findByText('Proof of play');
    // The card is: <div.card> > <button>(toggle) > <span>Proof of play.
    const section = header.closest('button')!.parentElement as HTMLElement;
    await act(async () => {
      fireEvent.click(header);
    });
    await waitFor(() => {
      expect(within(section).getByText('Over Cap Co')).toBeInTheDocument();
    });
    return within(section);
  }

  it('renders the per-surface counts for the game', async () => {
    await act(async () => {
      renderPanel();
    });
    const card = await openProofCard();
    expect(card.getByText('Joe Pizza')).toBeInTheDocument();
    expect(card.getByText('28')).toBeInTheDocument(); // board
    expect(card.getByText('41')).toBeInTheDocument(); // ribbon

    // Cap-compliance is surfaced: one "within cap" + one "over cap" marker.
    expect(card.getByLabelText('Within frequency cap')).toBeInTheDocument();
    expect(
      card.getByLabelText('Over the frequency cap for this game length'),
    ).toBeInTheDocument();

    // A CSV download is offered.
    expect(card.getByRole('button', { name: /CSV/i })).toBeInTheDocument();
  });

  /**
   * SEC-007 re-audit (2026-09-04). The panel used to omit `verified` /
   * `unverified` / `evidence` from its interfaces entirely, sum a single
   * `total`, call it "measured" and "the number you hand a sponsor", and
   * export it as `proof-of-play-*.csv`. Anonymous browser beacons were being
   * presented to an operator as billable proof.
   *
   * These assertions are the contract: the two lanes are visible and
   * separate, the totals never merge, and no string calls an unverified count
   * proof.
   */
  describe('verified vs unverified evidence', () => {
    it('shows the verified and unverified counts as SEPARATE figures', async () => {
      await act(async () => {
        renderPanel();
      });
      const card = await openProofCard();

      // Both lanes are labelled — a reader can tell which number is which.
      // (Each label appears twice: the summary tile and the column header.)
      expect(card.getAllByText('Verified').length).toBeGreaterThan(0);
      expect(card.getAllByText('Unverified').length).toBeGreaterThan(0);
      // Per-sponsor split: 60/9 for sp1, 0/205 for sp2.
      expect(card.getAllByText('60').length).toBeGreaterThan(0);
      expect(card.getByText('9')).toBeInTheDocument();
      expect(card.getAllByText('205').length).toBeGreaterThan(0);
      // The unverified figure is present and named as not-proof.
      expect(card.getByText('214')).toBeInTheDocument();
      expect(card.getAllByText(/Not proof\s+of play/i).length).toBeGreaterThan(0);
      // The server's own evidence sentence is rendered, not paraphrased.
      expect(
        card.getAllByText(/not proof of play and are not included/i).length,
      ).toBeGreaterThan(0);
    });

    it('drops the copy that called an anonymous count measured proof', async () => {
      await act(async () => {
        renderPanel();
      });
      const card = await openProofCard();
      // Both strings shipped in the pre-re-audit panel and both were claims
      // the evidence could not support.
      expect(card.queryByText(/the numbers you hand a sponsor/i)).toBeNull();
      expect(card.queryByText(/this game, measured/i)).toBeNull();
      // What replaced them says what the verified lane actually proves.
      expect(card.getByText(/proved its credential/i)).toBeInTheDocument();
    });

    it('the collapsed header leads with the VERIFIED count, not the total', async () => {
      await act(async () => {
        renderPanel();
      });
      // The header text is built from several nodes, so match on the
      // element's whole textContent.
      await waitFor(() => {
        expect(
          screen.getAllByText((_t, el) =>
            /60 verified impressions this game · 214 unverified/i.test(el?.textContent ?? ''),
          ).length,
        ).toBeGreaterThan(0);
      });
    });

    it('exports verified and unverified as separate CSV columns', async () => {
      // Capture the CSV the download handler builds. Stubbing the Blob
      // CONSTRUCTOR (rather than reading a jsdom Blob back) keeps this
      // synchronous and independent of jsdom's Blob/File support.
      const captured: string[] = [];
      const realBlob = global.Blob;
      const realCreate = URL.createObjectURL;
      const realRevoke = URL.revokeObjectURL;
      (global as any).Blob = class {
        constructor(parts: unknown[]) {
          captured.push(parts.map(String).join(''));
        }
      };
      (URL as any).createObjectURL = () => 'blob:mock';
      (URL as any).revokeObjectURL = () => {};

      try {
        await act(async () => {
          renderPanel();
        });
        const card = await openProofCard();
        await act(async () => {
          fireEvent.click(card.getByRole('button', { name: /CSV/i }));
        });
        expect(captured).toHaveLength(1);

        const csv = captured[0];
        expect(csv).toContain('Verified impressions');
        expect(csv).toContain('Unverified impressions');
        expect(csv).toContain('Total reported');
        // The per-row split is exported, not just a merged total.
        expect(csv).toContain('Joe Pizza,28,41,60,9,69,yes');
        expect(csv).toContain('Over Cap Co,5,200,0,205,205,OVER');
        // And the file states what each lane means.
        expect(csv).toContain('# Verified impressions (proof of play): 60');
        expect(csv).toContain('# Unverified impressions (NOT proof of play): 214');
      } finally {
        (global as any).Blob = realBlob;
        (URL as any).createObjectURL = realCreate;
        (URL as any).revokeObjectURL = realRevoke;
      }
    });

    /**
     * SEC-007 residual #3 (2026-09-05) — the frequency-cap flag grades on
     * EVERY REPORTED AIRING, verified or not. That is deliberate ("did this
     * logo run more often than the contract allows" is a question about
     * airings, not about evidence) — but sitting one column away from two
     * columns that DO split on evidence, it is exactly the kind of thing a
     * reader assumes matches its neighbours.
     *
     * So it is disclosed in the panel, and this test is what stops the
     * disclosure being quietly deleted in a future copy pass. If someone
     * changes the cap to grade the verified lane instead, this test SHOULD
     * fail — the sentence would then be a lie and must change with it.
     */
    it('DISCLOSES that the cap flag grades every reported airing, not just the verified ones', async () => {
      await act(async () => {
        renderPanel();
      });
      const card = await openProofCard();

      const disclosure = card.getByText((_t, el) =>
        /the cap flag counts every reported airing/i.test(el?.textContent ?? '') &&
        el?.tagName.toLowerCase() === 'p',
      );
      // The sentence names the number it grades on (all 274 reported airings —
      // NOT the 60 verified ones), and says why the two differ.
      expect(disclosure.textContent).toMatch(/274/);
      expect(disclosure.textContent).toMatch(/verified or not/i);
      expect(disclosure.textContent).toMatch(/scheduling question, not an evidence one/i);

      // And both cap states are still rendered, so the flag the sentence
      // describes is actually on screen.
      expect(card.getByLabelText('Within frequency cap')).toBeInTheDocument();
      expect(
        card.getByLabelText('Over the frequency cap for this game length'),
      ).toBeInTheDocument();
    });

    it('grades a report with NO provenance fields as entirely unverified', async () => {
      // An older API response (or a cached one) proves nothing about
      // provenance, so the panel must not infer verification from `total`.
      apiFetch.mockImplementation((path: string) => {
        if (path === `/sports/games/${GAME_ID}/sponsor-report`) {
          return Promise.resolve({
            gameId: GAME_ID,
            gameDurationMin: 10,
            sponsors: [
              { sponsorId: 'sp1', name: 'Joe Pizza', board: 3, ribbon: 4, total: 7, capCompliant: true },
            ],
          });
        }
        return routeFetch(path);
      });

      await act(async () => {
        renderPanel();
      });
      await waitFor(() => {
        expect(
          screen.getAllByText((_t, el) =>
            /0 verified impressions this game · 7 unverified/i.test(el?.textContent ?? ''),
          ).length,
        ).toBeGreaterThan(0);
      });
    });
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
