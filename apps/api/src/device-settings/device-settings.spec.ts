import type { DeviceSettingsReport } from '@cms/api-types';

import {
  WifiPassphraseRequiredError,
  ackTransitions,
  applyPatch,
  auditView,
  fullReply,
  loadBuckets,
  readStoredSettings,
  reportSignature,
  viewDesired,
  wifiSecretNeeded,
  type StoredSettings,
} from './device-settings';

const now = new Date('2026-10-18T12:00:00.000Z');
const ctx = (revision: number, hasSecret = false) => ({ revision, now, userId: 'u-1', hasSecret });

describe('readStoredSettings — the JSON column is read, never trusted', () => {
  it('keeps well-formed entries and drops everything else', () => {
    const stored = readStoredSettings({
      brightness: { v: 80, id: 'r3', at: now.toISOString(), by: null },
      volume: { v: 40, id: 'bad', at: now.toISOString(), by: null },
      wifi: { v: 7, id: 'r4', at: now.toISOString(), by: null },
      autoTime: { v: { ssid: 'x', security: 'open', hidden: false }, id: 'r4', at: now.toISOString(), by: null },
      reboot: { v: true, id: 'r1', at: now.toISOString(), by: null },
    });
    expect(Object.keys(stored)).toEqual(['brightness']);
    expect(readStoredSettings(null)).toEqual({});
    expect(readStoredSettings([1, 2])).toEqual({});
  });
});

describe('applyPatch — identity per changed value, nothing else moves', () => {
  it('stamps only the keys that changed with the new revision', () => {
    const first = applyPatch({}, { brightness: 80, autoTime: true }, ctx(1));
    expect(first.changed).toEqual(['brightness', 'autoTime']);
    expect(first.next.brightness).toMatchObject({ v: 80, id: 'r1', by: 'u-1' });

    const second = applyPatch(first.next, { brightness: 80, volume: 30 }, ctx(2));
    expect(second.changed).toEqual(['volume']);
    expect(second.next.brightness!.id).toBe('r1'); // an unchanged value keeps its identity
    expect(second.next.volume!.id).toBe('r2');
  });

  it('null stops managing a setting; absent leaves it', () => {
    const base = applyPatch({}, { brightness: 80, volume: 30 }, ctx(1)).next;
    const r = applyPatch(base, { brightness: null }, ctx(2));
    expect(r.changed).toEqual(['brightness']);
    expect(r.next.brightness).toBeUndefined();
    expect(r.next.volume!.id).toBe('r1');
    expect(applyPatch(base, { autoTime: null }, ctx(3)).changed).toEqual([]);
  });

  it('requires the Wi-Fi passphrase for a new secured network and keeps the saved one for the same network', () => {
    expect(() => applyPatch({}, { wifi: { ssid: 'Lobby', security: 'wpa2' } }, ctx(1))).toThrow(WifiPassphraseRequiredError);
    const set = applyPatch({}, { wifi: { ssid: 'Lobby', security: 'wpa2', passphrase: 'correct horse' } }, ctx(1));
    expect(set.wifiSecret).toEqual({ kind: 'set', passphrase: 'correct horse' });
    expect(set.next.wifi!.v).toEqual({ ssid: 'Lobby', security: 'wpa2', hidden: false });
    expect(JSON.stringify(set.next)).not.toContain('correct horse');

    // Same network, nothing new: no change, the saved secret is kept.
    const same = applyPatch(set.next, { wifi: { ssid: 'Lobby', security: 'wpa2' } }, ctx(2, true));
    expect(same.changed).toEqual([]);
    expect(same.wifiSecret).toEqual({ kind: 'keep' });
    // Hidden flipped: a change, still the saved secret.
    const hidden = applyPatch(set.next, { wifi: { ssid: 'Lobby', security: 'wpa2', hidden: true } }, ctx(2, true));
    expect(hidden.changed).toEqual(['wifi']);
    expect(hidden.wifiSecret).toEqual({ kind: 'keep' });
    // A different network without a passphrase is refused.
    expect(() => applyPatch(set.next, { wifi: { ssid: 'Office', security: 'wpa2' } }, ctx(2, true))).toThrow(
      WifiPassphraseRequiredError,
    );
    // A passphrase that is sent is always a change (the old one is never opened to compare).
    expect(applyPatch(set.next, { wifi: { ssid: 'Lobby', security: 'wpa2', passphrase: 'correct horse' } }, ctx(2, true)).changed).toEqual(['wifi']);
  });

  it('an open network drops any saved secret; stopping Wi-Fi clears it', () => {
    const secured = applyPatch({}, { wifi: { ssid: 'Lobby', security: 'wpa2', passphrase: 'correct horse' } }, ctx(1)).next;
    const open = applyPatch(secured, { wifi: { ssid: 'Lobby', security: 'open' } }, ctx(2, true));
    expect(open.changed).toEqual(['wifi']);
    expect(open.wifiSecret).toEqual({ kind: 'clear' });
    const stop = applyPatch(secured, { wifi: null }, ctx(3, true));
    expect(stop.wifiSecret).toEqual({ kind: 'clear' });
    expect(stop.next.wifi).toBeUndefined();
  });
});

describe('what may leave the API — never a passphrase', () => {
  const stored = applyPatch(
    {},
    { brightness: 80, wifi: { ssid: 'Lobby', security: 'wpa2', passphrase: 'correct horse' } },
    ctx(5),
  ).next;

  it('the dashboard view says a passphrase is saved, not what it is', () => {
    const view = viewDesired(stored, true);
    expect(view.wifi!.value).toEqual({ ssid: 'Lobby', security: 'wpa2', hidden: false, passphraseSaved: true });
    expect(view.brightness).toEqual({ value: 80, id: 'r5', changedAt: now.toISOString() });
    expect(JSON.stringify(view)).not.toContain('correct horse');
  });

  it('the audit before/after carries values only', () => {
    expect(auditView(stored, true)).toEqual({
      brightness: 80,
      wifi: { ssid: 'Lobby', security: 'wpa2', hidden: false, passphraseSaved: true },
    });
  });

  it('the heartbeat reply carries the passphrase only when it is handed one', () => {
    const withSecret = fullReply(5, stored, 'correct horse') as { items: Record<string, { v: unknown }> };
    expect((withSecret.items.wifi.v as { passphrase?: string }).passphrase).toBe('correct horse');
    const without = fullReply(5, stored, null) as { items: Record<string, { v: unknown }> };
    expect(without.items.wifi.v).toEqual({ ssid: 'Lobby', security: 'wpa2', hidden: false });
    expect(without.items.brightness).toEqual({ id: 'r5', v: 80 });
  });
});

describe('wifiSecretNeeded — the secret stops travelling once the unit is done with it', () => {
  const stored: StoredSettings = {
    wifi: { v: { ssid: 'Lobby', security: 'wpa2', hidden: false }, id: 'r6', at: now.toISOString(), by: null },
  };
  const report = (ack?: { id: string; st: 'applied' | 'failed' | 'pending' | 'waiting' }): DeviceSettingsReport => ({
    schema: 1,
    rev: 6,
    ...(ack ? { ack: { wifi: { ...ack, n: 1 } } } : {}),
  });

  it('is needed until THAT identity is applied or failed', () => {
    expect(wifiSecretNeeded(stored, report())).toBe(true);
    expect(wifiSecretNeeded(stored, report({ id: 'r6', st: 'pending' }))).toBe(true);
    expect(wifiSecretNeeded(stored, report({ id: 'r5', st: 'applied' }))).toBe(true);
    expect(wifiSecretNeeded(stored, report({ id: 'r6', st: 'applied' }))).toBe(false);
    expect(wifiSecretNeeded(stored, report({ id: 'r6', st: 'failed' }))).toBe(false);
  });

  it('is never needed for an open network or no network', () => {
    expect(wifiSecretNeeded({}, report())).toBe(false);
    const open: StoredSettings = {
      wifi: { v: { ssid: 'Guest', security: 'open', hidden: false }, id: 'r6', at: now.toISOString(), by: null },
    };
    expect(wifiSecretNeeded(open, report())).toBe(false);
  });
});

describe('reportSignature — one stored write per real change, not per sample', () => {
  const base: DeviceSettingsReport = {
    schema: 1,
    rev: 3,
    cap: { brightness: 'ok' },
    obs: { brightness: 80 },
    load: { thermal: 0, headroom: 0.31, cpu: 12, memAvailMb: 800, memTotalMb: 2000, socC: 61 },
  };

  it('ignores load jitter inside a bucket and sees a moved bucket', () => {
    const sig = reportSignature(base);
    expect(reportSignature({ ...base, load: { ...base.load, cpu: 14, headroom: 0.33, socC: 63, memAvailMb: 810 } })).toBe(sig);
    expect(reportSignature({ ...base, load: { ...base.load, cpu: 40 } })).not.toBe(sig);
    expect(reportSignature({ ...base, load: { ...base.load, thermal: 2 } })).not.toBe(sig);
    expect(reportSignature({ ...base, load: { ...base.load, socC: 75 } })).not.toBe(sig);
  });

  it('sees every observed or acknowledged change exactly', () => {
    const sig = reportSignature(base);
    expect(reportSignature({ ...base, obs: { brightness: 81 } })).not.toBe(sig);
    expect(reportSignature({ ...base, ack: { brightness: { id: 'r3', st: 'applied', n: 1 } } })).not.toBe(sig);
    expect(loadBuckets(undefined)).toBeNull();
  });
});

describe('ackTransitions — what gets an audit row', () => {
  const applied = { id: 'r3', st: 'applied' as const, n: 1, at: 1_760_000_000_000 };

  it('audits a newly applied or failed identity with what Android read back', () => {
    const next: DeviceSettingsReport = {
      schema: 1,
      rev: 3,
      obs: { brightness: 79 },
      ack: { brightness: applied, volume: { id: 'r3', st: 'failed', n: 3, why: 'not-taken' }, autoTime: { id: 'r3', st: 'waiting', n: 0 } },
    };
    const t = ackTransitions(null, next);
    expect(t.map((x) => [x.key, x.status])).toEqual([
      ['brightness', 'applied'],
      ['volume', 'failed'],
    ]);
    expect(t[0].observed).toBe(79);
    expect(t[1].why).toBe('not-taken');
  });

  it('does not re-audit an unchanged acknowledgement, but does a re-apply after a reboot', () => {
    const prev: DeviceSettingsReport = { schema: 1, rev: 3, ack: { brightness: applied } };
    expect(ackTransitions(prev, { ...prev, obs: { brightness: 80 } })).toEqual([]);
    const reapplied: DeviceSettingsReport = { schema: 1, rev: 3, ack: { brightness: { ...applied, at: applied.at + 86_400_000 } } };
    expect(ackTransitions(prev, reapplied)).toHaveLength(1);
  });
});
