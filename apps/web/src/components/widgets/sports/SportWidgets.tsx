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
 * CRITICAL (audit P1, 2026-06-13): the sample placeholder is ONLY shown
 * in the builder. On a LIVE player surface (provider present) with no
 * live value yet, the widget renders a NEUTRAL glyph ("—" / "—:—") via
 * `displayOrNeutral` — NEVER a fabricated score. Otherwise a crowd could
 * see fake numbers on the big board indistinguishable from a real game.
 * The "is this a live surface?" signal is `useGameState() != null`
 * (the provider only mounts on the live /board route, not the builder).
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

import { useGameState } from './GameStateContext';
import { FitOneLine, FitBox } from './FitOneLine';
import { resolveCtsField, deriveCtsField, displayOrNeutral } from './cts-fields';

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
  // CTS feed-field binding — the REAL field the operator picked in the
  // Properties "Reads from CTS field" dropdown (cts-fields.ts catalog).
  // When set, the widget renders exactly that field via resolveCtsField.
  // Falls back to each widget's correct default key when unset, and to
  // the legacy cfg.team/cfg.statKey for back-compat with old templates.
  ctsField?: string;
  team?: 'home' | 'away';
  statKey?: string;
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
 *
 * autoShrink is ALWAYS true — the value must NEVER overflow its zone.
 * `config.fontSize` is the CEILING/target (it raises the base font, so + / −
 * still visibly grows/shrinks within the fit), NOT a literal size: FitOneLine
 * always scales ≤ 1 to fit. Do NOT gate autoShrink on fontSize — that
 * reintroduces the blown-up-digits overflow (operator, 2026-05-29 AND
 * 2026-05-30, twice now).
 */
function FitValue({ config, children }: { config: BaseConfig; children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', height: '100%', background: config.bgColor ?? 'transparent', overflow: 'hidden' }}>
      <FitOneLine
        maxFontPx={config.fontSize && config.fontSize > 0 ? config.fontSize : 800}
        autoShrink={true}
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
  // Bind to the operator-picked CTS field (default homeScore). Back-compat:
  // derive from legacy cfg.team/cfg.statKey when cfg.ctsField is absent.
  const key = deriveCtsField('SCORE_HOME', config) ?? 'homeScore';
  const resolved = resolveCtsField(state?.snapshot, state?.liveClockMs ?? 0, key);
  // Live surface (provider present) with no value → neutral "—", never
  // the fabricated sample. Builder (no provider) → keep the sample.
  const display = displayOrNeutral(state != null, resolved, config.placeholder ?? '24');

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
  const key = deriveCtsField('SCORE_AWAY', config) ?? 'awayScore';
  const resolved = resolveCtsField(state?.snapshot, state?.liveClockMs ?? 0, key);
  const display = displayOrNeutral(state != null, resolved, config.placeholder ?? '21');

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
  // Default field 'clock'; an operator who re-points this to e.g. a shot
  // clock gets that value instead (the binding is real, not cosmetic).
  const key = deriveCtsField('GAME_CLOCK', config) ?? 'clock';
  const resolved = resolveCtsField(state?.snapshot, state?.liveClockMs ?? 0, key, {
    showTenths: !!config.showTenths,
  });
  // Live surface with no clock → "—:—", never the sample "07:42".
  const display = displayOrNeutral(state != null, resolved, config.placeholder ?? '07:42', 'clock');
  return <FitValue config={config}>{display}</FitValue>;
}

// ── Segment ──────────────────────────────────────────────────────────

export function GameSegmentWidget({ config }: { config: SegmentConfig }) {
  const state = useGameState();
  const key = deriveCtsField('GAME_SEGMENT', config) ?? 'segment';
  const resolved = resolveCtsField(state?.snapshot, state?.liveClockMs ?? 0, key);
  // Live surface with no segment → "—", never the sample "Q3".
  const display = displayOrNeutral(state != null, resolved, config.placeholder ?? 'Q3');
  return <FitValue config={config}>{display}</FitValue>;
}

// ── Stat (sport-specific) ────────────────────────────────────────────

export function GameStatWidget({ config }: { config: StatConfig }) {
  const state = useGameState();
  // CTS binding wins: if the operator picked a real CTS field
  // (cfg.ctsField, set by the "Reads from CTS field" picker), resolve it
  // through the catalog so re-pointing actually changes the value. Else
  // fall back to a manual Game.stats key (cfg.statKey) — operator-input
  // stats (down/fouls/…) that CTS doesn't transmit.
  // Live surface (provider present) with no value → neutral "—", never
  // the operator's sample placeholder. Builder → keep the sample.
  const isLive = state != null;
  let display: string;
  if (config.ctsField) {
    const resolved = resolveCtsField(state?.snapshot, state?.liveClockMs ?? 0, config.ctsField);
    display = displayOrNeutral(isLive, resolved, config.placeholder ?? '—');
  } else {
    const key = config.statKey ?? 'down';
    const raw = state?.snapshot?.stats?.[key];
    const resolved = raw != null && raw !== '' ? String(raw) : null;
    display = displayOrNeutral(isLive, resolved, config.placeholder ?? '—');
  }

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
