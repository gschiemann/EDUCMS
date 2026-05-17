"use client";
/**
 * VenueOS · Sports Venue widgets — net-new vertical purpose-built to
 * compete with Daktronics ProAd / Show Control, ANC LiveEdge, Cisco
 * Vision, and ScoreVision. Built around real venue display surfaces:
 * jumbotrons, 16:1 LED ribbon boards, concourse + suite displays,
 * and vertical concourse posters.
 *
 * Ported 1:1 from scratch/incoming/edu-cms-6/sports-venue-pack — every
 * fixed px is rescaled against the widget's native canvas height via
 * px(height, fixedPx / canvasHeight).
 */
import React from 'react';
import { resolveStyle, frameStyle, animDurationSec } from './_shared/styleSystem';
import type { BaseCfg, WidgetProps } from './_shared/types';

function px(z: number, f: number): number { return Math.max(8, Math.round(z * f)); }

/* ════════════════ shared types ════════════════ */

interface TeamCfg {
  code: string;
  name: string;
  color: string;
  color2?: string;
  record?: string;
  shots?: number;
  score?: number;
  timeouts?: number;
}
interface StatEntry { label: string; value: string; }
interface SegmentEntry { text: string; tint?: string; }

const DEFAULT_HOME: TeamCfg = { code: 'CHI', name: 'Chicago Bulls', color: '#ce1141', color2: '#000000', record: '34-18', shots: 42, score: 82, timeouts: 3 };
const DEFAULT_AWAY: TeamCfg = { code: 'BOS', name: 'Boston Celtics', color: '#007a33', color2: '#0b3d20', record: '40-12', shots: 38, score: 78, timeouts: 2 };

/* ════════════════ STADIUM SCOREBOARD ════════════════ */

export interface StadiumScoreboardCfg extends BaseCfg {
  sport?: string;
  home?: TeamCfg;
  away?: TeamCfg;
  clock?: string;
  period?: string;
  homeFouls?: number;
  awayFouls?: number;
  homeBonus?: boolean;
  awayBonus?: boolean;
  topSponsor?: string;
  bottomSponsor?: string;
}

function ScbTeamPanel({ team, score, side, mirror, height }: { team: TeamCfg; score: number; side: string; mirror?: boolean; height: number }) {
  return (
    <div style={{ background: `linear-gradient(${mirror ? '-135deg' : '135deg'}, ${team.color} 0%, ${team.color2 || '#000'} 100%)`, borderRadius: px(height, 0.0167), display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: `${px(height, 0.022)}px ${px(height, 0.0278)}px`, color: '#fff', overflow: 'hidden', position: 'relative' }}>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: px(height, 0.024), opacity: 0.7, letterSpacing: '0.1em' }}>{side}</div>
          <div style={{ fontWeight: 800, fontSize: px(height, 0.059), letterSpacing: '-0.02em', lineHeight: 1 }}>{team.code}</div>
          <div style={{ fontWeight: 700, fontSize: px(height, 0.0204), opacity: 0.85, marginTop: 2 }}>{team.name}</div>
        </div>
        <div style={{ width: px(height, 0.0704), height: px(height, 0.0704), borderRadius: px(height, 0.013), background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: team.color, fontWeight: 800, fontSize: px(height, 0.0333) }}>{team.code.slice(0, 3)}</div>
      </div>
      <div style={{ position: 'relative', fontWeight: 800, fontSize: px(height, 0.2407), lineHeight: 0.85, letterSpacing: '-0.04em', textAlign: mirror ? 'left' : 'right', textShadow: '0 4px 24px rgba(0,0,0,.5)' }}>{score}</div>
      <div style={{ position: 'relative', display: 'flex', color: '#fff', justifyContent: mirror ? 'flex-start' : 'flex-end' }}>
        <span style={{ background: '#0006', padding: `${px(height, 0.0056)}px ${px(height, 0.0111)}px`, borderRadius: px(height, 0.0056), fontWeight: 700, fontSize: px(height, 0.0167), letterSpacing: '0.04em', marginRight: px(height, 0.0111) }}>{team.record || '34-18'}</span>
        <span style={{ background: '#0006', padding: `${px(height, 0.0056)}px ${px(height, 0.0111)}px`, borderRadius: px(height, 0.0056), fontWeight: 700, fontSize: px(height, 0.0167), letterSpacing: '0.04em' }}>SHOTS {team.shots ?? 18}</span>
      </div>
    </div>
  );
}

function ScbIndicator({ label, on, dir, height }: { label: string; on?: boolean; dir?: 'left' | 'right'; height: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginRight: px(height, 0.0167) }}>
      <span style={{ width: px(height, 0.013), height: px(height, 0.013), borderRadius: '50%', background: on ? '#ff5664' : '#2a2a2a', boxShadow: on ? '0 0 12px #ff5664' : 'none', marginRight: px(height, 0.0056) }} />
      <span style={{ color: on ? '#fff' : '#5a5a5a', fontWeight: 700, fontSize: px(height, 0.0167), letterSpacing: '0.06em' }}>{label}{dir === 'left' ? ' ◀' : dir === 'right' ? ' ▶' : ''}</span>
    </div>
  );
}

function ScbFoulRow({ label, count, color, height }: { label: string; count: number; color: string; height: number }) {
  return (
    <div style={{ background: '#111', border: `2px solid ${color}55`, borderRadius: px(height, 0.0093), padding: `${px(height, 0.0111)}px ${px(height, 0.0167)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ color, fontWeight: 800, fontSize: px(height, 0.0222), letterSpacing: '0.08em' }}>FOULS · {label}</div>
      <div style={{ display: 'flex' }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <span key={i} style={{ width: px(height, 0.0167), height: px(height, 0.0278), borderRadius: px(height, 0.0037), background: i < count ? color : '#222', boxShadow: i < count ? `0 0 8px ${color}99` : 'none', marginRight: i === 6 ? 0 : px(height, 0.0056) }} />
        ))}
      </div>
    </div>
  );
}

export function StadiumScoreboardWidget({ config, live = true, height = 480 }: WidgetProps<StadiumScoreboardCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#000', textColor: '#ffd23a', accentColor: '#ff5664', ...c.style });
  const sport = c.sport || 'BASKETBALL';
  const home = c.home || DEFAULT_HOME;
  const away = c.away || DEFAULT_AWAY;
  const clock = c.clock || '4:21';
  const period = c.period || 'Q3';

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `${px(height, 0.037)}px ${px(height, 0.0556)}px`, display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        <div style={{ height: px(height, 0.0556), background: 'linear-gradient(90deg, #1a1a1a, #2a2a2a)', borderRadius: px(height, 0.0074), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: px(height, 0.0222), letterSpacing: '0.2em', marginBottom: px(height, 0.0167), flexShrink: 0 }}>{c.topSponsor || 'PRESENTED BY · MIDWEST AUTO GROUP'}</div>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `1fr ${px(height, 0.4444)}px 1fr`, columnGap: px(height, 0.0278), alignItems: 'stretch' }}>
          <ScbTeamPanel team={home} score={home.score ?? 0} side="HOME" height={height} />
          <div style={{ background: '#0a0a0a', border: `4px solid #ffd23a`, borderRadius: px(height, 0.0167), display: 'flex', flexDirection: 'column', marginLeft: px(height, 0.0139), marginRight: px(height, 0.0139) }}>
            <div style={{ background: '#ffd23a', color: '#000', fontWeight: 800, fontSize: px(height, 0.0296), padding: `${px(height, 0.0074)}px 0`, textAlign: 'center', letterSpacing: '0.06em' }}>{period} · {sport.replace(/_/g, ' ')}</div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: `${px(height, 0.013)}px ${px(height, 0.0185)}px`, color: '#ffd23a' }}>
              <div style={{ fontWeight: 800, fontSize: px(height, 0.1852), lineHeight: 0.85, letterSpacing: '-0.04em', textShadow: '0 0 24px #ffd23a99' }}>{clock}</div>
              <div style={{ marginTop: px(height, 0.013), display: 'flex', color: '#fff' }}>
                <ScbIndicator label="BONUS" on={c.homeBonus} height={height} />
                <ScbIndicator label="POSS" on dir="left" height={height} />
                <ScbIndicator label="BONUS" on={c.awayBonus} height={height} />
              </div>
              <div style={{ marginTop: px(height, 0.013), color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.0204), letterSpacing: '0.08em' }}>TIMEOUTS {home.timeouts ?? 3} · {away.timeouts ?? 2}</div>
            </div>
          </div>
          <ScbTeamPanel team={away} score={away.score ?? 0} side="AWAY" mirror height={height} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr', columnGap: px(height, 0.0167), marginTop: px(height, 0.0167), flexShrink: 0 }}>
          <ScbFoulRow label={home.code} count={c.homeFouls ?? 5} color={home.color} height={height} />
          <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: px(height, 0.0093), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: px(height, 0.0259), letterSpacing: '0.06em', marginLeft: px(height, 0.0083), marginRight: px(height, 0.0083) }}>{c.bottomSponsor || 'BUDWEISER · OFFICIAL BEER PARTNER'}</div>
          <ScbFoulRow label={away.code} count={c.awayFouls ?? 3} color={away.color} height={height} />
        </div>
      </div>
    </div>
  );
}

/* ════════════════ RIBBON TICKER ════════════════ */

export interface RibbonTickerCfg extends BaseCfg {
  home?: TeamCfg;
  away?: TeamCfg;
  clock?: string;
  period?: string;
  segments?: SegmentEntry[];
  scrollSpeed?: number;
}

const DEFAULT_SEGMENTS: SegmentEntry[] = [
  { text: 'WELCOME TO THE UNITED CENTER', tint: '#fff' },
  { text: '★ #1 PICK · CALEB WILLIAMS · 22 PTS · 8 AST', tint: '#ffd23a' },
  { text: 'BUDWEISER · KING OF SPONSORS', tint: '#fff' },
  { text: 'NEXT HOME GAME · TUESDAY VS MIA · 7:30 PM', tint: '#ffd23a' },
  { text: 'TEXT BULLS TO 88-22 FOR PROMOS', tint: '#ff5664' },
];

export function RibbonTickerWidget({ config, live = true, height = 480 }: WidgetProps<RibbonTickerCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#000', textColor: '#ffd23a', accentColor: '#ce1141', ...c.style });
  const home = c.home || DEFAULT_HOME;
  const away = c.away || DEFAULT_AWAY;
  const segments = c.segments || DEFAULT_SEGMENTS;
  // ribbon canvas is 7680×480 → height drives px scale on 480 base.
  const dur = animDurationSec(r.anim.speed, c.scrollSpeed && c.scrollSpeed > 0 ? c.scrollSpeed : 40);

  return (
    <div style={frameStyle(r)}>
      <style>{`@keyframes svRibbonMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'stretch', overflow: 'hidden' }}>
        <div style={{ width: px(height, 1.5), background: home.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-around', flexShrink: 0 }}>
          <span style={{ fontWeight: 800, fontSize: px(height, 0.5), letterSpacing: '-0.04em', lineHeight: 1, marginRight: px(height, 0.0625) }}>{home.code}</span>
          <span style={{ fontWeight: 800, fontSize: px(height, 0.7083), letterSpacing: '-0.04em', lineHeight: 1 }}>{home.score}</span>
        </div>
        <div style={{ flex: 1, background: '#000', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', animation: live && r.anim.on ? `svRibbonMarquee ${dur}s linear infinite` : 'none', whiteSpace: 'nowrap', willChange: 'transform' }}>
            {[...segments, ...segments].map((s, i) => (
              <span key={i} style={{ color: s.tint || '#ffd23a', fontWeight: 800, fontSize: px(height, 0.4583), letterSpacing: '-0.02em', marginLeft: px(height, 0.125), marginRight: px(height, 0.125) }}>{s.text}</span>
            ))}
          </div>
        </div>
        <div style={{ width: px(height, 2.2917), background: 'linear-gradient(90deg, #000, #1a1a1a)', color: '#ffd23a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `0 ${px(height, 0.0625)}px`, flexShrink: 0 }}>
          <span style={{ fontWeight: 800, fontSize: px(height, 0.5), letterSpacing: '-0.04em', lineHeight: 1, marginRight: px(height, 0.0833) }}>{c.clock || '4:21'}</span>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.3542), opacity: 0.55 }}>{c.period || 'Q3'}</span>
        </div>
        <div style={{ width: px(height, 1.5), background: away.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-around', flexShrink: 0 }}>
          <span style={{ fontWeight: 800, fontSize: px(height, 0.7083), letterSpacing: '-0.04em', lineHeight: 1 }}>{away.score}</span>
          <span style={{ fontWeight: 800, fontSize: px(height, 0.5), letterSpacing: '-0.04em', lineHeight: 1 }}>{away.code}</span>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ RIBBON SPONSOR ════════════════ */

export interface RibbonSponsorCfg extends BaseCfg {
  sponsor?: string;
  tagline?: string;
  cta?: string;
  bg?: string;
}

export function RibbonSponsorWidget({ config, live = true, height = 480 }: WidgetProps<RibbonSponsorCfg>) {
  const c = config ?? {};
  const bg = c.bg || '#dc2626';
  const r = resolveStyle({ bgColor: bg, textColor: '#fff', accentColor: '#ffd23a', ...c.style });

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `0 ${px(height, 0.125)}px`, color: '#fff', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: px(height, 0.7083), height: px(height, 0.7083), background: '#fff', borderRadius: px(height, 0.05), display: 'flex', alignItems: 'center', justifyContent: 'center', color: bg, fontWeight: 800, fontSize: px(height, 0.2917), marginRight: px(height, 0.1667) }}>{(c.sponsor || 'BUD').slice(0, 3).toUpperCase()}</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.1667), letterSpacing: '0.04em', opacity: 0.7 }}>OFFICIAL PARTNER</div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.625), letterSpacing: '-0.04em', lineHeight: 1 }}>{c.sponsor || 'BUDWEISER'}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 800, fontSize: px(height, 0.5), letterSpacing: '-0.04em', lineHeight: 1 }}>{c.tagline || 'KING OF BEERS'}</div>
          <div style={{ fontWeight: 700, fontSize: px(height, 0.125), opacity: 0.8, marginTop: px(height, 0.0292) }}>{c.cta || 'now pouring · sec 110-114'}</div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ RIBBON FAN SHOUTOUT ════════════════ */

export interface RibbonFanShoutoutCfg extends BaseCfg {
  kind?: string;
  name?: string;
  from?: string;
}

export function RibbonFanShoutoutWidget({ config, live = true, height = 480 }: WidgetProps<RibbonFanShoutoutCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#1a1a1a', textColor: '#ffd23a', accentColor: '#fff', ...c.style });

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `${px(height, 0.0625)}px ${px(height, 0.125)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: px(height, 0.625), lineHeight: 1, marginRight: px(height, 0.1042) }}>{'🎂'}</div>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 0.1667), letterSpacing: '0.06em' }}>{(c.kind || 'HAPPY BIRTHDAY').toUpperCase()}</div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.5417), letterSpacing: '-0.04em', lineHeight: 1, marginTop: px(height, 0.0125) }}>{c.name || 'JAMES, AGE 8'}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.1875), opacity: 0.7 }}>from</div>
          <div style={{ fontWeight: 800, fontSize: px(height, 0.3333), letterSpacing: '-0.04em', lineHeight: 1.1 }}>{c.from || 'YOUR BULLS FAMILY'}</div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ PLAYER CARD ════════════════ */

interface PlayerCfg {
  first?: string;
  last?: string;
  number?: string;
  team: TeamCfg;
  position?: string;
  years?: string;
  statLine?: StatEntry[] | null;
}
export interface PlayerCardCfg extends BaseCfg {
  player?: PlayerCfg;
}

const DEFAULT_STATLINE: StatEntry[] = [
  { label: 'PTS', value: '22' },
  { label: 'REB', value: '4' },
  { label: 'AST', value: '8' },
  { label: 'STL', value: '2' },
  { label: 'FG%', value: '48.1' },
  { label: '3P%', value: '41.2' },
];
const DEFAULT_PLAYER: PlayerCfg = { first: 'COBY', last: 'WHITE', number: '0', team: DEFAULT_HOME, position: 'GUARD', years: '4', statLine: DEFAULT_STATLINE };

export function PlayerCardWidget({ config, live = true, height = 480 }: WidgetProps<PlayerCardCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#000', textColor: '#ffd23a', accentColor: '#ce1141', ...c.style });
  const p = c.player || DEFAULT_PLAYER;
  const statLine = p.statLine || DEFAULT_STATLINE;

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '60%', background: `linear-gradient(135deg, ${p.team.color} 0%, ${p.team.color2 || '#000'} 100%)` }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: '55%', background: 'linear-gradient(225deg, #1a1a1a, #000)', clipPath: 'polygon(15% 0, 100% 0, 100% 100%, 0 100%)' }}>
          <div style={{ position: 'absolute', right: px(height, 0.0556), bottom: px(height, 0.0278), color: '#fff', fontSize: px(height, 0.0222), fontWeight: 700, letterSpacing: '0.08em', opacity: 0.5 }}>{'●'} PLAYER PHOTO &mdash; TRANSPARENT PNG</div>
        </div>
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: `${px(height, 0.0741)}px ${px(height, 0.0741)}px`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: '#fff', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <div style={{ width: px(height, 0.1111), height: px(height, 0.1111), borderRadius: px(height, 0.013), background: '#fff', color: p.team.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: px(height, 0.0556), marginRight: px(height, 0.0278), flexShrink: 0 }}>{p.team.code.slice(0, 3)}</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: px(height, 0.0315), opacity: 0.7, letterSpacing: '0.1em' }}>{(p.team.name || 'CHICAGO BULLS').toUpperCase()}</div>
              <div style={{ fontWeight: 700, fontSize: px(height, 0.0259), opacity: 0.6 }}>{p.position || 'GUARD'} · {p.years || '4'} YR</div>
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.1574), lineHeight: 0.9, letterSpacing: '-0.04em' }}>{p.first || 'COBY'}</div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.2222), lineHeight: 0.9, letterSpacing: '-0.05em' }}>{p.last || 'WHITE'}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', marginTop: px(height, 0.0222) }}>
              <span style={{ fontWeight: 800, fontSize: px(height, 0.1852), color: '#ffd23a', textShadow: '0 0 24px #ffd23a99', lineHeight: 1 }}>#{p.number || '0'}</span>
            </div>
          </div>
          <div style={{ background: '#0006', border: `2px solid ${p.team.color}`, borderRadius: px(height, 0.0167), padding: `${px(height, 0.0222)}px ${px(height, 0.0278)}px`, display: 'flex', justifyContent: 'space-between', maxWidth: px(height, 1.0185) }}>
            {statLine.map((s, i) => (
              <div key={i} style={{ marginRight: i === statLine.length - 1 ? 0 : px(height, 0.0463) }}>
                <div style={{ color: '#ffd23a', fontWeight: 700, fontSize: px(height, 0.0204), letterSpacing: '0.08em' }}>{s.label.toUpperCase()}</div>
                <div style={{ fontWeight: 800, fontSize: px(height, 0.0741), lineHeight: 1 }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ STARTING LINEUP ════════════════ */

interface LineupPlayer {
  number: string;
  first: string;
  last: string;
  position: string;
  height?: string;
  weight?: string;
}
export interface StartingLineupCfg extends BaseCfg {
  team?: TeamCfg;
  lineup?: LineupPlayer[];
}

const DEFAULT_LINEUP: LineupPlayer[] = [
  { number: '0', first: 'COBY', last: 'WHITE', position: 'PG', height: '6\'4"', weight: '193 LB' },
  { number: '10', first: 'ZACH', last: 'LAVINE', position: 'SG', height: '6\'5"', weight: '200 LB' },
  { number: '8', first: 'PATRICK', last: 'WILLIAMS', position: 'SF', height: '6\'7"', weight: '215 LB' },
  { number: '24', first: 'DALEN', last: 'TERRY', position: 'PF', height: '6\'7"', weight: '195 LB' },
  { number: '9', first: 'NIKOLA', last: 'VUCEVIC', position: 'C', height: '6\'10"', weight: '260 LB' },
];

export function StartingLineupWidget({ config, live = true, height = 480 }: WidgetProps<StartingLineupCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#000', textColor: '#ffd23a', accentColor: '#ce1141', ...c.style });
  const team = c.team || DEFAULT_HOME;
  const lineup = c.lineup || DEFAULT_LINEUP;
  const shown = lineup.slice(0, 5);

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), background: `linear-gradient(135deg, ${team.color}33 0%, #000 60%)`, boxSizing: 'border-box' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: px(height, 0.037) }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.12em' }}>TONIGHT{'’'}S STARTING FIVE</div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.1019), letterSpacing: '-0.02em', lineHeight: 1 }}>{team.name || 'Chicago Bulls'}</div>
          </div>
          <div style={{ width: px(height, 0.1296), height: px(height, 0.1296), borderRadius: px(height, 0.0222), background: '#fff', color: team.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: px(height, 0.0593) }}>{team.code.slice(0, 3)}</div>
        </div>
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${Math.min(shown.length, 5)}, 1fr)` }}>
          {shown.map((p, i) => (
            <div key={i} style={{ background: `linear-gradient(180deg, ${team.color}22, #000)`, border: `2px solid ${team.color}55`, borderRadius: px(height, 0.0167), padding: `${px(height, 0.0259)}px ${px(height, 0.0204)}px`, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', overflow: 'hidden', marginRight: i === shown.length - 1 ? 0 : px(height, 0.0167) }}>
              <div style={{ position: 'absolute', top: px(height, -0.0185), right: px(height, -0.0185), fontWeight: 800, fontSize: px(height, 0.1852), color: `${team.color}33`, lineHeight: 1 }}>{p.number}</div>
              <div style={{ width: px(height, 0.1296), height: px(height, 0.1667), borderRadius: px(height, 0.013), background: '#1a1a1a', border: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a5a5a', fontSize: px(height, 0.0556), marginBottom: px(height, 0.013) }}>{'👤'}</div>
              <div style={{ color: '#ffd23a', fontWeight: 700, fontSize: px(height, 0.0222), letterSpacing: '0.1em', marginBottom: px(height, 0.013) }}>{p.position}</div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.0333), lineHeight: 1, textAlign: 'center', marginBottom: px(height, 0.013) }}>{p.first}<br />{p.last}</div>
              <div style={{ color: '#9aa3b2', fontWeight: 600, fontSize: px(height, 0.0167) }}>{p.height || '6\'4"'} · {p.weight || '193 LB'}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ STAT COMPARISON ════════════════ */

interface CompareStat { label: string; home: number; away: number; }
export interface StatComparisonCfg extends BaseCfg {
  home?: TeamCfg;
  away?: TeamCfg;
  scope?: string;
  stats?: CompareStat[];
}

const DEFAULT_COMPARE: CompareStat[] = [
  { label: 'PPG', home: 119.8, away: 115.3 },
  { label: 'REB', home: 44.2, away: 42.1 },
  { label: 'AST', home: 26.4, away: 24.9 },
  { label: 'STL', home: 7.8, away: 8.2 },
  { label: 'FG%', home: 47.8, away: 46.1 },
  { label: '3P%', home: 38.4, away: 36.6 },
];

export function StatComparisonWidget({ config, live = true, height = 480 }: WidgetProps<StatComparisonCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#000', textColor: '#ffd23a', accentColor: '#ce1141', ...c.style });
  const home = c.home || DEFAULT_HOME;
  const away = c.away || DEFAULT_AWAY;
  const stats = c.stats || DEFAULT_COMPARE;

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: px(height, 0.037) }}>
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <div style={{ color: home.color, fontWeight: 800, fontSize: px(height, 0.0741), marginRight: px(height, 0.0167) }}>{home.code}</div>
            <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.0315), marginRight: px(height, 0.0167) }}>vs</div>
            <div style={{ color: away.color, fontWeight: 800, fontSize: px(height, 0.0741) }}>{away.code}</div>
          </div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 0.0315), letterSpacing: '0.08em' }}>{(c.scope || 'SEASON AVERAGES').toUpperCase()}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {stats.map((s, i) => {
            const hWin = s.home > s.away;
            const total = s.home + s.away;
            const hPct = total > 0 ? (s.home / total) * 100 : 50;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: `${px(height, 0.1296)}px 1fr ${px(height, 0.1296)}px`, alignItems: 'center', columnGap: px(height, 0.0222), marginBottom: i === stats.length - 1 ? 0 : px(height, 0.0167) }}>
                <div style={{ color: hWin ? home.color : '#fff', fontWeight: 800, fontSize: px(height, 0.05), textAlign: 'right' }}>{s.home}</div>
                <div>
                  <div style={{ textAlign: 'center', color: '#ffd23a', fontWeight: 800, fontSize: px(height, 0.0222), letterSpacing: '0.1em', marginBottom: px(height, 0.0056) }}>{s.label.toUpperCase()}</div>
                  <div style={{ height: px(height, 0.037), display: 'flex', borderRadius: px(height, 0.0074), overflow: 'hidden', border: '1px solid #2a2a2a' }}>
                    <div style={{ width: `${hPct}%`, background: home.color, transition: 'width .3s' }} />
                    <div style={{ width: `${100 - hPct}%`, background: away.color }} />
                  </div>
                </div>
                <div style={{ color: !hWin ? away.color : '#fff', fontWeight: 800, fontSize: px(height, 0.05), textAlign: 'left' }}>{s.away}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ OUT-OF-TOWN SCORES ════════════════ */

interface OotTeam { code: string; score: number; color: string; }
interface OotGame { status: string; away: OotTeam; home: OotTeam; note: string; }
export interface OutOfTownScoresCfg extends BaseCfg {
  games?: OotGame[];
}

const OOT_GAMES: OotGame[] = [
  { status: 'LIVE', away: { code: 'LAL', score: 78, color: '#552583' }, home: { code: 'GSW', score: 82, color: '#1d428a' }, note: 'Q3 5:21' },
  { status: 'LIVE', away: { code: 'PHI', score: 54, color: '#006bb6' }, home: { code: 'MIA', score: 59, color: '#98002e' }, note: 'Q2 0:42' },
  { status: 'F', away: { code: 'DEN', score: 110, color: '#0e2240' }, home: { code: 'OKC', score: 104, color: '#007ac1' }, note: 'final' },
  { status: 'F', away: { code: 'PHX', score: 102, color: '#1d1160' }, home: { code: 'SAS', score: 114, color: '#000' }, note: 'final OT' },
  { status: '7:30', away: { code: 'NYK', score: 0, color: '#f58426' }, home: { code: 'BKN', score: 0, color: '#000' }, note: 'tonight' },
  { status: '7:30', away: { code: 'MIL', score: 0, color: '#00471b' }, home: { code: 'DET', score: 0, color: '#c8102e' }, note: 'tonight' },
  { status: '8:00', away: { code: 'CLE', score: 0, color: '#860038' }, home: { code: 'HOU', score: 0, color: '#ce1141' }, note: 'tonight' },
  { status: '10:30', away: { code: 'POR', score: 0, color: '#e03a3e' }, home: { code: 'SAC', score: 0, color: '#5a2d81' }, note: 'tonight' },
];

function OotRow({ code, score, color, winner, height }: { code: string; score: number; color: string; winner: boolean; height: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <span style={{ width: px(height, 0.0074), height: px(height, 0.0074), borderRadius: '50%', background: color, marginRight: px(height, 0.0093) }} />
      <span style={{ color: '#fff', fontWeight: winner ? 800 : 600, fontSize: px(height, 0.0278), width: px(height, 0.0741) }}>{code}</span>
      <span style={{ color: winner ? '#ffd23a' : '#cfd8e3', fontWeight: winner ? 800 : 600, fontSize: px(height, 0.0315) }}>{score}</span>
    </div>
  );
}

export function OutOfTownScoresWidget({ config, live = true, height = 480 }: WidgetProps<OutOfTownScoresCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0a0a', textColor: '#ffd23a', accentColor: '#ff5664', ...c.style });
  const games = c.games || OOT_GAMES;

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0556), boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: px(height, 0.0278) }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.12em' }}>AROUND THE LEAGUE</div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.0815), letterSpacing: '-0.02em' }}>Out-of-Town Scores</div>
          </div>
          <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.0222), letterSpacing: '0.06em' }}>UPDATED LIVE</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: px(height, 0.0167), rowGap: px(height, 0.0167) }}>
          {games.slice(0, 8).map((g, i) => (
            <div key={i} style={{ background: '#11161e', border: '1px solid #2a2a2a', borderRadius: px(height, 0.013), padding: `${px(height, 0.0185)}px ${px(height, 0.0241)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginBottom: px(height, 0.0056) }}>
                  <OotRow code={g.away.code} score={g.away.score} color={g.away.color} winner={g.away.score > g.home.score && g.status === 'F'} height={height} />
                </div>
                <OotRow code={g.home.code} score={g.home.score} color={g.home.color} winner={g.home.score > g.away.score && g.status === 'F'} height={height} />
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: g.status === 'LIVE' ? '#ff5664' : g.status === 'F' ? '#9aa3b2' : '#ffd23a', fontWeight: 700, fontSize: px(height, 0.0204), letterSpacing: '0.06em' }}>{g.status === 'LIVE' ? '● LIVE' : g.status}</div>
                <div style={{ color: '#9aa3b2', fontWeight: 600, fontSize: px(height, 0.0167) }}>{g.note}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ KISS CAM ════════════════ */

export interface KissCamCfg extends BaseCfg {
  kind?: string;
  tone?: string;
  shape?: string;
  sponsor?: string;
}

export function KissCamWidget({ config, live = true, height = 480 }: WidgetProps<KissCamCfg>) {
  const c = config ?? {};
  const tone = c.tone || '#ec4899';
  const r = resolveStyle({ bgColor: '#000', textColor: '#fff', accentColor: tone, ...c.style });
  const kind = (c.kind || 'KISS CAM').toUpperCase();

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'linear-gradient(135deg, #3a2030, #1a1422)' }}>
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)', fontSize: px(height, 0.1296) }}>{'●'} CAM 4 · LIVE FEED</div>
        </div>
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}>
          <defs>
            <mask id="svKissHeartCut">
              <rect width="1920" height="1080" fill="white" />
              <path d="M960 250 C 760 80, 380 150, 380 460 C 380 760, 760 900, 960 980 C 1160 900, 1540 760, 1540 460 C 1540 150, 1160 80, 960 250 Z" fill="black" />
            </mask>
          </defs>
          <rect width="1920" height="1080" fill={tone} mask="url(#svKissHeartCut)" />
          <path d="M960 250 C 760 80, 380 150, 380 460 C 380 760, 760 900, 960 980 C 1160 900, 1540 760, 1540 460 C 1540 150, 1160 80, 960 250 Z" fill="none" stroke="#fff" strokeWidth="14" />
        </svg>
        <div style={{ position: 'absolute', top: px(height, 0.037), left: '50%', transform: 'translateX(-50%)', background: tone, padding: `${px(height, 0.013)}px ${px(height, 0.0463)}px`, borderRadius: px(height, 0.013), color: '#fff', fontWeight: 800, fontSize: px(height, 0.0593), letterSpacing: '0.08em', boxShadow: '0 8px 30px #00000055', whiteSpace: 'nowrap' }}>
          {'💋'} {kind}
        </div>
        <div style={{ position: 'absolute', bottom: px(height, 0.037), left: '50%', transform: 'translateX(-50%)', background: '#0008', padding: `${px(height, 0.013)}px ${px(height, 0.0278)}px`, borderRadius: px(height, 0.0093), color: '#fff', fontWeight: 700, fontSize: px(height, 0.0315), letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{c.sponsor || 'BROUGHT TO YOU BY JEWELED VOWS DIAMOND CO.'}</div>
      </div>
    </div>
  );
}

/* ════════════════ NOISE METER ════════════════ */

export interface NoiseMeterCfg extends BaseCfg {
  prompt?: string;
  target?: number;
  level?: number;
}

export function NoiseMeterWidget({ config, live = true, height = 480 }: WidgetProps<NoiseMeterCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0a0a', textColor: '#fff', accentColor: '#ff5664', ...c.style });
  const level = c.level ?? 87;
  const target = c.target ?? 100;

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#ff5664', fontWeight: 800, fontSize: px(height, 0.0444), letterSpacing: '0.1em', textShadow: '0 0 24px #ff566499' }}>MAKE SOME NOISE</div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.1852), letterSpacing: '-0.04em', lineHeight: 1 }}>{c.prompt || 'Get LOUD!'}</div>
        </div>
        <div style={{ flex: 1, marginTop: px(height, 0.037), display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', height: px(height, 0.3519), marginRight: px(height, 0.0556) }}>
            {Array.from({ length: 30 }).map((_, i) => {
              const v = (i / 29) * 100;
              const on = level >= v;
              const color = v < 60 ? '#22c55e' : v < 85 ? '#f59e0b' : '#ff5664';
              return (
                <div key={i} style={{ flex: 1, height: `${((i + 1) / 30) * 100}%`, background: on ? color : '#1a1a1a', borderRadius: px(height, 0.0037), boxShadow: on ? `0 0 14px ${color}aa` : 'none', transition: 'all .1s', marginRight: i === 29 ? 0 : px(height, 0.0074) }} />
              );
            })}
          </div>
          <div style={{ width: px(height, 0.3148), textAlign: 'right' }}>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.06em' }}>DB · LIVE</div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.2222), letterSpacing: '-0.04em', lineHeight: 0.9 }}>{level}</div>
            <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.0278), marginTop: px(height, 0.0093) }}>target {target}+</div>
            <div style={{ marginTop: px(height, 0.0167), color: level >= target ? '#22c55e' : '#ff5664', fontWeight: 800, fontSize: px(height, 0.0426), letterSpacing: '0.04em' }}>{level >= target ? '🔥 LOUD!' : 'LOUDER!'}</div>
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

export function InGamePromoWidget({ config, live = true, height = 480 }: WidgetProps<InGamePromoCfg>) {
  const c = config ?? {};
  const accent = c.accent || '#ffd23a';
  const r = resolveStyle({ bgColor: '#1a0a0a', textColor: '#fff', accentColor: accent, ...c.style });
  const sections = c.sections || ['SEC 100', 'SEC 200', 'SEC 300', 'SEC 400'];

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: '#fff', boxSizing: 'border-box' }}>
        <div>
          <div style={{ color: accent, fontWeight: 800, fontSize: px(height, 0.037), letterSpacing: '0.12em', textShadow: `0 0 24px ${accent}99` }}>{(c.kicker || 'BROUGHT TO YOU BY POPEYE\'S').toUpperCase()}</div>
          <div style={{ fontWeight: 800, fontSize: px(height, 0.2778), lineHeight: 0.9, letterSpacing: '-0.04em', marginTop: px(height, 0.013) }}>{c.title || 'T-SHIRT TOSS'}</div>
          <div style={{ color: '#cfd8e3', fontWeight: 700, fontSize: px(height, 0.0463), marginTop: px(height, 0.0278), maxWidth: px(height, 1.1111) }}>{c.subtitle || 'Look up · catch a shirt · take a selfie · tag @ChicagoBulls'}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex' }}>
            {sections.map((s, i) => (
              <div key={i} style={{ background: `${accent}22`, border: `2px solid ${accent}`, padding: `${px(height, 0.0167)}px ${px(height, 0.0259)}px`, borderRadius: px(height, 0.013), color: accent, fontWeight: 800, fontSize: px(height, 0.0444), marginRight: i === sections.length - 1 ? 0 : px(height, 0.0222) }}>{s}</div>
            ))}
          </div>
          <div style={{ background: accent, color: '#0b0c0e', padding: `${px(height, 0.0222)}px ${px(height, 0.037)}px`, borderRadius: px(height, 0.013), fontWeight: 800, fontSize: px(height, 0.0556), letterSpacing: '0.02em' }}>{c.cta || 'NEXT TOSS · 4:00'}</div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ SPONSOR TAKEOVER ════════════════ */

export interface SponsorTakeoverCfg extends BaseCfg {
  sponsor?: string;
  tagline?: string;
  body?: string;
  cta?: string;
  bg?: string;
}

export function SponsorTakeoverWidget({ config, live = true, height = 480 }: WidgetProps<SponsorTakeoverCfg>) {
  const c = config ?? {};
  const tone = c.bg || '#0a4a8a';
  const r = resolveStyle({ bgColor: tone, textColor: '#fff', accentColor: '#ffd23a', ...c.style });

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.1111), color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: px(height, 0.0167), height: px(height, 0.0167), borderRadius: '50%', background: '#fff', marginRight: px(height, 0.0278) }} />
          <div style={{ fontWeight: 800, fontSize: px(height, 0.0407), letterSpacing: '0.12em', opacity: 0.85 }}>OFFICIAL PARTNER · CHICAGO BULLS</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: px(height, 0.3519), height: px(height, 0.3519), background: '#fff', borderRadius: px(height, 0.0278), display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone, fontWeight: 800, fontSize: px(height, 0.1574), marginRight: px(height, 0.0741), flexShrink: 0 }}>{(c.sponsor || 'AA').slice(0, 2).toUpperCase()}</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.2222), letterSpacing: '-0.04em', lineHeight: 0.95 }}>{c.sponsor || 'AMERICAN AIRLINES'}</div>
            <div style={{ fontWeight: 700, fontSize: px(height, 0.0556), opacity: 0.85, marginTop: px(height, 0.0167) }}>{c.tagline || 'Going for great.'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 700, fontSize: px(height, 0.0426), opacity: 0.85, maxWidth: px(height, 1.0185), lineHeight: 1.25 }}>{c.body || 'Fly the Bulls and earn double AAdvantage miles all season long.'}</div>
          <div style={{ background: '#fff', color: tone, padding: `${px(height, 0.0222)}px ${px(height, 0.0333)}px`, borderRadius: px(height, 0.013), fontWeight: 800, fontSize: px(height, 0.0389) }}>{c.cta || 'aa.com/bulls'}</div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ HOME SCHEDULE ════════════════ */

interface HomeGameOpp { code: string; name: string; color: string; }
interface HomeGame { date: string; opp: HomeGameOpp; note: string; time: string; tix: string; }
export interface HomeScheduleCfg extends BaseCfg {
  team?: TeamCfg;
  games?: HomeGame[];
}

const HOME_GAMES: HomeGame[] = [
  { date: 'TUE, MAY 20', opp: { code: 'MIA', name: 'Heat', color: '#98002e' }, note: 'Rivalry Night · Pacers giveaway', time: '7:30 PM', tix: 'sec 100s few left' },
  { date: 'FRI, MAY 23', opp: { code: 'PHI', name: '76ers', color: '#006bb6' }, note: 'Throwback Friday · 90s jerseys', time: '7:00 PM', tix: 'on sale' },
  { date: 'SUN, MAY 25', opp: { code: 'NYK', name: 'Knicks', color: '#f58426' }, note: 'Family Sunday · kids run the bases', time: '1:00 PM', tix: 'on sale' },
  { date: 'WED, MAY 28', opp: { code: 'BOS', name: 'Celtics', color: '#007a33' }, note: 'East Showdown', time: '8:00 PM', tix: 'few left' },
  { date: 'SAT, MAY 31', opp: { code: 'MIL', name: 'Bucks', color: '#00471b' }, note: 'Fan Appreciation Night', time: '7:30 PM', tix: 'on sale' },
];

export function HomeScheduleWidget({ config, live = true, height = 480 }: WidgetProps<HomeScheduleCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#000', textColor: '#ffd23a', accentColor: '#ce1141', ...c.style });
  const team = c.team || DEFAULT_HOME;
  const games = c.games || HOME_GAMES;

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: px(height, 0.0278) }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.12em' }}>NEXT 5 AT HOME</div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.0889), letterSpacing: '-0.02em' }}>{team.name || 'Chicago Bulls'} schedule</div>
          </div>
          <div style={{ width: px(height, 0.1111), height: px(height, 0.1111), borderRadius: px(height, 0.0222), background: '#fff', color: team.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: px(height, 0.0519) }}>{team.code.slice(0, 3)}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {games.slice(0, 5).map((g, i) => (
            <div key={i} style={{ background: '#11161e', border: '1px solid #2a2a2a', borderRadius: px(height, 0.013), padding: `${px(height, 0.0222)}px ${px(height, 0.0296)}px`, display: 'grid', gridTemplateColumns: `${px(height, 0.1667)}px 1fr 1fr ${px(height, 0.2037)}px`, alignItems: 'center', columnGap: px(height, 0.0185), marginBottom: i === Math.min(games.length, 5) - 1 ? 0 : px(height, 0.013) }}>
              <div>
                <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.06em' }}>{g.date.split(',')[0]}</div>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.0426), lineHeight: 1 }}>{g.date.split(',')[1]}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ width: px(height, 0.0593), height: px(height, 0.0593), borderRadius: px(height, 0.0111), background: '#fff', color: g.opp.color, fontWeight: 800, fontSize: px(height, 0.0222), display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: px(height, 0.0167) }}>{g.opp.code}</div>
                <div>
                  <div style={{ color: '#9aa3b2', fontWeight: 600, fontSize: px(height, 0.0185) }}>vs</div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: px(height, 0.0333) }}>{g.opp.name}</div>
                </div>
              </div>
              <div style={{ color: '#cfd8e3', fontWeight: 600, fontSize: px(height, 0.0222) }}>{g.note}</div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.0333) }}>{g.time}</div>
                <div style={{ color: '#ff5664', fontWeight: 700, fontSize: px(height, 0.0167) }}>{g.tix}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ STANDINGS BOARD ════════════════ */

interface StandingRow {
  rank: number;
  name: string;
  code: string;
  color: string;
  w: number;
  l: number;
  pct: string;
  gb: string;
  strk: string;
  last10: string;
}
export interface StandingsBoardCfg extends BaseCfg {
  team?: TeamCfg;
  scope?: string;
  rows?: StandingRow[];
}

const STANDINGS: StandingRow[] = [
  { rank: 1, name: 'Celtics', code: 'BOS', color: '#007a33', w: 40, l: 12, pct: '.769', gb: '—', strk: 'W8', last10: '9-1' },
  { rank: 2, name: 'Bucks', code: 'MIL', color: '#00471b', w: 36, l: 16, pct: '.692', gb: '4', strk: 'W2', last10: '7-3' },
  { rank: 3, name: 'Knicks', code: 'NYK', color: '#f58426', w: 35, l: 17, pct: '.673', gb: '5', strk: 'L1', last10: '6-4' },
  { rank: 4, name: 'Bulls', code: 'CHI', color: '#ce1141', w: 34, l: 18, pct: '.654', gb: '6', strk: 'W4', last10: '8-2' },
  { rank: 5, name: '76ers', code: 'PHI', color: '#006bb6', w: 33, l: 19, pct: '.635', gb: '7', strk: 'L2', last10: '5-5' },
  { rank: 6, name: 'Heat', code: 'MIA', color: '#98002e', w: 30, l: 22, pct: '.577', gb: '10', strk: 'W1', last10: '6-4' },
  { rank: 7, name: 'Pacers', code: 'IND', color: '#fdbb30', w: 28, l: 24, pct: '.538', gb: '12', strk: 'L1', last10: '5-5' },
  { rank: 8, name: 'Magic', code: 'ORL', color: '#0077c0', w: 27, l: 25, pct: '.519', gb: '13', strk: 'W2', last10: '7-3' },
];

export function StandingsBoardWidget({ config, live = true, height = 480 }: WidgetProps<StandingsBoardCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#000', textColor: '#ffd23a', accentColor: '#ce1141', ...c.style });
  const team = c.team || DEFAULT_HOME;
  const rows = c.rows || STANDINGS;
  const cols = `${px(height, 0.0741)}px 1fr ${px(height, 0.0926)}px ${px(height, 0.0926)}px ${px(height, 0.0926)}px ${px(height, 0.0926)}px ${px(height, 0.0926)}px ${px(height, 0.1481)}px`;
  const shown = rows.slice(0, 8);

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: px(height, 0.0278) }}>
          <div>
            <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.12em' }}>{(c.scope || 'EASTERN CONFERENCE').toUpperCase()}</div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.0889), letterSpacing: '-0.02em' }}>Standings</div>
          </div>
          <div style={{ color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.0222) }}>UPDATED LIVE</div>
        </div>
        <div style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: px(height, 0.013), overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, padding: `${px(height, 0.0167)}px ${px(height, 0.0241)}px`, borderBottom: '1px solid #2a2a2a', color: '#9aa3b2', fontWeight: 700, fontSize: px(height, 0.0185), letterSpacing: '0.08em' }}>
            <div>RK</div><div>TEAM</div><div>W</div><div>L</div><div>PCT</div><div>GB</div><div>STRK</div><div>LAST 10</div>
          </div>
          {shown.map((row, i) => {
            const me = row.code === team.code;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: cols, padding: `${px(height, 0.0167)}px ${px(height, 0.0241)}px`, borderBottom: i < shown.length - 1 ? '1px solid #1a1a1a' : 'none', color: me ? '#ffd23a' : '#fff', background: me ? `${team.color}22` : 'transparent', fontWeight: me ? 800 : 600, fontSize: px(height, 0.0278), alignItems: 'center' }}>
                <div style={{ color: i < 3 ? '#ffd23a' : '#9aa3b2', fontWeight: 800 }}>{row.rank}</div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ width: px(height, 0.013), height: px(height, 0.013), borderRadius: '50%', background: row.color, marginRight: px(height, 0.013) }} />
                  <span>{row.name}</span>
                </div>
                <div>{row.w}</div><div>{row.l}</div>
                <div>{row.pct}</div>
                <div>{row.gb}</div>
                <div style={{ color: row.strk[0] === 'W' ? '#22c55e' : '#ff5664', fontWeight: 800 }}>{row.strk}</div>
                <div>{row.last10}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ════════════════ CONCESSION WAITS ════════════════ */

interface ConcessionStand { name: string; where: string; icon: string; wait: number; }
export interface ConcessionWaitsCfg extends BaseCfg {
  stands?: ConcessionStand[];
}

const CONCESSION_DATA: ConcessionStand[] = [
  { name: 'Goose Island Pub', where: 'Sec 110 main concourse', icon: '🍺', wait: 3 },
  { name: 'Vienna Beef Hot Dogs', where: 'Sec 200 club level', icon: '🌭', wait: 6 },
  { name: 'Garrett Popcorn', where: 'Sec 304 upper bowl', icon: '🍿', wait: 8 },
  { name: 'Lou Malnati\'s Pizza', where: 'Sec 102 main concourse', icon: '🍕', wait: 14 },
  { name: 'BBQ Bowl', where: 'Sec 215 club level', icon: '🍖', wait: 4 },
  { name: 'Sweet Treats Cart', where: 'Sec 320 upper bowl', icon: '🍦', wait: 5 },
];

export function ConcessionWaitsWidget({ config, live = true, height = 480 }: WidgetProps<ConcessionWaitsCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#0a0a0a', textColor: '#ffd23a', accentColor: '#22c55e', ...c.style });
  const stands = c.stands || CONCESSION_DATA;

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0556), boxSizing: 'border-box' }}>
        <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 0.0278), letterSpacing: '0.12em' }}>SHORTEST LINES RIGHT NOW</div>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.0833), letterSpacing: '-0.02em' }}>Grab a bite</div>
        <div style={{ marginTop: px(height, 0.0278), display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', columnGap: px(height, 0.0167), rowGap: px(height, 0.0167) }}>
          {stands.slice(0, 6).map((s, i) => {
            const tone = s.wait <= 5 ? '#22c55e' : s.wait <= 12 ? '#f59e0b' : '#ff5664';
            return (
              <div key={i} style={{ background: '#11161e', border: '1px solid #2a2a2a', borderRadius: px(height, 0.013), padding: `${px(height, 0.0222)}px ${px(height, 0.0259)}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ fontSize: px(height, 0.05), marginRight: px(height, 0.0167) }}>{s.icon}</div>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 800, fontSize: px(height, 0.0315) }}>{s.name}</div>
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
    </div>
  );
}

/* ════════════════ GATE WAYFINDING ════════════════ */

export interface GateWayfindingCfg extends BaseCfg {
  section?: string;
  gate?: string;
  distance?: string;
  directions?: string;
}

export function GateWayfindingWidget({ config, live = true, height = 480 }: WidgetProps<GateWayfindingCfg>) {
  const c = config ?? {};
  const r = resolveStyle({ bgColor: '#000', textColor: '#fff', accentColor: '#22c55e', ...c.style });
  // portrait canvas: 1080×3840 → px scale on 3840 base.

  return (
    <div style={frameStyle(r)}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0208), color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxSizing: 'border-box' }}>
        <div>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 0.0109), letterSpacing: '0.12em' }}>YOUR SECTION</div>
          <div style={{ fontWeight: 800, fontSize: px(height, 0.0885), lineHeight: 0.9, letterSpacing: '-0.04em' }}>{c.section || '212'}</div>
        </div>
        <div style={{ background: '#11161e', border: '2px solid #ffd23a', borderRadius: px(height, 0.00625), padding: px(height, 0.0156), textAlign: 'center' }}>
          <div style={{ color: '#ffd23a', fontWeight: 800, fontSize: px(height, 0.0109), letterSpacing: '0.12em', marginBottom: px(height, 0.0052) }}>USE GATE</div>
          <div style={{ fontWeight: 800, fontSize: px(height, 0.0990), lineHeight: 1, letterSpacing: '-0.04em' }}>{c.gate || 'B'}</div>
        </div>
        <div>
          <div style={{ color: '#22c55e', fontWeight: 800, fontSize: px(height, 0.0125), letterSpacing: '0.04em' }}>{c.distance || '4 MIN WALK'}</div>
          <div style={{ color: '#cfd8e3', fontWeight: 600, fontSize: px(height, 0.00938), marginTop: px(height, 0.0026) }}>{c.directions || 'Take the escalator to the upper concourse, walk left past Goose Island.'}</div>
        </div>
        <div style={{ background: '#fff', color: '#000', padding: `${px(height, 0.00625)}px ${px(height, 0.0078)}px`, borderRadius: px(height, 0.00365), display: 'flex', alignItems: 'center' }}>
          <div style={{ width: px(height, 0.03125), height: px(height, 0.03125), background: 'repeating-conic-gradient(#000 0% 10%, #fff 0% 20%)', borderRadius: px(height, 0.00156), marginRight: px(height, 0.00625), flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.00833) }}>Scan your ticket</div>
            <div style={{ color: '#74767d', fontWeight: 600, fontSize: px(height, 0.00573) }}>We{'’'}ll send you directly to your seat</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════ GOAL CELEBRATION ════════════════ */

interface CelebPlayer { number?: string; name?: string; }
export interface GoalCelebrationCfg extends BaseCfg {
  team?: TeamCfg;
  label?: string;
  player?: CelebPlayer;
}

export function GoalCelebrationWidget({ config, live = true, height = 480 }: WidgetProps<GoalCelebrationCfg>) {
  const c = config ?? {};
  const team = c.team || DEFAULT_HOME;
  const r = resolveStyle({ bgColor: team.color, textColor: '#fff', accentColor: '#ffd23a', ...c.style });
  const dur = animDurationSec(r.anim.speed, 1.4);
  const animate = live && r.anim.on;

  return (
    <div style={frameStyle(r)}>
      <style>{`
        @keyframes svGoalPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }
        @keyframes svGoalBurst { 0% { opacity: 0.35; } 50% { opacity: 0.85; } 100% { opacity: 0.35; } }
      `}</style>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'radial-gradient(circle at 50% 50%, #fff8 0%, transparent 50%)', animation: animate ? `svGoalBurst ${dur}s ease-in-out infinite` : 'none' }} />
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: px(height, 0.0741), color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', boxSizing: 'border-box' }}>
          <div style={{ fontWeight: 800, fontSize: px(height, 0.0741), letterSpacing: '0.12em' }}>{(team.name ? team.name.toUpperCase() : 'BULLS')} SCORE!</div>
          <div style={{ fontWeight: 800, fontSize: px(height, 0.4444), lineHeight: 0.9, letterSpacing: '-0.06em', textShadow: '0 12px 40px #00000088', animation: animate ? `svGoalPulse ${dur}s ease-in-out infinite` : 'none' }}>{c.label || 'GOAL!'}</div>
          <div style={{ marginTop: px(height, 0.0185), display: 'flex', alignItems: 'baseline' }}>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.0741), marginRight: px(height, 0.0278) }}>#{c.player?.number || '0'}</div>
            <div style={{ fontWeight: 800, fontSize: px(height, 0.1296), letterSpacing: '-0.04em' }}>{c.player?.name || 'COBY WHITE'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
