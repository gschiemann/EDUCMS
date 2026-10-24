/**
 * Notification titles and bodies in the reader's language (2026-10-24).
 *
 * The API writes every notification as finished ENGLISH text ("Screen
 * offline: Lobby TV", "No heartbeat since 2026-10-07T21:14:03.000Z.") and
 * stores no structured parameters — `Notification` has kind / title / body /
 * link and nothing else. So a Spanish or Chinese operator read English in the
 * bell and the inbox (launch QA, 2026-10-23).
 *
 * Rather than a schema change, this recognises each sentence the server can
 * write, pulls its parts out (screen name, site, counts, times) and rebuilds
 * it from the `notifications.server.*` catalog. That also localizes the rows
 * ALREADY stored. Anything it does not recognise — a reviewer's own note, a
 * visitor's typed help request, a sentence added later — is shown exactly as
 * written, so nothing is ever lost or invented.
 *
 * The English catalog repeats the API's wording, so English readers see the
 * same text as before (with the machine timestamps made readable).
 * `notificationCopy.test.ts` reads the API source files and fails when a
 * sentence below is no longer what the server writes — reword both together.
 *
 * Pure: no React, no DOM, no network.
 */

export type NotificationTranslate = (key: string, values?: Record<string, string | number>) => string;

export interface NotificationCopyOptions {
  /** Translator scoped to `notifications.server`. */
  t: NotificationTranslate;
  /** A short local date and time for an instant, in the reader's locale and time zone. */
  formatTime: (ms: number) => string;
}

export interface LocalizableNotification {
  kind: string;
  title: string;
  body?: string | null;
}

type Params = Record<string, string | number>;

interface Rule {
  /** Which `Notification.kind` values may carry this sentence. */
  kinds: readonly string[];
  re: RegExp;
  /** Catalog key under `notifications.server`. */
  key: string | ((m: RegExpExecArray) => string);
  params?: (m: RegExpExecArray, o: NotificationCopyOptions) => Params;
}

/** "2026-10-07T21:14:03.000Z" → local time; anything else passes through. */
function isoTime(raw: string, o: NotificationCopyOptions): string {
  const ms = Date.parse(raw);
  return /^\d{4}-\d{2}-\d{2}T/.test(raw) && Number.isFinite(ms) ? o.formatTime(ms) : raw;
}

/** "2026-10-24 17:30 UTC" (support-access `fmt`) → local time; anything else passes through. */
function utcStamp(raw: string, o: NotificationCopyOptions): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) UTC$/.exec(raw.trim());
  if (!m) return raw;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isFinite(ms) ? o.formatTime(ms) : raw;
}

/** support-access `describeMinutes` ("2 hours", "1 day", "an unspecified time") → localized. */
function duration(raw: string, o: NotificationCopyOptions): string {
  const m = /^(\d+) (day|days|hour|hours|minute|minutes)$/.exec(raw.trim());
  if (m) {
    const unit = m[2].startsWith('day') ? 'days' : m[2].startsWith('hour') ? 'hours' : 'minutes';
    return o.t(`duration.${unit}`, { count: Number(m[1]) });
  }
  if (raw.trim() === 'an unspecified time') return o.t('duration.unspecified');
  return raw;
}

const VENUEOS_SUPPORT = 'VenueOS support';
const A_CUSTOMER = 'A customer';
const who = (raw: string, o: NotificationCopyOptions) => (raw === VENUEOS_SUPPORT ? o.t('venueosSupport') : raw);
const org = (raw: string, o: NotificationCopyOptions) => (raw === A_CUSTOMER ? o.t('aCustomer') : raw);

const OFFLINE = ['SCREEN_OFFLINE'];
const INFRA = ['INFRA_EVENT'];
const PUSH_DEAD = ['SCREEN_PUSH_DEAD'];
const INFO = ['INFO'];

/** Every title the API writes (see the file header for where each comes from). */
export const TITLE_RULES: readonly Rule[] = [
  // notifications.service.ts — the offline scanner (store row, then the HQ roll-up).
  { kinds: OFFLINE, re: /^(.+) · Screen offline: (.+)$/, key: 'screenOfflineAt', params: (m) => ({ site: m[1], screen: m[2] }) },
  { kinds: OFFLINE, re: /^Screen offline: (.+)$/, key: 'screenOffline', params: (m) => ({ screen: m[1] }) },
  {
    kinds: INFRA,
    re: /^(?:(.+) · )?Possible infrastructure event — (\d+)\/(\d+) screens dropped$/,
    key: (m) => (m[1] ? 'infraEventAt' : 'infraEvent'),
    params: (m) => ({ ...(m[1] ? { site: m[1] } : {}), count: Number(m[2]), total: Number(m[3]) }),
  },
  // screen-wedge-detector.cron.ts — the realtime channel is down.
  { kinds: PUSH_DEAD, re: /^(.+): realtime channel down — running on polling$/, key: 'pushDeadPolling', params: (m) => ({ screen: m[1] }) },
  {
    kinds: PUSH_DEAD,
    re: /^(.+): realtime down AND content unproven — needs attention now$/,
    key: 'pushDeadUnproven',
    params: (m) => ({ screen: m[1] }),
  },
  // assets.controller.ts — the approval workflow.
  { kinds: ['ASSET_PENDING_REVIEW'], re: /^New asset pending review$/, key: 'assetPending' },
  { kinds: ['ASSET_APPROVED'], re: /^Your asset was approved$/, key: 'assetApproved' },
  { kinds: ['ASSET_REJECTED'], re: /^Your asset was rejected$/, key: 'assetRejected' },
  // submissions.controller.ts + schedules.controller.ts.
  { kinds: INFO, re: /^New submission awaiting your review$/, key: 'submissionAwaiting' },
  { kinds: INFO, re: /^Your submission was approved$/, key: 'submissionApproved' },
  { kinds: INFO, re: /^Your submission was rejected$/, key: 'submissionRejected' },
  // customer-console.service.ts.
  { kinds: INFO, re: /^VenueOS support created an owner sign-in link$/, key: 'ownerLink' },
  // support-access.service.ts — to the customer's admins, then to VenueOS staff.
  { kinds: INFO, re: /^VenueOS is asking for support access$/, key: 'supportRequested' },
  { kinds: INFO, re: /^VenueOS used emergency support access$/, key: 'supportBreakGlass' },
  { kinds: INFO, re: /^VenueOS support access has ended$/, key: 'supportEnded' },
  { kinds: INFO, re: /^(.+) approved support access$/, key: 'supportApproved', params: (m, o) => ({ org: org(m[1], o) }) },
  { kinds: INFO, re: /^(.+) denied support access$/, key: 'supportDenied', params: (m, o) => ({ org: org(m[1], o) }) },
  { kinds: INFO, re: /^(.+) gave VenueOS support access$/, key: 'supportInvited', params: (m, o) => ({ org: org(m[1], o) }) },
  // notifications.controller.ts — a kiosk visitor asked for help (default title only;
  // a title the kiosk sent is the visitor's own words and stays as written).
  { kinds: INFO, re: /^Visitor needs assistance — (.+)$/, key: 'kioskHelp', params: (m) => ({ screen: m[1] }) },
  // playback-demotion.service.ts.
  { kinds: INFO, re: /^Video stutters on (.+)$/, key: 'videoStutter', params: (m) => ({ screen: m[1] }) },
];

/** Every body sentence the API writes. Free text (notes, reasons) is never matched on its own. */
export const BODY_RULES: readonly Rule[] = [
  {
    kinds: OFFLINE,
    re: /^No heartbeat since unknown\.$/,
    key: 'noHeartbeatUnknown',
  },
  { kinds: OFFLINE, re: /^No heartbeat since (\S+)\.$/, key: 'noHeartbeat', params: (m, o) => ({ time: isoTime(m[1], o) }) },
  {
    kinds: OFFLINE,
    re: /^(.+): no heartbeat from "(.+)" since (\S+)\.$/,
    key: 'noHeartbeatAt',
    params: (m, o) => ({ site: m[1], screen: m[2], time: m[3] === 'unknown' ? o.t('unknownTime') : isoTime(m[3], o) }),
  },
  {
    kinds: INFRA,
    re: /^(\d+) screens went offline within (\d+) s \(>(\d+)% of fleet\)\. Likely WAN, ISP, or local power event — per-screen alerts suppressed\. Affected: (.*)\.$/,
    key: 'infraBody',
    params: (m) => ({ count: Number(m[1]), seconds: Number(m[2]), pct: Number(m[3]), names: m[4] }),
  },
  {
    kinds: INFRA,
    re: /^(.+): (\d+) screens went offline within (\d+) s \(>(\d+)% of that location's fleet\)\. Likely WAN, ISP, or power\.$/,
    key: 'infraBodyAt',
    params: (m) => ({ site: m[1], count: Number(m[2]), seconds: Number(m[3]), pct: Number(m[4]) }),
  },
  {
    kinds: PUSH_DEAD,
    re: /^This screen cannot receive instant commands \(refresh, immediate emergency delivery\)\. Its render proof is current/,
    key: 'pushDeadPollingBody',
  },
  {
    kinds: PUSH_DEAD,
    re: /^This screen cannot receive instant commands AND has not proven a painted frame recently/,
    key: 'pushDeadUnprovenBody',
  },
  {
    kinds: ['ASSET_PENDING_REVIEW'],
    re: /^(.+) uploaded "(.+)" — review needed before it can be scheduled\.$/,
    key: 'assetPendingBody',
    params: (m) => ({ email: m[1], asset: m[2] }),
  },
  {
    kinds: ['ASSET_APPROVED'],
    re: /^"(.+)" is now published and can be added to playlists\.$/,
    key: 'assetApprovedBody',
    params: (m) => ({ asset: m[1] }),
  },
  {
    kinds: ['ASSET_REJECTED'],
    re: /^"(.+)" was rejected by (.+?) — "([\s\S]*)"\.$/,
    key: 'assetRejectedReasonBody',
    params: (m) => ({ asset: m[1], reviewer: m[2], reason: m[3] }),
  },
  {
    kinds: ['ASSET_REJECTED'],
    re: /^"(.+)" was rejected by (.+)\.$/,
    key: 'assetRejectedBody',
    params: (m) => ({ asset: m[1], reviewer: m[2] }),
  },
  { kinds: INFO, re: /^A schedule was submitted for approval before it can go live\.$/, key: 'submissionScheduleBody' },
  { kinds: INFO, re: /^(\d+) item\(s\) submitted for approval\.$/, key: 'submissionItemsBody', params: (m) => ({ count: Number(m[1]) }) },
  { kinds: INFO, re: /^Content is now live\.$/, key: 'submissionLiveBody' },
  { kinds: INFO, re: /^Reviewer left no feedback\. Edit and resubmit when ready\.$/, key: 'submissionNoFeedbackBody' },
  {
    kinds: INFO,
    re: /^A one-time sign-in link for a new organization owner was issued under your support access approval\. If you did not expect this, revoke support access in Settings\.$/,
    key: 'ownerLinkBody',
  },
  {
    kinds: INFO,
    re: /^(.+) asked for access to (.+) for (.+): "([\s\S]*)"\. Approve or deny it in Settings → Support access\.$/,
    key: 'supportRequestedBody',
    params: (m, o) => ({ who: who(m[1], o), org: m[2], duration: duration(m[3], o), reason: m[4] }),
  },
  {
    kinds: INFO,
    re: /^(.+) opened emergency access to (.+) until (.+): "([\s\S]*)"\. You can end it now in Settings → Support access\.$/,
    key: 'supportBreakGlassBody',
    params: (m, o) => ({ who: who(m[1], o), org: m[2], until: utcStamp(m[3], o), reason: m[4] }),
  },
  { kinds: INFO, re: /^VenueOS ended its support access to (.+)\.$/, key: 'supportEndedBody', params: (m) => ({ org: m[1] }) },
  { kinds: INFO, re: /^Access until (.+)\.$/, key: 'accessUntil', params: (m, o) => ({ until: utcStamp(m[1], o) }) },
  { kinds: INFO, re: /^A kiosk visitor tapped “request help\.”$/, key: 'kioskHelpBody' },
  {
    kinds: INFO,
    re: /^“(.+)” stutters on “(.+)” while it plays more than one video at once\. It keeps playing; a lighter copy would not fix this\.$/,
    key: 'videoStutterConcurrencyBody',
    params: (m) => ({ screen: m[1], file: m[2] }),
  },
  {
    kinds: INFO,
    re: /^“(.+)” stutters on “(.+)” and there is no lighter copy to switch it to\. It keeps playing\.$/,
    key: 'videoStutterNoCopyBody',
    params: (m) => ({ screen: m[1], file: m[2] }),
  },
];

function apply(kind: string, text: string, rules: readonly Rule[], o: NotificationCopyOptions): string | null {
  for (const rule of rules) {
    if (!rule.kinds.includes(kind)) continue;
    const m = rule.re.exec(text);
    if (!m) continue;
    const key = typeof rule.key === 'function' ? rule.key(m) : rule.key;
    return o.t(key, rule.params ? rule.params(m, o) : undefined);
  }
  return null;
}

/**
 * The row as the reader should see it. `title` is always a string; `body`
 * stays null when the row has none. An unrecognised text comes back unchanged
 * (the caller still humanizes any ISO timestamp left in it).
 */
export function localizeNotification(
  n: LocalizableNotification,
  o: NotificationCopyOptions,
): { title: string; body: string | null; titleLocalized: boolean; bodyLocalized: boolean } {
  const title = apply(n.kind, n.title, TITLE_RULES, o);
  const body = n.body ? apply(n.kind, n.body, BODY_RULES, o) : null;
  return {
    title: title ?? n.title,
    body: body ?? (n.body || null),
    titleLocalized: title !== null,
    bodyLocalized: body !== null,
  };
}
