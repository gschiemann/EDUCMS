import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { requireSecret } from '../security/required-secret';
import { clientIpFromRequest } from '../security/client-ip';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { evaluateApiKeyScopes } from '../api-keys/api-key-scopes';

/**
 * Routes an API key may NEVER reach, no matter what role the key carries and
 * no matter what scopes it holds (ACC-06, 2026-08-01).
 *
 * A tenant API key is a long-lived bearer string that lives in a script, a CI
 * secret, or a vendor's integration config. Minted with DISTRICT_ADMIN (the
 * default the UI offers) it satisfied `@RequireRoles` on POST
 * /api/v1/emergency/trigger — so a leaked key could put every screen in a
 * district into LOCKDOWN, and `/emergency/sos` was reachable at CONTRIBUTOR
 * too. That is a life-safety action; it requires a human identity with a
 * session, hold-to-trigger UX, and a named actor in the audit trail — none of
 * which a machine credential has.
 *
 * KEPT AS THE FIRST CHECK even now that per-key scopes exist (2026-08-03), and
 * it is not redundant with them:
 *   - it is UNCONDITIONAL. There is deliberately no `emergency:*` scope
 *     (api-key-scopes.ts explains why), so this cannot be granted around. An
 *     unrestricted legacy key — every key minted before scopes existed, all of
 *     which carry `scopes = NULL` and therefore skip scope narrowing entirely
 *     — is still refused here;
 *   - it is PREFIX-based, so a NEW emergency route is covered the moment it
 *     merges rather than the moment someone remembers to map it;
 *   - it runs before `req.user` is populated, so nothing downstream ever sees
 *     an api-key identity on an emergency request.
 * Scopes narrow what a key can do; this list is the floor under all of it.
 */
export const API_KEY_DENIED_PATH_PREFIXES: readonly string[] = ['/api/v1/emergency'];

/** Paths whose actor's tenant must not be archived (ACC-05). */
const ARCHIVED_TENANT_DENIED_PATH_PREFIXES: readonly string[] = ['/api/v1/emergency'];

/** How long a tenant's archive state is cached in-process (ms). */
const ARCHIVE_CHECK_TTL_MS = 30_000;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly guardLogger = new Logger(JwtAuthGuard.name);

  /**
   * Short-lived cache of `tenantId → isArchived`. The archive check only runs
   * on the emergency prefix (a rare, high-stakes route), and archiving is a
   * deliberate admin action, so a 30s window is a sound trade against adding
   * a DB round-trip to a life-safety path.
   */
  private archiveCache = new Map<string, { archived: boolean; at: number }>();

  constructor(
    private jwtService: JwtService,
    private redisService: RedisService,
    // Optional so the guard still loads in test contexts where the
    // ApiKeysModule isn't imported. In production app.module imports
    // ApiKeysModule globally so this is always present.
    @Optional() private apiKeys?: ApiKeysService,
    // Optional for the same reason. PrismaModule is @Global in the running
    // app, so this is always injected there.
    @Optional() private prisma?: PrismaService,
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
      // ACC-06 — life-safety routes are off-limits to machine credentials.
      // Checked BEFORE req.user is populated so nothing downstream ever sees
      // an api-key identity on an emergency request.
      const path = this.requestPath(request);
      if (API_KEY_DENIED_PATH_PREFIXES.some((p) => path.startsWith(p))) {
        this.guardLogger.warn(
          `API key ${verified.id} (tenant ${verified.tenantId}) was refused on ${path} — ` +
            `emergency actions require a human session.`,
        );
        this.recordApiKeyUse(request, verified, path, 'DENIED', 'emergency-path');
        throw new ForbiddenException(
          'API keys cannot trigger or clear emergency actions. These require a signed-in ' +
            'user with emergency permissions.',
        );
      }

      // Per-key least privilege (2026-08-03). `verified.scopes === null` is an
      // unrestricted key (everything minted before the scopes column) and
      // passes straight through — this is what keeps every live integration
      // working. A scoped key must hold the family+access the route maps to.
      const scopeDecision = evaluateApiKeyScopes(
        verified.scopes,
        String((request as any)?.method || 'GET'),
        path,
      );
      if (!scopeDecision.allowed) {
        this.guardLogger.warn(
          `API key ${verified.id} (tenant ${verified.tenantId}) was refused on ${path} — ` +
            `${scopeDecision.reason}` +
            (scopeDecision.requiredScope ? ` (needs '${scopeDecision.requiredScope}')` : ''),
        );
        this.recordApiKeyUse(request, verified, path, 'DENIED', scopeDecision.reason, {
          requiredScope: scopeDecision.requiredScope,
        });
        throw new ForbiddenException(
          scopeDecision.requiredScope
            ? `This API key does not have the '${scopeDecision.requiredScope}' scope.`
            : 'This API key is not scoped for this endpoint.',
        );
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
      // ACC-06 — API-key actions were forensically ANONYMOUS: every AuditLog
      // row they produced carried `userId: null` and no key reference. The
      // guard writes its OWN row per state-changing API-key request, giving
      // the key, IP, method and route.
      //
      // 2026-08-03: `AuditLog.apiKeyId` now exists, so the ACTION rows the
      // request goes on to write are stamped with the key directly
      // (AuditWriter / prisma.service). This request row is no longer the only
      // way to answer "which key did this" — but it is kept, because it is
      // also the only record of DENIED attempts and of requests that were
      // refused before any action row could be written.
      if (this.isMutating(request)) {
        this.recordApiKeyUse(request, verified, path, 'ALLOWED');
      }
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
          // 2026-07-25 — auth.service signs `tenantSlug` into the token but this
          // object never copied it, so every `req.user.tenantSlug` read was
          // undefined. BillingController.billingUrl fell back to the literal
          // 'dashboard', sending Stripe Checkout / Customer Portal returns to
          // /dashboard/settings/billing — a route that does not exist, i.e. a 404
          // for a customer who just paid.
          tenantSlug: payload.tenantSlug,
          districtId: payload.districtId,
          schoolId: payload.schoolId || payload.tenantId,
          canTriggerPanic: payload.canTriggerPanic,
          // ACC-07 — surface the CURRENT session's clock so any route that
          // re-mints a token (tenant switch) can cap the new token at the
          // remaining lifetime instead of silently extending it.
          tokenIat: typeof payload.iat === 'number' ? payload.iat : undefined,
          tokenExp: typeof payload.exp === 'number' ? payload.exp : undefined,
        };
      }
    } catch (error) {
      // Catching the specific error allows us to see if it was a token issue or a Redis crash
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired authentication token');
    }

    // ACC-05 — an ARCHIVED tenant must not be able to fire a life-safety
    // action. Login is already blocked for archived tenants and archiving
    // revokes the tenant's live sessions, so reaching here means an edge case
    // (a tenant archived by a direct DB/script write that bypassed the
    // controller). This is the runtime backstop for exactly that.
    await this.assertActorTenantNotArchived(request);

    return true;
  }

  /** Lower-cased request path, without query string. Never throws. */
  private requestPath(request: Request): string {
    const raw =
      (request as any)?.originalUrl ?? (request as any)?.url ?? (request as any)?.path ?? '';
    return String(raw).split('?')[0].toLowerCase();
  }

  private isMutating(request: Request): boolean {
    const method = String((request as any)?.method || 'GET').toUpperCase();
    return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  }

  /**
   * Attributable forensic row for an API-key request (ACC-06). Fire-and-forget
   * — the auth path must never block or fail on an audit write.
   *
   * 2026-08-03: also stamps the first-class `apiKeyId` column, so this row is
   * returned by the same "everything key X did" query as the action rows
   * rather than only being findable by parsing `details` JSON.
   */
  private recordApiKeyUse(
    request: Request,
    verified: { id: string; tenantId: string; role: string; scopes?: string[] | null },
    path: string,
    outcome: 'ALLOWED' | 'DENIED',
    reason?: string,
    extra?: Record<string, unknown>,
  ): void {
    if (!this.prisma) return;
    const details = JSON.stringify({
      apiKeyId: verified.id,
      role: verified.role,
      // `null` here means an unrestricted (pre-scopes) key — worth recording
      // verbatim so an investigator can tell "was granted everything" apart
      // from "was granted nothing".
      scopes: verified.scopes ?? null,
      method: String((request as any)?.method || '').toUpperCase(),
      path,
      outcome,
      ...(reason ? { reason } : {}),
      ...(extra ?? {}),
      ip: clientIpFromRequest(request),
      ua: ((request.headers?.['user-agent'] as string | undefined) || '').slice(0, 256),
    });
    this.prisma.client.auditLog
      .create({
        data: {
          tenantId: verified.tenantId,
          // No user — this IS the point of the row: the key is the actor, and
          // `apiKeyId` names it.
          userId: null,
          apiKeyId: verified.id,
          action: outcome === 'DENIED' ? 'API_KEY_REQUEST_DENIED' : 'API_KEY_REQUEST',
          targetType: 'TenantApiKey',
          targetId: verified.id,
          details,
        } as any,
      })
      .catch((e: any) =>
        this.guardLogger.warn(`API-key audit row failed: ${e?.message ?? e}`),
      );
  }

  /**
   * ACC-05 — refuse emergency actions from a user whose tenant is archived.
   *
   * AVAILABILITY NOTE (deliberate): if the lookup itself FAILS we ALLOW and
   * log at ERROR. This is a housekeeping control (a retired location), not a
   * threat gate, and a life-safety product must never let a DB hiccup be the
   * reason a lockdown does not fire. A truly-down database fails the trigger
   * downstream anyway (it writes Tenant + AuditLog), so allowing here
   * forfeits nothing. Contrast the token-revocation checks above, which fail
   * CLOSED because there the check IS the security boundary.
   */
  private async assertActorTenantNotArchived(request: Request): Promise<void> {
    const path = this.requestPath(request);
    if (!ARCHIVED_TENANT_DENIED_PATH_PREFIXES.some((p) => path.startsWith(p))) return;
    const user = (request as any).user;
    const tenantId: string | undefined = user?.tenantId;
    if (!tenantId || !this.prisma) return;

    try {
      const cached = this.archiveCache.get(tenantId);
      let archived: boolean;
      if (cached && Date.now() - cached.at < ARCHIVE_CHECK_TTL_MS) {
        archived = cached.archived;
      } else {
        const row = await this.prisma.client.tenant.findUnique({
          where: { id: tenantId },
          select: { archivedAt: true },
        });
        archived = !!row?.archivedAt;
        this.archiveCache.set(tenantId, { archived, at: Date.now() });
      }
      if (archived) {
        this.guardLogger.warn(
          `Refused ${path} for archived tenant ${tenantId} (user ${user?.id ?? 'unknown'}).`,
        );
        throw new ForbiddenException(
          'This workspace is archived. Restore it before triggering emergency actions.',
        );
      }
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      this.guardLogger.error(
        `Archived-tenant check failed for ${tenantId} on ${path} (ALLOWING — life-safety ` +
          `availability): ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    // Standard Bearer token extraction
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}