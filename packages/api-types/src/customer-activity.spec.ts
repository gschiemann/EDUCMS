import {
  CUSTOMER_ACTIVITY,
  CUSTOMER_ACTIVITY_ACTIONS,
  CUSTOMER_ACTIVITY_ANY_ACTOR_ACTIONS,
  OWNER_ONLY_NOTIFICATION_KINDS,
  customerActivityCategory,
  isCustomerActivityAction,
  isCustomerNotificationKind,
} from './customer-activity';

/**
 * The rows the owner photographed on his own dashboard (2026-10-24), plus the
 * backend families the brief names: none of them may ever reach a customer.
 * Real action names from the production audit log (60-day census).
 */
const BACKEND_ACTIONS = [
  'FIELD_BUILD_WINDOW_EXPIRE',
  'FIELD_BUILD_WINDOW_ARM',
  'FIELD_BUILD_WINDOW_CANCEL',
  'FIELD_BUILD_PUSH',
  'FIELD_BUILD_PUSH_CANCEL',
  'OTA_PUSH_HELD',
  'OTA_WINDOW_UPDATED',
  'OTA_UNAUTHENTICATED_INSTALL_CLAIM',
  'PLAYER_FIELD_APK_OFFER',
  'PLAYER_FIELD_APK_CONFIGURATION',
  'PLAYER_RECOVERY_EVENT',
  'PLAYER_DIAGNOSTICS_CRASH',
  'FORCE_APK_UPDATE',
  'FORCE_APK_UPDATE_CANCELLED',
  'CANARY_ROLLOUT_UPDATED',
  'SCREEN_TOKEN_RENEWED',
  'SCREEN_TOKEN_DOWNGRADED',
  'SCREEN_CREDENTIAL_REVOKED',
  'SCREEN_TRUST_RESTORED',
  'KEY_ROTATION_REWRAP',
  'USB_INGEST_KEY_ROTATED',
  'SPORTS_FEED_TOKEN_MINTED',
  'DEVICE_FETCH_EMERGENCY_ASSETS',
  'AUTO_REFRESH_WEB',
  'AUTO_RECOVERY_PUSH_DEAD',
  'AUTO_RECOVERY_GAVE_UP',
  'SCREEN_DISPLAY_CAPABILITIES_CHANGED',
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILED',
  'AUTH_TOKEN_REFRESH',
  'AUTH_SESSION_COOKIE_REFRESH',
  'PASSKEY_LOGIN_SUCCESS',
  'TENANT_SWITCH',
  'AI_MODEL_CATALOG_SYNCED',
  'AI_ALT_TEXT_GENERATED',
  'ASSET_VIDEO_OPTIMIZED',
  'ASSET_VIDEO_RENDITION_CREATED',
  'GEOCODE_BACKFILL',
  'EMERGENCY_DEFAULTS_INITIALIZED',
  'SCHEDULE_AUTO_REACTIVATED',
  'VIDEO_PLAYBACK_DEMOTED',
  'PLAYER_LOOP_STANDARD_CONFIGURED',
  'SPORTS_GAME_COMMAND',
  'SPORTS_CUE_FIRED',
  'BULK_SCREEN_ACTION',
];

describe('customer activity allowlist', () => {
  it('never lets a backend action through', () => {
    for (const action of BACKEND_ACTIONS) {
      expect({ action, allowed: isCustomerActivityAction(action) }).toEqual({ action, allowed: false });
    }
  });

  it('carries the operator actions the dashboard is for', () => {
    for (const action of [
      'PLAYLIST_CREATED', 'SCHEDULE_CREATED', 'PLAYLIST_SCHEDULES_TOGGLED', 'PLAYLIST_DELETED',
      'ASSET_UPLOADED', 'ASSET_DELETED', 'TEMPLATE_UPDATED',
      'SCREEN_PAIRED', 'SCREEN_RENAMED', 'SCREEN_DELETED',
      'TRIGGER_EMERGENCY', 'CLEAR_EMERGENCY', 'TRIGGER_EMERGENCY_DRILL', 'CLEAR_EMERGENCY_DRILL',
      'USER_INVITED', 'INVITE_ACCEPTED', 'USER_ROLE_CHANGED',
      'TENANT_UPDATED', 'MFA_EMAIL_CODE_SUCCESS',
    ]) {
      expect({ action, allowed: isCustomerActivityAction(action) }).toEqual({ action, allowed: true });
    }
  });

  it('keeps the evidence the Settings pages read (they query /audit by action)', () => {
    // branding, emergency drill history, Settings home's "recently changed".
    for (const action of [
      'ADOPT_BRANDING', 'ADOPT_BRANDING_MANUAL', 'BRANDING_APPEARANCE_MODE_CHANGED',
      'TRIGGER_EMERGENCY_DRILL', 'CLEAR_EMERGENCY_DRILL', 'DRILL_ENDED_BY_LIVE_ALERT', 'TRIGGER_EMERGENCY',
      'TENANT_UPDATED', 'CHILD_TENANT_CREATED', 'PANIC_SETTINGS_UPDATED', 'USER_INVITED',
      'USER_ROLE_CHANGED', 'SSO_CONFIG_UPSERT', 'AI_KEY_SET', 'LICENSE_UPSERT', 'API_KEY_CREATED',
      'WEBHOOK_CREATED',
    ]) {
      expect(isCustomerActivityAction(action)).toBe(true);
    }
  });

  it('is case-exact and rejects junk', () => {
    expect(isCustomerActivityAction('playlist_created')).toBe(false);
    expect(isCustomerActivityAction('')).toBe(false);
    expect(isCustomerActivityAction(undefined)).toBe(false);
    expect(isCustomerActivityAction('toString')).toBe(false);
    expect(isCustomerActivityAction('__proto__')).toBe(false);
  });

  it('categorises', () => {
    expect(customerActivityCategory('TRIGGER_EMERGENCY_DRILL')).toBe('emergency');
    expect(customerActivityCategory('ASSET_UPLOADED')).toBe('content');
    expect(customerActivityCategory('OTA_PUSH_HELD')).toBeNull();
  });

  it('exports matching action lists', () => {
    expect([...CUSTOMER_ACTIVITY_ACTIONS].sort()).toEqual(Object.keys(CUSTOMER_ACTIVITY).sort());
    for (const a of CUSTOMER_ACTIVITY_ANY_ACTOR_ACTIONS) expect(CUSTOMER_ACTIVITY[a].actor).toBe('any');
    // A system-written row is customer activity only by explicit choice.
    expect(CUSTOMER_ACTIVITY_ANY_ACTOR_ACTIONS.length).toBeLessThan(15);
  });
});

describe('customer notification kinds', () => {
  it('hides the push-channel nag from customers', () => {
    expect(OWNER_ONLY_NOTIFICATION_KINDS).toContain('SCREEN_PUSH_DEAD');
    expect(isCustomerNotificationKind('SCREEN_PUSH_DEAD')).toBe(false);
  });

  it('keeps what a customer can act on', () => {
    for (const kind of ['SCREEN_OFFLINE', 'INFRA_EVENT', 'INFO', 'ASSET_PENDING_REVIEW', 'ASSET_APPROVED', 'ASSET_REJECTED']) {
      expect(isCustomerNotificationKind(kind)).toBe(true);
    }
  });
});
