/**
 * Render-proof heartbeat tests (2026-05-29).
 *
 * The #1 player-reliability gap: a frozen kiosk still answers TCP reads, so
 * lastPingAt stays fresh and the fleet map shows it ONLINE/green while it is
 * actually showing a stuck / black frame. These tests pin the load-bearing
 * property the fix exists for:
 *
 *   A STALE render-proof flips a screen to RED (renderHealth STALE), while a
 *   FRESH PING ALONE does NOT — rendering-alive ≠ TCP-reachable.
 *
 * Two layers:
 *   1. The pure helper `deriveRenderHealth` (no Prisma — same discipline as
 *      ScreenWedgeDetectorCron.decide).
 *   2. The controller `list()` endpoint wiring — proves the helper is actually
 *      surfaced on the fleet payload AND that the existing `status`
 *      (ONLINE/OFFLINE) behavior is untouched (additive).
 *
 * Mirrors the mock pattern in screens.hardware-model.spec.ts.
 */

import { ScreensController } from './screens.controller';
import {
  deriveRenderHealth,
  RENDER_PROOF_STALE_MS,
} from './render-proof';

// Stub requireSecret so tests don't need real env vars.
jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

// ─────────────────────────────────────────────────────────────────────────
// Layer 1 — the pure helper.
// ─────────────────────────────────────────────────────────────────────────
describe('deriveRenderHealth (pure)', () => {
  const NOW = 1_700_000_000_000;

  it('FRESH PING ALONE (no render-proof ever reported) does NOT flip RED — UNKNOWN', () => {
    // The whole point: a TCP-reachable screen that has never proven it
    // painted must NOT be reported as OK *or* STALE. UNKNOWN = "no opinion",
    // so old player builds / freshly-paired screens are never falsely alarmed.
    const r = deriveRenderHealth({
      isLiveOnline: true, // fresh ping → ONLINE
      lastRenderedAtMs: null, // but never reported a painted frame
      nowMs: NOW,
    });
    expect(r.renderHealth).toBe('UNKNOWN');
    expect(r.renderStale).toBe(false);
  });

  it('STALE render-proof on a fresh-ping (ONLINE) screen flips RED — STALE', () => {
    const r = deriveRenderHealth({
      isLiveOnline: true, // fresh ping → ONLINE
      lastRenderedAtMs: NOW - (RENDER_PROOF_STALE_MS + 5_000), // painted long ago
      nowMs: NOW,
    });
    expect(r.renderHealth).toBe('STALE'); // ← RED / degraded
    expect(r.renderStale).toBe(true);
    expect(r.renderStaleSeconds).toBeGreaterThanOrEqual(
      Math.floor(RENDER_PROOF_STALE_MS / 1000),
    );
  });

  it('FRESH render-proof on an ONLINE screen reads OK', () => {
    const r = deriveRenderHealth({
      isLiveOnline: true,
      lastRenderedAtMs: NOW - 5_000, // painted 5s ago
      nowMs: NOW,
    });
    expect(r.renderHealth).toBe('OK');
    expect(r.renderStale).toBe(false);
  });

  it('an OFFLINE screen never reports STALE — the ping path owns that verdict', () => {
    // A non-reachable screen obviously isn't painting; it's already flagged
    // OFFLINE by the ping-age path. Render-proof must NOT double-count it as
    // a "freeze" (renderStale stays false) even with a stale lastRenderedAt.
    const r = deriveRenderHealth({
      isLiveOnline: false,
      lastRenderedAtMs: NOW - (RENDER_PROOF_STALE_MS + 60_000),
      nowMs: NOW,
    });
    expect(r.renderHealth).toBe('UNKNOWN');
    expect(r.renderStale).toBe(false);
  });

  it('boundary: exactly at the staleness window is STALE (>=)', () => {
    const r = deriveRenderHealth({
      isLiveOnline: true,
      lastRenderedAtMs: NOW - RENDER_PROOF_STALE_MS,
      nowMs: NOW,
    });
    expect(r.renderHealth).toBe('STALE');
    expect(r.renderStale).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Layer 2 — the controller list() endpoint surfaces render-proof AND keeps
// the existing status (ONLINE/OFFLINE) behavior intact.
// ─────────────────────────────────────────────────────────────────────────
describe('ScreensController.list — render-proof overlay', () => {
  const NOW = 1_700_000_000_000;

  let controller: ScreensController;
  let mockPrisma: any;
  const mockRedis: any = { publish: jest.fn() };
  const mockSigner: any = {
    signMessage: jest.fn(() => ({ type: 'SYNC', signature: 'x', timestamp: Date.now() })),
  };
  const mockLicense: any = { assertSeatAvailable: jest.fn() };
  const mockStripe: any = { syncSubscriptionQuantity: jest.fn() };

  const ADMIN_REQ = {
    user: { id: 'user-admin', tenantId: 'tenant-xyz', role: 'SCHOOL_ADMIN' },
  };

  // A baseline screen row the way Prisma returns it (camelCase mapped).
  const baseRow = (over: Record<string, unknown> = {}) => ({
    id: 'screen-1',
    tenantId: 'tenant-xyz',
    screenGroupId: null,
    name: 'Lobby',
    status: 'ONLINE',
    lastPingAt: new Date(NOW - 5_000), // fresh ping → live ONLINE
    latitude: null,
    longitude: null,
    address: null,
    userAgent: null,
    lastRenderedAt: null,
    screenGroup: null,
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    mockPrisma = {
      client: {
        screen: { findMany: jest.fn() },
        tenant: { findUnique: jest.fn(async () => ({ latitude: null, longitude: null, address: null })) },
      },
    };
    controller = new ScreensController(mockPrisma, mockRedis, mockSigner, mockLicense, mockStripe);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const res: any = { setHeader: jest.fn() };

  it('FRESH PING + STALE render-proof → status stays ONLINE but renderHealth is STALE (RED)', async () => {
    mockPrisma.client.screen.findMany.mockResolvedValue([
      baseRow({
        lastPingAt: new Date(NOW - 5_000), // fresh ping
        lastRenderedAt: new Date(NOW - (RENDER_PROOF_STALE_MS + 10_000)), // stale paint
      }),
    ]);

    const out: any[] = await controller.list(ADMIN_REQ as any, res);
    expect(out).toHaveLength(1);
    // The existing TCP-reachability verdict is UNCHANGED — the screen is
    // reachable, so it is correctly still ONLINE (NOT downgraded to OFFLINE).
    expect(out[0].status).toBe('ONLINE');
    // …but render-proof catches the freeze the ping cannot: RED.
    expect(out[0].renderHealth).toBe('STALE');
    expect(out[0].renderStale).toBe(true);
  });

  it('FRESH PING ALONE (no render-proof reported) → ONLINE + renderHealth UNKNOWN (NOT RED)', async () => {
    mockPrisma.client.screen.findMany.mockResolvedValue([
      baseRow({
        lastPingAt: new Date(NOW - 5_000), // fresh ping
        lastRenderedAt: null, // never reported a painted frame
      }),
    ]);

    const out: any[] = await controller.list(ADMIN_REQ as any, res);
    expect(out[0].status).toBe('ONLINE');
    // A fresh ping by itself must NOT mark the screen RED — that would
    // falsely alarm every older player build that doesn't POST render-proof.
    expect(out[0].renderHealth).toBe('UNKNOWN');
    expect(out[0].renderStale).toBe(false);
  });

  it('FRESH PING + FRESH render-proof → ONLINE + renderHealth OK', async () => {
    mockPrisma.client.screen.findMany.mockResolvedValue([
      baseRow({
        lastPingAt: new Date(NOW - 5_000),
        lastRenderedAt: new Date(NOW - 5_000), // painted 5s ago
      }),
    ]);

    const out: any[] = await controller.list(ADMIN_REQ as any, res);
    expect(out[0].status).toBe('ONLINE');
    expect(out[0].renderHealth).toBe('OK');
    expect(out[0].renderStale).toBe(false);
  });

  it('STALE PING (already OFFLINE) → render-proof does not double-count as a freeze', async () => {
    mockPrisma.client.screen.findMany.mockResolvedValue([
      baseRow({
        // ping older than the 35s ONLINE grace → OFFLINE by the existing path
        lastPingAt: new Date(NOW - 5 * 60_000),
        lastRenderedAt: new Date(NOW - 5 * 60_000),
      }),
    ]);

    const out: any[] = await controller.list(ADMIN_REQ as any, res);
    // Existing behavior: a stale ping flips ONLINE → OFFLINE. Unchanged.
    expect(out[0].status).toBe('OFFLINE');
    // An offline screen isn't "frozen but reachable" — renderStale must be
    // false so the dashboard doesn't show two conflicting alarms.
    expect(out[0].renderHealth).toBe('UNKNOWN');
    expect(out[0].renderStale).toBe(false);
  });
});
