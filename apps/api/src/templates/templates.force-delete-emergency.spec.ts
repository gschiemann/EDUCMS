import { HttpException, HttpStatus } from '@nestjs/common';
import { TemplatesController } from './templates.controller';

/**
 * DELETE /templates/:id?force=true — an informed "delete anyway" (the gallery's
 * in-use warning now carries it, 2026-09-28) unlinks the layout from the
 * playlists that use it. It must NEVER do that to an emergency playlist, and
 * the check fails closed.
 */

function makeController(over: { emergency?: 'none' | 'protected' | 'tenant' | 'check-broken' } = {}) {
  const emergency = over.emergency ?? 'none';
  const client: any = {
    template: {
      findFirst: jest.fn(async () => ({ id: 'tmp1', tenantId: 't1', isSystem: false, name: 'Club Welcome', category: 'CUSTOM' })),
      delete: jest.fn(async () => ({})),
    },
    playlist: {
      findMany: jest.fn(async () => [{ id: 'p1', name: 'Morning Loop' }]),
      count: jest.fn(async () => 1),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(async () => (emergency === 'protected' ? { id: 'p1' } : null)),
    },
    tenant: {
      findFirst: jest.fn(async () => {
        if (emergency === 'check-broken') throw new Error('db down');
        return emergency === 'tenant' ? { id: 't1' } : null;
      }),
    },
    screen: { findFirst: jest.fn(async () => null) },
    screenEmergencyOverride: { findFirst: jest.fn(async () => null) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const controller = Object.create(TemplatesController.prototype) as TemplatesController;
  (controller as any).prisma = { client };
  return { controller, client };
}

const req = { user: { tenantId: 't1', id: 'u1', role: 'SCHOOL_ADMIN' } } as any;

async function refusal(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { return e as HttpException; }
  throw new Error('expected a refusal');
}

describe('force-deleting a template', () => {
  it('a layout used only by ordinary playlists is unlinked, audited and deleted', async () => {
    const { controller, client } = makeController();
    await expect(controller.remove(req, 'tmp1', 'true')).resolves.toEqual({ deleted: true });
    expect(client.playlist.updateMany).toHaveBeenCalledWith({ where: { templateId: 'tmp1', tenantId: 't1' }, data: { templateId: null } });
    expect(client.template.delete).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a protected playlist', 'protected'],
    ['a tenant emergency default', 'tenant'],
  ] as const)('refuses — and changes nothing — when %s renders through it', async (_label, emergency) => {
    const { controller, client } = makeController({ emergency });
    const e = await refusal(() => controller.remove(req, 'tmp1', 'true'));
    expect(e.getStatus()).toBe(HttpStatus.CONFLICT);
    expect((e.getResponse() as any).code).toBe('TEMPLATE_EMERGENCY_IN_USE');
    expect(client.playlist.updateMany).not.toHaveBeenCalled();
    expect(client.template.delete).not.toHaveBeenCalled();
  });

  it('fails CLOSED: an emergency check that cannot run refuses the delete', async () => {
    const { controller, client } = makeController({ emergency: 'check-broken' });
    const e = await refusal(() => controller.remove(req, 'tmp1', 'true'));
    expect((e.getResponse() as any).code).toBe('TEMPLATE_EMERGENCY_IN_USE');
    expect(client.playlist.updateMany).not.toHaveBeenCalled();
    expect(client.template.delete).not.toHaveBeenCalled();
  });

  it('without force the in-use block is unchanged (409 TEMPLATE_IN_USE, nothing touched)', async () => {
    const { controller, client } = makeController();
    // The reach lookup reads playlists/schedules/screens; give it the minimum it needs.
    (client as any).schedule = { findMany: jest.fn(async () => []) };
    (client.screen as any).findMany = jest.fn(async () => []);
    const e = await refusal(() => controller.remove(req, 'tmp1', undefined));
    expect((e.getResponse() as any).code).toBe('TEMPLATE_IN_USE');
    expect(client.template.delete).not.toHaveBeenCalled();
  });
});
