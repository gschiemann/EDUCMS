/**
 * GET /api/v1/ai/allowance — the session's organisation only; our cost per board for SUPER_ADMIN only.
 */
import 'reflect-metadata';
import { AppRole } from '@cms/database';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AiAllowanceController } from './ai-allowance.controller';

function build() {
  const allowance = { operatorView: jest.fn(async (tenantId: string, opts: any) => ({ tenantId, opts })) };
  return { controller: new AiAllowanceController(allowance as any), allowance };
}

describe('AiAllowanceController', () => {
  it('reads the tenant from the SESSION — a tenant id in the query or body is never consulted', async () => {
    const { controller, allowance } = build();
    const req: any = {
      user: { id: 'u1', tenantId: 't-home', role: AppRole.SCHOOL_ADMIN },
      query: { tenantId: 't-foreign' },
      params: { tenantId: 't-foreign' },
      body: { tenantId: 't-foreign' },
    };
    await controller.allowanceForSession(req);
    expect(allowance.operatorView).toHaveBeenCalledWith('t-home', { includeCost: false });
  });

  it('our cost per board rides along for SUPER_ADMIN only', async () => {
    const { controller, allowance } = build();
    for (const role of [AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR, AppRole.RESTRICTED_VIEWER]) {
      await controller.allowanceForSession({ user: { tenantId: 't1', role } });
      expect(allowance.operatorView).toHaveBeenLastCalledWith('t1', { includeCost: false });
    }
    await controller.allowanceForSession({ user: { tenantId: 't1', role: AppRole.SUPER_ADMIN } });
    expect(allowance.operatorView).toHaveBeenLastCalledWith('t1', { includeCost: true });
  });

  it('every role that can make or edit a board may read it', () => {
    const roles: AppRole[] = Reflect.getMetadata(ROLES_KEY, AiAllowanceController.prototype.allowanceForSession);
    expect([...roles].sort()).toEqual(
      [AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR].sort(),
    );
  });
});
