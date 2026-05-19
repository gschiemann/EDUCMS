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
import { readBoardCache, writeBoardCache } from '@/lib/sports-board-cache';
import { SituationalRow, hasSituational } from '@/components/widgets/v2/_shared/sports-situational';
import { useParams, useSearchParams } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
import { findSport } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';
// Sprint 13 — when Game.scorebugTemplateId is set, hand the entire
// scorebug overlay off to the custom-template renderer. The operator
// picks a template at a tight aspect ratio (e.g. 800×120 OBS-overlay).
import { CustomScoreboardScene } from '../../board/[gameId]/CustomScoreboardScene';

interface Cue {
  id: string;
  key?: string;
  label?: string;
  emoji?: string;
  // Which surfaces play this cue — BOARD / RIBBON / ALL (default ALL).
  target?: string;
}

/** The scorebug is a scoreboard surface — it plays BOARD- and
 *  ALL-targeted cues (and legacy untargeted ones); a RIBBON-only
 *  cue is skipped. */
function cuePlaysHere(target?: string): boolean {
  return target !== 'RIBBON';
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
  cues: Cue[];
  serverTime: number;
  // Sprint 13 — operator-picked custom layouts.
  scoreboardTemplateId?: string | null;
  ribbonTemplateId?: string | null;
  scorebugTemplateId?: string | null;
}

const DEFAULT_HOME = '#4f46e5';
const DEFAULT_AWAY = '#dc2626';
// 750ms — sub-second sync, kept in step with the board + ribbon.
const POLL_MS = 750;

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
  const cueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pumpCues = () => {
    if (playing.current) return;
    const next = cueQueue.current.shift();
    if (!next) return;
    playing.current = true;
    setActiveCue(next);
    cueTimer.current = setTimeout(() => {
      setActiveCue(null);
      playing.current = false;
      pumpCues();
    }, 3600);
  };

  // Cancel a pending cue timer on unmount.
  useEffect(() => () => {
    if (cueTimer.current) clearTimeout(cueTimer.current);
  }, []);

  useEffect(() => {
    if (!gameId) return;
    let alive = true;
    // Cold-boot: seed from the last cached frame so a power-cycle
    // mid-broadcast restores the overlay instantly.
    const cached = readBoardCache<BoardData>(gameId);
    if (cached) setData(cached);
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/sports/board/${gameId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const json: BoardData = await res.json();
        if (!alive) return;
        setData(json);
        writeBoardCache(gameId, json);
        for (const c of json.cues || []) {
          if (seenCues.current.has(c.id)) continue;
          seenCues.current.add(c.id);
          // Skip cues targeted only at the ribbon.
          if (!firstLoad.current && cuePlaysHere(c.target)) cueQueue.current.push(c);
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

  // Sprint 13 — operator picked a custom scorebug template. The
  // template canvas can be any aspect ratio; the broadcast operator
  // typically picks a small (e.g. 800×120) overlay. Same renderer
  // as /board /ribbon; the canvas size differentiates the surface.
  if (data.scorebugTemplateId) {
    return (
      <>
        {transparentCss}
        <CustomScoreboardScene
          templateId={data.scorebugTemplateId}
          gameId={gameId}
          initial={data as any}
        />
      </>
    );
  }

  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  const hasClock = def.clock.type !== 'none';
  const cueAbove = pos.v === 'bottom';
  const sit = data.stats || {};
  const showSit = hasSituational(def, sit);

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
              logoUrl={data.homeLogoUrl}
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
              logoUrl={data.awayLogoUrl}
              side="away"
            />
          </div>

          {/* situational strip — down & distance, base / ball / strike,
              timeout pips. Same shared renderer the in-venue board and
              the scoreboard widget use, in a compact pill below the bug
              so a broadcast viewer gets the full live game state. */}
          {showSit && (
            <div
              style={{
                marginTop: 6,
                background: 'linear-gradient(135deg, #1e2638, #0b0f1a)',
                border: '1.5px solid #2a3650',
                borderRadius: 10,
                overflow: 'hidden',
                boxShadow: '0 6px 26px rgba(0,0,0,0.6)',
              }}
            >
              <SituationalRow
                def={def}
                stats={sit}
                h={230}
                accent="#fbbf24"
                ink="#ffffff"
                dim="#64748b"
                hairline="transparent"
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TeamBlock({
  code,
  score,
  color,
  logoUrl,
  side,
}: {
  code: string;
  score: number;
  color: string;
  logoUrl: string | null;
  side: 'home' | 'away';
}) {
  const name = (
    <div
      style={{
        width: 158,
        background: color,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 12px',
      }}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          style={{
            width: 48,
            height: 48,
            objectFit: 'contain',
            marginBottom: 2,
            filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))',
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
      <span
        style={{
          fontSize: logoUrl ? 19 : 26,
          fontWeight: 900,
          letterSpacing: 1,
          color: '#fff',
          textShadow: '0 2px 6px rgba(0,0,0,0.45)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
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
