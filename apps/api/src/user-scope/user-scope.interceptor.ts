import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable, from, mergeMap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { UserScopeService } from './user-scope.service';
import { USER_SCOPE_REQ_KEY } from './user-scope.context';
import {
  LOCATION_ACCESS_REVOKED,
  SCREEN_SCOPE_FORBIDDEN,
  bodyTargets,
  decideScopedRoute,
  isScopableRole,
  isStaleLocationExemptPath,
  normalizePath,
  rowTargetInScope,
  targetsInScope,
  type ScreenScope,
} from './user-scope.policy';

/**
 * USER SCOPING GATE (2026-10-11) — the ONE place both new rules are enforced.
 *
 * Runs for every request by a signed-in PERSON whose role is a location role
 * (SCHOOL_ADMIN / CONTRIBUTOR / RESTRICTED_VIEWER). Never for SUPER_ADMIN or
 * DISTRICT_ADMIN, a screen (`kind: 'device'`) or an API key — their behaviour
 * is byte-for-byte what it was.
 *
 *   1. LOCATION. The session's active tenant must be the person's home or a
 *      location they were given (`user_location_access`). If an admin removes
 *      that access while the person is switched in, the next request answers
 *      403 LOCATION_ACCESS_REVOKED (sign-out / who-am-i / the switcher stay
 *      open so they can go home).
 *   2. SCREENS. If the person is screen-scoped there, the route must be one
 *      the policy allows (default deny) and every screen, group, schedule or
 *      playlist it names must be within their scope. List routes are narrowed
 *      by the controller from `req.userScope`.
 *
 * Interceptors run after the route's guards, so `req.user` is verified and
 * RbacGuard has already decided the ROLE question; this only narrows WHERE.
 *
 * FAILS CLOSED, except for emergency routes. If the access lookup itself
 * fails, a normal request answers 503 (a scoped person must never be widened
 * by a database blip). An `/emergency/**` request goes through instead: an
 * alert is never what a scoping lookup takes down, and screen scope never
 * narrows emergency reach anyway (owner decision, user-scope.policy.ts).
 */
@Injectable()
export class UserScopeInterceptor implements NestInterceptor {
  constructor(
    private readonly scope: UserScopeService,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    if (!user || user.kind === 'device' || user.kind === 'api-key') return next.handle();
    if (!isScopableRole(user.role)) return next.handle();
    const userId: string | undefined = typeof user.id === 'string' ? user.id : undefined;
    const tenantId: string | undefined = typeof user.tenantId === 'string' ? user.tenantId : undefined;
    if (!userId || !tenantId) return next.handle();

    return from(this.decide(req, userId, tenantId)).pipe(mergeMap(() => next.handle()));
  }

  /** Throws to refuse; resolves to let the handler run. Exported for the matrix spec through the class. */
  async decide(req: any, userId: string, tenantId: string): Promise<void> {
    const path: string = normalizePath(req.originalUrl || req.url || '');
    const isEmergency = /^\/api\/v1\/emergency(?:\/|$)/i.test(path);

    let access;
    try {
      access = await this.scope.resolve(userId, tenantId);
    } catch (e) {
      this.scope.logFailure(`access lookup failed for user ${userId} in ${tenantId} on ${path}`, e);
      if (isEmergency) return;
      throw new ServiceUnavailableException({ code: 'USER_SCOPE_UNAVAILABLE', message: 'Could not check your access. Please try again.' });
    }

    if (!access || !access.allowed) {
      if (isStaleLocationExemptPath(path)) return;
      throw new ForbiddenException({
        code: LOCATION_ACCESS_REVOKED,
        message: 'You no longer have access to this location. Switch to one of your locations.',
      });
    }

    const screenScope = access.screenScope;
    if (!screenScope) return;
    req[USER_SCOPE_REQ_KEY] = screenScope;

    const decision = decideScopedRoute(req.method, path);
    const check = decision.check;
    if (check.kind === 'pass' || check.kind === 'filter') return;
    if (check.kind === 'deny') throw refusal();

    // Every remaining kind also checks any target the BODY names.
    const targets = bodyTargets(req.body);
    if (!targetsInScope(screenScope, targets)) throw refusal();

    switch (check.kind) {
      case 'body':
        if (check.requireTarget && targets.screenIds.length === 0 && targets.groupIds.length === 0) throw refusal();
        return;
      case 'screen': {
        const id = decision.params[check.param];
        if (!id || !screenScope.screenIds.includes(id)) throw refusal();
        return;
      }
      case 'schedule':
      case 'display-schedule': {
        const id = decision.params[check.param];
        const model = check.kind === 'schedule' ? 'schedule' : 'displaySchedule';
        const row = id
          ? await (this.prisma.client as any)[model].findFirst({
              where: { id, tenantId },
              select: { screenId: true, screenGroupId: true },
            })
          : null;
        // A row that is not in this location is answered by the controller
        // (404) exactly as before; for a scoped person it is simply refused.
        if (!row || !rowTargetInScope(screenScope, row)) throw refusal();
        return;
      }
      case 'playlist': {
        const id = decision.params[check.param];
        if (!id || !(await this.playlistWithinScope(id, tenantId, screenScope))) throw refusal();
        return;
      }
      case 'submission': {
        const id = decision.params[check.param];
        if (!id || !(await this.submissionWithinScope(id, tenantId, screenScope))) throw refusal();
        return;
      }
    }
  }

  /**
   * V-7 (2026-10-11): every schedule a submission bundles targets one of the
   * person's screens or groups. A submission with no schedules (assets only)
   * publishes nowhere and is theirs to approve. One from another location is
   * refused here and 404s for everyone else.
   */
  private async submissionWithinScope(submissionId: string, tenantId: string, scope: ScreenScope): Promise<boolean> {
    const client: any = this.prisma.client;
    const sub = await client.submission.findFirst({ where: { id: submissionId, tenantId } });
    if (!sub) return false;
    const ids = String(sub.scheduleIds || '').split(',').map((x: string) => x.trim()).filter(Boolean);
    if (!ids.length) return true;
    const rows: Array<{ id: string; screenId: string | null; screenGroupId: string | null }> = await client.schedule.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, screenId: true, screenGroupId: true },
    });
    // A bundled id that no longer resolves in this location cannot be judged — refuse.
    if (rows.length !== new Set(ids).size) return false;
    return rows.every((r) => rowTargetInScope(scope, r));
  }

  /**
   * Every schedule of the playlist targets one of the person's screens or
   * groups. An unpublished playlist (no schedules) is theirs to edit. A
   * playlist from another location is refused here and 404s for everyone else.
   */
  private async playlistWithinScope(playlistId: string, tenantId: string, scope: ScreenScope): Promise<boolean> {
    const client: any = this.prisma.client;
    const playlist = await client.playlist.findFirst({ where: { id: playlistId, tenantId }, select: { id: true } });
    if (!playlist) return false;
    const rows: Array<{ screenId: string | null; screenGroupId: string | null }> = await client.schedule.findMany({
      where: { playlistId, tenantId },
      select: { screenId: true, screenGroupId: true },
    });
    return rows.every((r) => rowTargetInScope(scope, r));
  }
}

function refusal(): ForbiddenException {
  return new ForbiddenException({
    code: SCREEN_SCOPE_FORBIDDEN,
    message: "You can only manage the screens you've been given. Ask an administrator if you need more access.",
  });
}
