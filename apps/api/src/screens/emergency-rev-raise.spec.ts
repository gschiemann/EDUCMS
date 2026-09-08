/**
 * emergency-rev-raise.spec.ts — the RAISE fast path (P0-7 #2, 2026-09-05).
 *
 * WHAT IT IS PROVING. With Redis stopped, the measured time for a lockdown to
 * reach 1 000 screens was p50 7 572 ms / p95 21 653 ms / max 45 131 ms
 * (`P0-7-load-test.md` §5.6) because every screen answered a moved revision
 * with a FULL emergency-manifest fetch and the herd queued. The alert now
 * rides the revision response itself.
 *
 * These cases are the SAFETY half of that change, not the speed half — the
 * speed is measured by the load harness. Every one of them is a way the fast
 * path could be wrong on a life-safety surface:
 *
 *   • it must RAISE and never RELEASE;
 *   • it must never replace an alert a screen is already showing;
 *   • a group/device-scoped trigger must not light up a whole tenant;
 *   • an all-clear must drop it in the same synchronous write as the epoch;
 *   • a descriptor must never outlive the epoch it was minted with;
 *   • a Redis value is shared mutable state and must be parsed defensively.
 */

import {
  ALERT_DESCRIPTOR_MAX_BYTES,
  bumpTenantEmergencyEpoch,
  noteScreenEmergencyState,
  parseEpoch,
  readTenantEmergencyEpoch,
  resetEmergencyRevForTests,
  resolveEmergencyRev,
  sanitizeAlertDescriptor,
  type EmergencyAlertDescriptor,
  type EmergencyRevRedis,
} from './emergency-rev';

const LOCKDOWN: EmergencyAlertDescriptor = {
  type: 'LOCKDOWN',
  severity: 'CRITICAL',
  scopeNote: null,
  scope: 'tenant',
  expiresAt: null,
};

/** In-memory stand-in for the Redis mirror. `down` makes every call throw. */
function fakeRedis(): EmergencyRevRedis & { store: Map<string, string>; down: boolean } {
  const store = new Map<string, string>();
  const r = {
    store,
    down: false,
    async getString(key: string) {
      if (r.down) throw new Error('redis down');
      return store.get(key) ?? null;
    },
    async setString(key: string, value: string) {
      if (r.down) throw new Error('redis down');
      store.set(key, value);
      return true;
    },
  };
  return r;
}

/** Let the fire-and-forget Redis mirror inside `bump` settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => resetEmergencyRevForTests('origin-raise'));

describe('sanitizeAlertDescriptor — the only door into the descriptor', () => {
  it('accepts the exact manifest-shaped object', () => {
    expect(sanitizeAlertDescriptor(LOCKDOWN)).toEqual(LOCKDOWN);
  });

  it('refuses anything that is not tenant-scoped', () => {
    // A per-screen descriptor could reach a screen the override never
    // targeted, so 'screen' is not merely unsupported — it is refused.
    expect(sanitizeAlertDescriptor({ ...LOCKDOWN, scope: 'screen' })).toBeNull();
    expect(sanitizeAlertDescriptor({ ...LOCKDOWN, scope: 'group' })).toBeNull();
  });

  it('refuses a descriptor with no type or no severity', () => {
    expect(sanitizeAlertDescriptor({ ...LOCKDOWN, type: '' })).toBeNull();
    expect(sanitizeAlertDescriptor({ ...LOCKDOWN, severity: undefined })).toBeNull();
  });

  it('refuses junk of every shape rather than coercing it', () => {
    for (const junk of [null, undefined, 0, '', 'LOCKDOWN', [], true]) {
      expect(sanitizeAlertDescriptor(junk)).toBeNull();
    }
  });

  it('bounds the strings so a poisoned Redis value cannot be a payload bomb', () => {
    expect(sanitizeAlertDescriptor({ ...LOCKDOWN, type: 'x'.repeat(65) })).toBeNull();
    expect(sanitizeAlertDescriptor({ ...LOCKDOWN, scopeNote: 'x'.repeat(513) })).toEqual({
      ...LOCKDOWN,
      scopeNote: null, // over-length note is dropped, the alert still raises
    });
  });
});

describe('epoch round-trip', () => {
  it('carries the descriptor through serialize → Redis → parse', async () => {
    const redis = fakeRedis();
    bumpTenantEmergencyEpoch({ redis }, 't1', { active: true, alert: LOCKDOWN });
    await settle();
    const raw = redis.store.get('venueos:emrev:t:t1');
    expect(raw).toBeTruthy();
    expect(parseEpoch(raw!)!.alert).toEqual(LOCKDOWN);
  });

  it('stays readable by a replica that only understands stamp:active', async () => {
    // The value gained a THIRD colon-separated field. An older replica splits
    // on ':' and reads [0] and [1] — it must still see the right stamp and
    // the right flag, or a mixed-version deploy mis-reads live alert state.
    const redis = fakeRedis();
    bumpTenantEmergencyEpoch({ redis }, 't1', { active: true, alert: LOCKDOWN });
    await settle();
    const [stamp, active] = redis.store.get('venueos:emrev:t:t1')!.split(':');
    expect(Number(stamp)).toBeGreaterThan(0);
    expect(active).toBe('1');
  });

  it('reads an unparseable descriptor as NO descriptor, never as a raise', () => {
    expect(parseEpoch('123:1:@@@not-base64-json@@@')!.alert).toBeNull();
    expect(parseEpoch(`123:1:${'A'.repeat(ALERT_DESCRIPTOR_MAX_BYTES + 1)}`)!.alert).toBeNull();
    // Base64url of `{"type":"X"}` — valid JSON, invalid descriptor.
    const halfBaked = Buffer.from('{"type":"X"}', 'utf8').toString('base64url');
    expect(parseEpoch(`123:1:${halfBaked}`)!.alert).toBeNull();
  });

  it('never keeps a descriptor on an epoch that says no alert is active', () => {
    // Belt and braces: the pair is tied together at the WRITE so no reader
    // ever has to remember to check both.
    const e = bumpTenantEmergencyEpoch({}, 't1', { active: false, alert: LOCKDOWN });
    expect(e.alert).toBeNull();
  });
});

describe('resolveEmergencyRev — when an alert may ride the response', () => {
  it('serves the descriptor to a screen with no alert on glass', async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: LOCKDOWN });
    const a = await resolveEmergencyRev({}, 's1', 't1');
    expect(a.alert).toEqual(LOCKDOWN);
    expect(a.active).toBe(true);
  });

  it('serves it on a COLD record — an unknown screen is a raise candidate', async () => {
    // A screen that just booted (or a restarted API) has no record. Raising
    // is the safe direction; the manifest fetch on the same tick corrects it.
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: LOCKDOWN });
    const a = await resolveEmergencyRev({}, 'never-seen', 't1');
    expect(a.cold).toBe(true);
    expect(a.alert).toEqual(LOCKDOWN);
  });

  it('WITHHOLDS it from a screen already showing an alert', async () => {
    // The screen may be on a per-screen EVACUATE override that the
    // tenant-wide descriptor knows nothing about. Replacing one alert with
    // another from a fast path is the mistake this guard exists to prevent.
    noteScreenEmergencyState('s1', { tenantId: 't1', sig: 'sig-evac', active: true });
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: LOCKDOWN });
    const a = await resolveEmergencyRev({}, 's1', 't1');
    expect(a.alert).toBeNull();
    expect(a.active).toBe(true); // still reported active — only the RAISE is withheld
  });

  it('serves NOTHING for a group/device-scoped trigger (no descriptor minted)', async () => {
    // That is how the controller calls it: `bump(tid)` with no `alert`, on a
    // tenant that has never had a tenant-wide trigger.
    bumpTenantEmergencyEpoch({}, 't1');
    const a = await resolveEmergencyRev({}, 's1', 't1');
    expect(a.alert).toBeNull();
  });

  it('stops serving it the moment the all-clear lands', async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: LOCKDOWN });
    expect((await resolveEmergencyRev({}, 's1', 't1')).alert).toEqual(LOCKDOWN);
    bumpTenantEmergencyEpoch({}, 't1', { active: false, alert: null });
    const after = await resolveEmergencyRev({}, 's1', 't1');
    expect(after.alert).toBeNull();
    expect(after.active).toBe(false);
  });

  it('does not re-raise after an all-clear followed by an unrelated bump', async () => {
    // The regression this guards: an all-clear drops the descriptor, then a
    // group trigger bumps the epoch with `active` OMITTED. If `alert` were
    // inherited independently of `active`, the tenant-wide lockdown would
    // come back from the dead.
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: LOCKDOWN });
    bumpTenantEmergencyEpoch({}, 't1', { active: false, alert: null });
    bumpTenantEmergencyEpoch({}, 't1'); // group-scoped trigger
    expect((await resolveEmergencyRev({}, 's1', 't1')).alert).toBeNull();
  });

  it('never invents a descriptor when none was ever stored', async () => {
    const a = await resolveEmergencyRev({}, 's1', 't1');
    expect(a.alert).toBeNull();
    expect(a.active).toBe(false);
  });

  it('serves no descriptor to an unpaired screen (no tenant, no epoch)', async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: LOCKDOWN });
    expect((await resolveEmergencyRev({}, 's1', null)).alert).toBeNull();
  });

  it('is tenant-scoped: another tenant\'s alert never leaks', async () => {
    bumpTenantEmergencyEpoch({}, 'tenant-a', { active: true, alert: LOCKDOWN });
    expect((await resolveEmergencyRev({}, 's1', 'tenant-b')).alert).toBeNull();
  });
});

describe('the Redis-down case this exists for', () => {
  it('still raises from the in-process epoch when the mirror is unreachable', async () => {
    // The whole point: this is the 21.6 s scenario. The local write is
    // synchronous and authoritative on the replica that served the trigger,
    // so the descriptor is available to the very next poll with no Redis.
    const redis = fakeRedis();
    redis.down = true;
    bumpTenantEmergencyEpoch({ redis }, 't1', { active: true, alert: LOCKDOWN });
    await settle();
    const a = await resolveEmergencyRev({ redis }, 's1', 't1');
    expect(a.alert).toEqual(LOCKDOWN);
  });

  it('a bump whose Redis mirror throws does not reject or lose the local value', async () => {
    const redis = fakeRedis();
    redis.down = true;
    expect(() =>
      bumpTenantEmergencyEpoch({ redis }, 't1', { active: true, alert: LOCKDOWN }),
    ).not.toThrow();
    await settle();
    expect((await readTenantEmergencyEpoch({ redis }, 't1')).alert).toEqual(LOCKDOWN);
  });

  it('prefers a NEWER remote epoch together with its own descriptor', async () => {
    // A descriptor can never be paired with an epoch it did not come from,
    // because they are one value. Here the remote (another replica's newer
    // trigger) wins, and its descriptor comes with it.
    const redis = fakeRedis();
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: LOCKDOWN });
    const remote: EmergencyAlertDescriptor = { ...LOCKDOWN, type: 'EVACUATE' };
    redis.store.set(
      'venueos:emrev:t:t1',
      `${Date.now() + 60_000}:1:${Buffer.from(JSON.stringify(remote), 'utf8').toString('base64url')}`,
    );
    const e = await readTenantEmergencyEpoch({ redis }, 't1');
    expect(e.alert).toEqual(remote);
  });
});
