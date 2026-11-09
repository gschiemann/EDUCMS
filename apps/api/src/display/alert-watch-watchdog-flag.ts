/**
 * THE ALERT-WATCH WATCHDOG SWITCH (Manager wave 5, 2026-11-08) — `MANAGER_ALERT_WATCH_WATCHDOG`.
 *
 * The companion Manager APK can watch the Player's NATIVE ALERT WATCH (the
 * code that raises an alert on a panel in standby) and, while the panel is
 * dark, re-arm it or restart its host when it has stopped stamping
 * (`apps/player/manager/.../alertwatch/AlertWatchWatchdogPolicy.kt`). That is
 * a life-safety CHANGE-class behaviour: it ships OFF and the lead switches it
 * on per screen, after the on-glass drill, in two steps:
 *
 *   MANAGER_ALERT_WATCH_WATCHDOG=observe:<uuid>[,…]   record verdicts, send nothing
 *   MANAGER_ALERT_WATCH_WATCHDOG=on:<uuid>[,…]        act (the bounded ladder)
 *   MANAGER_ALERT_WATCH_WATCHDOG=on:all / observe:all the fleet
 *   unset / off / anything else                       today's behaviour: nothing
 *
 * `on` wins over `observe` for the same screen; a typo enables nothing; a
 * screen the env does not name gets NO key, so no other screen's payload hash
 * moves (CLAUDE.md manifest-cache rule). Carried on the manifest's `display`
 * block as `alertWatchWatchdog: "on" | "observe"`; the Player copies it into
 * the stamp it writes for the Manager, which does nothing without it.
 *
 * Failure direction: CLOSED — unreadable means off; the existing watch still
 * runs exactly as before.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AlertWatchWatchdogMode = 'on' | 'observe';

export interface AlertWatchWatchdogTargets {
  onAll: boolean;
  observeAll: boolean;
  onIds: Set<string>;
  observeIds: Set<string>;
}

export function parseAlertWatchWatchdogEnv(
  env: Record<string, string | undefined> = process.env,
): AlertWatchWatchdogTargets {
  const r: AlertWatchWatchdogTargets = { onAll: false, observeAll: false, onIds: new Set(), observeIds: new Set() };
  const raw = (env.MANAGER_ALERT_WATCH_WATCHDOG ?? '').trim();
  if (!raw) return r;
  for (const t0 of raw.split(',')) {
    const t = t0.trim();
    const colon = t.indexOf(':');
    if (colon <= 0) continue;
    const mode = t.slice(0, colon).trim().toLowerCase();
    const target = t.slice(colon + 1).trim();
    if (mode !== 'on' && mode !== 'observe') continue;
    if (target.toLowerCase() === 'all') {
      if (mode === 'on') r.onAll = true;
      else r.observeAll = true;
    } else if (UUID_RE.test(target)) {
      (mode === 'on' ? r.onIds : r.observeIds).add(target.toLowerCase());
    }
  }
  return r;
}

/** The mode for ONE screen, or `null` when the block must carry no key at all. */
export function alertWatchWatchdogModeFor(
  screenId: string,
  env: Record<string, string | undefined> = process.env,
): AlertWatchWatchdogMode | null {
  const id = String(screenId ?? '').toLowerCase();
  const r = parseAlertWatchWatchdogEnv(env);
  const isUuid = UUID_RE.test(id);
  if (r.onAll || (isUuid && r.onIds.has(id))) return 'on';
  if (r.observeAll || (isUuid && r.observeIds.has(id))) return 'observe';
  return null;
}
