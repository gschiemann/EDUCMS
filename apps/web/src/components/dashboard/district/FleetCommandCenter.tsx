"use client";

/**
 * FleetCommandCenter — the Fleet Command HQ dashboard.
 *
 * Design source: scratch/design/multi-location-dashboard/fleet-command-v1.png
 * (operator-approved, 2026-08-31). The mock is the spec — this surface is a
 * COMPOSITION OF SEPARATE CARDS on the page's slate-50 ground, not one white
 * panel with sections inside it:
 *
 *   • a header band (title · location filter · Push content / Run fleet check)
 *   • an assurance rail of five independent truths, one card each
 *   • Needs attention · Live deployment · Fleet pulse
 *   • Locations (list or map) · Recent activity
 *
 * "Online" is one card of five, never a health synonym. All derivation lives
 * in fleetCommand.ts (pure, unit-tested); this file is presentation +
 * navigation only.
 *
 * ── ROLLBACK CONTRACT (operator condition for shipping this) ─────────
 * The classic dashboard (DistrictCommandCenter + KPI/status sections) is
 * fully preserved behind the per-user toggle in dashboard/page.tsx
 * (localStorage `venueos_hq_dashboard`). "Classic view" up top switches
 * back instantly — no deploy. Flipping the fleet-wide default back is the
 * one-line `HQ_DASHBOARD_DEFAULT` constant in dashboard/page.tsx.
 *
 * Brand-aware by construction: every tinted surface derives from
 * --brand-primary via color-mix (the BrandStyleInjector tokens), so a
 * crimson gym and a navy district each see their own dashboard. Health
 * colors stay semantic (emerald/amber/rose) — "screens down" must never
 * inherit a red brand's decoration.
 *
 * Dashboard surface (not player/widget) → CSS gap/inset are fine here. No
 * backdrop-blur anywhere (mobile standard), and no chart library: every
 * graphic on this page is hand-rolled inline SVG.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, AlertTriangle, ArrowRight, Building2, Calendar, CheckCircle2, ChevronDown,
  ChevronUp, CloudOff, CreditCard, FileCheck2, Inbox, Info, ListVideo, Loader2, MapPin,
  MonitorCheck, MonitorPlay, MonitorX, MoreHorizontal, Radio, RefreshCw, Search, Send,
  ShieldAlert, ShieldCheck, SlidersHorizontal, Upload, Wifi, X, Zap,
} from 'lucide-react';
import { useTenantSwitch } from '@/hooks/use-tenant-switch';
import { useRefreshWeb } from '@/hooks/use-api';
import { VERTICAL_LABELS, normalizeVertical } from '@cms/api-types';
import type {
  FleetResponse, DistrictReadinessResponse, DistrictPendingApprovals, DeploymentRow,
  FleetPulseResponse, FleetPulsePoint,
} from '@/hooks/use-api';
import {
  buildFleetCommand, buildLocationPanel, donutSegments, groupInbox, isContentBehind,
  atlasRowLines, parseCityState,
  type AssuranceState, type ExceptionRow, type LocationRow,
} from './fleetCommand';
import { deriveRenderTrustGrade } from '@/components/screens/renderTrust';
import { filterScorecards } from './districtRollup';
import { ProofDrawer, timeAgo, type ProofDrawerScreen } from './ProofDrawer';
import { DeviceDrawer, type DeviceDrawerScreen } from './DeviceDrawer';
import { ScreenMapClient } from '@/components/screens/ScreenMapClient';
// Type-only — erased at compile time, so the dashboard bundle still reaches
// Leaflet exclusively through the ssr:false dynamic import above.
import type { LocationPin } from '@/components/screens/ScreenMap';

/** The mock's card: white on the page's slate ground, hairline, barely a shadow. */
const CARD = 'bg-white rounded-2xl border border-slate-200/90 shadow-[0_1px_3px_rgba(15,23,42,0.05)]';

/** Icon-chip tint per assurance state — semantic health, never brand. */
const PILL_ICON_TONE: Record<AssuranceState, string> = {
  ok: 'bg-emerald-50 text-emerald-600',
  warn: 'bg-amber-50 text-amber-600',
  bad: 'bg-rose-50 text-rose-600',
  unknown: 'bg-slate-100 text-slate-400',
};

const INBOX_ICON: Record<ExceptionRow['kind'], typeof CloudOff> = {
  emergency: ShieldAlert,
  'not-painting': MonitorX,
  offline: CloudOff,
  'content-behind': FileCheck2,
  'push-stale': Wifi,
  approvals: Inbox,
  setup: MonitorPlay,
};

const INBOX_TONE: Record<ExceptionRow['kind'], string> = {
  emergency: 'text-rose-600 bg-rose-50',
  'not-painting': 'text-rose-600 bg-rose-50',
  offline: 'text-amber-600 bg-amber-50',
  'content-behind': 'text-rose-600 bg-rose-50',
  'push-stale': 'text-amber-600 bg-amber-50',
  approvals: 'text-slate-500 bg-slate-100',
  setup: 'text-sky-600 bg-sky-50',
};

/** The age accent in a headline carries the row's own severity. */
const INBOX_AGE_TONE: Record<ExceptionRow['kind'], string> = {
  emergency: 'text-rose-600',
  'not-painting': 'text-rose-600',
  offline: 'text-amber-600',
  'content-behind': 'text-rose-600',
  'push-stale': 'text-amber-600',
  approvals: 'text-slate-400',
  setup: 'text-slate-400',
};

/**
 * The verb each exception offers, per the mock's action column.
 *
 * 'resync' / 'reconnect' both send THAT ONE SCREEN the reload command — the
 * push rides the screen's own content feed as well as the live channel, so it
 * reaches a screen whose push channel is dead (which is exactly why a dead
 * channel is a "Reconnect", not just an "Open").
 *
 * 'open' is for everything a reload cannot fix: an offline screen isn't
 * listening, a missing emergency playlist is a settings gap, and a wedged
 * renderer needs eyes on the screen page.
 */
type InboxVerb = 'resync' | 'reconnect' | 'open';
const INBOX_VERB: Record<ExceptionRow['kind'], InboxVerb> = {
  'content-behind': 'resync',
  'push-stale': 'reconnect',
  'not-painting': 'open',
  offline: 'open',
  emergency: 'open',
  approvals: 'open',
  setup: 'open',
};

/** A deployment older than this is history, not something to watch. */
const RECENT_DEPLOYMENT_MS = 24 * 60 * 60 * 1000;

/**
 * How long a LANDED push keeps its "confirmed everywhere" banner before the
 * strip disappears entirely. Measured from `createdAt` because that is the
 * only timestamp the deployments payload carries — no completion stamp
 * exists, so the window closes EARLY rather than late. No standing card, and
 * never a stale "43m ago" line (2026-08-31 operator feedback).
 */
const SETTLED_BANNER_MS = 10 * 60 * 1000;

/** Schedule rows the card renders before it collapses into "+N more". */
const SCHEDULE_ROWS = 5;

/** Fewer samples than this and a 24h chart would be a drawing, not a record. */
// Two points draw an honest line; the header labels short spans as
// building-history so nobody mistakes an hour for a day (2026-08-31 —
// operator: "give me some data we have so far so I can see the UI").
const MIN_PULSE_SAMPLES = 2;
const PULSE_FULL_SPAN_MS = 20 * 60 * 60 * 1000;

/** Text color per worst-line severity — one place, so the map can reuse it. */
const WORST_TONE_CLS: Record<'muted' | 'warn' | 'bad', string> = {
  muted: 'text-slate-400',
  warn: 'text-amber-600',
  bad: 'text-rose-600',
};

/**
 * The map's ring colors, as literals. Deliberately the SAME three values
 * LOCATION_TONE_COLOR uses inside ScreenMap — the selected-location panel
 * draws its own logo ring in CSS, and a panel whose ring is a different green
 * from the pin it describes reads as a different status.
 */
const TONE_HEX: Record<'ok' | 'warn' | 'bad', string> = {
  ok: '#10b981',
  warn: '#f59e0b',
  bad: '#f43f5e',
};

/** Screen tiles the selected-location panel draws before "View all". */
const ATLAS_SCREEN_TILES = 3;

/**
 * The single worst thing true about a location, worst-first — null when the
 * location is calm. Shared by the table row, the map's selected-location card
 * AND the atlas pin ring, so those three surfaces can never word (or color)
 * the same location differently.
 */
function worstLine(row: LocationRow): { text: string; cls: string; tone: 'muted' | 'warn' | 'bad' } | null {
  const line = (tone: 'muted' | 'warn' | 'bad', text: string) => ({ text, tone, cls: WORST_TONE_CLS[tone] });
  if (!row.hasScreens) return line('muted', 'No screens set up yet');
  if (row.readiness === 'NOT_CONFIGURED') return line('bad', 'Can’t display an emergency alert');
  if (row.notPainting > 0) return line('bad', `${row.notPainting} no picture confirmed`);
  if (row.screensOffline > 0) return line('warn', `${row.screensOffline} offline`);
  if (row.contentBehind > 0) return line('warn', `${row.contentBehind} behind on content`);
  return null;
}

/**
 * A location's atlas ring color — the SAME precedence the table prints, plus
 * the one state the worst-line deliberately doesn't spend a whole row on
 * (screens on the ~10s polling backstop), which the table's own Push column
 * already grades amber.
 */
function locationTone(row: LocationRow): 'ok' | 'warn' | 'bad' {
  const worst = worstLine(row);
  if (worst?.tone === 'bad') return 'bad';
  if (worst?.tone === 'warn') return 'warn';
  if (row.pushStale > 0) return 'warn';
  return 'ok';
}

/** 1–2 letters for a location with no org logo. Never blank. */
function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  return letters || '•';
}

/** Where a click on this location lands — keyed off the SAME precedence. */
function worstPath(row: LocationRow): string {
  if (!row.hasScreens) return 'screens';
  if (row.readiness === 'NOT_CONFIGURED') return 'settings/emergency';
  return worstLine(row) ? 'screens' : 'dashboard';
}

/**
 * Atlas pin filters — the mock's floating chip row, "All" first so the map
 * never opens pre-narrowed. Each one is a real slice of the SAME LocationRow
 * the table and the ring read, so a chip can never select a set the rest of
 * the page would grade differently.
 */
type AtlasFilterKey = 'all' | 'healthy' | 'drift' | 'push' | 'emergency';
const ATLAS_FILTERS: Array<{ key: AtlasFilterKey; label: string; dot?: string; Icon?: typeof ShieldAlert }> = [
  { key: 'all', label: 'All' },
  { key: 'healthy', label: 'Healthy', dot: '#10b981' },
  { key: 'drift', label: 'Content drift', dot: '#f59e0b' },
  { key: 'push', label: 'Push issues', dot: '#f43f5e' },
  { key: 'emergency', label: 'Emergency gaps', Icon: ShieldAlert },
];

/** Does this location belong in the chip's slice? */
function matchesAtlasFilter(row: LocationRow, key: AtlasFilterKey): boolean {
  switch (key) {
    case 'all': return true;
    case 'healthy': return locationTone(row) === 'ok';
    case 'drift': return row.contentBehind > 0;
    case 'push': return row.pushStale > 0;
    // "Isn't Ready" — but never UNKNOWN: a readiness check that has not
    // answered is not evidence of a gap (never cry wolf).
    case 'emergency': return row.readiness === 'NEEDS_ATTENTION' || row.readiness === 'NOT_CONFIGURED';
  }
}

/** Dot colors for the grouped inbox headings — semantic, never brand. */
const GROUP_DOT: Record<'bad' | 'warn' | 'muted', string> = {
  bad: '#f43f5e',
  warn: '#f59e0b',
  muted: '#94a3b8',
};

/**
 * A stable identity for one inbox row. The index is part of it on purpose:
 * two "+N more at X" aggregates of DIFFERENT kinds at the same location share
 * every other field, and a key that collided would move the selection to the
 * wrong row. Derived the same way wherever a row is rendered or looked up.
 */
function inboxRowKey(row: ExceptionRow, i: number): string {
  return `${row.kind}:${row.screenId ?? row.tenantId}:${i}`;
}

/** Plain-English "what is this column" — never "never-evict tier". */
const CACHE_HINT =
  'Screens with emergency content stored locally — they can show an alert even if the network is down.';

/**
 * Is this push still "the current one"? Reads the wall clock at render on
 * purpose — the boundary has to age with the page, and the branch it gates is
 * client-only (this app never prefetches react-query on the server, so the
 * deployments payload is always absent during SSR), so there is no
 * server/client render to disagree. A push with an unparseable timestamp is
 * treated as NOT recent: fail closed rather than pin a bad record to the card.
 */
function isRecentPush(createdAt: string): boolean {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && Date.now() - t < RECENT_DEPLOYMENT_MS;
}

/** Wall-clock time of day, e.g. "9:47 AM". Client-only, same reasoning above. */
function clockTime(ts: string | number): string {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ─── Small presentational atoms ──────────────────────────────────────

/** Circled-icon + text, the mock's cell language for a graded fact. */
function StatusCell({
  tone, children, title,
}: { tone: 'ok' | 'warn' | 'bad' | 'muted'; children: React.ReactNode; title?: string }) {
  if (tone === 'muted') return <span className="text-slate-300">—</span>;
  const Icon = tone === 'ok' ? CheckCircle2 : AlertCircle;
  const cls = tone === 'ok' ? 'text-emerald-500' : tone === 'warn' ? 'text-amber-500' : 'text-rose-500';
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={title}>
      <Icon className={`w-4 h-4 shrink-0 ${cls}`} aria-hidden />
      <span className="text-slate-700">{children}</span>
    </span>
  );
}

/**
 * Per-location online trend — the mock's tiny in-row chart. Green while every
 * screen is currently answering, red the moment one isn't; an absent series
 * renders nothing at all rather than a flat line implying "all fine".
 */
function Sparkline({ series }: { series?: Array<{ ts: number; online: number; total: number }> }) {
  if (!series || series.length < 2) return null;
  const W = 54;
  const H = 18;
  const max = Math.max(1, ...series.map((p) => p.total));
  const pt = (p: { online: number }, i: number) => [
    (i / (series.length - 1)) * W,
    H - 1 - (p.online / max) * (H - 3),
  ];
  const line = series.map((p, i) => { const [x, y] = pt(p, i); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('');
  const last = series[series.length - 1];
  const ok = last.total === 0 || last.online >= last.total;
  const stroke = ok ? '#10b981' : '#f43f5e';
  const fill = ok ? 'rgba(16,185,129,0.14)' : 'rgba(244,63,94,0.14)';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="overflow-visible" role="img" aria-label={ok ? 'All screens answering' : 'Some screens not answering'}>
      <path d={`${line}L${W},${H}L0,${H}Z`} fill={fill} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Chart aspect bounds — 3:1 at its flattest, never taller than square. */
const PULSE_MIN_RATIO = 104 / 320;
const PULSE_MAX_RATIO = 1;

/**
 * Measure an element's own height:width ratio, live.
 *
 * NO FEEDBACK LOOP: the measured box is `min-h-0 overflow-hidden` inside a
 * flex card whose height comes from the GRID ROW (its siblings), so the SVG
 * this ratio sizes can never push the container taller and re-trigger the
 * observer. Returns undefined until something has actually been measured —
 * and in any environment without ResizeObserver (jsdom), which is exactly
 * when the caller's default aspect is the right answer.
 */
function useFillRatio<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [ratio, setRatio] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setRatio((prev) => (prev != null && Math.abs(prev - h / w) < 0.005 ? prev : h / w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, ratio] as const;
}

/**
 * Fleet pulse — the mock's stacked 24h area chart, hand-rolled SVG (no chart
 * dependency). Stacked bottom-up so the top edge is the whole fleet:
 *   offline (red) · degraded, i.e. online with no confirmed picture (amber) ·
 *   online AND painting (green).
 *
 * Draws only what the sampler recorded. A fresh deploy has a handful of
 * samples and says so instead of drawing a 24-hour line through two points.
 */
function FleetPulseChart({ points, fillRatio }: { points: FleetPulsePoint[]; fillRatio?: number }) {
  const W = 320;
  // The SVG scales UNIFORMLY to the card's width, so its rendered height is
  // width × (H/W). Handing it the container's own height:width ratio makes it
  // land exactly on the space available — the chart fills the card instead of
  // floating in whitespace (2026-08-31 operator: keep it the same height as
  // the other cards). Uniform scaling means a taller viewBox adds vertical
  // user-space WITHOUT stretching text or strokes: an 8-unit label still
  // renders at 8 × (cardWidth / 320) pixels either way.
  //
  // Clamped so a freak measurement can't produce a sliver or a square-ish
  // chart, and the 3:1 default (104/320) is what a container that never
  // reported a size falls back to.
  const H = Math.round(W * Math.min(PULSE_MAX_RATIO, Math.max(PULSE_MIN_RATIO, fillRatio ?? PULSE_MIN_RATIO)));
  const padL = 24;
  const padR = 4;
  const padT = 5;
  const padB = 16;

  const stack = points.map((p) => {
    const offline = Math.max(0, p.offline);
    const degraded = Math.max(0, Math.min(p.notPainting, p.online));
    const healthy = Math.max(0, p.online - degraded);
    return { ts: p.ts, b1: offline, b2: offline + degraded, b3: offline + degraded + healthy };
  });
  const maxY = Math.max(1, ...points.map((p, i) => Math.max(p.total, stack[i].b3)));
  const x = (i: number) => padL + (i / Math.max(1, points.length - 1)) * (W - padL - padR);
  const y = (v: number) => H - padB - (v / maxY) * (H - padT - padB);

  const band = (lo: (i: number) => number, hi: (i: number) => number) => {
    const up = stack.map((_, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(hi(i)).toFixed(1)}`).join('');
    const down = stack
      .map((_, i) => stack.length - 1 - i)
      .map((i) => `L${x(i).toFixed(1)},${y(lo(i)).toFixed(1)}`)
      .join('');
    return `${up}${down}Z`;
  };
  const line = (v: (i: number) => number) =>
    stack.map((_, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v(i)).toFixed(1)}`).join('');

  const yTicks = Array.from(new Set([0, Math.round(maxY / 2), maxY]));
  // Four evenly spaced time labels; the newest sample is always "Now".
  const tickIdx = Array.from(new Set(
    [0, 1, 2, 3, 4].map((k) => Math.round((k / 4) * (points.length - 1))),
  )).sort((a, b) => a - b);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Fleet status over the last 24 hours, ${points.length} samples`}>
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#e2e8f0" strokeWidth={0.6} />
          <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize={8} fill="#94a3b8" fontWeight={600}>{v}</text>
        </g>
      ))}
      <path d={band(() => 0, (i) => stack[i].b1)} fill="rgba(244,63,94,0.16)" />
      <path d={band((i) => stack[i].b1, (i) => stack[i].b2)} fill="rgba(245,158,11,0.18)" />
      <path d={band((i) => stack[i].b2, (i) => stack[i].b3)} fill="rgba(16,185,129,0.16)" />
      <path d={line((i) => stack[i].b1)} fill="none" stroke="#f43f5e" strokeWidth={1.4} strokeLinejoin="round" />
      <path d={line((i) => stack[i].b2)} fill="none" stroke="#f59e0b" strokeWidth={1.4} strokeLinejoin="round" />
      <path d={line((i) => stack[i].b3)} fill="none" stroke="#10b981" strokeWidth={1.6} strokeLinejoin="round" />
      {tickIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fontSize={8} fill="#94a3b8" fontWeight={600}>
          {i === points.length - 1 ? 'Now' : new Date(points[i].ts).toLocaleTimeString([], { hour: 'numeric' })}
        </text>
      ))}
    </svg>
  );
}

/** How long "Sent ✓" stands before the button offers itself again. */
const SENT_CONFIRM_MS = 3000;

/**
 * The mock's per-row recovery verb. Sends THAT ONE SCREEN the reload command
 * (dual-path, so it reaches a screen with a dead push channel too), then holds
 * "Sent ✓" — including through the disabled window, because a control reading
 * "Sent ✓" that fires again on click is a trap.
 */
function RowPushButton({ screenId, verb }: { screenId: string; verb: 'resync' | 'reconnect' }) {
  const refreshWeb = useRefreshWeb();
  const [sent, setSent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const fire = () => {
    refreshWeb.mutate({ screenId });
    setSent(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSent(false), SENT_CONFIRM_MS);
  };

  const tone = verb === 'resync'
    ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
    : 'border-amber-200 text-amber-600 hover:bg-amber-50';

  return (
    <button
      type="button"
      onClick={fire}
      disabled={refreshWeb.isPending || sent}
      title={
        verb === 'resync'
          ? 'Send this screen the reload command so it picks up the published content.'
          : 'Send this screen the reload command — a reload re-establishes its live connection.'
      }
      className={`shrink-0 text-[12px] font-bold px-3.5 py-1.5 rounded-lg border disabled:opacity-70 ${
        sent ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : tone
      }`}
    >
      {refreshWeb.isPending
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label="Sending" />
        : sent ? 'Sent ✓' : verb === 'resync' ? 'Resync' : 'Reconnect'}
    </button>
  );
}

/**
 * The Atlas inbox's primary verb — same one-screen reload command the table
 * rows send, styled as the mock's solid purple button.
 */
function InboxResyncButton({ screenId }: { screenId: string }) {
  const refreshWeb = useRefreshWeb();
  const [sent, setSent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const fire = () => {
    refreshWeb.mutate({ screenId });
    setSent(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSent(false), SENT_CONFIRM_MS);
  };

  return (
    <button
      type="button"
      onClick={fire}
      // Held through the confirmation window: a control reading "Sent ✓" that
      // fires again on click is a trap.
      disabled={refreshWeb.isPending || sent}
      title="Send this screen the reload command so it picks up the published content."
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-bold text-white disabled:opacity-70"
      style={{ background: sent ? '#059669' : 'var(--brand-primary, #4f46e5)' }}
    >
      {refreshWeb.isPending
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label="Sending" />
        : <RefreshCw className="w-3.5 h-3.5" aria-hidden />}
      {sent ? 'Sent ✓' : 'Resync'}
    </button>
  );
}

/** One "icon · label ……… value" row in the selected-location panel. */
function PanelStat({
  Icon, label, sub, children,
}: { Icon: typeof Wifi; label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden />
      <dt className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold text-slate-600 truncate">{label}</span>
        {sub && <span className="block text-[11px] font-semibold text-slate-400 truncate">{sub}</span>}
      </dt>
      <dd className="text-[12.5px] font-black text-slate-900 text-right shrink-0 whitespace-nowrap">{children}</dd>
    </div>
  );
}

/** One grouped schedule row, already shaped by the page. */
export interface FleetScheduleRow {
  key: string;
  /** Playlist (or schedule) name. */
  name: string;
  /** "Lobby · Front desk · +2 more" — already collapsed by the page. */
  deviceLine: string;
  deviceCount: number;
  timeStart: string;
  timeEnd: string;
  isActive: boolean;
  /** First image in the playlist, or null for a video/template playlist. */
  previewUrl: string | null;
  /** Majority orientation of the target screens — shapes the preview tile. */
  portrait: boolean;
}

export function FleetCommandCenter({
  fleet,
  readiness,
  approvals,
  deployments,
  pulse,
  activity,
  schedule,
  scheduleTotals,
  orgName,
  logoUrl,
  onSwitchClassic,
  onFleetCheck,
}: {
  fleet: FleetResponse;
  readiness?: DistrictReadinessResponse | null;
  approvals?: DistrictPendingApprovals | null;
  /** Recent "Push content" actions. Absent → no deployment banner. */
  deployments?: { deployments: DeploymentRow[] } | null;
  /** Recorded fleet history for the pulse chart + row sparklines. */
  pulse?: FleetPulseResponse | null;
  /** Recent audit lines, already shaped by the page. */
  activity?: Array<{ title: string; detail?: string; at: string }> | null;
  /** Today's grouped schedule rows (the page owns the grouping). */
  schedule?: FleetScheduleRow[] | null;
  /** Counts for the schedule card's header line. */
  scheduleTotals?: { playing: number; total: number } | null;
  orgName?: string | null;
  /** Org logo for the atlas pins. Absent → initials on a brand-tinted disc. */
  logoUrl?: string | null;
  onSwitchClassic: () => void;
  /** Re-probe everything (fleet / readiness / approvals / deployments). */
  onFleetCheck?: () => Promise<unknown> | void;
}) {
  const { switchToTenant, switchingId } = useTenantSwitch();
  const [q, setQ] = useState('');
  // ── Network Atlas — the locations section's second view. ────────────
  // The map is a VIEW of this section, not a second module: FleetRollup no
  // longer renders under Fleet Command (classic keeps it), so locations
  // exist exactly once on the page in either mode.
  const [view, setView] = useState<'list' | 'map'>('list');
  const locationsRef = useRef<HTMLDivElement>(null);

  // ── Location scope (the mock's "All locations" control) ─────────────
  // Scoping happens by PRE-FILTERING the derivation's inputs, never by
  // filtering its output: the derivation stays pure and every number on the
  // page — pills, inbox, table, map — is then computed over the same subset.
  const [scopeId, setScopeId] = useState<string>('all');
  const scoped = useMemo(() => {
    if (scopeId === 'all') return { fleet, readiness: readiness ?? null, approvals: approvals ?? null };
    return {
      fleet: {
        ...fleet,
        locations: fleet.locations.filter((l) => l.id === scopeId),
        screens: fleet.screens.filter((s) => s.sourceTenant?.id === scopeId),
      },
      readiness: readiness
        ? { ...readiness, schools: readiness.schools.filter((s) => s.tenantId === scopeId) }
        : null,
      approvals: approvals
        ? { ...approvals, byTenant: (approvals.byTenant ?? []).filter((a) => a.tenantId === scopeId) }
        : null,
    };
  }, [fleet, readiness, approvals, scopeId]);

  // ── Header actions (design-mock parity) ─────────────────────────────
  // "Push content" goes to the PUBLISH FLOW (2026-08-31 operator: "push
  // content should take u to a playlist wizard"). It used to arm a
  // fleet-wide reload — a blast-radius action wearing the primary button's
  // costume. The publish flow mints a tracked deployment, which is what the
  // banner above the cards then follows. A fleet-wide reload is still one
  // click away per screen (inbox Resync) and on the Screens page.
  // "Run fleet check" re-probes every read this surface is built from.
  const [checking, setChecking] = useState(false);
  const runFleetCheck = async () => {
    if (!onFleetCheck || checking) return;
    setChecking(true);
    try { await onFleetCheck(); } finally { setChecking(false); }
  };

  // Deployed bundle SHA — same fail-closed fetch the Screens page uses: a
  // null SHA grades content 'unknown' (gray card), never a false accusation.
  const [deployedSha, setDeployedSha] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/build-info', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        if (!cancelled && typeof j?.sha === 'string') setDeployedSha(j.sha);
      } catch { /* fail closed */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const fc = useMemo(
    () =>
      buildFleetCommand({
        screens: scoped.fleet.screens as any,
        deployedSha,
        rollupInput: {
          locations: scoped.fleet.locations,
          rootId: fleet.root?.id ?? null,
          screens: scoped.fleet.screens as any,
          readiness: scoped.readiness,
          approvals: scoped.approvals,
        },
      }),
    [scoped, fleet.root?.id, deployedSha],
  );

  const vertical = normalizeVertical((fleet.root as { vertical?: string | null } | null)?.vertical);
  const nounOne = VERTICAL_LABELS[vertical].singular.toLowerCase();
  const nounMany = VERTICAL_LABELS[vertical].plural.toLowerCase();
  const n = (count: number) => (count === 1 ? nounOne : nounMany);

  const enter = (row: { tenantId: string; slug: string }, path: string) =>
    switchToTenant({ id: row.tenantId, slug: row.slug }, `/${row.slug}/${path}`);

  /**
   * SINGLE-LOCATION MODE (2026-08-31 — operator: "the dashboard for a child
   * location should look the same new look as the top level just be only
   * that locations info"). One location in the payload → the surface keeps
   * its pills, deployment banner, inbox, schedule, pulse and activity, and
   * drops the multi-location chrome: the location filter, and the whole
   * Locations table / Atlas section (a one-row table and a one-pin map say
   * nothing the cards above don't). Everything else derives identically.
   */
  const singleLocation = fleet.locations.length <= 1;

  /** The playlists index — where "Manage" and "+N more" land. */
  const playlistsHref = `/${fleet.root?.slug ?? ''}/playlists`;
  /** This location's screens page — single-location "view all" target. */
  const screensHref = `/${fleet.root?.slug ?? ''}/screens`;
  /**
   * "Push content" opens the CREATE WIZARD, not the index (2026-08-31
   * operator: "clicking push content should take you to play list and launch
   * the wizard"). `?newPlaylist=1` is the param the playlists page already
   * parses on mount to open <PlaylistCreateWizard> — the same handoff the
   * Assets page uses — and it strips itself from the URL once consumed, so a
   * back-navigation doesn't reopen the wizard.
   */
  const newPlaylistHref = `${playlistsHref}?newPlaylist=1`;

  const visible = useMemo(
    () => filterScorecards(fc.locations, q) as LocationRow[],
    [fc.locations, q],
  );

  // ── Atlas pin filter (Network Atlas mock parity) ──────────────────
  // The mock's five chips float over the map. Every one of them is a slice of
  // the SAME LocationRow the table and the pin rings read (matchesAtlasFilter
  // above), so a chip can never select a set the rest of the page grades
  // differently.
  const [atlasFilter, setAtlasFilter] = useState<AtlasFilterKey>('all');
  const needsAttention = useMemo(() => {
    return (s: FleetResponse['screens'][number]) =>
      s.status !== 'ONLINE' ||
      deriveRenderTrustGrade({
        status: s.status,
        renderHealth: s.renderHealth ?? null,
        renderStale: s.renderStale ?? null,
      }) !== 'painting' ||
      isContentBehind(
        {
          status: s.status,
          lastBundleSha: s.lastBundleSha ?? null,
          pendingRefreshAtMs: s.pendingRefreshAtMs ?? null,
          refreshAckMs: s.refreshAckMs ?? null,
        },
        deployedSha,
      );
  }, [deployedSha]);
  /** Screens the map's own predicate says need someone — also the stat card. */
  const attentionCount = useMemo(
    () => scoped.fleet.screens.filter(needsAttention).length,
    [scoped.fleet.screens, needsAttention],
  );

  // ── Selected location (Network Atlas mock parity) ─────────────────
  // A pin click NEVER teleports: it SELECTS. The card names the location,
  // its online count and its worst line, and leaves the trip behind an
  // explicit "Open" button.
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  /** This location's screens, in payload order — the panel's screen strip. */
  const screensByTenant = useMemo(() => {
    const m = new Map<string, FleetResponse['screens']>();
    for (const s of scoped.fleet.screens) {
      const t = s.sourceTenant?.id;
      if (!t) continue;
      const bucket = m.get(t);
      if (bucket) bucket.push(s);
      else m.set(t, [s]);
    }
    return m;
  }, [scoped.fleet.screens]);

  // ── Where each location sits ──────────────────────────────────────
  // Coordinates come from a SCREEN's effective geo first (screen pin > group
  // > tenant address, the chain the fleet map has always used), and fall back
  // to the LOCATION ROW's own latitude/longitude. That fallback is what ended
  // "why do the others not even exist" (2026-08-31): a location with an
  // address but no screens paired yet could never be positioned at all.
  // A location with neither is NOT invented onto the map — it is listed
  // separately with the reason.
  const locationGeo = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number }>();
    for (const s of scoped.fleet.screens) {
      const t = s.sourceTenant?.id;
      if (!t || m.has(t)) continue;
      if (s.effectiveLatitude == null || s.effectiveLongitude == null) continue;
      m.set(t, { lat: s.effectiveLatitude, lng: s.effectiveLongitude });
    }
    for (const l of scoped.fleet.locations) {
      if (m.has(l.id)) continue;
      if (l.latitude == null || l.longitude == null) continue;
      m.set(l.id, { lat: l.latitude, lng: l.longitude });
    }
    return m;
  }, [scoped.fleet.screens, scoped.fleet.locations]);

  /** The location payload row (address / own geo), keyed for quick reads. */
  const locationMeta = useMemo(() => {
    const m = new Map<string, FleetResponse['locations'][number]>();
    for (const l of fleet.locations) m.set(l.id, l);
    return m;
  }, [fleet.locations]);

  // ── Atlas pins — ONE PER LOCATION (2026-08-31 operator: "show the logo
  // and the store name as the icons"). A wall of per-screen wifi dots told
  // the operator nothing about WHERE a problem was; the store pin does.
  //
  // Ring color = locationTone(), the table's own precedence; the ring's
  // SEGMENTS are that location's screen mix, so the pin says how MANY screens
  // are in trouble, not just that some are.
  const allLocationPins = useMemo<LocationPin[]>(() => {
    const pins: LocationPin[] = [];
    for (const row of fc.locations) {
      const at = locationGeo.get(row.tenantId);
      if (!at) continue;
      pins.push({
        id: row.tenantId,
        name: row.name,
        lat: at.lat,
        lng: at.lng,
        tone: locationTone(row),
        segments: donutSegments(row),
        logoUrl: logoUrl ?? null,
        initials: initialsOf(row.name),
        selected: selectedTenantId === row.tenantId,
      });
    }
    return pins;
  }, [locationGeo, fc.locations, logoUrl, selectedTenantId]);

  /** Pins after the chips — filtered on the LocationRow, never re-graded. */
  const locationPins = useMemo(() => {
    if (atlasFilter === 'all') return allLocationPins;
    const keep = new Set(
      fc.locations.filter((row) => matchesAtlasFilter(row, atlasFilter)).map((row) => row.tenantId),
    );
    return allLocationPins.filter((p) => keep.has(p.id));
  }, [allLocationPins, fc.locations, atlasFilter]);
  const mappableCount = locationPins.length;
  /** Pins BEFORE the filter — separates "no addresses" from "no match". */
  const mappableTotal = allLocationPins.length;

  /**
   * Locations the map cannot honestly place, each with the reason and — when
   * the fix is the operator's — where the fix lives. A location WITH an
   * address is not the operator's problem: the server geocodes it on its own
   * within the hour, so that row says so instead of sending them somewhere.
   */
  const unmappedLocations = useMemo(
    () =>
      fc.locations
        .filter((row) => !locationGeo.has(row.tenantId))
        .map((row) => ({
          row,
          hasAddress: !!locationMeta.get(row.tenantId)?.address,
        })),
    [fc.locations, locationGeo, locationMeta],
  );

  const selectedLocation = selectedTenantId
    ? fc.locations.find((l) => l.tenantId === selectedTenantId) ?? null
    : null;
  /** The location's own address, else the first one its screens resolved to. */
  const selectedAddress = useMemo(() => {
    if (!selectedTenantId) return null;
    return (
      locationMeta.get(selectedTenantId)?.address
      ?? fleet.screens.find((s) => s.sourceTenant?.id === selectedTenantId && s.effectiveAddress)
        ?.effectiveAddress
      ?? null
    );
  }, [fleet.screens, locationMeta, selectedTenantId]);

  // ── The grouped exception inbox (the mock's map-side to-do list) ───
  // Grouped from inboxAll, NOT the capped six: a category header that reports
  // "2" has to mean two.
  const inboxGroups = useMemo(() => groupInbox(fc.inboxAll), [fc.inboxAll]);
  /**
   * Row → key, computed ONCE over the flat worst-first list. Grouping
   * preserves object identity, so the grouped render and this lookup agree —
   * and the key can safely use the flat index, which is what makes two
   * otherwise-identical aggregate rows distinguishable.
   */
  const inboxKeyOf = useMemo(() => {
    const m = new Map<ExceptionRow, string>();
    fc.inboxAll.forEach((r, i) => m.set(r, inboxRowKey(r, i)));
    return m;
  }, [fc.inboxAll]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<ExceptionRow['kind']>>(new Set());
  const [showInbox, setShowInbox] = useState(true);
  /** Which inbox row is under the operator's cursor of attention. */
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const selectedRow = useMemo(
    () => fc.inboxAll.find((r) => inboxKeyOf.get(r) === selectedRowKey) ?? null,
    [fc.inboxAll, inboxKeyOf, selectedRowKey],
  );

  /** The screen a device drawer is open on (never a stale id — resolved live). */
  const [deviceScreenId, setDeviceScreenId] = useState<string | null>(null);
  /**
   * The control that opened the drawer, so focus goes back where it came from
   * on close. Captured from the live activeElement rather than a per-button
   * ref: the drawer opens from four different places (inbox rows, the Atlas
   * inbox footer, screen tiles) and a shared ref would restore focus to
   * whichever of them rendered last.
   */
  const deviceTriggerRef = useRef<HTMLElement | null>(null);
  const openDeviceDrawer = (screenId: string) => {
    deviceTriggerRef.current =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    setDeviceScreenId(screenId);
  };
  const closeDeviceDrawer = () => {
    setDeviceScreenId(null);
    // The trigger can have unmounted (a row that just got fixed) — optional
    // chaining means a vanished trigger simply leaves focus on <body>.
    deviceTriggerRef.current?.focus?.();
  };
  const deviceScreen = useMemo<DeviceDrawerScreen | null>(() => {
    if (!deviceScreenId) return null;
    const s = fleet.screens.find((x) => x.id === deviceScreenId);
    if (!s) return null;
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      renderHealth: s.renderHealth ?? null,
      renderStale: s.renderStale ?? null,
      pushChannel: (s as { pushChannel?: 'live' | 'stale' | 'unknown' }).pushChannel ?? null,
      lastPingAt: s.lastPingAt ?? null,
      contentBehind: isContentBehind(
        {
          status: s.status,
          lastBundleSha: s.lastBundleSha ?? null,
          pendingRefreshAtMs: s.pendingRefreshAtMs ?? null,
          refreshAckMs: s.refreshAckMs ?? null,
        },
        deployedSha,
      ),
      pendingRefreshAtMs: s.pendingRefreshAtMs ?? null,
      locationName: s.sourceTenant?.name ?? '',
      locationSlug: s.sourceTenant?.slug ?? fleet.root?.slug ?? '',
      locationTenantId: s.sourceTenant?.id ?? fleet.root?.id ?? '',
      // A screen at a DIFFERENT location than the session's own tenant —
      // its Full-settings link must ride the tenant switch.
      isRemote: (s.sourceTenant?.id ?? fleet.root?.id) !== fleet.root?.id,
      orientation: (s as { orientation?: string | null }).orientation ?? null,
    };
  }, [deviceScreenId, fleet.screens, fleet.root?.slug, fleet.root?.id, deployedSha]);

  /**
   * The one line of REAL timing we can put under a selected exception.
   *
   * The mock prints "Expected: 10:02 AM · Now: 9:44 AM" — an SLA this product
   * does not measure. What we genuinely know is when the update went out and
   * that the screen has not echoed it back, or when an unreachable screen was
   * last heard from. Anything else is silence.
   */
  const selectedTiming = useMemo(() => {
    if (!selectedRow?.screenId) return null;
    const s = fleet.screens.find((x) => x.id === selectedRow.screenId);
    if (!s) return null;
    if (s.status !== 'ONLINE') {
      return s.lastPingAt ? `Last answered ${timeAgo(s.lastPingAt)}` : 'Not answering check-ins';
    }
    if (s.pendingRefreshAtMs != null && s.refreshAckMs !== s.pendingRefreshAtMs) {
      return `Update sent ${timeAgo(s.pendingRefreshAtMs)} · not confirmed yet`;
    }
    return null;
  }, [selectedRow, fleet.screens]);

  // Scoped to the open panel — no listener sitting on window while the map
  // is closed. A device drawer owns Escape while it is up (it closes itself),
  // so the panel must not swallow the same key from under it.
  useEffect(() => {
    if (!selectedLocation || deviceScreenId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedTenantId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedLocation, deviceScreenId]);

  // ── Selecting on the Atlas ────────────────────────────────────────
  // A pin click and an inbox-row click do the SAME thing: select. The map
  // pans to keep the selection in view — at the CURRENT zoom, so an operator
  // who framed their region keeps that frame.
  const [panTarget, setPanTarget] = useState<{ lat: number; lng: number; nonce: number } | null>(null);
  const panNonce = useRef(0);
  const panToLocation = (tenantId: string) => {
    const at = locationGeo.get(tenantId);
    if (!at) return;
    panNonce.current += 1;
    setPanTarget({ lat: at.lat, lng: at.lng, nonce: panNonce.current });
  };
  /** Pin click — select only, never a teleport out of the map. */
  const selectLocation = (tenantId: string) => {
    setSelectedTenantId(tenantId);
    setSelectedRowKey(null);
  };
  const selectInboxRow = (row: ExceptionRow, key: string) => {
    setSelectedRowKey(key);
    setSelectedTenantId(row.tenantId);
    panToLocation(row.tenantId);
  };

  /** A screen tile's badge — the same three graded facts the table prints. */
  const screenTileState = (s: FleetResponse['screens'][number]) => {
    if (s.status !== 'ONLINE') return { label: 'OFFLINE', cls: 'text-rose-600', Icon: MonitorX };
    if (isContentBehind(
      {
        status: s.status,
        lastBundleSha: s.lastBundleSha ?? null,
        pendingRefreshAtMs: s.pendingRefreshAtMs ?? null,
        refreshAckMs: s.refreshAckMs ?? null,
      },
      deployedSha,
    )) return { label: 'BEHIND', cls: 'text-amber-600', Icon: AlertCircle };
    const grade = deriveRenderTrustGrade({
      status: s.status,
      renderHealth: s.renderHealth ?? null,
      renderStale: s.renderStale ?? null,
    });
    if (grade === 'not-painting') return { label: 'NO PICTURE', cls: 'text-rose-600', Icon: MonitorX };
    return { label: 'CURRENT', cls: 'text-emerald-600', Icon: CheckCircle2 };
  };

  /**
   * A tile's thumbnail, or null — NEVER a fake screenshot.
   *
   * The only content preview this page actually holds is the schedule payload
   * the dashboard already computed, and that payload belongs to the ROOT
   * tenant, listing its target screens BY NAME. So a preview is offered only
   * when a live schedule row genuinely names this screen (or covers all of
   * them). Every other tile gets a brand plate: honest about being a label,
   * not a picture of the glass.
   */
  const previewForScreen = (s: FleetResponse['screens'][number]): string | null => {
    if (!fleet.root?.id || s.sourceTenant?.id !== fleet.root.id) return null;
    const hit = scheduleRows.find(
      (r) =>
        r.isActive
        && !!r.previewUrl
        && r.deviceLine.split(' · ').some((part) => part === s.name || part === 'All screens'),
    );
    return hit?.previewUrl ?? null;
  };

  // ── Deployment record ─────────────────────────────────────────────
  // Server order is unspecified, so date the records here — a card that
  // shows an older push as the current one is worse than no card.
  const rows = deployments?.deployments;
  const latestDeployment = useMemo(() => {
    if (!rows?.length) return null;
    return rows.reduce((a, b) => (Date.parse(b.createdAt) > Date.parse(a.createdAt) ? b : a));
  }, [rows]);
  const recentDeployment =
    latestDeployment && isRecentPush(latestDeployment.createdAt) ? latestDeployment : null;
  /** In flight — the banner above the cards names it. */
  const activeDeployment = recentDeployment && !recentDeployment.convergence.done ? recentDeployment : null;
  /**
   * Landed everywhere, and recently enough to still be news. Beyond the
   * window it is history: the strip disappears completely rather than
   * standing there saying "43m ago".
   */
  const settledDeployment =
    recentDeployment
    && recentDeployment.convergence.done
    && Date.now() - Date.parse(recentDeployment.createdAt) < SETTLED_BANNER_MS
      ? recentDeployment
      : null;

  // Newest push PER LOCATION. A push is scoped to exactly one tenant
  // server-side, so this attribution is real, not an org-wide number wearing a
  // per-row costume — a location with no push record shows "—" rather than
  // borrowing another location's timestamp.
  const lastPushByTenant = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of rows ?? []) {
      const at = Date.parse(d.createdAt);
      if (!Number.isFinite(at)) continue; // unparseable → no claim
      const prev = m.get(d.tenantId);
      if (!prev || at > Date.parse(prev)) m.set(d.tenantId, d.createdAt);
    }
    return m;
  }, [rows]);

  // Proof drawer: which deployment the operator is inspecting (never a stale
  // id — it is resolved against the current payload every render).
  const [proofId, setProofId] = useState<string | null>(null);
  const proofDeployment = rows?.find((d) => d.id === proofId) ?? null;
  const proofTriggerRef = useRef<HTMLButtonElement>(null);
  const closeProof = () => {
    setProofId(null);
    proofTriggerRef.current?.focus(); // the trigger never unmounts
  };

  // The deployments payload carries a target COUNT, not target ids, so the
  // only screens we can NAME are the ones still holding this push's value.
  // (A future API rev may add targetIds — then map those instead.)
  const proofScreens: ProofDrawerScreen[] = useMemo(() => {
    if (!proofDeployment) return [];
    return fleet.screens
      .filter((s) => s.pendingRefreshAtMs != null && s.pendingRefreshAtMs === proofDeployment.valueMs)
      .map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        renderHealth: s.renderHealth ?? null,
        renderStale: s.renderStale ?? null,
        pendingRefreshAtMs: s.pendingRefreshAtMs ?? null,
        locationName: s.sourceTenant?.name ?? '',
      }));
  }, [fleet.screens, proofDeployment]);

  const viewDeploymentButton = (deployment: DeploymentRow, label: string) => (
    <button
      ref={proofTriggerRef}
      type="button"
      onClick={() => setProofId(deployment.id)}
      className="inline-flex items-center gap-1.5 text-[12.5px] font-black hover:underline underline-offset-2"
      style={{ color: 'var(--brand-primary, #4f46e5)' }}
    >
      {label} <ArrowRight className="w-3.5 h-3.5" aria-hidden />
    </button>
  );

  // 2026-08-31: refresh-web is fleet-scoped server-side (self + direct
  // children), so a child location's screen is pushable straight from HQ.
  const canPushScreen = (row: ExceptionRow) => !!row.screenId;

  const pills: Array<{ key: string; label: string; Icon: typeof Wifi; pill: typeof fc.assurance.online; hint: string }> = [
    { key: 'content', label: 'Content current', Icon: CheckCircle2, pill: fc.assurance.contentCurrent, hint: 'Screens confirmed on the latest published content. Gray = nothing to compare yet.' },
    { key: 'online', label: 'Devices online', Icon: Wifi, pill: fc.assurance.online, hint: 'Screens answering heartbeats. Online alone does not prove a picture — that is the last card.' },
    { key: 'push', label: 'Push live', Icon: Send, pill: fc.assurance.pushLive, hint: 'Screens with an instant connection. Others still update via ~10s check-ins.' },
    { key: 'emergency', label: 'Emergency ready', Icon: ShieldCheck, pill: fc.assurance.emergencyReady, hint: `${nounMany.charAt(0).toUpperCase() + nounMany.slice(1)} able to display an emergency alert right now — its own check, never inferred from content health.` },
    { key: 'painting', label: 'Showing content', Icon: MonitorCheck, pill: fc.assurance.showingContent, hint: 'Screens with a confirmed picture on the glass.' },
  ];

  /** Today's schedule, as the page grouped it. Absent payload → no rows. */
  const scheduleRows = schedule ?? [];

  /** "View all incidents" — the table, unfiltered, scrolled into view. */
  const showAllIncidents = () => {
    setView('list');
    setQ('');
    setScopeId('all');
    locationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const [pulseBoxRef, pulseRatio] = useFillRatio<HTMLDivElement>();
  const pulsePoints = pulse?.fleet ?? [];
  const hasPulse = pulsePoints.length >= MIN_PULSE_SAMPLES;
  const pulseSpanMs = hasPulse ? pulsePoints[pulsePoints.length - 1].ts - pulsePoints[0].ts : 0;
  const pulseBuilding = hasPulse && pulseSpanMs < PULSE_FULL_SPAN_MS;
  const pulseSpanLabel = pulseSpanMs >= 60 * 60 * 1000
    ? `${Math.round(pulseSpanMs / (60 * 60 * 1000))}h`
    : `${Math.max(1, Math.round(pulseSpanMs / 60_000))}m`;

  // ── The locations table's row menu ("⋯") ──────────────────────────
  const [menuFor, setMenuFor] = useState<string | null>(null);
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuFor(null); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', onKey); };
  }, [menuFor]);

  const inboxCount = fc.inbox.length + fc.inboxOverflow;

  return (
    <section aria-label="Fleet command" className="space-y-4">
      {/* ─── Header band ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-[26px] leading-tight font-black text-slate-900 tracking-tight">Fleet Command</h2>
          <p className="text-[13px] font-semibold text-slate-500 truncate">
            {orgName || fleet.root?.name || 'Fleet'}
            <span className="text-slate-300"> · </span>
            {singleLocation
              ? `${fleet.screens.length} screen${fleet.screens.length === 1 ? '' : 's'}`
              : `${fc.locations.length} ${n(fc.locations.length)}`}
          </p>
        </div>

        {!singleLocation && (
        <div className="relative">
          <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden />
          <select
            value={scopeId}
            onChange={(e) => { setScopeId(e.target.value); setSelectedTenantId(null); }}
            aria-label={`Show one ${nounOne} or all of them`}
            className={`appearance-none pl-9 pr-9 py-2.5 rounded-xl text-[13px] font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-300 ${CARD}`}
          >
            <option value="all">All {nounMany}</option>
            {fleet.locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden />
        </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Link
            href={newPlaylistHref}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold text-white"
            style={{ background: 'var(--brand-primary, #4f46e5)' }}
            title="Pick what to show and publish it to the locations you choose."
          >
            <Upload className="w-4 h-4" aria-hidden />
            Push content
          </Link>
          <button
            type="button"
            onClick={runFleetCheck}
            disabled={checking || !onFleetCheck}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-slate-600 hover:text-slate-800 text-[13px] font-bold disabled:opacity-60 ${CARD}`}
            title="Re-check every signal on this page right now — screens, emergency readiness, approvals, and pushes."
          >
            {checking ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <RefreshCw className="w-4 h-4" aria-hidden />}
            Run fleet check
          </button>
          <button
            type="button"
            onClick={onSwitchClassic}
            className="text-[11px] font-bold text-slate-400 hover:text-slate-600 underline underline-offset-2"
            title="Go back to the previous dashboard layout (you can switch again any time)"
          >
            Classic view
          </button>
        </div>
      </div>

      {/* ─── 1 · Assurance rail — five independent truths ─────────── */}
      <div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {pills.map(({ key, label, Icon, pill, hint }) => (
            <div key={key} className={`${CARD} px-4 py-3 flex items-center gap-3`} title={hint}>
              <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${PILL_ICON_TONE[pill.state]}`}>
                <Icon className="w-5 h-5" aria-hidden />
              </span>
              <span className="min-w-0 flex items-baseline gap-1.5">
                <span className="text-[16px] font-black text-slate-900 shrink-0">
                  {pill.state === 'unknown' ? '—' : `${pill.n}/${pill.total}`}
                </span>
                <span className="text-[13px] font-semibold text-slate-500 truncate">{label}</span>
              </span>
            </div>
          ))}
        </div>
        <p
          className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-slate-400"
          title="A card shows “—” when that check hasn’t answered yet — never a zero it hasn’t earned."
        >
          <Info className="w-3.5 h-3.5 shrink-0" aria-hidden />
          Status separates connectivity, content, delivery and on-glass proof
        </p>
      </div>

      {/* ─── 2 · Deployment strip — ONLY while something is happening ───
          The old standing "Content convergence" card sat there permanently
          restating a number the assurance rail already owns (operator
          2026-08-31: "what is this dashboard card even for"). It is now a
          slim banner that exists only while a push is in flight, plus a
          short emerald beat when one lands — then the row's whole height
          goes back to content. */}
      {(activeDeployment || settledDeployment) && (() => {
        const d = (activeDeployment ?? settledDeployment)!;
        const live = !!activeDeployment;
        const pct = Math.round((d.convergence.converged / Math.max(1, d.targetCount)) * 100);
        return (
          <div
            className="rounded-2xl border px-4 py-3 flex items-center gap-3 flex-wrap"
            style={
              live
                ? {
                    background: 'color-mix(in srgb, var(--brand-primary, #4f46e5) 7%, white)',
                    borderColor: 'color-mix(in srgb, var(--brand-primary, #4f46e5) 24%, white)',
                  }
                : { background: '#ecfdf5', borderColor: '#a7f3d0' }
            }
            role="status"
            aria-label="Content push"
          >
            <span
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white"
              style={{ background: live ? 'var(--brand-primary, #4f46e5)' : '#10b981' }}
            >
              {live ? <Upload className="w-4 h-4" aria-hidden /> : <CheckCircle2 className="w-4 h-4" aria-hidden />}
            </span>
            <p className="text-[13.5px] font-bold text-slate-800 min-w-0 truncate" title={d.label}>
              {d.label}
              <span className="text-slate-300"> — </span>
              {live ? (
                <span className="text-slate-600 font-semibold">
                  {d.convergence.converged} of {d.targetCount} screen{d.targetCount === 1 ? '' : 's'} confirmed
                </span>
              ) : (
                <span className="text-emerald-700 font-semibold">
                  confirmed everywhere · {d.targetCount} screen{d.targetCount === 1 ? '' : 's'}
                </span>
              )}
            </p>
            {live && (
              <span className="h-1.5 w-32 rounded-full bg-white/80 overflow-hidden shrink-0" aria-hidden>
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${pct}%`, background: 'var(--brand-primary, #4f46e5)' }}
                />
              </span>
            )}
            <span className="ml-auto shrink-0">{viewDeploymentButton(d, 'View screens')}</span>
          </div>
        );
      })()}

      {/* ─── 3 · Needs attention · Today's Schedule · Fleet pulse ───
          Pulse takes the NARROWEST column so Today's Schedule gains the room
          its device lines need (2026-08-31 operator ask). */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1.05fr)_minmax(0,0.85fr)]">
        {/* Needs attention */}
        <div className={`${CARD} flex flex-col`}>
          <div className="px-5 pt-4 pb-3 flex items-center gap-2.5">
            <h3 className="text-[17px] font-black text-slate-900">Needs attention</h3>
            {inboxCount > 0 && (
              <span className="min-w-[24px] h-6 px-2 rounded-full bg-slate-100 text-slate-500 text-[12px] font-black flex items-center justify-center">
                {inboxCount}
              </span>
            )}
          </div>

          {fc.inbox.length === 0 ? (
            <div className="px-5 pb-5 border-t border-slate-100 pt-4 flex items-center gap-2.5">
              {fc.allClear ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden />
                  <p className="text-[13.5px] font-bold text-emerald-800">
                    {singleLocation
                      ? 'All screens healthy — nothing needs you right now.'
                      : `All ${fc.locations.length} ${n(fc.locations.length)} healthy — nothing needs you right now.`}
                  </p>
                </>
              ) : (
                <>
                  <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" aria-hidden />
                  <p className="text-[13.5px] font-semibold text-slate-500">
                    Nothing urgent so far — still waiting on{' '}
                    {[!fc.coverage.readiness && 'the emergency check', !fc.coverage.approvals && 'the review queue']
                      .filter(Boolean)
                      .join(' and ')}.
                  </p>
                </>
              )}
            </div>
          ) : (
            <ul className="border-t border-slate-100">
              {fc.inbox.map((row, i) => {
                const Icon = INBOX_ICON[row.kind];
                const verb = INBOX_VERB[row.kind];
                return (
                  <li key={`${row.kind}:${row.screenId ?? row.tenantId}:${i}`} className="border-b border-slate-100 last:border-b-0">
                    {/* The action button is a SIBLING of the navigate button,
                        never nested — a button inside a button is invalid and
                        swallows the inner click in some engines. */}
                    <div className="flex items-center gap-2 pr-4 hover:bg-slate-50/70">
                      <button
                        type="button"
                        onClick={() => enter(row, row.path)}
                        disabled={!!switchingId}
                        className="flex-1 min-w-0 pl-5 pr-1 py-3 flex items-center gap-3 text-left disabled:opacity-60 disabled:cursor-wait"
                      >
                        <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${INBOX_TONE[row.kind]}`}>
                          <Icon className="w-4 h-4" aria-hidden />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13.5px] font-bold text-slate-900 truncate">
                            {row.headline}
                            {row.age && (
                              <span className={`ml-2 ${INBOX_AGE_TONE[row.kind]}`}>{row.age}</span>
                            )}
                          </span>
                          <span className="block text-[12px] font-medium text-slate-500 truncate">
                            {row.tenantName}
                            <span className="text-slate-300"> · </span>
                            {row.detail}
                          </span>
                        </span>
                        {switchingId === row.tenantId && (
                          <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" aria-hidden />
                        )}
                      </button>
                      {verb !== 'open' && canPushScreen(row) ? (
                        <RowPushButton screenId={row.screenId!} verb={verb} />
                      ) : row.screenId ? (
                        // "Open" on a SCREEN row opens the device drawer right
                        // here (2026-08-31 operator ask) — the operator works
                        // the whole list without ever leaving the dashboard.
                        <button
                          type="button"
                          onClick={() => openDeviceDrawer(row.screenId!)}
                          className="shrink-0 text-[12px] font-bold px-3.5 py-1.5 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50"
                          title={`Open ${row.screenName ?? 'this screen'} without leaving the dashboard.`}
                        >
                          Open
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => enter(row, row.path)}
                          disabled={!!switchingId}
                          className="shrink-0 text-[12px] font-bold px-3.5 py-1.5 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 disabled:opacity-70"
                          title={`Go to ${row.tenantName} to look at this.`}
                        >
                          Open
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="px-5 py-3 border-t border-slate-100 mt-auto">
            {singleLocation ? (
              // Single-location mode has no locations table to scroll to —
              // "all incidents" for one location IS its screens page.
              <Link
                href={screensHref}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-black hover:underline underline-offset-2"
                style={{ color: 'var(--brand-primary, #4f46e5)' }}
              >
                View all screens <ArrowRight className="w-3.5 h-3.5" aria-hidden />
              </Link>
            ) : (
              <button
                type="button"
                onClick={showAllIncidents}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-black hover:underline underline-offset-2"
                style={{ color: 'var(--brand-primary, #4f46e5)' }}
              >
                View all incidents <ArrowRight className="w-3.5 h-3.5" aria-hidden />
              </button>
            )}
          </div>
        </div>

        {/* Today's Schedule — moved up into the slot the standing
            convergence card used to occupy (2026-08-31 operator ask), which
            is what frees the whole bottom of the page. Same compact grouped
            rows the lower section used to render. */}
        <div className={`${CARD} flex flex-col`} role="group" aria-label="Today’s Schedule">
          <div className="px-5 pt-4 pb-3 flex items-center gap-2 flex-wrap">
            <Calendar className="w-4 h-4 shrink-0" style={{ color: 'var(--brand-primary, #4f46e5)' }} aria-hidden />
            <h3 className="text-[17px] font-black text-slate-900">Today&rsquo;s Schedule</h3>
            {scheduleTotals && scheduleTotals.total > 0 && (
              <span className="text-[12px] font-semibold text-slate-400">
                {scheduleTotals.playing} playing &middot; {scheduleTotals.total} total
              </span>
            )}
            <Link
              href={playlistsHref}
              className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-black hover:underline underline-offset-2"
              style={{ color: 'var(--brand-primary, #4f46e5)' }}
            >
              Manage <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </Link>
          </div>
          {scheduleRows.length === 0 ? (
            <div className="px-5 pb-5 border-t border-slate-100 pt-4">
              <p className="text-[13px] font-semibold text-slate-400">Nothing scheduled for today.</p>
              <Link
                href={newPlaylistHref}
                className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-black hover:underline underline-offset-2"
                style={{ color: 'var(--brand-primary, #4f46e5)' }}
              >
                Create a schedule <ArrowRight className="w-3.5 h-3.5" aria-hidden />
              </Link>
            </div>
          ) : (
            <ul className="border-t border-slate-100">
              {scheduleRows.slice(0, SCHEDULE_ROWS).map((row) => (
                <li key={row.key} className="border-b border-slate-100 last:border-b-0 px-5 py-2 flex items-center gap-2.5">
                  <span className={`w-1 h-9 rounded-full shrink-0 ${row.isActive ? 'bg-emerald-500' : 'bg-slate-200'}`} aria-hidden />
                  {/* Square-cornered like a real panel, shaped to the target
                      screens’ orientation. A video/template playlist gets a
                      quiet icon tile — never a fake frame. */}
                  {row.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.previewUrl}
                      alt=""
                      loading="lazy"
                      className={`${row.portrait ? 'w-7 h-11' : 'w-[54px] h-8'} object-cover border border-slate-300 shrink-0`}
                    />
                  ) : (
                    <span className={`${row.portrait ? 'w-7 h-11' : 'w-[54px] h-8'} bg-slate-100 border border-slate-300 flex items-center justify-center shrink-0`}>
                      <ListVideo className="w-3.5 h-3.5 text-slate-400" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-bold text-slate-900 truncate">{row.name}</span>
                    <span className="block text-[11px] font-semibold text-slate-400 truncate" title={row.deviceLine}>
                      {row.timeStart || 'All day'}{row.timeEnd ? `–${row.timeEnd}` : ''}
                      <span className="text-slate-300"> &middot; </span>
                      {row.deviceCount > 1 ? `${row.deviceCount} screens · ` : ''}{row.deviceLine}
                    </span>
                  </span>
                  {row.isActive && (
                    <span className="shrink-0 text-[9.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                      Live
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {scheduleRows.length > SCHEDULE_ROWS && (
            <div className="px-5 py-2.5 border-t border-slate-100 mt-auto">
              <Link
                href={playlistsHref}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-black hover:underline underline-offset-2"
                style={{ color: 'var(--brand-primary, #4f46e5)' }}
              >
                +{scheduleRows.length - SCHEDULE_ROWS} more <ArrowRight className="w-3.5 h-3.5" aria-hidden />
              </Link>
            </div>
          )}
        </div>

        {/* Fleet pulse — NARROWER, not shorter (2026-08-31 operator: "u could
            make it narrower but shorter, keep it the same height as the other
            cards"). Its grid column is the smallest of the three, and the card
            fills the row height like its siblings — no `self-start` stub with
            dead space under it. The chart then GROWS into the card via
            useFillRatio instead of floating in whitespace. */}
        <div className={`${CARD} flex flex-col`}>
          <div className="px-4 pt-3 pb-1 flex items-center gap-2 flex-wrap">
            <h3 className="text-[14px] font-black text-slate-900">Fleet pulse</h3>
            <span className="text-[11.5px] font-semibold text-slate-400">
              {pulseBuilding ? `· building history — ${pulseSpanLabel} so far` : '· last 24h'}
            </span>
            {hasPulse && (
              <span className="ml-auto flex items-center gap-2">
                {[
                  { label: 'Online', color: '#10b981' },
                  { label: 'Degraded', color: '#f59e0b' },
                  { label: 'Offline', color: '#f43f5e' },
                ].map(({ label, color }) => (
                  <span key={label} className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-500">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} aria-hidden />
                    {label}
                  </span>
                ))}
              </span>
            )}
          </div>
          {/* min-h-0 + overflow-hidden: the measured box takes its height FROM
              the row and can never be pushed taller by the SVG it sizes. */}
          <div ref={pulseBoxRef} className="px-3 pb-3 flex-1 min-h-0 overflow-hidden flex items-center">
            {hasPulse ? (
              <FleetPulseChart points={pulsePoints} fillRatio={pulseRatio} />
            ) : (
              <p className="px-1 pb-2 text-[12px] font-semibold text-slate-400">
                Building your first 24 hours of history — first samples land within the hour.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ─── 4 · Locations · Recent activity ────────────────────────
          In MAP mode the Atlas is the hero: it takes the full content width
          and Recent activity steps out of the row entirely (the mock gives
          the map the whole page, and a 380px column beside it is what made
          the last build read as "a small map in a card"). The white card
          chrome drops away too — the map IS the surface, and the panels float
          on it. */}
      <div className={`grid gap-4 ${view === 'map' || singleLocation ? '' : 'lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)]'}`}>
        {/* Single-location mode: no locations module at all — a one-row
            table (or a one-pin map) restates what the pills already say. */}
        {!singleLocation && (
        <div ref={locationsRef} className={view === 'map' ? 'flex flex-col' : `${CARD} flex flex-col`}>
          <div className={`flex items-center gap-3 flex-wrap ${view === 'map' ? 'pb-3' : 'px-5 pt-4 pb-3'}`}>
            {view === 'map' ? (
              <div className="min-w-0">
                <h3 className="text-[19px] font-black text-slate-900 leading-tight">Network Atlas</h3>
                <p className="text-[12.5px] font-semibold text-slate-500 truncate">
                  {orgName || fleet.root?.name || 'Fleet'}
                  <span className="text-slate-300"> · </span>
                  {mappableTotal} of {fc.locations.length} {n(fc.locations.length)} on the map
                </p>
              </div>
            ) : (
              <h3 className="text-[17px] font-black text-slate-900 capitalize">{nounMany}</h3>
            )}
            <div className="ml-auto flex items-center gap-2">
              {view === 'list' && fc.locations.length > 8 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-300 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={`Filter ${nounMany}…`}
                    aria-label={`Filter ${nounMany} by name`}
                    className="pl-8 pr-7 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold w-40 focus:ring-2 focus:ring-indigo-300 outline-none"
                  />
                  {q && (
                    <button type="button" onClick={() => setQ('')} aria-label="Clear filter" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                      <X className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              )}
              <div className="flex bg-slate-100 rounded-lg p-0.5" role="tablist" aria-label="Locations view">
                {(['list', 'map'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                    className={`px-3 py-1 rounded-md text-[11.5px] font-bold capitalize ${
                      view === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {view === 'map' ? (
            <div className="space-y-3">
              {/* Atlas stat cards — the mock's four counts above the map. */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="group" aria-label="Fleet totals">
                {[
                  // Sentence case, always — `capitalize` would title-case the
                  // two-word labels ("Content Current") and stop matching the mock.
                  { key: 'loc', label: nounMany.charAt(0).toUpperCase() + nounMany.slice(1), value: fc.locations.length, Icon: MapPin, bg: 'var(--brand-primary, #4f46e5)' },
                  { key: 'scr', label: 'Screens', value: scoped.fleet.screens.length, Icon: MonitorPlay, bg: '#2563eb' },
                  { key: 'cur', label: 'Content current', value: fc.assurance.contentCurrent.state === 'unknown' ? '—' : fc.assurance.contentCurrent.n, Icon: CheckCircle2, bg: '#10b981' },
                  { key: 'att', label: 'Need attention', value: attentionCount, Icon: AlertTriangle, bg: '#f97316' },
                ].map(({ key, label, value, Icon, bg }) => (
                  <div key={key} className={`${CARD} px-4 py-3 flex items-center gap-3`}>
                    <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white" style={{ background: bg }}>
                      <Icon className="w-5 h-5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[22px] font-black text-slate-900 leading-tight">{value}</span>
                      <span className="block text-[12px] font-semibold text-slate-500 truncate">{label}</span>
                    </span>
                  </div>
                ))}
              </div>

              {/* ── THE MAP IS THE PAGE ─────────────────────────────────
                  Every panel the mock shows FLOATS on the map — nothing
                  stacks underneath it, and nothing sits beside it. That is
                  the whole difference between "a map feature" and an atlas.
                  Panels sit above Leaflet's panes (z-[1000] > .leaflet-pane's
                  400) and the map keeps panning behind them. */}
              <div className="relative rounded-2xl border border-slate-200 overflow-hidden bg-slate-100">
                {mappableTotal === 0 ? (
                  <div className="h-[60vh] min-h-[380px] flex flex-col items-center justify-center text-center px-6">
                    <MapPin className="w-8 h-8 text-slate-300" aria-hidden />
                    <p className="mt-3 text-sm font-bold text-slate-600">No addresses on the map yet.</p>
                    <p className="text-[12.5px] text-slate-400 mt-1 max-w-md">
                      Add an address to a {nounOne}, a screen group, or a screen — that {nounOne} then
                      gets its own pin here, with its logo and its screen health.
                    </p>
                  </div>
                ) : (
                  <ScreenMapClient
                    screens={[]}
                    renderSidebar={false}
                    locationPins={locationPins}
                    onLocationClick={selectLocation}
                    panTo={panTarget}
                    // The mock gives the map most of the page. min-h keeps it
                    // usable on a short laptop; max-h stops a 4K monitor
                    // turning it into a mile of tiles.
                    heightClass="h-[72vh] min-h-[520px] max-h-[900px]"
                    fitPadBottomRight={[400, 130]}
                  />
                )}

                {/* ── Filter chips, floating top-right (mock parity) ──── */}
                {mappableTotal > 0 && (
                  <div
                    className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 flex-wrap justify-end max-w-[calc(100%-1.5rem)]"
                    role="radiogroup"
                    aria-label="Filter locations on the map"
                  >
                    {ATLAS_FILTERS.map(({ key, label, dot, Icon }) => {
                      const on = atlasFilter === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setAtlasFilter(key)}
                          className="inline-flex items-center gap-1.5 rounded-full pl-3 pr-3.5 py-1.5 text-[11.5px] font-bold bg-white shadow-[0_2px_10px_rgba(15,23,42,0.12)] border"
                          style={
                            on
                              ? {
                                  borderColor: 'var(--brand-primary, #4f46e5)',
                                  color: 'var(--brand-primary, #4f46e5)',
                                  boxShadow: '0 2px 10px rgba(15,23,42,0.12), 0 0 0 1px var(--brand-primary, #4f46e5) inset',
                                }
                              : { borderColor: '#e2e8f0', color: '#334155' }
                          }
                        >
                          {Icon
                            ? <Icon className="w-3.5 h-3.5 shrink-0 text-rose-500" aria-hidden />
                            : dot
                              ? <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} aria-hidden />
                              : null}
                          {label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setShowInbox((v) => !v)}
                      aria-pressed={showInbox}
                      title={showInbox ? 'Hide the exception inbox' : 'Show the exception inbox'}
                      aria-label={showInbox ? 'Hide the exception inbox' : 'Show the exception inbox'}
                      className="w-9 h-9 rounded-full bg-white border border-slate-200 shadow-[0_2px_10px_rgba(15,23,42,0.12)] flex items-center justify-center"
                      style={{ color: showInbox ? 'var(--brand-primary, #4f46e5)' : '#64748b' }}
                    >
                      <SlidersHorizontal className="w-4 h-4" aria-hidden />
                    </button>
                  </div>
                )}

                {/* No pins matched the chip. The map stays put and stays
                    pannable — replacing it with a paragraph would take the
                    chips away with it. */}
                {mappableTotal > 0 && mappableCount === 0 && (
                  <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1000] bg-white rounded-full px-4 py-2 shadow-[0_4px_16px_rgba(15,23,42,0.16)] border border-slate-200">
                    <p className="text-[12px] font-bold text-slate-600">
                      No {nounMany} match this filter.
                    </p>
                  </div>
                )}

                {/* ── Exception inbox, floating top-left (mock parity) ──
                    Grouped by category with real counts, each section
                    collapsible. A row SELECTS — it never teleports the
                    operator out of the map they are reading. */}
                {mappableTotal > 0 && showInbox && inboxGroups.length > 0 && (
                  <div
                    // The height cap RESERVES the bottom-left corner when the
                    // "Not on the map yet" card is there. Without it a tall
                    // inbox grows straight down over that card and its own
                    // action footer ends up underneath it — verification
                    // caught exactly that: "Open screen" was on screen and
                    // un-clickable.
                    className={`absolute top-3 left-3 z-[1000] w-[304px] max-w-[calc(100%-1.5rem)] ${
                      unmappedLocations.length > 0 ? 'max-h-[calc(100%-14rem)]' : 'max-h-[calc(100%-1.5rem)]'
                    } bg-white rounded-2xl border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.14)] overflow-hidden flex flex-col`}
                    role="group"
                    aria-label="Exception inbox"
                  >
                    <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 shrink-0">
                      <Inbox className="w-4 h-4 shrink-0" style={{ color: 'var(--brand-primary, #4f46e5)' }} aria-hidden />
                      <h4 className="text-[12.5px] font-black text-slate-800">Exception inbox</h4>
                      <span className="ml-auto text-[11px] font-black text-slate-400">{fc.inboxAll.length}</span>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto">
                      {inboxGroups.map((g) => {
                        const open = !collapsedGroups.has(g.kind);
                        const Chevron = open ? ChevronUp : ChevronDown;
                        return (
                          <div key={g.kind}>
                            <button
                              type="button"
                              onClick={() => setCollapsedGroups((prev) => {
                                const next = new Set(prev);
                                if (next.has(g.kind)) next.delete(g.kind);
                                else next.add(g.kind);
                                return next;
                              })}
                              aria-expanded={open}
                              className="w-full px-4 py-2 flex items-center gap-2 text-left border-b border-slate-100 hover:bg-slate-50"
                            >
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: GROUP_DOT[g.tone] }} aria-hidden />
                              <span className="text-[12px] font-black text-slate-800 flex-1 min-w-0 truncate">{g.label}</span>
                              <span className="text-[11px] font-black text-slate-400 shrink-0">{g.count}</span>
                              <Chevron className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden />
                            </button>
                            {open && g.rows.map((row) => {
                              const key = inboxKeyOf.get(row)!;
                              const on = selectedRowKey === key;
                              const lines = atlasRowLines(row);
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => selectInboxRow(row, key)}
                                  aria-pressed={on}
                                  className={`relative w-full pl-4 pr-3 py-2 flex items-center gap-2 text-left border-b border-slate-100 ${on ? '' : 'hover:bg-slate-50'}`}
                                  style={on ? { background: 'color-mix(in srgb, var(--brand-primary, #4f46e5) 9%, white)' } : undefined}
                                >
                                  {/* Three sides + a width — never all four (a
                                      four-side inline object serializes to the
                                      `inset` shorthand). */}
                                  {on && (
                                    <span
                                      className="absolute top-0 bottom-0 left-0 w-[3px]"
                                      style={{ background: 'var(--brand-primary, #4f46e5)' }}
                                      aria-hidden
                                    />
                                  )}
                                  <span className="flex-1 min-w-0">
                                    <span className="block text-[12.5px] font-bold text-slate-900 truncate">{lines.title}</span>
                                    <span className="block text-[11px] font-semibold text-slate-500 truncate">{lines.sub}</span>
                                  </span>
                                  {lines.age && (
                                    <span className={`shrink-0 text-[11px] font-black ${INBOX_AGE_TONE[row.kind]}`}>{lines.age}</span>
                                  )}
                                </button>
                              );
                            })}
                            {open && g.hidden > 0 && (
                              <p className="px-4 py-1.5 text-[10.5px] font-bold text-slate-400 border-b border-slate-100">
                                +{g.hidden} more
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Detail footer — what is selected, what we actually
                        know about its timing, and the two things to do. */}
                    {selectedRow && (() => {
                      const lines = atlasRowLines(selectedRow);
                      const pushable = !!selectedRow.screenId
                        && (selectedRow.kind === 'content-behind' || selectedRow.kind === 'push-stale' || selectedRow.kind === 'not-painting');
                      return (
                        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/80 shrink-0">
                          <p className="text-[12.5px] font-black text-slate-900 truncate">
                            {selectedRow.screenName ?? lines.title}
                            {lines.age && (
                              <span className={`ml-2 ${INBOX_AGE_TONE[selectedRow.kind]}`}>{lines.age}</span>
                            )}
                          </p>
                          <p className="text-[11px] font-semibold text-slate-500 mt-0.5 line-clamp-2">
                            {selectedTiming ?? selectedRow.detail}
                          </p>
                          <div className="mt-2.5 flex items-center gap-2">
                            {pushable && (
                              <InboxResyncButton screenId={selectedRow.screenId!} />
                            )}
                            {selectedRow.screenId ? (
                              <button
                                type="button"
                                onClick={() => openDeviceDrawer(selectedRow.screenId!)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[11.5px] font-bold text-slate-600 hover:bg-slate-50"
                              >
                                <MonitorPlay className="w-3.5 h-3.5" aria-hidden />
                                Open screen
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => enter(selectedRow, selectedRow.path)}
                                disabled={!!switchingId}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[11.5px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                              >
                                Open {nounOne}
                                <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* ── Selected location, floating top-right (mock parity) ── */}
                {selectedLocation && (() => {
                  const tone = locationTone(selectedLocation);
                  const panel = buildLocationPanel(selectedLocation, tone);
                  const ringColor = TONE_HEX[tone];
                  const city = parseCityState(selectedAddress);
                  const lastPush = lastPushByTenant.get(selectedLocation.tenantId);
                  const mine = screensByTenant.get(selectedLocation.tenantId) ?? [];
                  return (
                    <div
                      className="absolute top-[60px] right-3 z-[1000] w-[372px] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-4.75rem)] bg-white rounded-2xl border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.16)] overflow-hidden flex flex-col"
                      role="group"
                      aria-label={`${selectedLocation.name} details`}
                    >
                      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 shrink-0">
                        <Building2 className="w-4 h-4 shrink-0" style={{ color: 'var(--brand-primary, #4f46e5)' }} aria-hidden />
                        <h4 className="text-[12.5px] font-black text-slate-800">Selected location</h4>
                        <button
                          type="button"
                          onClick={() => setSelectedTenantId(null)}
                          aria-label="Close"
                          className="ml-auto w-7 h-7 -mr-1 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus:ring-2 focus:ring-indigo-300 outline-none shrink-0"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden />
                        </button>
                      </div>

                      <div className="flex-1 min-h-0 overflow-y-auto">
                        {/* Identity — the same logo disc + status ring the pin
                            draws, so the panel and the pin are the same object. */}
                        <div className="px-4 pt-3.5 pb-3 flex items-center gap-3">
                          <span
                            className="w-14 h-14 rounded-full bg-white flex items-center justify-center shrink-0 overflow-hidden"
                            style={{ border: `3px solid ${ringColor}` }}
                            aria-hidden
                          >
                            {logoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={logoUrl} alt="" className="w-10 h-10 object-contain rounded-full" />
                            ) : (
                              <span className="text-[15px] font-black" style={{ color: 'var(--brand-primary, #4f46e5)' }}>
                                {initialsOf(selectedLocation.name)}
                              </span>
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[19px] leading-tight font-black text-slate-900 truncate" title={selectedLocation.name}>
                              {selectedLocation.name}
                            </span>
                            {city && <span className="block text-[12.5px] font-semibold text-slate-400 truncate">{city}</span>}
                            <span className="mt-0.5 inline-flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ background: ringColor }} aria-hidden />
                              <span className="text-[12.5px] font-bold" style={{ color: ringColor }}>{panel.statusLabel}</span>
                            </span>
                          </span>
                        </div>

                        <dl className="px-4 pb-3 border-t border-slate-100 pt-2.5 space-y-2">
                          <PanelStat Icon={MonitorPlay} label="Screens">
                            {panel.screensTotal === 0 ? '—' : (
                              <>
                                <span className="text-emerald-600">{panel.screensCurrent} current</span>
                                {panel.screensBehind > 0 && (
                                  <>
                                    <span className="text-slate-300"> · </span>
                                    <span className="text-amber-600">{panel.screensBehind} behind</span>
                                  </>
                                )}
                                {panel.screensOffline > 0 && (
                                  <>
                                    <span className="text-slate-300"> · </span>
                                    <span className="text-rose-600">{panel.screensOffline} offline</span>
                                  </>
                                )}
                              </>
                            )}
                          </PanelStat>
                          <PanelStat Icon={CreditCard} label="Last content change">
                            {lastPush ? (
                              <>
                                {clockTime(lastPush)}
                                <span className="text-slate-300"> · </span>
                                <span className="font-semibold text-slate-400">{timeAgo(lastPush)}</span>
                              </>
                            ) : <span className="text-slate-300">—</span>}
                          </PanelStat>
                          {/* The mock's row here is "Push latency (p95)". We do
                              not measure latency, so this row reports the truth
                              we DO hold: which delivery path the screens are on. */}
                          <PanelStat Icon={Send} label="Push">
                            {panel.push === 'live' ? <span className="text-emerald-600">Live</span>
                              : panel.push === 'slow' ? <span className="text-amber-600">Slow updates</span>
                                : <span className="text-slate-300">—</span>}
                          </PanelStat>
                          <PanelStat
                            Icon={ShieldCheck}
                            label="Emergency cache"
                            sub={panel.screensTotal > 0 ? `${panel.emergencyCached} of ${panel.screensTotal} screens` : undefined}
                          >
                            {panel.readiness === 'READY' ? <span className="text-emerald-600">Ready</span>
                              : panel.readiness === 'NEEDS_ATTENTION' ? <span className="text-amber-600">Gaps</span>
                                : panel.readiness === 'NOT_CONFIGURED' ? <span className="text-rose-600">Not set up</span>
                                  : <span className="text-slate-300">—</span>}
                          </PanelStat>
                        </dl>

                        {/* Screens strip — the mock's tile row. */}
                        {mine.length > 0 && (
                          <div className="border-t border-slate-100">
                            <div className="px-4 pt-2.5 pb-1.5 flex items-center gap-2">
                              <h5 className="text-[12px] font-black text-slate-800">Screens</h5>
                              <button
                                type="button"
                                onClick={() => enter(selectedLocation, 'screens')}
                                disabled={!!switchingId}
                                className="ml-auto text-[11.5px] font-black hover:underline underline-offset-2 disabled:opacity-60"
                                style={{ color: 'var(--brand-primary, #4f46e5)' }}
                              >
                                View all ({mine.length})
                              </button>
                            </div>
                            <div className="px-4 pb-3 grid grid-cols-3 gap-2">
                              {mine.slice(0, ATLAS_SCREEN_TILES).map((s) => {
                                const st = screenTileState(s);
                                const preview = previewForScreen(s);
                                return (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => openDeviceDrawer(s.id)}
                                    title={`${s.name} — open this screen`}
                                    className="text-left min-w-0"
                                  >
                                    <span className="block aspect-video rounded-lg overflow-hidden border border-slate-200 relative bg-slate-100">
                                      {preview ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={preview} alt="" loading="lazy" className="w-full h-full object-cover" />
                                      ) : (
                                        // NEVER a fake screenshot: a brand-tinted
                                        // plate says "this is the screen", not
                                        // "this is what is on it".
                                        <span
                                          className="w-full h-full flex items-center justify-center px-1.5 text-center"
                                          style={{ background: 'color-mix(in srgb, var(--brand-primary, #4f46e5) 10%, white)' }}
                                        >
                                          <span className="text-[9.5px] font-black leading-tight line-clamp-2" style={{ color: 'var(--brand-primary, #4f46e5)' }}>
                                            {s.name}
                                          </span>
                                        </span>
                                      )}
                                    </span>
                                    <span className="mt-1 flex items-center gap-1 min-w-0">
                                      <st.Icon className={`w-3 h-3 shrink-0 ${st.cls}`} aria-hidden />
                                      <span className="text-[10.5px] font-black text-slate-800 truncate">{s.name}</span>
                                    </span>
                                    <span className={`block text-[9px] font-black uppercase tracking-wider ${st.cls}`}>{st.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="px-4 py-3 border-t border-slate-100 shrink-0">
                        <button
                          type="button"
                          onClick={() => enter(selectedLocation, worstPath(selectedLocation))}
                          disabled={!!switchingId}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12.5px] font-bold text-white disabled:opacity-60 disabled:cursor-wait"
                          style={{ background: 'var(--brand-primary, #4f46e5)' }}
                        >
                          {switchingId === selectedLocation.tenantId && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                          )}
                          Open {nounOne} →
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Not on the map yet, floating bottom-left ────────── */}
                {mappableTotal > 0 && unmappedLocations.length > 0 && (
                  <div
                    className="absolute bottom-3 left-3 z-[1000] w-[288px] max-w-[calc(100%-1.5rem)] bg-white rounded-2xl border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.14)] px-4 py-3"
                    role="group"
                    aria-label="Locations not on the map yet"
                  >
                    <h4 className="text-[12px] font-black text-slate-800">
                      Not on the map yet
                      <span className="ml-1.5 font-black text-slate-400">{unmappedLocations.length}</span>
                    </h4>
                    <ul className="mt-1.5 space-y-1.5 max-h-32 overflow-y-auto">
                      {unmappedLocations.map(({ row, hasAddress }) => (
                        <li key={row.tenantId} className="min-w-0">
                          <span className="block text-[12px] font-bold text-slate-800 truncate">{row.name}</span>
                          {hasAddress ? (
                            // The server geocodes an address-only location on
                            // its own (hourly). Sending the operator to "fix"
                            // something that is already being fixed is worse
                            // than telling them to wait.
                            <span className="block text-[11px] font-semibold text-slate-400">
                              Locating… we&rsquo;re placing this address now
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => enter(row, 'settings')}
                              disabled={!!switchingId}
                              className="text-[11px] font-black hover:underline underline-offset-2 disabled:opacity-60"
                              style={{ color: 'var(--brand-primary, #4f46e5)' }}
                            >
                              Add an address →
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* ── "Online ≠ current", floating bottom-right ─────────
                    The mock's teaching strip: it names the four separate
                    truths so nobody reads a green ring as proof of a picture. */}
                {mappableTotal > 0 && (
                  <div
                    className="absolute bottom-3 right-3 z-[1000] max-w-[calc(100%-1.5rem)] bg-white rounded-2xl border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.14)] px-4 py-3"
                    role="group"
                    aria-label="Online ≠ current"
                  >
                    <h4 className="text-[12px] font-black text-slate-800">Online ≠ current</h4>
                    <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-x-5 gap-y-2">
                      {[
                        { label: 'Device online', Icon: Wifi, cls: 'text-emerald-500' },
                        { label: 'Content current', Icon: CheckCircle2, cls: 'text-emerald-500' },
                        { label: 'Push live', Icon: Radio, cls: 'text-indigo-500' },
                        // "Picture proof", never "painting" — that is our wire
                        // vocabulary, not the operator's (2026-08-31 feedback).
                        { label: 'Picture proof', Icon: MonitorCheck, cls: 'text-indigo-500' },
                      ].map(({ label, Icon, cls }) => (
                        <span key={label} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600">
                          <Icon className={`w-4 h-4 shrink-0 ${cls}`} aria-hidden />
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="px-5 overflow-x-auto">
                <table className="w-full text-left" style={{ minWidth: 820 }}>
                  <thead>
                    <tr className="text-[11.5px] font-semibold text-slate-500 border-y border-slate-100">
                      <th className="px-2 py-2.5 font-semibold">Location</th>
                      <th className="px-2 py-2.5 font-semibold">Screens</th>
                      <th className="px-2 py-2.5 font-semibold">Content</th>
                      <th className="px-2 py-2.5 font-semibold"><span className="sr-only">Trend</span></th>
                      <th className="px-2 py-2.5 font-semibold">Push</th>
                      <th className="px-2 py-2.5 font-semibold" title={CACHE_HINT}>Cache</th>
                      <th className="px-2 py-2.5 font-semibold">Emergency</th>
                      <th className="px-2 py-2.5 font-semibold">Last change</th>
                      <th className="px-2 py-2.5" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 && (
                      <tr><td colSpan={9} className="px-2 py-4 text-sm font-semibold text-slate-400">No {nounOne} matches{q.trim() ? ` “${q.trim()}”` : ''}.</td></tr>
                    )}
                    {visible.map((row) => {
                      const worst = worstLine(row);
                      const cachePct = row.screensTotal > 0
                        ? Math.round((row.emergencyCached / row.screensTotal) * 100)
                        : 0;
                      const cacheGrade = cachePct >= 90 ? 'Good' : cachePct >= 60 ? 'Fair' : 'Low';
                      const lastPush = lastPushByTenant.get(row.tenantId);
                      return (
                        <tr
                          key={row.tenantId}
                          onClick={() => enter(row, worstPath(row))}
                          className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/70 cursor-pointer text-[13px] font-bold"
                        >
                          <td className="px-2 py-3">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                              <div className="min-w-0">
                                <div className="text-slate-900 flex items-center gap-2">
                                  <span className="truncate">{row.name}</span>
                                  {row.isSelf && <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 border border-slate-200 rounded px-1 py-0.5 shrink-0">HQ</span>}
                                  {row.pendingApprovals > 0 && (
                                    <span className="text-[9.5px] font-black rounded-full px-1.5 py-0.5 text-white shrink-0" style={{ background: 'var(--brand-primary, #6366f1)' }}>
                                      {row.pendingApprovals}
                                    </span>
                                  )}
                                </div>
                                {worst && <div className={`text-[11px] font-bold ${worst.cls}`}>{worst.text}</div>}
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-3 text-slate-900 whitespace-nowrap">
                            <span className={row.screensOffline > 0 ? 'text-amber-600' : ''}>{row.screensOnline}</span>
                            <span className="text-slate-300">/{row.screensTotal}</span>
                          </td>
                          <td className="px-2 py-3">
                            {!row.hasScreens ? <StatusCell tone="muted">—</StatusCell>
                              : row.contentBehind > 0
                                ? <StatusCell tone="bad">{row.contentBehind} behind</StatusCell>
                                : <StatusCell tone="ok">Up to date</StatusCell>}
                          </td>
                          <td className="px-2 py-3">
                            <Sparkline series={pulse?.locations?.[row.tenantId]} />
                          </td>
                          <td className="px-2 py-3">
                            {!row.hasScreens ? <StatusCell tone="muted">—</StatusCell>
                              : row.pushStale > 0
                                ? <StatusCell tone="warn" title={`${row.pushStale} screen${row.pushStale === 1 ? '' : 's'} on ~10s check-ins`}>Degraded</StatusCell>
                                : <StatusCell tone="ok">Live</StatusCell>}
                          </td>
                          <td className="px-2 py-3">
                            {!row.hasScreens ? <StatusCell tone="muted">—</StatusCell> : (
                              <StatusCell
                                tone={cacheGrade === 'Good' ? 'ok' : 'warn'}
                                title={`${row.emergencyCached} of ${row.screensTotal} screens — ${CACHE_HINT}`}
                              >
                                {cacheGrade} {cachePct}%
                              </StatusCell>
                            )}
                          </td>
                          <td className="px-2 py-3">
                            {!row.hasScreens ? <StatusCell tone="muted">—</StatusCell> : (<>
                              {row.readiness === 'READY' && <StatusCell tone="ok">Ready</StatusCell>}
                              {row.readiness === 'NEEDS_ATTENTION' && <StatusCell tone="warn">Gaps</StatusCell>}
                              {row.readiness === 'NOT_CONFIGURED' && <StatusCell tone="bad">Not set up</StatusCell>}
                              {row.readiness === 'UNKNOWN' && <StatusCell tone="muted">—</StatusCell>}
                            </>)}
                          </td>
                          <td className="px-2 py-3 whitespace-nowrap">
                            {lastPush ? (
                              <>
                                <div className="text-slate-900">{clockTime(lastPush)}</div>
                                <div className="text-[11px] font-semibold text-slate-400">{timeAgo(lastPush)}</div>
                              </>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-2 py-3 text-right">
                            {switchingId === row.tenantId ? (
                              <Loader2 className="w-4 h-4 text-slate-400 animate-spin inline-block" aria-hidden />
                            ) : (
                              <span className="relative inline-block">
                                <button
                                  type="button"
                                  aria-label={`More actions for ${row.name}`}
                                  aria-expanded={menuFor === row.tenantId}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuFor((v) => (v === row.tenantId ? null : row.tenantId));
                                  }}
                                  className="w-8 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                                >
                                  <MoreHorizontal className="w-4 h-4" aria-hidden />
                                </button>
                                {menuFor === row.tenantId && (
                                  <span
                                    className="absolute right-0 top-full mt-1 z-20 w-44 bg-white rounded-xl border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.12)] overflow-hidden block text-left"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => { setMenuFor(null); enter(row, worstPath(row)); }}
                                      className="w-full px-3.5 py-2 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 text-left block"
                                    >
                                      Open {nounOne}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setMenuFor(null); enter(row, 'screens'); }}
                                      className="w-full px-3.5 py-2 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 text-left border-t border-slate-100 block"
                                    >
                                      View screens
                                    </button>
                                  </span>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 mt-auto flex items-center gap-3 flex-wrap">
                <p className="text-[12px] font-semibold text-slate-400">
                  Showing {visible.length} of {fc.locations.length} {n(fc.locations.length)}
                </p>
                <button
                  type="button"
                  onClick={() => fleet.root && enter({ tenantId: fleet.root.id, slug: fleet.root.slug }, 'screens')}
                  className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-black hover:underline underline-offset-2"
                  style={{ color: 'var(--brand-primary, #4f46e5)' }}
                >
                  View all {nounMany} <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                </button>
              </div>
            </>
          )}
        </div>
        )}

        {/* Recent activity. In map mode the Atlas takes the full width (see
            the grid above) and this card follows BELOW it, full-width — a
            column beside a hero map is exactly what the mock does not do,
            but hiding activity outright lost real information (operator,
            2026-08-31: "when you go to map mode it hides activities
            completely"). */}
        <div className={`${CARD} flex flex-col`}>
          <div className="px-5 pt-4 pb-3">
            <h3 className="text-[17px] font-black text-slate-900">Recent activity</h3>
          </div>
          {activity && activity.length > 0 ? (
            <ul className="border-t border-slate-100">
              {activity.map((row, i) => (
                <li key={`${row.at}:${i}`} className="border-b border-slate-100 last:border-b-0 px-5 py-2.5 flex items-start gap-3">
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      background: 'color-mix(in srgb, var(--brand-primary, #6366f1) 12%, white)',
                      color: 'var(--brand-primary, #4f46e5)',
                    }}
                    aria-hidden
                  >
                    <Zap className="w-3.5 h-3.5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] font-bold text-slate-900 truncate">{row.title}</span>
                    {row.detail && (
                      <span className="block text-[11.5px] font-medium text-slate-400 truncate">{row.detail}</span>
                    )}
                  </span>
                  <span className="text-[11.5px] font-semibold text-slate-400 shrink-0">{clockTime(row.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 pb-5 border-t border-slate-100 pt-4">
              <p className="text-[12.5px] font-semibold text-slate-400">
                Changes across your {nounMany} will appear here.
              </p>
            </div>
          )}
          <div className="px-5 py-3 border-t border-slate-100 mt-auto">
            <button
              type="button"
              // The classic activity column below is hidden under Fleet
              // Command (operator: "you have recent activity twice") — the
              // full trail lives on the audit page.
              onClick={() => { window.location.href = `/${fleet.root?.slug ?? ''}/audit`; }}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-black hover:underline underline-offset-2"
              style={{ color: 'var(--brand-primary, #4f46e5)' }}
            >
              View all activity <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {proofDeployment && (
        <ProofDrawer
          deployment={proofDeployment}
          screens={proofScreens}
          locationNoun={{ one: nounOne, many: nounMany }}
          onClose={closeProof}
        />
      )}

      {/* Fix one screen WITHOUT leaving the dashboard (2026-08-31 operator:
          "it would be great if you didnt even leave the dashboard so you
          could knock out all issues right from the main screen"). */}
      {deviceScreen && (
        <DeviceDrawer screen={deviceScreen} onClose={closeDeviceDrawer} onChanged={onFleetCheck} />
      )}
    </section>
  );
}
