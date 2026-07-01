/**
 * IntegrationDiscoveryService — Concierge auto-fill own-link extraction.
 *
 * World-class build (2026-07-01, App Library Tier 2 "concierge autofill",
 * see docs/research/2026-06-30-app-library/20-WORLDCLASS-BUILD-PLAN.md).
 *
 * These tests exercise `discoverFromUrl`'s NEW `ownLinks` output + the
 * `detectedValue` field threaded onto matching candidates — the difference
 * between "we noticed you use YouTube" (useless) and "here's your channel,
 * one tap to add" (effortless). safeFetch is mocked (same pattern as
 * data-source.service.spec.ts) so these are hermetic — no network, no SSRF
 * gate exercised here (that's covered by the branding/data-source SSRF
 * specs already).
 */
jest.mock('../branding/safe-fetch', () => ({
  __esModule: true,
  safeFetch: jest.fn(),
  SsrfError: class SsrfError extends Error {},
}));

import { safeFetch } from '../branding/safe-fetch';
import { IntegrationDiscoveryService } from './discovery.service';

const mockedFetch = safeFetch as unknown as jest.Mock;

function htmlResponse(html: string) {
  return {
    body: Buffer.from(html, 'utf8'),
    contentType: 'text/html',
    finalUrl: 'https://example.com',
    status: 200,
  };
}

afterEach(() => jest.clearAllMocks());

describe('IntegrationDiscoveryService — own-link extraction (Concierge auto-fill)', () => {
  const svc = new IntegrationDiscoveryService();

  it('extracts a real YouTube channel link from the footer, not just a category match', async () => {
    mockedFetch.mockResolvedValueOnce(
      htmlResponse(`
        <html><body>
          <footer>
            <a href="https://www.youtube.com/@ourschool">YouTube</a>
          </footer>
        </body></html>
      `),
    );
    const res = await svc.discoverFromUrl('https://example.com');
    expect(res.ownLinks.youtube).toBe('https://www.youtube.com/@ourschool');
    const yt = res.candidates.find((c) => c.id === 'youtube');
    expect(yt).toBeDefined();
    expect(yt!.detectedValue).toBe('https://www.youtube.com/@ourschool');
  });

  it('extracts Instagram and a Google Slides link from separate nav anchors', async () => {
    mockedFetch.mockResolvedValueOnce(
      htmlResponse(`
        <html><body>
          <nav>
            <a href="https://instagram.com/ourvenue">Follow us</a>
            <a href="https://docs.google.com/presentation/d/abc123/edit">Menu deck</a>
          </nav>
        </body></html>
      `),
    );
    const res = await svc.discoverFromUrl('https://example.com');
    expect(res.ownLinks.instagram).toBe('https://instagram.com/ourvenue');
    expect(res.ownLinks['google-slides']).toBe(
      'https://docs.google.com/presentation/d/abc123/edit',
    );
  });

  it('extracts an RSS feed via <link rel="alternate"> autodiscovery', async () => {
    mockedFetch.mockResolvedValueOnce(
      htmlResponse(`
        <html><head>
          <link rel="alternate" type="application/rss+xml" href="https://example.com/feed.xml" />
        </head><body></body></html>
      `),
    );
    const res = await svc.discoverFromUrl('https://example.com');
    expect(res.ownLinks['news-rss']).toBe('https://example.com/feed.xml');
  });

  it('extracts a social link from JSON-LD sameAs[] when no plain anchor exists', async () => {
    mockedFetch.mockResolvedValueOnce(
      htmlResponse(`
        <html><body>
          <script type="application/ld+json">
            {"@type":"LocalBusiness","name":"Our Venue","sameAs":["https://www.facebook.com/ourvenue"]}
          </script>
        </body></html>
      `),
    );
    const res = await svc.discoverFromUrl('https://example.com');
    expect(res.ownLinks['facebook-page']).toBe(
      'https://www.facebook.com/ourvenue',
    );
  });

  it('tolerates malformed JSON-LD without throwing (degrades to whatever anchors found)', async () => {
    mockedFetch.mockResolvedValueOnce(
      htmlResponse(`
        <html><body>
          <script type="application/ld+json">{ not valid json </script>
          <a href="https://twitch.tv/ourchannel">Watch live</a>
        </body></html>
      `),
    );
    const res = await svc.discoverFromUrl('https://example.com');
    expect(res.ownLinks.twitch).toBe('https://twitch.tv/ourchannel');
  });

  it('returns an empty ownLinks map (never throws) when the page has no matching links', async () => {
    mockedFetch.mockResolvedValueOnce(
      htmlResponse('<html><body><p>Nothing here.</p></body></html>'),
    );
    const res = await svc.discoverFromUrl('https://example.com');
    expect(res.ownLinks).toEqual({});
  });

  it('returns an empty ownLinks map when the fetch itself fails (existing degrade path)', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('network down'));
    const res = await svc.discoverFromUrl('https://example.com');
    expect(res.ownLinks).toEqual({});
    expect(res.candidates).toEqual([]);
  });

  it('/describe (no HTML source) always returns an empty ownLinks map', async () => {
    const res = await svc.discoverFromDescription(
      'a coffee shop in Austin using YouTube for our live roast videos',
    );
    expect(res.ownLinks).toEqual({});
  });
});
