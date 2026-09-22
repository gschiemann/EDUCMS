/**
 * Regression tests for P2-B — the SERIALIZABLE seat-claim transaction in
 * ScreensController.pair() is wrapped in withDbRetry.
 *
 * Background: two admins racing the last license seat each fall inside the
 * other's predicate under the SERIALIZABLE seat-claim tx, so PostgreSQL's SSI
 * aborts one with 40001 → Prisma surfaces it as P2034. The seat ceiling always
 * holds (over-seating is prevented), but BEFORE this fix the raw $transaction
 * was not wrapped in withDbRetry, so the loser got an unhandled 500 instead of
 * a clean retry that resolves to either success or a structured 402
 * LICENSE_EXHAUSTED.
 *
 * These tests assert:
 *  1. A P2034 on the first attempt is retried, the WHOLE tx (seat count +
 *     screen.update write) re-runs, and the pair succeeds on the retry.
 *  2. A 402 LICENSE_EXHAUSTED (a plain HttpException thrown by
 *     assertSeatAvailable) is NOT a transient DB error, so it is re-thrown
 *     immediately — the loser gets a clean 402, never a 500, and the tx is
 *     attempted exactly once (no wasteful retry of a real over-quota result).
 *  3. Re-pairing a screen that already belongs to this tenant does not even
 *     hit assertSeatAvailable (free re-pair), and still benefits from retry.
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { ScreensController } from './screens.controller';

// Stub requireSecret so the controller constructor / token paths don't need
// real env vars.
jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

// ── Mocks ───────────────────────────────────────────────────────────────────
const mockPrisma: any = {
  client: {
    screen: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    // $transaction is the unit under test's seam. We make it ACTUALLY invoke
    // the thunk with a tx client so assertSeatAvailable + screen.update run
    // for real inside it — that's what makes "the whole tx re-runs" provable.
    $transaction: jest.fn(),
  },
};

const mockRedis: any = { publish: jest.fn() };
const mockSigner: any = { signMessage: jest.fn(() => 'signed') };
const mockLicense: any = { assertSeatAvailable: jest.fn() };
const mockStripe: any = { syncSubscriptionQuantity: jest.fn(() => Promise.resolve()) };

let controller: ScreensController;

// A tx client whose screen.update is the same mock the assertions read.
const txClient: any = {
  screen: { update: mockPrisma.client.screen.update },
  // F-03a (2026-09-21): the claim now writes its SCREEN_PAIRED audit row on
  // the SAME tx client, so the row can never outlive a rolled-back claim.
  auditLog: { create: jest.fn() },
};

// Build a P2034 (write-conflict / serialization) error the way Prisma does —
// withDbRetry classifies it transient by its `code`.
function p2034Error(): Error & { code: string } {
  const e = new Error(
    'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
  ) as Error & { code: string };
  e.code = 'P2034';
  return e;
}

// An over-quota 402 — exactly what license.service.assertSeatAvailable throws.
function licenseExhausted(): HttpException {
  return new HttpException(
    { code: 'LICENSE_EXHAUSTED', message: 'Seat limit reached' },
    HttpStatus.PAYMENT_REQUIRED,
  );
}

const adminReq = (tenantId = 'tenant-A') => ({ user: { id: 'admin-1', tenantId } });

const unpairedScreen = (overrides: Record<string, any> = {}) => ({
  id: 'screen-1',
  tenantId: null, // unpaired → isNewPair true → seat gate runs
  name: 'Lobby',
  pairingCode: 'ABC123',
  ...overrides,
});

const updatedScreen = (overrides: Record<string, any> = {}) => ({
  id: 'screen-1',
  tenantId: 'tenant-A',
  name: 'Lobby',
  pairingCode: null,
  screenGroup: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  controller = new ScreensController(
    mockPrisma,
    mockRedis,
    mockSigner,
    mockLicense,
    mockStripe,
    {} as any,
  );
  // Default: $transaction runs the thunk against txClient and honors whatever
  // the thunk does (so assertSeatAvailable can throw from inside it).
  mockPrisma.client.$transaction.mockImplementation(async (fn: any) => fn(txClient));
});

// ════════════════════════════════════════════════════════════════════════════
// P2-B — seat-claim tx wrapped in withDbRetry
// ════════════════════════════════════════════════════════════════════════════

it('P2B-1: P2034 on first attempt retries the WHOLE tx and the pair succeeds', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue(unpairedScreen());
  // Seat is available on both attempts.
  mockLicense.assertSeatAvailable.mockResolvedValue(undefined);
  mockPrisma.client.screen.update.mockResolvedValue(updatedScreen());

  // First $transaction call throws a serialization conflict; second succeeds.
  mockPrisma.client.$transaction
    .mockImplementationOnce(async () => {
      throw p2034Error();
    })
    .mockImplementationOnce(async (fn: any) => fn(txClient));

  const res = await controller.pair(adminReq(), { pairingCode: 'ABC123' });

  // Pair resolved (no 500 bubbled out).
  expect(res).toMatchObject({ id: 'screen-1', tenantId: 'tenant-A' });
  // The ENTIRE tx ran twice — proving withDbRetry re-ran the full thunk.
  expect(mockPrisma.client.$transaction).toHaveBeenCalledTimes(2);
  // On the surviving attempt the seat count + write both executed.
  expect(mockLicense.assertSeatAvailable).toHaveBeenCalledWith('tenant-A', txClient);
  expect(mockPrisma.client.screen.update).toHaveBeenCalledTimes(1);
});

it('P2B-2: over-quota 402 LICENSE_EXHAUSTED is re-thrown immediately (clean 402, not 500, no retry)', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue(unpairedScreen());
  // Seat gate throws a 402 from INSIDE the tx every time.
  mockLicense.assertSeatAvailable.mockRejectedValue(licenseExhausted());

  await expect(
    controller.pair(adminReq(), { pairingCode: 'ABC123' }),
  ).rejects.toMatchObject({ status: HttpStatus.PAYMENT_REQUIRED });

  // A real over-quota result is NOT transient → attempted exactly once.
  expect(mockPrisma.client.$transaction).toHaveBeenCalledTimes(1);
  // The write never happened — seat gate short-circuited inside the tx.
  expect(mockPrisma.client.screen.update).not.toHaveBeenCalled();
});

it('P2B-3: loser of the race who is STILL over quota on retry ends at a clean 402', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue(unpairedScreen());
  mockPrisma.client.screen.update.mockResolvedValue(updatedScreen());

  // Attempt 1: serialization conflict (P2034, transient → retry).
  // Attempt 2: seat is now genuinely exhausted → 402 (terminal).
  mockPrisma.client.$transaction
    .mockImplementationOnce(async () => {
      throw p2034Error();
    })
    .mockImplementationOnce(async (fn: any) => fn(txClient));
  mockLicense.assertSeatAvailable.mockRejectedValue(licenseExhausted());

  await expect(
    controller.pair(adminReq(), { pairingCode: 'ABC123' }),
  ).rejects.toMatchObject({ status: HttpStatus.PAYMENT_REQUIRED });

  // Retried once (P2034), then the terminal 402 stopped further retries.
  expect(mockPrisma.client.$transaction).toHaveBeenCalledTimes(2);
});

it('P2B-4: free re-pair (same tenant) skips the seat gate but still runs inside the retried tx', async () => {
  // Screen already belongs to tenant-A → isNewPair false → no seat gate.
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    unpairedScreen({ tenantId: 'tenant-A' }),
  );
  mockPrisma.client.screen.update.mockResolvedValue(updatedScreen());

  const res = await controller.pair(adminReq('tenant-A'), { pairingCode: 'ABC123' });

  expect(res).toMatchObject({ id: 'screen-1', tenantId: 'tenant-A' });
  expect(mockLicense.assertSeatAvailable).not.toHaveBeenCalled();
  expect(mockPrisma.client.$transaction).toHaveBeenCalledTimes(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// F-03a (launch re-audit 2026-09-21) — a claim leaves a forensic record
// ─────────────────────────────────────────────────────────────────────────────

it('F03a-1: a successful claim writes a SCREEN_PAIRED audit row on the tx client, after the screen write', async () => {
  // clearAllMocks keeps implementations: an earlier test left the seat gate rejecting.
  mockLicense.assertSeatAvailable.mockResolvedValue(undefined);
  mockPrisma.client.screen.findUnique.mockResolvedValue(unpairedScreen());
  mockPrisma.client.screen.update.mockResolvedValue(updatedScreen());

  // (No screenGroupId: this harness has no screenGroup double; group
  // ownership at claim time is pinned by screens.group-tenant-isolation.spec.)
  await controller.pair(adminReq('tenant-A'), {
    pairingCode: 'ABC123',
    name: '  Front Lobby  ',
  });

  // On the TX client — never `prisma.client.auditLog` — so a rollback of the
  // claim rolls the row back with it, and a paired screen with no row is
  // impossible.
  expect(txClient.auditLog.create).toHaveBeenCalledTimes(1);
  const row = txClient.auditLog.create.mock.calls[0][0].data;
  expect(row).toMatchObject({
    tenantId: 'tenant-A',
    userId: 'admin-1',
    action: 'SCREEN_PAIRED',
    targetType: 'Screen',
    targetId: 'screen-1',
  });
  const details = JSON.parse(row.details);
  expect(details).toEqual({
    name: 'Front Lobby',
    isNewPair: true,
    previousTenantId: null,
    screenGroupId: null,
  });
  // SDE-03: the claim credential is never persisted anywhere readable.
  expect(row.details).not.toContain('ABC123');
  // The row is written AFTER the claim, inside the same tx.
  const updateOrder = mockPrisma.client.screen.update.mock.invocationCallOrder[0];
  const auditOrder = txClient.auditLog.create.mock.invocationCallOrder[0];
  expect(auditOrder).toBeGreaterThan(updateOrder);
});

it('F03a-2: a claim refused by the seat gate writes NO audit row', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue(unpairedScreen());
  mockLicense.assertSeatAvailable.mockRejectedValue(licenseExhausted());

  await expect(
    controller.pair(adminReq('tenant-A'), { pairingCode: 'ABC123' }),
  ).rejects.toMatchObject({ status: 402 });

  expect(txClient.auditLog.create).not.toHaveBeenCalled();
});
