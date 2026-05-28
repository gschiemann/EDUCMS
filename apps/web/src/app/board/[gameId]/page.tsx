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

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { readBoardCache, writeBoardCache } from '@/lib/sports-board-cache';
import { applyCtsOverlay } from '@/lib/cts-merge';
import { SituationalRow } from '@/components/widgets/v2/_shared/sports-situational';
import { celebrationSrc } from '@/lib/celebration-assets';
import { useParams } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
import { findSport } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';
// Sprint 13 — custom-template scoreboard renderer. Used iff
// Game.scoreboardTemplateId is non-null; otherwise the legacy
// BoardScene + status-aware scenes below render unchanged.
import { CustomScoreboardScene } from './CustomScoreboardScene';
// T2-4 — Pre-game starting-lineup choreography widget.
import {
  CelPregameIntroWidget,
  type PregamePlayer,
} from '@/components/widgets/v2/CelebrationsOtherSportsWidgets';

interface Cue {
  id: string;
  key?: string;
  label?: string;
  emoji?: string;
  createdAt?: string;
  // Custom cue-deck fields — uploaded content shown on a trigger.
  custom?: boolean;
  mediaUrl?: string | null;
  // 'overlay' (default) → board stays visible, media drops into a lower
  // band; 'takeover' → full-screen opaque media.
  displayMode?: string | null;
  color?: string | null;
  durationMs?: number;
  // Scoring team for a sport celebration ('home' | 'away') — used to brand
  // the celebration animation to that team's color.
  team?: string | null;
  // Which surfaces play this cue — BOARD / RIBBON / ALL (default ALL).
  target?: string;
  // Audio to play alongside a sport-celebration cue. Best-effort —
  // failure never interrupts the visual celebration.
  audioUrl?: string | null;
  // Co-branded celebration attribution — shown below the cue label.
  sponsorName?: string | null;
  sponsorLogoUrl?: string | null;
  // T2-4 — Pre-game lineup choreography fields (only present when
  // key === 'pregame-intro').
  lineup?: PregamePlayer[];
  teamColor?: string | null;
  teamName?: string | null;
  slotMs?: number;
  skippable?: boolean;
  // Frozen live-game snapshot, captured server-side at cue-fire time —
  // so a celebration shows the EXACT score + clock of the moment.
  snapshot?: {
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    homeColor?: string | null;
    awayColor?: string | null;
    segmentLabel?: string;
    clockText?: string;
  };
}
interface Sponsor {
  id: string;
  name: string;
  logoUrl?: string | null;
  tagline?: string | null;
  color?: string | null;
  weight?: number;
  // T2-9: frequency cap enforcement + flight-window re-check at render time.
  frequencyCapPerHour?: number | null;
  flightEndAt?: string | null;
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
  // Sprint 13 — operator-picked custom-template IDs. NULL → fall back
  // to the hardcoded BoardScene below; non-NULL → render
  // CustomScoreboardScene (template-driven) instead.
  scoreboardTemplateId?: string | null;
  ribbonTemplateId?: string | null;
  scorebugTemplateId?: string | null;
}

const DEFAULT_HOME = '#4f46e5';
const DEFAULT_AWAY = '#dc2626';

/** This is the scoreboard surface — it plays BOARD- and ALL-targeted
 *  cues (and legacy untargeted ones); a RIBBON-only cue is skipped. */
function cuePlaysHere(target?: string): boolean {
  return target !== 'RIBBON';
}
// 750ms — sub-second sync. A score / clock / cue change reaches every
// surface (board, ribbon, scorebug) within ~0.75s and they stay near
// lockstep, instead of the up-to-2s lag + drift of slow polling.
const POLL_MS = 750;

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

/** Penalty-clock format — always MM:SS, ceil to the second so the
 *  box still reads "0:01" right up to the instant it expires. */
function fmtPenalty(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** First word of a team name, upper-cased, capped — a clean short
 *  code for the celebration score line. */
function teamCode(name: string): string {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return first.toUpperCase().slice(0, 14);
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

/** A team's live penalty timers — the box for hockey / lacrosse /
 *  field hockey / water polo. Each penalty is an anchor projected
 *  locally (the same math as the game clock); an expired one drops
 *  off on its own. Renders nothing when the box is empty, so the
 *  14 sports with no penalty box show no panel. */
function PenaltyTimers({
  team,
  stats,
  serverTime,
  color,
}: {
  team: 'home' | 'away';
  stats: Record<string, unknown> | undefined;
  serverTime: number;
  color: string;
}) {
  const raw = stats && Array.isArray(stats.penalties) ? (stats.penalties as unknown[]) : [];
  const mine = raw
    .filter(
      (p): p is Record<string, unknown> =>
        !!p && typeof p === 'object' && (p as Record<string, unknown>).team === team,
    )
    .map((p) => ({
      id: String(p.id || ''),
      player: String(p.player || ''),
      ms: Math.max(0, Number(p.ms) || 0),
      at: String(p.at || ''),
      running: !!p.running,
    }))
    .filter((p) => p.id);
  // A stable key so the projection effect only re-subscribes when the
  // penalty anchors actually change, not on every poll.
  const key = JSON.stringify(mine.map((p) => [p.id, p.ms, p.at, p.running]));

  const [live, setLive] = useState<{ id: string; player: string; ms: number }[]>([]);
  useEffect(() => {
    const skew = serverTime - Date.now(); // local + skew ≈ server
    const project = () => {
      setLive(
        mine
          .map((p) => {
            let ms = p.ms;
            if (p.running) {
              const at = new Date(p.at).getTime();
              if (Number.isFinite(at)) ms = Math.max(0, p.ms - (Date.now() + skew - at));
            }
            return { id: p.id, player: p.player, ms };
          })
          .filter((p) => p.ms > 0),
      );
    };
    project();
    if (!mine.some((p) => p.running)) return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, serverTime]);

  if (live.length === 0) return null;
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 16 }}
    >
      <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 4, color: '#64748b' }}>
        PENALTIES
      </span>
      <div
        style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}
      >
        {live.slice(0, 4).map((p, i) => (
          <div
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              background: '#0f172a',
              border: `3px solid ${color}`,
              borderRadius: 12,
              padding: '8px 18px',
              marginLeft: i ? 14 : 0,
              marginBottom: 8,
            }}
          >
            {p.player ? (
              <span style={{ fontSize: 32, fontWeight: 900, color, marginRight: 12 }}>
                #{p.player}
              </span>
            ) : null}
            <span
              style={{
                fontSize: 38,
                fontWeight: 900,
                color: p.ms <= 10_000 ? '#f87171' : '#ffffff',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {fmtPenalty(p.ms)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamPanel({
  side,
  name,
  score,
  color,
  logoUrl,
  winning,
  hasPossession,
  penaltyNode,
}: {
  side: 'home' | 'away';
  name: string;
  score: number;
  color: string;
  logoUrl: string | null;
  winning: boolean;
  hasPossession?: boolean;
  penaltyNode?: ReactNode;
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          maxWidth: 660,
          marginTop: 6,
        }}
      >
        {/* possession marker — the football icon sits by whoever has
            the ball, the way every broadcast scoreboard shows it */}
        {hasPossession && (
          <span aria-hidden style={{ fontSize: 40, lineHeight: 1, marginRight: 14 }}>
            🏈
          </span>
        )}
        <div
          style={{
            fontSize: 54,
            fontWeight: 800,
            letterSpacing: 1,
            color: '#fff',
            textAlign: 'center',
            lineHeight: 1.05,
            textShadow: '0 4px 18px rgba(0,0,0,0.6)',
          }}
        >
          {name}
        </div>
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
      {penaltyNode}
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

  // Basketball shot clock — a second countdown, projected from its own
  // anchor in stats.shotClock the same way as the game clock.
  const [shotMs, setShotMs] = useState(0);
  const scRaw = (data.stats as Record<string, unknown> | undefined)?.shotClock;
  const sc = scRaw && typeof scRaw === 'object' ? (scRaw as Record<string, unknown>) : null;
  const shotLen = Number(sc?.len) || 0;
  const shotAnchorMs = Math.max(0, Number(sc?.ms) || 0);
  const shotAnchorAt = String(sc?.at || '');
  const shotRunning = !!sc?.running;
  useEffect(() => {
    if (shotLen <= 0) {
      setShotMs(0);
      return;
    }
    const skew = data.serverTime - Date.now();
    const at = new Date(shotAnchorAt).getTime();
    const project = () => {
      if (!shotRunning || !Number.isFinite(at)) {
        setShotMs(shotAnchorMs);
        return;
      }
      setShotMs(Math.max(0, shotAnchorMs - (Date.now() + skew - at)));
    };
    project();
    if (!shotRunning) return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
  }, [shotAnchorMs, shotAnchorAt, shotRunning, shotLen, data.serverTime]);

  // Football play clock — the 40/25 countdown between snaps,
  // projected from its own anchor in stats.playClock.
  const [playMs, setPlayMs] = useState(0);
  const pcRaw = (data.stats as Record<string, unknown> | undefined)?.playClock;
  const pc = pcRaw && typeof pcRaw === 'object' ? (pcRaw as Record<string, unknown>) : null;
  const playArmed = !!(pc && String(pc.at || ''));
  const playAnchorMs = Math.max(0, Number(pc?.ms) || 0);
  const playAnchorAt = String(pc?.at || '');
  const playRunning = !!pc?.running;
  useEffect(() => {
    if (!playArmed) {
      setPlayMs(0);
      return;
    }
    const skew = data.serverTime - Date.now();
    const at = new Date(playAnchorAt).getTime();
    const project = () => {
      if (!playRunning || !Number.isFinite(at)) {
        setPlayMs(playAnchorMs);
        return;
      }
      setPlayMs(Math.max(0, playAnchorMs - (Date.now() + skew - at)));
    };
    project();
    if (!playRunning) return;
    const t = setInterval(project, 100);
    return () => clearInterval(t);
  }, [playArmed, playAnchorMs, playAnchorAt, playRunning, data.serverTime]);

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

  // T2-9: track when each sponsor was shown (sliding 60-min window) for
  // frequency-cap enforcement. Per-render instance; reset on game change.
  const shownTimestamps = useRef<Map<string, number[]>>(new Map());

  // Build the slot list, filtering out sponsors that are cap-exceeded or
  // whose flight has ended since the last server-side listActive query.
  const buildSlots = () => {
    const now = Date.now();
    const oneHourAgo = now - 3_600_000;
    const s: ({ kind: 'stats' } | { kind: 'sponsor'; sponsor: Sponsor })[] = [{ kind: 'stats' }];
    for (const sp of sponsors) {
      // Flight-end re-check: if flightEndAt is set and has passed, skip.
      if (sp.flightEndAt && new Date(sp.flightEndAt).getTime() <= now) continue;
      // Frequency-cap re-check: if cap is set, count recent shows in window.
      if (sp.frequencyCapPerHour !== null && sp.frequencyCapPerHour !== undefined) {
        const recent = (shownTimestamps.current.get(sp.id) || []).filter((t) => t > oneHourAgo);
        shownTimestamps.current.set(sp.id, recent);
        if (recent.length >= sp.frequencyCapPerHour) continue;
      }
      const w = Math.max(1, Math.min(10, sp.weight || 1));
      for (let i = 0; i < w; i++) s.push({ kind: 'sponsor', sponsor: sp });
    }
    return s;
  };

  const slots = useMemo(buildSlots, // eslint-disable-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [sponsorKey]);
  const [slotIdx, setSlotIdx] = useState(0);
  useEffect(() => {
    if (slots.length <= 1) {
      setSlotIdx(0);
      return;
    }
    const intervalMs = Math.max(3, spotSeconds) * 1000;
    const t = setInterval(() => {
      setSlotIdx((i) => (i + 1) % slots.length);
    }, intervalMs);
    return () => clearInterval(t);
  }, [slots.length, spotSeconds]);
  const activeSlot = slots[slotIdx % slots.length] || slots[0];
  // T2-8: Football possession — lights the 🏈 marker on the team panel.
  // Read from Game.possession (first-class column) first; fall back to
  // stats.possession for backward compat with rows created before the
  // add_game_possession migration.


  // T2-9: When the active slot changes to a sponsor look, record the
  // impression timestamp locally (for cap enforcement) and ping the API.
  const lastPingedSponsorRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeSlot?.kind !== 'sponsor') {
      lastPingedSponsorRef.current = null;
      return;
    }
    const sp = activeSlot.sponsor;
    // Throttle to once per look (don't double-fire on re-render).
    if (lastPingedSponsorRef.current === sp.id) return;
    lastPingedSponsorRef.current = sp.id;
    // Record locally for cap enforcement.
    const prev = shownTimestamps.current.get(sp.id) || [];
    prev.push(Date.now());
    shownTimestamps.current.set(sp.id, prev);
    // Fire-and-forget POST to the impression endpoint.
    const gameId = data.id;
    if (gameId) {
      fetch(`${API_URL}/sports/sponsors/${sp.id}/impression`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, surfaceKind: 'board' }),
      }).catch(() => {}); // best-effort, never fail the board
    }
  }, [activeSlot, data.id]);
  // Football possession — lights the 🏈 marker on the team panel.
  const ballSide =
    def.key === 'football'
      ? (
          typeof (data as any).possession === 'string' && (data as any).possession
            ? (data as any).possession
            : String((data.stats as Record<string, unknown> | undefined)?.possession || '')
        )
          .trim()
          .toLowerCase()
      : '';

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
          hasPossession={ballSide === 'home'}
          penaltyNode={
            <PenaltyTimers
              team="home"
              stats={data.stats}
              serverTime={data.serverTime}
              color={homeColor}
            />
          }
        />

        {/* center column — clock + segment */}
        <div
          style={{
            // 600 (was 520): a 5-char "MM:SS" clock at this size needs
            // the room — a 520 column clipped the leading/trailing digit.
            // Team panels stay ≥ 660px wide, comfortably over the 640
            // team-name max-width.
            width: 600,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#05070d',
            overflow: 'visible',
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
                // 188 (was 200): sized so a 5-char "MM:SS" clock sits
                // inside the 600px column with margin on both sides.
                fontSize: 188,
                fontWeight: 900,
                lineHeight: 1,
                marginTop: 18,
                fontVariantNumeric: 'tabular-nums',
                color: data.clockRunning ? '#fbbf24' : '#e2e8f0',
                textShadow: data.clockRunning ? '0 0 50px rgba(251,191,36,0.5)' : 'none',
                whiteSpace: 'nowrap',
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
          {def.key === 'basketball' && shotLen > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                marginTop: 14,
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 4, color: '#64748b' }}>
                SHOT
              </span>
              <span
                style={{
                  fontSize: 88,
                  fontWeight: 900,
                  lineHeight: 1,
                  marginTop: 2,
                  fontVariantNumeric: 'tabular-nums',
                  color: shotMs <= 5000 ? '#ef4444' : '#e2e8f0',
                }}
              >
                {shotMs <= 5000 ? (shotMs / 1000).toFixed(1) : Math.ceil(shotMs / 1000)}
              </span>
            </div>
          )}
          {def.key === 'football' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                marginTop: 14,
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 4, color: '#64748b' }}>
                PLAY
              </span>
              <span
                style={{
                  fontSize: 88,
                  fontWeight: 900,
                  lineHeight: 1,
                  marginTop: 2,
                  fontVariantNumeric: 'tabular-nums',
                  color: playArmed && playMs <= 5000 ? '#ef4444' : '#e2e8f0',
                }}
              >
                {!playArmed
                  ? 40
                  : playMs <= 5000
                    ? (playMs / 1000).toFixed(1)
                    : Math.ceil(playMs / 1000)}
              </span>
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
          hasPossession={ballSide === 'away'}
          penaltyNode={
            <PenaltyTimers
              team="away"
              stats={data.stats}
              serverTime={data.serverTime}
              color={awayColor}
            />
          }
        />
      </div>

      {/* broadcast spotlight — featured player / promo panel.
          When the spotlight is active the footer is hidden so the
          spotlight can use the freed vertical space. */}
      {data.spotlight && data.spotlight.visible && data.spotlight.title ? (
        <SpotlightBand spot={data.spotlight} expanded />
      ) : null}

      {/* footer strip — rotates between sport stats and sponsor banners.
          Hidden while a player spotlight is showing so it can expand. */}
      <div
        style={{
          height: data.spotlight && data.spotlight.visible ? 0 : 132,
          overflow: 'hidden',
          background: '#05070d',
          borderTop: data.spotlight && data.spotlight.visible ? 'none' : '2px solid #1e2638',
          position: 'relative',
          transition: 'height 0.35s ease-in-out',
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
            /* Broadcast situational graphics — the same shared renderer
               the scoreboard widget uses: base diamond + B/S/O for
               baseball, down & distance + possession for football,
               bonus + timeout pips for basketball, etc. One source of
               truth so the venue board and the template widget match. */
            <SituationalRow
              def={def}
              stats={data.stats || {}}
              h={620}
              accent="#fbbf24"
              ink="#ffffff"
              dim="#64748b"
              hairline="transparent"
            />
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
            // Transparent — the logo sits straight on the banner so it
            // reads as part of the board, not a white sticker. Natural
            // aspect (width auto) so a wide logo isn't crushed into a
            // square, and taller so the sponsor is actually legible.
            height: 104,
            width: 'auto',
            maxWidth: 460,
            objectFit: 'contain',
            marginRight: 30,
          }}
        />
      ) : (
        <div
          style={{
            height: 104,
            width: 104,
            borderRadius: 14,
            background: color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 58,
            fontWeight: 900,
            color: '#fff',
            marginRight: 30,
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

function SpotlightBand({ spot, expanded }: { spot: Spotlight; expanded?: boolean }) {
  const lines = (spot.lines || []).filter((l) => l && (l.label || l.value)).slice(0, 4);
  // When the footer is hidden (expanded=true) we gain ~132px extra height.
  // Use a taller band + bigger photo + bigger name so the spotlight fills it.
  const bandH = expanded ? 316 : 184;
  const photoSz = expanded ? 256 : 148;
  const eyebrowSz = expanded ? 22 : 17;
  const titleSz = expanded ? 76 : 52;
  const subtitleSz = expanded ? 30 : 23;
  const statValueSz = expanded ? 80 : 54;
  const statLabelSz = expanded ? 19 : 15;
  const statPad = expanded ? 36 : 26;
  return (
    <div
      style={{
        height: bandH,
        background: '#0b1020',
        borderTop: '3px solid #4f46e5',
        display: 'flex',
        alignItems: 'center',
        padding: '0 48px',
        fontFamily: 'Inter, system-ui, sans-serif',
        transition: 'height 0.35s ease-in-out',
      }}
    >
      {spot.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={spot.photoUrl}
          alt=""
          style={{
            width: photoSz,
            height: photoSz,
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
        <div style={{ fontSize: eyebrowSz, fontWeight: 800, letterSpacing: 4, color: '#818cf8' }}>
          SPOTLIGHT
        </div>
        <div
          style={{
            fontSize: titleSz,
            fontWeight: 900,
            color: '#fff',
            // 1.3 (was 1.05): the line box must contain Inter's full
            // glyph extent (~1.21em) or `overflow:hidden` clips the
            // descenders — a name like "Greg" lost the tail of its g.
            lineHeight: 1.3,
            marginTop: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {spot.title}
        </div>
        {spot.subtitle ? (
          <div style={{ fontSize: subtitleSz, fontWeight: 600, color: '#94a3b8', marginTop: 2 }}>
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
                padding: `0 ${statPad}px`,
                borderLeft: i > 0 ? '2px solid #1e2638' : undefined,
              }}
            >
              <div
                style={{
                  fontSize: statValueSz,
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
                  fontSize: statLabelSz,
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

// ── non-LIVE status presentation scenes ────────────────────────
// These render for PRE_GAME/SCHEDULED, HALFTIME, and FINAL.
// The LIVE path (BoardScene) is untouched — zero regression risk.

/** A large team logo block with name and optional score — shared by all
 *  three non-live scenes. */
function BigTeamBlock({
  name,
  score,
  logoUrl,
  color,
  showScore,
  accent,
}: {
  name: string;
  score?: number;
  logoUrl: string | null;
  color: string;
  showScore?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
      }}
    >
      {/* logo or monogram */}
      <div
        style={{
          position: 'relative',
          width: 280,
          height: 280,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 24,
        }}
      >
        {/* team-color halo */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            background: `radial-gradient(circle at 50% 50%, ${color}55, transparent 68%)`,
            borderRadius: 999,
          }}
        />
        {accent && (
          <div
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              bottom: -6,
              left: -6,
              borderRadius: 999,
              border: `5px solid ${color}`,
              boxShadow: `0 0 48px ${color}88`,
            }}
          />
        )}
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            style={{
              position: 'relative',
              width: 240,
              height: 240,
              objectFit: 'contain',
              filter: 'drop-shadow(0 12px 32px rgba(0,0,0,0.6))',
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            style={{
              position: 'relative',
              width: 180,
              height: 180,
              borderRadius: '50%',
              background: color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 88,
              fontWeight: 900,
              color: '#fff',
              boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
            }}
          >
            {(name.trim()[0] || '?').toUpperCase()}
          </div>
        )}
      </div>
      {/* name */}
      <div
        style={{
          fontSize: 52,
          fontWeight: 900,
          color: '#fff',
          textAlign: 'center',
          maxWidth: 580,
          lineHeight: 1.05,
          letterSpacing: 1,
          textShadow: '0 4px 16px rgba(0,0,0,0.55)',
        }}
      >
        {name}
      </div>
      {/* score — only when showScore */}
      {showScore && score !== undefined && (
        <div
          style={{
            fontSize: 220,
            fontWeight: 900,
            lineHeight: 1,
            marginTop: 8,
            fontVariantNumeric: 'tabular-nums',
            color: '#fff',
            textShadow: accent ? `0 0 72px ${color}` : '0 8px 30px rgba(0,0,0,0.7)',
          }}
        >
          {score}
        </div>
      )}
    </div>
  );
}

/** PRE_GAME / SCHEDULED — matchup graphic.
 *  No scores yet; focus is on team identity + anticipation framing. */
function PreGameScene({ data, def }: { data: BoardData; def: SportDefinition }) {
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  const pill = STATUS_STYLE[data.status] || STATUS_STYLE.PRE_GAME;
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
      {/* header */}
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
            background: pill.bg,
            padding: '12px 28px',
            borderRadius: 999,
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: 3,
          }}
        >
          {pill.label}
        </div>
      </div>

      {/* matchup body */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* left team gradient wash */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: '48%',
            background: `linear-gradient(135deg, ${homeColor}22, transparent 72%)`,
            borderTop: `6px solid ${homeColor}`,
          }}
        />
        {/* right team gradient wash */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '48%',
            background: `linear-gradient(225deg, ${awayColor}22, transparent 72%)`,
            borderTop: `6px solid ${awayColor}`,
          }}
        />

        {/* home team */}
        <BigTeamBlock
          name={data.homeTeam}
          logoUrl={data.homeLogoUrl}
          color={homeColor}
          showScore={false}
        />

        {/* VS divider */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: 200,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 100,
              fontWeight: 900,
              color: '#1e2638',
              lineHeight: 1,
              letterSpacing: 4,
            }}
          >
            VS
          </div>
          <div
            style={{
              marginTop: 16,
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: 5,
              color: '#334155',
            }}
          >
            TONIGHT
          </div>
        </div>

        {/* away team */}
        <BigTeamBlock
          name={data.awayTeam}
          logoUrl={data.awayLogoUrl}
          color={awayColor}
          showScore={false}
        />
      </div>

      {/* footer */}
      <div
        style={{
          height: 80,
          background: '#05070d',
          borderTop: '2px solid #1e2638',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: 5,
          color: '#334155',
        }}
      >
        VENUEOS
      </div>
    </div>
  );
}

/** HALFTIME — the score with a prominent HALFTIME treatment. */
function HalftimeScene({ data, def }: { data: BoardData; def: SportDefinition }) {
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
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
      {/* header */}
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
            background: STATUS_STYLE.HALFTIME.bg,
            padding: '12px 28px',
            borderRadius: 999,
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: 3,
          }}
        >
          HALFTIME
        </div>
      </div>

      {/* body — scores */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* left gradient */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: '45%',
            background: `linear-gradient(135deg, ${homeColor}1a, transparent 68%)`,
            borderTop: `4px solid ${homeColor}`,
          }}
        />
        {/* right gradient */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '45%',
            background: `linear-gradient(225deg, ${awayColor}1a, transparent 68%)`,
            borderTop: `4px solid ${awayColor}`,
          }}
        />

        <BigTeamBlock
          name={data.homeTeam}
          score={data.homeScore}
          logoUrl={data.homeLogoUrl}
          color={homeColor}
          showScore
        />

        {/* center divider */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: 180,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: 26,
              fontWeight: 900,
              letterSpacing: 5,
              color: '#2563eb',
              marginBottom: 12,
            }}
          >
            HALFTIME
          </div>
          <div style={{ fontSize: 80, fontWeight: 900, color: '#1e2638', lineHeight: 1 }}>–</div>
        </div>

        <BigTeamBlock
          name={data.awayTeam}
          score={data.awayScore}
          logoUrl={data.awayLogoUrl}
          color={awayColor}
          showScore
        />
      </div>

      {/* footer */}
      <div
        style={{
          height: 80,
          background: '#05070d',
          borderTop: '2px solid #1e2638',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: 5,
          color: '#334155',
        }}
      >
        VENUEOS
      </div>
    </div>
  );
}

/** FINAL — score with winner emphasis; tie = no winner accent. */
function FinalScene({ data, def }: { data: BoardData; def: SportDefinition }) {
  const homeColor = data.homeColor || DEFAULT_HOME;
  const awayColor = data.awayColor || DEFAULT_AWAY;
  const tie = data.homeScore === data.awayScore;
  const homeWins = !tie && data.homeScore > data.awayScore;
  const awayWins = !tie && data.awayScore > data.homeScore;
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
      {/* header */}
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
            background: STATUS_STYLE.FINAL.bg,
            padding: '12px 28px',
            borderRadius: 999,
            fontSize: 30,
            fontWeight: 900,
            letterSpacing: 3,
          }}
        >
          FINAL
        </div>
      </div>

      {/* body — final scores */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* left gradient — brighter when home wins */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: '45%',
            background: homeWins
              ? `linear-gradient(135deg, ${homeColor}2e, transparent 68%)`
              : `linear-gradient(135deg, ${homeColor}10, transparent 68%)`,
            borderTop: `${homeWins ? 7 : 3}px solid ${homeColor}`,
          }}
        />
        {/* right gradient — brighter when away wins */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '45%',
            background: awayWins
              ? `linear-gradient(225deg, ${awayColor}2e, transparent 68%)`
              : `linear-gradient(225deg, ${awayColor}10, transparent 68%)`,
            borderTop: `${awayWins ? 7 : 3}px solid ${awayColor}`,
          }}
        />

        <BigTeamBlock
          name={data.homeTeam}
          score={data.homeScore}
          logoUrl={data.homeLogoUrl}
          color={homeColor}
          showScore
          accent={homeWins}
        />

        {/* center divider */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: 180,
            flexShrink: 0,
          }}
        >
          {tie ? (
            <div
              style={{
                fontSize: 26,
                fontWeight: 900,
                letterSpacing: 4,
                color: '#64748b',
                marginBottom: 12,
              }}
            >
              TIE
            </div>
          ) : (
            <div
              style={{
                fontSize: 22,
                fontWeight: 900,
                letterSpacing: 4,
                color: '#64748b',
                marginBottom: 12,
              }}
            >
              FINAL
            </div>
          )}
          <div style={{ fontSize: 80, fontWeight: 900, color: '#1e2638', lineHeight: 1 }}>–</div>
        </div>

        <BigTeamBlock
          name={data.awayTeam}
          score={data.awayScore}
          logoUrl={data.awayLogoUrl}
          color={awayColor}
          showScore
          accent={awayWins}
        />
      </div>

      {/* footer */}
      <div
        style={{
          height: 80,
          background: '#05070d',
          borderTop: '2px solid #1e2638',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: 5,
          color: '#334155',
        }}
      >
        VENUEOS
      </div>
    </div>
  );
}

// ── celebration overlay ────────────────────────────────────────

/** A hex color (#rgb / #rrggbb) as an rgba() string at the given
 *  alpha. Falls back to broadcast gold if the input isn't clean hex,
 *  so a malformed team color can never break a celebration render. */
function hexA(color: string | null | undefined, alpha: number): string {
  let hex = String(color || '').trim();
  if (hex[0] === '#') hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== 6 || /[^0-9a-f]/i.test(hex)) return `rgba(251,191,36,${alpha})`;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Marquee scoring plays — touchdowns, home runs, the game-winner —
// earn a bigger celebration: a wider glow, an extra shockwave ring,
// more confetti. Everything else still gets the full broadcast look.
const BIG_CUE_RE =
  /touchdown|home.?run|grand.?slam|hat.?trick|\bpin\b|buzzer|walk.?off|game.?winner|champ/i;

/**
 * A broadcast-grade scoring celebration. A layered, phased animation:
 * ENTER (~0.6s — shockwave rings, energy glow, a diagonal light sweep,
 * an emoji pop + text-slam), HOLD (~2.8s — falling confetti + the
 * live-score lower-third), EXIT (~0.5s fade). Every layer animates
 * transform/opacity only — Chromium-83 (NovaStar Taurus) + WebKit safe.
 */
function CueOverlay({
  cue,
  sport,
  pack,
}: {
  cue: Cue;
  sport?: string | null;
  pack?: 'v1' | 'v2';
}) {
  // T2-4 — Pre-game starting-lineup choreography. Full-screen takeover
  // rendered by CelPregameIntroWidget; the board stays dark behind it.
  // The board's existing holdMs logic uses cue.durationMs (total runtime
  // = slotMs × playerCount, capped at 60s server-side).
  if (cue.key === 'pregame-intro') {
    const teamColor =
      cue.teamColor ||
      (cue.team === 'away' ? cue.snapshot?.awayColor : cue.snapshot?.homeColor) ||
      '#fbbf24';
    return (
      <div
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
          zIndex: 50, background: '#05070d',
          animation: 'venueCelebScrim 0.35s ease-out',
        }}
      >
        <CelPregameIntroWidget
          live
          config={{
            teamName: cue.teamName ?? (cue.team === 'away' ? cue.snapshot?.awayTeam : cue.snapshot?.homeTeam) ?? 'HOME',
            teamColor,
            lineup: cue.lineup ?? [],
            slotMs: cue.slotMs ?? 3500,
            skippable: cue.skippable !== false,
          }}
        />
      </div>
    );
  }

  // Custom cue — the operator's uploaded content (a sponsor graphic, a
  // promo, a hype card).
  if (cue.mediaUrl) {
    // TAKEOVER — full-screen opaque media (opt-in).
    if (cue.displayMode === 'takeover') {
      return (
        <div
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: cue.color || '#05070d', zIndex: 50,
            animation: 'venueCelebScrim 0.4s ease-out',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cue.mediaUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </div>
      );
    }
    // OVERLAY (default) — the board stays fully visible; the media drops
    // into a lower band (bottom ~34%) over a gradient scrim that fades
    // up, then slides away after the cue's duration. Operator: "the
    // custom cues should overlay, not take over the entire screen."
    return (
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: '34%',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            background: cue.color
              ? `linear-gradient(to top, ${cue.color} 12%, ${cue.color}cc 55%, transparent 100%)`
              : 'linear-gradient(to top, rgba(5,7,13,0.96) 12%, rgba(5,7,13,0.78) 55%, transparent 100%)',
            animation: 'venueCueBandUp 0.45s cubic-bezier(0.22,1,0.36,1)',
            padding: '0 3% 2.5%',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cue.mediaUrl} alt="" style={{ maxWidth: '94%', maxHeight: '88%', objectFit: 'contain' }} />
        </div>
      </div>
    );
  }

  // Cinematic sport celebration — a hand-tuned full-screen animation for this
  // sport + cue, branded to the scoring team's color. Falls through to the
  // generic text cue below when no animation is mapped for this combo.
  const teamColor =
    cue.color ||
    (cue.team === 'away' ? cue.snapshot?.awayColor : cue.snapshot?.homeColor) ||
    cue.snapshot?.homeColor ||
    null;
  const celebUrl = celebrationSrc(sport, cue.key, teamColor, pack || 'v1', 'scoreboard');
  if (celebUrl) {
    return (
      <div
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
          zIndex: 50, background: '#05070d',
          animation: 'venueCelebScrim 0.35s ease-out',
        }}
      >
        <iframe
          src={celebUrl}
          title="celebration"
          scrolling="no"
          // Lane-8 P1: sandbox the celebration iframe even though src is
          // always a same-origin static file under /celebrations/. `allow-scripts`
          // lets the canvas engine run; omitting `allow-same-origin` blocks
          // any cookie / localStorage / top-frame access from inside.
          sandbox="allow-scripts"
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
            width: '100%', height: '100%', border: 0, display: 'block',
            pointerEvents: 'none',
          }}
        />
      </div>
    );
  }

  const snap = cue.snapshot;
  const big = BIG_CUE_RE.test(cue.key || '') || BIG_CUE_RE.test(cue.label || '');
  // Energy color — the operator's cue color when set, else broadcast
  // gold. Confetti also mixes in both team colors so the moment is
  // venue-branded even with no cue color set.
  const energy = cue.color || '#fbbf24';
  const confetti = [
    energy,
    '#ffffff',
    snap?.homeColor || '#38bdf8',
    snap?.awayColor || '#f472b6',
    '#fde047',
  ];
  const rings = big ? 4 : 3;
  const confettiCount = big ? 26 : 16;
  const glow = big ? 1520 : 1200;
  const emojiSize = big ? 432 : 360;
  // glow + rings centre on the emoji stack (which centres in y 0–830)
  const cy = 415;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: 'hidden',
        zIndex: 50,
      }}
    >
      {/* dark scrim */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background: 'rgba(5,7,13,0.85)',
          animation: 'venueCelebScrim 3.9s ease-in-out forwards',
        }}
      />
      {/* team-energy radial glow */}
      <div
        style={{
          position: 'absolute',
          left: 960 - glow / 2,
          top: cy - glow / 2,
          width: glow,
          height: glow,
          borderRadius: 999,
          background: `radial-gradient(circle, ${hexA(energy, 0.5)} 0%, ${hexA(
            energy,
            0.15,
          )} 42%, rgba(5,7,13,0) 66%)`,
          animation: 'venueCelebGlow 3.9s ease-in-out forwards',
        }}
      />
      {/* expanding shockwave rings */}
      {Array.from({ length: rings }, (_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: 960 - 220,
            top: cy - 220,
            width: 440,
            height: 440,
            borderRadius: 999,
            border: `9px solid ${hexA(energy, 0.85)}`,
            animation: `venueCelebRing 3.9s ${(i * 0.16).toFixed(
              2,
            )}s cubic-bezier(.15,.7,.3,1) forwards`,
          }}
        />
      ))}
      {/* diagonal light sweep — one fast pass on entrance */}
      <div
        style={{
          position: 'absolute',
          left: 770,
          top: -610,
          width: 380,
          height: 2300,
          background:
            'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0) 100%)',
          animation: 'venueCelebSweep 3.9s ease-out forwards',
        }}
      />
      {/* confetti */}
      {Array.from({ length: confettiCount }, (_, i) => {
        const tall = i % 3 === 0;
        const size = 13 + ((i * 11) % 17);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${(i * 61) % 100}%`,
              top: -70,
              width: size,
              height: tall ? size * 2.6 : size,
              background: confetti[i % confetti.length],
              borderRadius: tall ? 2 : 999,
              opacity: 0,
              animation: `${
                i % 2 ? 'venueCelebFallB' : 'venueCelebFallA'
              } ${(2.7 + (i % 5) * 0.28).toFixed(2)}s ${(
                0.08 +
                (i % 7) * 0.11
              ).toFixed(2)}s ease-in forwards`,
            }}
          />
        );
      })}
      {/* center stack — emoji + slammed label */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 250,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontSize: emojiSize,
            lineHeight: 1,
            filter: `drop-shadow(0 22px 50px ${hexA(energy, 0.7)})`,
            animation: 'venueCelebEmoji 3.9s cubic-bezier(.2,.9,.2,1) forwards',
          }}
        >
          {cue.emoji || '🎉'}
        </div>
        <div
          style={{
            fontSize: big ? 172 : 138,
            fontWeight: 900,
            letterSpacing: 6,
            color: '#fff',
            marginTop: 10,
            textAlign: 'center',
            textShadow: `0 12px 52px rgba(0,0,0,0.9), 0 0 64px ${hexA(energy, 0.55)}`,
            animation: 'venueCelebSlam 3.9s cubic-bezier(.2,.9,.2,1) forwards',
          }}
        >
          {(cue.label || cue.key || 'NICE!').toUpperCase()}
        </div>
      </div>

      {/* co-branded attribution — "BROUGHT TO YOU BY" + sponsor logo/name.
          Understated: small caps, dimmed, uses the energy accent colour.
          Animates in with the lower-third — transform/opacity only
          (Chromium-83 + WebKit safe). Rendered only when the cue carries
          a sponsorName so the visual is never affected on unsponsored cues. */}
      {cue.sponsorName && !cue.mediaUrl && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: snap ? 268 : 108,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            animation: 'venueCelebLowerText 3.9s ease-out forwards',
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: 5,
              color: hexA(energy, 0.7),
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            BROUGHT TO YOU BY
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {cue.sponsorLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cue.sponsorLogoUrl}
                alt=""
                style={{
                  height: 52,
                  width: 'auto',
                  maxWidth: 220,
                  objectFit: 'contain',
                  marginRight: 16,
                  filter: 'brightness(0.9)',
                }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div
              style={{
                fontSize: 36,
                fontWeight: 900,
                letterSpacing: 2,
                color: '#cbd5e1',
              }}
            >
              {cue.sponsorName}
            </div>
          </div>
        </div>
      )}

      {/* live-score lower-third — the EXACT score + clock frozen at
          cue-fire time. A mask-wipe bar reveals it. */}
      {snap && (
        <div
          style={{
            position: 'absolute',
            left: 960 - 600,
            bottom: 92,
            width: 1200,
            height: 156,
          }}
        >
          {/* the bar wipes in — scaleX from center */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              background:
                'linear-gradient(180deg, rgba(15,20,33,0.97), rgba(8,11,19,0.97))',
              borderRadius: 20,
              border: `2px solid ${hexA(energy, 0.5)}`,
              boxShadow: '0 26px 72px rgba(0,0,0,0.65)',
              animation: 'venueCelebLower 3.9s cubic-bezier(.2,.9,.2,1) forwards',
            }}
          />
          {/* score content fades + rises in after the wipe */}
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
              animation: 'venueCelebLowerText 3.9s ease-out forwards',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                fontSize: 84,
                fontWeight: 900,
                color: '#fff',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span style={{ color: snap.homeColor || '#fff', letterSpacing: 2 }}>
                {teamCode(snap.homeTeam)}
              </span>
              <span style={{ margin: '0 20px' }}>{snap.homeScore}</span>
              <span style={{ color: '#475569', fontSize: 52 }}>–</span>
              <span style={{ margin: '0 20px' }}>{snap.awayScore}</span>
              <span style={{ color: snap.awayColor || '#fff', letterSpacing: 2 }}>
                {teamCode(snap.awayTeam)}
              </span>
            </div>
            {(snap.segmentLabel || snap.clockText) && (
              <div
                style={{
                  marginLeft: 28,
                  paddingLeft: 28,
                  borderLeft: '2px solid #1e2638',
                  fontSize: 42,
                  fontWeight: 800,
                  letterSpacing: 4,
                  color: energy,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {[snap.segmentLabel, snap.clockText].filter(Boolean).join('  ·  ')}
              </div>
            )}
          </div>
        </div>
      )}
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
  // Audio ref for celebration sounds — holds the current Audio object
  // so we can pause + release it when the cue ends or on unmount.
  const cueAudio = useRef<HTMLAudioElement | null>(null);

  const stopCueAudio = () => {
    if (cueAudio.current) {
      cueAudio.current.pause();
      cueAudio.current = null;
    }
  };

  const pumpCues = () => {
    if (playing.current) return;
    const next = cueQueue.current.shift();
    if (!next) return;
    playing.current = true;
    setActiveCue(next);
    // Start audio best-effort — never let a failure interrupt playback.
    if (next.audioUrl && !next.mediaUrl) {
      stopCueAudio();
      try {
        const a = new Audio(next.audioUrl);
        cueAudio.current = a;
        a.play().catch(() => {});
      } catch (_) {
        // Audio API unavailable — silent fallback.
      }
    }
    // A custom cue holds for its own duration; a cinematic celebration runs
    // ~4.3s, so hold it 4.8s; a plain text cue holds 3.9s.
    const holdMs =
      next.mediaUrl && next.durationMs && next.durationMs > 0
        ? next.durationMs
        : celebrationSrc(data?.sport, next.key, null)
          ? 4800
          : 3900;
    cueTimer.current = setTimeout(() => {
      stopCueAudio();
      setActiveCue(null);
      playing.current = false;
      pumpCues();
    }, holdMs);
  };

  // Cancel a pending cue timer + audio on unmount (kiosk route reloads).
  useEffect(() => () => {
    if (cueTimer.current) clearTimeout(cueTimer.current);
    stopCueAudio();
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
    // Cold-boot: paint the last cached frame instantly (clock frozen)
    // so a power-cycle mid-game never shows a blank or error board.
    const cached = readBoardCache<BoardData>(gameId);
    if (cached) { setData(cached); setError(null); }
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
        writeBoardCache(gameId, json);

        for (const c of json.cues || []) {
          if (seenCues.current.has(c.id)) continue;
          seenCues.current.add(c.id);
          // The very first poll's cues already happened before the
          // board opened — record them as seen but don't replay.
          // Skip cues targeted only at the ribbon.
          if (!firstLoad.current && cuePlaysHere(c.target)) cueQueue.current.push(c);
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

  // Sprint 13 — CTS source-of-truth merge. When a CTS console is
  // broadcasting (Game.stats.cts.lastUpdateAt fresh within 5 s of
  // serverTime) the bridge's score/clock/segment win over the operator-
  // input columns. Stale or absent → operator inputs win. Single helper
  // in apps/web/src/lib/cts-merge.ts shared with the ribbon route so
  // both surfaces render identical numbers.
  const displayData = useMemo(
    () => (data ? applyCtsOverlay(data) : data),
    [data],
  );

  const keyframes = (
    <style>{`
      @keyframes venuePulse { 0%,100%{opacity:1} 50%{opacity:0.55} }
      @keyframes venueFooterFade { 0%{opacity:0} 100%{opacity:1} }
      @keyframes venueCelebScrim { 0%{opacity:0} 7%{opacity:1} 90%{opacity:1} 100%{opacity:0} }
      @keyframes venueCueBandUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      @keyframes venueCelebGlow {
        0%{opacity:0;transform:scale(0.35)}
        16%{opacity:1;transform:scale(1)}
        86%{opacity:0.92;transform:scale(1.05)}
        100%{opacity:0;transform:scale(1.12)}
      }
      @keyframes venueCelebRing {
        0%{opacity:0;transform:scale(0.2)}
        7%{opacity:0.9}
        46%{opacity:0}
        100%{opacity:0;transform:scale(3.7)}
      }
      @keyframes venueCelebSweep {
        0%{opacity:0;transform:translateX(-1500px) rotate(18deg)}
        4%{opacity:0.9}
        20%{opacity:0.9}
        30%{opacity:0;transform:translateX(1500px) rotate(18deg)}
        100%{opacity:0;transform:translateX(1500px) rotate(18deg)}
      }
      @keyframes venueCelebEmoji {
        0%{opacity:0;transform:scale(0)}
        7%{opacity:1;transform:scale(1.3)}
        13%{transform:scale(0.9)}
        18%{transform:scale(1.08)}
        23%{transform:scale(1)}
        90%{opacity:1;transform:scale(1)}
        100%{opacity:0;transform:scale(1.16)}
      }
      @keyframes venueCelebSlam {
        0%{opacity:0;transform:scale(1.75)}
        9%{opacity:1;transform:scale(0.9)}
        15%{transform:scale(1.07)}
        21%{transform:scale(1)}
        90%{opacity:1;transform:scale(1)}
        100%{opacity:0;transform:scale(1.05)}
      }
      @keyframes venueCelebLower {
        0%{opacity:0;transform:scaleX(0)}
        11%{opacity:1}
        22%{opacity:1;transform:scaleX(1)}
        89%{opacity:1;transform:scaleX(1)}
        100%{opacity:0;transform:scaleX(1)}
      }
      @keyframes venueCelebLowerText {
        0%{opacity:0;transform:translateY(16px)}
        20%{opacity:0;transform:translateY(16px)}
        30%{opacity:1;transform:translateY(0)}
        89%{opacity:1;transform:translateY(0)}
        100%{opacity:0;transform:translateY(0)}
      }
      @keyframes venueCelebFallA {
        0%{opacity:0;transform:translate(0,0) rotate(0deg)}
        6%{opacity:1}
        84%{opacity:1}
        100%{opacity:0;transform:translate(-90px,1200px) rotate(560deg)}
      }
      @keyframes venueCelebFallB {
        0%{opacity:0;transform:translate(0,0) rotate(0deg)}
        6%{opacity:1}
        84%{opacity:1}
        100%{opacity:0;transform:translate(95px,1230px) rotate(-640deg)}
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

  // Sprint 13 — operator picked a custom scoreboard template for this
  // game. Hand off to CustomScoreboardScene; it fetches the template,
  // wraps the render in <GameStateProvider> so the embedded sport
  // primitives (SCORE_HOME / GAME_CLOCK / etc.) read live game state,
  // and scales the template's NATIVE canvas (e.g. 960×1080 narrow LED)
  // to fit the viewport. NULL → legacy hardcoded scenes below render
  // unchanged (zero regression).
  if (data.scoreboardTemplateId) {
    // BoardData is structurally a superset of GameSnapshot (id, sport,
    // status, segment, homeTeam, awayTeam, homeScore, awayScore,
    // homeColor, awayColor, homeLogoUrl, awayLogoUrl, clockMs,
    // clockRunning, clockUpdatedAt, stats, serverTime — all present
    // on both). The cast is just to satisfy the narrower context
    // type; runtime values match exactly.
    //
    // 2026-05-27 — CTS overlay applied here too so a custom scoreboard
    // template reads the same merged data as the legacy hardcoded
    // scenes. The GameStateProvider inside CustomScoreboardScene
    // re-polls /sports/board/:id directly for its OWN live updates, so
    // the initial snapshot it receives is the CTS-overlaid view; its
    // ongoing polls also flow through this page's `data` (it's the
    // same endpoint) and we trust the helper to be idempotent.
    return (
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
        {keyframes}
        <CustomScoreboardScene
          templateId={data.scoreboardTemplateId}
          gameId={gameId}
          initial={displayData ?? data}
          embedded={(data as { scoreboardTemplate?: any }).scoreboardTemplate ?? null}
        />
      </div>
    );
  }

  // Sprint 13 — render the CTS-merged view (CTS data when fresh,
  // operator inputs when stale). Cue feed still reads from `data.cues`
  // (the helper doesn't touch that field) so celebrations fire unchanged.
  const view = displayData ?? data;

  // Select the scene component. LIVE always renders BoardScene (zero
  // regression on the working scoreboard). All other statuses get a
  // dedicated presentation scene.
  const status = view.status;
  const isLive = status === 'LIVE';
  const isPreGame = status === 'PRE_GAME' || status === 'SCHEDULED';
  const isHalftime = status === 'HALFTIME';
  const isFinal = status === 'FINAL';

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
        {isLive && <BoardScene data={view} def={def} />}
        {isPreGame && <PreGameScene data={view} def={def} />}
        {isHalftime && <HalftimeScene data={view} def={def} />}
        {isFinal && <FinalScene data={view} def={def} />}
        {/* Fallback for any unexpected status — use the live board */}
        {!isLive && !isPreGame && !isHalftime && !isFinal && (
          <BoardScene data={view} def={def} />
        )}
        {activeCue && (
          <CueOverlay
            cue={activeCue}
            sport={data?.sport}
            // 2026-05-27 — operator-selected celebration pack (Setup mode).
            // Stored on Game.stats so it travels with the game record.
            // 2026-05-28: default flipped to v2 — the sophisticated FINA
            // water polo canvas2D engine (the "good animated ones" the
            // operator gave us in commit 87da542). v2 already gracefully
            // falls back to v1 art for sports without v2 cues yet, so
            // defaulting to v2 has zero downside.
            pack={
              ((data?.stats as Record<string, unknown> | undefined)?.celebrationPack === 'v1'
                ? 'v1'
                : 'v2') as 'v1' | 'v2'
            }
          />
        )}
      </div>
    </div>
  );
}
