'use client';

/**
 * VenueOS Sports — Sprint 13. The live scoreboard board page.
 *
 * PUBLIC route (no auth) — a stadium screen renders this. It polls the
 * un-authed GET /sports/board/:id endpoint, ticks the clock locally
 * from the stored anchor (clockMs + clockUpdatedAt + clockRunning),
 * and fires a full-bleed celebration overlay when the operator taps a
 * cue ("Touchdown", "GOAL!", "Home Run", …).
 *
 * Chromium-83 safe (NovaStar Taurus / video-processor targets):
 *   • no `inset` shorthand — long-hand top/right/bottom/left only
 *   • no flex `gap` — explicit margins
 *   • no `backdrop-filter`
 *   • fixed 1920×1080 scene + transform:scale to fit any canvas
 *     (the pattern CLAUDE.md mandates for player surfaces)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
import { findSport } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';

interface Cue {
  id: string;
  key?: string;
  label?: string;
  emoji?: string;
  createdAt?: string;
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

// ── formatting helpers ─────────────────────────────────────────

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
  return `${def.segment.name.toUpperCase()} ${n}`;
}

const STATUS_STYLE: Record<string, { label: string; bg: string; pulse?: boolean }> = {
  SCHEDULED: { label: 'SCHEDULED', bg: '#475569' },
  PRE_GAME: { label: 'PRE-GAME', bg: '#d97706' },
  LIVE: { label: 'LIVE', bg: '#dc2626', pulse: true },
  HALFTIME: { label: 'HALFTIME', bg: '#2563eb' },
  FINAL: { label: 'FINAL', bg: '#1e293b' },
};

// ── the 1920×1080 scoreboard scene ─────────────────────────────

function TeamPanel({
  side,
  name,
  score,
  color,
  winning,
}: {
  side: 'home' | 'away';
  name: string;
  score: number;
  color: string;
  winning: boolean;
}) {
  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(${side === 'home' ? '135deg' : '225deg'}, ${color}26, #0b0f1a 70%)`,
        borderTop: `10px solid ${color}`,
      }}
    >
      <div
        style={{
          fontSize: 62,
          fontWeight: 800,
          letterSpacing: 1,
          color: '#fff',
          textAlign: 'center',
          maxWidth: 620,
          lineHeight: 1.05,
          textShadow: '0 4px 18px rgba(0,0,0,0.6)',
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: 6,
          color,
          marginTop: 10,
        }}
      >
        {side === 'home' ? 'HOME' : 'AWAY'}
      </div>
      <div
        style={{
          fontSize: 300,
          fontWeight: 900,
          color: '#fff',
          lineHeight: 1,
          marginTop: 8,
          fontVariantNumeric: 'tabular-nums',
          textShadow: winning ? `0 0 60px ${color}` : '0 8px 30px rgba(0,0,0,0.7)',
        }}
      >
        {score}
      </div>
    </div>
  );
}

function BoardScene({ data, def }: { data: BoardData; def: SportDefinition }) {
  const [clockMs, setClockMs] = useState(data.clockMs);

  // Tick the clock locally off the stored anchor. The server never
  // ticks — clockMs is the reading at clockUpdatedAt; we project it.
  useEffect(() => {
    const skew = data.serverTime - Date.now(); // local + skew ≈ server
    const anchorAt = new Date(data.clockUpdatedAt).getTime();
    const project = () => {
      if (!data.clockRunning || def.clock.type === 'none') {
        setClockMs(data.clockMs);
        return;
      }
      const elapsed = Date.now() + skew - anchorAt;
      if (def.clock.type === 'countup') setClockMs(data.clockMs + elapsed);
      else setClockMs(Math.max(0, data.clockMs - elapsed));
    };
    project();
    if (!data.clockRunning || def.clock.type === 'none') return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
  }, [data.clockMs, data.clockRunning, data.clockUpdatedAt, data.serverTime, def]);

  const status = STATUS_STYLE[data.status] || STATUS_STYLE.SCHEDULED;
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  const hasClock = def.clock.type !== 'none';

  const statChips = def.stats
    .map((s) => ({ ...s, value: (data.stats || {})[s.key] }))
    .filter((s) => s.value !== undefined && s.value !== null && s.value !== '');

  return (
    <div
      style={{
        width: 1920,
        height: 1080,
        background: 'radial-gradient(ellipse at 50% 0%, #131a2e, #05070d 75%)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* header strip */}
      <div
        style={{
          height: 92,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 44px',
          background: '#05070d',
          borderBottom: '2px solid #1e2638',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 40, fontWeight: 800, letterSpacing: 1 }}>
          <span style={{ fontSize: 48, marginRight: 16 }}>{def.emoji}</span>
          {def.name.toUpperCase()}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: status.bg,
            padding: '12px 28px',
            borderRadius: 999,
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: 3,
            animation: status.pulse ? 'venuePulse 1.6s ease-in-out infinite' : undefined,
          }}
        >
          {status.pulse && (
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 999,
                background: '#fff',
                marginRight: 14,
                display: 'inline-block',
              }}
            />
          )}
          {status.label}
        </div>
      </div>

      {/* main row: HOME | center | AWAY */}
      <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
        <TeamPanel
          side="home"
          name={data.homeTeam}
          score={data.homeScore}
          color={homeColor}
          winning={data.homeScore > data.awayScore && data.status !== 'SCHEDULED'}
        />

        {/* center column — clock + segment */}
        <div
          style={{
            width: 520,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#05070d',
          }}
        >
          <div
            style={{
              fontSize: 38,
              fontWeight: 800,
              letterSpacing: 5,
              color: '#94a3b8',
            }}
          >
            {segmentLabel(def, data)}
          </div>
          {hasClock ? (
            <div
              style={{
                fontSize: 200,
                fontWeight: 900,
                lineHeight: 1,
                marginTop: 18,
                fontVariantNumeric: 'tabular-nums',
                color: data.clockRunning ? '#fbbf24' : '#e2e8f0',
                textShadow: data.clockRunning ? '0 0 50px rgba(251,191,36,0.5)' : 'none',
              }}
            >
              {fmtClock(clockMs)}
            </div>
          ) : (
            <div
              style={{
                fontSize: 150,
                fontWeight: 900,
                lineHeight: 1,
                marginTop: 24,
                color: '#e2e8f0',
              }}
            >
              {def.emoji}
            </div>
          )}
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 3, color: '#475569', marginTop: 18 }}>
            VENUEOS
          </div>
        </div>

        <TeamPanel
          side="away"
          name={data.awayTeam}
          score={data.awayScore}
          color={awayColor}
          winning={data.awayScore > data.homeScore && data.status !== 'SCHEDULED'}
        />
      </div>

      {/* footer strip — sport-specific stats */}
      <div
        style={{
          height: 132,
          background: '#05070d',
          borderTop: '2px solid #1e2638',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 44px',
        }}
      >
        {statChips.length === 0 ? (
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 4, color: '#334155' }}>
            {data.homeTeam.toUpperCase()} vs {data.awayTeam.toUpperCase()}
          </div>
        ) : (
          statChips.map((s) => (
            <div
              key={s.key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                background: '#0e1424',
                border: '2px solid #1e2638',
                borderRadius: 16,
                padding: '16px 30px',
                margin: '0 12px',
                minWidth: 130,
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, color: '#64748b' }}>
                {s.label.toUpperCase()}
              </div>
              <div style={{ fontSize: 46, fontWeight: 900, color: '#fff', marginTop: 4 }}>
                {String(s.value)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── celebration overlay ────────────────────────────────────────

function CueOverlay({ cue }: { cue: Cue }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(5,7,13,0.78)',
        animation: 'venueCueFade 3.8s ease-in-out forwards',
        zIndex: 50,
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 900,
          height: 900,
          borderRadius: 999,
          background: 'radial-gradient(circle, rgba(251,191,36,0.55), transparent 65%)',
          animation: 'venueCueGlow 3.8s ease-in-out forwards',
        }}
      />
      <div
        style={{
          fontSize: 420,
          lineHeight: 1,
          animation: 'venueCuePop 3.8s cubic-bezier(.2,.9,.2,1) forwards',
        }}
      >
        {cue.emoji || '🎉'}
      </div>
      <div
        style={{
          fontSize: 130,
          fontWeight: 900,
          letterSpacing: 4,
          color: '#fff',
          marginTop: 10,
          textShadow: '0 8px 40px rgba(0,0,0,0.8)',
          animation: 'venueCuePop 3.8s cubic-bezier(.2,.9,.2,1) forwards',
        }}
      >
        {(cue.label || cue.key || 'NICE!').toUpperCase()}
      </div>
    </div>
  );
}

// ── page ───────────────────────────────────────────────────────

export default function ScoreboardPage() {
  const params = useParams();
  const gameId = String(params?.gameId || '');

  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vp, setVp] = useState({ w: 1920, h: 1080 });

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
    }, 3900);
  };

  // viewport measure → transform:scale fit
  useEffect(() => {
    const measure = () =>
      setVp({ w: window.innerWidth || 1920, h: window.innerHeight || 1080 });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // poll the public board endpoint
  useEffect(() => {
    if (!gameId) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/sports/board/${gameId}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(res.status === 404 ? 'Game not found' : `HTTP ${res.status}`);
        const json: BoardData = await res.json();
        if (!alive) return;
        setData(json);
        setError(null);

        for (const c of json.cues || []) {
          if (seenCues.current.has(c.id)) continue;
          seenCues.current.add(c.id);
          // The very first poll's cues already happened before the
          // board opened — record them as seen but don't replay.
          if (!firstLoad.current) cueQueue.current.push(c);
        }
        firstLoad.current = false;
        pumpCues();
      } catch (e) {
        if (alive) setError((e as Error).message);
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
  const scale = Math.min(vp.w / 1920, vp.h / 1080);

  const keyframes = (
    <style>{`
      @keyframes venuePulse { 0%,100%{opacity:1} 50%{opacity:0.55} }
      @keyframes venueCueFade { 0%{opacity:0} 8%{opacity:1} 82%{opacity:1} 100%{opacity:0} }
      @keyframes venueCueGlow { 0%{opacity:0;transform:scale(0.4)} 20%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(1.2)} }
      @keyframes venueCuePop {
        0%{opacity:0;transform:scale(0.3)}
        12%{opacity:1;transform:scale(1.12)}
        20%{transform:scale(1)}
        82%{opacity:1;transform:scale(1)}
        100%{opacity:0;transform:scale(1.05)}
      }
    `}</style>
  );

  if (error && !data) {
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#64748b',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 28,
          fontWeight: 700,
        }}
      >
        {error}
      </div>
    );
  }

  if (!data || !def) {
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#334155',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: 3,
        }}
      >
        {keyframes}
        {data && !def ? `UNKNOWN SPORT: ${data.sport}` : 'LOADING SCOREBOARD…'}
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
      {keyframes}
      <div
        style={{
          position: 'absolute',
          width: 1920,
          height: 1080,
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        <BoardScene data={data} def={def} />
        {activeCue && <CueOverlay cue={activeCue} />}
      </div>
    </div>
  );
}
