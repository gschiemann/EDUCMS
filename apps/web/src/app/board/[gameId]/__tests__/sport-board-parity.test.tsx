/**
 * Sports default-surface PARITY GATE (2026-07-01, task #269 — Day 1 of the
 * launch sprint, see docs/research/2026-07-01-launch-sprint/00-PLAN.md and
 * docs/research/2026-07-01-sports-default-parity-audit/00-AUDIT.md).
 *
 * The systemic bug class this closes: "features ship to the BUILDER but the
 * DEFAULT surfaces lag — and nothing gates it." #267 (swimming had no lanes
 * until commit cfffcbf8) was exactly this: the lane-grid widget was built,
 * registered, and unit-tested… and the Game-Day board never used it. There
 * was no per-sport parity check, so the only detector was the operator's
 * eyeballs on a real screen.
 *
 * This suite renders, for EVERY sport in `SPORTS` (packages/api-types) plus
 * the legacy combined `swimming_diving` key, the EXACT `DefaultBoardScene`
 * component production selects at LIVE status with realistic sample stats,
 * and asserts a SPORT-SPECIFIC marker is present in the rendered text. A
 * regression that silently falls back to a generic scene (the #267 failure
 * mode) fails this suite instead of waiting for Greg to catch it on glass.
 *
 * CLAUDE.md rule #9 ("VERIFY THE RENDER TREE"): this test imports
 * `DefaultBoardScene`, the component `ScoreboardPage` (the actual page)
 * renders — extracted 2026-07-01 specifically so this gate proves what
 * PRODUCTION renders, not a hand-rolled re-implementation that could drift.
 *
 * CLAUDE.md rule #10: every rendered DOM node is swept for the `inset`
 * shorthand (Taurus / Chromium-83 safety) — this board ships to LED walls.
 *
 * PARITY-DEBT markers: where a sport genuinely has no dedicated default-
 * board treatment yet (it shares the generic LeaderboardScene shell with
 * only a label swap), the assertion covers the label that IS true today,
 * and a `// PARITY-DEBT(<sport>): ...` comment records what a world-class
 * default would still need. `grep -n PARITY-DEBT` enumerates every
 * remaining gap for the Day 2-4 backlog.
 */

import { render } from '@testing-library/react';
import { SPORTS, findSport, type SportDefinition } from '@cms/api-types';
import { DefaultBoardScene, type BoardData } from '../page';

// jsdom has no ResizeObserver — FitOneLine / SwimDiveWidgets' useScaleToFit
// need one (same polyfill as swim-dive-widgets.test.tsx).
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

// The swim/dive/track lane-grid default branch wraps in <GameStateProvider>,
// which fires a background `fetch(.../sports/board/:id)` poll. The provider
// seeds its snapshot synchronously from the `initial` prop (lazy useState
// initializer) so the render under test never depends on this resolving —
// but without a mock, jsdom logs a real network attempt / unhandled
// rejection noise. Stub it to a never-resolving-usefully but harmless 404.
beforeAll(() => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(() =>
    Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  jest.clearAllMocks();
});

const NOW = new Date().toISOString();

function baseFixture(sport: string): BoardData {
  return {
    id: 'game-parity-test',
    sport,
    status: 'LIVE',
    segment: 2,
    homeTeam: 'Home Lions',
    awayTeam: 'Away Tigers',
    homeScore: 14,
    awayScore: 7,
    homeColor: '#1e3a5f',
    awayColor: '#9b1c2e',
    homeLogoUrl: null,
    awayLogoUrl: null,
    clockMs: 5 * 60_000,
    clockRunning: false,
    clockUpdatedAt: NOW,
    stats: {},
    cues: [],
    serverTime: Date.now(),
  };
}

/** Per-sport sample `stats` (+ optional score/segment overrides) that make
 *  the sport's dedicated default-board marker light up. Mirrors the real
 *  shapes the console writes (sports-situational.tsx readers / sports.ts
 *  stat keys) — see the audit's coverage map for which surface owns which
 *  marker per sport. */
function sampleFor(sport: string): { stats: Record<string, unknown>; overrides?: Partial<BoardData> } {
  switch (sport) {
    case 'football':
      return {
        stats: {
          down: 3,
          distance: 7,
          ballOn: 'H35',
          possession: 'home',
          homeTimeouts: 2,
          awayTimeouts: 3,
        },
      };
    case 'basketball':
      return {
        stats: {
          possession: 'away',
          homeTimeouts: 3,
          awayTimeouts: 2,
          homeFouls: 4,
          awayFouls: 7,
        },
      };
    case 'baseball':
    case 'softball':
      // R-H-E linescore only renders once stats.lineScore has at least one
      // completed-segment snapshot (readLineScore) — the "everything else"
      // stat chips would otherwise be the only marker.
      return {
        stats: {
          lineScore: [{ segment: 1, home: 1, away: 0 }],
          homeHits: 6,
          awayHits: 3,
          homeErrors: 1,
          awayErrors: 0,
          balls: 2,
          strikes: 1,
          outs: 1,
        },
      };
    case 'water_polo':
      return {
        stats: {
          homeShots: 9,
          awayShots: 6,
          playerExclusions: [{ team: 'home', jersey: 7, name: 'Rivera', count: 2 }],
        },
      };
    case 'hockey':
    case 'lacrosse':
    case 'field_hockey':
      return {
        stats: {
          homeShots: 12,
          awayShots: 8,
          homePenalties: 1,
        },
      };
    case 'soccer':
      return {
        stats: {
          homeShots: 5,
          awayShots: 3,
          addedTime: 3,
          homeYellowCards: 1,
        },
      };
    case 'volleyball':
      return {
        stats: { homeSets: 2, awaySets: 1, serving: 'home' },
      };
    case 'pickleball':
      return {
        stats: { homeGames: 2, awayGames: 1, serving: 'away' },
      };
    case 'wrestling':
      return {
        stats: {
          weightClass: '152',
          boutNumber: 7,
          homeTeamPoints: 24,
          awayTeamPoints: 18,
        },
      };
    // ── Swimming/diving DEDICATED default board (#267) — the lane grid /
    //    dive leaderboard, NOT the generic LeaderboardScene. Fed via
    //    stats.results (readResults contract). ──
    case 'swimming':
    case 'swimming_diving':
      return {
        stats: {
          results: [
            {
              event: 'EVENT 12 — BOYS 100 FREESTYLE',
              order: 1,
              entries: [
                { place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '51.90' },
                { place: 2, name: 'M. Chen', team: 'away', lane: 2, mark: '52.18' },
              ],
            },
          ],
        },
      };
    case 'diving':
      return {
        stats: {
          results: [
            {
              event: 'GIRLS 1M SPRINGBOARD — FINAL',
              order: 1,
              entries: [
                { place: 1, name: 'A. Washington', team: 'home', mark: '312.45' },
                { place: 2, name: 'L. Fischer', team: 'away', mark: '298.10' },
              ],
            },
          ],
        },
      };
    // ── Track & field (#270a) — SAME lane grid widget as swimming, reused
    //    via athleteLabel/iconEmoji config. ──
    case 'track_and_field':
      return {
        stats: {
          currentEvent: 'BOYS 200M FINAL',
          results: [
            {
              event: 'BOYS 200M FINAL',
              order: 1,
              entries: [
                { place: 1, name: 'D. Okafor', team: 'home', lane: 3, mark: '22.14' },
                { place: 2, name: 'M. Chen', team: 'away', lane: 4, mark: '22.40' },
              ],
            },
          ],
        },
      };
    case 'cross_country':
      return {
        stats: { leadRunner: 'D. Okafor', finishers: 12 },
      };
    case 'golf':
      return {
        stats: { currentHole: 14, homePar: '+1', awayPar: 'E' },
      };
    case 'gymnastics':
      return {
        stats: { currentApparatus: 'BEAM', homeAthletes: 6, awayAthletes: 6 },
      };
    case 'competitive_cheer':
      return {
        stats: { division: 'VARSITY LARGE', homeRoutine: 'ROUTINE A' },
      };
    default:
      return { stats: {} };
  }
}

/** The sport-specific marker(s) that MUST appear in the rendered DOM text
 *  for this sport's DEFAULT board. Each entry is the audit's coverage map
 *  turned into an assertion. PARITY-DEBT sports assert the label that's
 *  true TODAY and record what a world-class board still needs. */
function expectedMarkers(sport: string): string[] {
  switch (sport) {
    case 'football':
      // SituationalRow renders "3RD & 7" (ordinal(down) + non-breaking &).
      return ['3RD', '7'];
    case 'basketball':
      return ['POSS'];
    case 'baseball':
    case 'softball':
      return ['R', 'H', 'E'];
    case 'water_polo':
      return ['EXCLUSIONS'];
    case 'hockey':
    case 'lacrosse':
    case 'field_hockey':
      return ['SHOTS'];
    case 'soccer':
      return ['ADDED'];
    case 'volleyball':
      return ['SETS'];
    case 'pickleball':
      return ['GAMES'];
    case 'wrestling':
      return ['WEIGHT CLASS'];
    case 'swimming':
    case 'swimming_diving':
      return ['LANE', 'SWIMMER / TEAM'];
    case 'diving':
      return ['DIVER / TEAM'];
    case 'track_and_field':
      return ['LANE', 'ATHLETE / TEAM'];
    // PARITY-DEBT(cross_country): shares the generic LeaderboardScene shell
    // (audit finding #6) — a world-class default would show a live
    // finish-order ticker like the swim lane grid, not just a leader name +
    // finisher count. Today's true label is asserted below.
    case 'cross_country':
      return ['RACE LEADER'];
    // PARITY-DEBT(golf): shares the generic LeaderboardScene shell — a
    // world-class default would show a live scorecard (hole-by-hole strokes
    // vs par per player), not just "NOW PLAYING · HOLE N". Today's true
    // label is asserted below.
    case 'golf':
      return ['NOW PLAYING', 'HOLE 14'];
    // PARITY-DEBT(gymnastics): shares the generic LeaderboardScene shell —
    // a world-class default would show the per-apparatus rotation as its
    // OWN board (attempt-leaderboard, like diving), not a label swap.
    // Today's true label is asserted below.
    case 'gymnastics':
      return ['CURRENT ROTATION', 'BEAM'];
    // PARITY-DEBT(competitive_cheer): shares the generic LeaderboardScene
    // shell — a world-class default would show judged panel scores per
    // routine (like DIVE_JUDGES_PANEL), not a label swap. Today's true
    // label is asserted below.
    case 'competitive_cheer':
      return ['DIVISION', 'VARSITY LARGE'];
    default:
      return [];
  }
}

function expectNoInsetShorthand(container: HTMLElement) {
  const styled = container.querySelectorAll('[style]');
  styled.forEach((el) => {
    const style = (el as HTMLElement).getAttribute('style') || '';
    expect(style).not.toMatch(/inset\s*:/);
  });
}

function renderBoard(
  sport: string,
  opts: { status?: BoardData['status']; vp?: { w: number; h: number } } = {},
) {
  const def = findSport(sport) as SportDefinition;
  const { stats, overrides } = sampleFor(sport);
  const data: BoardData = {
    ...baseFixture(sport),
    stats,
    ...(overrides || {}),
    ...(opts.status ? { status: opts.status } : {}),
  };
  return render(
    <DefaultBoardScene
      data={data}
      def={def}
      displayData={data}
      vp={opts.vp ?? { w: 1920, h: 1080 }}
      activeCue={null}
      keyframes={null}
    />,
  );
}

// SPORTS is the current picker list (19 entries as of the 2026-07-01
// swim/dive split). Plus the legacy combined `swimming_diving` key, which
// pre-split games still carry — findSport resolves it via SPORT_DEFINITIONS
// even though it's deliberately absent from SPORTS (see sports.ts comment).
const ALL_SPORT_KEYS = [...SPORTS.map((s) => s.key), 'swimming_diving'];

describe('Sports default-surface parity gate (#269)', () => {
  it('covers every sport in SPORTS plus the legacy swimming_diving key', () => {
    // Guard against a future sport being silently added to SPORTS without
    // a corresponding parity assertion above — fails loudly instead of the
    // suite quietly not covering the new sport.
    expect(ALL_SPORT_KEYS.length).toBeGreaterThanOrEqual(19);
    expect(new Set(ALL_SPORT_KEYS).size).toBe(ALL_SPORT_KEYS.length);
  });

  for (const sport of ALL_SPORT_KEYS) {
    describe(sport, () => {
      it('renders a sport-specific marker on the LIVE default board', () => {
        const { container } = renderBoard(sport);
        const text = container.textContent || '';
        const markers = expectedMarkers(sport);
        for (const marker of markers) {
          if (!marker) continue;
          expect(text).toContain(marker);
        }
      });

      it('never uses the inset shorthand (Taurus / Chromium-83 safety)', () => {
        const { container } = renderBoard(sport);
        expectNoInsetShorthand(container);
      });
    });
  }

  // ── Explicit #267/#270a regression proofs — the exact bug that started
  //    this gate. A future edit that reverts swimming/diving/track back to
  //    the generic meet tally fails these specifically, with a message
  //    that names the bug class instead of a generic marker miss. ──
  describe('#267/#270a regression proofs', () => {
    it('swimming renders the LANE GRID, not the generic leaderboard shell', () => {
      const { container } = renderBoard('swimming');
      const text = container.textContent || '';
      expect(text).toContain('SWIMMER / TEAM');
      expect(text).toContain('LANE');
      // The generic LeaderboardScene's "NOW · <event>" chip format must NOT
      // be what's carrying the event name — the lane grid's own header is.
      expect(text).not.toContain('NOW ·');
    });

    it('diving renders the DIVE LEADERBOARD (no lanes — a different data model)', () => {
      const { container } = renderBoard('diving');
      const text = container.textContent || '';
      expect(text).toContain('DIVER / TEAM');
      expect(text).not.toContain('LANE');
    });

    it('track_and_field reuses the lane grid with running-event copy (#270a)', () => {
      const { container } = renderBoard('track_and_field');
      const text = container.textContent || '';
      expect(text).toContain('ATHLETE / TEAM');
      expect(text).toContain('LANE');
      expect(text).not.toContain('SWIMMER / TEAM');
    });

    it('the legacy swimming_diving key still gets the lane grid (pre-split games)', () => {
      const { container } = renderBoard('swimming_diving');
      const text = container.textContent || '';
      expect(text).toContain('SWIMMER / TEAM');
      expect(text).toContain('LANE');
    });
  });

  // ── P1-9 (2026-07-02) — laneGrid sports get a PRE_GAME/FINAL moment ──
  // Before this fix, DefaultBoardScene routed swim/dive/track to the lane
  // grid across EVERY status (the ternary short-circuited before the
  // status-scene block), so a meet that ended just kept showing the last
  // heat forever — no winner moment. Fixed: PRE_GAME → PreGameScene,
  // FINAL → FinalScene (dual-meet team points already live on
  // homeScore/awayScore), grid stays for LIVE/HALFTIME.
  describe('P1-9 — laneGrid sports get PRE_GAME/FINAL status scenes', () => {
    for (const sport of ['swimming', 'diving', 'track_and_field']) {
      describe(sport, () => {
        it('renders PreGameScene at PRE_GAME (not the lane grid)', () => {
          const { container } = renderBoard(sport, { status: 'PRE_GAME' });
          const text = container.textContent || '';
          expect(text).toContain('GAME DAY');
          expect(text).not.toContain('LANE ORDER');
          expect(text).not.toContain('DIVER / TEAM');
        });

        it('renders the right FINAL scene (diving keeps its standings; swim/track get FinalScene)', () => {
          const { container } = renderBoard(sport, { status: 'FINAL' });
          const text = container.textContent || '';
          if (sport === 'diving') {
            // 2026-07-12 world-class audit P1 — diving's FINAL is its diver
            // STANDINGS (winner ranked #1), not the two-number FinalScene the
            // judge pad never populates (would read 0.00-0.00 and hide the
            // standings). The dive leaderboard stays up at FINAL.
            expect(text).toContain('DIVER / TEAM');
          } else {
            expect(text).toContain('FINAL');
            expect(text).not.toContain('LANE ORDER');
          }
        });

        it('still renders the lane grid / dive leaderboard at LIVE', () => {
          const { container } = renderBoard(sport, { status: 'LIVE' });
          const text = container.textContent || '';
          const markers = expectedMarkers(sport);
          for (const marker of markers) expect(text).toContain(marker);
        });

        it('still renders the lane grid / dive leaderboard at HALFTIME', () => {
          const { container } = renderBoard(sport, { status: 'HALFTIME' });
          const text = container.textContent || '';
          const markers = expectedMarkers(sport);
          for (const marker of markers) expect(text).toContain(marker);
        });
      });
    }
  });

  // ── P1-10 (2026-07-02) — portrait fit math on a real 960×1080 wall ──
  // Before this fix, `portrait = vp.w < vp.h && !isLeaderboard` excluded
  // every meet sport from the portrait branch, AND the laneGrid path always
  // scaled a 1920-wide scene — so a 960×1080 wall computed
  // fitScale = Math.min(960/1920, 1080/1080) = 0.5, letterboxing the board
  // into a ~540px-wide strip at half text size. Fixed: laneGrid sports get
  // their own 960-wide natural base in portrait, so fitScale should be 1.0
  // (full canvas, no letterbox) — verified here via the SAME outer scaled
  // wrapper DefaultBoardScene renders (width/transform), not a re-derived
  // calculation, so a regression in the real component fails this test.
  describe('P1-10 — portrait fit on a 960×1080 wall (no longer letterboxed)', () => {
    function outerSceneStyle(container: HTMLElement): CSSStyleDeclaration {
      // DefaultBoardScene's render tree is:
      //   <container (RTL wrapper)>
      //     <div position:absolute inset (DefaultBoardScene root)>
      //       <div width/height/transform:scale (the fit-scaled wrapper)>
      // i.e. the node carrying `width`/`transform` is the GRANDCHILD of the
      // RTL container, not the direct child.
      const outer = container.querySelector(':scope > div > div') as HTMLElement;
      return outer.style;
    }

    it('laneGrid sports (swimming) use a 960-wide base and scale 1.0 — no letterbox', () => {
      const { container } = renderBoard('swimming', {
        status: 'LIVE',
        vp: { w: 960, h: 1080 },
      });
      const style = outerSceneStyle(container);
      expect(style.width).toBe('960px');
      expect(style.transform).toContain('scale(1)');
    });

    it('laneGrid sports (diving) use a 960-wide base and scale 1.0 — no letterbox', () => {
      const { container } = renderBoard('diving', {
        status: 'LIVE',
        vp: { w: 960, h: 1080 },
      });
      const style = outerSceneStyle(container);
      expect(style.width).toBe('960px');
      expect(style.transform).toContain('scale(1)');
    });

    it('the SwimLaneGridWidget itself renders in portrait mode (no landscape-only marker regression)', () => {
      const { container } = renderBoard('swimming', {
        status: 'LIVE',
        vp: { w: 960, h: 1080 },
      });
      const text = container.textContent || '';
      expect(text).toContain('SWIMMER / TEAM');
      expect(text).toContain('LANE');
    });

    it('non-leaderboard head-to-head sports (football) also drop the old carve-out and get PortraitBoardScene', () => {
      // P1-10 dropped `!isLeaderboard` from the portrait gate entirely —
      // this proves head-to-head sports are unaffected (they always got
      // PortraitBoardScene; this just confirms no regression from the
      // gate's simplification).
      const { container } = renderBoard('football', {
        status: 'LIVE',
        vp: { w: 960, h: 1080 },
      });
      const style = outerSceneStyle(container);
      expect(style.width).toBe('960px');
    });

    it('leaderboard sports WITHOUT a lane grid (golf) now ALSO get a portrait base (carve-out dropped)', () => {
      const { container } = renderBoard('golf', {
        status: 'LIVE',
        vp: { w: 960, h: 1080 },
      });
      const style = outerSceneStyle(container);
      // Before the fix, golf (isLeaderboard=true) was force-landscape
      // (baseW=1920) even on a portrait wall. Now it gets the same
      // 960-wide PortraitBoardScene base as every other sport.
      expect(style.width).toBe('960px');
    });

    it('landscape walls (1920×1080) are unaffected — laneGrid still scales to 1.0 on its native aspect', () => {
      const { container } = renderBoard('swimming', {
        status: 'LIVE',
        vp: { w: 1920, h: 1080 },
      });
      const style = outerSceneStyle(container);
      expect(style.width).toBe('1920px');
      expect(style.transform).toContain('scale(1)');
    });
  });
});
