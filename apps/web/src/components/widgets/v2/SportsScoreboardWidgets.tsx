'use client';
/**
 * VenueOS Sports — live scoreboard widget.
 *
 * One widget, every sport. It binds to a game (`config.gameId`), polls
 * the public `/sports/board/:id` feed, and renders a scoreboard whose
 * clock model, period structure, and stat row are ALL driven by the
 * game's SportDefinition (`findSport`) — the same sports engine the
 * game-day console runs on. Football shows down/distance/ball-on,
 * baseball shows balls/strikes/outs, volleyball shows sets — no
 * per-sport code, the engine decides.
 *
 * Three visual tiers — High School, College, Professional — picked via
 * `config.tier`; registered as three picker variants.
 *
 * In the editor / thumbnails (`live === false`, or no game bound) it
 * renders a representative sample game so the tile always looks alive.
 */

import { useEffect, useRef, useState } from 'react';
import { findSport } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';
import type { WidgetProps } from './_shared/types';
import type { WidgetStyle } from './_shared/styleSystem';
import { API_URL } from '@/lib/api-url';
import { readBoardCache, writeBoardCache } from '@/lib/sports-board-cache';
import { SituationalRow } from './_shared/sports-situational';

type Tier = 'hs' | 'college' | 'pro';

interface BoardData {
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
  serverTime: number;
}

export interface SportsScoreboardCfg {
  /** The game to display — paste a game id, or leave blank for a sample. */
  gameId?: string;
  /** Visual tier: 'hs' | 'college' | 'pro'. */
  tier?: Tier;
  /** Brand overrides (Properties Panel → Style) — bg / text / accent
   *  color + font win over the tier's designed palette. */
  style?: WidgetStyle;
}

// ── sample game (editor / no game bound) ───────────────────────────
const SAMPLE: BoardData = {
  id: 'sample',
  sport: 'basketball',
  status: 'LIVE',
  segment: 3,
  homeTeam: 'EAGLES',
  awayTeam: 'TIGERS',
  homeScore: 62,
  awayScore: 58,
  homeColor: '#4f46e5',
  awayColor: '#dc2626',
  homeLogoUrl: null,
  awayLogoUrl: null,
  clockMs: 8 * 60_000 + 42_000,
  clockRunning: false,
  clockUpdatedAt: new Date().toISOString(),
  stats: { homeFouls: 3, awayFouls: 5, homeTimeouts: 2, awayTimeouts: 1 },
  serverTime: Date.now(),
};

// ── tiers ──────────────────────────────────────────────────────────
interface TierStyle {
  label: string;
  bg: string;
  panel: string;
  ink: string;
  inkDim: string;
  scoreInk: string;
  accent: string;
  fontFamily: string;
  radius: number;
  hairline: string;
}
const TIERS: Record<Tier, TierStyle> = {
  hs: {
    label: 'High School',
    bg: 'linear-gradient(165deg, #0e1a3a 0%, #0a1024 100%)',
    panel: 'rgba(255,255,255,0.05)',
    ink: '#ffffff',
    inkDim: '#94a3b8',
    scoreInk: '#ffffff',
    accent: '#fbbf24',
    fontFamily: "'Inter', system-ui, sans-serif",
    radius: 0.06,
    hairline: 'rgba(255,255,255,0.10)',
  },
  college: {
    label: 'College',
    bg: 'linear-gradient(165deg, #0a0e1a 0%, #05070d 100%)',
    panel: 'rgba(255,255,255,0.04)',
    ink: '#f8fafc',
    inkDim: '#8b95a7',
    scoreInk: '#f0b429',
    accent: '#f0b429',
    fontFamily: "'Inter', system-ui, sans-serif",
    radius: 0.03,
    hairline: 'rgba(240,180,41,0.30)',
  },
  pro: {
    label: 'Professional',
    bg: 'linear-gradient(165deg, #0a0a0c 0%, #000000 100%)',
    panel: 'rgba(255,255,255,0.03)',
    ink: '#ffffff',
    inkDim: '#7a8694',
    scoreInk: '#ffffff',
    accent: '#22d3ee',
    fontFamily: "'Inter', system-ui, sans-serif",
    radius: 0.02,
    hairline: 'rgba(34,211,238,0.28)',
  },
};

// ── helpers ────────────────────────────────────────────────────────
function px(zoneH: number, f: number): number {
  return Math.max(8, Math.round(zoneH * f));
}
function fmtClock(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe >= 60_000) {
    const m = Math.floor(safe / 60_000);
    const s = Math.floor((safe % 60_000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return `${Math.floor(safe / 1000)}.${Math.floor((safe % 1000) / 100)}`;
}
function liveClockMs(b: BoardData, def: SportDefinition, ticking: boolean): number {
  if (!ticking || !b.clockRunning || def.clock.type === 'none') return b.clockMs;
  const skew = b.serverTime - Date.now();
  const elapsed = Date.now() + skew - new Date(b.clockUpdatedAt).getTime();
  if (def.clock.type === 'countup') return b.clockMs + elapsed;
  return Math.max(0, b.clockMs - elapsed);
}
function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
function segmentLabel(def: SportDefinition, b: BoardData): string {
  const n = b.segment;
  // Inning sports (baseball / softball) have no overtime — extra
  // innings just keep counting up (10TH, 11TH…). This MUST be checked
  // before the OT branch, or innings past `count` mislabel as "OT".
  if (def.segment.name === 'Inning') {
    const half = String((b.stats || {}).half || '').toUpperCase();
    return `${half ? half + ' ' : ''}${ordinal(n)}`;
  }
  if (n > def.segment.count) {
    const ot = n - def.segment.count;
    return ot > 1 ? `OT${ot}` : 'OT';
  }
  return `${def.segment.name.toUpperCase()} ${n}`;
}

const STATUS: Record<string, { label: string; bg: string }> = {
  SCHEDULED: { label: 'SCHEDULED', bg: '#475569' },
  PRE_GAME: { label: 'PRE-GAME', bg: '#d97706' },
  LIVE: { label: 'LIVE', bg: '#dc2626' },
  HALFTIME: { label: 'HALFTIME', bg: '#2563eb' },
  FINAL: { label: 'FINAL', bg: '#1e293b' },
};

// ── widget ─────────────────────────────────────────────────────────
export function SportsScoreboardWidget({
  config,
  live = true,
  height = 480,
}: WidgetProps<SportsScoreboardCfg>) {
  const c = config || {};
  const baseTier = TIERS[c.tier && TIERS[c.tier] ? c.tier : 'hs'];
  // Operator brand overrides (Properties Panel → Style) win over the
  // tier's designed palette, so a scoreboard can match team colors.
  const st: WidgetStyle = c.style || {};
  const tier: TierStyle = {
    ...baseTier,
    bg: st.bgColor || baseTier.bg,
    accent: st.accentColor || baseTier.accent,
    ink: st.textColor || baseTier.ink,
    fontFamily: st.fontFamily || baseTier.fontFamily,
  };
  const gameId = (c.gameId || '').trim();

  // Preview = no real game bound. The sample game self-plays so a
  // scoreboard tile in the builder / picker is genuinely alive, and
  // the score-pop + clock-urgency treatments read true.
  const preview = !live || !gameId;

  const [data, setData] = useState<BoardData | null>(null);
  const [simBoard, setSimBoard] = useState<BoardData>(SAMPLE);
  const [, setTick] = useState(0);

  // Poll the public board feed — only on a real screen with a game bound.
  useEffect(() => {
    if (preview) return;
    let alive = true;
    // Cold-boot: paint the last cached frame instantly so a player
    // power-cycle mid-game never shows an empty scoreboard.
    const cached = readBoardCache<BoardData>(gameId);
    if (cached) setData(cached);
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/sports/board/${gameId}`, { cache: 'no-store' });
        if (res.ok && alive) {
          const json = (await res.json()) as BoardData;
          setData(json);
          writeBoardCache(gameId, json);
        }
      } catch {
        /* keep the last good frame */
      }
    };
    load();
    // 750ms — sub-second sync, in step with the standalone surfaces.
    const t = setInterval(load, 750);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [preview, gameId]);

  // Preview self-play — the sample game ticks down and scores so a
  // scoreboard tile in the builder looks alive, not frozen. Starts
  // late in a period so the tile reads tense + the final-minute
  // urgency treatment shows.
  useEffect(() => {
    if (!preview) return;
    let b: BoardData = { ...SAMPLE, clockMs: 108_000, clockRunning: true };
    let n = 0;
    const id = setInterval(() => {
      n++;
      let ms = b.clockMs - 1000;
      let seg = b.segment;
      if (ms <= 0) { ms = 144_000; seg = seg >= 4 ? 1 : seg + 1; }
      b = { ...b, clockMs: ms, segment: seg };
      if (n % 6 === 0) {
        b = n % 12 === 0
          ? { ...b, homeScore: b.homeScore + 2 }
          : { ...b, awayScore: b.awayScore + 3 };
      }
      setSimBoard(b);
    }, 1000);
    return () => clearInterval(id);
  }, [preview]);

  const board: BoardData = preview ? simBoard : (data || SAMPLE);
  const def = findSport(board.sport);
  // Clock tick — re-render a few times a second while a live clock runs.
  const tickClock = !preview && !!data && board.clockRunning && !!def && def.clock.type !== 'none';
  useEffect(() => {
    if (!tickClock) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [tickClock]);

  // Score-pop — replay the score's pop animation whenever it rises.
  const prevHome = useRef(board.homeScore);
  const prevAway = useRef(board.awayScore);
  const [popHome, setPopHome] = useState(0);
  const [popAway, setPopAway] = useState(0);
  useEffect(() => {
    if (board.homeScore > prevHome.current) setPopHome((x) => x + 1);
    prevHome.current = board.homeScore;
  }, [board.homeScore]);
  useEffect(() => {
    if (board.awayScore > prevAway.current) setPopAway((x) => x + 1);
    prevAway.current = board.awayScore;
  }, [board.awayScore]);

  if (!def) {
    return (
      <div style={{ width: '100%', height: '100%', background: tier.bg }} />
    );
  }

  const homeColor = board.homeColor || '#4f46e5';
  const awayColor = board.awayColor || '#dc2626';
  const status = STATUS[board.status] || STATUS.SCHEDULED;
  const liveMs = liveClockMs(board, def, tickClock);
  const clockStr = fmtClock(liveMs);
  // Final-minute urgency — the clock tenses up: red + a soft pulse.
  const clockUrgent =
    def.clock.type !== 'none' && board.clockRunning && liveMs > 0 && liveMs < 60_000;

  const pad = px(height, 0.06);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: tier.bg,
        fontFamily: tier.fontFamily,
        color: tier.ink,
        display: 'flex',
        flexDirection: 'column',
        padding: pad,
        boxSizing: 'border-box',
        borderRadius: px(height, tier.radius),
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes venueScorePop { 0% { transform: scale(1); } 28% { transform: scale(1.32); } 100% { transform: scale(1); } }
        @keyframes venueLivePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
        @keyframes venueClockPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
      {/* top strip — status + segment/clock */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: px(height, 0.16),
        }}
      >
        <span
          style={{
            background: status.bg,
            color: '#fff',
            fontSize: px(height, 0.06),
            fontWeight: 800,
            letterSpacing: 2,
            padding: `${px(height, 0.018)}px ${px(height, 0.05)}px`,
            borderRadius: 999,
            marginRight: px(height, 0.06),
          }}
        >
          {board.status === 'LIVE' && (
            <span
              style={{
                display: 'inline-block',
                marginRight: px(height, 0.022),
                animation: 'venueLivePulse 1.3s ease-in-out infinite',
              }}
            >
              ●
            </span>
          )}
          {status.label}
        </span>
        <span
          style={{
            fontSize: px(height, 0.085),
            fontWeight: 800,
            letterSpacing: 3,
            color: tier.accent,
          }}
        >
          {segmentLabel(def, board)}
        </span>
        {def.clock.type !== 'none' && (
          <span
            style={{
              fontSize: px(height, 0.11),
              fontWeight: 900,
              marginLeft: px(height, 0.06),
              fontVariantNumeric: 'tabular-nums',
              color: clockUrgent ? '#ef4444' : board.clockRunning ? tier.accent : tier.ink,
              animation: clockUrgent ? 'venueClockPulse 1s ease-in-out infinite' : undefined,
            }}
          >
            {clockStr}
          </span>
        )}
      </div>

      {/* main row — home | score | away */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <TeamBlock
          name={board.homeTeam}
          score={board.homeScore}
          color={homeColor}
          logo={board.homeLogoUrl}
          tier={tier}
          h={height}
          align="left"
          pop={popHome}
        />
        <div
          style={{
            fontSize: px(height, 0.07),
            fontWeight: 800,
            color: tier.inkDim,
            letterSpacing: 2,
          }}
        >
          VS
        </div>
        <TeamBlock
          name={board.awayTeam}
          score={board.awayScore}
          color={awayColor}
          logo={board.awayLogoUrl}
          tier={tier}
          h={height}
          align="right"
          pop={popAway}
        />
      </div>

      {/* situational graphics strip — real broadcast-style state,
          per-sport: base diamond + B/S/O for baseball, down & distance
          + possession for football, bonus + timeout pips for
          basketball, serve indicator for rally sports, clean stat
          chips for everything else. */}
      <SituationalRow
        def={def}
        stats={board.stats || {}}
        h={height}
        accent={tier.accent}
        ink={tier.ink}
        dim={tier.inkDim}
        hairline={tier.hairline}
      />
    </div>
  );
}


function TeamBlock({
  name,
  score,
  color,
  logo,
  tier,
  h,
  align,
  pop,
}: {
  name: string;
  score: number;
  color: string;
  logo: string | null;
  tier: TierStyle;
  h: number;
  align: 'left' | 'right';
  /** Increments on every score rise — `key`s the score span so its
   *  pop animation replays. */
  pop: number;
}) {
  const code = String(name || '—').trim().toUpperCase().slice(0, 14);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'left' ? 'flex-start' : 'flex-end',
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', maxWidth: '100%' }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt=""
            style={{
              height: px(h, 0.14),
              width: px(h, 0.14),
              objectFit: 'contain',
              [align === 'left' ? 'marginRight' : 'marginLeft']: px(h, 0.03),
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <span
            style={{
              width: px(h, 0.05),
              height: px(h, 0.14),
              background: color,
              borderRadius: 3,
              [align === 'left' ? 'marginRight' : 'marginLeft']: px(h, 0.03),
              display: 'inline-block',
            }}
          />
        )}
        <span
          style={{
            fontSize: px(h, 0.1),
            fontWeight: 800,
            letterSpacing: 1,
            color: tier.ink,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {code}
        </span>
      </div>
      <span
        key={pop}
        style={{
          fontSize: px(h, 0.34),
          fontWeight: 900,
          lineHeight: 1,
          color: tier.scoreInk,
          fontVariantNumeric: 'tabular-nums',
          textShadow: `0 0 ${px(h, 0.06)}px ${color}66`,
          animation: 'venueScorePop 0.6s cubic-bezier(.2,1.4,.4,1) both',
          transformOrigin: align === 'left' ? 'left center' : 'right center',
        }}
      >
        {score}
      </span>
    </div>
  );
}
