/**
 * Codex T05 (2026-09-13): a privileged brand change must not report success
 * without its audit record. adopt / clear / apply used to `.catch(() => {})`
 * the AuditLog write; they run mutation + audit in one transaction now, so a
 * failed audit write rolls the change back and the request fails.
 */
// The controller pulls in the scraper stack; the same mocks the sibling specs use keep ESM-only deps out of jest.
jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (x: string) => x } }));
jest.mock('./safe-fetch', () => ({ safeFetch: jest.fn(), safeFetchBuffer: jest.fn() }));

import { BrandingController } from './branding.controller';
import type { PrismaService } from '../prisma/prisma.service';

function build(auditFails: boolean) {
  const calls: string[] = [];
  const tx = {
    template: { update: jest.fn(async () => { calls.push('template.update'); return { id: 't1', name: 'T', brandKit: {}, updatedAt: new Date() }; }) },
    auditLog: { create: jest.fn(async () => { calls.push('auditLog.create'); if (auditFails) throw new Error('audit store down'); return {}; }) },
  };
  const client = {
    template: { findFirst: jest.fn(async () => ({ id: 't1', name: 'T', isSystem: false })), update: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const prisma = { client } as unknown as PrismaService;
  const ctrl = new BrandingController(prisma, {} as never, { check: () => undefined } as never, {} as never);
  return { ctrl, client, tx, calls };
}
const req = { user: { id: 'u1', tenantId: 'ten1' } } as never;

describe('clearTemplateBranding — mutation + audit are one transaction', () => {
  it('runs the update and the audit row inside the SAME transaction and succeeds', async () => {
    const { ctrl, client, tx, calls } = build(false);
    await expect(ctrl.clearTemplateBranding(req, 't1')).resolves.toEqual({ ok: true });
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.template.update).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['template.update', 'auditLog.create']);
    expect(client.template.update).not.toHaveBeenCalled();        // never outside the transaction
    expect(client.auditLog.create).not.toHaveBeenCalled();
  });
  it('a failed audit write fails the request instead of reporting an unaudited success', async () => {
    const { ctrl } = build(true);
    await expect(ctrl.clearTemplateBranding(req, 't1')).rejects.toThrow('audit store down');
  });
});
