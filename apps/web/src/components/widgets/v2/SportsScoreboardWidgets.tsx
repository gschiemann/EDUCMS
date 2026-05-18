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

import { useEffect, useState, type CSSProperties } from 'react';
import { findSport } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';
import type { WidgetProps } from './_shared/types';
import type { WidgetStyle } from './_shared/styleSystem';
import { API_URL } from '@/lib/api-url';
import { readBoardCache, writeBoardCache } from '@/lib/sports-board-cache';

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
  LIVE: { label: '● LIVE', bg: '#dc2626' },
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

  const [data, setData] = useState<BoardData | null>(null);
  const [, setTick] = useState(0);

  // Poll the public board feed — only on a real screen with a game bound.
  useEffect(() => {
    if (!live || !gameId) return;
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
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [live, gameId]);

  // Clock tick — re-render a few times a second while the clock runs.
  const board = data || SAMPLE;
  const def = findSport(board.sport);
  const tickClock = live && !!data && board.clockRunning && !!def && def.clock.type !== 'none';
  useEffect(() => {
    if (!tickClock) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [tickClock]);

  if (!def) {
    return (
      <div style={{ width: '100%', height: '100%', background: tier.bg }} />
    );
  }

  const homeColor = board.homeColor || '#4f46e5';
  const awayColor = board.awayColor || '#dc2626';
  const status = STATUS[board.status] || STATUS.SCHEDULED;
  const clockStr = fmtClock(liveClockMs(board, def, tickClock));

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
              color: board.clockRunning ? tier.accent : tier.ink,
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
        />
      </div>

      {/* situational graphics strip — real broadcast-style state,
          per-sport: base diamond + B/S/O for baseball, down & distance
          + possession for football, bonus + timeout pips for
          basketball, serve indicator for rally sports, clean stat
          chips for everything else. */}
      <SituationalRow def={def} board={board} tier={tier} h={height} />
    </div>
  );
}

// ── situational graphics ───────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const side = (v: unknown): 'home' | 'away' | null => {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'home' || s === 'h') return 'home';
  if (s === 'away' || s === 'a') return 'away';
  return null;
};

/** A row of N pips, `filled` of them solid — the iconic count display. */
function Pips({ n, filled, color, dim, size }: { n: number; filled: number; color: string; dim: string; size: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: i < filled ? color : 'transparent',
            border: `${Math.max(1, Math.round(size * 0.16))}px solid ${i < filled ? color : dim}`,
            marginLeft: i === 0 ? 0 : Math.round(size * 0.45),
            boxSizing: 'border-box',
            display: 'inline-block',
          }}
        />
      ))}
    </span>
  );
}

/** Baseball base diamond — 2B top, 1B right, 3B left; lit when occupied. */
function BaseDiamond({ on1, on2, on3, accent, dim, h }: { on1: boolean; on2: boolean; on3: boolean; accent: string; dim: string; h: number }) {
  const s = px(h, 0.15);
  const fill = (on: boolean) => (on ? accent : 'none');
  const stroke = (on: boolean) => (on ? accent : dim);
  return (
    <svg width={s * 1.7} height={s} viewBox="0 0 85 50" aria-hidden>
      {/* 3B left */}
      <rect x="11" y="23" width="14" height="14" transform="rotate(45 18 30)" fill={fill(on3)} stroke={stroke(on3)} strokeWidth="2.6" />
      {/* 2B top */}
      <rect x="35.5" y="6" width="14" height="14" transform="rotate(45 42.5 13)" fill={fill(on2)} stroke={stroke(on2)} strokeWidth="2.6" />
      {/* 1B right */}
      <rect x="60" y="23" width="14" height="14" transform="rotate(45 67 30)" fill={fill(on1)} stroke={stroke(on1)} strokeWidth="2.6" />
    </svg>
  );
}

/** A labelled count cluster — "B ●●○". */
function Count({ label, n, filled, accent, dim, h }: { label: string; n: number; filled: number; accent: string; dim: string; h: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: px(h, 0.02) }}>
      <span style={{ fontSize: px(h, 0.055), fontWeight: 900, color: dim, letterSpacing: 1 }}>{label}</span>
      <Pips n={n} filled={Math.max(0, Math.min(n, filled))} color={accent} dim={dim} size={px(h, 0.045)} />
    </span>
  );
}

function SituationalRow({ def, board, tier, h }: { def: SportDefinition; board: BoardData; tier: TierStyle; h: number }) {
  const stats = (board.stats || {}) as Record<string, unknown>;
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: px(h, 0.06),
    height: px(h, 0.17),
    borderTop: `1px solid ${tier.hairline}`,
    paddingTop: px(h, 0.02),
  };

  // ── Baseball / softball — base diamond + B/S/O ──
  if (def.segment.name === 'Inning') {
    return (
      <div style={rowStyle}>
        <BaseDiamond
          on1={num(stats.on1B) > 0}
          on2={num(stats.on2B) > 0}
          on3={num(stats.on3B) > 0}
          accent={tier.accent}
          dim={tier.inkDim}
          h={h}
        />
        <Count label="B" n={3} filled={num(stats.balls)} accent={tier.accent} dim={tier.inkDim} h={h} />
        <Count label="S" n={2} filled={num(stats.strikes)} accent={tier.accent} dim={tier.inkDim} h={h} />
        <Count label="O" n={2} filled={num(stats.outs)} accent="#dc2626" dim={tier.inkDim} h={h} />
      </div>
    );
  }

  // ── Football — down & distance + ball-on + possession ──
  if (def.key === 'football') {
    const down = num(stats.down);
    const dist = num(stats.distance);
    const ballOn = stats.ballOn;
    const poss = side(stats.possession);
    return (
      <div style={rowStyle}>
        {poss && (
          <span style={{ fontSize: px(h, 0.06), fontWeight: 900, color: tier.accent }}>
            {poss === 'home' ? '◀' : ''} {poss.toUpperCase()} BALL {poss === 'away' ? '▶' : ''}
          </span>
        )}
        {down > 0 && (
          <span style={{ fontSize: px(h, 0.07), fontWeight: 900, color: tier.ink, letterSpacing: 1 }}>
            {ordinal(down)} &amp; {dist === 0 ? 'GOAL' : dist}
          </span>
        )}
        {ballOn !== undefined && ballOn !== null && ballOn !== '' && (
          <span style={{ fontSize: px(h, 0.055), fontWeight: 800, color: tier.inkDim, letterSpacing: 1 }}>
            BALL ON {String(ballOn)}
          </span>
        )}
      </div>
    );
  }

  // ── Basketball — per-team timeouts + bonus, possession arrow ──
  if (def.key === 'basketball') {
    const hFouls = num(stats.homeFouls);
    const aFouls = num(stats.awayFouls);
    const poss = side(stats.possession);
    const bonus = (f: number) =>
      f >= 10 ? 'DOUBLE BONUS' : f >= 7 ? 'BONUS' : null;
    const TeamSit = ({ to, b, alignR }: { to: number; b: string | null; alignR?: boolean }) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: px(h, 0.03), flexDirection: alignR ? 'row-reverse' : 'row' }}>
        <Pips n={5} filled={to} color={tier.accent} dim={tier.inkDim} size={px(h, 0.04)} />
        {b && (
          <span style={{ fontSize: px(h, 0.05), fontWeight: 900, color: '#f59e0b', letterSpacing: 1 }}>{b}</span>
        )}
      </span>
    );
    return (
      <div style={rowStyle}>
        <TeamSit to={num(stats.homeTimeouts)} b={bonus(hFouls)} />
        <span style={{ fontSize: px(h, 0.055), fontWeight: 900, color: tier.accent, letterSpacing: 1 }}>
          {poss === 'home' ? '◀ ' : ''}POSS{poss === 'away' ? ' ▶' : ''}
        </span>
        <TeamSit to={num(stats.awayTimeouts)} b={bonus(aFouls)} alignR />
      </div>
    );
  }

  // ── Rally sports — serve indicator ──
  if (def.key === 'volleyball' || def.key === 'pickleball') {
    const serving = String(stats.serving || '').trim();
    if (!serving) return <ChipRow def={def} board={board} tier={tier} h={h} rowStyle={rowStyle} />;
    return (
      <div style={rowStyle}>
        <span style={{ fontSize: px(h, 0.06), fontWeight: 900, color: tier.accent, letterSpacing: 1 }}>
          🏐 SERVING — {serving.toUpperCase()}
        </span>
      </div>
    );
  }

  // ── Everything else — clean stat chips ──
  return <ChipRow def={def} board={board} tier={tier} h={h} rowStyle={rowStyle} />;
}

/** Fallback — the SportDefinition-driven chip row, for sports with no
 *  dedicated situational graphic. */
function ChipRow({ def, board, tier, h, rowStyle }: { def: SportDefinition; board: BoardData; tier: TierStyle; h: number; rowStyle: CSSProperties }) {
  const chips = def.stats
    .map((s) => {
      const raw = (board.stats || {})[s.key];
      if (raw === undefined || raw === null || raw === '') return null;
      return { label: s.label.toUpperCase(), value: String(raw) };
    })
    .filter((x): x is { label: string; value: string } => x !== null)
    .slice(0, 6);
  if (chips.length === 0) return null;
  return (
    <div style={{ ...rowStyle, flexWrap: 'wrap' }}>
      {chips.map((s) => (
        <span key={s.label} style={{ fontSize: px(h, 0.055), fontWeight: 700, color: tier.inkDim }}>
          {s.label}{' '}
          <strong style={{ color: tier.ink, fontVariantNumeric: 'tabular-nums' }}>{s.value}</strong>
        </span>
      ))}
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
}: {
  name: string;
  score: number;
  color: string;
  logo: string | null;
  tier: TierStyle;
  h: number;
  align: 'left' | 'right';
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
        style={{
          fontSize: px(h, 0.34),
          fontWeight: 900,
          lineHeight: 1,
          color: tier.scoreInk,
          fontVariantNumeric: 'tabular-nums',
          textShadow: `0 0 ${px(h, 0.06)}px ${color}66`,
        }}
      >
        {score}
      </span>
    </div>
  );
}
