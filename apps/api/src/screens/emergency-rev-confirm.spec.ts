/**
 * emergency-rev-confirm.spec.ts — the raise descriptor is offered ONLY when
 * the database confirms it (emergency-rev.ts rule 6, 2026-11-01).
 *
 * THE WEAKNESS. `GET /screens/:id/emergency-rev` signs the tenant epoch's
 * raise descriptor with the same HMAC every WS/SSE push carries. The epoch is
 * read from Redis, and anyone who could write Redis (REDIS_URL was in the
 * 2026-10-21 Railway environment leak) could plant `<stamp>:1:<descriptor>`
 * and have the API sign a lockdown for every screen of that tenant —
 * repeatedly, with no signing key. A signing oracle.
 *
 * THE RULE PINNED HERE. A descriptor is offered only when the manifest's own
 * read of the tenant has a live tenant-wide alert of the same type, severity
 * and drill flag. Unreadable / slow / disagreeing → no descriptor, `active`
 * untouched (the player still fetches the manifest). The read is bounded,
 * single-flight and cached per tenant, and a refusal is evidence: a forgery
 * signal only when it cannot be a legitimate trigger in flight.
 *
 * Controller-level and end-to-end (real trigger, real manifest) proofs live
 * in screens.emergency-rev-confirmation.spec.ts.
 */

import { invalidateTenantState, resetManifestCacheForTests } from './manifest-hot-cache';
import {
  RAISE_CONFIRM_FLIGHT_MAX_AGE_MS,
  RAISE_CONFIRM_NEGATIVE_TTL_MS,
  RAISE_CONFIRM_POSITIVE_TTL_MS,
  RAISE_CONFIRM_TIMEOUT_MS,
  RAISE_REFUSAL_COMMIT_GRACE_MS,
  RAISE_REFUSAL_LOG_INTERVAL_MS,
  RAISE_REFUSAL_OWNER_ALERT_INTERVAL_MS,
  TENANT_EPOCH_REDIS_PREFIX,
  bumpTenantEmergencyEpoch,
  classifyDescriptorRefusal,
  descriptorMatchesConfirmed,
  epochDescriptorOrigin,
  formatDescriptorRefusalLine,
  localTenantEmergencyEpoch,
  noteScreenEmergencyState,
  readTenantEmergencyEpoch,
  renderDescriptorRefusalAlert,
  resetEmergencyRevForTests,
  resolveEmergencyRev,
  type ConfirmedTenantAlert,
  type EmergencyAlertDescriptor,
  type EmergencyRevDeps,
  type EmergencyRevRedis,
  type EmergencyRevRefusal,
} from './emergency-rev';

/** Exactly what `triggerEmergency` mints for a tenant-scoped live lockdown: the
 *  request's LOWER-CASE incident type (the Zod enum), CRITICAL, no note/expiry. */
const MINTED_LOCKDOWN: EmergencyAlertDescriptor = {
  type: 'lockdown',
  severity: 'CRITICAL',
  scopeNote: null,
  scope: 'tenant',
  expiresAt: null,
};
const MINTED_DRILL: EmergencyAlertDescriptor = { ...MINTED_LOCKDOWN, isDrill: true };

/** What the same trigger writes to the Tenant row (`emergencyType` upper-cased). */
const DB_LOCKDOWN: ConfirmedTenantAlert = { type: 'LOCKDOWN', severity: 'CRITICAL', isDrill: false };
const DB_DRILL: ConfirmedTenantAlert = { ...DB_LOCKDOWN, isDrill: true };
const DB_WEATHER: ConfirmedTenantAlert = { type: 'WEATHER', severity: 'CRITICAL', isDrill: false };

function fakeRedis(): EmergencyRevRedis & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async getString(key: string) {
      return store.get(key) ?? null;
    },
    async setString(key: string, value: string) {
      store.set(key, value);
      return true;
    },
  };
}

/** Write a value straight into the shared mirror — what an attacker with REDIS_URL can do. */
function plant(
  redis: { store: Map<string, string> },
  tenantId: string,
  stamp: number,
  descriptor: Record<string, unknown> = MINTED_LOCKDOWN as unknown as Record<string, unknown>,
): void {
  const encoded = Buffer.from(JSON.stringify(descriptor), 'utf8').toString('base64url');
  redis.store.set(`${TENANT_EPOCH_REDIS_PREFIX}${tenantId}`, `${Math.floor(stamp)}:1:${encoded}`);
}

/** A database that answers `alert` for every tenant (or per tenant). */
function db(alert: ConfirmedTenantAlert | null | Record<string, ConfirmedTenantAlert | null>) {
  return jest.fn(async (tenantId: string): Promise<ConfirmedTenantAlert | null> => {
    if (alert && !('type' in alert)) return (alert as Record<string, ConfirmedTenantAlert | null>)[tenantId] ?? null;
    return alert as ConfirmedTenantAlert | null;
  });
}

function depsWith(
  confirmTenantAlert: EmergencyRevDeps['confirmTenantAlert'],
  extra: Partial<EmergencyRevDeps> = {},
) {
  const refusals: EmergencyRevRefusal[] = [];
  const deps: EmergencyRevDeps = {
    confirmTenantAlert,
    onDescriptorRefused: (r) => {
      refusals.push(r);
    },
    ...extra,
  };
  return { deps, refusals };
}

/** Let fire-and-forget Redis mirror writes settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const savedRaiseSwitch = process.env.EMERGENCY_REV_RAISE;

beforeEach(() => {
  resetEmergencyRevForTests('origin-confirm');
  resetManifestCacheForTests();
  delete process.env.EMERGENCY_REV_RAISE;
});

afterEach(() => {
  if (savedRaiseSwitch === undefined) delete process.env.EMERGENCY_REV_RAISE;
  else process.env.EMERGENCY_REV_RAISE = savedRaiseSwitch;
});

// ── 1. Only what the database confirms is offered ────────────────────────

describe('only what the database confirms is offered for signing', () => {
  it('a descriptor planted in Redis with NO live alert in the database is never returned — `active` still is', async () => {
    const redis = fakeRedis();
    plant(redis, 't1', Date.now() - 120_000);
    const confirm = db(null);
    const { deps, refusals } = depsWith(confirm, { redis });

    const a = await resolveEmergencyRev(deps, 's1', 't1');

    expect(a.alert).toBeNull();
    // `active` is reported from the epoch exactly as before: the player still
    // learns an alert may be up and fetches the manifest (the arbiter).
    expect(a.active).toBe(true);
    expect(confirm).toHaveBeenCalledWith('t1');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ tenantId: 't1', screenId: 's1', reason: 'no-alert', origin: 'redis', confirmed: null });
  });

  it('a real alert the database confirms still rides exactly as before (live: no isDrill key at all)', async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const { deps, refusals } = depsWith(db(DB_LOCKDOWN));

    const a = await resolveEmergencyRev(deps, 's1', 't1');

    // Byte-for-byte the descriptor the trigger minted — lower-case type and
    // all — so the signed envelope the player receives is what it was.
    expect(a.alert).toEqual(MINTED_LOCKDOWN);
    expect('isDrill' in (a.alert as object)).toBe(false);
    expect(a.active).toBe(true);
    expect(refusals).toHaveLength(0);
  });

  it('a real DRILL rides with its drill flag', async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_DRILL });
    const { deps } = depsWith(db(DB_DRILL));
    const a = await resolveEmergencyRev(deps, 's1', 't1');
    expect(a.alert).toEqual(MINTED_DRILL);
    expect(a.alert?.isDrill).toBe(true);
  });

  it('a database read that THROWS → no descriptor, no exception, `active` unchanged', async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const confirm = jest.fn(async () => {
      throw new Error('P1001: database unreachable');
    });
    const { deps, refusals } = depsWith(confirm);

    await expect(resolveEmergencyRev(deps, 's1', 't1')).resolves.toMatchObject({ alert: null, active: true });
    expect(refusals[0]).toMatchObject({ reason: 'unavailable', forgerySignal: false, notifyOwner: false });
  });

  it('a confirmer that throws SYNCHRONOUSLY is the same unknown', async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const confirm = jest.fn(() => {
      throw new Error('boom');
    }) as unknown as EmergencyRevDeps['confirmTenantAlert'];
    const { deps } = depsWith(confirm);
    await expect(resolveEmergencyRev(deps, 's1', 't1')).resolves.toMatchObject({ alert: null, active: true });
  });

  it(`a database read that HANGS → answered within ${RAISE_CONFIRM_TIMEOUT_MS} ms with no descriptor`, async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const confirm = jest.fn(() => new Promise<ConfirmedTenantAlert | null>(() => undefined));
    const { deps, refusals } = depsWith(confirm);

    const started = Date.now();
    const a = await resolveEmergencyRev(deps, 's1', 't1');
    const elapsed = Date.now() - started;

    expect(a).toMatchObject({ alert: null, active: true });
    expect(elapsed).toBeGreaterThanOrEqual(RAISE_CONFIRM_TIMEOUT_MS - 20);
    expect(elapsed).toBeLessThan(RAISE_CONFIRM_TIMEOUT_MS + 700);
    expect(refusals[0]).toMatchObject({ reason: 'unavailable', forgerySignal: false });
  });

  it('a MISMATCH (Redis says LOCKDOWN, the database says WEATHER) is refused', async () => {
    const redis = fakeRedis();
    plant(redis, 't1', Date.now() - 120_000);
    const { deps, refusals } = depsWith(db(DB_WEATHER), { redis });

    const a = await resolveEmergencyRev(deps, 's1', 't1');

    expect(a.alert).toBeNull();
    expect(a.active).toBe(true);
    expect(refusals[0]).toMatchObject({ reason: 'mismatch', confirmed: DB_WEATHER, descriptor: { type: 'lockdown' } });
  });

  it('a severity mismatch, and a drill/live mismatch in either direction, are refused', async () => {
    for (const [minted, inDb] of [
      [MINTED_LOCKDOWN, { ...DB_LOCKDOWN, severity: 'LOW' }],
      [MINTED_LOCKDOWN, DB_DRILL],
      [MINTED_DRILL, DB_LOCKDOWN],
    ] as Array<[EmergencyAlertDescriptor, ConfirmedTenantAlert]>) {
      resetEmergencyRevForTests('origin-confirm');
      bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: minted });
      const { deps, refusals } = depsWith(db(inDb));
      expect((await resolveEmergencyRev(deps, 's1', 't1')).alert).toBeNull();
      expect(refusals[0].reason).toBe('mismatch');
    }
  });

  it('a descriptor carrying a scope note or an expiry is refused even when type and severity match', async () => {
    // A tenant-scoped trigger writes neither. Without this an attacker could
    // ride a REAL lockdown and have their own words ("EVACUATE VIA NORTH
    // EXIT") signed onto every screen of the tenant.
    const redis = fakeRedis();
    for (const extra of [{ scopeNote: 'Evacuate via the north exit' }, { expiresAt: 4_102_444_800 }]) {
      resetEmergencyRevForTests('origin-confirm');
      plant(redis, 't1', Date.now() - 120_000, { ...MINTED_LOCKDOWN, ...extra });
      const { deps, refusals } = depsWith(db(DB_LOCKDOWN), { redis });
      expect((await resolveEmergencyRev(deps, 's1', 't1')).alert).toBeNull();
      expect(refusals[0].reason).toBe('mismatch');
    }
  });

  it('junk from the confirmer is an unknown, never a confirmation', async () => {
    for (const junk of [{ type: '', severity: 'CRITICAL' }, { type: 'LOCKDOWN' }, 'LOCKDOWN', 42, true, []]) {
      resetEmergencyRevForTests('origin-confirm');
      bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
      const { deps, refusals } = depsWith(jest.fn(async () => junk as any));
      expect((await resolveEmergencyRev(deps, 's1', 't1')).alert).toBeNull();
      expect(refusals[0].reason).toBe('unavailable');
    }
  });

  it('WITHOUT a confirmer nothing is offered and nothing is recorded (the cheap pre-304 pass)', async () => {
    const redis = fakeRedis();
    plant(redis, 't1', Date.now() - 120_000);
    const hook = jest.fn();
    const a = await resolveEmergencyRev({ redis, onDescriptorRefused: hook }, 's1', 't1');
    expect(a).toMatchObject({ alert: null, active: true });
    expect(hook).not.toHaveBeenCalled();
  });

  it('the database is never asked outside the raise window', async () => {
    const confirm = db(DB_LOCKDOWN);
    const { deps } = depsWith(confirm);

    // A screen already showing an alert (its last manifest build said so).
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    noteScreenEmergencyState('on-glass', { tenantId: 't1', sig: 'x', active: true });
    expect((await resolveEmergencyRev(deps, 'on-glass', 't1')).alert).toBeNull();

    // A group/device-scoped trigger: an epoch with no descriptor.
    bumpTenantEmergencyEpoch({}, 't2', { active: true });
    expect((await resolveEmergencyRev(deps, 's', 't2')).alert).toBeNull();

    // No alert at all, and an unpaired screen.
    expect((await resolveEmergencyRev(deps, 's', 't3')).alert).toBeNull();
    expect((await resolveEmergencyRev(deps, 's', null)).alert).toBeNull();

    // The kill switch.
    process.env.EMERGENCY_REV_RAISE = 'off';
    expect((await resolveEmergencyRev(deps, 'cold', 't1')).alert).toBeNull();

    expect(confirm).not.toHaveBeenCalled();
  });

  it('the revision and `active` are the same whatever the database said', async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const now = Date.now();
    const yes = await resolveEmergencyRev(depsWith(db(DB_LOCKDOWN)).deps, 's1', 't1', now);
    // Force a fresh read (the tenant-state epoch is not an input to the
    // revision), this time against a database that disagrees.
    invalidateTenantState('t1');
    const no = await resolveEmergencyRev(depsWith(db(null)).deps, 's1', 't1', now);
    expect(yes.alert).not.toBeNull();
    expect(no.alert).toBeNull();
    expect(no.rev).toBe(yes.rev);
    expect(no.active).toBe(yes.active);
    // …and so does the cheap pass, which never confirms.
    expect((await resolveEmergencyRev({}, 's1', 't1', now)).rev).toBe(yes.rev);
  });
});

// ── 2. Cost: the herd costs one read per tenant per window ───────────────

describe('cost — one confirmation read per tenant per window, never one per screen', () => {
  it('50 concurrent polls of one tenant cost ONE read (single-flight)', async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const confirm = db(DB_LOCKDOWN);
    const { deps } = depsWith(confirm);
    const now = Date.now();

    const answers = await Promise.all(
      Array.from({ length: 50 }, (_, i) => resolveEmergencyRev(deps, `screen-${i}`, 't1', now)),
    );

    expect(answers.every((a) => a.alert !== null)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it(`polls inside ${RAISE_CONFIRM_POSITIVE_TTL_MS} ms reuse a confirmation; at ${RAISE_CONFIRM_POSITIVE_TTL_MS} ms it is read again`, async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const confirm = db(DB_LOCKDOWN);
    const { deps } = depsWith(confirm);
    const t0 = Date.now();

    for (const dt of [0, 400, 1_200, RAISE_CONFIRM_POSITIVE_TTL_MS - 1]) {
      expect((await resolveEmergencyRev(deps, `s-${dt}`, 't1', t0 + dt)).alert).toEqual(MINTED_LOCKDOWN);
    }
    expect(confirm).toHaveBeenCalledTimes(1);

    await resolveEmergencyRev(deps, 's-late', 't1', t0 + RAISE_CONFIRM_POSITIVE_TTL_MS);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it(`a negative answer is reused for less than ${RAISE_CONFIRM_NEGATIVE_TTL_MS} ms, then retried`, async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const confirm = db(null);
    const { deps } = depsWith(confirm);
    const t0 = Date.now();

    await resolveEmergencyRev(deps, 's1', 't1', t0);
    await resolveEmergencyRev(deps, 's2', 't1', t0 + 100);
    await resolveEmergencyRev(deps, 's3', 't1', t0 + RAISE_CONFIRM_NEGATIVE_TTL_MS - 1);
    expect(confirm).toHaveBeenCalledTimes(1);

    // The trigger's transaction has committed in between: the retry confirms.
    confirm.mockResolvedValue(DB_LOCKDOWN);
    const a = await resolveEmergencyRev(deps, 's4', 't1', t0 + RAISE_CONFIRM_NEGATIVE_TTL_MS);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(a.alert).toEqual(MINTED_LOCKDOWN);
  });

  it("the trigger's post-commit invalidation re-reads AT ONCE — no waiting out the negative window", async () => {
    // The trigger bumps the epoch BEFORE its transaction commits, then calls
    // `invalidateTenantState` again after the commit. A poll inside that
    // window is refused; the first poll after the commit must confirm.
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const confirm = db(null);
    const { deps } = depsWith(confirm);
    const t0 = Date.now();

    expect((await resolveEmergencyRev(deps, 's1', 't1', t0)).alert).toBeNull();
    confirm.mockResolvedValue(DB_LOCKDOWN);
    invalidateTenantState('t1'); // ← what the trigger does right after `$transaction`
    const a = await resolveEmergencyRev(deps, 's2', 't1', t0 + 10);
    expect(a.alert).toEqual(MINTED_LOCKDOWN);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('a new epoch stamp never reuses the previous answer', async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const confirm = db(DB_LOCKDOWN);
    const { deps } = depsWith(confirm);
    const t0 = Date.now();
    await resolveEmergencyRev(deps, 's1', 't1', t0);
    // An SOS / broadcast bump: same alert, new stamp → read again.
    bumpTenantEmergencyEpoch({}, 't1');
    await resolveEmergencyRev(deps, 's2', 't1', t0 + 10);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it(`a read that never settles blocks a new one only until ${RAISE_CONFIRM_FLIGHT_MAX_AGE_MS} ms`, async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const confirm = jest.fn() as jest.Mock;
    confirm.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValue(DB_LOCKDOWN);
    const { deps } = depsWith(confirm as unknown as EmergencyRevDeps['confirmTenantAlert']);
    const t0 = Date.now();

    expect((await resolveEmergencyRev(deps, 's1', 't1', t0)).alert).toBeNull();
    // Still the one hung read: joined, not repeated (a stalled database gets
    // ONE outstanding confirmation per tenant).
    expect((await resolveEmergencyRev(deps, 's2', 't1', t0 + 5_000)).alert).toBeNull();
    expect(confirm).toHaveBeenCalledTimes(1);
    // Past the flight's max age a fresh read starts and confirms.
    const a = await resolveEmergencyRev(deps, 's3', 't1', t0 + RAISE_CONFIRM_FLIGHT_MAX_AGE_MS + 1);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(a.alert).toEqual(MINTED_LOCKDOWN);
  });

  it('tenants are confirmed independently', async () => {
    bumpTenantEmergencyEpoch({}, 'ta', { active: true, alert: MINTED_LOCKDOWN });
    bumpTenantEmergencyEpoch({}, 'tb', { active: true, alert: MINTED_LOCKDOWN });
    const confirm = db({ ta: DB_LOCKDOWN, tb: null });
    const { deps } = depsWith(confirm);
    const now = Date.now();
    expect((await resolveEmergencyRev(deps, 's-a', 'ta', now)).alert).toEqual(MINTED_LOCKDOWN);
    expect((await resolveEmergencyRev(deps, 's-b', 'tb', now)).alert).toBeNull();
    expect(confirm.mock.calls.map((c) => c[0]).sort()).toEqual(['ta', 'tb']);
  });
});

// ── 3. Evidence: a refusal is a forgery signal only when it can be one ───

describe('evidence — when a refusal is a forgery signal', () => {
  it("a descriptor THIS process minted is never a signal (the trigger's own pre-commit window)", async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const { deps, refusals } = depsWith(db(null));
    const t0 = Date.now();

    await resolveEmergencyRev(deps, 's1', 't1', t0);
    // …and not even an hour later (a trigger whose write failed — its operator
    // was already told; it is not an attack).
    await resolveEmergencyRev(deps, 's2', 't1', t0 + RAISE_REFUSAL_OWNER_ALERT_INTERVAL_MS + 1);

    expect(refusals.map((r) => r.origin)).toEqual(['local', 'local']);
    expect(refusals.every((r) => !r.forgerySignal && !r.notifyOwner)).toBe(true);
    expect(refusals[0].log).toBe(true);
  });

  it('a Redis-sourced descriptor the database disagrees with IS a signal — the owner is told once per tenant per hour', async () => {
    const redis = fakeRedis();
    const t0 = Date.now();
    plant(redis, 't1', t0 - 60_000);
    plant(redis, 't2', t0 - 60_000);
    const { deps, refusals } = depsWith(db(null), { redis });

    await resolveEmergencyRev(deps, 's1', 't1', t0);
    await resolveEmergencyRev(deps, 's2', 't1', t0 + 1_000);
    await resolveEmergencyRev(deps, 's3', 't1', t0 + 30 * 60_000);
    await resolveEmergencyRev(deps, 's4', 't2', t0 + 30 * 60_000); // its own budget
    await resolveEmergencyRev(deps, 's5', 't1', t0 + RAISE_REFUSAL_OWNER_ALERT_INTERVAL_MS);

    expect(refusals.map((r) => [r.tenantId, r.origin, r.forgerySignal, r.notifyOwner])).toEqual([
      ['t1', 'redis', true, true],
      ['t1', 'redis', true, false],
      ['t1', 'redis', true, false],
      ['t2', 'redis', true, true],
      ['t1', 'redis', true, true],
    ]);
  });

  it('a FRESH Redis-sourced descriptor (another replica mid-commit) is not a signal until it outlives the commit grace', async () => {
    const redis = fakeRedis();
    const t0 = Date.now();
    plant(redis, 't1', t0);
    const { deps, refusals } = depsWith(db(null), { redis });

    for (const dt of [0, 10_000, RAISE_REFUSAL_COMMIT_GRACE_MS - 1]) {
      await resolveEmergencyRev(deps, `s-${dt}`, 't1', t0 + dt);
    }
    expect(refusals.every((r) => r.origin === 'redis' && !r.forgerySignal)).toBe(true);

    await resolveEmergencyRev(deps, 's-grace', 't1', t0 + RAISE_REFUSAL_COMMIT_GRACE_MS);
    expect(refusals[refusals.length - 1]).toMatchObject({ forgerySignal: true, notifyOwner: true });
  });

  it('re-stamping the planted value to look fresh does not evade it (the streak)', async () => {
    const redis = fakeRedis();
    const t0 = Date.now();
    const { deps, refusals } = depsWith(db(null), { redis });

    for (let dt = 0; dt <= RAISE_REFUSAL_COMMIT_GRACE_MS; dt += 5_000) {
      plant(redis, 't1', t0 + dt); // always "just written"
      await resolveEmergencyRev(deps, `s-${dt}`, 't1', t0 + dt);
    }

    expect(refusals.every((r) => r.epochAgeMs === 0)).toBe(true);
    expect(refusals.slice(0, -1).some((r) => r.forgerySignal)).toBe(false);
    expect(refusals[refusals.length - 1]).toMatchObject({ forgerySignal: true, notifyOwner: true });
  });

  it('a stamp in the future (no API clock writes one) is a signal at once', async () => {
    const redis = fakeRedis();
    const t0 = Date.now();
    plant(redis, 't1', t0 + 60_000);
    const { deps, refusals } = depsWith(db(null), { redis });
    await resolveEmergencyRev(deps, 's1', 't1', t0);
    expect(refusals[0]).toMatchObject({ origin: 'redis', forgerySignal: true, notifyOwner: true });
  });

  it('an unreadable database is never a signal, however old the descriptor', async () => {
    const redis = fakeRedis();
    plant(redis, 't1', Date.now() - 3_600_000);
    const confirm = jest.fn(async () => {
      throw new Error('timeout');
    });
    const { deps, refusals } = depsWith(confirm, { redis });
    await resolveEmergencyRev(deps, 's1', 't1');
    expect(refusals[0]).toMatchObject({ reason: 'unavailable', forgerySignal: false, notifyOwner: false });
  });

  it('a descriptor adopted from Redis and CARRIED by a local bump (an SOS) stays Redis-sourced', async () => {
    const redis = fakeRedis();
    const t0 = Date.now();
    plant(redis, 't1', t0 - 1_000);
    await readTenantEmergencyEpoch({ redis }, 't1', t0); // adopted into the local map
    bumpTenantEmergencyEpoch({ redis }, 't1'); // SOS / broadcast: `alert` omitted, carried
    expect(localTenantEmergencyEpoch('t1')?.alert).toEqual(MINTED_LOCKDOWN);
    expect(epochDescriptorOrigin('t1', localTenantEmergencyEpoch('t1')!)).toBe('redis');
  });

  it('a descriptor minted here and carried by a later local bump stays local; a newer Redis value is redis', async () => {
    const redis = fakeRedis();
    bumpTenantEmergencyEpoch({ redis }, 't1', { active: true, alert: MINTED_LOCKDOWN });
    bumpTenantEmergencyEpoch({ redis }, 't1'); // SOS
    expect(epochDescriptorOrigin('t1', localTenantEmergencyEpoch('t1')!)).toBe('local');

    await settle(); // let the bumps' own fire-and-forget mirror writes land first
    plant(redis, 't1', Date.now() + 1_000);
    const e = await readTenantEmergencyEpoch({ redis }, 't1', Date.now() + 2_500);
    expect(epochDescriptorOrigin('t1', e)).toBe('redis');
  });

  it('a confirmed alert ends the streak', async () => {
    const redis = fakeRedis();
    const t0 = Date.now();
    const confirm = db(null);
    const { deps, refusals } = depsWith(confirm, { redis });

    plant(redis, 't1', t0);
    await resolveEmergencyRev(deps, 's1', 't1', t0);
    plant(redis, 't1', t0 + 20_000);
    await resolveEmergencyRev(deps, 's2', 't1', t0 + 20_000);

    confirm.mockResolvedValue(DB_LOCKDOWN);
    plant(redis, 't1', t0 + 25_000);
    expect((await resolveEmergencyRev(deps, 's3', 't1', t0 + 25_000)).alert).toEqual(MINTED_LOCKDOWN);

    confirm.mockResolvedValue(null);
    plant(redis, 't1', t0 + 31_000);
    await resolveEmergencyRev(deps, 's4', 't1', t0 + 31_000);
    // 31 s after the FIRST refusal, but the streak restarted after the
    // confirmation — so this is a fresh disagreement, not a signal.
    expect(refusals).toHaveLength(3);
    expect(refusals[2]).toMatchObject({ forgerySignal: false });
  });

  it('the log line is throttled per tenant per kind; a new kind still gets its line', async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const confirm = db(null);
    const { deps, refusals } = depsWith(confirm);
    const t0 = Date.now();

    await resolveEmergencyRev(deps, 's1', 't1', t0);
    await resolveEmergencyRev(deps, 's2', 't1', t0 + 1_000);
    confirm.mockRejectedValue(new Error('down'));
    await resolveEmergencyRev(deps, 's3', 't1', t0 + 2_000);
    confirm.mockResolvedValue(null);
    await resolveEmergencyRev(deps, 's4', 't1', t0 + RAISE_REFUSAL_LOG_INTERVAL_MS);

    expect(refusals.map((r) => [r.reason, r.log])).toEqual([
      ['no-alert', true],
      ['no-alert', false],
      ['unavailable', true],
      ['no-alert', true],
    ]);
  });

  it('a hook that throws never fails the poll', async () => {
    bumpTenantEmergencyEpoch({}, 't1', { active: true, alert: MINTED_LOCKDOWN });
    const deps: EmergencyRevDeps = {
      confirmTenantAlert: db(null),
      onDescriptorRefused: () => {
        throw new Error('logger exploded');
      },
    };
    await expect(resolveEmergencyRev(deps, 's1', 't1')).resolves.toMatchObject({ alert: null, active: true });
  });
});

// ── 4. The pure pieces ───────────────────────────────────────────────────

describe('descriptorMatchesConfirmed', () => {
  it('matches the trigger-minted descriptor against the row it wrote (type compared without case)', () => {
    expect(descriptorMatchesConfirmed(MINTED_LOCKDOWN, DB_LOCKDOWN)).toBe(true);
    expect(descriptorMatchesConfirmed({ ...MINTED_LOCKDOWN, type: 'LOCKDOWN' }, DB_LOCKDOWN)).toBe(true);
    expect(descriptorMatchesConfirmed(MINTED_DRILL, DB_DRILL)).toBe(true);
  });

  it('refuses every other difference', () => {
    expect(descriptorMatchesConfirmed(MINTED_LOCKDOWN, DB_WEATHER)).toBe(false);
    expect(descriptorMatchesConfirmed({ ...MINTED_LOCKDOWN, severity: 'critical' }, DB_LOCKDOWN)).toBe(false);
    expect(descriptorMatchesConfirmed(MINTED_DRILL, DB_LOCKDOWN)).toBe(false);
    expect(descriptorMatchesConfirmed(MINTED_LOCKDOWN, DB_DRILL)).toBe(false);
    expect(descriptorMatchesConfirmed({ ...MINTED_LOCKDOWN, scopeNote: 'x' }, DB_LOCKDOWN)).toBe(false);
    expect(descriptorMatchesConfirmed({ ...MINTED_LOCKDOWN, expiresAt: 1 }, DB_LOCKDOWN)).toBe(false);
  });
});

describe('classifyDescriptorRefusal', () => {
  const now = 1_800_000_000_000;
  const base = { now, streak: null };

  it('never: an unknown, or a descriptor this process minted', () => {
    for (const reason of ['no-alert', 'mismatch', 'unavailable'] as const) {
      expect(classifyDescriptorRefusal({ ...base, reason, origin: 'local', epochStamp: now - 3_600_000 }).forgerySignal).toBe(false);
    }
    expect(classifyDescriptorRefusal({ ...base, reason: 'unavailable', origin: 'redis', epochStamp: now - 3_600_000 }).forgerySignal).toBe(false);
  });

  it('a definite Redis-sourced disagreement: old stamp yes, fresh stamp not yet, future stamp yes', () => {
    const at = (epochStamp: number) =>
      classifyDescriptorRefusal({ ...base, reason: 'no-alert', origin: 'redis', epochStamp }).forgerySignal;
    expect(at(now - RAISE_REFUSAL_COMMIT_GRACE_MS)).toBe(true);
    expect(at(now - RAISE_REFUSAL_COMMIT_GRACE_MS + 1)).toBe(false);
    expect(at(now)).toBe(false);
    expect(at(now + 4_000)).toBe(false); // inside clock skew
    expect(at(now + 6_000)).toBe(true);
  });

  it('the streak continues across short gaps, restarts after a long one, and trips at the grace', () => {
    const step = (streak: { since: number; last: number } | null, t: number) =>
      classifyDescriptorRefusal({ reason: 'mismatch', origin: 'redis', epochStamp: t, now: t, streak });
    let r = step(null, now);
    expect(r).toEqual({ forgerySignal: false, streak: { since: now, last: now } });
    r = step(r.streak, now + 20_000);
    expect(r.streak).toEqual({ since: now, last: now + 20_000 });
    r = step(r.streak, now + 30_000);
    expect(r.forgerySignal).toBe(true);
    // A gap longer than the grace restarts it.
    r = step({ since: now, last: now }, now + RAISE_REFUSAL_COMMIT_GRACE_MS + 1);
    expect(r).toEqual({ forgerySignal: false, streak: { since: now + RAISE_REFUSAL_COMMIT_GRACE_MS + 1, last: now + RAISE_REFUSAL_COMMIT_GRACE_MS + 1 } });
  });
});

describe('the evidence copy carries no attacker-chosen characters', () => {
  const refusal: EmergencyRevRefusal = {
    tenantId: 'tenant-a',
    screenId: 'screen-a',
    reason: 'no-alert',
    origin: 'redis',
    descriptor: { type: 'lockdown\n[emergency-rev] all clear ok', severity: 'CRITICAL\r\nX-Injected: 1', isDrill: false },
    confirmed: null,
    epochStamp: 1_800_000_000_000,
    epochAgeMs: 90_000,
    forgerySignal: true,
    log: true,
    notifyOwner: true,
  };

  it('the log line is one line and names the source', () => {
    const line = formatDescriptorRefusalLine(refusal);
    expect(line.startsWith('[emergency-rev] descriptor refused: not confirmed by the database')).toBe(true);
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain('tenant=tenant-a');
    expect(line).toContain('source=redis');
    expect(line).toContain('reason=no-alert');
    expect(line).toContain('forgery-signal=yes');
    expect(line).not.toContain('[emergency-rev] all clear');
  });

  it('the owner mail cannot be rewritten by the descriptor', () => {
    const { subject, body } = renderDescriptorRefusalAlert(refusal);
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain('tenant-a');
    expect(body).not.toContain('X-Injected: 1');
    expect(body).not.toContain('[emergency-rev] all clear');
    expect(body).toContain('venueos:emrev:t:tenant-a');
    expect(body).toContain('REDIS_URL');
  });
});
