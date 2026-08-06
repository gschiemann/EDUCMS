'use client';

/**
 * VenueOS Sports — Sprint 13. The live scoreboard board page.
 *
 * PUBLIC route (no auth) — a stadium screen renders this. It polls the
 * un-authed GET /sports/board/:id endpoint, ticks the clock locally
 * from the stored anchor (clockMs + clockUpdatedAt + clockRunning),
 * and fires a full-bleed celebration overlay when the operator taps a
 * cue ("Touchdown", "GOAL!", "Home Run", …).
 *
 * Chromium-83 safe (NovaStar Taurus / video-processor targets):
 *   • no `inset` shorthand — long-hand top/right/bottom/left only
 *   • no flex `gap` — explicit margins
 *   • no `backdrop-filter`
 *   • fixed 1920×1080 scene + transform:scale to fit any canvas
 *     (the pattern CLAUDE.md mandates for player surfaces)
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { readBoardCache, writeBoardCache } from '@/lib/sports-board-cache';
// Trust wave Domain B (2026-08-06) — shared hardened poll engine
// (self-chaining, ETag/304 revalidation, jittered backoff) + the
// "CONNECTION LOST" staleness chip shown when the feed goes quiet.
import { startBoardPoll, STALE_FEED_AFTER_MS } from '@/lib/board-poll';
import { ConnectionLostPill } from '@/components/sports/ConnectionLostPill';
import { applyCtsOverlay } from '@/lib/cts-merge';
import {
  SituationalRow,
  readResults,
  readPlayerExclusions,
  type ResultEvent,
} from '@/components/widgets/v2/_shared/sports-situational';
import { celebrationSrc, celebrationLiveDataFromCue } from '@/lib/celebration-assets';
import { useParams } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
import { findSport, formatScore } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';
// 2026-06-15 sports-pro polish — shared crowd-surface motion primitives
// (score-pop on change, ambient idle drift) + vector sport/possession marks.
// All transform/opacity-only keyframes → Chromium-83 (NovaStar Taurus) safe.
import {
  SCORE_MOTION_KEYFRAMES,
  SCORE_POP_ANIM,
  SCORE_GLOW_ANIM,
  AMBIENT_DRIFT_ANIM,
  useScoreFlip,
} from '@/components/sports/score-motion';
import { SportMark, PossessionGlyph } from '@/components/sports/SportGlyph';
// item L (2026-06-16) — the team name auto-fits to one line so long real
// school names never clip on a 4K board (was a fixed 54px that overflowed).
import { FitOneLine } from '@/components/widgets/sports/FitOneLine';
// #267 — swim/dive games render their DEDICATED default board (lane grid /
// dive leaderboard) instead of the generic meet tally. Reuse the exact
// SwimDiveWidgets, fed by a GameStateProvider seeded from this board's poll.
import { GameStateProvider, type GameSnapshot } from '@/components/widgets/sports/GameStateContext';
import { SwimLaneGridWidget, DiveLeaderboardWidget } from '@/components/widgets/sports/SwimDiveWidgets';
// Sprint 13 — custom-template scoreboard renderer. Used iff
// Game.scoreboardTemplateId is non-null; otherwise the legacy
// BoardScene + status-aware scenes below render unchanged.
import { CustomScoreboardScene } from './CustomScoreboardScene';
// T2-4 — Pre-game starting-lineup choreography widget.
import {
  CelPregameIntroWidget,
  type PregamePlayer,
} from '@/components/widgets/v2/CelebrationsOtherSportsWidgets';

interface Cue {
  id: string;
  key?: string;
  label?: string;
  emoji?: string;
  createdAt?: string;
  // Custom cue-deck fields — uploaded content shown on a trigger.
  custom?: boolean;
  mediaUrl?: string | null;
  // 'overlay' (default) → board stays visible, media drops into a lower
  // band; 'takeover' → full-screen opaque media.
  displayMode?: string | null;
  color?: string | null;
  durationMs?: number;
  // Scoring team for a sport celebration ('home' | 'away') — used to brand
  // the celebration animation to that team's color.
  team?: string | null;
  // Which surfaces play this cue — BOARD / RIBBON / ALL (default ALL).
  target?: string;
  // Audio to play alongside a sport-celebration cue. Best-effort —
  // failure never interrupts the visual celebration.
  audioUrl?: string | null;
  // Co-branded celebration attribution — shown below the cue label.
  sponsorName?: string | null;
  sponsorLogoUrl?: string | null;
  // T2-4 — Pre-game lineup choreography fields (only present when
  // key === 'pregame-intro').
  lineup?: PregamePlayer[];
  teamColor?: string | null;
  teamName?: string | null;
  slotMs?: number;
  skippable?: boolean;
  // Frozen live-game snapshot, captured server-side at cue-fire time —
  // so a celebration shows the EXACT score + clock of the moment.
  snapshot?: {
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    homeColor?: string | null;
    awayColor?: string | null;
    segmentLabel?: string;
    clockText?: string;
  };
  // Operator-attributed scorer (the player picked when firing the cue) —
  // injected into the v2 cinematic so it shows "#7 RIVERA" with the REAL
  // name instead of the cue file's placeholder. Server persists these on
  // the CUE GameEvent at fire time.
  scorerName?: string | null;
  scorerNumber?: string | null;
}
interface Sponsor {
  id: string;
  name: string;
  logoUrl?: string | null;
  tagline?: string | null;
  color?: string | null;
  weight?: number;
  // T2-9: frequency cap enforcement + flight-window re-check at render time.
  frequencyCapPerHour?: number | null;
  flightEndAt?: string | null;
}
interface Spotlight {
  visible?: boolean;
  title?: string;
  photoUrl?: string | null;
  subtitle?: string;
  lines?: { label: string; value: string }[];
}
// Exported (2026-07-01, #269 parity gate) so the sport-board-parity test
// can build typed fixtures against the exact same shape DefaultBoardScene
// consumes — no behavior change, this was always the page's data contract.
export interface BoardData {
  id: string;
  sport: string;
  status: string;
  segment: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeColor: string | null;
  awayColor: string | null;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
  clockMs: number;
  clockRunning: boolean;
  clockUpdatedAt: string;
  stats: Record<string, unknown>;
  spotlight?: Spotlight | null;
  cues: Cue[];
  sponsors?: Sponsor[];
  sponsorSpotSeconds?: number;
  serverTime: number;
  // Sprint 13 — operator-picked custom-template IDs. NULL → fall back
  // to the hardcoded BoardScene below; non-NULL → render
  // CustomScoreboardScene (template-driven) instead.
  scoreboardTemplateId?: string | null;
  ribbonTemplateId?: string | null;
  scorebugTemplateId?: string | null;
  // T3-3 Show Control — a recalled full-screen GAMEDAY scene (Halftime Board,
  // Starting Lineup, Sponsors, …) that takes over the board until it expires
  // server-side, then auto-reverts. NULL → no scene (render the scoreboard as
  // usual). `template` is the resolved Template, bundled like scoreboardTemplate
  // so the public board needs no second auth-gated fetch.
  scene?: { templateId: string; template: unknown; expiresAt: number } | null;
  // Phase 1 (sports-pro stats engine, P1-B) — auto stat-leaders +
  // Player-of-the-Game, computed server-side from the already-shipped
  // per-game roster. Present ONLY when the `sports_player_stats` flag is
  // ON for the tenant AND the data is non-empty; OMITTED entirely
  // otherwise — so a flag-off board's payload is byte-identical to today
  // and these render nothing extra. Spec:
  // docs/research/2026-06-15-sports-pro-gap-analysis/01-STATS-ENGINE-SPEC.md
  leaders?: Array<{
    statKey: string;
    label: string;
    team: 'home' | 'away';
    playerName: string;
    playerNumber: string | null;
    photoUrl: string | null;
    value: string;
  }>;
  playerOfGame?: {
    name: string;
    number: string | null;
    team: 'home' | 'away';
    photoUrl: string | null;
    headline: string;
    lines: Array<{ label: string; value: string }>;
  } | null;
}

// Athletic neutral defaults — an uncustomized game should read like a
// scoreboard (deep stadium navy vs crimson), NOT the product's SaaS indigo.
// Same constant lives only in this file. (2026-06-15 sports-pro polish.)
const DEFAULT_HOME = '#1e3a5f';
const DEFAULT_AWAY = '#9b1c2e';

/** This is the scoreboard surface — it plays BOARD- and ALL-targeted
 *  cues (and legacy untargeted ones); a RIBBON-only cue is skipped. */
function cuePlaysHere(target?: string): boolean {
  return target !== 'RIBBON';
}
// 750ms — sub-second sync. A score / clock / cue change reaches every
// surface (board, ribbon, scorebug) within ~0.75s and they stay near
// lockstep, instead of the up-to-2s lag + drift of slow polling.
const POLL_MS = 750;

// ── formatting helpers ─────────────────────────────────────────

function fmtClock(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe >= 60_000) {
    const m = Math.floor(safe / 60_000);
    const s = Math.floor((safe % 60_000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  const s = Math.floor(safe / 1000);
  const tenths = Math.floor((safe % 1000) / 100);
  return `${s}.${tenths}`;
}

/** Penalty-clock format — always MM:SS, ceil to the second so the
 *  box still reads "0:01" right up to the instant it expires. */
function fmtPenalty(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** First word of a team name, upper-cased, capped — a clean short
 *  code for the celebration score line. */
function teamCode(name: string): string {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return first.toUpperCase().slice(0, 14);
}

function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** Low-score-wins sports: in cross country the team with the LOWEST point
 *  total wins (fewest finish-position points), and in stroke-play golf the
 *  fewest strokes wins. On those boards the leader is the team with the
 *  SMALLER score, so the winner-highlight comparison must invert.
 *  (The audit's preferred home for this is a `lowerWins` flag on
 *  SportDefinition in packages/api-types; that file is owned by another
 *  domain, so the board derives it from the sport key here — same effect,
 *  in-scope.) */
function isLowerWins(def: SportDefinition): boolean {
  return def.key === 'cross_country' || def.key === 'golf';
}

/** Which side is currently leading — honoring low-score-wins sports.
 *  Returns null on a tie or before the game has a meaningful score. */
function leadingSide(def: SportDefinition, home: number, away: number): 'home' | 'away' | null {
  if (home === away) return null;
  const homeAhead = isLowerWins(def) ? home < away : home > away;
  return homeAhead ? 'home' : 'away';
}

/** Penalty-box sports where a man-advantage ("power play") is a live game
 *  state worth surfacing. */
function hasPenaltyBox(def: SportDefinition): boolean {
  return (
    def.key === 'hockey' ||
    def.key === 'lacrosse' ||
    def.key === 'field_hockey' ||
    def.key === 'water_polo'
  );
}

/** Derive the man-advantage from the live penalties array — the team with
 *  FEWER players in the box is "on the power play" (audit P2). Counts only
 *  active penalties (running, or frozen-at-stoppage but not expired). The
 *  team WITH the advantage is the one whose opponent has more boxed players;
 *  the differential gives 5-on-4 / 5-on-3 strength. Returns null at even
 *  strength. */
function powerPlay(
  stats: Record<string, unknown> | undefined,
): { team: 'home' | 'away'; diff: number } | null {
  const raw = stats && Array.isArray(stats.penalties) ? (stats.penalties as unknown[]) : [];
  let home = 0;
  let away = 0;
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const rec = p as Record<string, unknown>;
    // A penalty still counts toward the box until its remaining ms hits 0.
    if ((Number(rec.ms) || 0) <= 0) continue;
    if (rec.team === 'home') home += 1;
    else if (rec.team === 'away') away += 1;
  }
  if (home === away) return null;
  // FEWER boxed players ⇒ that team is up a skater (on the power play).
  return home < away ? { team: 'home', diff: away - home } : { team: 'away', diff: home - away };
}

function segmentLabel(def: SportDefinition, data: BoardData): string {
  const n = data.segment;
  // Inning sports (baseball / softball) keep counting up past the
  // regulation 7th/9th — extra innings are "10TH", NOT "OT". Decide by
  // segment.name, BEFORE the overflow→OT check below (the config's own
  // contract). This branch handles regulation AND extra innings.
  if (def.segment.name === 'Inning') {
    const half = String((data.stats || {}).half || '').toUpperCase();
    return `${half ? half + ' ' : ''}${ordinal(n)}`;
  }
  // Hole-based sports (golf) never roll into "OT" — clamp at the final
  // hole and show "F" (finished) once the round is complete, the literal
  // hole otherwise. (Shared overflow-label spec, hole-based branch.)
  if (def.segment.name === 'Hole') {
    if (n > def.segment.count) return 'F';
    return `HOLE ${n}`;
  }
  if (n > def.segment.count) {
    // Only period/quarter/half sports that declare overtime roll to OT.
    if (def.segment.overtime) {
      const ot = n - def.segment.count;
      return ot > 1 ? `OT${ot}` : 'OT';
    }
    // A LEADERBOARD / non-overtime sport that somehow overflowed its
    // segment count — show the literal segment, never a bogus "OT".
    return `${def.segment.name.toUpperCase()} ${n}`;
  }
  // Cross-surface abbreviation parity: the scorebug + ribbon render the
  // compact "Q1 / P1 / H1" broadcast form, but the big board used to show
  // the verbose "QUARTER 1 / PERIOD 1 / HALF 1". Match the abbreviated
  // form so all three surfaces agree (audit P2). Other segment names
  // (Inning/Hole handled above; Rotation/Round for meet sports) keep their
  // descriptive label since the LEADERBOARD scene reads them by name.
  if (def.segment.name === 'Quarter') return `Q${n}`;
  if (def.segment.name === 'Period') return `P${n}`;
  if (def.segment.name === 'Half') return `H${n}`;
  return `${def.segment.name.toUpperCase()} ${n}`;
}

const STATUS_STYLE: Record<string, { label: string; bg: string; pulse?: boolean }> = {
  SCHEDULED: { label: 'SCHEDULED', bg: '#475569' },
  PRE_GAME: { label: 'PRE-GAME', bg: '#d97706' },
  LIVE: { label: 'LIVE', bg: '#dc2626', pulse: true },
  HALFTIME: { label: 'HALFTIME', bg: '#2563eb' },
  FINAL: { label: 'FINAL', bg: '#1e293b' },
};

// ── the 1920×1080 scoreboard scene ─────────────────────────────

/** A team's live penalty timers — the box for hockey / lacrosse /
 *  field hockey / water polo. Each penalty is an anchor projected
 *  locally (the same math as the game clock); an expired one drops
 *  off on its own. Renders nothing when the box is empty, so the
 *  14 sports with no penalty box show no panel. */
function PenaltyTimers({
  team,
  stats,
  serverTime,
  color,
}: {
  team: 'home' | 'away';
  stats: Record<string, unknown> | undefined;
  serverTime: number;
  color: string;
}) {
  const raw = stats && Array.isArray(stats.penalties) ? (stats.penalties as unknown[]) : [];
  const mine = raw
    .filter(
      (p): p is Record<string, unknown> =>
        !!p && typeof p === 'object' && (p as Record<string, unknown>).team === team,
    )
    .map((p) => ({
      id: String(p.id || ''),
      player: String(p.player || ''),
      ms: Math.max(0, Number(p.ms) || 0),
      at: String(p.at || ''),
      running: !!p.running,
    }))
    .filter((p) => p.id);
  // A stable key so the projection effect only re-subscribes when the
  // penalty anchors actually change, not on every poll.
  const key = JSON.stringify(mine.map((p) => [p.id, p.ms, p.at, p.running]));

  const [live, setLive] = useState<{ id: string; player: string; ms: number }[]>([]);
  useEffect(() => {
    const skew = serverTime - Date.now(); // local + skew ≈ server
    const project = () => {
      setLive(
        mine
          .map((p) => {
            let ms = p.ms;
            if (p.running) {
              const at = new Date(p.at).getTime();
              if (Number.isFinite(at)) ms = Math.max(0, p.ms - (Date.now() + skew - at));
            }
            return { id: p.id, player: p.player, ms };
          })
          .filter((p) => p.ms > 0),
      );
    };
    project();
    if (!mine.some((p) => p.running)) return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, serverTime]);

  if (live.length === 0) return null;
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 16 }}
    >
      <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 4, color: '#64748b' }}>
        PENALTIES
      </span>
      <div
        style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}
      >
        {live.slice(0, 4).map((p, i) => (
          <div
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              background: '#0f172a',
              border: `3px solid ${color}`,
              borderRadius: 12,
              padding: '8px 18px',
              marginLeft: i ? 14 : 0,
              marginBottom: 8,
            }}
          >
            {p.player ? (
              <span style={{ fontSize: 32, fontWeight: 900, color, marginRight: 12 }}>
                #{p.player}
              </span>
            ) : null}
            <span
              style={{
                fontSize: 38,
                fontWeight: 900,
                color: p.ms <= 10_000 ? '#f87171' : '#ffffff',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {fmtPenalty(p.ms)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Water-polo per-player exclusion panel — each player's running major-
 *  foul count ("X of 3"; 3 = ejected for the game). Reads the structured
 *  stats.playerExclusions contract for ONE team. Renders nothing when the
 *  team has no exclusions, so a clean water-polo board shows no panel.
 *  Chromium-83 safe: per-child margins, no flex gap / inset shorthand. */
function ExclusionPanel({
  team,
  stats,
  color,
}: {
  team: 'home' | 'away';
  stats: Record<string, unknown> | undefined;
  color: string;
}) {
  const mine = readPlayerExclusions(stats)
    .filter((p) => p.team === team && p.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
  if (mine.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 16 }}>
      <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 4, color: '#64748b' }}>
        EXCLUSIONS
      </span>
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        {mine.map((p, i) => {
          const ejected = p.count >= 3;
          return (
            <div
              key={`${p.jersey}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                background: '#0f172a',
                border: `3px solid ${ejected ? '#dc2626' : color}`,
                borderRadius: 12,
                padding: '8px 18px',
                marginLeft: i ? 14 : 0,
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 32, fontWeight: 900, color: ejected ? '#f87171' : color, marginRight: 12 }}>
                #{p.jersey}
              </span>
              <span
                style={{
                  fontSize: 30,
                  fontWeight: 900,
                  color: ejected ? '#f87171' : '#ffffff',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {ejected ? 'EJECTED' : `${p.count} of 3`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeamPanel({
  side,
  name,
  score,
  scoreText,
  color,
  logoUrl,
  winning,
  hasPossession,
  penaltyNode,
  flipKey,
  flipDir,
}: {
  side: 'home' | 'away';
  name: string;
  /** Raw scaled score — kept for comparison/layout; never rendered when
   *  `scoreText` is supplied. */
  score: number;
  /** Pre-formatted display string (decimals for judged sports). When
   *  absent, the raw `score` int is shown — backwards-compatible. */
  scoreText?: string;
  color: string;
  logoUrl: string | null;
  winning: boolean;
  hasPossession?: boolean;
  penaltyNode?: ReactNode;
  /** Score-change motion — `flipKey` retriggers the pop via React remount;
   *  `flipDir` null on first paint so a cold board never pops on load. */
  flipKey?: number;
  flipDir?: 'up' | 'down' | null;
}) {
  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(${side === 'home' ? '135deg' : '225deg'}, ${color}2e, #0b0f1a 72%)`,
        borderTop: `10px solid ${color}`,
      }}
    >
      {/* brand logo — the team's actual mark, with a soft team-color halo */}
      <div
        style={{
          position: 'relative',
          width: 200,
          height: 176,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            background: `radial-gradient(circle at 50% 48%, ${color}59, transparent 64%)`,
          }}
        />
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            style={{
              position: 'relative',
              width: 176,
              height: 176,
              objectFit: 'contain',
              filter: 'drop-shadow(0 8px 20px rgba(0,0,0,0.55))',
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            style={{
              position: 'relative',
              width: 130,
              height: 130,
              borderRadius: '50%',
              background: color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 66,
              fontWeight: 900,
              color: '#fff',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            {(name.trim()[0] || '?').toUpperCase()}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          maxWidth: 660,
          marginTop: 6,
        }}
      >
        {/* possession marker — a vector chevron (team-tinted) points toward
            whoever has the ball, the way every broadcast scoreboard shows it.
            Vector, not the 🏈 emoji, so it renders identically at 8-foot
            distance and on a livestream. */}
        {hasPossession && (
          <span style={{ marginRight: 14, display: 'inline-flex', alignItems: 'center' }}>
            <PossessionGlyph dir={side} size={40} color={color} title="Possession" />
          </span>
        )}
        {/* item L (2026-06-16) — auto-fit to ONE line: short names render at the
            full 54px (unchanged look); long real school names shrink to fit
            instead of clipping/colliding on a 4K board. FitOneLine downscales
            only (crisp), Chromium-83 / Taurus safe. Fixed box keeps the panel
            layout stable regardless of name length. */}
        <div style={{ width: hasPossession ? 600 : 640, height: 86 }}>
          <FitOneLine
            maxFontPx={54}
            align="center"
            style={{
              fontWeight: 800,
              letterSpacing: 1,
              color: '#fff',
              textShadow: '0 4px 18px rgba(0,0,0,0.6)',
            }}
          >
            {name}
          </FitOneLine>
        </div>
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: 6,
          color,
          marginTop: 8,
        }}
      >
        {side === 'home' ? 'HOME' : 'AWAY'}
      </div>
      {/* score — pops on change (key remount retriggers the CSS pop), with a
          brief team-color glow flash behind the digits on the changed side.
          flipDir is null on first paint so a cold-boot board never pops. */}
      <div style={{ position: 'relative', marginTop: 2 }}>
        {flipKey !== undefined && flipDir && (
          <div
            key={`glow-${flipKey}`}
            aria-hidden
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 360,
              height: 360,
              marginLeft: -180,
              marginTop: -180,
              borderRadius: 999,
              background: `radial-gradient(circle, ${color}66 0%, ${color}1a 46%, rgba(5,7,13,0) 68%)`,
              animation: SCORE_GLOW_ANIM,
              pointerEvents: 'none',
            }}
          />
        )}
        <div
          key={flipKey}
          style={{
            position: 'relative',
            fontSize: 264,
            fontWeight: 900,
            color: '#fff',
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            textShadow: winning ? `0 0 64px ${color}` : '0 8px 30px rgba(0,0,0,0.7)',
            animation: flipDir ? SCORE_POP_ANIM : undefined,
          }}
        >
          {scoreText ?? score}
        </div>
      </div>
      {penaltyNode}
    </div>
  );
}

/** A per-segment scoring entry on Game.stats.lineScore. CROSS-DOMAIN
 *  CONTRACT (see 01-FIX-PLAN.md): each entry is the per-segment value (runs
 *  this inning / points this quarter) for `segment` — NOT a cumulative
 *  total. The board sums them for the R / total column; R-H-E hits + errors
 *  come from the homeHits / awayHits / homeErrors / awayErrors stats. The
 *  config+api agent appends one entry per segment boundary. */
interface LineScoreEntry {
  segment: number;
  home: number;
  away: number;
}

function readLineScore(stats: Record<string, unknown> | undefined): LineScoreEntry[] {
  const raw = stats && Array.isArray(stats.lineScore) ? (stats.lineScore as unknown[]) : [];
  return raw
    .map((e) => {
      if (!e || typeof e !== 'object') return null;
      const rec = e as Record<string, unknown>;
      const seg = Number(rec.segment);
      if (!Number.isFinite(seg)) return null;
      return { segment: seg, home: Number(rec.home) || 0, away: Number(rec.away) || 0 };
    })
    .filter((e): e is LineScoreEntry => e !== null)
    .sort((a, b) => a.segment - b.segment);
}

const numStat = (stats: Record<string, unknown> | undefined, key: string): number => {
  const n = Number((stats || {})[key]);
  return Number.isFinite(n) ? n : 0;
};

/** The canonical baseball linescore (R-H-E per-inning grid) and the football
 *  quarter-by-quarter scoring box — both fed by Game.stats.lineScore (audit
 *  P2). Renders nothing when no per-segment data has been recorded yet, so it
 *  never shows a fake empty grid. `withRHE` adds the Hits / Errors columns
 *  for baseball / softball. */
function LineScoreBox({
  data,
  def,
  withRHE,
}: {
  data: BoardData;
  def: SportDefinition;
  withRHE: boolean;
}) {
  const snaps = readLineScore(data.stats);
  if (snaps.length === 0) return null;

  // stats.lineScore stores CUMULATIVE totals at each completed-segment
  // boundary (see sports.service.ts computeLineScore). Build the full
  // cumulative-by-segment map, fold in the IN-PROGRESS segment from the
  // live score, then DIFFERENCE consecutive cumulatives to get each
  // segment's own value (runs this inning / points this quarter). The
  // R / total column is the live score — never a sum of snapshots.
  const cumBySeg = new Map<number, { home: number; away: number }>();
  for (const e of snaps) cumBySeg.set(e.segment, { home: e.home, away: e.away });
  const curSeg = Math.max(1, Math.round(Number(data.segment) || 1));
  if (!cumBySeg.has(curSeg)) {
    cumBySeg.set(curSeg, { home: Math.max(0, data.homeScore), away: Math.max(0, data.awayScore) });
  }
  const maxSeg = Math.max(def.segment.count, ...cumBySeg.keys());
  const segNums = Array.from({ length: maxSeg }, (_, i) => i + 1);
  const bySeg = new Map<number, LineScoreEntry>();
  let runH = 0;
  let runA = 0;
  for (let n = 1; n <= maxSeg; n++) {
    const c = cumBySeg.get(n);
    if (!c) continue; // unplayed segment → blank cell
    bySeg.set(n, { segment: n, home: Math.max(0, c.home - runH), away: Math.max(0, c.away - runA) });
    runH = c.home;
    runA = c.away;
  }
  const homeTotal = Math.max(0, data.homeScore);
  const awayTotal = Math.max(0, data.awayScore);
  const segAbbr = def.segment.name === 'Inning' ? '' : def.segment.name.charAt(0).toUpperCase();

  const cell = (txt: string, opts?: { head?: boolean; bold?: boolean; color?: string }): ReactNode => (
    <div
      style={{
        minWidth: 56,
        padding: '6px 4px',
        textAlign: 'center',
        fontSize: opts?.head ? 22 : 30,
        fontWeight: opts?.bold || opts?.head ? 900 : 700,
        color: opts?.color || (opts?.head ? '#64748b' : '#e2e8f0'),
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: opts?.head ? 2 : 0,
      }}
    >
      {txt}
    </div>
  );

  const teamRow = (
    side: 'home' | 'away',
    name: string,
    color: string,
    total: number,
  ): ReactNode => (
    <div style={{ display: 'flex', alignItems: 'center', borderTop: '1px solid #1e2638' }}>
      <div
        style={{
          minWidth: 220,
          padding: '6px 16px',
          fontSize: 28,
          fontWeight: 800,
          color: '#fff',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          borderLeft: `8px solid ${color}`,
        }}
      >
        {name}
      </div>
      {segNums.map((n) => {
        const e = bySeg.get(n);
        return (
          <div key={n}>{cell(e ? String(side === 'home' ? e.home : e.away) : '·')}</div>
        );
      })}
      {cell(String(total), { bold: true, color: '#fbbf24' })}
      {withRHE && cell(String(numStat(data.stats, side === 'home' ? 'homeHits' : 'awayHits')), { bold: true })}
      {withRHE && cell(String(numStat(data.stats, side === 'home' ? 'homeErrors' : 'awayErrors')), { bold: true })}
    </div>
  );

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        background: '#080b14',
        border: '1px solid #1e2638',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* header row */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ minWidth: 220, padding: '6px 16px' }} />
        {segNums.map((n) => (
          <div key={n}>{cell(`${segAbbr}${n}`, { head: true })}</div>
        ))}
        {cell('R', { head: true, color: '#fbbf24' })}
        {withRHE && cell('H', { head: true })}
        {withRHE && cell('E', { head: true })}
      </div>
      {teamRow('away', data.awayTeam, data.awayColor || DEFAULT_AWAY, awayTotal)}
      {teamRow('home', data.homeTeam, data.homeColor || DEFAULT_HOME, homeTotal)}
    </div>
  );
}

function BoardScene({ data, def }: { data: BoardData; def: SportDefinition }) {
  const [clockMs, setClockMs] = useState(data.clockMs);

  // Score-change motion — the instant the whole crowd looks at the board.
  // First paint does NOT pop (dir = null) so a cold-boot board is calm.
  const homeFlip = useScoreFlip(data.homeScore);
  const awayFlip = useScoreFlip(data.awayScore);

  // Tick the clock locally off the stored anchor. The server never
  // ticks — clockMs is the reading at clockUpdatedAt; we project it.
  useEffect(() => {
    const skew = data.serverTime - Date.now(); // local + skew ≈ server
    const anchorAt = new Date(data.clockUpdatedAt).getTime();
    const project = () => {
      if (!data.clockRunning || def.clock.type === 'none') {
        setClockMs(data.clockMs);
        return;
      }
      const elapsed = Date.now() + skew - anchorAt;
      if (def.clock.type === 'countup') setClockMs(data.clockMs + elapsed);
      else setClockMs(Math.max(0, data.clockMs - elapsed));
    };
    project();
    if (!data.clockRunning || def.clock.type === 'none') return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
  }, [data.clockMs, data.clockRunning, data.clockUpdatedAt, data.serverTime, def]);

  // Shot clock — a second countdown, projected from its own anchor in
  // stats.shotClock the same way as the game clock. Driven by the sport's
  // shotClock config (basketball 24/14, water polo 30/20, lacrosse 80/60),
  // NOT a hardcoded sport key — so every shot-clock sport renders it.
  const [shotMs, setShotMs] = useState(0);
  const scRaw = (data.stats as Record<string, unknown> | undefined)?.shotClock;
  const sc = scRaw && typeof scRaw === 'object' ? (scRaw as Record<string, unknown>) : null;
  // 2026-06-15 — the CTS feed now derives stats.shotClock per-side (cts-merge)
  // but often WITHOUT `len`. When a shot-clock object IS present but carries no
  // length, fall back to the sport's configured full length so the ring/digits
  // still render on a live CTS basketball / water-polo game. Operator-armed
  // games (which set `len`) are unchanged. No object present → stays hidden.
  const scLen = Number(sc?.len) || 0;
  const shotLen = sc ? (scLen > 0 ? scLen : Number(def.shotClock?.full) || 0) : 0;
  const shotAnchorMs = Math.max(0, Number(sc?.ms) || 0);
  const shotAnchorAt = String(sc?.at || '');
  const shotRunning = !!sc?.running;
  useEffect(() => {
    if (shotLen <= 0) {
      setShotMs(0);
      return;
    }
    const skew = data.serverTime - Date.now();
    const at = new Date(shotAnchorAt).getTime();
    const project = () => {
      if (!shotRunning || !Number.isFinite(at)) {
        setShotMs(shotAnchorMs);
        return;
      }
      setShotMs(Math.max(0, shotAnchorMs - (Date.now() + skew - at)));
    };
    project();
    if (!shotRunning) return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
  }, [shotAnchorMs, shotAnchorAt, shotRunning, shotLen, data.serverTime]);

  // Football play clock — the 40/25 countdown between snaps,
  // projected from its own anchor in stats.playClock.
  const [playMs, setPlayMs] = useState(0);
  const pcRaw = (data.stats as Record<string, unknown> | undefined)?.playClock;
  const pc = pcRaw && typeof pcRaw === 'object' ? (pcRaw as Record<string, unknown>) : null;
  const playArmed = !!(pc && String(pc.at || ''));
  const playAnchorMs = Math.max(0, Number(pc?.ms) || 0);
  const playAnchorAt = String(pc?.at || '');
  const playRunning = !!pc?.running;
  useEffect(() => {
    if (!playArmed) {
      setPlayMs(0);
      return;
    }
    const skew = data.serverTime - Date.now();
    const at = new Date(playAnchorAt).getTime();
    const project = () => {
      if (!playRunning || !Number.isFinite(at)) {
        setPlayMs(playAnchorMs);
        return;
      }
      setPlayMs(Math.max(0, playAnchorMs - (Date.now() + skew - at)));
    };
    project();
    if (!playRunning) return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
  }, [playArmed, playAnchorMs, playAnchorAt, playRunning, data.serverTime]);

  const status = STATUS_STYLE[data.status] || STATUS_STYLE.SCHEDULED;
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  // HS / college football overtime is UNTIMED — each team gets a possession
  // from the 25 with no game clock running. Showing a frozen "12:00" in OT
  // is wrong (audit P2), so suppress the clock for football past regulation
  // and surface an "OT — UNTIMED" marker instead. Other OT sports (hoops,
  // hockey, soccer) keep their timed overtime clock.
  const inOvertime = def.segment.overtime && data.segment > def.segment.count;
  const footballUntimedOT = def.key === 'football' && inOvertime;
  const hasClock = def.clock.type !== 'none' && !footballUntimedOT;

  const statChips = def.stats
    .map((s) => ({ ...s, value: (data.stats || {})[s.key] }))
    .filter((s) => s.value !== undefined && s.value !== null && s.value !== '');

  // Footer rotation — cycle through one stats slot + one slot per
  // unit of each sponsor's weight, holding each for spotSeconds. With
  // no sponsors the footer just shows stats (no rotation).
  const sponsors = data.sponsors || [];
  const spotSeconds = data.sponsorSpotSeconds || 8;
  // Whether the auto stat-leaders slot is present drives the rotation
  // length, so it must invalidate the slot memo alongside the sponsor set.
  const hasLeaders = !!(data.leaders && data.leaders.length > 0);
  const sponsorKey = JSON.stringify(sponsors) + `|leaders:${hasLeaders}`;

  // T2-9: track when each sponsor was shown (sliding 60-min window) for
  // frequency-cap enforcement. Per-render instance; reset on game change.
  const shownTimestamps = useRef<Map<string, number[]>>(new Map());

  // Build the slot list, filtering out sponsors that are cap-exceeded or
  // whose flight has ended since the last server-side listActive query.
  const buildSlots = () => {
    const now = Date.now();
    const oneHourAgo = now - 3_600_000;
    const s: ({ kind: 'stats' } | { kind: 'leaders' } | { kind: 'sponsor'; sponsor: Sponsor })[] = [
      { kind: 'stats' },
    ];
    // Phase 1 (P1-B): auto stat-leaders ride the footer rotation, but ONLY
    // when the server shipped a non-empty `leaders` array (flag-gated +
    // omitted-when-off). Absent → this slot never joins the rotation, so a
    // flag-off board rotates exactly as it does today.
    if (data.leaders && data.leaders.length > 0) s.push({ kind: 'leaders' });
    for (const sp of sponsors) {
      // Flight-end re-check: if flightEndAt is set and has passed, skip.
      if (sp.flightEndAt && new Date(sp.flightEndAt).getTime() <= now) continue;
      // Frequency-cap re-check: if cap is set, count recent shows in window.
      if (sp.frequencyCapPerHour !== null && sp.frequencyCapPerHour !== undefined) {
        const recent = (shownTimestamps.current.get(sp.id) || []).filter((t) => t > oneHourAgo);
        shownTimestamps.current.set(sp.id, recent);
        if (recent.length >= sp.frequencyCapPerHour) continue;
      }
      const w = Math.max(1, Math.min(10, sp.weight || 1));
      for (let i = 0; i < w; i++) s.push({ kind: 'sponsor', sponsor: sp });
    }
    return s;
  };

  const slots = useMemo(buildSlots, // eslint-disable-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [sponsorKey]);
  const [slotIdx, setSlotIdx] = useState(0);
  useEffect(() => {
    if (slots.length <= 1) {
      setSlotIdx(0);
      return;
    }
    const intervalMs = Math.max(3, spotSeconds) * 1000;
    const t = setInterval(() => {
      setSlotIdx((i) => (i + 1) % slots.length);
    }, intervalMs);
    return () => clearInterval(t);
  }, [slots.length, spotSeconds]);
  const activeSlot = slots[slotIdx % slots.length] || slots[0];
  // T2-8: Football possession — lights the 🏈 marker on the team panel.
  // Read from Game.possession (first-class column) first; fall back to
  // stats.possession for backward compat with rows created before the
  // add_game_possession migration.


  // T2-9: When the active slot changes to a sponsor look, record the
  // impression timestamp locally (for cap enforcement) and ping the API.
  const lastPingedSponsorRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeSlot?.kind !== 'sponsor') {
      lastPingedSponsorRef.current = null;
      return;
    }
    const sp = activeSlot.sponsor;
    // Throttle to once per look (don't double-fire on re-render).
    if (lastPingedSponsorRef.current === sp.id) return;
    lastPingedSponsorRef.current = sp.id;
    // Record locally for cap enforcement.
    const prev = shownTimestamps.current.get(sp.id) || [];
    prev.push(Date.now());
    shownTimestamps.current.set(sp.id, prev);
    // Fire-and-forget POST to the impression endpoint.
    const gameId = data.id;
    if (gameId) {
      fetch(`${API_URL}/sports/sponsors/${sp.id}/impression`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, surfaceKind: 'board' }),
      }).catch(() => {}); // best-effort, never fail the board
    }
  }, [activeSlot, data.id]);
  // Possession — read Game.possession (first-class column) first; fall
  // back to stats.possession for rows created before the migration. Used
  // by football (lights the 🏈 marker on the team panel) AND basketball
  // (the alternating-possession arrow in the center column, below).
  const possessionSide = (
    typeof (data as any).possession === 'string' && (data as any).possession
      ? (data as any).possession
      : String((data.stats as Record<string, unknown> | undefined)?.possession || '')
  )
    .trim()
    .toLowerCase();
  // Football lights the ball marker beside the leading team's name.
  const ballSide = def.key === 'football' ? possessionSide : '';
  // Basketball gets a persistent possession arrow in/near the center clock
  // column — always on-screen, independent of the rotating footer.
  const hoopsPoss =
    def.key === 'basketball' && (possessionSide === 'home' || possessionSide === 'away')
      ? (possessionSide as 'home' | 'away')
      : null;

  // Winner-highlight side — honors low-score-wins sports (XC / golf).
  const lead = leadingSide(def, data.homeScore, data.awayScore);

  // Power play / penalty kill — derived from the live penalty box for
  // hockey / lacrosse / field hockey / water polo (audit P2). Null at even
  // strength, so the badge only appears when a team is genuinely up a
  // skater. The badge re-derives every poll, so it clears the instant the
  // box empties or evens out.
  const pp = hasPenaltyBox(def) ? powerPlay(data.stats) : null;

  // Soccer added (stoppage) time — the broadcast "+N" beside the count-up
  // clock once the half has run its regulation length (audit P2). Only
  // soccer is count-up with operator-set addedTime; show it whenever an
  // added-time minute count is set, mirroring the on-pitch fourth-official
  // board convention. (Score format unchanged; this is a clock annotation.)
  const addedTimeMin =
    def.key === 'soccer'
      ? Math.max(0, Math.round(Number((data.stats as Record<string, unknown> | undefined)?.addedTime) || 0))
      : 0;

  // Spotlight resolution (Phase 1, P1-B): a MANUAL operator spotlight
  // ALWAYS wins. When none is visible AND the server shipped a
  // Player-of-the-Game, fall back to the POTG through the same
  // SpotlightBand via the spotFromPotg adapter. When neither exists this
  // is null and the board renders exactly as it does today.
  const manualSpot = data.spotlight && data.spotlight.visible && data.spotlight.title ? data.spotlight : null;
  const resolvedSpot: Spotlight | null = manualSpot
    ? manualSpot
    : data.playerOfGame
      ? spotFromPotg(data.playerOfGame)
      : null;
  const spotShowing = !!resolvedSpot;

  return (
    <div
      style={{
        position: 'relative',
        width: 1920,
        height: 1080,
        background: 'radial-gradient(ellipse at 50% 0%, #131a2e, #05070d 75%)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* idle ambient motion — a very slow, almost-subliminal sheen drift on
          the LIVE board background so it reads as "live / premium" instead of
          a frozen PNG between scores. transform-only (14s) → Taurus safe;
          aria-hidden + pointerEvents:none so it never affects layout or a11y.
          Sits at zIndex 0 behind the flow content (which is bumped to zIndex 1). */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: -120,
          right: -120,
          top: -160,
          height: 900,
          zIndex: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 60% 70% at 50% 0%, rgba(56,89,148,0.18), rgba(5,7,13,0) 70%)',
          animation: AMBIENT_DRIFT_ANIM,
        }}
      />
      {/* header strip */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          height: 92,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 44px',
          background: '#05070d',
          borderBottom: '2px solid #1e2638',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 40, fontWeight: 800, letterSpacing: 1 }}>
          <span style={{ marginRight: 16, display: 'inline-flex', alignItems: 'center' }}>
            <SportMark sport={data.sport} fallbackEmoji={def.emoji} size={48} color="#cbd5e1" title={def.name} />
          </span>
          {def.name.toUpperCase()}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: status.bg,
            padding: '12px 28px',
            borderRadius: 999,
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: 3,
            animation: status.pulse ? 'venuePulse 1.6s ease-in-out infinite' : undefined,
          }}
        >
          {status.pulse && (
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 999,
                background: '#fff',
                marginRight: 14,
                display: 'inline-block',
              }}
            />
          )}
          {status.label}
        </div>
      </div>

      {/* main row: HOME | center | AWAY */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', zIndex: 1 }}>
        <TeamPanel
          side="home"
          name={data.homeTeam}
          score={data.homeScore}
          scoreText={formatScore(def, data.homeScore)}
          color={homeColor}
          logoUrl={data.homeLogoUrl}
          winning={lead === 'home' && data.status !== 'SCHEDULED'}
          hasPossession={ballSide === 'home'}
          flipKey={homeFlip.flipKey}
          flipDir={homeFlip.dir}
          penaltyNode={
            <>
              <PenaltyTimers
                team="home"
                stats={data.stats}
                serverTime={data.serverTime}
                color={homeColor}
              />
              {/* Water-polo per-player exclusion count ("X of 3"), pinned
                  beneath the team's penalty box near the penalty area. */}
              {def.key === 'water_polo' && (
                <ExclusionPanel team="home" stats={data.stats} color={homeColor} />
              )}
            </>
          }
        />

        {/* center column — clock + segment */}
        <div
          style={{
            // 600 (was 520): a 5-char "MM:SS" clock at this size needs
            // the room — a 520 column clipped the leading/trailing digit.
            // Team panels stay ≥ 660px wide, comfortably over the 640
            // team-name max-width.
            width: 600,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#05070d',
            overflow: 'visible',
          }}
        >
          <div
            style={{
              fontSize: 38,
              fontWeight: 800,
              letterSpacing: 5,
              color: '#94a3b8',
            }}
          >
            {segmentLabel(def, data)}
          </div>
          {hasClock ? (
            <div
              style={{
                // 188 (was 200): sized so a 5-char "MM:SS" clock sits
                // inside the 600px column with margin on both sides.
                fontSize: 188,
                fontWeight: 900,
                lineHeight: 1,
                marginTop: 18,
                fontVariantNumeric: 'tabular-nums',
                color: data.clockRunning ? '#fbbf24' : '#e2e8f0',
                textShadow: data.clockRunning ? '0 0 50px rgba(251,191,36,0.5)' : 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {fmtClock(clockMs)}
              {addedTimeMin > 0 && (
                <sup
                  style={{
                    fontSize: 64,
                    fontWeight: 900,
                    color: '#fbbf24',
                    verticalAlign: 'super',
                    marginLeft: 10,
                    lineHeight: 0,
                  }}
                >
                  +{addedTimeMin}
                </sup>
              )}
            </div>
          ) : footballUntimedOT ? (
            // Football OT is untimed — no clock, just an "UNTIMED" marker so
            // the board never lies with a frozen 12:00 in overtime (P2). The
            // segment label above already reads "OT".
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                marginTop: 24,
              }}
            >
              <SportMark sport={data.sport} fallbackEmoji={def.emoji} size={120} color="#fbbf24" title={def.name} />
              <span style={{ fontSize: 34, fontWeight: 900, letterSpacing: 8, color: '#94a3b8', marginTop: 14 }}>
                UNTIMED
              </span>
            </div>
          ) : (
            <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <SportMark sport={data.sport} fallbackEmoji={def.emoji} size={150} color="#e2e8f0" title={def.name} />
            </div>
          )}
          {/* Power play / penalty kill — man-advantage badge derived from the
              live penalty box (audit P2). Team-colored, with the man-advantage
              differential ("UP 1" / "UP 2"). Clears at even strength. */}
          {pp && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                marginTop: 16,
                padding: '10px 26px',
                borderRadius: 14,
                background: `${(pp.team === 'home' ? homeColor : awayColor)}26`,
                border: `3px solid ${pp.team === 'home' ? homeColor : awayColor}`,
              }}
            >
              <span
                style={{
                  fontSize: 30,
                  fontWeight: 900,
                  letterSpacing: 6,
                  color: pp.team === 'home' ? homeColor : awayColor,
                }}
              >
                POWER PLAY
              </span>
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 3, color: '#cbd5e1', marginTop: 4 }}>
                {pp.team === 'home' ? data.homeTeam.toUpperCase() : data.awayTeam.toUpperCase()}
                {` · UP ${pp.diff}`}
              </span>
            </div>
          )}
          {!!def.shotClock && shotLen > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                marginTop: 14,
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 4, color: '#64748b' }}>
                SHOT
              </span>
              <span
                style={{
                  fontSize: 88,
                  fontWeight: 900,
                  lineHeight: 1,
                  marginTop: 2,
                  fontVariantNumeric: 'tabular-nums',
                  color: shotMs <= 5000 ? '#ef4444' : '#e2e8f0',
                }}
              >
                {shotMs <= 5000 ? (shotMs / 1000).toFixed(1) : Math.ceil(shotMs / 1000)}
              </span>
            </div>
          )}
          {/* Basketball alternating-possession arrow — always on-screen in
              the center column (mirrors the football 🏈 marker), pointing
              toward whichever team has the ball. Reads stats.possession /
              Game.possession, independent of the rotating footer. */}
          {hoopsPoss && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                marginTop: 14,
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 4, color: '#64748b' }}>
                POSS
              </span>
              <span
                aria-label={`${hoopsPoss === 'home' ? 'Home' : 'Away'} possession`}
                style={{
                  fontSize: 72,
                  fontWeight: 900,
                  lineHeight: 1,
                  marginTop: 2,
                  color: hoopsPoss === 'home' ? homeColor : awayColor,
                  textShadow: `0 0 28px ${hoopsPoss === 'home' ? homeColor : awayColor}`,
                }}
              >
                {hoopsPoss === 'home' ? '◀' : '▶'}
              </span>
            </div>
          )}
          {def.key === 'football' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                marginTop: 14,
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 4, color: '#64748b' }}>
                PLAY
              </span>
              <span
                style={{
                  fontSize: 88,
                  fontWeight: 900,
                  lineHeight: 1,
                  marginTop: 2,
                  fontVariantNumeric: 'tabular-nums',
                  color: playArmed && playMs <= 5000 ? '#ef4444' : '#e2e8f0',
                }}
              >
                {!playArmed
                  ? 40
                  : playMs <= 5000
                    ? (playMs / 1000).toFixed(1)
                    : Math.ceil(playMs / 1000)}
              </span>
            </div>
          )}
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 3, color: '#475569', marginTop: 18 }}>
            VENUEOS
          </div>
        </div>

        <TeamPanel
          side="away"
          name={data.awayTeam}
          score={data.awayScore}
          scoreText={formatScore(def, data.awayScore)}
          color={awayColor}
          logoUrl={data.awayLogoUrl}
          winning={lead === 'away' && data.status !== 'SCHEDULED'}
          hasPossession={ballSide === 'away'}
          flipKey={awayFlip.flipKey}
          flipDir={awayFlip.dir}
          penaltyNode={
            <>
              <PenaltyTimers
                team="away"
                stats={data.stats}
                serverTime={data.serverTime}
                color={awayColor}
              />
              {def.key === 'water_polo' && (
                <ExclusionPanel team="away" stats={data.stats} color={awayColor} />
              )}
            </>
          }
        />

        {/* Linescore band — the canonical baseball R-H-E per-inning grid and
            the football quarter-by-quarter scoring box (audit P2). Pinned to
            the bottom-center of the main row over the (empty, for these
            sports) lower panel area. Renders nothing until per-segment
            data exists on stats.lineScore, so it never shows an empty grid.
            Hidden while a spotlight is up so the two never collide. */}
        {(def.segment.name === 'Inning' || def.key === 'football') && !spotShowing && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 28,
              display: 'flex',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <LineScoreBox data={data} def={def} withRHE={def.segment.name === 'Inning'} />
          </div>
        )}
      </div>

      {/* broadcast spotlight — featured player / promo panel. A manual
          operator spotlight always wins; otherwise the auto
          Player-of-the-Game (P1-B) fills it via spotFromPotg. When the
          spotlight is active the footer is hidden so the spotlight can use
          the freed vertical space. */}
      {resolvedSpot ? <SpotlightBand spot={resolvedSpot} expanded /> : null}

      {/* footer strip — rotates between sport stats, auto stat-leaders, and
          sponsor banners. Hidden while a player spotlight is showing so it
          can expand. */}
      <div
        style={{
          height: spotShowing ? 0 : 132,
          overflow: 'hidden',
          background: '#05070d',
          borderTop: spotShowing ? 'none' : '2px solid #1e2638',
          position: 'relative',
          zIndex: 1,
          transition: 'height 0.35s ease-in-out',
        }}
      >
        <div
          key={slotIdx}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 44px',
            animation: 'venueFooterFade 0.6s ease-out',
          }}
        >
          {activeSlot && activeSlot.kind === 'sponsor' ? (
            <SponsorBanner sponsor={activeSlot.sponsor} />
          ) : activeSlot && activeSlot.kind === 'leaders' && data.leaders ? (
            /* Phase 1 (P1-B): auto stat-leaders — "PTS — #23 JONES 30"
               with the player's team color as the accent. */
            <LeadersStrip leaders={data.leaders} homeColor={homeColor} awayColor={awayColor} />
          ) : statChips.length === 0 ? (
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 4, color: '#334155' }}>
              {data.homeTeam.toUpperCase()} vs {data.awayTeam.toUpperCase()}
            </div>
          ) : (
            /* Broadcast situational graphics — the same shared renderer
               the scoreboard widget uses: base diamond + B/S/O for
               baseball, down & distance + possession for football,
               bonus + timeout pips for basketball, etc. One source of
               truth so the venue board and the template widget match. */
            <SituationalRow
              def={def}
              stats={data.stats || {}}
              h={620}
              accent="#fbbf24"
              ink="#ffffff"
              dim="#64748b"
              hairline="transparent"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── meet / leaderboard scene (track, swim, XC, golf, gym, cheer) ───

/** Pull a stat off the live game stats blob as a trimmed string. */
function statStr(stats: Record<string, unknown> | undefined, key: string): string {
  const v = (stats || {})[key];
  return v === undefined || v === null ? '' : String(v).trim();
}

/** The meet's headline context line — the single most important live
 *  datum the operator surfaces (current event / heat / hole / apparatus /
 *  division). Falls back to the segment label so the banner is never
 *  empty. Returns { eyebrow, headline }. */
function meetContext(
  def: SportDefinition,
  data: BoardData,
): { eyebrow: string; headline: string } {
  const s = data.stats || {};
  switch (def.key) {
    case 'track_and_field':
    // DEPRECATED key — pre-split games only.
    case 'swimming_diving':
    case 'swimming': {
      const ev = statStr(s, 'currentEvent');
      return { eyebrow: 'CURRENT EVENT', headline: ev || 'WARM-UPS' };
    }
    case 'diving': {
      const diver = statStr(s, 'currentDiver');
      const code = statStr(s, 'diveCode');
      return { eyebrow: 'NOW DIVING', headline: diver ? (code ? `${diver} · ${code}` : diver) : 'WARM-UPS' };
    }
    case 'cross_country': {
      const lead = statStr(s, 'leadRunner');
      return { eyebrow: 'RACE LEADER', headline: lead || 'RACE IN PROGRESS' };
    }
    case 'golf': {
      const hole = statStr(s, 'currentHole');
      const n = data.segment;
      const holeLabel = hole
        ? `HOLE ${hole}`
        : n > def.segment.count
          ? 'ROUND COMPLETE'
          : `HOLE ${n}`;
      return { eyebrow: 'NOW PLAYING', headline: holeLabel };
    }
    case 'gymnastics': {
      const app = statStr(s, 'currentApparatus');
      return { eyebrow: 'CURRENT ROTATION', headline: app || `ROTATION ${data.segment}` };
    }
    case 'competitive_cheer': {
      const div = statStr(s, 'division');
      return { eyebrow: 'DIVISION', headline: div || `ROUND ${data.segment}` };
    }
    default:
      return { eyebrow: def.segment.name.toUpperCase(), headline: segmentLabel(def, data) };
  }
}

/** A single team card in the meet's points tally. */
function MeetTeamCard({
  name,
  score,
  scoreText,
  unit,
  color,
  logoUrl,
  leading,
  alignR,
  context,
}: {
  name: string;
  /** Raw scaled score — kept for layout; never rendered when
   *  `scoreText` is supplied. */
  score: number;
  /** Pre-formatted display string (decimals for judged sports). */
  scoreText?: string;
  unit: string;
  color: string;
  logoUrl: string | null;
  leading: boolean;
  alignR?: boolean;
  context?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 48px',
        background: `linear-gradient(${alignR ? '225deg' : '135deg'}, ${color}30, #0b0f1a 74%)`,
        borderTop: `10px solid ${color}`,
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 200,
          height: 168,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            background: `radial-gradient(circle at 50% 48%, ${color}55, transparent 64%)`,
          }}
        />
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            style={{
              position: 'relative',
              width: 168,
              height: 168,
              objectFit: 'contain',
              filter: 'drop-shadow(0 8px 20px rgba(0,0,0,0.55))',
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            style={{
              position: 'relative',
              width: 128,
              height: 128,
              borderRadius: '50%',
              background: color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 64,
              fontWeight: 900,
              color: '#fff',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            {(name.trim()[0] || '?').toUpperCase()}
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: 50,
          fontWeight: 800,
          letterSpacing: 1,
          color: '#fff',
          textAlign: 'center',
          maxWidth: 640,
          lineHeight: 1.05,
          marginTop: 6,
          textShadow: '0 4px 18px rgba(0,0,0,0.6)',
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontSize: 200,
          fontWeight: 900,
          color: '#fff',
          lineHeight: 1,
          marginTop: 4,
          fontVariantNumeric: 'tabular-nums',
          textShadow: leading ? `0 0 64px ${color}` : '0 8px 30px rgba(0,0,0,0.7)',
        }}
      >
        {scoreText ?? score}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: 4,
          color: leading ? color : '#475569',
          marginTop: 6,
        }}
      >
        {leading ? 'LEADING' : unit.toUpperCase()}
      </div>
      {context ? (
        <div
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 1,
            color: '#94a3b8',
            marginTop: 12,
            textAlign: 'center',
            maxWidth: 640,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {context}
        </div>
      ) : null}
    </div>
  );
}

/** The four women's gymnastics apparatus in standard meet-rotation order.
 *  A meet rotates through these; the board lights the current one. */
const GYM_APPARATUS = ['VAULT', 'BARS', 'BEAM', 'FLOOR'] as const;

/** Per-apparatus rotation strip for the gymnastics meet board (audit P2).
 *  Highlights the live apparatus — matched by name from
 *  stats.currentApparatus when set, otherwise by the rotation number
 *  (data.segment, 1-based) so the strip stays meaningful even before the
 *  operator types the apparatus. Pure-render off existing state. */
function ApparatusRotation({ data }: { data: BoardData }) {
  const current = statStr(data.stats, 'currentApparatus').toUpperCase();
  // Match the typed apparatus to the canonical list (substring-tolerant:
  // "Uneven Bars" → BARS, "Balance Beam" → BEAM).
  let activeIdx = GYM_APPARATUS.findIndex((a) => current.includes(a));
  if (activeIdx < 0 && data.segment >= 1 && data.segment <= GYM_APPARATUS.length) {
    activeIdx = data.segment - 1;
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        marginTop: 22,
      }}
    >
      {GYM_APPARATUS.map((a, i) => (
        <div
          key={a}
          style={{
            fontSize: 18,
            fontWeight: i === activeIdx ? 900 : 700,
            letterSpacing: 3,
            color: i === activeIdx ? '#fbbf24' : '#475569',
            marginTop: i === 0 ? 0 : 8,
            textShadow: i === activeIdx ? '0 0 18px rgba(251,191,36,0.5)' : 'none',
          }}
        >
          {i === activeIdx ? '▸ ' : ''}
          {a}
        </div>
      ))}
    </div>
  );
}

/**
 * The current-event finish-results panel for a meet board (place / name /
 * mark), fed by the structured stats.results contract the console writes
 * and the api persists. For gymnastics / cheer the "events" are the
 * apparatus (event = "Vault", mark = the decimal score "9.850"); for
 * track / swim / XC / golf they are the finish events (mark = a time /
 * distance / stroke string). Renders the MOST RECENT event (the highest
 * `order`, else the last in the array) so the board always shows the
 * just-completed result, with a winner-highlight on 1st place. Renders
 * NOTHING when there are no results — never a fake grid.
 *
 * Chromium-83 safe: no inset shorthand / flex gap / backdrop-filter.
 */
function MeetResultsBox({ data }: { data: BoardData }) {
  const events = readResults(data.stats);
  if (events.length === 0) return null;
  // Show the latest event: prefer the highest `order`, else array order.
  const current: ResultEvent = events.reduce((best, e) => {
    const bo = best.order ?? -Infinity;
    const eo = e.order ?? -Infinity;
    if (eo > bo) return e;
    if (eo === bo) return e; // later array index wins on a tie
    return best;
  }, events[events.length - 1]);
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  // Top 8 finishers fit the board cleanly; the operator types the
  // headline finishers, not a full heat sheet.
  const rows = current.entries.slice(0, 8);

  const placeText = (place: number): string => (place > 0 ? ordinal(place) : '—');

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        background: '#080b14',
        border: '1px solid #1e2638',
        borderRadius: 14,
        overflow: 'hidden',
        minWidth: 560,
        maxWidth: 760,
        boxShadow: '0 18px 48px rgba(0,0,0,0.6)',
      }}
    >
      {/* event title row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 22px',
          background: '#0b1226',
          borderBottom: '1px solid #1e2638',
        }}
      >
        <span style={{ fontSize: 24, fontWeight: 900, letterSpacing: 3, color: '#fbbf24' }}>
          {current.event.toUpperCase()}
        </span>
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 4, color: '#64748b' }}>
          RESULTS
        </span>
      </div>
      {rows.map((r, i) => {
        const teamColor =
          r.team === 'home' ? homeColor : r.team === 'away' ? awayColor : '#334155';
        const isWinner = r.place === 1;
        return (
          <div
            key={`${r.place}-${r.name}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 18px',
              borderTop: i === 0 ? 'none' : '1px solid #131a2b',
              background: isWinner ? `${teamColor}1f` : 'transparent',
            }}
          >
            {/* place */}
            <div
              style={{
                minWidth: 64,
                fontSize: 28,
                fontWeight: 900,
                color: isWinner ? '#fbbf24' : '#94a3b8',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {placeText(r.place)}
            </div>
            {/* team color tab */}
            <div
              style={{
                width: 6,
                height: 30,
                borderRadius: 3,
                background: teamColor,
                marginRight: 16,
                flex: 'none',
              }}
            />
            {/* name (+ optional lane) */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 28,
                fontWeight: 800,
                color: '#fff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {r.name || '—'}
              {r.lane ? (
                <span style={{ fontSize: 18, fontWeight: 700, color: '#64748b', marginLeft: 12 }}>
                  LN {r.lane}
                </span>
              ) : null}
            </div>
            {/* mark */}
            <div
              style={{
                fontSize: 30,
                fontWeight: 900,
                color: '#e2e8f0',
                fontVariantNumeric: 'tabular-nums',
                marginLeft: 18,
                whiteSpace: 'nowrap',
              }}
            >
              {r.mark || '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * LEADERBOARD board scene — the meet-sport render. Track / swim / cross
 * country / golf / gymnastics / cheer are NOT head-to-head clock games,
 * so the legacy BoardScene (which dropped a giant emoji where the clock
 * would be) reads as broken. This scene instead promotes the live meet
 * context (current event / heat / hole / apparatus / division) to a
 * prominent banner, shows the team-points tally with a winner highlight
 * (honoring low-score-wins XC / golf), and lists the per-side meet
 * details that exist in the live game state (lead runner, finishers,
 * vs-par, competitor counts).
 *
 * When the operator records finish / per-apparatus results (the
 * stats.results contract), the current event's finish list (place /
 * name / mark) overlays the center of the tally via MeetResultsBox —
 * including the gymnastics per-apparatus decimal scores. The box
 * renders nothing until results exist, so an un-scored meet shows the
 * clean team-points tally exactly as before.
 *
 * Chromium-83 safe: no inset shorthand / flex gap / backdrop-filter.
 */
function LeaderboardScene({ data, def }: { data: BoardData; def: SportDefinition }) {
  const status = STATUS_STYLE[data.status] || STATUS_STYLE.SCHEDULED;
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  const { eyebrow, headline } = meetContext(def, data);
  const lead = leadingSide(def, data.homeScore, data.awayScore);
  const lowerWins = isLowerWins(def);

  // Per-side meet detail line (right under each team's points), built from
  // whatever live state the sport carries.
  const sideDetail = (team: 'home' | 'away'): string => {
    const s = data.stats || {};
    if (def.key === 'golf') {
      const par = statStr(s, team === 'home' ? 'homePar' : 'awayPar');
      return par ? `${par} vs par` : '';
    }
    if (
      def.key === 'gymnastics' ||
      def.key === 'track_and_field' ||
      // DEPRECATED key — pre-split games only.
      def.key === 'swimming_diving' ||
      def.key === 'swimming' ||
      def.key === 'diving'
    ) {
      const n = statStr(s, team === 'home' ? 'homeAthletes' : 'awayAthletes');
      return n ? `${n} competing` : '';
    }
    if (def.key === 'competitive_cheer') {
      return statStr(s, team === 'home' ? 'homeRoutine' : 'awayRoutine');
    }
    return '';
  };

  // A meet sub-line beneath the headline — e.g. XC finishers count, the
  // round/rotation number, or the segment for context.
  const subLine = (): string => {
    const s = data.stats || {};
    if (def.key === 'cross_country') {
      const fin = statStr(s, 'finishers');
      return fin ? `${fin} FINISHED` : 'RACE IN PROGRESS';
    }
    if (def.key === 'gymnastics') return `ROTATION ${data.segment} OF ${def.segment.count}`;
    if (def.key === 'competitive_cheer') return `ROUND ${data.segment}`;
    if (def.key === 'golf') return lowerWins ? 'LOW SCORE LEADS' : '';
    return '';
  };
  const sub = subLine();

  // Spotlight resolution (Phase 1, P1-B) — identical rule to the
  // head-to-head board: a MANUAL operator spotlight always wins; otherwise
  // the auto Player-of-the-Game (the meet's top performer) fills it.
  const manualSpot =
    data.spotlight && data.spotlight.visible && data.spotlight.title ? data.spotlight : null;
  const resolvedSpot: Spotlight | null = manualSpot
    ? manualSpot
    : data.playerOfGame
      ? spotFromPotg(data.playerOfGame)
      : null;

  return (
    <div
      style={{
        width: 1920,
        height: 1080,
        background: 'radial-gradient(ellipse at 50% 0%, #131a2e, #05070d 75%)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* header strip — sport + status */}
      <div
        style={{
          height: 92,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 44px',
          background: '#05070d',
          borderBottom: '2px solid #1e2638',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 40, fontWeight: 800, letterSpacing: 1 }}>
          <span style={{ marginRight: 16, display: 'inline-flex', alignItems: 'center' }}>
            <SportMark sport={data.sport} fallbackEmoji={def.emoji} size={48} color="#cbd5e1" title={def.name} />
          </span>
          {def.name.toUpperCase()}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: status.bg,
            padding: '12px 28px',
            borderRadius: 999,
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: 3,
            animation: status.pulse ? 'venuePulse 1.6s ease-in-out infinite' : undefined,
          }}
        >
          {status.pulse && (
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 999,
                background: '#fff',
                marginRight: 14,
                display: 'inline-block',
              }}
            />
          )}
          {status.label}
        </div>
      </div>

      {/* meet-context banner — the headline live datum (event / hole /
          apparatus / division), where a clock would sit on a timed sport */}
      <div
        style={{
          minHeight: 196,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 44px',
          background: 'linear-gradient(180deg, #0b1226, #05070d)',
          borderBottom: '2px solid #1e2638',
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 8, color: '#818cf8' }}>
          {eyebrow}
        </div>
        <div
          style={{
            fontSize: 96,
            fontWeight: 900,
            lineHeight: 1.05,
            marginTop: 8,
            color: '#fbbf24',
            textShadow: '0 0 50px rgba(251,191,36,0.4)',
            textAlign: 'center',
            maxWidth: 1700,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {headline}
        </div>
        {sub ? (
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 4, color: '#64748b', marginTop: 10 }}>
            {sub}
          </div>
        ) : null}
      </div>

      {/* team-points tally — two cards + a center divider */}
      <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
        <MeetTeamCard
          name={data.homeTeam}
          score={data.homeScore}
          scoreText={formatScore(def, data.homeScore)}
          unit={def.score.unit}
          color={homeColor}
          logoUrl={data.homeLogoUrl}
          leading={lead === 'home' && data.status !== 'SCHEDULED'}
          context={sideDetail('home')}
        />
        <div
          style={{
            width: 220,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#05070d',
          }}
        >
          <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: 4, color: '#334155' }}>VS</div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 3,
              color: '#475569',
              marginTop: 18,
              textAlign: 'center',
            }}
          >
            {def.score.unit.toUpperCase()}
          </div>
          {/* Gymnastics per-apparatus rotation structure (audit P2): the four
              women's apparatus in standard rotation order, with the current
              one (matched by stats.currentApparatus name, else by the live
              rotation number) lit. Built from existing state — no new data
              model. */}
          {def.key === 'gymnastics' && <ApparatusRotation data={data} />}
        </div>
        <MeetTeamCard
          name={data.awayTeam}
          score={data.awayScore}
          scoreText={formatScore(def, data.awayScore)}
          unit={def.score.unit}
          color={awayColor}
          logoUrl={data.awayLogoUrl}
          leading={lead === 'away' && data.status !== 'SCHEDULED'}
          alignR
          context={sideDetail('away')}
        />

        {/* current-event finish results (place / name / mark) + gymnastics
            per-apparatus decimal scores. Overlaid on the center of the
            tally so the just-completed event is glanceable above the
            team-points cards. Renders nothing until results exist, and is
            hidden while a spotlight is up so the two never collide. */}
        {!resolvedSpot && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 32,
              display: 'flex',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <MeetResultsBox data={data} />
          </div>
        )}
      </div>

      {/* broadcast spotlight — featured athlete (same as head-to-head): a
          manual operator spotlight always wins; otherwise the auto
          Player-of-the-Game (P1-B) fills it via spotFromPotg. */}
      {resolvedSpot ? (
        <SpotlightBand spot={resolvedSpot} expanded />
      ) : (
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#05070d',
            borderTop: '2px solid #1e2638',
          }}
        >
          <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: 5, color: '#475569' }}>
            VENUEOS
          </span>
        </div>
      )}
    </div>
  );
}

// ── sponsor banner (rotates in the board footer) ───────────────

function SponsorBanner({ sponsor }: { sponsor: Sponsor }) {
  const color = sponsor.color || '#4f46e5';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        height: '100%',
        background: `linear-gradient(90deg, ${color}3a, transparent 60%)`,
      }}
    >
      {/* logo or color monogram */}
      {sponsor.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sponsor.logoUrl}
          alt=""
          style={{
            // Transparent — the logo sits straight on the banner so it
            // reads as part of the board, not a white sticker. Natural
            // aspect (width auto) so a wide logo isn't crushed into a
            // square, and taller so the sponsor is actually legible.
            height: 104,
            width: 'auto',
            maxWidth: 460,
            objectFit: 'contain',
            marginRight: 30,
          }}
        />
      ) : (
        <div
          style={{
            height: 104,
            width: 104,
            borderRadius: 14,
            background: color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 58,
            fontWeight: 900,
            color: '#fff',
            marginRight: 30,
          }}
        >
          {sponsor.name.charAt(0).toUpperCase()}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 48,
            fontWeight: 900,
            color: '#fff',
            lineHeight: 1.05,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sponsor.name}
        </div>
        {sponsor.tagline && (
          <div
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: '#94a3b8',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sponsor.tagline}
          </div>
        )}
      </div>

      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          letterSpacing: 4,
          color,
          marginLeft: 20,
          whiteSpace: 'nowrap',
        }}
      >
        PROUD SPONSOR
      </div>
    </div>
  );
}

// ── auto stat-leaders + Player-of-the-Game (Phase 1, P1-B) ─────
// These render ONLY when getBoardFresh ships `leaders` / `playerOfGame`
// (flag-gated server-side, omitted when off/empty). When the fields are
// absent the board is byte-identical to today.

type PlayerOfGame = NonNullable<BoardData['playerOfGame']>;
type StatLeader = NonNullable<BoardData['leaders']>[number];

/** Adapt the server's Player-of-the-Game shape into the Spotlight shape so
 *  it can ride the existing SpotlightBand. The POTG only ever fills the
 *  Spotlight when NO manual operator spotlight is visible (manual wins). */
function spotFromPotg(potg: PlayerOfGame): Spotlight {
  const num = (potg.number || '').trim();
  // "#23 MARCUS JONES" — number prefix when present, name always.
  const title = num ? `#${num.replace(/^#/, '')} ${potg.name}` : potg.name;
  return {
    visible: true,
    title,
    photoUrl: potg.photoUrl,
    subtitle: potg.headline,
    lines: potg.lines,
  };
}

/** Broadcast stat-leaders strip — rides the footer rotation alongside the
 *  situational graphics + sponsors. Reads at 8ft: each leader shows the
 *  stat label, the player's number + name, and the value, with the
 *  player's TEAM color as the accent rail. Taurus / Chromium-83 safe:
 *  fixed-px sizing, longhand top/right/bottom/left, per-child marginRight
 *  (no flex `gap`), no `inset`, no `backdrop-filter`. */
function LeadersStrip({
  leaders,
  homeColor,
  awayColor,
}: {
  leaders: StatLeader[];
  homeColor: string;
  awayColor: string;
}) {
  // Cap at the four most impactful so each tile stays legible at distance.
  const shown = leaders.slice(0, 4);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      {shown.map((l, i) => {
        const accent = l.team === 'home' ? homeColor : awayColor;
        const num = (l.playerNumber || '').trim().replace(/^#/, '');
        const isLast = i === shown.length - 1;
        return (
          <div
            key={`${l.statKey}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              // Per-child margin (NOT flex gap — Chromium-83 / Taurus).
              marginRight: isLast ? 0 : 28,
              paddingLeft: 18,
              paddingRight: 22,
              paddingTop: 12,
              paddingBottom: 12,
              background: '#0b1226',
              borderLeft: `6px solid ${accent}`,
              borderRadius: 10,
              maxWidth: 440,
            }}
          >
            {l.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={l.photoUrl}
                alt=""
                style={{
                  width: 72,
                  height: 72,
                  objectFit: 'cover',
                  borderRadius: 8,
                  border: `2px solid ${accent}`,
                  background: '#05070d',
                  marginRight: 16,
                  flex: 'none',
                }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  letterSpacing: 3,
                  color: accent,
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
              >
                {l.label}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  marginTop: 4,
                  maxWidth: 320,
                }}
              >
                {num ? (
                  <span
                    style={{
                      fontSize: 28,
                      fontWeight: 900,
                      color: '#94a3b8',
                      marginRight: 10,
                      flex: 'none',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    #{num}
                  </span>
                ) : null}
                <span
                  style={{
                    fontSize: 30,
                    fontWeight: 900,
                    color: '#fff',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {(l.playerName || '').toUpperCase()}
                </span>
                <span
                  style={{
                    fontSize: 34,
                    fontWeight: 900,
                    color: accent,
                    marginLeft: 16,
                    flex: 'none',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {l.value}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── spotlight band (featured player / promo) ───────────────────

function SpotlightBand({ spot, expanded }: { spot: Spotlight; expanded?: boolean }) {
  const lines = (spot.lines || []).filter((l) => l && (l.label || l.value)).slice(0, 4);
  // When the footer is hidden (expanded=true) we gain ~132px extra height.
  // Use a taller band + bigger photo + bigger name so the spotlight fills it.
  const bandH = expanded ? 316 : 184;
  const photoSz = expanded ? 256 : 148;
  const eyebrowSz = expanded ? 22 : 17;
  const titleSz = expanded ? 76 : 52;
  const subtitleSz = expanded ? 30 : 23;
  const statValueSz = expanded ? 80 : 54;
  const statLabelSz = expanded ? 19 : 15;
  const statPad = expanded ? 36 : 26;
  return (
    <div
      style={{
        height: bandH,
        background: '#0b1020',
        borderTop: '3px solid #4f46e5',
        display: 'flex',
        alignItems: 'center',
        padding: '0 48px',
        fontFamily: 'Inter, system-ui, sans-serif',
        transition: 'height 0.35s ease-in-out',
      }}
    >
      {spot.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={spot.photoUrl}
          alt=""
          style={{
            width: photoSz,
            height: photoSz,
            objectFit: 'cover',
            borderRadius: 16,
            border: '3px solid #1e2638',
            background: '#05070d',
            marginRight: 32,
            flex: 'none',
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: eyebrowSz, fontWeight: 800, letterSpacing: 4, color: '#818cf8' }}>
          SPOTLIGHT
        </div>
        <div
          style={{
            fontSize: titleSz,
            fontWeight: 900,
            color: '#fff',
            // 1.3 (was 1.05): the line box must contain Inter's full
            // glyph extent (~1.21em) or `overflow:hidden` clips the
            // descenders — a name like "Greg" lost the tail of its g.
            lineHeight: 1.3,
            marginTop: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {spot.title}
        </div>
        {spot.subtitle ? (
          <div style={{ fontSize: subtitleSz, fontWeight: 600, color: '#94a3b8', marginTop: 2 }}>
            {spot.subtitle}
          </div>
        ) : null}
      </div>
      {lines.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', flex: 'none' }}>
          {lines.map((l, i) => (
            <div
              key={i}
              style={{
                textAlign: 'center',
                padding: `0 ${statPad}px`,
                borderLeft: i > 0 ? '2px solid #1e2638' : undefined,
              }}
            >
              <div
                style={{
                  fontSize: statValueSz,
                  fontWeight: 900,
                  color: '#fff',
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {l.value || '—'}
              </div>
              <div
                style={{
                  fontSize: statLabelSz,
                  fontWeight: 700,
                  letterSpacing: 2,
                  color: '#64748b',
                  marginTop: 6,
                }}
              >
                {(l.label || '').toUpperCase()}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── non-LIVE status presentation scenes ────────────────────────
// These render for PRE_GAME/SCHEDULED, HALFTIME, and FINAL.
// The LIVE path (BoardScene) is untouched — zero regression risk.

/** A large team logo block with name and optional score — shared by all
 *  three non-live scenes. */
function BigTeamBlock({
  name,
  score,
  scoreText,
  logoUrl,
  color,
  showScore,
  accent,
}: {
  name: string;
  /** Raw scaled score — gates display via `showScore`; never rendered
   *  when `scoreText` is supplied. */
  score?: number;
  /** Pre-formatted display string (decimals for judged sports). */
  scoreText?: string;
  logoUrl: string | null;
  color: string;
  showScore?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
      }}
    >
      {/* logo or monogram */}
      <div
        style={{
          position: 'relative',
          width: 280,
          height: 280,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
        }}
      >
        {/* team-color halo */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            background: `radial-gradient(circle at 50% 50%, ${color}55, transparent 68%)`,
            borderRadius: 999,
          }}
        />
        {accent && (
          <div
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              bottom: -6,
              left: -6,
              borderRadius: 999,
              border: `5px solid ${color}`,
              boxShadow: `0 0 48px ${color}88`,
            }}
          />
        )}
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            style={{
              position: 'relative',
              width: 240,
              height: 240,
              objectFit: 'contain',
              filter: 'drop-shadow(0 12px 32px rgba(0,0,0,0.6))',
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            style={{
              position: 'relative',
              width: 180,
              height: 180,
              borderRadius: '50%',
              background: color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 88,
              fontWeight: 900,
              color: '#fff',
              boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
            }}
          >
            {(name.trim()[0] || '?').toUpperCase()}
          </div>
        )}
      </div>
      {/* name */}
      <div
        style={{
          fontSize: 52,
          fontWeight: 900,
          color: '#fff',
          textAlign: 'center',
          maxWidth: 580,
          lineHeight: 1.05,
          letterSpacing: 1,
          textShadow: '0 4px 16px rgba(0,0,0,0.55)',
        }}
      >
        {name}
      </div>
      {/* score — only when showScore */}
      {showScore && score !== undefined && (
        <div
          style={{
            fontSize: 220,
            fontWeight: 900,
            lineHeight: 1,
            marginTop: 8,
            fontVariantNumeric: 'tabular-nums',
            color: '#fff',
            textShadow: accent ? `0 0 72px ${color}` : '0 8px 30px rgba(0,0,0,0.7)',
          }}
        >
          {scoreText ?? score}
        </div>
      )}
    </div>
  );
}

/** PRE_GAME / SCHEDULED — matchup graphic.
 *  No scores yet; focus is on team identity + anticipation framing. */
function PreGameScene({ data, def }: { data: BoardData; def: SportDefinition }) {
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  const pill = STATUS_STYLE[data.status] || STATUS_STYLE.PRE_GAME;
  return (
    <div
      style={{
        width: 1920,
        height: 1080,
        background: 'radial-gradient(ellipse at 50% 0%, #131a2e, #05070d 75%)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* header */}
      <div
        style={{
          height: 92,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 44px',
          background: '#05070d',
          borderBottom: '2px solid #1e2638',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 40, fontWeight: 800, letterSpacing: 1 }}>
          <span style={{ marginRight: 16, display: 'inline-flex', alignItems: 'center' }}>
            <SportMark sport={data.sport} fallbackEmoji={def.emoji} size={48} color="#cbd5e1" title={def.name} />
          </span>
          {def.name.toUpperCase()}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: pill.bg,
            padding: '12px 28px',
            borderRadius: 999,
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: 3,
          }}
        >
          {pill.label}
        </div>
      </div>

      {/* matchup body */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* left team gradient wash */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: '48%',
            background: `linear-gradient(135deg, ${homeColor}22, transparent 72%)`,
            borderTop: `6px solid ${homeColor}`,
          }}
        />
        {/* right team gradient wash */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '48%',
            background: `linear-gradient(225deg, ${awayColor}22, transparent 72%)`,
            borderTop: `6px solid ${awayColor}`,
          }}
        />

        {/* home team */}
        <BigTeamBlock
          name={data.homeTeam}
          logoUrl={data.homeLogoUrl}
          color={homeColor}
          showScore={false}
        />

        {/* VS divider — team-tinted + legible (was dark-#1e2638 on dark, near
            invisible). A home→away color gradient on the "VS" plus a soft
            two-tone halo reads as a real matchup. The label is time-agnostic
            ("GAME DAY") because the board payload carries no start time — we
            do NOT invent a field or fetch (2026-06-15 sports-pro polish). */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: 200,
            flexShrink: 0,
            position: 'relative',
          }}
        >
          {/* two-tone halo so the VS sits on a faint glow, not flat dark */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 240,
              height: 240,
              marginLeft: -120,
              marginTop: -120,
              borderRadius: 999,
              background: `radial-gradient(circle at 32% 50%, ${homeColor}33, transparent 60%), radial-gradient(circle at 68% 50%, ${awayColor}33, transparent 60%)`,
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'relative',
              fontSize: 104,
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: 4,
              background: `linear-gradient(135deg, ${homeColor}, #ffffff 50%, ${awayColor})`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              color: '#fff',
              filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.55))',
            }}
          >
            VS
          </div>
          <div
            style={{
              position: 'relative',
              marginTop: 16,
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: 5,
              color: '#94a3b8',
            }}
          >
            GAME DAY
          </div>
        </div>

        {/* away team */}
        <BigTeamBlock
          name={data.awayTeam}
          logoUrl={data.awayLogoUrl}
          color={awayColor}
          showScore={false}
        />
      </div>

      {/* footer */}
      <div
        style={{
          height: 80,
          background: '#05070d',
          borderTop: '2px solid #1e2638',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: 5,
          color: '#334155',
        }}
      >
        VENUEOS
      </div>
    </div>
  );
}

/** HALFTIME — the score with a prominent HALFTIME treatment. */
function HalftimeScene({ data, def }: { data: BoardData; def: SportDefinition }) {
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  return (
    <div
      style={{
        width: 1920,
        height: 1080,
        background: 'radial-gradient(ellipse at 50% 0%, #131a2e, #05070d 75%)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* header */}
      <div
        style={{
          height: 92,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 44px',
          background: '#05070d',
          borderBottom: '2px solid #1e2638',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 40, fontWeight: 800, letterSpacing: 1 }}>
          <span style={{ marginRight: 16, display: 'inline-flex', alignItems: 'center' }}>
            <SportMark sport={data.sport} fallbackEmoji={def.emoji} size={48} color="#cbd5e1" title={def.name} />
          </span>
          {def.name.toUpperCase()}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: STATUS_STYLE.HALFTIME.bg,
            padding: '12px 28px',
            borderRadius: 999,
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: 3,
          }}
        >
          HALFTIME
        </div>
      </div>

      {/* body — scores */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* left gradient */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: '45%',
            background: `linear-gradient(135deg, ${homeColor}1a, transparent 68%)`,
            borderTop: `4px solid ${homeColor}`,
          }}
        />
        {/* right gradient */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '45%',
            background: `linear-gradient(225deg, ${awayColor}1a, transparent 68%)`,
            borderTop: `4px solid ${awayColor}`,
          }}
        />

        <BigTeamBlock
          name={data.homeTeam}
          score={data.homeScore}
          scoreText={formatScore(def, data.homeScore)}
          logoUrl={data.homeLogoUrl}
          color={homeColor}
          showScore
        />

        {/* center divider */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: 180,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 26,
              fontWeight: 900,
              letterSpacing: 5,
              color: '#2563eb',
              marginBottom: 12,
            }}
          >
            HALFTIME
          </div>
          <div style={{ fontSize: 80, fontWeight: 900, color: '#1e2638', lineHeight: 1 }}>–</div>
        </div>

        <BigTeamBlock
          name={data.awayTeam}
          score={data.awayScore}
          scoreText={formatScore(def, data.awayScore)}
          logoUrl={data.awayLogoUrl}
          color={awayColor}
          showScore
        />
      </div>

      {/* footer */}
      <div
        style={{
          height: 80,
          background: '#05070d',
          borderTop: '2px solid #1e2638',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: 5,
          color: '#334155',
        }}
      >
        VENUEOS
      </div>
    </div>
  );
}

/** FINAL — score with winner cinematic; tie = no winner accent.
 *  2026-06-15 sports-pro polish: a clear WINNER treatment — champion glow +
 *  slow confetti tinted to the winner, a "WINNER" star banner over the
 *  winning team, and the score highlighted (the emotional peak). Honors
 *  low-score-wins sports (XC / golf) so the right side is crowned. */
function FinalScene({ data, def }: { data: BoardData; def: SportDefinition }) {
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  const tie = data.homeScore === data.awayScore;
  // leadingSide honors low-score-wins sports; at FINAL the leader IS the winner.
  const winSide = tie ? null : leadingSide(def, data.homeScore, data.awayScore);
  const homeWins = winSide === 'home';
  const awayWins = winSide === 'away';
  const winColor = homeWins ? homeColor : awayWins ? awayColor : '#fbbf24';
  const winName = homeWins ? data.homeTeam : awayWins ? data.awayTeam : '';
  return (
    <div
      style={{
        position: 'relative',
        width: 1920,
        height: 1080,
        background: 'radial-gradient(ellipse at 50% 0%, #131a2e, #05070d 75%)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* Champion cinematic — only when there's a winner (a tie shows none).
          A slow winner-tinted glow breath + slow continuous confetti, behind
          all content (zIndex 0). transform/opacity-only → Taurus + WebKit safe.
          pointerEvents:none + aria-hidden so it never affects layout or a11y. */}
      {!tie && (
        <div
          aria-hidden
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}
        >
          {/* champion glow breath, centered behind the winning team's side */}
          <div
            style={{
              position: 'absolute',
              top: 120,
              left: homeWins ? 220 : awayWins ? 1140 : 660,
              width: 560,
              height: 560,
              borderRadius: 999,
              background: `radial-gradient(circle, ${hexA(winColor, 0.42)} 0%, ${hexA(winColor, 0.12)} 46%, rgba(5,7,13,0) 70%)`,
              animation: 'venueFinalGlow 4.5s ease-in-out infinite',
            }}
          />
          {/* slow confetti — winner color + white + gold */}
          {Array.from({ length: 22 }, (_, i) => {
            const palette = [winColor, '#ffffff', '#fde047'];
            const c = palette[i % palette.length];
            const size = 12 + ((i * 7) % 14);
            const tall = i % 3 === 0;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${(i * 53) % 100}%`,
                  top: -60,
                  width: tall ? size : size + 6,
                  height: tall ? size + 10 : size,
                  background: c,
                  borderRadius: 2,
                  opacity: 0.9,
                  animation: `venueFinalConfetti ${(6 + (i % 5)).toFixed(0)}s ${(i * 0.31).toFixed(2)}s linear infinite`,
                }}
              />
            );
          })}
        </div>
      )}
      {/* header */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          height: 92,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 44px',
          background: '#05070d',
          borderBottom: '2px solid #1e2638',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 40, fontWeight: 800, letterSpacing: 1 }}>
          <span style={{ marginRight: 16, display: 'inline-flex', alignItems: 'center' }}>
            <SportMark sport={data.sport} fallbackEmoji={def.emoji} size={48} color="#cbd5e1" title={def.name} />
          </span>
          {def.name.toUpperCase()}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: STATUS_STYLE.FINAL.bg,
            padding: '12px 28px',
            borderRadius: 999,
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: 3,
          }}
        >
          FINAL
        </div>
      </div>

      {/* body — final scores */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* WINNER champion banner — top-centered, winner-tinted, with a
            twinkling star. Only shown when there's a winner (tie → omitted). */}
        {!tie && winName && (
          <div
            style={{
              position: 'absolute',
              top: 22,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '12px 34px',
              borderRadius: 999,
              background: `${hexA(winColor, 0.16)}`,
              border: `2px solid ${winColor}`,
              boxShadow: `0 0 42px ${hexA(winColor, 0.45)}`,
              maxWidth: 1200,
              animation: 'venueFinalWordmark 0.7s ease-out',
            }}
          >
            <span
              aria-hidden
              style={{
                fontSize: 40,
                lineHeight: 1,
                marginRight: 16,
                color: '#fde047',
                display: 'inline-block',
                animation: 'venueFinalStar 2.6s ease-in-out infinite',
                textShadow: '0 0 18px rgba(253,224,71,0.7)',
              }}
            >
              ★
            </span>
            <span
              style={{
                fontSize: 34,
                fontWeight: 900,
                letterSpacing: 6,
                color: winColor,
                marginRight: 18,
              }}
            >
              WINNER
            </span>
            <span
              style={{
                fontSize: 38,
                fontWeight: 900,
                letterSpacing: 1,
                color: '#fff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 760,
                textShadow: '0 3px 14px rgba(0,0,0,0.6)',
              }}
            >
              {winName.toUpperCase()}
            </span>
          </div>
        )}

        {/* left gradient — brighter when home wins */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: '45%',
            background: homeWins
              ? `linear-gradient(135deg, ${homeColor}2e, transparent 68%)`
              : `linear-gradient(135deg, ${homeColor}10, transparent 68%)`,
            borderTop: `${homeWins ? 7 : 3}px solid ${homeColor}`,
          }}
        />
        {/* right gradient — brighter when away wins */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '45%',
            background: awayWins
              ? `linear-gradient(225deg, ${awayColor}2e, transparent 68%)`
              : `linear-gradient(225deg, ${awayColor}10, transparent 68%)`,
            borderTop: `${awayWins ? 7 : 3}px solid ${awayColor}`,
          }}
        />

        <BigTeamBlock
          name={data.homeTeam}
          score={data.homeScore}
          scoreText={formatScore(def, data.homeScore)}
          logoUrl={data.homeLogoUrl}
          color={homeColor}
          showScore
          accent={homeWins}
        />

        {/* center divider — a bold FINAL wordmark (or TIE), then the dash */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: 180,
            flexShrink: 0,
          }}
        >
          {/* 2026-06-15 — only the "TIE" wordmark here. The old "FINAL" word
              was leftover clutter: the header pill already reads FINAL and the
              "★ WINNER <TEAM>" banner names the result, so a third "FINAL" in
              the center just crowded the winner banner. On a tie there's no
              banner, so "TIE" stays as the result label. */}
          {tie && (
            <div
              style={{
                fontSize: 34,
                fontWeight: 900,
                letterSpacing: 6,
                color: '#64748b',
                marginBottom: 14,
              }}
            >
              TIE
            </div>
          )}
          <div style={{ fontSize: 80, fontWeight: 900, color: '#334155', lineHeight: 1 }}>–</div>
        </div>

        <BigTeamBlock
          name={data.awayTeam}
          score={data.awayScore}
          scoreText={formatScore(def, data.awayScore)}
          logoUrl={data.awayLogoUrl}
          color={awayColor}
          showScore
          accent={awayWins}
        />
      </div>

      {/* footer */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          height: 80,
          background: '#05070d',
          borderTop: '2px solid #1e2638',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: 5,
          color: '#334155',
        }}
      >
        VENUEOS
      </div>
    </div>
  );
}

// ── celebration overlay ────────────────────────────────────────

/** A hex color (#rgb / #rrggbb) as an rgba() string at the given
 *  alpha. Falls back to broadcast gold if the input isn't clean hex,
 *  so a malformed team color can never break a celebration render. */
function hexA(color: string | null | undefined, alpha: number): string {
  let hex = String(color || '').trim();
  if (hex[0] === '#') hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== 6 || /[^0-9a-f]/i.test(hex)) return `rgba(251,191,36,${alpha})`;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Marquee scoring plays — touchdowns, home runs, the game-winner —
// earn a bigger celebration: a wider glow, an extra shockwave ring,
// more confetti. Everything else still gets the full broadcast look.
const BIG_CUE_RE =
  /touchdown|home.?run|grand.?slam|hat.?trick|\bpin\b|buzzer|walk.?off|game.?winner|champ/i;

/**
 * A broadcast-grade scoring celebration. A layered, phased animation:
 * ENTER (~0.6s — shockwave rings, energy glow, a diagonal light sweep,
 * an emoji pop + text-slam), HOLD (~2.8s — falling confetti + the
 * live-score lower-third), EXIT (~0.5s fade). Every layer animates
 * transform/opacity only — Chromium-83 (NovaStar Taurus) + WebKit safe.
 */
function CueOverlay({
  cue,
  sport,
  pack,
}: {
  cue: Cue;
  sport?: string | null;
  pack?: 'v1' | 'v2';
}) {
  // T2-4 — Pre-game starting-lineup choreography. Full-screen takeover
  // rendered by CelPregameIntroWidget; the board stays dark behind it.
  // The board's existing holdMs logic uses cue.durationMs (total runtime
  // = slotMs × playerCount, capped at 60s server-side).
  if (cue.key === 'pregame-intro') {
    const teamColor =
      cue.teamColor ||
      (cue.team === 'away' ? cue.snapshot?.awayColor : cue.snapshot?.homeColor) ||
      '#fbbf24';
    return (
      <div
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
          zIndex: 50, background: '#05070d',
          animation: 'venueCelebScrim 0.35s ease-out',
        }}
      >
        <CelPregameIntroWidget
          live
          config={{
            teamName: cue.teamName ?? (cue.team === 'away' ? cue.snapshot?.awayTeam : cue.snapshot?.homeTeam) ?? 'HOME',
            teamColor,
            lineup: cue.lineup ?? [],
            slotMs: cue.slotMs ?? 3500,
            skippable: cue.skippable !== false,
          }}
        />
      </div>
    );
  }

  // Custom cue — the operator's uploaded content (a sponsor graphic, a
  // promo, a hype card).
  if (cue.mediaUrl) {
    // TAKEOVER — full-screen opaque media (opt-in).
    if (cue.displayMode === 'takeover') {
      return (
        <div
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: cue.color || '#05070d', zIndex: 50,
            animation: 'venueCelebScrim 0.4s ease-out',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cue.mediaUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      );
    }
    // OVERLAY (default) — the board stays fully visible; the media drops
    // into a lower band (bottom ~34%) over a gradient scrim that fades
    // up, then slides away after the cue's duration. Operator: "the
    // custom cues should overlay, not take over the entire screen."
    return (
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: '34%',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            background: cue.color
              ? `linear-gradient(to top, ${cue.color} 12%, ${cue.color}cc 55%, transparent 100%)`
              : 'linear-gradient(to top, rgba(5,7,13,0.96) 12%, rgba(5,7,13,0.78) 55%, transparent 100%)',
            animation: 'venueCueBandUp 0.45s cubic-bezier(0.22,1,0.36,1)',
            padding: '0 3% 2.5%',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cue.mediaUrl} alt="" style={{ maxWidth: '94%', maxHeight: '88%', objectFit: 'contain' }} />
        </div>
      </div>
    );
  }

  // Cinematic sport celebration — a hand-tuned full-screen animation for this
  // sport + cue, branded to the scoring team's color. Falls through to the
  // generic text cue below when no animation is mapped for this combo.
  const teamColor =
    cue.color ||
    (cue.team === 'away' ? cue.snapshot?.awayColor : cue.snapshot?.homeColor) ||
    cue.snapshot?.homeColor ||
    null;
  const celebUrl = celebrationSrc(
    sport,
    cue.key,
    teamColor,
    pack || 'v1',
    'scoreboard',
    // Inject the frozen live score + operator-attributed scorer so the v2
    // cinematic shows the REAL game instead of the cue file's placeholders.
    celebrationLiveDataFromCue(cue),
  );
  if (celebUrl) {
    return (
      <div
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
          zIndex: 50, background: '#05070d',
          animation: 'venueCelebScrim 0.35s ease-out',
        }}
      >
        <iframe
          src={celebUrl}
          title="celebration"
          scrolling="no"
          // 2026-06-15 — allow the synthesized stadium air-horn / impact SFX
          // (celebration-sound.js) to play. Kiosks run Chromium with autoplay
          // enabled, so a fired cue is audible; without this the Permissions
          // Policy blocks the iframe's AudioContext output.
          allow="autoplay"
          // Lane-8 P1: sandbox the celebration iframe even though src is
          // always a same-origin static file under /celebrations/. `allow-scripts`
          // lets the canvas engine run; omitting `allow-same-origin` blocks
          // any cookie / localStorage / top-frame access from inside.
          sandbox="allow-scripts"
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
            width: '100%', height: '100%', border: 0, display: 'block',
            pointerEvents: 'none',
          }}
        />
      </div>
    );
  }

  const snap = cue.snapshot;
  const big = BIG_CUE_RE.test(cue.key || '') || BIG_CUE_RE.test(cue.label || '');
  // Energy color — the operator's cue color when set, else broadcast
  // gold. Confetti also mixes in both team colors so the moment is
  // venue-branded even with no cue color set.
  const energy = cue.color || '#fbbf24';
  const confetti = [
    energy,
    '#ffffff',
    snap?.homeColor || '#38bdf8',
    snap?.awayColor || '#f472b6',
    '#fde047',
  ];
  const rings = big ? 4 : 3;
  const confettiCount = big ? 26 : 16;
  const glow = big ? 1520 : 1200;
  const emojiSize = big ? 432 : 360;
  // glow + rings centre on the emoji stack (which centres in y 0–830)
  const cy = 415;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: 'hidden',
        zIndex: 50,
      }}
    >
      {/* dark scrim */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: 'rgba(5,7,13,0.85)',
          animation: 'venueCelebScrim 3.9s ease-in-out forwards',
        }}
      />
      {/* team-energy radial glow */}
      <div
        style={{
          position: 'absolute',
          left: 960 - glow / 2,
          top: cy - glow / 2,
          width: glow,
          height: glow,
          borderRadius: 999,
          background: `radial-gradient(circle, ${hexA(energy, 0.5)} 0%, ${hexA(
            energy,
            0.15,
          )} 42%, rgba(5,7,13,0) 66%)`,
          animation: 'venueCelebGlow 3.9s ease-in-out forwards',
        }}
      />
      {/* expanding shockwave rings */}
      {Array.from({ length: rings }, (_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: 960 - 220,
            top: cy - 220,
            width: 440,
            height: 440,
            borderRadius: 999,
            border: `9px solid ${hexA(energy, 0.85)}`,
            animation: `venueCelebRing 3.9s ${(i * 0.16).toFixed(
              2,
            )}s cubic-bezier(.15,.7,.3,1) forwards`,
          }}
        />
      ))}
      {/* diagonal light sweep — one fast pass on entrance */}
      <div
        style={{
          position: 'absolute',
          left: 770,
          top: -610,
          width: 380,
          height: 2300,
          background:
            'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0) 100%)',
          animation: 'venueCelebSweep 3.9s ease-out forwards',
        }}
      />
      {/* confetti */}
      {Array.from({ length: confettiCount }, (_, i) => {
        const tall = i % 3 === 0;
        const size = 13 + ((i * 11) % 17);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${(i * 61) % 100}%`,
              top: -70,
              width: size,
              height: tall ? size * 2.6 : size,
              background: confetti[i % confetti.length],
              borderRadius: tall ? 2 : 999,
              opacity: 0,
              animation: `${
                i % 2 ? 'venueCelebFallB' : 'venueCelebFallA'
              } ${(2.7 + (i % 5) * 0.28).toFixed(2)}s ${(
                0.08 +
                (i % 7) * 0.11
              ).toFixed(2)}s ease-in forwards`,
            }}
          />
        );
      })}
      {/* center stack — emoji + slammed label */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 250,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontSize: emojiSize,
            lineHeight: 1,
            filter: `drop-shadow(0 22px 50px ${hexA(energy, 0.7)})`,
            animation: 'venueCelebEmoji 3.9s cubic-bezier(.2,.9,.2,1) forwards',
          }}
        >
          {cue.emoji || '🎉'}
        </div>
        <div
          style={{
            fontSize: big ? 172 : 138,
            fontWeight: 900,
            letterSpacing: 6,
            color: '#fff',
            marginTop: 10,
            textAlign: 'center',
            textShadow: `0 12px 52px rgba(0,0,0,0.9), 0 0 64px ${hexA(energy, 0.55)}`,
            animation: 'venueCelebSlam 3.9s cubic-bezier(.2,.9,.2,1) forwards',
          }}
        >
          {(cue.label || cue.key || 'NICE!').toUpperCase()}
        </div>
      </div>

      {/* co-branded attribution — "BROUGHT TO YOU BY" + sponsor logo/name.
          Understated: small caps, dimmed, uses the energy accent colour.
          Animates in with the lower-third — transform/opacity only
          (Chromium-83 + WebKit safe). Rendered only when the cue carries
          a sponsorName so the visual is never affected on unsponsored cues. */}
      {cue.sponsorName && !cue.mediaUrl && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: snap ? 268 : 108,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            animation: 'venueCelebLowerText 3.9s ease-out forwards',
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: 5,
              color: hexA(energy, 0.7),
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            BROUGHT TO YOU BY
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {cue.sponsorLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cue.sponsorLogoUrl}
                alt=""
                style={{
                  height: 52,
                  width: 'auto',
                  maxWidth: 220,
                  objectFit: 'contain',
                  marginRight: 16,
                  filter: 'brightness(0.9)',
                }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div
              style={{
                fontSize: 36,
                fontWeight: 900,
                letterSpacing: 2,
                color: '#cbd5e1',
              }}
            >
              {cue.sponsorName}
            </div>
          </div>
        </div>
      )}

      {/* live-score lower-third — the EXACT score + clock frozen at
          cue-fire time. A mask-wipe bar reveals it. */}
      {snap && (
        <div
          style={{
            position: 'absolute',
            left: 960 - 600,
            bottom: 92,
            width: 1200,
            height: 156,
          }}
        >
          {/* the bar wipes in — scaleX from center */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              background:
                'linear-gradient(180deg, rgba(15,20,33,0.97), rgba(8,11,19,0.97))',
              borderRadius: 20,
              border: `2px solid ${hexA(energy, 0.5)}`,
              boxShadow: '0 26px 72px rgba(0,0,0,0.65)',
              animation: 'venueCelebLower 3.9s cubic-bezier(.2,.9,.2,1) forwards',
            }}
          />
          {/* score content fades + rises in after the wipe */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'venueCelebLowerText 3.9s ease-out forwards',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                fontSize: 84,
                fontWeight: 900,
                color: '#fff',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span style={{ color: snap.homeColor || '#fff', letterSpacing: 2 }}>
                {teamCode(snap.homeTeam)}
              </span>
              <span style={{ margin: '0 20px' }}>
                {formatScore(findSport(sport), snap.homeScore)}
              </span>
              <span style={{ color: '#475569', fontSize: 52 }}>–</span>
              <span style={{ margin: '0 20px' }}>
                {formatScore(findSport(sport), snap.awayScore)}
              </span>
              <span style={{ color: snap.awayColor || '#fff', letterSpacing: 2 }}>
                {teamCode(snap.awayTeam)}
              </span>
            </div>
            {(snap.segmentLabel || snap.clockText) && (
              <div
                style={{
                  marginLeft: 28,
                  paddingLeft: 28,
                  borderLeft: '2px solid #1e2638',
                  fontSize: 42,
                  fontWeight: 800,
                  letterSpacing: 4,
                  color: energy,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {[snap.segmentLabel, snap.clockText].filter(Boolean).join('  ·  ')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Portrait / tall-canvas board (multi-poster LED, e.g. 3×320 = 960×1080) ──
// When the render canvas is TALLER than it is wide (a single portrait poster or
// a column of joined posters), the 16:9 BoardScene can only letterbox into a
// strip. This renders the SAME live data re-flowed into three full-height
// columns — Home · Clock/Shot · Away — one per physical poster. The page
// auto-selects it whenever the viewport is portrait; no custom template needed.
// Chromium-83 / NovaStar-Taurus safe: NO `inset` shorthand, NO flex `gap`
// (margins only), NO backdrop-filter.
export function PortraitBoardScene({ data, def }: { data: BoardData; def: SportDefinition }) {
  // Game clock — projected from the stored anchor (same math as BoardScene).
  const [clockMs, setClockMs] = useState(data.clockMs);
  useEffect(() => {
    const skew = data.serverTime - Date.now();
    const anchorAt = new Date(data.clockUpdatedAt).getTime();
    const project = () => {
      if (!data.clockRunning || def.clock.type === 'none') { setClockMs(data.clockMs); return; }
      const elapsed = Date.now() + skew - anchorAt;
      if (def.clock.type === 'countup') setClockMs(data.clockMs + elapsed);
      else setClockMs(Math.max(0, data.clockMs - elapsed));
    };
    project();
    if (!data.clockRunning || def.clock.type === 'none') return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
  }, [data.clockMs, data.clockRunning, data.clockUpdatedAt, data.serverTime, def]);

  // Shot clock — projected from stats.shotClock (same math as BoardScene).
  const [shotMs, setShotMs] = useState(0);
  const scRaw = (data.stats as Record<string, unknown> | undefined)?.shotClock;
  const sc = scRaw && typeof scRaw === 'object' ? (scRaw as Record<string, unknown>) : null;
  const scLen = Number(sc?.len) || 0;
  const shotLen = sc ? (scLen > 0 ? scLen : Number((def as any).shotClock?.full) || 0) : 0;
  const shotAnchorMs = Math.max(0, Number(sc?.ms) || 0);
  const shotAnchorAt = String(sc?.at || '');
  const shotRunning = !!sc?.running;
  useEffect(() => {
    if (shotLen <= 0) { setShotMs(0); return; }
    const skew = data.serverTime - Date.now();
    const at = new Date(shotAnchorAt).getTime();
    const project = () => {
      if (!shotRunning || !Number.isFinite(at)) { setShotMs(shotAnchorMs); return; }
      setShotMs(Math.max(0, shotAnchorMs - (Date.now() + skew - at)));
    };
    project();
    if (!shotRunning) return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
  }, [shotAnchorMs, shotAnchorAt, shotRunning, shotLen, data.serverTime]);

  const stats = (data.stats || {}) as Record<string, unknown>;
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  const hasClock = def.clock.type !== 'none';
  const showShot = shotLen > 0;
  const st = STATUS_STYLE[data.status] || STATUS_STYLE.SCHEDULED;
  const sportTitle = String(data.sport || '').replace(/[_-]+/g, ' ').toUpperCase();
  const num = (k: string): number => { const v = Number(stats[k]); return Number.isFinite(v) ? v : 0; };

  // Per-team stat rows — only the keys this sport actually tracks (home/away
  // split, defensive: rendered only when the key is present on the game).
  const rowsFor = (side: 'home' | 'away'): { label: string; value: number }[] => {
    const out: { label: string; value: number }[] = [];
    if (`${side}Shots` in stats) out.push({ label: 'SHOTS', value: num(`${side}Shots`) });
    if (`${side}Exclusions` in stats) out.push({ label: 'EXCL', value: num(`${side}Exclusions`) });
    if (`${side}Fouls` in stats) out.push({ label: 'FOULS', value: num(`${side}Fouls`) });
    if (`${side}Timeouts` in stats) out.push({ label: 'T.O.', value: num(`${side}Timeouts`) });
    return out;
  };

  const teamCol = (side: 'home' | 'away') => {
    const name = side === 'home' ? data.homeTeam : data.awayTeam;
    const score = side === 'home' ? data.homeScore : data.awayScore;
    const color = side === 'home' ? homeColor : awayColor;
    const logo = side === 'home' ? data.homeLogoUrl : data.awayLogoUrl;
    const r = rowsFor(side);
    return (
      <div style={{ width: 320, height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', paddingTop: 44, paddingBottom: 44, boxSizing: 'border-box', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 380, background: `linear-gradient(180deg, ${color}40, transparent)`, pointerEvents: 'none' }} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" style={{ width: 130, height: 130, objectFit: 'contain', marginBottom: 16 }} />
          ) : (
            <div style={{ width: 130, height: 130, borderRadius: '50%', background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 68, fontWeight: 800, marginBottom: 16 }}>
              {(name || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div style={{ color: '#fff', fontSize: 34, fontWeight: 800, textAlign: 'center', lineHeight: 1.02, maxWidth: 296, letterSpacing: -0.5 }}>{name || (side === 'home' ? 'HOME' : 'AWAY')}</div>
          <div style={{ color, fontSize: 18, fontWeight: 800, letterSpacing: 4, marginTop: 12 }}>{side === 'home' ? 'HOME' : 'AWAY'}</div>
        </div>
        <div style={{ position: 'relative', color: '#fff', fontSize: 150, fontWeight: 800, lineHeight: 0.85, fontVariantNumeric: 'tabular-nums' }}>{formatScore(def, score)}</div>
        <div style={{ position: 'relative', width: '100%', paddingLeft: 30, paddingRight: 30, boxSizing: 'border-box' }}>
          {r.map((row) => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 12, paddingBottom: 12 }}>
              <span style={{ color: '#94a3b8', fontSize: 22, fontWeight: 700, letterSpacing: 1 }}>{row.label}</span>
              <span style={{ color: '#fff', fontSize: 30, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const shotSecs = Math.ceil(Math.max(0, shotMs) / 1000);

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: 960, height: 1080, background: '#05070d', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ height: 80, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
        <span style={{ color: '#cbd5e1', fontSize: 26, fontWeight: 800, letterSpacing: 6 }}>{sportTitle}</span>
        <span style={{ position: 'absolute', right: 22, top: 22, display: 'inline-flex', alignItems: 'center', background: st.bg, color: '#fff', fontSize: 18, fontWeight: 800, letterSpacing: 2, paddingTop: 6, paddingBottom: 6, paddingLeft: 14, paddingRight: 14, borderRadius: 999 }}>
          {st.pulse && <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#fff', marginRight: 8, animation: 'venuePulse 1.4s ease-in-out infinite' }} />}
          {st.label}
        </span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
        {teamCol('home')}
        <div style={{ width: 320, height: '100%', borderLeft: '1px solid rgba(255,255,255,0.10)', borderRight: '1px solid rgba(255,255,255,0.10)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', paddingLeft: 8, paddingRight: 8 }}>
          <div style={{ color: '#94a3b8', fontSize: 30, fontWeight: 800, letterSpacing: 4, marginBottom: 30 }}>{segmentLabel(def, data)}</div>
          {hasClock && <div style={{ color: '#fff', fontSize: 92, fontWeight: 800, lineHeight: 0.9, fontVariantNumeric: 'tabular-nums', marginBottom: showShot ? 40 : 0 }}>{fmtClock(clockMs)}</div>}
          {showShot && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ color: '#f59e0b', fontSize: 66, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{shotSecs}</div>
              <div style={{ color: '#b45309', fontSize: 20, fontWeight: 800, letterSpacing: 3, marginTop: 6 }}>SHOT</div>
            </div>
          )}
        </div>
        {teamCol('away')}
      </div>
    </div>
  );
}

// ── page ───────────────────────────────────────────────────────

export default function ScoreboardPage() {
  const params = useParams();
  const gameId = String(params?.gameId || '');

  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vp, setVp] = useState({ w: 1920, h: 1080 });

  // cue playback
  const [activeCue, setActiveCue] = useState<Cue | null>(null);
  const seenCues = useRef<Set<string>>(new Set());
  const cueQueue = useRef<Cue[]>([]);
  const firstLoad = useRef(true);
  const playing = useRef(false);
  // 2026-06-05 (v2) — coalesce duplicate celebration cues from ONE scoring
  // moment. A single goal can emit TWO CUE events: the auto-celebrate (which
  // ALWAYS carries `team`) and a manual player-attributed fire (whose `team`
  // is usually null — the operator fired it from the cue/player picker). The
  // v1 sig `key|team` therefore never matched (`goal|home` vs `goal|`), so
  // both still played. Fix: match on the cue KEY with a team-WILDCARD (an
  // empty team matches any) inside a window wide enough to cover the human
  // delay of picking the scorer. A genuine home-THEN-away of the same key
  // (both teams set AND different) still plays twice.
  const lastCueSig = useRef<{ key: string; team: string; t: number }>({ key: '', team: '', t: 0 });
  const cueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Audio ref for celebration sounds — holds the current Audio object
  // so we can pause + release it when the cue ends or on unmount.
  const cueAudio = useRef<HTMLAudioElement | null>(null);

  const stopCueAudio = () => {
    if (cueAudio.current) {
      cueAudio.current.pause();
      cueAudio.current = null;
    }
  };

  const pumpCues = () => {
    if (playing.current) return;
    const next = cueQueue.current.shift();
    if (!next) return;
    playing.current = true;
    setActiveCue(next);
    // Start audio best-effort — never let a failure interrupt playback.
    if (next.audioUrl && !next.mediaUrl) {
      stopCueAudio();
      try {
        const a = new Audio(next.audioUrl);
        cueAudio.current = a;
        a.play().catch(() => {});
      } catch (_) {
        // Audio API unavailable — silent fallback.
      }
    }
    // A custom cue holds for its own duration; a cinematic celebration runs
    // ~4.3s, so hold it 4.8s; a plain text cue holds 3.9s.
    // A custom-media cue holds for its own duration; every other cue is a
    // cinematic celebration → hold the full ~4.8s. (Was gated on
    // celebrationSrc(data?.sport,…) but `data` here is the stale closure value
    // from the polling effect — always null — so EVERY celebration was being
    // cut to 3.9s and unmounted before its payoff. 2026-06-15.)
    const holdMs =
      next.mediaUrl && next.durationMs && next.durationMs > 0 ? next.durationMs : 4800;
    cueTimer.current = setTimeout(() => {
      stopCueAudio();
      setActiveCue(null);
      playing.current = false;
      pumpCues();
    }, holdMs);
  };

  // Cancel a pending cue timer + audio on unmount (kiosk route reloads).
  useEffect(() => () => {
    if (cueTimer.current) clearTimeout(cueTimer.current);
    stopCueAudio();
  }, []);

  // viewport measure → transform:scale fit
  useEffect(() => {
    const measure = () =>
      setVp({ w: window.innerWidth || 1920, h: window.innerHeight || 1080 });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Poll health → staleness chip. onStatus fires every ~750ms; the chip
  // decision changes rarely, so the health sample lands in a ref and a 1s
  // ticker below derives the boolean (re-rendering only when it flips).
  const pollHealth = useRef({ lastGoodAt: Date.now() });
  const [feedStale, setFeedStale] = useState(false);
  useEffect(() => {
    const evalStale = () =>
      setFeedStale(
        navigator.onLine === false ||
          Date.now() - pollHealth.current.lastGoodAt > STALE_FEED_AFTER_MS,
      );
    const t = setInterval(evalStale, 1000);
    return () => clearInterval(t);
  }, []);

  // poll the public board endpoint — through the shared hardened engine
  // (self-chaining so slow responses never overlap, If-None-Match/304
  // revalidation when the API offers an ETag, jittered 1.5/3/5s backoff
  // while it's unreachable; see lib/board-poll.ts). Cue-dedup semantics
  // below are unchanged from the old inline load().
  useEffect(() => {
    if (!gameId) return;
    // Cold-boot: paint the last cached frame instantly (clock frozen)
    // so a power-cycle mid-game never shows a blank or error board.
    const cached = readBoardCache<BoardData>(gameId);
    if (cached) { setData(cached); setError(null); }
    return startBoardPoll({
      url: `${API_URL}/sports/board/${gameId}`,
      intervalMs: POLL_MS,
      onPayload: (payload) => {
        const json = payload as BoardData;
        setData(json);
        setError(null);
        writeBoardCache(gameId, json);

        for (const c of json.cues || []) {
          if (seenCues.current.has(c.id)) continue;
          seenCues.current.add(c.id);
          // The very first poll's cues already happened before the
          // board opened — record them as seen but don't replay.
          // Skip cues targeted only at the ribbon.
          if (firstLoad.current || !cuePlaysHere(c.target)) continue;
          // Drop the auto+manual duplicate of one scoring moment (see the
          // lastCueSig comment above): same KEY, team-wildcard, 6s window.
          const ck = String(c.key || '');
          const ctm = String(c.team || '');
          const nowMs = Date.now();
          const lc = lastCueSig.current;
          const isDup =
            ck !== '' &&
            lc.key === ck &&
            (!lc.team || !ctm || lc.team === ctm) &&
            nowMs - lc.t < 6000;
          if (isDup) continue;
          lastCueSig.current = { key: ck, team: ctm, t: nowMs };
          cueQueue.current.push(c);
        }
        firstLoad.current = false;
        pumpCues();
      },
      // 304 — content unchanged; refresh only the skew anchor so the
      // projected clock stays honest without touching cue-dedup state.
      onServerTime: (n) =>
        setData((prev) => (prev ? { ...prev, serverTime: n } : prev)),
      onStatus: (s) => {
        pollHealth.current = { lastGoodAt: s.lastGoodAt };
        // Error surface (renders only while data is null — cold boot on a
        // bad gameId). Same messages the old inline load() produced.
        if (s.lastError) setError(s.lastHttpStatus === 404 ? 'Game not found' : s.lastError);
        else setError(null);
        // The chip must clear the INSTANT a good poll lands; the 1s
        // ticker above only handles the (slow) appear side.
        if (s.online && navigator.onLine !== false) setFeedStale(false);
      },
    });
  }, [gameId]);

  // 2026-06-15 — DOUBLE-FIRE FIX. This board route is the single celebration
  // authority for the scoreboard: <CueOverlay> plays every fired cue. A custom
  // scoreboard template can ALSO embed a CtsCelebration / CtsCelebration
  // Orchestrator widget that independently auto-fires the SAME cue feed on a
  // score delta — with no dedup between the two engines, every goal animated
  // TWICE. This flag tells those embedded widgets to stand down while they're
  // on the live board (operator test/preview, which never sets it, still
  // animates). The ribbon route sets the same flag for its own surface.
  useEffect(() => {
    const w = window as Window & { __VENUEOS_SURFACE_HANDLES_CUES?: boolean };
    w.__VENUEOS_SURFACE_HANDLES_CUES = true;
    return () => { w.__VENUEOS_SURFACE_HANDLES_CUES = false; };
  }, []);

  const def = useMemo(() => (data ? findSport(data.sport) : undefined), [data]);
  const scale = Math.min(vp.w / 1920, vp.h / 1080);

  // Sprint 13 — CTS source-of-truth merge. When a CTS console is
  // broadcasting (Game.stats.cts.lastUpdateAt fresh within 5 s of
  // serverTime) the bridge's score/clock/segment win over the operator-
  // input columns. Stale or absent → operator inputs win. Single helper
  // in apps/web/src/lib/cts-merge.ts shared with the ribbon route so
  // both surfaces render identical numbers.
  const displayData = useMemo(
    () => (data ? applyCtsOverlay(data) : data),
    [data],
  );

  const keyframes = (
    <style>{`
      ${SCORE_MOTION_KEYFRAMES}
      @keyframes venuePulse { 0%,100%{opacity:1} 50%{opacity:0.55} }
      @keyframes venueFooterFade { 0%{opacity:0} 100%{opacity:1} }
      @keyframes venueCelebScrim { 0%{opacity:0} 7%{opacity:1} 90%{opacity:1} 100%{opacity:0} }
      @keyframes venueCueBandUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      @keyframes venueCelebGlow {
        0%{opacity:0;transform:scale(0.35)}
        16%{opacity:1;transform:scale(1)}
        86%{opacity:0.92;transform:scale(1.05)}
        100%{opacity:0;transform:scale(1.12)}
      }
      @keyframes venueCelebRing {
        0%{opacity:0;transform:scale(0.2)}
        7%{opacity:0.9}
        46%{opacity:0}
        100%{opacity:0;transform:scale(3.7)}
      }
      @keyframes venueCelebSweep {
        0%{opacity:0;transform:translateX(-1500px) rotate(18deg)}
        4%{opacity:0.9}
        20%{opacity:0.9}
        30%{opacity:0;transform:translateX(1500px) rotate(18deg)}
        100%{opacity:0;transform:translateX(1500px) rotate(18deg)}
      }
      @keyframes venueCelebEmoji {
        0%{opacity:0;transform:scale(0)}
        7%{opacity:1;transform:scale(1.3)}
        13%{transform:scale(0.9)}
        18%{transform:scale(1.08)}
        23%{transform:scale(1)}
        90%{opacity:1;transform:scale(1)}
        100%{opacity:0;transform:scale(1.16)}
      }
      @keyframes venueCelebSlam {
        0%{opacity:0;transform:scale(1.75)}
        9%{opacity:1;transform:scale(0.9)}
        15%{transform:scale(1.07)}
        21%{transform:scale(1)}
        90%{opacity:1;transform:scale(1)}
        100%{opacity:0;transform:scale(1.05)}
      }
      @keyframes venueCelebLower {
        0%{opacity:0;transform:scaleX(0)}
        11%{opacity:1}
        22%{opacity:1;transform:scaleX(1)}
        89%{opacity:1;transform:scaleX(1)}
        100%{opacity:0;transform:scaleX(1)}
      }
      @keyframes venueCelebLowerText {
        0%{opacity:0;transform:translateY(16px)}
        20%{opacity:0;transform:translateY(16px)}
        30%{opacity:1;transform:translateY(0)}
        89%{opacity:1;transform:translateY(0)}
        100%{opacity:0;transform:translateY(0)}
      }
      @keyframes venueCelebFallA {
        0%{opacity:0;transform:translate(0,0) rotate(0deg)}
        6%{opacity:1}
        84%{opacity:1}
        100%{opacity:0;transform:translate(-90px,1200px) rotate(560deg)}
      }
      @keyframes venueCelebFallB {
        0%{opacity:0;transform:translate(0,0) rotate(0deg)}
        6%{opacity:1}
        84%{opacity:1}
        100%{opacity:0;transform:translate(95px,1230px) rotate(-640deg)}
      }
      /* FINAL winner cinematic — steady-state (the FINAL scene is not a
         3.9s burst). A slow champion-glow breath behind the winner, a
         gentle star twinkle, and slow continuous confetti. transform/opacity
         only → Chromium-83 (Taurus) + WebKit safe. */
      @keyframes venueFinalGlow {
        0%,100%{opacity:0.55;transform:scale(1)}
        50%{opacity:0.95;transform:scale(1.06)}
      }
      @keyframes venueFinalStar {
        0%,100%{opacity:0.85;transform:scale(1) rotate(0deg)}
        50%{opacity:1;transform:scale(1.18) rotate(8deg)}
      }
      @keyframes venueFinalWordmark {
        0%{opacity:0;transform:translateY(14px) scale(0.96)}
        100%{opacity:1;transform:translateY(0) scale(1)}
      }
      @keyframes venueFinalConfetti {
        0%{opacity:0;transform:translateY(-60px) rotate(0deg)}
        8%{opacity:0.9}
        92%{opacity:0.9}
        100%{opacity:0;transform:translateY(1180px) rotate(420deg)}
      }
    `}</style>
  );

  if (error && !data) {
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#64748b',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 28,
          fontWeight: 700,
        }}
      >
        {error}
      </div>
    );
  }

  if (!data || !def) {
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#334155',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: 3,
        }}
      >
        {keyframes}
        {data && !def ? `UNKNOWN SPORT: ${data.sport}` : 'LOADING SCOREBOARD…'}
      </div>
    );
  }

  // Sprint 13 — operator picked a custom scoreboard template for this
  // game. Hand off to CustomScoreboardScene; it fetches the template,
  // wraps the render in <GameStateProvider> so the embedded sport
  // primitives (SCORE_HOME / GAME_CLOCK / etc.) read live game state,
  // and scales the template's NATIVE canvas (e.g. 960×1080 narrow LED)
  // to fit the viewport. NULL → legacy hardcoded scenes below render
  // unchanged (zero regression).
  // T3-3 Show Control — a recalled GAMEDAY scene takes over the board until it
  // expires server-side (getBoard returns scene=null once past expiresAt), then
  // the board auto-reverts to the live scoreboard on the next 750ms poll. This
  // branch sits ABOVE the persistent-scoreboardTemplateId branch so a recalled
  // scene wins while it's on-air; when scene is null (every game until the
  // operator recalls one) this is skipped and the board renders exactly as
  // before. Same wrapper + CueOverlay as the scoreboardTemplateId path so a
  // fired celebration still plays over the scene.
  if (data.scene?.template && data.scene.templateId) {
    return (
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
        {keyframes}
        <CustomScoreboardScene
          templateId={data.scene.templateId}
          gameId={gameId}
          initial={displayData ?? data}
          embedded={data.scene.template as any}
        />
        {activeCue && (
          <CueOverlay
            cue={activeCue}
            sport={data?.sport}
            pack={
              ((data?.stats as Record<string, unknown> | undefined)?.celebrationPack === 'v2'
                || data?.sport === 'basketball'
                || data?.sport === 'water_polo' || data?.sport === 'water-polo'
                ? 'v2'
                : 'v1') as 'v1' | 'v2'
            }
          />
        )}
        {feedStale && <ConnectionLostPill pulseName="venuePulse" />}
      </div>
    );
  }

  if (data.scoreboardTemplateId) {
    // BoardData is structurally a superset of GameSnapshot (id, sport,
    // status, segment, homeTeam, awayTeam, homeScore, awayScore,
    // homeColor, awayColor, homeLogoUrl, awayLogoUrl, clockMs,
    // clockRunning, clockUpdatedAt, stats, serverTime — all present
    // on both). The cast is just to satisfy the narrower context
    // type; runtime values match exactly.
    //
    // 2026-05-27 — CTS overlay applied here too so a custom scoreboard
    // template reads the same merged data as the legacy hardcoded
    // scenes. The GameStateProvider inside CustomScoreboardScene
    // re-polls /sports/board/:id directly for its OWN live updates, so
    // the initial snapshot it receives is the CTS-overlaid view; its
    // ongoing polls also flow through this page's `data` (it's the
    // same endpoint) and we trust the helper to be idempotent.
    return (
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
        {keyframes}
        <CustomScoreboardScene
          templateId={data.scoreboardTemplateId}
          gameId={gameId}
          initial={displayData ?? data}
          embedded={(data as { scoreboardTemplate?: any }).scoreboardTemplate ?? null}
        />
        {/* 2026-06-05 — celebration cues MUST play on a CUSTOM scoreboard
            template too. Previously <CueOverlay> was only mounted in the
            legacy scene path below, so a board using a custom template
            played NOTHING on a fired cue (BOARD/ALL targets) — only the
            ribbon reacted. Same overlay + pack resolution as the legacy
            path; it renders position:absolute over the custom scene. */}
        {activeCue && (
          <CueOverlay
            cue={activeCue}
            sport={data?.sport}
            pack={
              // 2026-06-15 — default to the BOLD v1 deck/marquee art. The v2
              // water-polo cinematic is a slow, dark build (ball drifts in over
              // ~4s; the "GOAL!" payoff lands after the board's hold window) so
              // the crowd saw dark water and called it "not firing." v1 slams a
              // bright "GOAL!/SLAM!" + live scoreline + burst immediately, and
              // now carries live data + team color + the air-horn. v2 is still
              // available as an explicit opt-in (celebrationPack === 'v2').
              // 2026-06-16 — basketball defaults to v2: its new cinematic
              // (ball through the hoop, cues-basketball.js) is bright + fast,
              // not the slow dark water-polo build that made v1 the default.
              // Other sports keep v1 unless the operator opts into v2.
              ((data?.stats as Record<string, unknown> | undefined)?.celebrationPack === 'v2'
                || data?.sport === 'basketball'
                || data?.sport === 'water_polo' || data?.sport === 'water-polo'
                ? 'v2'
                : 'v1') as 'v1' | 'v2'
            }
          />
        )}
        {feedStale && <ConnectionLostPill pulseName="venuePulse" />}
      </div>
    );
  }

  return (
    <>
      <DefaultBoardScene
        data={data}
        def={def}
        displayData={displayData}
        vp={vp}
        activeCue={activeCue}
        keyframes={keyframes}
      />
      {/* venuePulse is defined inside the scene's shared keyframes block —
          @keyframes are document-global, so the sibling pill can use it. */}
      {feedStale && <ConnectionLostPill pulseName="venuePulse" />}
    </>
  );
}

/**
 * DefaultBoardScene — the DEFAULT (non-custom-template) board render:
 * portrait detection → swim/dive/track lane-grid default (#267/#270a) →
 * status-driven BoardScene/LeaderboardScene/PreGame/Halftime/Final →
 * celebration overlay.
 *
 * Extracted 2026-07-01 (#269 sports parity gate) so the parity test suite
 * can render EXACTLY what production selects, instead of re-implementing
 * (and risking drift from) the selection logic. `ScoreboardPage` above is
 * now a thin wrapper — the CTS-merge / scene-selection / lane-grid-default
 * logic below is UNCHANGED from before the extraction (verified via the
 * pre-existing 27 swim-dive-widgets tests + a tsc-clean diff), so this is
 * a pure refactor, not a behavior change.
 */
export function DefaultBoardScene({
  data,
  def,
  displayData,
  vp,
  activeCue,
  keyframes,
}: {
  data: BoardData;
  def: SportDefinition;
  /** CTS-merged view of `data` (or `data` itself when no overlay applies). */
  displayData: BoardData | null;
  vp: { w: number; h: number };
  activeCue: Cue | null;
  /** The page's shared <style> keyframes block — rendered once per scene. */
  keyframes: ReactNode;
}) {
  // Sprint 13 — render the CTS-merged view (CTS data when fresh,
  // operator inputs when stale). Cue feed still reads from `data.cues`
  // (the helper doesn't touch that field) so celebrations fire unchanged.
  const view = displayData ?? data;

  // Select the scene component. LIVE always renders BoardScene (zero
  // regression on the working scoreboard). All other statuses get a
  // dedicated presentation scene.
  const status = view.status;
  const isLive = status === 'LIVE';
  const isPreGame = status === 'PRE_GAME' || status === 'SCHEDULED';
  const isHalftime = status === 'HALFTIME';
  const isFinal = status === 'FINAL';
  // Meet sports (track / swim / XC / golf / gymnastics / cheer) are NOT
  // head-to-head clock games — gated on the config's own `mode`, never a
  // hardcoded key list — so the LIVE (and any unexpected status) render
  // uses the dedicated LeaderboardScene instead of the head-to-head clock
  // shell that dropped a giant emoji where the clock would sit.
  const isLeaderboard = def.mode === 'LEADERBOARD';
  // #267 — Swimming/Diving get their DEDICATED default board (the lane grid /
  // dive leaderboard), not the generic meet tally. Covers the legacy combined
  // `swimming_diving` key too so pre-split games benefit. Rendered across every
  // status (pre-game = empty pool shell, live = filled lanes/places).
  const swimDiveDefault =
    def.key === 'swimming' || def.key === 'diving' || def.key === 'swimming_diving';
  // #270a — the swim research (Part C) says the lane grid generalizes to
  // track & field running events "for free" (lane × athlete/time/place).
  // Same widget, sport-agnostic athleteLabel/iconEmoji config (see
  // SwimDiveWidgets.tsx) so this is a config swap, not a new component.
  const trackDefault = def.key === 'track_and_field';
  const laneGridDefault = swimDiveDefault || trackDefault;

  // Tall-canvas (portrait) detection. When the render viewport is taller than
  // it is wide — a portrait LED poster or a column of joined posters like the
  // operator's 3×320 = 960×1080 wall — the 16:9 landscape scenes can only
  // letterbox into a strip. Render the dedicated PortraitBoardScene at a
  // 960×1080 base instead so the DEFAULT board FILLS the canvas — no custom
  // template required.
  // P1-10 (2026-07-02) — the `!isLeaderboard` carve-out left every meet
  // sport force-landscape on a real portrait wall: golf/gym/cheer/XC via
  // PortraitBoardScene (already sport-agnostic on homeScore/awayScore, so
  // there's no reason to exclude them), and swim/dive/track's OWN lane grid
  // (which always scaled a 1920×1080 base — on a 960×1080 wall that's
  // Math.min(960/1920, 1080/1080)=0.5, a ~540px half-dark strip at half
  // text size). Dropped the carve-out; laneGrid sports get their own
  // portrait-shaped lane grid below (not PortraitBoardScene, which is a
  // 2-column box score with no room for lane rows).
  const portrait = vp.w < vp.h;
  const baseW = portrait ? 960 : 1920;
  const fitScale = Math.min(vp.w / baseW, vp.h / 1080);
  // P1-9/P1-10 combined — laneGrid sports render their OWN grid (portrait or
  // landscape, via the `portrait` config flag below) at LIVE/HALFTIME and any
  // unexpected status; PRE_GAME/FINAL always go through the shared
  // PreGameScene/FinalScene/PortraitBoardScene status scenes (landscape or
  // portrait respectively) so a meet gets the same pre-game/winner moment a
  // head-to-head game gets, instead of showing the lane grid forever.
  // Diving's FINAL "winner moment" IS its standings leaderboard (winner
  // ranked #1), NOT the shared two-number FinalScene (2026-07-12 world-class
  // audit P1): the judge pad writes per-diver `results` but never a dual-meet
  // homeScore/awayScore, so FinalScene would crown nobody with a 0.00-0.00
  // team score AND hide the diver standings exactly when the crowd wants to
  // see who won. Swimming/track keep FinalScene — their dual-meet team points
  // ride homeScore/awayScore, so their FINAL two-number moment is real.
  const laneGridShowsGrid =
    laneGridDefault && !isPreGame && (!isFinal || def.key === 'diving');

  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
      {keyframes}
      <div
        style={{
          position: 'absolute',
          width: baseW,
          height: 1080,
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) scale(${fitScale})`,
          transformOrigin: 'center center',
        }}
      >
        {laneGridShowsGrid ? (
          // #267 — the swim/dive DEFAULT scoreboard IS the lane grid / dive
          // leaderboard (no template selection needed) at LIVE/HALFTIME (and
          // any unexpected status). #270a — track & field reuses the SAME
          // lane grid widget with running-event copy (🏃 / ATHLETE·TEAM) via
          // config, not a new component. GameStateProvider re-polls
          // /sports/board/:id so the grid shows live lanes/heats/places;
          // seeded from `view` to avoid a boot flash.
          // P1-10 (2026-07-02) — `portrait` picks the grid's own
          // portrait-shaped base (see SwimLaneGridWidget/DiveLeaderboardWidget
          // `portrait` config) instead of letterboxing a 1920-wide scene onto
          // a 960×1080 wall (was Math.min(960/1920,1080/1080)=0.5×).
          <GameStateProvider gameId={view.id} initial={view as unknown as GameSnapshot}>
            {def.key === 'diving' ? (
              <DiveLeaderboardWidget
                config={{ homeColor: view.homeColor ?? undefined, awayColor: view.awayColor ?? undefined, portrait }}
              />
            ) : (
              <SwimLaneGridWidget
                config={{
                  homeColor: view.homeColor ?? undefined,
                  awayColor: view.awayColor ?? undefined,
                  portrait,
                  ...(trackDefault
                    ? { athleteLabel: 'ATHLETE / TEAM', iconEmoji: '🏃' }
                    : null),
                }}
              />
            )}
          </GameStateProvider>
        ) : portrait ? (
          // The portrait board is status-aware (shows the status chip + live
          // score/clock), so it replaces the entire landscape scene block.
          // P1-10 — also covers laneGrid sports at PRE_GAME/FINAL in
          // portrait (laneGridShowsGrid is false there): PortraitBoardScene
          // is already sport-agnostic on data.homeScore/awayScore (the
          // dual-meet team points every meet sport carries), so it doubles
          // as the meet's pre-game/final moment without a bespoke portrait
          // scene for the lane grid.
          <PortraitBoardScene data={view} def={def} />
        ) : laneGridDefault ? (
          // P1-9 (2026-07-02) — landscape PRE_GAME/FINAL for laneGrid sports
          // (LIVE/HALFTIME already returned via laneGridShowsGrid above).
          // Same dedicated status scenes head-to-head sports use below —
          // dual-meet team points already live on data.homeScore/awayScore,
          // no new data needed — so a meet doesn't end on "last heat
          // forever, no winner moment."
          isPreGame ? (
            <PreGameScene data={view} def={def} />
          ) : (
            <FinalScene data={view} def={def} />
          )
        ) : (
          <>
            {isLive &&
              (isLeaderboard ? (
                <LeaderboardScene data={view} def={def} />
              ) : (
                <BoardScene data={view} def={def} />
              ))}
            {isPreGame && <PreGameScene data={view} def={def} />}
            {isHalftime && <HalftimeScene data={view} def={def} />}
            {isFinal && <FinalScene data={view} def={def} />}
            {/* Fallback for any unexpected status — use the live board (the
                meet board for LEADERBOARD sports). */}
            {!isLive && !isPreGame && !isHalftime && !isFinal &&
              (isLeaderboard ? (
                <LeaderboardScene data={view} def={def} />
              ) : (
                <BoardScene data={view} def={def} />
              ))}
          </>
        )}
        {activeCue && (
          <CueOverlay
            cue={activeCue}
            sport={data?.sport}
            // 2026-05-27 — operator-selected celebration pack (Setup mode).
            // Stored on Game.stats so it travels with the game record.
            // 2026-05-28: default flipped to v2 — the sophisticated FINA
            // water polo canvas2D engine (the "good animated ones" the
            // operator gave us in commit 87da542). v2 already gracefully
            // falls back to v1 art for sports without v2 cues yet, so
            // defaulting to v2 has zero downside.
            pack={
              // 2026-06-15 — default to the BOLD v1 deck/marquee art. The v2
              // water-polo cinematic is a slow, dark build (ball drifts in over
              // ~4s; the "GOAL!" payoff lands after the board's hold window) so
              // the crowd saw dark water and called it "not firing." v1 slams a
              // bright "GOAL!/SLAM!" + live scoreline + burst immediately, and
              // now carries live data + team color + the air-horn. v2 is still
              // available as an explicit opt-in (celebrationPack === 'v2').
              // 2026-06-16 — basketball defaults to v2: its new cinematic
              // (ball through the hoop, cues-basketball.js) is bright + fast,
              // not the slow dark water-polo build that made v1 the default.
              // Other sports keep v1 unless the operator opts into v2.
              ((data?.stats as Record<string, unknown> | undefined)?.celebrationPack === 'v2'
                || data?.sport === 'basketball'
                || data?.sport === 'water_polo' || data?.sport === 'water-polo'
                ? 'v2'
                : 'v1') as 'v1' | 'v2'
            }
          />
        )}
      </div>
    </div>
  );
}
