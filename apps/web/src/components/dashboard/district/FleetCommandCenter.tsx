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
import {
  AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, CloudOff,
  ExternalLink, FileCheck2, Inbox, Info, Loader2, MapPin, MonitorCheck,
  MonitorPlay, MonitorX, MoreHorizontal, Radio, RefreshCw, Search, Send,
  ShieldAlert, ShieldCheck, Upload, Wifi, X, Zap,
} from 'lucide-react';
import { useTenantSwitch } from '@/hooks/use-tenant-switch';
import { useRefreshWeb } from '@/hooks/use-api';
import { VERTICAL_LABELS, normalizeVertical } from '@cms/api-types';
import type {
  FleetResponse, DistrictReadinessResponse, DistrictPendingApprovals, DeploymentRow,
  FleetPulseResponse, FleetPulsePoint,
} from '@/hooks/use-api';
import { buildFleetCommand, isContentBehind, type AssuranceState, type ExceptionRow, type LocationRow } from './fleetCommand';
import { deriveRenderTrustGrade } from '@/components/screens/renderTrust';
import { filterScorecards } from './districtRollup';
import { ProofDrawer, timeAgo, type ProofDrawerScreen } from './ProofDrawer';
import { ScreenMapClient } from '@/components/screens/ScreenMapClient';

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

/** Fewer samples than this and a 24h chart would be a drawing, not a record. */
const MIN_PULSE_SAMPLES = 4;

/**
 * The single worst thing true about a location, worst-first — null when the
 * location is calm. Shared by the table row and the map's selected-location
 * card so the two surfaces can never word the same location differently.
 */
function worstLine(row: LocationRow): { text: string; cls: string } | null {
  if (!row.hasScreens) return { text: 'No screens set up yet', cls: 'text-slate-400' };
  if (row.readiness === 'NOT_CONFIGURED') return { text: 'Can’t display an emergency alert', cls: 'text-rose-600' };
  if (row.notPainting > 0) return { text: `${row.notPainting} no picture confirmed`, cls: 'text-rose-600' };
  if (row.screensOffline > 0) return { text: `${row.screensOffline} offline`, cls: 'text-amber-600' };
  if (row.contentBehind > 0) return { text: `${row.contentBehind} behind on content`, cls: 'text-amber-600' };
  return null;
}

/** Where a click on this location lands — keyed off the SAME precedence. */
function worstPath(row: LocationRow): string {
  if (!row.hasScreens) return 'screens';
  if (row.readiness === 'NOT_CONFIGURED') return 'settings/emergency';
  return worstLine(row) ? 'screens' : 'dashboard';
}

/** Atlas pin filter — "All" first so the map never opens pre-narrowed. */
const ATLAS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'healthy', label: 'Healthy' },
] as const;

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

/** "1h 02m" / "14m" — how long a push has been running. */
function elapsedSince(startMs: number, nowMs: number): string {
  const min = Math.max(0, Math.floor((nowMs - startMs) / 60_000));
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
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
 * Artwork for a push. A push has no artwork pipeline yet (it reloads whatever
 * each screen is already scheduled to play), so the tile is a brand-gradient
 * plate carrying the push's initials rather than a fake thumbnail.
 */
function ArtworkTile({ label }: { label: string }) {
  const initials =
    label.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '—';
  return (
    <div
      className="w-full aspect-video rounded-xl flex items-center justify-center overflow-hidden shrink-0"
      style={{
        background:
          'linear-gradient(135deg, var(--brand-primary, #4f46e5), color-mix(in srgb, var(--brand-accent, #6366f1) 65%, #1e1b4b))',
      }}
      aria-hidden
    >
      <span className="text-white font-black text-2xl tracking-tight opacity-95">{initials}</span>
    </div>
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

/**
 * Fleet pulse — the mock's stacked 24h area chart, hand-rolled SVG (no chart
 * dependency). Stacked bottom-up so the top edge is the whole fleet:
 *   offline (red) · degraded, i.e. online with no confirmed picture (amber) ·
 *   online AND painting (green).
 *
 * Draws only what the sampler recorded. A fresh deploy has a handful of
 * samples and says so instead of drawing a 24-hour line through two points.
 */
function FleetPulseChart({ points }: { points: FleetPulsePoint[] }) {
  const W = 320;
  const H = 148;
  const padL = 24;
  const padR = 4;
  const padT = 6;
  const padB = 20;

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
    [0, 1, 2, 3].map((k) => Math.round((k / 3) * (points.length - 1))).concat(points.length - 1),
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

export function FleetCommandCenter({
  fleet,
  readiness,
  approvals,
  deployments,
  pulse,
  activity,
  orgName,
  onSwitchClassic,
  onFleetCheck,
}: {
  fleet: FleetResponse;
  readiness?: DistrictReadinessResponse | null;
  approvals?: DistrictPendingApprovals | null;
  /** Recent "Push content" actions. Absent → live-derived convergence only. */
  deployments?: { deployments: DeploymentRow[] } | null;
  /** Recorded fleet history for the pulse chart + row sparklines. */
  pulse?: FleetPulseResponse | null;
  /** Recent audit lines, already shaped by the page. */
  activity?: Array<{ title: string; detail?: string; at: string }> | null;
  orgName?: string | null;
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
  // "Push content" fires the fleet-wide durable refresh (a Deployment the
  // deployment card then tracks). Blast radius = every screen, so it uses
  // the same two-tap arm the locations card uses for destructive actions.
  // "Run fleet check" re-probes every read this surface is built from.
  const refreshWeb = useRefreshWeb();
  const [pushArmed, setPushArmed] = useState(false);
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

  const visible = useMemo(
    () => filterScorecards(fc.locations, q) as LocationRow[],
    [fc.locations, q],
  );

  // ── Atlas pin filter (Network Atlas mock parity) ──────────────────
  // Three chips over the map. "Needs attention" is the SAME union the inbox
  // ranks on — offline, or no confirmed picture, or behind on content — so
  // the map and the list can never disagree about who is in trouble. Healthy
  // is its exact complement, which keeps All = the two halves with no gap.
  const [atlasFilter, setAtlasFilter] = useState<'all' | 'attention' | 'healthy'>('all');
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

  // Map pins ride the SAME effective-geo the fleet map has always used
  // (screen pin > group > location address). Pin click selects the owning
  // location; the trip stays behind an explicit button.
  const mapScreens = useMemo(
    () =>
      scoped.fleet.screens
        .filter((s) =>
          atlasFilter === 'all' ? true
          : atlasFilter === 'attention' ? needsAttention(s)
          : !needsAttention(s),
        )
        .map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          latitude: s.effectiveLatitude,
          longitude: s.effectiveLongitude,
          address: s.effectiveAddress,
          geoSource: s.geoSource,
          lastPingAt: s.lastPingAt,
          lastCacheReport: s.lastCacheReport,
        })),
    [scoped.fleet.screens, atlasFilter, needsAttention],
  );
  const mappableCount = useMemo(
    () => mapScreens.filter((s) => s.latitude != null && s.longitude != null).length,
    [mapScreens],
  );
  /** Mappable pins BEFORE the filter — separates "no addresses" from "no match". */
  const mappableTotal = useMemo(
    () => scoped.fleet.screens.filter((s) => s.effectiveLatitude != null && s.effectiveLongitude != null).length,
    [scoped.fleet.screens],
  );
  // ── Selected location (Network Atlas mock parity) ─────────────────
  // A pin click used to switch tenants immediately — a full context change
  // fired by one click on a 20px dot, with no chance to read what was wrong
  // first. Now it SELECTS: the card names the location, its online count and
  // its worst line, and leaves the trip behind an explicit "Open" button.
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const selectScreenLocation = (screenId: string) => {
    const src = fleet.screens.find((s) => s.id === screenId)?.sourceTenant;
    if (src) setSelectedTenantId(src.id);
  };
  const selectedLocation = selectedTenantId
    ? fc.locations.find((l) => l.tenantId === selectedTenantId) ?? null
    : null;
  /** First address any of this location's screens resolved to. May be absent. */
  const selectedAddress = useMemo(
    () =>
      selectedTenantId
        ? fleet.screens.find((s) => s.sourceTenant?.id === selectedTenantId && s.effectiveAddress)
            ?.effectiveAddress ?? null
        : null,
    [fleet.screens, selectedTenantId],
  );
  // Scoped to the open panel — no listener sitting on window while the map
  // is closed.
  useEffect(() => {
    if (!selectedLocation) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedTenantId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedLocation]);

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
  /** In flight — the card leads with it. */
  const activeDeployment = recentDeployment && !recentDeployment.convergence.done ? recentDeployment : null;
  /** Landed everywhere — one quiet line under the live card, never a banner. */
  const settledDeployment = recentDeployment && recentDeployment.convergence.done ? recentDeployment : null;

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

  /**
   * A single-screen push is scoped to the CALLER's tenant server-side
   * (`POST /screens/:id/refresh-web` looks the screen up under
   * `req.user.tenantId`), so from HQ it can only reach HQ's own screens — a
   * child location's screen would 404. Rather than ship a button that fails,
   * a row outside HQ falls back to "Open", which lands in the location where
   * the same control works. Lifting this needs a fleet-scoped endpoint.
   */
  const canPushScreen = (row: ExceptionRow) => !!row.screenId && row.tenantId === fleet.root?.id;

  const pills: Array<{ key: string; label: string; Icon: typeof Wifi; pill: typeof fc.assurance.online; hint: string }> = [
    { key: 'content', label: 'Content current', Icon: CheckCircle2, pill: fc.assurance.contentCurrent, hint: 'Screens confirmed on the latest published content. Gray = nothing to compare yet.' },
    { key: 'online', label: 'Devices online', Icon: Wifi, pill: fc.assurance.online, hint: 'Screens answering heartbeats. Online alone does not prove a picture — that is the last card.' },
    { key: 'push', label: 'Push live', Icon: Send, pill: fc.assurance.pushLive, hint: 'Screens with an instant connection. Others still update via ~10s check-ins.' },
    { key: 'emergency', label: 'Emergency ready', Icon: ShieldCheck, pill: fc.assurance.emergencyReady, hint: `${nounMany.charAt(0).toUpperCase() + nounMany.slice(1)} able to display an emergency alert right now — its own check, never inferred from content health.` },
    { key: 'painting', label: 'Showing content', Icon: MonitorCheck, pill: fc.assurance.showingContent, hint: 'Screens with a confirmed picture on the glass.' },
  ];

  /** "View all incidents" — the table, unfiltered, scrolled into view. */
  const showAllIncidents = () => {
    setView('list');
    setQ('');
    setScopeId('all');
    locationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const pulsePoints = pulse?.fleet ?? [];
  const hasPulse = pulsePoints.length >= MIN_PULSE_SAMPLES;

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
            {fc.locations.length} {n(fc.locations.length)}
          </p>
        </div>

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

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!pushArmed) { setPushArmed(true); return; }
              setPushArmed(false);
              refreshWeb.mutate({});
            }}
            onBlur={() => setPushArmed(false)}
            disabled={refreshWeb.isPending}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold text-white disabled:opacity-60 ${pushArmed ? 'bg-rose-600 hover:bg-rose-700' : ''}`}
            style={pushArmed ? undefined : { background: 'var(--brand-primary, #4f46e5)' }}
            title="Send every screen a reload-content command. It rides both the live connection AND each screen's own content feed, so it reaches screens with a dead push channel too — and becomes a tracked push in the deployment card."
          >
            {refreshWeb.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              : <Upload className="w-4 h-4" aria-hidden />}
            {pushArmed ? `Confirm · all ${fleet.stats.total} screens` : 'Push content'}
          </button>
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
              <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${PILL_ICON_TONE[pill.state]}`}>
                <Icon className="w-[18px] h-[18px]" aria-hidden />
              </span>
              <span className="min-w-0 flex items-baseline gap-1.5">
                <span className="text-[15px] font-black text-slate-900 shrink-0">
                  {pill.state === 'unknown' ? '—' : `${pill.n}/${pill.total}`}
                </span>
                <span className="text-[12.5px] font-semibold text-slate-500 truncate">{label}</span>
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

      {/* ─── 2 · Needs attention · Live deployment · Fleet pulse ─── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
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
                    All {fc.locations.length} {n(fc.locations.length)} healthy — nothing needs you right now.
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
            <button
              type="button"
              onClick={showAllIncidents}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-black hover:underline underline-offset-2"
              style={{ color: 'var(--brand-primary, #4f46e5)' }}
            >
              View all incidents <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </button>
          </div>
        </div>

        {/* Live deployment — a real push takes the card; otherwise the
            live-derived convergence stands exactly as it always has. */}
        <div className={`${CARD} flex flex-col`}>
          <div className="px-5 pt-4 pb-3">
            <h3 className="text-[17px] font-black text-slate-900">
              {activeDeployment ? 'Live deployment' : 'Content convergence'}
            </h3>
          </div>
          <div className="px-5 pb-4 flex-1">
            {activeDeployment ? (
              <div className="flex gap-4 items-start">
                <div className="w-[40%] max-w-[170px] shrink-0">
                  <ArtworkTile label={activeDeployment.label} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-black text-slate-900 truncate" title={activeDeployment.label}>
                    {activeDeployment.label}
                  </p>
                  <p className="text-[12px] font-semibold text-slate-400 truncate">
                    {activeDeployment.targetCount} screen{activeDeployment.targetCount === 1 ? '' : 's'}
                  </p>
                  <p className="mt-2.5 text-[13.5px] font-black text-emerald-600">
                    {activeDeployment.convergence.converged} of {activeDeployment.targetCount} confirmed
                  </p>
                  <div className="mt-2 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{
                        width: `${Math.round((activeDeployment.convergence.converged / Math.max(1, activeDeployment.targetCount)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-2.5 text-[12px] font-semibold text-slate-400">
                    {`Started ${clockTime(activeDeployment.createdAt)} · Elapsed ${elapsedSince(Date.parse(activeDeployment.createdAt), Date.now())}`}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {fc.convergence.gradeable === 0 ? (
                  <p className="text-[13px] font-semibold text-slate-400">
                    Nothing to compare yet — screens report their content version as they check in.
                  </p>
                ) : (
                  <>
                    <p className="text-[13.5px] font-black text-emerald-600">
                      {fc.convergence.confirmed} of {fc.convergence.gradeable} confirmed
                    </p>
                    <div className="mt-2 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round((fc.convergence.confirmed / Math.max(1, fc.convergence.gradeable)) * 100)}%`,
                          background: fc.convergence.settled ? '#10b981' : 'var(--brand-primary, #6366f1)',
                        }}
                      />
                    </div>
                    <p className="mt-2.5 text-[12.5px] font-semibold text-slate-500">
                      {fc.convergence.settled
                        ? 'Every reporting screen is on the current content.'
                        : `${fc.convergence.propagating} screen${fc.convergence.propagating === 1 ? '' : 's'} still picking up the latest update.`}
                    </p>
                  </>
                )}
                {/* A landed push is ONE quiet line, and it must survive the
                    "nothing to compare" case too — that is exactly when a
                    screen has no bundle evidence but the push record does. */}
                {settledDeployment && (
                  <p className="mt-2 text-[12px] font-semibold text-slate-400">
                    Last push confirmed everywhere · {timeAgo(settledDeployment.createdAt)}
                  </p>
                )}
              </>
            )}
          </div>
          {(activeDeployment || settledDeployment) && (
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
              {activeDeployment
                ? viewDeploymentButton(activeDeployment, 'View deployment')
                : viewDeploymentButton(settledDeployment!, 'View screens')}
            </div>
          )}
        </div>

        {/* Fleet pulse */}
        <div className={`${CARD} flex flex-col`}>
          <div className="px-5 pt-4 pb-2 flex items-center gap-2 flex-wrap">
            <h3 className="text-[17px] font-black text-slate-900">Fleet pulse</h3>
            <span className="text-[12.5px] font-semibold text-slate-400">· last 24h</span>
            {hasPulse && (
              <span className="ml-auto flex items-center gap-3">
                {[
                  { label: 'Online', color: '#10b981' },
                  { label: 'Degraded', color: '#f59e0b' },
                  { label: 'Offline', color: '#f43f5e' },
                ].map(({ label, color }) => (
                  <span key={label} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-500">
                    <span className="w-2 h-2 rounded-full" style={{ background: color }} aria-hidden />
                    {label}
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className="px-4 pb-4 flex-1 flex items-center">
            {hasPulse ? (
              <FleetPulseChart points={pulsePoints} />
            ) : (
              <p className="px-1 text-[12.5px] font-semibold text-slate-400">
                Building your first 24 hours of history — first samples land within the hour.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ─── 3 · Locations · Recent activity ──────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)]">
        <div ref={locationsRef} className={`${CARD} flex flex-col`}>
          <div className="px-5 pt-4 pb-3 flex items-center gap-3 flex-wrap">
            <h3 className="text-[17px] font-black text-slate-900 capitalize">{nounMany}</h3>
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
            <div className="px-5 pb-5">
              {/* Atlas stat cards — the mock's four counts above the map. */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3" role="group" aria-label="Fleet totals">
                {[
                  { key: 'loc', label: n(fc.locations.length), value: fc.locations.length, Icon: MapPin, tone: 'text-white', bg: 'var(--brand-primary, #4f46e5)' },
                  { key: 'scr', label: 'Screens', value: scoped.fleet.screens.length, Icon: MonitorPlay, tone: 'text-white', bg: '#2563eb' },
                  { key: 'cur', label: 'Content current', value: fc.assurance.contentCurrent.state === 'unknown' ? '—' : fc.assurance.contentCurrent.n, Icon: CheckCircle2, tone: 'text-white', bg: '#10b981' },
                  { key: 'att', label: 'Need attention', value: attentionCount, Icon: AlertTriangle, tone: 'text-white', bg: '#f97316' },
                ].map(({ key, label, value, Icon, tone, bg }) => (
                  <div key={key} className={`${CARD} px-4 py-3 flex items-center gap-3`}>
                    <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${tone}`} style={{ background: bg }}>
                      <Icon className="w-5 h-5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[19px] font-black text-slate-900 leading-tight">{value}</span>
                      <span className="block text-[12px] font-semibold text-slate-500 truncate capitalize">{label}</span>
                    </span>
                  </div>
                ))}
              </div>

              {mappableTotal > 0 && (
                <div className="mb-2 flex bg-slate-100 rounded-lg p-0.5 w-fit" role="radiogroup" aria-label="Filter pins">
                  {ATLAS_FILTERS.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={atlasFilter === key}
                      onClick={() => setAtlasFilter(key)}
                      className={`px-3 py-1 rounded-md text-[11px] font-bold ${
                        atlasFilter === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <div className="relative rounded-2xl border border-slate-200 overflow-hidden">
                {mappableTotal === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <p className="text-sm font-bold text-slate-500">No addresses on the map yet.</p>
                    <p className="text-[12px] text-slate-400 mt-1">
                      Add an address to a {nounOne}, a screen group, or a screen — its pins appear here.
                    </p>
                  </div>
                ) : mappableCount === 0 ? (
                  // There ARE addresses — the filter is simply empty. Saying
                  // "no addresses" here would send the operator to fix the
                  // wrong thing.
                  <div className="px-5 py-8 text-center">
                    <p className="text-sm font-bold text-slate-500">No {nounMany} match this filter on the map.</p>
                  </div>
                ) : (
                  <ScreenMapClient screens={mapScreens} renderSidebar={false} onScreenClick={selectScreenLocation} />
                )}

                {/* Floating exception inbox — the mock's map-side to-do list.
                    Same rows, same navigation as the card above; compact and
                    corner-pinned so the map stays pannable behind it. */}
                {mappableCount > 0 && fc.inbox.length > 0 && (
                  <div
                    className="absolute top-3 left-3 z-[1000] w-[268px] max-w-[calc(100%-1.5rem)] bg-white rounded-2xl border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.14)] overflow-hidden"
                    role="group"
                    aria-label="Exception inbox"
                  >
                    <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
                      <Inbox className="w-4 h-4 shrink-0" style={{ color: 'var(--brand-primary, #4f46e5)' }} aria-hidden />
                      <h4 className="text-[12.5px] font-black text-slate-800">Exception inbox</h4>
                      <span className="ml-auto text-[11px] font-black text-slate-400">{inboxCount}</span>
                    </div>
                    <ul>
                      {fc.inbox.slice(0, 4).map((row, i) => {
                        const Icon = INBOX_ICON[row.kind];
                        return (
                          <li key={`map:${row.kind}:${row.screenId ?? row.tenantId}:${i}`} className="border-b border-slate-100 last:border-b-0">
                            <button
                              type="button"
                              onClick={() => enter(row, row.path)}
                              disabled={!!switchingId}
                              className="w-full px-4 py-2 flex items-center gap-2.5 text-left hover:bg-slate-50 disabled:opacity-60"
                            >
                              <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${INBOX_TONE[row.kind]}`}>
                                <Icon className="w-3 h-3" aria-hidden />
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-[12px] font-bold text-slate-800 truncate">
                                  {row.headline}
                                  {row.age && <span className={`ml-1.5 ${INBOX_AGE_TONE[row.kind]}`}>{row.age}</span>}
                                </span>
                                <span className="block text-[10.5px] font-semibold text-slate-400 truncate">{row.tenantName}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* Floating evidence card. Deliberately small and corner-pinned:
                    the map behind it stays pannable, so the operator can keep
                    their bearings while reading it. */}
                {selectedLocation && (
                  <div
                    className="absolute top-3 right-3 z-[1000] w-[300px] max-w-[calc(100%-1.5rem)] bg-white rounded-2xl border border-slate-200 shadow-[0_8px_30px_rgb(0,0,0,0.14)] p-4"
                    role="group"
                    aria-label={`${selectedLocation.name} details`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <h4 className="text-[13.5px] font-black text-slate-800 truncate">{selectedLocation.name}</h4>
                        {selectedAddress && (
                          <p className="text-[11px] font-semibold text-slate-400 truncate" title={selectedAddress}>
                            {selectedAddress}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedTenantId(null)}
                        aria-label="Close"
                        className="w-7 h-7 -mt-1 -mr-1 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 focus:ring-2 focus:ring-indigo-300 outline-none shrink-0"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden />
                      </button>
                    </div>

                    <p className="mt-2 text-[12.5px] font-bold text-slate-700">
                      <span className={selectedLocation.screensOffline > 0 ? 'text-amber-600' : ''}>
                        {selectedLocation.screensOnline}
                      </span>
                      <span className="text-slate-300">/{selectedLocation.screensTotal}</span> online
                    </p>
                    {(() => {
                      const worst = worstLine(selectedLocation);
                      return worst ? <p className={`text-[11.5px] font-bold ${worst.cls}`}>{worst.text}</p> : null;
                    })()}

                    <button
                      type="button"
                      onClick={() => enter(selectedLocation, worstPath(selectedLocation))}
                      disabled={!!switchingId}
                      className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11.5px] font-bold text-white disabled:opacity-60 disabled:cursor-wait"
                      style={{ background: 'var(--brand-primary, #4f46e5)' }}
                    >
                      {switchingId === selectedLocation.tenantId && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                      )}
                      Open {nounOne} →
                    </button>
                  </div>
                )}
              </div>

              {/* "Online ≠ current" — the mock's teaching strip. Static: it
                  names the four separate truths so nobody reads a green dot
                  on the map as proof of a picture. */}
              <div className={`${CARD} mt-3 px-4 py-3`} role="group" aria-label="Online ≠ current">
                <h4 className="text-[12.5px] font-black text-slate-800">Online ≠ current</h4>
                <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-x-6 gap-y-2">
                  {[
                    { label: 'Device online', Icon: Wifi, cls: 'text-emerald-500' },
                    { label: 'Content current', Icon: CheckCircle2, cls: 'text-emerald-500' },
                    { label: 'Push live', Icon: Radio, cls: 'text-indigo-500' },
                    { label: 'Painting proof', Icon: MonitorCheck, cls: 'text-indigo-500' },
                  ].map(({ label, Icon, cls }) => (
                    <span key={label} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                      <Icon className={`w-4 h-4 shrink-0 ${cls}`} aria-hidden />
                      {label}
                    </span>
                  ))}
                </div>
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

        {/* Recent activity */}
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
              onClick={() => document.getElementById('recent-activity')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
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
    </section>
  );
}
