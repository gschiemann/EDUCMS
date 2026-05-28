import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { RedisService } from '../realtime/redis.service';
import { requireSecret } from '../security/required-secret';
import { ApiKeysService } from '../api-keys/api-keys.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private redisService: RedisService,
    // Optional so the guard still loads in test contexts where the
    // ApiKeysModule isn't imported. In production app.module imports
    // ApiKeysModule globally so this is always present.
    @Optional() private apiKeys?: ApiKeysService,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token missing');
    }

    // 2026-05-25 Developer area: tenant REST API keys (`vos_<32hex>`)
    // share the Bearer header with user / device JWTs. Detect the
    // format and route to a separate verification path that hashes
    // and looks up against the TenantApiKey table. On success we
    // attach a synthetic req.user with role + tenantId (userId = null
    // because this is a machine identity — AuditLog rows for API-
    // key-driven actions carry userId:null + apiKeyId for forensics).
    if (token.startsWith('vos_') && this.apiKeys) {
      const verified = await this.apiKeys.verify(token);
      if (!verified) {
        throw new UnauthorizedException('Invalid or revoked API key');
      }
      request['user'] = {
        // No real user — machine identity. id/userId left null so
        // AuditLog rows the API key triggers carry userId:null. The
        // apiKeyId field identifies WHICH key was used.
        id: null,
        userId: null,
        kind: 'api-key',
        role: verified.role,
        tenantId: verified.tenantId,
        apiKeyId: verified.id,
      };
      return true;
    }

    try {
      // Decode header WITHOUT verifying to learn which secret to use.
      // Device JWTs are signed with DEVICE_JWT_SECRET (kind: 'device');
      // user JWTs are signed with JWT_SECRET. Before this fix the guard
      // only tried JWT_SECRET, so /screens/:id/manifest requests carrying
      // a device token 401'd with 'Invalid or expired' — which surfaced
      // as 'unable to connect' on the paired browser player.
      const parts = token.split('.');
      let unverifiedKind: string | undefined;
      if (parts.length === 3) {
        try {
          const raw = Buffer.from(parts[1], 'base64url').toString('utf8');
          unverifiedKind = JSON.parse(raw)?.kind;
        } catch { /* malformed header — let verify throw below */ }
      }

      const isDeviceToken = unverifiedKind === 'device';
      const secret = isDeviceToken
        ? requireSecret('DEVICE_JWT_SECRET', { devFallback: 'dev_only_device_jwt_secret_CHANGE_ME' })
        : requireSecret('JWT_SECRET', { devFallback: 'dev_only_jwt_secret_CHANGE_ME' });

      const payload = await this.jwtService.verifyAsync(token, { secret });

      // Token revocation checks. Lane-1 P0 fix: previously a Redis error
      // here LOGGED AND ALLOWED the token (fail-open), so a brief Redis
      // hiccup let already-revoked tokens (logout, role downgrade) keep
      // working. Now we fail CLOSED — if we can't confirm the token isn't
      // revoked, we deny. Clients retry; transient Redis outages cause a
      // brief auth blip rather than an auth bypass.
      //
      // P1-4 (2026-05-28): this block was gated on
      // `process.env.NODE_ENV === 'production'`, making logout + every
      // revocation a SILENT NO-OP in staging / preview / misconfigured
      // deploys — while SSE (sse.controller.ts) and the WS gateway
      // (realtime.gateway.ts) checked unconditionally. Gate removed: the
      // check now runs in every environment and already fails closed, so
      // there is no remaining environment where a revoked token survives.
      try {
        // (a) Single-token revocation — the logout path SADDs the exact
        //     bearer token here.
        const isRevoked = await this.redisService.sismember('jwt_revoked_list', token);
        if (isRevoked) {
          throw new UnauthorizedException('Session revoked');
        }

        // (b) P1-1 — per-user mass revocation. Individual user JWTs carry
        //     no `jti` and a user can hold several live tokens, so the
        //     single-token set above can't revoke a demoted user's OTHER
        //     sessions. When an admin tightens a user's privileges (role
        //     downgrade, canTriggerPanic→false) the writer records a
        //     per-user "invalid-before" epoch; any token issued before it
        //     is rejected. Device tokens (sub=screenId, no `iat`-vs-user
        //     semantics) are exempt — this is a user-privilege control.
        if (unverifiedKind !== 'device' && payload?.sub && typeof payload.iat === 'number') {
          const invalidBefore = await this.redisService.getTokenInvalidBefore(payload.sub);
          if (invalidBefore != null && payload.iat < invalidBefore) {
            throw new UnauthorizedException('Session revoked');
          }
        }
      } catch (redisError) {
        if (redisError instanceof UnauthorizedException) {
          throw redisError;
        }
        const msg = redisError instanceof Error ? redisError.message : String(redisError);
        console.warn('[JwtAuthGuard] Redis revocation check failed (failing closed):', msg);
        throw new UnauthorizedException('Auth check unavailable; please retry');
      }

      if (isDeviceToken) {
        // Device identity — consumed by controllers that care (manifest,
        // cache-status, emergency-assets). kind='device' + sub=screenId
        // is the contract; no role / tenant assumptions here.
        request['user'] = {
          id: payload.sub,
          sub: payload.sub,
          kind: 'device',
          tenantId: payload.tenantId,
          fp: payload.fp,
        };
      } else {
        // Assign the structured payload to Request object for RbacGuard to consume
        // Token contains: { sub: user.id, tenantId, role } — see auth.service.ts
        // NOTE: both `id` and `userId` are populated. Most controllers read
        // req.user.id; a couple of older ones (tenants/switchTenant) still
        // read req.user.userId. Populating both avoids switch-500s when a
        // refactor only updates one call-site.
        request['user'] = {
          id: payload.sub,
          userId: payload.sub,
          email: payload.email,
          role: payload.role,
          tenantId: payload.tenantId,
          districtId: payload.districtId,
          schoolId: payload.schoolId || payload.tenantId,
          canTriggerPanic: payload.canTriggerPanic,
        };
      }
    } catch (error) {
      // Catching the specific error allows us to see if it was a token issue or a Redis crash
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired authentication token');
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    // Standard Bearer token extraction
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}