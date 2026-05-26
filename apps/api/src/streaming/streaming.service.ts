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
import { safeFetch, validatePublicUrl, SsrfError } from '../branding/safe-fetch';

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
    // CYCLE-4 integrations-BUG-007 fix — reject oauth2 connect attempts
    // server-side. Frontend already disables the Connect button, but
    // double-check at the API boundary so a curl/Postman call cannot
    // create empty PENDING rows that pollute the connections list.
    // Mirrors apps/api/src/pos/pos.service.ts cycle-2 fix.
    if (provider.auth === 'oauth2') {
      throw new BadRequestException('OAuth flow not yet implemented for this provider. Contact sales for activation.');
    }
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
    // CYCLE-5 streaming-iframeOnly-stuck-pending fix: providers whose
    // auth is `iframeOnly` need no credential exchange — the embed URL
    // is the whole integration. Without flipping these to ACTIVE on
    // create, they sit in PENDING forever and the player can't pull
    // playback. Same logic as `auth === 'none'`: nothing to verify
    // server-side, the connection is usable as soon as it's saved.
    const autoActiveAuth = provider.auth === 'none' || provider.auth === 'iframeOnly';
    const row = await (this.prisma.client as any).streamProviderConnection.create({
      data: {
        tenantId: opts.tenantId,
        providerId: opts.providerId,
        displayName: opts.displayName,
        encryptedCreds: sealed.encryptedCreds,
        encryptedDataKey: sealed.encryptedDataKey,
        status: autoActiveAuth ? 'ACTIVE' : 'PENDING',
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

  async deleteConnection(tenantId: string, id: string, actorUserId?: string | null) {
    const row = await this.getConnection(tenantId, id);
    // 2026-05-23 launch audit P1: streaming connections store
    // encrypted OAuth credentials. Deleting one purges those secrets —
    // a privileged action that previously had ZERO forensic trail.
    // Wrap delete + audit in a $transaction so partial state is
    // impossible.
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.streamProviderConnection.delete({ where: { id: row.id } });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId ?? null,
          action: 'STREAM_CONNECTION_DELETED',
          targetType: 'StreamProviderConnection',
          targetId: id,
          details: JSON.stringify({
            providerId: row.providerId,
            displayName: row.displayName,
          }),
        },
      });
    });
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

  async deleteChannel(tenantId: string, id: string, actorUserId?: string | null) {
    const ch = await (this.prisma.client as any).streamChannel.findFirst({
      where: { id, tenantId },
    });
    if (!ch) throw new NotFoundException('Channel not found.');
    // 2026-05-23 launch audit P1: channel deletes are part of the
    // OAuth-bound stream surface — audit-log them too so the
    // forensic chain stays consistent with the connection delete.
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.streamChannel.delete({ where: { id: ch.id } });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId ?? null,
          action: 'STREAM_CHANNEL_DELETED',
          targetType: 'StreamChannel',
          targetId: id,
          details: JSON.stringify({
            connectionId: ch.connectionId,
            externalId: ch.externalId,
            title: ch.title,
          }),
        },
      });
    });
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

  /**
   * Server-side URL validator + embeddability probe for the Connect /
   * Pick-channels UI. Added 2026-05-25 streaming-overhaul. The
   * operator screenshot showed France 24 + a YouTube embed Error 153
   * shipping to the live preview because the underlying YouTube video
   * had embedding disabled. This endpoint pre-checks before the
   * operator wastes a screen-slot.
   *
   * Returns a structured assessment:
   *   { ok, type, embeddable, reason?, normalizedUrl?, suggestion? }
   *
   * - `type`: 'youtube' | 'twitch' | 'vimeo' | 'hls' | 'dash' |
   *           'public-broadcaster' | 'unknown'
   * - `embeddable`: best-effort yes/no
   * - `reason`: human-friendly explanation when not embeddable
   * - `suggestion`: alternate source to try
   *
   * SSRF-safe via validatePublicUrl + safeFetch. We NEVER call
   * fetch(url) directly on operator-supplied input.
   */
  async validateStreamUrl(rawUrl: string): Promise<{
    ok: boolean;
    type: string;
    embeddable: boolean;
    reason?: string;
    normalizedUrl?: string;
    suggestion?: string;
  }> {
    const url = String(rawUrl || '').trim();
    if (!url) {
      return { ok: false, type: 'unknown', embeddable: false, reason: 'No URL provided.' };
    }

    // Up-front scheme + private-IP guard (also enforces 80/443 ports).
    try {
      validatePublicUrl(url);
    } catch (e) {
      const msg = e instanceof SsrfError ? e.message : 'Invalid URL format.';
      return { ok: false, type: 'unknown', embeddable: false, reason: msg };
    }

    // ─── YouTube ───
    // The signage operator's #1 source. We check whether the video
    // owner permits embedding. The "embeddable" public flag isn't on
    // any YouTube URL, BUT the oEmbed endpoint returns 401 / 403 for
    // videos with embedding disabled — that's the structural signal.
    const ytWatchMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/live\/|youtube\.com\/embed\/)([\w-]{6,})/);
    const ytChannelMatch = url.match(/youtube\.com\/(?:c|channel|user|@)([\w-]+)(?:\/live)?/i);
    if (ytWatchMatch || ytChannelMatch) {
      // Channel-level live embeds (live_stream?channel=…) are always
      // permitted by YouTube — the channel owner publishes the
      // long-running stream, and channel embeds resolve to whichever
      // video is currently live. We assume embeddable unless someone
      // explicitly forbids; if the channel handle is valid, oEmbed
      // returns 200.
      const id = ytWatchMatch ? ytWatchMatch[1] : '';
      const probeUrl = ytWatchMatch
        ? `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`
        : `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      try {
        const r = await safeFetch(probeUrl, { timeoutMs: 6000, accept: 'application/json' });
        if (r.status === 401 || r.status === 403) {
          return {
            ok: false,
            type: 'youtube',
            embeddable: false,
            reason: "This YouTube video has embedding disabled by its owner (Error 153 at playback time). Pick another video or a public live channel — channel-level live embeds (youtube.com/@handle/live) usually work even when individual videos don't.",
            suggestion: 'Try a 24/7 live channel like NHK World, France 24, Bloomberg, or Sky News from the Public Broadcasters one-click connection.',
          };
        }
        if (r.status === 404) {
          return {
            ok: false,
            type: 'youtube',
            embeddable: false,
            reason: 'YouTube returned 404 — the video / channel does not exist or has been removed.',
          };
        }
        if (r.status >= 200 && r.status < 300) {
          return { ok: true, type: 'youtube', embeddable: true, normalizedUrl: url };
        }
        // 200-ish but not embeddable explicitly — surface the unknown
        // state so the operator can decide.
        return {
          ok: true,
          type: 'youtube',
          embeddable: true,
          reason: `YouTube probe returned ${r.status} — embedding likely permitted, but verify in preview.`,
        };
      } catch (e) {
        // Network-level error — don't block, but surface the warning.
        return {
          ok: true,
          type: 'youtube',
          embeddable: true,
          reason: `Could not pre-verify YouTube embedding (${e instanceof Error ? e.message : 'network error'}). The screen will still try to play this URL.`,
        };
      }
    }

    // ─── Twitch ───
    // Twitch embeds always work (anonymous-mode); the only gotcha is
    // the parent= query param needs to match the iframe host, which
    // the StreamingWidget already handles at render time.
    if (/twitch\.tv\/[\w-]+/i.test(url)) {
      return { ok: true, type: 'twitch', embeddable: true, normalizedUrl: url };
    }

    // ─── Vimeo ───
    if (/vimeo\.com\/(?:video\/)?\d+/.test(url)) {
      const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
      if (m) {
        try {
          // Vimeo oEmbed returns 403 with `domain_status_code` when
          // owner forbids embedding on this domain.
          const r = await safeFetch(
            `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
            { timeoutMs: 6000, accept: 'application/json' },
          );
          if (r.status === 403 || r.status === 401) {
            return {
              ok: false,
              type: 'vimeo',
              embeddable: false,
              reason: 'Vimeo refused the embed probe. The video owner may have restricted embedding to specific domains.',
            };
          }
          if (r.status === 404) {
            return { ok: false, type: 'vimeo', embeddable: false, reason: 'Vimeo returned 404 — video not found.' };
          }
          return { ok: true, type: 'vimeo', embeddable: true, normalizedUrl: url };
        } catch {
          return { ok: true, type: 'vimeo', embeddable: true, reason: 'Could not pre-verify embedding; live preview will surface any error.' };
        }
      }
    }

    // ─── HLS / DASH direct ───
    // Doing a HEAD with safeFetch tells us:
    //   • the URL resolves (no DNS / SSRF issues)
    //   • the content-type matches an HLS or DASH playlist
    // If the content-type is text/* we still pass — Akamai / Vimeo
    // sometimes return text/plain for m3u8.
    if (/\.m3u8(\?|$)/i.test(url)) {
      try {
        const r = await safeFetch(url, { timeoutMs: 6000, maxBytes: 64 * 1024 });
        if (r.status >= 400) {
          return {
            ok: false,
            type: 'hls',
            embeddable: false,
            reason: `HLS playlist returned ${r.status}.`,
          };
        }
        return { ok: true, type: 'hls', embeddable: true, normalizedUrl: url };
      } catch (e) {
        return {
          ok: false,
          type: 'hls',
          embeddable: false,
          reason: `Could not reach HLS playlist: ${e instanceof Error ? e.message : 'network error'}.`,
        };
      }
    }

    if (/\.mpd(\?|$)/i.test(url)) {
      try {
        const r = await safeFetch(url, { timeoutMs: 6000, maxBytes: 64 * 1024 });
        if (r.status >= 400) {
          return { ok: false, type: 'dash', embeddable: false, reason: `DASH manifest returned ${r.status}.` };
        }
        return { ok: true, type: 'dash', embeddable: true, normalizedUrl: url };
      } catch (e) {
        return {
          ok: false,
          type: 'dash',
          embeddable: false,
          reason: `Could not reach DASH manifest: ${e instanceof Error ? e.message : 'network error'}.`,
        };
      }
    }

    // ─── Unknown — let it through, but warn ───
    return {
      ok: true,
      type: 'unknown',
      embeddable: true,
      reason: 'URL format not recognized. Falling back to iframe; preview to verify.',
      normalizedUrl: url,
    };
  }
}
