"use client";

import { useMemo } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CheckCircle2, ChevronRight, MonitorPlay, Wifi,
  ShieldCheck, MonitorCheck, UploadCloud, ListMusic, PlusCircle, Trophy,
  CalendarClock, Activity,
} from 'lucide-react';
import { VERTICAL_LABELS, normalizeVertical } from '@cms/api-types';
import {
  buildFleetCommand, INBOX_GROUP_TONE, ASSURANCE_LABEL,
  worstLine, locationTone, worstPath,
  type ExceptionRow, type LocationRow, type AssurancePill,
} from '@/components/dashboard/district/fleetCommand';
import { cn } from '@/lib/utils';
import { useDeployedBundle } from '@/hooks/use-deployed-bundle';

/**
 * M04 — Mobile Fleet Command home.
 *
 * "This replaces the older card-stack dashboard with a phone version of Fleet
 * Command", in the order §M04 sets out:
 *
 *   1. Location scope and greeting in one compact line.
 *   2. Active emergency strip when relevant.   ← lives in the header shell
 *   3. Needs attention summary.
 *   4. Quiet assurance row.
 *   5. Grouped location exceptions.
 *   6. Quick actions.
 *   7. Playing/scheduled soon.
 *   8. Recent activity.
 *
 * ONE DERIVATION, TWO DRAWINGS. Every number here comes from
 * `buildFleetCommand` — the exact function the desktop Fleet Command reads.
 * This component counts nothing, grades nothing and re-words nothing. That is
 * the whole point: a phone and a laptop looking at the same fleet must not be
 * able to disagree about how many screens are offline, and the only way to
 * guarantee that is to refuse to compute it twice. It also means the vocabulary
 * stays fixed at the source — "App current" is app-level because no
 * expected-content signature exists yet to prove more (2026-09-01 truth audit),
 * and this surface cannot quietly upgrade that claim.
 *
 * §5.1 EXCEPTION FIRST: the first operational thing on screen is the highest
 * -priority exception, and `fc.inbox` is already ordered worst-first
 * (emergency > no picture confirmed > offline > behind on content > push
 * stale > approvals > setup). §M04: "Do not lead with a giant welcome card."
 */

export interface MobileFleetCommandProps {
  /** The fleet payload, exactly as /screens/fleet returns it. */
  fleet: {
    root?: { id?: string | null; name?: string | null; vertical?: string | null } | null;
    locations: Array<{ id: string; name: string; slug: string }>;
    screens: unknown[];
  };
  readiness?: unknown;
  approvals?: unknown;
  /** Tenant slug for building in-location links. */
  schoolId: string;
  /** Greeting name — "Greg", not an email. */
  firstName?: string | null;
  orgName?: string | null;
  /** Today's schedule rows, already grouped by the page. */
  schedule?: Array<{ key: string; name: string; deviceLine: string; timeStart: string; timeEnd: string }> | null;
  /** Recent audit lines, already shaped by the page. */
  activity?: Array<{ title: string; detail?: string; at: string }> | null;
  /** Capability-gated quick actions (§5.6 / §10). */
  can: { upload: boolean; createPlaylist: boolean; pairScreen: boolean; submitOnly: boolean };
  /** Sports tenants replace the first quick action with Game day (§M04). */
  isSportsVertical?: boolean;
}

export function MobileFleetCommand(props: MobileFleetCommandProps) {
  const { fleet, schoolId, firstName, orgName, schedule, activity, can } = props;

  // The SAME deployed identity the desktop uses, through the same hook
  // (2026-09-21). This component carried its own copy of the build-info fetch
  // that read only `sha`, so when desktop learned to compare `bundleId` — the
  // identity the player actually reloads on — the phone would have kept
  // grading a healthy fleet "App current 5/18" after every API-only commit.
  // Three hand-rolled copies of one fetch is how the third goes stale. Still
  // fail-closed: no deployed identity ⇒ 'unknown' (grey), never an accusation.
  const deployed = useDeployedBundle();
  const deployedSha = deployed.sha;
  const deployedBundleId = deployed.bundleId;

  const fc = useMemo(
    () =>
      buildFleetCommand({
        screens: fleet.screens as never,
        deployedSha,
        deployedBundleId,
        rollupInput: {
          locations: fleet.locations,
          rootId: fleet.root?.id ?? null,
          screens: fleet.screens as never,
          readiness: props.readiness as never,
          approvals: props.approvals as never,
        },
      }),
    [fleet, deployedSha, deployedBundleId, props.readiness, props.approvals],
  );

  const vertical = normalizeVertical(fleet.root?.vertical ?? null);
  const nounMany = VERTICAL_LABELS[vertical].plural.toLowerCase();

  const exceptions = fc.inboxAll;
  const top = exceptions[0] ?? null;
  const healthyLocations = fc.locations.filter((l) => locationTone(l) === 'ok');
  const troubled = fc.locations.filter((l) => locationTone(l) !== 'ok');

  return (
    <div className="space-y-4" data-testid="mobile-fleet-command">
      {/* 1 — scope + greeting on ONE compact line (§M04: not a giant welcome
          card, which is what the previous mobile home led with).

          2026-09-21 — NO second logo here, on purpose. This home only renders
          under the v1 shell, whose top bar already carries the tenant's mark
          ~60px above this line; the first cut put the same mark on this line
          too and the phone showed one logo stacked on its twin. Identity on
          this page is the top-bar mark, the organisation name printed here,
          and the brand-coloured primary action below. */}
      <div className="flex items-baseline gap-1.5 px-0.5">
        <span className="text-[15px] font-black text-slate-900 truncate">
          {firstName ? `Hi, ${firstName}` : 'Hi'}
        </span>
        <span className="text-slate-300" aria-hidden>·</span>
        <span className="text-[13px] font-semibold text-slate-500 truncate">
          {orgName || 'Your fleet'}
        </span>
      </div>

      {/* 3 — NEEDS ATTENTION: one dominant condition + a count of the rest. */}
      <NeedsAttention
        top={top}
        total={exceptions.length}
        assurance={fc.assurance}
        allClear={fc.allClear}
        schoolId={schoolId}
      />

      {/* 4 — QUIET ASSURANCE ROW. §M04: "Every label must remain visible; do
          not reduce it to unlabeled numbers." A 2×2 grid keeps every label on
          screen at 360px, which a horizontal scroller would not.

          The labels come from ASSURANCE_LABEL, the same record the desktop
          tiles read — §5.3 keeps these four evidence families apart, and the
          only way a phone and a laptop can be guaranteed to name them
          identically is to not let either one type the words. Push live is
          the one desktop tile dropped here: four fit at 360px, five do not,
          and it is the signal an operator acts on least. */}
      <div className="grid grid-cols-2 gap-2" data-testid="assurance-row">
        <Assurance label={ASSURANCE_LABEL.online} pill={fc.assurance.online} Icon={Wifi} />
        <Assurance label={ASSURANCE_LABEL.showingContent} pill={fc.assurance.showingContent} Icon={MonitorCheck} />
        <Assurance label={ASSURANCE_LABEL.contentCurrent} pill={fc.assurance.contentCurrent} Icon={CheckCircle2} />
        <Assurance
          label={ASSURANCE_LABEL.emergencyReady}
          pill={fc.assurance.emergencyReady}
          Icon={ShieldCheck}
          unit={nounMany}
        />
      </div>

      {/* 5 — GROUPED LOCATION EXCEPTIONS, worst first. Healthy locations
          collapse into one line (§M04). */}
      {troubled.length > 0 && (
        <section aria-label="Locations that need attention" className="space-y-2">
          <SectionTitle>Locations</SectionTitle>
          {troubled.map((loc) => (
            <LocationCard key={loc.tenantId} row={loc} exceptions={exceptions} />
          ))}
          {healthyLocations.length > 0 && (
            <p className="px-1 text-[12px] font-semibold text-slate-500" data-testid="healthy-collapsed">
              {healthyLocations.length} {healthyLocations.length === 1 ? 'location' : 'locations'} healthy
            </p>
          )}
        </section>
      )}

      {/* 6 — QUICK ACTIONS. At most four, capability-filtered (§M04, §5.6). */}
      <section aria-label="Quick actions">
        <SectionTitle>Quick actions</SectionTitle>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {props.isSportsVertical && (
            <QuickAction href={`/${schoolId}/sports`} Icon={Trophy} label="Game day" />
          )}
          {can.upload && (
            <QuickAction href={`/${schoolId}/assets`} Icon={UploadCloud} label="Upload media" />
          )}
          {can.createPlaylist && (
            <QuickAction href={`/${schoolId}/playlists`} Icon={ListMusic} label="New playlist" />
          )}
          {can.submitOnly && (
            <QuickAction href={`/${schoolId}/reviews?tab=mine`} Icon={ListMusic} label="My submissions" />
          )}
          {can.pairScreen && (
            <QuickAction href={`/${schoolId}/screens`} Icon={PlusCircle} label="Pair screen" />
          )}
          <QuickAction href={`/${schoolId}/screens`} Icon={MonitorPlay} label="Screens" />
        </div>
      </section>

      {/* 7 — SCHEDULED SOON. Schedule INTENT only: this proves a window is on
          the calendar, never that a screen received or rendered anything
          (§11.2 keeps those separate; §11.5 forbids calling a schedule
          "Live"). The assurance row above is where render evidence lives. */}
      {schedule && schedule.length > 0 && (
        <section aria-label="Scheduled today" data-testid="schedule-section">
          <SectionTitle>Scheduled today</SectionTitle>
          <div className="mt-2 rounded-2xl bg-white border border-slate-200 overflow-hidden divide-y divide-slate-100">
            {schedule.slice(0, 4).map((s) => (
              <div key={s.key} className="px-4 py-3 flex items-center gap-3">
                <CalendarClock className="w-4 h-4 shrink-0 text-slate-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-slate-900 truncate">{s.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {s.timeStart && s.timeEnd ? `${s.timeStart}–${s.timeEnd}` : 'All day'} · {s.deviceLine}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 8 — RECENT ACTIVITY. */}
      {activity && activity.length > 0 && (
        <section aria-label="Recent activity" data-testid="activity-section">
          <SectionTitle>Recent activity</SectionTitle>
          <div className="mt-2 rounded-2xl bg-white border border-slate-200 overflow-hidden divide-y divide-slate-100">
            {activity.slice(0, 5).map((a, i) => (
              <div key={`${a.at}-${i}`} className="px-4 py-2.5 flex items-start gap-3">
                <Activity className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-300" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold text-slate-800 truncate">{a.title}</p>
                  {a.detail && <p className="text-[11px] text-slate-500 truncate">{a.detail}</p>}
                </div>
                <span className="shrink-0 text-[11px] text-slate-400">{a.at}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="h-2" />
    </div>
  );
}

// ── pieces ──────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">{children}</h2>
  );
}

/**
 * §M04's needs-attention card: "Show the single highest-risk condition and a
 * count of additional exceptions."
 *
 * The healthy copy is where honesty gets tested. §M04's own example reads
 * "45 screens online · 45 expected revisions rendered" — but no expected
 * content revision exists to compare against yet (that is the open P0 from
 * the 2026-09-01 truth audit; the desktop pill is deliberately named "App
 * current" for the same reason). So the healthy state reports the two things
 * the derivation genuinely proves — how many screens answer, and how many
 * report a confirmed picture — and says nothing about revisions.
 */
function NeedsAttention({
  top, total, assurance, allClear, schoolId,
}: {
  top: ExceptionRow | null;
  total: number;
  assurance: ReturnType<typeof buildFleetCommand>['assurance'];
  allClear: boolean;
  schoolId: string;
}) {
  if (total === 0) {
    return (
      <div
        data-testid="needs-attention"
        data-state={allClear ? 'clear' : 'unknown'}
        className="rounded-2xl bg-white border border-slate-200 p-4"
      >
        <div className="flex items-start gap-3">
          <span className={cn(
            'shrink-0 w-9 h-9 rounded-xl flex items-center justify-center',
            allClear ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500',
          )}>
            <CheckCircle2 className="w-5 h-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-black text-slate-900">
              {allClear ? 'All checks passed' : 'Nothing needs attention'}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-slate-600">
              {assurance.online.state === 'unknown'
                // Never cry wolf, and never cry all-clear either: a check that
                // did not answer is reported as not-answered, not as zero.
                ? 'No screens reporting yet.'
                : `${assurance.online.n} of ${assurance.online.total} devices online · ` +
                  (assurance.showingContent.state === 'unknown'
                    ? 'no picture evidence yet'
                    : `${assurance.showingContent.n} reporting a confirmed picture`)}
            </p>
            {!allClear && (
              <p className="mt-1 text-[11.5px] text-slate-500">
                Some checks haven’t reported, so this isn’t a full all-clear.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const tone = INBOX_GROUP_TONE[top!.kind];
  return (
    <div
      data-testid="needs-attention"
      data-state="attention"
      data-kind={top!.kind}
      className={cn(
        'rounded-2xl border p-4',
        tone === 'bad' ? 'bg-red-50 border-red-200' : tone === 'warn' ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200',
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn(
          'shrink-0 w-9 h-9 rounded-xl flex items-center justify-center',
          tone === 'bad' ? 'bg-red-100 text-red-700' : tone === 'warn' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600',
        )}>
          <AlertTriangle className="w-5 h-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-black text-slate-900">
            {total === 1 ? '1 thing needs attention' : `${total} things need attention`}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-slate-700">
            {top!.headline}
            {top!.age ? <span className="text-slate-500"> · {top!.age}</span> : null}
          </p>
          <p className="text-[11.5px] leading-snug text-slate-500">{top!.detail}</p>
        </div>
      </div>
      {/* The page's one primary action. 2026-09-21: was near-black
          (bg-slate-900), which read as chrome from some other product on a
          branded tenant. `bg-indigo-600` is the dashboard's primary-CTA class
          and globals.css maps the whole indigo scale onto the brand — 600 →
          --brand-primary-strong, the shade lib/branding.ts derives to clear
          4.5:1 against white, so white label text stays legible for ANY brand
          colour (the 2026-07-22 cream incident). The tone here is identity,
          never status: the amber/red card around it keeps its own semantics. */}
      <Link
        href={`/${schoolId}/${top!.path}`}
        className="mt-3 flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl bg-indigo-600 text-white text-[13px] font-bold active:bg-indigo-700"
      >
        {top!.kind === 'approvals' ? 'Review submissions' : 'Review screens'}
        <ChevronRight className="w-4 h-4" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * One assurance signal. §8.4: gray means EXPLICITLY UNKNOWN, and an unknown
 * signal suppresses its counter rather than printing a zero — a "0/0" reads
 * as a measurement, and this one was never taken.
 */
function Assurance({
  label, pill, Icon, unit,
}: {
  label: string;
  pill: AssurancePill;
  Icon: typeof Wifi;
  unit?: string;
}) {
  const tone =
    pill.state === 'ok' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : pill.state === 'warn' ? 'text-amber-800 bg-amber-50 border-amber-200'
    : pill.state === 'bad' ? 'text-red-800 bg-red-50 border-red-200'
    : 'text-slate-500 bg-slate-50 border-slate-200';
  return (
    <div className={cn('rounded-xl border px-3 py-2.5', tone)} data-testid={`assurance-${pill.state}`}>
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
        <span className="text-[11px] font-bold leading-tight">{label}</span>
      </div>
      <p className="mt-1 text-[17px] font-black leading-none tabular-nums">
        {pill.state === 'unknown' ? (
          <span className="text-[13px] font-bold">Not reported</span>
        ) : (
          <>
            {pill.n}
            <span className="text-[12px] font-bold opacity-60"> / {pill.total}{unit ? ` ${unit}` : ''}</span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * §M04's location card: name, dominant condition, affected screen count, last
 * evidence timestamp, one action.
 *
 * `worstLine` / `locationTone` / `worstPath` are IMPORTED, not re-derived. The
 * first draft of this file carried its own copy of the ranking and it had
 * already drifted before it ever rendered — a location with no screens graded
 * amber here and gray on the desktop table, for the same venue on the same
 * fleet. The line, the dot color and the destination now all come off the
 * function the laptop reads.
 */
function LocationCard({ row, exceptions }: { row: LocationRow; exceptions: ExceptionRow[] }) {
  // The location's own worst row — already ranked, so no re-sorting here. It
  // carries the evidence timestamp; the shared worst-line carries the words.
  const mine = exceptions.find((e) => e.tenantId === row.tenantId);
  const tone = locationTone(row);
  const worst = worstLine(row);
  return (
    <Link
      href={`/${row.slug}/${worstPath(row)}`}
      data-testid="location-card"
      data-tone={tone}
      className="flex items-center gap-3 rounded-2xl bg-white border border-slate-200 px-4 min-h-[64px] active:bg-slate-50"
    >
      <span
        className={cn(
          'shrink-0 w-2.5 h-2.5 rounded-full',
          tone === 'bad' ? 'bg-red-600' : tone === 'warn' ? 'bg-amber-500' : 'bg-emerald-500',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1 py-2.5">
        <p className="text-[13.5px] font-bold text-slate-900 truncate">{row.name}</p>
        <p className="text-[11.5px] text-slate-600 truncate">
          {worst ? worst.text : `${row.screensOnline}/${row.screensTotal} devices online`}
        </p>
      </div>
      {mine?.age && <span className="shrink-0 text-[11px] font-bold text-slate-400">{mine.age}</span>}
      <ChevronRight className="w-4 h-4 shrink-0 text-slate-300" aria-hidden />
    </Link>
  );
}

function QuickAction({ href, Icon, label }: { href: string; Icon: typeof Wifi; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-2xl bg-white border border-slate-200 px-3 min-h-[56px] active:bg-slate-50"
    >
      <Icon className="w-4.5 h-4.5 shrink-0 text-slate-500" aria-hidden />
      <span className="text-[13px] font-bold text-slate-800 leading-tight">{label}</span>
    </Link>
  );
}
