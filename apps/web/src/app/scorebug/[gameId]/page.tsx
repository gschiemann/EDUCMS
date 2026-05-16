'use client';

/**
 * VenueOS Sports — Sprint 13 Phase 2. The broadcast scorebug overlay.
 *
 * PUBLIC route (no auth). Designed to be added as a "browser source"
 * in OBS / vMix / Streamlabs: a compact, transparent-background score
 * bug that sits in a corner of the livestream. It polls the same
 * un-authed /sports/board/:id endpoint as the in-venue scoreboard, so
 * one operator console drives both the big board and the broadcast.
 *
 * Query params (all optional):
 *   ?pos=tl|tr|bl|br   corner to dock in        (default bl)
 *   ?scale=1.4         size multiplier          (default 1)
 *   ?home=LIN ?away=CEN  override team codes    (default: first word)
 *
 * Transparency: this component injects CSS to clear the document
 * background + hide the dashboard's decorative gradient. OBS also
 * zeroes the body itself, so the bug composites cleanly over video.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
import { findSport } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';

interface Cue {
  id: string;
  key?: string;
  label?: string;
  emoji?: string;
}
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
  clockMs: number;
  clockRunning: boolean;
  clockUpdatedAt: string;
  stats: Record<string, unknown>;
  cues: Cue[];
  serverTime: number;
}

const DEFAULT_HOME = '#4f46e5';
const DEFAULT_AWAY = '#dc2626';
const POLL_MS = 2000;

const POS: Record<
  string,
  { v: 'top' | 'bottom'; h: 'left' | 'right'; origin: string }
> = {
  tl: { v: 'top', h: 'left', origin: 'top left' },
  tr: { v: 'top', h: 'right', origin: 'top right' },
  bl: { v: 'bottom', h: 'left', origin: 'bottom left' },
  br: { v: 'bottom', h: 'right', origin: 'bottom right' },
};

// ── helpers ────────────────────────────────────────────────────

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

function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function segmentLabel(def: SportDefinition, data: BoardData): string {
  const n = data.segment;
  if (n > def.segment.count) {
    const ot = n - def.segment.count;
    return ot > 1 ? `OT${ot}` : 'OT';
  }
  if (def.segment.name === 'Inning') {
    const half = String((data.stats || {}).half || '').toUpperCase();
    return `${half ? half + ' ' : ''}${ordinal(n)}`;
  }
  if (def.segment.name === 'Quarter') return `Q${n}`;
  if (def.segment.name === 'Period') return `P${n}`;
  return `${def.segment.name.toUpperCase()} ${n}`;
}

/** Team code: explicit override → else first word, upper, ≤11 chars. */
function teamCode(name: string, override: string | null): string {
  if (override) return override.trim().toUpperCase().slice(0, 11);
  const first = String(name || '').trim().split(/\s+/)[0] || '—';
  return first.toUpperCase().slice(0, 11);
}

// ── live clock ─────────────────────────────────────────────────

function useLiveClock(data: BoardData | null, def: SportDefinition | undefined): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!data || !def) return;
    const skew = data.serverTime - Date.now();
    const anchorAt = new Date(data.clockUpdatedAt).getTime();
    const project = () => {
      if (!data.clockRunning || def.clock.type === 'none') {
        setMs(data.clockMs);
        return;
      }
      const elapsed = Date.now() + skew - anchorAt;
      if (def.clock.type === 'countup') setMs(data.clockMs + elapsed);
      else setMs(Math.max(0, data.clockMs - elapsed));
    };
    project();
    if (!data.clockRunning || def.clock.type === 'none') return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
  }, [data?.clockMs, data?.clockRunning, data?.clockUpdatedAt, data?.serverTime, def]);
  return ms;
}

// ── page ───────────────────────────────────────────────────────

export default function ScorebugPage() {
  const params = useParams();
  const search = useSearchParams();
  const gameId = String(params?.gameId || '');

  const pos = POS[String(search?.get('pos') || 'bl')] || POS.bl;
  const scaleRaw = parseFloat(String(search?.get('scale') || '1'));
  const scale = Number.isFinite(scaleRaw) ? Math.min(4, Math.max(0.4, scaleRaw)) : 1;
  const homeOverride = search?.get('home') || null;
  const awayOverride = search?.get('away') || null;

  const [data, setData] = useState<BoardData | null>(null);

  // cue playback
  const [activeCue, setActiveCue] = useState<Cue | null>(null);
  const seenCues = useRef<Set<string>>(new Set());
  const cueQueue = useRef<Cue[]>([]);
  const firstLoad = useRef(true);
  const playing = useRef(false);

  const pumpCues = () => {
    if (playing.current) return;
    const next = cueQueue.current.shift();
    if (!next) return;
    playing.current = true;
    setActiveCue(next);
    setTimeout(() => {
      setActiveCue(null);
      playing.current = false;
      pumpCues();
    }, 3600);
  };

  useEffect(() => {
    if (!gameId) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/sports/board/${gameId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const json: BoardData = await res.json();
        if (!alive) return;
        setData(json);
        for (const c of json.cues || []) {
          if (seenCues.current.has(c.id)) continue;
          seenCues.current.add(c.id);
          if (!firstLoad.current) cueQueue.current.push(c);
        }
        firstLoad.current = false;
        pumpCues();
      } catch {
        /* keep the last good frame on a transient network error */
      }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [gameId]);

  const def = useMemo(() => (data ? findSport(data.sport) : undefined), [data]);
  const liveMs = useLiveClock(data, def);

  // Transparency: clear the document bg + hide the dashboard's
  // decorative top gradient so only the bug composites over video.
  const transparentCss = (
    <style>{`
      html, body { background: transparent !important; }
      main > [class~="-z-10"] { display: none !important; }
    `}</style>
  );

  // Pre-data / unknown sport → render nothing. An OBS overlay must
  // never flash a loading or error box onto a live broadcast.
  if (!data || !def) return transparentCss;

  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  const hasClock = def.clock.type !== 'none';
  const cueAbove = pos.v === 'bottom';

  return (
    <>
      {transparentCss}
      <style>{`
        @keyframes sbCueIn {
          0% { opacity: 0; transform: translateY(${cueAbove ? '14px' : '-14px'}) scale(0.9); }
          12% { opacity: 1; transform: translateY(0) scale(1); }
          86% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(${cueAbove ? '-6px' : '6px'}) scale(1); }
        }
      `}</style>

      <div
        style={{
          position: 'fixed',
          [pos.v]: 0,
          [pos.h]: 0,
          padding: 32,
          zIndex: 2147483000,
        }}
      >
        <div style={{ transform: `scale(${scale})`, transformOrigin: pos.origin }}>
          {/* celebration toast */}
          {activeCue && (
            <div
              style={{
                position: 'absolute',
                [cueAbove ? 'bottom' : 'top']: '100%',
                [pos.h]: 0,
                [cueAbove ? 'marginBottom' : 'marginTop']: 10,
                display: 'flex',
                alignItems: 'center',
                background: 'linear-gradient(135deg, #1e2638, #0b0f1a)',
                border: '2px solid #fbbf24',
                borderRadius: 12,
                padding: '10px 18px',
                boxShadow: '0 8px 28px rgba(0,0,0,0.6)',
                whiteSpace: 'nowrap',
                animation: 'sbCueIn 3.6s ease-in-out forwards',
              }}
            >
              <span style={{ fontSize: 30, marginRight: 10 }}>{activeCue.emoji || '🎉'}</span>
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 900,
                  letterSpacing: 2,
                  color: '#fff',
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
              >
                {(activeCue.label || activeCue.key || 'NICE!').toUpperCase()}
              </span>
            </div>
          )}

          {/* the bug */}
          <div
            style={{
              display: 'flex',
              height: 100,
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: '0 6px 26px rgba(0,0,0,0.6)',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            <TeamBlock
              code={teamCode(data.homeTeam, homeOverride)}
              score={data.homeScore}
              color={homeColor}
              side="home"
            />

            {/* center — clock + segment */}
            <div
              style={{
                width: 150,
                background: '#070a12',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {hasClock && (
                <div
                  style={{
                    fontSize: 34,
                    fontWeight: 900,
                    lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                    color: data.clockRunning ? '#fbbf24' : '#e2e8f0',
                  }}
                >
                  {fmtClock(liveMs)}
                </div>
              )}
              <div
                style={{
                  fontSize: hasClock ? 14 : 30,
                  fontWeight: 800,
                  letterSpacing: 2,
                  color: hasClock ? '#64748b' : '#e2e8f0',
                  marginTop: hasClock ? 4 : 0,
                }}
              >
                {segmentLabel(def, data)}
              </div>
            </div>

            <TeamBlock
              code={teamCode(data.awayTeam, awayOverride)}
              score={data.awayScore}
              color={awayColor}
              side="away"
            />
          </div>
        </div>
      </div>
    </>
  );
}

function TeamBlock({
  code,
  score,
  color,
  side,
}: {
  code: string;
  score: number;
  color: string;
  side: 'home' | 'away';
}) {
  const name = (
    <div
      style={{
        width: 158,
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 12px',
      }}
    >
      <span
        style={{
          fontSize: 26,
          fontWeight: 900,
          letterSpacing: 1,
          color: '#fff',
          textShadow: '0 2px 6px rgba(0,0,0,0.45)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {code}
      </span>
    </div>
  );
  const scoreBox = (
    <div
      style={{
        width: 82,
        background: '#11161f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        style={{
          fontSize: 46,
          fontWeight: 900,
          color: '#fff',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {score}
      </span>
    </div>
  );
  // Home: NAME | SCORE   ·   Away: SCORE | NAME (mirrored).
  return side === 'home' ? (
    <>
      {name}
      {scoreBox}
    </>
  ) : (
    <>
      {scoreBox}
      {name}
    </>
  );
}
