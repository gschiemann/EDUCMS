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
import { readBoardCache, writeBoardCache } from '@/lib/sports-board-cache';
import { useParams } from 'next/navigation';
import { API_URL } from '@/lib/api-url';
import { findSport, defaultRibbonPresets } from '@cms/api-types';
import type { SportDefinition } from '@cms/api-types';

interface Sponsor {
  id: string;
  name: string;
  logoUrl?: string | null;
  tagline?: string | null;
  color?: string | null;
}
interface Player {
  id: string;
  team: string;
  name: string;
  number: string | null;
  position: string | null;
  photoUrl: string | null;
  stats: Record<string, string>;
}
/** A fired celebration cue — the ribbon plays the ones targeted at it. */
interface Cue {
  id: string;
  key?: string;
  label?: string;
  emoji?: string;
  // Custom cue-deck fields — a full-ribbon takeover of uploaded art.
  custom?: boolean;
  mediaUrl?: string | null;
  color?: string | null;
  durationMs?: number;
  // Which surfaces play this cue — BOARD / RIBBON / ALL (default ALL).
  target?: string;
  // The score frozen at cue-fire time, captured server-side.
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
  roster?: Player[];
  ribbonMessages?: string[];
  /** Which content presets ride the reel — resolved server-side
   *  (stored config, or the sport's full default-on set). */
  ribbonPresets?: string[];
  /** Recent celebration cues — the board feed's 20s cue window. */
  cues?: Cue[];
  serverTime: number;
}

// 750ms — sub-second sync, kept in step with the board + scorebug.
const POLL_MS = 750;
const DEFAULT_HOME = '#4f46e5';
const DEFAULT_AWAY = '#dc2626';

/** This is the ribbon surface — it plays RIBBON- and ALL-targeted
 *  cues (and legacy untargeted ones); a scoreboard-only cue is
 *  skipped, so a cue fired "to the scoreboard" never hits the ribbon. */
function cuePlaysHere(target?: string): boolean {
  return target !== 'BOARD';
}

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
  | { kind: 'situational'; text: string }
  | { kind: 'prompt'; text: string }
  | { kind: 'sponsor'; sponsor: Sponsor }
  | { kind: 'player'; player: Player };

/**
 * A single punchy line of the sport's LIVE game situation, sized for
 * the ribbon reel — down & distance, the baseball count, the serve,
 * the basketball bonus. Returns null when nothing is live to show
 * (no down set yet, no server picked) so the situational tile is
 * skipped. Reads the SAME Game.stats keys the scoreboard's
 * situational strip uses, so the two surfaces never disagree.
 */
function ribbonSituational(def: SportDefinition, stats: Record<string, unknown>): string | null {
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
  const SEP = '  ·  ';

  // Baseball / softball — the live count + base runners.
  if (def.segment.name === 'Inning') {
    const parts: string[] = [];
    const half = String(stats.half || '').trim();
    if (half) parts.push(half.toUpperCase());
    parts.push(`${num(stats.balls)}-${num(stats.strikes)}`);
    parts.push(`${num(stats.outs)} OUT`);
    const bases: string[] = [];
    if (num(stats.on1B) > 0) bases.push('1ST');
    if (num(stats.on2B) > 0) bases.push('2ND');
    if (num(stats.on3B) > 0) bases.push('3RD');
    parts.push(
      bases.length === 3
        ? '◆ BASES LOADED'
        : bases.length
          ? `◆ ${bases.join(' & ')}`
          : '◇ BASES EMPTY',
    );
    return parts.join(SEP);
  }

  // Football — possession + down & distance + ball-on.
  if (def.key === 'football') {
    const down = num(stats.down);
    const poss = side(stats.possession);
    const ballOn = stats.ballOn;
    const hasBallOn = ballOn !== undefined && ballOn !== null && ballOn !== '';
    if (down <= 0 && !poss && !hasBallOn) return null;
    const parts: string[] = [];
    if (poss) parts.push(`${poss.toUpperCase()} BALL`);
    if (down > 0) {
      const dist = num(stats.distance);
      parts.push(`${ordinal(down)} & ${dist === 0 ? 'GOAL' : dist}`);
    }
    if (hasBallOn) parts.push(`BALL ON ${String(ballOn)}`);
    return parts.length ? parts.join(SEP) : null;
  }

  // Basketball — team bonus + possession arrow.
  if (def.key === 'basketball') {
    const bonus = (f: number) => (f >= 10 ? 'DOUBLE BONUS' : f >= 7 ? 'BONUS' : null);
    const parts: string[] = [];
    const hb = bonus(num(stats.homeFouls));
    const ab = bonus(num(stats.awayFouls));
    if (hb) parts.push(`HOME ${hb}`);
    if (ab) parts.push(`AWAY ${ab}`);
    const poss = side(stats.possession);
    if (poss) parts.push(`POSS ${poss.toUpperCase()}`);
    return parts.length ? parts.join(SEP) : null;
  }

  // Rally sports — the serve.
  if (def.key === 'volleyball' || def.key === 'pickleball') {
    const serving = String(stats.serving || '').trim();
    return serving ? `SERVING — ${serving.toUpperCase()}` : null;
  }

  // Everything else — the SportDefinition stat chips that have a value.
  const chips = def.stats
    .map((s) => {
      const raw = stats[s.key];
      if (raw === undefined || raw === null || raw === '') return null;
      return `${s.label.toUpperCase()} ${String(raw)}`;
    })
    .filter((x): x is string => x !== null)
    .slice(0, 4);
  return chips.length ? chips.join(SEP) : null;
}

/**
 * Build the ribbon reel from the operator's content presets. Each
 * preset is a content tile the operator toggled on in the control
 * panel; `data.ribbonPresets` is the resolved list (server falls
 * back to every applicable preset when the reel was never
 * configured, so an unconfigured ribbon shows everything).
 */
function buildCells(data: BoardData, def: SportDefinition): Cell[] {
  const homeCode = teamCode(data.homeTeam);
  const enabled = new Set<string>(
    Array.isArray(data.ribbonPresets) ? data.ribbonPresets : defaultRibbonPresets(def),
  );
  const cells: Cell[] = [];

  // Score.
  if (enabled.has('score')) cells.push({ kind: 'score' });

  // Period + clock — one combined status tile when both are on, so
  // "Q2 · 5:30" reads as a unit; either alone shows just that part.
  const showSeg = enabled.has('segment');
  const showClk = enabled.has('clock') && def.clock.type !== 'none';
  if (showSeg || showClk) {
    const seg = segmentLabel(def, data);
    const clk = fmtClock(liveClockMs(data, def));
    const text = showSeg && showClk ? `${seg} · ${clk}` : showSeg ? seg : clk;
    cells.push({ kind: 'status', text, live: data.status === 'LIVE' });
  }

  // Sport-specific game situation — only when there's something live.
  if (enabled.has('situation')) {
    const sit = ribbonSituational(def, (data.stats || {}) as Record<string, unknown>);
    if (sit) cells.push({ kind: 'situational', text: sit });
  }

  // Engagement tiles. Operator-set ribbon messages win; otherwise the
  // default crowd prompts. Each tile type is gated on its preset.
  const custom = enabled.has('prompts')
    ? (data.ribbonMessages || []).map((m) => m.trim()).filter(Boolean)
    : [];
  const prompts = !enabled.has('prompts')
    ? []
    : custom.length
      ? custom
      : ['LET’S GO!', `GO ${homeCode}!`, 'MAKE SOME NOISE', 'DEFENSE!', `${homeCode} PRIDE`];
  const sponsors = enabled.has('sponsors') ? data.sponsors || [] : [];
  const players = enabled.has('roster') ? data.roster || [] : [];
  let pi = 0;
  let si = 0;
  let pl = 0;
  // Interleave roster players (weighted — two per pass), sponsors, and
  // crowd prompts so the loop is a rich mix, never a wall of one kind.
  while (pi < prompts.length || si < sponsors.length || pl < players.length) {
    if (pl < players.length) cells.push({ kind: 'player', player: players[pl++] });
    if (si < sponsors.length) cells.push({ kind: 'sponsor', sponsor: sponsors[si++] });
    if (pl < players.length) cells.push({ kind: 'player', player: players[pl++] });
    if (pi < prompts.length) cells.push({ kind: 'prompt', text: prompts[pi++] });
  }
  // Re-insert the score mid-reel so it comes around twice per loop.
  if (enabled.has('score') && cells.length > 1) {
    cells.splice(Math.ceil(cells.length / 2), 0, { kind: 'score' });
  }
  // A board is never blank — if every preset is off, still show the score.
  if (cells.length === 0) cells.push({ kind: 'score' });
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

  // cue playback — celebrations the operator fired at the ribbon (or ALL)
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
    // matches the 3.9s celebration animation.
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
    // Cold-boot: instant paint from the last cached frame so a
    // power-cycle / Wi-Fi blip never blanks the ribbon.
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
        // Queue new celebration cues targeted at the ribbon. The first
        // poll's cues already happened before the ribbon opened —
        // record them as seen but don't replay.
        for (const c of json.cues || []) {
          if (seenCues.current.has(c.id)) continue;
          seenCues.current.add(c.id);
          if (!firstLoad.current && cuePlaysHere(c.target)) cueQueue.current.push(c);
        }
        firstLoad.current = false;
        pumpCues();
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
      <style>{`@keyframes ribbonScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}@keyframes ribbonCueShow{0%{opacity:0}8%{opacity:1}90%{opacity:1}100%{opacity:0}}@keyframes ribbonCuePop{0%{transform:scale(0.7)}14%{transform:scale(1.06)}24%{transform:scale(1)}100%{transform:scale(1)}}@keyframes ribbonCueIn{from{opacity:0}to{opacity:1}}`}</style>

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

      {/* celebration cue overlay — a fired cue takes over the ribbon */}
      {activeCue && <RibbonCueOverlay cue={activeCue} h={h} />}
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

  if (cell.kind === 'situational') {
    return (
      <div style={wrap}>
        <span
          style={{
            fontSize: h * 0.32,
            fontWeight: 900,
            letterSpacing: 2,
            color: '#38bdf8',
            whiteSpace: 'nowrap',
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

  if (cell.kind === 'player') {
    const p = cell.player;
    const color = p.team === 'away' ? awayColor : homeColor;
    const statKeys = Object.keys(p.stats || {});
    const topStat = statKeys[0] ? `${statKeys[0]} ${p.stats[statKeys[0]]}` : null;
    const initials = p.name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    const eyebrow =
      [p.number ? `#${p.number}` : null, p.position].filter(Boolean).join(' · ').toUpperCase() ||
      'PLAYER';
    return (
      <div style={wrap}>
        {p.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.photoUrl}
            alt=""
            style={{
              height: h * 0.74,
              width: h * 0.74,
              borderRadius: 999,
              objectFit: 'cover',
              border: `${Math.max(2, Math.round(h * 0.03))}px solid ${color}`,
              marginRight: h * 0.22,
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            style={{
              height: h * 0.74,
              width: h * 0.74,
              borderRadius: 999,
              background: color,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: h * 0.3,
              fontWeight: 900,
              marginRight: h * 0.22,
            }}
          >
            {initials || '—'}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <span style={{ fontSize: h * 0.15, fontWeight: 800, letterSpacing: 3, color }}>
            {eyebrow}
          </span>
          <span style={{ fontSize: h * 0.32, fontWeight: 900, color: '#fff', whiteSpace: 'nowrap' }}>
            {p.name}
          </span>
          {topStat ? (
            <span
              style={{
                fontSize: h * 0.18,
                fontWeight: 700,
                color: '#94a3b8',
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {topStat}
            </span>
          ) : null}
        </div>
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

// ── celebration cue overlay ────────────────────────────────────

/**
 * A fired cue takes over the whole ribbon for its hold window. A
 * custom cue shows the operator's uploaded art; a sport celebration
 * shows the emoji + label + the score frozen at fire time.
 *
 * Chromium-83 safe (NovaStar Taurus): long-hand insets, no flex
 * `gap` (per-child margin), animation is opacity / transform only.
 */
function RibbonCueOverlay({ cue, h }: { cue: Cue; h: number }) {
  // Custom cue — a full-ribbon takeover of the operator's uploaded art.
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
          zIndex: 60,
          animation: 'ribbonCueIn 0.45s ease-out',
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

  // Sport celebration — emoji + label + the frozen score snapshot.
  const snap = cue.snapshot;
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
        background: 'rgba(5,7,13,0.94)',
        overflow: 'hidden',
        zIndex: 60,
        animation: 'ribbonCueShow 3.9s ease-in-out forwards',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          animation: 'ribbonCuePop 3.9s cubic-bezier(.2,.9,.2,1) forwards',
        }}
      >
        <span style={{ fontSize: h * 0.62, lineHeight: 1, marginRight: h * 0.16 }}>
          {cue.emoji || '🎉'}
        </span>
        <span
          style={{
            fontSize: h * 0.4,
            fontWeight: 900,
            letterSpacing: 4,
            color: '#fff',
            whiteSpace: 'nowrap',
            textShadow: '0 6px 30px rgba(0,0,0,0.85)',
          }}
        >
          {(cue.label || cue.key || 'NICE!').toUpperCase()}
        </span>
        {snap && (
          <span
            style={{
              marginLeft: h * 0.22,
              fontSize: h * 0.34,
              fontWeight: 900,
              color: '#fff',
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span style={{ color: snap.homeColor || '#fff', letterSpacing: 1 }}>
              {teamCode(snap.homeTeam)}
            </span>
            <span style={{ margin: `0 ${Math.round(h * 0.07)}px` }}>{snap.homeScore}</span>
            <span style={{ color: '#475569' }}>–</span>
            <span style={{ margin: `0 ${Math.round(h * 0.07)}px` }}>{snap.awayScore}</span>
            <span style={{ color: snap.awayColor || '#fff', letterSpacing: 1 }}>
              {teamCode(snap.awayTeam)}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
