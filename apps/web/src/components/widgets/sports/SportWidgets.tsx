'use client';

/**
 * Sport-bound widget primitives — the building blocks of a custom
 * scoreboard / ribbon / scorebug template.
 *
 * Each widget consumes `useGameState()` (provided by GameStateContext
 * around the rendered template on /board /ribbon /scorebug). When the
 * widget renders OUTSIDE a provider (template builder canvas, gallery
 * thumbnail), it falls through to `cfg.placeholder` so the operator
 * can still see + position the widget while laying out a board.
 *
 * Chromium-83 safe — no `inset` shorthand, no flex `gap`, no
 * `backdrop-filter`. Long-hand sides, explicit margins, solid bgs.
 *
 * Five primitives, one file:
 *   • <ScoreHomeWidget />     home-team score (huge digits)
 *   • <ScoreAwayWidget />     away-team score
 *   • <GameClockWidget />     the live game clock (MM:SS)
 *   • <GameSegmentWidget />   sport-aware segment label ("Q3", "Inning 5")
 *   • <GameStatWidget />      sport-specific stat (down/distance,
 *                              balls/strikes, sets, etc.) driven by
 *                              cfg.statKey against snapshot.stats[]
 */

import { useGameState, fmtClock, fmtSegment } from './GameStateContext';
import { FitOneLine, FitBox } from './FitOneLine';

interface BaseConfig {
  // Visual.
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  bgColor?: string;
  align?: 'left' | 'center' | 'right';
  letterSpacing?: number;
  // Builder-mode placeholder.
  placeholder?: string;
  // Common sizing: when the operator drops the widget in a zone we
  // size text to fill the zone via CSS; explicit fontSize is optional.
}

interface ScoreConfig extends BaseConfig {
  showName?: boolean; // render the team name above the score
  showLogo?: boolean; // render the team logo to the left of the score
}

interface ClockConfig extends BaseConfig {
  showTenths?: boolean; // show ".T" on the last minute (basketball / wrestling)
}

interface SegmentConfig extends BaseConfig {
  // No extra options yet — the segment text is sport-aware.
}

interface StatConfig extends BaseConfig {
  // Key into snapshot.stats[]. e.g. "down", "distance", "balls", "strikes".
  statKey?: string;
  // Optional label shown next to the value. "DOWN: 2  TO GO: 7"
  label?: string;
}

function rootStyle(cfg: BaseConfig): React.CSSProperties {
  return {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: cfg.align === 'left' ? 'flex-start' : cfg.align === 'right' ? 'flex-end' : 'center',
    color: cfg.color ?? '#ffffff',
    backgroundColor: cfg.bgColor ?? 'transparent',
    fontFamily: cfg.fontFamily ?? 'Inter, system-ui, sans-serif',
    fontWeight: cfg.fontWeight ?? 900,
    letterSpacing: cfg.letterSpacing != null ? `${cfg.letterSpacing}px` : undefined,
    // Fill the zone — scale text via the parent zone's font-size or
    // an explicit number. Without an explicit fontSize the widget
    // grows to whatever line-height the container computes; the
    // template builder usually pegs fontSize on drop.
    fontSize: cfg.fontSize ?? undefined,
    overflow: 'hidden',
    textAlign: cfg.align ?? 'center',
  };
}

/**
 * FitValue — render a single value (score / clock / segment / stat) that
 * ALWAYS fits its zone. The bug this fixes: these widgets used to render
 * the value at a fixed `fontSize` with no auto-fit, so a big number (or the
 * size pegged on drop) blew straight past the zone — "the numbers are so
 * big, they dont fit in the template" (operator, 2026-05-29). Now the value
 * is sized by the SAME shrink-to-fit primitive the team name uses
 * (FitOneLine): it renders at a large base and scales down so the digit
 * fills the zone but never overflows. `config.fontSize`, when set, is the
 * base/target; FitOneLine still clamps it to fit, so even a huge pegged
 * value can't overflow. Unset → fills the zone (as large as fits).
 */
function FitValue({ config, children }: { config: BaseConfig; children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', height: '100%', background: config.bgColor ?? 'transparent', overflow: 'hidden' }}>
      <FitOneLine
        maxFontPx={config.fontSize && config.fontSize > 0 ? config.fontSize : 800}
        autoShrink={!(config.fontSize && config.fontSize > 0)}
        align={config.align ?? 'center'}
        style={{
          color: config.color ?? '#ffffff',
          fontWeight: config.fontWeight ?? 900,
          fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif',
          letterSpacing: config.letterSpacing != null ? `${config.letterSpacing}px` : undefined,
        }}
      >
        {children}
      </FitOneLine>
    </div>
  );
}

// ── Score widgets ────────────────────────────────────────────────────

export function ScoreHomeWidget({ config }: { config: ScoreConfig }) {
  const state = useGameState();
  const score = state?.snapshot?.homeScore;
  const display = score != null ? String(score) : (config.placeholder ?? '24');

  if (config.showLogo || config.showName) {
    const team = state?.snapshot?.homeTeam ?? 'HOME';
    const logo = state?.snapshot?.homeLogoUrl ?? null;
    return (
      <FitBox
        baseFontPx={config.fontSize ?? 400}
        align={config.align ?? 'center'}
        style={{
          color: config.color ?? '#ffffff',
          fontWeight: config.fontWeight ?? 900,
          fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif',
          letterSpacing: config.letterSpacing != null ? `${config.letterSpacing}px` : undefined,
          backgroundColor: config.bgColor ?? 'transparent',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {config.showLogo && logo && (
            <img
              src={logo}
              alt={team}
              style={{ maxHeight: '40%', objectFit: 'contain', marginBottom: 8 }}
            />
          )}
          {config.showName && (
            <div style={{ fontSize: '0.4em', opacity: 0.8, marginBottom: 4 }}>
              {team.toUpperCase()}
            </div>
          )}
          <div>{display}</div>
        </div>
      </FitBox>
    );
  }
  return <FitValue config={config}>{display}</FitValue>;
}

export function ScoreAwayWidget({ config }: { config: ScoreConfig }) {
  const state = useGameState();
  const score = state?.snapshot?.awayScore;
  const display = score != null ? String(score) : (config.placeholder ?? '21');

  if (config.showLogo || config.showName) {
    const team = state?.snapshot?.awayTeam ?? 'AWAY';
    const logo = state?.snapshot?.awayLogoUrl ?? null;
    return (
      <FitBox
        baseFontPx={config.fontSize ?? 400}
        align={config.align ?? 'center'}
        style={{
          color: config.color ?? '#ffffff',
          fontWeight: config.fontWeight ?? 900,
          fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif',
          letterSpacing: config.letterSpacing != null ? `${config.letterSpacing}px` : undefined,
          backgroundColor: config.bgColor ?? 'transparent',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {config.showLogo && logo && (
            <img
              src={logo}
              alt={team}
              style={{ maxHeight: '40%', objectFit: 'contain', marginBottom: 8 }}
            />
          )}
          {config.showName && (
            <div style={{ fontSize: '0.4em', opacity: 0.8, marginBottom: 4 }}>
              {team.toUpperCase()}
            </div>
          )}
          <div>{display}</div>
        </div>
      </FitBox>
    );
  }
  return <FitValue config={config}>{display}</FitValue>;
}

// ── Clock ────────────────────────────────────────────────────────────

export function GameClockWidget({ config }: { config: ClockConfig }) {
  const state = useGameState();
  if (!state?.snapshot) {
    return <FitValue config={config}>{config.placeholder ?? '07:42'}</FitValue>;
  }
  return <FitValue config={config}>{fmtClock(state.liveClockMs, !!config.showTenths)}</FitValue>;
}

// ── Segment ──────────────────────────────────────────────────────────

export function GameSegmentWidget({ config }: { config: SegmentConfig }) {
  const state = useGameState();
  if (!state?.snapshot) {
    return <FitValue config={config}>{config.placeholder ?? 'Q3'}</FitValue>;
  }
  return (
    <FitValue config={config}>
      {fmtSegment(state.snapshot.sport, state.snapshot.segment)}
    </FitValue>
  );
}

// ── Stat (sport-specific) ────────────────────────────────────────────

export function GameStatWidget({ config }: { config: StatConfig }) {
  const state = useGameState();
  const key = config.statKey ?? 'down';
  const raw = state?.snapshot?.stats?.[key];
  const display =
    raw != null && raw !== ''
      ? String(raw)
      : (config.placeholder ?? '—');

  if (config.label) {
    return (
      <FitBox
        baseFontPx={config.fontSize ?? 400}
        align={config.align ?? 'center'}
        style={{
          color: config.color ?? '#ffffff',
          fontWeight: config.fontWeight ?? 900,
          fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif',
          letterSpacing: config.letterSpacing != null ? `${config.letterSpacing}px` : undefined,
          backgroundColor: config.bgColor ?? 'transparent',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: '0.4em', opacity: 0.7 }}>{config.label.toUpperCase()}</div>
          <div>{display}</div>
        </div>
      </FitBox>
    );
  }
  return <FitValue config={config}>{display}</FitValue>;
}
