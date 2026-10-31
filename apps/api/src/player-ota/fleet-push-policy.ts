/**
 * FLEET PUSH RULES (2026-10-31) — the owner's OTA rules, in code. Until now
 * they lived only in prose (AGENTS.md hard stops; docs/governance/
 * OWNER-RULES.md 2026-10-12; AUTONOMY-REGISTER.md "Fleet OTA / field push").
 *
 *   "Never mass-force an update during playback — one hardware class at a
 *    time, off-hours." Born 2026-10-12: a forced update to 14 screens
 *    stalled playback and broke the rk3288 double-sided units.
 *   "Field-candidate builds go only to bench / test screens, never customer
 *    screens." Field builds 1.1.42, 1.1.47 and 1.1.50 reached customer
 *    screens while skipping the hardware gate.
 *
 * Pure: no Prisma, no Nest, no wall clock unless a `now` is passed in. The
 * field-build panel (field-builds/field-builds.service.ts) and the update
 * check (player-ota.controller.ts, field-candidate.ts) call these;
 * fleet-push-policy.spec.ts pins every shape.
 *
 * 1. ONE HARDWARE CLASS. A set of more than one screen must be provably ONE
 *    class. A screen's class is its `Screen.hardwareModel` — the field the
 *    `model:<id>` tokens of PLAYER_NATIVE_VIDEO / PLAYER_NATIVE_FIRST match —
 *    except for the two buckets hardware detection falls back to when it
 *    could not tell (`generic-android`, `unknown`: screens/hardware-detect.ts).
 *    A Goodview GUQ panel (Amlogic T982) and an rk3288 double-sided unit both
 *    land in `generic-android`, so there the class is the device class the
 *    screen's own APK reported (`lastVideoReport.native.device.class`, e.g.
 *    `rockchip/android-7` — the `class:` token of PLAYER_NATIVE_FIRST). A
 *    screen with neither has NO KNOWN class, and a set holding one cannot be
 *    shown to be one class: refused, exactly as a screen with no time zone
 *    is refused below.
 * 2. BENCH SCREENS ONLY for a field candidate — PLAYER_FIELD_BENCH_SCREENS,
 *    comma-separated screen ids. Unset or blank = no restriction, the
 *    behaviour before the variable existed. Set = only the listed screens are
 *    offered, sent or pushed a field build. A token that is not a screen id is
 *    ignored and there is no wildcard, so a typo can only shrink the list: a
 *    list with no valid id admits no screen at all (the safe direction for a
 *    restriction — it never re-opens customer screens).
 * 3. OFF-HOURS. A push to more than one screen goes out only between 22:00
 *    and 06:00 in EVERY target screen's own time zone — the zone the screen
 *    itself shows (screens/screen-time-zone.ts). A screen whose zone does not
 *    resolve is UNKNOWN and refuses the push, saying why; the device's own
 *    zone is never the fallback (a GUQ panel ships set to Asia/Shanghai).
 *
 * Rules 1 and 3 bind a set of MORE THAN ONE screen — one screen is one class
 * and one clock, which is how bench testing works — and yield to one explicit
 * override on the request, which the caller writes to the audit log. Rule 2
 * has no override: the variable itself is the switch.
 */
import { reportedDeviceClass } from '../screens/native-video';
import { isInsideWindowStrict, isValidTimeZone } from './auto-update-policy';

const UUID_RE = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** The rules a mass push can break — the names an override records. */
export type MassPushRule = 'hardware-class' | 'off-hours';

export interface NamedScreen {
  id: string;
  name: string | null;
}

const named = (s: { id: string; name?: string | null }): NamedScreen => ({
  id: s.id,
  name: typeof s.name === 'string' && s.name ? s.name : null,
});

/** "Lobby, Gym and 2 more" for a refusal — a screen without a name is its id's first 8 characters. */
export function listScreenNames(screens: ReadonlyArray<NamedScreen>, max = 3): string {
  const names = screens.map((s) => s.name ?? s.id.slice(0, 8));
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

// ─── 2. Bench screens ──────────────────────────────────────────────────────

export const FIELD_BENCH_ENV = 'PLAYER_FIELD_BENCH_SCREENS';

export interface FieldBenchList {
  /** false = the variable is unset or blank: no restriction. */
  configured: boolean;
  /** The listed screen ids, lower-cased. Empty while configured = no bench screen at all. */
  ids: ReadonlySet<string>;
}

export function parseFieldBenchScreens(env: Record<string, string | undefined> = process.env): FieldBenchList {
  const raw = (env[FIELD_BENCH_ENV] ?? '').trim();
  const ids = new Set<string>();
  if (!raw) return { configured: false, ids };
  for (const token of raw.split(',')) {
    const id = token.trim();
    if (UUID_RE.test(id)) ids.add(id.toLowerCase());
  }
  return { configured: true, ids };
}

/** May a field candidate reach this screen? Always yes while the variable is unset. */
export function isFieldBenchScreen(
  screenId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const bench = parseFieldBenchScreens(env);
  if (!bench.configured) return true;
  return typeof screenId === 'string' && bench.ids.has(screenId.trim().toLowerCase());
}

// ─── 1. One hardware class ─────────────────────────────────────────────────

/** hardware-detect.ts's two "we could not tell" buckets. */
export const COARSE_HARDWARE_MODELS: ReadonlySet<string> = new Set(['generic-android', 'unknown']);

export interface HardwareClassFacts {
  /** `Screen.hardwareModel` */
  hardwareModel?: string | null;
  /** `Screen.lastVideoReport` — read only for its reported device class. */
  lastVideoReport?: unknown;
}

export interface HardwareClass {
  /** Two screens are one class exactly when their keys are equal. */
  key: string;
  /** How a refusal names it. */
  label: string;
}

/** This screen's class, or null when nothing proves one. */
export function hardwareClassOf(screen: HardwareClassFacts | null | undefined): HardwareClass | null {
  const model = typeof screen?.hardwareModel === 'string' ? screen.hardwareModel.trim().toLowerCase() : '';
  if (model && !COARSE_HARDWARE_MODELS.has(model)) return { key: `model:${model}`, label: model };
  const reported = reportedDeviceClass(screen ?? null);
  if (reported) return { key: `class:${reported}`, label: model ? `${model} (${reported})` : reported };
  return null;
}

export interface HardwareClassVerdict {
  /** At most one screen, or every screen of one known class. */
  ok: boolean;
  reason: 'mixed' | 'unknown' | null;
  /** The classes present, by label, in first-seen order. */
  classes: string[];
  /** The screens with no known class. */
  unknown: NamedScreen[];
  /** The caller could not read every screen of the set (it then cannot be shown to be one class). */
  incomplete: boolean;
}

export function evaluateHardwareClasses(
  screens: ReadonlyArray<HardwareClassFacts & { id: string; name?: string | null }>,
  opts: { incomplete?: boolean } = {},
): HardwareClassVerdict {
  const seen = new Map<string, string>();
  const unknown: NamedScreen[] = [];
  for (const s of screens) {
    const c = hardwareClassOf(s);
    if (!c) unknown.push(named(s));
    else if (!seen.has(c.key)) seen.set(c.key, c.label);
  }
  const classes = [...seen.values()];
  const incomplete = opts.incomplete === true;
  const verdict = (reason: HardwareClassVerdict['reason']): HardwareClassVerdict => ({
    ok: reason === null,
    reason,
    classes,
    unknown,
    incomplete,
  });
  if (screens.length <= 1 && !incomplete) return verdict(null);
  if (classes.length > 1) return verdict('mixed');
  if (unknown.length > 0 || incomplete) return verdict('unknown');
  return verdict(null);
}

// ─── 3. Off-hours ──────────────────────────────────────────────────────────

/** Local time, in each screen's own zone; the end is exclusive (06:00 is outside). */
export const OFF_HOURS = { start: '22:00', end: '06:00' } as const;

/** "HH:MM" in `zone` at `now`, or null when the zone cannot be formatted. */
export function localTimeIn(zone: string, now: Date): string | null {
  if (!isValidTimeZone(zone)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hh = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '', 10) % 24;
    const mm = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '', 10);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

export interface ZonedScreen {
  id: string;
  name?: string | null;
  /** The screen's effective IANA zone (screens/screen-time-zone.ts), or null when none resolves. */
  timeZone: string | null | undefined;
}

export interface OffHoursVerdict {
  /** At most one screen, or every screen inside 22:00–06:00 in its own zone. */
  ok: boolean;
  /** `no-time-zone` is reported first: it blocks the push even at the right hour. */
  reason: 'no-time-zone' | 'outside' | null;
  noZone: NamedScreen[];
  outside: Array<NamedScreen & { timeZone: string; localTime: string | null }>;
}

export function evaluateOffHours(screens: ReadonlyArray<ZonedScreen>, now: Date): OffHoursVerdict {
  const noZone: OffHoursVerdict['noZone'] = [];
  const outside: OffHoursVerdict['outside'] = [];
  if (screens.length > 1) {
    for (const s of screens) {
      const zone = typeof s.timeZone === 'string' ? s.timeZone : '';
      if (!isValidTimeZone(zone)) noZone.push(named(s));
      else if (!isInsideWindowStrict({ ...OFF_HOURS, timezone: zone }, now)) {
        outside.push({ ...named(s), timeZone: zone, localTime: localTimeIn(zone, now) });
      }
    }
  }
  const reason: OffHoursVerdict['reason'] = noZone.length ? 'no-time-zone' : outside.length ? 'outside' : null;
  return { ok: reason === null, reason, noZone, outside };
}
