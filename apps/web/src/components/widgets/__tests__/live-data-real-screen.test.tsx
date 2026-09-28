/**
 * K-12 launch, lane B4, item 4 — Live Data truth (2026-09-27).
 *
 * The Live Data and Transit packs have no feed. They used to put sample
 * quotes, bitcoin prices, "AP · Reuters · BBC" headlines, a Springfield air
 * reading and an SFO departures board on every REAL screen, under claims like
 * "delayed 15 min", "via CoinGecko" and "refreshed every 5 min". The weather
 * hooks painted "72° Sunny" whenever no location was set or the fetch failed,
 * and the News Feed put "Board Meeting Highlights: Budget Approved" on a
 * school's lobby screen until a feed loaded.
 *
 * The rule proved here, on both surfaces:
 *   • real screen (RenderSurfaceProvider surface="player") — what the template
 *     holds, a live reading, or a dash; never the sample, never a source
 *     nothing fetched;
 *   • builder — the sample, stamped SAMPLE, so a tile is never blank;
 *   • a zone SEEDED with the old sample reads as nothing entered;
 *   • a freshly dropped board is seeded with its look only.
 */
import * as React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import '@/components/widgets/variants-register';
import { listVariants } from '@/components/widgets/variants';
import { RenderSurfaceProvider } from '../render-surface';
import { ALL_V2_WIDGETS } from '../v2/registry';
import { RSSWidget } from '../WidgetRenderer';
import { LobbyWelcomeWeather } from '../themes/lobby-welcome';
import { FinalChanceWeather } from '../themes/final-chance';
import { BusLoopWeather } from '../themes/bus-loop';
import { WeatherHero } from '../themes/modern-2026';
import { useLiveWeather, WEATHER_HOLD_MS } from '../use-live-weather';
import { fetchWeather } from '../weather-api';

jest.mock('../weather-api', () => {
  const actual = jest.requireActual('../weather-api');
  return { ...actual, fetchWeather: jest.fn() };
});
const fetchWeatherMock = fetchWeather as jest.MockedFunction<typeof fetchWeather>;

// The boards size off offsetHeight (withMeasuredHeight); jsdom reports 0,
// which renders nothing at all — a false green for every "not shown" check.
const realOffsetW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const realOffsetH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const originalFetch = global.fetch;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1280 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 720 });
});
afterAll(() => {
  if (realOffsetW) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realOffsetW);
  if (realOffsetH) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetH);
});
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  fetchWeatherMock.mockReset();
  jest.useRealTimers();
});

type AnyWidget = React.ComponentType<{ config?: Record<string, unknown>; live?: boolean }>;

function mount(Component: AnyWidget, config: Record<string, unknown>, surface: 'builder' | 'player') {
  const node = <Component config={config} live={false} />;
  return render(surface === 'player' ? <RenderSurfaceProvider surface="player">{node}</RenderSurfaceProvider> : node);
}
/** What a viewer can read — <style> keyframes ("720deg") are not on the glass. */
function textIn(container: HTMLElement): string {
  const copy = container.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('style, script').forEach((n) => n.remove());
  return (copy.textContent || '').replace(/\s+/g, ' ').trim();
}
const stamped = (container: HTMLElement) => container.querySelector('[data-live-data-sample]') !== null;

/** Strings that exist only in each board's sample (and its old false claims). */
const SAMPLE: Record<string, string[]> = {
  STOCK_TICKER: ['AAPL', 'NVDA', '232.18', 'delayed 15 min'],
  CRYPTO_TICKER: ['Bitcoin', 'BTC', '96,420', 'CoinGecko'],
  NEWS_HEADLINES: ['Global summit', 'Underdog stuns', 'AP · Reuters · BBC', '12 min ago', 'BREAKING'],
  AIR_QUALITY: ['Springfield', 'Moderate', 'PM2.5', '62'],
  FX_RATES: ['Euro', '0.9241', 'Mid-market', 'refreshed every', 'OpenExchangeRates'],
  TRAFFIC_CAM: ['I-5', 'Exit 168', 'HEAVY', 'Sample data', 'SAMPLE'],
  DEPARTURES_BOARD: ['SFO', "CHICAGO O'HARE", 'AA 1421', 'BOARDING'],
  FLIGHT_STATUS_HERO: ['UA 504', 'SFO', 'JFK', 'United Airlines', '2,576 mi', 'Boeing'],
  TRANSIT_DEPARTURES: ['EMBARCADERO', 'Caltrain', 'BART', 'SF Zoo'],
  PARKING_AVAILABILITY: ['SFO', 'Hourly Garage', '$22/day', 'Valet'],
};
/** The claims no board may make on any surface — nothing behind them. */
const FALSE_CLAIMS = ['delayed 15 min', 'via CoinGecko', 'Mid-market', 'refreshed every 5 min', 'via Wise', 'OpenExchangeRates'];

/** One row / reading an operator (or an AI draft) could have saved. */
const TYPED: Record<string, { config: Record<string, unknown>; shows: string[]; hides?: string[] }> = {
  STOCK_TICKER: { config: { symbols: [{ symbol: 'ACME', price: 12.5, change: 0.25, pct: 2 }] }, shows: ['ACME', '12.50', '+2.00%'] },
  CRYPTO_TICKER: { config: { coins: [{ name: 'Tigercoin', symbol: 'TGR', price: '3.5', pct: 1 }] }, shows: ['Tigercoin', '$3.5', '+1.00%'] },
  NEWS_HEADLINES: {
    config: { items: [{ cat: 'CAMPUS', time: 'Today', headline: 'Robotics team heads to state' }], source: 'Tiger Times' },
    shows: ['Robotics team heads to state', 'Tiger Times', 'BREAKING'],
  },
  AIR_QUALITY: { config: { aqi: 41, pm25: 9, location: 'Lincoln High' }, shows: ['41', 'Good', 'Lincoln High', 'PM2.5'], hides: ['PM10', 'NO₂'] },
  FX_RATES: { config: { pairs: [{ code: 'CAD', name: 'Canadian Dollar', flag: '', rate: 1.37, delta: 0.01 }] }, shows: ['CAD', 'Canadian Dollar', '1.3700'] },
  TRAFFIC_CAM: { config: { cams: [{ name: 'Main St & 5th', note: 'Bus loop', status: 'clear' }], city: 'Our Town' }, shows: ['Traffic · Our Town', 'Main St & 5th', 'CLEAR'] },
  DEPARTURES_BOARD: {
    config: { flights: [{ flight: 'BUS 7', time: '15:10', dest: 'NORTH CAMPUS', gate: 'B', status: 'on time' }], airport: 'Bus Loop' },
    shows: ['BUS LOOP', 'BUS 7', 'NORTH CAMPUS', 'ON TIME'],
  },
  FLIGHT_STATUS_HERO: { config: { flight: 'DL 88', from: 'ATL', to: 'LAX' }, shows: ['DL 88', 'ATL', 'LAX', '—'], hides: ['United Airlines', '2,576 mi'] },
  TRANSIT_DEPARTURES: {
    config: { lines: [{ line: '12', color: '#f00', toward: 'Downtown', minutes: [4, '19'] }], station: 'Main St' },
    shows: ['NEXT TRAINS · MAIN ST', 'Downtown', '19'],
  },
  PARKING_AVAILABILITY: { config: { lots: [{ name: 'Student Lot', note: 'North', total: 200, avail: 35, rate: 'Free' }], facility: 'Campus' }, shows: ['PARKING · CAMPUS', 'Student Lot', '35', '/ 200 open'] },
};

const BOARDS = ALL_V2_WIDGETS.filter((w) => w.type in SAMPLE);

describe('Live Data + Transit boards on a real screen', () => {
  it('covers every board with no feed behind it', () => {
    expect(BOARDS.map((w) => w.type).sort()).toEqual(Object.keys(SAMPLE).sort());
  });

  for (const w of BOARDS) {
    const Component = w.Component as AnyWidget;
    const sample = SAMPLE[w.type];

    it(`${w.type}: nothing entered → a dash, no sample, no stamp`, () => {
      const { container } = mount(Component, {}, 'player');
      const text = textIn(container);
      expect(text.length).toBeGreaterThan(0);
      expect({ type: w.type, leaked: sample.filter((s) => text.includes(s)) }).toEqual({ type: w.type, leaked: [] });
      expect(text).toContain('—');
      expect(stamped(container)).toBe(false);
    });

    it(`${w.type}: a zone still holding the OLD seed shows none of it`, () => {
      const { container } = mount(Component, { ...(w.defaults || {}) }, 'player');
      const text = textIn(container);
      expect({ type: w.type, leaked: sample.filter((s) => text.includes(s)) }).toEqual({ type: w.type, leaked: [] });
    });

    it(`${w.type}: what the template holds is what the screen shows`, () => {
      const t = TYPED[w.type];
      const { container } = mount(Component, t.config, 'player');
      const text = textIn(container);
      for (const s of t.shows) expect({ type: w.type, missing: s, shown: text.includes(s) }).toEqual({ type: w.type, missing: s, shown: true });
      for (const s of t.hides || []) expect({ type: w.type, leaked: s, shown: text.includes(s) }).toEqual({ type: w.type, leaked: s, shown: false });
      expect(stamped(container)).toBe(false);
    });

    it(`${w.type}: the builder shows the sample, stamped SAMPLE`, () => {
      const { container } = mount(Component, {}, 'builder');
      const text = textIn(container);
      expect(sample.some((s) => text.includes(s))).toBe(true);
      expect(stamped(container)).toBe(true);
    });

    it(`${w.type}: claims no feed on either surface`, () => {
      for (const surface of ['builder', 'player'] as const) {
        const { container, unmount } = mount(Component, {}, surface);
        const text = textIn(container);
        expect({ type: w.type, surface, claims: FALSE_CLAIMS.filter((s) => text.includes(s)) }).toEqual({ type: w.type, surface, claims: [] });
        unmount();
      }
    });
  }

  it('a partly entered flight fills the rest with the sample in the builder only, and stamps it', () => {
    const hero = BOARDS.find((w) => w.type === 'FLIGHT_STATUS_HERO')!.Component as AnyWidget;
    const b = mount(hero, { flight: 'DL 88' }, 'builder');
    expect(textIn(b.container)).toContain('DL 88');
    expect(textIn(b.container)).toContain('SFO');
    expect(textIn(b.container)).not.toContain('United Airlines');
    expect(stamped(b.container)).toBe(true);
    b.unmount();
    const p = mount(hero, { flight: 'DL 88' }, 'player');
    expect(textIn(p.container)).not.toContain('SFO');
  });

  it('an air reading someone changed from the old seed is theirs, even where it matches a sample number', () => {
    const air = BOARDS.find((w) => w.type === 'AIR_QUALITY')!.Component as AnyWidget;
    const { container } = mount(air, { location: 'Springfield, IL', aqi: 40, pm25: 14, pm10: 28, o3: 52, no2: 12 }, 'player');
    const text = textIn(container);
    expect(text).toContain('40');
    expect(text).toContain('PM10');
    // The location is still the seed's — nobody typed it.
    expect(text).not.toContain('Springfield');
  });
});

describe('a freshly dropped Live Data / Transit board', () => {
  const dropped = listVariants({ widgetType: 'LIVE_DATA' });
  const SETTINGS = new Set(['style', 'accent', 'hour12', 'base', 'units', 'timezone', 'exchange']);

  it('is registered for every board', () => {
    expect(dropped.length).toBeGreaterThanOrEqual(BOARDS.length);
  });

  it('is seeded with its look and settings only — never a sample', () => {
    const seededContent = dropped
      .map((v) => ({ id: v.id, keys: Object.keys(v.defaultConfig || {}).filter((k) => !SETTINGS.has(k) && !/Color$/.test(k)) }))
      .filter((r) => r.keys.length > 0);
    expect(seededContent).toEqual([]);
  });

  it('keeps the settings its registry entry defines', () => {
    const fx = dropped.find((v) => v.id === 'fx-rates');
    const clocks = dropped.find((v) => v.id === 'world-clocks');
    expect(fx?.defaultConfig).toEqual({ base: 'USD' });
    expect(clocks?.defaultConfig).toEqual({ hour12: false });
  });
});

describe('v2 weather pack', () => {
  const WEATHER = ALL_V2_WIDGETS.filter((w) => w.category === 'Weather');

  it('covers all five', () => {
    expect(WEATHER.length).toBe(5);
  });

  for (const w of WEATHER) {
    const Component = w.Component as AnyWidget;
    it(`${w.type}: no location on a real screen → no 72°, no hi/lo, no condition, no "cached_data"`, () => {
      const { container } = mount(Component, {}, 'player');
      const text = textIn(container);
      for (const s of ['72', '78', '60', 'Partly cloudy', 'PARTLY CLOUDY', 'cached_data', '⛅']) {
        expect({ type: w.type, leaked: s, shown: text.includes(s) }).toEqual({ type: w.type, leaked: s, shown: false });
      }
      expect(text).toContain('—');
      expect(stamped(container)).toBe(false);
    });

    it(`${w.type}: the builder keeps the 72° sample, stamped`, () => {
      const { container } = mount(Component, {}, 'builder');
      expect(textIn(container)).toContain('72');
      expect(stamped(container)).toBe(true);
    });
  }

  it('shows the real reading on a real screen, and a failed fetch never becomes 72°', async () => {
    const neon = WEATHER.find((w) => w.type === 'WX_NEON')!.Component as AnyWidget;
    const WeatherNeon = neon;
    global.fetch = jest.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes('geocoding')
        ? { results: [{ latitude: 40, longitude: -75 }] }
        : { current_weather: { temperature: 55.4, weathercode: 61 }, daily: { temperature_2m_max: [61.2], temperature_2m_min: [44.9] } }),
    })) as unknown as typeof fetch;
    const ok = mount(neon, { location: 'Philadelphia' }, 'player');
    await waitFor(() => expect(textIn(ok.container)).toContain('55'));
    expect(textIn(ok.container)).toContain('HI 61°F');
    expect(textIn(ok.container)).toContain('RAINY');
    // Clearing the location drops that place's reading at once.
    ok.rerender(<RenderSurfaceProvider surface="player"><WeatherNeon config={{}} live={false} /></RenderSurfaceProvider>);
    expect(textIn(ok.container)).not.toContain('55');
    expect(textIn(ok.container)).toContain('—');
    ok.unmount();

    global.fetch = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const down = mount(neon, { location: 'Philadelphia' }, 'player');
    await act(async () => { await Promise.resolve(); });
    expect(textIn(down.container)).not.toContain('72');
    expect(textIn(down.container)).toContain('—');
  });

  it('a reply with no current temperature is no reading (it used to become 70°)', async () => {
    const glass = WEATHER.find((w) => w.type === 'WX_GLASS')!.Component as AnyWidget;
    const fetchSpy = jest.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes('geocoding') ? { results: [{ latitude: 1, longitude: 2 }] } : { current_weather: {} }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;
    const { container } = mount(glass, { location: 'Nowhere' }, 'player');
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(textIn(container)).not.toContain('70');
    expect(textIn(container)).toContain('—');
  });
});

describe('themed weather variants (useLiveWeather)', () => {
  const THEMED: Array<[string, AnyWidget]> = [
    ['Lobby Welcome', LobbyWelcomeWeather as AnyWidget],
    ['Final Chance', FinalChanceWeather as AnyWidget],
    ['Bus Loop', BusLoopWeather as AnyWidget],
    ['Modern 2026 hero', WeatherHero as AnyWidget],
  ];

  for (const [name, Component] of THEMED) {
    it(`${name}: no location on a real screen → no 72°, no Sunny, no Springfield, no sun`, () => {
      const { container } = mount(Component, {}, 'player');
      const text = textIn(container);
      for (const s of ['72', 'Sunny', 'Springfield', '78', '64', '☀️']) {
        expect({ name, leaked: s, shown: text.includes(s) }).toEqual({ name, leaked: s, shown: false });
      }
      expect(text).toContain('—');
      expect(text).not.toContain('—°');
      expect(stamped(container)).toBe(false);
    });

    it(`${name}: the builder keeps its sample, stamped`, () => {
      const { container } = mount(Component, {}, 'builder');
      expect(textIn(container)).toContain('72°');
      expect(stamped(container)).toBe(true);
    });
  }

  it('a live reading shows on a real screen with its own condition', async () => {
    fetchWeatherMock.mockResolvedValue({ temp: 48, feelsLike: 45, humidity: 80, wind: 5, weatherCode: 61, high: 52, low: 40, locationName: 'Erie, PA' });
    const { container } = mount(LobbyWelcomeWeather as AnyWidget, { location: 'Erie' }, 'player');
    await waitFor(() => expect(textIn(container)).toContain('48°'));
    expect(textIn(container)).not.toContain('Sunny');
    expect(stamped(container)).toBe(false);
  });
});

describe('useLiveWeather keeps a reading through failed refreshes — for an hour, not forever', () => {
  function Probe({ config }: { config: Record<string, unknown> }) {
    const w = useLiveWeather(config);
    return <div data-testid="t">{String(w.temp)}</div>;
  }

  it('holds the last good reading, then lets it go', async () => {
    jest.useFakeTimers();
    fetchWeatherMock.mockResolvedValueOnce({ temp: 50, feelsLike: 50, humidity: 50, wind: 0, weatherCode: 0, high: 55, low: 45, locationName: 'Town' });
    fetchWeatherMock.mockResolvedValue(null);
    const { getByTestId } = render(
      <RenderSurfaceProvider surface="player"><Probe config={{ location: 'Town' }} /></RenderSurfaceProvider>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(getByTestId('t').textContent).toBe('50');

    // Three failed refreshes (45 min) — still this hour's reading.
    for (let i = 0; i < 3; i++) {
      await act(async () => { jest.advanceTimersByTime(15 * 60 * 1000); await Promise.resolve(); });
    }
    expect(getByTestId('t').textContent).toBe('50');

    // Past the hold: the screen stops presenting a stale reading as now.
    for (let elapsed = 45 * 60 * 1000; elapsed <= WEATHER_HOLD_MS + 15 * 60 * 1000; elapsed += 15 * 60 * 1000) {
      await act(async () => { jest.advanceTimersByTime(15 * 60 * 1000); await Promise.resolve(); });
    }
    expect(getByTestId('t').textContent).toBe('—');
  });
});

describe('News Feed (RSS) on a real screen', () => {
  const Rss = RSSWidget as unknown as AnyWidget;
  const SAMPLE_HEADLINES = ['School District Announces New STEM Program', 'Board Meeting Highlights: Budget Approved'];
  const mountRss = (config: Record<string, unknown>, surface: 'builder' | 'player') => {
    const node = <RSSWidget config={config} compact={false} />;
    return render(surface === 'player' ? <RenderSurfaceProvider surface="player">{node}</RenderSurfaceProvider> : node);
  };

  it('no feed → no made-up headline and no "Sample headlines" label', () => {
    const { container } = mountRss({}, 'player');
    const text = textIn(container);
    for (const h of SAMPLE_HEADLINES) expect(text).not.toContain(h);
    expect(text).not.toContain('Sample headlines');
    expect(Rss).toBeDefined();
  });

  it('feed still loading → "Connecting…", no sample underneath', () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    const { container } = mountRss({ feedUrl: 'https://example.org/feed.xml' }, 'player');
    const text = textIn(container);
    expect(text).toContain('Connecting…');
    for (const h of SAMPLE_HEADLINES) expect(text).not.toContain(h);
  });

  it('feed failed → says so, and shows no sample', async () => {
    global.fetch = jest.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch;
    const { container } = mountRss({ feedUrl: 'https://example.org/broken.xml' }, 'player');
    await waitFor(() => expect(textIn(container)).toContain("Couldn't load this feed yet."));
    const text = textIn(container);
    expect(text).not.toContain('showing sample headlines');
    expect(text).not.toContain('Connecting…');
    for (const h of SAMPLE_HEADLINES) expect(text).not.toContain(h);
  });

  it('the builder still previews sample headlines, labelled', () => {
    const { container } = mountRss({}, 'builder');
    const text = textIn(container);
    expect(text).toContain('Sample headlines');
    expect(text).toContain(SAMPLE_HEADLINES[0]);
  });
});
