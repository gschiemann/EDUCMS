/**
 * Customer-facing activity and notifications (2026-10-24).
 *
 * Greg, looking at the dashboard on his phone: "These alerts don't seem like
 * user activity which I thought we were keeping the dashboard to only app
 * activity not backend activity … just alerts that make sense to an end
 * user." The Home "Recent Activity" card was printing raw audit rows —
 * "Field Build Window Expire · field_build_window", "Ota Push Held · screen",
 * "Player Field Apk Offer · screen" — and the bell counted 31, 19 of them a
 * daily "realtime channel down" nag about one screen.
 *
 * The rule is an ALLOWLIST, never a blocklist: an audit action reaches a
 * customer only when it is named here. Every new backend action (OTA, field
 * builds, tokens, credentials, key rotation, telemetry, recovery machinery,
 * cron sweeps) is therefore invisible to customers on the day it is written,
 * without anyone remembering to hide it. The blocklist this replaces had to be
 * extended twice in one week and still leaked.
 *
 * Shared by the API (which FILTERS on it: `GET /audit/recent`, and `GET /audit`
 * + `GET /audit/export` for everyone but a SUPER_ADMIN asking for the raw log)
 * and the dashboard (which turns each allowed row into a sentence). Nothing is
 * deleted: the full trail stays in the database and in the owner's raw view.
 */

/** What an activity row is about — drives the icon and the colour. */
export type ActivityCategory =
  | 'content'
  | 'screens'
  | 'emergency'
  | 'team'
  | 'security'
  | 'settings'
  | 'integrations'
  | 'billing'
  | 'sports'
  | 'menus';

export interface CustomerActivityRule {
  category: ActivityCategory;
  /**
   * Who may have written the row for it to count as customer activity.
   *   'person' (default) — a person (or the customer's own API key) did it.
   *            A row with no actor is machinery even when the action name
   *            sounds human (an ops script pushing a REFRESH_WEB, a cron
   *            re-activating a schedule), so it stays out.
   *   'any'   — the event matters to the customer whoever caused it (a drill
   *            ended by a real alert, support access expiring, the plan
   *            changing after a payment).
   */
  actor?: 'person' | 'any';
}

const person = (category: ActivityCategory): CustomerActivityRule => ({ category });
const any = (category: ActivityCategory): CustomerActivityRule => ({ category, actor: 'any' });

/**
 * THE ALLOWLIST. Action → category. Keep it to things an operator would
 * recognise as something they, their team, or VenueOS support did for them.
 *
 * Deliberately NOT here (owner console / raw audit log only): sign-ins and
 * tenant switches (sessions, not changes), token renewals and refreshes,
 * device credentials and trust, key rotation, OTA pushes / holds / offers /
 * field builds / update windows / staged rollouts, player recovery and
 * diagnostics, render renditions, transcodes and re-muxes, alt-text jobs, AI
 * usage telemetry, geocode backfills, catalog syncs, sports game commands and
 * cues (a live game writes hundreds), sports feed tokens, and every
 * `*_FAILED` / `*_REFUSED` / `*_DENIED` guard row.
 */
export const CUSTOMER_ACTIVITY: Readonly<Record<string, CustomerActivityRule>> = Object.freeze({
  // ── Content ──────────────────────────────────────────────────────────
  PLAYLIST_CREATED: person('content'),
  PLAYLIST_UPDATED: person('content'),
  PLAYLIST_ITEMS_REPLACED: person('content'),
  PLAYLIST_DELETED: person('content'),
  PLAYLIST_SCHEDULES_TOGGLED: person('content'),
  PLAYLIST_SCREEN_REMOVED: person('content'),
  PLAYLIST_SCREEN_TOGGLED: person('content'),
  PLAYLIST_SYNC_PLAYBACK_CHANGED: person('content'),
  PLAYLIST_PUBLISHED_TO_FLEET: person('content'),
  SCHEDULE_CREATED: person('content'),
  SCHEDULE_UPDATED: person('content'),
  SCHEDULE_DELETED: person('content'),
  SCHEDULE_TOGGLED: person('content'),
  ASSET_UPLOADED: person('content'),
  ASSET_DELETED: person('content'),
  ASSET_APPROVED: person('content'),
  ASSET_REJECTED: person('content'),
  ASSET_FOLDER_DELETED: person('content'),
  AI_IMAGE_GENERATED: person('content'),
  TEMPLATE_CREATED: person('content'),
  TEMPLATE_UPDATED: person('content'),
  TEMPLATE_DELETED: person('content'),
  TEMPLATE_IMPORTED: person('content'),
  IMPORT_DESIGN: person('content'),
  SUBMISSION_CREATED: person('content'),
  USB_BUNDLE_EXPORTED: person('content'),

  // ── Screens ──────────────────────────────────────────────────────────
  SCREEN_PAIRED: person('screens'),
  SCREEN_RENAMED: person('screens'),
  SCREEN_MOVED: person('screens'),
  SCREEN_DELETED: person('screens'),
  SCREEN_ORIENTATION_CHANGED: person('screens'),
  SCREEN_DISPLAY_CONTROL: person('screens'),
  SCREEN_DEVICE_SETTINGS_CHANGED: person('screens'),
  SCREEN_FACE_ADDED: person('screens'),
  SCREEN_GROUP_DELETED: person('screens'),
  REFRESH_WEB: person('screens'),
  DISPLAY_SCHEDULE_CREATED: person('screens'),
  DISPLAY_SCHEDULE_UPDATED: person('screens'),
  DISPLAY_SCHEDULE_DELETED: person('screens'),
  CREATE_FLOOR_PLAN: person('screens'),
  DELETE_FLOOR_PLAN: person('screens'),
  REPLACE_FLOOR_PLAN_IMAGE: person('screens'),

  // ── Emergency (drills are labelled as drills by the dashboard) ──────
  TRIGGER_EMERGENCY: person('emergency'),
  CLEAR_EMERGENCY: person('emergency'),
  TRIGGER_EMERGENCY_DRILL: person('emergency'),
  CLEAR_EMERGENCY_DRILL: person('emergency'),
  DRILL_ENDED_BY_LIVE_ALERT: any('emergency'),
  TRIGGER_SCREEN_EMERGENCY: person('emergency'),
  CLEAR_SCREEN_EMERGENCY: person('emergency'),
  BROADCAST_TEXT: person('emergency'),
  MEDIA_ALERT: person('emergency'),
  CLEAR_EMERGENCY_MESSAGE: person('emergency'),
  SOS_TRIGGER: person('emergency'),
  EMERGENCY_ENABLED_CHANGED: person('emergency'),
  LOCATION_BASED_EMERGENCY_TOGGLED: person('emergency'),
  PANIC_SETTINGS_UPDATED: person('emergency'),
  PANIC_CONTENT_ASSET_ADDED: person('emergency'),
  PANIC_CONTENT_ASSET_REMOVED: person('emergency'),
  UPDATE_SCREEN_EMERGENCY_CONTENT: person('emergency'),
  UPLOAD_SCREEN_EMERGENCY_ASSET: person('emergency'),
  USER_CAN_TRIGGER_PANIC_CHANGED: person('emergency'),

  // ── Team ─────────────────────────────────────────────────────────────
  USER_INVITED: person('team'),
  INVITE_ACCEPTED: person('team'),
  USER_CREDENTIAL_SETUP_COMPLETED: person('team'),
  USER_CREATED: person('team'),
  USER_CREATED_DIRECT: person('team'),
  USER_ROLE_CHANGED: person('team'),
  USER_DISABLED: person('team'),
  USER_ENABLED: person('team'),
  USER_DELETED: person('team'),
  USER_ACCESS_UPDATED: person('team'),
  USER_MFA_REQUIRED_CHANGED: person('team'),
  USER_MFA_RESET: person('team'),
  USER_EMAIL_CHANGED: person('team'),

  // ── Sign-in and account security ────────────────────────────────────
  /** A sign-in finished with an emailed code — the "New sign-in … on <device>" moment. */
  MFA_EMAIL_CODE_SUCCESS: person('security'),
  PASSKEY_REGISTERED: person('security'),
  PASSKEY_REMOVED: person('security'),
  PASSWORD_CHANGED: person('security'),
  PASSWORD_RESET_COMPLETED: person('security'),
  'mfa.enabled': person('security'),
  'mfa.disabled': person('security'),
  TENANT_MFA_POLICY_CHANGED: person('security'),
  SUPPORT_ACCESS_INVITED: person('security'),
  SUPPORT_ACCESS_REQUESTED: any('security'),
  SUPPORT_ACCESS_APPROVED: person('security'),
  SUPPORT_ACCESS_DENIED: person('security'),
  SUPPORT_ACCESS_REVOKED: any('security'),
  SUPPORT_ACCESS_WITHDRAWN: any('security'),
  SUPPORT_ACCESS_EXPIRED: any('security'),
  SUPPORT_ACCESS_BREAK_GLASS: any('security'),

  // ── Settings ─────────────────────────────────────────────────────────
  TENANT_SIGNUP: person('settings'),
  TENANT_UPDATED: person('settings'),
  TENANT_POSTER_STANDARD_CHANGED: person('settings'),
  CHILD_TENANT_CREATED: person('settings'),
  CHILD_TENANT_DELETED: person('settings'),
  ADOPT_BRANDING: person('settings'),
  ADOPT_BRANDING_MANUAL: person('settings'),
  REVERT_BRANDING: person('settings'),
  BRANDING_VOICE_UPDATED: person('settings'),
  BRANDING_APPLY_TO_TEMPLATES: person('settings'),
  BRANDING_APPEARANCE_MODE_CHANGED: person('settings'),
  SSO_CONFIG_UPSERT: person('settings'),
  SSO_CONFIG_DELETE: person('settings'),
  AI_KEY_SET: person('settings'),
  AI_KEY_CLEARED: person('settings'),
  AI_KEY_MODEL_CHANGED: person('settings'),
  API_KEY_CREATED: person('settings'),
  API_KEY_REVOKED: person('settings'),
  WEBHOOK_CREATED: person('settings'),
  WEBHOOK_DELETED: person('settings'),
  USB_INGEST_TOGGLED: person('settings'),
  STUDENT_PRIVACY_SERVES_MINORS_SET: person('settings'),

  // ── Integrations ─────────────────────────────────────────────────────
  POS_CONNECTION_CREATED: person('integrations'),
  POS_CONNECTION_DELETED: person('integrations'),
  SOCIAL_CONNECTION_CREATED: person('integrations'),
  SOCIAL_CONNECTION_REVOKED: person('integrations'),
  STREAM_CONNECTION_DELETED: person('integrations'),
  AD_CONNECTION_DELETED: person('integrations'),
  CLEVER_DISCONNECTED: person('integrations'),

  // ── Plan & billing ───────────────────────────────────────────────────
  BILLING_SEATS_CHANGED: person('billing'),
  BILLING_AI_PLAN_CHANGED: person('billing'),
  BILLING_TRIAL_STARTED: any('billing'),
  LICENSE_UPSERT: any('billing'),
  LICENSE_STATUS_CHANGED: any('billing'),
  AI_BOARD_PACK_PURCHASED: person('billing'),

  // ── Sports ───────────────────────────────────────────────────────────
  SPORTS_GAME_CREATED: person('sports'),
  SPORTS_SCREENS_SHOWN: person('sports'),
  SPONSOR_CREATED: person('sports'),
  SPONSOR_UPDATED: person('sports'),
  SPONSOR_DELETED: person('sports'),
  SPORTS_ROSTER_PRIVACY_SET: person('sports'),
  SPORTS_STUDENT_PRIVACY_FLAGS_SET: person('sports'),

  // ── Menus ────────────────────────────────────────────────────────────
  MENU_OVERRIDE_SET: person('menus'),
  MENU_OVERRIDE_BULK: person('menus'),
  MENU_OVERRIDE_REVERT: person('menus'),
  MENU_IMPORT_OPERATOR: person('menus'),
});

/** Every allowed action, for a database `in` filter. */
export const CUSTOMER_ACTIVITY_ACTIONS: readonly string[] = Object.freeze(Object.keys(CUSTOMER_ACTIVITY));

/** Allowed actions whose rows count with no person behind them. */
export const CUSTOMER_ACTIVITY_ANY_ACTOR_ACTIONS: readonly string[] = Object.freeze(
  Object.keys(CUSTOMER_ACTIVITY).filter((a) => CUSTOMER_ACTIVITY[a].actor === 'any'),
);

export function isCustomerActivityAction(action: string | null | undefined): boolean {
  return typeof action === 'string' && Object.prototype.hasOwnProperty.call(CUSTOMER_ACTIVITY, action);
}

export function customerActivityCategory(action: string | null | undefined): ActivityCategory | null {
  return isCustomerActivityAction(action) ? CUSTOMER_ACTIVITY[action as string].category : null;
}

// ─── Notifications ──────────────────────────────────────────────────────

/**
 * Notification kinds the customer's bell never shows. They stay in the table
 * (the owner reads them with `?audience=owner`) — they are VenueOS's own
 * health signals, not something a customer can act on:
 *   SCREEN_PUSH_DEAD — "realtime channel down — running on polling", written
 *     once a day per screen by the wedge detector. The screen still plays and
 *     still receives alerts over its regular check-in; the fix, when there is
 *     one, is ours. It was 19 of the 31 unread on the owner's own dashboard.
 */
export const OWNER_ONLY_NOTIFICATION_KINDS: readonly string[] = Object.freeze(['SCREEN_PUSH_DEAD']);

export function isCustomerNotificationKind(kind: string | null | undefined): boolean {
  return typeof kind === 'string' && !OWNER_ONLY_NOTIFICATION_KINDS.includes(kind);
}

// ─── The customer-facing activity row (what the API hands the dashboard) ─

export type ActivityActorKind = 'person' | 'support' | 'apiKey' | 'system';

export interface ActivityActor {
  kind: ActivityActorKind;
  /** The person's user id — the dashboard says "You" when it is the viewer. */
  userId: string | null;
  /** First name, else full name, else the email's local part. Null for support / system. */
  name: string | null;
}

/**
 * The few detail facts a sentence needs, already read out of the row's JSON
 * details. Whitelisted per action by the API — raw details (IP addresses,
 * internal ids, correlation ids) never travel in this shape.
 */
export interface ActivityFacts {
  /** On / off switches (pause / resume, sync on / off, alerts on / off). */
  on?: boolean | null;
  /** Emergency alert type (LOCKDOWN, EVACUATE, WEATHER, HOLD, SECURE, MEDICAL, …). */
  alertType?: string | null;
  /** The row is about drill content or a drill. */
  drill?: boolean | null;
  /** Display control verb: POWER_OFF, POWER_ON, BLANK, WAKE, REBOOT, SET_BRIGHTNESS, SET_VOLUME. */
  requested?: string | null;
  /** LANDSCAPE / PORTRAIT / AUTO. */
  orientation?: string | null;
  /** The role a person was given. */
  role?: string | null;
  /** "a Windows PC" — the device a new sign-in came from. */
  device?: string | null;
  /** A passkey's label. */
  label?: string | null;
  /** The previous name (renames). */
  from?: string | null;
  /** A count the sentence carries (pages imported, locations published to). */
  count?: number | null;
  /** The emergency scope: tenant (everywhere), group, device. */
  scope?: string | null;
}

export interface ActivityItem {
  id: string;
  action: string;
  category: ActivityCategory;
  createdAt: string;
  targetType: string;
  targetId: string | null;
  actor: ActivityActor;
  /** The main thing the row is about, by name (a playlist, a screen, a file, a person). */
  subject: string | null;
  /** The second thing, by name (the screen or group a playlist went to). */
  target: string | null;
  /** The screen-or-group id the target names, so rows can be grouped per publish. */
  targetKey: string | null;
  facts: ActivityFacts;
}
