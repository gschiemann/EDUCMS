'use client';

/**
 * RibbonCelebrationStrip — celebration art designed for the LED ribbon
 * fascia (7.5:1 horizontal), NOT for a 16:9 video board.
 *
 * 2026-05-27 — Operator: "the celebrations are not fitting in the
 * ribbon resolution and the players name does not show up, i think u
 * need a redesign on those to maek it work".
 *
 * The original cinematics (CelebrationWaterPoloGoal, CelSoccerGoalWidget
 * etc.) were drawn for video boards — they render a 1920×1080 canvas
 * with the goal-frame composition centered, then scale-to-fit via
 * useScaleToFit. Dropped into a 7.5:1 ribbon slice (e.g. 1920×256), the
 * canvas either:
 *   - fits-height → 256 tall × 455 wide, leaves huge empty bars
 *   - fits-width → 1920 wide × 1080 tall → 824px gets clipped off top
 *     and bottom (the player's complaint: "cutting off the top").
 * Either way it reads as broken.
 *
 * This component is a ribbon-NATIVE layout. Three horizontal columns:
 *   • LEFT (25%):  animated sport motif (pulsing accent circle, future:
 *                  per-sport SVG icon — ball / puck / racquet etc).
 *   • CENTER (50%): big title (GOAL / SAVE / EXCLUSION / POWER PLAY)
 *                  in white over team-color background, with
 *                  "#99 GREG SCHIEMANN" scorer attribution on the
 *                  line below.
 *   • RIGHT (25%): tabular scoreline "BRUINS 3 — 0 BUCKEYES" with the
 *                  segment + clock underneath (Q2 · 7:15).
 *
 * Every dimension is derived from the `height` prop so the strip renders
 * crisp at any ribbon resolution — 192px-tall HS practice ribbon, 256px
 * NCAA scorebug, 384px pro fascia. No `vw` / `%` font sizes; pure pixel
 * math like BoardScene.
 *
 * Chromium-83 safe (Taurus LED controllers): no `inset` shorthand, no
 * flex `gap`, no `backdrop-filter`, pure transforms + opacity keyframes.
 */

import { useId } from 'react';

export interface RibbonCelebrationStripConfig {
  /** Hero title — "GOAL!", "SAVE!", "EXCLUSION", "POWER PLAY" etc. */
  title: string;
  /** Optional secondary line if no scorer attribution
   *  (e.g. "MAN ADVANTAGE" under "POWER PLAY"). */
  subtitle?: string;
  /** Team accent colour for the background flash + side-stripe — hex. */
  accent: string;
  /** Scorer attribution — when present, renders "#99 GREG SCHIEMANN"
   *  on the center column's lower line, overriding subtitle. */
  scorerName?: string;
  scorerNumber?: string;
  /** Scoreboard snapshot for the right column. All optional — when
   *  missing the right column collapses gracefully. */
  homeName?: string;
  awayName?: string;
  homeScore?: number;
  awayScore?: number;
  segmentLabel?: string;
  clockText?: string;
  /** Which team scored — used to highlight the right team's chip on the
   *  scoreline. */
  team?: 'home' | 'away' | null;
}

interface RibbonCelebrationStripProps {
  config: RibbonCelebrationStripConfig;
  /** Ribbon physical height in px — drives every font-size + spacing. */
  height: number;
  /** When false, the entrance animation doesn't fire — preview mode. */
  live?: boolean;
}

/** Darken a hex color by `amount` (0..1). Used for the diagonal-stripe
 *  pattern so the background reads as "team color with energy" instead
 *  of a flat block. */
function darken(hex: string, amount: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Pick a legible text color (white or near-black) against `bg`. */
function pickTextOn(bg: string): string {
  const m = bg.match(/^#([0-9a-f]{6})$/i);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? '#0b1220' : '#ffffff';
}

export function RibbonCelebrationStrip({
  config,
  height,
  live = true,
}: RibbonCelebrationStripProps) {
  const accent = config.accent || '#21e6ff';
  const accentDark = darken(accent, 0.45);
  const ink = pickTextOn(accent);
  // Per-element font sizes — fixed-pixel from height, like BoardScene.
  // Title is the focal point; scorer attribution is roughly half that;
  // scoreline numbers are sized to read at a glance from the stands.
  const titleFs = Math.max(36, Math.round(height * 0.42));
  const scorerFs = Math.max(18, Math.round(height * 0.20));
  const scoreNumFs = Math.max(40, Math.round(height * 0.55));
  const teamNameFs = Math.max(12, Math.round(height * 0.13));
  const metaFs = Math.max(11, Math.round(height * 0.13));
  const motifSize = Math.max(48, Math.round(height * 0.72));
  // 2026-05-27 — unique animation IDs so multiple strips on the same
  // page (one per ribbon segment) don't share keyframes.
  const uid = useId().replace(/:/g, '');
  const animEnter = `rcsEnter_${uid}`;
  const animPulse = `rcsPulse_${uid}`;
  const animStripe = `rcsStripe_${uid}`;

  const hasScorer = !!config.scorerName;
  const scorerLine = hasScorer
    ? `${config.scorerNumber ? `#${config.scorerNumber}  ` : ''}${(config.scorerName || '').toUpperCase()}`
    : config.subtitle || '';

  const homeHi = config.team === 'home';
  const awayHi = config.team === 'away';
  const homeName = (config.homeName || '').toUpperCase();
  const awayName = (config.awayName || '').toUpperCase();

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: 'hidden',
        background: accent,
        // Animated diagonal stripe pattern — adds energy without
        // overpowering the text. The CSS variable is set once and
        // the keyframe animates `background-position` only.
        backgroundImage: `repeating-linear-gradient(
          135deg,
          ${accentDark} 0,
          ${accentDark} ${Math.round(height * 0.08)}px,
          ${accent} ${Math.round(height * 0.08)}px,
          ${accent} ${Math.round(height * 0.16)}px
        )`,
        backgroundSize: `${Math.round(height * 0.45)}px ${Math.round(height * 0.45)}px`,
        animation: live ? `${animStripe} 2.4s linear infinite` : 'none',
      }}
    >
      {/* Inline keyframes — scoped via the per-instance uid so multiple
          strips on the same ribbon (one per segment) never collide. */}
      <style>{`
        @keyframes ${animEnter} {
          0%   { opacity: 0; transform: translateY(${Math.round(height * 0.1)}px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes ${animPulse} {
          0%, 100% { transform: scale(1);   opacity: 0.95; }
          50%      { transform: scale(1.08); opacity: 1; }
        }
        @keyframes ${animStripe} {
          0%   { background-position: 0 0; }
          100% { background-position: ${Math.round(height * 0.45)}px 0; }
        }
      `}</style>

      {/* Subtle vignette so center text reads cleanly against the
          striped background. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 60%, rgba(0,0,0,0) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* LEFT — motif (pulsing accent ring). Future: per-sport SVG
          icons (waterball / soccerball / puck etc) drop into this slot. */}
      <div
        style={{
          position: 'absolute',
          left: '2%',
          top: 0,
          bottom: 0,
          width: '20%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: motifSize,
            height: motifSize,
            borderRadius: '50%',
            background: `radial-gradient(circle at 35% 35%, #ffffff 0%, ${accent} 40%, ${accentDark} 100%)`,
            boxShadow: `0 0 ${Math.round(motifSize * 0.45)}px rgba(255,255,255,0.6), inset 0 0 ${Math.round(motifSize * 0.2)}px ${accentDark}`,
            animation: live ? `${animPulse} 1.1s ease-in-out infinite` : 'none',
          }}
        />
      </div>

      {/* CENTER — title + scorer/subtitle. The big focal text. */}
      <div
        style={{
          position: 'absolute',
          left: '22%',
          right: '22%',
          top: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          animation: live ? `${animEnter} 0.4s ease-out both` : 'none',
        }}
      >
        <div
          style={{
            fontSize: titleFs,
            fontWeight: 900,
            color: ink,
            letterSpacing: '0.04em',
            lineHeight: 1,
            textShadow: '0 2px 6px rgba(0,0,0,0.45)',
            whiteSpace: 'nowrap',
            textTransform: 'uppercase',
            fontFamily:
              "Impact, 'Anton', 'Bebas Neue', 'Oswald', system-ui, sans-serif",
          }}
        >
          {config.title}
        </div>
        {scorerLine ? (
          <div
            style={{
              fontSize: scorerFs,
              fontWeight: 800,
              color: ink,
              marginTop: Math.round(height * 0.04),
              letterSpacing: '0.06em',
              lineHeight: 1,
              opacity: 0.92,
              whiteSpace: 'nowrap',
              textTransform: 'uppercase',
              fontFamily:
                "'Inter', 'Helvetica Neue', system-ui, sans-serif",
            }}
          >
            {scorerLine}
          </div>
        ) : null}
      </div>

      {/* RIGHT — scoreline + clock. Compact, tabular numbers. */}
      <div
        style={{
          position: 'absolute',
          right: '2%',
          top: 0,
          bottom: 0,
          width: '20%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Top: H — A score */}
        <div
          style={{
            fontSize: scoreNumFs,
            fontWeight: 900,
            color: ink,
            letterSpacing: '0.02em',
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            textShadow: '0 2px 6px rgba(0,0,0,0.5)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ opacity: homeHi ? 1 : 0.78 }}>
            {config.homeScore ?? 0}
          </span>
          <span
            style={{
              margin: `0 ${Math.round(height * 0.05)}px`,
              opacity: 0.6,
            }}
          >
            —
          </span>
          <span style={{ opacity: awayHi ? 1 : 0.78 }}>
            {config.awayScore ?? 0}
          </span>
        </div>
        {/* Bottom: team names + segment */}
        {(homeName || awayName || config.segmentLabel || config.clockText) && (
          <div
            style={{
              marginTop: Math.round(height * 0.04),
              display: 'flex',
              alignItems: 'center',
              fontSize: teamNameFs,
              fontWeight: 800,
              color: ink,
              letterSpacing: '0.08em',
              opacity: 0.88,
              whiteSpace: 'nowrap',
              textTransform: 'uppercase',
              fontFamily:
                "'Inter', 'Helvetica Neue', system-ui, sans-serif",
            }}
          >
            <span style={{ opacity: homeHi ? 1 : 0.75 }}>{homeName}</span>
            {(config.segmentLabel || config.clockText) && (
              <span
                style={{
                  marginLeft: Math.round(height * 0.05),
                  marginRight: Math.round(height * 0.05),
                  fontSize: metaFs,
                  opacity: 0.7,
                  fontWeight: 700,
                }}
              >
                {[config.segmentLabel, config.clockText].filter(Boolean).join(' · ')}
              </span>
            )}
            <span style={{ opacity: awayHi ? 1 : 0.75 }}>{awayName}</span>
          </div>
        )}
      </div>
    </div>
  );
}
