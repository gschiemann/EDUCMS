/**
 * The customer-facing activity feed (2026-10-24) — what the dashboard's
 * "Recent activity" card and the Activity page show.
 *
 * Two jobs, both read-only:
 *
 *   1. WHICH rows. `customerActivityWhere` narrows any audit query to the
 *      allowlist in `@cms/api-types` (`CUSTOMER_ACTIVITY`) and to rows a person
 *      (or the customer's own API key) wrote — an action that sounds human but
 *      was written by a cron or an ops script stays out unless the allowlist
 *      says that action counts with no actor (`actor: 'any'`).
 *
 *   2. WHAT they say. `toActivityItems` resolves each row into names — who did
 *      it, and the playlist / screen / file / person it was about — with a
 *      handful of batched, tenant-scoped reads, and reads the few detail facts
 *      a sentence needs out of the row's JSON. Raw details never travel in the
 *      item (IP addresses, correlation ids, internal ids stay in the row).
 *
 * The full trail is untouched: nothing here deletes or rewrites an audit row,
 * and a SUPER_ADMIN can still read the raw log (`GET /audit?view=all`).
 */
import {
  CUSTOMER_ACTIVITY,
  CUSTOMER_ACTIVITY_ACTIONS,
  CUSTOMER_ACTIVITY_ANY_ACTOR_ACTIONS,
  isCustomerActivityAction,
  type ActivityActor,
  type ActivityFacts,
  type ActivityItem,
} from '@cms/api-types';

/** The columns `toActivityItems` needs. Callers select exactly this. */
export const ACTIVITY_ROW_SELECT = {
  id: true,
  tenantId: true,
  userId: true,
  apiKeyId: true,
  supportGrantId: true,
  action: true,
  targetType: true,
  targetId: true,
  details: true,
  createdAt: true,
  user: { select: { email: true, role: true, firstName: true, lastName: true, tenantId: true } },
} as const;

export interface ActivityRow {
  id: string;
  tenantId: string;
  userId: string | null;
  apiKeyId?: string | null;
  supportGrantId?: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  details: string | null;
  createdAt: Date | string;
  user?: {
    email?: string | null;
    role?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    tenantId?: string | null;
  } | null;
}

/**
 * Narrow an audit `where` to customer activity.
 *
 * `action` is the caller's own action filter, when it has one: it is honoured
 * only if it is on the allowlist. Returns `null` when the filter names an
 * action customers never see — the caller answers with an empty page instead
 * of querying (`{ in: [] }` would work too, but costs a round trip).
 */
export function customerActivityWhere(
  base: Record<string, unknown>,
  action?: string | null,
  category?: string | null,
): Record<string, unknown> | null {
  const wanted = typeof action === 'string' && action.length > 0 ? action : null;
  if (wanted && !isCustomerActivityAction(wanted)) return null;
  // `category` narrows to one shelf of the allowlist (the Activity page's
  // chips); an unknown category is ignored rather than answered empty.
  const inCategory =
    typeof category === 'string' && category.length > 0
      ? CUSTOMER_ACTIVITY_ACTIONS.filter((a) => CUSTOMER_ACTIVITY[a].category === category)
      : [];
  if (wanted && inCategory.length && !inCategory.includes(wanted)) return null;
  const allowed = inCategory.length ? inCategory : [...CUSTOMER_ACTIVITY_ACTIONS];
  const { action: _ignored, ...rest } = base;
  const actorRule = {
    OR: [
      { userId: { not: null } },
      { apiKeyId: { not: null } },
      ...(CUSTOMER_ACTIVITY_ANY_ACTOR_ACTIONS.length
        ? [{ action: { in: [...CUSTOMER_ACTIVITY_ANY_ACTOR_ACTIONS] } }]
        : []),
    ],
  };
  return {
    ...rest,
    action: wanted ?? { in: allowed },
    AND: [actorRule],
  };
}

// ─── Details ──────────────────────────────────────────────────────────────

type Details = Record<string, unknown>;

/** Audit details are a JSON string (sometimes truncated, sometimes not JSON). */
export function parseDetails(raw: string | null | undefined): Details {
  if (!raw || typeof raw !== 'string' || raw.length > 64_000) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Details) : {};
  } catch {
    return {};
  }
}

/** A short display string, or null. Names longer than 120 chars are clipped. */
function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function id(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null;
}

const lower = (s: string | null | undefined) => String(s ?? '').toLowerCase();

/** Which model a row's target lives in (audit target types are not case-stable). */
type Model = 'playlist' | 'template' | 'screen' | 'asset' | 'user' | 'group' | 'tenant';

function modelOfTarget(targetType: string): Model | null {
  switch (lower(targetType)) {
    case 'playlist':
      return 'playlist';
    case 'template':
      return 'template';
    case 'screen':
    case 'device':
      return 'screen';
    case 'asset':
      return 'asset';
    case 'user':
      return 'user';
    case 'screengroup':
    case 'group':
      return 'group';
    case 'tenant':
      return 'tenant';
    default:
      return null;
  }
}

/** The name the row's own details already carry, before any lookup. */
function subjectFromDetails(action: string, d: Details): string | null {
  if (action === 'SPORTS_GAME_CREATED') {
    const home = str(d.homeTeam);
    const away = str(d.awayTeam);
    return home && away ? `${home} vs ${away}` : home ?? away;
  }
  if (action === 'SCREEN_RENAMED') return str(d.to);
  if (action === 'ASSET_UPLOADED' || action.startsWith('ASSET_')) {
    return str(d.originalName) ?? str(d.name) ?? str(d.fileName);
  }
  if (action.startsWith('SCHEDULE_')) return str(d.playlistName);
  if (action.startsWith('USER_') || action === 'INVITE_ACCEPTED') return str(d.email);
  if (action === 'STARTER_BOARD_SEEDED') return str(d.templateName);
  return str(d.name) ?? str(d.playlistName) ?? str(d.screenName) ?? str(d.templateName);
}

/** Facts a sentence needs, per action. Whitelisted — never the raw details. */
function factsFor(action: string, targetType: string, d: Details): ActivityFacts {
  switch (action) {
    case 'PLAYLIST_SCHEDULES_TOGGLED':
    case 'PLAYLIST_SCREEN_TOGGLED':
      return { on: bool(d.active) };
    case 'SCHEDULE_TOGGLED':
      return { on: bool(d.isActive) };
    case 'PLAYLIST_SYNC_PLAYBACK_CHANGED':
      return { on: bool(d.to) };
    case 'PLAYLIST_PUBLISHED_TO_FLEET': {
      const n =
        num(d.locationCount) ??
        num(d.tenantCount) ??
        (Array.isArray(d.tenantIds) ? d.tenantIds.length : null) ??
        (Array.isArray(d.locations) ? d.locations.length : null);
      return { count: n };
    }
    case 'IMPORT_DESIGN':
      return { count: num(d.created) };
    case 'SCREEN_ORIENTATION_CHANGED':
      return { orientation: str(d.to) };
    case 'SCREEN_DISPLAY_CONTROL':
      return { requested: str(d.requested) };
    case 'SCREEN_RENAMED':
      return { from: str(d.from) };
    case 'TRIGGER_EMERGENCY':
    case 'TRIGGER_EMERGENCY_DRILL':
    case 'TRIGGER_SCREEN_EMERGENCY':
    case 'CLEAR_SCREEN_EMERGENCY':
    case 'CLEAR_EMERGENCY':
    case 'CLEAR_EMERGENCY_DRILL':
      return {
        alertType: str(d.type),
        drill: bool(d.isDrill) ?? (action.endsWith('_DRILL') ? true : null),
        scope: lower(targetType) || null,
      };
    case 'PANIC_CONTENT_ASSET_ADDED':
    case 'PANIC_CONTENT_ASSET_REMOVED':
    case 'PANIC_SETTINGS_UPDATED':
    case 'UPDATE_SCREEN_EMERGENCY_CONTENT':
    case 'UPLOAD_SCREEN_EMERGENCY_ASSET':
      return { drill: d.mode === 'drill' ? true : null, alertType: str(d.kind) };
    case 'EMERGENCY_ENABLED_CHANGED': {
      const next = d.next && typeof d.next === 'object' ? (d.next as Details) : {};
      return { on: bool(next.effective) ?? bool(next.emergencyEnabled) };
    }
    case 'LOCATION_BASED_EMERGENCY_TOGGLED':
      return { on: bool(d.enabled) ?? bool(d.to) };
    case 'USB_INGEST_TOGGLED':
      return { on: bool(d.enabled) ?? bool(d.to) };
    case 'USER_ROLE_CHANGED':
      return { role: str(d.toRole) };
    case 'USER_INVITED':
    case 'USER_CREATED':
    case 'USER_CREATED_DIRECT':
      return { role: str(d.role) };
    case 'MFA_EMAIL_CODE_SUCCESS':
      return { device: str(d.device) };
    case 'PASSKEY_REGISTERED':
      return { label: str(d.label) };
    default:
      return {};
  }
}

// ─── Names ────────────────────────────────────────────────────────────────

/** First name, else full name, else the email's local part. */
export function personName(user: ActivityRow['user']): string | null {
  if (!user) return null;
  const first = str(user.firstName);
  if (first) return first;
  const last = str(user.lastName);
  if (last) return last;
  const email = str(user.email);
  if (!email) return null;
  const local = email.split('@')[0];
  return local || null;
}

function actorOf(row: ActivityRow): ActivityActor {
  // Work done under a support grant, or by a VenueOS super admin inside a
  // customer organisation that is not their own home, is VenueOS support's —
  // and that is what the customer reads. The viewer still sees "You" for
  // their own rows (the dashboard compares userId).
  if (row.supportGrantId) return { kind: 'support', userId: row.userId ?? null, name: null };
  if (row.user && row.user.role === 'SUPER_ADMIN' && row.user.tenantId && row.user.tenantId !== row.tenantId) {
    return { kind: 'support', userId: row.userId ?? null, name: null };
  }
  if (row.userId) return { kind: 'person', userId: row.userId, name: personName(row.user ?? null) };
  if (row.apiKeyId) return { kind: 'apiKey', userId: null, name: null };
  return { kind: 'system', userId: null, name: null };
}

/** What each row still needs looked up, by model. */
interface Wants {
  subject: { model: Model; id: string } | null;
  target: { model: Model; id: string } | null;
  /** The subject phrase for a schedule row comes from its playlist. */
}

function wantsFor(row: ActivityRow, d: Details, subject: string | null): Wants {
  const action = row.action;
  const out: Wants = { subject: null, target: null };

  // Schedule rows are ABOUT a playlist and point AT a screen or a group.
  if (action.startsWith('SCHEDULE_') || action === 'DISPLAY_SCHEDULE_CREATED') {
    const pl = id(d.playlistId);
    if (!subject && pl && action.startsWith('SCHEDULE_')) out.subject = { model: 'playlist', id: pl };
    const scr = id(d.screenId);
    const grp = id(d.screenGroupId);
    if (scr) out.target = { model: 'screen', id: scr };
    else if (grp) out.target = { model: 'group', id: grp };
    return out;
  }
  if (action === 'PLAYLIST_SCREEN_REMOVED' || action === 'PLAYLIST_SCREEN_TOGGLED') {
    if (!subject && row.targetId) out.subject = { model: 'playlist', id: row.targetId };
    const scr = id(d.screenId);
    if (!str(d.screenName) && scr) out.target = { model: 'screen', id: scr };
    return out;
  }
  if (action === 'SCREEN_MOVED') {
    if (!subject && row.targetId) out.subject = { model: 'screen', id: row.targetId };
    const grp = id(d.toGroupId);
    if (!str(d.toGroupName) && grp) out.target = { model: 'group', id: grp };
    return out;
  }
  if (action === 'TRIGGER_EMERGENCY' || action === 'TRIGGER_EMERGENCY_DRILL' || action === 'CLEAR_EMERGENCY' || action === 'CLEAR_EMERGENCY_DRILL') {
    // Scope: 'tenant' (everywhere) needs no name; a group or one screen does.
    const scope = lower(row.targetType);
    if (row.targetId && scope === 'group') out.target = { model: 'group', id: row.targetId };
    if (row.targetId && scope === 'device') out.target = { model: 'screen', id: row.targetId };
    return out;
  }
  // Rows whose details carry no usable name: look the target up.
  if (!subject && row.targetId) {
    const model = modelOfTarget(row.targetType);
    // A tenant row is the organisation itself for most actions; only a
    // child-location row names one.
    if (model && (model !== 'tenant' || action.startsWith('CHILD_TENANT_'))) {
      out.subject = { model, id: row.targetId };
    }
  }
  return out;
}

/** The second name a row's details already carry. */
function targetFromDetails(action: string, d: Details): string | null {
  if (action === 'PLAYLIST_SCREEN_REMOVED' || action === 'PLAYLIST_SCREEN_TOGGLED') return str(d.screenName);
  if (action === 'SCREEN_MOVED') return str(d.toGroupName);
  if (action.startsWith('SCHEDULE_')) return str(d.screenName) ?? str(d.screenGroupName);
  return null;
}

function targetKeyFor(action: string, d: Details, row: ActivityRow): string | null {
  if (action.startsWith('SCHEDULE_') || action === 'DISPLAY_SCHEDULE_CREATED') {
    return id(d.screenId) ?? id(d.screenGroupId);
  }
  if (action === 'PLAYLIST_SCREEN_REMOVED' || action === 'PLAYLIST_SCREEN_TOGGLED') return id(d.screenId);
  if (action === 'REFRESH_WEB' || action === 'SCREEN_DISPLAY_CONTROL') return row.targetId;
  return null;
}

/** Batched lookups: one indexed read per model that is actually needed. */
async function lookupNames(
  prisma: any,
  tenantIds: string[],
  want: Map<Model, Set<string>>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const key = (m: Model, i: string) => `${m}:${i}`;
  const ids = (m: Model) => [...(want.get(m) ?? [])].slice(0, 200);
  const tenantScope = { in: tenantIds };
  const reads: Array<Promise<void>> = [];
  const read = (m: Model, run: () => Promise<Array<Record<string, any>>>, name: (r: Record<string, any>) => string | null) => {
    if (!ids(m).length) return;
    reads.push(
      run()
        .then((rows) => {
          for (const r of rows ?? []) {
            const n = name(r);
            if (n && r.id) out.set(key(m, r.id), n);
          }
        })
        .catch(() => undefined),
    );
  };
  const c = prisma?.client;
  read('playlist', () => c.playlist.findMany({ where: { id: { in: ids('playlist') }, tenantId: tenantScope }, select: { id: true, name: true } }), (r) => str(r.name));
  read('template', () => c.template.findMany({ where: { id: { in: ids('template') }, tenantId: tenantScope }, select: { id: true, name: true } }), (r) => str(r.name));
  read('screen', () => c.screen.findMany({ where: { id: { in: ids('screen') }, tenantId: tenantScope }, select: { id: true, name: true } }), (r) => str(r.name));
  read('asset', () => c.asset.findMany({ where: { id: { in: ids('asset') }, tenantId: tenantScope }, select: { id: true, originalName: true } }), (r) => str(r.originalName));
  read('group', () => c.screenGroup.findMany({ where: { id: { in: ids('group') }, tenantId: tenantScope }, select: { id: true, name: true } }), (r) => str(r.name));
  read('user', () => c.user.findMany({ where: { id: { in: ids('user') }, tenantId: tenantScope }, select: { id: true, email: true } }), (r) => str(r.email));
  read('tenant', () => c.tenant.findMany({ where: { id: { in: ids('tenant') } }, select: { id: true, name: true } }), (r) => str(r.name));
  await Promise.all(reads);
  return out;
}

/**
 * Rows → customer-facing items, newest first as given. A failed lookup only
 * costs a name (the dashboard then says "a playlist"), never the row.
 */
export async function toActivityItems(prisma: any, input: ActivityRow[]): Promise<ActivityItem[]> {
  // Defensive about shape: a row without an action or target type is still a
  // row (it renders as a generic line), never a crash of the whole page.
  const rows = (input ?? []).map((r) => ({
    ...r,
    action: typeof r?.action === 'string' ? r.action : '',
    targetType: typeof r?.targetType === 'string' ? r.targetType : '',
  }));
  const parsed = rows.map((row) => {
    const d = parseDetails(row.details);
    const subject = subjectFromDetails(row.action, d);
    return { row, d, subject, wants: wantsFor(row, d, subject) };
  });

  const want = new Map<Model, Set<string>>();
  const add = (w: { model: Model; id: string } | null) => {
    if (!w) return;
    const set = want.get(w.model) ?? new Set<string>();
    set.add(w.id);
    want.set(w.model, set);
  };
  for (const p of parsed) {
    add(p.wants.subject);
    add(p.wants.target);
  }
  const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter(Boolean))];
  const names = want.size ? await lookupNames(prisma, tenantIds, want) : new Map<string, string>();
  const named = (w: { model: Model; id: string } | null) => (w ? names.get(`${w.model}:${w.id}`) ?? null : null);

  return parsed.map(({ row, d, subject, wants }) => ({
    id: row.id,
    action: row.action,
    category: CUSTOMER_ACTIVITY[row.action]?.category ?? 'settings',
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    targetType: row.targetType,
    targetId: row.targetId ?? null,
    actor: actorOf(row),
    subject: subject ?? named(wants.subject),
    target: targetFromDetails(row.action, d) ?? named(wants.target),
    targetKey: targetKeyFor(row.action, d, row),
    facts: factsFor(row.action, row.targetType, d),
  }));
}
