/**
 * Basic Android settings without device owner — the server's pure half
 * (2026-10-18). No I/O here: the heartbeat hook
 * (`device-settings.heartbeat.ts`) and the operator controller
 * (`device-settings.controller.ts`) call these and own the database.
 *
 * The contract itself (keys, value rules, the report schema, the one state
 * rule) is shared with the dashboard in `@cms/api-types` (`device-settings.ts`)
 * and mirrors the player's `settings` package; read that header first.
 *
 * ─────────────────────────────────────────────────────────────────────
 * IDENTITY, NOT TIME
 * ─────────────────────────────────────────────────────────────────────
 * Every stored value carries `id = "r<revision>"`, the record revision at
 * which THAT value last changed. The unit acknowledges by echoing the id;
 * equality is the only comparison anyone makes (CLAUDE.md player rule 6 —
 * signage clocks run minutes off). The revision only ever goes up for a
 * screen, so an id can never name two different values.
 */

import * as crypto from 'crypto';
import { z } from 'zod';

import {
  DEVICE_SETTING_KEYS,
  DEVICE_SETTING_STATUSES,
  DEVICE_WIFI_SECURITY,
  DeviceSettingsReportSchema,
  type DeviceSettingDesired,
  type DeviceSettingKey,
  type DeviceSettingsPatch,
  type DeviceSettingsReport,
  type DeviceLoad,
} from '@cms/api-types';

export const DEVICE_SETTINGS_AUDIT_ACTIONS = {
  /** An operator changed the desired set (before/after, passphrase redacted). */
  CHANGED: 'SCREEN_DEVICE_SETTINGS_CHANGED',
  /** The unit reported a stored value in place, with what Android reads back. */
  APPLIED: 'SCREEN_DEVICE_SETTING_APPLIED',
  /** The unit gave up on a stored value (bounded attempts spent) and why. */
  FAILED: 'SCREEN_DEVICE_SETTING_FAILED',
} as const;

// ─────────────────────────────────────────────────────────────────────
// The stored desired set (DesiredDeviceSettings.settings)
// ─────────────────────────────────────────────────────────────────────

const storedWifi = z.object({
  ssid: z.string().min(1).max(64),
  security: z.enum(DEVICE_WIFI_SECURITY),
  hidden: z.boolean(),
});
const storedItem = z.object({
  v: z.union([z.number(), z.boolean(), z.string(), storedWifi]),
  id: z.string().regex(/^r\d{1,10}$/),
  at: z.string(),
  by: z.string().nullable(),
});
export type StoredItem = z.infer<typeof storedItem>;
export type StoredSettings = Partial<Record<DeviceSettingKey, StoredItem>>;
export type StoredWifi = z.infer<typeof storedWifi>;

/** Read the JSON column defensively: an entry that does not parse is dropped, never trusted. */
export function readStoredSettings(json: unknown): StoredSettings {
  const out: StoredSettings = {};
  if (!json || typeof json !== 'object' || Array.isArray(json)) return out;
  for (const key of DEVICE_SETTING_KEYS) {
    const parsed = storedItem.safeParse((json as Record<string, unknown>)[key]);
    if (!parsed.success) continue;
    const isWifi = typeof parsed.data.v === 'object';
    if ((key === 'wifi') !== isWifi) continue;
    out[key] = parsed.data;
  }
  return out;
}

export class WifiPassphraseRequiredError extends Error {
  readonly code = 'DEVICE_SETTINGS_WIFI_PASSPHRASE_REQUIRED';
  constructor() {
    super('Enter the Wi-Fi password — this network has none saved yet.');
  }
}

export type WifiSecretChange = { kind: 'keep' } | { kind: 'clear' } | { kind: 'set'; passphrase: string };

/**
 * Fold a PUT body into the stored set. Pure.
 *
 * Partial by key: absent = unchanged, `null` = stop managing. A value equal
 * to the stored one is NOT a change (it keeps its id, so the unit does not
 * re-apply it). Every changed key gets the new revision's id.
 *
 * Wi-Fi: the passphrase is write-only. Left out, the saved one is kept —
 * but only for the SAME network and security; a different network, or a
 * secured network with nothing saved, needs it. A passphrase that is sent is
 * always a change (it cannot be compared without opening the old one).
 */
export function applyPatch(
  current: StoredSettings,
  patch: DeviceSettingsPatch,
  ctx: { revision: number; now: Date; userId: string | null; hasSecret: boolean },
): { next: StoredSettings; changed: DeviceSettingKey[]; wifiSecret: WifiSecretChange } {
  const next: StoredSettings = { ...current };
  const changed: DeviceSettingKey[] = [];
  let wifiSecret: WifiSecretChange = { kind: 'keep' };
  const stamp = (v: StoredItem['v']): StoredItem => ({
    v,
    id: `r${ctx.revision}`,
    at: ctx.now.toISOString(),
    by: ctx.userId,
  });

  for (const key of DEVICE_SETTING_KEYS) {
    if (!(key in patch)) continue;
    const incoming = (patch as Record<string, unknown>)[key];
    if (incoming === undefined) continue;
    if (incoming === null) {
      if (next[key]) {
        delete next[key];
        changed.push(key);
        if (key === 'wifi') wifiSecret = { kind: 'clear' };
      }
      continue;
    }
    if (key === 'wifi') {
      const w = incoming as NonNullable<DeviceSettingsPatch['wifi']>;
      const value: StoredWifi = { ssid: w.ssid, security: w.security, hidden: w.hidden ?? false };
      const prev = next.wifi?.v as StoredWifi | undefined;
      const sameNetwork = !!prev && prev.ssid === value.ssid && prev.security === value.security;
      if (value.security === 'open') {
        wifiSecret = ctx.hasSecret ? { kind: 'clear' } : { kind: 'keep' };
      } else if (w.passphrase !== undefined) {
        wifiSecret = { kind: 'set', passphrase: w.passphrase };
      } else if (!(sameNetwork && ctx.hasSecret)) {
        throw new WifiPassphraseRequiredError();
      }
      const unchanged = sameNetwork && prev!.hidden === value.hidden && wifiSecret.kind !== 'set' &&
        !(value.security === 'open' && ctx.hasSecret);
      if (!unchanged) {
        next.wifi = stamp(value);
        changed.push('wifi');
      }
      continue;
    }
    const value = incoming as number | boolean | string;
    if (next[key] && next[key]!.v === value) continue;
    next[key] = stamp(value);
    changed.push(key);
  }
  return { next, changed, wifiSecret };
}

/** The desired set as the dashboard and the audit log may see it — never a passphrase. */
export function viewDesired(
  stored: StoredSettings,
  hasSecret: boolean,
): Partial<Record<DeviceSettingKey, DeviceSettingDesired>> {
  const out: Partial<Record<DeviceSettingKey, DeviceSettingDesired>> = {};
  for (const key of DEVICE_SETTING_KEYS) {
    const item = stored[key];
    if (!item) continue;
    const value =
      key === 'wifi'
        ? { ...(item.v as StoredWifi), passphraseSaved: hasSecret && (item.v as StoredWifi).security !== 'open' }
        : (item.v as number | boolean | string);
    out[key] = { value, id: item.id, changedAt: item.at };
  }
  return out;
}

/** The audit row's before/after: values only, the Wi-Fi passphrase as a fact ("saved"), never itself. */
export function auditView(stored: StoredSettings, hasSecret: boolean): Record<string, unknown> {
  const view = viewDesired(stored, hasSecret);
  return Object.fromEntries(Object.entries(view).map(([k, d]) => [k, d!.value]));
}

// ─────────────────────────────────────────────────────────────────────
// The unit's report: signature, and what changed in it
// ─────────────────────────────────────────────────────────────────────

/**
 * Heat and load move every heartbeat; storing each sample would be a write
 * per screen per minute. The signature therefore sees them in coarse buckets
 * — a moved bucket stores the new raw numbers, a jitter inside one does not.
 */
export function loadBuckets(load: DeviceLoad | undefined): Record<string, number | boolean | null> | null {
  if (!load) return null;
  const memPct =
    load.memAvailMb !== undefined && load.memTotalMb ? Math.floor((load.memAvailMb / load.memTotalMb) * 10) : null;
  return {
    thermal: load.thermal ?? null,
    thermalAt: load.thermalAt ?? null,
    headroom: load.headroom !== undefined ? Math.floor(load.headroom * 10) : null,
    cpu: load.cpu !== undefined ? Math.floor(load.cpu / 25) : null,
    sysCpu: load.sysCpu !== undefined ? Math.floor(load.sysCpu / 25) : null,
    mem: memPct,
    memLow: load.memLow ?? null,
    socC: load.socC !== undefined ? Math.floor(load.socC / 5) : null,
    zones: load.zones ?? null,
  };
}

/** 16 hex chars over the report with its load in buckets. Stable: zod emits keys in schema order. */
export function reportSignature(report: DeviceSettingsReport): string {
  const { load, ...rest } = report;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ ...rest, load: loadBuckets(load) }))
    .digest('hex')
    .slice(0, 16);
}

export interface AckTransition {
  key: DeviceSettingKey;
  id: string;
  status: 'applied' | 'failed';
  why: string | null;
  attempts: number;
  /** The unit's wall clock of the write — evidence, never compared. */
  appliedAtDeviceMs: number | null;
  observed: unknown;
}

/**
 * The acknowledgements that NEWLY became `applied` or `failed` between two
 * reports — each one is an audit row. A re-applied value after a reboot
 * shows as a new device time on the same id, and is audited too.
 */
export function ackTransitions(prev: DeviceSettingsReport | null, next: DeviceSettingsReport): AckTransition[] {
  const out: AckTransition[] = [];
  for (const key of DEVICE_SETTING_KEYS) {
    const a = next.ack?.[key];
    if (!a || (a.st !== 'applied' && a.st !== 'failed')) continue;
    const before = prev?.ack?.[key];
    if (before && before.id === a.id && before.st === a.st && before.at === a.at) continue;
    out.push({
      key,
      id: a.id,
      status: a.st,
      why: a.why ?? null,
      attempts: a.n,
      appliedAtDeviceMs: a.at ?? null,
      observed: next.obs?.[key] ?? null,
    });
  }
  return out;
}

/** Defensive read of a stored report (the JSON column). */
export function readStoredReport(json: unknown): DeviceSettingsReport | null {
  if (!json || typeof json !== 'object') return null;
  // Same schema the header passed through; stored rows were produced by it.
  const parsed = DeviceSettingsReportSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

// ─────────────────────────────────────────────────────────────────────
// The heartbeat reply
// ─────────────────────────────────────────────────────────────────────

export type DeviceSettingsReply =
  | { schema: 1; rev: number; same: true }
  | { schema: 1; rev: number; items: Record<string, { id: string; v: unknown }> };

const TERMINAL: ReadonlySet<string> = new Set(['applied', 'failed']);

/**
 * Must THIS reply carry the Wi-Fi passphrase? Only while the unit has not
 * finished the current Wi-Fi identity. Once it reports that id applied or
 * failed, the secret stops travelling.
 */
export function wifiSecretNeeded(stored: StoredSettings, report: DeviceSettingsReport): boolean {
  const wifi = stored.wifi;
  if (!wifi || (wifi.v as StoredWifi).security === 'open') return false;
  const ack = report.ack?.wifi;
  return !(ack && ack.id === wifi.id && TERMINAL.has(ack.st));
}

export function fullReply(
  revision: number,
  stored: StoredSettings,
  passphrase: string | null,
): DeviceSettingsReply {
  const items: Record<string, { id: string; v: unknown }> = {};
  for (const key of DEVICE_SETTING_KEYS) {
    const item = stored[key];
    if (!item) continue;
    if (key === 'wifi') {
      const w = item.v as StoredWifi;
      items.wifi = {
        id: item.id,
        v: { ssid: w.ssid, security: w.security, hidden: w.hidden, ...(passphrase ? { passphrase } : {}) },
      };
    } else {
      items[key] = { id: item.id, v: item.v };
    }
  }
  return { schema: 1, rev: revision, items };
}

export const DEVICE_SETTING_STATUS_SET: ReadonlySet<string> = new Set(DEVICE_SETTING_STATUSES);
