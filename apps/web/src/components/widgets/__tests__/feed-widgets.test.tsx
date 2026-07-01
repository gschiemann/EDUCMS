/**
 * Launch Sprint FEEDS domain (2026-07-01) — RSSWidget / CalendarWidget
 * live-fetch tests. Proves:
 *   - No feedUrl → sample data, clearly labeled (never mistaken for real).
 *   - feedUrl set → calls fetch() against our own /api/v1/feeds/* endpoint
 *     (NOT a third-party URL directly — that's the SSRF-guarded backend
 *     path) and renders the returned items/events.
 *   - A fetch failure on the FIRST load falls back to sample content
 *     without crashing.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { WidgetPreview } from '../WidgetRenderer';

function renderWidget(type: string, config: Record<string, unknown> = {}) {
  return render(
    <div style={{ position: 'relative', width: 400, height: 300 }}>
      <WidgetPreview widgetType={type} config={config} width={50} height={50} live={false} />
    </div>,
  );
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('RSSWidget — no feedUrl configured', () => {
  it('renders labeled sample headlines, never claims to be live', () => {
    renderWidget('RSS_FEED', {});
    expect(screen.getByText('Sample headlines')).toBeInTheDocument();
    expect(screen.getByText('School District Announces New STEM Program')).toBeInTheDocument();
  });

  it('never calls fetch when no feedUrl is set', () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    renderWidget('RSS_FEED', {});
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('RSSWidget — feedUrl configured', () => {
  it('calls our own /api/v1/feeds/rss endpoint, never the third-party URL directly', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        title: 'District News',
        items: [{ title: 'Live Headline One', link: 'https://x.com/a', publishedAt: null, source: 'District News' }],
      }),
    });
    global.fetch = fetchSpy as any;

    renderWidget('RSS_FEED', { feedUrl: 'https://example.org/feed.xml', maxItems: 5 });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/\/api\/v1\/feeds\/rss\?url=/);
    expect(calledUrl).toContain(encodeURIComponent('https://example.org/feed.xml'));
    // Never hits the operator's feed URL directly from the browser.
    expect(calledUrl.startsWith('https://example.org')).toBe(false);

    await waitFor(() => expect(screen.getByText('Live Headline One')).toBeInTheDocument());
    expect(screen.queryByText('Sample headlines')).not.toBeInTheDocument();
    // "District News" appears twice: once as the header title, once as the
    // per-item source label (the item had no publishedAt to show instead).
    expect(screen.getAllByText('District News').length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to sample content (labeled "Connecting…") when the first fetch fails, without crashing', async () => {
    const fetchSpy = jest.fn().mockRejectedValue(new Error('network down'));
    global.fetch = fetchSpy as any;

    renderWidget('RSS_FEED', { feedUrl: 'https://example.org/broken.xml' });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText("Couldn't load this feed yet — showing sample headlines.")).toBeInTheDocument(),
    );
    expect(screen.getByText('School District Announces New STEM Program')).toBeInTheDocument();
  });
});

describe('CalendarWidget — no feedUrl configured', () => {
  it('renders manual/default events with no "Connecting…" state', () => {
    renderWidget('CALENDAR', {});
    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
  });

  it('never calls fetch when no feedUrl is set', () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    renderWidget('CALENDAR', {});
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('CalendarWidget — feedUrl configured', () => {
  it('calls our own /api/v1/feeds/ics endpoint and renders live events', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          { title: 'Board Meeting', start: '2026-07-10T18:00:00.000Z', end: null, location: null, allDay: false },
        ],
        meta: { recurringEventCount: 0, recurrenceExpansionDays: 30, hasUnexpandedRecurrence: false },
      }),
    });
    global.fetch = fetchSpy as any;

    renderWidget('CALENDAR', { feedUrl: 'https://example.org/cal.ics' });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/\/api\/v1\/feeds\/ics\?url=/);

    await waitFor(() => expect(screen.getByText('Board Meeting')).toBeInTheDocument());
  });

  it('manual config.events win over a live event with the same title', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          { title: 'Board Meeting', start: '2026-07-10T18:00:00.000Z', end: null, location: null, allDay: false },
        ],
        meta: { recurringEventCount: 0, recurrenceExpansionDays: 30, hasUnexpandedRecurrence: false },
      }),
    });
    global.fetch = fetchSpy as any;

    renderWidget('CALENDAR', {
      feedUrl: 'https://example.org/cal.ics',
      events: [{ title: 'Board Meeting', date: 'MANUAL DATE OVERRIDE', color: '#ff0000' }],
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('MANUAL DATE OVERRIDE')).toBeInTheDocument());
    // Only ONE "Board Meeting" row — the live duplicate was suppressed.
    expect(screen.getAllByText('Board Meeting')).toHaveLength(1);
  });
});
