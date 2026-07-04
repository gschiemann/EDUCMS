/**
 * Tests for POST /api/v1/player-logs/:screenId (PlayerLogsController.ingestLog).
 *
 * SECURITY REGRESSION GUARD (sec-fix P1, 2026-07-03 — unauthenticated
 * cross-tenant write):
 *
 * Before the fix, this endpoint had no auth guard and, on a missing/invalid
 * device token, fell back to the ATTACKER-SUPPLIED :screenId path param to
 * resolve a real tenant, then wrote an immutable PLAYER_DIAGNOSTICS_CRASH
 * AuditLog row (with up to 10 KB of attacker text) into that VICTIM tenant.
 * A remote unauthenticated attacker who guessed any screen UUID could forge
 * crash records into any tenant's forensic audit trail.
 *
 * Asserted behaviours:
 *   1. Unauthenticated request + victim screenId + 'FATAL' body → NO AuditLog
 *      write at all (the cross-tenant write is closed). THE regression guard.
 *   2. A valid device JWT bound to the screenId + 'FATAL' body → AuditLog row
 *      IS written, scoped to the screen's real tenant (legit path preserved).
 *   3. A device JWT for a DIFFERENT screen (subject mismatch) → treated as
 *      unauthenticated: NO AuditLog write, victim tenant untouched (defense
 *      in depth).
 *   4. Valid device JWT + a routine (non-crash) heartbeat body → NO AuditLog
 *      write (audit-spam fix preserved), request still succeeds.
 */
import * as jwt from 'jsonwebtoken';
import { PlayerLogsController } from './player-logs.controller';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';

/** A valid device token whose `sub` is the given screenId. */
function deviceToken(screenId: string): string {
  return jwt.sign({ sub: screenId, kind: 'device', fp: 'fp-test' }, DEVICE_JWT_SECRET, { expiresIn: '365d' });
}

/** An Express-ish request stub with a text body + optional Bearer header. */
function req(body: string, authToken?: string): any {
  return {
    body,
    headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
    ip: '203.0.113.9',
    socket: { remoteAddress: '203.0.113.9' },
  };
}

const CRASH_BODY = '2026-07-03T00:00:00.000Z [CRASH] FATAL EXCEPTION: main\n  at com.evil.Injected(Attack.kt:1)';
const HEARTBEAT_BODY = '2026-07-03T00:00:00.000Z [INFO] Heartbeat: playlist synced, 3 assets cached';

const VICTIM_SCREEN_ID = 'victim-screen-uuid-0001';
const VICTIM_TENANT_ID = 'victim-tenant-uuid-9999';
const ATTACKER_SCREEN_ID = 'attacker-owned-screen-uuid';

let controller: PlayerLogsController;
let mockPrisma: any;

beforeEach(() => {
  mockPrisma = {
    client: {
      screen: {
        // The victim screen resolves to the victim tenant, as it would in prod.
        findUnique: jest.fn().mockResolvedValue({ tenantId: VICTIM_TENANT_ID }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    },
  };
  controller = new PlayerLogsController(mockPrisma);
});

describe('PlayerLogsController.ingestLog — cross-tenant write guard', () => {
  it('does NOT write an AuditLog row for an unauthenticated crash upload targeting a victim screen', async () => {
    const res = await controller.ingestLog(VICTIM_SCREEN_ID, req(CRASH_BODY /* no token */));

    // THE regression guard: no immutable audit row was forged into any tenant.
    expect(mockPrisma.client.auditLog.create).not.toHaveBeenCalled();
    // And the victim tenant is never even resolved from the unverified path param.
    expect(mockPrisma.client.screen.findUnique).not.toHaveBeenCalled();
    // Upload still succeeds (early-boot diagnostics keep working) but stores nothing.
    expect(res).toEqual({ stored: true, rows: 0 });
  });

  it('DOES write a tenant-scoped AuditLog row for a valid device token bound to its own screen (legit path preserved)', async () => {
    const token = deviceToken(VICTIM_SCREEN_ID); // the real device for that screen
    const res = await controller.ingestLog(VICTIM_SCREEN_ID, req(CRASH_BODY, token));

    expect(mockPrisma.client.screen.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: VICTIM_SCREEN_ID } }),
    );
    expect(mockPrisma.client.auditLog.create).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.client.auditLog.create.mock.calls[0][0];
    expect(arg.data.tenantId).toBe(VICTIM_TENANT_ID);
    expect(arg.data.action).toBe('PLAYER_DIAGNOSTICS_CRASH');
    expect(arg.data.targetId).toBe(VICTIM_SCREEN_ID);
    expect(res).toEqual({ stored: true, rows: 1 });
  });

  it('rejects a valid device token for a DIFFERENT screen (subject mismatch) — no AuditLog write', async () => {
    const stolenTokenForOtherScreen = deviceToken(ATTACKER_SCREEN_ID);
    const res = await controller.ingestLog(VICTIM_SCREEN_ID, req(CRASH_BODY, stolenTokenForOtherScreen));

    // Subject mismatch is treated as unauthenticated: no tenant resolution, no audit row.
    expect(mockPrisma.client.screen.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.client.auditLog.create).not.toHaveBeenCalled();
    expect(res).toEqual({ stored: true, rows: 0 });
  });

  it('does NOT write an AuditLog row for a routine (non-crash) heartbeat from a valid device (audit-spam fix preserved)', async () => {
    const token = deviceToken(VICTIM_SCREEN_ID);
    const res = await controller.ingestLog(VICTIM_SCREEN_ID, req(HEARTBEAT_BODY, token));

    expect(mockPrisma.client.auditLog.create).not.toHaveBeenCalled();
    expect(res).toEqual({ stored: true, rows: 0 });
  });
});
