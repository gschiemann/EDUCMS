"use client";

/**
 * DistrictCommandCenter — what a DISTRICT ADMIN sees first (2026-08-24).
 *
 * ── The problem ──────────────────────────────────────────────────────
 * A district admin was landing on roughly the same dashboard a single school
 * gets: fleet KPIs, a screen-group rollup, a getting-started card. They are
 * responsible for every school in the district, and the page told them
 * nothing about which one needs them. This is their command center.
 *
 * ── The two things it renders ────────────────────────────────────────
 *  1. NEEDS ACTION — only rows whose count is NONZERO, worst first. Screens
 *     offline · screens reachable-but-NOT-painting · schools that can't run a
 *     lockdown · approvals waiting. Every row is one tap: when a single
 *     school is implicated it switches straight into that school at the page
 *     where the fix lives; when several are, it filters the list below to
 *     exactly those schools. When every counter is zero it collapses to ONE
 *     calm line — "All N schools healthy" — and nothing else.
 *  2. PER-SCHOOL SCORECARDS — one compact ROW per school (rows, not cards:
 *     this has to stay legible at ~40 schools), sorted worst-first by
 *     `compareScorecards`. Each row's tap target lands on the page where that
 *     school's worst problem is actually fixed, not a generic dashboard.
 *
 * ── Discipline this file keeps ───────────────────────────────────────
 *  • NEVER CRY WOLF. Readiness and approvals are separate requests. If one
 *    hasn't answered, its counters are suppressed and the calm all-clear line
 *    is withheld — `buildDistrictRollup` reports that as `coverage`.
 *  • NO NEW POLLING. The live signal rides useFleet's existing 30s interval;
 *    the two new reads are mount-paced (see use-api.ts).
 *  • Every action happens by SWITCHING INTO the owning school via
 *    useTenantSwitch — the same manager-console pattern FleetRollup uses, so
 *    the JWT, brand palette, and React Query cache all move together.
 *
 * Dashboard surface (not player/widget) → CSS `inset`/`gap` are fine here.
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Building2, CheckCircle2, ChevronDown, ChevronRight,
  CloudOff, Loader2, Search, ShieldAlert, Siren, MonitorX, Inbox, X,
} from 'lucide-react';
import { useTenantSwitch } from '@/hooks/use-tenant-switch';
import { VERTICAL_LABELS, VERTICAL_EMERGENCY_TYPES, normalizeVertical } from '@cms/api-types';
import type { FleetResponse, DistrictReadinessResponse, DistrictPendingApprovals } from '@/hooks/use-api';
import {
  buildDistrictRollup, filterScorecards,
  type SchoolScorecard,
} from './districtRollup';

/** Which needs-action dimension the list below is currently filtered to.
 *  `noLockdown` and `alertGaps` are kept SEPARATE (not one 'emergency' key)
 *  so the two emergency rows can't highlight together when both are
 *  multi-school — a pressed state has to mean "you pressed this one". */
type Focus = 'offline' | 'notPainting' | 'noLockdown' | 'alertGaps' | 'approvals' | null;

/** Where a school's WORST problem is actually fixed. */
function destinationFor(s: SchoolScorecard): { path: string; label: string } {
  if (s.readiness === 'NOT_CONFIGURED') return { path: 'settings/emergency', label: 'Wire alerts' };
  if (s.notPainting > 0 || s.screensOffline > 0) return { path: 'screens', label: 'Fix screens' };
  if (s.readiness === 'NEEDS_ATTENTION') return { path: 'settings/emergency', label: 'Finish setup' };
  if (s.pendingApprovals > 0) return { path: 'reviews', label: 'Review' };
  return { path: 'dashboard', label: 'Open' };
}

function matchesFocus(s: SchoolScorecard, focus: Focus): boolean {
  switch (focus) {
    case 'offline': return s.screensOffline > 0;
    case 'notPainting': return s.notPainting > 0;
    case 'noLockdown': return s.readiness === 'NOT_CONFIGURED';
    case 'alertGaps': return s.readiness === 'NEEDS_ATTENTION';
    case 'approvals': return s.pendingApprovals > 0;
    default: return true;
  }
}

export function DistrictCommandCenter({
  fleet,
  readiness,
  approvals,
  districtName,
}: {
  fleet: FleetResponse;
  readiness?: DistrictReadinessResponse | null;
  approvals?: DistrictPendingApprovals | null;
  districtName?: string | null;
}) {
  const { switchToTenant, switchingId } = useTenantSwitch();
  const [focus, setFocus] = useState<Focus>(null);
  const [q, setQ] = useState('');
  const [showHealthy, setShowHealthy] = useState(false);

  const rollup = useMemo(
    () =>
      buildDistrictRollup({
        locations: fleet.locations,
        rootId: fleet.root?.id ?? null,
        screens: fleet.screens,
        readiness: readiness ?? null,
        approvals: approvals ?? null,
      }),
    [fleet.locations, fleet.root?.id, fleet.screens, readiness, approvals],
  );

  const { needsAction: na, coverage } = rollup;
  const schoolCount = rollup.schools.length;

  // Vertical-aware nouns + anchor verb (2026-08-30 — operator: a GYM
  // district read "schools can't run a lockdown"). The root tenant's
  // vertical names the children ("gyms", "stores", ...) and picks the
  // emergency verb: "run a lockdown" only where the vertical carries
  // lockdown; everyone else gets "display an emergency alert".
  const vertical = normalizeVertical((fleet.root as { vertical?: string | null } | null)?.vertical);
  const nounOne = VERTICAL_LABELS[vertical].singular.toLowerCase();
  const nounMany = VERTICAL_LABELS[vertical].plural.toLowerCase();
  const n = (count: number) => (count === 1 ? nounOne : nounMany);
  const anchorVerb = VERTICAL_EMERGENCY_TYPES[vertical].includes('lockdown')
    ? 'run a lockdown'
    : 'display an emergency alert';
  const anchorName = VERTICAL_EMERGENCY_TYPES[vertical].includes('lockdown') ? 'Lockdown' : 'Evacuate';
  const searchable = schoolCount > 8;

  const enter = (s: SchoolScorecard, path: string) =>
    switchToTenant({ id: s.tenantId, slug: s.slug }, `/${s.slug}/${path}`);

  // ── The needs-action rows. Built as data so the "only nonzero rows" rule
  // is enforced in ONE place instead of five conditional JSX blocks. ──────
  type ActionRow = {
    key: Exclude<Focus, null>;
    Icon: typeof CloudOff;
    tone: 'red' | 'amber' | 'indigo';
    headline: string;
    detail: string;
    schools: SchoolScorecard[];
    path: string;
  };
  const actionRows: ActionRow[] = [];
  if (na.emergencyNotConfiguredSchools > 0) {
    const hit = rollup.schools.filter((s) => s.readiness === 'NOT_CONFIGURED');
    actionRows.push({
      key: 'noLockdown', Icon: ShieldAlert, tone: 'red',
      headline: `${hit.length} ${n(hit.length)} can’t ${anchorVerb}`,
      detail: hit.length === 1
        ? `${hit[0].name} has no alert content wired — a trigger would push nothing to its screens.`
        : 'No alert content wired — a trigger would push nothing to those screens.',
      schools: hit, path: 'settings/emergency',
    });
  }
  if (na.notPaintingScreens > 0) {
    const hit = rollup.schools.filter((s) => s.notPainting > 0);
    actionRows.push({
      key: 'notPainting', Icon: MonitorX, tone: 'red',
      headline: `${na.notPaintingScreens} ${na.notPaintingScreens === 1 ? 'screen is' : 'screens are'} online but not painting`,
      // 2026-08-30 (audit P0-5 copy honesty): the system proves "no painted-
      // frame proof", not "frozen frame on the glass" — we cannot see the
      // panel. Say the strongest thing the evidence supports, no more.
      detail: hit.length === 1
        ? `${hit[0].name} — reachable and answering heartbeats, but no proof of a painted frame for 5+ minutes.`
        : `Across ${hit.length} ${nounMany} — reachable and answering heartbeats, but no proof of a painted frame for 5+ minutes.`,
      schools: hit, path: 'screens',
    });
  }
  if (na.offlineScreens > 0) {
    const hit = rollup.schools.filter((s) => s.screensOffline > 0);
    actionRows.push({
      key: 'offline', Icon: CloudOff, tone: 'amber',
      headline: `${na.offlineScreens} ${na.offlineScreens === 1 ? 'screen' : 'screens'} offline`,
      detail: hit.length === 1
        ? `All of them at ${hit[0].name}.`
        : `Across ${hit.length} ${nounMany}.`,
      schools: hit, path: 'screens',
    });
  }
  const emergencyWarnOnly = na.emergencyNotReadySchools - na.emergencyNotConfiguredSchools;
  if (emergencyWarnOnly > 0) {
    const hit = rollup.schools.filter((s) => s.readiness === 'NEEDS_ATTENTION');
    actionRows.push({
      key: 'alertGaps', Icon: Siren, tone: 'amber',
      headline: `${emergencyWarnOnly} ${n(emergencyWarnOnly)} ${emergencyWarnOnly === 1 ? 'has' : 'have'} gaps in emergency setup`,
      detail: hit.length === 1 && hit[0].missingTypes.length > 0
        ? `${hit[0].name} is missing content for: ${hit[0].missingTypes.join(', ')}.`
        : `${anchorName} is wired, but other alert types or part of the fleet are not ready.`,
      schools: hit, path: 'settings/emergency',
    });
  }
  if (na.pendingApprovals > 0) {
    const hit = rollup.schools.filter((s) => s.pendingApprovals > 0);
    actionRows.push({
      key: 'approvals', Icon: Inbox, tone: 'indigo',
      headline: `${na.pendingApprovals} ${na.pendingApprovals === 1 ? 'submission is' : 'submissions are'} waiting on you`,
      detail: hit.length === 1 ? `From ${hit[0].name}.` : `From ${hit.length} ${nounMany}.`,
      schools: hit, path: 'reviews',
    });
  }

  // A row is one tap: a single implicated school goes STRAIGHT there; several
  // filter the scorecard list below to exactly those schools.
  const onAction = (row: ActionRow) => {
    if (row.schools.length === 1) { enter(row.schools[0], row.path); return; }
    setFocus((cur) => (cur === row.key ? null : row.key));
    setQ('');
  };

  const visible = useMemo(() => {
    const focused = focus ? rollup.schools.filter((s) => matchesFocus(s, focus)) : rollup.schools;
    return filterScorecards(focused, q);
  }, [rollup.schools, focus, q]);
  const attention = visible.filter((s) => s.needsAttention);
  const healthy = visible.filter((s) => !s.needsAttention);
  // With nothing filtered and a long healthy tail, keep the tail collapsed so
  // the schools that need work stay above the fold at 40 schools.
  const collapseHealthy = !focus && !q.trim() && healthy.length > 4 && attention.length > 0 && !showHealthy;

  const toneCls: Record<ActionRow['tone'], { wrap: string; icon: string; count: string }> = {
    red:    { wrap: 'border-rose-200 bg-rose-50/60 hover:bg-rose-50', icon: 'text-rose-600', count: 'text-rose-700' },
    amber:  { wrap: 'border-amber-200 bg-amber-50/60 hover:bg-amber-50', icon: 'text-amber-600', count: 'text-amber-700' },
    indigo: { wrap: 'border-slate-200 bg-slate-50/60 hover:bg-slate-50', icon: 'text-slate-600', count: 'text-slate-700' },
  };

  return (
    <section
      aria-label="District command center"
      className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden"
    >
      {/* ─── Header ──────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-4 flex items-center gap-2 flex-wrap">
        <Building2 className="w-5 h-5 shrink-0" style={{ color: 'var(--brand-primary, #4f46e5)' }} aria-hidden />
        <h2 className="text-base font-black text-slate-800">
          {districtName || fleet.root?.name || 'District'} — every {nounOne}, one view
        </h2>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 ml-auto">
          {schoolCount} {n(schoolCount)} · {fleet.stats.total} screens
        </span>
      </div>

      {/* ─── NEEDS ACTION ────────────────────────────────────────── */}
      <div className="px-5 pb-5">
        {actionRows.length === 0 ? (
          coverage.readiness && coverage.approvals ? (
            // THE calm moment. One line, nothing else.
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" aria-hidden />
              <p className="text-sm font-bold text-emerald-900">
                All {schoolCount} {n(schoolCount)} {schoolCount === 1 ? 'is' : 'are'} healthy — nothing needs you right now.
              </p>
            </div>
          ) : (
            // Counters are zero but a check never answered. Say so plainly
            // rather than claiming an all-clear we can't prove.
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3.5">
              <Loader2 className="w-4 h-4 text-slate-400 shrink-0 animate-spin" aria-hidden />
              <p className="text-sm font-semibold text-slate-600">
                Screens are healthy. Still checking{' '}
                {[!coverage.readiness && 'emergency readiness', !coverage.approvals && 'the review queue']
                  .filter(Boolean).join(' and ')}
                …
              </p>
            </div>
          )
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-slate-400" aria-hidden />
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Needs action</h3>
            </div>
            {actionRows.map((row) => {
              const single = row.schools.length === 1;
              const isFocused = !single && focus === row.key;
              const busy = single && switchingId === row.schools[0].tenantId;
              return (
                <button
                  key={`${row.key}-${row.headline}`}
                  type="button"
                  onClick={() => onAction(row)}
                  disabled={!!switchingId}
                  aria-pressed={isFocused || undefined}
                  className={`w-full text-left flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors disabled:opacity-60 disabled:cursor-wait ${
                    toneCls[row.tone].wrap
                  } ${isFocused ? 'ring-2 ring-offset-1 ring-slate-300' : ''}`}
                >
                  <row.Icon className={`w-5 h-5 shrink-0 ${toneCls[row.tone].icon}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-bold ${toneCls[row.tone].count}`}>{row.headline}</span>
                    <span className="block text-[12px] text-slate-600 mt-0.5">{row.detail}</span>
                  </span>
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-slate-500">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : null}
                    {single ? `Open ${row.schools[0].name}` : isFocused ? 'Showing these' : `Show the ${row.schools.length}`}
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                  </span>
                </button>
              );
            })}
            {/* The one platform-level note: realtime in fallback. Reported ONCE
                for the district — it is identical for every school, and letting
                it repaint 40 rows amber would drown the per-school signal. */}
            {readiness?.delivery?.status === 'warn' && (
              <p className="text-[11px] text-slate-500 px-1 pt-0.5">
                Note: {readiness.delivery.detail} {readiness.delivery.fixHint}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ─── PER-SCHOOL SCORECARDS ───────────────────────────────── */}
      <div className="border-t border-slate-100">
        <div className="px-5 py-3 flex items-center gap-3 flex-wrap bg-slate-50/50 border-b border-slate-100">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Schools</h3>
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">worst first</span>
          {focus && (
            <button
              type="button"
              onClick={() => setFocus(null)}
              className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 hover:bg-slate-300"
            >
              Filtered <X className="w-3 h-3" aria-hidden />
            </button>
          )}
          {searchable && (
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label={`Filter ${nounMany} by name`}
                placeholder="Find a school…"
                className="w-full pl-9 pr-8 py-1.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-slate-400 bg-white"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ('')}
                  aria-label="Clear filter"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            No {nounOne} matches{q.trim() ? ` “${q.trim()}”` : ''}.
          </p>
        ) : (
          <div className={schoolCount > 12 ? 'max-h-[560px] overflow-y-auto' : ''}>
            <ul className="divide-y divide-slate-50">
              {attention.map((s) => (
                <SchoolRow key={s.tenantId} school={s} switchingId={switchingId} onEnter={enter} />
              ))}
              {!collapseHealthy &&
                healthy.map((s) => (
                  <SchoolRow key={s.tenantId} school={s} switchingId={switchingId} onEnter={enter} />
                ))}
            </ul>
            {collapseHealthy && (
              <button
                type="button"
                onClick={() => setShowHealthy(true)}
                className="w-full px-5 py-3 flex items-center gap-2 text-left border-t border-slate-100 bg-emerald-50/40 hover:bg-emerald-50 transition-colors"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden />
                <span className="text-[13px] font-semibold text-emerald-900">
                  {healthy.length} other {nounMany} are healthy
                </span>
                <ChevronDown className="w-4 h-4 text-emerald-600 ml-auto" aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * One school. A ROW, not a card — this list has to stay skimmable at ~40
 * schools, and a district admin reads it top-to-bottom like a triage queue.
 * The whole row is the tap target and it lands on the page where THIS
 * school's worst problem is fixed, not on a generic dashboard.
 */
function SchoolRow({
  school: s, switchingId, onEnter,
}: {
  school: SchoolScorecard;
  switchingId: string | null;
  onEnter: (s: SchoolScorecard, path: string) => void;
}) {
  const dest = destinationFor(s);
  const switching = switchingId === s.tenantId;
  const dot =
    s.readiness === 'NOT_CONFIGURED' || s.notPainting > 0 ? 'bg-rose-500'
    : s.screensOffline > 0 || s.readiness === 'NEEDS_ATTENTION' ? 'bg-amber-500'
    : 'bg-emerald-500';

  return (
    <li>
      <button
        type="button"
        onClick={() => onEnter(s, dest.path)}
        disabled={!!switchingId}
        aria-label={`${s.name}: ${dest.label}`}
        className="group w-full text-left px-5 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-wait"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} aria-hidden />

        {/* Name */}
        <span className="min-w-0 w-[30%] sm:w-[26%]">
          <span className="block text-sm font-semibold text-slate-800 truncate">{s.name}</span>
          {s.isSelf && (
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">District office</span>
          )}
        </span>

        {/* Screens online / total */}
        <span className="shrink-0 w-[70px] text-right text-[13px] tabular-nums">
          {s.screensTotal === 0 ? (
            <span className="text-slate-300">no screens</span>
          ) : (
            <>
              <span className={s.screensOffline > 0 ? 'font-bold text-amber-700' : 'font-semibold text-slate-700'}>
                {s.screensOnline}
              </span>
              <span className="text-slate-400">/{s.screensTotal}</span>
            </>
          )}
        </span>

        {/* Chips — only ever rendered when they carry real information. */}
        <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
          {s.notPainting > 0 && (
            <Chip tone="rose" Icon={MonitorX}>
              {s.notPainting} not painting
            </Chip>
          )}
          {s.readiness === 'NOT_CONFIGURED' && <Chip tone="rose" Icon={ShieldAlert}>No lockdown content</Chip>}
          {s.readiness === 'NEEDS_ATTENTION' && (
            <Chip tone="amber" Icon={Siren}>
              {s.missingTypes.length > 0 ? `Missing ${s.missingTypes.length} alert ${s.missingTypes.length === 1 ? 'type' : 'types'}` : 'Alerts need setup'}
            </Chip>
          )}
          {/* The readiness verdict is ALWAYS shown when we have one, even on a
              row that is red for some other reason: "two screens are down but
              lockdown is wired" is a materially different morning from "two
              screens are down AND we can't alert", and the district admin has
              to be able to tell them apart at a glance. */}
          {s.readiness === 'READY' && <Chip tone="emerald" Icon={CheckCircle2}>Alert-ready</Chip>}
          {s.pendingApprovals > 0 && (
            <Chip tone="slate" Icon={Inbox}>
              {s.pendingApprovals} waiting
            </Chip>
          )}
        </span>

        <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 group-hover:text-slate-700 transition-colors">
          {switching ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : null}
          <span className="hidden sm:inline">{dest.label}</span>
          <ChevronRight className="w-3.5 h-3.5" aria-hidden />
        </span>
      </button>
    </li>
  );
}

function Chip({
  tone, Icon, children,
}: {
  tone: 'rose' | 'amber' | 'emerald' | 'slate';
  Icon: typeof CloudOff;
  children: React.ReactNode;
}) {
  const cls: Record<string, string> = {
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cls[tone]}`}>
      <Icon className="w-3 h-3" aria-hidden />
      {children}
    </span>
  );
}
