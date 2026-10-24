/**
 * Owner fleet alarms — the EMAILS (2026-10-23). Pure. English only: these go
 * to PLATFORM_ALERT_EMAILS (the platform owner), never to a customer.
 *
 * Names screens, locations and organisations (the owner has to find them) and
 * screen ids (to look them up); never a token, a fingerprint, an address or a
 * secret — the inputs below do not even carry them.
 */
import type { RefusalCategory, RefusalSource } from './fleet-alarm-policy';

const MIN = 60_000;
/** Screens listed by name; the rest are counted. */
const MAX_LISTED = 40;

export interface RenderedOwnerEmail {
  subject: string;
  body: string;
}

/** `2026-10-23 05:43Z`. */
export function fmtUtc(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'never';
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

/** `9 min` / `2 h 05 min` / `3 d 4 h`. */
export function fmtDuration(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface ScreenLabel {
  id: string;
  name: string;
  /** The root organisation's name. */
  orgName: string;
  /** The screen's own location (tenant) name, when it is not the organisation itself. */
  locationName: string | null;
}

function labelOf(s: ScreenLabel): string {
  const where = s.locationName && s.locationName !== s.orgName ? `${s.orgName} › ${s.locationName}` : s.orgName;
  return `${where} › ${s.name} [${s.id}]`;
}

const SOURCE_WORDS: Record<RefusalSource, string> = { ws: 'websocket', register: 'register' };
const CATEGORY_WORDS: Record<RefusalCategory, string> = {
  signature: 'signature no current key verifies',
  expired: 'expired',
  superseded: 'superseded (stale credential epoch)',
  register: 'prior token refused (401)',
};

export function describeRefusal(sources: readonly RefusalSource[], categories: readonly RefusalCategory[]): string {
  const via = sources.map((s) => SOURCE_WORDS[s] ?? s).join(' + ');
  const why = categories.map((c) => CATEGORY_WORDS[c] ?? c).join('; ');
  return `${via} (${why})`;
}

function listed<T>(items: readonly T[], line: (t: T) => string): string[] {
  const out = items.slice(0, MAX_LISTED).map((t) => `  • ${line(t)}`);
  if (items.length > MAX_LISTED) out.push(`  … and ${items.length - MAX_LISTED} more`);
  return out;
}

const orgCount = (screens: readonly ScreenLabel[]) => new Set(screens.map((s) => s.orgName)).size;

// ─── 1. Post-restart fleet check ──────────────────────────────────────────

export interface BootCheckScreen extends ScreenLabel {
  lastPingAtMs: number | null;
  /** Newest player/Manager version report — "the unit is powered" — when after the boot. */
  unitSeenSinceBootMs: number | null;
  /** Refusals recorded for this screen in the last 15 min, if any. */
  refusal: { sources: RefusalSource[]; categories: RefusalCategory[] } | null;
  /** For a downgraded screen: when it fell to re-pair required. */
  downgradedAtMs?: number | null;
}

export function renderBootCheckAlert(input: {
  bootAtMs: number;
  nowMs: number;
  checkOffsetMs: number;
  commit: string | null;
  cohort: number;
  expected: number;
  excused: Record<string, number>;
  gone: number;
  missing: BootCheckScreen[];
  downgraded: BootCheckScreen[];
  degradedComponents: readonly string[];
}): RenderedOwnerEmail {
  const notBack = input.missing.length + input.downgraded.length;
  const all = [...input.missing, ...input.downgraded];
  const subject =
    `[VenueOS] After the API restart, ${notBack} of ${input.expected} screens are not back` +
    ` (${plural(orgCount(all), 'organisation')}) — +${Math.round(input.checkOffsetMs / MIN)} min`;
  const excused = Object.entries(input.excused);
  const body = [
    `The API restarted at ${fmtUtc(input.bootAtMs)}${input.commit ? ` (commit ${input.commit.slice(0, 12)})` : ''}.`,
    `${input.cohort} paired screens had checked in during the 15 minutes before it. ` +
      `${fmtDuration(input.nowMs - input.bootAtMs)} later:`,
    `  • ${input.missing.length} have not checked in since the restart` +
      ' (a check-in served by the old container during the hand-over does not count);',
    ...(input.downgraded.length
      ? [`  • ${input.downgraded.length} checked in, but only on a 1-hour credential — "re-pair required", no push channel;`]
      : []),
    ...(excused.length
      ? [`  • not counted, meant to be off (on/off schedule, remote power-off, standby, maintenance): ${excused.map(([k, n]) => `${n} ${k}`).join(', ')};`]
      : []),
    ...(input.gone ? [`  • not counted, unpaired / revoked / deleted since: ${input.gone}.`] : []),
    '',
    'These screens were working minutes before the restart, so the restart — the new code, its',
    'configuration or its secrets — is the first suspect, not the sites.',
    ...(input.degradedComponents.length ? ['', `Platform health also reports: ${input.degradedComponents.join(', ')}.`] : []),
    '',
    ...(input.missing.length
      ? [
          'Not checked in since the restart:',
          ...listed(input.missing, (s) =>
            [
              labelOf(s),
              `last check-in ${fmtUtc(s.lastPingAtMs)}${s.lastPingAtMs ? ` (${fmtDuration(input.nowMs - s.lastPingAtMs)} ago)` : ''}`,
              s.unitSeenSinceBootMs ? `the unit itself is up (version report ${fmtUtc(s.unitSeenSinceBootMs)})` : null,
              s.refusal ? `device credential refused: ${describeRefusal(s.refusal.sources, s.refusal.categories)}` : null,
            ]
              .filter(Boolean)
              .join(' — '),
          ),
          '',
        ]
      : []),
    ...(input.downgraded.length
      ? [
          'Back, but on a 1-hour credential ("re-pair required" — Restore trust heals it):',
          ...listed(input.downgraded, (s) =>
            [labelOf(s), `since ${fmtUtc(s.downgradedAtMs ?? null)}`, s.refusal ? `refused: ${describeRefusal(s.refusal.sources, s.refusal.categories)}` : null]
              .filter(Boolean)
              .join(' — '),
          ),
          '',
        ]
      : []),
    'Look first at:',
    '  • the Railway deploy logs for "[WS] Auth failed … device credential refused" and "[register]" lines;',
    '  • whether DEVICE_JWT_SECRET / DEVICE_SECRET_KEY (or their _PREVIOUS) changed with this deploy;',
    '  • GET /api/v1/health.',
    '',
    'One alert per restart. POST_RESTART_FLEET_CHECK_DISABLED=1 turns this check off.',
    '— VenueOS post-restart fleet check',
  ].join('\n');
  return { subject, body };
}

// ─── 2. Device-credential refusals ────────────────────────────────────────

export interface RefusedScreen extends ScreenLabel {
  sinceMs: number;
  lastPingAtMs: number | null;
  lastPushConnectedAtMs: number | null;
  sources: RefusalSource[];
  categories: RefusalCategory[];
}

export function renderRefusalAlert(input: {
  nowMs: number;
  reminder: boolean;
  incidentSinceMs: number | null;
  screens: RefusedScreen[];
  /** False when Redis could not be read — the count is this replica's alone. */
  shared: boolean;
}): RenderedOwnerEmail {
  const n = input.screens.length;
  const since = input.incidentSinceMs ?? Math.min(...input.screens.map((s) => s.sinceMs));
  const subject = input.reminder
    ? `[VenueOS] STILL refusing device credentials — ${plural(n, 'screen')} at ${plural(orgCount(input.screens), 'organisation')}, since ${fmtUtc(since)}`
    : `[VenueOS] Device credentials refused — ${plural(n, 'screen')} at ${plural(orgCount(input.screens), 'organisation')} for 10+ minutes`;
  const body = [
    `${n} paired screens have had their device credential refused continuously for at least 10 minutes` +
      ` (since about ${fmtUtc(since)}, ${fmtDuration(input.nowMs - since)}). None has a live push channel.`,
    'A refused screen keeps retrying, so this is a lock-out, not a screen that is switched off.',
    ...(input.shared ? [] : ['(Redis could not be read: these are the refusals THIS replica saw — the real number may be higher.)']),
    '',
    ...listed(input.screens, (s) =>
      [
        labelOf(s),
        `refused via ${describeRefusal(s.sources, s.categories)} since ${fmtUtc(s.sinceMs)}`,
        `last check-in ${fmtUtc(s.lastPingAtMs)}`,
        `push channel last up ${fmtUtc(s.lastPushConnectedAtMs)}`,
      ].join(' — '),
    ),
    '',
    'Usual causes: a DEVICE_JWT_SECRET rotation window closed while these screens still held tokens on the',
    'old key, or a deploy that changed the device secrets. The Railway logs carry one',
    '"[WS] Auth failed … device credential refused: <reason>" line per refused attempt.',
    '',
    input.reminder
      ? 'Reminder: at most one email an hour while it lasts, and a recovery note when it stops.'
      : 'At most one email an hour while it lasts; a recovery note follows when the refusals stop.',
    'DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED=1 turns this alarm off.',
    '— VenueOS device-credential refusal alarm',
  ].join('\n');
  return { subject, body };
}

export function renderRefusalRecovery(input: {
  nowMs: number;
  incidentSinceMs: number | null;
  /** Screens the incident's emails named. */
  alerted: ScreenLabel[];
  /** Of those, the ones still being refused (fewer than the alarm's threshold). */
  stillRefused: ScreenLabel[];
}): RenderedOwnerEmail {
  const recovered = input.alerted.length - input.stillRefused.length;
  const subject = `[VenueOS] Recovered: device credentials no longer refused (${plural(recovered, 'screen')})`;
  const body = [
    `The device-credential refusals that began about ${fmtUtc(input.incidentSinceMs)} have stopped:` +
      ` for the last 5 minutes, fewer than 3 screens have been refused continuously` +
      ` (${fmtDuration(input.nowMs - (input.incidentSinceMs ?? input.nowMs))} after it began).`,
    `Recovered: ${recovered} of the ${input.alerted.length} screens the alarm named.`,
    ...(input.stillRefused.length
      ? ['', 'Still refused (below the alarm threshold — look at these by hand):', ...listed(input.stillRefused, (s) => labelOf(s))]
      : []),
    '',
    'A screen that is back on a 1-hour credential shows "re-pair required" on the dashboard; Restore trust heals it.',
    '— VenueOS device-credential refusal alarm',
  ].join('\n');
  return { subject, body };
}
