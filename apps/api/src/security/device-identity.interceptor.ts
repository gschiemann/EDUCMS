/**
 * DeviceIdentityInterceptor — re-derive a device principal's identity from
 * the LIVE Screen row, on every request (finding DT-03, 2026-08-03).
 *
 * THE BUG IT FIXES. `JwtAuthGuard` builds a device principal like this:
 *
 *     request['user'] = { id: payload.sub, sub: payload.sub,
 *                         kind: 'device', tenantId: payload.tenantId, … }
 *
 * — `tenantId` straight off a claim inside a multi-month token. Three
 * sibling paths in this codebase explicitly refuse to trust that claim and
 * say why: `emergency.controller` `/messages` ("a screen re-paired to
 * another tenant carries a stale claim until its token rotates; reading the
 * live row prevents a cross-tenant leak"), `realtime.gateway` (rejects the
 * socket when the claim disagrees with the DB), and `sse.controller`. Every
 * other device-reachable route — `/emergency/status`, `/notifications`,
 * `/tenants`, `/license/me`, `/branding/me` — trusted the claim, so a screen
 * that had been unpaired, re-homed to another district, or pulled out of a
 * school and dumpstered went on reading its FORMER tenant's live emergency
 * traffic for the life of the token. For a K-12 life-safety product that is
 * the highest-consequence read in the system.
 *
 * Fixing it in each handler is whack-a-mole: the next roleless route added
 * inherits the same trap. This interceptor fixes the principal itself, once,
 * for every route the guard protects:
 *
 *   • `tenantId` / `screenGroupId` come from the live `Screen` row, or are
 *     `undefined` when the screen is unpaired. Downstream `requireTenantId*`
 *     helpers then fail closed instead of resolving a stale tenant.
 *   • a device whose screen row is gone, is `REVOKED`, or whose credential
 *     epoch no longer matches is rejected with 401 — which is what makes
 *     the DT-01 revocation store actually bite on the guard-protected
 *     routes (`/screens/:id/manifest` above all).
 *
 * SCOPE / SAFETY:
 *   • It is a strict no-op for every non-device principal. User sessions,
 *     API keys and anonymous routes are untouched.
 *   • It only ever NARROWS a device's reach; it can never widen it.
 *   • Grandfathering: a token minted before the `ep` claim existed reads as
 *     epoch 0, which is `Screen.credentialEpoch`'s default, so the deployed
 *     fleet authenticates unchanged. See `screens/device-auth.ts`.
 *   • Cost: one indexed `Screen` lookup, memoised for 5 s per screen by the
 *     shared credential-snapshot cache — so the 5 s manifest poll and the
 *     16 Hz `/game-state` post do not each become a database round trip on
 *     a `connection_limit=10` pool.
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { from, switchMap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import {
  loadDeviceCredentialState,
  isEpochAcceptable,
  epochFromClaim,
  decodeDeviceTokenUnsafe,
} from '../screens/device-auth';

@Injectable()
export class DeviceIdentityInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    if (!user || user.kind !== 'device' || typeof user.sub !== 'string') {
      return next.handle();
    }
    return from(this.resolve(req, user)).pipe(switchMap(() => next.handle()));
  }

  private async resolve(req: any, user: any): Promise<void> {
    const state = await loadDeviceCredentialState({ prisma: this.prisma }, user.sub);

    // Row gone → the credential has nothing left to authenticate against.
    // (Deleting a screen is therefore a complete, immediate revocation.)
    if (!state) throw new UnauthorizedException('Device credential invalid');
    if (state.status === 'REVOKED') throw new UnauthorizedException('Device credential revoked');

    // The guard does not surface the raw token's claims beyond the handful
    // it copies, so read the epoch off the bearer token directly. Signature
    // validity is already established by the guard; we only need the claim.
    const auth = typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
    const decoded = decodeDeviceTokenUnsafe(auth);
    const presentedEpoch = epochFromClaim(decoded);
    if (!isEpochAcceptable(presentedEpoch, state)) {
      throw new UnauthorizedException('Device credential revoked');
    }

    // ── The DT-03 fix itself ──────────────────────────────────────────
    // Live row wins over the claim, always. `undefined` (not null) so the
    // `requireTenantId*` helpers treat an unpaired screen as "no tenant"
    // and refuse, rather than resolving a stale one.
    user.tenantId = state.tenantId ?? undefined;
    user.screenGroupId = state.screenGroupId ?? undefined;
    user.credentialEpoch = state.credentialEpoch;
    user.ep = presentedEpoch;
    // A device principal must never be able to satisfy a district/school
    // scoped read via an alternate key that a handler happens to check
    // first (several read `schoolId || tenantId || districtId`).
    user.schoolId = state.tenantId ?? undefined;
    user.districtId = undefined;
  }
}
