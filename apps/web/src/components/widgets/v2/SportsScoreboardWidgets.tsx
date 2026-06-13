'use client';
/**
 * VenueOS Sports — live scoreboard widget.
 *
 * One widget, every sport. It binds to a game (`config.gameId`), polls
 * the public `/sports/board/:id` feed, and renders a scoreboard whose
 * clock model, period structure, and stat row are ALL driven by the
 * game's SportDefinition (`findSport`). Football shows down/distance,
 * baseball balls/strikes/outs, basketball fouls/possession — the engine
 * decides, not per-sport code.
 *
 * RENDER MODEL (rebuilt 2026-05-29 — the prior version regressed to a
 * generic dark "home VS away" box that looked nothing like the approved
 * mockups). Each tier is now a faithful, fixed-1920×1080 SCENE ported
 * from scratch/design/scoreboards/{hs,college,pro}.html, wrapped in a
 * transform:scale fitter so it fills any zone (gallery thumb → 4K board)
 * with zero unit drift. This is the CLAUDE.md design-loop pattern:
 *   HTML mockup (approved) → React port (this file) → screenshot verify.
 *
 * APPROVED 2026-05-29 (HS tier) — matches scratch/design/scoreboards/hs.html,
 * screenshot-verified. College + Pro tiers in progress (ported next).
 *
 * Cross-browser / Chromium-83-safe — long-hand top/right/bottom/left,
 * NO flex `gap` (margins / justify-content only), NO `inset` shorthand,
 * NO `backdrop-filter`. Ships to the player / Taurus LED controllers.
 * Font: Fredoka (already self-hosted via next/font — offline + Taurus
 * safe), the chunky rounded face the HS pep-rally mockup was designed in.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { findSport, formatScore } from '@cms/api-types';
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
  /** Center-banner text (HS tier). Defaults to "GAME NIGHT". */
  bannerText?: string;
  /** Brand overrides (Properties Panel → Style) — accent / text / bg
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
  homeColor: '#1e3a8a',
  awayColor: '#b91c1c',
  homeLogoUrl: null,
  awayLogoUrl: null,
  clockMs: 7 * 60_000 + 42_000,
  clockRunning: false,
  clockUpdatedAt: new Date().toISOString(),
  stats: {
    shotClock: 14,
    possession: 'home',
    homeFouls: 3,
    awayFouls: 5,
    homeTimeouts: 2,
    awayTimeouts: 1,
  },
  serverTime: Date.now(),
};

// ── tier palettes ──────────────────────────────────────────────────
interface TierStyle {
  label: string;
  /** stage background */
  stage: string;
  /** gold/accent trim (border, banner, clock frame) */
  accent: string;
  accentInk: string; // text on the accent (banner)
  /** clock card */
  clockCardBg: string;
  clockInk: string;
  /** neutral chrome */
  ink: string;
  dim: string;
}
const TIERS: Record<Tier, TierStyle> = {
  hs: {
    label: 'High School',
    stage: '#11151d',
    accent: '#fbbf24',
    accentInk: '#1e2a4a',
    clockCardBg: '#0a0f1c',
    clockInk: '#fde047',
    ink: '#ffffff',
    dim: '#cbd5e1',
  },
  // College + Pro reuse the HS scene with a cooler palette as a faithful
  // stopgap until their own mockups (college.html / pro.html) are ported.
  college: {
    label: 'College',
    stage: '#0a0e1a',
    accent: '#f0b429',
    accentInk: '#0a0e1a',
    clockCardBg: '#05070d',
    clockInk: '#f0b429',
    ink: '#f8fafc',
    dim: '#8b95a7',
  },
  pro: {
    label: 'Professional',
    stage: '#06080d',
    accent: '#22d3ee',
    accentInk: '#04060b',
    clockCardBg: '#0a0f1c',
    clockInk: '#67e8f9',
    ink: '#ffffff',
    dim: '#7a8694',
  },
};

const DISPLAY_FONT =
  "var(--font-fredoka), 'Fredoka', 'Baloo 2', system-ui, sans-serif";

// ── helpers ────────────────────────────────────────────────────────
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
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const sideOf = (v: unknown): 'home' | 'away' | null => {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'home' || s === 'h') return 'home';
  if (s === 'away' || s === 'a') return 'away';
  return null;
};

const STATUS: Record<string, { label: string; bg: string }> = {
  SCHEDULED: { label: 'SCHEDULED', bg: '#475569' },
  PRE_GAME: { label: 'PRE-GAME', bg: '#d97706' },
  LIVE: { label: 'LIVE', bg: '#dc2626' },
  HALFTIME: { label: 'HALFTIME', bg: '#2563eb' },
  FINAL: { label: 'FINAL', bg: '#1e293b' },
};

/**
 * Measure the wrapper and return the scale that fits a fixed 1920×1080
 * scene inside it (contain), plus the offsets to center it. This is the
 * ScaledTemplateThumbnail pattern — keep every px in the scene literal.
 */
function useScaleToFit(sceneW: number, sceneH: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, left: 0, top: 0, ready: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      const scale = Math.min(w / sceneW, h / sceneH);
      setFit({
        scale,
        left: Math.round((w - sceneW * scale) / 2),
        top: Math.round((h - sceneH * scale) / 2),
        ready: true,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sceneW, sceneH]);
  return { ref, fit };
}

// ════════════════════════════════════════════════════════════════════
//  WIDGET
// ════════════════════════════════════════════════════════════════════
export function SportsScoreboardWidget({
  config,
  live = true,
}: WidgetProps<SportsScoreboardCfg>) {
  const c = config || {};
  const baseTier = TIERS[c.tier && TIERS[c.tier] ? c.tier : 'hs'];
  const st: WidgetStyle = c.style || {};
  const tier: TierStyle = {
    ...baseTier,
    accent: st.accentColor || baseTier.accent,
    ink: st.textColor || baseTier.ink,
    stage: st.bgColor || baseTier.stage,
  };
  const gameId = (c.gameId || '').trim();
  const preview = !live || !gameId;

  const [data, setData] = useState<BoardData | null>(null);
  const [simBoard, setSimBoard] = useState<BoardData>(SAMPLE);
  const [, setTick] = useState(0);

  // Poll the public board feed — only on a real screen with a game bound.
  useEffect(() => {
    if (preview) return;
    let alive = true;
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
        /* keep last good frame */
      }
    };
    load();
    const t = setInterval(load, 750);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [preview, gameId]);

  // Preview self-play — the sample ticks down + scores so a tile in the
  // builder / picker looks alive, not frozen.
  useEffect(() => {
    if (!preview) return;
    let b: BoardData = { ...SAMPLE, clockMs: 7 * 60_000 + 42_000, clockRunning: true };
    let n = 0;
    const id = setInterval(() => {
      n++;
      let ms = b.clockMs - 1000;
      let seg = b.segment;
      const sc = Math.max(0, num((b.stats || {}).shotClock) - 1) || 24;
      if (ms <= 0) {
        ms = 9 * 60_000;
        seg = seg >= 4 ? 1 : seg + 1;
      }
      b = { ...b, clockMs: ms, segment: seg, stats: { ...b.stats, shotClock: sc } };
      if (n % 7 === 0) {
        b =
          n % 14 === 0
            ? { ...b, homeScore: b.homeScore + 2, stats: { ...b.stats, possession: 'away' } }
            : { ...b, awayScore: b.awayScore + 3, stats: { ...b.stats, possession: 'home' } };
      }
      setSimBoard(b);
    }, 1000);
    return () => clearInterval(id);
  }, [preview]);

  const board: BoardData = preview ? simBoard : data || SAMPLE;
  const def = findSport(board.sport);

  const tickClock = !preview && !!data && board.clockRunning && !!def && def.clock.type !== 'none';
  useEffect(() => {
    if (!tickClock) return;
    const t = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [tickClock]);

  const { ref, fit } = useScaleToFit(1920, 1080);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: tier.stage,
        overflow: 'hidden',
      }}
    >
      {def && (
        <div
          style={{
            position: 'absolute',
            top: fit.top,
            left: fit.left,
            width: 1920,
            height: 1080,
            transform: `scale(${fit.scale})`,
            transformOrigin: 'top left',
            opacity: fit.ready ? 1 : 0,
          }}
        >
          <HsScene board={board} def={def} tier={tier} bannerText={c.bannerText} live={live} preview={preview} />
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  HS SCENE — faithful port of scratch/design/scoreboards/hs.html
//  Fixed 1920×1080. Every px below is literal (scaled by the fitter).
// ════════════════════════════════════════════════════════════════════
function darken(hex: string, amt: number): string {
  // amt 0..1 → blend toward black. Safe on any #rrggbb; passthrough else.
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amt));
  const g = Math.round(((n >> 8) & 255) * (1 - amt));
  const b = Math.round((n & 255) * (1 - amt));
  return `rgb(${r},${g},${b})`;
}

function HsScene({
  board,
  def,
  tier,
  bannerText,
  live,
  preview,
}: {
  board: BoardData;
  def: SportDefinition;
  tier: TierStyle;
  bannerText?: string;
  live: boolean;
  preview: boolean;
}) {
  const homeColor = board.homeColor || '#1e3a8a';
  const awayColor = board.awayColor || '#b91c1c';
  const tickClock = !preview && board.clockRunning && def.clock.type !== 'none';
  const liveMs = liveClockMs(board, def, tickClock);
  const clockStr = def.clock.type === 'none' ? '' : fmtClock(liveMs);
  const stats = board.stats || {};
  const isLive = board.status === 'LIVE';

  // Which center modules apply to this sport (drive off real data).
  const shotClock = num(stats.shotClock);
  const hasShot = 'shotClock' in stats && shotClock > 0;
  const poss = sideOf(stats.possession);
  const hasFouls = 'homeFouls' in stats || 'awayFouls' in stats;
  const hasTimeouts = 'homeTimeouts' in stats || 'awayTimeouts' in stats;
  const homeTO = num(stats.homeTimeouts);
  const awayTO = num(stats.awayTimeouts);
  const maxTO = 3;

  const homeInitial = (board.homeTeam || '—').trim().charAt(0).toUpperCase();
  const awayInitial = (board.awayTeam || '—').trim().charAt(0).toUpperCase();

  const BLOCK_W = 620;
  const stage: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1920,
    height: 1080,
    overflow: 'hidden',
    fontFamily: DISPLAY_FONT,
    background: tier.stage,
    backgroundImage:
      'repeating-linear-gradient(115deg, rgba(255,255,255,0.018) 0 60px, rgba(255,255,255,0) 60px 120px)',
  };

  const sideBlock = (which: 'home' | 'away'): React.CSSProperties => {
    const col = which === 'home' ? homeColor : awayColor;
    return {
      position: 'absolute',
      top: 0,
      [which === 'home' ? 'left' : 'right']: 0,
      width: BLOCK_W,
      height: 1080,
      background: `linear-gradient(${which === 'home' ? 160 : 200}deg, ${col} 0%, ${darken(col, 0.28)} 60%, ${darken(col, 0.42)} 100%)`,
      [which === 'home' ? 'borderRight' : 'borderLeft']: `14px solid ${tier.accent}`,
      boxShadow: `inset ${which === 'home' ? '-40px' : '40px'} 0 80px rgba(0,0,0,0.35)`,
    } as React.CSSProperties;
  };

  const logoCoin = (which: 'home' | 'away'): React.CSSProperties => {
    const col = which === 'home' ? homeColor : awayColor;
    return {
      position: 'absolute',
      top: 96,
      [which === 'home' ? 'left' : 'right']: 194,
      width: 232,
      height: 232,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: 150,
      color: '#fff',
      background: `radial-gradient(circle at 38% 32%, ${darken(col, -0.18 < 0 ? 0 : 0)}, ${darken(col, 0.4)})`,
      border: '12px solid rgba(255,255,255,0.92)',
      boxShadow: '0 18px 44px rgba(0,0,0,0.45), inset 0 6px 18px rgba(255,255,255,0.12)',
      overflow: 'hidden',
    } as React.CSSProperties;
  };

  const nameStyle = (which: 'home' | 'away'): React.CSSProperties =>
    ({
      position: 'absolute',
      top: 360,
      [which === 'home' ? 'left' : 'right']: 0,
      width: BLOCK_W,
      textAlign: 'center',
      fontWeight: 800,
      fontSize: 92,
      lineHeight: 0.95,
      color: '#fff',
      letterSpacing: 1,
      textShadow: '0 6px 0 rgba(0,0,0,0.28)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      padding: '0 24px',
      boxSizing: 'border-box',
    }) as React.CSSProperties;

  const tagStyle = (which: 'home' | 'away'): React.CSSProperties =>
    ({
      position: 'absolute',
      top: 478,
      [which === 'home' ? 'left' : 'right']: 0,
      width: BLOCK_W,
      textAlign: 'center',
      fontWeight: 600,
      fontSize: 34,
      letterSpacing: 12,
      color: tier.accent,
    }) as React.CSSProperties;

  const scoreStyle = (which: 'home' | 'away'): React.CSSProperties =>
    ({
      position: 'absolute',
      top: 560,
      [which === 'home' ? 'left' : 'right']: 0,
      width: BLOCK_W,
      textAlign: 'center',
      fontWeight: 800,
      fontSize: 440,
      lineHeight: 0.8,
      color: '#fff',
      fontVariantNumeric: 'tabular-nums',
      textShadow: '0 14px 0 rgba(0,0,0,0.30), 0 0 70px rgba(255,255,255,0.22)',
    }) as React.CSSProperties;

  const pip = (on: boolean, color: string): React.CSSProperties => ({
    width: 30,
    height: 30,
    borderRadius: '50%',
    marginLeft: 12,
    background: on ? color : 'transparent',
    border: `3px solid ${on ? color : 'rgba(255,255,255,0.5)'}`,
    display: 'inline-block',
  });

  return (
    <div style={stage}>
      <style>{`@keyframes vsbBlink{0%,100%{opacity:1}50%{opacity:.25}}`}</style>

      {/* HOME side */}
      <div style={sideBlock('home')} />
      <div style={logoCoin('home')}>
        {board.homeLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={board.homeLogoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        ) : homeInitial}
      </div>
      <div style={nameStyle('home')}>{(board.homeTeam || 'HOME').toUpperCase()}</div>
      <div style={tagStyle('home')}>HOME</div>
      <div style={scoreStyle('home')}>{formatScore(def, board.homeScore)}</div>

      {/* AWAY side */}
      <div style={sideBlock('away')} />
      <div style={logoCoin('away')}>
        {board.awayLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={board.awayLogoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        ) : awayInitial}
      </div>
      <div style={nameStyle('away')}>{(board.awayTeam || 'AWAY').toUpperCase()}</div>
      <div style={tagStyle('away')}>AWAY</div>
      <div style={scoreStyle('away')}>{formatScore(def, board.awayScore)}</div>

      {/* CENTER COLUMN */}
      <div style={{ position: 'absolute', top: 0, left: BLOCK_W, width: 680, height: 1080 }}>
        {/* banner */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 680,
            height: 150,
            background: `linear-gradient(180deg, ${tier.accent}, ${darken(tier.accent, 0.22)})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 50,
            letterSpacing: 4,
            color: tier.accentInk,
            boxShadow: '0 8px 22px rgba(0,0,0,0.4)',
          }}
        >
          <span style={{ fontSize: 40, marginRight: 18 }}>★</span>
          {(bannerText || 'GAME NIGHT').toUpperCase()}
          <span style={{ fontSize: 40, marginLeft: 18 }}>★</span>
        </div>

        {/* period chip */}
        <div
          style={{
            position: 'absolute',
            top: 196,
            left: 140,
            width: 400,
            height: 96,
            background: '#fff',
            borderRadius: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 52,
            color: darken(homeColor, 0.15),
            boxShadow: '0 10px 0 rgba(0,0,0,0.22)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {segmentLabel(def, board)}
        </div>

        {/* big clock card */}
        {clockStr ? (
          <div
            style={{
              position: 'absolute',
              top: 330,
              left: 60,
              width: 560,
              height: 300,
              background: tier.clockCardBg,
              border: `10px solid ${tier.accent}`,
              borderRadius: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 16px 0 rgba(0,0,0,0.30), inset 0 0 60px ${tier.accent}1a`,
            }}
          >
            <span
              style={{
                fontWeight: 800,
                fontSize: 200,
                lineHeight: 1,
                color: liveMs > 0 && liveMs < 60_000 && board.clockRunning ? '#f87171' : tier.clockInk,
                fontVariantNumeric: 'tabular-nums',
                textShadow: `0 0 40px ${tier.clockInk}8c`,
              }}
            >
              {clockStr}
            </span>
          </div>
        ) : (
          // leaderboard / no-clock sports — show the sport name plate
          <div
            style={{
              position: 'absolute', top: 330, left: 60, width: 560, height: 300,
              background: tier.clockCardBg, border: `10px solid ${tier.accent}`, borderRadius: 34,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 90, color: tier.accent, letterSpacing: 4, textAlign: 'center',
            }}
          >
            {def.name.toUpperCase()}
          </div>
        )}

        {/* shot clock coin */}
        {hasShot && (
          <div
            style={{
              position: 'absolute',
              top: 300,
              left: 470,
              width: 168,
              height: 168,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 40% 34%, #ff5b5b, #c81e1e)',
              border: '9px solid #fff',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 12px 28px rgba(0,0,0,0.5)',
            }}
          >
            <span style={{ fontWeight: 800, fontSize: 92, lineHeight: 0.9, color: '#fff' }}>{shotClock}</span>
            <span style={{ fontWeight: 600, fontSize: 21, letterSpacing: 2, color: '#ffe2e2', marginTop: 2 }}>SHOT</span>
          </div>
        )}

        {/* possession bar */}
        {poss && (
          <div
            style={{
              position: 'absolute',
              top: 658,
              left: 60,
              width: 560,
              height: 92,
              background: '#fff',
              borderRadius: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 0 rgba(0,0,0,0.2)',
            }}
          >
            <span style={{ fontSize: 60, lineHeight: 1, color: darken(homeColor, 0.1), opacity: poss === 'home' ? 1 : 0.18 }}>◄</span>
            <span style={{ fontWeight: 600, fontSize: 32, letterSpacing: 3, color: '#475569', margin: '0 22px' }}>POSSESSION</span>
            <span style={{ fontSize: 60, lineHeight: 1, color: darken(awayColor, 0.1), opacity: poss === 'away' ? 1 : 0.18 }}>►</span>
          </div>
        )}

        {/* fouls + timeouts meters */}
        {(hasFouls || hasTimeouts) && (
          <div style={{ position: 'absolute', top: 776, left: 60, width: 560, height: 216, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            {hasFouls && (
              <div style={{ height: 100, background: '#161c2b', border: '4px solid #2a3450', borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px' }}>
                <span style={{ fontWeight: 600, fontSize: 28, letterSpacing: 3, color: '#cbd5e1' }}>TEAM FOULS</span>
                <span style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: 56, lineHeight: 1, width: 92, textAlign: 'center', borderRadius: 16, padding: '4px 0', background: homeColor, color: '#fff' }}>{num(stats.homeFouls)}</span>
                  <span style={{ fontWeight: 600, fontSize: 26, color: '#64748b', margin: '0 16px' }}>–</span>
                  <span style={{ fontWeight: 800, fontSize: 56, lineHeight: 1, width: 92, textAlign: 'center', borderRadius: 16, padding: '4px 0', background: awayColor, color: '#fff' }}>{num(stats.awayFouls)}</span>
                </span>
              </div>
            )}
            {hasTimeouts && (
              <div style={{ height: 100, background: '#161c2b', border: '4px solid #2a3450', borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px' }}>
                <span style={{ fontWeight: 600, fontSize: 28, letterSpacing: 3, color: '#cbd5e1' }}>TIMEOUTS</span>
                <span style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    {Array.from({ length: maxTO }).map((_, i) => <span key={`h${i}`} style={pip(i < homeTO, '#60a5fa')} />)}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 26, color: '#64748b', margin: '0 16px' }}>/</span>
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    {Array.from({ length: maxTO }).map((_, i) => <span key={`a${i}`} style={pip(i < awayTO, '#f87171')} />)}
                  </span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* LIVE flag */}
      {isLive && (
        <div
          style={{
            position: 'absolute',
            top: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#dc2626',
            color: '#fff',
            fontWeight: 700,
            fontSize: 30,
            letterSpacing: 4,
            padding: '8px 26px',
            borderRadius: 999,
            display: 'flex',
            alignItems: 'center',
            boxShadow: '0 6px 16px rgba(0,0,0,0.4)',
            zIndex: 5,
          }}
        >
          <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', marginRight: 12, animation: 'vsbBlink 1.3s ease-in-out infinite' }} />
          LIVE
        </div>
      )}
    </div>
  );
}
