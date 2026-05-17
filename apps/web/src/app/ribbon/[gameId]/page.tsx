'use client';

/**
 * VenueOS Sports — Sprint 13. The stadium ribbon / fascia board.
 *
 * A ribbon board is a long, short LED strip wrapping a stadium
 * (≈1000mm tall × 40+ feet wide). This page renders a seamless,
 * infinitely-looping horizontal scroll of game content — score,
 * team branding, segment/clock, rotating sponsor messages, and
 * crowd prompts — sized to whatever extreme aspect ratio it lands on.
 *
 * It's a PUBLIC route reading the same /sports/board/:id endpoint the
 * scoreboard uses — set the game up once (teams, colors, logos,
 * sponsors) and the ribbon just works. No extra configuration.
 *
 * Seamless loop: the reel is rendered an even number of times in a
 * flex track; the track translateX-animates 0 → -50%, so the second
 * half lands exactly where the first began. Chromium-83 safe — only
 * transform/opacity animation, long-hand insets, margin (no flex gap).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
import { findSport } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';

interface Sponsor {
  id: string;
  name: string;
  logoUrl?: string | null;
  tagline?: string | null;
  color?: string | null;
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
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
  clockMs: number;
  clockRunning: boolean;
  clockUpdatedAt: string;
  stats: Record<string, unknown>;
  sponsors?: Sponsor[];
  serverTime: number;
}

const POLL_MS = 2000;
const DEFAULT_HOME = '#4f46e5';
const DEFAULT_AWAY = '#dc2626';

// ── helpers ────────────────────────────────────────────────────

function fmtClock(ms: number): string {
  const safe = Math.max(0, ms);
  const m = Math.floor(safe / 60_000);
  const s = Math.floor((safe % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function teamCode(name: string): string {
  const first = String(name || '').trim().split(/\s+/)[0] || '—';
  return first.toUpperCase().slice(0, 12);
}

function segmentLabel(def: SportDefinition, data: BoardData): string {
  const n = data.segment;
  if (n > def.segment.count) return n - def.segment.count > 1 ? `OT${n - def.segment.count}` : 'OT';
  if (def.segment.name === 'Quarter') return `Q${n}`;
  if (def.segment.name === 'Period') return `P${n}`;
  if (def.segment.name === 'Inning') return `${ordinal(n)} INN`;
  return `${def.segment.name.toUpperCase()} ${n}`;
}
function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function liveClockMs(data: BoardData, def: SportDefinition): number {
  if (!data.clockRunning || def.clock.type === 'none') return data.clockMs;
  const skew = data.serverTime - Date.now();
  const elapsed = Date.now() + skew - new Date(data.clockUpdatedAt).getTime();
  if (def.clock.type === 'countup') return data.clockMs + elapsed;
  return Math.max(0, data.clockMs - elapsed);
}

type Cell =
  | { kind: 'score' }
  | { kind: 'status'; text: string; live: boolean }
  | { kind: 'prompt'; text: string }
  | { kind: 'sponsor'; sponsor: Sponsor };

function buildCells(data: BoardData, def: SportDefinition): Cell[] {
  const homeCode = teamCode(data.homeTeam);
  const statusText =
    def.clock.type === 'none'
      ? segmentLabel(def, data)
      : `${segmentLabel(def, data)} · ${fmtClock(liveClockMs(data, def))}`;
  const cells: Cell[] = [
    { kind: 'score' },
    { kind: 'status', text: statusText, live: data.status === 'LIVE' },
  ];
  const prompts = ['LET’S GO!', `GO ${homeCode}!`, 'MAKE SOME NOISE', 'DEFENSE!', `${homeCode} PRIDE`];
  const sponsors = data.sponsors || [];
  let pi = 0;
  let si = 0;
  while (pi < prompts.length || si < sponsors.length) {
    if (si < sponsors.length) cells.push({ kind: 'sponsor', sponsor: sponsors[si++] });
    if (pi < prompts.length) cells.push({ kind: 'prompt', text: prompts[pi++] });
  }
  // Re-insert the score mid-reel so it comes around twice per loop.
  cells.splice(Math.ceil(cells.length / 2), 0, { kind: 'score' });
  return cells;
}

// ── page ───────────────────────────────────────────────────────

export default function RibbonPage() {
  const params = useParams();
  const gameId = String(params?.gameId || '');

  const [data, setData] = useState<BoardData | null>(null);
  const [vp, setVp] = useState({ w: 1920, h: 240 });
  const [baseW, setBaseW] = useState(0);
  const measureRef = useRef<HTMLDivElement>(null);

  // viewport measure
  useEffect(() => {
    const measure = () =>
      setVp({ w: window.innerWidth || 1920, h: window.innerHeight || 240 });
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
        const res = await fetch(`${API_URL}/sports/board/${gameId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const json: BoardData = await res.json();
        if (alive) setData(json);
      } catch {
        /* keep the last good frame */
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
  const cells = useMemo(
    () => (data && def ? buildCells(data, def) : []),
    [data, def],
  );

  // measure one reel's width so the loop is seamless at any board width
  useEffect(() => {
    if (measureRef.current) {
      const w = measureRef.current.offsetWidth;
      if (w > 0) setBaseW(w);
    }
  }, [cells, vp.h]);

  const h = vp.h;
  const homeColor = data?.homeColor || DEFAULT_HOME;
  const awayColor = data?.awayColor || DEFAULT_AWAY;

  // how many reel copies make one loop-unit wider than the viewport,
  // then double it — translateX 0→-50% is then a seamless jump.
  const loopCopies = baseW > 0 ? Math.max(1, Math.ceil(vp.w / baseW)) : 1;
  const repeat = loopCopies * 2;
  const pxPerSec = Math.max(60, h * 0.55);
  const duration = baseW > 0 ? (loopCopies * baseW) / pxPerSec : 40;

  const renderReel = (copyKey: number) =>
    cells.map((cell, i) => (
      <RibbonCell
        key={`${copyKey}-${i}`}
        cell={cell}
        h={h}
        homeColor={homeColor}
        awayColor={awayColor}
        data={data!}
      />
    ));

  if (!data || !def || cells.length === 0) {
    return <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: '#05070d' }} />;
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: '#05070d',
        overflow: 'hidden',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <style>{`@keyframes ribbonScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}`}</style>

      {/* hidden measurer — one reel copy */}
      <div
        ref={measureRef}
        aria-hidden
        style={{
          position: 'absolute',
          visibility: 'hidden',
          display: 'flex',
          height: h,
          top: 0,
          left: 0,
        }}
      >
        {renderReel(-1)}
      </div>

      {/* scrolling track — `repeat` copies, animate 0 → -50% */}
      <div
        style={{
          display: 'flex',
          height: '100%',
          width: 'max-content',
          animation: `ribbonScroll ${duration}s linear infinite`,
          willChange: 'transform',
        }}
      >
        {Array.from({ length: repeat }, (_, c) => (
          <div key={c} style={{ display: 'flex', height: '100%' }}>
            {renderReel(c)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── one ribbon cell ────────────────────────────────────────────

function RibbonCell({
  cell,
  h,
  homeColor,
  awayColor,
  data,
}: {
  cell: Cell;
  h: number;
  homeColor: string;
  awayColor: string;
  data: BoardData;
}) {
  const pad = Math.round(h * 0.42);
  const wrap: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    height: '100%',
    padding: `0 ${pad}px`,
    borderRight: '1px solid rgba(255,255,255,0.09)',
    flex: 'none',
  };

  if (cell.kind === 'score') {
    return (
      <div style={wrap}>
        <TeamMark name={data.homeTeam} logo={data.homeLogoUrl} color={homeColor} h={h} />
        <span
          style={{
            fontSize: h * 0.5,
            fontWeight: 900,
            color: '#fff',
            margin: `0 ${Math.round(h * 0.16)}px`,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {data.homeScore}
        </span>
        <span style={{ fontSize: h * 0.34, fontWeight: 800, color: '#475569' }}>–</span>
        <span
          style={{
            fontSize: h * 0.5,
            fontWeight: 900,
            color: '#fff',
            margin: `0 ${Math.round(h * 0.16)}px`,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {data.awayScore}
        </span>
        <TeamMark name={data.awayTeam} logo={data.awayLogoUrl} color={awayColor} h={h} />
      </div>
    );
  }

  if (cell.kind === 'status') {
    return (
      <div style={wrap}>
        {cell.live && (
          <span
            style={{
              width: h * 0.16,
              height: h * 0.16,
              borderRadius: 999,
              background: '#ef4444',
              marginRight: h * 0.18,
              display: 'inline-block',
            }}
          />
        )}
        <span
          style={{
            fontSize: h * 0.34,
            fontWeight: 800,
            letterSpacing: 3,
            color: '#fbbf24',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {cell.text}
        </span>
      </div>
    );
  }

  if (cell.kind === 'prompt') {
    return (
      <div style={wrap}>
        <span
          style={{
            fontSize: h * 0.46,
            fontWeight: 900,
            letterSpacing: 4,
            color: '#fff',
            whiteSpace: 'nowrap',
          }}
        >
          {cell.text}
        </span>
      </div>
    );
  }

  // sponsor
  const sp = cell.sponsor;
  const color = sp.color || '#4f46e5';
  return (
    <div style={wrap}>
      {sp.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sp.logoUrl}
          alt=""
          style={{
            height: h * 0.6,
            width: h * 0.6,
            objectFit: 'contain',
            marginRight: h * 0.22,
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <span style={{ fontSize: h * 0.15, fontWeight: 800, letterSpacing: 3, color }}>
          PROUD SPONSOR
        </span>
        <span style={{ fontSize: h * 0.32, fontWeight: 900, color: '#fff', whiteSpace: 'nowrap' }}>
          {sp.name}
        </span>
        {sp.tagline ? (
          <span style={{ fontSize: h * 0.16, fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>
            {sp.tagline}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TeamMark({
  name,
  logo,
  color,
  h,
}: {
  name: string;
  logo: string | null;
  color: string;
  h: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt=""
          style={{ height: h * 0.62, width: h * 0.62, objectFit: 'contain', marginRight: h * 0.16 }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <span
          style={{
            width: h * 0.14,
            height: h * 0.52,
            background: color,
            borderRadius: 4,
            marginRight: h * 0.16,
            display: 'inline-block',
          }}
        />
      )}
      <span
        style={{
          fontSize: h * 0.32,
          fontWeight: 900,
          letterSpacing: 1,
          color: '#fff',
          whiteSpace: 'nowrap',
        }}
      >
        {teamCode(name)}
      </span>
    </div>
  );
}
