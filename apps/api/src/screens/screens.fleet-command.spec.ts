/**
 * Fleet Command Phase 2 — durable operator pushes + the deployment record.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ── What this pins, and why each one is load-bearing ──────────────────
 *
 * 1. THE DURABLE RIDE (the behavior change). Both refresh-web endpoints
 *    used to publish on Redis and stop there, so a screen whose push
 *    channel was dead never received the operator's click — the exact hole
 *    the wedge cron closed for its own pushes (AUTO_RECOVERY_PUSH_DEAD).
 *    The push now also stamps `pendingRefreshAt`, which the manifest
 *    carries as `refreshRequestedAt`. Per CLAUDE.md player rule 12 a change
 *    operators can observe ships tested per shape, never silently — that is
 *    what these cases are.
 *
 * 2. VALUE IDENTITY. One `value` instant is stamped on every target AND
 *    recorded on the Deployment row. The player acks by echoing that exact
 *    value; a clock comparison would reload-loop skewed signage boxes. If
 *    the two ever drift apart, convergence silently reads "never landed"
 *    forever — so the row's value and the screens' value are asserted equal.
 *
 * 3. BEST-EFFORT ISOLATION. The Redis push has already left by the time any
 *    of the bookkeeping runs. A failed Deployment write must degrade to
 *    exactly the pre-2026-08-31 behavior (push + audit), never to a failed
 *    operator click.
 *
 * 4. CONVERGENCE IS DERIVED, NEVER STORED — including the superseded case,
 *    which is the one a stored counter would get wrong: a LATER push
 *    replaces the value, and the older deployment is no longer outstanding
 *    on that screen even though `pendingRefreshAt` is not null.
 *
 * 5. TENANT SCOPING (TEN-001). Self + DIRECT non-archived children, exactly
 *    like fleet(). An archived child must stay excluded — a parent whose
 *    only children are archived test tenants is NOT an HQ (2026-07-23).
 *
 * 6. THE ACK EVENT FIRES ONLY ON THE VALUE MATCH. The clear IS the ack (no
 *    persisted ack column), so an event on every render proof would bury
 *    the one moment that proves a command completed.
 */
import { ScreensController } from './screens.controller';
import { RENDER_PROOF_STALE_MS } from './render-proof';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const NOW = 1_700_000_000_000;

function makeController(over: Record<string, any> = {}) {
  const mockPrisma: any = {
    client: {
      screen: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(async () => []),
        updateMany: jest.fn(async () => ({ count: 0 })),
        update: jest.fn(async () => ({ id: 'x' })),
      },
      tenant: { findMany: jest.fn(async () => []) },
      deployment: { create: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
      screenEvent: {
        create: jest.fn(async () => ({})),
        createMany: jest.fn(async () => ({ count: 0 })),
        findMany: jest.fn(async () => []),
      },
      auditLog: { create: jest.fn(async () => ({})) },
      ...over,
    },
  };
  const mockRedis: any = { publish: jest.fn(async () => undefined) };
  const mockSigner: any = {
    signMessage: jest.fn((type: string, payload: any) => ({
      eventId: 'evt_1',
      timestamp: NOW,
      type,
      payload,
      signature: 'sig',
    })),
  };
  const controller = new ScreensController(
    mockPrisma,
    mockRedis,
    mockSigner,
    { assertSeatAvailable: jest.fn() } as any,
    { syncSubscriptionQuantity: jest.fn() } as any,
    {} as any,
  );
  return { controller, mockPrisma, mockRedis, mockSigner };
}

const adminReq = (tenantId = 'tenant-a', id = 'user-1') =>
  ({ user: { id, tenantId, role: 'SCHOOL_ADMIN' } }) as any;

// ─────────────────────────────────────────────────────────────────────────
// 1 + 2 + 3 — the operator push: durable, recorded, and never fragile.
// ─────────────────────────────────────────────────────────────────────────
describe('POST /screens/refresh-web (tenant-wide) — durable + recorded', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('stamps pendingRefreshAt on every target and records ONE deployment carrying the SAME value', async () => {
    const { controller, mockPrisma, mockRedis } = makeController();
    mockPrisma.client.screen.findMany.mockResolvedValue([
      { id: 's1' },
      { id: 's2' },
      { id: 's3' },
    ]);

    const out: any = await controller.refreshWebAll(adminReq());
    expect(out.ok).toBe(true);

    // Durable ride: all three targets, tenant re-asserted on the write.
    const update = mockPrisma.client.screen.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: { in: ['s1', 's2', 's3'] }, tenantId: 'tenant-a' });
    const stamped: Date = update.data.pendingRefreshAt;
    expect(stamped.getTime()).toBe(NOW);

    // ONE deployment row, and its `value` IS the stamped value. Drift here
    // means every future convergence read says "never landed".
    expect(mockPrisma.client.deployment.create).toHaveBeenCalledTimes(1);
    const dep = mockPrisma.client.deployment.create.mock.calls[0][0].data;
    expect(dep.value.getTime()).toBe(stamped.getTime());
    expect(dep.tenantId).toBe('tenant-a');
    expect(dep.createdById).toBe('user-1');
    expect(dep.targetIds).toEqual(['s1', 's2', 's3']);
    expect(dep.targetCount).toBe(3);
    expect(dep.label).toBe('Push update · 3 screens');

    // One timeline row per target.
    const events = mockPrisma.client.screenEvent.createMany.mock.calls[0][0].data;
    expect(events).toHaveLength(3);
    expect(events.every((e: any) => e.kind === 'refresh-requested')).toBe(true);
    expect(events.every((e: any) => e.tenantId === 'tenant-a')).toBe(true);
    expect(events[0].detail.valueMs).toBe(NOW);

    // Pre-existing behavior UNCHANGED: signed publish on the tenant channel
    // + the audit row.
    expect(mockRedis.publish).toHaveBeenCalledTimes(1);
    expect(mockRedis.publish.mock.calls[0][0]).toBe('tenant:tenant-a');
    expect(mockRedis.publish.mock.calls[0][1].type).toBe('REFRESH_WEB');
    expect(mockPrisma.client.auditLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.client.auditLog.create.mock.calls[0][0].data.action).toBe('REFRESH_WEB');
  });

  it('a THROWING deployment write does not fail the push — publish + audit still land', async () => {
    const { controller, mockPrisma, mockRedis } = makeController();
    mockPrisma.client.screen.findMany.mockResolvedValue([{ id: 's1' }]);
    mockPrisma.client.deployment.create.mockRejectedValue(new Error('db down'));

    // The push already left on the Redis path; bookkeeping must not be able
    // to turn that into a failed operator click.
    const out: any = await controller.refreshWebAll(adminReq());
    expect(out.ok).toBe(true);
    expect(mockRedis.publish).toHaveBeenCalledTimes(1);
    expect(mockPrisma.client.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('a tenant with no screens records nothing and still pushes', async () => {
    const { controller, mockPrisma, mockRedis } = makeController();
    mockPrisma.client.screen.findMany.mockResolvedValue([]);

    await controller.refreshWebAll(adminReq());
    expect(mockPrisma.client.screen.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.client.deployment.create).not.toHaveBeenCalled();
    expect(mockRedis.publish).toHaveBeenCalledTimes(1);
  });

  it('a fan-out past the per-screen event cap still records the deployment', async () => {
    const { controller, mockPrisma } = makeController();
    const many = Array.from({ length: 250 }, (_, i) => ({ id: `s${i}` }));
    mockPrisma.client.screen.findMany.mockResolvedValue(many);

    await controller.refreshWebAll(adminReq());
    // 250 > the 200 cap: no per-screen rows, but the push is still on record
    // with its REAL count.
    expect(mockPrisma.client.screenEvent.createMany).not.toHaveBeenCalled();
    const dep = mockPrisma.client.deployment.create.mock.calls[0][0].data;
    expect(dep.targetCount).toBe(250);
  });
});

describe('POST /screens/:id/refresh-web (single screen) — durable + recorded', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('stamps the one target, labels the deployment "Push update · <screen name>"', async () => {
    const { controller, mockPrisma, mockRedis } = makeController();
    mockPrisma.client.screen.findFirst.mockResolvedValue({
      id: 's1',
      tenantId: 'tenant-a',
      name: 'Lobby TV',
    });

    const out: any = await controller.refreshWebOne(adminReq(), 's1');
    expect(out.ok).toBe(true);

    const update = mockPrisma.client.screen.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: { in: ['s1'] }, tenantId: 'tenant-a' });
    expect(update.data.pendingRefreshAt.getTime()).toBe(NOW);

    const dep = mockPrisma.client.deployment.create.mock.calls[0][0].data;
    expect(dep.label).toBe('Push update · Lobby TV');
    expect(dep.targetCount).toBe(1);
    expect(dep.targetIds).toEqual(['s1']);
    expect(dep.value.getTime()).toBe(NOW);

    const events = mockPrisma.client.screenEvent.createMany.mock.calls[0][0].data;
    expect(events).toEqual([
      expect.objectContaining({ screenId: 's1', kind: 'refresh-requested' }),
    ]);

    // No tenant-wide target resolution on the single-screen path.
    expect(mockPrisma.client.screen.findMany).not.toHaveBeenCalled();
    expect(mockRedis.publish).toHaveBeenCalledTimes(1);
    expect(mockPrisma.client.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('a THROWING deployment write does not fail the push', async () => {
    const { controller, mockPrisma, mockRedis } = makeController();
    mockPrisma.client.screen.findFirst.mockResolvedValue({
      id: 's1',
      tenantId: 'tenant-a',
      name: 'Lobby TV',
    });
    mockPrisma.client.screen.updateMany.mockRejectedValue(new Error('db down'));

    const out: any = await controller.refreshWebOne(adminReq(), 's1');
    expect(out.ok).toBe(true);
    expect(mockRedis.publish).toHaveBeenCalledTimes(1);
    expect(mockPrisma.client.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4 + 5 — GET /screens/deployments: live convergence + tenant scoping.
// ─────────────────────────────────────────────────────────────────────────
describe('GET /screens/deployments — convergence is derived, never stored', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  const DEP_VALUE = new Date(NOW - 60_000);

  /** A target screen row shaped the way the endpoint selects it. */
  const target = (id: string, over: Record<string, any> = {}) => ({
    id,
    status: 'ONLINE',
    lastPingAt: new Date(NOW - 5_000), // fresh ping → live ONLINE
    lastRenderedAt: new Date(NOW - 5_000), // fresh paint → painting
    pendingRefreshAt: null,
    ...over,
  });

  it('counts converged (acked / superseded), not-converged, and painting separately', async () => {
    const { controller, mockPrisma } = makeController();
    mockPrisma.client.tenant.findMany.mockResolvedValue([]);
    mockPrisma.client.deployment.findMany.mockResolvedValue([
      {
        id: 'dep-1',
        label: 'Push update · 4 screens',
        createdAt: DEP_VALUE,
        value: DEP_VALUE,
        targetIds: ['acked', 'superseded', 'pending', 'dark'],
        targetCount: 4,
      },
    ]);
    mockPrisma.client.screen.findMany.mockResolvedValue([
      // Acked: render-proof's value match cleared the flag.
      target('acked', { pendingRefreshAt: null }),
      // Superseded: a LATER push replaced the value. Still non-null, but
      // this deployment is no longer outstanding on it — the case a stored
      // counter gets wrong.
      target('superseded', { pendingRefreshAt: new Date(NOW - 1_000) }),
      // Still carrying THIS command's exact value → not converged.
      target('pending', { pendingRefreshAt: new Date(DEP_VALUE.getTime()) }),
      // Converged, but reachable-and-not-painting: render proof is stale.
      target('dark', {
        pendingRefreshAt: null,
        lastRenderedAt: new Date(NOW - (RENDER_PROOF_STALE_MS + 10_000)),
      }),
    ]);

    const out: any = await controller.deployments(adminReq());
    expect(out.deployments).toHaveLength(1);
    const d = out.deployments[0];
    expect(d.valueMs).toBe(DEP_VALUE.getTime());
    expect(d.targetCount).toBe(4);
    // acked + superseded + dark = 3; `pending` still holds the value.
    expect(d.convergence.converged).toBe(3);
    // "took the command" ≠ "is showing something": `dark` converged but is
    // not painting, and `pending` has not taken it yet though it IS painting.
    expect(d.convergence.painting).toBe(3);
    expect(d.convergence.done).toBe(false);
  });

  it('done flips true only when every target has converged', async () => {
    const { controller, mockPrisma } = makeController();
    mockPrisma.client.tenant.findMany.mockResolvedValue([]);
    mockPrisma.client.deployment.findMany.mockResolvedValue([
      {
        id: 'dep-1',
        label: 'x',
        createdAt: DEP_VALUE,
        value: DEP_VALUE,
        targetIds: ['a', 'b'],
        targetCount: 2,
      },
    ]);
    mockPrisma.client.screen.findMany.mockResolvedValue([target('a'), target('b')]);

    const out: any = await controller.deployments(adminReq());
    expect(out.deployments[0].convergence).toEqual({ converged: 2, painting: 2, done: true });
  });

  it('an OFFLINE target is never counted as painting', async () => {
    const { controller, mockPrisma } = makeController();
    mockPrisma.client.tenant.findMany.mockResolvedValue([]);
    mockPrisma.client.deployment.findMany.mockResolvedValue([
      { id: 'dep-1', label: 'x', createdAt: DEP_VALUE, value: DEP_VALUE, targetIds: ['a'], targetCount: 1 },
    ]);
    mockPrisma.client.screen.findMany.mockResolvedValue([
      // Stale heartbeat → not live-ONLINE, so a recent paint proves nothing.
      target('a', { lastPingAt: new Date(NOW - 5 * 60_000) }),
    ]);

    const out: any = await controller.deployments(adminReq());
    expect(out.deployments[0].convergence.painting).toBe(0);
    expect(out.deployments[0].convergence.converged).toBe(1);
  });

  it('a deployment past the stored-id cap can never read done — under-claim, never over-claim', async () => {
    const { controller, mockPrisma } = makeController();
    mockPrisma.client.tenant.findMany.mockResolvedValue([]);
    mockPrisma.client.deployment.findMany.mockResolvedValue([
      {
        id: 'dep-big',
        label: 'x',
        createdAt: DEP_VALUE,
        value: DEP_VALUE,
        targetIds: ['a'], // only one id was stored…
        targetCount: 1500, // …but 1500 screens were really pushed
      },
    ]);
    mockPrisma.client.screen.findMany.mockResolvedValue([target('a')]);

    const out: any = await controller.deployments(adminReq());
    expect(out.deployments[0].convergence.done).toBe(false);
  });

  it('scopes to self + DIRECT non-archived children, and never reads a foreign screen', async () => {
    const { controller, mockPrisma } = makeController();
    // The tenant query itself carries the archived filter — an archived
    // child must never enter the scope set (2026-07-23 Dodgers incident).
    mockPrisma.client.tenant.findMany.mockResolvedValue([{ id: 'child-live' }]);
    mockPrisma.client.deployment.findMany.mockResolvedValue([
      { id: 'dep-1', label: 'x', createdAt: DEP_VALUE, value: DEP_VALUE, targetIds: ['a'], targetCount: 1 },
    ]);
    mockPrisma.client.screen.findMany.mockResolvedValue([target('a')]);

    await controller.deployments(adminReq());

    expect(mockPrisma.client.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentId: 'tenant-a', archivedAt: null } }),
    );
    expect(mockPrisma.client.deployment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: { in: ['tenant-a', 'child-live'] } } }),
    );
    // The convergence read is re-scoped too: a stray/tampered id inside a
    // stored targetIds array must not surface another tenant's screen.
    expect(mockPrisma.client.screen.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['a'] }, tenantId: { in: ['tenant-a', 'child-live'] } },
      }),
    );
  });

  it('carries the owning tenantId so the fleet table can attribute a push per location', async () => {
    const { controller, mockPrisma } = makeController();
    mockPrisma.client.tenant.findMany.mockResolvedValue([{ id: 'child-live' }]);
    mockPrisma.client.deployment.findMany.mockResolvedValue([
      { id: 'dep-hq', tenantId: 'tenant-a', label: 'x', createdAt: DEP_VALUE, value: DEP_VALUE, targetIds: ['a'], targetCount: 1 },
      { id: 'dep-child', tenantId: 'child-live', label: 'y', createdAt: DEP_VALUE, value: DEP_VALUE, targetIds: ['b'], targetCount: 1 },
    ]);
    mockPrisma.client.screen.findMany.mockResolvedValue([target('a'), target('b')]);

    const out: any = await controller.deployments(adminReq());
    // Each row keeps its OWN location — the table must never let one
    // location's push stand in for another's.
    expect(out.deployments.map((d: any) => [d.id, d.tenantId])).toEqual([
      ['dep-hq', 'tenant-a'],
      ['dep-child', 'child-live'],
    ]);
  });

  it('an empty page costs zero screen reads', async () => {
    const { controller, mockPrisma } = makeController();
    mockPrisma.client.tenant.findMany.mockResolvedValue([]);
    mockPrisma.client.deployment.findMany.mockResolvedValue([]);

    const out: any = await controller.deployments(adminReq());
    expect(out).toEqual({ deployments: [] });
    expect(mockPrisma.client.screen.findMany).not.toHaveBeenCalled();
  });

  it('clamps limit and defaults to 10', async () => {
    const { controller, mockPrisma } = makeController();
    mockPrisma.client.tenant.findMany.mockResolvedValue([]);
    mockPrisma.client.deployment.findMany.mockResolvedValue([]);

    await controller.deployments(adminReq());
    expect(mockPrisma.client.deployment.findMany.mock.calls[0][0].take).toBe(10);

    await controller.deployments(adminReq(), '9999');
    expect(mockPrisma.client.deployment.findMany.mock.calls[1][0].take).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5 — GET /screens/:id/events: scoping + ordering.
// ─────────────────────────────────────────────────────────────────────────
describe('GET /screens/:id/events', () => {
  it('returns the screen timeline newest-first, scoped to self + children', async () => {
    const { controller, mockPrisma } = makeController();
    mockPrisma.client.tenant.findMany.mockResolvedValue([{ id: 'child-live' }]);
    mockPrisma.client.screen.findFirst.mockResolvedValue({ id: 's1' });
    mockPrisma.client.screenEvent.findMany.mockResolvedValue([
      { id: 'e2', kind: 'refresh-acked', detail: { valueMs: NOW }, createdAt: new Date(NOW) },
      { id: 'e1', kind: 'refresh-requested', detail: {}, createdAt: new Date(NOW - 1000) },
    ]);

    const out: any = await controller.screenEvents(adminReq(), 's1');
    expect(out.events.map((e: any) => e.id)).toEqual(['e2', 'e1']);
    expect(mockPrisma.client.screenEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { screenId: 's1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
    // Ownership is proven against the SCREEN row — a child's screen is
    // readable, anything outside the scope set is not.
    expect(mockPrisma.client.screen.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', tenantId: { in: ['tenant-a', 'child-live'] } },
      }),
    );
  });

  it('404s a screen outside the tenant scope instead of leaking its timeline', async () => {
    const { controller, mockPrisma } = makeController();
    mockPrisma.client.tenant.findMany.mockResolvedValue([]);
    mockPrisma.client.screen.findFirst.mockResolvedValue(null); // foreign tenant

    await expect(controller.screenEvents(adminReq(), 'foreign')).rejects.toMatchObject({
      status: 404,
    });
    expect(mockPrisma.client.screenEvent.findMany).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6 — the ack event fires on the value match ONLY.
// ─────────────────────────────────────────────────────────────────────────
describe('POST /screens/:id/render-proof — refresh-acked event', () => {
  let seq = 0;
  /** Fresh id per case: the render-proof write debounce is module state. */
  const nextId = () => `screen-ack-${++seq}`;

  const post = (c: ScreensController, id: string, body: Record<string, unknown>) =>
    (c as any).reportRenderProof(id, {} as any, body);

  function ackController(pendingRefreshAt: Date | null) {
    const { controller, mockPrisma } = makeController();
    mockPrisma.client.screen.findUnique.mockResolvedValue({
      id: 'x',
      tenantId: 'tenant-a',
      pendingRefreshAt,
    });
    (controller as any).deviceAuth = jest.fn(async () => ({ ok: true }));
    return { controller, mockPrisma };
  }

  it('writes refresh-acked when the echoed value MATCHES, alongside the clear', async () => {
    const value = new Date(NOW - 30_000);
    const { controller, mockPrisma } = ackController(value);
    const id = nextId();

    await post(controller, id, { frames: 10, refreshAckMs: value.getTime() });

    // The clear IS the ack — assert both halves stay together.
    expect(mockPrisma.client.screen.update.mock.calls[0][0].data.pendingRefreshAt).toBeNull();
    expect(mockPrisma.client.screenEvent.create).toHaveBeenCalledTimes(1);
    const ev = mockPrisma.client.screenEvent.create.mock.calls[0][0].data;
    expect(ev).toMatchObject({
      screenId: id,
      tenantId: 'tenant-a',
      kind: 'refresh-acked',
      detail: { valueMs: value.getTime() },
    });
  });

  it('writes NOTHING on an ordinary render proof (no ack echoed)', async () => {
    const { controller, mockPrisma } = ackController(new Date(NOW - 30_000));

    await post(controller, nextId(), { frames: 10 });

    expect(mockPrisma.client.screenEvent.create).not.toHaveBeenCalled();
    // …and the pending command is left alone: an un-acked flag must survive.
    expect(
      mockPrisma.client.screen.update.mock.calls[0][0].data.pendingRefreshAt,
    ).toBeUndefined();
  });

  it('writes NOTHING when the echoed value is a MISMATCH (a stale ack)', async () => {
    const { controller, mockPrisma } = ackController(new Date(NOW - 30_000));

    // A player echoing an older command's value must not clear the newer
    // one — value identity, not "an ack arrived".
    await post(controller, nextId(), { frames: 10, refreshAckMs: NOW - 999_999 });

    expect(mockPrisma.client.screenEvent.create).not.toHaveBeenCalled();
    expect(
      mockPrisma.client.screen.update.mock.calls[0][0].data.pendingRefreshAt,
    ).toBeUndefined();
  });

  it('a THROWING event write does not fail the render proof', async () => {
    const value = new Date(NOW - 30_000);
    const { controller, mockPrisma } = ackController(value);
    mockPrisma.client.screenEvent.create.mockRejectedValue(new Error('db down'));

    await expect(
      post(controller, nextId(), { frames: 10, refreshAckMs: value.getTime() }),
    ).resolves.toEqual({ ok: true });
  });
});
