"use client";
/**
 * VenueOS · Sports Venue widgets — jumbotron, 16:1 LED ribbon, concourse and
 * portrait surfaces for game presentation.
 *
 * Originally ported 1:1 from scratch/incoming/edu-cms-6/sports-venue-pack —
 * every fixed px is rescaled against the widget's measured height via
 * px(height, fixedPx / canvasHeight). The LAYOUTS are unchanged from that
 * port; what changed (K-12 launch audit, 2026-09-27) is where the words and
 * numbers come from.
 *
 * ── DATA TRUTH (audit F28 / F29 / F38) ────────────────────────────────
 * The pack used to render ONLY static config + hardcoded pro-league samples:
 * a "Stadium Scoreboard" that never read the game (an NBA matchup at 4:21 of
 * Q3, forever), a Noise Meter frozen at "87 · DB · LIVE", out-of-town scores
 * and standings stamped "UPDATED LIVE", a beer sponsor, an airline takeover,
 * a Kiss Cam and a child's name and age as sample copy. Every widget now
 * belongs to exactly one of three honest sources, and says which:
 *
 *   LIVE GAME (scoreboard, ribbon ticker, lineup, player card, stat
 *   comparison, goal celebration — `dataMode: 'live'`, the default):
 *     game facts (score, clock, period, fouls, timeouts, possession,
 *     roster) come from the bound game through `useGameState()` — the
 *     ambient game on /board /ribbon /scorebug, or the per-zone provider
 *     WidgetPreview mounts for `config.gameId`. Nothing typed can mask a
 *     live score (F29); the operator may override IDENTITY only (short
 *     code, colours, logo, record). A real screen with no game shows
 *     neutral dashes, never a sample.
 *
 *   MANUAL CONTENT (`dataMode: 'manual'`, and every widget with no game
 *   source at all — standings, out-of-town scores, concession waits, home
 *   schedule, sponsors, promos, wayfinding): exactly what the operator
 *   typed. Score boards typed by hand carry an "AS OF <time>" stamp the
 *   panel writes on every edit — never "LIVE".
 *
 *   DEMO (the builder only — `useRenderSurface() === 'builder'`): a
 *   school-safe sample so the tile is never blank, always stamped SAMPLE.
 *   A real screen with nothing configured renders the empty frame instead
 *   (the WidgetEmptyState contract: no invented content, no authoring
 *   prompt in front of the public).
 *
 * The Noise Meter is an ANIMATION — there is no microphone input, so it no
 * longer prints a decibel number or "LIVE". The Fan Cam frame paints a
 * transparent window for a camera feed layered beneath it and never claims
 * a live feed itself.
 *
 * ── TAURUS / CHROMIUM-83 ──────────────────────────────────────────────
 * Long-hand sides only, no flex `gap` (margins), no `backdrop-filter`, and a
 * positioned box never carries four non-uniform sides in one style object
 * (CLAUDE.md rule #10, all three variants).
 */
import React, { useEffect, useState } from 'react';
import { findSport, formatScore } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { ResolvedStyle } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';
import { sceneCss } from '../scene-css';
import { useGameState, fmtClock, type GameSnapshot } from '../sports/GameStateContext';
import { useRenderSurface } from '../render-surface';
import {
  DEMO_AWAY, DEMO_CLOCK, DEMO_COMPARE, DEMO_HOME, DEMO_HOME_GAMES, DEMO_LINEUP,
  DEMO_OOT, DEMO_PERIOD, DEMO_STANDINGS, DEMO_STANDS, DEMO_STATLINE, DEMO_TICKER_SEGMENTS,
  asOfLabel, defaultLineupCount, findRosterPlayer, gameStatPairs, hasTypedTeam,
  lineupFromRoster, liveTeamView, ownCopy, ownSponsorName, splitName, statLineFromRoster,
  typedTeamView,
  type ConcessionStand, type HomeGameRow, type LineupPlayer, type OotGame,
  type StandingRow, type StatPairRow, type VenueTeamCfg, type VenueTeamView,
} from './sports-venue-data';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

/* ════════════════ shared source + chrome ════════════════ */

type DataMode = 'live' | 'manual';

/**
 * Where a live-capable widget's game facts come from right now.
 *   demo   — builder / thumbnail with no game provider: school-safe sample.
 *   live   — a provider with a snapshot: the real game.
 *   empty  — a provider without data (a real screen, nothing bound yet).
 *   manual — the operator chose to type every value.
 */
interface VenueSource {
  kind: 'demo' | 'live' | 'empty' | 'manual';
  snap: GameSnapshot | null;
  clockMs: number;
  isBuilder: boolean;
}

function useVenueSource(mode: DataMode | string | undefined): VenueSource {
  const state = useGameState();
  const isBuilder = useRenderSurface() !== 'player';
  if (mode === 'manual') return { kind: 'manual', snap: null, clockMs: 0, isBuilder };
  if (state == null) return { kind: 'demo', snap: null, clockMs: 0, isBuilder };
  if (state.snapshot) return { kind: 'live', snap: state.snapshot, clockMs: state.liveClockMs, isBuilder };
  return { kind: 'empty', snap: null, clockMs: 0, isBuilder };
}

function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** Compact period label for a scoreboard chip: Q3 · OT · 2ND HALF · SET 2 · TOP 5TH. */
function periodLabel(def: SportDefinition | undefined, snap: GameSnapshot): string {
  if (snap.status === 'HALFTIME') return 'HALFTIME';
  if (snap.status === 'FINAL') return 'FINAL';
  if (snap.status === 'SCHEDULED' || snap.status === 'PRE_GAME') return 'PRE-GAME';
  const n = snap.segment;
  if (!def) return `P${n}`;
  if (def.segment.name === 'Inning') {
    const half = String((snap.stats || {}).half || '').toLowerCase();
    return `${half === 'bottom' ? 'BOT' : 'TOP'} ${ordinal(n)}`;
  }
  if (n > def.segment.count) {
    const ot = n - def.segment.count;
    return ot > 1 ? `OT${ot}` : 'OT';
  }
  switch (def.segment.name) {
    case 'Quarter': return `Q${n}`;
    case 'Half': return n === 1 ? '1ST HALF' : '2ND HALF';
    case 'Period': return `P${n}`;
    default: return `${def.segment.name.toUpperCase()} ${n}`;
  }
}

function sideOf(v: unknown): 'home' | 'away' | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'home' || s === 'h') return 'home';
  if (s === 'away' || s === 'a') return 'away';
  return null;
}

/** Both team views + clock/period for a scoreboard-type widget. */
interface GameView {
  home: VenueTeamView;
  away: VenueTeamView;
  clock: string;
  period: string;
  possession: 'home' | 'away' | null;
  homeBonus: boolean;
  awayBonus: boolean;
  sportName: string;
  /** true while the numbers on screen are the builder's sample */
  demo: boolean;
}

interface ScoreboardishCfg {
  dataMode?: DataMode;
  sport?: string;
  home?: VenueTeamCfg;
  away?: VenueTeamCfg;
  clock?: string;
  period?: string;
  homeFouls?: number;
  awayFouls?: number;
  homeBonus?: boolean;
  awayBonus?: boolean;
  possession?: 'home' | 'away' | '';
}

function useGameView(c: ScoreboardishCfg): GameView {
  const src = useVenueSource(c.dataMode);
  if (src.kind === 'live' && src.snap) {
    const snap = src.snap;
    const def = findSport(snap.sport);
    const fmt = (n: number) => formatScore(def, n);
    const stats = snap.stats || {};
    const hasClock = !!def && def.clock.type !== 'none';
    return {
      home: liveTeamView(snap, 'home', c.home, fmt),
      away: liveTeamView(snap, 'away', c.away, fmt),
      clock: hasClock ? fmtClock(src.clockMs) : '',
      period: periodLabel(def, snap),
      possession: sideOf((snap as { possession?: unknown }).possession ?? stats.possession),
      // Only an explicit engine flag lights a bonus lamp here — the
      // threshold rules are the engine's (audit F04), never guessed.
      homeBonus: stats.homeBonus === true,
      awayBonus: stats.awayBonus === true,
      sportName: def ? def.name.toUpperCase() : '',
      demo: false,
    };
  }
  if (src.kind === 'empty') {
    // A real screen with no game: identity the operator set may show (it
    // is not a claim about a game), every number is a dash.
    const home = typedTeamView({ ...c.home, score: undefined }, null, 'home');
    const away = typedTeamView({ ...c.away, score: undefined }, null, 'away');
    return {
      home: { ...home, timeouts: null, fouls: null, shots: '' },
      away: { ...away, timeouts: null, fouls: null, shots: '' },
      clock: '—:—', period: '—', possession: null, homeBonus: false, awayBonus: false,
      sportName: '', demo: false,
    };
  }
  // demo (builder, no game) or manual (typed). Manual on a real screen
  // never falls back to the sample; in the builder an untyped manual
  // board shows the stamped sample so the tile is not blank.
  const useDemo = src.kind === 'demo' || (src.isBuilder && !hasTypedTeam(c.home) && !hasTypedTeam(c.away));
  const home = typedTeamView(
    { ...c.home, fouls: c.homeFouls ?? c.home?.fouls },
    useDemo ? DEMO_HOME : null,
    'home',
  );
  const away = typedTeamView(
    { ...c.away, fouls: c.awayFouls ?? c.away?.fouls },
    useDemo ? DEMO_AWAY : null,
    'away',
  );
  return {
    home,
    away,
    clock: ownCopy(c.clock) ?? (useDemo ? DEMO_CLOCK : ''),
    period: ownCopy(c.period) ?? (useDemo ? DEMO_PERIOD : ''),
    possession: sideOf(c.possession) ?? (useDemo ? 'home' : null),
    homeBonus: !!c.homeBonus,
    awayBonus: !!c.awayBonus,
    sportName: ownCopy(c.sport)?.replace(/_/g, ' ').toUpperCase() ?? (useDemo ? 'BASKETBALL' : ''),
    demo: useDemo,
  };
}

/** Builder-only stamp: the content on this tile is a sample. Never on a real screen. */
function SampleStamp({ height, show }: { height: number; show: boolean }) {
  if (!show) return null;
  return (
    <div
      data-venue-sample=""
      style={{
        position: 'absolute', bottom: px(height, 0.02), right: px(height, 0.025), zIndex: 20,
        background: 'rgba(0,0,0,0.62)', color: '#facc15', fontWeight: 800,
        fontSize: Math.max(10, px(height, 0.026)), letterSpacing: '0.2em',
        padding: `${px(height, 0.006)}px ${px(height, 0.014)}px`, borderRadius: px(height, 0.008),
        border: '1px solid rgba(250,204,21,0.45)', pointerEvents: 'none', whiteSpace: 'nowrap',
      }}
    >
      SAMPLE
    </div>
  );
}

/** A team badge: the logo when there is one, else the short code on a chip. */
function TeamMark({ team, size, radius }: { team: VenueTeamView; size: number; radius: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: radius, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: team.color, fontWeight: 800, fontSize: Math.round(size * 0.44), overflow: 'hidden', flexShrink: 0 }}>
      {team.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
      ) : team.code.slice(0, 3)}
    </div>
  );
}

/** Colours every venue widget exposes through the v2 Style section. */
function venueStyle(c: BaseCfg, defaults: { bgColor: string; textColor?: string; accentColor?: string; accentColor2?: string }): ResolvedStyle {
  return resolveStyle({
    textColor: '#ffffff',
    accentColor: '#ffd23a',
    accentColor2: '#ff5664',
    ...defaults,
    ...c.style,
  });
}

/* ════════════════ STADIUM SCOREBOARD ════════════════ */

export interface StadiumScoreboardCfg extends BaseCfg, ScoreboardishCfg {
  gameId?: string;
  topSponsor?: string;
  bottomSponsor?: string;
}

function ScbTeamPanel({ team, side, sideLabel, mirror, height, ink }: { team: VenueTeamView; side: 'home' | 'away'; sideLabel: string; mirror?: boolean; height: number; ink: string }) {
  return (
    <div style={{ background: `linear-gradient(${mirror ? '-135deg' : '135deg'}, ${team.color} 0%, ${team.color2 || '#000'} 100%)`, borderRadius: px(height, 0.0167), display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: `${px(height, 0.022)}px ${px(height, 0.0278)}px`, color: ink, overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: px(height, 0.024), opacity: 0.7, letterSpacing: '0.1em' }}>{sideLabel}</div>
          <div data-field-jump={`${side}.code`} style={{ fontWeight: 800, fontSize: px(height, 0.059), letterSpacing: '-0.02em', lineHeight: 1 }}>{team.code}</div>
          <div data-field-jump={`${side}.name`} style={{ fontWeight: 700, fontSize: px(height, 0.0204), opacity: 0.85, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.name}</div>
        </div>
        <TeamMark team={team} size={px(height, 0.0704)} radius={px(height, 0.013)} />
      </div>
      <div style={{ position: 'relative', fontWeight: 800, fontSize: px(height, 0.2407), lineHeight: 0.85, letterSpacing: '-0.04em', textAlign: mirror ? 'left' : 'right', textShadow: '0 4px 24px rgba(0,0,0,.5)', fontVariantNumeric: 'tabular-nums' }}>{team.score}</div>
      <div style={{ position: 'relative', display: 'flex', color: ink, justifyContent: mirror ? 'flex-start' : 'flex-end', minHeight: px(height, 0.03) }}>
        {team.record && <span style={{ background: '#0006', padding: `${px(height, 0.0056)}px ${px(height, 0.0111)}px`, borderRadius: px(height, 0.0056), fontWeight: 700, fontSize: px(height, 0.0167), letterSpacing: '0.04em', marginRight: px(height, 0.0111) }}>{team.record}</span>}
        {team.shots && <span style={{ background: '#0006', padding: `${px(height, 0.0056)}px ${px(height, 0.0111)}px`, borderRadius: px(height, 0.0056), fontWeight: 700, fontSize: px(height, 0.0167), letterSpacing: '0.04em' }}>SHOTS {team.shots}</span>}
      </div>
    </div>
  );
}

function ScbIndicator({ label, on, dir, height, color }: { label: string; on?: boolean; dir?: 'left' | 'right'; height: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginRight: px(height, 0.0167) }}>
      <span style={{ width: px(height, 0.013), height: px(height, 0.013), borderRadius: '50%', background: on ? color : '#2a2a2a', boxShadow: on ? `0 0 12px ${color}` : 'none', marginRight: px(height, 0.0056) }} />
      <span style={{ color: on ? '#fff' : '#5a5a5a', fontWeight: 700, fontSize: px(height, 0.0167), letterSpacing: '0.06em' }}>{label}{dir === 'left' ? ' ◀' : dir === 'right' ? ' ▶' : ''}</span>
    </div>
  );
}

function ScbFoulRow({ label, count, color, height }: { label: string; count: number; color: string; height: number }) {
  return (
    <div style={{ background: '#111', border: `2px solid ${color}55`, borderRadius: px(height, 0.0093), padding: `${px(height, 0.0111)}px ${px(height, 0.0167)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ color, fontWeight: 800, fontSize: px(height, 0.0222), letterSpacing: '0.08em', filter: 'brightness(1.6)' }}>FOULS · {label}</div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <span key={i} style={{ width: px(height, 0.0167), height: px(height, 0.0278), borderRadius: px(height, 0.0037), background: i < count ? color : '#222', boxShadow: i < count ? `0 0 8px ${color}99` : 'none', marginRight: px(height, 0.0056) }} />
        ))}
        <span style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.026), marginLeft: px(height, 0.006), fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      </div>
    </div>
  );
}

export function StadiumScoreboardWidget({ config, height = 480 }: WidgetProps<StadiumScoreboardCfg>) {
  const c = config ?? {};
  const r = venueStyle(c, { bgColor: '#000' });
  const gv = useGameView(c);
  const isBuilder = useRenderSurface() !== 'player';
  const accent = r.accent.primary;
  const topSponsor = ownCopy(c.topSponsor) ?? (isBuilder ? 'PRESENTED BY · YOUR SPONSOR' : '');
  const bottomSponsor = ownCopy(c.bottomSponsor) ?? (isBuilder ? 'THANK YOU TO OUR BOOSTER CLUB' : '');
  const sponsorDemo = isBuilder && (!ownCopy(c.topSponsor) || !ownCopy(c.bottomSponsor));
  const showFouls = gv.home.fouls !== null || gv.away.fouls !== null;
  const showTimeouts = gv.home.timeouts !== null || gv.away.timeouts !== null;

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `${px(height, 0.037)}px ${px(height, 0.0556)}px`, display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        {topSponsor && (
          <div data-field="topSponsor" style={{ height: px(height, 0.0556), background: 'linear-gradient(90deg, #1a1a1a, #2a2a2a)', borderRadius: px(height, 0.0074), display: 'flex', alignItems: 'center', justifyContent: 'center', color: r.font.color, fontWeight: 700, fontSize: px(height, 0.0222), letterSpacing: '0.2em', marginBottom: px(height, 0.0167), flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden' }}>{topSponsor}</div>
        )}

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `1fr ${px(height, 0.4444)}px 1fr`, columnGap: px(height, 0.0278), alignItems: 'stretch', minHeight: 0 }}>
          <ScbTeamPanel team={gv.home} side="home" sideLabel="HOME" height={height} ink={r.font.color} />
          <div style={{ background: '#0a0a0a', border: `4px solid ${accent}`, borderRadius: px(height, 0.0167), display: 'flex', flexDirection: 'column', marginLeft: px(height, 0.0139), marginRight: px(height, 0.0139) }}>
            <div style={{ background: accent, color: '#000', fontWeight: 800, fontSize: px(height, 0.0296), padding: `${px(height, 0.0074)}px 0`, textAlign: 'center', letterSpacing: '0.06em', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {[gv.period, gv.sportName].filter(Boolean).join(' · ') || '—'}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: `${px(height, 0.013)}px ${px(height, 0.0185)}px`, color: accent }}>
              {gv.clock && <div style={{ fontWeight: 800, fontSize: px(height, 0.1852), lineHeight: 0.85, letterSpacing: '-0.04em', textShadow: `0 0 24px ${accent}99`, fontVariantNumeric: 'tabular-nums' }}>{gv.clock}</div>}
              <div style={{ marginTop: px(height, 0.013), display: 'flex', color: '#fff' }}>
                <ScbIndicator label="BONUS" on={gv.homeBonus} height={height} color={r.accent.secondary} />
                <ScbIndicator label="POSS" on={gv.possession !== null} dir={gv.possession === 'away' ? 'right' : gv.possession === 'home' ? 'left' : undefined} height={height} color={r.accent.secondary} />
                <ScbIndicator label="BONUS" on={gv.awayBonus} height={height} color={r.accent.secondary} />
              </div>
              {showTimeouts && (
                <div style={{ marginTop: px(height, 0.013), color: '#cbd5e1', fontWeight: 700, fontSize: px(height, 0.0204), letterSpacing: '0.08em' }}>TIMEOUTS {gv.home.timeouts ?? '—'} · {gv.away.timeouts ?? '—'}</div>
              )}
            </div>
          </div>
          <ScbTeamPanel team={gv.away} side="away" sideLabel="AWAY" mirror height={height} ink={r.font.color} />
        </div>

        {(showFouls || bottomSponsor) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr', columnGap: px(height, 0.0167), marginTop: px(height, 0.0167), flexShrink: 0 }}>
            {showFouls ? <ScbFoulRow label={gv.home.code} count={gv.home.fouls ?? 0} color={gv.home.color} height={height} /> : <div />}
            <div data-field="bottomSponsor" style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: px(height, 0.0093), display: 'flex', alignItems: 'center', justifyContent: 'center', color: r.font.color, fontWeight: 800, fontSize: px(height, 0.0259), letterSpacing: '0.06em', marginLeft: px(height, 0.0083), marginRight: px(height, 0.0083), whiteSpace: 'nowrap', overflow: 'hidden', visibility: bottomSponsor ? 'visible' : 'hidden' }}>{bottomSponsor}</div>
            {showFouls ? <ScbFoulRow label={gv.away.code} count={gv.away.fouls ?? 0} color={gv.away.color} height={height} /> : <div />}
          </div>
        )}
      </div>
      <SampleStamp height={height} show={gv.demo || sponsorDemo} />
    </div>
  );
}

/* ════════════════ RIBBON TICKER ════════════════ */

interface SegmentEntry { text: string; tint?: string }

export interface RibbonTickerCfg extends BaseCfg, ScoreboardishCfg {
  gameId?: string;
  segments?: SegmentEntry[];
  scrollSpeed?: number;
}

/** A segment tint: 'accent' / 'accent2' map to the brand accents, a hex is used as-is. */
function tintColor(tint: string | undefined, r: ResolvedStyle): string {
  if (!tint || tint === 'text') return r.font.color;
  if (tint === 'accent') return r.accent.primary;
  if (tint === 'accent2') return r.accent.secondary;
  return tint;
}

export function RibbonTickerWidget({ config, live = true, height = 480 }: WidgetProps<RibbonTickerCfg>) {
  const c = config ?? {};
  const r = venueStyle(c, { bgColor: '#000' });
  const gv = useGameView(c);
  const isBuilder = useRenderSurface() !== 'player';
  const typed = Array.isArray(c.segments) ? c.segments.filter((s) => s && ownCopy(s.text)) : [];
  const segments: SegmentEntry[] = typed.length ? typed : isBuilder ? DEMO_TICKER_SEGMENTS : [];
  // ribbon canvas is 7680×480 → height drives px scale on 480 base.
  const dur = animDurationSec(r.anim.speed, c.scrollSpeed && c.scrollSpeed > 0 ? c.scrollSpeed : 40);

  return (
    <div style={frameStyle(r)}>
      <style>{sceneCss(`@keyframes svRibbonMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }`)}</style>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'stretch', overflow: 'hidden' }}>
        <div style={{ width: px(height, 1.5), background: gv.home.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-around', flexShrink: 0 }}>
          <span data-field-jump="home.code" style={{ fontWeight: 800, fontSize: px(height, 0.5), letterSpacing: '-0.04em', lineHeight: 1, marginRight: px(height, 0.0625) }}>{gv.home.code}</span>
          <span style={{ fontWeight: 800, fontSize: px(height, 0.7083), letterSpacing: '-0.04em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{gv.home.score}</span>
        </div>
        <div data-field-jump="segments" style={{ flex: 1, background: '#000', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center' }}>
          {segments.length > 0 && (
            <div style={{ display: 'flex', animation: live && r.anim.on ? `svRibbonMarquee ${dur}s linear infinite` : 'none', whiteSpace: 'nowrap', willChange: 'transform' }}>
              {[...segments, ...segments].map((s, i) => (
                <span key={i} style={{ color: tintColor(s.tint, r), fontWeight: 800, fontSize: px(height, 0.4583), letterSpacing: '-0.02em', marginLeft: px(height, 0.125), marginRight: px(height, 0.125) }}>{s.text}</span>
              ))}
            </div>
          )}
        </div>
        <div style={{ width: px(height, 2.2917), background: 'linear-gradient(90deg, #000, #1a1a1a)', color: r.accent.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `0 ${px(height, 0.0625)}px`, flexShrink: 0 }}>
          {gv.clock && <span style={{ fontWeight: 800, fontSize: px(height, 0.5), letterSpacing: '-0.04em', lineHeight: 1, marginRight: px(height, 0.0833), fontVariantNumeric: 'tabular-nums' }}>{gv.clock}</span>}
          <span style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.3542), opacity: 0.55, whiteSpace: 'nowrap' }}>{gv.period}</span>
        </div>
        <div style={{ width: px(height, 1.5), background: gv.away.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-around', flexShrink: 0 }}>
          <span style={{ fontWeight: 800, fontSize: px(height, 0.7083), letterSpacing: '-0.04em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{gv.away.score}</span>
          <span data-field-jump="away.code" style={{ fontWeight: 800, fontSize: px(height, 0.5), letterSpacing: '-0.04em', lineHeight: 1 }}>{gv.away.code}</span>
        </div>
      </div>
      <SampleStamp height={height} show={gv.demo || (isBuilder && typed.length === 0)} />
    </div>
  );
}

/* ════════════════ RIBBON SPONSOR ════════════════ */

export interface RibbonSponsorCfg extends BaseCfg {
  sponsor?: string;
  tagline?: string;
  cta?: string;
  logoUrl?: string;
  partnerLabel?: string;
  bg?: string;
}

export function RibbonSponsorWidget({ config, height = 480 }: WidgetProps<RibbonSponsorCfg>) {
  const c = config ?? {};
  const bg = c.bg || '#1e3a8a';
  const r = venueStyle(c, { bgColor: bg });
  const isBuilder = useRenderSurface() !== 'player';
  const sponsorOwn = ownSponsorName(c.sponsor, c.tagline);
  const sponsor = sponsorOwn ?? (isBuilder ? 'YOUR SPONSOR' : '');
  const taglineOwn = ownCopy(c.tagline);
  const tagline = taglineOwn ?? (isBuilder ? 'PROUD SUPPORTER OF EAGLES ATHLETICS' : '');
  const cta = ownCopy(c.cta) ?? (isBuilder ? 'visit the booster table' : '');
  const partner = ownCopy(c.partnerLabel) ?? 'OFFICIAL PARTNER';
  const markText = (sponsor || '').slice(0, 3).toUpperCase();

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${px(height, 0.125)}px`, color: r.font.color, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          {(c.logoUrl || markText) && (
            <div style={{ width: px(height, 0.7083), height: px(height, 0.7083), background: '#fff', borderRadius: px(height, 0.05), display: 'flex', alignItems: 'center', justifyContent: 'center', color: bg, fontWeight: 800, fontSize: px(height, 0.2917), marginRight: px(height, 0.1667), overflow: 'hidden', flexShrink: 0 }}>
              {c.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : markText}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            {sponsor && <div data-field="partnerLabel" style={{ fontWeight: 800, fontSize: px(height, 0.1667), letterSpacing: '0.04em', opacity: 0.7 }}>{partner}</div>}
            <div data-field="sponsor" style={{ fontWeight: 800, fontSize: px(height, 0.625), letterSpacing: '-0.04em', lineHeight: 1, whiteSpace: 'nowrap' }}>{sponsor}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 0 }}>
          <div data-field="tagline" style={{ fontWeight: 800, fontSize: px(height, 0.5), letterSpacing: '-0.04em', lineHeight: 1, whiteSpace: 'nowrap' }}>{tagline}</div>
          <div data-field="cta" style={{ fontWeight: 700, fontSize: px(height, 0.125), opacity: 0.8, marginTop: px(height, 0.0292) }}>{cta}</div>
        </div>
      </div>
      <SampleStamp height={height} show={isBuilder && (!sponsorOwn || !taglineOwn)} />
    </div>
  );
}

/* ════════════════ RIBBON FAN SHOUTOUT ════════════════ */

export interface RibbonFanShoutoutCfg extends BaseCfg {
  kind?: string;
  name?: string;
  from?: string;
  icon?: string;
}

export function RibbonFanShoutoutWidget({ config, height = 480 }: WidgetProps<RibbonFanShoutoutCfg>) {
  const c = config ?? {};
  const r = venueStyle(c, { bgColor: '#1a1a1a' });
  const isBuilder = useRenderSurface() !== 'player';
  const nameOwn = ownCopy(c.name);
  const kind = (ownCopy(c.kind) ?? (isBuilder ? 'WELCOME' : '')).toUpperCase();
  const name = nameOwn ?? (isBuilder ? 'CLASS OF 2027' : '');
  const from = ownCopy(c.from) ?? (isBuilder ? 'EAGLES ATHLETICS' : '');
  const icon = ownCopy(c.icon) ?? '🎉';

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `${px(height, 0.0625)}px ${px(height, 0.125)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: r.font.color, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          {name && <div data-field="icon" style={{ fontSize: px(height, 0.625), lineHeight: 1, marginRight: px(height, 0.1042) }}>{icon}</div>}
          <div style={{ minWidth: 0 }}>
            <div data-field="kind" style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.1667), letterSpacing: '0.06em' }}>{kind}</div>
            <div data-field="name" style={{ fontWeight: 800, fontSize: px(height, 0.5417), letterSpacing: '-0.04em', lineHeight: 1, marginTop: px(height, 0.0125), whiteSpace: 'nowrap' }}>{name}</div>
          </div>
        </div>
        {from && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: r.font.color, fontWeight: 800, fontSize: px(height, 0.1875), opacity: 0.7 }}>from</div>
            <div data-field="from" style={{ fontWeight: 800, fontSize: px(height, 0.3333), letterSpacing: '-0.04em', lineHeight: 1.1, whiteSpace: 'nowrap' }}>{from}</div>
          </div>
        )}
      </div>
      <SampleStamp height={height} show={isBuilder && !nameOwn} />
    </div>
  );
}

/* ════════════════ PLAYER CARD ════════════════ */

interface PlayerCfg {
  first?: string;
  last?: string;
  number?: string;
  team?: VenueTeamCfg;
  position?: string;
  years?: string;
  photoUrl?: string;
  statLine?: { label: string; value: string }[] | null;
}
export interface PlayerCardCfg extends BaseCfg {
  dataMode?: DataMode;
  gameId?: string;
  /** Live mode: which side + jersey number to feature from the game roster. */
  side?: 'home' | 'away';
  number?: string;
  /** Manual mode: the typed player. */
  player?: PlayerCfg;
}

const DEMO_PLAYER: PlayerCfg = { first: 'JORDAN', last: 'LEE', number: '3', position: 'GUARD', years: 'SR', statLine: DEMO_STATLINE };

export function PlayerCardWidget({ config, height = 480 }: WidgetProps<PlayerCardCfg>) {
  const c = config ?? {};
  const r = venueStyle(c, { bgColor: '#000' });
  const src = useVenueSource(c.dataMode);
  const side: 'home' | 'away' = c.side === 'away' ? 'away' : 'home';

  let p: PlayerCfg | null = null;
  let team: VenueTeamView;
  let demo = false;
  if (src.kind === 'live' && src.snap) {
    const snap = src.snap;
    const def = findSport(snap.sport);
    team = liveTeamView(snap, side, c.player?.team, (n) => formatScore(def, n));
    const hit = findRosterPlayer(snap.roster, side, c.number);
    if (hit) {
      const n = splitName(hit.name);
      p = { first: n.first, last: n.last, number: String(hit.number ?? ''), position: String(hit.position ?? '').toUpperCase(), photoUrl: hit.photoUrl || undefined, statLine: statLineFromRoster(hit) };
    }
  } else if (src.kind === 'empty') {
    team = typedTeamView(c.player?.team, null, side);
  } else {
    const typed = c.player && (ownCopy(c.player.last) || ownCopy(c.player.first)) ? c.player : null;
    demo = !typed && src.isBuilder;
    p = typed ?? (demo ? DEMO_PLAYER : null);
    team = typedTeamView(c.player?.team, demo ? DEMO_HOME : null, side);
  }
  const statLine = (p?.statLine ?? []).filter((s) => s && (s.label || s.value));
  const years = p?.years ? (/^\d+$/.test(p.years) ? `${p.years} YR` : p.years) : '';

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '60%', background: `linear-gradient(135deg, ${team.color} 0%, ${team.color2 || '#000'} 100%)` }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: '55%', background: 'linear-gradient(225deg, #1a1a1a, #000)', clipPath: 'polygon(15% 0, 100% 0, 100% 100%, 0 100%)', overflow: 'hidden' }}>
          {p?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img data-field-jump="player.photoUrl" src={p.photoUrl} alt="" style={{ position: 'absolute', bottom: 0, right: 0, height: '100%', width: '80%', objectFit: 'contain', objectPosition: 'bottom right' }} />
          ) : src.isBuilder ? (
            <div style={{ position: 'absolute', right: px(height, 0.0556), bottom: px(height, 0.0278), color: '#fff', fontSize: px(height, 0.0222), fontWeight: 700, letterSpacing: '0.08em', opacity: 0.5 }}>{'●'} PLAYER PHOTO</div>
          ) : null}
        </div>
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `${px(height, 0.0741)}px ${px(height, 0.0741)}px`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: r.font.color, boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <TeamMark team={team} size={px(height, 0.1111)} radius={px(height, 0.013)} />
            <div style={{ marginLeft: px(height, 0.0278) }}>
              <div style={{ fontWeight: 800, fontSize: px(height, 0.0315), opacity: 0.7, letterSpacing: '0.1em' }}>{team.name.toUpperCase()}</div>
              {(p?.position || years) && <div style={{ fontWeight: 700, fontSize: px(height, 0.0259), opacity: 0.6 }}>{[p?.position, years].filter(Boolean).join(' · ')}</div>}
            </div>
          </div>
          <div>
            {p ? (
              <>
                <div data-field-jump="player.first" style={{ fontWeight: 800, fontSize: px(height, 0.1574), lineHeight: 0.9, letterSpacing: '-0.04em' }}>{p.first}</div>
                <div data-field-jump="player.last" style={{ fontWeight: 800, fontSize: px(height, 0.2222), lineHeight: 0.9, letterSpacing: '-0.05em' }}>{p.last}</div>
                {p.number && (
                  <div style={{ display: 'flex', alignItems: 'baseline', marginTop: px(height, 0.0222) }}>
                    <span style={{ fontWeight: 800, fontSize: px(height, 0.1852), color: r.accent.primary, textShadow: `0 0 24px ${r.accent.primary}99`, lineHeight: 1 }}>#{p.number}</span>
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontWeight: 800, fontSize: px(height, 0.2222), lineHeight: 0.9, opacity: 0.35 }}>—</div>
            )}
          </div>
          {statLine.length > 0 ? (
            <div data-field-jump="player.statLine" style={{ background: '#0006', border: `2px solid ${team.color}`, borderRadius: px(height, 0.0167), padding: `${px(height, 0.0222)}px ${px(height, 0.0278)}px`, display: 'flex', justifyContent: 'space-between', maxWidth: px(height, 1.0185) }}>
              {statLine.slice(0, 6).map((s, i) => (
                <div key={i} style={{ marginRight: i === Math.min(statLine.length, 6) - 1 ? 0 : px(height, 0.0463) }}>
                  <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.0204), letterSpacing: '0.08em' }}>{String(s.label).toUpperCase()}</div>
                  <div style={{ fontWeight: 800, fontSize: px(height, 0.0741), lineHeight: 1 }}>{s.value}</div>
                </div>
              ))}
            </div>
          ) : <div />}
        </div>
      </div>
      <SampleStamp height={height} show={demo || src.kind === 'demo'} />
    </div>
  );
}

/* ════════════════ STARTING LINEUP ════════════════ */

export interface StartingLineupCfg extends BaseCfg {
  dataMode?: DataMode;
  gameId?: string;
  side?: 'home' | 'away';
  /** How many starters to show (live mode); default by sport. */
  count?: number;
  title?: string;
  team?: VenueTeamCfg;
  lineup?: LineupPlayer[];
}

export function StartingLineupWidget({ config, height = 480 }: WidgetProps<StartingLineupCfg>) {
  const c = config ?? {};
  const r = venueStyle(c, { bgColor: '#000' });
  const src = useVenueSource(c.dataMode);
  const side: 'home' | 'away' = c.side === 'away' ? 'away' : 'home';

  let team: VenueTeamView;
  let players: LineupPlayer[];
  let demo = false;
  if (src.kind === 'live' && src.snap) {
    const snap = src.snap;
    const def = findSport(snap.sport);
    team = liveTeamView(snap, side, c.team, (n) => formatScore(def, n));
    const count = typeof c.count === 'number' && c.count > 0 ? c.count : defaultLineupCount(snap.sport);
    players = lineupFromRoster(snap.roster, side, count);
  } else if (src.kind === 'empty') {
    team = typedTeamView(c.team, null, side);
    players = [];
  } else {
    const typed = Array.isArray(c.lineup) ? c.lineup.filter((p) => p && (ownCopy(p.last) || ownCopy(p.first) || ownCopy(p.number))) : [];
    demo = typed.length === 0 && src.isBuilder;
    players = typed.length ? typed : demo ? DEMO_LINEUP : [];
    team = typedTeamView(c.team, demo ? DEMO_HOME : null, side);
  }
  const shown = players.slice(0, 12);
  const perRow = shown.length > 6 ? Math.ceil(shown.length / 2) : Math.max(1, shown.length);
  const title = ownCopy(c.title) ?? 'STARTING LINEUP';

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), background: `linear-gradient(135deg, ${team.color}33 0%, #000 60%)`, boxSizing: 'border-box' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: px(height, 0.037) }}>
          <div>
            <div data-field="title" style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.12em' }}>{title}</div>
            <div style={{ color: r.font.color, fontWeight: 800, fontSize: px(height, 0.1019), letterSpacing: '-0.02em', lineHeight: 1 }}>{team.name}</div>
          </div>
          <TeamMark team={team} size={px(height, 0.1296)} radius={px(height, 0.0222)} />
        </div>
        <div data-field-jump="lineup" style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${perRow}, 1fr)`, rowGap: px(height, 0.0167) }}>
          {shown.map((p, i) => (
            <div key={i} style={{ background: `linear-gradient(180deg, ${team.color}22, #000)`, border: `2px solid ${team.color}55`, borderRadius: px(height, 0.0167), padding: `${px(height, 0.0259)}px ${px(height, 0.0204)}px`, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', overflow: 'hidden', marginRight: (i + 1) % perRow === 0 ? 0 : px(height, 0.0167) }}>
              <div style={{ position: 'absolute', top: px(height, -0.0185), right: px(height, -0.0185), fontWeight: 800, fontSize: px(height, 0.1852), color: `${team.color}33`, lineHeight: 1 }}>{p.number}</div>
              <div style={{ width: px(height, 0.1296), height: px(height, 0.1667), borderRadius: px(height, 0.013), background: '#1a1a1a', border: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a5a5a', fontSize: px(height, 0.0556), marginBottom: px(height, 0.013), overflow: 'hidden' }}>
                {p.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : p.number ? <span style={{ color: '#94a3b8', fontWeight: 800 }}>#{p.number}</span> : '👤'}
              </div>
              {p.position && <div style={{ color: r.accent.primary, fontWeight: 700, fontSize: px(height, 0.0222), letterSpacing: '0.1em', marginBottom: px(height, 0.013) }}>{p.position}</div>}
              <div style={{ color: r.font.color, fontWeight: 800, fontSize: px(height, 0.0333), lineHeight: 1, textAlign: 'center', marginBottom: px(height, 0.013) }}>{p.first}{p.first ? <br /> : null}{p.last}</div>
              {p.detail && <div style={{ color: '#9aa3b2', fontWeight: 600, fontSize: px(height, 0.0167) }}>{p.detail}</div>}
            </div>
          ))}
        </div>
      </div>
      <SampleStamp height={height} show={demo || src.kind === 'demo'} />
    </div>
  );
}

/* ════════════════ STAT COMPARISON ════════════════ */

export interface StatComparisonCfg extends BaseCfg {
  dataMode?: DataMode;
  gameId?: string;
  /** 'game' = the bound game's head-to-head stats; 'manual' = the rows below. */
  statsSource?: 'game' | 'manual';
  home?: VenueTeamCfg;
  away?: VenueTeamCfg;
  scope?: string;
  stats?: StatPairRow[];
}

export function StatComparisonWidget({ config, height = 480 }: WidgetProps<StatComparisonCfg>) {
  const c = config ?? {};
  const r = venueStyle(c, { bgColor: '#000' });
  const src = useVenueSource(c.dataMode);

  let home: VenueTeamView;
  let away: VenueTeamView;
  let rows: StatPairRow[];
  let demo = false;
  const typedRows = Array.isArray(c.stats) ? c.stats.filter((s) => s && ownCopy(s.label)) : [];
  if (src.kind === 'live' && src.snap) {
    const snap = src.snap;
    const def = findSport(snap.sport);
    const fmt = (n: number) => formatScore(def, n);
    home = liveTeamView(snap, 'home', c.home, fmt);
    away = liveTeamView(snap, 'away', c.away, fmt);
    rows = c.statsSource === 'manual' ? typedRows : gameStatPairs(def?.stats, snap.stats || {});
  } else if (src.kind === 'empty') {
    home = typedTeamView(c.home, null, 'home');
    away = typedTeamView(c.away, null, 'away');
    rows = c.statsSource === 'manual' ? typedRows : [];
  } else {
    demo = typedRows.length === 0 && src.isBuilder;
    rows = typedRows.length ? typedRows : demo ? DEMO_COMPARE : [];
    home = typedTeamView(c.home, demo ? DEMO_HOME : null, 'home');
    away = typedTeamView(c.away, demo ? DEMO_AWAY : null, 'away');
  }
  const liveStats = src.kind === 'live' && c.statsSource !== 'manual';
  const scope = ownCopy(c.scope) ?? (liveStats ? 'THIS GAME' : 'SEASON AVERAGES');
  const numOf = (v: number | string) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: px(height, 0.037) }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <div style={{ color: home.color, fontWeight: 800, fontSize: px(height, 0.0741), marginRight: px(height, 0.0167), filter: 'brightness(1.4)' }}>{home.code}</div>
            <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.0315), marginRight: px(height, 0.0167) }}>vs</div>
            <div style={{ color: away.color, fontWeight: 800, fontSize: px(height, 0.0741), filter: 'brightness(1.4)' }}>{away.code}</div>
          </div>
          <div data-field="scope" style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.0315), letterSpacing: '0.08em' }}>{scope.toUpperCase()}</div>
        </div>
        <div data-field-jump="stats" style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((s, i) => {
            const h = numOf(s.home);
            const a = numOf(s.away);
            const total = (h ?? 0) + (a ?? 0);
            const hPct = total > 0 && h !== null ? (h / total) * 100 : 50;
            const hWin = h !== null && a !== null && h > a;
            const aWin = h !== null && a !== null && a > h;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: `${px(height, 0.1296)}px 1fr ${px(height, 0.1296)}px`, alignItems: 'center', columnGap: px(height, 0.0222), marginBottom: i === rows.length - 1 ? 0 : px(height, 0.0167) }}>
                <div style={{ color: hWin ? r.accent.primary : r.font.color, fontWeight: 800, fontSize: px(height, 0.05), textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.home}</div>
                <div>
                  <div style={{ textAlign: 'center', color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.0222), letterSpacing: '0.1em', marginBottom: px(height, 0.0056) }}>{String(s.label).toUpperCase()}</div>
                  <div style={{ height: px(height, 0.037), display: 'flex', borderRadius: px(height, 0.0074), overflow: 'hidden', border: '1px solid #2a2a2a' }}>
                    <div style={{ width: `${hPct}%`, background: home.color, transition: 'width .3s' }} />
                    <div style={{ width: `${100 - hPct}%`, background: away.color }} />
                  </div>
                </div>
                <div style={{ color: aWin ? r.accent.primary : r.font.color, fontWeight: 800, fontSize: px(height, 0.05), textAlign: 'left', fontVariantNumeric: 'tabular-nums' }}>{s.away}</div>
              </div>
            );
          })}
        </div>
      </div>
      <SampleStamp height={height} show={demo || src.kind === 'demo'} />
    </div>
  );
}

/* ════════════════ OUT-OF-TOWN SCORES (manual) ════════════════ */

export interface OutOfTownScoresCfg extends BaseCfg {
  eyebrow?: string;
  title?: string;
  games?: OotGame[];
  /** ISO time the rows were last edited — written by the Properties panel. */
  asOf?: string;
}

function OotRow({ code, score, color, winner, height, ink, accent }: { code: string; score: number | string; color: string; winner: boolean; height: number; ink: string; accent: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <span style={{ width: px(height, 0.0074), height: px(height, 0.0074), borderRadius: '50%', background: color, marginRight: px(height, 0.0093) }} />
      <span style={{ color: ink, fontWeight: winner ? 800 : 600, fontSize: px(height, 0.0278), width: px(height, 0.0741) }}>{code}</span>
      <span style={{ color: winner ? accent : '#cfd8e3', fontWeight: winner ? 800 : 600, fontSize: px(height, 0.0315), fontVariantNumeric: 'tabular-nums' }}>{score}</span>
    </div>
  );
}

const isFinal = (status: string) => /^f(inal)?\b/i.test(status.trim());

export function OutOfTownScoresWidget({ config, height = 480 }: WidgetProps<OutOfTownScoresCfg>) {
  const c = config ?? {};
  const r = venueStyle(c, { bgColor: '#0a0a0a' });
  const isBuilder = useRenderSurface() !== 'player';
  const typed = Array.isArray(c.games) ? c.games.filter((g) => g && g.home && g.away && (ownCopy(g.home.code) || ownCopy(g.away.code))) : [];
  const demo = typed.length === 0 && isBuilder;
  const games = typed.length ? typed : demo ? DEMO_OOT : [];
  const asOf = asOfLabel(c.asOf);

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0556), boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: px(height, 0.0278) }}>
          <div>
            <div data-field="eyebrow" style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.12em' }}>{ownCopy(c.eyebrow) ?? 'AROUND THE CONFERENCE'}</div>
            <div data-field="title" style={{ color: r.font.color, fontWeight: 800, fontSize: px(height, 0.0815), letterSpacing: '-0.02em' }}>{ownCopy(c.title) ?? 'Scores'}</div>
          </div>
          {asOf && <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.0222), letterSpacing: '0.06em' }}>{asOf}</div>}
        </div>
        <div data-field-jump="games" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: px(height, 0.0167), rowGap: px(height, 0.0167) }}>
          {games.slice(0, 8).map((g, i) => {
            const hs = Number(g.home.score);
            const as = Number(g.away.score);
            const fin = isFinal(String(g.status || ''));
            return (
              <div key={i} style={{ background: '#11161e', border: '1px solid #2a2a2a', borderRadius: px(height, 0.013), padding: `${px(height, 0.0185)}px ${px(height, 0.0241)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ marginBottom: px(height, 0.0056) }}>
                    <OotRow code={g.away.code} score={g.away.score} color={g.away.color} winner={fin && as > hs} height={height} ink={r.font.color} accent={r.accent.primary} />
                  </div>
                  <OotRow code={g.home.code} score={g.home.score} color={g.home.color} winner={fin && hs > as} height={height} ink={r.font.color} accent={r.accent.primary} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  {/* The operator's own status text, as typed — this widget
                      has no live source, so it never decorates a row "LIVE". */}
                  <div style={{ color: fin ? '#9aa3b2' : r.accent.primary, fontWeight: 700, fontSize: px(height, 0.0204), letterSpacing: '0.06em' }}>{String(g.status || '').toUpperCase()}</div>
                  <div style={{ color: '#9aa3b2', fontWeight: 600, fontSize: px(height, 0.0167) }}>{g.note}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <SampleStamp height={height} show={demo} />
    </div>
  );
}

/* ════════════════ FAN CAM (was "Kiss Cam") ════════════════ */

export interface KissCamCfg extends BaseCfg {
  kind?: string;
  tone?: string;
  /** frame · heart · star · circle */
  shape?: string;
  sponsor?: string;
}

const CAM_SHAPES: Record<string, string> = {
  heart: 'M960 250 C 760 80, 380 150, 380 460 C 380 760, 760 900, 960 980 C 1160 900, 1540 760, 1540 460 C 1540 150, 1160 80, 960 250 Z',
  star: 'M960 110 L1092 400 L1400 430 L1166 640 L1236 950 L960 790 L684 950 L754 640 L520 430 L828 400 Z',
  circle: 'M960 120 A 420 420 0 1 1 959.9 120 Z',
  frame: 'M260 170 H1660 Q1720 170 1720 230 V850 Q1720 910 1660 910 H260 Q200 910 200 850 V230 Q200 170 260 170 Z',
};

export function KissCamWidget({ config, height = 480 }: WidgetProps<KissCamCfg>) {
  const c = config ?? {};
  const tone = c.tone || '#2563eb';
  const r = venueStyle(c, { bgColor: 'transparent', accentColor: tone });
  const isBuilder = useRenderSurface() !== 'player';
  const kind = (ownCopy(c.kind) ?? 'FAN CAM').toUpperCase();
  const shape = CAM_SHAPES[String(c.shape || 'frame')] ? String(c.shape || 'frame') : 'frame';
  const path = CAM_SHAPES[shape];
  const sponsor = ownCopy(c.sponsor) ?? '';
  const maskId = `svCamCut-${shape}`;

  return (
    <div style={{ ...frameStyle(r), backgroundColor: 'transparent', backgroundImage: 'none', padding: 0 }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
        {/* The window is TRANSPARENT: put the camera / stream zone beneath
            this one. Only the builder shows where the feed will sit — a real
            screen never claims a live feed it does not have. */}
        {isBuilder && (
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'linear-gradient(135deg, #1e293b, #0f172a)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.28)', fontSize: px(height, 0.06), fontWeight: 800, letterSpacing: '0.1em' }}>CAMERA FEED</div>
        )}
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}>
          <defs>
            <mask id={maskId}>
              <rect width="1920" height="1080" fill="white" />
              <path d={path} fill="black" />
            </mask>
          </defs>
          <rect width="1920" height="1080" fill={tone} mask={`url(#${maskId})`} />
          <path d={path} fill="none" stroke="#fff" strokeWidth="14" />
        </svg>
        <div data-field="kind" style={{ position: 'absolute', top: px(height, 0.037), left: '50%', transform: 'translateX(-50%)', background: tone, padding: `${px(height, 0.013)}px ${px(height, 0.0463)}px`, borderRadius: px(height, 0.013), color: '#fff', fontWeight: 800, fontSize: px(height, 0.0593), letterSpacing: '0.08em', boxShadow: '0 8px 30px #00000055', whiteSpace: 'nowrap' }}>
          {kind}
        </div>
        {sponsor && <div data-field="sponsor" style={{ position: 'absolute', bottom: px(height, 0.037), left: '50%', transform: 'translateX(-50%)', background: '#0008', padding: `${px(height, 0.013)}px ${px(height, 0.0278)}px`, borderRadius: px(height, 0.0093), color: '#fff', fontWeight: 700, fontSize: px(height, 0.0315), letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{sponsor}</div>}
      </div>
    </div>
  );
}

/* ════════════════ CROWD METER (was "Noise Meter") ════════════════ */

export interface NoiseMeterCfg extends BaseCfg {
  prompt?: string;
  headline?: string;
  /** Legacy — the meter is an animation; kept so old zones still render. */
  target?: number;
  /** Peak fill of the animation, 20–100. NOT a measurement. */
  level?: number;
}

/**
 * An ANIMATION that hypes the crowd. There is no microphone or sound-level
 * input anywhere in the product, so it shows no decibel number and never
 * says LIVE (audit F28: the old meter printed "87 · DB · LIVE" forever).
 */
export function NoiseMeterWidget({ config, live = true, height = 480 }: WidgetProps<NoiseMeterCfg>) {
  const c = config ?? {};
  const r = venueStyle(c, { bgColor: '#0a0a0a', accentColor: '#ff5664', accentColor2: '#ffd23a' });
  const peak = Math.max(20, Math.min(100, typeof c.level === 'number' ? c.level : 90));
  const animate = live && r.anim.on;
  const dur = animDurationSec(r.anim.speed, 1.2);
  const bars = 30;
  const onBars = Math.round((peak / 100) * bars);

  return (
    <div style={frameStyle(r)}>
      <style>{sceneCss(`@keyframes svCrowdSurge { 0%, 100% { transform: scaleY(0.55); } 50% { transform: scaleY(1); } }`)}</style>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        <div style={{ textAlign: 'center' }}>
          <div data-field="headline" style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.0444), letterSpacing: '0.1em', textShadow: `0 0 24px ${r.accent.primary}99` }}>{ownCopy(c.headline) ?? 'MAKE SOME NOISE'}</div>
          <div data-field="prompt" style={{ color: r.font.color, fontWeight: 800, fontSize: px(height, 0.1852), letterSpacing: '-0.04em', lineHeight: 1 }}>{ownCopy(c.prompt) ?? 'Get LOUD!'}</div>
        </div>
        <div style={{ flex: 1, marginTop: px(height, 0.037), display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', height: px(height, 0.3519), transformOrigin: 'bottom center', animation: animate ? `svCrowdSurge ${dur}s ease-in-out infinite` : 'none' }}>
            {Array.from({ length: bars }).map((_, i) => {
              const v = (i / (bars - 1)) * 100;
              const on = i < onBars;
              const color = v < 60 ? '#22c55e' : v < 85 ? '#f59e0b' : r.accent.primary;
              return (
                <div key={i} style={{ flex: 1, height: `${((i + 1) / bars) * 100}%`, background: on ? color : '#1a1a1a', borderRadius: px(height, 0.0037), boxShadow: on ? `0 0 14px ${color}aa` : 'none', marginRight: i === bars - 1 ? 0 : px(height, 0.0074) }} />
              );
            })}
          </div>
          <div style={{ width: px(height, 0.3148), textAlign: 'right' }}>
            <div style={{ color: r.accent.secondary, fontWeight: 800, fontSize: px(height, 0.0741), letterSpacing: '0.02em', lineHeight: 1 }}>LOUDER!</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ IN-GAME PROMO ════════════════ */

export interface InGamePromoCfg extends BaseCfg {
  kicker?: string;
  title?: string;
  subtitle?: string;
  sections?: string[];
  cta?: string;
  accent?: string;
}

export function InGamePromoWidget({ config, height = 480 }: WidgetProps<InGamePromoCfg>) {
  const c = config ?? {};
  const accent = c.accent || '#ffd23a';
  const r = venueStyle(c, { bgColor: '#1a0a0a', accentColor: accent });
  const isBuilder = useRenderSurface() !== 'player';
  const titleOwn = ownCopy(c.title);
  const kicker = ownCopy(c.kicker) ?? (isBuilder ? 'BROUGHT TO YOU BY YOUR SPONSOR' : '');
  const title = titleOwn ?? (isBuilder ? 'T-SHIRT TOSS' : '');
  const subtitle = ownCopy(c.subtitle) ?? (isBuilder ? 'Look up · catch a shirt · show your school spirit' : '');
  const sectionsTyped = Array.isArray(c.sections) ? c.sections.filter((s) => ownCopy(s)) : [];
  const sections = sectionsTyped.length ? sectionsTyped : isBuilder ? ['HOME SIDE', 'STUDENT SECTION', 'VISITOR SIDE'] : [];
  const cta = ownCopy(c.cta) ?? (isBuilder ? 'NEXT TOSS · HALFTIME' : '');
  const a = r.accent.primary;

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: r.font.color, boxSizing: 'border-box' }}>
        <div>
          <div data-field="kicker" style={{ color: a, fontWeight: 800, fontSize: px(height, 0.037), letterSpacing: '0.12em', textShadow: `0 0 24px ${a}99` }}>{kicker.toUpperCase()}</div>
          <div data-field="title" style={{ fontWeight: 800, fontSize: px(height, 0.2778), lineHeight: 0.9, letterSpacing: '-0.04em', marginTop: px(height, 0.013) }}>{title}</div>
          <div data-field="subtitle" style={{ color: '#cfd8e3', fontWeight: 700, fontSize: px(height, 0.0463), marginTop: px(height, 0.0278), maxWidth: px(height, 1.1111) }}>{subtitle}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div data-field-jump="sections" style={{ display: 'flex', flexWrap: 'wrap' }}>
            {sections.map((s, i) => (
              <div key={i} style={{ background: `${a}22`, border: `2px solid ${a}`, padding: `${px(height, 0.0167)}px ${px(height, 0.0259)}px`, borderRadius: px(height, 0.013), color: a, fontWeight: 800, fontSize: px(height, 0.0444), marginRight: i === sections.length - 1 ? 0 : px(height, 0.0222), marginTop: px(height, 0.0111) }}>{s}</div>
            ))}
          </div>
          {cta && <div data-field="cta" style={{ background: a, color: '#0b0c0e', padding: `${px(height, 0.0222)}px ${px(height, 0.037)}px`, borderRadius: px(height, 0.013), fontWeight: 800, fontSize: px(height, 0.0556), letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>{cta}</div>}
        </div>
      </div>
      <SampleStamp height={height} show={isBuilder && !titleOwn} />
    </div>
  );
}

/* ════════════════ SPONSOR TAKEOVER ════════════════ */

export interface SponsorTakeoverCfg extends BaseCfg {
  sponsor?: string;
  partnerLine?: string;
  tagline?: string;
  body?: string;
  cta?: string;
  logoUrl?: string;
  bg?: string;
}

export function SponsorTakeoverWidget({ config, height = 480 }: WidgetProps<SponsorTakeoverCfg>) {
  const c = config ?? {};
  const tone = c.bg || '#0a4a8a';
  const r = venueStyle(c, { bgColor: tone });
  const isBuilder = useRenderSurface() !== 'player';
  const sponsorOwn = ownSponsorName(c.sponsor, c.tagline);
  const sponsor = sponsorOwn ?? (isBuilder ? 'YOUR SPONSOR' : '');
  const partnerLine = ownCopy(c.partnerLine) ?? (isBuilder ? 'PROUD PARTNER · EAGLES ATHLETICS' : '');
  const tagline = ownCopy(c.tagline) ?? (isBuilder ? 'Proud supporter of student athletes.' : '');
  const body = ownCopy(c.body) ?? (isBuilder ? 'Thank you for supporting our teams all season long.' : '');
  const cta = ownCopy(c.cta) ?? (isBuilder ? 'yoursponsor.com' : '');
  const mark = (sponsor || '').slice(0, 2).toUpperCase();

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.1111), color: r.font.color, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', minHeight: px(height, 0.04) }}>
          {partnerLine && <div style={{ width: px(height, 0.0167), height: px(height, 0.0167), borderRadius: '50%', background: r.font.color, marginRight: px(height, 0.0278) }} />}
          <div data-field="partnerLine" style={{ fontWeight: 800, fontSize: px(height, 0.0407), letterSpacing: '0.12em', opacity: 0.85 }}>{partnerLine}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {(c.logoUrl || mark) && (
            <div style={{ width: px(height, 0.3519), height: px(height, 0.3519), background: '#fff', borderRadius: px(height, 0.0278), display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone, fontWeight: 800, fontSize: px(height, 0.1574), marginRight: px(height, 0.0741), flexShrink: 0, overflow: 'hidden' }}>
              {c.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : mark}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div data-field="sponsor" style={{ fontWeight: 800, fontSize: px(height, 0.2222), letterSpacing: '-0.04em', lineHeight: 0.95 }}>{sponsor}</div>
            <div data-field="tagline" style={{ fontWeight: 700, fontSize: px(height, 0.0556), opacity: 0.85, marginTop: px(height, 0.0167) }}>{tagline}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div data-field="body" style={{ fontWeight: 700, fontSize: px(height, 0.0426), opacity: 0.85, maxWidth: px(height, 1.0185), lineHeight: 1.25 }}>{body}</div>
          {cta && <div data-field="cta" style={{ background: '#fff', color: tone, padding: `${px(height, 0.0222)}px ${px(height, 0.0333)}px`, borderRadius: px(height, 0.013), fontWeight: 800, fontSize: px(height, 0.0389), whiteSpace: 'nowrap' }}>{cta}</div>}
        </div>
      </div>
      <SampleStamp height={height} show={isBuilder && !sponsorOwn} />
    </div>
  );
}

/* ════════════════ HOME SCHEDULE (manual) ════════════════ */

export interface HomeScheduleCfg extends BaseCfg {
  eyebrow?: string;
  team?: VenueTeamCfg;
  games?: HomeGameRow[];
}

export function HomeScheduleWidget({ config, height = 480 }: WidgetProps<HomeScheduleCfg>) {
  const c = config ?? {};
  const r = venueStyle(c, { bgColor: '#000' });
  const isBuilder = useRenderSurface() !== 'player';
  const typed = Array.isArray(c.games) ? c.games.filter((g) => g && (ownCopy(g.date) || ownCopy(g.opp?.name))) : [];
  const demo = typed.length === 0 && isBuilder;
  const games = typed.length ? typed : demo ? DEMO_HOME_GAMES : [];
  const demoTeam = isBuilder && !hasTypedTeam(c.team);
  const team = typedTeamView(c.team, demoTeam ? DEMO_HOME : null, 'home');
  const splitDate = (d: string) => { const i = d.indexOf(','); return i < 0 ? [d, ''] : [d.slice(0, i), d.slice(i + 1).trim()]; };

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: px(height, 0.0278) }}>
          <div>
            <div data-field="eyebrow" style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.12em' }}>{ownCopy(c.eyebrow) ?? 'UPCOMING HOME GAMES'}</div>
            <div style={{ color: r.font.color, fontWeight: 800, fontSize: px(height, 0.0889), letterSpacing: '-0.02em' }}>{team.name === 'HOME' ? 'Home schedule' : `${team.name} schedule`}</div>
          </div>
          <TeamMark team={team} size={px(height, 0.1111)} radius={px(height, 0.0222)} />
        </div>
        <div data-field-jump="games" style={{ display: 'flex', flexDirection: 'column' }}>
          {games.slice(0, 5).map((g, i) => {
            const [d1, d2] = splitDate(String(g.date || ''));
            return (
              <div key={i} style={{ background: '#11161e', border: '1px solid #2a2a2a', borderRadius: px(height, 0.013), padding: `${px(height, 0.0222)}px ${px(height, 0.0296)}px`, display: 'grid', gridTemplateColumns: `${px(height, 0.1667)}px 1fr 1fr ${px(height, 0.2037)}px`, alignItems: 'center', columnGap: px(height, 0.0185), marginBottom: i === Math.min(games.length, 5) - 1 ? 0 : px(height, 0.013) }}>
                <div>
                  <div style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.06em' }}>{d1}</div>
                  <div style={{ color: r.font.color, fontWeight: 800, fontSize: px(height, 0.0426), lineHeight: 1 }}>{d2}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ width: px(height, 0.0593), height: px(height, 0.0593), borderRadius: px(height, 0.0111), background: '#fff', color: g.opp?.color || '#334155', fontWeight: 800, fontSize: px(height, 0.0222), display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: px(height, 0.0167) }}>{g.opp?.code}</div>
                  <div>
                    <div style={{ color: '#9aa3b2', fontWeight: 600, fontSize: px(height, 0.0185) }}>vs</div>
                    <div style={{ color: r.font.color, fontWeight: 700, fontSize: px(height, 0.0333) }}>{g.opp?.name}</div>
                  </div>
                </div>
                <div style={{ color: '#cfd8e3', fontWeight: 600, fontSize: px(height, 0.0222) }}>{g.note}</div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: r.font.color, fontWeight: 800, fontSize: px(height, 0.0333) }}>{g.time}</div>
                  <div style={{ color: r.accent.secondary, fontWeight: 700, fontSize: px(height, 0.0167) }}>{g.tix}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <SampleStamp height={height} show={demo || demoTeam} />
    </div>
  );
}

/* ════════════════ STANDINGS BOARD (manual) ════════════════ */

export interface StandingsBoardCfg extends BaseCfg {
  team?: VenueTeamCfg;
  scope?: string;
  rows?: StandingRow[];
  asOf?: string;
}

export function StandingsBoardWidget({ config, height = 480 }: WidgetProps<StandingsBoardCfg>) {
  const c = config ?? {};
  const r = venueStyle(c, { bgColor: '#000' });
  const isBuilder = useRenderSurface() !== 'player';
  const typed = Array.isArray(c.rows) ? c.rows.filter((row) => row && (ownCopy(row.name) || ownCopy(row.code))) : [];
  const demo = typed.length === 0 && isBuilder;
  const rows = typed.length ? typed : demo ? DEMO_STANDINGS : [];
  const highlight = ownCopy(c.team?.code) ?? (demo ? DEMO_HOME.code : '');
  const highlightColor = ownCopy(c.team?.color) ?? (demo ? DEMO_HOME.color : r.accent.primary);
  const cols = `${px(height, 0.0741)}px 1fr ${px(height, 0.0926)}px ${px(height, 0.0926)}px ${px(height, 0.0926)}px ${px(height, 0.0926)}px ${px(height, 0.0926)}px ${px(height, 0.1481)}px`;
  const shown = rows.slice(0, 8);
  const asOf = asOfLabel(c.asOf);

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: px(height, 0.0278) }}>
          <div>
            <div data-field="scope" style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.12em' }}>{(ownCopy(c.scope) ?? 'CONFERENCE STANDINGS').toUpperCase()}</div>
            <div style={{ color: r.font.color, fontWeight: 800, fontSize: px(height, 0.0889), letterSpacing: '-0.02em' }}>Standings</div>
          </div>
          {asOf && <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.0222) }}>{asOf}</div>}
        </div>
        <div data-field-jump="rows" style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: px(height, 0.013), overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, padding: `${px(height, 0.0167)}px ${px(height, 0.0241)}px`, borderBottom: '1px solid #2a2a2a', color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.0185), letterSpacing: '0.08em' }}>
            <div>RK</div><div>TEAM</div><div>W</div><div>L</div><div>PCT</div><div>GB</div><div>STRK</div><div>LAST 10</div>
          </div>
          {shown.map((row, i) => {
            const me = !!highlight && row.code === highlight;
            const strk = String(row.strk || '');
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: cols, padding: `${px(height, 0.0167)}px ${px(height, 0.0241)}px`, borderBottom: i < shown.length - 1 ? '1px solid #1a1a1a' : 'none', color: me ? r.accent.primary : r.font.color, background: me ? `${highlightColor}22` : 'transparent', fontWeight: me ? 800 : 600, fontSize: px(height, 0.0278), alignItems: 'center' }}>
                <div style={{ color: i < 3 ? r.accent.primary : '#9aa3b2', fontWeight: 800 }}>{row.rank}</div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ width: px(height, 0.013), height: px(height, 0.013), borderRadius: '50%', background: row.color, marginRight: px(height, 0.013) }} />
                  <span>{row.name}</span>
                </div>
                <div>{row.w}</div><div>{row.l}</div>
                <div>{row.pct}</div>
                <div>{row.gb}</div>
                <div style={{ color: strk[0] === 'W' ? '#22c55e' : strk[0] === 'L' ? r.accent.secondary : r.font.color, fontWeight: 800 }}>{strk}</div>
                <div>{row.last10}</div>
              </div>
            );
          })}
        </div>
      </div>
      <SampleStamp height={height} show={demo} />
    </div>
  );
}

/* ════════════════ CONCESSION WAITS (manual) ════════════════ */

export interface ConcessionWaitsCfg extends BaseCfg {
  eyebrow?: string;
  title?: string;
  stands?: ConcessionStand[];
  asOf?: string;
}

export function ConcessionWaitsWidget({ config, height = 480 }: WidgetProps<ConcessionWaitsCfg>) {
  const c = config ?? {};
  const r = venueStyle(c, { bgColor: '#0a0a0a' });
  const isBuilder = useRenderSurface() !== 'player';
  const typed = Array.isArray(c.stands) ? c.stands.filter((s) => s && ownCopy(s.name)) : [];
  const demo = typed.length === 0 && isBuilder;
  const stands = typed.length ? typed : demo ? DEMO_STANDS : [];
  const asOf = asOfLabel(c.asOf);

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0556), boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div data-field="eyebrow" style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.12em' }}>{ownCopy(c.eyebrow) ?? 'ESTIMATED WAIT TIMES'}</div>
          {asOf && <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.0222) }}>{asOf}</div>}
        </div>
        <div data-field="title" style={{ color: r.font.color, fontWeight: 800, fontSize: px(height, 0.0833), letterSpacing: '-0.02em' }}>{ownCopy(c.title) ?? 'Grab a bite'}</div>
        <div data-field-jump="stands" style={{ marginTop: px(height, 0.0278), display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', columnGap: px(height, 0.0167), rowGap: px(height, 0.0167) }}>
          {stands.slice(0, 6).map((s, i) => {
            const w = Number(s.wait);
            const tone = !Number.isFinite(w) ? '#9aa3b2' : w <= 5 ? '#22c55e' : w <= 12 ? '#f59e0b' : r.accent.secondary;
            return (
              <div key={i} style={{ background: '#11161e', border: '1px solid #2a2a2a', borderRadius: px(height, 0.013), padding: `${px(height, 0.0222)}px ${px(height, 0.0259)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <div style={{ fontSize: px(height, 0.05), marginRight: px(height, 0.0167) }}>{s.icon}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: r.font.color, fontWeight: 800, fontSize: px(height, 0.0315) }}>{s.name}</div>
                    <div style={{ color: '#9aa3b2', fontWeight: 600, fontSize: px(height, 0.0204) }}>{s.where}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: tone, fontWeight: 800, fontSize: px(height, 0.0722), lineHeight: 1 }}>{s.wait}</div>
                  <div style={{ color: tone, fontWeight: 700, fontSize: px(height, 0.0204), letterSpacing: '0.04em' }}>MIN WAIT</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <SampleStamp height={height} show={demo} />
    </div>
  );
}

/* ════════════════ GATE WAYFINDING ════════════════ */

export interface GateWayfindingCfg extends BaseCfg {
  sectionLabel?: string;
  gateLabel?: string;
  section?: string;
  gate?: string;
  distance?: string;
  directions?: string;
  /** A link the QR code opens (seat map, tickets, event page). Empty = no code. */
  qrUrl?: string;
  qrTitle?: string;
  qrSubtitle?: string;
}

/** A real, scannable QR (the `qrcode` lib, generated on the device — see
 *  QrCodeWidget.tsx). The old tile drew a decorative checkerboard no phone
 *  could read and labelled it "Scan your ticket". */
function useQrDataUrl(text: string): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!text) { setUrl(''); return; }
    let alive = true;
    import('qrcode')
      .then((m) => (m.default || m).toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width: 512, color: { dark: '#000000', light: '#ffffff' } }))
      .then((u: string) => { if (alive) setUrl(u); })
      .catch(() => { if (alive) setUrl(''); });
    return () => { alive = false; };
  }, [text]);
  return url;
}

export function GateWayfindingWidget({ config, height = 480 }: WidgetProps<GateWayfindingCfg>) {
  const c = config ?? {};
  const r = venueStyle(c, { bgColor: '#000', accentColor: '#ffd23a', accentColor2: '#22c55e' });
  const isBuilder = useRenderSurface() !== 'player';
  // portrait canvas: 1080×3840 → px scale on 3840 base.
  const qrUrl = (c.qrUrl || '').trim();
  const qr = useQrDataUrl(qrUrl);
  // Directions on a public screen are only ever the school's own: a wrong
  // gate sends people the wrong way. The builder shows a stamped sample.
  const typedAny = [c.section, c.gate, c.distance, c.directions].some((v) => ownCopy(v) !== undefined);
  const demo = isBuilder && !typedAny;
  const section = ownCopy(c.section) ?? (demo ? 'HOME' : '');
  const gate = ownCopy(c.gate) ?? (demo ? 'B' : '');
  const distance = ownCopy(c.distance) ?? (demo ? '2 MIN WALK' : '');
  const directions = ownCopy(c.directions) ?? (demo ? 'Enter through the main lobby and follow the signs to the gym.' : '');

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0208), color: r.font.color, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxSizing: 'border-box' }}>
        <div>
          {section && <div data-field="sectionLabel" style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.0109), letterSpacing: '0.12em' }}>{ownCopy(c.sectionLabel) ?? 'YOUR SECTION'}</div>}
          <div data-field="section" style={{ fontWeight: 800, fontSize: px(height, 0.0885), lineHeight: 0.9, letterSpacing: '-0.04em' }}>{section}</div>
        </div>
        <div style={{ background: '#11161e', border: `2px solid ${r.accent.primary}`, borderRadius: px(height, 0.00625), padding: px(height, 0.0156), textAlign: 'center', visibility: gate ? 'visible' : 'hidden' }}>
          <div data-field="gateLabel" style={{ color: r.accent.primary, fontWeight: 800, fontSize: px(height, 0.0109), letterSpacing: '0.12em', marginBottom: px(height, 0.0052) }}>{ownCopy(c.gateLabel) ?? 'USE GATE'}</div>
          <div data-field="gate" style={{ fontWeight: 800, fontSize: px(height, 0.0990), lineHeight: 1, letterSpacing: '-0.04em' }}>{gate}</div>
        </div>
        <div>
          <div data-field="distance" style={{ color: r.accent.secondary, fontWeight: 800, fontSize: px(height, 0.0125), letterSpacing: '0.04em' }}>{distance}</div>
          <div data-field="directions" style={{ color: '#cfd8e3', fontWeight: 600, fontSize: px(height, 0.00938), marginTop: px(height, 0.0026) }}>{directions}</div>
        </div>
        {(qr || isBuilder) ? (
          <div style={{ background: '#fff', color: '#000', padding: `${px(height, 0.00625)}px ${px(height, 0.0078)}px`, borderRadius: px(height, 0.00365), display: 'flex', alignItems: 'center' }}>
            <div style={{ width: px(height, 0.03125), height: px(height, 0.03125), borderRadius: px(height, 0.00156), marginRight: px(height, 0.00625), flexShrink: 0, background: qr ? '#fff' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: px(height, 0.006), fontWeight: 800, textAlign: 'center', overflow: 'hidden' }}>
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="" style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }} />
              ) : 'ADD A LINK'}
            </div>
            <div>
              <div data-field="qrTitle" style={{ fontWeight: 800, fontSize: px(height, 0.00833) }}>{ownCopy(c.qrTitle) ?? 'Scan for the seating map'}</div>
              <div data-field="qrSubtitle" style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.00573) }}>{ownCopy(c.qrSubtitle) ?? 'Opens on your phone'}</div>
            </div>
          </div>
        ) : <div />}
      </div>
      <SampleStamp height={height} show={demo} />
    </div>
  );
}

/* ════════════════ GOAL CELEBRATION ════════════════ */

interface CelebPlayer { number?: string; name?: string }
export interface GoalCelebrationCfg extends BaseCfg {
  dataMode?: DataMode;
  gameId?: string;
  /** Which team is celebrating (live mode reads its name + colours). */
  side?: 'home' | 'away';
  team?: VenueTeamCfg;
  label?: string;
  player?: CelebPlayer;
  /** Keep the live score visible along the bottom during the celebration. */
  showScore?: boolean;
}

export function GoalCelebrationWidget({ config, live = true, height = 480 }: WidgetProps<GoalCelebrationCfg>) {
  const c = config ?? {};
  const side: 'home' | 'away' = c.side === 'away' ? 'away' : 'home';
  const gv = useGameView({ dataMode: c.dataMode, [side]: c.team } as ScoreboardishCfg);
  const team = side === 'away' ? gv.away : gv.home;
  const r = venueStyle(c, { bgColor: team.color });
  const dur = animDurationSec(r.anim.speed, 1.4);
  const animate = live && r.anim.on;
  const isBuilder = useRenderSurface() !== 'player';
  const playerName = ownCopy(c.player?.name) ?? (gv.demo ? 'JORDAN LEE' : '');
  const playerNumber = ownCopy(c.player?.number) ?? (gv.demo ? '3' : '');
  const scoreLine = c.showScore !== false && !gv.demo && gv.home.score !== '—';

  return (
    <div style={frameStyle(r)}>
      <style>{sceneCss(`
        @keyframes svGoalPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }
        @keyframes svGoalBurst { 0% { opacity: 0.35; } 50% { opacity: 0.85; } 100% { opacity: 0.35; } }
      `)}</style>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'radial-gradient(circle at 50% 50%, #fff8 0%, transparent 50%)', animation: animate ? `svGoalBurst ${dur}s ease-in-out infinite` : 'none' }} />
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), color: r.font.color, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', boxSizing: 'border-box' }}>
          <div style={{ fontWeight: 800, fontSize: px(height, 0.0741), letterSpacing: '0.12em' }}>{team.name.toUpperCase()} SCORE!</div>
          <div data-field="label" style={{ fontWeight: 800, fontSize: px(height, 0.4444), lineHeight: 0.9, letterSpacing: '-0.06em', textShadow: '0 12px 40px #00000088', animation: animate ? `svGoalPulse ${dur}s ease-in-out infinite` : 'none' }}>{ownCopy(c.label) ?? 'GOAL!'}</div>
          {(playerName || playerNumber) && (
            <div style={{ marginTop: px(height, 0.0185), display: 'flex', alignItems: 'baseline' }}>
              {playerNumber && <div data-field="player.number" style={{ fontWeight: 800, fontSize: px(height, 0.0741), marginRight: px(height, 0.0278) }}>#{playerNumber}</div>}
              {playerName && <div data-field="player.name" style={{ fontWeight: 800, fontSize: px(height, 0.1296), letterSpacing: '-0.04em' }}>{playerName}</div>}
            </div>
          )}
        </div>
        {/* The score stays readable during the celebration (audit review:
            "preserve stable score/time information during presentation"). */}
        {scoreLine && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: px(height, 0.037), display: 'flex', justifyContent: 'center' }}>
            <div style={{ background: '#000a', color: '#fff', fontWeight: 800, fontSize: px(height, 0.05), letterSpacing: '0.04em', padding: `${px(height, 0.0093)}px ${px(height, 0.0278)}px`, borderRadius: px(height, 0.0139), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {gv.home.code} {gv.home.score} – {gv.away.score} {gv.away.code}{gv.clock ? `  ·  ${gv.clock}` : ''}{gv.period ? `  ${gv.period}` : ''}
            </div>
          </div>
        )}
      </div>
      <SampleStamp height={height} show={gv.demo && isBuilder} />
    </div>
  );
}
