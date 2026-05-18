'use client';
/**
 * Shared sports situational graphics — the broadcast-style state strip
 * rendered beneath the score on BOTH the scoreboard widget and the
 * standalone venue /board page. ONE source of truth so the template
 * widget and the game-day display can never drift apart.
 *
 * Per sport:
 *   - baseball / softball  → lit base diamond + B/S/O pip clusters
 *   - football             → possession marker + down & distance + ball-on
 *   - basketball           → per-team timeout pips + BONUS badges + possession
 *   - volleyball / pickle  → serve indicator
 *   - everything else      → clean SportDefinition stat chips
 *
 * Surface-agnostic: the caller passes plain colors (accent / ink / dim
 * / hairline) and a height `h` that the situational sizing scales off.
 */
import type { CSSProperties } from 'react';
import type { SportDefinition } from '@cms/api-types';

function px(zoneH: number, f: number): number {
  return Math.max(8, Math.round(zoneH * f));
}
function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
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

export interface SituationalColors {
  accent: string;
  ink: string;
  dim: string;
  hairline: string;
}

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

type RowProps = { def: SportDefinition; stats: Record<string, unknown>; h: number } & SituationalColors;

/**
 * Does this sport + state actually have a broadcast situational graphic
 * worth drawing? A compact surface (the scorebug) calls this to decide
 * whether to render the strip's frame at all; `SituationalRow` itself
 * uses it as the empty-guard, so the predicate and the renderer can
 * never disagree about whether there is anything to show.
 */
export function hasSituational(def: SportDefinition, stats: Record<string, unknown>): boolean {
  // Baseball / softball always have a live count worth showing.
  if (def.segment.name === 'Inning') return true;
  // Football — only once a down is set, the ball has a spot, or
  // possession is known.
  if (def.key === 'football') {
    return (
      num(stats.down) > 0 ||
      side(stats.possession) !== null ||
      (stats.ballOn !== undefined && stats.ballOn !== null && stats.ballOn !== '')
    );
  }
  // Basketball — timeout pips are always meaningful.
  if (def.key === 'basketball') return true;
  // Rally sports show a serve indicator when a server is set.
  if ((def.key === 'volleyball' || def.key === 'pickleball') && String(stats.serving || '').trim()) {
    return true;
  }
  // Everything else — only if at least one SportDefinition stat has a value.
  return def.stats.some((s) => {
    const raw = stats[s.key];
    return raw !== undefined && raw !== null && raw !== '';
  });
}

/** The broadcast situational strip — dispatches on sport. */
export function SituationalRow({ def, stats, h, accent, ink, dim, hairline }: RowProps) {
  if (!hasSituational(def, stats)) return null;
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: px(h, 0.06),
    height: px(h, 0.17),
    borderTop: `1px solid ${hairline}`,
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
          accent={accent}
          dim={dim}
          h={h}
        />
        <Count label="B" n={3} filled={num(stats.balls)} accent={accent} dim={dim} h={h} />
        <Count label="S" n={2} filled={num(stats.strikes)} accent={accent} dim={dim} h={h} />
        <Count label="O" n={2} filled={num(stats.outs)} accent="#dc2626" dim={dim} h={h} />
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
          <span style={{ fontSize: px(h, 0.06), fontWeight: 900, color: accent }}>
            {poss === 'home' ? '◀' : ''} {poss.toUpperCase()} BALL {poss === 'away' ? '▶' : ''}
          </span>
        )}
        {down > 0 && (
          <span style={{ fontSize: px(h, 0.07), fontWeight: 900, color: ink, letterSpacing: 1 }}>
            {ordinal(down)} &amp; {dist === 0 ? 'GOAL' : dist}
          </span>
        )}
        {ballOn !== undefined && ballOn !== null && ballOn !== '' && (
          <span style={{ fontSize: px(h, 0.055), fontWeight: 800, color: dim, letterSpacing: 1 }}>
            BALL ON {String(ballOn)}
          </span>
        )}
      </div>
    );
  }

  // ── Basketball — per-team timeouts + bonus, possession arrow ──
  if (def.key === 'basketball') {
    const poss = side(stats.possession);
    const bonus = (f: number) => (f >= 10 ? 'DOUBLE BONUS' : f >= 7 ? 'BONUS' : null);
    const TeamSit = ({ to, b, alignR }: { to: number; b: string | null; alignR?: boolean }) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: px(h, 0.03), flexDirection: alignR ? 'row-reverse' : 'row' }}>
        <Pips n={5} filled={to} color={accent} dim={dim} size={px(h, 0.04)} />
        {b && (
          <span style={{ fontSize: px(h, 0.05), fontWeight: 900, color: '#f59e0b', letterSpacing: 1 }}>{b}</span>
        )}
      </span>
    );
    return (
      <div style={rowStyle}>
        <TeamSit to={num(stats.homeTimeouts)} b={bonus(num(stats.homeFouls))} />
        <span style={{ fontSize: px(h, 0.055), fontWeight: 900, color: accent, letterSpacing: 1 }}>
          {poss === 'home' ? '◀ ' : ''}POSS{poss === 'away' ? ' ▶' : ''}
        </span>
        <TeamSit to={num(stats.awayTimeouts)} b={bonus(num(stats.awayFouls))} alignR />
      </div>
    );
  }

  // ── Rally sports — serve indicator ──
  if (def.key === 'volleyball' || def.key === 'pickleball') {
    const serving = String(stats.serving || '').trim();
    if (serving) {
      return (
        <div style={rowStyle}>
          <span style={{ fontSize: px(h, 0.06), fontWeight: 900, color: accent, letterSpacing: 1 }}>
            🏐 SERVING — {serving.toUpperCase()}
          </span>
        </div>
      );
    }
  }

  // ── Everything else — clean stat chips ──
  const chips = def.stats
    .map((s) => {
      const raw = stats[s.key];
      if (raw === undefined || raw === null || raw === '') return null;
      return { label: s.label.toUpperCase(), value: String(raw) };
    })
    .filter((x): x is { label: string; value: string } => x !== null)
    .slice(0, 6);
  if (chips.length === 0) return null;
  return (
    <div style={{ ...rowStyle, flexWrap: 'wrap' }}>
      {chips.map((s) => (
        <span key={s.label} style={{ fontSize: px(h, 0.055), fontWeight: 700, color: dim }}>
          {s.label}{' '}
          <strong style={{ color: ink, fontVariantNumeric: 'tabular-nums' }}>{s.value}</strong>
        </span>
      ))}
    </div>
  );
}
