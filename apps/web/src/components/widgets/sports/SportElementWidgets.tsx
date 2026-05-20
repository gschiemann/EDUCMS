'use client';

/**
 * Composable scoreboard ELEMENT widgets (universal set).
 * ─────────────────────────────────────────────────────
 * Operator mandate (2026-05-19): "make sure everything in these
 * scoreboards are added as widgets and can be added or removed from
 * them … keep every aspect editable down to the finest detail."
 *
 * Each export here is a single scoreboard element the operator drops on
 * the canvas, positions, sizes, and styles independently — the opposite
 * of the monolithic MainScoreboardWidget. They read live game state from
 * GameStateContext (the GameStateProvider CustomScoreboardScene wraps the
 * rendered template in); outside a provider (builder canvas / gallery
 * thumbnail) they fall back to representative sample values so the tile
 * is never blank.
 *
 * Editable + brandable: every widget honours flat style config
 * (color, fontFamily, fontSize, fontWeight, bgColor, align, accentColor)
 * — the exact keys the builder Properties panel + BrandKit write — so a
 * scoreboard brands the same way a template does.
 *
 * Chromium-83 / NovaStar-Taurus SAFE: long-hand top/right/bottom/left,
 * explicit margins (no flex `gap`), no `inset` shorthand, no
 * `aspect-ratio`, no `backdrop-filter`.
 *
 * The per-sport element widgets (down/distance, base diamond, penalty
 * box, sets, riding time, leaderboard, …) live in
 * SportElementWidgets.<sport>.tsx and follow this same pattern.
 */

import React from 'react';
import { useGameState, type GameSnapshot } from './GameStateContext';

// ── shared style ─────────────────────────────────────────────────────
export interface ElCfg {
  team?: 'home' | 'away';
  color?: string;
  bgColor?: string;
  accentColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  letterSpacing?: number;
  align?: 'left' | 'center' | 'right';
  label?: string;
  statKey?: string;
  placeholder?: string;
  uppercase?: boolean;
}

export function elRoot(cfg: ElCfg, extra?: React.CSSProperties): React.CSSProperties {
  const justify = cfg.align === 'left' ? 'flex-start' : cfg.align === 'right' ? 'flex-end' : 'center';
  return {
    width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: justify,
    color: cfg.color ?? '#ffffff', backgroundColor: cfg.bgColor ?? 'transparent',
    fontFamily: cfg.fontFamily ?? 'Inter, system-ui, sans-serif',
    fontWeight: cfg.fontWeight ?? 800,
    letterSpacing: cfg.letterSpacing != null ? `${cfg.letterSpacing}px` : undefined,
    fontSize: cfg.fontSize ?? undefined,
    textAlign: cfg.align ?? 'center', overflow: 'hidden',
    fontVariantNumeric: 'tabular-nums',
    ...extra,
  };
}

/** Project a sub-clock anchor ({ ms, at, running }) forward locally. */
export function useSubClock(anchor: { ms?: number; at?: string; running?: boolean } | null | undefined, serverTime?: number) {
  const [ms, setMs] = React.useState<number>(anchor?.ms ?? 0);
  React.useEffect(() => {
    if (!anchor) { setMs(0); return; }
    const skew = serverTime ? Date.now() - serverTime : 0;
    const at = anchor.at ? new Date(anchor.at).getTime() : 0;
    const project = () => {
      if (!anchor.running || !at) { setMs(Math.max(0, anchor.ms ?? 0)); return; }
      setMs(Math.max(0, (anchor.ms ?? 0) - (Date.now() - at - skew)));
    };
    project();
    if (!anchor.running) return;
    const id = setInterval(project, 100);
    return () => clearInterval(id);
  }, [anchor?.ms, anchor?.at, anchor?.running, serverTime]);
  return ms;
}

export function teamOf(snap: GameSnapshot | null | undefined, team: 'home' | 'away') {
  // Builder/thumbnail (no live snapshot) → sample names so logo
  // initials + team-name elements read "EAGLES" / "TIGERS" instead of
  // blank "?".
  if (!snap) {
    return team === 'away'
      ? { name: 'TIGERS', color: '#dc2626', logo: null as string | null }
      : { name: 'EAGLES', color: '#4f46e5', logo: null as string | null };
  }
  return team === 'away'
    ? { name: snap.awayTeam, color: snap.awayColor, logo: snap.awayLogoUrl }
    : { name: snap.homeTeam, color: snap.homeColor, logo: snap.homeLogoUrl };
}

// ── Team name ────────────────────────────────────────────────────────
export function TeamNameWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const t = teamOf(s?.snapshot, team);
  const name = t.name ?? (team === 'away' ? 'TIGERS' : 'EAGLES');
  return <div style={elRoot(config, { fontWeight: config.fontWeight ?? 800 })}>{config.uppercase === false ? name : name.toUpperCase()}</div>;
}

// ── Team abbreviation (first 3 letters, or full if short) ────────────
export function TeamAbbrWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const t = teamOf(s?.snapshot, team);
  const name = t.name ?? (team === 'away' ? 'TIGERS' : 'EAGLES');
  const abbr = name.trim().slice(0, 3).toUpperCase();
  return <div style={elRoot(config, { fontWeight: config.fontWeight ?? 900 })}>{abbr}</div>;
}

// ── Team logo (or color initial disc) ────────────────────────────────
export function TeamLogoWidget({ config }: { config: ElCfg & { logoUrl?: string } }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const t = teamOf(s?.snapshot, team);
  const color = (config as any).color || t.color || (team === 'away' ? '#dc2626' : '#4f46e5');
  // 2026-05-20 — operator wants to brand a board by pasting a logo URL
  // BEFORE a game is bound. A config.logoUrl overrides the live game
  // logo; if neither is set we fall back to the color-initial disc.
  const logo = (config.logoUrl && config.logoUrl.trim()) || t.logo;
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent' })}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.5))' }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
      ) : (
        <div style={{ width: '72%', height: '72%', borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: config.fontSize ?? 64, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {((t.name ?? '?').trim()[0] || '?').toUpperCase()}
        </div>
      )}
    </div>
  );
}

// ── Team record (W-L) — config-driven (no live source yet) ───────────
export function TeamRecordWidget({ config }: { config: ElCfg }) {
  const display = config.placeholder ?? (config.team === 'away' ? '8-3' : '10-1');
  return <div style={elRoot(config, { fontWeight: config.fontWeight ?? 700, color: config.color ?? '#94a3b8' })}>{display}</div>;
}

// ── Game status pill (LIVE / FINAL / etc.) ───────────────────────────
const STATUS: Record<string, { label: string; bg: string; pulse?: boolean }> = {
  SCHEDULED: { label: 'SCHEDULED', bg: '#475569' },
  PRE_GAME: { label: 'PRE-GAME', bg: '#d97706' },
  LIVE: { label: 'LIVE', bg: '#dc2626', pulse: true },
  HALFTIME: { label: 'HALFTIME', bg: '#2563eb' },
  FINAL: { label: 'FINAL', bg: '#1e293b' },
};
export function GameStatusWidget({ config, live = true }: { config: ElCfg; live?: boolean }) {
  const s = useGameState();
  const st = STATUS[s?.snapshot?.status ?? 'LIVE'] || STATUS.SCHEDULED;
  const pulse = !!st.pulse && live !== false;
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent' })}>
      {pulse && <style>{`@keyframes sbStatusPulse{0%,100%{opacity:1}50%{opacity:.6}}`}</style>}
      <div style={{ display: 'flex', alignItems: 'center', background: config.accentColor ?? st.bg, padding: '0.35em 0.8em', borderRadius: 999, fontWeight: 900, letterSpacing: 3, fontSize: config.fontSize, animation: pulse ? 'sbStatusPulse 1.6s ease-in-out infinite' : undefined }}>
        {st.pulse && <span style={{ width: '0.5em', height: '0.5em', borderRadius: 999, background: '#fff', marginRight: '0.45em', display: 'inline-block' }} />}
        {config.label ?? st.label}
      </div>
    </div>
  );
}

// ── Timeouts remaining (pips) ────────────────────────────────────────
export function TimeoutsWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const key = config.statKey ?? (team === 'away' ? 'awayTimeouts' : 'homeTimeouts');
  const raw = s?.snapshot?.stats?.[key];
  const left = raw != null ? Number(raw) : 3;
  const max = 3;
  const accent = config.accentColor ?? config.color ?? '#fbbf24';
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent' })}>
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} style={{ width: '0.7em', height: '0.28em', borderRadius: 2, marginLeft: i ? '0.25em' : 0, display: 'inline-block', background: i < left ? accent : 'rgba(255,255,255,0.18)' }} />
      ))}
    </div>
  );
}

// ── Possession arrow (alternating possession, basketball/football) ───
export function PossessionArrowWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const poss = String(s?.snapshot?.stats?.possession ?? 'home').toLowerCase();
  const accent = config.accentColor ?? config.color ?? '#fbbf24';
  const left = poss === 'home';
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent', color: accent })}>
      <span style={{ fontSize: config.fontSize ?? '1em', fontWeight: 900 }}>{left ? '◀' : '▶'}</span>
    </div>
  );
}

// ── Possession indicator (who has the ball — football 🏈) ────────────
export function PossessionBallWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const poss = String(s?.snapshot?.stats?.possession ?? 'home').toLowerCase();
  const lit = poss === team;
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent', opacity: lit ? 1 : 0.12 })}>
      <span style={{ fontSize: config.fontSize ?? '1em' }}>🏈</span>
    </div>
  );
}

// ── Play clock (football 40/25s — own anchor in stats.playClock) ─────
export function PlayClockWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const raw = s?.snapshot?.stats?.playClock as any;
  const armed = !!(raw && raw.at);
  const ms = useSubClock(armed ? raw : null, s?.snapshot?.serverTime);
  const secs = !armed ? 40 : ms <= 5000 ? (ms / 1000).toFixed(1) : Math.ceil(ms / 1000);
  const danger = armed && ms <= 5000;
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent', flexDirection: 'column' })}>
      {config.label !== '' && <div style={{ fontSize: '0.28em', fontWeight: 800, letterSpacing: 3, color: '#64748b' }}>{config.label ?? 'PLAY'}</div>}
      <div style={{ fontWeight: 900, color: danger ? '#ef4444' : (config.color ?? '#e2e8f0') }}>{secs}</div>
    </div>
  );
}

// ── Shot clock (basketball/lacrosse/water polo — stats.shotClock) ────
export function ShotClockWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const raw = s?.snapshot?.stats?.shotClock as any;
  const len = Number(raw?.len) || 0;
  const ms = useSubClock(len > 0 ? raw : null, s?.snapshot?.serverTime);
  if (len <= 0 && s?.snapshot) {
    // sport has no shot clock right now — render nothing on a live board
    return <div style={elRoot(config, { backgroundColor: 'transparent' })} />;
  }
  const display = !s?.snapshot ? '24' : ms <= 5000 ? (ms / 1000).toFixed(1) : Math.ceil(ms / 1000);
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent', flexDirection: 'column' })}>
      {config.label !== '' && <div style={{ fontSize: '0.28em', fontWeight: 800, letterSpacing: 3, color: '#64748b' }}>{config.label ?? 'SHOT'}</div>}
      <div style={{ fontWeight: 900, color: (s?.snapshot && ms <= 5000) ? '#ef4444' : (config.color ?? '#e2e8f0') }}>{display}</div>
    </div>
  );
}

// ── Added time (soccer stoppage +N) ──────────────────────────────────
export function AddedTimeWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const key = config.statKey ?? 'addedTime';
  const raw = s?.snapshot?.stats?.[key];
  const n = raw != null && raw !== '' ? Number(raw) : (s?.snapshot ? 0 : 3);
  if (s?.snapshot && (!n || n <= 0)) return <div style={elRoot(config, { backgroundColor: 'transparent' })} />;
  return <div style={elRoot(config, { backgroundColor: config.bgColor ?? 'rgba(251,191,36,0.16)', color: config.color ?? '#fbbf24', fontWeight: 900 })}>+{n}</div>;
}

// ── Bonus / double-bonus lamp (basketball) ───────────────────────────
export function BonusLampWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const key = config.statKey ?? (team === 'away' ? 'awayFouls' : 'homeFouls');
  const fouls = Number(s?.snapshot?.stats?.[key] ?? (s?.snapshot ? 0 : 8));
  const bonus = fouls >= 7;
  const dbl = fouls >= 10;
  const onColor = dbl ? '#ef4444' : '#fbbf24';
  const lit = bonus || !s?.snapshot;
  return (
    <div style={elRoot(config, { backgroundColor: 'transparent', opacity: lit ? 1 : 0.18 })}>
      <span style={{ background: lit ? (config.accentColor ?? onColor) : 'rgba(255,255,255,0.1)', color: lit ? '#11131a' : '#64748b', padding: '0.2em 0.55em', borderRadius: 6, fontWeight: 900, letterSpacing: 1, fontSize: config.fontSize }}>
        {dbl ? 'DOUBLE BONUS' : 'BONUS'}
      </span>
    </div>
  );
}

// ── Sponsor slot (image or text) ─────────────────────────────────────
export function SponsorSlotWidget({ config }: { config: ElCfg & { imageUrl?: string } }) {
  const url = (config as any).imageUrl;
  return (
    <div style={elRoot(config, { backgroundColor: config.bgColor ?? 'rgba(255,255,255,0.04)', borderRadius: 8 })}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="sponsor" style={{ maxWidth: '90%', maxHeight: '80%', objectFit: 'contain' }} />
      ) : (
        <span style={{ color: config.color ?? '#64748b', fontWeight: 700, letterSpacing: 2, fontSize: config.fontSize }}>{config.label ?? 'YOUR SPONSOR'}</span>
      )}
    </div>
  );
}

// ── Team fouls (basketball) ──────────────────────────────────────────
export function TeamFoulsWidget({ config }: { config: ElCfg }) {
  const s = useGameState();
  const team = config.team ?? 'home';
  const key = config.statKey ?? (team === 'away' ? 'awayFouls' : 'homeFouls');
  const fouls = s?.snapshot?.stats?.[key];
  const display = fouls != null ? String(fouls) : (s?.snapshot ? '0' : '4');
  return (
    <div style={elRoot(config, { flexDirection: 'column', backgroundColor: 'transparent' })}>
      {config.label !== '' && <div style={{ fontSize: '0.32em', fontWeight: 800, letterSpacing: 2, color: '#64748b' }}>{config.label ?? 'FOULS'}</div>}
      <div style={{ fontWeight: 900, color: config.color ?? '#fff' }}>{display}</div>
    </div>
  );
}
