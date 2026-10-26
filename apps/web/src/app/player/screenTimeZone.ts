/**
 * screenTimeZone — the screen's effective time zone on the player (2026-10-24).
 *
 * Owner (Greg, 2026-10-24): Goodview GUQ panels ship set to Asia/Shanghai and
 * nothing a normal app can do changes that, so every clock and date widget on
 * those screens read Shanghai time. The API now decides ONE zone per screen
 * (screen override > location setting > automatic from the address > none)
 * and carries it in the manifest as `timeZone`. This module is the player's
 * pure half:
 *
 *   • `readManifestTimeZone` — what the manifest says. Three answers, kept
 *     apart on purpose: a VALID zone; `null` = "the server has no zone for
 *     this screen, use the device's"; `undefined` = the key is ABSENT (an
 *     older API, an EMERGENCY manifest, which never carries it) = "keep what
 *     you had". An emergency must never be able to move a clock.
 *   • `applyManifestTimeZone` — the fold: absent keeps the previous value,
 *     anything else replaces it. The page persists the result
 *     (`edu_screenTimeZone`) so a boot straight into an alert, or offline,
 *     still has the zone.
 *   • `withDefaultTimeZone` — the ONE place every widget gets the default:
 *     a zone config key the widget left empty (`timezone`, `clockTimeZone`,
 *     `timeZone` — the three spellings the widget catalog reads) is filled
 *     with the screen's zone; an explicit widget zone always wins. The
 *     marker `_timeZoneDefaulted` lets the clock keep its "abbreviation only
 *     when set explicitly" look.
 *
 * Pure — no React / DOM / network. `Intl` is the only runtime dependency and
 * it is what the widgets format with, so "valid" here means "renders there".
 */

/** The three config spellings time-showing widgets read (WidgetRenderer + the themed widgets). */
export const TIME_ZONE_CONFIG_KEYS = ['timezone', 'clockTimeZone', 'timeZone'] as const;
/** Set beside an injected default so a widget can tell "defaulted" from "set by the operator". */
export const TIME_ZONE_DEFAULTED_KEY = '_timeZoneDefaulted';
export const SCREEN_TIME_ZONE_STORAGE_KEY = 'edu_screenTimeZone';

const validity = new Map<string, boolean>();

/** An IANA id this runtime can format in. Cached; never throws. */
export function isUsableTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string') return false;
  const z = zone.trim();
  if (!z || z.length > 64 || z !== zone) return false;
  const hit = validity.get(z);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    ok = true;
  } catch {
    ok = false;
  }
  validity.set(z, ok);
  return ok;
}

/**
 * `undefined` = the manifest carries no `timeZone` key (keep the last one);
 * `null` = it says there is none (use the device); a string = a usable zone.
 * An unusable string reads as `null` — a zone the runtime cannot format in
 * must not replace one it can.
 */
export function readManifestTimeZone(manifest: unknown): string | null | undefined {
  if (!manifest || typeof manifest !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(manifest, 'timeZone')) return undefined;
  const raw = (manifest as { timeZone?: unknown }).timeZone;
  if (raw === null) return null;
  return isUsableTimeZone(raw) ? raw : null;
}

/** The fold: an absent key changes nothing; anything else is the new truth. */
export function applyManifestTimeZone(previous: string | null, incoming: string | null | undefined): string | null {
  return incoming === undefined ? previous : incoming;
}

/** The persisted zone, or null; a stored value the runtime cannot use is dropped. */
export function readStoredTimeZone(storage: Pick<Storage, 'getItem'> | null | undefined): string | null {
  try {
    const v = storage?.getItem(SCREEN_TIME_ZONE_STORAGE_KEY) ?? null;
    return isUsableTimeZone(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredTimeZone(storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined, zone: string | null): void {
  try {
    if (!storage) return;
    if (zone) storage.setItem(SCREEN_TIME_ZONE_STORAGE_KEY, zone);
    else storage.removeItem(SCREEN_TIME_ZONE_STORAGE_KEY);
  } catch {
    /* storage unavailable — the ref still holds it for this document */
  }
}

/**
 * The widget's config with the screen's zone filled in wherever the widget
 * has no explicit zone of its own. Returns the SAME object when there is
 * nothing to add (no zone, or every key already set), so React sees no
 * change. Never overwrites an operator's choice — not even an invalid one
 * (the widget's own fallback handles that exactly as it did before).
 */
export function withDefaultTimeZone<T extends Record<string, unknown>>(config: T, zone: string | null | undefined): T {
  if (!zone || !config || typeof config !== 'object') return config;
  // Identity cache: the player re-renders its zones often, and a widget's
  // `config` prop identity is what its memoisation keys on. The same input
  // object with the same zone yields the same output object.
  const hit = defaulted.get(config);
  if (hit && hit.zone === zone) return hit.out as T;
  const missing = TIME_ZONE_CONFIG_KEYS.filter((key) => {
    const v = config[key];
    return !(typeof v === 'string' && v.trim());
  });
  // One explicit key is enough for the widget: it reads only its own spelling,
  // so filling the OTHERS would never change what it shows — and must not,
  // because the operator set it. Only a config with NO zone at all is defaulted.
  if (missing.length !== TIME_ZONE_CONFIG_KEYS.length) {
    defaulted.set(config, { zone, out: config });
    return config;
  }
  const next: Record<string, unknown> = { ...config };
  for (const key of missing) next[key] = zone;
  next[TIME_ZONE_DEFAULTED_KEY] = true;
  defaulted.set(config, { zone, out: next });
  return next as T;
}

const defaulted = new WeakMap<object, { zone: string; out: Record<string, unknown> }>();

/** The device's own zone, when the runtime can say. */
export function deviceTimeZoneOf(): string | null {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isUsableTimeZone(z) ? z : null;
  } catch {
    return null;
  }
}
