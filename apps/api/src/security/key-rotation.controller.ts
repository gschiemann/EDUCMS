import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { assertKeyRingsAtBoot, DEVICE_JWT_SECRET_NAME, DEVICE_SECRET_KEY_NAME, previousSecretName } from './key-ring';
import { KeyRotationRewrapService } from './key-rotation-rewrap.service';

/**
 * SUPER_ADMIN controls for a secret rotation window (`security/key-ring.ts`,
 * runbook `docs/SECRET-ROTATION.md`).
 *
 *   GET  /api/v1/super/key-rotation          — which windows are open (names only, never values)
 *   POST /api/v1/super/key-rotation/rewrap   — run the stored-credential re-wrap now; counts only
 *
 * The re-wrap is idempotent and a no-op with no window open, so the POST is
 * safe to repeat; the runbook uses a run reporting `rewrapped: 0` and
 * `unreadable: 0` as the proof that `DEVICE_SECRET_KEY_PREVIOUS` can go.
 * Every run writes one `KEY_ROTATION_REWRAP` AuditLog row (system tenant,
 * `userId` = the admin who pressed it).
 */
@Controller('api/v1/super/key-rotation')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
export class KeyRotationController {
  constructor(private readonly rewrap: KeyRotationRewrapService) {}

  @Get()
  status() {
    const open = assertKeyRingsAtBoot();
    return {
      windows: [DEVICE_JWT_SECRET_NAME, DEVICE_SECRET_KEY_NAME].map((name) => ({
        secret: name,
        previousVar: previousSecretName(name),
        open: open.includes(name),
      })),
      rewrapPending: KeyRotationRewrapService.windowOpen(),
    };
  }

  @Post('rewrap')
  async runRewrap(@Req() req: any) {
    const actor = typeof req?.user?.id === 'string' ? req.user.id : null;
    return this.rewrap.run('manual', actor);
  }
}
