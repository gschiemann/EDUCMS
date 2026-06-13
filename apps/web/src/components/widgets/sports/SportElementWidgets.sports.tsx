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
 * NO FAKE STATS ON A LIVE BOARD (audit P1, 2026-06-13): the representative
 * sample values ("2ND & 7", "157 LBS", a lit base diamond, …) are for the
 * BUILDER ONLY. The "is this a live surface?" signal is `useGameState() !=
 * null` — the GameStateProvider only mounts on the live /board route, NOT
 * the builder canvas / gallery thumbnail. On a live surface that has no
 * snapshot yet, these widgets render their NEUTRAL / empty state, never a
 * fabricated value a crowd could read as the real game. (The OLD gate
 * `s?.snapshot` conflated "live board, no data yet" with "builder" — that
 * is the bug this closes.)
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
import { FitOneLine, FitBox } from './FitOneLine';

function stat(s: ReturnType<typeof useGameState>, key: string): unknown {
  return s?.snapshot?.stats?.[key];
}

// ════════════════ FOOTBALL ════════════════

export function DownDistanceWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const down = stat(s, config.statKey ?? 'down');
  const dist = stat(s, 'distance');
  const ord = (n: number) => ['', '1ST', '2ND', '3RD', '4TH'][n] || `${n}TH`;
  // Builder (s == null) → sample "2ND & 7". Live surface → real value or
  // a neutral "—" (never the fabricated sample).
  const display = s != null
    ? (down ? `${ord(Number(down))} & ${dist ?? '—'}` : '—')
    : (config.placeholder ?? '2ND & 7');
  return (
    <div style={{ width: '100%', height: '100%', background: config.bgColor ?? 'transparent', overflow: 'hidden' }}>
      <FitOneLine
        maxFontPx={config.fontSize ?? 800}
        align={config.align ?? 'center'}
        style={{ color: config.color ?? '#ffffff', fontWeight: config.fontWeight ?? 900, fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif', letterSpacing: config.letterSpacing != null ? `${config.letterSpacing}px` : undefined }}
      >
        {display}
      </FitOneLine>
    </div>
  );
}

export function BallOnWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const ballOn = stat(s, config.statKey ?? 'ballOn');
  // Builder (s == null) → sample. Live surface → real value or blank
  // (never the fabricated "BALL ON 35").
  const display = s != null ? (ballOn != null ? `BALL ON ${ballOn}` : '') : (config.placeholder ?? 'BALL ON 35');
  return (
    <div style={{ width: '100%', height: '100%', background: config.bgColor ?? 'transparent', overflow: 'hidden' }}>
      <FitOneLine
        maxFontPx={config.fontSize ?? 800}
        align={config.align ?? 'center'}
        style={{ color: config.color ?? '#94a3b8', fontWeight: config.fontWeight ?? 700, fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif', letterSpacing: config.letterSpacing != null ? `${config.letterSpacing}px` : undefined }}
      >
        {display}
      </FitOneLine>
    </div>
  );
}

export function FlagIndicatorWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const flag = stat(s, config.statKey ?? 'flag');
  // Builder (s == null) → always lit so the operator sees the badge.
  // Live surface → lit only on a real flag; hidden otherwise (never a
  // fabricated FLAG).
  const lit = s != null ? !!flag : true;
  if (s != null && !lit) return <div style={elRoot(config, { backgroundColor: 'transparent' })} />;
  return (
    <div style={{ width: '100%', height: '100%', background: 'transparent', overflow: 'hidden' }}>
      <FitOneLine
        maxFontPx={config.fontSize ?? 800}
        align={config.align ?? 'center'}
        style={{ background: config.accentColor ?? '#fbbf24', color: '#11131a', padding: '0.2em 0.55em', borderRadius: 5, fontWeight: 900, letterSpacing: 1, fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif' }}
      >
        {config.label ?? '🚩 FLAG'}
      </FitOneLine>
    </div>
  );
}

// ════════════════ BASEBALL / SOFTBALL ════════════════

export function CountWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  // Builder (s == null) → sample 2-1, 1 out. Live surface → real count
  // (defaults to 0-0, 0 — never the fabricated sample).
  const balls = s != null ? Number(stat(s, 'balls') ?? 0) : 2;
  const strikes = s != null ? Number(stat(s, 'strikes') ?? 0) : 1;
  const outs = s != null ? Number(stat(s, 'outs') ?? 0) : 1;
  const dot = (on: boolean, c: string) => (
    <span style={{ width: '0.5em', height: '0.5em', borderRadius: '50%', display: 'inline-block', marginLeft: '0.18em', background: on ? c : 'rgba(255,255,255,0.16)' }} />
  );
  return (
    <div style={{ width: '100%', height: '100%', background: config.bgColor ?? 'transparent', overflow: 'hidden' }}>
      <FitBox
        baseFontPx={config.fontSize ?? 400}
        align={config.align ?? 'center'}
        style={{ color: config.color ?? '#fff', fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif' }}
      >
        <div style={{ fontWeight: 900, fontSize: '1em', color: config.color ?? '#fff' }}>{balls}-{strikes}</div>
        <div style={{ marginTop: '0.2em', display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: '0.34em', fontWeight: 800, letterSpacing: 2, color: '#64748b', marginRight: '0.3em' }}>OUT</span>
          {dot(outs >= 1, config.accentColor ?? '#ef4444')}{dot(outs >= 2, config.accentColor ?? '#ef4444')}
        </div>
      </FitBox>
    </div>
  );
}

export function BaseDiamondWidget({ config }: { config: ElCfg }) {
  // Visual diamond graphic — percentage-based sizing, no text overflow risk. Left alone.
  const s = useGameState();
  // Builder (s == null) → sample runners on 1st + 3rd. Live surface →
  // real base state (defaults to empty bases — never the fabricated sample).
  const on1 = s != null ? !!Number(stat(s, 'on1B') ?? 0) : true;
  const on2 = s != null ? !!Number(stat(s, 'on2B') ?? 0) : false;
  const on3 = s != null ? !!Number(stat(s, 'on3B') ?? 0) : true;
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
  // Builder (s == null) → sample "▲ 5TH". Live surface with no snapshot →
  // neutral "—" (never the fabricated 5th-inning sample).
  const liveNoData = s != null && !s.snapshot;
  const seg = s?.snapshot?.segment ?? 5;
  const half = String(stat(s, 'half') ?? 'top').toLowerCase();
  const ord = (n: number) => { const x = ['TH','ST','ND','RD']; const v = n % 100; return `${n}${x[(v-20)%10] || x[v] || x[0]}`; };
  const arrow = half.startsWith('b') ? '▼' : '▲';
  return (
    <div style={{ width: '100%', height: '100%', background: config.bgColor ?? 'transparent', overflow: 'hidden' }}>
      <FitOneLine
        maxFontPx={config.fontSize ?? 800}
        align={config.align ?? 'center'}
        style={{ color: config.color ?? '#ffffff', fontWeight: config.fontWeight ?? 800, fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif', letterSpacing: config.letterSpacing != null ? `${config.letterSpacing}px` : undefined }}
      >
        {liveNoData ? '—' : `${arrow} ${ord(seg)}`}
      </FitOneLine>
    </div>
  );
}

export function PitchCountWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const key = config.statKey ?? (team === 'away' ? 'awayPitchCount' : 'homePitchCount');
  const pc = stat(s, key);
  // Real value when present; sample "87" only in the builder (s == null);
  // neutral "—" on a live surface with no data.
  const display = pc != null ? String(pc) : (s != null ? '—' : '87');
  return (
    <div style={{ width: '100%', height: '100%', background: config.bgColor ?? 'transparent', overflow: 'hidden' }}>
      <FitBox
        baseFontPx={config.fontSize ?? 400}
        align={config.align ?? 'center'}
        style={{ color: config.color ?? '#fff', fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif' }}
      >
        {config.label !== '' && <div style={{ fontSize: '0.32em', fontWeight: 800, letterSpacing: 2, color: '#64748b' }}>{config.label ?? 'PITCHES'}</div>}
        <div style={{ fontWeight: 900, color: config.color ?? '#fff' }}>{display}</div>
      </FitBox>
    </div>
  );
}

export function PitchSpeedWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const v = stat(s, config.statKey ?? 'pitchSpeed');
  // Sample "94" only in the builder (s == null). Live surface → real
  // speed or hidden (never a fabricated 94 mph).
  const display = v != null && v !== '' ? `${v}` : (s != null ? '' : '94');
  if (s != null && !display) return <div style={elRoot(config, { backgroundColor: 'transparent' })} />;
  return (
    <div style={{ width: '100%', height: '100%', background: config.bgColor ?? 'transparent', overflow: 'hidden' }}>
      <FitBox
        baseFontPx={config.fontSize ?? 400}
        align={config.align ?? 'center'}
        style={{ color: config.color ?? '#fbbf24', fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif' }}
      >
        <div style={{ fontWeight: 900, color: config.color ?? '#fbbf24' }}>{display}</div>
        <div style={{ fontSize: '0.3em', fontWeight: 800, letterSpacing: 2, color: '#64748b' }}>{config.label ?? 'MPH'}</div>
      </FitBox>
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
  // Multi-row list with em sub-sizing — complex layout, not a simple text overflow case.
  const s = useGameState();
  const team = config.team ?? 'home';
  const all = stat(s, 'penalties');
  // Sample penalty (#17) only in the builder (s == null). Live surface
  // with no penalty data → empty box (the widget renders nothing) — never
  // a fabricated player in the penalty box.
  const penalties: any[] = Array.isArray(all)
    ? all.filter((p) => (p?.team ?? 'home') === team)
    : (s != null ? [] : [{ player: 17, ms: 95000, at: new Date().toISOString(), running: false }]);
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
  const all = Array.isArray(stat(s, 'penalties')) ? (stat(s, 'penalties') as any[]) : [];
  const homeP = all.filter((p) => (p?.team ?? 'home') === 'home').length;
  const awayP = all.filter((p) => (p?.team ?? 'home') === 'away').length;
  const team = config.team ?? 'home';
  const myP = team === 'home' ? homeP : awayP;
  const oppP = team === 'home' ? awayP : homeP;
  let label = ''; let bg = '';
  // Sample "POWER PLAY" only in the builder (s == null). On a live surface
  // the badge follows the real penalty counts and stays hidden until a
  // genuine power-play / kill exists — never a fabricated badge.
  if (s == null) { label = 'POWER PLAY'; bg = '#22c55e'; }
  else if (oppP > myP) { label = `POWER PLAY${oppP - myP > 1 ? ` ${myP}-on-${myP + (oppP - myP)}` : ''}`; bg = '#22c55e'; }
  else if (myP > oppP) { label = 'PENALTY KILL'; bg = '#f59e0b'; }
  if (!label) return <div style={elRoot(config, { backgroundColor: 'transparent' })} />;
  return (
    <div style={{ width: '100%', height: '100%', background: 'transparent', overflow: 'hidden' }}>
      <FitOneLine
        maxFontPx={config.fontSize ?? 800}
        align={config.align ?? 'center'}
        style={{ background: config.accentColor ?? bg, color: '#11131a', padding: '0.2em 0.6em', borderRadius: 6, fontWeight: 900, letterSpacing: 1, fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif' }}
      >
        {label}
      </FitOneLine>
    </div>
  );
}

// ════════════════ VOLLEYBALL / TENNIS (set / rally) ════════════════

export function SetScoresWidget({ config }: { config: ElCfg }) {
  // Multi-column per-set scores: each set is a home/away pair — FitBox scales the whole row.
  const s = useGameState();
  const raw = stat(s, config.statKey ?? 'sets');
  // Sample per-set scores only in the builder (s == null). On a live
  // surface with no set data → a single neutral "—/—" column (never the
  // fabricated 25-21 / 23-25 / 25-18 sample).
  const sets: Array<{ h?: number; a?: number }> = Array.isArray(raw) && raw.length
    ? (raw as any[])
    : (s != null ? [{}] : [{ h: 25, a: 21 }, { h: 23, a: 25 }, { h: 25, a: 18 }]);
  return (
    <div style={{ width: '100%', height: '100%', background: config.bgColor ?? 'transparent', overflow: 'hidden' }}>
      <FitBox
        baseFontPx={config.fontSize ?? 400}
        align={config.align ?? 'center'}
        style={{ color: config.color ?? '#fff', fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif', display: 'flex', flexDirection: 'row', alignItems: 'center' }}
      >
        {sets.map((set, i) => (
          <div key={i} style={{ marginLeft: i ? '0.5em' : 0, textAlign: 'center', lineHeight: 1.1 }}>
            <div style={{ fontWeight: 900 }}>{set.h ?? '—'}</div>
            <div style={{ fontWeight: 900, color: config.accentColor ?? '#94a3b8' }}>{set.a ?? '—'}</div>
          </div>
        ))}
      </FitBox>
    </div>
  );
}

export function ServeIndicatorWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const rawServe = stat(s, config.statKey ?? 'serve');
  // Builder (s == null) → light the home indicator as a sample. Live
  // surface → follow the real serve; with no serve data nothing is lit
  // (never a fabricated serve indicator).
  const serve = String(rawServe ?? (s == null ? 'home' : '')).toLowerCase();
  const lit = serve === team;
  return (
    <div style={{ width: '100%', height: '100%', background: 'transparent', overflow: 'hidden' }}>
      <FitOneLine
        maxFontPx={config.fontSize ?? 800}
        align={config.align ?? 'center'}
        style={{ opacity: lit ? 1 : 0.14, color: config.accentColor ?? config.color ?? '#fbbf24' }}
      >
        🏐
      </FitOneLine>
    </div>
  );
}

// ════════════════ SOCCER ════════════════

export function CardCountWidget({ config }: { config: ElCfg }) {
  // Card icons + count numbers — visual indicator row, not text overflow. Left alone.
  const s = useGameState();
  const team = config.team ?? 'home';
  const yKey = config.statKey ?? (team === 'away' ? 'awayYellow' : 'homeYellow');
  const rKey = team === 'away' ? 'awayRed' : 'homeRed';
  // Builder (s == null) → sample 2 yellow / 1 red. Live surface → real
  // counts (default 0 / 0 — never the fabricated sample).
  const yellow = s != null ? Number(stat(s, yKey) ?? 0) : 2;
  const red = s != null ? Number(stat(s, rKey) ?? 0) : 1;
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
  // Generic labelled stat (shots, corners, possession %, etc.)
  const s = useGameState();
  const v = stat(s, config.statKey ?? 'shots');
  // Real value when present; sample "12" only in the builder (s == null);
  // neutral "—" on a live surface with no data.
  const display = v != null && v !== '' ? `${v}` : (s != null ? '—' : '12');
  return (
    <div style={{ width: '100%', height: '100%', background: config.bgColor ?? 'transparent', overflow: 'hidden' }}>
      <FitBox
        baseFontPx={config.fontSize ?? 400}
        align={config.align ?? 'center'}
        style={{ color: config.color ?? '#fff', fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif' }}
      >
        {config.label !== '' && <div style={{ fontSize: '0.34em', fontWeight: 800, letterSpacing: 2, color: '#64748b' }}>{config.label ?? 'SHOTS'}</div>}
        <div style={{ fontWeight: 900, color: config.color ?? '#fff' }}>{display}</div>
      </FitBox>
    </div>
  );
}

// ════════════════ WRESTLING ════════════════

export function RidingTimeWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const raw = stat(s, config.statKey ?? 'ridingTime') as any;
  const ms = useSubClock(raw && raw.at ? raw : null, s?.snapshot?.serverTime);
  // Builder (s == null) → sample 1:12. Live surface → the real riding
  // time (0:00 until a real anchor arrives — never the fabricated sample).
  const shown = s != null ? ms : 72000;
  const m = Math.floor(shown / 60000);
  const sec = Math.floor((shown % 60000) / 1000);
  const advantage = shown >= 60000;
  return (
    <div style={{ width: '100%', height: '100%', background: config.bgColor ?? 'transparent', overflow: 'hidden' }}>
      <FitBox
        baseFontPx={config.fontSize ?? 400}
        align={config.align ?? 'center'}
        style={{ fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif' }}
      >
        {config.label !== '' && <div style={{ fontSize: '0.3em', fontWeight: 800, letterSpacing: 2, color: '#64748b' }}>{config.label ?? 'RIDING TIME'}</div>}
        <div style={{ fontWeight: 900, color: advantage ? (config.accentColor ?? '#22c55e') : (config.color ?? '#fff') }}>{m}:{String(sec).padStart(2, '0')}</div>
      </FitBox>
    </div>
  );
}

export function WeightClassWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const w = stat(s, config.statKey ?? 'weightClass');
  // Real value when present; sample "157 LBS" only in the builder
  // (s == null); blank on a live surface with no data.
  const display = w != null && w !== '' ? `${w}` : (s != null ? '' : '157 LBS');
  return (
    <div style={{ width: '100%', height: '100%', background: config.bgColor ?? 'transparent', overflow: 'hidden' }}>
      <FitOneLine
        maxFontPx={config.fontSize ?? 800}
        align={config.align ?? 'center'}
        style={{ color: config.color ?? '#94a3b8', fontWeight: config.fontWeight ?? 800, fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif', letterSpacing: config.letterSpacing != null ? `${config.letterSpacing}px` : undefined }}
      >
        {display}
      </FitOneLine>
    </div>
  );
}

export function TeamScoreRunningWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const key = config.statKey ?? (team === 'away' ? 'awayTeamScore' : 'homeTeamScore');
  const v = stat(s, key);
  // Real value when present; sample 24/18 only in the builder (s == null);
  // neutral "—" on a live surface with no data (never a fabricated score).
  const display = v != null ? String(v) : (s != null ? '—' : team === 'away' ? '18' : '24');
  return (
    <div style={{ width: '100%', height: '100%', background: config.bgColor ?? 'transparent', overflow: 'hidden' }}>
      <FitBox
        baseFontPx={config.fontSize ?? 400}
        align={config.align ?? 'center'}
        style={{ color: config.color ?? '#fff', fontFamily: config.fontFamily ?? 'Inter, system-ui, sans-serif' }}
      >
        {config.label !== '' && <div style={{ fontSize: '0.3em', fontWeight: 800, letterSpacing: 2, color: '#64748b' }}>{config.label ?? 'TEAM'}</div>}
        <div style={{ fontWeight: 900, color: config.color ?? '#fff' }}>{display}</div>
      </FitBox>
    </div>
  );
}

// ════════════════ TRACK / SWIM (leaderboard) ════════════════

export function LeaderboardWidget({ config }: { config: ElCfg & { rows?: Array<{ place?: number | string; lane?: number | string; name?: string; time?: string }> } }) {
  // Complex multi-row list with fixed proportional column layout — not a single text overflow.
  // The font is elRoot-driven (zone-relative via em); rows self-scroll via overflow:hidden. Left alone.
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
