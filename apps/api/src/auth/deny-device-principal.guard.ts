import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Refuses a DEVICE principal (`req.user.kind === 'device'`, set by
 * JwtAuthGuard for a screen's device JWT) with 403. Applied after
 * JwtAuthGuard on dashboard routes that carry no `@RequireRoles` and serve or
 * change a tenant's administrative data — the routes a person's session uses,
 * which no screen calls. A route the player or APK calls must never carry it;
 * `screens/device-principal-routes.spec.ts` lists every route that does, and
 * the routes deliberately kept open to devices, with the call site that keeps
 * each one.
 *
 * Every other principal (a user session, an API key) is unaffected; with no
 * principal at all it defers to the authentication guard that runs before it.
 */
@Injectable()
export class DenyDevicePrincipalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { kind?: string } }>();
    if (req?.user?.kind === 'device') {
      throw new ForbiddenException({
        code: 'DEVICE_PRINCIPAL_NOT_ALLOWED',
        message: 'This route is not available to a screen credential',
      });
    }
    return true;
  }
}
