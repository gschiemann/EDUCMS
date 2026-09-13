/**
 * GOOGLE_REVIEWS — what has to be on the glass, and what must never be.
 *
 * Two classes of assertion here, and they are different in kind:
 *
 *   POLICY. Google's Places API Policies are not style guidance. Every review
 *   must carry its author's name and avatar; the board must carry the Google
 *   Maps attribution; and when reviews are filtered, the notice describing
 *   that filtering must be visible. A board that drops any of these is not
 *   allowed to display Google reviews at all, so each one is pinned.
 *
 *   HONESTY. Every empty/failed state must say what is true (CLAUDE.md §19 +
 *   player rule 10): no business picked, no API key, and nothing loaded yet
 *   are three DIFFERENT sentences, and none of them is a fabricated review.
 *
 * No geometry is asserted — jsdom has no layout, and a px number from a test
 * that cannot measure anything would be a lie dressed as a guarantee. The
 * browser rig (`apps/web/tools/widget-legibility/measure.mjs`) is where size
 * is graded.
 */

import { render, screen, act, waitFor } from '@testing-library/react';

import { GoogleReviewsWidget } from '../GoogleReviewsWidget';
import { RenderSurfaceProvider } from '../render-surface';
import type { GoogleReviewsPayload } from '@/lib/reviews/google-reviews-client';

const fetchReviewsMock = jest.fn();
jest.mock('@/lib/reviews/google-reviews-client', () => {
  const actual = jest.requireActual('@/lib/reviews/google-reviews-client');
  return {
    ...actual,
    fetchGoogleReviews: (...args: unknown[]) => fetchReviewsMock(...args),
  };
});

const PLACE_ID = 'ChIJj61dQgK6j4AR4GeTYWZsKWw';

function payload(over: Partial<GoogleReviewsPayload> = {}): GoogleReviewsPayload {
  return {
    enabled: true,
    place: { name: 'Riot Color Jacksonville', rating: 4.7, count: 218, mapsUri: 'https://maps.google.com/?cid=1' },
    reviews: [
      {
        author: 'Dana R.',
        authorUri: 'https://www.google.com/maps/contrib/1',
        photoUri: 'https://lh3.googleusercontent.com/a/dana',
        rating: 5,
        text: 'Fast turnaround and the colour match was perfect.',
        publishedAt: '2020-01-01T00:00:00Z',
        relative: 'a month ago',
        reviewUri: 'https://maps.google.com/review/1',
      },
      {
        author: 'Miguel S.',
        authorUri: 'https://www.google.com/maps/contrib/2',
        photoUri: 'https://lh3.googleusercontent.com/a/miguel',
        rating: 2,
        text: 'Parking is a nightmare.',
        publishedAt: '2020-02-01T00:00:00Z',
        relative: '2 months ago',
        reviewUri: 'https://maps.google.com/review/2',
      },
    ],
    fetchedAt: '2026-09-12T06:00:00.000Z',
    ...over,
  };
}

async function mount(config: Record<string, unknown>, surface: 'builder' | 'player' = 'builder') {
  const view = render(
    <RenderSurfaceProvider surface={surface}>
      <GoogleReviewsWidget config={config as never} height={900} />
    </RenderSurfaceProvider>,
  );
  // The fetch effect resolves on a microtask; flush it before asserting.
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  localStorage.clear();
  fetchReviewsMock.mockReset().mockResolvedValue(payload());
  jest.useRealTimers();
});

// ── POLICY ────────────────────────────────────────────────────────────────
describe('what Google requires to be on screen', () => {
  it('credits the author by NAME and AVATAR on every review shown', async () => {
    await mount({ placeId: PLACE_ID, minRating: 0, maxItems: 5, layout: 'list' });

    expect(await screen.findByText('Dana R.')).toBeInTheDocument();
    expect(screen.getByText('Miguel S.')).toBeInTheDocument();
    const avatars = document.querySelectorAll('img[src^="https://lh3.googleusercontent.com"]');
    expect(avatars).toHaveLength(2);
  });

  it('carries the Google Maps attribution', async () => {
    await mount({ placeId: PLACE_ID });
    const attribution = await screen.findByText(/Reviews from Google Maps/i);
    expect(attribution).toBeInTheDocument();
  });

  it('states how the reviews are ordered AND filtered, in the same notice', async () => {
    await mount({ placeId: PLACE_ID, minRating: 4 });
    const notice = await screen.findByText(/Reviews from Google Maps/i);
    // Google does not promise "newest" — say whose selection it is…
    expect(notice.textContent).toMatch(/Google’s selection/);
    // …and name the filter we applied on top of it.
    expect(notice.textContent).toMatch(/4★ and up/);
  });

  it('drops the filter clause when nothing is being filtered', async () => {
    await mount({ placeId: PLACE_ID, minRating: 0 });
    const notice = await screen.findByText(/Reviews from Google Maps/i);
    expect(notice.textContent).toMatch(/Google’s selection/);
    expect(notice.textContent).not.toMatch(/★ and up/);
  });

  it('shows the reviewer’s words exactly as written — no rewriting, no appended ellipsis', async () => {
    await mount({ placeId: PLACE_ID, minRating: 0, layout: 'list' });
    const body = await screen.findByText('Fast turnaround and the colour match was perfect.');
    expect(body.textContent).toBe('Fast turnaround and the colour match was perfect.');
    // Clipping is CSS, so the DOM text node is untouched.
    expect(body).toHaveStyle({ overflow: 'hidden' });
  });
});

// ── FILTERING ─────────────────────────────────────────────────────────────
describe('minRating', () => {
  it('hides a review below the operator’s bar', async () => {
    await mount({ placeId: PLACE_ID, minRating: 4, maxItems: 5, layout: 'list' });
    expect(await screen.findByText('Dana R.')).toBeInTheDocument();
    expect(screen.queryByText('Miguel S.')).not.toBeInTheDocument();
    expect(screen.queryByText('Parking is a nightmare.')).not.toBeInTheDocument();
  });

  it('says so honestly when the filter leaves nothing, instead of showing an empty box', async () => {
    const p = payload();
    p.reviews = p.reviews.map((r) => ({ ...r, rating: 3 }));
    fetchReviewsMock.mockResolvedValue(p);
    await mount({ placeId: PLACE_ID, minRating: 4, maxItems: 5, layout: 'list' });
    expect(await screen.findByText(/No reviews at 4★ or above/i)).toBeInTheDocument();
    // The rating the business actually has is still shown — that is real data.
    expect(screen.getByText('4.7')).toBeInTheDocument();
  });
});

// ── TIME ──────────────────────────────────────────────────────────────────
describe('review age', () => {
  it('prints Google’s own phrasing and never a number computed from the render clock', async () => {
    // `publishedAt` on these rows is 2020; a widget that computed an age would
    // say "6 years ago". Google's string says "a month ago" and that is what
    // must be on the wall — a signage player's clock is not trustworthy.
    await mount({ placeId: PLACE_ID, minRating: 0, maxItems: 5, layout: 'list' });
    expect(await screen.findByText('a month ago')).toBeInTheDocument();
    expect(screen.getByText('2 months ago')).toBeInTheDocument();
    expect(screen.queryByText(/years? ago/i)).not.toBeInTheDocument();
  });

  it('renders nothing rather than inventing an age when Google sent no relative string', async () => {
    const p = payload();
    p.reviews = [{ ...p.reviews[0], relative: null }];
    fetchReviewsMock.mockResolvedValue(p);
    await mount({ placeId: PLACE_ID, minRating: 0, layout: 'list' });
    expect(await screen.findByText('Dana R.')).toBeInTheDocument();
    expect(screen.queryByText(/ago/i)).not.toBeInTheDocument();
  });
});

// ── HONEST STATES ─────────────────────────────────────────────────────────
describe('honest states', () => {
  it('tells the OPERATOR to pick a business when none is bound', async () => {
    await mount({});
    expect(screen.getByText(/Pick your business in the Apps tab/i)).toBeInTheDocument();
    expect(fetchReviewsMock).not.toHaveBeenCalled();
  });

  it('tells the OPERATOR to ask their admin when the deploy has no API key', async () => {
    fetchReviewsMock.mockResolvedValue({ enabled: false, place: null, reviews: [], fetchedAt: null });
    await mount({ placeId: PLACE_ID });
    expect(await screen.findByText(/Google reviews need an API key — ask your admin/i)).toBeInTheDocument();
  });

  it('shows the PUBLIC a quiet zone, never an authoring prompt, for the same no-key state', async () => {
    fetchReviewsMock.mockResolvedValue({ enabled: false, place: null, reviews: [], fetchedAt: null });
    await mount({ placeId: PLACE_ID }, 'player');
    await waitFor(() => expect(document.querySelector('[data-widget-empty="player"]')).toBeTruthy());
    expect(screen.queryByText(/ask your admin/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Apps tab/i)).not.toBeInTheDocument();
  });

  it('says nothing has loaded rather than inventing reviews, when the first fetch fails cold', async () => {
    fetchReviewsMock.mockResolvedValue(null);
    await mount({ placeId: PLACE_ID });
    expect(await screen.findByText(/Waiting for Google to answer/i)).toBeInTheDocument();
    expect(screen.queryByText('Dana R.')).not.toBeInTheDocument();
  });
});

// ── OFFLINE ───────────────────────────────────────────────────────────────
describe('a screen that loses its uplink', () => {
  it('keeps the last good payload on the wall when the fetch fails', async () => {
    localStorage.setItem(
      `venueos_greviews_v1:${PLACE_ID}`,
      JSON.stringify({ payload: payload(), storedAt: Date.now() }),
    );
    fetchReviewsMock.mockResolvedValue(null);
    await mount({ placeId: PLACE_ID, minRating: 0, layout: 'list' }, 'player');
    expect(await screen.findByText('Dana R.')).toBeInTheDocument();
    expect(screen.getByText('Riot Color Jacksonville')).toBeInTheDocument();
  });

  it('lets an EMPTY success CLEAR the last good list — empty is data, not absence', async () => {
    localStorage.setItem(
      `venueos_greviews_v1:${PLACE_ID}`,
      JSON.stringify({ payload: payload(), storedAt: Date.now() }),
    );
    fetchReviewsMock.mockResolvedValue(payload({ reviews: [] }));
    await mount({ placeId: PLACE_ID, minRating: 0, layout: 'list' });
    await waitFor(() => expect(screen.queryByText('Dana R.')).not.toBeInTheDocument());
    expect(screen.getByText(/Google returned no reviews/i)).toBeInTheDocument();
  });

  it('writes the last good payload after a successful fetch', async () => {
    await mount({ placeId: PLACE_ID });
    await waitFor(() => expect(localStorage.getItem(`venueos_greviews_v1:${PLACE_ID}`)).toBeTruthy());
  });
});

// ── LAYOUT ────────────────────────────────────────────────────────────────
describe('layout', () => {
  it('list mode stacks every selected review at once', async () => {
    await mount({ placeId: PLACE_ID, minRating: 0, maxItems: 5, layout: 'list' });
    expect(await screen.findByText('Dana R.')).toBeInTheDocument();
    expect(screen.getByText('Miguel S.')).toBeInTheDocument();
  });

  it('carousel mode shows one at a time and rotates to the next', async () => {
    jest.useFakeTimers();
    render(
      <RenderSurfaceProvider surface="player">
        <GoogleReviewsWidget
          config={{ placeId: PLACE_ID, minRating: 0, maxItems: 5, layout: 'carousel' } as never}
          height={900}
        />
      </RenderSurfaceProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Dana R.')).toBeInTheDocument();
    expect(screen.queryByText('Miguel S.')).not.toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(8000);
    });

    expect(screen.getByText('Miguel S.')).toBeInTheDocument();
    expect(screen.queryByText('Dana R.')).not.toBeInTheDocument();
    jest.useRealTimers();
  });
});

// ── THE PICKER TILE ───────────────────────────────────────────────────────
describe('catalogue thumbnail', () => {
  it('draws real output from the `sample` PROP and never touches the network', async () => {
    render(
      <GoogleReviewsWidget
        config={{} as never}
        height={400}
        sample={{
          enabled: true,
          place: { name: 'Your business', rating: 4.8, count: 214, mapsUri: null },
          reviews: [
            {
              author: 'A Google reviewer',
              authorUri: null,
              photoUri: null,
              rating: 5,
              text: 'Sample copy.',
              publishedAt: null,
              relative: 'a week ago',
              reviewUri: null,
            },
          ],
          fetchedAt: null,
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Your business')).toBeInTheDocument();
    expect(screen.getByText('4.8')).toBeInTheDocument();
    expect(screen.getByText(/Reviews from Google Maps/i)).toBeInTheDocument();
    expect(fetchReviewsMock).not.toHaveBeenCalled();
  });

  it('a zone with NO business shows the empty state, never the sample', async () => {
    await mount({});
    expect(screen.queryByText('Your business')).not.toBeInTheDocument();
    expect(screen.getByText(/Pick your business in the Apps tab/i)).toBeInTheDocument();
  });
});
