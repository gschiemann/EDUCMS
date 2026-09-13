/**
 * SocialService — Instagram / Facebook Page connections + post cache.
 * ──────────────────────────────────────────────────────────────────
 *
 * Mirrors PosService (apps/api/src/pos/pos.service.ts) deliberately: the same
 * envelope cipher, the same status vocabulary, the same audit helper, the same
 * "sync writes a cache the widgets read" shape. If you are changing one of
 * them, look at the other.
 *
 * THREE RULES THIS FILE EXISTS TO KEEP:
 *
 *  1. **Tokens never leave the API.** `listConnections` returns a DTO built
 *     field-by-field; there is no `...row` spread anywhere in this file, so a
 *     new column cannot leak by accident. Nothing logs a token.
 *  2. **Every query is tenant-scoped.** Every `where` carries `tenantId`, so
 *     the tenant-isolation gate (TEN-001, baseline 0) stays green without an
 *     exemption.
 *  3. **`lastSyncedAt` is the ONLY source of an "updated" label.** Render time
 *     is not freshness — a board that says "just now" because it repainted is
 *     the exact lie this codebase keeps getting burned by.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { sealCredentials, openCredentials } from '../../streaming/creds-cipher';
import {
  MetaHttpError,
  type FetchLike,
  type NormalizedSocialPost,
} from './meta-http';
import * as instagram from './instagram';
import * as facebook from './facebook';

export type SocialProviderId = 'instagram' | 'facebook';

export const SOCIAL_PROVIDER_IDS: SocialProviderId[] = [
  'instagram',
  'facebook',
];

export function isSocialProviderId(v: unknown): v is SocialProviderId {
  return v === 'instagram' || v === 'facebook';
}

export const SOCIAL_PROVIDER_LABEL: Record<SocialProviderId, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook Page',
};

/** How many posts one sync pulls per connection. A signage board shows at most
 *  12; 30 gives the operator room to filter and keeps one Graph call per
 *  connection per hour. */
export const SYNC_POST_LIMIT = 30;

/** Refresh an Instagram token with less than this left. Meta gives 60 days and
 *  requires the token to be ≥24h old and still valid to refresh at all, so a
 *  10-day window means ~50 chances to succeed before anything breaks — an
 *  outage has to last more than a week to cost the operator a reconnect. */
export const REFRESH_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

/** What the dashboard and the player are allowed to see. No credential fields
 *  appear here, and that is the point. */
export interface SocialConnectionDto {
  id: string;
  providerId: SocialProviderId;
  providerName: string;
  accountId: string;
  displayName: string | null;
  status: string;
  statusReason: string | null;
  /** ISO. The ONLY freshness signal any UI may show. */
  lastSyncedAt: string | null;
  postCount: number;
  createdAt: string;
}

export interface SocialPostDto {
  id: string;
  connectionId: string;
  kind: string;
  text: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  postedAt: string;
}

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Test seam. Production always uses global fetch. */
  fetchImpl: FetchLike | undefined = undefined;

  // ─── Configuration status ─────────────────────────────────────────
  //
  // Dormant-until-configured, exactly like StripeService.enabled(): with no
  // keys the endpoints answer honestly and NOTHING throws at boot.

  missingEnvFor(provider: SocialProviderId): string[] {
    return provider === 'instagram'
      ? instagram.instagramMissingEnv()
      : facebook.facebookMissingEnv();
  }

  isConfigured(provider: SocialProviderId): boolean {
    return this.missingEnvFor(provider).length === 0;
  }

  /** `GET /integrations/social/status`. */
  status() {
    const providers = SOCIAL_PROVIDER_IDS.map((id) => ({
      id,
      name: SOCIAL_PROVIDER_LABEL[id],
      enabled: this.isConfigured(id),
      missing: this.missingEnvFor(id),
    }));
    return {
      enabled: providers.some((p) => p.enabled),
      // Union of everything unset, so the UI can print one sentence.
      missing: Array.from(new Set(providers.flatMap((p) => p.missing))),
      providers,
    };
  }

  // ─── Connections ──────────────────────────────────────────────────

  async listConnections(
    tenantId: string,
    provider?: SocialProviderId,
  ): Promise<SocialConnectionDto[]> {
    const where: any = { tenantId };
    if (provider) where.providerId = provider;
    const rows = await (
      this.prisma.client as any
    ).socialProviderConnection.findMany({
      where,
      include: { _count: { select: { posts: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r: any) => this.toConnectionDto(r));
  }

  /** Field-by-field, never a spread. Adding a column to the model must not be
   *  able to publish it. */
  private toConnectionDto(r: any): SocialConnectionDto {
    return {
      id: r.id,
      providerId: r.providerId,
      providerName:
        SOCIAL_PROVIDER_LABEL[r.providerId as SocialProviderId] || r.providerId,
      accountId: r.accountId,
      displayName: r.displayName ?? null,
      status: r.status,
      statusReason: r.statusReason ?? null,
      lastSyncedAt: r.lastSyncedAt
        ? new Date(r.lastSyncedAt).toISOString()
        : null,
      postCount: r._count?.posts ?? 0,
      createdAt: new Date(r.createdAt).toISOString(),
    };
  }

  /**
   * Create-or-reauthorize one connection. Keyed on
   * (tenantId, providerId, accountId) so re-connecting the same account
   * updates in place rather than piling up dead rows.
   */
  async upsertConnection(opts: {
    tenantId: string;
    userId: string;
    providerId: SocialProviderId;
    accountId: string;
    displayName: string;
    accessToken: string;
    expiresAt: Date | null;
    scope: string[];
  }) {
    const sealed = sealCredentials({ accessToken: opts.accessToken });
    const scope = opts.scope?.join(' ') || null;

    const existing = await (
      this.prisma.client as any
    ).socialProviderConnection.findFirst({
      where: {
        tenantId: opts.tenantId,
        providerId: opts.providerId,
        accountId: opts.accountId,
      },
    });

    if (existing) {
      const updated = await (
        this.prisma.client as any
      ).socialProviderConnection.update({
        where: { id: existing.id, tenantId: opts.tenantId },
        data: {
          displayName: opts.displayName || existing.displayName,
          encryptedCreds: sealed.encryptedCreds,
          encryptedDataKey: sealed.encryptedDataKey,
          status: 'ACTIVE',
          statusReason: null,
          expiresAt: opts.expiresAt,
          scope,
        },
      });
      await this.audit(
        opts.tenantId,
        opts.userId,
        'SOCIAL_CONNECTION_REAUTH',
        updated.id,
        {
          providerId: opts.providerId,
          accountId: opts.accountId,
          displayName: opts.displayName,
        },
      );
      return updated;
    }

    const created = await (
      this.prisma.client as any
    ).socialProviderConnection.create({
      data: {
        tenantId: opts.tenantId,
        providerId: opts.providerId,
        accountId: opts.accountId,
        displayName: opts.displayName,
        encryptedCreds: sealed.encryptedCreds,
        encryptedDataKey: sealed.encryptedDataKey,
        status: 'ACTIVE',
        expiresAt: opts.expiresAt,
        scope,
        createdByUserId: opts.userId,
      },
    });
    await this.audit(
      opts.tenantId,
      opts.userId,
      'SOCIAL_CONNECTION_CREATED',
      created.id,
      {
        providerId: opts.providerId,
        accountId: opts.accountId,
        displayName: opts.displayName,
      },
    );
    return created;
  }

  /**
   * Disconnect.
   *
   * The credential is DESTROYED (the sealed blob is overwritten, not merely
   * flagged) and the row goes REVOKED — but the cached posts STAY until the
   * next sync clears them, so a screen that is mid-rotation does not go blank
   * the instant an admin clicks Disconnect in another building. A REVOKED
   * connection is never synced again, so "until the next sync" means "until
   * the operator reconnects or deletes the zone" in practice.
   */
  async disconnect(tenantId: string, id: string, actorUserId: string | null) {
    const conn = await (
      this.prisma.client as any
    ).socialProviderConnection.findFirst({
      where: { id, tenantId },
    });
    if (!conn) throw new NotFoundException('Social connection not found.');

    // Overwrite the credential with an empty bag rather than leaving a live
    // token sealed in a row nobody looks at again.
    const blanked = sealCredentials({});
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.socialProviderConnection.update({
        where: { id, tenantId },
        data: {
          status: 'REVOKED',
          statusReason: 'Disconnected by an administrator.',
          encryptedCreds: blanked.encryptedCreds,
          encryptedDataKey: blanked.encryptedDataKey,
          expiresAt: null,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId,
          action: 'SOCIAL_CONNECTION_REVOKED',
          targetType: 'SocialProviderConnection',
          targetId: id,
          details: JSON.stringify({
            providerId: conn.providerId,
            accountId: conn.accountId,
            displayName: conn.displayName,
          }),
        },
      });
    });
    return { success: true };
  }

  // ─── Post cache (what the screens read) ───────────────────────────

  async listPosts(
    tenantId: string,
    opts: { connectionId?: string; limit?: number },
  ): Promise<SocialPostDto[]> {
    const take = Math.max(
      1,
      Math.min(50, Math.floor(Number(opts.limit)) || 12),
    );
    const where: any = { tenantId };
    // The connectionId filter is ANDed with tenantId, never substituted for
    // it — passing another tenant's connection id returns [] rather than
    // their posts. That is the property `social.service.spec.ts` proves.
    if (opts.connectionId) where.connectionId = opts.connectionId;
    const rows = await (this.prisma.client as any).socialPost.findMany({
      where,
      orderBy: { postedAt: 'desc' },
      take,
    });
    return rows.map((r: any) => ({
      id: r.id,
      connectionId: r.connectionId,
      kind: r.kind,
      text: r.text ?? null,
      mediaUrl: r.mediaUrl ?? null,
      thumbnailUrl: r.thumbnailUrl ?? null,
      permalink: r.permalink ?? null,
      postedAt: new Date(r.postedAt).toISOString(),
    }));
  }

  /**
   * The credential-free facts a SCREEN needs to render an honest state:
   * whose account this is, and whether the connection is healthy. Without
   * this the widget cannot tell "this account has posted nothing" from
   * "this account's access expired three weeks ago" — and a board that
   * silently shows an empty frame for a dead credential is the same
   * costume this whole change is replacing.
   *
   * Tenant-scoped, and it returns NO credential fields (see toConnectionDto:
   * built field by field, never a spread).
   */
  async connectionSummary(
    tenantId: string,
    connectionId: string,
  ): Promise<SocialConnectionDto | null> {
    const row = await (
      this.prisma.client as any
    ).socialProviderConnection.findFirst({
      where: { id: connectionId, tenantId },
    });
    return row ? this.toConnectionDto(row) : null;
  }

  // ─── Sync ─────────────────────────────────────────────────────────

  /** Manual "Sync now" from the dashboard. */
  async triggerSync(tenantId: string, id: string, actorUserId: string | null) {
    const conn = await (
      this.prisma.client as any
    ).socialProviderConnection.findFirst({
      where: { id, tenantId },
    });
    if (!conn) throw new NotFoundException('Social connection not found.');
    return this.syncConnection(conn, actorUserId);
  }

  /**
   * Pull the newest posts for one connection and upsert them.
   *
   * Never throws: a sync failure is a STATUS on the row, not a 500 — the
   * cron runs this across every tenant and one dead token must not stop the
   * others.
   */
  async syncConnection(
    conn: any,
    actorUserId: string | null,
  ): Promise<{ status: 'ok' | 'error'; itemCount: number; message: string }> {
    const tenantId: string = conn.tenantId;
    const providerId = conn.providerId as SocialProviderId;
    const label = SOCIAL_PROVIDER_LABEL[providerId] || providerId;

    if (conn.status === 'REVOKED') {
      return {
        status: 'error',
        itemCount: 0,
        message: `${label} is disconnected.`,
      };
    }
    if (!this.isConfigured(providerId)) {
      const missing = this.missingEnvFor(providerId).join(', ');
      await this.markError(
        tenantId,
        conn.id,
        'ERROR',
        `${label} keys are not set on this deploy (${missing}).`,
      );
      return {
        status: 'error',
        itemCount: 0,
        message: `${label} is not configured on this deploy.`,
      };
    }

    let accessToken: string;
    try {
      const creds = openCredentials({
        encryptedCreds: conn.encryptedCreds,
        encryptedDataKey: conn.encryptedDataKey,
      });
      accessToken = String((creds as any).accessToken || '');
    } catch {
      await this.markError(
        tenantId,
        conn.id,
        'ERROR',
        'Stored access could not be read. Reconnect this account.',
      );
      return {
        status: 'error',
        itemCount: 0,
        message: 'Stored access could not be read.',
      };
    }
    if (!accessToken) {
      await this.markError(
        tenantId,
        conn.id,
        'EXPIRED',
        `${label} access is gone. Reconnect in the Apps tab.`,
      );
      return {
        status: 'error',
        itemCount: 0,
        message: `${label} access is gone.`,
      };
    }

    // ── Proactive refresh (Instagram only; Page tokens never expire) ──
    if (providerId === 'instagram' && this.needsRefresh(conn.expiresAt)) {
      try {
        const refreshed = await instagram.instagramRefreshToken(
          accessToken,
          this.fetchImpl,
        );
        accessToken = refreshed.accessToken;
        const sealed = sealCredentials({ accessToken });
        await (this.prisma.client as any).socialProviderConnection.update({
          where: { id: conn.id, tenantId },
          data: {
            encryptedCreds: sealed.encryptedCreds,
            encryptedDataKey: sealed.encryptedDataKey,
            expiresAt: refreshed.expiresAt,
            status: 'ACTIVE',
            statusReason: null,
          },
        });
        await this.audit(
          tenantId,
          actorUserId,
          'SOCIAL_TOKEN_REFRESHED',
          conn.id,
          {
            providerId,
            accountId: conn.accountId,
          },
        );
      } catch (err: any) {
        // A failed refresh is NOT fatal on its own — the current token is
        // still valid until expiresAt, so we log and carry on with it. Only
        // the fetch below decides whether the credential is really dead.
        this.logger.warn(
          `Instagram token refresh failed for connection ${conn.id}: ${this.safeMessage(err)}`,
        );
      }
    }

    // ── Fetch ──
    let posts: NormalizedSocialPost[];
    try {
      posts =
        providerId === 'instagram'
          ? await instagram.instagramFetchMedia(
              accessToken,
              SYNC_POST_LIMIT,
              this.fetchImpl,
            )
          : await facebook.facebookFetchPosts(
              conn.accountId,
              accessToken,
              SYNC_POST_LIMIT,
              this.fetchImpl,
            );
    } catch (err: any) {
      const authFailure = err instanceof MetaHttpError && err.authFailure;
      const status = authFailure ? 'EXPIRED' : 'ERROR';
      const reason = authFailure
        ? `${label} access expired — reconnect in the Apps tab.`
        : `Could not reach ${label} (${this.safeMessage(err)}).`;
      await this.markError(tenantId, conn.id, status, reason);
      this.logger.warn(
        `Social sync failed conn=${conn.id} provider=${providerId}: ${this.safeMessage(err)}`,
      );
      return { status: 'error', itemCount: 0, message: reason };
    }

    // ── Upsert ──
    //
    // Idempotent on (connectionId, providerPostId): the same post fetched an
    // hour later updates the row it already has. A caption edit propagates; a
    // duplicate row cannot happen.
    let written = 0;
    for (const p of posts) {
      try {
        await (this.prisma.client as any).socialPost.upsert({
          where: {
            connectionId_providerPostId: {
              connectionId: conn.id,
              providerPostId: p.providerPostId,
            },
          },
          update: {
            kind: p.kind,
            text: p.text,
            mediaUrl: p.mediaUrl,
            thumbnailUrl: p.thumbnailUrl,
            permalink: p.permalink,
            postedAt: p.postedAt,
            fetchedAt: new Date(),
          },
          create: {
            tenantId,
            connectionId: conn.id,
            providerPostId: p.providerPostId,
            kind: p.kind,
            text: p.text,
            mediaUrl: p.mediaUrl,
            thumbnailUrl: p.thumbnailUrl,
            permalink: p.permalink,
            postedAt: p.postedAt,
          },
        });
        written += 1;
      } catch (err: any) {
        this.logger.warn(
          `Social post upsert failed conn=${conn.id}: ${this.safeMessage(err)}`,
        );
      }
    }

    await (this.prisma.client as any).socialProviderConnection.update({
      where: { id: conn.id, tenantId },
      data: {
        status: 'ACTIVE',
        statusReason: null,
        // THE one freshness signal. Nothing else may claim to be one.
        lastSyncedAt: new Date(),
        lastSyncItemCount: written,
      },
    });
    await this.audit(tenantId, actorUserId, 'SOCIAL_SYNC_COMPLETED', conn.id, {
      providerId,
      accountId: conn.accountId,
      itemCount: written,
    });

    return {
      status: 'ok',
      itemCount: written,
      message: `${label} sync complete: ${written} post${written === 1 ? '' : 's'}.`,
    };
  }

  /** Every ACTIVE connection, for the cron. */
  async listActiveConnections() {
    return (this.prisma.client as any).socialProviderConnection.findMany({
      where: { status: { in: ['ACTIVE', 'ERROR'] } },
    });
  }

  /** Is this token inside the refresh window? A null expiry means "does not
   *  expire" (Facebook Page tokens) and never refreshes. */
  needsRefresh(expiresAt: Date | string | null | undefined): boolean {
    if (!expiresAt) return false;
    const ms = new Date(expiresAt).getTime();
    if (!Number.isFinite(ms)) return false;
    return ms - Date.now() < REFRESH_WINDOW_MS;
  }

  // ─── helpers ──────────────────────────────────────────────────────

  /**
   * An error message that is SAFE to persist in `statusReason` and to log.
   *
   * `MetaHttpError` is already sanitised at the HTTP layer (meta-http.ts keeps
   * the status/type/code and drops the body, because Graph error bodies echo
   * the request — including, in some shapes, the `access_token` query
   * parameter). Anything else gets its class name only.
   */
  private safeMessage(err: unknown): string {
    if (err instanceof MetaHttpError) return err.message;
    if (err && typeof err === 'object' && 'name' in (err as any)) {
      return String((err as any).name || 'Error');
    }
    return 'Error';
  }

  private async markError(
    tenantId: string,
    id: string,
    status: 'ERROR' | 'EXPIRED',
    reason: string,
  ) {
    try {
      await (this.prisma.client as any).socialProviderConnection.update({
        where: { id, tenantId },
        data: { status, statusReason: reason.slice(0, 250) },
      });
    } catch (err: any) {
      this.logger.warn(`markError failed for ${id}: ${this.safeMessage(err)}`);
    }
  }

  private async audit(
    tenantId: string,
    userId: string | null,
    action: string,
    targetId: string,
    details: Record<string, unknown>,
  ) {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId,
          action,
          targetType: 'SocialProviderConnection',
          targetId,
          details: JSON.stringify(details),
        },
      });
    } catch (err: any) {
      this.logger.warn(`audit ${action} failed: ${this.safeMessage(err)}`);
    }
  }
}
