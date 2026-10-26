/**
 * Customer-facing activity → sentences (2026-10-24).
 *
 * The owner, on his phone: "These alerts don't seem like user activity … just
 * alerts that make sense to an end user." The Home card printed audit rows as
 * title-cased action names ("Field Build Window Expire · field_build_window").
 * The API now returns only the customer allowlist (`@cms/api-types`
 * CUSTOMER_ACTIVITY), with names resolved; this module turns those items into
 * what a person would say:
 *
 *     "You published “Lobby loop” to 3 screens"
 *     "Maria started a Hold drill on “Front desk”"
 *     "VenueOS support added the location “Downtown”"
 *
 * Two pure steps, both unit-tested (`__tests__/activityFeed.test.ts`):
 *
 *   groupActivity — one sitting is one line. Publishing a playlist to three
 *     screens writes three audit rows (and the wizard writes "created" and
 *     "content set" rows before them); uploading eight files writes eight.
 *     Consecutive rows by the same person, of the same kind, within ten
 *     minutes, become one line with a count. A setting flipped back and forth
 *     (orientation, pause / resume) reads as its final state.
 *
 *   describeActivity — the sentence, the icon and the colour for a group, in
 *     the reader's language (`activityFeed.*` in en / es / zh). "You" when the
 *     row is the reader's own; "VenueOS support" when our staff did it.
 *
 * No React, no DOM, no network.
 */
import type { ActivityCategory, ActivityItem } from '@cms/api-types';

export type { ActivityItem };

/** Ten minutes: the longest a single sitting (a publish wizard, an upload batch) takes. */
export const GROUP_WINDOW_MS = 10 * 60_000;

export interface ActivityGroup {
  /** Stable React key: the newest item's id. */
  key: string;
  /** The newest item — its actor, time and facts speak for the line. */
  head: ActivityItem;
  /** Every item folded into the line, newest first. */
  items: ActivityItem[];
  /** How many THINGS the line covers (screens published to, files uploaded). */
  count: number;
  /** The playlist was also created in the same sitting (the publish wizard). */
  createdToo: boolean;
}

const at = (i: ActivityItem) => {
  const t = Date.parse(i.createdAt);
  return Number.isFinite(t) ? t : 0;
};

const actorKey = (i: ActivityItem) => `${i.actor?.kind ?? 'system'}:${i.actor?.userId ?? ''}`;

/** Rows that collapse to their newest state (a toggle flipped twice is one change). */
const LATEST_WINS = new Set([
  'SCREEN_ORIENTATION_CHANGED',
  'PLAYLIST_SCHEDULES_TOGGLED',
  'PLAYLIST_SCREEN_TOGGLED',
  'SCHEDULE_TOGGLED',
  'PLAYLIST_SYNC_PLAYBACK_CHANGED',
  'EMERGENCY_ENABLED_CHANGED',
  'LOCATION_BASED_EMERGENCY_TOGGLED',
  'USB_INGEST_TOGGLED',
  'TEMPLATE_UPDATED',
  'PLAYLIST_UPDATED',
  'PLAYLIST_ITEMS_REPLACED',
  'TENANT_UPDATED',
  'ADOPT_BRANDING',
  'ADOPT_BRANDING_MANUAL',
  'SCREEN_DEVICE_SETTINGS_CHANGED',
  'DISPLAY_SCHEDULE_UPDATED',
  'MENU_OVERRIDE_SET',
  'MENU_OVERRIDE_BULK',
]);

/** Rows that add up across different things ("uploaded 5 files", "resynced 3 screens"). */
const COUNTED = new Set(['ASSET_UPLOADED', 'ASSET_DELETED', 'ASSET_APPROVED', 'ASSET_REJECTED', 'REFRESH_WEB', 'SCREEN_DISPLAY_CONTROL']);

/** What makes two consecutive rows "the same thing, again". */
function mergeKey(i: ActivityItem): string {
  if (i.action === 'SCHEDULE_CREATED') return `pub:${i.subject ?? ''}`;
  if (i.action === 'SCREEN_DISPLAY_CONTROL') return `${i.action}:${i.facts?.requested ?? ''}`;
  if (COUNTED.has(i.action)) return i.action;
  if (LATEST_WINS.has(i.action)) return `${i.action}:${i.subject ?? i.targetId ?? ''}`;
  return `${i.action}:${i.subject ?? ''}:${i.target ?? ''}:${JSON.stringify(i.facts ?? {})}`;
}

/** The thing a counted row is about, for counting distinct ones. */
function thingOf(i: ActivityItem): string {
  return i.targetKey ?? i.targetId ?? i.target ?? i.subject ?? i.id;
}

export function groupActivity(items: readonly ActivityItem[] | null | undefined): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const item of items ?? []) {
    if (!item || typeof item.action !== 'string') continue;
    const last = groups[groups.length - 1];
    const lastOldest = last ? at(last.items[last.items.length - 1]) : 0;
    const near = last && Math.abs(lastOldest - at(item)) <= GROUP_WINDOW_MS && actorKey(last.head) === actorKey(item);

    // The publish wizard writes "created" and "content set" just before the
    // publish rows: they are steps of the same sitting, not separate news.
    if (
      near &&
      last.head.action === 'SCHEDULE_CREATED' &&
      (item.action === 'PLAYLIST_ITEMS_REPLACED' || item.action === 'PLAYLIST_CREATED') &&
      !!item.subject &&
      item.subject === last.head.subject
    ) {
      last.items.push(item);
      if (item.action === 'PLAYLIST_CREATED') last.createdToo = true;
      continue;
    }
    if (near && mergeKey(last.head) === mergeKey(item)) {
      last.items.push(item);
      continue;
    }
    groups.push({ key: item.id, head: item, items: [item], count: 1, createdToo: false });
  }
  for (const g of groups) {
    const counted = g.items.filter((i) => i.action === g.head.action);
    g.count = g.head.action === 'SCHEDULE_CREATED' || COUNTED.has(g.head.action)
      ? new Set(counted.map(thingOf)).size
      : 1;
  }
  return groups;
}

// ─── Sentences ──────────────────────────────────────────────────────────

/** A translator scoped to `activityFeed` (next-intl's `useTranslations('activityFeed')`). */
export type ActivityTranslate = (key: string, values?: Record<string, string | number>) => string;

export type ActivityIcon =
  | 'playlist' | 'publish' | 'pause' | 'play' | 'upload' | 'trash' | 'approve' | 'reject' | 'template'
  | 'import' | 'ai' | 'usb' | 'screen' | 'pair' | 'rename' | 'move' | 'rotate' | 'power' | 'resync'
  | 'clock' | 'map' | 'siren' | 'drill' | 'allClear' | 'message' | 'invite' | 'joined' | 'role'
  | 'removePerson' | 'key' | 'signIn' | 'support' | 'settings' | 'brand' | 'location' | 'plug'
  | 'billing' | 'sports' | 'menu' | 'shield';

export type ActivityTone = 'brand' | 'sky' | 'rose' | 'amber' | 'violet' | 'emerald' | 'slate';

export interface ActivityLine {
  text: string;
  icon: ActivityIcon;
  tone: ActivityTone;
  category: ActivityCategory;
}

/** Nouns used when a row has no name to show (a deleted playlist, an old row). */
type Noun = 'playlist' | 'screen' | 'file' | 'template' | 'person' | 'location' | 'group' | 'folder' | 'apiKey' | 'webhook' | 'sponsor' | 'game' | 'passkey';

interface Rule {
  icon: ActivityIcon;
  /** What `{subject}` falls back to when the row carries no name. */
  noun?: Noun;
  /**
   * 'noun' — the subject reads "the playlist “Lobby loop”" (created, deleted,
   * paired…); default — the bare name, "“Lobby loop”", where the verb already
   * says what it is (published, paused, uploaded…).
   */
  form?: 'noun';
  /** The variant key under `a.<ACTION>`, when the action has more than one sentence. */
  variant?: (g: ActivityGroup) => string;
  tone?: ActivityTone;
}

/** On / off / unknown — an unknown switch never reads as "on". */
const onOff = (g: ActivityGroup) => (g.head.facts?.on === true ? 'on' : g.head.facts?.on === false ? 'off' : 'changed');
const oneMany = (g: ActivityGroup) => (g.count > 1 ? 'many' : 'one');

const RULES: Record<string, Rule> = {
  // Content
  PLAYLIST_CREATED: { icon: 'playlist', noun: 'playlist', form: 'noun' },
  PLAYLIST_UPDATED: { icon: 'playlist', noun: 'playlist', form: 'noun' },
  PLAYLIST_ITEMS_REPLACED: { icon: 'playlist', noun: 'playlist' },
  PLAYLIST_DELETED: { icon: 'trash', noun: 'playlist', form: 'noun' },
  PLAYLIST_SCHEDULES_TOGGLED: { icon: 'pause', noun: 'playlist', variant: onOff },
  PLAYLIST_SCREEN_REMOVED: { icon: 'publish', noun: 'playlist' },
  PLAYLIST_SCREEN_TOGGLED: { icon: 'pause', noun: 'playlist', variant: onOff },
  PLAYLIST_SYNC_PLAYBACK_CHANGED: { icon: 'playlist', noun: 'playlist', variant: onOff },
  PLAYLIST_PUBLISHED_TO_FLEET: { icon: 'publish', noun: 'playlist' },
  SCHEDULE_CREATED: {
    icon: 'publish',
    noun: 'playlist',
    variant: (g) => {
      if (g.count > 1) return g.createdToo ? 'createdMany' : 'many';
      if (!g.head.target) return g.createdToo ? 'createdNone' : 'none';
      return g.createdToo ? 'createdOne' : 'one';
    },
  },
  SCHEDULE_UPDATED: { icon: 'clock', noun: 'playlist' },
  SCHEDULE_DELETED: { icon: 'publish', noun: 'playlist', variant: (g) => (g.head.target ? 'one' : 'none') },
  SCHEDULE_TOGGLED: { icon: 'pause', noun: 'playlist', variant: onOff },
  ASSET_UPLOADED: { icon: 'upload', noun: 'file', variant: oneMany },
  ASSET_DELETED: { icon: 'trash', noun: 'file', variant: oneMany },
  ASSET_APPROVED: { icon: 'approve', noun: 'file', variant: oneMany },
  ASSET_REJECTED: { icon: 'reject', noun: 'file', variant: oneMany },
  ASSET_FOLDER_DELETED: { icon: 'trash', noun: 'folder', form: 'noun' },
  AI_IMAGE_GENERATED: { icon: 'ai' },
  TEMPLATE_CREATED: { icon: 'template', noun: 'template', form: 'noun' },
  TEMPLATE_UPDATED: { icon: 'template', noun: 'template', form: 'noun' },
  TEMPLATE_DELETED: { icon: 'trash', noun: 'template', form: 'noun' },
  TEMPLATE_IMPORTED: { icon: 'import' },
  IMPORT_DESIGN: { icon: 'import' },
  SUBMISSION_CREATED: { icon: 'approve' },
  USB_BUNDLE_EXPORTED: { icon: 'usb' },
  // Screens
  SCREEN_PAIRED: { icon: 'pair', noun: 'screen', form: 'noun' },
  SCREEN_RENAMED: { icon: 'rename', noun: 'screen', variant: (g) => (g.head.facts?.from ? 'from' : 'plain') },
  SCREEN_MOVED: { icon: 'move', noun: 'screen', variant: (g) => (g.head.target ? 'group' : 'ungrouped') },
  SCREEN_DELETED: { icon: 'trash', noun: 'screen', form: 'noun' },
  SCREEN_ORIENTATION_CHANGED: {
    icon: 'rotate',
    noun: 'screen',
    variant: (g) => {
      const o = String(g.head.facts?.orientation ?? '').toUpperCase();
      return o === 'PORTRAIT' ? 'portrait' : o === 'LANDSCAPE' ? 'landscape' : 'auto';
    },
  },
  SCREEN_DISPLAY_CONTROL: {
    icon: 'power',
    noun: 'screen',
    variant: (g) => {
      const r = String(g.head.facts?.requested ?? '').toUpperCase();
      const verb =
        r === 'POWER_OFF' ? 'off' : r === 'POWER_ON' ? 'on' : r === 'BLANK' ? 'blank' : r === 'WAKE' ? 'wake'
          : r === 'REBOOT' ? 'restart' : r === 'SET_BRIGHTNESS' ? 'brightness' : r === 'SET_VOLUME' ? 'volume' : 'other';
      return `${verb}${g.count > 1 ? 'Many' : ''}`;
    },
  },
  SCREEN_DEVICE_SETTINGS_CHANGED: { icon: 'settings', noun: 'screen' },
  SCREEN_FACE_ADDED: { icon: 'screen', noun: 'screen' },
  SCREEN_GROUP_DELETED: { icon: 'trash', noun: 'group', form: 'noun' },
  REFRESH_WEB: { icon: 'resync', noun: 'screen', variant: oneMany },
  DISPLAY_SCHEDULE_CREATED: { icon: 'clock', variant: (g) => (g.head.target ? 'target' : 'all') },
  DISPLAY_SCHEDULE_UPDATED: { icon: 'clock' },
  DISPLAY_SCHEDULE_DELETED: { icon: 'clock' },
  CREATE_FLOOR_PLAN: { icon: 'map' },
  DELETE_FLOOR_PLAN: { icon: 'map' },
  REPLACE_FLOOR_PLAN_IMAGE: { icon: 'map' },
  // Emergency
  TRIGGER_EMERGENCY: { icon: 'siren', tone: 'rose', variant: (g) => (g.head.target ? 'target' : 'all') },
  CLEAR_EMERGENCY: { icon: 'allClear', tone: 'emerald', variant: (g) => (g.head.target ? 'target' : 'all') },
  TRIGGER_EMERGENCY_DRILL: { icon: 'drill', tone: 'amber', variant: (g) => (g.head.target ? 'target' : 'all') },
  CLEAR_EMERGENCY_DRILL: { icon: 'allClear', tone: 'amber', variant: (g) => (g.head.target ? 'target' : 'all') },
  DRILL_ENDED_BY_LIVE_ALERT: { icon: 'siren', tone: 'rose' },
  TRIGGER_SCREEN_EMERGENCY: { icon: 'siren', tone: 'rose', noun: 'screen' },
  CLEAR_SCREEN_EMERGENCY: { icon: 'allClear', tone: 'emerald', noun: 'screen' },
  BROADCAST_TEXT: { icon: 'message', tone: 'rose' },
  MEDIA_ALERT: { icon: 'siren', tone: 'rose' },
  CLEAR_EMERGENCY_MESSAGE: { icon: 'allClear', tone: 'emerald' },
  SOS_TRIGGER: { icon: 'siren', tone: 'rose' },
  EMERGENCY_ENABLED_CHANGED: { icon: 'shield', variant: onOff },
  LOCATION_BASED_EMERGENCY_TOGGLED: { icon: 'shield', variant: onOff },
  PANIC_SETTINGS_UPDATED: { icon: 'shield', variant: (g) => (g.head.facts?.drill ? 'drill' : 'live') },
  PANIC_CONTENT_ASSET_ADDED: { icon: 'shield', variant: (g) => (g.head.facts?.drill ? 'drill' : 'live') },
  PANIC_CONTENT_ASSET_REMOVED: { icon: 'shield', variant: (g) => (g.head.facts?.drill ? 'drill' : 'live') },
  UPDATE_SCREEN_EMERGENCY_CONTENT: { icon: 'shield', noun: 'screen' },
  UPLOAD_SCREEN_EMERGENCY_ASSET: { icon: 'shield' },
  USER_CAN_TRIGGER_PANIC_CHANGED: { icon: 'shield' },
  // Team
  USER_INVITED: { icon: 'invite', noun: 'person' },
  INVITE_ACCEPTED: { icon: 'joined' },
  USER_CREDENTIAL_SETUP_COMPLETED: { icon: 'joined' },
  USER_CREATED: { icon: 'invite', noun: 'person' },
  USER_CREATED_DIRECT: { icon: 'invite', noun: 'person' },
  USER_ROLE_CHANGED: { icon: 'role', noun: 'person', variant: (g) => (roleKey(g.head.facts?.role) ? 'to' : 'plain') },
  USER_DISABLED: { icon: 'removePerson', noun: 'person' },
  USER_ENABLED: { icon: 'joined', noun: 'person' },
  USER_DELETED: { icon: 'removePerson', noun: 'person' },
  USER_ACCESS_UPDATED: { icon: 'role', noun: 'person' },
  USER_MFA_REQUIRED_CHANGED: { icon: 'key', noun: 'person' },
  USER_MFA_RESET: { icon: 'key', noun: 'person' },
  USER_EMAIL_CHANGED: { icon: 'role', noun: 'person' },
  // Security
  MFA_EMAIL_CODE_SUCCESS: { icon: 'signIn', variant: (g) => (deviceKey(g.head.facts?.device) ? 'device' : 'plain') },
  PASSKEY_REGISTERED: { icon: 'key', variant: (g) => (g.head.facts?.label ? 'label' : 'plain') },
  PASSKEY_REMOVED: { icon: 'key' },
  PASSWORD_CHANGED: { icon: 'key' },
  PASSWORD_RESET_COMPLETED: { icon: 'key' },
  'mfa.enabled': { icon: 'key' },
  'mfa.disabled': { icon: 'key' },
  TENANT_MFA_POLICY_CHANGED: { icon: 'key' },
  SUPPORT_ACCESS_INVITED: { icon: 'support' },
  SUPPORT_ACCESS_REQUESTED: { icon: 'support' },
  SUPPORT_ACCESS_APPROVED: { icon: 'support' },
  SUPPORT_ACCESS_DENIED: { icon: 'support' },
  SUPPORT_ACCESS_REVOKED: { icon: 'support', variant: (g) => (g.head.actor?.kind === 'person' ? 'byPerson' : 'ended') },
  SUPPORT_ACCESS_WITHDRAWN: { icon: 'support' },
  SUPPORT_ACCESS_EXPIRED: { icon: 'support' },
  SUPPORT_ACCESS_BREAK_GLASS: { icon: 'support', tone: 'rose' },
  // Settings
  TENANT_SIGNUP: { icon: 'settings' },
  TENANT_UPDATED: { icon: 'settings' },
  TENANT_POSTER_STANDARD_CHANGED: { icon: 'settings' },
  CHILD_TENANT_CREATED: { icon: 'location', noun: 'location', form: 'noun' },
  CHILD_TENANT_DELETED: { icon: 'location', noun: 'location', form: 'noun' },
  ADOPT_BRANDING: { icon: 'brand' },
  ADOPT_BRANDING_MANUAL: { icon: 'brand' },
  REVERT_BRANDING: { icon: 'brand' },
  BRANDING_VOICE_UPDATED: { icon: 'brand' },
  BRANDING_APPLY_TO_TEMPLATES: { icon: 'brand' },
  BRANDING_APPEARANCE_MODE_CHANGED: { icon: 'brand' },
  SSO_CONFIG_UPSERT: { icon: 'key' },
  SSO_CONFIG_DELETE: { icon: 'key' },
  AI_KEY_SET: { icon: 'ai' },
  AI_KEY_CLEARED: { icon: 'ai' },
  AI_KEY_MODEL_CHANGED: { icon: 'ai' },
  API_KEY_CREATED: { icon: 'plug', noun: 'apiKey', form: 'noun' },
  API_KEY_REVOKED: { icon: 'plug' },
  WEBHOOK_CREATED: { icon: 'plug', noun: 'webhook', form: 'noun' },
  WEBHOOK_DELETED: { icon: 'plug' },
  USB_INGEST_TOGGLED: { icon: 'usb', variant: onOff },
  STUDENT_PRIVACY_SERVES_MINORS_SET: { icon: 'shield' },
  // Integrations
  POS_CONNECTION_CREATED: { icon: 'plug' },
  POS_CONNECTION_DELETED: { icon: 'plug' },
  SOCIAL_CONNECTION_CREATED: { icon: 'plug' },
  SOCIAL_CONNECTION_REVOKED: { icon: 'plug' },
  STREAM_CONNECTION_DELETED: { icon: 'plug' },
  AD_CONNECTION_DELETED: { icon: 'plug' },
  CLEVER_DISCONNECTED: { icon: 'plug' },
  // Billing
  BILLING_SEATS_CHANGED: { icon: 'billing' },
  BILLING_AI_PLAN_CHANGED: { icon: 'billing' },
  BILLING_TRIAL_STARTED: { icon: 'billing' },
  LICENSE_UPSERT: { icon: 'billing' },
  LICENSE_STATUS_CHANGED: { icon: 'billing' },
  AI_BOARD_PACK_PURCHASED: { icon: 'billing' },
  // Sports
  SPORTS_GAME_CREATED: { icon: 'sports', noun: 'game', form: 'noun' },
  SPORTS_SCREENS_SHOWN: { icon: 'sports' },
  SPONSOR_CREATED: { icon: 'sports', noun: 'sponsor', form: 'noun' },
  SPONSOR_UPDATED: { icon: 'sports', noun: 'sponsor', form: 'noun' },
  SPONSOR_DELETED: { icon: 'sports', noun: 'sponsor', form: 'noun' },
  SPORTS_ROSTER_PRIVACY_SET: { icon: 'shield' },
  SPORTS_STUDENT_PRIVACY_FLAGS_SET: { icon: 'shield' },
  // Menus
  MENU_OVERRIDE_SET: { icon: 'menu' },
  MENU_OVERRIDE_BULK: { icon: 'menu' },
  MENU_OVERRIDE_REVERT: { icon: 'menu' },
  MENU_IMPORT_OPERATOR: { icon: 'menu' },
};

/** Actions the dashboard can word. Anything else (an older client) is skipped, never title-cased. */
export function hasSentence(action: string): boolean {
  return Object.prototype.hasOwnProperty.call(RULES, action);
}

const CATEGORY_TONE: Record<ActivityCategory, ActivityTone> = {
  content: 'brand',
  screens: 'sky',
  emergency: 'rose',
  team: 'violet',
  security: 'slate',
  settings: 'slate',
  integrations: 'emerald',
  billing: 'amber',
  sports: 'amber',
  menus: 'amber',
};

const ALERT_KEYS: Record<string, string> = {
  LOCKDOWN: 'lockdown',
  EVACUATE: 'evacuate',
  EVACUATION: 'evacuate',
  FIRE: 'evacuate',
  WEATHER: 'weather',
  SHELTER: 'weather',
  HOLD: 'hold',
  SECURE: 'secure',
  MEDICAL: 'medical',
};

function roleKey(role: unknown): string | null {
  const r = String(role ?? '').toUpperCase();
  return ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER'].includes(r) ? r : null;
}

/**
 * The server names a new sign-in's device in English from a closed set
 * (`deviceNameFromUserAgent`, apps/api/src/auth/mfa-email-code.ts); each maps
 * to `activityFeed.device.*` so a Spanish or Chinese reader never sees
 * "a Windows PC". An unknown name drops the device rather than leak English.
 */
const DEVICE_KEYS: Record<string, string> = {
  'an iPhone': 'iphone',
  'an iPad': 'ipad',
  'an Android phone': 'android',
  'a Mac': 'mac',
  'a Windows PC': 'windows',
  'a Chromebook': 'chromebook',
  'a Linux computer': 'linux',
  'a web browser': 'browser',
};

function deviceKey(device: unknown): string | null {
  return typeof device === 'string' ? DEVICE_KEYS[device] ?? null : null;
}

/** Actions whose `{target}` is a screen, so a missing name still reads "a screen". */
const TARGET_IS_SCREEN = new Set(['PLAYLIST_SCREEN_REMOVED', 'PLAYLIST_SCREEN_TOGGLED', 'SCHEDULE_TOGGLED', 'SCHEDULE_DELETED']);

export interface DescribeOptions {
  t: ActivityTranslate;
  /** The signed-in person's user id — their own rows read "You". */
  viewerId?: string | null;
}

/** Who did it, as the reader should see it. */
function actorText(i: ActivityItem, o: DescribeOptions): string {
  const a = i.actor;
  if (!a) return o.t('actor.system');
  if (a.userId && o.viewerId && a.userId === o.viewerId) return o.t('actor.you');
  if (a.kind === 'support') return o.t('actor.support');
  if (a.kind === 'apiKey') return o.t('actor.apiKey');
  if (a.kind === 'person') return a.name ? a.name : o.t('actor.someone');
  return o.t('actor.system');
}

/**
 * The `{subject}` phrase: "the playlist “Lobby loop”" (noun form), "“Lobby
 * loop”" (bare), a person's name or email as is, or — with no name at all —
 * "a playlist".
 */
function subjectText(name: string | null | undefined, rule: Rule, o: DescribeOptions): string {
  const noun = rule.noun ?? 'thing';
  if (!name) return o.t(`noun.${noun}`);
  if (noun === 'person') return name;
  if (rule.form === 'noun' && noun !== 'thing' && noun !== 'passkey') return o.t(`subj.${noun}`, { name });
  return o.t('quote', { name });
}

/** The sentence, icon and colour for one line. Null for an action this client cannot word. */
export function describeActivity(g: ActivityGroup, o: DescribeOptions): ActivityLine | null {
  const head = g.head;
  const rule = RULES[head.action];
  if (!rule) return null;
  const key = `a.${head.action}${rule.variant ? `.${rule.variant(g)}` : ''}`;

  const alertKey = ALERT_KEYS[String(head.facts?.alertType ?? '').toUpperCase()];
  const values: Record<string, string | number> = {
    actor: actorText(head, o),
    subject: subjectText(head.subject, rule, o),
    target: head.target
      ? o.t('quote', { name: head.target })
      : TARGET_IS_SCREEN.has(head.action) ? o.t('noun.screen') : '',
    count: g.count,
    alert: alertKey ? o.t(`alert.${alertKey}`) : o.t('alert.other'),
  };
  const role = roleKey(head.facts?.role);
  if (role) values.role = o.t(`role.${role}`);
  const device = deviceKey(head.facts?.device);
  if (device) values.device = o.t(`device.${device}`);
  if (head.facts?.label) values.label = String(head.facts.label);
  if (head.facts?.from) values.from = o.t('quote', { name: String(head.facts.from) });

  let text: string;
  try {
    text = o.t(key, values);
  } catch {
    return null;
  }
  const drill = !!head.facts?.drill || head.action.endsWith('_DRILL');
  const tone: ActivityTone = rule.tone ?? (head.category === 'emergency' && drill ? 'amber' : CATEGORY_TONE[head.category] ?? 'slate');
  return { text, icon: rule.icon, tone, category: head.category };
}

/** Group, then word; lines this client cannot word are dropped (never shown raw). */
export function activityLines(
  items: readonly ActivityItem[] | null | undefined,
  o: DescribeOptions,
): Array<ActivityLine & { key: string; at: string; group: ActivityGroup }> {
  const out: Array<ActivityLine & { key: string; at: string; group: ActivityGroup }> = [];
  for (const g of groupActivity(items)) {
    const line = describeActivity(g, o);
    if (line) out.push({ ...line, key: g.key, at: g.head.createdAt, group: g });
  }
  return out;
}
