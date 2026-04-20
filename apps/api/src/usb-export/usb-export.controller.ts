/**
 * POST /api/v1/usb-export/bundle
 *
 * Builds a signed USB content bundle in memory and streams it back as a
 * ZIP attachment. Bundle is playback-identical to a live publish: the
 * manifest's `playlists[]` shape matches `/screens/:id/manifest`
 * exactly (template + zones + defaultConfig + per-item duration), so
 * the Android player renders a USB-sourced bundle with the same code
 * path it uses for network-scheduled content. Custom text, slide
 * durations, countdown dates, menu items — all carried in
 * template.zones[*].defaultConfig.
 *
 * ZIP layout (matches CLAUDE.md Sprint 7 spec):
 *   edu-cms-content/
 *     manifest.json      ← JSON, includes template + zones + config
 *     manifest.sig       ← HMAC-SHA256(manifest.json, tenant.usbIngestKey)
 *     assets/<sha256>.<ext>   ← one file per unique asset
 *     README.txt         ← operator-readable summary
 */

import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { createHmac } from 'crypto';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { safeFetch } from '../branding/safe-fetch';

interface BundleBody {
  screenId?: string;
  playlistIds: string[];
  includeEmergency?: boolean;
  bundleLabel?: string;
}

interface ManifestAsset {
  url: string;
  storagePath: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
}

interface ManifestZone {
  id: string;
  name: string;
  widgetType: string;
  x: number; y: number; width: number; height: number;
  zIndex: number;
  sortOrder: number | null;
  defaultConfig: any;
}

interface ManifestTemplate {
  id: string;
  name: string;
  screenWidth: number;
  screenHeight: number;
  bgColor: string | null;
  bgGradient: string | null;
  bgImage: string | null;
  zones: ManifestZone[];
}

interface ManifestPlaylistItem {
  url: string;
  duration_ms: number;
  sequence: number;
  transition_type: string | null;
  asset: ManifestAsset;
}

interface ManifestPlaylist {
  id: string;
  name: string;
  template?: ManifestTemplate;
  items: ManifestPlaylistItem[];
}

interface SignedManifest {
  version: 1;
  tenantId: string;
  tenantSlug: string | null;
  screenId: string | null;
  bundleLabel: string | null;
  createdAt: string;
  expiresAt: string;
  playlists: ManifestPlaylist[];
  emergencyPlaylists: ManifestPlaylist[];
  assetCount: number;
  totalBytes: number;
  exporterUserId: string;
  truncated: boolean;
}

const MAX_ASSETS_PER_BUNDLE = 500;
const MAX_BYTES_PER_BUNDLE = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_ASSET_FETCH_TIMEOUT_MS = 30_000;
const BUNDLE_VALID_DAYS = 30;

function tryParse(s: any): any {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return s; }
}

function extFromMimeOrUrl(mime: string | null | undefined, url: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('svg')) return 'svg';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('pdf')) return 'pdf';
  const dot = url.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i);
  return (dot?.[1] || 'bin').toLowerCase();
}

@Controller('api/v1/usb-export')
@UseGuards(JwtAuthGuard, RbacGuard)
export class UsbExportController {
  private readonly logger = new Logger('UsbExport');
  constructor(private readonly prisma: PrismaService) {}

  @Post('bundle')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  async bundle(
    @Req() req: Request & { user: any },
    @Res() res: Response,
    @Body() body: BundleBody,
  ) {
    const tenantId = req.user.tenantId;

    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, slug: true, usbIngestEnabled: true, usbIngestKey: true,
        // Emergency playlist — schema currently has a single
        // emergencyPlaylistId; emergency type (lockdown/evacuate/weather/
        // all-clear) is distinguished at trigger time, not per-playlist.
        // If we ever split these into four distinct playlists, expand
        // the select + the emergencyIds array below.
        emergencyPlaylistId: true,
      },
    });
    if (!tenant) throw new HttpException('Tenant not found', HttpStatus.NOT_FOUND);
    if (!tenant.usbIngestEnabled) {
      throw new HttpException(
        'USB ingest is disabled for this tenant. Enable it in Settings → USB before exporting a bundle.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!tenant.usbIngestKey) {
      throw new HttpException(
        'Tenant has no USB signing key. Generate one in Settings → USB before exporting.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const playlistIds = Array.isArray(body.playlistIds) ? body.playlistIds : [];
    if (playlistIds.length === 0) {
      throw new HttpException('playlistIds is required (non-empty)', HttpStatus.BAD_REQUEST);
    }

    let screen: { id: string; tenantId: string | null } | null = null;
    if (body.screenId) {
      screen = await this.prisma.client.screen.findUnique({
        where: { id: body.screenId },
        select: { id: true, tenantId: true },
      });
      if (!screen || screen.tenantId !== tenantId) {
        throw new HttpException('Screen not found in your tenant', HttpStatus.NOT_FOUND);
      }
    }

    // IDENTICAL include() shape to screens.controller.ts getManifest() so
    // the USB-sourced manifest renders in the player via the same code
    // path as a scheduled publish. template.zones carries every widget
    // config (custom text, slide timings, countdown dates, menu items).
    const playlistInclude = {
      items: {
        include: { asset: true },
        orderBy: { sequenceOrder: 'asc' as const },
      },
      template: {
        include: { zones: { orderBy: { sortOrder: 'asc' as const } } },
      },
    };

    const playlistsRaw = await this.prisma.client.playlist.findMany({
      where: { id: { in: playlistIds }, tenantId },
      include: playlistInclude,
    });
    if (playlistsRaw.length === 0) {
      throw new HttpException('No matching playlists in this tenant', HttpStatus.NOT_FOUND);
    }

    const emergencyIds = body.includeEmergency
      ? [tenant.emergencyPlaylistId].filter((x): x is string => !!x)
      : [];
    const emergencyRaw = emergencyIds.length
      ? await this.prisma.client.playlist.findMany({
          where: { id: { in: emergencyIds }, tenantId },
          include: playlistInclude,
        })
      : [];

    // ───────── Download assets + assemble ZIP ─────────
    const zip = new JSZip();
    const root = zip.folder('edu-cms-content')!;
    const assetsDir = root.folder('assets')!;
    const seenHashes = new Set<string>();
    let totalBytes = 0;
    let assetCount = 0;
    let truncated = false;

    const serializeTemplate = (t: any): ManifestTemplate | undefined => {
      if (!t) return undefined;
      return {
        id: t.id,
        name: t.name,
        screenWidth: t.screenWidth,
        screenHeight: t.screenHeight,
        bgColor: t.bgColor,
        bgGradient: t.bgGradient,
        bgImage: t.bgImage,
        zones: (t.zones || []).map((z: any) => ({
          id: z.id,
          name: z.name,
          widgetType: z.widgetType,
          x: z.x, y: z.y, width: z.width, height: z.height,
          zIndex: z.zIndex,
          sortOrder: z.sortOrder ?? null,
          // defaultConfig is stored as JSON string in Prisma — parse it so
          // the player doesn't receive double-encoded JSON. Mirrors
          // screens.controller.ts:601.
          defaultConfig: z.defaultConfig ? tryParse(z.defaultConfig) : null,
        })),
      };
    };

    const processPlaylist = async (p: any): Promise<ManifestPlaylist> => {
      const items: ManifestPlaylistItem[] = [];
      for (const it of p.items) {
        const asset = it.asset;
        if (!asset?.fileUrl) continue;

        const hash = asset.fileHash?.trim();
        if (!hash) {
          this.logger.warn(`Skipping asset ${asset.id} — no fileHash`);
          continue;
        }
        const ext = extFromMimeOrUrl(asset.mimeType, asset.fileUrl);
        const storagePath = `assets/${hash}.${ext}`;

        if (!seenHashes.has(hash)) {
          if (assetCount >= MAX_ASSETS_PER_BUNDLE) { truncated = true; break; }
          try {
            const fetched = await safeFetch(asset.fileUrl, {
              maxBytes: 200 * 1024 * 1024,
              timeoutMs: MAX_ASSET_FETCH_TIMEOUT_MS,
            });
            if (totalBytes + fetched.body.byteLength > MAX_BYTES_PER_BUNDLE) {
              truncated = true;
              break;
            }
            assetsDir.file(`${hash}.${ext}`, fetched.body);
            seenHashes.add(hash);
            totalBytes += fetched.body.byteLength;
            assetCount += 1;
          } catch (e: any) {
            this.logger.warn(`Asset fetch failed for ${asset.fileUrl}: ${e?.message}`);
          }
        }

        items.push({
          url: asset.fileUrl,
          duration_ms: it.durationMs,
          sequence: it.sequenceOrder,
          transition_type: it.transitionType ?? null,
          asset: {
            url: asset.fileUrl,
            storagePath,
            sha256: hash,
            mimeType: asset.mimeType || 'application/octet-stream',
            sizeBytes: asset.fileSize || 0,
          },
        });
      }
      const out: ManifestPlaylist = { id: p.id, name: p.name, items };
      const tpl = serializeTemplate((p as any).template);
      if (tpl) out.template = tpl;
      return out;
    };

    const playlists: ManifestPlaylist[] = [];
    for (const p of playlistsRaw) playlists.push(await processPlaylist(p));
    const emergencyPlaylists: ManifestPlaylist[] = [];
    for (const p of emergencyRaw) emergencyPlaylists.push(await processPlaylist(p));

    const manifest: SignedManifest = {
      version: 1,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      screenId: screen?.id ?? null,
      bundleLabel: (body.bundleLabel || '').slice(0, 200) || null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + BUNDLE_VALID_DAYS * 86400_000).toISOString(),
      playlists,
      emergencyPlaylists,
      assetCount,
      totalBytes,
      exporterUserId: req.user.id,
      truncated,
    };
    const manifestJson = JSON.stringify(manifest, null, 2);
    const signature = createHmac('sha256', Buffer.from(tenant.usbIngestKey, 'hex'))
      .update(manifestJson, 'utf-8')
      .digest('hex');

    root.file('manifest.json', manifestJson);
    root.file('manifest.sig', signature);
    root.file(
      'README.txt',
      [
        'EDU CMS — USB Content Bundle',
        `Tenant: ${tenant.slug || tenant.id}`,
        `Created: ${manifest.createdAt}`,
        `Expires: ${manifest.expiresAt}`,
        `Playlists: ${playlists.length}${emergencyPlaylists.length ? ` (+ ${emergencyPlaylists.length} emergency)` : ''}`,
        `Assets:  ${assetCount}  (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`,
        truncated ? '⚠ TRUNCATED — bundle hit size/count cap. Consider splitting across multiple USBs.' : '',
        '',
        'How to use:',
        '  1. Plug this USB stick into a paired EDU CMS player.',
        '  2. The player prompts for an admin PIN before ingesting.',
        '  3. Content stays on-device and keeps playing offline.',
        '',
        'Do NOT modify manifest.json or manifest.sig — the player will',
        'reject any bundle whose signature does not match.',
      ].filter(Boolean).join('\n'),
    );

    await this.prisma.client.auditLog.create({
      data: {
        tenantId,
        userId: req.user.id,
        action: 'USB_BUNDLE_EXPORTED',
        targetType: 'Tenant',
        targetId: tenantId,
        details: JSON.stringify({
          screenId: screen?.id,
          playlistIds: playlists.map((p) => p.id),
          emergencyPlaylistIds: emergencyPlaylists.map((p) => p.id),
          assetCount,
          totalBytes,
          truncated,
          label: manifest.bundleLabel,
        }),
      },
    }).catch(() => { /* audit write failure shouldn't block export */ });

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const shortSig = signature.slice(0, 8);
    const filename = `edu-cms-bundle-${stamp}-${shortSig}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Bundle-Signature', shortSig);
    res.setHeader('X-Bundle-Asset-Count', String(assetCount));
    res.setHeader('X-Bundle-Truncated', truncated ? 'true' : 'false');
    res.end(zipBuffer);
  }
}
