'use client';

/**
 * Per-sport scoreboard ELEMENT widgets.
 * ─────────────────────────────────────
 * Sport-specific composable elements that bind to the SportDefinition
 * stat keys (Game.stats JSON, surfaced through GameStateContext). Same
 * pattern + helpers as SportElementWidgets.tsx (the universal set):
 * config-driven, brand-aware (flat color/font config), Chromium-83 safe,
 * sample fallback in the builder.
 *
 * Football   · down&distance, ball-on, flag
 * Baseball   · count (B-S-O), base diamond, inning-half, pitch count, pitch speed
 * Hockey/Lax/WP · penalty box (stacked timers), power-play badge
 * Volleyball/Tennis · per-set scores, serve indicator
 * Wrestling  · riding time, weight class, dual-meet team score
 * Track/Swim · leaderboard rows
 */

import React from 'react';
import { useGameState } from './GameStateContext';
import { elRoot, useSubClock, type ElCfg } from './SportElementWidgets';

function stat(s: ReturnType<typeof useGameState>, key: string): unknown {
  return s?.snapshot?.stats?.[key];
}

// ════════════════ FOOTBALL ════════════════

export function DownDistanceWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const down = stat(s, config.statKey ?? 'down');
  const dist = stat(s, 'distance');
  const ord = (n: number) => ['', '1ST', '2ND', '3RD', '4TH'][n] || `${n}TH`;
  const display = s?.snapshot
    ? (down ? `${ord(Number(down))} & ${dist ?? '—'}` : '—')
    : (config.placeholder ?? '2ND & 7');
  return <div style={elRoot(config, { fontWeight: config.fontWeight ?? 900 })}>{display}</div>;
}

export function BallOnWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const ballOn = stat(s, config.statKey ?? 'ballOn');
  const display = s?.snapshot ? (ballOn != null ? `BALL ON ${ballOn}` : '') : (config.placeholder ?? 'BALL ON 35');
  return <div style={elRoot(config, { fontWeight: config.fontWeight ?? 700, color: config.color ?? '#94a3b8' })}>{display}</div>;
}

export function FlagIndicatorWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const flag = stat(s, config.statKey ?? 'flag');
  const lit = s?.snapshot ? !!flag : true;
  if (s?.snapshot && !lit) return <div style={elRoot(config, { backgroundColor: 'transparent' })} />;
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent' })}>
      <span style={{ background: config.accentColor ?? '#fbbf24', color: '#11131a', padding: '0.2em 0.55em', borderRadius: 5, fontWeight: 900, letterSpacing: 1, fontSize: config.fontSize }}>
        {config.label ?? '🚩 FLAG'}
      </span>
    </div>
  );
}

// ════════════════ BASEBALL / SOFTBALL ════════════════

export function CountWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const balls = s?.snapshot ? Number(stat(s, 'balls') ?? 0) : 2;
  const strikes = s?.snapshot ? Number(stat(s, 'strikes') ?? 0) : 1;
  const outs = s?.snapshot ? Number(stat(s, 'outs') ?? 0) : 1;
  const dot = (on: boolean, c: string) => (
    <span style={{ width: '0.5em', height: '0.5em', borderRadius: '50%', display: 'inline-block', marginLeft: '0.18em', background: on ? c : 'rgba(255,255,255,0.16)' }} />
  );
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent', flexDirection: 'column' })}>
      <div style={{ fontWeight: 900, fontSize: '1em', color: config.color ?? '#fff' }}>{balls}-{strikes}</div>
      <div style={{ marginTop: '0.2em', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: '0.34em', fontWeight: 800, letterSpacing: 2, color: '#64748b', marginRight: '0.3em' }}>OUT</span>
        {dot(outs >= 1, config.accentColor ?? '#ef4444')}{dot(outs >= 2, config.accentColor ?? '#ef4444')}
      </div>
    </div>
  );
}

export function BaseDiamondWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const on1 = s?.snapshot ? !!Number(stat(s, 'on1B') ?? 0) : true;
  const on2 = s?.snapshot ? !!Number(stat(s, 'on2B') ?? 0) : false;
  const on3 = s?.snapshot ? !!Number(stat(s, 'on3B') ?? 0) : true;
  const lit = config.accentColor ?? '#fbbf24';
  const off = 'rgba(255,255,255,0.14)';
  const base = (on: boolean, style: React.CSSProperties) => (
    <span style={{ position: 'absolute', width: '34%', height: '34%', background: on ? lit : off, transform: 'rotate(45deg)', borderRadius: 3, ...style }} />
  );
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent' })}>
      <div style={{ position: 'relative', width: '80%', height: '80%' }}>
        {base(on2, { top: '4%', left: '33%' })}
        {base(on3, { top: '33%', left: '4%' })}
        {base(on1, { top: '33%', right: '4%' })}
      </div>
    </div>
  );
}

export function InningHalfWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const seg = s?.snapshot?.segment ?? 5;
  const half = String(stat(s, 'half') ?? (s?.snapshot ? 'top' : 'top')).toLowerCase();
  const ord = (n: number) => { const x = ['TH','ST','ND','RD']; const v = n % 100; return `${n}${x[(v-20)%10] || x[v] || x[0]}`; };
  const arrow = half.startsWith('b') ? '▼' : '▲';
  return <div style={elRoot(config, { fontWeight: config.fontWeight ?? 800 })}>{arrow} {ord(seg)}</div>;
}

export function PitchCountWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const key = config.statKey ?? (team === 'away' ? 'awayPitchCount' : 'homePitchCount');
  const pc = stat(s, key);
  const display = pc != null ? String(pc) : (s?.snapshot ? '0' : '87');
  return (
    <div style={elRoot(config, { flexDirection: 'column', backgroundColor: 'transparent' })}>
      {config.label !== '' && <div style={{ fontSize: '0.32em', fontWeight: 800, letterSpacing: 2, color: '#64748b' }}>{config.label ?? 'PITCHES'}</div>}
      <div style={{ fontWeight: 900, color: config.color ?? '#fff' }}>{display}</div>
    </div>
  );
}

export function PitchSpeedWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const v = stat(s, config.statKey ?? 'pitchSpeed');
  const display = v != null && v !== '' ? `${v}` : (s?.snapshot ? '' : '94');
  if (s?.snapshot && !display) return <div style={elRoot(config, { backgroundColor: 'transparent' })} />;
  return (
    <div style={elRoot(config, { flexDirection: 'column', backgroundColor: 'transparent' })}>
      <div style={{ fontWeight: 900, color: config.color ?? '#fbbf24' }}>{display}</div>
      <div style={{ fontSize: '0.3em', fontWeight: 800, letterSpacing: 2, color: '#64748b' }}>{config.label ?? 'MPH'}</div>
    </div>
  );
}

// ════════════════ HOCKEY / LACROSSE / WATER POLO ════════════════

function PenaltyRow({ p, serverTime, color }: { p: any; serverTime?: number; color: string }) {
  const ms = useSubClock(p, serverTime);
  const m = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.18em' }}>
      <span style={{ background: color, color: '#fff', borderRadius: 3, padding: '0 0.35em', fontWeight: 900, fontSize: '0.7em', marginRight: '0.4em' }}>#{p.player ?? '—'}</span>
      <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{m}:{String(sec).padStart(2, '0')}</span>
    </div>
  );
}

export function PenaltyBoxWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const key = config.statKey ?? (team === 'away' ? 'awayPenalties' : 'homePenalties');
  const raw = stat(s, key);
  const penalties: any[] = Array.isArray(raw) ? raw : (s?.snapshot ? [] : [{ player: 17, ms: 95000, at: new Date().toISOString(), running: false }]);
  const color = (team === 'away' ? s?.snapshot?.awayColor : s?.snapshot?.homeColor) || config.accentColor || '#dc2626';
  if (penalties.length === 0) return <div style={elRoot(config, { backgroundColor: 'transparent' })} />;
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent', flexDirection: 'column', alignItems: config.align === 'right' ? 'flex-end' : 'flex-start' })}>
      {penalties.slice(0, 3).map((p, i) => <PenaltyRow key={i} p={p} serverTime={s?.snapshot?.serverTime} color={color} />)}
    </div>
  );
}

export function PowerPlayBadgeWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const homeP = (Array.isArray(stat(s, 'homePenalties')) ? (stat(s, 'homePenalties') as any[]).length : 0);
  const awayP = (Array.isArray(stat(s, 'awayPenalties')) ? (stat(s, 'awayPenalties') as any[]).length : 0);
  const team = config.team ?? 'home';
  const myP = team === 'home' ? homeP : awayP;
  const oppP = team === 'home' ? awayP : homeP;
  let label = ''; let bg = '';
  if (!s?.snapshot) { label = 'POWER PLAY'; bg = '#22c55e'; }
  else if (oppP > myP) { label = `POWER PLAY${oppP - myP > 1 ? ` ${myP}-on-${myP + (oppP - myP)}` : ''}`; bg = '#22c55e'; }
  else if (myP > oppP) { label = 'PENALTY KILL'; bg = '#f59e0b'; }
  if (!label) return <div style={elRoot(config, { backgroundColor: 'transparent' })} />;
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent' })}>
      <span style={{ background: config.accentColor ?? bg, color: '#11131a', padding: '0.2em 0.6em', borderRadius: 6, fontWeight: 900, letterSpacing: 1, fontSize: config.fontSize }}>{label}</span>
    </div>
  );
}

// ════════════════ VOLLEYBALL / TENNIS (set / rally) ════════════════

export function SetScoresWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const raw = stat(s, config.statKey ?? 'sets');
  const sets: Array<{ h?: number; a?: number }> = Array.isArray(raw) && raw.length
    ? (raw as any[])
    : [{ h: 25, a: 21 }, { h: 23, a: 25 }, { h: 25, a: 18 }];
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent' })}>
      {sets.map((set, i) => (
        <div key={i} style={{ marginLeft: i ? '0.5em' : 0, textAlign: 'center', lineHeight: 1.1 }}>
          <div style={{ fontWeight: 900 }}>{set.h ?? '—'}</div>
          <div style={{ fontWeight: 900, color: config.accentColor ?? '#94a3b8' }}>{set.a ?? '—'}</div>
        </div>
      ))}
    </div>
  );
}

export function ServeIndicatorWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const serve = String(stat(s, config.statKey ?? 'serve') ?? (s?.snapshot ? 'home' : 'home')).toLowerCase();
  const lit = serve === team;
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent', opacity: lit ? 1 : 0.14, color: config.accentColor ?? config.color ?? '#fbbf24' })}>
      <span style={{ fontSize: config.fontSize ?? '1em' }}>🏐</span>
    </div>
  );
}

// ════════════════ SOCCER ════════════════

export function CardCountWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const yKey = config.statKey ?? (team === 'away' ? 'awayYellow' : 'homeYellow');
  const rKey = team === 'away' ? 'awayRed' : 'homeRed';
  const yellow = s?.snapshot ? Number(stat(s, yKey) ?? 0) : 2;
  const red = s?.snapshot ? Number(stat(s, rKey) ?? 0) : 1;
  const card = (color: string, n: number) => (
    <div style={{ display: 'flex', alignItems: 'center', marginLeft: '0.3em' }}>
      <span style={{ width: '0.6em', height: '0.85em', background: color, borderRadius: 2, marginRight: '0.18em', display: 'inline-block' }} />
      <span style={{ fontWeight: 900 }}>{n}</span>
    </div>
  );
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent' })}>
      {card('#fbbf24', yellow)}
      {card('#ef4444', red)}
    </div>
  );
}

export function StatPairWidget({ config }: { config: ElCfg }) {
  // Generic labelled stat (shots, corners, possession %, etc.) — bind a
  // stat key in Properties. Covers the long tail of per-sport numbers.
  const s = useGameState();
  const v = stat(s, config.statKey ?? 'shots');
  const display = v != null && v !== '' ? `${v}` : (s?.snapshot ? '0' : '12');
  return (
    <div style={elRoot(config, { flexDirection: 'column', backgroundColor: 'transparent' })}>
      {config.label !== '' && <div style={{ fontSize: '0.34em', fontWeight: 800, letterSpacing: 2, color: '#64748b' }}>{config.label ?? 'SHOTS'}</div>}
      <div style={{ fontWeight: 900, color: config.color ?? '#fff' }}>{display}</div>
    </div>
  );
}

// ════════════════ WRESTLING ════════════════

export function RidingTimeWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const raw = stat(s, config.statKey ?? 'ridingTime') as any;
  const ms = useSubClock(raw && raw.at ? raw : null, s?.snapshot?.serverTime);
  const shown = s?.snapshot ? ms : 72000;
  const m = Math.floor(shown / 60000);
  const sec = Math.floor((shown % 60000) / 1000);
  const advantage = shown >= 60000;
  return (
    <div style={elRoot(config, { flexDirection: 'column', backgroundColor: 'transparent' })}>
      {config.label !== '' && <div style={{ fontSize: '0.3em', fontWeight: 800, letterSpacing: 2, color: '#64748b' }}>{config.label ?? 'RIDING TIME'}</div>}
      <div style={{ fontWeight: 900, color: advantage ? (config.accentColor ?? '#22c55e') : (config.color ?? '#fff') }}>{m}:{String(sec).padStart(2, '0')}</div>
    </div>
  );
}

export function WeightClassWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const w = stat(s, config.statKey ?? 'weightClass');
  const display = w != null && w !== '' ? `${w}` : (s?.snapshot ? '' : '157 LBS');
  return <div style={elRoot(config, { fontWeight: config.fontWeight ?? 800, color: config.color ?? '#94a3b8' })}>{display}</div>;
}

export function TeamScoreRunningWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const key = config.statKey ?? (team === 'away' ? 'awayTeamScore' : 'homeTeamScore');
  const v = stat(s, key);
  const display = v != null ? String(v) : (s?.snapshot ? '0' : team === 'away' ? '18' : '24');
  return (
    <div style={elRoot(config, { flexDirection: 'column', backgroundColor: 'transparent' })}>
      {config.label !== '' && <div style={{ fontSize: '0.3em', fontWeight: 800, letterSpacing: 2, color: '#64748b' }}>{config.label ?? 'TEAM'}</div>}
      <div style={{ fontWeight: 900, color: config.color ?? '#fff' }}>{display}</div>
    </div>
  );
}

// ════════════════ TRACK / SWIM (leaderboard) ════════════════

export function LeaderboardWidget({ config }: { config: ElCfg & { rows?: Array<{ place?: number | string; lane?: number | string; name?: string; time?: string }> } }) {
  const rows = config.rows && config.rows.length ? config.rows : [
    { place: 1, lane: 4, name: 'J. CARTER', time: '10.42' },
    { place: 2, lane: 3, name: 'M. OKAFOR', time: '10.51' },
    { place: 3, lane: 5, name: 'D. REYES', time: '10.58' },
    { place: 4, lane: 6, name: 'T. NGUYEN', time: '10.63' },
  ];
  return (
    <div style={elRoot(config, { backgroundColor: config.bgColor ?? 'transparent', flexDirection: 'column', justifyContent: 'flex-start', padding: '0.3em 0.4em' })}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '0.18em 0', borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
          <span style={{ width: '1.4em', fontWeight: 900, color: config.accentColor ?? '#fbbf24' }}>{r.place}</span>
          <span style={{ width: '1.6em', fontWeight: 700, color: '#64748b', fontSize: '0.8em' }}>L{r.lane}</span>
          <span style={{ flex: 1, fontWeight: 700, marginLeft: '0.3em' }}>{r.name}</span>
          <span style={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', marginLeft: '0.3em' }}>{r.time}</span>
        </div>
      ))}
    </div>
  );
}
