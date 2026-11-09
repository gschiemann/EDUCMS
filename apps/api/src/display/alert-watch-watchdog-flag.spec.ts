import { alertWatchWatchdogModeFor, parseAlertWatchWatchdogEnv } from './alert-watch-watchdog-flag';

const A = '7d0c4a3e-1b2f-4c5d-8e9f-0a1b2c3d4e5f';
const B = '11111111-2222-4333-8444-555555555555';

describe('MANAGER_ALERT_WATCH_WATCHDOG — the lead-only switch for the alert-watch watchdog (Manager wave 5)', () => {
  it('unset or empty: today — nobody gets a key, the Manager does nothing', () => {
    expect(alertWatchWatchdogModeFor(A, {})).toBeNull();
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: '' })).toBeNull();
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: '   ' })).toBeNull();
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: 'off' })).toBeNull();
  });

  it('on:<uuid> and observe:<uuid> name exactly that screen, case-insensitively', () => {
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: `on:${A.toUpperCase()}` })).toBe('on');
    expect(alertWatchWatchdogModeFor(B, { MANAGER_ALERT_WATCH_WATCHDOG: `on:${A}` })).toBeNull();
    expect(alertWatchWatchdogModeFor(B, { MANAGER_ALERT_WATCH_WATCHDOG: `on:${A}, observe:${B}` })).toBe('observe');
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: `ON:${A}` })).toBe('on');
  });

  it('on:all / observe:all reach the fleet, and on wins over observe', () => {
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: 'observe:all' })).toBe('observe');
    expect(alertWatchWatchdogModeFor(B, { MANAGER_ALERT_WATCH_WATCHDOG: 'on:all' })).toBe('on');
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: `observe:all,on:${A}` })).toBe('on');
    expect(alertWatchWatchdogModeFor(B, { MANAGER_ALERT_WATCH_WATCHDOG: `observe:all,on:${A}` })).toBe('observe');
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: `observe:${A},on:${A}` })).toBe('on');
  });

  it('a typo, a bare token or a malformed id enables nothing', () => {
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: 'on' })).toBeNull();
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: A })).toBeNull();
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: 'all' })).toBeNull();
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: 'onn:all' })).toBeNull();
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: 'on:not-a-uuid' })).toBeNull();
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: `on:${A.slice(0, 20)}` })).toBeNull();
    expect(alertWatchWatchdogModeFor(A, { MANAGER_ALERT_WATCH_WATCHDOG: ':all' })).toBeNull();
    expect(parseAlertWatchWatchdogEnv({ MANAGER_ALERT_WATCH_WATCHDOG: ',,' })).toEqual({
      onAll: false, observeAll: false, onIds: new Set(), observeIds: new Set(),
    });
  });

  it('a screen id that is not a uuid is never matched by a per-screen token, but all still reaches it', () => {
    expect(alertWatchWatchdogModeFor('preview-1', { MANAGER_ALERT_WATCH_WATCHDOG: `on:${A}` })).toBeNull();
    expect(alertWatchWatchdogModeFor('preview-1', { MANAGER_ALERT_WATCH_WATCHDOG: 'on:all' })).toBe('on');
  });

  it('is deterministic per (screen, env) — the manifest hash never moves for an unnamed screen', () => {
    const env = { MANAGER_ALERT_WATCH_WATCHDOG: `on:${A}` };
    expect(alertWatchWatchdogModeFor(B, env)).toBeNull();
    expect(alertWatchWatchdogModeFor(B, env)).toBeNull();
    expect(alertWatchWatchdogModeFor(A, env)).toBe(alertWatchWatchdogModeFor(A, env));
  });
});
