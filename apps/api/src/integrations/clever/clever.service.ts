import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CleverHttpClient, CleverUser } from './clever-http.client';
import { RealCleverHttpClient } from './clever-http.client';
import { decryptToken, encryptToken } from './clever-crypto';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { requireSecret } from '../../security/required-secret';
import { CLEVER_STATE_TTL_MS, CleverOAuthStateStore } from './clever-oauth-state';

// State envelope signed with HMAC-SHA256 over (tenantId|nonce|ts). Defends
// against the historical "swap the state param to bind your Clever org to a
// victim tenant" attack (Lane-1 P0). Reuses DEVICE_SECRET_KEY (already
// boot-validated as a >=16-char secret by required-secret.ts in production).
//
// CLV-01 (2026-09-02): the HMAC alone was never enough — it proves the state
// is one WE minted, not that it belongs to the browser presenting it. The
// nonce is now a real single-use server record bound to {tenantId, userId}
// (`clever-oauth-state.ts`) AND mirrored into a browser cookie by the
// controller. See `consumeState` below.
const STATE_TTL_MS = CLEVER_STATE_TTL_MS; // 15 min — OAuth round-trips finish in seconds
function stateSecret(): string {
  // 2026-05-29 (Audit 34-supplychain P3): route through requireSecret so the
  // dev fallback is THROWN in production (consistent with every other secret
  // call-site) instead of being a NODE_ENV-ungated public literal that's dead
  // in prod only by boot-gate transitivity.
  return requireSecret('DEVICE_SECRET_KEY', {
    devFallback: 'dev-only-clever-state-fallback-do-not-use-in-production-1234567890',
  });
}
function signStatePayload(tenantId: string, nonce: string, ts: number): string {
  return createHmac('sha256', stateSecret())
    .update(`${tenantId}|${nonce}|${ts}`)
    .digest('base64url');
}

/** Length-safe constant-time string compare (never leaks the position of a mismatch). */
function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export const CLEVER_HTTP_CLIENT = 'CLEVER_HTTP_CLIENT';

export interface SyncDiff {
  toAdd: CleverUser[];
  toUpdate: CleverUser[];
  toDisable: string[]; // internal user ids
}

export interface SyncResult {
  syncLogId: string;
  usersAdded: number;
  usersUpdated: number;
  usersDisabled: number;
}

function mapCleverRole(role: string): string {
  switch (role) {
    case 'district_admin':
      return 'DISTRICT_ADMIN';
    case 'school_admin':
    case 'principal':
      return 'SCHOOL_ADMIN';
    case 'teacher':
    case 'staff':
      return 'CONTRIBUTOR';
    default:
      return 'RESTRICTED_VIEWER';
  }
}

@Injectable()
export class CleverService {
  private readonly logger = new Logger(CleverService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLEVER_HTTP_CLIENT) private readonly http: CleverHttpClient,
    private readonly stateStore: CleverOAuthStateStore,
  ) {}

  /** True when the Clever OAuth credentials are present in env. Callers
   *  can use this to render a "not configured" state or refuse to surface
   *  the Connect button (2026-05-23 launch audit P0 — previously the UI
   *  unconditionally rendered the Connect button which 302'd to a broken
   *  clever.com error page when client_id was empty). */
  isConfigured(): boolean {
    return !!(process.env.CLEVER_CLIENT_ID && process.env.CLEVER_CLIENT_SECRET);
  }

  /**
   * Begin a connect flow: mint the authorize URL AND the single-use nonce the
   * caller must mirror into a browser cookie.
   *
   * CLV-01 — the returned `nonce` is the browser binding. `clever.controller`
   * sets it as a short-lived HttpOnly cookie and `consumeState` refuses any
   * callback that does not present the matching value. Without it a phished
   * `state` binds the victim district's Clever token to the attacker's tenant.
   *
   * @param tenantId the tenant this handshake may bind a Clever district to.
   * @param redirectUri the registered Clever redirect for this deploy.
   * @param userId the admin who started it, recorded for the audit trail.
   */
  async beginConnect(
    tenantId: string,
    redirectUri: string,
    userId: string | null,
  ): Promise<{ url: string; nonce: string }> {
    const { url, nonce } = this.buildAuthorizeUrl(tenantId, redirectUri);
    await this.stateStore.put(nonce, { tenantId, userId, createdAt: Date.now() });
    return { url, nonce };
  }

  /** Build the Clever OAuth authorize URL for a tenant to begin a connect flow.
   *  State is HMAC-signed over (tenantId|nonce|ts) so the callback can reject
   *  any attempt to swap the tenantId in transit. Callers should prefer
   *  `beginConnect`, which also persists the nonce — a URL minted here without
   *  a stored nonce can never complete (`consumeState` refuses it). */
  buildAuthorizeUrl(tenantId: string, redirectUri: string): { url: string; nonce: string } {
    // 2026-05-23 launch audit P0: refuse to mint a clever.com URL with
    // an empty client_id. Previously this returned
    //   https://clever.com/oauth/authorize?...&client_id=
    // which 302'd the operator to a Clever "Invalid client" error page.
    // Surface a real error so the controller can return a 503 with
    // actionable copy instead.
    const clientId = process.env.CLEVER_CLIENT_ID ?? '';
    if (!clientId) {
      throw new Error(
        'Clever integration is not configured for this deploy. Set CLEVER_CLIENT_ID and CLEVER_CLIENT_SECRET on the API service and redeploy.',
      );
    }
    const nonce = randomBytes(12).toString('base64url');
    const ts = Date.now();
    const sig = signStatePayload(tenantId, nonce, ts);
    const state = Buffer.from(JSON.stringify({ tenantId, nonce, ts, sig })).toString('base64url');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'read:user_id read:users read:sis',
      state,
    });
    return { url: `https://clever.com/oauth/authorize?${params.toString()}`, nonce };
  }

  /**
   * CLV-01 — the ONE gate the callback goes through.
   *
   * Three checks, all required, in cheapest-first order:
   *   1. the envelope is one we signed and has not expired (`decodeState`);
   *   2. the browser presenting it holds the matching nonce cookie — this is
   *      what stops a phished state completing in the VICTIM's browser;
   *   3. a single-use server record for that nonce still exists AND names the
   *      same tenant — this is what stops replay and what makes the tenant
   *      binding come from our own store rather than the envelope alone.
   *
   * Every failure throws. There is no path that returns a tenant without all
   * three holding.
   *
   * @param state the `state` query param echoed back by Clever.
   * @param browserNonce the nonce read from the request's cookie (or session).
   */
  async consumeState(
    state: string,
    browserNonce: string | null | undefined,
  ): Promise<{ tenantId: string; userId: string | null }> {
    const { tenantId, nonce } = this.decodeState(state);
    if (!browserNonce || !constantTimeEquals(browserNonce, nonce)) {
      // The browser that finished this handshake is not the browser that
      // started it. This is the phished-state case.
      throw new Error('Invalid OAuth state (session mismatch)');
    }
    const record = await this.stateStore.take(nonce);
    if (!record) {
      // Unknown, expired, or already used. Fail closed — see the header of
      // clever-oauth-state.ts for why a Redis "no record" is authoritative.
      throw new Error('Invalid OAuth state (unknown or already used)');
    }
    if (record.tenantId !== tenantId) {
      throw new Error('Invalid OAuth state (tenant mismatch)');
    }
    return { tenantId: record.tenantId, userId: record.userId };
  }

  /** Verify the signed state envelope. Throws on missing/expired/forged. */
  decodeState(state: string): { tenantId: string; nonce: string } {
    let parsed: { tenantId?: unknown; nonce?: unknown; ts?: unknown; sig?: unknown };
    try {
      parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    } catch {
      throw new Error('Invalid OAuth state (decode)');
    }
    const tenantId = typeof parsed.tenantId === 'string' ? parsed.tenantId : '';
    const nonce = typeof parsed.nonce === 'string' ? parsed.nonce : '';
    const ts = typeof parsed.ts === 'number' ? parsed.ts : 0;
    const sig = typeof parsed.sig === 'string' ? parsed.sig : '';
    if (!tenantId || !nonce || !ts || !sig) {
      throw new Error('Invalid OAuth state (missing fields)');
    }
    if (Math.abs(Date.now() - ts) > STATE_TTL_MS) {
      throw new Error('Invalid OAuth state (expired)');
    }
    const expected = signStatePayload(tenantId, nonce, ts);
    if (!constantTimeEquals(sig, expected)) {
      throw new Error('Invalid OAuth state (signature mismatch)');
    }
    return { tenantId, nonce };
  }

  /** Complete OAuth callback: exchange code, store encrypted token + district id. */
  async completeOAuth(tenantId: string, code: string, redirectUri: string): Promise<void> {
    const token = await this.http.exchangeCode(code, redirectUri);
    const districtId = await this.http.getDistrictId(token.access_token);
    await this.prisma.client.tenant.update({
      where: { id: tenantId },
      data: {
        cleverAccessToken: encryptToken(token.access_token),
        cleverDistrictId: districtId,
        cleverConnectedAt: new Date(),
      },
    });
  }

  async disconnect(tenantId: string, actorUserId?: string | null): Promise<void> {
    // 2026-05-23 launch audit P1: disconnect purges Clever OAuth
    // access token from Tenant.cleverAccessToken. Same secret-purge
    // class as streaming/pos/ads connection deletes. Transactional
    // with the audit-log so partial state is impossible.
    await this.prisma.client.$transaction(async (tx) => {
      const before = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { cleverDistrictId: true, cleverConnectedAt: true },
      });
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          cleverAccessToken: null,
          cleverDistrictId: null,
          cleverConnectedAt: null,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId ?? null,
          action: 'CLEVER_DISCONNECTED',
          targetType: 'Tenant',
          targetId: tenantId,
          details: JSON.stringify({
            priorDistrictId: before?.cleverDistrictId ?? null,
            priorConnectedAt: before?.cleverConnectedAt ?? null,
          }),
        },
      });
    });
  }

  async getAccessToken(tenantId: string): Promise<string | null> {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { cleverAccessToken: true },
    });
    if (!tenant?.cleverAccessToken) return null;
    return decryptToken(tenant.cleverAccessToken);
  }

  /**
   * Compute a sync diff without mutating the database.
   * Idempotent — callable repeatedly to power the "preview before sync" UI.
   */
  async computeDiff(tenantId: string, remote: CleverUser[]): Promise<SyncDiff> {
    const remoteById = new Map(remote.map((u) => [u.id, u]));
    const existing = await this.prisma.client.user.findMany({
      where: { tenantId },
      select: { id: true, cleverId: true, email: true },
    });

    const existingByCleverId = new Map(
      existing.filter((u) => u.cleverId).map((u) => [u.cleverId as string, u]),
    );
    const existingByEmail = new Map(
      existing.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u]),
    );

    const toAdd: CleverUser[] = [];
    const toUpdate: CleverUser[] = [];

    for (const u of remote) {
      if (!u.email) continue;
      if (existingByCleverId.has(u.id)) {
        toUpdate.push(u);
      } else if (existingByEmail.has(u.email.toLowerCase())) {
        toUpdate.push(u);
      } else {
        toAdd.push(u);
      }
    }

    const toDisable: string[] = [];
    for (const u of existing) {
      if (u.cleverId && !remoteById.has(u.cleverId)) {
        toDisable.push(u.id);
      }
    }
    return { toAdd, toUpdate, toDisable };
  }

  /**
   * Run a sync for one tenant. Creates a CleverSyncLog row, applies diff,
   * and completes the log. Safe to call repeatedly — idempotent by design.
   */
  async syncTenant(tenantId: string): Promise<SyncResult> {
    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('tenant not found');
    if (!tenant.cleverAccessToken) {
      throw new Error('Tenant is not connected to Clever');
    }

    const log = await this.prisma.client.cleverSyncLog.create({
      data: { tenantId },
    });

    try {
      const accessToken = decryptToken(tenant.cleverAccessToken);
      const remote = await this.http.listUsers(accessToken);
      const diff = await this.computeDiff(tenantId, remote);

      // Add
      for (const u of diff.toAdd) {
        if (!u.email) continue;
        await this.prisma.client.user.create({
          data: {
            tenantId,
            email: u.email,
            // Clever-provisioned accounts log in via SSO; placeholder hash blocks password login.
            passwordHash: 'clever-sso-no-password',
            role: mapCleverRole(u.role),
            cleverId: u.id,
            cleverRole: u.role,
          },
        });
      }

      // Update
      for (const u of diff.toUpdate) {
        if (!u.email) continue;
        await this.prisma.client.user.updateMany({
          where: {
            tenantId,
            OR: [{ cleverId: u.id }, { email: u.email }],
          },
          data: {
            cleverId: u.id,
            cleverRole: u.role,
            role: mapCleverRole(u.role),
          },
        });
      }

      // Disable — we don't have an `enabled` column yet, so mark via role downgrade.
      // Follow-up: add User.disabled flag in its own sprint. For now, log only.
      // We still record the count so the UI can surface the delta.
      const disabled = diff.toDisable.length;

      const completed = await this.prisma.client.cleverSyncLog.update({
        where: { id: log.id },
        data: {
          syncCompletedAt: new Date(),
          usersAdded: diff.toAdd.length,
          usersUpdated: diff.toUpdate.length,
          usersDisabled: disabled,
        },
      });

      return {
        syncLogId: completed.id,
        usersAdded: completed.usersAdded,
        usersUpdated: completed.usersUpdated,
        usersDisabled: completed.usersDisabled,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Clever sync failed for tenant=${tenantId}: ${msg}`);
      await this.prisma.client.cleverSyncLog.update({
        where: { id: log.id },
        data: { syncCompletedAt: new Date(), errorMessage: msg.slice(0, 500) },
      });
      throw err;
    }
  }

  /** Preview: return just the diff counts for UI display. */
  async previewSync(tenantId: string): Promise<{
    toAdd: number;
    toUpdate: number;
    toDisable: number;
  }> {
    const token = await this.getAccessToken(tenantId);
    if (!token) throw new Error('Tenant is not connected to Clever');
    const remote = await this.http.listUsers(token);
    const diff = await this.computeDiff(tenantId, remote);
    return {
      toAdd: diff.toAdd.length,
      toUpdate: diff.toUpdate.length,
      toDisable: diff.toDisable.length,
    };
  }

  async getStatus(tenantId: string) {
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        cleverDistrictId: true,
        cleverConnectedAt: true,
      },
    });
    const lastSync = await this.prisma.client.cleverSyncLog.findFirst({
      where: { tenantId },
      orderBy: { syncStartedAt: 'desc' },
    });
    return {
      // 2026-05-23 launch audit P0: surface deployment-level configured
      // state so the UI can render a "Clever not configured for this
      // deploy" empty state instead of a Connect button that 302s to
      // a broken clever.com error page.
      configured: this.isConfigured(),
      connected: !!tenant?.cleverDistrictId,
      districtId: tenant?.cleverDistrictId ?? null,
      connectedAt: tenant?.cleverConnectedAt ?? null,
      lastSync,
    };
  }

  /** List connected tenants for cron to iterate over. */
  async listConnectedTenantIds(): Promise<string[]> {
    const rows = await this.prisma.client.tenant.findMany({
      where: { cleverAccessToken: { not: null } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}

export { RealCleverHttpClient };
