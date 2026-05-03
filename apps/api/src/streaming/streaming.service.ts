/**
 * StreamingService — provider connections, channels, ad slots.
 *
 * Sprint 8c (2026-05-03). Tenant-scoped CRUD for streaming integrations.
 * Validates against the canonical catalog in
 * `@cms/api-types/streaming.ts` so a typo in providerId can't slip
 * through to the player.
 */
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  STREAM_PROVIDERS,
  getStreamProvider,
  PUBLIC_BROADCASTER_CHANNELS,
  presetEmbedUrl,
  type StreamConnectionDto,
  type StreamChannelDto,
} from '@cms/api-types';
import { sealCredentials, openCredentials } from './creds-cipher';

@Injectable()
export class StreamingService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Catalog ─────────────────────────────────────────────────────
  listProviders() {
    return STREAM_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      integrationTier: p.integrationTier,
      blurb: p.blurb,
      iconEmoji: p.iconEmoji,
      iconUrl: p.iconUrl,
      auth: p.auth,
      playback: p.playback,
      commercialUseLegal: p.commercialUseLegal,
      allowsAdOverlay: p.allowsAdOverlay,
      pricingNote: p.pricingNote,
      docsUrl: p.docsUrl,
      websiteUrl: p.websiteUrl,
      bestFor: p.bestFor,
      requiresVenueLicense: p.requiresVenueLicense,
      tierReason: p.tierReason,
      bridgeSteps: p.bridgeSteps,
    }));
  }

  /** Curated channel list for the `public-broadcasters` provider —
   *  shipped in code, no auth needed. */
  listPresetChannels(providerId: string) {
    if (providerId === 'public-broadcasters') {
      return PUBLIC_BROADCASTER_CHANNELS.map((c) => ({
        externalId: c.id,
        title: c.title,
        description: c.description,
        category: c.category,
        thumbnailUrl: c.thumbnailUrl,
        playbackUrl: c.hlsUrl,
        embedUrl: c.youtubeHandle ? presetEmbedUrl(c, { muted: true, autoplay: true }) : undefined,
        playbackType: c.hlsUrl ? 'hls' : 'iframe',
        allowAdOverlay: c.allowAdOverlay,
      }));
    }
    return [];
  }

  // ─── Connections ─────────────────────────────────────────────────
  async listConnections(tenantId: string): Promise<StreamConnectionDto[]> {
    const rows = await (this.prisma.client as any).streamProviderConnection.findMany({
      where: { tenantId },
      include: { _count: { select: { channels: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r: any) => ({
      id: r.id,
      providerId: r.providerId,
      providerName: getStreamProvider(r.providerId)?.name || r.providerId,
      displayName: r.displayName || undefined,
      status: r.status,
      statusReason: r.statusReason || undefined,
      lastVerifiedAt: r.lastVerifiedAt?.toISOString(),
      expiresAt: r.expiresAt?.toISOString(),
      channelCount: r._count?.channels ?? 0,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createConnection(opts: {
    tenantId: string;
    userId: string;
    providerId: string;
    displayName?: string;
    credentials: Record<string, unknown>;
  }) {
    const provider = getStreamProvider(opts.providerId);
    if (!provider) throw new BadRequestException(`Unknown provider: ${opts.providerId}`);
    if (!provider.commercialUseLegal) {
      throw new ForbiddenException(
        `${provider.name} does not permit commercial venue display per its TOS.`,
      );
    }
    if (provider.integrationTier === 'CLOSED') {
      throw new ForbiddenException(
        `${provider.name} does not have a public API or bridge workflow. ${provider.tierReason || ''}`,
      );
    }
    // PARTNER + BRIDGE both save in PENDING. PARTNER waits on vendor
    // OAuth approval; BRIDGE waits on the operator getting their
    // capture-card workflow live and pasting the local HLS URL.
    // Validate auth shape per provider — minimal at the framework
    // level; per-provider handlers can do deeper validation in a
    // future commit.
    const creds = opts.credentials || {};
    if (provider.auth === 'apiKey' && !(creds as any).apiKey) {
      throw new BadRequestException('apiKey required for this provider.');
    }
    if (provider.auth === 'license' && !(creds as any).licenseNumber) {
      throw new BadRequestException('licenseNumber required for this provider.');
    }
    if (provider.auth === 'customHls' && !(creds as any).playbackUrl) {
      throw new BadRequestException('playbackUrl required.');
    }

    const sealed = sealCredentials(creds);
    const row = await (this.prisma.client as any).streamProviderConnection.create({
      data: {
        tenantId: opts.tenantId,
        providerId: opts.providerId,
        displayName: opts.displayName,
        encryptedCreds: sealed.encryptedCreds,
        encryptedDataKey: sealed.encryptedDataKey,
        status: provider.auth === 'none' ? 'ACTIVE' : 'PENDING',
        createdByUserId: opts.userId,
      },
    });
    return row;
  }

  async getConnection(tenantId: string, id: string) {
    const row = await (this.prisma.client as any).streamProviderConnection.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Streaming connection not found.');
    return row;
  }

  async deleteConnection(tenantId: string, id: string) {
    const row = await this.getConnection(tenantId, id);
    await (this.prisma.client as any).streamProviderConnection.delete({ where: { id: row.id } });
  }

  /** Decrypt credentials for use by a per-provider handler. NEVER
   *  exposed to the web app — only callable inside the API process. */
  async decryptCredentials(tenantId: string, id: string): Promise<Record<string, unknown>> {
    const row = await this.getConnection(tenantId, id);
    return openCredentials({
      encryptedCreds: row.encryptedCreds,
      encryptedDataKey: row.encryptedDataKey,
    });
  }

  // ─── Channels ────────────────────────────────────────────────────
  async listChannels(tenantId: string): Promise<StreamChannelDto[]> {
    const rows = await (this.prisma.client as any).streamChannel.findMany({
      where: { tenantId },
      include: { connection: { select: { providerId: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((c: any) => ({
      id: c.id,
      connectionId: c.connectionId,
      providerId: c.connection?.providerId || '',
      externalId: c.externalId,
      kind: c.kind,
      title: c.title,
      description: c.description || undefined,
      thumbnailUrl: c.thumbnailUrl || undefined,
      category: c.category || undefined,
      playbackUrl: c.playbackUrl || undefined,
      playbackType: c.playbackType || undefined,
      allowAdOverlay: c.allowAdOverlay,
      status: c.status,
    }));
  }

  async addChannel(opts: {
    tenantId: string;
    connectionId: string;
    externalId: string;
    title: string;
    description?: string;
    category?: string;
    thumbnailUrl?: string;
    playbackUrl?: string;
    playbackType?: string;
    kind?: 'LIVE' | 'VOD' | 'PLAYLIST' | 'RADIO';
    allowAdOverlay?: boolean;
  }) {
    const conn = await this.getConnection(opts.tenantId, opts.connectionId);
    return (this.prisma.client as any).streamChannel.create({
      data: {
        tenantId: opts.tenantId,
        connectionId: conn.id,
        externalId: opts.externalId,
        title: opts.title,
        description: opts.description,
        category: opts.category,
        thumbnailUrl: opts.thumbnailUrl,
        playbackUrl: opts.playbackUrl,
        playbackType: opts.playbackType,
        kind: opts.kind || 'LIVE',
        allowAdOverlay: opts.allowAdOverlay !== false,
      },
    });
  }

  async deleteChannel(tenantId: string, id: string) {
    const ch = await (this.prisma.client as any).streamChannel.findFirst({
      where: { id, tenantId },
    });
    if (!ch) throw new NotFoundException('Channel not found.');
    await (this.prisma.client as any).streamChannel.delete({ where: { id: ch.id } });
  }

  /** Resolve a channel into a playable URL for the player. For
   *  iframe providers this is the embed URL; for HLS providers it's
   *  the m3u8 URL (eventually with a signed token). */
  async resolvePlayback(tenantId: string, channelId: string) {
    const ch = await (this.prisma.client as any).streamChannel.findFirst({
      where: { id: channelId, tenantId },
    });
    if (!ch) throw new NotFoundException('Channel not found.');
    return {
      playbackUrl: ch.playbackUrl,
      playbackType: ch.playbackType,
      title: ch.title,
      allowAdOverlay: ch.allowAdOverlay,
    };
  }
}
