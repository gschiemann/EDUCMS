/**
 * SYNTHETIC EMERGENCY DRILL — the OWNER's email text (2026-11-01).
 *
 * Owner-only (`PlatformAlertMailer` → PLATFORM_ALERT_EMAILS), never a
 * customer, so plain English. Three emails, all bounded:
 *   - the per-tick summary of every FAIL and INCONCLUSIVE (modes alert / on);
 *   - the daily dead-man note: a display or kind with no PASS in 36 h;
 *   - a listed screen whose organisation is NOT internal (guard 2), once per
 *     boot per organisation — a configuration that could have drilled a
 *     customer's glass, refused before anything was sent.
 * PURE: strings in, strings out.
 */
import type { DrillKind, FailedLink } from './synthetic-drill.policy';

export interface DrillEmail {
  subject: string;
  body: string;
}

export interface DrillEmailRun {
  label: string;
  kind: DrillKind;
  verdict: string;
  failedLink: FailedLink | null;
  reason: string;
  runId: string;
  panes: Array<{ id: string; raisedAtMs: number | null; paintedAtMs: number | null; lastHash: string | null; failedLink: FailedLink | null; reason: string }>;
  dispatchAtMs: number | null;
}

const KIND_WORDS: Record<DrillKind, string> = {
  override: 'device alert (OVERRIDE)',
  broadcast: 'pushed message (TEXT_BROADCAST)',
  'district-copy': 'district copy (tenant-scoped TEXT_BROADCAST)',
};

const LINK_WORDS: Record<FailedLink, string> = {
  delivery: 'DELIVERY — the screen never raised the alert within 5 s',
  render: 'RENDER — the screen raised the alert but did not prove it painted within 5 s',
  persistence: 'PERSISTENCE — the alert did not stay on the glass until the all-clear',
  release: 'RELEASE — the screen did not leave the alert within 150 s of the all-clear',
};

function rel(ms: number | null, from: number | null): string {
  if (ms === null || from === null) return '—';
  return `+${((ms - from) / 1000).toFixed(1)} s`;
}

export function renderTickEmail(input: { runs: DrillEmailRun[]; mode: string; nowMs: number }): DrillEmail {
  const fails = input.runs.filter((r) => r.verdict === 'FAIL').length;
  const inconclusive = input.runs.length - fails;
  const subject = `[VenueOS] Synthetic emergency drill: ${fails} FAIL${fails === 1 ? '' : 's'}${inconclusive ? `, ${inconclusive} inconclusive` : ''}`;
  const lines: string[] = [
    `The synthetic emergency drill (mode: ${input.mode}) could not prove an alert on bench glass.`,
    '',
  ];
  for (const r of input.runs) {
    lines.push(`• ${r.label} — ${KIND_WORDS[r.kind]}: ${r.verdict}`);
    if (r.failedLink) lines.push(`  ${LINK_WORDS[r.failedLink]}`);
    lines.push(`  reason: ${r.reason}  (run ${r.runId})`);
    for (const p of r.panes) {
      lines.push(
        `  pane ${p.id}: raised ${rel(p.raisedAtMs, r.dispatchAtMs)}, painted ${rel(p.paintedAtMs, r.dispatchAtMs)}, last ${p.lastHash ?? '—'}${p.failedLink ? ` → ${p.failedLink} (${p.reason})` : ''}`,
      );
    }
    lines.push('');
  }
  lines.push(
    'The all-clear was sent for every run (and each alert expires on its own within 180 s).',
    'Evidence: Activity → All events (?view=all), actions EMERGENCY_DRILL_STARTED / EMERGENCY_DRILL_RESULT beside the trigger path’s own TRIGGER_EMERGENCY_DRILL and PLAYER_EMERGENCY_* rows.',
    'Kill switch: EMERGENCY_DRILL_CRON_DISABLED=1 (or unset EMERGENCY_DRILL_SCREENS) and restart.',
    `Sent ${new Date(input.nowMs).toISOString()}. One email per drill pass; never a retry.`,
  );
  return { subject, body: lines.join('\n') };
}

export function renderDeadManEmail(input: {
  gaps: Array<{ label: string; kind: DrillKind; lastVerdict: string | null }>;
  scheduleValid: boolean;
  nowMs: number;
}): DrillEmail {
  const subject = `[VenueOS] Synthetic emergency drill: ${input.gaps.length} with no PASS in 36 h`;
  const lines = [
    'These bench displays have not passed a synthetic emergency drill in the last 36 hours:',
    '',
    ...input.gaps.map((g) => `• ${g.label} — ${KIND_WORDS[g.kind]} (last result: ${g.lastVerdict ?? 'none'})`),
    '',
    input.scheduleValid
      ? 'Common causes: the panel was off or offline at its slot, the location is not flagged internal, or every run FAILED.'
      : 'EMERGENCY_DRILL_SCHEDULE is invalid, so no drill has been sent at all — fix the variable (HH:MM, up to 4 slots, local time of each screen).',
    `Sent ${new Date(input.nowMs).toISOString()}. Once per day.`,
  ];
  return { subject, body: lines.join('\n') };
}

export function renderNotInternalEmail(input: { screenId: string; rootTenantId: string | null; nowMs: number }): DrillEmail {
  return {
    subject: '[VenueOS] Synthetic emergency drill REFUSED a listed screen (organisation is not internal)',
    body: [
      `EMERGENCY_DRILL_SCREENS lists screen ${input.screenId}, but its organisation${input.rootTenantId ? ` (${input.rootTenantId})` : ''} is not flagged internal.`,
      'Nothing was sent to it: a synthetic drill never runs on a customer’s glass.',
      'Remove the screen from EMERGENCY_DRILL_SCREENS (or move the unit to an internal bench organisation).',
      `Sent ${new Date(input.nowMs).toISOString()}. Once per organisation per API boot.`,
    ].join('\n'),
  };
}

export function renderIdentityProblemEmail(input: { tenantId: string; problem: string; nowMs: number }): DrillEmail {
  return {
    subject: '[VenueOS] Synthetic emergency drill paused: its service identity was changed',
    body: [
      `The drill-runner account of location ${input.tenantId} is no longer the login-disabled service identity (${input.problem}).`,
      'No drill is sent from an account that can sign in. Restore it (status DISABLED, no password, role SCHOOL_ADMIN) or delete it and the runner recreates it.',
      `Sent ${new Date(input.nowMs).toISOString()}. Once per location per API boot.`,
    ].join('\n'),
  };
}
