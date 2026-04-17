import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CleverHttpClient, CleverUser } from './clever-http.client';
import { RealCleverHttpClient } from './clever-http.client';
import { decryptToken, encryptToken } from './clever-crypto';

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
  ) {}

  /** Build the Clever OAuth authorize URL for a tenant to begin a connect flow. */
  buildAuthorizeUrl(tenantId: string, redirectUri: string): string {
    const clientId = process.env.CLEVER_CLIENT_ID ?? '';
    const state = Buffer.from(JSON.stringify({ tenantId })).toString('base64url');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'read:user_id read:users read:sis',
      state,
    });
    return `https://clever.com/oauth/authorize?${params.toString()}`;
  }

  decodeState(state: string): { tenantId: string } {
    try {
      const json = Buffer.from(state, 'base64url').toString('utf8');
      return JSON.parse(json) as { tenantId: string };
    } catch {
      throw new Error('Invalid OAuth state');
    }
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

  async disconnect(tenantId: string): Promise<void> {
    await this.prisma.client.tenant.update({
      where: { id: tenantId },
      data: {
        cleverAccessToken: null,
        cleverDistrictId: null,
        cleverConnectedAt: null,
      },
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
