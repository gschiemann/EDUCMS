/**
 * nofake-sweep (2026-07-03) — closing the leaks the overnight review found
 * in docs/research/2026-07-02-sports-deep-pass/06-OVERNIGHT-REVIEW.md
 * ("No-fake-data / RenderSurface guard", S2 + #290 hardening pass).
 *
 * The S2/#290 pass applied the RenderSurfaceContext guard widget-by-widget
 * instead of structurally, and missed several palette-registered sports
 * widgets that still rendered fabricated SAMPLE_* data unconditionally on
 * a real player surface with nothing configured/bound:
 *
 *   1. CtsSponsorRotatorWidget  (scoreboard-cts-sponsor)      — P0
 *   2. CtsAnnouncementWidget    (scoreboard-cts-announcement) — P0
 *   3. TeamRecordWidget         (sb-team-record-home/away)    — P1
 *   4. LeaderboardWidget        (sb-leaderboard)               — P1
 *   5. RibbonScoreboardWidget's sponsor/message reel field (ribbon-main)
 *      — the widget already gated score/clock/period/abbr; the reel
 *        field was the "field the guard forgot" — P1
 *
 * Plus a verification-only case for SwimRecordLineWidget (SWIM_RECORD_LINE)
 * — flagged by the review, closed the same way once confirmed it wasn't
 * actually exempt (see the file-header comment on SwimRecordLineWidget in
 * SwimDiveWidgets.tsx for the full reasoning).
 *
 * Every case below proves BOTH directions: the real player surface with
 * nothing configured renders the neutral/bind state (never the fabricated
 * sample), AND the exact same drop-time config still renders the alive
 * SAMPLE in the builder (renderSurface unset) — zero regression for the
 * existing "the tile is never blank on the canvas" UX.
 */

import { render, screen } from '@testing-library/react';
import { WidgetPreview } from '../../WidgetRenderer';
// Side-effecting import registers every sb-*/scoreboard-cts-*/ribbon-main
// variant into the variants.ts Map (CLAUDE.md rule #9) — without it,
// `config.variant` resolves to nothing and WidgetPreview silently falls
// through to a generic widget, hiding the very regression this suite
// guards against.
import '../../variants-register';

// jsdom has no ResizeObserver — every widget under test measures its own
// zone height via ResizeObserver (same polyfill as the sibling render-
// surface suites).
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

function renderVariant(
  variant: string,
  config: Record<string, unknown> = {},
  opts: { renderSurface?: 'player'; live?: boolean } = {},
) {
  return render(
    <div style={{ position: 'relative', width: 800, height: 300 }}>
      <WidgetPreview
        widgetType="SCOREBOARD"
        config={{ variant, ...config }}
        width={100}
        height={100}
        live={opts.live}
        renderSurface={opts.renderSurface}
      />
    </div>,
  );
}

function renderWidgetType(
  widgetType: string,
  config: Record<string, unknown> = {},
  opts: { renderSurface?: 'player'; live?: boolean } = {},
) {
  return render(
    <div style={{ position: 'relative', width: 800, height: 300 }}>
      <WidgetPreview
        widgetType={widgetType}
        config={config}
        width={100}
        height={100}
        live={opts.live}
        renderSurface={opts.renderSurface}
      />
    </div>,
  );
}

describe('nofake-sweep — CtsSponsorRotatorWidget (scoreboard-cts-sponsor)', () => {
  // Matches the real drop-time defaultConfig from variants-register.ts:
  // zoneLabel/defaultDurationMs/bgColor + an EMPTY slots array — this is
  // exactly what a fresh, untouched drop looks like.
  const dropTimeConfig = { zoneLabel: 'OUR SPONSORS', defaultDurationMs: 6000, bgColor: '#1e293b', slots: [] };

  it('real player surface, freshly dropped (empty slots): renders neutral empty slot, never the fabricated sponsor reel', () => {
    renderVariant('scoreboard-cts-sponsor', dropTimeConfig, { renderSurface: 'player' });
    expect(screen.queryByText('YOUR SPONSOR HERE')).not.toBeInTheDocument();
    expect(screen.queryByText('BOOK NEXT GAME AT YOUR-CLUB.COM')).not.toBeInTheDocument();
    expect(screen.queryByText(/PROUD PARTNER/)).not.toBeInTheDocument();
  });

  it('builder (renderSurface unset), same freshly-dropped config: still shows the alive SAMPLE reel', () => {
    renderVariant('scoreboard-cts-sponsor', dropTimeConfig);
    expect(screen.getByText('YOUR SPONSOR HERE')).toBeInTheDocument();
  });

  it('real player surface WITH manual slots configured: renders the operator-configured sponsor, not neutral', () => {
    renderVariant(
      'scoreboard-cts-sponsor',
      { ...dropTimeConfig, slots: [{ text: 'ACME HARDWARE — PROUD SPONSOR', durationMs: 5000 }] },
      { renderSurface: 'player' },
    );
    expect(screen.getByText('ACME HARDWARE — PROUD SPONSOR')).toBeInTheDocument();
  });
});

describe('nofake-sweep — CtsAnnouncementWidget (scoreboard-cts-announcement)', () => {
  const dropTimeConfig = { zoneLabel: 'ANNOUNCEMENTS', defaultDurationMs: 5000, bgColor: '#0c1322', accentColor: '#fbbf24', entries: [] };

  it('real player surface, freshly dropped (empty entries): renders neutral (no reel text), never the fabricated roster/lineup copy', () => {
    renderVariant('scoreboard-cts-announcement', dropTimeConfig, { renderSurface: 'player' });
    expect(screen.queryByText(/STARTING LINEUP/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NEXT HOME MATCH/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PLAYER OF THE WEEK/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CONCESSIONS OPEN/)).not.toBeInTheDocument();
  });

  it('builder (renderSurface unset), same freshly-dropped config: still shows the alive SAMPLE announcement reel', () => {
    renderVariant('scoreboard-cts-announcement', dropTimeConfig);
    expect(screen.getByText(/STARTING LINEUP/)).toBeInTheDocument();
  });

  it('real player surface WITH manual entries configured: renders the operator-configured announcement, not neutral', () => {
    renderVariant(
      'scoreboard-cts-announcement',
      { ...dropTimeConfig, entries: [{ text: 'CONCESSIONS OPEN — MEZZANINE LEVEL', durationMs: 5000 }] },
      { renderSurface: 'player' },
    );
    expect(screen.getByText('CONCESSIONS OPEN — MEZZANINE LEVEL')).toBeInTheDocument();
  });
});

describe('nofake-sweep — TeamRecordWidget (sb-team-record-home / sb-team-record-away)', () => {
  // #295 (2026-07-03): the fabricated '10-1'/'8-3' defaultConfig seed was
  // REMOVED from variants-register.ts. A freshly dropped record now has NO
  // placeholder; an explicit operator entry renders as-is on every surface
  // (no more value-equality false-blank).
  it('real player surface, freshly dropped (no seeded record): renders neutral dash, never a fabricated record', () => {
    renderVariant('sb-team-record-home', { team: 'home', fontSize: 32 }, { renderSurface: 'player' });
    expect(screen.queryByText('10-1')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('real player surface, away variant, freshly dropped: renders neutral dash, never a fabricated record', () => {
    renderVariant('sb-team-record-away', { team: 'away', fontSize: 32 }, { renderSurface: 'player' });
    expect(screen.queryByText('8-3')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('builder (renderSurface unset), freshly dropped: shows an obvious "W–L" prompt, never a fabricated sample record', () => {
    renderVariant('sb-team-record-home', { team: 'home', fontSize: 32 });
    expect(screen.getByText('W–L')).toBeInTheDocument();
    expect(screen.queryByText('10-1')).not.toBeInTheDocument();
  });

  it('real player surface with an operator-typed record: renders the operator value on the live board', () => {
    renderVariant('sb-team-record-home', { team: 'home', fontSize: 32, placeholder: '14-2' }, { renderSurface: 'player' });
    expect(screen.getByText('14-2')).toBeInTheDocument();
  });

  it('real player surface: a legitimately-entered "10-1" home record is NOT false-blanked (#295 fix — the old value-equality heuristic wrongly hid it)', () => {
    renderVariant('sb-team-record-home', { team: 'home', fontSize: 32, placeholder: '10-1' }, { renderSurface: 'player' });
    expect(screen.getByText('10-1')).toBeInTheDocument();
  });
});

describe('nofake-sweep — LeaderboardWidget (sb-leaderboard)', () => {
  it('real player surface, freshly dropped (no rows configured): renders the blank neutral shell, never the fabricated named/timed rows', () => {
    renderVariant('sb-leaderboard', { fontSize: 28, align: 'center' }, { renderSurface: 'player' });
    expect(screen.queryByText('J. CARTER')).not.toBeInTheDocument();
    expect(screen.queryByText('M. OKAFOR')).not.toBeInTheDocument();
    expect(screen.queryByText('10.42')).not.toBeInTheDocument();
  });

  it('builder (renderSurface unset), same freshly-dropped config: still shows the alive SAMPLE rows', () => {
    renderVariant('sb-leaderboard', { fontSize: 28, align: 'center' });
    expect(screen.getByText('J. CARTER')).toBeInTheDocument();
    expect(screen.getByText('10.42')).toBeInTheDocument();
  });

  it('real player surface WITH rows configured: renders the operator-configured rows, not neutral', () => {
    renderVariant(
      'sb-leaderboard',
      { fontSize: 28, align: 'center', rows: [{ place: 1, lane: 2, name: 'REAL SWIMMER', time: '22.10' }] },
      { renderSurface: 'player' },
    );
    expect(screen.getByText('REAL SWIMMER')).toBeInTheDocument();
  });
});

describe('nofake-sweep — RibbonScoreboardWidget sponsor/message reel (ribbon-main)', () => {
  it('real player surface, no messages/sponsorText configured: renders an empty reel, never the fabricated "YOUR SPONSOR HERE / GO TEAM! / NEXT HOME GAME" strings', () => {
    renderVariant('ribbon-main', {}, { renderSurface: 'player' });
    expect(screen.queryByText(/YOUR SPONSOR HERE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/GO TEAM!/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NEXT HOME GAME FRI 7PM/)).not.toBeInTheDocument();
    // The score/clock/period/abbr side of this widget was already correctly
    // gated before this sweep — confirm that hasn't regressed.
    expect(screen.getByText('—:—')).toBeInTheDocument();
  });

  it('builder (renderSurface unset), no config: still shows the alive SAMPLE reel', () => {
    renderVariant('ribbon-main', {});
    expect(screen.getByText(/YOUR SPONSOR HERE/)).toBeInTheDocument();
  });

  it('real player surface WITH sponsorText configured: renders the operator-configured reel text, not empty', () => {
    renderVariant('ribbon-main', { sponsorText: 'ACME HARDWARE' }, { renderSurface: 'player' });
    expect(screen.getByText(/ACME HARDWARE/)).toBeInTheDocument();
  });
});

describe('nofake-sweep — SwimRecordLineWidget (SWIM_RECORD_LINE) verification', () => {
  it('real player surface, nothing typed in: renders neutral dash, never the fabricated "48.42" / "D. OKAFOR, 2024"', () => {
    renderWidgetType('SWIM_RECORD_LINE', {}, { renderSurface: 'player' });
    expect(screen.queryByText('48.42')).not.toBeInTheDocument();
    expect(screen.queryByText('D. OKAFOR, 2024')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('builder (renderSurface unset), nothing typed in: still shows the alive SAMPLE record + a SAMPLE watermark', () => {
    renderWidgetType('SWIM_RECORD_LINE', {});
    expect(screen.getByText('48.42')).toBeInTheDocument();
    expect(screen.getByText('D. OKAFOR, 2024')).toBeInTheDocument();
    expect(screen.getByText('SAMPLE')).toBeInTheDocument();
  });

  it('real player surface with an operator-typed record: renders the operator value, not neutral', () => {
    renderWidgetType('SWIM_RECORD_LINE', { recordTime: '51.10', recordHolder: 'J. SMITH, 2025' }, { renderSurface: 'player' });
    expect(screen.getByText('51.10')).toBeInTheDocument();
    expect(screen.getByText('J. SMITH, 2025')).toBeInTheDocument();
  });
});

// ─── Drift-catcher: every SAMPLE_/hardcoded-demo constant under
// components/widgets/sports must be consumed by a widget that also calls
// useRenderSurface() (directly, or transitively via useGameState() /
// useCtsGameState()) somewhere in the SAME file. This is a static-source
// scan, not a render assertion — it exists so a FUTURE widget added to
// this directory with its own SAMPLE_* fallback and no surface check
// fails CI immediately, instead of silently regressing into the exact
// class of bug this sweep just closed. ─────────────────────────────────

import fs from 'fs';
import path from 'path';

describe('nofake-sweep — drift-catcher: every SAMPLE_/hardcoded-demo source must be render-surface-gated', () => {
  const sportsDir = path.join(__dirname, '..');
  const files = fs
    .readdirSync(sportsDir)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .filter((f) => !f.includes('__tests__') && f !== 'GameStateContext.tsx');

  it('every file that declares a SAMPLE_* / hardcoded-fabricated constant also imports useRenderSurface or useGameState (which itself is render-surface-aware)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const full = path.join(sportsDir, file);
      const src = fs.readFileSync(full, 'utf8');
      const declaresSample = /const\s+SAMPLE[A-Z_]*\s*[:=]/.test(src) || /const\s+N_[A-Z_]+\s*=/.test(src);
      if (!declaresSample) continue;
      const usesGuard = src.includes('useRenderSurface') || src.includes('useGameState') || src.includes('useCtsGameState');
      if (!usesGuard) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
