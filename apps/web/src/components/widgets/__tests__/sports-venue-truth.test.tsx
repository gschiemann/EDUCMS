/**
 * K-12 launch audit F28 / F38 (2026-09-27) — the sports-venue pack renders
 * only what is true: the bound game, what the school typed, or (in the
 * builder only) a stamped school-safe sample.
 *
 * Every case drives the real `WidgetPreview` dispatcher with the variant id
 * the builder stores (CLAUDE.md rule #9), on both surfaces:
 *   - builder (renderSurface unset): the sample shows AND is stamped SAMPLE;
 *   - a real screen (renderSurface="player"): with nothing configured, not
 *     one word of sample content and no stamp.
 */
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import { WidgetPreview } from '../WidgetRenderer';
import '../variants-register';
import { warmAllWidgetFamilies } from '../widget-families';
import { warmVariantRegistry } from '../WidgetRenderer';
import { GameStateProvider } from '../sports/GameStateContext';
import { SPORTS_VENUE_WIDGETS } from '../v2/registry';
import * as fs from 'fs';
import * as path from 'path';

// `qrcode` (the wayfinding QR) encodes through TextEncoder, which jsdom lacks.
(global as unknown as { TextEncoder?: unknown }).TextEncoder ??= NodeTextEncoder;
(global as unknown as { TextDecoder?: unknown }).TextDecoder ??= NodeTextDecoder;

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
beforeAll(async () => {
  // withMeasuredHeight renders nothing until it measures a height; jsdom has
  // no layout, so give every box one.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 480; } });
  await warmAllWidgetFamilies();
  await warmVariantRegistry();
});
afterAll(() => {
  if (realOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetHeight);
});
afterEach(() => cleanup());

const VARIANT = (type: string) => type.toLowerCase().replace(/_/g, '-');
const VENUE = SPORTS_VENUE_WIDGETS.map((w) => ({ type: w.type, variant: VARIANT(w.type), defaults: (w.defaults || {}) as Record<string, unknown> }));

function renderVenue(variant: string, config: Record<string, unknown>, surface?: 'player') {
  return render(
    <div style={{ position: 'relative', width: 1200, height: 480 }}>
      <WidgetPreview
        widgetType="SCOREBOARD"
        config={{ variant, ...config }}
        width={100}
        height={100}
        live={surface === 'player'}
        renderSurface={surface}
      />
    </div>,
  );
}

/** Words the pack's old samples put on real screens. None may ever render. */
const FORBIDDEN = /budweiser|\bbeer\b|king of beers|bulls|celtics|kiss cam|jeweled|popeye|american airlines|aadvantage|goose island|age 8|united center|caleb williams|coby white|out-of-town|updated live|db · live/i;

/** Distinctive words from the school-safe DEMO content (builder only). */
const DEMO_WORDS = /eagles|jordan|maya patel|main concession stand|your sponsor|class of 2027|t-shirt toss|central|pink out|thank you to our booster|main lobby/i;

describe('F28/F38 — every venue variant, freshly dropped', () => {
  it('the registry seeds settings only — no sample copy in any default', () => {
    for (const v of VENUE) {
      const copyKeys = Object.keys(v.defaults).filter((k) => !['dataMode', 'side', 'scrollSpeed', 'bg', 'tone', 'shape', 'kind', 'accent', 'level', 'label'].includes(k));
      expect({ variant: v.variant, copyKeys }).toEqual({ variant: v.variant, copyKeys: [] });
    }
  });

  for (const v of VENUE) {
    it(`${v.variant}: a real screen with nothing configured shows no sample content, no stamp, no pro / adult copy`, () => {
      const { container } = renderVenue(v.variant, v.defaults, 'player');
      const text = container.textContent || '';
      expect(text).not.toMatch(DEMO_WORDS);
      expect(text).not.toMatch(FORBIDDEN);
      expect(container.querySelector('[data-venue-sample]')).toBeNull();
      // A real screen never claims a live reading it does not have.
      expect(text).not.toMatch(/\bLIVE\b/);
    });

    it(`${v.variant}: the builder shows school-safe content (stamped SAMPLE when it is sample)`, () => {
      const { container } = renderVenue(v.variant, v.defaults);
      const text = container.textContent || '';
      expect(text).not.toMatch(FORBIDDEN);
      expect(text).not.toMatch(/\bLIVE\b/);
      // Every widget whose content comes from the school stamps its sample;
      // the fan-cam frame and crowd animation carry no sample content.
      if (!['kiss-cam', 'noise-meter'].includes(v.variant)) {
        expect(container.querySelector('[data-venue-sample]')).not.toBeNull();
      }
    });
  }
});

describe('F38 — zones saved with the OLD seeded defaults render school-safe', () => {
  const OLD: Record<string, Record<string, unknown>> = {
    'stadium-scoreboard': { sport: 'BASKETBALL', clock: '4:21', period: 'Q3', homeFouls: 5, awayFouls: 3, topSponsor: 'PRESENTED BY · MIDWEST AUTO GROUP', bottomSponsor: 'BUDWEISER · OFFICIAL BEER PARTNER' },
    'ribbon-sponsor': { sponsor: 'BUDWEISER', tagline: 'KING OF BEERS', cta: 'now pouring · sec 110-114', bg: '#dc2626' },
    'ribbon-fan-shoutout': { kind: 'HAPPY BIRTHDAY', name: 'JAMES, AGE 8', from: 'YOUR BULLS FAMILY' },
    'kiss-cam': { kind: 'KISS CAM', tone: '#ec4899', sponsor: 'BROUGHT TO YOU BY JEWELED VOWS DIAMOND CO.' },
    'in-game-promo': { kicker: "BROUGHT TO YOU BY POPEYE'S", title: 'T-SHIRT TOSS', subtitle: 'Look up · catch a shirt · take a selfie · tag @ChicagoBulls' },
    'sponsor-takeover': { sponsor: 'AMERICAN AIRLINES', tagline: 'Going for great.', body: 'Fly the Bulls and earn double AAdvantage miles all season long.', cta: 'aa.com/bulls' },
    'gate-wayfinding': { section: '212', gate: 'B', distance: '4 MIN WALK', directions: 'Take the escalator to the upper concourse, walk left past Goose Island.' },
  };
  for (const [variant, cfg] of Object.entries(OLD)) {
    it(`${variant}: no beer / pro-team / jeweller / child-name copy on a real screen`, () => {
      const { container } = renderVenue(variant, cfg, 'player');
      const text = container.textContent || '';
      expect(text).not.toMatch(/budweiser|beer|bulls|jeweled|popeye|american airlines|aadvantage|goose island|age 8|midwest auto/i);
    });
  }

  it('the old Stadium Scoreboard seed ("4:21 · Q3", fouls 5/3) is not a game: a real screen shows dashes', () => {
    const { container } = renderVenue('stadium-scoreboard', OLD['stadium-scoreboard'], 'player');
    const text = container.textContent || '';
    expect(text).not.toContain('4:21');
    expect(text).not.toContain('Q3');
    expect(text).toContain('—:—');
  });
});

describe('F28 — the Crowd Meter is an animation, not a measurement', () => {
  it('prints no decibel number and never says LIVE, even with the old level set', () => {
    for (const surface of [undefined, 'player'] as const) {
      const { container } = renderVenue('noise-meter', { prompt: 'Get LOUD!', target: 100, level: 87 }, surface);
      const text = container.textContent || '';
      expect(text).not.toMatch(/\bDB\b|decibel|\bLIVE\b/i);
      expect(text).not.toContain('87');
      expect(text).not.toMatch(/target/i);
      cleanup();
    }
  });
});

describe('F28 — manual score boards never claim to be live', () => {
  it('out-of-town scores: an operator-typed LIVE status is shown as typed, with no pulsing live claim; "AS OF" when stamped', () => {
    const asOf = new Date().toISOString();
    const { container } = renderVenue('out-of-town-scores', {
      asOf,
      games: [{ status: 'Q2', away: { code: 'CEN', score: 20, color: '#0f766e' }, home: { code: 'NOR', score: 18, color: '#1d4ed8' }, note: '4:10' }],
    }, 'player');
    const text = container.textContent || '';
    expect(text).toContain('CEN');
    expect(text).toMatch(/AS OF \d{1,2}:\d{2} (AM|PM)/);
    expect(text).not.toMatch(/●|UPDATED LIVE/);
  });
});

/* ── live game binding ─────────────────────────────────────────── */

const LIVE_GAME = {
  id: 'venue-game',
  sport: 'basketball',
  status: 'LIVE',
  segment: 3,
  homeTeam: 'Riverside Hawks',
  awayTeam: 'Lakeview Wolves',
  homeScore: 41,
  awayScore: 37,
  homeColor: '#0f766e',
  awayColor: '#7c2d12',
  homeLogoUrl: null,
  awayLogoUrl: null,
  clockMs: 5 * 60_000 + 7_000,
  clockRunning: false,
  clockUpdatedAt: new Date().toISOString(),
  stats: { homeFouls: 4, awayFouls: 6, homeTimeouts: 2, awayTimeouts: 1, possession: 'away' },
  serverTime: Date.now(),
  roster: [
    { id: 'h1', team: 'home', name: 'Jamie Ortiz', number: '5', position: 'G', photoUrl: null, stats: { PTS: '12' } },
    { id: 'h2', team: 'home', name: 'Chris Nguyen', number: '15', position: 'F', photoUrl: null, stats: {} },
    { id: 'a1', team: 'away', name: 'Pat Kim', number: '5', position: 'C', photoUrl: null, stats: {} },
  ],
};

function withLiveGame(ui: React.ReactElement) {
  const fn = jest.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(LIVE_GAME) }));
  (global as unknown as { fetch: unknown }).fetch = fn as unknown as typeof fetch;
  return render(<GameStateProvider gameId="venue-game">{ui}</GameStateProvider>);
}

function venueNode(variant: string, config: Record<string, unknown> = {}) {
  return (
    <div style={{ position: 'relative', width: 1200, height: 480 }}>
      <WidgetPreview widgetType="SCOREBOARD" config={{ variant, ...config }} width={100} height={100} live renderSurface="player" />
    </div>
  );
}

describe('F28 — live-capable venue widgets read the bound game', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('stadium scoreboard: real teams, score, clock, fouls, possession — a stale typed clock never masks it', async () => {
    const { container } = withLiveGame(venueNode('stadium-scoreboard', { dataMode: 'live', clock: '4:21', period: 'Q3', home: { score: 99 } }));
    await waitFor(() => expect(container.textContent).toContain('Riverside Hawks'));
    // The provider projects the clock in an effect after the snapshot lands.
    await waitFor(() => expect(container.textContent).toContain('5:07'));
    const text = container.textContent || '';
    expect(text).toContain('Lakeview Wolves');
    expect(text).toContain('41');
    expect(text).toContain('37');
    expect(text).toContain('5:07');
    expect(text).toContain('Q3');
    expect(text).not.toContain('4:21');
    expect(text).not.toContain('99');
    expect(text).toContain('POSS ▶');
    expect(text).toContain('TIMEOUTS 2 · 1');
    expect(container.querySelector('[data-venue-sample]')).toBeNull();
  });

  it('ribbon ticker: live scoreline beside the operator\'s own messages', async () => {
    const { container } = withLiveGame(venueNode('ribbon-ticker', { dataMode: 'live', segments: [{ text: 'GO HAWKS' }] }));
    await waitFor(() => expect(container.textContent).toContain('RIV'));
    expect(container.textContent).toContain('41');
    expect(container.textContent).toContain('GO HAWKS');
  });

  it('starting lineup: the bound game\'s roster for the chosen side', async () => {
    const { container } = withLiveGame(venueNode('starting-lineup', { dataMode: 'live', side: 'home' }));
    await waitFor(() => expect(container.textContent).toContain('ORTIZ'));
    expect(container.textContent).toContain('NGUYEN');
    expect(container.textContent).not.toContain('KIM');
  });

  it('player card: the roster player by side + jersey number', async () => {
    const { container } = withLiveGame(venueNode('player-card', { dataMode: 'live', side: 'away', number: '5' }));
    await waitFor(() => expect(container.textContent).toContain('KIM'));
    expect(container.textContent).not.toContain('ORTIZ');
  });

  it('stat comparison: the game\'s head-to-head team stats', async () => {
    const { container } = withLiveGame(venueNode('stat-comparison', { dataMode: 'live' }));
    await waitFor(() => expect(container.textContent).toContain('FOULS'));
    expect(container.textContent).toContain('THIS GAME');
    expect(container.textContent).toContain('TIMEOUTS');
  });

  it('goal celebration: the celebrating team from the game, with the live score kept on screen', async () => {
    const { container } = withLiveGame(venueNode('goal-celebration', { dataMode: 'live', side: 'home', label: 'GOAL!' }));
    await waitFor(() => expect(container.textContent).toContain('RIVERSIDE HAWKS SCORE!'));
    expect(container.textContent).toContain('RIV 41 – 37 LAK');
  });

  it('manual mode ignores the game entirely — every value is typed', async () => {
    const { container } = withLiveGame(venueNode('stadium-scoreboard', { dataMode: 'manual', home: { name: 'Blue Team', score: 7 }, away: { name: 'Gold Team', score: 5 }, clock: '2:00' }));
    await waitFor(() => expect(container.textContent).toContain('Blue Team'));
    expect(container.textContent).not.toContain('Riverside Hawks');
    expect(container.textContent).toContain('2:00');
  });
});

describe('F28 — the universal Scores Board (Live Data pack) is not a live feed', () => {
  function renderScores(config: Record<string, unknown>, surface?: 'player') {
    return render(
      <div style={{ position: 'relative', width: 1200, height: 480 }}>
        <WidgetPreview widgetType="LIVE_DATA" config={{ variant: 'sports-scoreboard', ...config }} width={100} height={100} live={surface === 'player'} renderSurface={surface} />
      </div>,
    );
  }
  it('a real screen with nothing entered: no invented games, no LIVE header, no hardcoded time', () => {
    // The old seed: { league: 'NBA', accent } — still in zones saved before.
    const { container } = renderScores({ league: 'NBA', accent: '#ffd23a' }, 'player');
    const text = container.textContent || '';
    expect(text).not.toMatch(/lakers|celtics|warriors|LIVE SCOREBOARD|7:00 PM ET|\bLIVE\b/i);
    expect(container.querySelector('[data-venue-sample]')).toBeNull();
  });
  it('the builder shows a school-safe sample, stamped', () => {
    const { container } = renderScores({ accent: '#ffd23a' });
    expect(container.textContent).toContain('Northgate');
    expect(container.querySelector('[data-venue-sample]')).not.toBeNull();
  });
  it('typed rows render as typed, with the AS OF stamp', () => {
    const { container } = renderScores({
      asOf: new Date().toISOString(),
      games: [{ status: 'FINAL', away: { name: 'Central', score: 51, logo: '#0f766e' }, home: { name: 'Northgate', score: 47, logo: '#1d4ed8' } }],
    }, 'player');
    expect(container.textContent).toContain('Central');
    expect(container.textContent).toMatch(/AS OF \d{1,2}:\d{2} (AM|PM)/);
    expect(container.textContent).not.toMatch(/\bLIVE\b/);
  });
});

describe('F28 — drift guard for the v2 sports packs', () => {
  // The sports/ drift-catcher (nofake-sweep) only scans components/widgets/
  // sports — which is exactly how this pack and the HS/College/Pro board
  // shipped fabricated games past it. Hold the two v2 sports files to the
  // same rule: anything that can show demo content consults the surface.
  it.each(['SportsVenueWidgets.tsx', 'SportsScoreboardWidgets.tsx'])('%s consults useRenderSurface or useGameState', (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'v2', file), 'utf8');
    expect(src.includes('useRenderSurface') || src.includes('useGameState')).toBe(true);
  });
});

describe('F28 — the public board routes are a real screen', () => {
  it('CustomScoreboardScene renders its zones with renderSurface="player"', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', 'board', '[gameId]', 'CustomScoreboardScene.tsx'), 'utf8');
    expect(src).toMatch(/<WidgetPreview[\s\S]*?renderSurface="player"[\s\S]*?\/>/);
  });
});
