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
  // Custom cue-deck fields — a full-screen takeover of uploaded content.
  custom?: boolean;
  mediaUrl?: string | null;
  color?: string | null;
  durationMs?: number;
}
interface Sponsor {
  id: string;
  name: string;
  logoUrl?: string | null;
  tagline?: string | null;
  color?: string | null;
  weight?: number;
}
interface Spotlight {
  visible?: boolean;
  title?: string;
  photoUrl?: string | null;
  subtitle?: string;
  lines?: { label: string; value: string }[];
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
  spotlight?: Spotlight | null;
  cues: Cue[];
  sponsors?: Sponsor[];
  sponsorSpotSeconds?: number;
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
  logoUrl,
  winning,
}: {
  side: 'home' | 'away';
  name: string;
  score: number;
  color: string;
  logoUrl: string | null;
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
        background: `linear-gradient(${side === 'home' ? '135deg' : '225deg'}, ${color}2e, #0b0f1a 72%)`,
        borderTop: `10px solid ${color}`,
      }}
    >
      {/* brand logo — the team's actual mark, with a soft team-color halo */}
      <div
        style={{
          position: 'relative',
          width: 200,
          height: 176,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            background: `radial-gradient(circle at 50% 48%, ${color}59, transparent 64%)`,
          }}
        />
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            style={{
              position: 'relative',
              width: 176,
              height: 176,
              objectFit: 'contain',
              filter: 'drop-shadow(0 8px 20px rgba(0,0,0,0.55))',
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            style={{
              position: 'relative',
              width: 130,
              height: 130,
              borderRadius: '50%',
              background: color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 66,
              fontWeight: 900,
              color: '#fff',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            {(name.trim()[0] || '?').toUpperCase()}
          </div>
        )}
      </div>

      <div
        style={{
          fontSize: 54,
          fontWeight: 800,
          letterSpacing: 1,
          color: '#fff',
          textAlign: 'center',
          maxWidth: 640,
          lineHeight: 1.05,
          marginTop: 6,
          textShadow: '0 4px 18px rgba(0,0,0,0.6)',
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: 6,
          color,
          marginTop: 8,
        }}
      >
        {side === 'home' ? 'HOME' : 'AWAY'}
      </div>
      <div
        style={{
          fontSize: 264,
          fontWeight: 900,
          color: '#fff',
          lineHeight: 1,
          marginTop: 2,
          fontVariantNumeric: 'tabular-nums',
          textShadow: winning ? `0 0 64px ${color}` : '0 8px 30px rgba(0,0,0,0.7)',
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

  // Footer rotation — cycle through one stats slot + one slot per
  // unit of each sponsor's weight, holding each for spotSeconds. With
  // no sponsors the footer just shows stats (no rotation).
  const sponsors = data.sponsors || [];
  const spotSeconds = data.sponsorSpotSeconds || 8;
  const sponsorKey = JSON.stringify(sponsors);
  const slots = useMemo(() => {
    const s: ({ kind: 'stats' } | { kind: 'sponsor'; sponsor: Sponsor })[] = [{ kind: 'stats' }];
    for (const sp of sponsors) {
      const w = Math.max(1, Math.min(10, sp.weight || 1));
      for (let i = 0; i < w; i++) s.push({ kind: 'sponsor', sponsor: sp });
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sponsorKey]);
  const [slotIdx, setSlotIdx] = useState(0);
  useEffect(() => {
    if (slots.length <= 1) {
      setSlotIdx(0);
      return;
    }
    const t = setInterval(
      () => setSlotIdx((i) => (i + 1) % slots.length),
      Math.max(3, spotSeconds) * 1000,
    );
    return () => clearInterval(t);
  }, [slots.length, spotSeconds]);
  const activeSlot = slots[slotIdx % slots.length] || slots[0];

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
          logoUrl={data.homeLogoUrl}
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
          logoUrl={data.awayLogoUrl}
          winning={data.awayScore > data.homeScore && data.status !== 'SCHEDULED'}
        />
      </div>

      {/* broadcast spotlight — featured player / promo panel */}
      {data.spotlight && data.spotlight.visible && data.spotlight.title ? (
        <SpotlightBand spot={data.spotlight} />
      ) : null}

      {/* footer strip — rotates between sport stats and sponsor banners */}
      <div
        style={{
          height: 132,
          background: '#05070d',
          borderTop: '2px solid #1e2638',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          key={slotIdx}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 44px',
            animation: 'venueFooterFade 0.6s ease-out',
          }}
        >
          {activeSlot && activeSlot.kind === 'sponsor' ? (
            <SponsorBanner sponsor={activeSlot.sponsor} />
          ) : statChips.length === 0 ? (
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
    </div>
  );
}

// ── sponsor banner (rotates in the board footer) ───────────────

function SponsorBanner({ sponsor }: { sponsor: Sponsor }) {
  const color = sponsor.color || '#4f46e5';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        height: '100%',
        background: `linear-gradient(90deg, ${color}3a, transparent 60%)`,
      }}
    >
      {/* logo or color monogram */}
      {sponsor.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sponsor.logoUrl}
          alt=""
          style={{
            height: 92,
            width: 92,
            objectFit: 'contain',
            background: '#fff',
            borderRadius: 14,
            marginRight: 26,
          }}
        />
      ) : (
        <div
          style={{
            height: 92,
            width: 92,
            borderRadius: 14,
            background: color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 52,
            fontWeight: 900,
            color: '#fff',
            marginRight: 26,
          }}
        >
          {sponsor.name.charAt(0).toUpperCase()}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 48,
            fontWeight: 900,
            color: '#fff',
            lineHeight: 1.05,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sponsor.name}
        </div>
        {sponsor.tagline && (
          <div
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: '#94a3b8',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sponsor.tagline}
          </div>
        )}
      </div>

      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          letterSpacing: 4,
          color,
          marginLeft: 20,
          whiteSpace: 'nowrap',
        }}
      >
        PROUD SPONSOR
      </div>
    </div>
  );
}

// ── spotlight band (featured player / promo) ───────────────────

function SpotlightBand({ spot }: { spot: Spotlight }) {
  const lines = (spot.lines || []).filter((l) => l && (l.label || l.value)).slice(0, 4);
  return (
    <div
      style={{
        height: 184,
        background: '#0b1020',
        borderTop: '3px solid #4f46e5',
        display: 'flex',
        alignItems: 'center',
        padding: '0 48px',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {spot.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={spot.photoUrl}
          alt=""
          style={{
            width: 148,
            height: 148,
            objectFit: 'cover',
            borderRadius: 16,
            border: '3px solid #1e2638',
            background: '#05070d',
            marginRight: 32,
            flex: 'none',
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 4, color: '#818cf8' }}>
          SPOTLIGHT
        </div>
        <div
          style={{
            fontSize: 52,
            fontWeight: 900,
            color: '#fff',
            lineHeight: 1.05,
            marginTop: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {spot.title}
        </div>
        {spot.subtitle ? (
          <div style={{ fontSize: 23, fontWeight: 600, color: '#94a3b8', marginTop: 2 }}>
            {spot.subtitle}
          </div>
        ) : null}
      </div>
      {lines.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', flex: 'none' }}>
          {lines.map((l, i) => (
            <div
              key={i}
              style={{
                textAlign: 'center',
                padding: '0 26px',
                borderLeft: i > 0 ? '2px solid #1e2638' : undefined,
              }}
            >
              <div
                style={{
                  fontSize: 54,
                  fontWeight: 900,
                  color: '#fff',
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {l.value || '—'}
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: 2,
                  color: '#64748b',
                  marginTop: 6,
                }}
              >
                {(l.label || '').toUpperCase()}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── celebration overlay ────────────────────────────────────────

function CueOverlay({ cue }: { cue: Cue }) {
  // Custom cue — a full-screen takeover of the operator's uploaded
  // content (a sponsor graphic, a promo, a hype card).
  if (cue.mediaUrl) {
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
          background: cue.color || '#05070d',
          zIndex: 50,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cue.mediaUrl}
          alt=""
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      </div>
    );
  }
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
        background: 'rgba(5,7,13,0.8)',
        animation: 'venueCueFade 3.8s ease-in-out forwards',
        zIndex: 50,
      }}
    >
      {/* expanding shockwave rings */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 440,
            height: 440,
            borderRadius: 999,
            border: '7px solid rgba(251,191,36,0.8)',
            animation: `venueCueRing 3.8s ${(0.04 + i * 0.22).toFixed(2)}s cubic-bezier(.15,.7,.3,1) forwards`,
          }}
        />
      ))}
      {/* warm glow */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 1040,
          height: 1040,
          borderRadius: 999,
          background: 'radial-gradient(circle, rgba(251,191,36,0.55), transparent 64%)',
          animation: 'venueCueGlow 3.8s ease-in-out forwards',
        }}
      />
      <div
        style={{
          position: 'relative',
          fontSize: 430,
          lineHeight: 1,
          animation: 'venueCuePop 3.8s cubic-bezier(.2,.9,.2,1) forwards',
        }}
      >
        {cue.emoji || '🎉'}
      </div>
      <div
        style={{
          position: 'relative',
          fontSize: 134,
          fontWeight: 900,
          letterSpacing: 5,
          color: '#fff',
          marginTop: 6,
          textShadow: '0 8px 44px rgba(0,0,0,0.85)',
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
  const cueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pumpCues = () => {
    if (playing.current) return;
    const next = cueQueue.current.shift();
    if (!next) return;
    playing.current = true;
    setActiveCue(next);
    // A custom cue holds for its own duration; a sport celebration
    // matches the 3.8s celebration animation.
    const holdMs =
      next.mediaUrl && next.durationMs && next.durationMs > 0 ? next.durationMs : 3900;
    cueTimer.current = setTimeout(() => {
      setActiveCue(null);
      playing.current = false;
      pumpCues();
    }, holdMs);
  };

  // Cancel a pending cue timer on unmount (kiosk route reloads).
  useEffect(() => () => {
    if (cueTimer.current) clearTimeout(cueTimer.current);
  }, []);

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
      @keyframes venueFooterFade { 0%{opacity:0} 100%{opacity:1} }
      @keyframes venueCueFade { 0%{opacity:0} 8%{opacity:1} 82%{opacity:1} 100%{opacity:0} }
      @keyframes venueCueGlow {
        0%{opacity:0;transform:translate(-50%,-50%) scale(0.4)}
        20%{opacity:1;transform:translate(-50%,-50%) scale(1)}
        100%{opacity:0;transform:translate(-50%,-50%) scale(1.2)}
      }
      @keyframes venueCueRing {
        0%{opacity:0;transform:translate(-50%,-50%) scale(0.25)}
        10%{opacity:0.95}
        100%{opacity:0;transform:translate(-50%,-50%) scale(3.4)}
      }
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
